import { WorkspaceValidationError } from './workspace.error.js';
import {
  checklistPercent,
  parseChecklistTitle,
  parseChecklistTitles,
  parseProgressMethod,
  parseQuantityDone,
  parseQuantityTarget,
  parseQuantityUnit,
  quantityPercent,
} from './progress-method.rules.js';

describe('parseProgressMethod', () => {
  it('nhận bốn cách tính, từ chối giá trị lạ', () => {
    for (const method of ['manual', 'quantity', 'checklist', 'child_weight']) {
      expect(parseProgressMethod(method)).toBe(method);
    }
    expect(() => parseProgressMethod('timeliness')).toThrow(WorkspaceValidationError);
    expect(() => parseProgressMethod(undefined)).toThrow(WorkspaceValidationError);
  });
});

describe('khối lượng', () => {
  it('khối lượng cần làm phải lớn hơn 0; đã làm được bằng 0', () => {
    expect(parseQuantityTarget('12.345')).toBe(12.35);
    expect(parseQuantityDone(0)).toBe(0);
    expect(() => parseQuantityTarget(0)).toThrow(WorkspaceValidationError);
    expect(() => parseQuantityTarget(-1)).toThrow(WorkspaceValidationError);
    expect(() => parseQuantityDone(-0.5)).toThrow(WorkspaceValidationError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 'abc', '', null, undefined, 1e15])('từ chối %p', (value) => {
    expect(() => parseQuantityTarget(value)).toThrow(WorkspaceValidationError);
  });

  it('đơn vị bắt buộc và có giới hạn độ dài', () => {
    expect(parseQuantityUnit('  bộ ')).toBe('bộ');
    expect(() => parseQuantityUnit('  ')).toThrow(WorkspaceValidationError);
    expect(() => parseQuantityUnit(undefined)).toThrow(WorkspaceValidationError);
    expect(() => parseQuantityUnit('x'.repeat(31))).toThrow(WorkspaceValidationError);
  });

  it('quantityPercent làm tròn, chặn 0–100 và an toàn khi thiếu mục tiêu', () => {
    expect(quantityPercent(3, 8)).toBe(38);
    expect(quantityPercent(8, 8)).toBe(100);
    expect(quantityPercent(12, 8)).toBe(100);
    expect(quantityPercent(0, 8)).toBe(0);
    expect(quantityPercent(5, undefined)).toBe(0);
    expect(quantityPercent(5, 0)).toBe(0);
  });
});

describe('đầu việc', () => {
  it('checklistPercent: tỷ lệ đã tích, không có đầu việc là 0%', () => {
    expect(checklistPercent(1, 3)).toBe(33);
    expect(checklistPercent(2, 3)).toBe(67);
    expect(checklistPercent(3, 3)).toBe(100);
    expect(checklistPercent(0, 0)).toBe(0);
  });

  it('tên đầu việc: bỏ khoảng trắng, từ chối rỗng và quá dài', () => {
    expect(parseChecklistTitle('  Gửi hồ sơ ')).toBe('Gửi hồ sơ');
    expect(() => parseChecklistTitle(' ')).toThrow(WorkspaceValidationError);
    expect(() => parseChecklistTitle('x'.repeat(201))).toThrow(WorkspaceValidationError);
  });

  it('danh sách tạo sẵn: bỏ dòng trống, giữ thứ tự, tối đa 50', () => {
    expect(parseChecklistTitles(['A', ' ', 'B '])).toEqual(['A', 'B']);
    expect(parseChecklistTitles(undefined)).toEqual([]);
    expect(() => parseChecklistTitles('A')).toThrow(WorkspaceValidationError);
    expect(() => parseChecklistTitles(Array.from({ length: 51 }, (_, i) => `Việc ${i}`))).toThrow(WorkspaceValidationError);
  });
});

describe('chỉ đạt 100% khi đã đủ', () => {
  it('thiếu dù ít thì tối đa 99%, không tự hoàn thành vì làm tròn', () => {
    expect(quantityPercent(996, 1000)).toBe(99);
    expect(quantityPercent(1000, 1000)).toBe(100);
    expect(checklistPercent(199, 200)).toBe(99);
    expect(checklistPercent(200, 200)).toBe(100);
  });
});
