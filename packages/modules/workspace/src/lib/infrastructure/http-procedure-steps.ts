import type {
  ProcedureGatewayView,
  ProcedureStepEvent,
  ProcedureStepView,
  ProcedureStepViewStatus,
} from '@enterprise-platform/contracts-workspace';
import type { ProcedureStepsReader, ProcedureStepsSnapshot } from '../application/procedure-steps.port.js';

const STEP_STATUSES: readonly ProcedureStepViewStatus[] = [
  'pending',
  'active',
  'ready',
  'completed',
  'returned',
  'rejected',
  'cancelled',
  'skipped',
];
const MAX_STEPS = 200;
const MAX_EVENTS = 50;
const MAX_GATEWAYS = 20;
const MAX_BRANCHES = 20;
const MAX_BRANCH_STEPS = 100;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * Gọi `GET /v1/internal/instances/:id/step-overview` của Quy trình bằng service token. Không ném lỗi:
 * 404 là `undefined` (hồ sơ không còn), mọi lỗi khác là `'unavailable'`. Kết quả được ánh xạ lại
 * từng trường nên Quy trình trả thừa hay thiếu đều không làm vỡ Workspace.
 */
export class HttpProcedureStepsReader implements ProcedureStepsReader {
  constructor(
    private readonly procedureApiUrl: string = process.env['PROCEDURE_API_URL'] ??
      'http://localhost:3334/api/procedure',
  ) {}

  async read(tenantId: string, instanceId: string): Promise<ProcedureStepsSnapshot | undefined | 'unavailable'> {
    const token = process.env['INTERNAL_SERVICE_TOKEN'];
    if (!token) return 'unavailable';
    try {
      const response = await fetch(
        `${this.procedureApiUrl}/v1/internal/instances/${encodeURIComponent(instanceId)}/step-overview`,
        {
          headers: { 'x-tenant-id': tenantId, 'x-service-token': token },
          signal: AbortSignal.timeout(8000),
          redirect: 'error',
        },
      );
      if (response.status === 404) {
        // Chỉ mã nghiệp vụ not_found của Quy trình mới nghĩa là hồ sơ không còn; 404 của gateway hay route
        // chưa triển khai là lỗi hạ tầng, báo "tạm thời không đọc được".
        const body = record(await response.json().catch(() => undefined));
        return body['error'] === 'not_found' || body['code'] === 'not_found' ? undefined : 'unavailable';
      }
      if (!response.ok) return 'unavailable';
      return mapOverview(await response.json());
    } catch {
      return 'unavailable';
    }
  }
}

function mapOverview(raw: unknown): ProcedureStepsSnapshot | 'unavailable' {
  const body = record(raw);
  const instanceId = text(body['instanceId']);
  if (!instanceId) return 'unavailable';
  const steps: ProcedureStepView[] = (Array.isArray(body['steps']) ? body['steps'] : [])
    .slice(0, MAX_STEPS)
    .map(record)
    .filter((step) => text(step['id']))
    .map((step, index) => ({
      id: String(step['id']),
      name: text(step['name']) ?? '',
      order: finite(step['order']) ?? index + 1,
      status: STEP_STATUSES.find((candidate) => candidate === step['status']) ?? 'pending',
      roleStage: text(step['roleStage']) ?? null,
      assigneeLabel: text(step['assigneeLabel']) ?? '',
      slaHours: finite(step['slaHours']),
      slaDueAt: text(step['slaDueAt']),
      startedAt: text(step['startedAt']),
      completedAt: text(step['completedAt']),
    }));
  const events: ProcedureStepEvent[] = (Array.isArray(body['events']) ? body['events'] : [])
    .slice(0, MAX_EVENTS)
    .map(record)
    .filter((event) => text(event['id']) && text(event['action']))
    .map((event) => ({
      id: String(event['id']),
      action: String(event['action']),
      actorName: text(event['actorName']) ?? '',
      createdAt: text(event['createdAt']) ?? '',
      stepId: text(event['stepId']),
    }));
  const gateways = mapGateways(body['gateways']);
  const progress = record(body['progress']);
  const completed = finite(progress['completed']);
  const total = finite(progress['total']);
  return {
    instanceId,
    instanceCode: text(body['instanceCode']),
    status: text(body['status']),
    currentStepId: text(body['currentStepId']),
    completedAt: text(body['completedAt']),
    progress: completed !== undefined && total !== undefined ? { completed, total } : undefined,
    steps,
    ...(gateways.length > 0 ? { gateways } : {}),
    events,
  };
}

function mapGateways(raw: unknown): ProcedureGatewayView[] {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, MAX_GATEWAYS)
    .map(record)
    .filter((gateway) => text(gateway['id']) && text(gateway['afterStepId']))
    .map((gateway) => {
      const chosenBranchId = text(gateway['chosenBranchId']);
      return {
        id: String(gateway['id']),
        name: text(gateway['name']) ?? '',
        afterStepId: String(gateway['afterStepId']),
        ...(chosenBranchId ? { chosenBranchId } : {}),
        branches: (Array.isArray(gateway['branches']) ? gateway['branches'] : [])
          .slice(0, MAX_BRANCHES)
          .map(record)
          .filter((branch) => text(branch['id']))
          .map((branch) => ({
            id: String(branch['id']),
            label: text(branch['label']) ?? '',
            isDefault: branch['isDefault'] === true,
            stepIds: (Array.isArray(branch['stepIds']) ? branch['stepIds'] : [])
              .slice(0, MAX_BRANCH_STEPS)
              .map(text)
              .filter((id): id is string => !!id),
          })),
      };
    });
}
