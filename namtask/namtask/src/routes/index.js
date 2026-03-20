'use strict';
const express = require('express');
const { body, param, query: qv } = require('express-validator');
const { authenticate, authorize }  = require('../middleware/auth');
const { validate }                 = require('../middleware/validate');
const { uploadTaskImages, uploadAvatar, uploadProof } = require('../middleware/upload');

const auth    = require('../controllers/authController');
const tasks   = require('../controllers/taskController');
const wallet  = require('../controllers/walletController');
const payment = require('../controllers/paymentController');
const safety  = require('../controllers/safetyController');
const sms     = require('../controllers/smsController');
const admin   = require('../controllers/adminController');
const notif   = require('../controllers/notificationController');
const profile = require('../controllers/profileController');

const router = express.Router();

// ─── Auth ─────────────────────────────────────────────────────────────────────

router.post('/auth/register',
  [body('name').trim().isLength({ min: 2 }),
   body('phone').trim().matches(/^\+?[0-9]{7,15}$/),
   body('password').isLength({ min: 8 }),
   body('role').optional().isIn(['customer','tasker'])],
  validate, auth.register
);

router.post('/auth/login',
  [body('phone').trim().notEmpty(), body('password').notEmpty()],
  validate, auth.login
);

router.get('/auth/me',          authenticate, auth.getMe);
router.patch('/auth/password',  authenticate,
  [body('current_password').notEmpty(), body('new_password').isLength({ min: 8 })],
  validate, auth.changePassword
);

// ─── Tasks ────────────────────────────────────────────────────────────────────

router.post('/tasks',
  authenticate, authorize('customer'),
  [body('title').trim().isLength({ min: 5, max: 200 }),
   body('category').trim().notEmpty(),
   body('budget').isFloat({ min: 10 }),
   body('latitude').isFloat({ min: -90, max: 90 }),
   body('longitude').isFloat({ min: -180, max: 180 })],
  validate, tasks.createTask
);

router.get('/tasks',            authenticate, tasks.listTasks);
router.get('/tasks/nearby',     authenticate, authorize('tasker','admin'), tasks.getNearbyTasks);
router.get('/tasks/:id',        authenticate, tasks.getTask);

router.patch('/tasks/:id/status',
  authenticate,
  [body('status').isIn(['accepted','in_progress','completed','cancelled','disputed'])],
  validate, tasks.updateTaskStatus
);

router.post('/tasks/:id/images',    authenticate, authorize('customer'), uploadTaskImages, tasks.uploadTaskImages);

router.post('/tasks/:id/offers',
  authenticate, authorize('tasker'),
  [body('bid_price').isFloat({ min: 1 }), body('message').optional().isLength({ max: 500 })],
  validate, tasks.submitOffer
);

router.patch('/tasks/:id/offers/:offerId/accept',
  authenticate, authorize('customer'), tasks.acceptOffer
);

// ─── Wallet ───────────────────────────────────────────────────────────────────

router.get('/wallet',               authenticate, wallet.getWallet);
router.get('/wallet/transactions',  authenticate, wallet.getTransactions);
router.get('/wallet/statement',     authenticate, wallet.getStatement);
router.get('/wallet/escrow',        authenticate, wallet.getEscrowSummary);

// Manual (small) deposit — dev or admin only
router.post('/wallet/deposit',
  authenticate,
  [body('amount').isFloat({ min: 0.01, max: 50000 })],
  validate, wallet.manualDeposit
);

// ─── Payments — Deposits ─────────────────────────────────────────────────────

router.post('/payments/deposit/initiate',
  authenticate,
  [body('amount').isFloat({ min: 10, max: 50000 }),
   body('provider').isIn(['fnb_ewallet','bank_windhoek']),
   body('phone').matches(/^\+?[0-9 ]{7,20}$/)],
  validate, payment.initiateDeposit
);

router.get('/payments/deposit/poll/:reference',  authenticate, payment.pollDeposit);
router.get('/payments/history',                  authenticate, payment.getDepositHistory);
router.get('/payments/summary',                  authenticate, payment.getSummary);

// ─── Payments — Withdrawals ───────────────────────────────────────────────────

router.post('/payments/withdraw',
  authenticate,
  [body('amount').isFloat({ min: 20 }),
   body('provider').isIn(['fnb_ewallet','bank_windhoek'])],
  validate, payment.initiateWithdrawal
);

router.get('/payments/withdrawals',               authenticate, payment.getWithdrawalHistory);
router.get('/payments/withdrawals/:reference',    authenticate, payment.getWithdrawalStatus);

// ─── Payments — Escrow ────────────────────────────────────────────────────────

router.get('/payments/escrow/:taskId',            authenticate, payment.getEscrowStatus);
router.post('/payments/escrow/:taskId/release',   authenticate, authorize('admin'), payment.releaseEscrow);
router.post('/payments/escrow/:taskId/refund',    authenticate, authorize('admin', 'customer'), payment.refundEscrow);

// ─── Webhooks (signature-verified, no JWT) ────────────────────────────────────

router.post('/payments/fnb/webhook',
  express.raw({ type: ['application/json', 'text/plain'] }),
  payment.fnbWebhook
);

router.post('/payments/bwk/webhook',
  express.raw({ type: ['application/json', 'text/plain'] }),
  payment.bwkWebhook
);

// ─── Push notifications ───────────────────────────────────────────────────────

router.post('/push/register',
  authenticate,
  [body('token').notEmpty()],
  validate, payment.registerPushToken
);

// ─── Dev / Mock endpoints (disabled in production by controller guard) ─────────

router.post('/dev/payments/mock-complete',  payment.mockComplete);
router.post('/dev/payments/mock-scenario',  authenticate, payment.mockScenario);

// ─── Safety ───────────────────────────────────────────────────────────────────

router.post('/safety/sos',
  authenticate,
  [body('task_id').optional().isUUID()],
  validate, safety.triggerSOS
);
router.patch('/safety/sos/:id/escalate',    authenticate, safety.escalateSOS);
router.patch('/safety/sos/:id/resolve',     authenticate, safety.resolveSOS);
router.post('/safety/sessions',             authenticate, safety.openSession);
router.delete('/safety/sessions/:task_id',  authenticate, safety.closeSession);
router.get('/safety/sessions/:task_id',     authenticate, safety.getSessionStatus);
router.post('/safety/checkin',
  authenticate,
  [body('task_id').isUUID()],
  validate, safety.checkIn
);
router.post('/safety/proof-of-arrival',     authenticate, uploadProof, safety.proofOfArrival);
router.get('/safety/contacts',              authenticate, safety.getEmergencyContacts);
router.post('/safety/contacts',             authenticate, safety.upsertEmergencyContact);
router.put('/safety/contacts/:id',          authenticate, safety.upsertEmergencyContact);
router.delete('/safety/contacts/:id',       authenticate, safety.deleteEmergencyContact);
router.get('/safety/tracking/:task_id',     authenticate, safety.getGPSTrail);
router.get('/safety/logs',                  authenticate, safety.getSafetyLogs);
router.get('/admin/safety/sessions',        authenticate, authorize('admin'), safety.getActiveSessions);

// ─── SMS booking ──────────────────────────────────────────────────────────────

router.post('/sms/webhook',   sms.smsWebhook);
router.post('/sms/parse',     authenticate, sms.parseOnly);

// ─── Notifications ────────────────────────────────────────────────────────────

router.get('/notifications',           authenticate, notif.list);
router.patch('/notifications/read',    authenticate, notif.markRead);
router.patch('/notifications/:id/read', authenticate, notif.markOneRead);

// ─── Profile ──────────────────────────────────────────────────────────────────

router.patch('/profile',        authenticate, uploadAvatar, profile.update);
router.patch('/profile/tasker', authenticate, authorize('tasker'), profile.updateTaskerProfile);

// ─── Admin ────────────────────────────────────────────────────────────────────

// Users
router.get('/admin/users',                   authenticate, authorize('admin'), admin.listUsers);
router.get('/admin/users/:id',               authenticate, authorize('admin'), admin.getUser);
router.patch('/admin/users/:id/toggle',      authenticate, authorize('admin'), admin.toggleUser);
// KYC
router.get('/admin/kyc',                     authenticate, authorize('admin'), admin.listKYCPending);
router.get('/admin/kyc/:id',                 authenticate, authorize('admin'), admin.getTaskerKYC);
router.patch('/admin/kyc/:id',
  authenticate, authorize('admin'),
  [body('status').isIn(['approved','rejected','in_review'])],
  validate, admin.updateKYCStatus
);
// Tasks
router.get('/admin/tasks',                   authenticate, authorize('admin'), admin.listTasks);
// Disputes
router.get('/admin/disputes',                authenticate, authorize('admin'), admin.listDisputes);
router.get('/admin/disputes/:id',            authenticate, authorize('admin'), admin.getDispute);
router.patch('/admin/disputes/:id/resolve',
  authenticate, authorize('admin'),
  [body('resolution').trim().notEmpty()],
  validate, admin.resolveDispute
);
// Transactions
router.get('/admin/transactions',            authenticate, authorize('admin'), admin.listTransactions);
// SOS
router.get('/admin/sos',                     authenticate, authorize('admin'), admin.listSOSAlerts);
router.patch('/admin/sos/:id/resolve',       authenticate, authorize('admin'), admin.resolveSOSAlert);
// Analytics
router.get('/admin/analytics',               authenticate, authorize('admin'), admin.getAnalytics);

module.exports = router;
