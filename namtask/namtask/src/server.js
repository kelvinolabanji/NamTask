require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const compression = require('compression');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const swaggerUi  = require('swagger-ui-express');
const path       = require('path');

const swaggerSpec         = require('./config/swagger');
const logger              = require('./config/logger');
const routes              = require('./routes/index');
const setupSocket         = require('./sockets/socketServer');
const safetyCron          = require('./services/safetyCron');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// ── App Setup ─────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  },
  pingTimeout:  20000,
  pingInterval: 10000,
});

app.set('io', io);

// ── Global Middleware ─────────────────────────────────────────────────────────

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}));

app.use(compression());

// Capture raw body for webhook HMAC verification BEFORE json parsing
app.use((req, res, next) => {
  if (req.headers['content-type'] === 'application/json' &&
      req.path.includes('/webhook')) {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      req.rawBody = raw;
      try { req.body = JSON.parse(raw); } catch (_) { req.body = {}; }
      next();
    });
  } else {
    next();
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: (msg) => logger.http(msg.trim()) },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many auth attempts. Try again in 15 minutes.' },
});

app.use('/api/', limiter);
app.use('/api/v1/auth/login',    authLimiter);
app.use('/api/v1/auth/register', authLimiter);

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── API Routes ────────────────────────────────────────────────────────────────

app.use('/api/v1', routes);

// Swagger docs
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Nam Task API Docs',
  customCss: '.swagger-ui .topbar { background-color: #1a1a2e; }',
}));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'namtask-api',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────

setupSocket(io);

// ── Safety cron (missed check-in detection) ───────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  safetyCron.start();
}

// ── Error Handling ────────────────────────────────────────────────────────────

app.use(notFound);
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT) || 3000;

server.listen(PORT, () => {
  logger.info(`🚀 Nam Task API running on port ${PORT} [${process.env.NODE_ENV}]`);
  logger.info(`📚 Swagger docs: http://localhost:${PORT}/api/docs`);
  logger.info(`🔌 Socket.io ready`);
});

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  safetyCron.stop();
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason));

module.exports = { app, server, io };
