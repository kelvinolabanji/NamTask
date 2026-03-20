-- Mobile Money additions to schema.sql
-- Run after main schema

CREATE TABLE IF NOT EXISTS payment_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  reference VARCHAR(100) UNIQUE NOT NULL,
  provider VARCHAR(50) NOT NULL,           -- 'fnb_ewallet' | 'bank_windhoek'
  provider_reference VARCHAR(200),
  amount DECIMAL(12,2) NOT NULL,
  phone VARCHAR(20),
  status VARCHAR(30) DEFAULT 'pending',    -- pending | completed | failed | refunded | cancelled
  checkout_url VARCHAR(500),
  provider_response JSONB,
  error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_user     ON payment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_ref      ON payment_requests(reference);
CREATE INDEX IF NOT EXISTS idx_payment_requests_provider ON payment_requests(provider, status);

-- Push notification device tokens
CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(500) NOT NULL,
  platform VARCHAR(20) DEFAULT 'expo',     -- expo | apns | fcm
  app_version VARCHAR(20),
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user   ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_active ON device_tokens(user_id, is_active);

-- Push notification log (for retry tracking and analytics)
CREATE TABLE IF NOT EXISTS push_notification_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  token VARCHAR(500),
  title VARCHAR(200),
  body TEXT,
  data JSONB DEFAULT '{}',
  status VARCHAR(30) DEFAULT 'sent',       -- sent | delivered | failed | invalid_token
  expo_receipt_id VARCHAR(200),
  error TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_log_user   ON push_notification_log(user_id);
CREATE INDEX IF NOT EXISTS idx_push_log_status ON push_notification_log(status);
