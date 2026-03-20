const { query, getClient } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

// Namibia city coordinates map
const CITY_COORDS = {
  WINDHOEK:    { lat: -22.5597, lng: 17.0832 },
  WALVIS:      { lat: -22.9576, lng: 14.5053 },
  'WALVIS BAY':{ lat: -22.9576, lng: 14.5053 },
  SWAKOPMUND:  { lat: -22.6784, lng: 14.5269 },
  OSHAKATI:    { lat: -17.7833, lng: 15.6833 },
  RUNDU:       { lat: -17.9333, lng: 19.7667 },
  KATIMA:      { lat: -17.4833, lng: 24.2667 },
  GOBABIS:     { lat: -22.4498, lng: 18.9737 },
  KEETMANSHOOP:{ lat: -26.5833, lng: 18.1333 },
  LÜDERITZ:    { lat: -26.6481, lng: 15.1588 },
  OTJIWARONGO: { lat: -20.4641, lng: 16.6527 },
  GROOTFONTEIN:{ lat: -19.5667, lng: 18.1167 },
};

const CATEGORY_MAP = {
  CLEAN:    'cleaning',  CLEANING: 'cleaning',
  DELIVER:  'delivery',  DELIVERY: 'delivery',
  MOVE:     'moving',    MOVING:   'moving',
  FIX:      'repairs',   REPAIR:   'repairs',  REPAIRS: 'repairs',
  TUTOR:    'tutoring',  TUTORING: 'tutoring',
  ERRAND:   'errands',   ERRANDS:  'errands',
  CARE:     'caregiving',CAREGIVE: 'caregiving',
};

const TIME_MAP = {
  'MORNING':   '09:00',
  'AFTERNOON': '14:00',
  'EVENING':   '18:00',
  'TONIGHT':   '19:00',
  'NOW':       null,  // immediate
};

/**
 * Parse SMS text into task object
 * Format: TASK <CATEGORY> <DESCRIPTION> <CITY> <DATE> <TIME> <PRICE>
 * Example: "TASK CLEAN HOUSE WINDHOEK TOMORROW 9AM 150"
 */
const parseSMS = (text) => {
  const upper = text.trim().toUpperCase().replace(/\s+/g, ' ');

  if (!upper.startsWith('TASK ')) {
    return { success: false, error: 'SMS must start with TASK' };
  }

  const parts = upper.replace(/^TASK /, '').split(' ');

  // Extract category (first word)
  const categoryKey = parts[0];
  const category = CATEGORY_MAP[categoryKey];
  if (!category) {
    return { success: false, error: `Unknown category: ${categoryKey}. Use: CLEAN, DELIVER, MOVE, FIX, TUTOR, ERRAND, CARE` };
  }

  // Extract price (last numeric value)
  let price = null;
  let priceIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    const num = parseFloat(parts[i]);
    if (!isNaN(num) && num > 0) { price = num; priceIdx = i; break; }
  }
  if (!price) return { success: false, error: 'Price not found. End your SMS with the price amount e.g. 150' };

  // Extract city
  let city = null;
  let cityCoords = null;
  let cityIdx = -1;
  for (const [name, coords] of Object.entries(CITY_COORDS)) {
    const nameWords = name.split(' ');
    for (let i = 1; i < parts.length; i++) {
      if (nameWords.length === 1 && parts[i] === name) {
        city = name; cityCoords = coords; cityIdx = i; break;
      } else if (nameWords.length === 2 && parts[i] === nameWords[0] && parts[i+1] === nameWords[1]) {
        city = name; cityCoords = coords; cityIdx = i; break;
      }
    }
    if (city) break;
  }
  if (!city) return { success: false, error: 'City not recognized. Use Namibian cities like WINDHOEK, WALVIS BAY, SWAKOPMUND' };

  // Extract time
  let scheduledTime = null;
  const timeRegex = /^(\d{1,2})(AM|PM)$/;
  let dateStr = 'today';

  for (let i = 1; i < parts.length; i++) {
    if (i === cityIdx || i === priceIdx) continue;
    if (parts[i] === 'TOMORROW') { dateStr = 'tomorrow'; continue; }
    if (parts[i] === 'TODAY')    { dateStr = 'today'; continue; }
    if (TIME_MAP[parts[i]] !== undefined) {
      const t = TIME_MAP[parts[i]];
      if (t) {
        const d = dateStr === 'tomorrow' ? new Date(Date.now() + 86400000) : new Date();
        const [h, m] = t.split(':');
        d.setHours(parseInt(h), parseInt(m), 0, 0);
        scheduledTime = d.toISOString();
      }
      continue;
    }
    const match = parts[i].match(timeRegex);
    if (match) {
      let hour = parseInt(match[1]);
      const ampm = match[2];
      if (ampm === 'PM' && hour !== 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
      const d = dateStr === 'tomorrow' ? new Date(Date.now() + 86400000) : new Date();
      d.setHours(hour, 0, 0, 0);
      scheduledTime = d.toISOString();
    }
  }

  // Build description from remaining words
  const skip = new Set([0, cityIdx, priceIdx]);
  const descWords = parts.filter((_, i) => !skip.has(i) && !['TOMORROW','TODAY','MORNING','AFTERNOON','EVENING','TONIGHT','NOW'].includes(parts[i]) && !parts[i].match(timeRegex));
  const description = descWords.join(' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) || `${category} task in ${city}`;

  return {
    success: true,
    task: {
      title: `${categoryKey} - ${city}`,
      description,
      category,
      budget: price,
      latitude: cityCoords.lat,
      longitude: cityCoords.lng,
      location_address: city,
      location_city: city,
      scheduled_time: scheduledTime,
      is_sms_booking: true,
    },
  };
};

/**
 * @swagger
 * /sms/webhook:
 *   post:
 *     summary: Mock SMS webhook endpoint
 *     tags: [SMS]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, message]
 *             properties:
 *               phone: { type: string }
 *               message: { type: string }
 *     responses:
 *       200:
 *         description: SMS processed
 */
const smsWebhook = async (req, res, next) => {
  const client = await getClient();
  try {
    // Verify webhook secret
    const secret = req.headers['x-sms-secret'] || req.body.secret;
    if (secret !== process.env.SMS_WEBHOOK_SECRET) {
      return res.status(401).json({ success: false, message: 'Invalid webhook secret' });
    }

    const { phone, message } = req.body;
    if (!phone || !message) throw new AppError('phone and message are required', 400);

    // Find user by phone
    const userRes = await query('SELECT id, name, role FROM users WHERE phone = $1 AND is_active = true', [phone]);
    if (!userRes.rows.length) {
      return res.json({
        success: false,
        message: 'Phone number not registered. Please register at namtask.com or call support.',
        sms_reply: 'NamTask: Phone not registered. Visit namtask.com to sign up. Reply HELP for info.',
      });
    }

    const user = userRes.rows[0];
    if (user.role !== 'customer') {
      return res.json({ success: false, message: 'Only customers can book tasks via SMS' });
    }

    // Parse the SMS
    const parsed = parseSMS(message);
    if (!parsed.success) {
      return res.json({
        success: false,
        message: parsed.error,
        sms_reply: `NamTask Error: ${parsed.error}. Format: TASK CLEAN HOUSE WINDHOEK TOMORROW 9AM 150`,
      });
    }

    const { task } = parsed;

    // Check wallet balance
    const walletRes = await query('SELECT balance FROM wallets WHERE user_id = $1', [user.id]);
    if (!walletRes.rows.length || parseFloat(walletRes.rows[0].balance) < task.budget) {
      return res.json({
        success: false,
        message: 'Insufficient wallet balance',
        sms_reply: `NamTask: Insufficient balance. You need NAD ${task.budget}. Deposit via app or USSD.`,
      });
    }

    await client.query('BEGIN');

    // Create task
    const taskRes = await client.query(
      `INSERT INTO tasks (customer_id, title, description, category, budget, location, location_address, location_city, scheduled_time, is_sms_booking, raw_sms)
       VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326),$8,$9,$10,true,$11)
       RETURNING *`,
      [user.id, task.title, task.description, task.category, task.budget,
       task.longitude, task.latitude, task.location_address, task.location_city,
       task.scheduled_time, message]
    );

    const newTask = taskRes.rows[0];

    // Hold escrow
    const walBal = parseFloat(walletRes.rows[0].balance);
    await client.query('UPDATE wallets SET balance = $1, escrow_balance = escrow_balance + $2 WHERE user_id = $3',
      [walBal - task.budget, task.budget, user.id]);

    await client.query(
      `INSERT INTO transactions (wallet_id, user_id, task_id, type, amount, balance_before, balance_after, description)
       SELECT id,$1,$2,'escrow_hold',$3,$4,$5,$6 FROM wallets WHERE user_id = $1`,
      [user.id, newTask.id, task.budget, walBal, walBal - task.budget, `SMS booking: ${task.title}`]
    );

    await client.query(
      'INSERT INTO escrow_transactions (task_id, customer_id, amount, commission) VALUES ($1,$2,$3,$4)',
      [newTask.id, user.id, task.budget, (task.budget * 0.10).toFixed(2)]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'SMS task created successfully',
      data: { task: newTask },
      sms_reply: `NamTask: Task booked! ${task.title} for NAD ${task.budget}${task.scheduled_time ? ' on ' + new Date(task.scheduled_time).toLocaleString() : ''}. Task ID: ${newTask.id.substring(0,8).toUpperCase()}`,
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
 * /sms/parse:
 *   post:
 *     summary: Parse SMS text (test endpoint)
 *     tags: [SMS]
 */
const parseOnly = (req, res) => {
  const { message } = req.body;
  res.json({ success: true, data: parseSMS(message || '') });
};

module.exports = { smsWebhook, parseOnly };
