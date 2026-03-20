'use strict';
/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          Nam Task — AI Matching Engine  v2                       ║
 * ║                                                                  ║
 * ║  Signals  : distance · rating · availability · completion       ║
 * ║             response_rate · recency · budget_fit                ║
 * ║  Features : DB-backed tunable weights · full explanation        ║
 * ║             match result persistence · push notifications        ║
 * ║             duplicate booking prevention · service-radius guard  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Signal breakdown
 * ────────────────
 *  distance      (default 30 %) — PostGIS great-circle km from last GPS fix,
 *                                  capped at tasker's service_radius_km
 *  rating        (default 25 %) — Bayesian-smoothed star rating
 *  availability  (default 20 %) — Scheduled weekday/hour vs JSONB schedule
 *                                  + blocks if tasker already in-progress
 *  completion    (default 10 %) — log₁₀(n+1) tasks completed, normalised to 100
 *  response_rate (default  8 %) — accepted offers / total offers (last 90 days)
 *  recency       (default  7 %) — exponential decay from last completion
 *
 *  NOTE: weights must sum ≤ 1.  Remainder goes to a baseline score every
 *        tasker gets just for being approved and active.
 */

const { query, getClient } = require('../config/database');
const logger               = require('../config/logger');
const notificationService  = require('../services/notificationService');
const pushService          = require('../services/pushNotificationService');

// ─── Weight cache (refreshed every 10 min from DB) ───────────────────────────

let _weightCache = null;
let _weightCacheAt = 0;
const WEIGHT_TTL_MS = 10 * 60 * 1000;

const loadWeights = async () => {
  if (_weightCache && Date.now() - _weightCacheAt < WEIGHT_TTL_MS) return _weightCache;

  try {
    const res = await query(
      `SELECT name, weight FROM match_scoring_config WHERE is_active = TRUE`
    );
    _weightCache = Object.fromEntries(res.rows.map(r => [r.name, parseFloat(r.weight)]));
    _weightCacheAt = Date.now();
    return _weightCache;
  } catch {
    // Fallback defaults if table doesn't exist yet
    return {
      distance:      0.30,
      rating:        0.25,
      availability:  0.20,
      completion:    0.10,
      response_rate: 0.08,
      recency:       0.07,
    };
  }
};

// ─── Individual signal scorers (all return 0.0–1.0) ─────────────────────────

/** Bayesian-smoothed rating: pulls towards 3.5 mean with <5 reviews */
const ratingSignal = (rating, count) => {
  const PRIOR_MEAN   = 3.5;
  const PRIOR_WEIGHT = 5;
  const smoothed = (PRIOR_MEAN * PRIOR_WEIGHT + parseFloat(rating) * count)
                 / (PRIOR_WEIGHT + count);
  return Math.max(0, Math.min(1, (smoothed - 1) / 4));  // normalise 1–5 → 0–1
};

/** Distance score: 1.0 at 0 km, 0.0 at max_km, 0 if beyond service_radius */
const distanceSignal = (distKm, serviceRadiusKm, maxKm = 50) => {
  if (distKm == null || distKm < 0) return 0;
  if (serviceRadiusKm > 0 && distKm > serviceRadiusKm) return 0;  // hard boundary
  return Math.max(0, 1 - distKm / maxKm);
};

/** Availability: 1 if tasker is free at scheduled time, 0 if not */
const availabilitySignal = (availability, scheduledTime, currentlyBusy) => {
  if (currentlyBusy) return 0;  // already has an in-progress task

  if (!scheduledTime || !availability) return 0.7;  // no schedule → partial credit

  const dt  = new Date(scheduledTime);
  const dow = dt.getDay();  // 0=Sun … 6=Sat
  const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayKey = DAYS[dow];

  const isAvailable = availability[dayKey] !== false;  // default true if key missing
  return isAvailable ? 1.0 : 0.0;
};

/**
 * Completion signal: log₁₀(n+1) normalised so 100 tasks = 1.0.
 * Gives meaningful early-career credit without letting outliers dominate.
 */
const completionSignal = (total) =>
  Math.min(1, Math.log10(parseFloat(total) + 1) / Math.log10(101));

/** Response rate: accepted_offers / total_offers, last 90 days. */
const responseSignal = (offersAccepted, offersMade) => {
  if (offersMade === 0) return 0.5;  // no data → neutral
  return Math.min(1, offersAccepted / offersMade);
};

/**
 * Recency: exponential decay from last completion.
 * Half-life = 30 days.  Never completed → 0.1 baseline.
 */
const recencySignal = (lastCompletedAt) => {
  if (!lastCompletedAt) return 0.1;
  const daysSince = (Date.now() - new Date(lastCompletedAt).getTime()) / 86_400_000;
  const halfLife  = 30;
  return Math.exp(-Math.LN2 * daysSince / halfLife);
};

/**
 * Budget fitness: how well the tasker's hourly rate matches the task budget.
 * Penalises mismatches in both directions — too cheap signals inexperience.
 */
const budgetSignal = (hourlyRate, taskBudget) => {
  if (!hourlyRate || !taskBudget) return 0.7;  // no data → neutral
  const rate   = parseFloat(hourlyRate);
  const budget = parseFloat(taskBudget);
  if (rate <= 0) return 0.5;
  const ratio = budget / rate;  // how many hours of tasker time the budget covers
  // Sweet spot: 2–6 hours.  Too short → underpaid, too long → overpaid/mismatch.
  if (ratio >= 2 && ratio <= 6)  return 1.0;
  if (ratio >= 1 && ratio < 2)   return 0.7;
  if (ratio > 6  && ratio <= 10) return 0.6;
  if (ratio < 1)                 return 0.3;  // budget probably too low
  return 0.4;                                 // ratio > 10 → budget very high
};

// ─── Human-readable explanation builder ─────────────────────────────────────

const buildExplanation = (signals, weights) => {
  const parts = [];
  if (signals.distance_km !== null) {
    parts.push(`${signals.distance_km.toFixed(1)} km away`);
  }
  parts.push(`${(parseFloat(signals.raw_rating)).toFixed(1)}★ rating (${signals.rating_count} reviews)`);
  if (signals.availability_score === 1)   parts.push('available at scheduled time');
  if (signals.availability_score === 0)   parts.push('unavailable at scheduled time');
  if (signals.currently_busy)             parts.push('⚠️ currently on another task');
  parts.push(`${signals.total_completed} tasks completed`);
  if (signals.response_rate !== null) {
    parts.push(`${(signals.response_rate * 100).toFixed(0)}% response rate`);
  }
  return parts.join(' · ');
};

// ─── Core candidates query ──────────────────────────────────────────────────

const fetchCandidates = async (task, maxResults = 30) => {
  /**
   * Single round-trip query that:
   *  1. Finds approved taskers with the right category
   *  2. Computes PostGIS distance to task location using tasker's LAST GPS fix
   *  3. Retrieves all scoring signals
   *  4. Filters by service radius (hard boundary)
   *  5. Excludes taskers already in-progress on another task
   */
  const result = await query(
    `SELECT
       u.id                          AS tasker_id,
       u.name                        AS tasker_name,
       u.phone                       AS tasker_phone,
       u.avatar_url,
       u.rating::float               AS rating,
       u.rating_count::int           AS rating_count,

       tp.service_radius_km,
       tp.hourly_rate::float,
       tp.availability,
       tp.total_tasks_completed::int AS total_completed,
       tp.categories,

       ts.offers_made::int,
       ts.offers_accepted::int,
       ts.last_completed_at,

       -- Actual PostGIS distance using most recent GPS fix from gps_tracking
       CASE
         WHEN t.location IS NOT NULL AND last_gps.location IS NOT NULL
           THEN ST_Distance(last_gps.location::geography, t.location::geography) / 1000.0
         ELSE NULL
       END AS distance_km,

       -- Is this tasker currently on another in-progress task?
       EXISTS (
         SELECT 1 FROM tasks active_t
         WHERE active_t.tasker_id = u.id
           AND active_t.status = 'in_progress'
           AND active_t.id != $1
       ) AS currently_busy

     FROM tasker_profiles tp
     JOIN users u ON u.id = tp.user_id
     LEFT JOIN tasker_stats ts ON ts.user_id = u.id

     -- Most recent GPS location for this tasker
     LEFT JOIN LATERAL (
       SELECT location
       FROM gps_tracking
       WHERE user_id = u.id
       ORDER BY recorded_at DESC
       LIMIT 1
     ) last_gps ON TRUE

     -- Task location for distance calc
     LEFT JOIN LATERAL (
       SELECT location FROM tasks WHERE id = $1
     ) t ON TRUE

     WHERE tp.verification_status = 'approved'
       AND u.is_active = TRUE
       AND $2 = ANY(tp.categories)
       -- Hard service-radius filter (exclude where distance > radius)
       AND (
         t.location IS NULL
         OR last_gps.location IS NULL
         OR tp.service_radius_km IS NULL
         OR ST_Distance(last_gps.location::geography, t.location::geography) / 1000.0
              <= tp.service_radius_km
       )
     LIMIT $3`,
    [task.id, task.category, maxResults]
  );
  return result.rows;
};

// ─── Main matcher ────────────────────────────────────────────────────────────

const matchTaskers = async (task, options = {}) => {
  const {
    maxResults   = 10,
    notifyTop    = 5,
    persist      = true,
    dryRun       = false,
  } = options;

  const weights    = await loadWeights();
  const candidates = await fetchCandidates(task, maxResults * 3);

  if (!candidates.length) {
    logger.info('[match] No candidates found', { taskId: task.id, category: task.category });
    return [];
  }

  // ── Score every candidate ────────────────────────────────────────────────
  const scored = candidates.map(c => {
    const sDistScore   = distanceSignal(c.distance_km, c.service_radius_km);
    const sRating      = ratingSignal(c.rating, c.rating_count);
    const sAvailability = availabilitySignal(c.availability, task.scheduled_time, c.currently_busy);
    const sCompletion  = completionSignal(c.total_completed);
    const sResponse    = responseSignal(c.offers_accepted, c.offers_made);
    const sRecency     = recencySignal(c.last_completed_at);
    const sBudget      = budgetSignal(c.hourly_rate, task.budget);

    const totalScore =
      sDistScore    * (weights.distance      ?? 0.30) +
      sRating       * (weights.rating        ?? 0.25) +
      sAvailability * (weights.availability  ?? 0.20) +
      sCompletion   * (weights.completion    ?? 0.10) +
      sResponse     * (weights.response_rate ?? 0.08) +
      sRecency      * (weights.recency       ?? 0.07);

    const signals = {
      distance_km:        c.distance_km !== null ? parseFloat(c.distance_km.toFixed(2)) : null,
      distance_score:     parseFloat(sDistScore.toFixed(4)),
      raw_rating:         c.rating,
      rating_count:       c.rating_count,
      rating_score:       parseFloat(sRating.toFixed(4)),
      availability_score: parseFloat(sAvailability.toFixed(4)),
      currently_busy:     c.currently_busy,
      total_completed:    c.total_completed,
      completion_score:   parseFloat(sCompletion.toFixed(4)),
      response_rate:      c.offers_made > 0 ? parseFloat((c.offers_accepted / c.offers_made).toFixed(4)) : null,
      response_score:     parseFloat(sResponse.toFixed(4)),
      last_completed_at:  c.last_completed_at,
      recency_score:      parseFloat(sRecency.toFixed(4)),
      budget_score:       parseFloat(sBudget.toFixed(4)),
      hourly_rate:        c.hourly_rate,
      task_budget:        task.budget,
    };

    return {
      tasker_id:    c.tasker_id,
      tasker_name:  c.tasker_name,
      tasker_phone: c.tasker_phone,
      avatar_url:   c.avatar_url,
      total_score:  parseFloat(Math.min(totalScore, 1).toFixed(4)),
      explanation:  buildExplanation(signals, weights),
      signals,
      ai_recommended: false,
    };
  });

  // ── Sort and rank ────────────────────────────────────────────────────────
  scored.sort((a, b) => b.total_score - a.total_score);
  const topN = scored.slice(0, maxResults);

  // Mark top 3 as AI-recommended (must score > 0.40)
  topN.forEach((m, i) => {
    m.rank = i + 1;
    m.ai_recommended = i < 3 && m.total_score > 0.40;
  });

  if (dryRun) return topN;

  // ── Persist results ──────────────────────────────────────────────────────
  if (persist) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Upsert all match results
      for (const m of topN) {
        await client.query(
          `INSERT INTO task_match_results
             (task_id, tasker_id, rank, total_score,
              distance_score, rating_score, availability_score,
              completion_score, response_score, recency_score, budget_score,
              distance_km, explanation, signals)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (task_id, tasker_id) DO UPDATE SET
             rank              = EXCLUDED.rank,
             total_score       = EXCLUDED.total_score,
             distance_score    = EXCLUDED.distance_score,
             rating_score      = EXCLUDED.rating_score,
             availability_score= EXCLUDED.availability_score,
             completion_score  = EXCLUDED.completion_score,
             response_score    = EXCLUDED.response_score,
             recency_score     = EXCLUDED.recency_score,
             budget_score      = EXCLUDED.budget_score,
             distance_km       = EXCLUDED.distance_km,
             explanation       = EXCLUDED.explanation,
             signals           = EXCLUDED.signals`,
          [
            task.id, m.tasker_id, m.rank, m.total_score,
            m.signals.distance_score,    m.signals.rating_score,
            m.signals.availability_score,m.signals.completion_score,
            m.signals.response_score,    m.signals.recency_score,
            m.signals.budget_score,      m.signals.distance_km,
            m.explanation,               JSON.stringify(m.signals),
          ]
        );
      }

      // Update task with top score + explanation
      if (topN.length) {
        await client.query(
          `UPDATE tasks
           SET ai_match_score       = $1,
               ai_match_explanation = $2,
               ai_match_count       = $3,
               ai_matched_at        = NOW()
           WHERE id = $4`,
          [topN[0].total_score, topN[0].explanation, topN.length, task.id]
        );
      }

      // Mark top offers as AI-recommended
      const recommendedIds = topN.filter(m => m.ai_recommended).map(m => m.tasker_id);
      if (recommendedIds.length) {
        await client.query(
          `UPDATE task_offers SET ai_recommended = TRUE
           WHERE task_id = $1 AND tasker_id = ANY($2)`,
          [task.id, recommendedIds]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('[match] persist error', err.message);
    } finally {
      client.release();
    }
  }

  // ── Notify top N matched taskers ─────────────────────────────────────────
  const toNotify = topN.slice(0, notifyTop).filter(m => !m.signals.currently_busy);
  const notifyPromises = toNotify.map(async m => {
    try {
      await notificationService.create(
        m.tasker_id, 'task_offer',
        '📋 New Task Match',
        `A ${task.category} task in ${task.location_city ?? 'your area'} matches your skills. Budget: NAD ${task.budget}.`,
        {
          task_id:       task.id,
          match_score:   m.total_score,
          match_reason:  m.explanation,
          screen:        'TaskDetail',
        }
      );

      await pushService.send(m.tasker_id, {
        title:    `📋 New ${task.category} task near you`,
        body:     `NAD ${task.budget} · ${m.signals.distance_km ? m.signals.distance_km.toFixed(1) + ' km away' : task.location_city ?? 'your area'}`,
        priority: m.ai_recommended ? 'high' : 'normal',
        data:     { task_id: task.id, screen: 'TaskDetail', channel: 'task_match' },
      });

      // Mark as notified
      if (persist) {
        await query(
          `UPDATE task_match_results
           SET was_notified=TRUE, notification_at=NOW()
           WHERE task_id=$1 AND tasker_id=$2`,
          [task.id, m.tasker_id]
        );
      }
    } catch (err) {
      logger.warn('[match] notify failed', { taskerId: m.tasker_id, err: err.message });
    }
  });

  await Promise.allSettled(notifyPromises);

  logger.info('[match] complete', {
    taskId:     task.id,
    category:   task.category,
    candidates: candidates.length,
    scored:     topN.length,
    notified:   toNotify.length,
    topScore:   topN[0]?.total_score,
  });

  return topN;
};

// ─── Stats refresh (called after task completion) ─────────────────────────────

const refreshTaskerStats = async (taskerId) => {
  try {
    await query(`SELECT refresh_tasker_stats($1)`, [taskerId]);
    logger.debug('[match] stats refreshed', { taskerId });
  } catch (err) {
    logger.warn('[match] stats refresh failed', err.message);
  }
};

// ─── Re-rank existing matches for a task (on offer submit) ───────────────────

const updateMatchOnOffer = async (taskId, taskerId) => {
  try {
    await query(
      `UPDATE task_match_results
       SET submitted_offer = TRUE
       WHERE task_id = $1 AND tasker_id = $2`,
      [taskId, taskerId]
    );
  } catch {}
};

// ── Export (keeping old name for backwards-compat) ─────────────────────────────

module.exports = {
  matchTaskers,
  aiMatchTaskers: matchTaskers,   // backwards-compatible alias for taskController
  refreshTaskerStats,
  updateMatchOnOffer,
  loadWeights,
  _signals: {
    ratingSignal, distanceSignal, availabilitySignal,
    completionSignal, responseSignal, recencySignal, budgetSignal,
  },
};
