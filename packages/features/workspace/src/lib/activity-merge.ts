import type { WorkItemFieldChange, WorkItemStatusHistoryEntry } from '@enterprise-platform/contracts-workspace';

/** Cùng phút (giờ UTC của chuỗi ISO là đủ để so hai mốc có chung múi giờ). */
const minuteOf = (iso: string) => iso.slice(0, 16);

const sameValue = (a: WorkItemFieldChange['from'], b: WorkItemFieldChange['to']) =>
  JSON.stringify(a) === JSON.stringify(b);

const isFieldEdit = (entry: WorkItemStatusHistoryEntry) => !entry.toStatus;

/**
 * Gộp các dòng "Sửa thông tin" liền nhau của cùng một người trong cùng một phút thành một dòng, để nhật ký không bị
 * chuỗi dòng lặp ("Tiến độ nhập tay 0% → 50%", rồi "50% → 33%"...). Mỗi trường giữ giá trị cũ của lần sửa đầu và giá
 * trị mới của lần sửa cuối; trường kết thúc đúng như lúc bắt đầu thì bỏ. Chỉ là cách hiển thị: dữ liệu nhật ký không đổi.
 *
 * `entries` xếp mới -> cũ (thứ tự server trả về). Dòng đổi trạng thái giữ nguyên và cắt đứt dãy gộp.
 */
export function mergeFieldEdits(
  entries: readonly WorkItemStatusHistoryEntry[],
): WorkItemStatusHistoryEntry[] {
  const result: WorkItemStatusHistoryEntry[] = [];
  let run: WorkItemStatusHistoryEntry[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      result.push(run[0] as WorkItemStatusHistoryEntry);
    } else {
      // Từ cũ nhất tới mới nhất để lấy "từ" của lần đầu và "đến" của lần cuối.
      const merged = new Map<WorkItemFieldChange['field'], WorkItemFieldChange>();
      for (const entry of [...run].reverse()) {
        for (const change of entry.changes ?? []) {
          const before = merged.get(change.field);
          merged.set(change.field, before ? { field: change.field, from: before.from, to: change.to } : change);
        }
      }
      const changes = [...merged.values()].filter((change) => !sameValue(change.from, change.to));
      if (changes.length > 0) result.push({ ...(run[0] as WorkItemStatusHistoryEntry), changes });
    }
    run = [];
  };

  for (const entry of entries) {
    const last = run[run.length - 1];
    const joins =
      last &&
      isFieldEdit(entry) &&
      isFieldEdit(last) &&
      entry.createdBy === last.createdBy &&
      minuteOf(entry.createdAt) === minuteOf(last.createdAt);
    if (!joins) flush();
    if (isFieldEdit(entry)) run.push(entry);
    else result.push(entry);
  }
  flush();
  return result;
}
