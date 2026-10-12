import { BadRequestException } from '@nestjs/common';
import {
  descriptionColumn,
  leaveReasonView,
  pickDescription,
  requestReasonCode,
  requestReasonView,
  resolveReasonInput,
} from './hrm-request-reason-input';
import type { RequestReasonKind } from './hrm-request-reason';

const T = '11111111-1111-4111-8111-111111111111';
const R = '33333333-3333-4333-8333-333333333333';

interface ReasonRow {
  id: string;
  kind: string;
  code: string;
  name: string;
  paid: boolean;
  requires_description: boolean;
  active: boolean;
}

/** DB giả của danh mục lý do: lọc theo tenant, id, kind như câu SQL thật. */
function fakeReasons(rows: ReasonRow[]) {
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM hrm_schema\.request_reasons/.test(sql)) {
        const found = rows.filter(
          (r) =>
            r.id === params[1] && (sql.includes('kind = $3') ? r.kind === params[2] : true),
        );
        return { rows: found, rowCount: found.length };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return db;
}

const reason = (over: Partial<ReasonRow> = {}): ReasonRow => ({
  id: R,
  kind: 'OVERTIME',
  code: 'OT_WORK',
  name: 'Theo yêu cầu công việc',
  paid: true,
  requires_description: false,
  active: true,
  ...over,
});

const KINDS: RequestReasonKind[] = [
  'OVERTIME',
  'BUSINESS_TRIP',
  'ATTENDANCE_CORRECTION',
  'SHIFT_CHANGE',
];

describe('pickDescription: mô tả tách khỏi lý do, reason cũ là bí danh', () => {
  it('lấy description; thiếu thì dùng bí danh reason', () => {
    expect(pickDescription({ description: ' Chốt báo cáo ' })).toBe('Chốt báo cáo');
    expect(pickDescription({ reason: 'Nội dung cũ' })).toBe('Nội dung cũ');
  });

  it('gửi cả hai thì description thắng', () => {
    expect(pickDescription({ description: 'Mới', reason: 'Cũ' })).toBe('Mới');
  });

  it('rỗng hoặc không gửi là null; cột reason NOT NULL nên lưu chuỗi rỗng', () => {
    expect(pickDescription({})).toBeNull();
    expect(pickDescription({ description: '   ' })).toBeNull();
    expect(pickDescription({ description: null, reason: null })).toBeNull();
    expect(descriptionColumn(null)).toBe('');
    expect(descriptionColumn('Mô tả')).toBe('Mô tả');
  });

  it('mô tả không phải văn bản hoặc quá 2000 ký tự bị từ chối', () => {
    expect(() => pickDescription({ description: 42 })).toThrow(BadRequestException);
    expect(() => pickDescription({ reason: { a: 1 } })).toThrow(BadRequestException);
    expect(() => pickDescription({ description: 'x'.repeat(2001) })).toThrow(
      /2000 ký tự/,
    );
  });
});

describe('resolveReasonInput: lý do bắt buộc, chọn từ danh mục đúng loại đơn', () => {
  it.each(KINDS)('%s: thiếu reasonId bị từ chối, không truy vấn danh mục', async (kind) => {
    const db = fakeReasons([reason({ kind })]);
    await expect(
      resolveReasonInput(db, T, kind, { description: 'Có mô tả nhưng chưa chọn lý do' }),
    ).rejects.toThrow(/Chọn lý do/);
    await expect(
      resolveReasonInput(db, T, kind, { reasonId: '' }),
    ).rejects.toThrow(/Chọn lý do/);
    // Trường reason cũ (tự do) không thay thế được lý do.
    await expect(
      resolveReasonInput(db, T, kind, { reason: 'Lý do nhập tự do' }),
    ).rejects.toThrow(/Chọn lý do/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('reasonId sai định dạng bị từ chối 400 trước khi hỏi CSDL', async () => {
    const db = fakeReasons([]);
    await expect(
      resolveReasonInput(db, T, 'OVERTIME', { reasonId: 'khong-phai-uuid' }),
    ).rejects.toThrow(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each(KINDS)('%s: lý do thuộc loại đơn khác hoặc không tồn tại bị từ chối', async (kind) => {
    const other = KINDS.find((k) => k !== kind) as RequestReasonKind;
    const db = fakeReasons([reason({ kind: other })]);
    await expect(
      resolveReasonInput(db, T, kind, { reasonId: R }),
    ).rejects.toThrow(/không có trong danh mục/);
    await expect(
      resolveReasonInput(db, T, kind, { reasonId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toThrow(/không có trong danh mục/);
    // Câu truy vấn lọc đúng tenant, id và loại đơn.
    expect(db.query).toHaveBeenLastCalledWith(expect.any(String), [
      T,
      '99999999-9999-4999-8999-999999999999',
      kind,
    ]);
  });

  it('lý do đã ngừng sử dụng bị từ chối và nêu tên lý do', async () => {
    const db = fakeReasons([reason({ active: false, name: 'Lý do cũ' })]);
    await expect(
      resolveReasonInput(db, T, 'OVERTIME', { reasonId: R }),
    ).rejects.toThrow(/Lý do cũ.*ngừng sử dụng/);
  });

  it('lý do yêu cầu mô tả: thiếu hoặc trống bị từ chối; có description hoặc bí danh reason thì qua', async () => {
    const db = fakeReasons([
      reason({ requires_description: true, code: 'OT_OTHER', name: 'Khác' }),
    ]);
    await expect(
      resolveReasonInput(db, T, 'OVERTIME', { reasonId: R }),
    ).rejects.toThrow(/cần nhập mô tả/);
    await expect(
      resolveReasonInput(db, T, 'OVERTIME', { reasonId: R, description: '  ' }),
    ).rejects.toThrow(/cần nhập mô tả/);

    const byDescription = await resolveReasonInput(db, T, 'OVERTIME', {
      reasonId: R,
      description: 'Sự cố hệ thống',
    });
    expect(byDescription.description).toBe('Sự cố hệ thống');
    expect(byDescription.reason).toMatchObject({
      id: R,
      code: 'OT_OTHER',
      name: 'Khác',
      requiresDescription: true,
    });

    const byAlias = await resolveReasonInput(db, T, 'OVERTIME', {
      reasonId: R,
      reason: 'Sự cố hệ thống',
    });
    expect(byAlias.description).toBe('Sự cố hệ thống');
  });

  it('lý do không yêu cầu mô tả: mô tả tùy chọn; trả về paid của lý do', async () => {
    const db = fakeReasons([reason({ paid: false })]);
    const result = await resolveReasonInput(db, T, 'OVERTIME', { reasonId: R });
    expect(result.description).toBeNull();
    expect(result.reason).toMatchObject({
      id: R,
      name: 'Theo yêu cầu công việc',
      paid: false,
      requiresDescription: false,
    });
  });
});

describe('requestReasonCode: mã lý do chọn cách duyệt (sub_type_code)', () => {
  it('trả về mã của lý do đã chọn; đơn cũ không có reason_id thì undefined', async () => {
    const db = fakeReasons([reason({ code: 'OT_WORK' })]);
    await expect(requestReasonCode(db, T, R)).resolves.toBe('OT_WORK');
    await expect(requestReasonCode(db, T, null)).resolves.toBeUndefined();
    await expect(requestReasonCode(db, T, undefined)).resolves.toBeUndefined();
    await expect(
      requestReasonCode(db, T, '99999999-9999-4999-8999-999999999999'),
    ).resolves.toBeUndefined();
  });
});

describe('đọc đơn: lý do, tên lý do và mô tả', () => {
  it('đơn mới: reasonId, reasonName, description; reason cũ bằng description', () => {
    expect(
      requestReasonView({
        reason_id: R,
        reason_name: 'Quên chấm công',
        reason: 'Quên thẻ ở nhà',
      }),
    ).toEqual({
      reasonId: R,
      reasonName: 'Quên chấm công',
      description: 'Quên thẻ ở nhà',
      reason: 'Quên thẻ ở nhà',
    });
  });

  it('đơn mới không có mô tả: description null, reason rỗng', () => {
    expect(
      requestReasonView({ reason_id: R, reason_name: 'Việc cá nhân', reason: '' }),
    ).toEqual({
      reasonId: R,
      reasonName: 'Việc cá nhân',
      description: null,
      reason: '',
    });
  });

  it('đơn cũ chưa có reason_id: reasonName null, description là nội dung cũ', () => {
    expect(requestReasonView({ reason: 'Đi công tác gấp' })).toEqual({
      reasonId: null,
      reasonName: null,
      description: 'Đi công tác gấp',
      reason: 'Đi công tác gấp',
    });
  });

  it('đơn nghỉ: lý do là loại nghỉ, tên lấy từ loại nghỉ nối bảng', () => {
    expect(
      leaveReasonView({
        leave_type_id: 'lt-1',
        leave_type_name: 'Nghỉ ốm',
        reason: 'Đi khám bệnh',
      }),
    ).toEqual({
      reasonId: 'lt-1',
      reasonName: 'Nghỉ ốm',
      description: 'Đi khám bệnh',
      reason: 'Đi khám bệnh',
    });
    expect(leaveReasonView({ leave_type_id: 'lt-1', reason: '' })).toMatchObject({
      reasonId: 'lt-1',
      reasonName: null,
      description: null,
    });
  });
});
