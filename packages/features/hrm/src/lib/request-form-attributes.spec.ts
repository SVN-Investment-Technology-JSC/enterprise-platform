import {
  hoursBetween,
  prefillAttributeValues,
  visibleDynamicAttributes,
  apiErrorInfo,
  bindingUrl,
  interpretBindingResponse,
  pruneAttributeValues,
  requestSubTypeCode,
} from './request-form-attributes';

const attr = (code: string) => ({
  id: code,
  code,
  name: code,
  type: 'text',
  required: false,
  scope: 'step' as const,
});

describe('thuộc tính động của form tạo đơn', () => {
  it('chọn mã loại con theo mã lý do của đơn', () => {
    const input = { leaveTypeCode: 'ANNUAL', reasonCode: 'THEO_YEU_CAU' };
    expect(requestSubTypeCode('leave', input)).toBe('ANNUAL');
    expect(requestSubTypeCode('ot', input)).toBe('THEO_YEU_CAU');
    expect(requestSubTypeCode('business_trip', input)).toBe('THEO_YEU_CAU');
    expect(requestSubTypeCode('shift_change', input)).toBe('THEO_YEU_CAU');
    expect(requestSubTypeCode('correction', input)).toBe('THEO_YEU_CAU');
    expect(requestSubTypeCode('advance', input)).toBeUndefined();
    expect(requestSubTypeCode('profile_correction', input)).toBeUndefined();
    expect(requestSubTypeCode('leave', {})).toBeUndefined();
    expect(requestSubTypeCode('ot', {})).toBeUndefined();
  });

  it('tạo URL binding kèm subTypeCode đã mã hóa', () => {
    expect(bindingUrl('leave')).toBe(
      '/api/hrm/v1/procedure-definitions/binding?kind=leave',
    );
    expect(bindingUrl('leave', 'A B')).toContain('subTypeCode=A+B');
  });

  it('diễn giải phản hồi binding', () => {
    expect(interpretBindingResponse(200, { data: null })).toEqual({
      status: 'direct',
    });
    expect(
      interpretBindingResponse(200, {
        data: { code: 'SUBTYPE_REQUIRED', message: 'Chọn loại đơn con để tải biểu mẫu' },
      }),
    ).toEqual({
      status: 'subtype-required',
      message: 'Chọn loại đơn con để tải biểu mẫu',
    });
    expect(
      interpretBindingResponse(200, {
        data: { definitionName: 'QT', attributes: [attr('a')] },
      }),
    ).toMatchObject({ status: 'ready', definitionName: 'QT' });
  });

  it('hiển thị lỗi thay vì nuốt, nhận diện PROCEDURE_UNAVAILABLE', () => {
    expect(
      interpretBindingResponse(409, { code: 'PROCEDURE_UNAVAILABLE' }),
    ).toMatchObject({ status: 'error', code: 'PROCEDURE_UNAVAILABLE' });
    expect(
      interpretBindingResponse(409, { error: { code: 'PROCEDURE_UNAVAILABLE' } }),
    ).toMatchObject({ code: 'PROCEDURE_UNAVAILABLE' });
    expect(interpretBindingResponse(500, { message: 'Lỗi máy chủ' })).toEqual({
      status: 'error',
      code: undefined,
      message: 'Lỗi máy chủ',
    });
    expect(apiErrorInfo(null)).toEqual({ code: undefined, message: undefined });
  });

  it('bỏ giá trị của thuộc tính không còn trong biểu mẫu', () => {
    const result = pruneAttributeValues(
      { a: 1, b: 'x', c: false },
      [attr('a'), attr('c')],
    );
    expect(result.values).toEqual({ a: 1, c: false });
    expect(result.dropped).toEqual(['b']);
  });

  it('ẩn thuộc tính OVERWRITE khỏi form động, giữ PREFILL và thuộc tính chưa ánh xạ', () => {
    const overwrite = {
      ...attr('so_ngay'),
      mapping: { hrmField: 'form.duration', mode: 'OVERWRITE' as const, group: 'form' as const },
    };
    const prefill = {
      ...attr('ly_do'),
      mapping: { hrmField: 'form.reason', mode: 'PREFILL' as const, group: 'form' as const },
    };
    const free = attr('khac');
    expect(
      visibleDynamicAttributes([overwrite, prefill, free]).map((a) => a.code),
    ).toEqual(['ly_do', 'khac']);
  });

  it('điền sẵn thuộc tính PREFILL từ trường form, ép kiểu số, bỏ qua ngữ cảnh và giá trị trống', () => {
    const make = (code: string, type: string, hrmField: string, group: 'form' | 'employee' = 'form') => ({
      ...attr(code),
      type,
      mapping: { hrmField, mode: 'PREFILL' as const, group },
    });
    const values = prefillAttributeValues(
      [
        make('so_ngay', 'number', 'form.duration'),
        make('ly_do', 'text', 'form.reason'),
        make('phong_ban', 'select', 'employee.department_code', 'employee'),
        make('den_ngay', 'date', 'form.to_date'),
      ],
      { 'form.duration': '2.5', 'form.reason': 'Việc riêng', 'form.to_date': '' },
    );
    expect(values).toEqual({ so_ngay: 2.5, ly_do: 'Việc riêng' });
  });

  it('tính số giờ OT giữa hai mốc, kể cả qua đêm', () => {
    expect(hoursBetween('18:00', '21:30')).toBe(3.5);
    expect(hoursBetween('22:00', '02:00')).toBe(4);
    expect(hoursBetween('x', '02:00')).toBeUndefined();
  });
});
