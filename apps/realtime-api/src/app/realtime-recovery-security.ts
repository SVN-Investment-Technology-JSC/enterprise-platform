import type { Server } from 'socket.io';
import type { IncomingMessage } from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { RealtimeAuthClient } from './realtime-runtime';
import type { RealtimeOriginPolicy } from './realtime.gateway';
import type { RealtimeMetrics } from './realtime-health';

const verifiedRequests = new WeakMap<IncomingMessage, TenantUserPrincipal>();

export function verifiedSocketPrincipal(request: IncomingMessage): TenantUserPrincipal | undefined {
  return verifiedRequests.get(request);
}

export function secureRealtimeRecovery(
  server: Server,
  auth: RealtimeAuthClient,
  origins: RealtimeOriginPolicy,
  metrics: Pick<RealtimeMetrics, 'authFailed'>,
): void {
  const context = new AsyncLocalStorage<TenantUserPrincipal>();
  server.engine.opts.allowRequest = (request, done) => {
    if (!origins.allows(request.headers.origin)) {
      metrics.authFailed('origin');
      done('Origin is not allowed.', false);
      return;
    }
    void auth.authenticate(request.headers.cookie).then((principal) => {
      verifiedRequests.set(request, principal);
      done(null, true);
    }, () => {
      metrics.authFailed('session');
      done('Session is not active.', false);
    });
  };
  // Namespace middleware runs after Socket.IO has replayed recovered packets.
  // Carry the verified Engine.IO identity into restoreSession instead.
  server.engine.prependListener('connection', (connection) => {
    const principal = verifiedRequests.get(connection.request);
    const emit = connection.emit.bind(connection);
    connection.emit = ((event: string, ...args: unknown[]) => {
      if ((event === 'packet' || event === 'data') && principal) {
        return context.run(principal, () => emit(event, ...args));
      }
      return emit(event, ...args);
    }) as typeof connection.emit;
  });
  const adapter = server.of('/').adapter;
  const restore = adapter.restoreSession.bind(adapter);
  adapter.restoreSession = async (pid, offset) => {
    const current = context.getStore();
    // The adapter type omits null although Socket.IO's recovery contract allows it.
    if (!current) return null as never;
    const session = await restore(pid, offset);
    const previous = (session?.data as { principal?: TenantUserPrincipal } | undefined)?.principal;
    if (!previous || previous.tenantId !== current.tenantId ||
        previous.userId !== current.userId || previous.sessionId !== current.sessionId) {
      return null as never;
    }
    return session;
  };
}
