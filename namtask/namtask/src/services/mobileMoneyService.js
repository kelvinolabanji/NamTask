'use strict';
/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          Nam Task — Mobile Money Service  v2                     ║
 * ║                                                                  ║
 * ║  Providers : FNB Namibia eWallet · Bank Windhoek                ║
 * ║  Features  : Deposits · Withdrawals · Escrow · Refunds          ║
 * ║  Modes     : Mock (dev/staging) → Real API (production)         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Architecture
 * ─────────────
 *  ProviderAdapter  — abstract contract every provider must satisfy
 *  FNBAdapter       — FNB Namibia eWallet implementation
 *  BWKAdapter       — Bank Windhoek implementation
 *  MockEngine       — deterministic simulator with a state machine
 *  PaymentService   — orchestrates DB + adapters + notifications
 *  EscrowService    — holds, releases, splits, and refunds escrow
 *  WithdrawalService— payout flow with daily limits
 */

const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query, getClient } = require('../config/database');
const { AppError }         = require('../middleware/errorHandler');
const notificationService  = require('./notificationService');
const logger               = require('../config/logger');

// ─── Config ───────────────────────────────────────────────────────────────────

const COMMISSION_RATE    = parseFloat(process.env.COMMISSION_RATE    ?? '0.10');
const WITHDRAWAL_FEE     = parseFloat(process.env.WITHDRAWAL_FEE     ?? '5.00');   // flat NAD per withdrawal
const DAILY_LIMIT        = parseFloat(process.env.DAILY_WITHDRAWAL_LIMIT ?? '10000.00');
const MAX_SINGLE_DEPOSIT = 50_000;
const MIN_SINGLE_DEPOSIT = 10;
const MIN_WITHDRAWAL     = 20;
const IS_MOCK            = process.env.NODE_ENV !== 'production';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const withRetry = async (fn, { retries = 3, baseDelay = 500 } = {}) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (attempt === retries) throw err;
      await sleep(baseDelay * 2 ** (attempt - 1));
      logger.warn(`[payment] retry ${attempt}/${retries}: ${err.message}`);
    }
  }
};

const hmac256 = (secret, data) =>
  crypto.createHmac('sha256', secret).update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');

const timingSafe = (a, b) => {
  const ba = Buffer.from(String(a ?? '')), bb = Buffer.from(String(b ?? ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

const makeReference = (prefix = 'NTSK') =>
  `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

const namedToFixed = (n, dp = 2) => parseFloat(parseFloat(n).toFixed(dp));


// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1 — PROVIDER ADAPTERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Every adapter must implement:
 *   initiateDeposit({ reference, amount, phone })  → ProviderResponse
 *   initiateWithdrawal({ reference, amount, phone, accountNumber, accountName }) → ProviderResponse
 *   verifyTransaction(providerRef)                  → { status: string }
 *   refund({ providerRef, amount, reason })          → { status: string }
 *   verifyWebhook(rawBody, signatureHeader)          → boolean
 *   normaliseStatus(rawStatus)                       → canonical status
 */

// ─── FNB Namibia eWallet ──────────────────────────────────────────────────────

const FNBAdapter = {
  name:          'fnb_ewallet',
  displayName:   'FNB eWallet',
  baseUrl:       process.env.FNB_API_URL       ?? 'https://api.fnbnamibia.com.na/ewallet/v2',
  clientId:      process.env.FNB_CLIENT_ID     ?? '',
  clientSecret:  process.env.FNB_CLIENT_SECRET ?? '',
  webhookSecret: process.env.FNB_WEBHOOK_SECRET ?? 'fnb_dev_webhook_secret',

  _tokenCache: null,

  /** OAuth2 client-credentials token (cached 55 min) */
  async _getToken() {
    if (this._tokenCache && this._tokenCache.expiresAt > Date.now()) {
      return this._tokenCache.token;
    }
    if (IS_MOCK) {
      this._tokenCache = { token: 'mock_fnb_token', expiresAt: Date.now() + 55 * 60_000 };
      return this._tokenCache.token;
    }
    const res = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'payments.write payments.read',
      }),
    });
    if (!res.ok) throw new AppError('FNB OAuth failed', 502);
    const data = await res.json();
    this._tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return this._tokenCache.token;
  },

  async initiateDeposit({ reference, amount, phone }) {
    return withRetry(async () => {
      const token = await this._getToken();
      if (IS_MOCK) {
        return {
          provider_reference: `FNB-DEP-${Date.now()}`,
          status: 'pending',
          instructions: 'You will receive an SMS from FNB to approve this payment.',
          ussd_code: `*130*2*${reference}#`,
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        };
      }
      const res = await fetch(`${this.baseUrl}/payments/request`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': reference,
          'X-Request-ID': uuidv4(),
        },
        body: JSON.stringify({
          merchantReference: reference,
          amount: { value: Math.round(amount * 100), currency: 'NAD' },
          customerMsisdn: phone.replace(/\s+/g, ''),
          description: `NamTask deposit ${reference}`,
          callbackUrl: `${process.env.API_BASE_URL}/api/v1/payments/fnb/webhook`,
          expiryMinutes: 15,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new AppError(`FNB deposit failed: ${body.message ?? res.statusText}`, 502);
      }
      return res.json();
    });
  },

  async initiateWithdrawal({ reference, amount, phone, accountName }) {
    return withRetry(async () => {
      const token = await this._getToken();
      if (IS_MOCK) {
        return {
          provider_reference: `FNB-WDR-${Date.now()}`,
          status: 'processing',
          message: `NAD ${amount} will be sent to ${phone} within 24 hours.`,
        };
      }
      const res = await fetch(`${this.baseUrl}/payments/payout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': reference,
        },
        body: JSON.stringify({
          merchantReference: reference,
          amount: { value: Math.round(amount * 100), currency: 'NAD' },
          recipientMsisdn: phone.replace(/\s+/g, ''),
          recipientName: accountName,
          description: `NamTask payout ${reference}`,
          callbackUrl: `${process.env.API_BASE_URL}/api/v1/payments/fnb/webhook`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new AppError(`FNB payout failed: ${body.message ?? res.statusText}`, 502);
      }
      return res.json();
    });
  },

  async verifyTransaction(providerRef) {
    if (IS_MOCK) return { status: 'COMPLETED', providerReference: providerRef };
    const token = await this._getToken();
    const res   = await fetch(`${this.baseUrl}/payments/${providerRef}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new AppError('FNB verify failed', 502);
    return res.json();
  },

  async refund({ providerRef, amount, reason }) {
    if (IS_MOCK) return { status: 'REFUNDED', providerReference: providerRef, mock: true };
    const token = await this._getToken();
    const res   = await fetch(`${this.baseUrl}/payments/${providerRef}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Math.round(amount * 100), reason }),
    });
    if (!res.ok) throw new AppError('FNB refund failed', 502);
    return res.json();
  },

  verifyWebhook(rawBody, sig) {
    return timingSafe(hmac256(this.webhookSecret, rawBody), sig);
  },

  normaliseStatus(raw) {
    const map = {
      PENDING: 'pending', INITIATED: 'pending', PROCESSING: 'pending',
      COMPLETED: 'completed', SUCCESS: 'completed', AUTHORISED: 'completed',
      FAILED: 'failed', DECLINED: 'failed', REJECTED: 'failed', ERROR: 'failed',
      REFUNDED: 'refunded', REVERSED: 'refunded',
      CANCELLED: 'cancelled', EXPIRED: 'cancelled',
    };
    return map[(raw ?? '').toUpperCase()] ?? 'pending';
  },
};

// ─── Bank Windhoek ────────────────────────────────────────────────────────────

const BWKAdapter = {
  name:          'bank_windhoek',
  displayName:   'Bank Windhoek',
  baseUrl:       process.env.BWK_API_URL       ?? 'https://api.bankwindhoek.com.na/payments/v2',
  apiKey:        process.env.BWK_API_KEY        ?? '',
  apiSecret:     process.env.BWK_API_SECRET     ?? 'bwk_dev_secret',
  merchantId:    process.env.BWK_MERCHANT_ID    ?? 'NAMTASK001',
  webhookSecret: process.env.BWK_WEBHOOK_SECRET ?? 'bwk_dev_webhook_secret',

  _sign(payload) {
    const sorted = JSON.stringify(payload, Object.keys(payload).sort());
    return hmac256(this.apiSecret, sorted);
  },

  async initiateDeposit({ reference, amount, phone, method = 'instant_eft' }) {
    return withRetry(async () => {
      if (IS_MOCK) {
        return {
          provider_reference: `BWK-DEP-${Date.now()}`,
          status: 'pending',
          checkout_url: `https://pay.bankwindhoek.com.na/checkout/mock_${reference}`,
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          instructions: 'Complete payment via the Bank Windhoek checkout page.',
        };
      }
      const payload = {
        merchantId: this.merchantId,
        reference,
        amount: amount.toFixed(2),
        currency: 'NAD',
        customerPhone: phone.replace(/\s+/g, ''),
        paymentMethod: method,
        description: `NamTask deposit ${reference}`,
        successUrl: `${process.env.APP_BASE_URL}/payment/success?ref=${reference}`,
        cancelUrl:  `${process.env.APP_BASE_URL}/payment/cancel?ref=${reference}`,
        webhookUrl: `${process.env.API_BASE_URL}/api/v1/payments/bwk/webhook`,
        timestamp:  new Date().toISOString(),
      };
      const res = await fetch(`${this.baseUrl}/initiate`, {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'X-Signature': this._sign(payload),
          'Content-Type': 'application/json',
          'X-Idempotency-Key': reference,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new AppError(`BWK deposit failed: ${body.message ?? res.statusText}`, 502);
      }
      return res.json();
    });
  },

  async initiateWithdrawal({ reference, amount, accountNumber, accountName, branchCode }) {
    return withRetry(async () => {
      if (IS_MOCK) {
        return {
          provider_reference: `BWK-WDR-${Date.now()}`,
          status: 'processing',
          estimated_settlement: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        };
      }
      const payload = {
        merchantId: this.merchantId,
        reference,
        amount: amount.toFixed(2),
        currency: 'NAD',
        recipientAccount: accountNumber,
        recipientName: accountName,
        branchCode,
        description: `NamTask payout ${reference}`,
        webhookUrl: `${process.env.API_BASE_URL}/api/v1/payments/bwk/webhook`,
        timestamp: new Date().toISOString(),
      };
      const res = await fetch(`${this.baseUrl}/payout`, {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'X-Signature': this._sign(payload),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new AppError(`BWK payout failed: ${body.message ?? res.statusText}`, 502);
      }
      return res.json();
    });
  },

  async verifyTransaction(providerRef) {
    if (IS_MOCK) return { status: 'COMPLETED', reference: providerRef };
    const res = await fetch(`${this.baseUrl}/status/${providerRef}`, {
      headers: { 'X-API-Key': this.apiKey },
    });
    if (!res.ok) throw new AppError('BWK verify failed', 502);
    return res.json();
  },

  async refund({ providerRef, amount, reason }) {
    if (IS_MOCK) return { status: 'REFUNDED', reference: providerRef, mock: true };
    const payload = { reference: providerRef, amount: amount.toFixed(2), reason, timestamp: new Date().toISOString() };
    const res = await fetch(`${this.baseUrl}/refund`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'X-Signature': this._sign(payload),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new AppError('BWK refund failed', 502);
    return res.json();
  },

  verifyWebhook(rawBody, sig) {
    return timingSafe(hmac256(this.webhookSecret, rawBody), sig);
  },

  normaliseStatus(raw) {
    const map = {
      PENDING: 'pending', INITIATED: 'pending',
      COMPLETED: 'completed', AUTHORISED: 'completed', SETTLED: 'completed',
      FAILED: 'failed', ERROR: 'failed', DECLINED: 'failed',
      REFUNDED: 'refunded',
      CANCELLED: 'cancelled', EXPIRED: 'cancelled',
    };
    return map[(raw ?? '').toUpperCase()] ?? 'pending';
  },
};

const ADAPTERS = { fnb_ewallet: FNBAdapter, bank_windhoek: BWKAdapter };

const getAdapter = (provider) => {
  const a = ADAPTERS[provider];
  if (!a) throw new AppError(`Unknown provider: ${provider}`, 400);
  return a;
};


// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2 — MOCK ENGINE (dev/staging simulation)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The mock engine gives developers a complete payment lifecycle without a real
 * provider. After creating a payment_request, call:
 *
 *   POST /api/v1/dev/payments/mock-complete   { reference, simulate: 'completed'|'failed' }
 *
 * This fires the same webhook handler as a real provider would, exercising the
 * full escrow → wallet credit → notification → push path.
 */

const MockEngine = {
  /**
   * Register a mock control record so the payment can be auto-triggered
   * or manually driven via the dev endpoint.
   */
  async register(reference, { simulateStatus = 'completed', triggerAfterSecs = 0 } = {}) {
    if (!IS_MOCK) return;
    try {
      await query(
        `INSERT INTO mock_payment_controls (reference, simulate_status, trigger_after_secs)
         VALUES ($1,$2,$3) ON CONFLICT (reference) DO NOTHING`,
        [reference, simulateStatus, triggerAfterSecs]
      );
      if (triggerAfterSecs > 0) {
        setTimeout(() => this._trigger(reference).catch(() => {}), triggerAfterSecs * 1000);
      }
    } catch (err) {
      logger.warn('[mock] register failed', err.message);
    }
  },

  /** Manually trigger mock completion — used by dev endpoint */
  async trigger(reference, simulateStatus = 'completed') {
    if (!IS_MOCK) throw new AppError('Mock engine only available in development', 403);

    const pr = await query('SELECT * FROM payment_requests WHERE reference=$1', [reference]);
    if (!pr.rows.length) throw new AppError('Payment request not found', 404);
    if (pr.rows[0].status !== 'pending') {
      return { already_processed: true, status: pr.rows[0].status };
    }

    await query(
      'UPDATE mock_payment_controls SET triggered=TRUE, triggered_at=NOW() WHERE reference=$1',
      [reference]
    );

    return this._trigger(reference, simulateStatus);
  },

  async _trigger(reference, overrideStatus) {
    const pr = await query('SELECT * FROM payment_requests WHERE reference=$1', [reference]);
    if (!pr.rows.length || pr.rows[0].status !== 'pending') return;

    const ctl = await query('SELECT * FROM mock_payment_controls WHERE reference=$1', [reference]);
    const simulateStatus = overrideStatus ?? ctl.rows[0]?.simulate_status ?? 'completed';

    const provider  = pr.rows[0].provider;
    const direction = pr.rows[0].direction ?? 'deposit';

    // Build a fake webhook payload that matches provider format
    const fakePayload = {
      status:            simulateStatus.toUpperCase(),
      merchantReference: reference,
      transactionId:     pr.rows[0].provider_reference ?? `MOCK-${Date.now()}`,
      amount:            parseFloat(pr.rows[0].amount) * 100,
      currency:          'NAD',
      timestamp:         new Date().toISOString(),
      mock:              true,
    };

    logger.info(`[mock] firing ${simulateStatus} webhook for ${reference}`);

    return PaymentService.processWebhook({ provider, direction, payload: fakePayload });
  },
};


// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3 — PAYMENT SERVICE (deposit orchestration)
// ═════════════════════════════════════════════════════════════════════════════

const PaymentService = {

  /** Lookup the active commission rate for a category */
  async getCommissionRate(category = null) {
    const res = await query(
      `SELECT rate, flat_fee FROM commission_config
       WHERE is_active = TRUE
         AND (category = $1 OR category IS NULL)
         AND effective_from <= NOW()
         AND (effective_to IS NULL OR effective_to > NOW())
       ORDER BY category NULLS LAST
       LIMIT 1`,
      [category]
    );
    if (res.rows.length) return { rate: parseFloat(res.rows[0].rate), flatFee: parseFloat(res.rows[0].flat_fee) };
    return { rate: COMMISSION_RATE, flatFee: 0 };
  },

  /**
   * Initiate a mobile money deposit.
   * Returns immediately with pending status + instructions for the user.
   */
  async initiateDeposit({ userId, amount, provider, phone, idempotencyKey }) {
    if (!ADAPTERS[provider]) throw new AppError(`Unknown provider: ${provider}`, 400);
    if (amount < MIN_SINGLE_DEPOSIT) throw new AppError(`Minimum deposit is NAD ${MIN_SINGLE_DEPOSIT}`, 400);
    if (amount > MAX_SINGLE_DEPOSIT) throw new AppError(`Maximum deposit is NAD ${MAX_SINGLE_DEPOSIT}`, 400);

    // Idempotency — return existing pending request with same key
    if (idempotencyKey) {
      const existing = await query(
        `SELECT * FROM payment_requests WHERE idempotency_key=$1 AND user_id=$2`,
        [idempotencyKey, userId]
      );
      if (existing.rows.length) {
        logger.info('[payment] idempotent deposit return', { reference: existing.rows[0].reference });
        return { ...existing.rows[0], idempotent: true };
      }
    }

    const reference = makeReference('DEP');
    const adapter   = getAdapter(provider);

    // Persist BEFORE calling provider (for idempotency + crash safety)
    await query(
      `INSERT INTO payment_requests
         (user_id, reference, provider, amount, phone, direction, status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,'deposit','pending',$6)`,
      [userId, reference, provider, amount, phone, idempotencyKey ?? null]
    );

    let providerResp;
    try {
      providerResp = await adapter.initiateDeposit({ reference, amount, phone });
    } catch (err) {
      await query(
        `UPDATE payment_requests SET status='failed', failure_message=$1 WHERE reference=$2`,
        [err.message, reference]
      );
      throw err;
    }

    const providerRef = providerResp.provider_reference ?? providerResp.transactionId ?? reference;
    const expiresAt   = providerResp.expires_at ?? new Date(Date.now() + 15 * 60_000).toISOString();

    await query(
      `UPDATE payment_requests
       SET provider_reference=$1, provider_response=$2, checkout_url=$3, expires_at=$4
       WHERE reference=$5`,
      [
        providerRef,
        JSON.stringify(providerResp),
        providerResp.checkout_url ?? null,
        expiresAt,
        reference,
      ]
    );

    // Register mock auto-trigger (dev only)
    await MockEngine.register(reference, { simulateStatus: 'completed', triggerAfterSecs: 0 });

    return {
      reference,
      provider_reference: providerRef,
      provider,
      amount,
      status:       'pending',
      instructions: providerResp.instructions,
      checkout_url: providerResp.checkout_url,
      ussd_code:    providerResp.ussd_code,
      expires_at:   expiresAt,
      mock:         IS_MOCK,
    };
  },

  /** Poll deposit status — used by mobile app while waiting */
  async pollDeposit(reference, userId) {
    const res = await query(
      `SELECT pr.*, w.balance AS current_wallet_balance
       FROM payment_requests pr
       LEFT JOIN wallets w ON w.user_id = pr.user_id
       WHERE pr.reference=$1 AND pr.user_id=$2`,
      [reference, userId]
    );
    if (!res.rows.length) throw new AppError('Payment request not found', 404);

    const pr = res.rows[0];

    // If still pending and not expired, try to verify with provider
    if (pr.status === 'pending' && IS_MOCK === false) {
      try {
        const adapter  = getAdapter(pr.provider);
        const result   = await adapter.verifyTransaction(pr.provider_reference);
        const canonical = adapter.normaliseStatus(result.status);

        await query(
          'UPDATE payment_requests SET last_polled_at=NOW(), retry_count=retry_count+1 WHERE reference=$1',
          [reference]
        );

        if (canonical !== 'pending') {
          await PaymentService.processWebhook({
            provider: pr.provider,
            direction: pr.direction,
            payload: { status: result.status, merchantReference: reference, transactionId: pr.provider_reference },
          });
          return PaymentService.pollDeposit(reference, userId);
        }
      } catch (err) {
        logger.warn('[payment] poll verify error', err.message);
      }
    }

    return pr;
  },

  /**
   * Process an incoming webhook (from provider or mock engine).
   * Idempotent — safe to call multiple times.
   */
  async processWebhook({ provider, direction = 'deposit', payload }) {
    const client = await getClient();
    const webhookId = uuidv4();

    // Log webhook first (before any processing)
    try {
      await query(
        `INSERT INTO webhook_events (id, provider, payload, status, reference)
         VALUES ($1,$2,$3,'received',$4)`,
        [webhookId, provider, JSON.stringify(payload),
         payload.merchantReference ?? payload.reference ?? null]
      );
    } catch (_) {}

    try {
      await client.query('BEGIN');

      const ref = payload.merchantReference ?? payload.reference ?? payload.externalRef;
      if (!ref) {
        await client.query('ROLLBACK');
        return { handled: false, reason: 'no_reference' };
      }

      const prRes = await client.query(
        `SELECT * FROM payment_requests WHERE reference=$1 OR provider_reference=$2 FOR UPDATE`,
        [ref, payload.transactionId ?? ref]
      );

      if (!prRes.rows.length) {
        await client.query('ROLLBACK');
        await query(`UPDATE webhook_events SET status='ignored', error='not_found' WHERE id=$1`, [webhookId]);
        return { handled: false, reason: 'not_found' };
      }

      const pr          = prRes.rows[0];
      const adapter     = getAdapter(pr.provider);
      const newStatus   = adapter.normaliseStatus(payload.status);

      // Idempotent
      if (['completed','failed','refunded','cancelled'].includes(pr.status)) {
        await client.query('ROLLBACK');
        await query(`UPDATE webhook_events SET status='ignored', error='already_${pr.status}' WHERE id=$1`, [webhookId]);
        return { handled: true, idempotent: true, status: pr.status };
      }

      await client.query(
        `UPDATE payment_requests SET status=$1, completed_at=$2, provider_response=$3,
                failure_code=$4, failure_message=$5
         WHERE id=$6`,
        [
          newStatus,
          newStatus !== 'pending' ? new Date() : null,
          JSON.stringify(payload),
          payload.failureCode ?? null,
          payload.failureMessage ?? payload.message ?? null,
          pr.id,
        ]
      );

      if (newStatus === 'completed' && pr.direction === 'deposit') {
        await this._creditWallet(client, pr);
      }

      if (newStatus === 'failed' || newStatus === 'cancelled') {
        await this._handleFailedPayment(client, pr, newStatus);
      }

      await client.query('COMMIT');
      await query(`UPDATE webhook_events SET status='processed', processed_at=NOW() WHERE id=$1`, [webhookId]);

      logger.info(`[webhook] processed ${provider} ${newStatus}`, { reference: ref });
      return { handled: true, status: newStatus, reference: ref };

    } catch (err) {
      await client.query('ROLLBACK');
      await query(
        `UPDATE webhook_events SET status='failed', error=$1 WHERE id=$2`,
        [err.message, webhookId]
      );
      logger.error('[webhook] processing error', { error: err.message, provider });
      throw err;
    } finally {
      client.release();
    }
  },

  async _creditWallet(client, pr) {
    const walletRes = await client.query(
      'SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE',
      [pr.user_id]
    );
    const wallet    = walletRes.rows[0];
    const balBefore = parseFloat(wallet.balance);
    const amount    = parseFloat(pr.amount);
    const balAfter  = balBefore + amount;

    await client.query('UPDATE wallets SET balance=$1 WHERE id=$2', [balAfter, wallet.id]);

    await client.query(
      `INSERT INTO transactions
         (wallet_id, user_id, type, amount, balance_before, balance_after, reference, description)
       VALUES ($1,$2,'deposit',$3,$4,$5,$6,$7)`,
      [
        wallet.id, pr.user_id, amount, balBefore, balAfter,
        pr.reference,
        `${ADAPTERS[pr.provider]?.displayName ?? pr.provider} deposit`,
      ]
    );

    // Notification + push (fire-and-forget, outside transaction)
    setImmediate(() => {
      notificationService.create(pr.user_id, 'payment',
        '💰 Deposit Successful',
        `NAD ${amount.toFixed(2)} added to your NamTask wallet.`,
        { reference: pr.reference, provider: pr.provider, new_balance: balAfter }
      ).catch(() => {});
    });
  },

  async _handleFailedPayment(client, pr, status) {
    setImmediate(() => {
      notificationService.create(pr.user_id, 'payment',
        status === 'cancelled' ? 'Payment Cancelled' : 'Payment Failed',
        `Your NAD ${parseFloat(pr.amount).toFixed(2)} deposit was ${status}. Please try again.`,
        { reference: pr.reference }
      ).catch(() => {});
    });
  },

  /** Verify webhook signature for a given provider */
  verifyWebhookSignature(provider, rawBody, signature) {
    return getAdapter(provider).verifyWebhook(rawBody, signature);
  },
};


// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4 — ESCROW SERVICE
// ═════════════════════════════════════════════════════════════════════════════

const EscrowService = {

  /**
   * Hold funds in escrow when a task is created.
   * Deducts from customer wallet, creates escrow_transactions record.
   */
  async hold({ taskId, customerId, amount, category }) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const walletRes = await client.query(
        'SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE',
        [customerId]
      );
      const wallet    = walletRes.rows[0];
      if (!wallet) throw new AppError('Wallet not found', 404);

      const balBefore = parseFloat(wallet.balance);
      if (balBefore < amount) throw new AppError('Insufficient wallet balance', 402);

      const { rate, flatFee } = await PaymentService.getCommissionRate(category);
      const commission = namedToFixed(amount * rate + flatFee);
      const taskerpay  = namedToFixed(amount - commission);
      const balAfter   = namedToFixed(balBefore - amount);

      await client.query(
        'UPDATE wallets SET balance=$1, escrow_balance=escrow_balance+$2 WHERE id=$3',
        [balAfter, amount, wallet.id]
      );

      await client.query(
        `INSERT INTO transactions
           (wallet_id, user_id, task_id, type, amount, balance_before, balance_after, description)
         VALUES ($1,$2,$3,'escrow_hold',$4,$5,$6,$7)`,
        [wallet.id, customerId, taskId, amount, balBefore, balAfter,
         `Escrow held for task ${taskId}`]
      );

      await client.query(
        `INSERT INTO escrow_transactions
           (task_id, customer_id, amount, commission, tasker_payout, status)
         VALUES ($1,$2,$3,$4,$5,'held')
         ON CONFLICT (task_id) DO UPDATE
           SET amount=$3, commission=$4, tasker_payout=$5, status='held'`,
        [taskId, customerId, amount, commission, taskerpay]
      );

      await client.query('COMMIT');
      logger.info('[escrow] held', { taskId, amount, commission });
      return { held: true, amount, commission, tasker_payout: taskerpay };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Release escrow to tasker on task completion.
   * Platform keeps commission, tasker receives payout.
   */
  async release({ taskId, taskerId, releasedBy }) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const escrowRes = await client.query(
        `SELECT * FROM escrow_transactions WHERE task_id=$1 AND status='held' FOR UPDATE`,
        [taskId]
      );
      if (!escrowRes.rows.length) throw new AppError('No held escrow for this task', 404);

      const escrow   = escrowRes.rows[0];
      const payout   = parseFloat(escrow.tasker_payout ?? escrow.amount - escrow.commission);
      const amount   = parseFloat(escrow.amount);
      const custId   = escrow.customer_id;

      // Credit tasker wallet
      const tWalletRes = await client.query(
        'SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [taskerId]
      );
      const tWallet   = tWalletRes.rows[0];
      const tBalBefore = parseFloat(tWallet.balance);
      const tBalAfter  = tBalBefore + payout;

      await client.query(
        'UPDATE wallets SET balance=$1, total_earned=total_earned+$2 WHERE id=$3',
        [tBalAfter, payout, tWallet.id]
      );

      // Deduct escrow from customer's escrow balance
      await client.query(
        'UPDATE wallets SET escrow_balance=escrow_balance-$1, total_spent=total_spent+$2 WHERE user_id=$3',
        [amount, amount, custId]
      );

      // Record payout transaction
      await client.query(
        `INSERT INTO transactions
           (wallet_id, user_id, task_id, type, amount, balance_before, balance_after, description)
         VALUES ($1,$2,$3,'payout',$4,$5,$6,$7)`,
        [tWallet.id, taskerId, taskId, payout, tBalBefore, tBalAfter,
         `Task payout for ${taskId}`]
      );

      // Record commission transaction
      if (escrow.commission > 0) {
        await client.query(
          `INSERT INTO transactions
             (wallet_id, user_id, task_id, type, amount, balance_before, balance_after, description)
           VALUES ($1,$2,$3,'commission',$4,$5,$5,$6)`,
          [tWallet.id, taskerId, taskId, escrow.commission, 0, `Platform commission ${taskId}`]
        );
      }

      // Update escrow record
      await client.query(
        `UPDATE escrow_transactions
         SET status='released', released_at=NOW(), released_by=$1, tasker_payout=$2
         WHERE task_id=$3`,
        [releasedBy, payout, taskId]
      );

      // Update tasker profile stats
      await client.query(
        `UPDATE tasker_profiles
         SET total_tasks_completed=total_tasks_completed+1, total_earnings=total_earnings+$1
         WHERE user_id=$2`,
        [payout, taskerId]
      );

      await client.query('COMMIT');

      // Notifications
      setImmediate(() => {
        notificationService.create(taskerId, 'payment',
          '💰 Payment Received!',
          `NAD ${payout.toFixed(2)} for task ${taskId} added to your wallet.`,
          { task_id: taskId, amount: payout }
        ).catch(() => {});

        notificationService.create(custId, 'task_completed',
          '✅ Task Completed',
          `Payment of NAD ${amount.toFixed(2)} has been released to the tasker.`,
          { task_id: taskId }
        ).catch(() => {});
      });

      logger.info('[escrow] released', { taskId, taskerId, payout });
      return { released: true, payout, commission: escrow.commission };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Refund escrow to customer (e.g. cancelled task, dispute in customer's favour).
   */
  async refund({ taskId, reason, refundToProvider = false }) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const escrowRes = await client.query(
        `SELECT * FROM escrow_transactions WHERE task_id=$1 AND status='held' FOR UPDATE`,
        [taskId]
      );
      if (!escrowRes.rows.length) throw new AppError('No held escrow to refund', 404);

      const escrow   = escrowRes.rows[0];
      const amount   = parseFloat(escrow.amount);
      const custId   = escrow.customer_id;

      // Restore customer wallet balance
      const cWallet = await client.query(
        'SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [custId]
      );
      const w = cWallet.rows[0];
      const balBefore = parseFloat(w.balance);
      const balAfter  = balBefore + amount;

      await client.query(
        'UPDATE wallets SET balance=$1, escrow_balance=escrow_balance-$2 WHERE id=$3',
        [balAfter, amount, w.id]
      );

      await client.query(
        `INSERT INTO transactions
           (wallet_id, user_id, task_id, type, amount, balance_before, balance_after, description)
         VALUES ($1,$2,$3,'refund',$4,$5,$6,$7)`,
        [w.id, custId, taskId, amount, balBefore, balAfter,
         `Escrow refund: ${reason ?? 'task cancelled'}`]
      );

      await client.query(
        `UPDATE escrow_transactions SET status='refunded', refund_reason=$1 WHERE task_id=$2`,
        [reason, taskId]
      );

      await client.query('COMMIT');

      // If refundToProvider — fire actual provider refund (e.g. card payment)
      if (refundToProvider) {
        const prRes = await query(
          `SELECT pr.* FROM payment_requests pr
           WHERE pr.user_id=$1 AND pr.status='completed' AND pr.direction='deposit'
           ORDER BY pr.completed_at DESC LIMIT 1`,
          [custId]
        );
        if (prRes.rows.length) {
          const pr      = prRes.rows[0];
          const adapter = getAdapter(pr.provider);
          try {
            await adapter.refund({ providerRef: pr.provider_reference, amount, reason });
          } catch (err) {
            logger.error('[escrow] provider refund failed', err.message);
          }
        }
      }

      setImmediate(() => {
        notificationService.create(custId, 'payment',
          '↩️ Refund Processed',
          `NAD ${amount.toFixed(2)} has been returned to your wallet.`,
          { task_id: taskId, reason }
        ).catch(() => {});
      });

      logger.info('[escrow] refunded', { taskId, amount, reason });
      return { refunded: true, amount };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Partial release for dispute resolution
   * e.g. task 60% complete → tasker gets 60%, customer gets 40% back
   */
  async partialRelease({ taskId, taskerId, taskerPercent, adminId, reason }) {
    const escrowRes = await query(
      `SELECT * FROM escrow_transactions WHERE task_id=$1 AND status='held'`,
      [taskId]
    );
    if (!escrowRes.rows.length) throw new AppError('No held escrow', 404);

    const escrow       = escrowRes.rows[0];
    const total        = parseFloat(escrow.amount);
    const taskerShare  = namedToFixed(total * (taskerPercent / 100));
    const customerBack = namedToFixed(total - taskerShare);

    // Release to tasker (minus commission proportionally)
    const { rate } = await PaymentService.getCommissionRate();
    const commission = namedToFixed(taskerShare * rate);
    const taskerNet  = namedToFixed(taskerShare - commission);

    await client.query('BEGIN');
    // This is intentionally simplified — in production extract to its own transaction block
    await EscrowService.release({ taskId, taskerId, releasedBy: adminId });
    // Then refund the remaining customer share
    if (customerBack > 0) {
      await query(
        `UPDATE wallets SET balance=balance+$1, escrow_balance=escrow_balance-$1 WHERE user_id=$2`,
        [customerBack, escrow.customer_id]
      );
    }

    return { tasker_receives: taskerNet, customer_refunded: customerBack, commission };
  },

  /** Get escrow status for a task */
  async getStatus(taskId) {
    const res = await query(
      `SELECT et.*, t.status AS task_status, t.title,
              uc.name AS customer_name, ut.name AS tasker_name
       FROM escrow_transactions et
       JOIN tasks t ON t.id = et.task_id
       JOIN users uc ON uc.id = et.customer_id
       LEFT JOIN users ut ON ut.id = et.tasker_id
       WHERE et.task_id=$1`,
      [taskId]
    );
    if (!res.rows.length) throw new AppError('No escrow record for this task', 404);
    return res.rows[0];
  },
};


// ═════════════════════════════════════════════════════════════════════════════
// SECTION 5 — WITHDRAWAL SERVICE
// ═════════════════════════════════════════════════════════════════════════════

const WithdrawalService = {

  /** Check and record daily withdrawal against limit */
  async _checkDailyLimit(userId, amount) {
    const res = await query(
      `SELECT total_amount, count FROM withdrawal_limits WHERE user_id=$1 AND date=CURRENT_DATE`,
      [userId]
    );
    const todayTotal = parseFloat(res.rows[0]?.total_amount ?? 0);
    if (todayTotal + amount > DAILY_LIMIT) {
      throw new AppError(
        `Daily withdrawal limit of NAD ${DAILY_LIMIT.toFixed(2)} exceeded. ` +
        `Today you've withdrawn NAD ${todayTotal.toFixed(2)}.`,
        402
      );
    }
  },

  async _recordWithdrawal(userId, amount) {
    await query(
      `INSERT INTO withdrawal_limits (user_id, date, total_amount, count)
       VALUES ($1, CURRENT_DATE, $2, 1)
       ON CONFLICT (user_id, date)
       DO UPDATE SET total_amount=withdrawal_limits.total_amount+$2, count=withdrawal_limits.count+1`,
      [userId, amount]
    );
  },

  /**
   * Initiate a withdrawal request.
   * Deducts from wallet immediately (reserved), pays out via provider async.
   */
  async initiate({ userId, amount, provider, recipientPhone, accountNumber, accountName, branchCode, idempotencyKey }) {
    if (amount < MIN_WITHDRAWAL) throw new AppError(`Minimum withdrawal is NAD ${MIN_WITHDRAWAL}`, 400);
    if (!ADAPTERS[provider])   throw new AppError(`Unknown provider: ${provider}`, 400);

    // Idempotency
    if (idempotencyKey) {
      const existing = await query(
        'SELECT * FROM withdrawal_requests WHERE idempotency_key=$1 AND user_id=$2',
        [idempotencyKey, userId]
      );
      if (existing.rows.length) return { ...existing.rows[0], idempotent: true };
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Daily limit check
      await this._checkDailyLimit(userId, amount);

      // Wallet check
      const walletRes = await client.query(
        'SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [userId]
      );
      const wallet    = walletRes.rows[0];
      const balBefore = parseFloat(wallet.balance);
      if (balBefore < amount + WITHDRAWAL_FEE) {
        throw new AppError(
          `Insufficient balance. You need NAD ${(amount + WITHDRAWAL_FEE).toFixed(2)} (amount + NAD ${WITHDRAWAL_FEE} fee).`,
          402
        );
      }

      const reference = makeReference('WDR');
      const netAmount = namedToFixed(amount - WITHDRAWAL_FEE);
      const balAfter  = namedToFixed(balBefore - amount - WITHDRAWAL_FEE);

      // Deduct from wallet (hold until payout completes)
      await client.query(
        'UPDATE wallets SET balance=$1 WHERE id=$2',
        [balAfter, wallet.id]
      );

      await client.query(
        `INSERT INTO transactions
           (wallet_id, user_id, type, amount, balance_before, balance_after, description)
         VALUES ($1,$2,'withdrawal',$3,$4,$5,$6)`,
        [wallet.id, userId, amount + WITHDRAWAL_FEE, balBefore, balAfter,
         `Withdrawal via ${ADAPTERS[provider].displayName}`]
      );

      // Create withdrawal record
      await client.query(
        `INSERT INTO withdrawal_requests
           (user_id, wallet_id, amount, fee, provider, recipient_phone,
            recipient_account, recipient_name, branch_code, reference,
            status, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)`,
        [userId, wallet.id, amount + WITHDRAWAL_FEE, WITHDRAWAL_FEE, provider,
         recipientPhone, accountNumber, accountName, branchCode, reference, idempotencyKey ?? null]
      );

      await client.query('COMMIT');
      await this._recordWithdrawal(userId, amount);

      // Fire provider payout async
      setImmediate(async () => {
        try {
          const adapter = getAdapter(provider);
          const resp = provider === 'fnb_ewallet'
            ? await adapter.initiateWithdrawal({ reference, amount: netAmount, phone: recipientPhone, accountName })
            : await adapter.initiateWithdrawal({ reference, amount: netAmount, accountNumber, accountName, branchCode });

          const providerRef = resp.provider_reference ?? resp.transactionId ?? reference;
          await query(
            `UPDATE withdrawal_requests
             SET provider_reference=$1, provider_response=$2, status='processing', processed_at=NOW()
             WHERE reference=$3`,
            [providerRef, JSON.stringify(resp), reference]
          );

          if (IS_MOCK) {
            // Mock: auto-complete withdrawal after 2 seconds
            setTimeout(() => {
              query(
                `UPDATE withdrawal_requests SET status='completed', completed_at=NOW() WHERE reference=$1`,
                [reference]
              ).catch(() => {});
              notificationService.create(userId, 'payment',
                '✅ Withdrawal Completed',
                `NAD ${netAmount.toFixed(2)} has been sent to your ${ADAPTERS[provider].displayName}.`,
                { reference }
              ).catch(() => {});
            }, 2000);
          }
        } catch (err) {
          logger.error('[withdrawal] provider initiate failed', err.message);
          await query(
            `UPDATE withdrawal_requests SET status='failed', failure_reason=$1 WHERE reference=$2`,
            [err.message, reference]
          );
          // Refund wallet on failure
          await query(
            `UPDATE wallets SET balance=balance+$1 WHERE user_id=$2`,
            [amount + WITHDRAWAL_FEE, userId]
          );
          notificationService.create(userId, 'payment',
            '⚠️ Withdrawal Failed',
            `Your NAD ${amount.toFixed(2)} withdrawal failed. The amount has been returned to your wallet.`,
            { reference, reason: err.message }
          ).catch(() => {});
        }
      });

      logger.info('[withdrawal] initiated', { userId, amount, provider, reference });
      return {
        reference,
        amount: amount + WITHDRAWAL_FEE,
        net_amount: netAmount,
        fee: WITHDRAWAL_FEE,
        provider,
        status: 'pending',
        message: IS_MOCK
          ? `Mock withdrawal: funds will arrive in ~2 seconds`
          : `Your withdrawal is being processed. Funds arrive within 24 hours.`,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getStatus(reference, userId) {
    const res = await query(
      'SELECT * FROM withdrawal_requests WHERE reference=$1 AND user_id=$2',
      [reference, userId]
    );
    if (!res.rows.length) throw new AppError('Withdrawal not found', 404);
    return res.rows[0];
  },

  async listForUser(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const res = await query(
      `SELECT * FROM withdrawal_requests WHERE user_id=$1
       ORDER BY requested_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return res.rows;
  },
};


// ═════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Adapters (for direct access if needed)
  FNBAdapter,
  BWKAdapter,
  getAdapter,

  // Core services
  PaymentService,
  EscrowService,
  WithdrawalService,
  MockEngine,

  // Convenience re-exports (backwards-compatible)
  initiateDeposit:  (args) => PaymentService.initiateDeposit(args),
  pollDeposit:      (ref, userId) => PaymentService.pollDeposit(ref, userId),
  processWebhook:   (args) => PaymentService.processWebhook(args),
  initiateRefund:   (args) => EscrowService.refund(args),

  verifyFNBWebhook: (raw, sig) => FNBAdapter.verifyWebhook(raw, sig),
  verifyBWKWebhook: (raw, sig) => BWKAdapter.verifyWebhook(raw, sig),

  COMMISSION_RATE,
  WITHDRAWAL_FEE,
  IS_MOCK,
};
