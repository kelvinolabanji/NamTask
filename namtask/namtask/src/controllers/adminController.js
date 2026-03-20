'use strict';
const { query } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

// ─── Users ────────────────────────────────────────────────────────────────────

const listUsers = async (req, res, next) => {
  try {
    const { role, kyc_status, is_active, search, page = 1, limit = 20, sort = 'created_at', order = 'desc' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];
    let idx = 1;

    if (role)       { conditions.push(`u.role = $${idx++}`);                               params.push(role); }
    if (kyc_status) { conditions.push(`tp.verification_status = $${idx++}`);               params.push(kyc_status); }
    if (is_active !== undefined) { conditions.push(`u.is_active = $${idx++}`);             params.push(is_active === 'true'); }
    if (search)     {
      conditions.push(`(u.name ILIKE $${idx} OR u.phone ILIKE $${idx} OR u.email ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }

    const safeSortCols = { created_at: 'u.created_at', name: 'u.name', rating: 'u.rating', balance: 'w.balance' };
    const sortCol = safeSortCols[sort] ?? 'u.created_at';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';
    const where   = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit), offset);

    const [rows, countRes] = await Promise.all([
      query(
        `SELECT u.id, u.name, u.phone, u.email, u.role, u.rating, u.rating_count,
                u.is_active, u.is_verified, u.last_seen_at, u.created_at,
                w.balance AS wallet_balance, w.escrow_balance, w.total_earned,
                tp.verification_status, tp.skills, tp.categories,
                tp.hourly_rate, tp.total_tasks_completed, tp.background_check_passed
         FROM users u
         LEFT JOIN wallets w ON w.user_id = u.id
         LEFT JOIN tasker_profiles tp ON tp.user_id = u.id
         ${where}
         ORDER BY ${sortCol} ${sortDir}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params
      ),
      query(`SELECT COUNT(*) FROM users u LEFT JOIN tasker_profiles tp ON tp.user_id = u.id ${where}`, params.slice(0, -2)),
    ]);

    res.json({
      success: true,
      data: rows.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countRes.rows[0].count) },
    });
  } catch (err) { next(err); }
};

const getUser = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.*, w.balance, w.escrow_balance, w.total_earned, w.total_spent,
              tp.bio, tp.skills, tp.categories, tp.hourly_rate, tp.service_radius_km,
              tp.verification_status, tp.id_document_url, tp.background_check_passed,
              tp.total_tasks_completed, tp.total_earnings,
              (SELECT COUNT(*) FROM tasks WHERE customer_id=u.id) AS tasks_posted,
              (SELECT COUNT(*) FROM tasks WHERE tasker_id=u.id)   AS tasks_worked,
              (SELECT COUNT(*) FROM reviews WHERE reviewee_id=u.id) AS review_count
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       LEFT JOIN tasker_profiles tp ON tp.user_id = u.id
       WHERE u.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) throw new AppError('User not found', 404);
    const user = result.rows[0];
    delete user.password_hash;
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
};

const toggleUser = async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) throw new AppError('Cannot deactivate your own account', 400);
    const result = await query(
      'UPDATE users SET is_active = NOT is_active WHERE id = $1 RETURNING id, name, is_active',
      [req.params.id]
    );
    if (!result.rows.length) throw new AppError('User not found', 404);
    const u = result.rows[0];
    logger.info('Admin toggled user', { admin: req.user.id, target: req.params.id, is_active: u.is_active });
    res.json({ success: true, message: `User ${u.is_active ? 'activated' : 'deactivated'}`, data: u });
  } catch (err) { next(err); }
};

// ─── KYC ──────────────────────────────────────────────────────────────────────

const listKYCPending = async (req, res, next) => {
  try {
    const { status = 'pending', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [rows, countRes] = await Promise.all([
      query(
        `SELECT u.id, u.name, u.phone, u.email, u.avatar_url, u.created_at,
                tp.verification_status, tp.bio, tp.skills, tp.categories,
                tp.id_document_url, tp.background_check_passed,
                tp.total_tasks_completed, tp.updated_at AS profile_updated_at
         FROM tasker_profiles tp
         JOIN users u ON u.id = tp.user_id
         WHERE tp.verification_status = $1
         ORDER BY tp.updated_at ASC
         LIMIT $2 OFFSET $3`,
        [status, parseInt(limit), offset]
      ),
      query('SELECT COUNT(*) FROM tasker_profiles WHERE verification_status = $1', [status]),
    ]);

    res.json({
      success: true,
      data: rows.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countRes.rows[0].count) },
    });
  } catch (err) { next(err); }
};

const getTaskerKYC = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.phone, u.email, u.avatar_url, u.rating, u.rating_count, u.created_at,
              tp.*,
              (SELECT json_agg(json_build_object('id',r.id,'rating',r.rating,'comment',r.comment,'created_at',r.created_at))
               FROM reviews r WHERE r.reviewee_id = u.id ORDER BY r.created_at DESC LIMIT 5) AS recent_reviews
       FROM tasker_profiles tp
       JOIN users u ON u.id = tp.user_id
       WHERE tp.user_id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) throw new AppError('Tasker profile not found', 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

const updateKYCStatus = async (req, res, next) => {
  try {
    const { status, reason, admin_notes } = req.body;
    if (!['approved', 'rejected', 'in_review'].includes(status)) throw new AppError('Invalid status', 400);

    const result = await query(
      `UPDATE tasker_profiles
       SET verification_status = $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING *`,
      [status, req.params.id]
    );
    if (!result.rows.length) throw new AppError('Tasker not found', 404);

    // Audit log
    await query(
      `INSERT INTO safety_logs (user_id, event_type, notes, metadata)
       VALUES ($1, 'kyc_decision', $2, $3)`,
      [req.params.id, `KYC ${status} by admin ${req.user.id}`,
       JSON.stringify({ status, reason, admin_notes, decided_by: req.user.id, decided_at: new Date().toISOString() })]
    ).catch(() => {});

    logger.info('Admin KYC decision', { admin: req.user.id, target: req.params.id, status });
    res.json({ success: true, message: `Tasker KYC ${status}`, data: result.rows[0] });
  } catch (err) { next(err); }
};

// ─── Tasks ────────────────────────────────────────────────────────────────────

const listTasks = async (req, res, next) => {
  try {
    const { status, category, search, date_from, date_to, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];
    let idx = 1;

    if (status)    { conditions.push(`t.status = $${idx++}`);                  params.push(status); }
    if (category)  { conditions.push(`t.category = $${idx++}`);                params.push(category); }
    if (date_from) { conditions.push(`t.created_at >= $${idx++}`);             params.push(date_from); }
    if (date_to)   { conditions.push(`t.created_at <= $${idx++}::date + 1`);   params.push(date_to); }
    if (search)    {
      conditions.push(`(t.title ILIKE $${idx} OR u.name ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);

    const [rows, countRes] = await Promise.all([
      query(
        `SELECT t.id, t.title, t.category, t.budget, t.final_price, t.status,
                t.location_city, t.scheduled_time, t.created_at, t.completed_at,
                t.is_sms_booking,
                u.name AS customer_name, u.phone AS customer_phone,
                tk.name AS tasker_name, tk.phone AS tasker_phone,
                et.amount AS escrow_amount, et.status AS escrow_status, et.commission
         FROM tasks t
         JOIN users u ON u.id = t.customer_id
         LEFT JOIN users tk ON tk.id = t.tasker_id
         LEFT JOIN escrow_transactions et ON et.task_id = t.id
         ${where}
         ORDER BY t.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params
      ),
      query(`SELECT COUNT(*) FROM tasks t JOIN users u ON u.id = t.customer_id ${where}`, params.slice(0, -2)),
    ]);

    res.json({
      success: true,
      data: rows.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countRes.rows[0].count) },
    });
  } catch (err) { next(err); }
};

// ─── Disputes ─────────────────────────────────────────────────────────────────

const listDisputes = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    let where = '';
    if (status) { where = 'WHERE d.status = $1'; params.push(status); }
    params.push(parseInt(limit), offset);
    const countParams = status ? [status] : [];

    const [rows, countRes] = await Promise.all([
      query(
        `SELECT d.*, t.title AS task_title, t.budget, t.status AS task_status,
                ur.name AS raised_by_name, ur.phone AS raised_by_phone,
                ua.name AS against_name, ua.phone AS against_phone,
                adm.name AS resolved_by_name
         FROM disputes d
         JOIN tasks t ON t.id = d.task_id
         JOIN users ur ON ur.id = d.raised_by
         JOIN users ua ON ua.id = d.against
         LEFT JOIN users adm ON adm.id = d.resolved_by
         ${where}
         ORDER BY d.created_at DESC
         LIMIT $${status ? 2 : 1} OFFSET $${status ? 3 : 2}`,
        params
      ),
      query(`SELECT COUNT(*) FROM disputes d ${where}`, countParams),
    ]);

    res.json({
      success: true,
      data: rows.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countRes.rows[0].count) },
    });
  } catch (err) { next(err); }
};

const getDispute = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT d.*,
              t.title AS task_title, t.description AS task_description,
              t.budget, t.final_price, t.status AS task_status, t.category,
              t.location_city, t.created_at AS task_created_at,
              ur.name AS raised_by_name, ur.phone AS raised_by_phone, ur.email AS raised_by_email,
              ua.name AS against_name, ua.phone AS against_phone, ua.email AS against_email,
              adm.name AS resolved_by_name,
              et.amount AS escrow_amount, et.status AS escrow_status,
              et.commission, et.tasker_payout
       FROM disputes d
       JOIN tasks t ON t.id = d.task_id
       JOIN users ur ON ur.id = d.raised_by
       JOIN users ua ON ua.id = d.against
       LEFT JOIN users adm ON adm.id = d.resolved_by
       LEFT JOIN escrow_transactions et ON et.task_id = t.id
       WHERE d.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) throw new AppError('Dispute not found', 404);

    // Fetch task images and chat count as context
    const [images, chatCount] = await Promise.all([
      query('SELECT url, type FROM task_images WHERE task_id=$1', [result.rows[0].task_id]),
      query('SELECT COUNT(*) FROM chat_messages WHERE task_id=$1', [result.rows[0].task_id]),
    ]);

    res.json({
      success: true,
      data: { ...result.rows[0], task_images: images.rows, chat_message_count: parseInt(chatCount.rows[0].count) },
    });
  } catch (err) { next(err); }
};

const resolveDispute = async (req, res, next) => {
  try {
    const { resolution, status = 'resolved', admin_notes, winner } = req.body;
    if (!resolution) throw new AppError('resolution is required', 400);

    const result = await query(
      `UPDATE disputes
       SET status=$1, resolution=$2, resolved_by=$3, resolved_at=NOW(), admin_notes=$4, updated_at=NOW()
       WHERE id=$5
       RETURNING *`,
      [status, resolution, req.user.id, admin_notes || null, req.params.id]
    );
    if (!result.rows.length) throw new AppError('Dispute not found', 404);

    logger.info('Admin resolved dispute', { admin: req.user.id, dispute: req.params.id, status, winner });
    res.json({ success: true, message: 'Dispute resolved', data: result.rows[0] });
  } catch (err) { next(err); }
};

// ─── Transactions ──────────────────────────────────────────────────────────────

const listTransactions = async (req, res, next) => {
  try {
    const { type, user_id, date_from, date_to, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];
    let idx = 1;

    if (type)      { conditions.push(`t.type = $${idx++}`);                    params.push(type); }
    if (user_id)   { conditions.push(`t.user_id = $${idx++}`);                 params.push(user_id); }
    if (date_from) { conditions.push(`t.created_at >= $${idx++}`);             params.push(date_from); }
    if (date_to)   { conditions.push(`t.created_at <= $${idx++}::date + 1`);   params.push(date_to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);

    const [rows, countRes] = await Promise.all([
      query(
        `SELECT t.*, u.name AS user_name, u.role AS user_role, tk.title AS task_title
         FROM transactions t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN tasks tk ON tk.id = t.task_id
         ${where}
         ORDER BY t.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params
      ),
      query(`SELECT COUNT(*), COALESCE(SUM(amount),0) AS total_volume FROM transactions t ${where}`, params.slice(0, -2)),
    ]);

    res.json({
      success: true,
      data: rows.rows,
      summary: { total_volume: countRes.rows[0].total_volume },
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countRes.rows[0].count) },
    });
  } catch (err) { next(err); }
};

// ─── SOS / Safety ──────────────────────────────────────────────────────────────

const listSOSAlerts = async (req, res, next) => {
  try {
    const { is_resolved, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    let where = "WHERE sl.event_type = 'sos'";
    if (is_resolved !== undefined) {
      where += ` AND sl.is_resolved = $1`;
      params.push(is_resolved === 'true');
    }
    params.push(parseInt(limit), offset);
    const p = is_resolved !== undefined;

    const result = await query(
      `SELECT sl.*, u.name AS user_name, u.phone AS user_phone, u.role AS user_role,
              t.title AS task_title,
              ST_X(sl.location::geometry) AS longitude,
              ST_Y(sl.location::geometry) AS latitude
       FROM safety_logs sl
       JOIN users u ON u.id = sl.user_id
       LEFT JOIN tasks t ON t.id = sl.task_id
       ${where}
       ORDER BY sl.created_at DESC
       LIMIT $${p ? 2 : 1} OFFSET $${p ? 3 : 2}`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

const resolveSOSAlert = async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE safety_logs SET is_resolved=TRUE, resolved_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) throw new AppError('Alert not found', 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

// ─── Analytics ────────────────────────────────────────────────────────────────

const getAnalytics = async (req, res, next) => {
  try {
    const { period = '30' } = req.query; // days
    const days = Math.min(parseInt(period), 365);

    const [
      userStats, taskStats, revenueStats,
      userGrowth, revenueTimeSeries, taskTimeSeries,
      topCategories, topTaskers, paymentStats,
    ] = await Promise.all([

      // KPI: user counts
      query(`SELECT
               COUNT(*)                                         AS total_users,
               COUNT(*) FILTER (WHERE role='customer')          AS customers,
               COUNT(*) FILTER (WHERE role='tasker')            AS taskers,
               COUNT(*) FILTER (WHERE created_at > NOW()-($1||' days')::interval) AS new_this_period,
               COUNT(*) FILTER (WHERE is_active=FALSE)          AS inactive
             FROM users`, [days]),

      // KPI: task counts
      query(`SELECT
               COUNT(*)                                             AS total,
               COUNT(*) FILTER (WHERE status='completed')           AS completed,
               COUNT(*) FILTER (WHERE status='pending')             AS pending,
               COUNT(*) FILTER (WHERE status='in_progress')         AS in_progress,
               COUNT(*) FILTER (WHERE status='disputed')            AS disputed,
               COUNT(*) FILTER (WHERE status='cancelled')           AS cancelled,
               ROUND(AVG(budget)::numeric, 2)                       AS avg_budget,
               ROUND(AVG(EXTRACT(EPOCH FROM (completed_at-created_at))/3600)::numeric,1) AS avg_hours_to_complete
             FROM tasks WHERE created_at > NOW()-($1||' days')::interval`, [days]),

      // KPI: revenue
      query(`SELECT
               COALESCE(SUM(amount) FILTER (WHERE type='commission'),  0) AS total_commission,
               COALESCE(SUM(amount) FILTER (WHERE type='payout'),      0) AS total_payouts,
               COALESCE(SUM(amount) FILTER (WHERE type='deposit'),     0) AS total_deposits,
               COALESCE(SUM(amount) FILTER (WHERE type='withdrawal'),  0) AS total_withdrawals,
               COALESCE(SUM(amount) FILTER (WHERE type='refund'),      0) AS total_refunds,
               COUNT(*)  FILTER (WHERE type='deposit')                    AS deposit_count
             FROM transactions
             WHERE created_at > NOW()-($1||' days')::interval`, [days]),

      // Chart: daily new users
      query(`SELECT
               DATE(created_at) AS date,
               COUNT(*) AS count,
               COUNT(*) FILTER (WHERE role='customer') AS customers,
               COUNT(*) FILTER (WHERE role='tasker')   AS taskers
             FROM users
             WHERE created_at > NOW()-($1||' days')::interval
             GROUP BY DATE(created_at)
             ORDER BY date ASC`, [days]),

      // Chart: daily revenue
      query(`SELECT
               DATE(created_at)        AS date,
               COALESCE(SUM(amount) FILTER (WHERE type='commission'), 0) AS commission,
               COALESCE(SUM(amount) FILTER (WHERE type='deposit'),    0) AS deposits,
               COALESCE(SUM(amount) FILTER (WHERE type='payout'),     0) AS payouts
             FROM transactions
             WHERE created_at > NOW()-($1||' days')::interval
             GROUP BY DATE(created_at)
             ORDER BY date ASC`, [days]),

      // Chart: daily tasks
      query(`SELECT
               DATE(created_at) AS date,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status='completed') AS completed
             FROM tasks
             WHERE created_at > NOW()-($1||' days')::interval
             GROUP BY DATE(created_at)
             ORDER BY date ASC`, [days]),

      // Top categories
      query(`SELECT category,
               COUNT(*)                   AS count,
               ROUND(AVG(budget)::numeric,2) AS avg_price,
               COUNT(*) FILTER (WHERE status='completed') AS completed
             FROM tasks
             GROUP BY category ORDER BY count DESC LIMIT 8`),

      // Top taskers
      query(`SELECT u.id, u.name, u.rating, u.rating_count, u.avatar_url,
               tp.total_tasks_completed, tp.total_earnings, tp.verification_status
             FROM users u
             JOIN tasker_profiles tp ON tp.user_id=u.id
             WHERE u.role='tasker'
             ORDER BY tp.total_tasks_completed DESC
             LIMIT 10`),

      // Payment provider stats
      query(`SELECT provider, direction,
               COUNT(*) AS count,
               COALESCE(SUM(amount),0) AS volume,
               COUNT(*) FILTER (WHERE status='completed') AS completed,
               COUNT(*) FILTER (WHERE status='failed')    AS failed
             FROM payment_requests
             WHERE created_at > NOW()-($1||' days')::interval
             GROUP BY provider, direction`, [days]),
    ]);

    res.json({
      success: true,
      data: {
        period_days: days,
        kpis: {
          users:   userStats.rows[0],
          tasks:   taskStats.rows[0],
          revenue: revenueStats.rows[0],
        },
        charts: {
          user_growth:      userGrowth.rows,
          revenue:          revenueTimeSeries.rows,
          tasks:            taskTimeSeries.rows,
        },
        top_categories:   topCategories.rows,
        top_taskers:      topTaskers.rows,
        payment_providers: paymentStats.rows,
      },
    });
  } catch (err) { next(err); }
};

module.exports = {
  listUsers, getUser, toggleUser,
  listKYCPending, getTaskerKYC, updateKYCStatus,
  listTasks,
  listDisputes, getDispute, resolveDispute,
  listTransactions,
  listSOSAlerts, resolveSOSAlert,
  getAnalytics,
};
