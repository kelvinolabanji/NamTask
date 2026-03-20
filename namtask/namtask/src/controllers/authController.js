const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

const generateToken = (userId, role) =>
  jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone, password, role]
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               password: { type: string }
 *               role: { type: string, enum: [customer, tasker] }
 *     responses:
 *       201:
 *         description: User registered successfully
 *       409:
 *         description: Phone or email already in use
 */
const register = async (req, res, next) => {
  try {
    const { name, phone, email, password, role = 'customer' } = req.body;

    if (!['customer', 'tasker'].includes(role)) {
      throw new AppError('Role must be customer or tasker', 400);
    }

    const exists = await query('SELECT id FROM users WHERE phone = $1 OR email = $2', [phone, email]);
    if (exists.rows.length) throw new AppError('Phone or email already registered', 409);

    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const password_hash = await bcrypt.hash(password, rounds);

    const result = await query(
      `INSERT INTO users (name, phone, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, phone, email, role, created_at`,
      [name, phone, email || null, password_hash, role]
    );

    const user = result.rows[0];

    // Create wallet
    await query('INSERT INTO wallets (user_id) VALUES ($1)', [user.id]);

    // Create tasker profile if role is tasker
    if (role === 'tasker') {
      await query('INSERT INTO tasker_profiles (user_id) VALUES ($1)', [user.id]);
    }

    const token = generateToken(user.id, user.role);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: { user, token },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, password]
 *             properties:
 *               phone: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */
const login = async (req, res, next) => {
  try {
    const { phone, password } = req.body;

    const result = await query(
      'SELECT id, name, phone, email, password_hash, role, is_active, avatar_url FROM users WHERE phone = $1',
      [phone]
    );

    if (!result.rows.length) throw new AppError('Invalid phone or password', 401);

    const user = result.rows[0];
    if (!user.is_active) throw new AppError('Account deactivated. Contact support.', 403);

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new AppError('Invalid phone or password', 401);

    // Update last seen
    await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [user.id]);

    delete user.password_hash;
    const token = generateToken(user.id, user.role);

    res.json({
      success: true,
      message: 'Login successful',
      data: { user, token },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: User profile
 */
const getMe = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.phone, u.email, u.role, u.avatar_url, u.rating, u.rating_count, u.created_at,
              w.balance, w.escrow_balance,
              tp.verification_status, tp.skills, tp.categories, tp.hourly_rate
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       LEFT JOIN tasker_profiles tp ON tp.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!valid) throw new AppError('Current password is incorrect', 400);

    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hash = await bcrypt.hash(new_password, rounds);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, getMe, changePassword };
