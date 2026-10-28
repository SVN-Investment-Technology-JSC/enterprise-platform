export interface ParsedTaskId {
  module: string;
  kind?: string;
  entityId: string;
  raw: string;
}

/**
 * Phân tích chuỗi taskId thành các thành phần cấu thành (module, kind, entityId).
 * Ví dụ:
 * - 'hrm:correction:50458af3-...' -> { module: 'hrm', kind: 'correction', entityId: '50458af3-...', raw: ... }
 * - 'inventory:transfer:123' -> { module: 'inventory', kind: 'transfer', entityId: '123', raw: ... }
 * - 'procedure:step-456' -> { module: 'procedure', kind: undefined, entityId: 'step-456', raw: ... }
 */
export function parseTaskId(taskId: string): ParsedTaskId {
  try {
    const decoded = decodeURIComponent(taskId).trim();
    const parts = decoded.split(':');
    if (parts.length >= 3) {
      return {
        module: parts[0],
        kind: parts[1],
        entityId: parts.slice(2).join(':'),
        raw: decoded,
      };
    }
    if (parts.length === 2) {
      return {
        module: parts[0],
        kind: undefined,
        entityId: parts[1],
        raw: decoded,
      };
    }
    return {
      module: 'unknown',
      kind: undefined,
      entityId: decoded,
      raw: decoded,
    };
  } catch {
    return {
      module: 'unknown',
      kind: undefined,
      entityId: taskId,
      raw: taskId,
    };
  }
}

/**
 * Phân giải đường dẫn endpoint API theo cấu trúc taskId và hậu tố (suffix).
 * Ví dụ:
 * - resolveTaskApiEndpoint('hrm:correction:50458af3-...') -> '/api/hrm/v1/tasks/correction/50458af3-...'
 * - resolveTaskApiEndpoint('hrm:correction:50458af3-...', '/actions') -> '/api/hrm/v1/tasks/correction/50458af3-.../actions'
 * - resolveTaskApiEndpoint('procedure:step-1', '/actions') -> '/api/procedure/v1/tasks/step-1/actions'
 */
export function resolveTaskApiEndpoint(taskId: string, suffix = ''): string {
  const parsed = parseTaskId(taskId);
  if (parsed.module !== 'unknown') {
    if (parsed.kind) {
      return `/api/${encodeURIComponent(parsed.module)}/v1/tasks/${encodeURIComponent(parsed.kind)}/${encodeURIComponent(parsed.entityId)}${suffix}`;
    }
    return `/api/${encodeURIComponent(parsed.module)}/v1/tasks/${encodeURIComponent(parsed.entityId)}${suffix}`;
  }
  return `/api/tasks/${encodeURIComponent(taskId)}${suffix}`;
}
