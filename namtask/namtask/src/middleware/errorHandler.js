const logger = require('../config/logger');

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';

  // PostgreSQL errors
  if (err.code === '23505') { // unique violation
    statusCode = 409;
    message = 'Resource already exists';
    const field = err.detail?.match(/\((.+?)\)/)?.[1];
    if (field) message = `${field} already in use`;
  }
  if (err.code === '23503') { // foreign key violation
    statusCode = 400;
    message = 'Referenced resource not found';
  }
  if (err.code === '23514') { // check constraint
    statusCode = 400;
    message = 'Invalid value provided';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    statusCode = 422;
  }

  if (statusCode === 500) {
    logger.error('Unhandled error:', { error: err.message, stack: err.stack, url: req.url, method: req.method });
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

const notFound = (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
};

module.exports = { AppError, errorHandler, notFound };
