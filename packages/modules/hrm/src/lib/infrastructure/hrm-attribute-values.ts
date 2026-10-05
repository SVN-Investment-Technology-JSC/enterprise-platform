import { BadRequestException } from '@nestjs/common';
import {
  buildFlowIndex,
  firstFlowStepId,
  type ProcedureDefinition,
} from '@enterprise-platform/contracts-procedure-engine';

/**
 * Chuẩn hóa giá trị thuộc tính kiểu `file` / `user` theo định dạng Procedure Engine mong đợi
 * (đọc từ procedure-attributes.ts của PE):
 *  - `file`: mảng chuỗi (id đính kèm), PE không kiểm id; HRM dùng id đính kèm HRM.
 *  - `user`: chuỗi id người dùng Platform (`core_schema.employees.user_id`) kèm `label` tên hiển thị,
 *    KHÔNG phải id nhân viên HRM (form HRM chọn theo id nhân viên).
 */

export interface ProcedureAttributeSpec {
  code: string;
  type: string;
  valueKey: string;
  name?: string;
  scope?: 'process' | 'step';
  stepName?: string;
  options?: ReadonlyArray<{ code: string; label: string }>;
}

export function initialProcedureAttributes(definition: ProcedureDefinition) {
  const steps = definition.steps ?? [];
  const firstId = steps.length
    ? firstFlowStepId(buildFlowIndex(steps, definition.gateways))
    : null;
  const first = steps.find((step) => step.id === firstId);
  return [
    ...(definition.attributes ?? []).map((attribute) => ({
      ...attribute,
      scope: 'process' as const,
      valueKey: `process:${attribute.code}`,
      stepName: undefined as string | undefined,
    })),
    ...(first?.attributes ?? []).map((attribute) => ({
      ...attribute,
      scope: 'step' as const,
      valueKey: `step:${first!.id}:${attribute.code}`,
      stepName: first!.name,
    })),
  ];
}

export interface EmployeeUserRef {
  employeeId: string;
  userId: string | null;
  name: string;
}
/** Bản đồ tra cứu theo cả employeeId lẫn userId. */
export type EmployeeUserMap = ReadonlyMap<string, EmployeeUserRef>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rawOf(input: unknown): unknown {
  return input && typeof input === 'object' && !Array.isArray(input) && 'value' in input
    ? (input as { value: unknown }).value
    : input;
}

function slot(
  attributes: Record<string, unknown>,
  spec: ProcedureAttributeSpec,
): string | undefined {
  if (attributes[spec.valueKey] !== undefined) return spec.valueKey;
  if (attributes[spec.code] !== undefined) return spec.code;
  return undefined;
}

/** Các id (nhân viên hoặc người dùng) cần tra tên/userId trong thuộc tính kiểu `user`. */
export function collectUserReferences(
  specs: readonly ProcedureAttributeSpec[],
  attributes: Record<string, unknown>,
): string[] {
  const ids = new Set<string>();
  for (const spec of specs) {
    if (spec.type !== 'user') continue;
    const key = slot(attributes, spec);
    const raw = key ? rawOf(attributes[key]) : undefined;
    if (typeof raw === 'string' && UUID.test(raw.trim())) ids.add(raw.trim());
  }
  return [...ids];
}

/** Đưa giá trị `file`/`user` về dạng PE chấp nhận; thuộc tính khác giữ nguyên. */
export function normalizeAttributesForProcedure(
  specs: readonly ProcedureAttributeSpec[],
  attributes: Record<string, unknown>,
  users: EmployeeUserMap = new Map(),
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...attributes };
  for (const spec of specs) {
    const key = slot(result, spec);
    if (!key) continue;
    const raw = rawOf(result[key]);
    if (spec.type === 'file') {
      const list = (Array.isArray(raw) ? raw : [raw]).filter(
        (item): item is string => typeof item === 'string' && item.trim() !== '',
      );
      result[key] = { type: 'file', value: [...new Set(list.map((i) => i.trim()))] };
    } else if (spec.type === 'user' && typeof raw === 'string' && raw.trim()) {
      const ref = users.get(raw.trim());
      if (!ref) continue; // không tra được: giữ nguyên để PE quyết định
      if (!ref.userId)
        throw new BadRequestException(
          `Nhân viên “${ref.name}” chưa có tài khoản người dùng nên không thể chọn làm “${spec.name ?? spec.code}”`,
        );
      result[key] = { type: 'user', value: ref.userId, label: ref.name };
    }
  }
  return result;
}

export interface SubmittedAttributeView {
  key: string;
  code: string;
  name: string;
  type: string;
  scope: 'process' | 'step';
  stepName?: string;
  /** Chuỗi hiển thị cho mọi kiểu trừ `file`. */
  display: string;
  files?: Array<{ id: string; name: string }>;
}

const dateFmt = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

/** Dựng danh sách thuộc tính đã nhập của đơn để hiển thị (tên người, tên tệp đã tra sẵn). */
export function describeSubmittedAttributes(
  specs: readonly ProcedureAttributeSpec[],
  attributes: Record<string, unknown>,
  users: EmployeeUserMap,
  fileNames: ReadonlyMap<string, string>,
): SubmittedAttributeView[] {
  const out: SubmittedAttributeView[] = [];
  for (const spec of specs) {
    const key = slot(attributes, spec);
    if (!key) continue;
    const input = attributes[key];
    const raw = rawOf(input);
    if (raw === undefined || raw === null || raw === '') continue;
    const base = {
      key: spec.valueKey,
      code: spec.code,
      name: spec.name ?? spec.code,
      type: spec.type,
      scope: spec.scope ?? ('process' as const),
      stepName: spec.stepName,
    };
    if (spec.type === 'file') {
      const ids = (Array.isArray(raw) ? raw : [raw]).filter(
        (item): item is string => typeof item === 'string' && item !== '',
      );
      if (!ids.length) continue;
      out.push({
        ...base,
        display: `${ids.length} tệp`,
        files: ids.map((id) => ({ id, name: fileNames.get(id) ?? 'Tệp đính kèm' })),
      });
    } else if (spec.type === 'user') {
      const label =
        input && typeof input === 'object' && 'label' in input
          ? String((input as { label?: unknown }).label ?? '').trim()
          : '';
      const id = String(raw).trim();
      out.push({ ...base, display: label || users.get(id)?.name || 'Người dùng đã chọn' });
    } else if (spec.type === 'boolean') {
      out.push({ ...base, display: raw === true ? 'Có' : 'Không' });
    } else if (spec.type === 'date') {
      out.push({ ...base, display: dateFmt(String(raw)) });
    } else if (spec.type === 'select') {
      out.push({
        ...base,
        display: spec.options?.find((o) => o.code === raw)?.label ?? String(raw),
      });
    } else if (spec.type === 'money') {
      out.push({ ...base, display: `${Number(raw).toLocaleString('vi-VN')} VND` });
    } else if (spec.type === 'percent') {
      out.push({ ...base, display: `${raw}%` });
    } else {
      out.push({ ...base, display: String(raw) });
    }
  }
  return out;
}

type Queryable = {
  query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }>;
};

/** Tra cứu employeeId/userId -> tên + userId (đọc core_schema.employees, như hrm-approval-policy). */
export async function loadEmployeeUserMap(
  db: Queryable,
  tenantId: string,
  ids: readonly string[],
): Promise<EmployeeUserMap> {
  const map = new Map<string, EmployeeUserRef>();
  if (!ids.length) return map;
  const rows = (
    await db.query(
      `SELECT id, user_id, full_name FROM core_schema.employees WHERE tenant_id=$1 AND (id = ANY($2::uuid[]) OR user_id = ANY($2::uuid[]))`,
      [tenantId, ids],
    )
  ).rows;
  for (const row of rows) {
    const ref: EmployeeUserRef = {
      employeeId: row.id,
      userId: row.user_id ?? null,
      name: row.full_name,
    };
    if (ref.userId) map.set(ref.userId, ref);
    map.set(ref.employeeId, ref);
  }
  return map;
}
