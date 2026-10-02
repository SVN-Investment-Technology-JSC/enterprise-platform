import { io } from 'socket.io-client';
import { randomUUID } from 'node:crypto';

const options = parseArguments(process.argv.slice(2));
const target = options.url ?? process.env.REALTIME_LOAD_URL ?? 'http://localhost:8080';
const origin =
  options.origin ?? process.env.REALTIME_LOAD_ORIGIN ?? new URL(target).origin;
const cookie = process.env.REALTIME_LOAD_COOKIE;
const connections = integerOption(options.connections, 100);
const rampPerSecond = integerOption(options.ramp, 100);
const durationSeconds = integerOption(options.duration, 60);
const storm = options.storm === 'true';

if (options.validate === 'true') {
  process.stdout.write(
    `${JSON.stringify({ target, origin, connections, rampPerSecond, durationSeconds, storm })}\n`,
  );
  process.exit(0);
}

if (!cookie) {
  throw new Error(
    'REALTIME_LOAD_COOKIE is required and must contain a valid tenant-user session cookie.',
  );
}

const sockets = [];
const probeResults = new Map();
let probeRedis;
if (process.env.REALTIME_LOAD_REDIS_URL) {
  if (!process.env.REALTIME_LOAD_TENANT_ID || !process.env.REALTIME_LOAD_USER_ID) {
    throw new Error('Transport probes require the disposable load tenant and user IDs.');
  }
  const { createClient } = await import('redis');
  probeRedis = createClient({ url: process.env.REALTIME_LOAD_REDIS_URL });
  probeRedis.on('error', (error) => process.stderr.write(`Probe Redis: ${error.message}\n`));
  await probeRedis.connect();
}
const connectLatencyMs = [];
const reconnectLatencyMs = [];
const errorReasons = new Map();
let connectErrorEvents = 0;
let disconnected = 0;
let reconnectDeadlineMet = !storm;
const disconnectReasons = new Map();
function progress(phase) {
  process.stderr.write(`${JSON.stringify({ phase, ready: connectLatencyMs.length, reconnected: reconnectLatencyMs.length, connected: sockets.filter((socket) => socket.connected).length })}\n`);
}

for (let index = 0; index < connections; index += 1) {
  const startedAt = performance.now();
  const socket = io(target, {
    path: '/realtime/socket.io',
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 1,
    extraHeaders: { cookie, origin },
  });
  socket.once('session.ready', () => {
    connectLatencyMs.push(performance.now() - startedAt);
  });
  socket.on('notification.summary-updated', (event) => {
    const probe = [...probeResults.values()].find((candidate) => candidate.id === event?.id);
    if (!probe) return;
    if (probe.clients.has(index)) { probe.duplicates += 1; return; }
    probe.clients.add(index);
    probe.latencies.push(Date.now() - Date.parse(event.occurredAt));
  });
  socket.on('connect_error', (error) => {
    connectErrorEvents += 1;
    const reason = error instanceof Error ? error.message : String(error);
    errorReasons.set(reason, (errorReasons.get(reason) ?? 0) + 1);
  });
  socket.on('disconnect', (reason) => {
    disconnected += 1;
    disconnectReasons.set(reason, (disconnectReasons.get(reason) ?? 0) + 1);
  });
  sockets.push(socket);
  if ((index + 1) % rampPerSecond === 0) await delay(1_000);
}

await waitFor(
  () => connectLatencyMs.length >= connections,
  Math.max(30_000, Math.ceil(connections / rampPerSecond) * 2_000),
);
progress('ramp-complete');
if (probeRedis && connectLatencyMs.length === connections) {
  await publishProbe('live-before-storm');
  await waitFor(() => probeResults.get('live-before-storm')?.clients.size === connections, 10_000);
}

if (storm && connectLatencyMs.length === connections) {
  for (const socket of sockets) {
    const startedAt = performance.now();
    socket.once('session.ready', () => {
      reconnectLatencyMs.push(performance.now() - startedAt);
    });
    socket.io.engine?.close();
  }
  if (probeRedis) await publishProbe('offline-recovery');
  await waitFor(
    () => reconnectLatencyMs.length >= connections,
    60_000,
  );
  reconnectDeadlineMet = reconnectLatencyMs.length === connections;
  progress('reconnect-complete');
  if (probeRedis && reconnectDeadlineMet) {
    await publishProbe('live-after-storm');
    await waitFor(() => probeResults.get('live-after-storm')?.clients.size === connections, 10_000);
  }
}

if (connectLatencyMs.length === connections) {
  await delay(durationSeconds * 1_000);
}
const connectedBeforeShutdown = sockets.filter((socket) => socket.connected).length;
const recoveredConnections = sockets.filter((socket) => socket.recovered).length;
const unexpectedDisconnects = Object.fromEntries(disconnectReasons);
for (const socket of sockets) socket.close();
await probeRedis?.quit();

const memory = process.memoryUsage();
const report = {
  target,
  requestedConnections: connections,
  successfulConnections: connectLatencyMs.length,
  failedConnections: connections - connectLatencyMs.length,
  successfulReconnections: reconnectLatencyMs.length,
  failedReconnections: storm ? connections - reconnectLatencyMs.length : 0,
  reconnectDeadlineMet,
  connectedBeforeShutdown,
  recoveredConnections,
  transportProbes: Object.fromEntries([...probeResults.entries()].map(([phase, probe]) => [phase, {
    received: probe.clients.size,
    duplicates: probe.duplicates,
    latencyMs: percentiles(probe.latencies),
  }])),
  disconnectReasonsBeforeShutdown: unexpectedDisconnects,
  connectErrorEvents,
  errorReasons: Object.fromEntries(
    [...errorReasons.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5),
  ),
  disconnected,
  connectLatencyMs: percentiles(connectLatencyMs),
  reconnectLatencyMs: percentiles(reconnectLatencyMs),
  processMemoryMb: {
    rss: megabytes(memory.rss),
    heapUsed: megabytes(memory.heapUsed),
  },
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (
  connectLatencyMs.length !== connections ||
  (storm && (!reconnectDeadlineMet || reconnectLatencyMs.length !== connections)) ||
  connectedBeforeShutdown !== connections ||
  [...probeResults.values()].some((probe) => probe.clients.size !== connections || probe.duplicates > 0)
) {
  process.exitCode = 1;
}

async function publishProbe(phase) {
  const id = randomUUID();
  const probe = { clients: new Set(), duplicates: 0, latencies: [] };
  // Use a phase key for reports and the generated UUID to correlate wire frames.
  probeResults.set(phase, probe);
  const tenantId = process.env.REALTIME_LOAD_TENANT_ID;
  const userId = process.env.REALTIME_LOAD_USER_ID;
  const event = {
    id, event: 'notification.summary-updated', version: 1, tenantId, userId,
    sequence: probeResults.size, occurredAt: new Date().toISOString(),
    data: { unreadCount: 0, lastSequence: probeResults.size },
  };
  probe.id = id;
  await probeRedis.xAdd('enterprise:socket.io', '*', {
    uid: 'load-probe', nsp: '/', type: '3',
    data: JSON.stringify({ packet: { type: 2, nsp: '/', data: [event.event, event] },
      opts: { rooms: [`tenant:${tenantId}:user:${userId}`], except: [], flags: {} } }),
  }, { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 20_000 } });
}

function parseArguments(argumentsList) {
  return Object.fromEntries(
    argumentsList.map((argument) => {
      const [key, ...value] = argument.replace(/^--/, '').split('=');
      return [key, value.join('=') || 'true'];
    }),
  );
}

function integerOption(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received ${value}.`);
  }
  return parsed;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return;
    await delay(100);
  }
}

function percentiles(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: Number(sorted.at(-1).toFixed(2)),
  };
}

function percentile(sorted, quantile) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return Number(sorted[index].toFixed(2));
}

function megabytes(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}
