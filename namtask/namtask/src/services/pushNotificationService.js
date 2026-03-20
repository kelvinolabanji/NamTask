/**
 * Push Notification Service — Expo Push API
 *
 * Flow:
 *  1. send()      → POST to Expo /send  → get ticket IDs
 *  2. checkReceipts() → POST to Expo /getReceipts → update DB status
 *  3. DeviceToken management (register / deactivate stale tokens)
 *
 * Expo limits: 100 messages per /send call, max 1000 receipt IDs per /getReceipts
 */

const { query } = require('../config/database');
const logger = require('../config/logger');

const EXPO_PUSH_URL     = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPT_URL  = 'https://exp.host/--/api/v2/push/getReceipts';
const BATCH_SIZE        = 100;
const RECEIPT_BATCH     = 1000;

// ─── Token Helpers ─────────────────────────────────────────────────────────────

const isValidExpoToken = (token) =>
  typeof token === 'string' && token.startsWith('ExponentPushToken[');

/**
 * Register or refresh a device token for a user
 */
const registerToken = async (userId, token, platform = 'expo', appVersion = null) => {
  if (!isValidExpoToken(token)) {
    throw new Error(`Invalid Expo push token: ${token}`);
  }
  await query(
    `INSERT INTO device_tokens (user_id, token, platform, app_version, last_used_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (user_id, token)
     DO UPDATE SET is_active=TRUE, last_used_at=NOW(), app_version=COALESCE($4, device_tokens.app_version)`,
    [userId, token, platform, appVersion]
  );
};

/**
 * Mark token as inactive (call after DeviceNotRegistered error)
 */
const deactivateToken = async (token) => {
  await query('UPDATE device_tokens SET is_active=FALSE WHERE token=$1', [token]);
  logger.info('Deactivated push token', { token: token.substring(0, 30) });
};

/**
 * Fetch all active tokens for a user
 */
const getUserTokens = async (userId) => {
  const res = await query(
    'SELECT token FROM device_tokens WHERE user_id=$1 AND is_active=TRUE',
    [userId]
  );
  return res.rows.map((r) => r.token);
};

// ─── Message Builder ───────────────────────────────────────────────────────────

/**
 * Build Expo message objects
 */
const buildMessages = (tokens, { title, body, data = {}, badge, sound = 'default', priority = 'default' }) =>
  tokens
    .filter(isValidExpoToken)
    .map((to) => ({
      to,
      title,
      body,
      data: { ...data, _sent: Date.now() },
      sound,
      priority,                  // 'default' | 'normal' | 'high'
      badge: badge ?? undefined,
      channelId: data.channel ?? 'default',
    }));

// ─── Expo API Calls ────────────────────────────────────────────────────────────

const callExpoSend = async (messages) => {
  if (process.env.NODE_ENV !== 'production') {
    logger.debug('PUSH (mock)', { count: messages.length, titles: messages.map((m) => m.title) });
    return messages.map((_, i) => ({ status: 'ok', id: `mock-receipt-${Date.now()}-${i}` }));
  }

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
      ...(process.env.EXPO_ACCESS_TOKEN && {
        Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}`,
      }),
    },
    body: JSON.stringify(messages),
  });

  if (!res.ok) throw new Error(`Expo API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data;  // array of ticket objects
};

const callExpoGetReceipts = async (receiptIds) => {
  if (process.env.NODE_ENV !== 'production') return {};

  const res = await fetch(EXPO_RECEIPT_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: receiptIds }),
  });
  if (!res.ok) throw new Error(`Expo receipts ${res.status}`);
  const json = await res.json();
  return json.data;  // { [receiptId]: { status, details? } }
};

// ─── Core send() ──────────────────────────────────────────────────────────────

/**
 * Send push notification(s) to one or more users
 *
 * @param {string|string[]} userIds  — single userId or array
 * @param {object}          payload  — { title, body, data, badge, priority }
 * @returns {number}                 — number of messages dispatched
 */
const send = async (userIds, payload) => {
  const ids = Array.isArray(userIds) ? userIds : [userIds];

  // Gather all tokens
  const tokenRows = await query(
    'SELECT user_id, token FROM device_tokens WHERE user_id = ANY($1) AND is_active=TRUE',
    [ids]
  );

  if (!tokenRows.rows.length) return 0;

  const allMessages = tokenRows.rows
    .flatMap((r) => buildMessages([r.token], { ...payload, _userId: r.user_id }));

  if (!allMessages.length) return 0;

  // Batch into chunks of 100 (Expo limit)
  let totalSent = 0;
  for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
    const batch = allMessages.slice(i, i + BATCH_SIZE);
    try {
      const tickets = await callExpoSend(batch);

      // Persist to push_notification_log
      for (let j = 0; j < batch.length; j++) {
        const ticket  = tickets[j] || {};
        const message = batch[j];
        const userId  = message.data?._userId || null;

        await query(
          `INSERT INTO push_notification_log
             (user_id, token, title, body, data, status, expo_receipt_id, error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            userId,
            message.to,
            payload.title,
            payload.body,
            JSON.stringify(payload.data || {}),
            ticket.status === 'ok' ? 'sent' : 'failed',
            ticket.id || null,
            ticket.details?.error || null,
          ]
        ).catch((e) => logger.error('push log insert', e.message));

        if (ticket.status === 'error') {
          logger.warn('Expo ticket error', { error: ticket.details?.error, token: message.to });
          if (ticket.details?.error === 'DeviceNotRegistered') {
            await deactivateToken(message.to);
          }
        }
      }

      totalSent += batch.filter((_, j) => tickets[j]?.status === 'ok').length;
    } catch (err) {
      logger.error('Expo batch send failed', { error: err.message, batchSize: batch.length });
    }
  }

  return totalSent;
};

// ─── Receipt Checker (run as a cron/job) ──────────────────────────────────────

/**
 * Check pending receipt IDs and update DB
 * Should be called periodically (e.g. every 15 minutes)
 */
const checkReceipts = async () => {
  const pending = await query(
    `SELECT expo_receipt_id, token FROM push_notification_log
     WHERE status='sent' AND expo_receipt_id IS NOT NULL AND expo_receipt_id NOT LIKE 'mock%'
     AND sent_at > NOW() - INTERVAL '24 hours'
     LIMIT $1`,
    [RECEIPT_BATCH]
  );

  if (!pending.rows.length) return;

  const receiptIds = pending.rows.map((r) => r.expo_receipt_id);
  const receipts   = await callExpoGetReceipts(receiptIds);

  for (const [id, receipt] of Object.entries(receipts)) {
    const status = receipt.status === 'ok' ? 'delivered' : 'failed';
    await query(
      `UPDATE push_notification_log SET status=$1, error=$2 WHERE expo_receipt_id=$3`,
      [status, receipt.details?.error || null, id]
    );

    if (receipt.details?.error === 'DeviceNotRegistered') {
      const row = pending.rows.find((r) => r.expo_receipt_id === id);
      if (row) await deactivateToken(row.token);
    }
  }

  logger.info('Receipt check complete', { checked: receiptIds.length });
};

// ─── Convenience Senders ──────────────────────────────────────────────────────

const templates = {
  taskOffer:      (taskTitle, price) => ({ title: '📋 New Offer', body: `Someone offered NAD ${price} for "${taskTitle}"`, priority: 'high' }),
  taskAccepted:   (taskTitle)        => ({ title: '✅ Task Accepted!', body: `Your offer for "${taskTitle}" was accepted. Get ready!`, priority: 'high' }),
  taskCompleted:  (taskTitle)        => ({ title: '🎉 Task Complete', body: `"${taskTitle}" has been marked complete.` }),
  paymentReceived:(amount)           => ({ title: '💰 Payment Received', body: `NAD ${amount} added to your wallet.`, priority: 'high' }),
  depositSuccess: (amount, provider) => ({ title: '💰 Deposit Successful', body: `NAD ${amount} deposited via ${provider}.` }),
  depositFailed:  (amount)           => ({ title: '⚠️ Deposit Failed', body: `Your NAD ${amount} deposit failed. Please try again.` }),
  newMessage:     (senderName)       => ({ title: `💬 ${senderName}`, body: 'Sent you a message', priority: 'high' }),
  sosAlert:       (userName)         => ({ title: '🚨 SOS ALERT', body: `${userName} triggered an emergency!`, priority: 'high' }),
  taskReminder:   (taskTitle, time)  => ({ title: '⏰ Task Reminder', body: `"${taskTitle}" starts at ${time}` }),
};

const sendTaskOffer      = (userId, taskTitle, price, data = {}) => send(userId, { ...templates.taskOffer(taskTitle, price), data: { screen: 'TaskDetail', ...data } });
const sendTaskAccepted   = (userId, taskTitle, data = {}) => send(userId, { ...templates.taskAccepted(taskTitle), data: { screen: 'TaskDetail', ...data } });
const sendPaymentReceived = (userId, amount, data = {}) => send(userId, { ...templates.paymentReceived(amount), data: { screen: 'Wallet', ...data } });
const sendDepositResult  = (userId, amount, provider, success) => send(userId, success ? { ...templates.depositSuccess(amount, provider), data: { screen: 'Wallet' } } : { ...templates.depositFailed(amount), data: { screen: 'Wallet' } });
const sendNewMessage     = (userId, senderName, data = {}) => send(userId, { ...templates.newMessage(senderName), data: { screen: 'Chat', ...data } });
const sendSOSAlert       = (adminIds, userName, data = {}) => send(adminIds, { ...templates.sosAlert(userName), data: { screen: 'AdminSOS', ...data } });

module.exports = {
  registerToken,
  deactivateToken,
  getUserTokens,
  send,
  checkReceipts,
  sendTaskOffer,
  sendTaskAccepted,
  sendPaymentReceived,
  sendDepositResult,
  sendNewMessage,
  sendSOSAlert,
};
