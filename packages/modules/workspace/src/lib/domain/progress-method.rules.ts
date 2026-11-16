import {
  CHECKLIST_TITLE_MAX_LENGTH,
  MAX_CHECKLIST_ITEMS,
  MAX_WORK_ITEM_QUANTITY,
  QUANTITY_UNIT_MAX_LENGTH,
  WORK_ITEM_PROGRESS_METHODS,
  type WorkItemProgressMethod,
} from '@enterprise-platform/contracts-workspace';
import { WorkspaceValidationError } from './workspace.error.js';

/** Cách tính tiến độ của công việc; giá trị lạ là lỗi nhập liệu (vắng thì do nơi gọi chọn mặc định). */
export function parseProgressMethod(value: unknown): WorkItemProgressMethod {
  if (!(WORK_ITEM_PROGRESS_METHODS as readonly string[]).includes(String(value))) {
    throw new WorkspaceValidationError('Cách tính tiến độ công việc không hợp lệ.');
  }
  return value as WorkItemProgressMethod;
}

/** Khối lượng (cần làm hay đã làm): số hữu hạn, tối đa 2 chữ số thập phân, trong giới hạn của cột. */
function parseQuantity(value: unknown, label: string, allowZero: boolean): number {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    throw new WorkspaceValidationError(`${label} phải là một số.`);
  }
  if (allowZero ? number < 0 : number <= 0) {
    throw new WorkspaceValidationError(`${label} phải ${allowZero ? 'không âm' : 'lớn hơn 0'}.`);
  }
  if (number > MAX_WORK_ITEM_QUANTITY) {
    throw new WorkspaceValidationError(`${label} tối đa ${MAX_WORK_ITEM_QUANTITY.toLocaleString('vi-VN')}.`);
  }
  return Math.round(number * 100) / 100;
}

export const parseQuantityTarget = (value: unknown): number => parseQuantity(value, 'Khối lượng cần hoàn thành', false);
export const parseQuantityDone = (value: unknown): number => parseQuantity(value, 'Khối lượng đã hoàn thành', true);

/** Đơn vị khối lượng: bắt buộc, bỏ khoảng trắng hai đầu. */
export function parseQuantityUnit(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new WorkspaceValidationError('Hãy nhập đơn vị của khối lượng (ví dụ: bộ, m, trang).');
  if (text.length > QUANTITY_UNIT_MAX_LENGTH) {
    throw new WorkspaceValidationError(`Đơn vị dài tối đa ${QUANTITY_UNIT_MAX_LENGTH} ký tự.`);
  }
  return text;
}

/**
 * Phần trăm của `done` trên `total`, làm tròn nhưng chỉ đạt 100% khi đã đủ: còn thiếu dù ít (vd 996/1000) thì tối đa
 * 99%, kẻo việc tự hoàn thành khi vẫn còn dở.
 */
function ratioPercent(done: number, total: number): number {
  if (done >= total) return 100;
  return Math.min(99, Math.max(0, Math.round((done / total) * 100)));
}

/** Tiến độ theo khối lượng: đã làm / cần làm; 100% chỉ khi đủ khối lượng. */
export function quantityPercent(done: number, target: number | undefined): number {
  if (!target || target <= 0) return 0;
  return ratioPercent(done, target);
}

/** Tiến độ theo đầu việc: đầu việc đã tích / tổng; 100% chỉ khi tích hết; không có đầu việc nào là 0%. */
export function checklistPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return ratioPercent(done, total);
}

/** Tên một đầu việc: bắt buộc, bỏ khoảng trắng hai đầu. */
export function parseChecklistTitle(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new WorkspaceValidationError('Tên đầu việc không được để trống.');
  if (text.length > CHECKLIST_TITLE_MAX_LENGTH) {
    throw new WorkspaceValidationError(`Tên đầu việc dài tối đa ${CHECKLIST_TITLE_MAX_LENGTH} ký tự.`);
  }
  return text;
}

/** Danh sách đầu việc tạo sẵn: bỏ dòng trống, kiểm từng tên, tối đa `MAX_CHECKLIST_ITEMS`. */
export function parseChecklistTitles(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new WorkspaceValidationError('Danh sách đầu việc không hợp lệ.');
  const titles = value.filter((entry) => !(typeof entry === 'string' && entry.trim() === '')).map(parseChecklistTitle);
  if (titles.length > MAX_CHECKLIST_ITEMS) {
    throw new WorkspaceValidationError(`Một công việc có tối đa ${MAX_CHECKLIST_ITEMS} đầu việc.`);
  }
  return titles;
}
