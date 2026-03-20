-- ============================================================
-- Nam Task — Payment System Schema v2
-- Run: node scripts/migrate_payments.js
-- ============================================================

-- ── Extend payment_requests with payout support ─────────────────────────────

ALTER TABLE payment_requests
  ADD COLUMN IF NOT EXISTS direction           VARCHAR(10)  NOT NULL DEFAULT 'deposit'  CHECK (direction IN ('deposit','withdrawal')),
  ADD COLUMN IF NOT EXISTS withdrawal_method   VARCHAR(30)                               CHECK (withdrawal_method IN ('fnb_ewallet','bank_windhoek','bank_transfer')),
  ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS bank_account_name   VARCHAR(150),
  ADD COLUMN IF NOT EXISTS bank_branch_code    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS idempotency_key     VARCHAR(200) UNIQUE,
  ADD COLUMN IF NOT EXISTS failure_code        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS failure_message     TEXT,
  ADD COLUMN IF NOT EXISTS retry_count         INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_polled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at          TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_requests_direction ON payment_requests(direction, status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_expires   ON payment_requests(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payment_requests_idem      ON payment_requests(idempotency_key);

-- ── Extend escrow_transactions ────────────────────────────────────────────────

ALTER TABLE escrow_transactions
  ADD COLUMN IF NOT EXISTS dispute_id              UUID REFERENCES disputes(id),
  ADD COLUMN IF NOT EXISTS partial_release_amount  DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS platform_fee            DECIMAL(12,2) GENERATED ALWAYS AS (commission) STORED,
  ADD COLUMN IF NOT EXISTS refund_reason           TEXT,
  ADD COLUMN IF NOT EXISTS refund_reference        VARCHAR(200);

-- ── Withdrawal requests table (separate from deposits) ────────────────────────

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID         NOT NULL REFERENCES users(id),
  wallet_id            UUID         NOT NULL REFERENCES wallets(id),
  amount               DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  fee                  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  net_amount           DECIMAL(12,2) GENERATED ALWAYS AS (amount - fee) STORED,
  provider             VARCHAR(30)  NOT NULL CHECK (provider IN ('fnb_ewallet','bank_windhoek','bank_transfer')),
  recipient_phone      VARCHAR(20),
  recipient_account    VARCHAR(50),
  recipient_name       VARCHAR(150),
  branch_code          VARCHAR(20),
  reference            VARCHAR(100) UNIQUE NOT NULL,
  provider_reference   VARCHAR(200),
  status               VARCHAR(30)  NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  failure_reason       TEXT,
  provider_response    JSONB,
  requested_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  processed_at         TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  idempotency_key      VARCHAR(200) UNIQUE,
  CONSTRAINT withdrawal_amount_check CHECK (amount >= 10)
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_user    ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_status  ON withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_ref     ON withdrawal_requests(reference);

-- ── Daily withdrawal tracking ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS withdrawal_limits (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID         NOT NULL REFERENCES users(id),
  date         DATE         NOT NULL DEFAULT CURRENT_DATE,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  count        INTEGER      NOT NULL DEFAULT 0,
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_limits_user_date ON withdrawal_limits(user_id, date);

-- ── Webhook events log (dead-letter + replay) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS webhook_events (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider        VARCHAR(50)  NOT NULL,
  event_type      VARCHAR(100),
  payload         JSONB        NOT NULL,
  raw_body        TEXT,
  signature       TEXT,
  status          VARCHAR(20)  NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received','processed','failed','ignored')),
  processed_at    TIMESTAMPTZ,
  error           TEXT,
  retry_count     INTEGER      NOT NULL DEFAULT 0,
  reference       VARCHAR(200),
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider  ON webhook_events(provider, status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_reference ON webhook_events(reference);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received  ON webhook_events(received_at DESC);

-- ── Mock simulation table (dev/staging only) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS mock_payment_controls (
  reference          VARCHAR(100) PRIMARY KEY REFERENCES payment_requests(reference),
  simulate_status    VARCHAR(30)  NOT NULL DEFAULT 'completed'
                       CHECK (simulate_status IN ('completed','failed','cancelled')),
  trigger_after_secs INTEGER      NOT NULL DEFAULT 5,
  triggered          BOOLEAN      NOT NULL DEFAULT FALSE,
  triggered_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Commission config table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commission_config (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  category        VARCHAR(100),              -- NULL = applies to all
  min_amount      DECIMAL(12,2),
  max_amount      DECIMAL(12,2),
  rate            DECIMAL(5,4)  NOT NULL,    -- e.g. 0.1000 = 10%
  flat_fee        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  effective_from  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  effective_to    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Default commission: 10% across all categories
INSERT INTO commission_config (rate, flat_fee, category)
VALUES (0.10, 0.00, NULL)
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_commission_active ON commission_config(is_active, category);
