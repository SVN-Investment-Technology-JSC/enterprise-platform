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
| `NOTIFICATION_DEADLINE_TIMEZONE` | notification-worker | IANA timezone for date-only work-item deadlines; default `Asia/Ho_Chi_Minh` |
| `INTERNAL_SERVICE_TOKEN` | notification-worker | Service token for reading the tenant organization context; required to notify users behind unit or position assignments |
| `TENANT_CORE_ORGANIZATION_CONTEXT_URL` | notification-worker | Tenant Core organization-context endpoint; defaults to `http://localhost:3333/api/platform/internal/v1/organization-contexts` |

Use exact `true` or `false` values. Invalid values stop the process instead of
silently enabling a rollout stage.

## Health and metrics

Normal tenant operations acquire a shared PostgreSQL session advisory lock by
calling `withActiveTenant(..., { mode: 'shared' })`. Tenant deletion,
provisioning and migration keep the corresponding exclusive lock (the default
mode), so normal delivery, maintenance, and outbox work can overlap without
bypassing deletion protection.
An exclusive lifecycle operation can still cause a delivery retry.
To verify the real PostgreSQL lock behavior, set
`TENANT_LIFECYCLE_TEST_DATABASE_URL` to a test database connection and run
`pnpm nx test adapter-database --runInBand --skipNxCache`. These tests use
unique advisory-lock keys and do not change tenant records. Disable the Nx cache
for this check because it depends on the live database and an opt-in environment.

The general worker's development watcher writes its executable to
`.nx/worker-dev/main.js`, separately from `apps/worker/dist` used by normal builds
and type checks. Its esbuild output file is set explicitly so the watcher and
Node executor agree on the executable location.

The development launcher builds the selected backends and their dependencies
before starting the continuous services. Backend development uses a dedicated
`build-watch` target so the Node executor receives webpack build events directly,
without launching overlapping nested Nx build graphs. Production builds retain
their existing webpack CLI target. The installed Nx 23 webpack executor emits a
deprecation warning; revisit this watch integration before upgrading to Nx 24.

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

## Periodic delivery and reminders

When `NOTIFICATION_CONSUMER_ENABLED=true`, the worker also runs a serialized
maintenance loop. It enumerates active tenants, drains notification delivery
rows every 500 ms after the previous tick completes, scans scheduled reminders
every 30 seconds per tenant, and performs retention cleanup hourly. Busy or
failed tenants are retried on the next tick. Lifecycle guards prevent work
during tenant migration; database schedule identities prevent duplicate
reminders across worker replicas. These intervals are minimum delays, not
deadlines when a database is slow.

Read/read-all mutations append durable delivery rows. The periodic relay sends
their summary updates even when no new business event arrives. Deadline scans
cover work items, calendar occurrences, procedure SLA, maintenance occurrences,
and expiring inventory reservations. A date-only work-item deadline expires at
the next midnight in `NOTIFICATION_DEADLINE_TIMEZONE`. Calendar recurrence uses
the event's own timezone and excludes cancelled or moved original occurrences.

## Authentication and recovery

The Engine.IO handshake checks Origin and the current session before Socket.IO
can restore packets. Recovery is bound to the same tenant, user, and session;
a revoked cookie or a different authenticated user cannot replay a saved private
stream. Authentication shares concurrent requests for the same cookie only
while the request is in flight; no authentication result is cached.

`session.ready` is a local control packet and is not added to the recovery
stream. Notification packets remain durable. Recovery tests exercise both valid
replay and denied replay using real Valkey. The adapter's recovery guard uses
Engine.IO packet/data event context: rerun these tests when upgrading Socket.IO
or its Redis Streams adapter. Clients use reconnect jitter with a 2-second
initial delay and a 30-second cap, followed by REST sequence synchronization.

## Dashboard and initial alerts

Scrape both internal metrics endpoints. Restrict their network exposure in
deployment. Use the following panels and starting thresholds, then tune them
against observed traffic:

| Signal | Query / source | Initial alert |
| --- | --- | --- |
| Server delivery p95 | `histogram_quantile(0.95, sum by (le) (rate(realtime_delivery_latency_seconds_bucket[5m])))` | Above 1 second for 5 minutes |
| Domain queue lag p95 | `histogram_quantile(0.95, sum by (le) (rate(notification_worker_queue_lag_seconds_bucket[5m])))` | Above 30 seconds for 5 minutes |
| Worker failures | `sum(rate(notification_worker_failures_total[5m]))` | Sustained failures for 5 minutes |
| Authentication failures | `sum by (reason) (rate(realtime_auth_failures_total[5m]))` | Investigate a rise above the normal login/revocation baseline |
| Sockets and memory | `realtime_active_sockets`, `realtime_process_resident_memory_bytes`, `realtime_process_heap_used_bytes` | Set memory limits from deployment sizing, leaving reconnect headroom |
| Sync resets / sequence gaps | Rates of `realtime_sync_resets_total` and `realtime_sequence_gaps_total` | Investigate sustained growth |
| Service availability | HTTP probes of each readiness endpoint | Not ready for 1 minute |
| Pending relay / oldest row | Per-tenant SQL below, exported by database monitoring | Oldest pending row above 30 seconds for 5 minutes |
| Retry and DLQ queues | RabbitMQ management / Prometheus exporter queue depth | Any DLQ growth; sustained retry backlog |

The server delivery histogram ends at publication to Valkey; it does not measure
browser receipt. Browser timing requires a synthetic or client measurement.
Outbox and DLQ depth are external monitoring inputs, not application gauges.

```sql
SELECT count(*) AS pending,
       extract(epoch FROM now() - min(occurred_at)) AS oldest_seconds
FROM notification_schema.notification_events
WHERE published_at IS NULL;
```

Inspect DLQ reasons before replaying messages. Fix invalid payloads or missing
dependencies first; retain the original event identity on replay so inbox
deduplication remains effective. Never purge a queue as a rollout step.

## Reproducing acceptance checks

CI provides PostgreSQL 17, RabbitMQ 4, and Valkey 9.1.2 and runs the database,
broker, recovery, and HRM provisioning suites without Nx cache. Local integration
suites use `NOTIFICATIONS_TEST_ADMIN_URL`, `HRM_TEST_ADMIN_URL`,
`RABBITMQ_TEST_URL`, and `REALTIME_TEST_REDIS_URL`. Database fixtures create and
remove disposable databases and require a loopback database endpoint.

The deployed pipeline suite additionally requires `NOTIFICATIONS_E2E_ENABLED=true`,
`NOTIFICATIONS_E2E_PLATFORM_DATABASE_URL`, `NOTIFICATIONS_E2E_TENANT_DATABASE_URL`,
`NOTIFICATIONS_E2E_AUTH_URL`, `NOTIFICATIONS_E2E_REALTIME_URL`, and
`NOTIFICATIONS_E2E_TENANT_SLUG`. Use only a local development tenant with its
migrations applied. It verifies the configured tenant database against the
platform registry, creates a temporary user, measures 100 events through two
sockets, checks read-all relay, then removes its fixtures.

```powershell
pnpm nx test notification-worker --runInBand --detectOpenHandles --testPathPatterns=notification-pipeline --skipNxCache
docker build -f apps/realtime-api/tools/Dockerfile.load -t realtime-load:local apps/realtime-api/tools
# A private env file contains REALTIME_LOAD_COOKIE and REALTIME_LOAD_URL.
# Do not commit this file or print its cookie.
docker run --rm --ulimit nofile=65535:65535 --env-file <private-env-file> realtime-load:local --connections=5000 --ramp=250 --duration=60 --storm=true
```

Optional transport probes require `REALTIME_LOAD_REDIS_URL`,
`REALTIME_LOAD_TENANT_ID`, and `REALTIME_LOAD_USER_ID` for a disposable test user.
They write synthetic packets directly to the adapter stream and prove transport
fan-out/recovery; they do not measure domain processing throughput. No public
test endpoint is added. Collect server memory separately while sockets are held.

## Measured local baseline — 2026-10-02

Runtime: Node.js 24.21, PostgreSQL 17, RabbitMQ 4, Valkey 9.1.2, Socket.IO 4.8.4,
and Nginx 1.29 in Docker Desktop (16 CPUs, approximately 7.58 GiB VM memory).
Traffic passed through the Nginx proxy. Nginx uses 16,384 connections per worker
and a 65,535 file-descriptor limit; deployment resource limits must support these
settings.

| Measurement | p50 | p95 | p99 |
| --- | ---: | ---: | ---: |
| Domain event to socket receipt: 100 sequential samples, two tabs | 40.47 ms | 53.72 ms | 65.42 ms |
| Notification list REST: same 100-sample run | 24.18 ms | 28.60 ms | 60.18 ms |
| 5,000 socket connection ramp, 250/second | 160.66 ms | 361.72 ms | 626.60 ms |
| 5,000 socket reconnect storm | 2,862.27 ms | 4,181.76 ms | 4,243.49 ms |
| Transport delivery before storm | 89 ms | 150 ms | 153 ms |
| Transport offline packet recovery, including reconnect delay | 2,802 ms | 4,036 ms | 4,132 ms |
| Transport delivery after storm | 86 ms | 145 ms | 150 ms |

All 5,000 sockets connected, reconnected, reported recovery, and remained live
before shutdown. Each of the three transport probes reached all 5,000 sockets
with zero duplicates and zero connection errors. The post-reconnect hold was
60 seconds. Server RSS sampled with 5,000 active sockets was 468,742,144 bytes
(447.03 MiB); server heap was 248,506,824 bytes (237.00 MiB). The separate load
process reported RSS 435.03 MiB and heap 254.09 MiB.

These are local baseline measurements. They do not establish 5,000 simultaneous
domain transactions, long-running soak behavior, WAN latency, or production
capacity. The load runtime includes the pre-replay authentication and tenant
guards; subsequent changes to authentication-failure counters and maintenance
retry bookkeeping were checked in the final suites but not rebenchmarked.
See [completion and review evidence](notification-realtime-completion.md).
