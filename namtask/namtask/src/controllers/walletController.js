'use strict';
const { query }          = require('../config/database');
const { AppError }       = require('../middleware/errorHandler');
const { EscrowService }  = require('../services/mobileMoneyService');

// ─── GET /wallet ──────────────────────────────────────────────────────────────
const getWallet = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT w.*,
              (SELECT COUNT(*) FROM transactions WHERE user_id=$1 AND created_at > NOW()-INTERVAL '30 days') AS tx_this_month,
              (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id=$1 AND type='deposit'    AND status='completed') AS lifetime_deposited,
              (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id=$1 AND type='withdrawal' AND status='completed') AS lifetime_withdrawn
       FROM wallets w
       WHERE w.user_id=$1`,
      [req.user.id]
    );
    if (!result.rows.length) throw new AppError('Wallet not found', 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

// ─── GET /wallet/transactions ─────────────────────────────────────────────────
const getTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, type, date_from, date_to } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [req.user.id];
    const conditions = ['t.user_id = $1'];
    let idx = 2;

    if (type)      { conditions.push(`t.type = $${idx++}`);                    params.push(type); }
    if (date_from) { conditions.push(`t.created_at >= $${idx++}`);             params.push(date_from); }
    if (date_to)   { conditions.push(`t.created_at <= $${idx++}::date + 1`);   params.push(date_to); }

    const where = conditions.join(' AND ');
    params.push(parseInt(limit), offset);

    const [txResult, countResult] = await Promise.all([
      query(
        `SELECT t.*, tk.title AS task_title, tk.category AS task_category
         FROM transactions t
         LEFT JOIN tasks tk ON tk.id = t.task_id
         WHERE ${where}
         ORDER BY t.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params
      ),
      query(`SELECT COUNT(*) FROM transactions t WHERE ${where}`, params.slice(0, -2)),
    ]);

    res.json({
      success: true,
      data: txResult.rows,
      pagination: {
        page:  parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / parseInt(limit)),
      },
    });
  } catch (err) { next(err); }
};

// ─── GET /wallet/escrow ───────────────────────────────────────────────────────
const getEscrowSummary = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT et.*, t.title, t.status AS task_status, t.category,
              ut.name AS tasker_name
       FROM escrow_transactions et
       JOIN tasks t ON t.id = et.task_id
       LEFT JOIN users ut ON ut.id = et.tasker_id
       WHERE et.customer_id = $1 AND et.status = 'held'
       ORDER BY et.created_at DESC`,
      [req.user.id]
    );
    const totalHeld = result.rows.reduce((s, r) => s + parseFloat(r.amount), 0);
    res.json({ success: true, data: result.rows, total_held: totalHeld.toFixed(2) });
  } catch (err) { next(err); }
};

// ─── POST /wallet/deposit (internal cash-in, used in dev or after webhook) ────
const manualDeposit = async (req, res, next) => {
  try {
    const { amount, reference, description } = req.body;
    if (!amount || parseFloat(amount) <= 0)       throw new AppError('Amount must be positive', 400);
    if (parseFloat(amount) > 50000)               throw new AppError('Max single deposit NAD 50,000', 400);
    if (req.user.role !== 'admin' && parseFloat(amount) > 500) {
      throw new AppError('Manual deposits over NAD 500 require admin. Use mobile money for larger amounts.', 403);
    }

    const walletRes = await query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [req.user.id]);
    const wallet    = walletRes.rows[0];
    const balBefore = parseFloat(wallet.balance);
    const balAfter  = balBefore + parseFloat(amount);

    await query('UPDATE wallets SET balance=$1 WHERE user_id=$2', [balAfter, req.user.id]);
    const tx = await query(
      `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_before, balance_after, reference, description)
       VALUES ($1,$2,'deposit',$3,$4,$5,$6,$7) RETURNING *`,
      [wallet.id, req.user.id, amount, balBefore, balAfter, reference || null,
       description || `Manual deposit of NAD ${amount}`]
    );

    res.json({ success: true, message: 'Deposit successful', data: { transaction: tx.rows[0], new_balance: balAfter } });
  } catch (err) { next(err); }
};

// ─── GET /wallet/statement ────────────────────────────────────────────────────
const getStatement = async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const m = parseInt(month ?? new Date().getMonth() + 1);
    const y = parseInt(year  ?? new Date().getFullYear());

    const result = await query(
      `SELECT t.*, tk.title AS task_title
       FROM transactions t
       LEFT JOIN tasks tk ON tk.id = t.task_id
       WHERE t.user_id=$1
         AND EXTRACT(MONTH FROM t.created_at) = $2
         AND EXTRACT(YEAR  FROM t.created_at) = $3
       ORDER BY t.created_at ASC`,
      [req.user.id, m, y]
    );

    const summary = result.rows.reduce((acc, tx) => {
      const isCredit = ['deposit','payout','escrow_release','refund'].includes(tx.type);
      if (isCredit) acc.total_in  += parseFloat(tx.amount);
      else          acc.total_out += parseFloat(tx.amount);
      return acc;
    }, { total_in: 0, total_out: 0 });

    res.json({
      success: true,
      data:    result.rows,
      summary: {
        month: m, year: y,
        total_in:  summary.total_in.toFixed(2),
        total_out: summary.total_out.toFixed(2),
        net:       (summary.total_in - summary.total_out).toFixed(2),
        count:     result.rows.length,
      },
    });
  } catch (err) { next(err); }
};

module.exports = {
  getWallet,
  getTransactions,
  getEscrowSummary,
  manualDeposit,
  getStatement,
};
