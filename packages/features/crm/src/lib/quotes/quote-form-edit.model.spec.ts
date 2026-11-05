import type { CustomFieldDefinition } from '@enterprise-platform/contracts-crm';
import {
  buildCustomFields,
  buildFees,
  buildOrderAmount,
  generalInfoError,
  hasLink,
  lockedOrderField,
  missingRequiredFields,
  newFeeRow,
  orderAmountText,
  parseDecimal,
  quoteFormErrorMessage,
  requiredFieldsMessage,
  setOrderAmountField,
  templateModes,
} from './quote-form-edit.model';

const field = (over: Partial<CustomFieldDefinition>): CustomFieldDefinition => ({
  id: 'f1',
  entityType: 'quote',
  name: 'Nguồn',
  fieldType: 'TEXT',
  options: [],
  required: false,
  sortOrder: 1,
  active: true,
  ...over,
});

describe('chiết khấu, thuế tổng đơn', () => {
  it('nhập một ô thì ô kia bị xoá và khoá', () => {
    const a = setOrderAmountField({ percent: '', amount: '5000' }, 'percent', '10');
    expect(a).toEqual({ percent: '10', amount: '' });
    expect(lockedOrderField(a)).toBe('amount');
    expect(lockedOrderField(setOrderAmountField(a, 'percent', ''))).toBeUndefined();
    expect(lockedOrderField({ percent: '', amount: '1' })).toBe('percent');
  });
  it('dựng yêu cầu: rỗng là null, phần trăm, số tiền, lỗi', () => {
    expect(buildOrderAmount({ percent: '', amount: '' }, 'thuế')).toEqual({ ok: true, value: null });
    expect(buildOrderAmount({ percent: '8,5', amount: '' }, 'thuế')).toEqual({ ok: true, value: { percent: 8.5 } });
    expect(buildOrderAmount({ percent: '', amount: '1.000.000' }, 'chiết khấu')).toEqual({ ok: true, value: { amount: 1000000 } });
    expect(buildOrderAmount({ percent: '101', amount: '' }, 'thuế').ok).toBe(false);
    expect(buildOrderAmount({ percent: '5', amount: '5' }, 'thuế').ok).toBe(false);
  });
  it('điền lại theo kiểu đã nhập', () => {
    expect(orderAmountText({ percent: 5, amount: 100, inputKind: 'PERCENT' })).toEqual({ percent: '5', amount: '' });
    expect(orderAmountText({ percent: 5, amount: 100, inputKind: 'AMOUNT' })).toEqual({ percent: '', amount: '100' });
    expect(orderAmountText({ percent: 0, amount: 0, inputKind: null })).toEqual({ percent: '', amount: '' });
  });
  it('mẫu quyết định chế độ', () => {
    expect(templateModes(undefined)).toEqual({ discount: 'LINE', tax: 'LINE' });
    expect(templateModes({ discountMode: 'ORDER', taxMode: 'LINE' })).toEqual({ discount: 'ORDER', tax: 'LINE' });
  });
  it('đọc số kiểu Việt và kiểu quốc tế', () => {
    expect(parseDecimal('1.234,5')).toBe(1234.5);
    expect(parseDecimal('1,234.5')).toBe(1234.5);
    expect(parseDecimal('abc')).toBeUndefined();
    expect(parseDecimal(' ')).toBeUndefined();
  });
});

describe('khoản phí', () => {
  it('bỏ dòng trống, kiểm số tiền', () => {
    expect(buildFees([newFeeRow('', ''), newFeeRow('Vận hành', '1000')])).toEqual({ ok: true, fees: [{ feeType: 'Vận hành', amount: 1000 }] });
    expect(buildFees([newFeeRow('A', '-1')]).ok).toBe(false);
    expect(buildFees([newFeeRow('A', '')]).ok).toBe(false);
  });
});

describe('trường tuỳ biến', () => {
  it('báo tên trường bắt buộc còn thiếu', () => {
    const defs = [field({ id: 'a', name: 'Nguồn', required: true }), field({ id: 'b', name: 'Ghi chú', required: true, sortOrder: 2 }), field({ id: 'c', required: true, active: false })];
    expect(missingRequiredFields(defs, { a: 'x' })).toEqual(['Ghi chú']);
    expect(requiredFieldsMessage(['Nguồn'])).toBe('Vui lòng nhập trường "Nguồn".');
    expect(requiredFieldsMessage(['A', 'B'])).toContain('"A", "B"');
  });
  it('dựng giá trị theo kiểu; rỗng là null', () => {
    const defs = [
      field({ id: 'n', fieldType: 'NUMBER' }),
      field({ id: 's', fieldType: 'SELECT', options: ['A', 'B'], sortOrder: 2 }),
      field({ id: 't', sortOrder: 3 }),
    ];
    expect(buildCustomFields(defs, { n: '12,5', s: 'A' })).toEqual({ ok: true, values: { n: 12.5, s: 'A', t: null } });
    expect(buildCustomFields(defs, { n: 'x' }).ok).toBe(false);
    expect(buildCustomFields(defs, { s: 'Z' }).ok).toBe(false);
  });
});

describe('khác', () => {
  it('tên báo giá bắt buộc, mã bắt buộc khi sửa', () => {
    expect(generalInfoError({ name: ' ', code: 'X', requireCode: false })).toMatch(/tên báo giá/);
    expect(generalInfoError({ name: 'A', code: '', requireCode: true })).toMatch(/mã báo giá/);
    expect(generalInfoError({ name: 'A', code: '', requireCode: false })).toBeUndefined();
  });
  it('lời lỗi: ưu tiên câu của server, rồi theo mã', () => {
    expect(quoteFormErrorMessage({ code: 'QUOTE_CODE_EXISTS', message: 'Mã trùng.' }, 'x')).toBe('Mã trùng.');
    expect(quoteFormErrorMessage({ code: 'QUOTE_CODE_EXISTS' }, 'x')).toMatch(/đã tồn tại/);
    expect(quoteFormErrorMessage({}, 'dự phòng')).toBe('dự phòng');
  });
  it('liên kết trùng', () => {
    expect(hasLink([{ targetType: 'CUSTOMER', targetId: '1' }], 'CUSTOMER', '1')).toBe(true);
    expect(hasLink([{ targetType: 'CUSTOMER', targetId: '1' }], 'QUOTE', '1')).toBe(false);
  });
});
