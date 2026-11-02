import type { CustomFieldDefinition } from '@enterprise-platform/contracts-crm';
import { applyCustomFields, parseCustomFieldValue } from './custom-fields.js';

const field = (partial: Partial<CustomFieldDefinition> & Pick<CustomFieldDefinition, 'id' | 'name' | 'fieldType'>): CustomFieldDefinition => ({
  entityType: 'quote',
  options: [],
  required: false,
  sortOrder: 0,
  active: true,
  ...partial,
});

const DEPT = field({ id: 'f-dept', name: 'Phòng ban phụ trách', fieldType: 'SELECT', options: ['Kỹ thuật', 'Kinh doanh'], required: true });
const NOTE = field({ id: 'f-note', name: 'Ghi chú nội bộ', fieldType: 'TEXT' });
const QTY = field({ id: 'f-qty', name: 'Số hợp đồng khung', fieldType: 'NUMBER' });
const DAY = field({ id: 'f-day', name: 'Ngày dự kiến ký', fieldType: 'DATE' });

describe('trường tuỳ biến của báo giá (P2I-06)', () => {
  it('kiểm kiểu: danh sách chọn theo lựa chọn, văn bản, số, ngày hợp lệ', () => {
    expect(parseCustomFieldValue(DEPT, ' Kỹ thuật ')).toBe('Kỹ thuật');
    expect(() => parseCustomFieldValue(DEPT, 'Nhân sự')).toThrow(/Phòng ban phụ trách/);
    expect(parseCustomFieldValue(NOTE, '  ghi chú ')).toBe('ghi chú');
    expect(() => parseCustomFieldValue(NOTE, 5)).toThrow(/văn bản/);
    expect(() => parseCustomFieldValue(NOTE, 'x'.repeat(1001))).toThrow(/tối đa/);
    expect(parseCustomFieldValue(QTY, '12.5')).toBe(12.5);
    expect(parseCustomFieldValue(QTY, 7)).toBe(7);
    expect(() => parseCustomFieldValue(QTY, 'abc')).toThrow(/số hợp lệ/);
    expect(() => parseCustomFieldValue(QTY, Number.POSITIVE_INFINITY)).toThrow();
    expect(parseCustomFieldValue(DAY, '2026-11-02')).toBe('2026-11-02');
    expect(() => parseCustomFieldValue(DAY, '2026-02-30')).toThrow(/ngày/);
    expect(() => parseCustomFieldValue(DAY, '02/11/2026')).toThrow(/ngày/);
  });

  it('TC-QF-11: lưu thiếu trường bắt buộc thì 400 nêu tên trường; điền rồi thì lưu được', () => {
    expect.assertions(5);
    try {
      applyCustomFields([DEPT, NOTE], {}, { [NOTE.id]: 'a' }, true);
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400, code: 'CUSTOM_FIELD_REQUIRED' });
      expect((error as Error).message).toContain('"Phòng ban phụ trách"');
    }
    expect(applyCustomFields([DEPT], {}, { [DEPT.id]: 'Kỹ thuật' }, true)).toEqual({ [DEPT.id]: 'Kỹ thuật' });
    // Đã có giá trị từ trước thì không cần gửi lại.
    expect(applyCustomFields([DEPT], { [DEPT.id]: 'Kinh doanh' }, undefined, true)).toEqual({ [DEPT.id]: 'Kinh doanh' });
    // Xoá giá trị của trường bắt buộc (null hoặc rỗng) cũng bị chặn.
    expect(() => applyCustomFields([DEPT], { [DEPT.id]: 'Kinh doanh' }, { [DEPT.id]: null }, true)).toThrow(/Phòng ban phụ trách/);
  });

  it('không ép bắt buộc khi chỉ kiểm giá trị (tạo báo giá chưa có dòng, báo giá cũ); trường tắt không còn bắt buộc', () => {
    expect(applyCustomFields([DEPT], {}, undefined, false)).toEqual({});
    expect(applyCustomFields([{ ...DEPT, active: false }], {}, undefined, true)).toEqual({});
  });

  it('gộp: giữ giá trị cũ kể cả của trường đã tắt; null xoá; khoá lạ hoặc trường đã tắt thì 400', () => {
    const merged = applyCustomFields([DEPT, NOTE, { ...QTY, active: false }], { 'f-qty': 3, [NOTE.id]: 'cũ' }, { [NOTE.id]: null, [DEPT.id]: 'Kỹ thuật' }, true);
    expect(merged).toEqual({ 'f-qty': 3, [DEPT.id]: 'Kỹ thuật' });
    expect(() => applyCustomFields([DEPT], {}, { 'khong-co': 'x' }, false)).toThrow(/không tồn tại hoặc đã tắt/);
    expect(() => applyCustomFields([{ ...QTY, active: false }], {}, { [QTY.id]: 1 }, false)).toThrow(/đã tắt/);
    expect(() => applyCustomFields([DEPT], {}, [] as never, false)).toThrow(/không hợp lệ/);
  });

  it('nhiều trường bắt buộc thiếu: liệt kê tên theo thứ tự hiển thị', () => {
    const a = field({ id: 'a', name: 'B trường', fieldType: 'TEXT', required: true, sortOrder: 2 });
    const b = field({ id: 'b', name: 'A trường', fieldType: 'TEXT', required: true, sortOrder: 1 });
    expect(() => applyCustomFields([a, b], {}, undefined, true)).toThrow('Vui lòng nhập các trường bắt buộc: "A trường", "B trường".');
  });
});
