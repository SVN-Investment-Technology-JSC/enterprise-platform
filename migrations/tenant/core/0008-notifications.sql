SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS notification_schema;

CREATE TABLE IF NOT EXISTS notification_schema.user_state (
  user_id uuid PRIMARY KEY REFERENCES core_schema.users(id) ON DELETE CASCADE,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_schema.notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES core_schema.users(id) ON DELETE CASCADE,
  module varchar(80) NOT NULL,
  category varchar(120) NOT NULL,
  priority varchar(24) NOT NULL
    CHECK (priority IN ('required', 'actionable', 'informational')),
  title varchar(240) NOT NULL,
  body text NOT NULL,
  deep_link text CHECK (
    deep_link IS NULL OR (deep_link LIKE '/%' AND deep_link NOT LIKE '//%')
  ),
  source_type varchar(160) NOT NULL,
  source_id varchar(200) NOT NULL,
  aggregation_key varchar(240),
  aggregation_window_started_at timestamptz,
  aggregate_count integer NOT NULL DEFAULT 1 CHECK (aggregate_count > 0),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  sequence bigint NOT NULL CHECK (sequence > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  UNIQUE (user_id, source_type, source_id, category)
);

CREATE INDEX IF NOT EXISTS notifications_user_feed_idx
  ON notification_schema.notifications (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notification_schema.notifications (user_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_aggregation_idx
  ON notification_schema.notifications
    (user_id, aggregation_key, aggregation_window_started_at DESC)
  WHERE aggregation_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_expiry_idx
  ON notification_schema.notifications (expires_at);

CREATE TABLE IF NOT EXISTS notification_schema.preferences (
  user_id uuid NOT NULL REFERENCES core_schema.users(id) ON DELETE CASCADE,
  module varchar(80) NOT NULL,
  category varchar(120) NOT NULL,
  priority varchar(24) NOT NULL
    CHECK (priority IN ('required', 'actionable', 'informational')),
  feed_enabled boolean NOT NULL DEFAULT true,
  toast_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module, category),
  CHECK (priority <> 'required' OR (feed_enabled AND toast_enabled)),
  CHECK (priority <> 'actionable' OR feed_enabled)
);

CREATE TABLE IF NOT EXISTS notification_schema.notification_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES core_schema.users(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_name varchar(120) NOT NULL CHECK (
    event_name IN (
      'notification.created',
      'notification.updated',
      'notification.read',
      'notification.summary-updated'
    )
  ),
  event_version smallint NOT NULL DEFAULT 1 CHECK (event_version = 1),
  notification_id uuid REFERENCES notification_schema.notifications(id)
    ON DELETE SET NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  last_error text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  UNIQUE (user_id, sequence)
);

CREATE INDEX IF NOT EXISTS notification_events_pending_idx
  ON notification_schema.notification_events (occurred_at)
  WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS notification_events_sync_idx
  ON notification_schema.notification_events (user_id, sequence);
CREATE INDEX IF NOT EXISTS notification_events_expiry_idx
  ON notification_schema.notification_events (expires_at);

CREATE TABLE IF NOT EXISTS notification_schema.inbox_messages (
  consumer varchar(120) NOT NULL,
  event_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

CREATE TABLE IF NOT EXISTS notification_schema.schedule_emissions (
  schedule_key varchar(240) NOT NULL,
  user_id uuid NOT NULL REFERENCES core_schema.users(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  event_id uuid NOT NULL,
  emitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_key, user_id, scheduled_for),
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS schedule_emissions_retention_idx
  ON notification_schema.schedule_emissions (emitted_at);
