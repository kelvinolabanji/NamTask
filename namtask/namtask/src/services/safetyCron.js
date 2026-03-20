'use strict';
/**
 * Safety Cron — runs every 5 minutes
 * Detects missed check-ins, auto-escalates to SOS after 3 consecutive misses
 *
 * Start in server.js or as a standalone worker:
 *   require('./services/safetyCron').start()
 */

const { processMissedCheckIns } = require('../controllers/safetyController');
const logger = require('../config/logger');

let _interval = null;
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const tick = async () => {
  const processed = await processMissedCheckIns();
  if (processed > 0) {
    logger.info(`[safety-cron] Processed ${processed} overdue sessions`);
  }
};

const start = () => {
  if (_interval) return;
  logger.info('[safety-cron] Starting — interval: 5 minutes');
  tick(); // run immediately on start
  _interval = setInterval(tick, INTERVAL_MS);
};

const stop = () => {
  if (_interval) { clearInterval(_interval); _interval = null; }
  logger.info('[safety-cron] Stopped');
};

module.exports = { start, stop };
