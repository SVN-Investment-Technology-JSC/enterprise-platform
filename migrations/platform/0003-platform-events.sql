SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS integration_schema.outbox_events (
  id uuid PRIMARY KEY, aggregate_type varchar(100) NOT NULL, aggregate_id varchar(160) NOT NULL,
  event_type varchar(160) NOT NULL, event_version integer NOT NULL, payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL, published_at timestamptz, attempts integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX IF NOT EXISTS platform_outbox_pending_idx
  ON integration_schema.outbox_events (occurred_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS integration_schema.inbox_messages (
  consumer varchar(120) NOT NULL, event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (consumer,event_id)
);
