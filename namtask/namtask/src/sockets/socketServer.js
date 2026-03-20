const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const pushService = require('../services/pushNotificationService');
const logger = require('../config/logger');

/**
 * Nam Task Socket.io Server
 *
 * Rooms:
 *  - user:{userId}          — personal room (notifications, status)
 *  - task:{taskId}          — task room (chat, status, tracking)
 *  - admins                 — admin room (SOS alerts, disputes)
 *
 * Events emitted by server:
 *  - task:status_updated    — { taskId, status }
 *  - task:offer_received    — { taskId, offer }
 *  - chat:message           — { taskId, message }
 *  - tracking:update        — { taskId, lat, lng, userId }
 *  - notification:new       — { notification }
 *  - sos:alert              — { userId, taskId, location }
 *
 * Events received from client:
 *  - join:task              — { taskId }
 *  - leave:task             — { taskId }
 *  - chat:send              — { taskId, message, imageUrl? }
 *  - tracking:send          — { taskId, latitude, longitude, accuracy? }
 *  - sos:trigger            — { taskId?, latitude?, longitude?, notes? }
 */

const setupSocket = (io) => {
  // ─── Auth Middleware ──────────────────────────────────────────────────────────

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('AUTH_REQUIRED'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const result  = await query(
        'SELECT id, name, role, avatar_url FROM users WHERE id=$1 AND is_active=TRUE',
        [decoded.userId]
      );

      if (!result.rows.length) return next(new Error('USER_NOT_FOUND'));

      socket.user = result.rows[0];
      next();
    } catch (err) {
      next(new Error('AUTH_INVALID'));
    }
  });

  // ─── Connection ───────────────────────────────────────────────────────────────

  io.on('connection', (socket) => {
    const { user } = socket;
    logger.debug(`Socket connected: ${user.name} (${user.role}) [${socket.id}]`);

    // Auto-join personal room and admin room if applicable
    socket.join(`user:${user.id}`);
    if (user.role === 'admin') socket.join('admins');

    // Update last_seen
    query('UPDATE users SET last_seen_at=NOW() WHERE id=$1', [user.id]).catch(() => {});

    // ─── Task Room ──────────────────────────────────────────────────────────────

    socket.on('join:task', async ({ taskId }) => {
      try {
        // Verify user is part of this task
        const res = await query(
          'SELECT customer_id, tasker_id FROM tasks WHERE id=$1',
          [taskId]
        );
        if (!res.rows.length) return socket.emit('error', { message: 'Task not found' });

        const task = res.rows[0];
        const isParticipant =
          task.customer_id === user.id ||
          task.tasker_id   === user.id ||
          user.role         === 'admin';

        if (!isParticipant) return socket.emit('error', { message: 'Not authorised for this task' });

        socket.join(`task:${taskId}`);
        socket.emit('joined:task', { taskId });

        // Send unread messages count
        const unread = await query(
          'SELECT COUNT(*) FROM chat_messages WHERE task_id=$1 AND sender_id!=$2 AND is_read=FALSE',
          [taskId, user.id]
        );
        socket.emit('chat:unread', { taskId, count: parseInt(unread.rows[0].count) });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('leave:task', ({ taskId }) => {
      socket.leave(`task:${taskId}`);
    });

    // ─── Chat ───────────────────────────────────────────────────────────────────

    socket.on('chat:send', async ({ taskId, message, imageUrl }) => {
      try {
        if (!message && !imageUrl) return;
        if (message && message.length > 2000) {
          return socket.emit('error', { message: 'Message too long (max 2000 chars)' });
        }

        // Verify participation
        const taskRes = await query(
          'SELECT customer_id, tasker_id, title FROM tasks WHERE id=$1',
          [taskId]
        );
        if (!taskRes.rows.length) return socket.emit('error', { message: 'Task not found' });

        const task   = taskRes.rows[0];
        const others = [task.customer_id, task.tasker_id].filter(
          (id) => id && id !== user.id
        );

        // Persist message
        const result = await query(
          `INSERT INTO chat_messages (task_id, sender_id, message, image_url)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [taskId, user.id, message || null, imageUrl || null]
        );

        const savedMessage = {
          ...result.rows[0],
          sender_name:   user.name,
          sender_avatar: user.avatar_url,
        };

        // Broadcast to task room (everyone in the room sees it)
        io.to(`task:${taskId}`).emit('chat:message', savedMessage);

        // Push notification to offline participants
        for (const recipientId of others) {
          // Check if they're online in this task room
          const roomSockets = await io.in(`task:${taskId}`).fetchSockets();
          const recipientOnline = roomSockets.some((s) => s.user?.id === recipientId);

          if (!recipientOnline) {
            await pushService.sendNewMessage(recipientId, user.name, {
              taskId,
              messageId: result.rows[0].id,
              channel: 'chat',
            });
          }
        }
      } catch (err) {
        logger.error('chat:send error', err.message);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Mark messages read
    socket.on('chat:read', async ({ taskId }) => {
      try {
        await query(
          'UPDATE chat_messages SET is_read=TRUE WHERE task_id=$1 AND sender_id!=$2',
          [taskId, user.id]
        );
        io.to(`task:${taskId}`).emit('chat:read_ack', { taskId, readBy: user.id });
      } catch (err) { /* non-critical */ }
    });

    // ─── GPS Tracking ───────────────────────────────────────────────────────────

    socket.on('tracking:send', async ({ taskId, latitude, longitude, accuracy }) => {
      try {
        if (!taskId || latitude == null || longitude == null) return;

        // Persist GPS point (keep last 100 points per task)
        await query(
          `INSERT INTO gps_tracking (task_id, user_id, location, accuracy)
           VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326),$5)`,
          [taskId, user.id, longitude, latitude, accuracy || null]
        );

        // Broadcast to task room (customer sees tasker location)
        io.to(`task:${taskId}`).emit('tracking:update', {
          taskId,
          userId: user.id,
          userName: user.name,
          latitude,
          longitude,
          accuracy,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        logger.error('tracking:send error', err.message);
      }
    });

    // ─── SOS ────────────────────────────────────────────────────────────────────

    socket.on('sos:trigger', async ({ taskId, latitude, longitude, notes }) => {
      try {
        const logResult = await query(
          `INSERT INTO safety_logs (user_id, task_id, event_type, location, notes)
           VALUES ($1,$2,'sos',
             ${latitude != null ? 'ST_SetSRID(ST_MakePoint($4,$3),4326)' : 'NULL'},
             $5)
           RETURNING id`,
          [user.id, taskId || null, latitude, longitude, notes || 'SOS via app']
        );

        const alert = {
          logId:     logResult.rows[0].id,
          userId:    user.id,
          userName:  user.name,
          userPhone: null,
          taskId,
          latitude,
          longitude,
          notes,
          timestamp: new Date().toISOString(),
        };

        // Broadcast to all admins
        io.to('admins').emit('sos:alert', alert);

        // Push to admins
        const adminIds = await query('SELECT id FROM users WHERE role=$1', ['admin']);
        if (adminIds.rows.length) {
          await pushService.sendSOSAlert(
            adminIds.rows.map((r) => r.id),
            user.name,
            { taskId, logId: logResult.rows[0].id, channel: 'sos' }
          );
        }

        socket.emit('sos:confirmed', { logId: logResult.rows[0].id });
      } catch (err) {
        logger.error('sos:trigger error', err.message);
        socket.emit('error', { message: 'SOS could not be sent. Call emergency services directly.' });
      }
    });

    // ─── Safety: check-in broadcast ─────────────────────────────────────────────

    socket.on('safety:checkin', ({ taskId }) => {
      // Broadcast to task room so customer sees live check-in
      io.to(`task:${taskId}`).emit('safety:checkin_received', {
        userId:    user.id,
        userName:  user.name,
        taskId,
        timestamp: new Date().toISOString(),
      });
    });

    // ─── Safety: session status broadcast ────────────────────────────────────────

    socket.on('safety:session_update', ({ taskId, status, nextDue }) => {
      io.to(`task:${taskId}`).emit('safety:session_update', {
        userId: user.id,
        taskId, status, nextDue,
        timestamp: new Date().toISOString(),
      });
    });

    // ─── Typing Indicator ───────────────────────────────────────────────────────

    socket.on('chat:typing', ({ taskId, isTyping }) => {
      socket.to(`task:${taskId}`).emit('chat:typing', {
        taskId,
        userId:   user.id,
        userName: user.name,
        isTyping,
      });
    });

    // ─── Disconnect ─────────────────────────────────────────────────────────────

    socket.on('disconnect', (reason) => {
      logger.debug(`Socket disconnected: ${user.name} — ${reason}`);
      query('UPDATE users SET last_seen_at=NOW() WHERE id=$1', [user.id]).catch(() => {});
    });

    socket.on('error', (err) => {
      logger.error(`Socket error for ${user.name}:`, err.message);
    });
  });

  // ─── Helpers exported for controllers ────────────────────────────────────────

  /**
   * Emit task status update to all parties in a task room
   */
  io.emitTaskStatusUpdate = (taskId, status, extra = {}) => {
    io.to(`task:${taskId}`).emit('task:status_updated', { taskId, status, ...extra });
  };

  /**
   * Emit new offer notification to task customer's personal room
   */
  io.emitNewOffer = (customerId, taskId, offer) => {
    io.to(`user:${customerId}`).emit('task:offer_received', { taskId, offer });
  };

  /**
   * Send a notification event to a user's personal room
   */
  io.emitNotification = (userId, notification) => {
    io.to(`user:${userId}`).emit('notification:new', notification);
  };

  logger.info('✅ Socket.io server ready');
};

module.exports = setupSocket;
