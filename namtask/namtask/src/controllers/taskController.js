const { query, getClient } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { aiMatchTaskers } = require('../ai-hooks/aiMatching');
const { aiSuggestPrice }  = require('../ai-hooks/aiPricing');
const notificationService = require('../services/notificationService');

/**
 * @swagger
 * /tasks:
 *   post:
 *     summary: Create a new task
 *     tags: [Tasks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, category, budget, latitude, longitude]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               category: { type: string }
 *               budget: { type: number }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               location_address: { type: string }
 *               location_city: { type: string }
 *               scheduled_time: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: Task created
 */
const createTask = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const {
      title, description, category, budget,
      latitude, longitude, location_address, location_city,
      scheduled_time
    } = req.body;

    // AI price suggestion hook
    const suggestedPrice = await aiSuggestPrice({ category, location_city, budget });

    const result = await client.query(
      `INSERT INTO tasks
         (customer_id, title, description, category, budget,
          location, location_address, location_city, scheduled_time)
       VALUES ($1,$2,$3,$4,$5,
               ST_SetSRID(ST_MakePoint($6,$7),4326),
               $8,$9,$10)
       RETURNING *`,
      [req.user.id, title, description, category, budget,
       longitude, latitude, location_address, location_city, scheduled_time || null]
    );

    const task = result.rows[0];

    // Deduct escrow from customer wallet
    const wallet = await client.query(
      'SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE',
      [req.user.id]
    );

    if (!wallet.rows.length || parseFloat(wallet.rows[0].balance) < parseFloat(budget)) {
      throw new AppError('Insufficient wallet balance to post this task', 402);
    }

    const balBefore = parseFloat(wallet.rows[0].balance);
    const balAfter  = balBefore - parseFloat(budget);

    await client.query(
      'UPDATE wallets SET balance = $1, escrow_balance = escrow_balance + $2 WHERE user_id = $3',
      [balAfter, budget, req.user.id]
    );

    await client.query(
      `INSERT INTO transactions (wallet_id, user_id, task_id, type, amount, balance_before, balance_after, description)
       SELECT id, $1, $2, 'escrow_hold', $3, $4, $5, $6 FROM wallets WHERE user_id = $1`,
      [req.user.id, task.id, budget, balBefore, balAfter, `Escrow held for task: ${title}`]
    );

    await client.query(
      `INSERT INTO escrow_transactions (task_id, customer_id, amount, commission)
       VALUES ($1,$2,$3,$4)`,
      [task.id, req.user.id, budget, (parseFloat(budget) * parseFloat(process.env.COMMISSION_RATE || 0.10)).toFixed(2)]
    );

    await client.query('COMMIT');

    // AI match taskers (async, non-blocking)
    aiMatchTaskers(task).catch(() => {});

    res.status(201).json({
      success: true,
      message: 'Task created successfully',
      data: { task, suggested_price: suggestedPrice },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

/**
 * @swagger
 * /tasks/nearby:
 *   get:
 *     summary: Get nearby tasks using geolocation
 *     tags: [Tasks]
 *     parameters:
 *       - in: query
 *         name: latitude
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: longitude
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: radius_km
 *         schema: { type: number, default: 10 }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of nearby tasks
 */
const getNearbyTasks = async (req, res, next) => {
  try {
    const { latitude, longitude, radius_km = 10, category, page = 1, limit = 20 } = req.query;

    if (!latitude || !longitude) throw new AppError('latitude and longitude are required', 400);

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [parseFloat(longitude), parseFloat(latitude), parseFloat(radius_km) * 1000];
    let paramIdx = 4;
    let categoryFilter = '';

    if (category) {
      categoryFilter = ` AND t.category = $${paramIdx++}`;
      params.push(category);
    }

    params.push(parseInt(limit), offset);

    const result = await query(
      `SELECT t.*,
              ST_Distance(t.location::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) / 1000 AS distance_km,
              u.name AS customer_name, u.avatar_url AS customer_avatar, u.rating AS customer_rating,
              (SELECT COUNT(*) FROM task_offers WHERE task_id = t.id) AS offer_count
       FROM tasks t
       JOIN users u ON u.id = t.customer_id
       WHERE t.status = 'pending'
         AND ST_DWithin(t.location::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)
         ${categoryFilter}
       ORDER BY distance_km ASC, t.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: result.rows.length },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /tasks/{id}:
 *   get:
 *     summary: Get task by ID
 *     tags: [Tasks]
 */
const getTask = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.*,
              ST_X(t.location::geometry) AS longitude,
              ST_Y(t.location::geometry) AS latitude,
              u.name AS customer_name, u.avatar_url AS customer_avatar, u.rating AS customer_rating, u.phone AS customer_phone,
              tk.name AS tasker_name, tk.avatar_url AS tasker_avatar, tk.rating AS tasker_rating,
              (SELECT json_agg(json_build_object('url', ti.url, 'type', ti.type)) FROM task_images ti WHERE ti.task_id = t.id) AS images,
              (SELECT json_agg(json_build_object('id', o.id, 'bid_price', o.bid_price, 'message', o.message, 'status', o.status, 'tasker_id', o.tasker_id, 'tasker_name', uo.name, 'tasker_rating', uo.rating))
               FROM task_offers o JOIN users uo ON uo.id = o.tasker_id WHERE o.task_id = t.id) AS offers
       FROM tasks t
       JOIN users u ON u.id = t.customer_id
       LEFT JOIN users tk ON tk.id = t.tasker_id
       WHERE t.id = $1`,
      [req.params.id]
    );

    if (!result.rows.length) throw new AppError('Task not found', 404);

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /tasks:
 *   get:
 *     summary: List tasks (with filters)
 *     tags: [Tasks]
 */
const listTasks = async (req, res, next) => {
  try {
    const { status, category, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [req.user.id];
    const conditions = [];
    let idx = 2;

    if (req.user.role === 'customer') {
      conditions.push(`t.customer_id = $1`);
    } else if (req.user.role === 'tasker') {
      conditions.push(`(t.tasker_id = $1 OR t.status = 'pending')`);
    }

    if (status) { conditions.push(`t.status = $${idx++}`); params.push(status); }
    if (category) { conditions.push(`t.category = $${idx++}`); params.push(category); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);

    const result = await query(
      `SELECT t.*, u.name AS customer_name, u.avatar_url AS customer_avatar
       FROM tasks t JOIN users u ON u.id = t.customer_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    res.json({ success: true, data: result.rows, pagination: { page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /tasks/{id}/status:
 *   patch:
 *     summary: Update task status
 *     tags: [Tasks]
 */
const updateTaskStatus = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { status } = req.body;
    const { id } = req.params;

    const validTransitions = {
      pending:     ['accepted', 'cancelled'],
      accepted:    ['in_progress', 'cancelled'],
      in_progress: ['completed', 'disputed'],
    };

    const taskRes = await client.query('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', [id]);
    if (!taskRes.rows.length) throw new AppError('Task not found', 404);

    const task = taskRes.rows[0];
    const allowed = validTransitions[task.status] || [];

    if (!allowed.includes(status)) {
      throw new AppError(`Cannot transition from ${task.status} to ${status}`, 400);
    }

    // Authorization checks
    if (status === 'accepted' && req.user.role !== 'tasker') throw new AppError('Only taskers can accept tasks', 403);
    if (['in_progress', 'completed'].includes(status) && task.tasker_id !== req.user.id && task.customer_id !== req.user.id) {
      throw new AppError('Not authorized to update this task', 403);
    }

    const updates = { status };
    if (status === 'in_progress') updates.started_at = new Date();
    if (status === 'completed')   updates.completed_at = new Date();

    const result = await client.query(
      `UPDATE tasks SET status = $1, started_at = COALESCE($2, started_at), completed_at = COALESCE($3, completed_at)
       WHERE id = $4 RETURNING *`,
      [status, updates.started_at || null, updates.completed_at || null, id]
    );

    // Release escrow on completion
    if (status === 'completed') {
      const escrow = await client.query('SELECT * FROM escrow_transactions WHERE task_id = $1', [id]);
      if (escrow.rows.length && escrow.rows[0].status === 'held') {
        const { amount, commission, tasker_id: tId } = escrow.rows[0];
        const taskerId = task.tasker_id;
        const payout   = parseFloat(amount) - parseFloat(commission);

        // Credit tasker wallet
        const tw = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [taskerId]);
        const twBal = parseFloat(tw.rows[0].balance);
        await client.query('UPDATE wallets SET balance = $1, total_earned = total_earned + $2 WHERE user_id = $3',
          [twBal + payout, payout, taskerId]);

        await client.query(
          `INSERT INTO transactions (wallet_id, user_id, task_id, type, amount, balance_before, balance_after, description)
           SELECT id, $1, $2, 'payout', $3, $4, $5, $6 FROM wallets WHERE user_id = $1`,
          [taskerId, id, payout, twBal, twBal + payout, `Payout for task: ${task.title}`]
        );

        // Release customer escrow
        await client.query(
          'UPDATE wallets SET escrow_balance = escrow_balance - $1, total_spent = total_spent + $1 WHERE user_id = $2',
          [amount, task.customer_id]
        );

        await client.query(
          `UPDATE escrow_transactions SET status = 'released', released_at = NOW(), tasker_payout = $1 WHERE task_id = $2`,
          [payout, id]
        );

        // Update tasker profile stats
        await client.query(
          'UPDATE tasker_profiles SET total_tasks_completed = total_tasks_completed + 1, total_earnings = total_earnings + $1 WHERE user_id = $2',
          [payout, taskerId]
        );

        await notificationService.create(taskerId, 'payment', 'Payment Received', `You received NAD ${payout.toFixed(2)} for completing "${task.title}"`, { task_id: id });
      }
    }

    await client.query('COMMIT');

    await notificationService.create(task.customer_id, 'task_accepted', 'Task Updated', `Your task "${task.title}" is now ${status}`, { task_id: id });

    res.json({ success: true, message: `Task status updated to ${status}`, data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

/**
 * @swagger
 * /tasks/{id}/images:
 *   post:
 *     summary: Upload task images
 *     tags: [Tasks]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 */
const uploadTaskImages = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) throw new AppError('No images uploaded', 400);

    const task = await query('SELECT id, customer_id FROM tasks WHERE id = $1', [req.params.id]);
    if (!task.rows.length) throw new AppError('Task not found', 404);
    if (task.rows[0].customer_id !== req.user.id) throw new AppError('Not authorized', 403);

    const inserted = [];
    for (const file of req.files) {
      const url = `/uploads/tasks/${file.filename}`;
      const r = await query(
        'INSERT INTO task_images (task_id, url, uploaded_by) VALUES ($1,$2,$3) RETURNING *',
        [req.params.id, url, req.user.id]
      );
      inserted.push(r.rows[0]);
    }

    res.status(201).json({ success: true, message: `${inserted.length} image(s) uploaded`, data: inserted });
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /tasks/{id}/offers:
 *   post:
 *     summary: Submit an offer for a task
 *     tags: [Tasks]
 */
const submitOffer = async (req, res, next) => {
  try {
    const { bid_price, message } = req.body;
    const { id } = req.params;

    if (req.user.role !== 'tasker') throw new AppError('Only taskers can submit offers', 403);

    const task = await query('SELECT status, customer_id FROM tasks WHERE id = $1', [id]);
    if (!task.rows.length) throw new AppError('Task not found', 404);
    if (task.rows[0].status !== 'pending') throw new AppError('Task is no longer accepting offers', 400);
    if (task.rows[0].customer_id === req.user.id) throw new AppError('Cannot offer on your own task', 400);

    const tp = await query('SELECT verification_status FROM tasker_profiles WHERE user_id = $1', [req.user.id]);
    if (!tp.rows.length || tp.rows[0].verification_status !== 'approved') {
      throw new AppError('Your tasker profile must be approved to submit offers', 403);
    }

    const result = await query(
      `INSERT INTO task_offers (task_id, tasker_id, bid_price, message)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (task_id, tasker_id) DO UPDATE SET bid_price=$3, message=$4, status='pending'
       RETURNING *`,
      [id, req.user.id, bid_price, message]
    );

    await notificationService.create(
      task.rows[0].customer_id, 'task_offer', 'New Offer Received',
      `A tasker submitted an offer of NAD ${bid_price} for your task`, { task_id: id }
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /tasks/{id}/offers/{offerId}/accept:
 *   patch:
 *     summary: Accept a task offer
 *     tags: [Tasks]
 */
const acceptOffer = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { id, offerId } = req.params;

    const offerRes = await client.query(
      'SELECT o.*, u.name AS tasker_name FROM task_offers o JOIN users u ON u.id = o.tasker_id WHERE o.id = $1 AND o.task_id = $2',
      [offerId, id]
    );
    if (!offerRes.rows.length) throw new AppError('Offer not found', 404);
    const offer = offerRes.rows[0];

    const taskRes = await client.query('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', [id]);
    const task = taskRes.rows[0];
    if (task.customer_id !== req.user.id) throw new AppError('Not authorized', 403);
    if (task.status !== 'pending') throw new AppError('Task is not accepting offers', 400);

    // Update task
    await client.query(
      'UPDATE tasks SET tasker_id = $1, status = $2, final_price = $3 WHERE id = $4',
      [offer.tasker_id, 'accepted', offer.bid_price, id]
    );

    // Accept this offer, reject others
    await client.query('UPDATE task_offers SET status = $1 WHERE id = $2', ['accepted', offerId]);
    await client.query('UPDATE task_offers SET status = $1 WHERE task_id = $2 AND id != $3', ['rejected', id, offerId]);

    await client.query('COMMIT');

    await notificationService.create(offer.tasker_id, 'task_accepted', 'Offer Accepted!', `Your offer for "${task.title}" was accepted. Get ready!`, { task_id: id });

    res.json({ success: true, message: 'Offer accepted', data: { task_id: id, tasker_id: offer.tasker_id } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

module.exports = { createTask, getNearbyTasks, getTask, listTasks, updateTaskStatus, uploadTaskImages, submitOffer, acceptOffer };
