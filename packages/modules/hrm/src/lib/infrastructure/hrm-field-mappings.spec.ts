jest.mock('./hrm-context.service.js', () => ({ HrmContextService: class {} }));
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProcedureDefinition } from '@enterprise-platform/contracts-procedure-engine';
import {
  applyFieldMappings,
  defaultFieldMappings,
  deriveOrgContext,
  fieldCatalogFor,
  loadBindingMappings,
  mappingForAttribute,
  resolveFieldValues,
  validateFieldMappings,
  type HrmFieldMapping,
} from './hrm-field-mappings';
import { submissionAttributes } from './hrm-submission';
import { initialProcedureValues } from './hrm-procedure-bridge.service';

const mapping = (over: Partial<HrmFieldMapping>): HrmFieldMapping => ({
  hrmField: 'form.duration',
  attributeCode: 'so_ngay',
  scope: 'any',
  stepId: '',
  transform: 'none',
  mode: 'OVERWRITE',
  ...over,
});

const leaveRow = {
  id: 'r1',
  reason: 'Việc gia đình',
  from_date: '2026-10-06',
  to_date: '2026-10-07',
  duration: '2',
  leave_type_id: 'lt-1',
  is_negative_leave: false,
};

const KINDS = [
  'leave',
  'ot',
  'business_trip',
  'shift_change',
  'correction',
  'advance',
  'profile_correction',
] as const;

describe('applyFieldMappings', () => {
  it('OVERWRITE: giá trị hệ thống thắng giá trị người nhập, kể cả khóa có phạm vi', () => {
    const result = applyFieldMappings(
      { so_ngay: 99, 'step:S:so_ngay': 99, 'process:so_ngay': 99 },
      { 'form.duration': 2 },
      [mapping({})],
    );
    expect(result).toMatchObject({
      so_ngay: 2,
      'step:S:so_ngay': 2,
      'process:so_ngay': 2,
    });
  });

  it('PREFILL: giá trị người nhập thắng, chỉ điền khi bỏ trống', () => {
    const prefill = mapping({ mode: 'PREFILL' });
    expect(
      applyFieldMappings({ so_ngay: 5 }, { 'form.duration': 2 }, [prefill]),
    ).toMatchObject({ so_ngay: 5 });
    expect(
      applyFieldMappings({ so_ngay: '' }, { 'form.duration': 2 }, [prefill]),
    ).toMatchObject({ so_ngay: 2 });
    expect(applyFieldMappings({}, { 'form.duration': 2 }, [prefill])).toEqual({
      so_ngay: 2,
    });
  });

  it('phạm vi process/step ghi đúng khóa, không đụng khóa còn lại', () => {
    const result = applyFieldMappings({ so_ngay: 7 }, { 'form.duration': 2 }, [
      mapping({ scope: 'process' }),
      mapping({ scope: 'step', stepId: 'S1', attributeCode: 'ngay_nghi' }),
    ]);
    expect(result).toEqual({
      so_ngay: 7,
      'process:so_ngay': 2,
      'step:S1:ngay_nghi': 2,
    });
  });

  it('bỏ qua trường không có giá trị và áp dụng phép biến đổi', () => {
    expect(
      applyFieldMappings({ a: 'giữ' }, {}, [mapping({ attributeCode: 'a' })]),
    ).toEqual({ a: 'giữ' });
    expect(
      applyFieldMappings({}, { 'form.duration': '2.5', 'form.reason': 'abc' }, [
        mapping({ transform: 'to_number' }),
        mapping({
          hrmField: 'form.reason',
          attributeCode: 'ly_do_hoa',
          transform: 'upper',
        }),
      ]),
    ).toEqual({ so_ngay: 2.5, ly_do_hoa: 'ABC' });
  });
});

describe('ánh xạ mặc định tương thích bảng mã cố định cũ', () => {
  it('đơn nghỉ: so_ngay_nghi, duration, tu_ngay... giống hành vi cũ và ghi đè giá trị giả mạo', () => {
    const values = submissionAttributes(
      {
        kind: 'leave',
        attributes: { so_ngay_nghi: 1, 'step:S:duration': 1, custom: 'x' },
      },
      leaveRow,
    );
    expect(values).toMatchObject({
      ly_do: 'Việc gia đình',
      tu_ngay: '2026-10-06',
      den_ngay: '2026-10-07',
      so_ngay_nghi: 2,
      duration: 2,
      'step:S:duration': 2,
      leave_type_id: 'lt-1',
      is_negative_leave: false,
      custom: 'x',
    });
  });

  it.each([
    [
      'ot',
      { planned_minutes: 150, ot_type: 'NIGHT', is_night_ot: true, reason: 'r' },
      { so_gio_ot: 2.5, ot_hours: 2.5, loai_ot: 'NIGHT', is_night_ot: true },
    ],
    [
      'business_trip',
      {
        days_count: '3',
        business_trip_type: 'DOMESTIC',
        destination: 'HN',
        allow_ot: true,
        reason: 'r',
      },
      {
        so_ngay_cong_tac: 3,
        days_count: 3,
        loai_cong_tac: 'DOMESTIC',
        dia_diem: 'HN',
        allow_ot: true,
      },
    ],
    [
      'advance',
      { requested_amount: '1000000', number_of_installments: 2, reason: 'r' },
      { so_tien: 1000000, amount: 1000000, so_ky_tra: 2 },
    ],
    [
      'correction',
      { request_date: '2026-10-01', reason: 'r' },
      { ngay: '2026-10-01' },
    ],
    [
      'shift_change',
      { change_type: 'SWAP', reason: 'r' },
      { loai_doi_ca: 'SWAP' },
    ],
  ] as const)('%s', (kind, row, expected) => {
    expect(submissionAttributes({ kind, attributes: {} }, row)).toMatchObject({
      ...expected,
      ly_do: 'r',
    });
  });

  it('mọi dòng mặc định chỉ dùng trường có trong danh mục của loại đơn', () => {
    for (const kind of KINDS) {
      const allowed = new Set(fieldCatalogFor(kind).map((f) => f.key));
      for (const m of defaultFieldMappings(kind))
        expect(allowed.has(m.hrmField)).toBe(true);
    }
  });

  it('migration 0030 nạp đúng các dòng mặc định của mã', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../../../../',
        'migrations/tenant/hrm/0030-hrm-procedure-field-mappings.sql',
      ),
      'utf8',
    );
    for (const kind of KINDS)
      for (const m of defaultFieldMappings(kind))
        expect(sql).toContain(
          `('${kind}','${m.hrmField}','${m.attributeCode}')`,
        );
  });
});

describe('ngữ cảnh nhân viên đẩy sang thuộc tính PE', () => {
  const snapshot = {
    units: [
      { id: 'u-kt', code: 'KE_TOAN', name: 'Phòng Kế toán' },
      { id: 'p-ktt', code: 'KTT', name: 'Kế toán trưởng' },
    ],
    positions: [
      {
        id: 'p-ktt',
        key: 'KE_TOAN_TRUONG',
        name: 'Kế toán trưởng',
        unitId: 'u-kt',
      },
    ],
    members: [
      {
        userId: 'user-nv',
        unitId: 'p-ktt',
        positionId: 'p-ktt',
        positionName: 'Kế toán trưởng',
      },
      {
        userId: 'user-ql',
        employeeId: 'emp-ql',
        displayName: 'Chị Lan',
        unitId: 'u-kt',
      },
    ],
  };

  it('suy phòng ban, chức danh và người quản lý từ snapshot Platform', () => {
    expect(deriveOrgContext(snapshot, 'user-nv', 'user-ql')).toEqual({
      departmentId: 'u-kt',
      departmentCode: 'KE_TOAN',
      departmentName: 'Phòng Kế toán',
      positionId: 'p-ktt',
      positionCode: 'KE_TOAN_TRUONG',
      positionName: 'Kế toán trưởng',
      managerEmployeeId: 'emp-ql',
      managerName: 'Chị Lan',
    });
  });

  it('resolveFieldValues chỉ tải ngữ cảnh khi có ánh xạ dùng đến, và nạp đúng khóa thuộc tính', async () => {
    const db = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('core_schema.employees'))
          return { rows: [{ user_id: 'user-nv' }], rowCount: 1 };
        if (sql.includes('salary_grades'))
          return { rows: [{ name: 'Bậc 3', code: 'B3' }], rowCount: 1 };
        if (sql.includes('leave_balances'))
          return { rows: [{ remaining: '4.5' }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    const org = {
      context: jest.fn(async () => deriveOrgContext(snapshot, 'user-nv', 'user-ql')),
    };
    const mappings: HrmFieldMapping[] = [
      mapping({
        hrmField: 'employee.department_code',
        attributeCode: 'phong_ban',
        scope: 'process',
      }),
      mapping({
        hrmField: 'employee.level_code',
        attributeCode: 'cap_bac',
        scope: 'process',
      }),
      mapping({
        hrmField: 'business.leave_remaining',
        attributeCode: 'phep_con',
        scope: 'step',
        stepId: 'S1',
      }),
    ];
    const values = await resolveFieldValues(
      db as never,
      { tenantId: 't', employeeId: 'e', kind: 'leave', row: leaveRow, org },
      mappings,
    );
    expect(values['employee.department_code']).toBe('KE_TOAN');
    expect(values['employee.level_code']).toBe('B3');
    expect(values['business.leave_remaining']).toBe(4.5);
    expect(applyFieldMappings({}, values, mappings)).toEqual({
      'process:phong_ban': 'KE_TOAN',
      'process:cap_bac': 'B3',
      'step:S1:phep_con': 4.5,
    });

    org.context.mockClear();
    await resolveFieldValues(
      db as never,
      { tenantId: 't', employeeId: 'e', kind: 'leave', row: leaveRow, org },
      defaultFieldMappings('leave'),
    );
    expect(org.context).not.toHaveBeenCalled();
  });

  it('thuộc tính do HRM cấp đến PE đúng khóa/giá trị để cổng điều kiện dùng (nghỉ 2 ngày / 5 ngày, theo phòng ban)', () => {
    const definition = {
      attributes: [
        {
          id: 'a1',
          code: 'phong_ban',
          name: 'Phòng ban',
          type: 'select',
          required: false,
        },
      ],
      steps: [
        {
          id: 'S',
          name: 'Nộp đơn',
          attributes: [
            {
              id: 'a2',
              code: 'so_ngay',
              name: 'Số ngày nghỉ',
              type: 'number',
              required: true,
            },
          ],
        },
      ],
      gateways: [],
    } as unknown as ProcedureDefinition;
    const mappings: HrmFieldMapping[] = [
      mapping({
        hrmField: 'employee.department_code',
        attributeCode: 'phong_ban',
        scope: 'process',
      }),
      mapping({ attributeCode: 'so_ngay', scope: 'step', stepId: 'S' }),
    ];
    for (const [days, department] of [
      [2, 'KE_TOAN'],
      [5, 'KINH_DOANH'],
    ] as const) {
      const attributes = applyFieldMappings(
        { so_ngay: 1 },
        { 'form.duration': days, 'employee.department_code': department },
        mappings,
      );
      expect(initialProcedureValues(definition, attributes)).toEqual({
        'process:phong_ban': { type: 'select', value: department },
        'step:S:so_ngay': { type: 'number', value: days },
      });
    }
  });
});

describe('mappingForAttribute và kiểm tra đầu vào', () => {
  it('khớp theo mã + phạm vi + bước; OVERWRITE thắng PREFILL', () => {
    const list = [
      mapping({ scope: 'step', stepId: 'S1', mode: 'PREFILL' }),
      mapping({ scope: 'any', mode: 'OVERWRITE' }),
    ];
    expect(
      mappingForAttribute(list, {
        code: 'so_ngay',
        scope: 'step',
        valueKey: 'step:S1:so_ngay',
      })?.mode,
    ).toBe('OVERWRITE');
    expect(
      mappingForAttribute([list[0]], {
        code: 'so_ngay',
        scope: 'step',
        valueKey: 'step:S2:so_ngay',
      }),
    ).toBeUndefined();
    expect(
      mappingForAttribute([list[0]], {
        code: 'so_ngay',
        scope: 'process',
        valueKey: 'process:so_ngay',
      }),
    ).toBeUndefined();
  });

  it('validateFieldMappings từ chối trường ngoài danh mục, trùng thuộc tính, thiếu bước', () => {
    const ok = {
      hrmField: 'form.duration',
      attributeCode: 'so_ngay',
      mode: 'OVERWRITE',
    };
    expect(validateFieldMappings('leave', [ok])).toHaveLength(1);
    expect(() => validateFieldMappings('ot', [ok])).toThrow('không áp dụng');
    expect(() => validateFieldMappings('leave', [ok, ok])).toThrow(
      'đã được ánh xạ',
    );
    expect(() =>
      validateFieldMappings('leave', [{ ...ok, scope: 'step' }]),
    ).toThrow('thiếu mã bước');
    expect(() =>
      validateFieldMappings('leave', [{ ...ok, mode: 'X' }]),
    ).toThrow('OVERWRITE');
    expect(() => validateFieldMappings('leave', 'x')).toThrow();
  });

  it('loadBindingMappings dùng bảng mặc định khi chưa migrate; cấu hình rỗng tường minh được giữ', async () => {
    const notReady = {
      query: jest.fn(async () => ({ rows: [{ ready: false }] })),
    };
    expect(
      (await loadBindingMappings(notReady as never, 't', 'b', 'leave'))
        .isDefault,
    ).toBe(true);
    const emptyConfigured = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('to_regclass')) return { rows: [{ ready: true }] };
        if (sql.includes('field_mappings_configured'))
          return { rows: [{ field_mappings_configured: true }] };
        return { rows: [] };
      }),
    };
    expect(
      await loadBindingMappings(emptyConfigured as never, 't', 'b', 'leave'),
    ).toEqual({ mappings: [], isDefault: false });
  });
});
