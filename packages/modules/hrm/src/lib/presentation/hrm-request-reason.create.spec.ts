import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));
jest.mock('../infrastructure/hrm-procedure-sync.js', () => ({
  syncEmployeeProcedureResults: jest.fn(async () => undefined),
}));
jest.mock('../infrastructure/hrm-request-overlap.js', () => ({
  ...jest.requireActual('../infrastructure/hrm-request-overlap.js'),
  assertNoRequestOverlap: jest.fn(async () => undefined),
}));
jest.mock('../infrastructure/hrm-time.js', () => ({
  ...jest.requireActual('../infrastructure/hrm-time.js'),
  assertOpenDate: jest.fn(async () => undefined),
  assertOpenRange: jest.fn(async () => undefined),
  lockEmployee: jest.fn(async () => undefined),
  resolvePolicy: jest.fn(async () => ({
    id: 'policy-1',
    config_json: { timezone: 'Asia/Ho_Chi_Minh' },
  })),
  scheduleDayTypeOf: jest.fn(async () => null),
  shiftForDate: jest.fn(async () => null),
}));
jest.mock('../infrastructure/hrm-overtime.js', () => ({
  createOvertime: jest.fn(),
  approveOvertime: jest.fn(),
}));
jest.mock('../infrastructure/hrm-approval-notification.js', () => ({
  ...jest.requireActual('../infrastructure/hrm-approval-notification.js'),
  notifyApproversOfDirectRequest: jest.fn(async () => undefined),
}));
jest.mock('../infrastructure/hrm-procedure-links.js', () => ({
  ...jest.requireActual('../infrastructure/hrm-procedure-links.js'),
  prepareHrmProcedureLink: jest.fn(async () => null),
}));
jest.mock('../infrastructure/hrm-leave-operations.js', () => {
  const actual = jest.requireActual('../infrastructure/hrm-leave-operations.js');
  return { ...actual, transitionLeave: jest.fn(async () => ({})) };
});

import { HrmRequestController } from './hrm-request.controller';
import { HrmAttendanceController } from './hrm-attendance.controller';
import { HrmLeaveController } from './hrm-leave.controller';
import { createOvertime } from '../infrastructure/hrm-overtime.js';
import { shiftForDate } from '../infrastructure/hrm-time.js';
import { prepareHrmProcedureLink } from '../infrastructure/hrm-procedure-links.js';

const T = '11111111-1111-4111-8111-111111111111';
const E = '22222222-2222-4222-8222-222222222222';
const U = '55555555-5555-4555-8555-555555555555';
const SHIFT_A = '66666666-6666-4666-8666-666666666666';
const SHIFT_B = '77777777-7777-4777-8777-777777777777';
const LEAVE_TYPE = '88888888-8888-4888-8888-888888888888';
const OLD_LEAVE = '99999999-9999-4999-8999-999999999999';

type Row = Record<string, unknown>;

interface ReasonRow {
  id: string;
  kind: string;
  code: string;
  name: string;
  paid: boolean;
  requires_description: boolean;
  active: boolean;
}

const reasonRow = (kind: string, over: Partial<ReasonRow> = {}): ReasonRow => ({
  id: randomUUID(),
  kind,
  code: `${kind}_CODE`,
  name: `Lý do ${kind}`,
  paid: true,
  requires_description: false,
  active: true,
  ...over,
});

const LEAVE_TYPE_ROW = {
  id: LEAVE_TYPE,
  tenant_id: T,
  code: 'NGHI_OM',
  name: 'Nghỉ ốm',
  paid: true,
  unit: 'DAYS',
  deduct_balance: false,
  requires_attachment: false,
  negative_limit: 0,
};

/**
 * CSDL giả: ghi lại các câu INSERT ... RETURNING * (cột -> giá trị) và trả đúng dòng danh mục lý do theo
 * tenant, id, loại đơn như câu SQL thật.
 */
function createHarness(
  reasons: ReasonRow[],
  extra: { leaveRow?: Row; draft?: Row; shiftRow?: Row } = {},
) {
  const inserts: { table: string; row: Row }[] = [];
  const queries: string[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    queries.push(sql);
    const empty = { rows: [], rowCount: 0 };
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return empty;
    const insert =
      /INSERT INTO hrm_schema\.(\w+)\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*RETURNING \*/i.exec(
        sql,
      );
    if (insert) {
      const columns = insert[2].split(',').map((c) => c.trim());
      const values = insert[3].split(',').map((v) => v.trim());
      const row: Row = {
        id: `req-${inserts.length + 1}`,
        tenant_id: T,
        status: 'PENDING',
        revision: 1,
        created_at: new Date('2026-10-10T00:00:00Z'),
        updated_at: new Date('2026-10-10T00:00:00Z'),
      };
      columns.forEach((column, index) => {
        const value = values[index];
        row[column] = value.startsWith('$')
          ? params[Number(value.slice(1)) - 1]
          : value.replace(/^'|'$/g, '');
      });
      inserts.push({ table: insert[1], row });
      return { rows: [row], rowCount: 1 };
    }
    if (/FROM hrm_schema\.employee_profiles/.test(sql))
      return { rows: [{ employment_status: 'ACTIVE' }], rowCount: 1 };
    if (/FROM hrm_schema\.request_reasons/.test(sql)) {
      const found = reasons.filter(
        (r) =>
          r.id === params[1] &&
          (sql.includes('kind = $3') ? r.kind === params[2] : true),
      );
      return { rows: found, rowCount: found.length };
    }
    if (/SELECT code FROM hrm_schema\.leave_types/.test(sql))
      return { rows: [{ code: LEAVE_TYPE_ROW.code }], rowCount: 1 };
    if (/SELECT code,name,paid FROM hrm_schema\.leave_types/.test(sql))
      return { rows: [LEAVE_TYPE_ROW], rowCount: 1 };
    if (/FROM hrm_schema\.leave_types/.test(sql))
      return { rows: [LEAVE_TYPE_ROW], rowCount: 1 };
    if (/generate_series/.test(sql)) {
      const [from, to] = sql.includes('work_calendar')
        ? [params[1], params[2]]
        : [params[0], params[1]];
      const days: Row[] = [];
      for (
        let t = Date.parse(String(from));
        t <= Date.parse(String(to));
        t += 86400000
      )
        days.push({ date: new Date(t).toISOString().slice(0, 10), day_kind: null });
      return { rows: days, rowCount: days.length };
    }
    if (/FROM hrm_schema\.shift_definitions/.test(sql))
      return { rows: [{ id: SHIFT_A }, { id: SHIFT_B }], rowCount: 2 };
    if (/AT TIME ZONE/.test(sql))
      return {
        rows: [{ start: '2025-01-05T17:00:00Z', end: '2025-01-06T17:00:00Z' }],
        rowCount: 1,
      };
    if (/FROM hrm_schema\.request_drafts/.test(sql))
      return extra.draft
        ? { rows: [extra.draft], rowCount: 1 }
        : empty;
    if (
      /SELECT \* FROM hrm_schema\.leave_requests WHERE tenant_id=\$1 AND id=\$2 FOR UPDATE/.test(
        sql,
      )
    )
      return extra.leaveRow
        ? { rows: [extra.leaveRow], rowCount: 1 }
        : empty;
    if (/FROM hrm_schema\.shift_change_requests WHERE tenant_id=\$1 AND id=\$2 FOR UPDATE/.test(sql))
      return extra.shiftRow
        ? { rows: [extra.shiftRow], rowCount: 1 }
        : empty;
    if (/UPDATE hrm_schema\.shift_change_requests SET swap_peer_confirmed/.test(sql))
      return {
        rows: [{ ...extra.shiftRow, swap_peer_confirmed: true, status: 'PEER_CONFIRMED' }],
        rowCount: 1,
      };
    if (/SELECT employee_id FROM hrm_schema\.leave_requests/.test(sql))
      return { rows: [{ employee_id: E }], rowCount: 1 };
    return empty;
  });
  const client = { query, release: jest.fn() };
  const pool = { query, connect: jest.fn(async () => client) };
  const ctx = {
    getRequestContext: async () => ({
      pool,
      tenantId: T,
      employeeId: E,
      principal: { userId: U, permissions: [] },
    }),
    getContext: async () => ({
      pool,
      tenantId: T,
      principal: { userId: U, permissions: [] },
    }),
    resolveEmployee: async () => ({ employeeId: E }),
  };
  return { pool, ctx: ctx as never, inserts, queries };
}

const req = { headers: {} } as Request;
const bridge = { startOrResume: jest.fn() } as never;
const prepare = prepareHrmProcedureLink as unknown as jest.Mock;

const tripBody = {
  employeeId: E,
  destination: 'Hà Nội',
  fromDate: '2026-10-12',
  toDate: '2026-10-13',
  daysCount: 2,
};
const shiftBody = {
  employeeId: E,
  changeType: 'CHANGE_SHIFT' as const,
  currentShiftId: SHIFT_A,
  requestedShiftId: SHIFT_B,
  fromDate: '2026-10-12',
  toDate: '2026-10-12',
};
const correctionBody = {
  employeeId: E,
  requestDate: '2025-01-06',
  sessions: [
    { start: '2025-01-06T02:00:00Z', end: '2025-01-06T10:00:00Z' },
  ],
};
const otBody = {
  employeeId: E,
  workDate: '2026-10-12',
  startTime: '18:00',
  endTime: '20:00',
  plannedMinutes: 120,
};

interface RequestCase {
  name: string;
  reasonKind: string;
  table: string;
  create: (
    harness: ReturnType<typeof createHarness>,
    body: Record<string, unknown>,
  ) => Promise<{ data: Row }>;
  baseBody: Record<string, unknown>;
}

const CASES: RequestCase[] = [
  {
    name: 'công tác',
    reasonKind: 'BUSINESS_TRIP',
    table: 'business_trip_requests',
    baseBody: tripBody,
    create: (h, body) =>
      new HrmRequestController(h.ctx, bridge).createBusinessTripRequest(
        req,
        body as never,
      ) as Promise<{ data: Row }>,
  },
  {
    name: 'đổi ca',
    reasonKind: 'SHIFT_CHANGE',
    table: 'shift_change_requests',
    baseBody: shiftBody,
    create: (h, body) =>
      new HrmRequestController(h.ctx, bridge).createShiftChangeRequest(
        req,
        body as never,
      ) as Promise<{ data: Row }>,
  },
  {
    name: 'giải trình công',
    reasonKind: 'ATTENDANCE_CORRECTION',
    table: 'attendance_corrections',
    baseBody: correctionBody,
    create: (h, body) =>
      new HrmAttendanceController(h.ctx, bridge).createCorrection(
        req,
        body as never,
      ) as Promise<{ data: Row }>,
  },
];

beforeEach(() => {
  prepare.mockClear();
  (createOvertime as jest.Mock).mockReset();
  (shiftForDate as jest.Mock).mockResolvedValue(null);
});

describe.each(CASES)(
  'đơn $name: lý do chọn từ danh mục, mô tả tự do',
  ({ reasonKind, table, create, baseBody }) => {
    it('thiếu reasonId bị từ chối (400) và không ghi đơn; reason tự do cũ không thay được lý do', async () => {
      const h = createHarness([reasonRow(reasonKind)]);
      await expect(create(h, { ...baseBody })).rejects.toThrow(/Chọn lý do/);
      await expect(
        create(h, { ...baseBody, reason: 'Lý do nhập tự do' }),
      ).rejects.toThrow(/Chọn lý do/);
      await expect(
        create(h, { ...baseBody, description: 'Chỉ có mô tả' }),
      ).rejects.toThrow(/Chọn lý do/);
      expect(h.inserts).toHaveLength(0);
    });

    it('lý do ngừng dùng, sai loại đơn hoặc không có trong danh mục bị từ chối', async () => {
      const inactive = reasonRow(reasonKind, { active: false, name: 'Đã khóa' });
      const wrongKind = reasonRow(
        reasonKind === 'SHIFT_CHANGE' ? 'OVERTIME' : 'SHIFT_CHANGE',
      );
      const h = createHarness([inactive, wrongKind]);
      await expect(
        create(h, { ...baseBody, reasonId: inactive.id }),
      ).rejects.toThrow(/Đã khóa.*ngừng sử dụng/);
      await expect(
        create(h, { ...baseBody, reasonId: wrongKind.id }),
      ).rejects.toThrow(/không có trong danh mục/);
      await expect(
        create(h, { ...baseBody, reasonId: randomUUID() }),
      ).rejects.toThrow(/không có trong danh mục/);
      await expect(
        create(h, { ...baseBody, reasonId: 'khong-phai-uuid' }),
      ).rejects.toThrow(/UUID không hợp lệ/);
      expect(h.inserts).toHaveLength(0);
    });

    it('lý do yêu cầu mô tả: thiếu mô tả bị từ chối, có mô tả thì lưu', async () => {
      const other = reasonRow(reasonKind, {
        requires_description: true,
        name: 'Khác',
        code: 'OTHER',
      });
      const h = createHarness([other]);
      await expect(
        create(h, { ...baseBody, reasonId: other.id }),
      ).rejects.toThrow(/Khác.*cần nhập mô tả/);
      expect(h.inserts).toHaveLength(0);
      await create(h, {
        ...baseBody,
        reasonId: other.id,
        description: 'Chi tiết lý do khác',
      });
      expect(h.inserts).toHaveLength(1);
      expect(h.inserts[0].row['reason']).toBe('Chi tiết lý do khác');
    });

    it('lưu reason_id, reason_name và mô tả ở cột reason; trả reasonId, reasonName, description', async () => {
      const chosen = reasonRow(reasonKind, { name: 'Lý do đã chọn' });
      const h = createHarness([chosen]);
      const { data } = await create(h, {
        ...baseBody,
        reasonId: chosen.id,
        description: '  Mô tả tự do  ',
      });
      expect(h.inserts).toHaveLength(1);
      expect(h.inserts[0].table).toBe(table);
      expect(h.inserts[0].row).toMatchObject({
        reason_id: chosen.id,
        reason_name: 'Lý do đã chọn',
        reason: 'Mô tả tự do',
      });
      expect(data).toMatchObject({
        reasonId: chosen.id,
        reasonName: 'Lý do đã chọn',
        description: 'Mô tả tự do',
        reason: 'Mô tả tự do',
      });
    });

    it('không nhập mô tả: cột reason (NOT NULL) lưu chuỗi rỗng, đọc ra description null', async () => {
      const chosen = reasonRow(reasonKind);
      const h = createHarness([chosen]);
      const { data } = await create(h, { ...baseBody, reasonId: chosen.id });
      expect(h.inserts[0].row['reason']).toBe('');
      expect(data).toMatchObject({
        reasonId: chosen.id,
        reasonName: chosen.name,
        description: null,
        reason: '',
      });
    });

    it('bí danh reason hoạt động như description; gửi cả hai thì description thắng', async () => {
      const chosen = reasonRow(reasonKind);
      const h = createHarness([chosen]);
      await create(h, {
        ...baseBody,
        reasonId: chosen.id,
        reason: 'Mô tả qua bí danh',
      });
      await create(h, {
        ...baseBody,
        reasonId: chosen.id,
        reason: 'Mô tả cũ',
        description: 'Mô tả mới',
      });
      expect(h.inserts.map((i) => i.row['reason'])).toEqual([
        'Mô tả qua bí danh',
        'Mô tả mới',
      ]);
    });

    it('chọn cách duyệt theo MÃ LÝ DO (sub_type_code)', async () => {
      const chosen = reasonRow(reasonKind, { code: 'MA_LY_DO' });
      const h = createHarness([chosen]);
      await create(h, { ...baseBody, reasonId: chosen.id });
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(prepare.mock.calls[0][1]).toMatchObject({
        subTypeCode: 'MA_LY_DO',
        fieldRow: expect.objectContaining({ reason_id: chosen.id }),
      });
    });

    it('gửi từ bản nháp đi qua cùng kiểm tra: nháp cũ chỉ có reason tự do bị từ chối, nháp có reasonId và mô tả được lưu', async () => {
      const chosen = reasonRow(reasonKind, { name: 'Lý do từ nháp' });
      const draftRow = (payload: Row): Row => ({
        id: randomUUID(),
        employee_id: E,
        request_kind: 'x',
        status: 'DRAFT',
        revision: 1,
        updated_at: new Date('2026-10-09T00:00:00Z'),
        payload,
      });
      const legacy = draftRow({ ...baseBody, reason: 'Lý do tự do cũ' });
      const legacyHarness = createHarness([chosen], { draft: legacy });
      await expect(
        create(legacyHarness, {
          draftId: legacy['id'],
          expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
        }),
      ).rejects.toThrow(/Chọn lý do/);
      expect(legacyHarness.inserts).toHaveLength(0);

      const saved = draftRow({
        ...baseBody,
        reasonId: chosen.id,
        description: 'Mô tả trong nháp',
      });
      const h = createHarness([chosen], { draft: saved });
      const { data } = await create(h, {
        draftId: saved['id'],
        expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
      });
      expect(h.inserts[0].row).toMatchObject({
        reason_id: chosen.id,
        reason_name: 'Lý do từ nháp',
        reason: 'Mô tả trong nháp',
      });
      expect(data).toMatchObject({ reasonName: 'Lý do từ nháp' });
    });
  },
);

describe('đổi ca: đồng nghiệp xác nhận xong thì chọn cách duyệt theo mã lý do của đơn', () => {
  it('peer-confirm truyền subTypeCode = mã lý do', async () => {
    const chosen = reasonRow('SHIFT_CHANGE', { code: 'SC_PERSONAL', name: 'Việc cá nhân' });
    const requestId = randomUUID();
    const shiftRow = {
      id: requestId,
      tenant_id: T,
      employee_id: U,
      status: 'PENDING',
      swap_with_employee_id: E,
      swap_peer_confirmed: false,
      submitted_by: U,
      submitted_attributes: {},
      revision: 1,
      reason: 'Đổi lịch trực',
      reason_id: chosen.id,
      reason_name: 'Việc cá nhân',
      change_type: 'SWAP',
      current_shift_id: SHIFT_A,
      requested_shift_id: SHIFT_B,
      from_date: '2026-10-12',
      to_date: '2026-10-12',
      created_at: new Date('2026-10-10T00:00:00Z'),
      updated_at: new Date('2026-10-10T00:00:00Z'),
    };
    const h = createHarness([chosen], { shiftRow });
    const { data } = (await new HrmRequestController(
      h.ctx,
      bridge,
    ).peerConfirmShiftChange(req, requestId, true)) as { data: Row };
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][1]).toMatchObject({
      kind: 'shift_change',
      subTypeCode: 'SC_PERSONAL',
    });
    expect(data).toMatchObject({
      reasonId: chosen.id,
      reasonName: 'Việc cá nhân',
      description: 'Đổi lịch trực',
    });
  });
});

describe('đơn làm thêm giờ: lý do danh mục, có lương / không lương', () => {
  const createOt = (h: ReturnType<typeof createHarness>, body: Row) =>
    new HrmRequestController(h.ctx, bridge).createOtRequest(
      req,
      body as never,
    ) as Promise<{ data: Row }>;

  /** createOvertime giả: ghi dòng đơn như hàm thật (tên lý do, paid, mô tả) để kiểm tra việc truyền dữ liệu. */
  function stubCreateOvertime() {
    (createOvertime as jest.Mock).mockImplementation(
      async (
        _db: unknown,
        _tenant: string,
        body: Row,
        reason?: {
          reasonId: string;
          reasonName: string;
          paid: boolean;
          description: string | null;
        },
      ) => ({
        id: 'ot-1',
        tenant_id: T,
        employee_id: E,
        work_date: body['workDate'],
        start_time: body['startTime'],
        end_time: body['endTime'],
        planned_minutes: body['plannedMinutes'],
        ot_type: 'WEEKDAY',
        status: 'PENDING',
        reason: reason?.description ?? '',
        reason_id: reason?.reasonId ?? null,
        reason_name: reason?.reasonName ?? null,
        paid: reason?.paid ?? true,
        created_at: new Date('2026-10-10T00:00:00Z'),
        updated_at: new Date('2026-10-10T00:00:00Z'),
      }),
    );
  }

  it('thiếu reasonId, lý do ngừng dùng, sai loại hoặc cần mô tả bị từ chối trước khi tạo đơn', async () => {
    stubCreateOvertime();
    const inactive = reasonRow('OVERTIME', { active: false, name: 'Đã khóa' });
    const wrongKind = reasonRow('BUSINESS_TRIP');
    const other = reasonRow('OVERTIME', {
      requires_description: true,
      name: 'Khác',
    });
    const h = createHarness([inactive, wrongKind, other]);
    await expect(createOt(h, { ...otBody })).rejects.toThrow(/Chọn lý do/);
    await expect(
      createOt(h, { ...otBody, reason: 'Lý do tự do' }),
    ).rejects.toThrow(/Chọn lý do/);
    await expect(
      createOt(h, { ...otBody, reasonId: inactive.id }),
    ).rejects.toThrow(/ngừng sử dụng/);
    await expect(
      createOt(h, { ...otBody, reasonId: wrongKind.id }),
    ).rejects.toThrow(/không có trong danh mục/);
    await expect(
      createOt(h, { ...otBody, reasonId: other.id }),
    ).rejects.toThrow(/cần nhập mô tả/);
    expect(createOvertime).not.toHaveBeenCalled();
  });

  it('lưu reason_id, reason_name, paid theo lý do và mô tả ở cột reason', async () => {
    stubCreateOvertime();
    const unpaid = reasonRow('OVERTIME', {
      name: 'Làm bù không lương',
      paid: false,
      code: 'OT_UNPAID',
    });
    const h = createHarness([unpaid]);
    const { data } = await createOt(h, {
      ...otBody,
      reasonId: unpaid.id,
      description: 'Bù ngày nghỉ',
    });
    expect(createOvertime).toHaveBeenCalledTimes(1);
    expect((createOvertime as jest.Mock).mock.calls[0][3]).toEqual({
      reasonId: unpaid.id,
      reasonName: 'Làm bù không lương',
      paid: false,
      description: 'Bù ngày nghỉ',
    });
    expect(data).toMatchObject({
      reasonId: unpaid.id,
      reasonName: 'Làm bù không lương',
      description: 'Bù ngày nghỉ',
      reason: 'Bù ngày nghỉ',
      paid: false,
    });
    expect(prepare.mock.calls[0][1]).toMatchObject({ subTypeCode: 'OT_UNPAID' });
  });

  it('lý do có lương, không mô tả: paid true, description null; bí danh reason là mô tả', async () => {
    stubCreateOvertime();
    const paid = reasonRow('OVERTIME', { name: 'Theo yêu cầu công việc' });
    const h = createHarness([paid]);
    const first = await createOt(h, { ...otBody, reasonId: paid.id });
    expect(first.data).toMatchObject({ paid: true, description: null, reason: '' });
    const alias = await createOt(h, {
      ...otBody,
      reasonId: paid.id,
      reason: 'Mô tả qua bí danh',
    });
    expect(alias.data).toMatchObject({
      description: 'Mô tả qua bí danh',
      paid: true,
    });
    const both = await createOt(h, {
      ...otBody,
      reasonId: paid.id,
      reason: 'Cũ',
      description: 'Mới',
    });
    expect(both.data).toMatchObject({ description: 'Mới' });
  });
});

describe('đơn nghỉ: lý do là loại nghỉ, mô tả tùy chọn', () => {
  const leaveBody = {
    employeeId: E,
    leaveTypeId: LEAVE_TYPE,
    fromDate: '2026-10-06',
    toDate: '2026-10-06',
    duration: 1,
  };
  const SHIFT = {
    window: {
      start: '2026-10-06T01:00:00.000Z',
      end: '2026-10-06T09:00:00.000Z',
      breakMinutes: 0,
    },
    before: 0,
    after: 0,
  };
  const createLeaveRequest = (h: ReturnType<typeof createHarness>, body: Row) =>
    new HrmLeaveController(h.ctx, bridge).createLeaveRequest(
      req,
      body as never,
    ) as Promise<{ data: Row }>;

  beforeEach(() => {
    (shiftForDate as jest.Mock).mockResolvedValue(SHIFT);
  });

  it('không bắt buộc mô tả: lưu chuỗi rỗng, trả reasonId = loại nghỉ, reasonName = tên loại nghỉ', async () => {
    const h = createHarness([]);
    const { data } = await createLeaveRequest(h, { ...leaveBody });
    const insert = h.inserts.find((i) => i.table === 'leave_requests');
    expect(insert?.row).toMatchObject({
      leave_type_id: LEAVE_TYPE,
      reason: '',
    });
    expect(data).toMatchObject({
      leaveTypeId: LEAVE_TYPE,
      reasonId: LEAVE_TYPE,
      reasonName: 'Nghỉ ốm',
      description: null,
      reason: '',
      leaveTypeName: 'Nghỉ ốm',
    });
  });

  it('mô tả lưu ở cột reason; bí danh reason cũ vẫn được nhận; description thắng', async () => {
    const h = createHarness([]);
    await createLeaveRequest(h, { ...leaveBody, description: 'Đi khám bệnh' });
    await createLeaveRequest(h, { ...leaveBody, reason: 'Qua bí danh' });
    await createLeaveRequest(h, {
      ...leaveBody,
      reason: 'Cũ',
      description: 'Mới',
    });
    expect(
      h.inserts
        .filter((i) => i.table === 'leave_requests')
        .map((i) => i.row['reason']),
    ).toEqual(['Đi khám bệnh', 'Qua bí danh', 'Mới']);
  });

  it('mô tả không phải văn bản bị từ chối', async () => {
    const h = createHarness([]);
    await expect(
      createLeaveRequest(h, { ...leaveBody, description: 123 }),
    ).rejects.toThrow(/Mô tả phải là văn bản/);
  });

  it('chọn cách duyệt theo MÃ LOẠI NGHỈ', async () => {
    const h = createHarness([]);
    await createLeaveRequest(h, { ...leaveBody });
    expect(prepare.mock.calls[0][1]).toMatchObject({ subTypeCode: 'NGHI_OM' });
  });

  describe('sửa đơn nghỉ chờ duyệt (amend)', () => {
    const existing = {
      id: OLD_LEAVE,
      tenant_id: T,
      employee_id: E,
      leave_type_id: LEAVE_TYPE,
      attachment_file_id: null,
      status: 'PENDING',
      reason: 'Mô tả cũ',
      updated_at: new Date('2026-10-09T00:00:00Z'),
    };
    const amend = (h: ReturnType<typeof createHarness>, body: Row) =>
      new HrmLeaveController(h.ctx, bridge).amendLeaveRequest(
        req,
        OLD_LEAVE,
        {
          fromDate: '2026-10-06',
          toDate: '2026-10-06',
          duration: 1,
          expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
          ...body,
        } as never,
      ) as Promise<{ data: Row }>;
    const amendedReason = async (body: Row) => {
      const h = createHarness([], { leaveRow: existing });
      const { data } = await amend(h, body);
      expect(data).toMatchObject({ reasonId: LEAVE_TYPE, reasonName: 'Nghỉ ốm' });
      return h.inserts.find((i) => i.table === 'leave_requests')?.row['reason'];
    };

    it('không gửi mô tả thì giữ mô tả cũ; gửi description hoặc bí danh reason thì thay; rỗng thì xóa', async () => {
      expect(await amendedReason({})).toBe('Mô tả cũ');
      expect(await amendedReason({ description: 'Mô tả mới' })).toBe('Mô tả mới');
      expect(await amendedReason({ reason: 'Qua bí danh' })).toBe('Qua bí danh');
      expect(await amendedReason({ description: 'Mới', reason: 'Cũ' })).toBe('Mới');
      expect(await amendedReason({ description: '' })).toBe('');
    });
  });
});
