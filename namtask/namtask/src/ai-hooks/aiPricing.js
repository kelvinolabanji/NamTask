'use strict';
/**
 * Nam Task — AI Pricing Engine
 *
 * Fixes:
 *  - Was imported from non-existent ai-hooks/aiPricing (crash)
 *  - Demand multipliers from pricing_demand table
 *  - Confidence bands with sample size and percentile spread
 *  - Price elasticity check (is budget reasonable vs market?)
 */

const { query } = require('../config/database');
const logger    = require('../config/logger');

/**
 * Get demand multiplier for a category at a given time.
 * Returns 1.0 (no change) if no matching demand rule exists.
 */
const getDemandMultiplier = async (category, scheduledTime) => {
  try {
    const dt  = scheduledTime ? new Date(scheduledTime) : new Date();
    const dow  = dt.getDay();   // 0=Sun … 6=Sat
    const hour = dt.getHours(); // 0–23

    const res = await query(
      `SELECT MAX(multiplier) AS multiplier
       FROM pricing_demand
       WHERE is_active = TRUE
         AND (category = $1 OR category IS NULL)
         AND (dow = $2 OR dow IS NULL)
         AND hour_start <= $3
         AND hour_end   >= $3`,
      [category, dow, hour]
    );

    return parseFloat(res.rows[0]?.multiplier ?? 1.0);
  } catch {
    return 1.0;
  }
};

/**
 * Suggest a price range for a new task.
 *
 * Returns:
 *  suggested     — recommended price (demand-adjusted median)
 *  min           — p25 of recent similar tasks
 *  max           — p75
 *  market_median — raw median before demand adjustment
 *  demand_factor — multiplier applied (1.0 = no surge)
 *  confidence    — 'low' | 'medium' | 'high'
 *  sample_size   — number of comparable tasks used
 *  elasticity    — 'below_market' | 'fair' | 'above_market'
 *  note          — human-readable explanation
 */
const aiSuggestPrice = async ({ category, location_city, budget, scheduled_time }) => {
  try {
    // ── Step 1: query comparable completed tasks ─────────────────────────────
    const res = await query(
      `SELECT
         PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY budget) AS p50,
         PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY budget) AS p25,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY budget) AS p75,
         PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY budget) AS p10,
         PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY budget) AS p90,
         COUNT(*)                                              AS sample_size,
         STDDEV(budget)                                        AS std_dev
       FROM tasks
       WHERE category = $1
         AND (location_city ILIKE $2 OR $2 IS NULL)
         AND status IN ('completed', 'in_progress')
         AND created_at > NOW() - INTERVAL '180 days'`,
      [category, location_city || null]
    );

    const row = res.rows[0];
    const n   = parseInt(row.sample_size ?? 0);

    // ── Step 2: get demand multiplier ────────────────────────────────────────
    const demandFactor = await getDemandMultiplier(category, scheduled_time);

    // ── Step 3: handle insufficient data ────────────────────────────────────
    if (n < 3 || !row.p50) {
      const fallbackBudget = parseFloat(budget ?? 100);
      return {
        suggested:     parseFloat((fallbackBudget * demandFactor).toFixed(2)),
        min:           parseFloat((fallbackBudget * 0.75).toFixed(2)),
        max:           parseFloat((fallbackBudget * 1.40).toFixed(2)),
        market_median: null,
        demand_factor: demandFactor,
        confidence:    'low',
        sample_size:   n,
        elasticity:    'unknown',
        note:          n === 0
          ? 'No comparable tasks found. Using your budget as the baseline.'
          : `Only ${n} comparable task${n === 1 ? '' : 's'} found — estimate may not be accurate.`,
      };
    }

    // ── Step 4: build suggestion ─────────────────────────────────────────────
    const p50      = parseFloat(row.p50);
    const p25      = parseFloat(row.p25);
    const p75      = parseFloat(row.p75);
    const p10      = parseFloat(row.p10);
    const p90      = parseFloat(row.p90);
    const stdDev   = parseFloat(row.std_dev ?? 0);
    const budget_f = parseFloat(budget ?? p50);

    const suggested = parseFloat((p50 * demandFactor).toFixed(2));
    const min       = parseFloat((p25 * demandFactor).toFixed(2));
    const max       = parseFloat((p75 * demandFactor).toFixed(2));

    // Confidence based on sample size and spread (coefficient of variation)
    const cv = stdDev / p50;  // coefficient of variation
    const confidence =
      n >= 30 && cv < 0.35 ? 'high'
      : n >= 10             ? 'medium'
      : 'low';

    // Elasticity: where does the user's budget sit relative to market?
    const elasticity =
      budget_f < p10 ? 'below_market'
      : budget_f > p90 ? 'above_market'
      : 'fair';

    // Human note
    const demandNote = demandFactor > 1.05
      ? ` (includes ${((demandFactor - 1) * 100).toFixed(0)}% demand surge for this time)`
      : demandFactor < 0.95
      ? ` (includes ${((1 - demandFactor) * 100).toFixed(0)}% off-peak discount)`
      : '';

    const elasticityNote =
      elasticity === 'below_market' ? ' Your budget is below typical market rates — you may attract fewer taskers.'
      : elasticity === 'above_market' ? ' Your budget is above market — you should attract strong interest.'
      : '';

    return {
      suggested,
      min,
      max,
      market_median: p50,
      demand_factor: demandFactor,
      confidence,
      sample_size:   n,
      elasticity,
      note: `Based on ${n} recent ${category} tasks in ${location_city ?? 'Namibia'}${demandNote}.${elasticityNote}`,
    };
  } catch (err) {
    logger.error('aiSuggestPrice error', err.message);
    return {
      suggested:     parseFloat(budget ?? 0),
      min:           null,
      max:           null,
      market_median: null,
      demand_factor: 1.0,
      confidence:    'unavailable',
      sample_size:   0,
      elasticity:    'unknown',
      note:          'Price suggestion temporarily unavailable.',
    };
  }
};

module.exports = { aiSuggestPrice, getDemandMultiplier };
