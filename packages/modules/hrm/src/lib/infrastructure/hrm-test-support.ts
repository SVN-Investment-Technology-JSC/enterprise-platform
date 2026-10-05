import { randomUUID } from 'node:crypto';
import {
  HrmApprovalPolicyService,
  type HrmOrgScopePort,
} from './hrm-approval-policy.js';

/**
 * Tiện ích dùng chung cho test (không import jest, không nằm trong bản build thư viện).
 * - Cổng phạm vi tổ chức giả: controller không gọi API Platform thật.
 * - Procedure Engine giả qua `fetch`: HRM chỉ giao tiếp với Procedure bằng HTTP nên test
 *   không được ghi thẳng vào schema của module khác.
 */

export const TEST_APPROVE_ALL_PERMISSIONS: readonly string[] = ['hrm.manage'];

/** Cổng phạm vi: `subordinates` là các user id mà người duyệt được duyệt đơn. */
export function fakeOrgScope(
  subordinates: Iterable<string> = [],
): HrmOrgScopePort {
  const ids = new Set(subordinates);
  return { subordinateUserIds: async () => ids };
}

/** Dịch vụ chính sách duyệt dùng cổng phạm vi giả (không gọi mạng). */
export function testApprovalPolicy(
  subordinates: Iterable<string> = [],
): HrmApprovalPolicyService {
  return new HrmApprovalPolicyService(fakeOrgScope(subordinates));
}

export interface ProcedureApiCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

export interface ProcedureApiFakeOptions {
  /** Định nghĩa đã công bố trả về cho `GET /v1/internal/definitions/:id`. */
  definitions?: Record<string, unknown>;
  available?: boolean;
  currentStepName?: string;
  currentAssigneeName?: string;
}

const respond = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Procedure Engine giả. Dùng: `jest.spyOn(globalThis, 'fetch').mockImplementation(fake.handler)`.
 * Tạo instance theo `idempotencyKey` (gọi lặp trả lại cùng instance).
 */
export function createProcedureApiFake(options: ProcedureApiFakeOptions = {}) {
  const state = {
    available: options.available ?? true,
    failStarts: 0,
    loseResponses: 0,
    startError: null as { status: number; message: string } | null,
  };
  const calls: ProcedureApiCall[] = [];
  const instances = new Map<string, { id: string; code: string }>();
  /** Trạng thái hồ sơ do test đặt, trả cho API đối soát/tiến độ. */
  const statuses = new Map<string, Record<string, unknown>>();
  const handler = async (
    input: string | URL | { url: string },
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(typeof input === 'object' && 'url' in input ? input.url : String(input));
    const path = url.pathname.replace(/^.*?\/v1\//, '/v1/');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({
      method,
      path,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body,
    });
    if (!state.available) return respond(403, { message: 'Entitlement tắt' });
    if (method === 'GET' && path === '/v1/internal/status')
      return respond(200, { ok: true });
    const definition = path.match(/^\/v1\/internal\/definitions\/([^/]+)$/);
    if (method === 'GET' && definition) {
      const found = options.definitions?.[decodeURIComponent(definition[1])];
      return found ? respond(200, found) : respond(404);
    }
    if (method === 'POST' && path === '/v1/internal/instances') {
      if (state.failStarts > 0) {
        state.failStarts -= 1;
        return respond(503, { message: 'Procedure tạm ngưng' });
      }
      if (state.startError)
        return respond(state.startError.status, {
          message: state.startError.message,
        });
      const key = String(body?.idempotencyKey);
      let instance = instances.get(key);
      if (!instance) {
        instance = { id: randomUUID(), code: `PRC-${instances.size + 1}` };
        instances.set(key, instance);
      }
      if (state.loseResponses > 0) {
        state.loseResponses -= 1;
        throw new Error('Mất phản hồi sau khi Procedure đã commit');
      }
      return respond(201, {
        ...instance,
        currentStepName: options.currentStepName ?? 'Trưởng phòng duyệt',
        currentAssigneeName: options.currentAssigneeName ?? 'Trưởng phòng A',
        sequence: 2,
      });
    }
    const progress = path.match(/^\/v1\/internal\/instances\/([^/]+)\/progress$/);
    if (method === 'GET' && progress) {
      const entry = statuses.get(decodeURIComponent(progress[1]));
      return entry
        ? respond(200, { steps: [], activity: [], ...entry })
        : respond(404);
    }
    if (method === 'POST' && path === '/v1/internal/instances/status') {
      const ids = ((body?.ids ?? []) as string[]).filter((id) =>
        statuses.has(id),
      );
      return respond(
        200,
        ids.map((id) => statuses.get(id)),
      );
    }
    if (method === 'POST' && /^\/v1\/instances\/[^/]+\/actions$/.test(path))
      return respond(200, { status: 'running' });
    return respond(404, { message: 'Không có route giả: ' + path });
  };
  return {
    handler,
    calls,
    instances,
    state,
    /** Đặt trạng thái hồ sơ (instanceId bắt buộc) cho API tiến độ và đối soát. */
    setInstanceStatus(entry: { instanceId: string } & Record<string, unknown>) {
      statuses.set(entry.instanceId, entry);
    },
    setAvailable(value: boolean) {
      state.available = value;
    },
    startCalls: () =>
      calls.filter(
        (call) => call.method === 'POST' && call.path === '/v1/internal/instances',
      ),
  };
}
