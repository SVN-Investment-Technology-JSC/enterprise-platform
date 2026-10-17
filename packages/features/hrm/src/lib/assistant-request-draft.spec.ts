import type { HrmRequestTypeField } from '@enterprise-platform/contracts-hrm';
import {
  assistantRequestPatch,
  customFieldValue,
  draftDate,
  draftDateTime,
} from './assistant-request-draft';

const fresh = { current: null };

describe('draftDate / draftDateTime', () => {
  it('chỉ nhận ngày có thật dạng YYYY-MM-DD', () => {
    expect(draftDate('2026-10-20')).toBe('2026-10-20');
    expect(draftDate('2026-02-30')).toBeNull();
    expect(draftDate('20/10/2026')).toBeNull();
    expect(draftDate(20261020)).toBeNull();
  });

  it('giữ nguyên ngày giờ địa phương, bỏ giây', () => {
    expect(draftDateTime('2026-10-20T13:00')).toEqual({ date: '2026-10-20', time: '13:00' });
    expect(draftDateTime('2026-10-20 08:30:15')).toEqual({ date: '2026-10-20', time: '08:30' });
    expect(draftDateTime('2026-10-20T24:00')).toBeNull();
    expect(draftDateTime('2026-10-20')).toBeNull();
  });

  it('đổi chuỗi có múi giờ sang giờ của trình duyệt', () => {
    const at = new Date('2026-10-20T06:00:00Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(draftDateTime('2026-10-20T06:00:00Z')).toEqual({
      date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
      time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
    });
  });
});

describe('assistantRequestPatch: đơn nghỉ', () => {
  const context = { ...fresh, leaveTypeIds: ['lt-annual', 'lt-sick'] };

  it('nghỉ cả ngày: chỉ đặt ngày, giờ để form lấy theo ca', () => {
    expect(
      assistantRequestPatch(
        'leave',
        { leaveTypeId: 'lt-annual', fromDate: '2026-10-20', toDate: '2026-10-21', description: ' Về quê ' },
        context,
      ),
    ).toEqual({
      fromDate: '2026-10-20',
      toDate: '2026-10-21',
      reasonId: 'lt-annual',
      description: 'Về quê',
    });
  });

  it('nghỉ nửa ngày: lấy ngày và giờ từ fromAt/toAt', () => {
    expect(
      assistantRequestPatch('leave', { fromAt: '2026-10-20T13:00', toAt: '2026-10-20T17:00' }, context),
    ).toEqual({ fromDate: '2026-10-20', startTime: '13:00', toDate: '2026-10-20', endTime: '17:00' });
  });

  it('một ngày: kết thúc cùng ngày bắt đầu khi mở form mới', () => {
    expect(assistantRequestPatch('leave', { fromDate: '2026-10-20' }, context)).toEqual({
      fromDate: '2026-10-20',
      toDate: '2026-10-20',
    });
  });

  it('bỏ qua loại nghỉ không chọn được và giá trị sai định dạng', () => {
    expect(
      assistantRequestPatch(
        'leave',
        { leaveTypeId: 'lt-unknown', fromDate: '20/10/2026', toDate: 5, description: '   ' },
        context,
      ),
    ).toEqual({});
  });

  it('ngày kết thúc trước ngày bắt đầu thì không dùng', () => {
    expect(
      assistantRequestPatch('leave', { fromDate: '2026-10-20', toDate: '2026-10-18' }, context),
    ).toEqual({ fromDate: '2026-10-20', toDate: '2026-10-20' });
  });
});

describe('assistantRequestPatch: cập nhật form đang mở', () => {
  it('chỉ trả các ô có trong bản nháp mới', () => {
    expect(
      assistantRequestPatch('ot', { description: 'Chạy thử máy' }, { current: { toDate: '2026-10-20', customToAt: '' } }),
    ).toEqual({ description: 'Chạy thử máy' });
  });

  it('đổi ngày bắt đầu giữ ngày kết thúc nếu vẫn hợp lệ', () => {
    const current = { toDate: '2026-10-25', customToAt: '' };
    expect(assistantRequestPatch('business_trip', { fromDate: '2026-10-22' }, { current })).toEqual({
      fromDate: '2026-10-22',
    });
    expect(assistantRequestPatch('business_trip', { fromDate: '2026-10-28' }, { current })).toEqual({
      fromDate: '2026-10-28',
      toDate: '2026-10-28',
    });
  });
});

describe('assistantRequestPatch: làm thêm giờ', () => {
  it('lấy khoảng giờ, kể cả qua đêm, và lý do', () => {
    expect(
      assistantRequestPatch(
        'ot',
        { fromAt: '2026-10-20T22:00', toAt: '2026-10-21T01:00', reasonId: 'r-ot' },
        fresh,
      ),
    ).toEqual({
      fromDate: '2026-10-20',
      startTime: '22:00',
      toDate: '2026-10-21',
      endTime: '01:00',
      reasonId: 'r-ot',
    });
  });

  it('không nhận fromDate (đơn làm thêm cần giờ)', () => {
    expect(assistantRequestPatch('ot', { fromDate: '2026-10-20' }, fresh)).toEqual({});
  });
});

describe('assistantRequestPatch: công tác', () => {
  const projects = [{ id: 'p1', code: 'EVN', name: 'Điện lực Miền Trung' }];

  it('điền nơi đến, loại công tác, làm thêm giờ, dự án', () => {
    expect(
      assistantRequestPatch(
        'business_trip',
        {
          destination: 'Nhà máy Tân An',
          businessTripType: 'INTERSITE',
          allowOt: true,
          projectId: 'p1',
          fromDate: '2026-10-20',
          toDate: '2026-10-22',
        },
        { ...fresh, projects },
      ),
    ).toEqual({
      fromDate: '2026-10-20',
      toDate: '2026-10-22',
      destination: 'Nhà máy Tân An',
      tripType: 'INTERSITE',
      allowOt: true,
      project: projects[0],
    });
  });

  it('bỏ qua loại công tác lạ và dự án người dùng không gắn được', () => {
    expect(
      assistantRequestPatch(
        'business_trip',
        { businessTripType: 'SPACE', projectId: 'p9', allowOt: 'có' },
        { ...fresh, projects },
      ),
    ).toEqual({});
  });
});

describe('assistantRequestPatch: đơn tuỳ chỉnh', () => {
  const fields: HrmRequestTypeField[] = [
    { key: 'so_luong', label: 'Số lượng', type: 'number' },
    { key: 'muc_do', label: 'Mức độ', type: 'select', options: ['Thấp', 'Cao'] },
    { key: 'can_xe', label: 'Cần xe', type: 'checkbox' },
  ];

  it('khoảng ngày: thiếu ngày kết thúc thì lấy ngày bắt đầu; trường động theo kiểu', () => {
    expect(
      assistantRequestPatch(
        'custom',
        {
          fromAt: '2026-10-20T08:00',
          fields: { so_luong: '3', muc_do: 'cao', can_xe: true, khong_co: 'x' },
          reasonId: 'r1',
        },
        { ...fresh, customType: { timeMode: 'DATE_RANGE', fields } },
      ),
    ).toEqual({
      customFromAt: '2026-10-20',
      customToAt: '2026-10-20',
      customValues: { so_luong: 3, muc_do: 'Cao', can_xe: true },
      reasonId: 'r1',
    });
  });

  it('ngày giờ: cần cả hai đầu, kết thúc phải sau bắt đầu', () => {
    const customType = { timeMode: 'RANGE_DATETIME' as const, fields: [] };
    expect(
      assistantRequestPatch('custom', { fromAt: '2026-10-20T08:00', toAt: '2026-10-20T10:30' }, { ...fresh, customType }),
    ).toEqual({ customFromAt: '2026-10-20T08:00', customToAt: '2026-10-20T10:30' });
    expect(
      assistantRequestPatch('custom', { fromAt: '2026-10-20T08:00', toAt: '2026-10-20T08:00' }, { ...fresh, customType }),
    ).toEqual({ customFromAt: '2026-10-20T08:00' });
  });

  it('một ngày đặt cả hai đầu; loại không có thời gian thì bỏ qua thời gian', () => {
    expect(
      assistantRequestPatch('custom', { fromAt: '2026-10-20' }, { ...fresh, customType: { timeMode: 'SINGLE_DATE', fields: [] } }),
    ).toEqual({ customFromAt: '2026-10-20', customToAt: '2026-10-20' });
    expect(
      assistantRequestPatch('custom', { fromAt: '2026-10-20' }, { ...fresh, customType: { timeMode: 'NONE', fields: [] } }),
    ).toEqual({});
  });

  it('chưa biết loại đơn thì chỉ lấy lý do và mô tả', () => {
    expect(assistantRequestPatch('custom', { fromAt: '2026-10-20', description: 'Ghi chú' }, fresh)).toEqual({
      description: 'Ghi chú',
    });
  });
});

describe('customFieldValue', () => {
  const field = (type: HrmRequestTypeField['type']): HrmRequestTypeField => ({ key: 'k', label: 'K', type });

  it('đổi giá trị theo kiểu trường, sai kiểu thì null', () => {
    expect(customFieldValue(field('text'), '  abc ')).toBe('abc');
    expect(customFieldValue(field('number'), 'x')).toBeNull();
    expect(customFieldValue(field('date'), '2026-10-20T09:00')).toBe('2026-10-20');
    expect(customFieldValue(field('datetime'), '2026-10-20T09:00')).toBe('2026-10-20T09:00');
    expect(customFieldValue(field('checkbox'), 'false')).toBe(false);
    expect(customFieldValue(field('checkbox'), 1)).toBeNull();
    expect(customFieldValue({ ...field('select'), options: ['A'] }, 'B')).toBeNull();
  });
});
