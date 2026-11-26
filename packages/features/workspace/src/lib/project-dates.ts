/**
 * Ngày bắt đầu / kết thúc của dự án trên bảng Dự án: các cột `Bắt đầu` và `Kết thúc`, và hàng tóm tắt của nhóm.
 * Ngày là chuỗi `YYYY-MM-DD` nên so sánh chuỗi cũng là so sánh ngày.
 */
interface DatedProject {
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly status: string;
}

const present = (value: string | null | undefined): value is string => Boolean(value);

/** Quá hạn: đã qua ngày kết thúc mà dự án chưa hoàn thành hay huỷ. */
export function isProjectOverdue(project: DatedProject, today: string, closedStatuses: readonly string[]): boolean {
  return Boolean(project.endDate && project.endDate < today) && !closedStatuses.includes(project.status);
}

/** Ngày bắt đầu sớm nhất của cả nhóm (kể cả dự án đã đóng): cho biết nhóm bắt đầu từ khi nào. */
export function earliestStartDate(projects: readonly DatedProject[]): string | undefined {
  return projects
    .map((project) => project.startDate)
    .filter(present)
    .sort()[0];
}

/** Hạn kết thúc gần nhất trong các dự án chưa đóng của nhóm. */
export function nextEndDate(projects: readonly DatedProject[], closedStatuses: readonly string[]): string | undefined {
  return projects
    .filter((project) => !closedStatuses.includes(project.status))
    .map((project) => project.endDate)
    .filter(present)
    .sort()[0];
}
