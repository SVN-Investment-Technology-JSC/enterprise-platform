import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import {
  buildApprovalRouteItems,
  loadApprovalRouteRows,
  parseSetApprovalRoute,
  selectApprovalBinding,
  type ApprovalBindingRow,
} from './hrm-approval-route';
import { HRM_REQUEST_TABLES, prepareHrmProcedureLink } from './hrm-procedure-links';

const T = '11111111-1111-4111-8111-111111111111';
const E = '22222222-2222-4222-8222-222222222222';
const R = '33333333-3333-4333-8333-333333333333';
const D_GENERAL = '44444444-4444-4444-8444-444444444444';
const D_REASON = '55555555-5555-4555-8555-555555555555';

const row = (
  id: string,
  kind: string,
  sub: string | null,
  mode: 'DIRECT' | 'PROCEDURE',
  proc: string | null = null,
): ApprovalBindingRow => ({ id, request_kind: kind, sub_type_code: sub, mode, procedure_definition_id: proc, configuration_status: 'ACTIVE' });

describe('chọn cách duyệt: riêng theo mã lý do, rồi tới chung của loại đơn', () => {
  it('cấu hình riêng thắng, kể cả DIRECT riêng thắng PROCEDURE chung', () => {
    const rows = [row('g', 'leave', null, 'PROCEDURE', D_GENERAL), row('s', 'leave', 'SICK', 'DIRECT')];
    expect(selectApprovalBinding(rows, 'leave', 'SICK')).toMatchObject({ binding: { id: 's' }, specific: true, conflict: false });
    expect(selectApprovalBinding(rows, 'leave', 'OTHER')).toMatchObject({ binding: { id: 'g' }, specific: false });
    expect(selectApprovalBinding(rows, 'leave')).toMatchObject({ binding: { id: 'g' }, specific: false });
  });

  it('không có cấu hình thì binding null (mặc định DIRECT); chỉ xét đúng loại đơn', () => {
    expect(selectApprovalBinding([row('o', 'ot', null, 'PROCEDURE', D_GENERAL)], 'leave', 'SICK').binding).toBeNull();
  });

  it('nhiều cấu hình mâu thuẫn trong cùng nhóm được báo conflict', () => {
    const rows = [row('a', 'ot', null, 'PROCEDURE', D_GENERAL), row('b', 'ot', null, 'DIRECT')];
    expect(selectApprovalBinding(rows, 'ot').conflict).toBe(true);
    expect(selectApprovalBinding([{ ...rows[0], configuration_status: 'CONFLICT' }], 'ot').conflict).toBe(true);
  });
});

describe('nạp lý do theo loại đơn', () => {
  it('đơn nghỉ lấy từ loại nghỉ, bốn loại đơn còn lại lấy từ danh mục lý do đúng loại; ứng lương và đính chính hồ sơ không có lý do', async () => {
    const db = {
      query: jest.fn(async (text: string) => {
        if (text.includes('FROM hrm_schema.leave_types'))
          return { rows: [{ id: 'lt1', code: 'SICK', name: 'Nghỉ ốm' }] };
        if (text.includes('FROM hrm_schema.request_reasons'))
          return {
            rows: [
              { id: 'r1', kind: 'OVERTIME', code: 'OT_WORK', name: 'Theo yêu cầu công việc' },
              { id: 'r2', kind: 'BUSINESS_TRIP', code: 'TRIP_PLAN', name: 'Công tác theo kế hoạch' },
              { id: 'r3', kind: 'ATTENDANCE_CORRECTION', code: 'COR_FORGOT', name: 'Quên chấm công' },
              { id: 'r4', kind: 'SHIFT_CHANGE', code: 'SC_PERSONAL', name: 'Việc cá nhân' },
              { id: 'r5', kind: 'LOAI_LA', code: 'X', name: 'Không thuộc loại đơn nào' },
            ],
          };
        return { rows: [] };
      }),
    };
    const rows = await loadApprovalRouteRows(db as never, T);
    expect(rows.reasons.map((r) => [r.requestKind, r.code])).toEqual([
      ['leave', 'SICK'],
      ['ot', 'OT_WORK'],
      ['business_trip', 'TRIP_PLAN'],
      ['correction', 'COR_FORGOT'],
      ['shift_change', 'SC_PERSONAL'],
    ]);
    const items = buildApprovalRouteItems(rows);
    expect(items.filter((i) => i.reasonCode).map((i) => i.label)).toEqual([
      'Nghỉ phép · Nghỉ ốm',
      'Làm thêm giờ · Theo yêu cầu công việc',
      'Công tác · Công tác theo kế hoạch',
      'Đổi ca · Việc cá nhân',
      'Giải trình công · Quên chấm công',
    ]);
    expect(items.filter((i) => !i.reasonCode)).toHaveLength(7);
    expect(items.filter((i) => ['advance', 'profile_correction'].includes(i.requestKind)).every((i) => !i.reasonCode)).toBe(true);
    // chỉ lý do còn dùng và chưa xóa được nạp
    const sql = db.query.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(sql).toContain('deleted_at IS NULL AND active=true');
  });
});

describe('PUT /approval-config: kiểm tra body', () => {
  it('chuẩn hóa loại đơn bí danh và mã lý do có khoảng trắng', () => {
    expect(parseSetApprovalRoute({ requestKind: 'LEAVE', reasonCode: ' SICK ', mode: 'DIRECT' })).toEqual({
      kind: 'leave',
      reasonCode: 'SICK',
      mode: 'DIRECT',
      definitionId: null,
    });
  });
  it('bỏ qua procedureDefinitionId khi DIRECT và yêu cầu UUID khi PROCEDURE', () => {
    expect(parseSetApprovalRoute({ requestKind: 'ot', mode: 'DIRECT', procedureDefinitionId: D_GENERAL }).definitionId).toBeNull();
    expect(parseSetApprovalRoute({ requestKind: 'ot', mode: 'PROCEDURE', procedureDefinitionId: D_GENERAL }).definitionId).toBe(D_GENERAL);
    expect(() => parseSetApprovalRoute({ requestKind: 'ot', mode: 'PROCEDURE' })).toThrow(BadRequestException);
  });
});

/**
 * Hàm chọn cấu hình khi GỬI đơn (`prepareHrmProcedureLink`) nhận `subTypeCode` = mã lý do cho cả năm loại đơn có lý do:
 * binding theo mã lý do thắng binding chung; không có binding riêng thì dùng binding chung.
 */
describe('gửi đơn chọn binding theo mã lý do cho cả năm loại đơn', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'token';
    global.fetch = jest.fn(async (url: unknown) => {
      const id = String(url).split('/').pop() as string;
      return { ok: true, status: 200, json: async () => ({ id, name: id, steps: [{ id: 's' }] }) } as unknown as Response;
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  function fakeDb(kind: HrmRequestKind, bindings: ApprovalBindingRow[]) {
    const inserts: unknown[][] = [];
    const db = {
      query: jest.fn(async (text: string, params: unknown[] = []) => {
        if (text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
        if (text.includes(`FROM hrm_schema.${HRM_REQUEST_TABLES[kind]} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`))
          return { rows: [{ id: R, employee_id: E, revision: 1, status: 'PENDING' }], rowCount: 1 };
        if (text.includes('INSERT INTO hrm_schema.procedure_links')) {
          inserts.push(params);
          return {
            rows: [{ id: 'l1', tenant_id: T, request_kind: kind, request_id: R, revision: 1, instance_id: null, sync_status: 'START_PENDING' }],
            rowCount: 1,
          };
        }
        if (text.includes('FROM hrm_schema.procedure_links')) return { rows: [], rowCount: 0 };
        if (text.includes('FROM hrm_schema.request_procedure_bindings')) {
          const found = bindings.filter(
            (b) => b.request_kind === params[1] && (b.sub_type_code == null || b.sub_type_code === params[2]),
          );
          return { rows: found, rowCount: found.length };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    return { db: db as unknown as PoolClient, inserts };
  }

  const submission = (kind: HrmRequestKind, subTypeCode?: string) => ({
    tenantId: T,
    kind,
    requestId: R,
    revision: 1,
    employeeId: E,
    initiatedBy: E,
    title: 'Đơn',
    subTypeCode,
  });

  const kinds: HrmRequestKind[] = ['leave', 'ot', 'business_trip', 'shift_change', 'correction'];

  it.each(kinds)('%s: binding riêng theo mã lý do thắng binding chung', async (kind) => {
    const { db, inserts } = fakeDb(kind, [
      row('general', kind, null, 'PROCEDURE', D_GENERAL),
      row('reason', kind, 'LY_DO_X', 'PROCEDURE', D_REASON),
    ]);
    await prepareHrmProcedureLink(db, submission(kind, 'LY_DO_X'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][9]).toBe('reason'); // binding_id
    expect(inserts[0][10]).toBe(D_REASON); // definition_id
  });

  it.each(kinds)('%s: lý do không có binding riêng thì dùng binding chung', async (kind) => {
    const { db, inserts } = fakeDb(kind, [
      row('general', kind, null, 'PROCEDURE', D_GENERAL),
      row('reason', kind, 'LY_DO_X', 'PROCEDURE', D_REASON),
    ]);
    await prepareHrmProcedureLink(db, submission(kind, 'LY_DO_KHAC'));
    expect(inserts[0][9]).toBe('general');
    expect(inserts[0][10]).toBe(D_GENERAL);
    const { db: db2, inserts: inserts2 } = fakeDb(kind, [row('general', kind, null, 'PROCEDURE', D_GENERAL)]);
    await prepareHrmProcedureLink(db2, submission(kind));
    expect(inserts2[0][9]).toBe('general');
  });

  it.each(kinds)('%s: DIRECT riêng của lý do thắng PROCEDURE chung (không tạo liên kết)', async (kind) => {
    const { db, inserts } = fakeDb(kind, [
      row('general', kind, null, 'PROCEDURE', D_GENERAL),
      row('reason', kind, 'LY_DO_X', 'DIRECT'),
    ]);
    await expect(prepareHrmProcedureLink(db, submission(kind, 'LY_DO_X'))).resolves.toBeNull();
    expect(inserts).toHaveLength(0);
  });
});
