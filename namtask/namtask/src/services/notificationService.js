const { query } = require('../config/database');
const push = require('./pushNotificationService');
const logger = require('../config/logger');

/**
 * Create an in-app notification and (optionally) fire a push
 */
const create = async (userId, type, title, message, data = {}) => {
  try {
    await query(
      `INSERT INTO notifications (user_id, type, title, message, data)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, type, title, message, JSON.stringify(data)]
    );
    // Best-effort push — never throw
    push.send(userId, { title, body: message, data }).catch(() => {});
  } catch (err) {
    logger.error('notification create', err.message);
  }
};

/** Same but accepts a pg client (for use inside transactions) */
const createWithClient = async (client, userId, type, title, message, data = {}) => {
  await client.query(
    `INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1,$2,$3,$4,$5)`,
    [userId, type, title, message, JSON.stringify(data)]
  );
  push.send(userId, { title, body: message, data }).catch(() => {});
};

const getUserNotifications = async (userId, { page = 1, limit = 30 } = {}) => {
  const offset = (page - 1) * limit;
  const res = await query(
    `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  const unread = await query(
    'SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=FALSE',
    [userId]
  );
  return { notifications: res.rows, unread_count: parseInt(unread.rows[0].count) };
};

const markRead = async (userId, notificationId) => {
  const sql = notificationId
    ? 'UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2'
    : 'UPDATE notifications SET is_read=TRUE WHERE user_id=$1';
  const params = notificationId ? [notificationId, userId] : [userId];
  await query(sql, params);
};

module.exports = { create, createWithClient, getUserNotifications, markRead };
