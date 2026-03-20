'use strict';
/**
 * Nam Task — Safety Controller v2
 *
 * Covers:
 *  SOS         — trigger, escalate, resolve, history
 *  Sessions    — open/close timed check-in windows per task
 *  Check-ins   — record, validate against session schedule
 *  Emergency contacts — CRUD
 *  GPS trail   — fetch route for a task
 *  Geofences   — set zone, detect breach
 *  Admin       — live session dashboard, SOS list, escalation
 */

const { query, getClient } = require('../config/database');
const { AppError }         = require('../middleware/errorHandler');
const notificationService  = require('../services/notificationService');
const pushService          = require('../services/pushNotificationService');
const logger               = require('../config/logger');

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

const geoInsert = (lat, lng) =>
  lat != null && lng != null
    ? `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`
    : 'NULL';

/** Notify all admins of a safety event via push + in-app */
const alertAdmins = async (title, body, data = {}) => {
  try {
    const admins = await query('SELECT id FROM users WHERE role=$1 AND is_active=TRUE', ['admin']);
    const adminIds = admins.rows.map(r => r.id);
    await Promise.all(adminIds.map(id =>
      notificationService.create(id, 'sos', title, body, data).catch(() => {})
    ));
    if (adminIds.length) await pushService.sendSOSAlert(adminIds, data.user_name ?? 'User', data);
    return adminIds.length;
  } catch (err) {
    logger.error('alertAdmins failed', err.message);
    return 0;
  }
};

/** Notify emergency contacts via in-app notification (SMS integration point) */
const alertEmergencyContacts = async (userId, message) => {
  try {
    const contacts = await query(
      'SELECT * FROM emergency_contacts WHERE user_id=$1 ORDER BY is_primary DESC',
      [userId]
    );
    for (const c of contacts.rows) {
      logger.info(`[safety] Emergency contact alert: ${c.name} (${c.phone}) — ${message}`);
      // TODO: Integrate SMS provider (MTC/Telecom Namibia) here:
      // await smsService.send(c.phone, `NAMTASK EMERGENCY: ${message}`);
    }
    return contacts.rows.length;
  } catch (err) {
    logger.error('alertEmergencyContacts failed', err.message);
    return 0;
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// SOS
// ═════════════════════════════════════════════════════════════════════════════

const triggerSOS = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { task_id, latitude, longitude, notes, escalation_level = 1 } = req.body;
    const user = req.user;

    // Validate task membership
    let taskInfo = null;
    if (task_id) {
      const tr = await client.query(
        'SELECT id, customer_id, tasker_id, title FROM tasks WHERE id=$1',
        [task_id]
      );
      taskInfo = tr.rows[0];
      const isParticipant = taskInfo && (
        taskInfo.customer_id === user.id || taskInfo.tasker_id === user.id
      );
      if (!isParticipant && user.role !== 'admin') {
        throw new AppError('You are not a participant in this task', 403);
      }
    }

    // Insert safety log with PostGIS location
    const locSql = (latitude != null && longitude != null)
      ? `ST_SetSRID(ST_MakePoint($7, $6), 4326)`
      : 'NULL';

    const logRes = await client.query(
      `INSERT INTO safety_logs
         (user_id, task_id, event_type, location, notes, metadata, escalation_level)
       VALUES ($1, $2, 'sos', ${locSql}, $3, $4, $5)
       RETURNING *`,
      [
        user.id, task_id || null,
        notes || 'SOS triggered',
        JSON.stringify({
          triggered_at:   new Date().toISOString(),
          escalation_level,
          app_version:    req.headers['x-app-version'] || null,
          battery_level:  req.body.battery_level || null,
        }),
        escalation_level,
        latitude, longitude,
      ]
    );
    const log = logRes.rows[0];

    // Mark GPS point as SOS-tagged
    if (latitude != null && longitude != null && task_id) {
      await client.query(
        `INSERT INTO gps_tracking (task_id, user_id, location, is_sos_point)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3,$4),4326), TRUE)`,
        [task_id, user.id, longitude, latitude]
      ).catch(() => {});
    }

    // Escalate the safety session if one exists
    if (task_id) {
      await client.query(
        `UPDATE safety_sessions SET status='escalated' WHERE task_id=$1 AND user_id=$2 AND status='active'`,
        [task_id, user.id]
      ).catch(() => {});
    }

    await client.query('COMMIT');

    // ── Notifications (outside transaction) ────────────────────────────────────

    // 1. Alert all admins
    const adminCount = await alertAdmins(
      '🚨 SOS ALERT',
      `${user.name} (${user.phone}) triggered SOS${taskInfo ? ` on task "${taskInfo.title}"` : ''}`,
      { user_id: user.id, user_name: user.name, task_id, log_id: log.id, screen: 'AdminSOS', channel: 'sos' }
    );

    // 2. Notify task partner (the OTHER participant)
    if (taskInfo) {
      const partnerId = user.id === taskInfo.customer_id ? taskInfo.tasker_id : taskInfo.customer_id;
      if (partnerId) {
        await notificationService.create(
          partnerId, 'sos',
          '🚨 Emergency Alert',
          `${user.name} has triggered an SOS for task "${taskInfo.title}". Please check on them.`,
          { task_id, log_id: log.id }
        );
      }
    }

    // 3. Level 2+: notify emergency contacts
    if (escalation_level >= 2) {
      await alertEmergencyContacts(
        user.id,
        `${user.name} triggered an emergency alert via NamTask app.${latitude ? ` Location: ${latitude.toFixed(4)},${longitude.toFixed(4)}` : ''}`
      );
      await query(
        'UPDATE safety_logs SET emergency_contact_notified=TRUE WHERE id=$1',
        [log.id]
      );
    }

    // 4. Socket broadcast to admins room
    if (req.app.get('io')) {
      req.app.get('io').to('admins').emit('sos:alert', {
        logId:     log.id,
        userId:    user.id,
        userName:  user.name,
        userPhone: user.phone,
        taskId:    task_id,
        latitude, longitude,
        notes:     notes || null,
        escalationLevel: escalation_level,
        timestamp: new Date().toISOString(),
      });
    }

    logger.info('[SOS] triggered', { userId: user.id, taskId: task_id, level: escalation_level, adminCount });

    res.status(201).json({
      success: true,
      message: '🚨 SOS alert sent. Help is on the way.',
      data: {
        log_id:          log.id,
        escalation_level,
        admins_notified:  adminCount,
        emergency_contacts_notified: escalation_level >= 2,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

const escalateSOS = async (req, res, next) => {
  try {
    const { id } = req.params;
    const log = await query('SELECT * FROM safety_logs WHERE id=$1', [id]);
    if (!log.rows.length) throw new AppError('Safety log not found', 404);
    if (log.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorised', 403);
    }

    const current = log.rows[0].escalation_level;
    if (current >= 3) {
      return res.json({ success: true, message: 'Already at maximum escalation level', data: log.rows[0] });
    }

    const newLevel = current + 1;
    const updated = await query(
      `UPDATE safety_logs SET escalation_level=$1, escalated_at=NOW() WHERE id=$2 RETURNING *`,
      [newLevel, id]
    );

    // Level 3: also alert emergency services (placeholder)
    if (newLevel === 3) {
      logger.warn('[SOS] Level 3 escalation — emergency services notification point', { logId: id });
      await alertEmergencyContacts(log.rows[0].user_id, 'LEVEL 3 EMERGENCY — please contact this person immediately.');
    }

    res.json({ success: true, message: `Escalated to level ${newLevel}`, data: updated.rows[0] });
  } catch (err) { next(err); }
};

const resolveSOS = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const result = await query(
      `UPDATE safety_logs
       SET is_resolved=TRUE, resolved_at=NOW(), resolved_by=$1,
           metadata = metadata || $2::jsonb
       WHERE id=$3 AND event_type='sos'
       RETURNING *`,
      [req.user.id, JSON.stringify({ resolution_notes: notes, resolved_by_name: req.user.name }), id]
    );
    if (!result.rows.length) throw new AppError('SOS log not found', 404);

    // Resume safety session if it was escalated
    await query(
      `UPDATE safety_sessions SET status='active' WHERE task_id=$1 AND status='escalated'`,
      [result.rows[0].task_id]
    ).catch(() => {});

    // Socket: inform admin room
    if (req.app.get('io')) {
      req.app.get('io').to('admins').emit('sos:resolved', { logId: id, resolvedBy: req.user.name });
    }

    res.json({ success: true, message: 'SOS resolved', data: result.rows[0] });
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// SAFETY SESSIONS
// ═════════════════════════════════════════════════════════════════════════════

const openSession = async (req, res, next) => {
  try {
    const { task_id, interval_minutes = 30 } = req.body;

    const task = await query(
      'SELECT id, customer_id, tasker_id, status FROM tasks WHERE id=$1',
      [task_id]
    );
    if (!task.rows.length) throw new AppError('Task not found', 404);
    const t = task.rows[0];
    if (t.status !== 'in_progress') throw new AppError('Sessions can only be opened for in-progress tasks', 400);
    if (t.tasker_id !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Only the assigned tasker can open a safety session', 403);
    }

    const nextDue = new Date(Date.now() + interval_minutes * 60_000);

    const result = await query(
      `INSERT INTO safety_sessions (task_id, user_id, interval_minutes, next_checkin_due)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, user_id) DO UPDATE
         SET status='active', interval_minutes=$3, next_checkin_due=$4,
             missed_checkins=0, ended_at=NULL
       RETURNING *`,
      [task_id, req.user.id, interval_minutes, nextDue]
    );

    // Notify the customer
    if (t.customer_id) {
      await notificationService.create(
        t.customer_id, 'safety_session',
        '🛡️ Safety Session Started',
        `${req.user.name} started a safety check-in session. They'll check in every ${interval_minutes} minutes.`,
        { task_id, session_id: result.rows[0].id }
      );
    }

    // Schedule a reminder push 5 min before first due
    const reminderDelay = Math.max(0, (interval_minutes - 5) * 60_000);
    setTimeout(async () => {
      const sess = await query('SELECT status FROM safety_sessions WHERE id=$1', [result.rows[0].id]);
      if (sess.rows[0]?.status === 'active') {
        await pushService.send(req.user.id, {
          title: '⏰ Check-in Due Soon',
          body:  `Your safety check-in for this task is due in 5 minutes.`,
          data:  { task_id, screen: 'Safety' },
        });
      }
    }, reminderDelay);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

const closeSession = async (req, res, next) => {
  try {
    const { task_id } = req.params;
    const result = await query(
      `UPDATE safety_sessions
       SET status='completed', ended_at=NOW()
       WHERE task_id=$1 AND user_id=$2 AND status IN ('active','paused')
       RETURNING *`,
      [task_id, req.user.id]
    );
    if (!result.rows.length) throw new AppError('No active session found for this task', 404);
    res.json({ success: true, message: 'Safety session closed', data: result.rows[0] });
  } catch (err) { next(err); }
};

const getSessionStatus = async (req, res, next) => {
  try {
    const { task_id } = req.params;
    const result = await query(
      `SELECT ss.*,
              EXTRACT(EPOCH FROM (ss.next_checkin_due - NOW())) AS seconds_until_due,
              CASE
                WHEN ss.next_checkin_due < NOW() THEN 'overdue'
                WHEN ss.next_checkin_due < NOW() + INTERVAL '5 minutes' THEN 'due_soon'
                ELSE 'ok'
              END AS urgency
       FROM safety_sessions ss
       WHERE ss.task_id=$1 AND ss.user_id=$2`,
      [task_id, req.user.id]
    );
    if (!result.rows.length) {
      return res.json({ success: true, data: null, active: false });
    }
    res.json({ success: true, data: result.rows[0], active: result.rows[0].status === 'active' });
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// CHECK-INS
// ═════════════════════════════════════════════════════════════════════════════

const checkIn = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { task_id, latitude, longitude, notes } = req.body;

    // Validate task
    const taskRes = await client.query(
      'SELECT id, customer_id, tasker_id, title FROM tasks WHERE id=$1',
      [task_id]
    );
    if (!taskRes.rows.length) throw new AppError('Task not found', 404);
    const task = taskRes.rows[0];

    // Insert log
    const locSql = (latitude != null && longitude != null)
      ? `ST_SetSRID(ST_MakePoint($4, $3), 4326)` : 'NULL';

    const logRes = await client.query(
      `INSERT INTO safety_logs (user_id, task_id, event_type, location, notes)
       VALUES ($1, $2, 'check_in', ${locSql}, $5)
       RETURNING *`,
      [req.user.id, task_id, latitude, longitude, notes || 'Check-in recorded']
    );

    // Update GPS tracking
    if (latitude != null && longitude != null) {
      await client.query(
        `INSERT INTO gps_tracking (task_id, user_id, location)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3,$4),4326))`,
        [task_id, req.user.id, longitude, latitude]
      ).catch(() => {});
    }

    // Update safety session
    let sessionData = null;
    const sessRes = await client.query(
      `SELECT * FROM safety_sessions WHERE task_id=$1 AND user_id=$2 AND status='active' FOR UPDATE`,
      [task_id, req.user.id]
    );

    if (sessRes.rows.length) {
      const sess   = sessRes.rows[0];
      const nextDue = new Date(Date.now() + sess.interval_minutes * 60_000);

      const updSess = await client.query(
        `UPDATE safety_sessions
         SET last_checkin_at=NOW(), next_checkin_due=$1,
             total_checkins=total_checkins+1, missed_checkins=0
         WHERE id=$2
         RETURNING *`,
        [nextDue, sess.id]
      );
      sessionData = updSess.rows[0];

      // Schedule next reminder
      const reminderDelay = Math.max(0, (sess.interval_minutes - 5) * 60_000);
      setTimeout(async () => {
        const current = await query('SELECT status FROM safety_sessions WHERE id=$1', [sess.id]);
        if (current.rows[0]?.status === 'active') {
          await pushService.send(req.user.id, {
            title: '⏰ Check-in Due Soon',
            body:  'Your safety check-in is due in 5 minutes.',
            data:  { task_id, screen: 'Safety' },
          });
        }
      }, reminderDelay);
    }

    await client.query('COMMIT');

    // Notify task partner
    const partnerId = req.user.id === task.customer_id ? task.tasker_id : task.customer_id;
    if (partnerId) {
      await notificationService.create(
        partnerId, 'safety_checkin',
        '✅ Check-In Received',
        `${req.user.name} checked in for "${task.title}"`,
        { task_id, log_id: logRes.rows[0].id }
      );
    }

    res.status(201).json({
      success: true,
      message: '✅ Check-in recorded',
      data: {
        log:     logRes.rows[0],
        session: sessionData,
        next_checkin_due: sessionData?.next_checkin_due ?? null,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// PROOF OF ARRIVAL
// ═════════════════════════════════════════════════════════════════════════════

const proofOfArrival = async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('Photo required', 400);
    const { task_id, latitude, longitude } = req.body;

    const url = `/uploads/proofs/${req.file.filename}`;

    const [log] = await Promise.all([
      query(
        `INSERT INTO safety_logs (user_id, task_id, event_type, notes, metadata)
         VALUES ($1, $2, 'proof_of_arrival', 'Proof of arrival uploaded', $3)
         RETURNING *`,
        [req.user.id, task_id || null,
         JSON.stringify({ image_url: url, latitude, longitude })]
      ),
      task_id ? query(
        'INSERT INTO task_images (task_id, url, type, uploaded_by) VALUES ($1,$2,$3,$4)',
        [task_id, url, 'proof_of_arrival', req.user.id]
      ) : Promise.resolve(),
    ]);

    // Notify task customer
    if (task_id) {
      const taskRes = await query('SELECT customer_id, title FROM tasks WHERE id=$1', [task_id]);
      if (taskRes.rows.length) {
        await notificationService.create(
          taskRes.rows[0].customer_id, 'system',
          '📍 Tasker Arrived',
          `${req.user.name} has arrived and uploaded proof of arrival for "${taskRes.rows[0].title}"`,
          { task_id }
        );
      }
    }

    res.status(201).json({ success: true, message: 'Proof of arrival uploaded', data: { url, log: log.rows[0] } });
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// EMERGENCY CONTACTS
// ═════════════════════════════════════════════════════════════════════════════

const getEmergencyContacts = async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM emergency_contacts WHERE user_id=$1 ORDER BY is_primary DESC, created_at ASC',
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

const upsertEmergencyContact = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { name, phone, relationship, is_primary = false } = req.body;

    // Check limit (max 3)
    const count = await client.query(
      'SELECT COUNT(*) FROM emergency_contacts WHERE user_id=$1', [req.user.id]
    );
    const id = req.params.id;
    if (!id && parseInt(count.rows[0].count) >= 3) {
      throw new AppError('Maximum 3 emergency contacts allowed', 400);
    }

    // If primary, demote existing
    if (is_primary) {
      await client.query(
        'UPDATE emergency_contacts SET is_primary=FALSE WHERE user_id=$1', [req.user.id]
      );
    }

    let result;
    if (id) {
      result = await client.query(
        `UPDATE emergency_contacts
         SET name=$1, phone=$2, relationship=$3, is_primary=$4, updated_at=NOW()
         WHERE id=$5 AND user_id=$6
         RETURNING *`,
        [name, phone, relationship || null, is_primary, id, req.user.id]
      );
      if (!result.rows.length) throw new AppError('Contact not found', 404);
    } else {
      result = await client.query(
        `INSERT INTO emergency_contacts (user_id, name, phone, relationship, is_primary)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.id, name, phone, relationship || null, is_primary]
      );
    }

    await client.query('COMMIT');
    res.status(id ? 200 : 201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

const deleteEmergencyContact = async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM emergency_contacts WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) throw new AppError('Contact not found', 404);
    res.json({ success: true, message: 'Contact removed' });
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// GPS TRAIL
// ═════════════════════════════════════════════════════════════════════════════

const getGPSTrail = async (req, res, next) => {
  try {
    const { task_id } = req.params;
    const { user_id, limit = 500 } = req.query;

    // Verify access
    const taskRes = await query(
      'SELECT customer_id, tasker_id FROM tasks WHERE id=$1', [task_id]
    );
    if (!taskRes.rows.length) throw new AppError('Task not found', 404);
    const task = taskRes.rows[0];
    const canAccess =
      task.customer_id === req.user.id ||
      task.tasker_id   === req.user.id ||
      req.user.role    === 'admin';
    if (!canAccess) throw new AppError('Not authorised', 403);

    const params = [task_id, parseInt(limit)];
    let userFilter = '';
    if (user_id) { userFilter = 'AND user_id=$3'; params.push(user_id); }

    const result = await query(
      `SELECT
         id, user_id, is_sos_point, speed, heading, accuracy,
         ST_X(location::geometry) AS longitude,
         ST_Y(location::geometry) AS latitude,
         recorded_at
       FROM gps_tracking
       WHERE task_id=$1 ${userFilter}
       ORDER BY recorded_at ASC
       LIMIT $2`,
      params
    );

    res.json({
      success: true,
      data:    result.rows,
      count:   result.rows.length,
      task_id,
    });
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// SAFETY LOGS
// ═════════════════════════════════════════════════════════════════════════════

const getSafetyLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, event_type, task_id } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const isAdmin = req.user.role === 'admin';

    const params = [];
    const conditions = isAdmin ? [] : ['sl.user_id=$1'];
    if (!isAdmin) params.push(req.user.id);
    let idx = params.length + 1;

    if (event_type) { conditions.push(`sl.event_type=$${idx++}`); params.push(event_type); }
    if (task_id)    { conditions.push(`sl.task_id=$${idx++}`);    params.push(task_id); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);

    const result = await query(
      `SELECT sl.*,
              u.name AS user_name, u.phone AS user_phone, u.role AS user_role,
              t.title AS task_title,
              ST_X(sl.location::geometry) AS longitude,
              ST_Y(sl.location::geometry) AS latitude,
              resolver.name AS resolved_by_name
       FROM safety_logs sl
       LEFT JOIN users u ON u.id = sl.user_id
       LEFT JOIN tasks t ON t.id = sl.task_id
       LEFT JOIN users resolver ON resolver.id = sl.resolved_by
       ${where}
       ORDER BY sl.created_at DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — Live session dashboard
// ═════════════════════════════════════════════════════════════════════════════

const getActiveSessions = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM v_active_safety ORDER BY seconds_until_due ASC NULLS LAST`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// MISSED CHECK-IN PROCESSOR  (called by cron every 5 minutes)
// ═════════════════════════════════════════════════════════════════════════════

const processMissedCheckIns = async () => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Find overdue sessions
    const overdue = await client.query(
      `SELECT ss.*, u.id AS user_id, u.name AS user_name, u.phone AS user_phone
       FROM safety_sessions ss
       JOIN users u ON u.id = ss.user_id
       WHERE ss.status = 'active'
         AND ss.next_checkin_due < NOW()
         AND ss.next_checkin_due > NOW() - INTERVAL '2 hours'`
    );

    for (const sess of overdue.rows) {
      const newMissed = sess.missed_checkins + 1;
      const newDue    = new Date(Date.now() + sess.interval_minutes * 60_000);

      await client.query(
        `UPDATE safety_sessions
         SET missed_checkins=$1, next_checkin_due=$2
         WHERE id=$3`,
        [newMissed, newDue, sess.id]
      );

      // Insert a missed check-in safety log
      await client.query(
        `INSERT INTO safety_logs (user_id, task_id, event_type, notes, metadata, escalation_level)
         VALUES ($1, $2, 'missed_checkin', $3, $4, $5)`,
        [
          sess.user_id, sess.task_id,
          `Missed check-in #${newMissed}`,
          JSON.stringify({ missed_count: newMissed, session_id: sess.id }),
          newMissed >= 3 ? 2 : 1,
        ]
      );

      // Level 1 (1–2 misses): push reminder
      if (newMissed <= 2) {
        await pushService.send(sess.user_id, {
          title: '⚠️ Check-in Overdue',
          body:  `You missed a safety check-in. Please check in now to let your partner know you're safe.`,
          data:  { task_id: sess.task_id, screen: 'Safety', priority: 'high' },
        }).catch(() => {});
      }

      // Level 2 (3 misses): auto-trigger SOS
      if (newMissed >= 3 && !sess.auto_sos_triggered) {
        await client.query(
          `INSERT INTO safety_logs (user_id, task_id, event_type, notes, metadata, escalation_level)
           VALUES ($1, $2, 'sos', $3, $4, 2)`,
          [
            sess.user_id, sess.task_id,
            'Auto-SOS: 3 consecutive missed check-ins',
            JSON.stringify({ auto_triggered: true, missed_checkins: newMissed }),
          ]
        );

        await client.query(
          `UPDATE safety_sessions SET auto_sos_triggered=TRUE, status='escalated' WHERE id=$1`,
          [sess.id]
        );

        await alertAdmins(
          '🚨 AUTO-SOS: Missed Check-Ins',
          `${sess.user_name} has missed ${newMissed} check-ins on task ${sess.task_id}. Auto-SOS triggered.`,
          { user_id: sess.user_id, task_id: sess.task_id, screen: 'AdminSOS' }
        );

        await alertEmergencyContacts(
          sess.user_id,
          `${sess.user_name} has missed ${newMissed} safety check-ins and an emergency alert has been raised.`
        );

        logger.warn('[safety] Auto-SOS triggered', { userId: sess.user_id, taskId: sess.task_id, missed: newMissed });
      }
    }

    await client.query('COMMIT');
    logger.debug(`[safety] Processed ${overdue.rows.length} overdue sessions`);
    return overdue.rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[safety] processMissedCheckIns error', err.message);
    return 0;
  } finally {
    client.release();
  }
};

module.exports = {
  // SOS
  triggerSOS, escalateSOS, resolveSOS,
  // Sessions
  openSession, closeSession, getSessionStatus,
  // Check-in
  checkIn, proofOfArrival,
  // Emergency contacts
  getEmergencyContacts, upsertEmergencyContact, deleteEmergencyContact,
  // GPS
  getGPSTrail,
  // Logs
  getSafetyLogs,
  // Admin
  getActiveSessions,
  // Cron
  processMissedCheckIns,
};
