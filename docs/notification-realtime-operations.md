# Notification Realtime Operations

## Runtime topology

`notification-worker` consumes tenant domain events from RabbitMQ, persists the
notification and sequence event in the tenant database, then publishes the
durable delivery event. `realtime-api` consumes that delivery event, writes the
Socket.IO packet to Valkey Streams, and emits it to the authenticated tenant/user
room. Nginx exposes REST at `/api/realtime/v1` and WebSocket transport at
`/realtime/socket.io`.

Valkey runs as `valkey/valkey:9.1.2-alpine` with the default user disabled and a
password-protected `realtime` ACL user. `VALKEY_PASSWORD` must be URL-safe because
the services receive it in `VALKEY_URL`.

## Required configuration

| Variable | Service | Purpose |
| --- | --- | --- |
| `VALKEY_PASSWORD` | Valkey, realtime-api | ACL credential; required in production |
| `REALTIME_ALLOWED_ORIGINS` | realtime-api | Comma-separated browser origins allowed to open a socket |
| `REALTIME_DELIVERY_ENABLED` | realtime-api | Starts the RabbitMQ-to-Valkey delivery consumer |
| `REALTIME_MUTATIONS_ENABLED` | realtime-api | Allows read-state and preference mutations; set `false` for REST read-only rollback |
| `NOTIFICATION_CONSUMER_ENABLED` | notification-worker | Starts domain-event consumption |

Use exact `true` or `false` values. Invalid values stop the process instead of
silently enabling a rollout stage.

## Health and metrics

The realtime API exposes:

- `GET /api/realtime/v1/health/live`: process liveness only.
- `GET /api/realtime/v1/health/ready`: platform PostgreSQL, Valkey, and the
  RabbitMQ delivery consumer when enabled.
- `GET /api/realtime/v1/metrics`: Prometheus metrics for active sockets, auth
  failures, reconnects, delivery volume and latency, sequence gaps, sync resets,
  and session revocations.

The notification worker exposes port `3340` internally:

- `GET /health/live`: process liveness only.
- `GET /health/ready`: platform PostgreSQL and the RabbitMQ consumer when enabled.
- `GET /metrics`: processed outcomes, failures, and queue-lag histogram.

Application-owned startup and error records are JSON with `timestamp`, `level`,
`service`, and `event` fields. NestJS framework logs remain available for
framework diagnostics.

## Rollout

1. Apply platform and tenant migrations, then start Valkey and verify its ACL
   healthcheck.
2. Deploy `realtime-api` with `REALTIME_DELIVERY_ENABLED=false`. Verify REST,
   WebSocket authentication, readiness, and metrics.
3. Deploy `notification-worker` with `NOTIFICATION_CONSUMER_ENABLED=false` and
   verify readiness in dark mode.
4. Enable `NOTIFICATION_CONSUMER_ENABLED`, watch processing failures, queue lag,
   outbox backlog, and DLQ growth.
5. Enable `REALTIME_DELIVERY_ENABLED`, then release the browser consumer.

Change one stage at a time and wait for health and backlog metrics to stabilize.

## Rollback

Set `REALTIME_MUTATIONS_ENABLED=false` to preserve persisted feed reads while
preventing state changes. Disable `REALTIME_DELIVERY_ENABLED` to stop socket
delivery consumption and disable `NOTIFICATION_CONSUMER_ENABLED` to stop creating
new notifications. Existing RabbitMQ messages and PostgreSQL outbox rows remain
durable for a later resume. Roll back the browser consumer last; do not remove
Valkey or database migrations while any released server still depends on them.

## Load harness

Run the harness through Nx with a valid tenant-user cookie:

```powershell
$env:REALTIME_LOAD_COOKIE='ep_access=<signed-session>'
pnpm nx run realtime-api:load -- --connections=5000 --ramp=250 --duration=60 --storm=true
```

The JSON report contains successful connections, errors, disconnects, client
process memory, and p50/p95/p99/max connection and reconnection latency. Run it
from a dedicated load host; the reported memory is for the harness process, while
server memory must come from the deployment metrics/dashboard.
