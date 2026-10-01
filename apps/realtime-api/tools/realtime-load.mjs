import { io } from 'socket.io-client';

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
const connectLatencyMs = [];
const reconnectLatencyMs = [];
let errors = 0;
let disconnected = 0;

for (let index = 0; index < connections; index += 1) {
  const startedAt = performance.now();
  const socket = io(target, {
    path: '/realtime/socket.io',
    transports: ['websocket'],
    reconnection: true,
    extraHeaders: { cookie, origin },
  });
  socket.once('session.ready', () => {
    connectLatencyMs.push(performance.now() - startedAt);
  });
  socket.on('connect_error', () => {
    errors += 1;
  });
  socket.on('disconnect', () => {
    disconnected += 1;
  });
  sockets.push(socket);
  if ((index + 1) % rampPerSecond === 0) await delay(1_000);
}

await waitFor(
  () => connectLatencyMs.length + errors >= connections,
  Math.max(30_000, Math.ceil(connections / rampPerSecond) * 2_000),
);

if (storm) {
  for (const socket of sockets) {
    const startedAt = performance.now();
    socket.once('session.ready', () => {
      reconnectLatencyMs.push(performance.now() - startedAt);
    });
    socket.io.engine?.close();
  }
  await waitFor(
    () => reconnectLatencyMs.length + errors >= connections,
    60_000,
  );
}

await delay(durationSeconds * 1_000);
for (const socket of sockets) socket.close();

const memory = process.memoryUsage();
const report = {
  target,
  requestedConnections: connections,
  successfulConnections: connectLatencyMs.length,
  errors,
  disconnected,
  connectLatencyMs: percentiles(connectLatencyMs),
  reconnectLatencyMs: percentiles(reconnectLatencyMs),
  processMemoryMb: {
    rss: megabytes(memory.rss),
    heapUsed: megabytes(memory.heapUsed),
  },
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (errors > 0 || connectLatencyMs.length !== connections) process.exitCode = 1;

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
