'use strict';
const { query }               = require('../config/database');
const { AppError }            = require('../middleware/errorHandler');
const {
  PaymentService,
  EscrowService,
  WithdrawalService,
  MockEngine,
  verifyFNBWebhook,
  verifyBWKWebhook,
  IS_MOCK,
}                             = require('../services/mobileMoneyService');
const logger                  = require('../config/logger');
const pushService             = require('../services/pushNotificationService');

// ═════════════════════════════════════════════════════════════════════════════
// DEPOSIT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /payments/deposit/initiate:
 *   post:
 *     summary: Initiate a mobile money deposit
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, provider, phone]
 *             properties:
 *               amount:   { type: number, minimum: 10, maximum: 50000 }
 *               provider: { type: string, enum: [fnb_ewallet, bank_windhoek] }
 *               phone:    { type: string, example: "+264811234567" }
 *               idempotency_key: { type: string }
 */
const initiateDeposit = async (req, res, next) => {
  try {
    const { amount, provider, phone, idempotency_key } = req.body;

    const result = await PaymentService.initiateDeposit({
      userId:         req.user.id,
      amount:         parseFloat(amount),
      provider,
      phone:          phone.replace(/\s+/g, ''),
      idempotencyKey: idempotency_key,
    });

    res.json({
      success: true,
      message: 'Payment initiated. Complete the payment to top up your wallet.',
      data:    result,
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /payments/deposit/poll/{reference}:
 *   get:
 *     summary: Poll deposit status
 *     tags: [Payments]
 */
const pollDeposit = async (req, res, next) => {
  try {
    const data = await PaymentService.pollDeposit(req.params.reference, req.user.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /payments/history:
 *   get:
 *     summary: Deposit history
 *     tags: [Payments]
 */
const getDepositHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset  = (parseInt(page) - 1) * parseInt(limit);
    const params  = [req.user.id];
    let statusSQL = '';
    if (status) { statusSQL = 'AND status=$2'; params.push(status); }

    const result = await query(
      `SELECT * FROM payment_requests
       WHERE user_id=$1 AND direction='deposit' ${statusSQL}
       ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// WITHDRAWAL
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /payments/withdraw:
 *   post:
 *     summary: Request a withdrawal (payout to mobile wallet or bank)
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, provider]
 *             properties:
 *               amount:           { type: number, minimum: 20 }
 *               provider:         { type: string, enum: [fnb_ewallet, bank_windhoek] }
 *               recipient_phone:  { type: string }
 *               account_number:   { type: string, description: "Required for bank_windhoek" }
 *               account_name:     { type: string }
 *               branch_code:      { type: string }
 *               idempotency_key:  { type: string }
 */
const initiateWithdrawal = async (req, res, next) => {
  try {
    const {
      amount, provider,
      recipient_phone, account_number, account_name, branch_code,
      idempotency_key,
    } = req.body;

    if (provider === 'bank_windhoek' && !account_number) {
      throw new AppError('account_number is required for Bank Windhoek withdrawals', 400);
    }
    if (provider === 'fnb_ewallet' && !recipient_phone) {
      throw new AppError('recipient_phone is required for FNB eWallet withdrawals', 400);
    }

    const result = await WithdrawalService.initiate({
      userId:         req.user.id,
      amount:         parseFloat(amount),
      provider,
      recipientPhone: recipient_phone,
      accountNumber:  account_number,
      accountName:    account_name ?? req.user.name,
      branchCode:     branch_code,
      idempotencyKey: idempotency_key,
    });

    res.json({ success: true, message: 'Withdrawal request submitted.', data: result });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /payments/withdrawals:
 *   get:
 *     summary: List withdrawal history
 *     tags: [Payments]
 */
const getWithdrawalHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const data = await WithdrawalService.listForUser(req.user.id, {
      page: parseInt(page), limit: parseInt(limit),
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /payments/withdrawals/{reference}:
 *   get:
 *     summary: Get withdrawal status
 *     tags: [Payments]
 */
const getWithdrawalStatus = async (req, res, next) => {
  try {
    const data = await WithdrawalService.getStatus(req.params.reference, req.user.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// ESCROW
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /payments/escrow/{taskId}:
 *   get:
 *     summary: Get escrow status for a task
 *     tags: [Payments]
 */
const getEscrowStatus = async (req, res, next) => {
  try {
    const data = await EscrowService.getStatus(req.params.taskId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /payments/escrow/{taskId}/release:
 *   post:
 *     summary: Manually release escrow (admin only)
 *     tags: [Payments]
 */
const releaseEscrow = async (req, res, next) => {
  try {
    const { tasker_id } = req.body;
    if (!tasker_id) throw new AppError('tasker_id required', 400);

    const data = await EscrowService.release({
      taskId:    req.params.taskId,
      taskerId:  tasker_id,
      releasedBy: req.user.id,
    });
    res.json({ success: true, message: 'Escrow released', data });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /payments/escrow/{taskId}/refund:
 *   post:
 *     summary: Refund escrow to customer
 *     tags: [Payments]
 */
const refundEscrow = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const data = await EscrowService.refund({ taskId: req.params.taskId, reason });
    res.json({ success: true, message: 'Escrow refunded', data });
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// WEBHOOKS
// ═════════════════════════════════════════════════════════════════════════════

const _handleWebhook = async (req, res, provider, signatureHeader) => {
  const rawBody = req.rawBody ?? JSON.stringify(req.body);
  const sig     = req.headers[signatureHeader] ?? '';

  // Verify signature
  const verifyFn = provider === 'fnb_ewallet' ? verifyFNBWebhook : verifyBWKWebhook;
  if (!verifyFn(rawBody, sig)) {
    logger.warn(`[webhook] ${provider}: invalid signature`, { sig: sig.substring(0, 20) });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const result = await PaymentService.processWebhook({ provider, payload: req.body });
    res.json({ received: true, ...result });
  } catch (err) {
    logger.error(`[webhook] ${provider} error`, err.message);
    // Always 200 so provider doesn't retry indefinitely
    res.json({ received: true, error: err.message });
  }
};

const fnbWebhook = (req, res) => _handleWebhook(req, res, 'fnb_ewallet', 'x-fnb-signature');
const bwkWebhook = (req, res) => _handleWebhook(req, res, 'bank_windhoek', 'x-bwk-signature');

// ═════════════════════════════════════════════════════════════════════════════
// MOCK ENGINE (dev / staging only)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /dev/payments/mock-complete:
 *   post:
 *     summary: Trigger mock payment completion (development only)
 *     tags: [Dev]
 *     security: []
 */
const mockComplete = async (req, res, next) => {
  if (!IS_MOCK) return res.status(403).json({ error: 'Only available in development' });
  try {
    const { reference, simulate = 'completed' } = req.body;
    if (!reference) throw new AppError('reference required', 400);
    const result = await MockEngine.trigger(reference, simulate);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /dev/payments/mock-scenario:
 *   post:
 *     summary: Run a full payment scenario (deposit + auto-complete)
 *     tags: [Dev]
 */
const mockScenario = async (req, res, next) => {
  if (!IS_MOCK) return res.status(403).json({ error: 'Only available in development' });
  try {
    const { user_id, amount = 500, provider = 'fnb_ewallet', scenario = 'deposit_success' } = req.body;

    const userId = user_id ?? req.user?.id;
    if (!userId) throw new AppError('user_id required', 400);

    // Get user phone
    const userRes = await query('SELECT phone FROM users WHERE id=$1', [userId]);
    if (!userRes.rows.length) throw new AppError('User not found', 404);

    const depositResult = await PaymentService.initiateDeposit({
      userId,
      amount,
      provider,
      phone: userRes.rows[0].phone,
    });

    const simulateStatus = scenario === 'deposit_fail' ? 'failed' : 'completed';
    const triggerResult  = await MockEngine.trigger(depositResult.reference, simulateStatus);

    res.json({
      success: true,
      message: `Mock scenario '${scenario}' executed`,
      data:    { deposit: depositResult, trigger: triggerResult },
    });
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// PUSH TOKEN
// ═════════════════════════════════════════════════════════════════════════════

const registerPushToken = async (req, res, next) => {
  try {
    const { token, platform = 'expo', app_version } = req.body;
    if (!token) throw new AppError('token is required', 400);
    await pushService.registerToken(req.user.id, token, platform, app_version);
    res.json({ success: true, message: 'Push token registered' });
  } catch (err) { next(err); }
};

// ═════════════════════════════════════════════════════════════════════════════
// GET /payments/summary — full dashboard data
// ═════════════════════════════════════════════════════════════════════════════

const getSummary = async (req, res, next) => {
  try {
    const [walletRes, recentDeposits, recentWithdrawals, escrowHeld] = await Promise.all([
      query('SELECT balance, escrow_balance, total_earned, total_spent FROM wallets WHERE user_id=$1', [req.user.id]),
      query(`SELECT reference, amount, provider, status, created_at FROM payment_requests
             WHERE user_id=$1 AND direction='deposit' ORDER BY created_at DESC LIMIT 5`, [req.user.id]),
      query(`SELECT reference, amount, provider, status, requested_at FROM withdrawal_requests
             WHERE user_id=$1 ORDER BY requested_at DESC LIMIT 5`, [req.user.id]),
      query(`SELECT COALESCE(SUM(amount),0) AS held FROM escrow_transactions
             WHERE customer_id=$1 AND status='held'`, [req.user.id]),
    ]);

    res.json({
      success: true,
      data: {
        wallet:              walletRes.rows[0] ?? { balance: '0.00', escrow_balance: '0.00' },
        escrow_held:         escrowHeld.rows[0].held,
        recent_deposits:     recentDeposits.rows,
        recent_withdrawals:  recentWithdrawals.rows,
        providers: [
          { id: 'fnb_ewallet',  name: 'FNB Namibia eWallet', available: true, min_deposit: 10,  max_deposit: 50000 },
          { id: 'bank_windhoek', name: 'Bank Windhoek',       available: true, min_deposit: 10,  max_deposit: 50000 },
        ],
        limits: {
          min_deposit:    10,
          max_deposit:    50000,
          min_withdrawal: 20,
          withdrawal_fee: parseFloat(process.env.WITHDRAWAL_FEE ?? '5'),
          daily_limit:    parseFloat(process.env.DAILY_WITHDRAWAL_LIMIT ?? '10000'),
        },
      },
    });
  } catch (err) { next(err); }
};

module.exports = {
  initiateDeposit,
  pollDeposit,
  getDepositHistory,
  initiateWithdrawal,
  getWithdrawalHistory,
  getWithdrawalStatus,
  getEscrowStatus,
  releaseEscrow,
  refundEscrow,
  fnbWebhook,
  bwkWebhook,
  mockComplete,
  mockScenario,
  getSummary,
  registerPushToken,
};
