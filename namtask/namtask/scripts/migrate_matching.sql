-- ══════════════════════════════════════════════════════════════════════════════
-- Nam Task — AI Matching Schema
-- Run: node scripts/migrate_matching.js
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Store every match run with full signal breakdown ─────────────────────────
CREATE TABLE IF NOT EXISTS task_match_results (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id          UUID          NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tasker_id        UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank             SMALLINT      NOT NULL,            -- 1 = best match
  total_score      DECIMAL(6,4)  NOT NULL,
  -- Individual signal scores (all 0.0–1.0)
  distance_score   DECIMAL(6,4),
  rating_score     DECIMAL(6,4),
  availability_score DECIMAL(6,4),
  completion_score DECIMAL(6,4),
  response_score   DECIMAL(6,4),
  recency_score    DECIMAL(6,4),
  budget_score     DECIMAL(6,4),
  -- Explainability
  distance_km      DECIMAL(8,2),
  explanation      TEXT,                              -- human-readable reason
  signals          JSONB         NOT NULL DEFAULT '{}', -- full raw signals
  -- Metadata
  was_notified     BOOLEAN       NOT NULL DEFAULT FALSE,
  notification_at  TIMESTAMPTZ,
  submitted_offer  BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, tasker_id)
);

CREATE INDEX IF NOT EXISTS idx_match_results_task
  ON task_match_results(task_id, rank);
CREATE INDEX IF NOT EXISTS idx_match_results_tasker
  ON task_match_results(tasker_id, created_at DESC);

-- ── Scoring weights config (tunable without code deploy) ─────────────────────
CREATE TABLE IF NOT EXISTS match_scoring_config (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL UNIQUE,
  weight      DECIMAL(5,4) NOT NULL CHECK (weight BETWEEN 0 AND 1),
  description TEXT,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO match_scoring_config (name, weight, description) VALUES
  ('distance',      0.30, 'Distance from task location (inverted — closer is better)'),
  ('rating',        0.25, 'User average rating (0–5 normalised to 0–1)'),
  ('availability',  0.20, 'Scheduled-time vs tasker availability + active task check'),
  ('completion',    0.10, 'Historical task completion count (log-scaled)'),
  ('response_rate', 0.08, 'Offer acceptance rate (offers accepted / offers made)'),
  ('recency',       0.07, 'Recency of last completed task (time-decayed)')
ON CONFLICT (name) DO NOTHING;

-- ── Extend tasks with match explanation ──────────────────────────────────────
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS ai_match_explanation TEXT,
  ADD COLUMN IF NOT EXISTS ai_match_count       SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_matched_at        TIMESTAMPTZ;

-- ── Materialised stats per tasker (refreshed after each completed task) ──────
CREATE TABLE IF NOT EXISTS tasker_stats (
  user_id            UUID          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Response rate
  offers_made        INTEGER       NOT NULL DEFAULT 0,
  offers_accepted    INTEGER       NOT NULL DEFAULT 0,
  response_rate      DECIMAL(5,4)  GENERATED ALWAYS AS (
                       CASE WHEN offers_made = 0 THEN 0
                            ELSE offers_accepted::decimal / offers_made END
                     ) STORED,
  -- Recency
  last_completed_at  TIMESTAMPTZ,
  days_since_active  INTEGER       GENERATED ALWAYS AS (
                       EXTRACT(DAY FROM NOW() - last_completed_at)::integer
                     ) STORED,
  -- Demand satisfaction
  avg_response_hours DECIMAL(6,2),  -- avg hours between offer and acceptance
  -- Computed at refresh time
  refreshed_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Populate initial rows for all taskers
INSERT INTO tasker_stats (user_id)
SELECT user_id FROM tasker_profiles
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_tasker_stats_response ON tasker_stats(response_rate DESC);
CREATE INDEX IF NOT EXISTS idx_tasker_stats_recency  ON tasker_stats(last_completed_at DESC NULLS LAST);

-- ── Pricing demand table (time-of-week demand multipliers) ───────────────────
CREATE TABLE IF NOT EXISTS pricing_demand (
  id         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  category   VARCHAR(100),                   -- NULL = all categories
  dow        SMALLINT     CHECK (dow BETWEEN 0 AND 6),  -- 0=Sun, 6=Sat; NULL=all days
  hour_start SMALLINT     CHECK (hour_start BETWEEN 0 AND 23),
  hour_end   SMALLINT     CHECK (hour_end   BETWEEN 0 AND 23),
  multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  label      VARCHAR(80),
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

-- Namibia-specific demand data
INSERT INTO pricing_demand (category, dow, hour_start, hour_end, multiplier, label) VALUES
  (NULL,        1, 7,  9,  1.15, 'Monday morning rush'),
  (NULL,        5, 14, 18, 1.20, 'Friday afternoon peak'),
  ('cleaning',  0, 8,  12, 1.25, 'Sunday morning cleaning surge'),
  ('delivery',  5, 17, 20, 1.30, 'Friday evening delivery peak'),
  ('delivery',  6, 10, 14, 1.20, 'Saturday lunch delivery'),
  ('moving',    5, 8,  14, 1.20, 'Friday moving day'),
  ('moving',    6, 8,  14, 1.25, 'Saturday moving day'),
  (NULL,        NULL, 22, 6, 0.80, 'Late-night discount')
ON CONFLICT DO NOTHING;

-- ── Function: refresh a single tasker's stats ─────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_tasker_stats(p_user_id UUID)
RETURNS void AS $$
DECLARE
  v_offers_made     INTEGER;
  v_offers_accepted INTEGER;
  v_last_completed  TIMESTAMPTZ;
  v_avg_resp_hrs    DECIMAL;
BEGIN
  SELECT COUNT(*) INTO v_offers_made
  FROM task_offers WHERE tasker_id = p_user_id;

  SELECT COUNT(*) INTO v_offers_accepted
  FROM task_offers WHERE tasker_id = p_user_id AND status = 'accepted';

  SELECT MAX(completed_at) INTO v_last_completed
  FROM tasks WHERE tasker_id = p_user_id AND status = 'completed';

  SELECT AVG(EXTRACT(EPOCH FROM (to2.updated_at - to2.created_at)) / 3600)
  INTO v_avg_resp_hrs
  FROM task_offers to2
  WHERE to2.tasker_id = p_user_id AND to2.status = 'accepted';

  INSERT INTO tasker_stats
    (user_id, offers_made, offers_accepted, last_completed_at, avg_response_hours, refreshed_at)
  VALUES
    (p_user_id, v_offers_made, v_offers_accepted, v_last_completed, v_avg_resp_hrs, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    offers_made        = EXCLUDED.offers_made,
    offers_accepted    = EXCLUDED.offers_accepted,
    last_completed_at  = EXCLUDED.last_completed_at,
    avg_response_hours = EXCLUDED.avg_response_hours,
    refreshed_at       = NOW();
END;
$$ LANGUAGE plpgsql;
