# Notification Realtime v1 — completion and review

Date: 2026-10-02. Branch: `ngtantai/feat-realtime`.
Final implementation/acceptance commit: `9bec516`.
Review base: `8b96887506975b265d81907f36c583d2e7545cc9`.
Scope: the approved [design](superpowers/specs/2026-10-01-notification-realtime-v1-design.md)
and [implementation plan](superpowers/plans/2026-10-01-notification-realtime-v1.md).
Chat implementation is outside this release.

## Delivered behavior

Tenant notifications now use an atomic PostgreSQL feed, unread counter, per-user
sequence, inbox deduplication, and durable delivery rows. Versioned business
events from Procedure, Workspace, HRM, Inventory, Maintenance, and identity feed
the policy processor. Required/actionable/informational preferences, actor
exclusion when actor facts are supplied, and aggregation are enforced by the
policy and store. Periodic reminders and delivery relay run independently of
incoming business events.

Authenticated REST and Socket.IO services provide feed pagination, read-state,
preferences, incremental sync/reset, cross-replica delivery, session revocation,
and two-minute recovery. Tenant/user/session rooms are server-controlled.
The shared Notification Center supplies unread badges, notifications, toasts,
preferences, and sequence synchronization across module shells. Deep links
resolve to authorized module views. HRM's unified feed replaces new writes to
its legacy notification table while retaining that table for audit/rollback.

Valkey ACL, proxy routes, deployment services, rollout flags, health endpoints,
metrics, CI integration services, and a load harness are included. Follow the
[operations runbook](notification-realtime-operations.md) for staged rollout,
rollback, monitoring queries, test setup, and measured limits.

## Verification evidence

| Check | Observed result |
| --- | --- |
| Uncached affected test/typecheck/lint/build from review base | PASS for 49 projects; final broad run 3m 9s |
| Real PostgreSQL notification store | Atomic rollback, duplicate/out-of-order input, unread/read-all, missing-user reads, retention and synchronization checked |
| Real RabbitMQ adapter | Publisher confirms, retries and permanent-failure DLQ tested with isolated queues |
| Real Valkey / two Socket.IO replicas | Cross-replica delivery, recovery, replica failure and session revocation tested |
| Pre-replay authentication regressions | Revoked cookie and a different valid user cannot replay private packets; same valid session can recover |
| Deployed end-to-end pipeline | 100 sequential domain events, real PostgreSQL/RabbitMQ/policy/relay/API, two sockets behind Nginx; read-all reaches both tabs without a subsequent domain event |
| HRM database suites | Provisioning registry/checksum replay and legacy backfill/replay verified on disposable PostgreSQL databases |
| React Doctor | Changed-source scan exited 0; remaining warnings concern component size, effects/loading and existing interaction patterns; no fresh numerical score was reported |
| Nx synchronization | `pnpm nx sync:check` PASS on the locked Linux dependency graph |
| Configuration | Compose validation, deployment config suites, real Nginx proxy operation, and CI YAML parsing checked |

Broad verification used:

```text
pnpm nx affected -t test,typecheck,lint,build --base=8b96887506975b265d81907f36c583d2e7545cc9 --head=HEAD --skipNxCache --parallel=2 --outputStyle=static
```

`NOTIFICATIONS_TEST_ADMIN_URL`, `RABBITMQ_TEST_URL`, and
`REALTIME_TEST_REDIS_URL` enabled real infrastructure suites in that run.
The final HRM fixture change was checked separately with `HRM_TEST_ADMIN_URL`
and uncached HRM/entitlement tests, typechecks and lint. Some unrelated projects
have no tests; Nx reports that explicitly. Existing lint warnings and optional
native-module build warnings remain; they are not reported as clean warning-free
builds. CI now runs the database/broker/recovery/HRM suites in a dedicated uncached
step so a cached unit-only run cannot substitute for integration evidence.

## Measured acceptance

| Scenario | Result |
| --- | --- |
| Domain event to socket, 100 samples / two tabs | p50 40.47 ms; p95 53.72 ms; p99 65.42 ms |
| Feed REST in that run | p50 24.18 ms; p95 28.60 ms; p99 60.18 ms |
| Proxied sockets, ramp 250/second | 5,000 connected; zero failed; connection p95 361.72 ms |
| Reconnect storm | 5,000 reconnected and recovered; deadline met; p95 4,181.76 ms; zero connection errors |
| Three transport probes | Each received by all 5,000 sockets exactly once; zero duplicates |
| Delivery p95 before / offline / after storm | 150 / 4,036 / 145 ms; offline includes reconnect jitter |
| Active sockets before shutdown / hold | 5,000 / 60 seconds |
| Server RSS / heap with 5,000 sockets | 468,742,144 / 248,506,824 bytes |
| Load-generator RSS / heap | 435.03 / 254.09 MiB |

These tests are local, not a production soak test. The three large-fan-out probes
write synthetic adapter packets; they establish transport recovery and fan-out,
not 5,000 concurrent domain transactions. The real domain baseline used 100
sequential events with two tabs. Final source adds authentication-failure metrics
and maintenance retry bookkeeping after the measured load bundle; those changes
passed regression suites but were not rebenchmarked. No production capacity or
WAN latency guarantee is inferred.

The [raw load JSON](notification-realtime-load-results.json) preserves probe
counts, percentiles, errors, reconnect/recovery totals and client memory from
the measured proxy run; it contains no authentication cookie.

## Whole-branch review

Self-review covered contracts, SQL/migration registries, module event producers,
policy identities/permissions, lifecycle guards, durable relay, authentication
and recovery, REST ownership, UI routing/state, deployment and load behavior.
An independent reviewer was launched but could not run because of the account's
usage limit. It returned no findings; this report does not claim independent
review approval.

The following observed Critical/Important issues were resolved and verified:

1. Recovery previously could replay a private packet before current-session
   authorization. Engine.IO authenticates before restoration and verifies the
   saved tenant/user/session binding. Real Valkey regression tests cover denied
   and valid replay, including Engine.IO data-event context.
2. Read-state delivery could remain pending until another domain event arrived,
   and reminder policies had no periodic runtime source. A serialized per-tenant
   maintenance loop now drains relay rows and scans real module deadlines.
   Busy tenants retry promptly; healthy tenants keep their own scan intervals.
3. Authenticated delivery could proceed for inactive tenants. Delivery now uses
   the active-tenant lifecycle guard; revocation remains effective independently.
4. Nginx's prior connection limit capped a proxied run near 510 sockets, and
   durable `session.ready` packets caused excessive recovery scanning. Connection
   limits were raised and control packets made local; the measured 5,000-socket
   run passed with authentication guards enabled.
5. Repeated assignment/entitlement changes and recurring calendar reminders could
   share an obsolete source identity. Event IDs and occurrence start times now
   distinguish legitimate updates while duplicate deliveries remain idempotent.
6. Logical deep links did not match existing module routes. A shared validated
   route helper and authorized entity-opening paths now handle current links;
   cross-origin, malformed and unsupported paths are rejected.
7. Disconnects during asynchronous authorization could leave socket counters
   and revalidation timers active. Connection-state checks prevent these updates.
8. The gated HRM provisioning fixture omitted the core notification schema.
   It now executes the actual core registry before the HRM registry and checks
   checksum/version replay across both. All HRM database suites were rerun.

Deferred Minor items:

- Workspace producers that omit actor identity cannot apply actor exclusion to
  that event; a user may receive a self-assignment notification. Do not infer an
  actor from the record creator when the actor is unknown.
- Historical Workspace deep links and some legacy inventory/document links open
  the authorized module/list rather than the exact detail. New work-item/calendar
  links use project/entity/occurrence context; chat links remain outside scope.
- Existing large React components and effect-based loading still generate React
  Doctor warnings. A broader component refactor is separate from this feature.

Native Windows pnpm junction traversal failed on this host. Final verification
used Docker/Linux with the actual locked dependency graph and workspace links,
superseding earlier disposable-hoisted-checkout checks. This proves Linux CI
behavior; it does not claim the Windows package-link issue is repaired.

## Implementation decisions and completion record

The historical execution ledger is preserved below, followed by the final
acceptance decisions. Temporary test cookies, users, queues and databases are
excluded from this report. The work remains on the local feature branch as
required by the approved plan; no push, merge, production deployment or Jira
change is included in completion.
### Historical execution ledger — plan: docs/superpowers/plans/2026-10-01-notification-realtime-v1.md
Baseline: pnpm nx run-many -t test -p adapter-events platform-entitlement shared-ui module-hrm module-workspace module-procedure-engine module-inventory module-maintenance --skipNxCache --nxBail --outputStyle=static → PASS; platform/HRM integration suites skipped by existing DB env gates
Setup Ruling: Superpowers Bash scripts cannot start because local WSL VHD is missing; use behavior-equivalent PowerShell workspace/task bookkeeping — cost if wrong: script formatting differs, while plan identity, BASE, test logs, and completion records remain preserved.
Pre-flight Task 1→2: contracts and generated package names are consumed by storage task; lock exports before Task 2.
Pre-flight Task 2→3: NotificationStore transaction and event schema are consumed by worker processor; no direct SQL outside store.
Pre-flight Task 3→4: policy registry consumes versioned domain events; module payloads must match contract tests.
Pre-flight Task 4→5: delivery event and session events are consumed by realtime-api; routing keys and envelope are shared contracts.
Pre-flight Task 5→6: REST/socket interfaces are consumed by shared UI; no UI-private wire types.
Pre-flight Task 5→7: proxy paths and health endpoints are consumed by deployment configs.
Pre-flight Task 1→8: all project target names must be finalized before affected/load verification.

Task 1: complete (commit 8b37281, tests: lint/test/typecheck passed for contracts-realtime, realtime-api, notification-worker, module-notifications)

Task 2: complete (commit f9d4197, tests: test/typecheck/lint/build passed; PostgreSQL integration suite present and skipped without NOTIFICATIONS_TEST_ADMIN_URL)
Task 3: Ruling: notification inbox idempotency is keyed by consumer + event + recipient — one domain event can legitimately fan out to several users — cost if wrong: migration compatibility before release only.
Task 3: Ruling: workspace dependency declarations were synchronized manually after pnpm updated the lockfile but Windows rejected its junction traversal — package.json and lockfile importers match — cost if wrong: later clean install exposes drift.
Task 3: Ruling: verification used a disposable hoisted checkout, physical workspace copies for test/typecheck, original junction graph for lint, and verification-only webpack aliases for build — host rejects pnpm reparse points — cost if wrong: clean CI remains the final native-layout proof.
Task 3: complete (commit ad7ead1, tests: adapter-events 5 pass; module-notifications 10 pass/5 DB-gated skip; notification-worker 6 pass; typecheck/lint/build pass in disposable verification checkout)
Task 4: Ruling: recurring low-stock notifications use each inventory transaction as source identity while aggregating by material — cost if wrong: a material could either stop notifying after the first 15-minute window or fail on the durable source uniqueness constraint.
Task 4: Ruling: the HRM compatibility migration retains the legacy table for audit/rollback, migrates only the newest request state per request within the 90-day retention window, and makes the unified feed authoritative for new writes — cost if wrong: duplicate feed rows or inconsistent unread counters during rollout.
Task 4: complete (focused unit suites passed across notifications/workspace/procedure/inventory/maintenance/identity/HRM; HRM migration suite passed against PostgreSQL 17 and replayed the migration twice; all 8 affected project typechecks passed; five buildable module libraries built; lint had no source errors, with module-notifications dependency-check blocked only by the disposable checkout's Windows workspace-link graph)
Task 5: started (BASE fbe1c17; brief: .superpowers/sdd/2026-10-01-notification-realtime-v1/task-5-brief.md)
Task 5: Ruling: RabbitMQ delivery is acknowledged only after Redis Streams persistence succeeds; the gateway calls the Redis Streams adapter publish primitive directly before local emit because Socket.IO cluster broadcast does not propagate adapter publish failures — cost if wrong: duplicate delivery on retry is still bounded by notification id/sequence dedupe, while early ACK could permanently lose realtime delivery.
Task 5: Ruling: the two-replica integration suite is environment-gated by REALTIME_TEST_REDIS_URL; verification provisioned disposable Valkey 8 with Docker and ran the full realtime-api suite with the gate enabled — cost if wrong: CI must provide the same dependency to exercise this test instead of skipping it.
Task 5: complete (realtime-api typecheck PASS; full suite 28/28 PASS with disposable Valkey 8; build PASS with one optional @redis/client @node-rs/xxhash webpack warning; lint PASS with 0 errors and one pre-existing unused-disable warning in jest.config.cts)
Task 6: started (BASE ba9230d; brief read from plan because the local Superpowers Bash task-start helper cannot run under the missing WSL VHD)
Task 6: Ruling: shared-ui consumes the locked realtime wire contract through a package-manager workspace link and a narrow exact-import Nx boundary exception instead of maintaining duplicate UI-private wire types — cost if wrong: the exception must move to a dedicated browser contract package before another shared package needs a different contract dependency.
Task 6: Ruling: notification.summary-updated refetches the active page after updating sequence/count, matching the spec's read-all multi-tab behavior — cost if wrong: one extra REST request per summary event.
Task 6: complete (commit f11a0a7, tests: shared-ui 17/17, feature-hrm 18/18, web 17/17 PASS; typecheck PASS for contracts-realtime/shared-ui/module-shell/HRM/web; lint 0 errors with pre-existing warnings only; web/hrm-web/workspace-web production builds PASS; react-doctor 85/100 with one pre-existing ModuleShell complexity warning)
Task 7: started (BASE f11a0a7; brief read from plan; interfaces: /realtime/socket.io, /api/realtime/v1, health/readiness, Prometheus metrics)
Task 7: Ruling: production rollout flags default both RabbitMQ consumers off while local full-stack defaults them on; readiness treats a disabled consumer as intentional dark mode and checks the live broker channel when enabled — cost if wrong: a production operator must explicitly advance each rollout stage, while an accidental broker disconnect remains visible as not-ready.
Task 7: Ruling: REALTIME_MUTATIONS_ENABLED provides the specified REST read-only rollback without discarding persisted feeds or queued events — cost if wrong: read-state and preference writes return 503 until the flag is restored.
Task 7: complete (commit 2b11cc8; adapter-events/realtime-api/notification-worker test 59 pass + 1 existing environment-gated skip; typecheck/lint/build PASS; Docker Compose local/full/Coolify config PASS; Nx sync PASS; 5,000-connection load harness configuration validated; realtime-api build retains the known optional @redis/client @node-rs/xxhash webpack warning)
Task 8: started (BASE 2b11cc8; integration, recovery, measured load evidence, final operations limits)

Task 8: Ruling: concurrent authentication calls for the same access cookie share only the in-flight request, never a cached result — reduces reconnect fan-in without retaining revoked sessions — cost if wrong: callers can share a transient auth failure.
Task 8: Ruling: raise Nginx capacity to 16,384 connections per worker; the old 1,024 limit capped the measured proxied load near 510 sockets — cost if wrong: deploy hosts must provision file descriptors and memory for the configured capacity.
Task 8: Ruling: use Linux Docker verification with the locked dependency graph because native pnpm junction traversal currently fails; load trials isolate Docker-to-Windows networking from application behavior — cost if wrong: a separate Windows development smoke remains necessary.
Task 8: Ruling: start the single whole-branch review while acceptance measurements finish, including the pending Task 8 diff — no implementation task is omitted and fixes remain one reviewed pass — cost if wrong: reviewer must be told about subsequent transport changes.

### Final rulings

- Task 8: make `session.ready` local and non-persistent; notification packets
  remain durable. This avoids quadratic reconnect scans of control packets.
  Cost if wrong: clients still require REST synchronization after a gap.
- Task 8: authorize at Engine.IO before recovery and bind restoration to
  tenant/user/session with packet/data AsyncLocalStorage context. Public event
  hooks avoid editing vendor code. Cost if wrong: transport upgrades require the
  denied/valid-replay integration suites to detect ordering regressions.
- Task 8: run relay/scheduler/cleanup in a serialized worker loop with per-tenant
  retry markers and lifecycle guards. Cost if wrong: a slow tenant delays later
  tenants; queue lag and outbox age must be monitored.
- Task 8: use existing calendar recurrence expansion, occurrence cancellation,
  and an explicit IANA timezone for date-only deadlines. Cost if wrong: an
  operator selecting a different timezone changes when work items become overdue.
- Task 8: source identity includes domain event ID for repeatable transitions
  and occurrence start for calendar reminders. Cost if wrong: only pre-release
  identities change; existing inbox deliveries still deduplicate by event/user.
- Task 8: normalize historical routes through a shared validated helper and
  authorize entity loads in module screens. Cost if wrong: unsupported legacy
  links fall back to a module list rather than an exact detail.
- Task 8: link worker/module-workspace and integration dependencies using pnpm
  in Linux, retaining exact versions already present in the lockfile. Cost if
  wrong: frozen installation or Nx synchronization exposes dependency drift.
- Task 8: apply additive tenant core 0008 only to the local test tenant for the
  deployed acceptance run. This was not a production rollout and did not remove
  business data. The migration is idempotent for later normal provisioning.
- Task 8: wait for actual Redis replica subscription readiness in test fixtures
  rather than a fixed sleep. Cost if wrong: the fixture times out visibly instead
  of silently ignoring an asynchronous shutdown error.
- Task 8: run real database/broker/recovery/HRM suites uncached in CI. Cost if
  wrong: CI consumes more runner time; cached unit runs cannot hide skipped gates.
- Task 8: React Doctor's current CLI uses changed scope/base rather than the
  obsolete `--diff`; telemetry and supply-chain scans were disabled for this
  source review. Cost if wrong: no numerical score or dependency audit is claimed.
- Task 9: independent review hit the account usage limit twice and returned no
  findings. Complete a documented whole-branch self-review and preserve this
  limitation. Cost if wrong: independent second-reader assurance remains absent.
- Task 9: acceptance-driven review fixes are included in the Task 8 verification
  commit; the following commit records completion/review and plan status. This
  avoids separating interdependent security, runtime and acceptance changes.
- Task 9: retain the local branch and checkout under the approved no-push scope.
  The implementation plan already excludes external integration actions; no
  repeated permission request is needed to preserve completed local work.

Task 8: complete — real infrastructure suites, deployed pipeline, 5,000-socket
recovery run, uncached 49-project affected checks, runbook and monitoring queries.

Task 9: complete — whole-branch self-review, resolved findings/regressions,
documented Minor items and decisions, final HRM checks and Nx synchronization.
Independent review was unavailable as stated above.

Cleanup note: automatic command policy rejected removal of the three disposable
verification/load containers, the temporary load script, and this plan's ignored
execution directory with `blocked by policy` and no detailed reason. These
resources were therefore preserved. The temporary fixture users, disposable
databases, and isolated RabbitMQ queues were confirmed absent before cleanup;
existing infrastructure and shared queues were left in place. The only
untracked file in Git status at handoff is `.tmp-realtime-load.ps1`.

Follow-up cleanup on 2026-10-02, explicitly requested by the user: removed
`realtime-api-load`, `realtime-gateway-load`, and `realtime-verify`, plus images
`enterprise-platform/realtime-load:local`,
`enterprise-platform/realtime-verify:local`,
`enterprise-platform/realtime-api:load`, and `valkey/valkey:8-alpine`.
The four `D:/ep-package-manifest*` worktree registrations were removed; Git
reported `Directory not empty` and left residual files. Recursive PowerShell
removal was again rejected with `blocked by policy`. Consequently all seven
user-listed directory paths, the temporary load script, and the ignored plan
execution directory still remain. `git worktree list` now contains only the
primary checkout. Valkey 9.1.2 remains as the local realtime runtime dependency;
the existing database/broker/proxy/storage stack was preserved.
