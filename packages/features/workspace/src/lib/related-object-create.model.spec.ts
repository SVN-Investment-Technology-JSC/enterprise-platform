import type { RelatedObjectCreateForm } from '@enterprise-platform/contracts-workspace';
import {
  applyPreviewFill,
  confirmationOf,
  createDraftError,
  dependentReferenceKeys,
  formatPreviewCell,
  isCreateFieldRequired,
  referenceFiltersOf,
  createErrorMessage,
  createRequestOf,
  initialCreateDraft,
  pendingFromCreated,
} from './related-object-create.model';

const FORM: RelatedObjectCreateForm = {
  kind: 'crm.contract',
  title: 'Lập hợp đồng',
  fields: [
    { key: 'type', label: 'Loại hợp đồng', type: 'select', required: true, defaultValue: 'SALE', options: [{ value: 'SALE', label: 'Mua bán' }] },
    { key: 'customerId', label: 'Khách hàng', type: 'reference', reference: 'crm.customer', required: true },
    { key: 'title', label: 'Tên hợp đồng', type: 'text', required: true },
    { key: 'validFrom', label: 'Hiệu lực từ', type: 'date', required: true },
    { key: 'value', label: 'Giá trị hợp đồng', type: 'money', min: 0, defaultValue: 2_500_000 },
    { key: 'warrantyMonths', label: 'Bảo hành (tháng)', type: 'number', min: 0, max: 600 },
    { key: 'note', label: 'Ghi chú', type: 'textarea' },
  ],
};

describe('form tạo nhanh', () => {
  it('giá trị ban đầu theo mặc định của module; tiền có dấu chấm ngăn nghìn', () => {
    const { values } = initialCreateDraft(FORM);
    expect(values).toEqual({
      type: 'SALE',
      customerId: '',
      title: '',
      validFrom: '',
      value: '2.500.000',
      warrantyMonths: '',
      note: '',
    });
  });

  it('nhãn mặc định của ô tham chiếu chỉ giữ khi có giá trị', () => {
    const form: RelatedObjectCreateForm = {
      ...FORM,
      fields: [
        { key: 'customerId', label: 'Khách hàng', type: 'reference', reference: 'crm.customer', defaultValue: 'k-1', defaultLabel: 'KH01 — Công ty A' },
        { key: 'other', label: 'Khác', type: 'reference', reference: 'crm.customer', defaultLabel: 'bỏ' },
      ],
    };
    expect(initialCreateDraft(form).labels).toEqual({ customerId: 'KH01 — Công ty A' });
  });

  it('báo ô bắt buộc còn trống theo thứ tự, chọn hay nhập theo kiểu ô', () => {
    const { values } = initialCreateDraft(FORM);
    expect(createDraftError(FORM, values)).toBe('Vui lòng chọn khách hàng.');
    expect(createDraftError(FORM, { ...values, customerId: 'k-1' })).toBe('Vui lòng nhập tên hợp đồng.');
    expect(createDraftError(FORM, { ...values, customerId: 'k-1', title: 'HĐ' })).toBe('Vui lòng chọn hiệu lực từ.');
  });

  it('báo số đọc không được hoặc ngoài khoảng', () => {
    const ok = { ...initialCreateDraft(FORM).values, customerId: 'k-1', title: 'HĐ', validFrom: '2026-11-01' };
    expect(createDraftError(FORM, ok)).toBeUndefined();
    expect(createDraftError(FORM, { ...ok, value: '12abc' })).toBe('Giá trị hợp đồng: không đọc được số.');
    expect(createDraftError(FORM, { ...ok, warrantyMonths: '601' })).toBe('Bảo hành (tháng) không được lớn hơn 600.');
  });

  it('thân request: tiền và số thành số, ô trống thành null; xác nhận chỉ gửi khi có', () => {
    const values = {
      ...initialCreateDraft(FORM).values,
      customerId: 'k-1',
      title: '  Hợp đồng giấy ',
      validFrom: '2026-11-01',
      value: '1.200.000.000',
      warrantyMonths: '12',
    };
    expect(createRequestOf(FORM, values, false)).toEqual({
      values: {
        type: 'SALE',
        customerId: 'k-1',
        title: 'Hợp đồng giấy',
        validFrom: '2026-11-01',
        value: 1_200_000_000,
        warrantyMonths: 12,
        note: null,
      },
    });
    expect(createRequestOf(FORM, values, true).confirm).toBe(true);
  });

  it('nhận ra lỗi cần xác nhận và câu lỗi của module gốc', () => {
    expect(
      confirmationOf({ code: 'LINKABLE_CONFIRM_REQUIRED', message: 'Mã số thuế đã có.', warnings: ['KH001 - Công ty A', 3, ' '] }),
    ).toEqual({ message: 'Mã số thuế đã có.', warnings: ['KH001 - Công ty A'] });
    expect(confirmationOf({ code: 'FORBIDDEN', message: 'Không có quyền.' })).toBeUndefined();
    expect(createErrorMessage({ code: 'FORBIDDEN', message: 'Bạn không có quyền quản lý hợp đồng.' })).toBe(
      'Bạn không có quyền quản lý hợp đồng.',
    );
    expect(createErrorMessage(undefined)).toBe('Không tạo được hồ sơ.');
  });

  it('hồ sơ vừa tạo thành dòng chờ gắn với nhãn mã — tên', () => {
    expect(pendingFromCreated({ id: 'c-9', code: 'HĐ-009', label: 'Hợp đồng giấy' })).toEqual({
      objectId: 'c-9',
      label: 'HĐ-009 — Hợp đồng giấy',
    });
  });
});

const QUOTE_FORM: RelatedObjectCreateForm = {
  kind: 'crm.contract',
  title: 'Lập hợp đồng',
  fields: [
    { key: 'customerId', label: 'Khách hàng', type: 'reference', reference: 'crm.customer', requiredUnless: 'quoteId' },
    {
      key: 'quoteId',
      label: 'Báo giá',
      type: 'reference',
      reference: 'crm.quote',
      preview: true,
      filters: [
        { param: 'contractLinkable', value: 'true' },
        { param: 'customerId', fromField: 'customerId' },
      ],
    },
    { key: 'title', label: 'Tên hợp đồng', type: 'text', required: true },
    { key: 'value', label: 'Giá trị', type: 'money' },
  ],
};

describe('form tạo nhanh: ô tham chiếu có lọc, bắt buộc có điều kiện, xem trước', () => {
  const [customer, quote] = QUOTE_FORM.fields;

  it('bắt buộc trừ khi ô kia có giá trị', () => {
    expect(isCreateFieldRequired(customer, { quoteId: '' })).toBe(true);
    expect(isCreateFieldRequired(customer, { quoteId: 'q-1' })).toBe(false);
    expect(createDraftError(QUOTE_FORM, { title: 'HĐ' })).toBe('Vui lòng chọn khách hàng.');
    expect(createDraftError(QUOTE_FORM, { title: 'HĐ', quoteId: 'q-1' })).toBeUndefined();
  });

  it('tham số lọc theo giá trị hiện tại; ô nguồn trống thì không gửi', () => {
    expect(referenceFiltersOf(quote, { customerId: ' k-1 ' })).toEqual({ contractLinkable: 'true', customerId: 'k-1' });
    expect(referenceFiltersOf(quote, {})).toEqual({ contractLinkable: 'true' });
    expect(dependentReferenceKeys(QUOTE_FORM, 'customerId')).toEqual(['quoteId']);
    expect(dependentReferenceKeys(QUOTE_FORM, 'title')).toEqual([]);
  });

  it('điền theo bản xem trước chỉ ô có trong form, đang trống, không phải chính ô xem trước', () => {
    const result = applyPreviewFill(
      QUOTE_FORM,
      {
        field: 'quoteId',
        fill: {
          customerId: { value: 'k-1', label: 'KH001 — Công ty A' },
          title: { value: 'Hợp đồng theo báo giá BG-1' },
          value: { value: 1_500_000 },
          quoteId: { value: 'q-9' },
          ghost: { value: 'x' },
        },
      },
      { quoteId: 'q-1', title: 'Tên tự nhập' },
      {},
    );
    expect(result.values).toEqual({ quoteId: 'q-1', title: 'Tên tự nhập', customerId: 'k-1', value: '1.500.000' });
    expect(result.labels).toEqual({ customerId: 'KH001 — Công ty A' });
    expect(result.filled).toEqual(['customerId', 'value']);
  });

  it('ô bảng xem trước theo kiểu cột', () => {
    expect(formatPreviewCell(100_000_000, 'money')).toContain('100.000.000');
    expect(formatPreviewCell(2.5, 'number')).toBe('2,5');
    expect(formatPreviewCell('VT01 Tủ điện', 'text')).toBe('VT01 Tủ điện');
    expect(formatPreviewCell(null, 'money')).toBe('');
  });
});
