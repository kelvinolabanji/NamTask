-- ══════════════════════════════════════════════════════════════════════════════
-- Nam Task — Safety System Schema v2
-- Run: node scripts/migrate_safety.js
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Extend safety_logs with escalation + resolution tracking ─────────────────
ALTER TABLE safety_logs
  ADD COLUMN IF NOT EXISTS resolved_by        UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS escalation_level   SMALLINT NOT NULL DEFAULT 1
                             CHECK (escalation_level BETWEEN 1 AND 3),
  ADD COLUMN IF NOT EXISTS escalated_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by    UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS emergency_contact_notified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS emergency_services_notified BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_safety_logs_unresolved
  ON safety_logs(event_type, is_resolved, created_at DESC)
  WHERE is_resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_safety_logs_escalation
  ON safety_logs(escalation_level, is_resolved)
  WHERE is_resolved = FALSE;

-- ── Emergency contacts ────────────────────────────────────────────────────────
-- Each user can store up to 3 emergency contacts
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(150) NOT NULL,
  phone        VARCHAR(30)  NOT NULL,
  relationship VARCHAR(80),           -- 'partner', 'parent', 'friend', etc.
  is_primary   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT max_contacts_per_user UNIQUE (user_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user
  ON emergency_contacts(user_id);

-- Ensure at most one primary contact per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_contacts_primary
  ON emergency_contacts(user_id)
  WHERE is_primary = TRUE;

-- ── Safety sessions (timed check-in windows) ─────────────────────────────────
-- A session is opened when a task moves to 'in_progress'.
-- The tasker must check in every `interval_minutes` minutes.
-- If they miss a check-in, the system auto-escalates.
CREATE TABLE IF NOT EXISTS safety_sessions (
  id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id              UUID         NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id              UUID         NOT NULL REFERENCES users(id),  -- usually the tasker
  status               VARCHAR(20)  NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','paused','completed','escalated','cancelled')),
  interval_minutes     SMALLINT     NOT NULL DEFAULT 30,  -- check-in frequency
  last_checkin_at      TIMESTAMPTZ,
  next_checkin_due     TIMESTAMPTZ,
  missed_checkins      SMALLINT     NOT NULL DEFAULT 0,
  total_checkins       SMALLINT     NOT NULL DEFAULT 0,
  started_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at             TIMESTAMPTZ,
  auto_sos_triggered   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_safety_sessions_active
  ON safety_sessions(status, next_checkin_due)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_safety_sessions_user
  ON safety_sessions(user_id, status);

-- ── GPS tracking enhancements ─────────────────────────────────────────────────
-- Add speed + heading for route replay
ALTER TABLE gps_tracking
  ADD COLUMN IF NOT EXISTS speed    DECIMAL(6,2),    -- m/s
  ADD COLUMN IF NOT EXISTS heading  DECIMAL(5,2),    -- degrees 0-360
  ADD COLUMN IF NOT EXISTS altitude DECIMAL(8,2),    -- metres
  ADD COLUMN IF NOT EXISTS is_sos_point BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_gps_task_time
  ON gps_tracking(task_id, recorded_at DESC);

-- ── Geofences (task location safety zones) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_geofences (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id     UUID         NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  center      GEOMETRY(POINT, 4326) NOT NULL,
  radius_m    INTEGER      NOT NULL DEFAULT 500,  -- alert if tasker exits this radius
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_geofences_active
  ON task_geofences(task_id) WHERE is_active = TRUE;

-- ── Notification type extension ───────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'safety_checkin'
      AND enumtypid = 'notification_type'::regtype
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'safety_checkin';
    ALTER TYPE notification_type ADD VALUE 'safety_missed';
    ALTER TYPE notification_type ADD VALUE 'safety_session';
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ── View: active safety snapshot ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_active_safety AS
SELECT
  ss.id            AS session_id,
  ss.task_id,
  ss.user_id,
  ss.status        AS session_status,
  ss.interval_minutes,
  ss.last_checkin_at,
  ss.next_checkin_due,
  ss.missed_checkins,
  ss.total_checkins,
  t.title          AS task_title,
  t.status         AS task_status,
  t.location_city,
  u.name           AS user_name,
  u.phone          AS user_phone,
  u.role           AS user_role,
  EXTRACT(EPOCH FROM (ss.next_checkin_due - NOW())) AS seconds_until_due,
  CASE
    WHEN ss.next_checkin_due < NOW() THEN 'overdue'
    WHEN ss.next_checkin_due < NOW() + INTERVAL '5 minutes' THEN 'due_soon'
    ELSE 'ok'
  END AS checkin_urgency,
  -- Latest GPS position
  ST_X(g.location::geometry) AS last_lng,
  ST_Y(g.location::geometry) AS last_lat,
  g.recorded_at    AS last_gps_at
FROM safety_sessions ss
JOIN tasks t ON t.id = ss.task_id
JOIN users u ON u.id = ss.user_id
LEFT JOIN LATERAL (
  SELECT location, recorded_at
  FROM gps_tracking
  WHERE task_id = ss.task_id AND user_id = ss.user_id
  ORDER BY recorded_at DESC
  LIMIT 1
) g ON TRUE
WHERE ss.status = 'active';
