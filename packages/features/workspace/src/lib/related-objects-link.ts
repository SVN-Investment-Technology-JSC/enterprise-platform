import type { Project, ProjectRole } from '@enterprise-platform/contracts-workspace';
import { mergeNewProjectMembers } from './project-tree.model';
import {
  completedRelated,
  existingRelatedRows,
  relatedChanges,
  relatedLinkWarning,
  relatedUnlinkWarning,
  type PendingRelatedObject,
  type RelatedLinkFailure,
} from './related-objects.model';
import * as api from './workspace-api';

const messageOf = (cause: unknown) => (cause as { message?: string })?.message ?? '';

/**
 * Gắn lần lượt các dòng đã chọn đủ vào dự án hoặc công việc. Dòng nào lỗi thì ghi lại rồi làm tiếp: dự án hay
 * công việc đã tạo không bị huỷ vì một liên kết hỏng. Trả các dòng chưa gắn được kèm lý do.
 */
export async function linkRelatedObjects(
  target: RelatedTarget,
  rows: readonly PendingRelatedObject[],
): Promise<RelatedLinkFailure[]> {
  const failures: RelatedLinkFailure[] = [];
  for (const item of completedRelated(rows)) {
    const body = { kind: item.kind, objectId: item.objectId };
    try {
      await (target.type === 'project'
        ? api.addProjectRelatedObject(target.id, body)
        : api.addWorkItemRelatedObject(target.id, body));
    } catch (cause) {
      failures.push({ item, message: messageOf(cause) });
    }
  }
  return failures;
}

export interface RelatedTarget {
  readonly type: 'project' | 'work_item';
  readonly id: string;
}

/**
 * Liên kết đã lưu của dự án hay công việc, thành dòng của form sửa, kèm quyền thêm. Danh sách của dự án có cả liên
 * kết gắn ở công việc: chỉ giữ liên kết của chính đối tượng đang sửa.
 */
export async function loadEntityRelatedRows(
  target: RelatedTarget,
): Promise<{ readonly rows: PendingRelatedObject[]; readonly canAdd: boolean }> {
  const list =
    target.type === 'project'
      ? await api.listProjectRelatedObjects(target.id)
      : await api.listWorkItemRelatedObjects(target.id);
  return { rows: existingRelatedRows(list.items, target), canAdd: list.canAdd };
}

/** Gỡ lần lượt các liên kết đã lưu; liên kết nào lỗi thì ghi lại rồi làm tiếp. */
export async function unlinkRelatedObjects(rows: readonly PendingRelatedObject[]): Promise<RelatedLinkFailure[]> {
  const failures: RelatedLinkFailure[] = [];
  for (const item of rows) {
    if (!item.existingId) continue;
    try {
      await api.removeRelatedObject(item.existingId);
    } catch (cause) {
      failures.push({ item, message: messageOf(cause) });
    }
  }
  return failures;
}

/**
 * Lưu thay đổi "Đối tượng liên quan" của form sửa, chạy sau khi đối tượng đã lưu xong: gỡ liên kết bị bỏ, gắn dòng
 * mới. Không bao giờ ném lỗi; trả lời cảnh báo để nơi gọi báo (không chặn). `label` ví dụ "công việc CV-001".
 */
export async function saveRelatedChanges(
  target: RelatedTarget,
  initial: readonly PendingRelatedObject[],
  current: readonly PendingRelatedObject[],
  label: string,
): Promise<{ readonly warnings: string[]; readonly changed: boolean }> {
  const { added, removed } = relatedChanges(initial, current);
  const unlinkFailures = await unlinkRelatedObjects(removed);
  const linkFailures = await linkRelatedObjects(target, added);
  const warnings: string[] = [];
  if (unlinkFailures.length > 0) warnings.push(relatedUnlinkWarning(unlinkFailures, label));
  if (linkFailures.length > 0) warnings.push(relatedLinkWarning(linkFailures, label));
  return { warnings, changed: added.length + removed.length > 0 };
}

/** Những thứ đi đường riêng sau khi `POST /projects` thành công. */
export interface ProjectCreateFollowUp {
  /** `undefined`: không đụng tới tài chính. */
  readonly contractValue?: number | null;
  /** Người được thêm ngay lúc tạo (ngoài người tạo, đã là chủ nhiệm). */
  readonly members?: ReadonlyArray<{ readonly userId: string; readonly role: ProjectRole }>;
  readonly relatedObjects?: readonly PendingRelatedObject[];
  /** Nhóm báo cáo chọn lúc tạo; rỗng là không gán. */
  readonly reportGroupId?: string;
}

/**
 * Việc kèm theo khi vừa tạo dự án. Giá trị hợp đồng và thành viên giữ y như trước (cùng thứ tự, lỗi thì ném ra).
 * Đối tượng liên quan rồi nhóm báo cáo chạy SAU CÙNG và không bao giờ chặn: dự án đã có, bước nào hỏng chỉ thành lời
 * cảnh báo trả về để nơi gọi báo.
 */
export async function finishProjectCreate(created: Project, followUp: ProjectCreateFollowUp): Promise<string[]> {
  if (followUp.contractValue !== undefined) {
    await api.updateProjectFinance(created.id, { contractValue: followUp.contractValue });
  }
  // Endpoint thành viên thay cả danh sách và cần đúng một chủ nhiệm, nên gộp cùng người tạo (đã là chủ nhiệm).
  if (followUp.members && followUp.members.length > 0) {
    const existing = await api.listMembers(created.id);
    await api.setMembers(created.id, {
      members: mergeNewProjectMembers(existing.items, followUp.members),
    });
  }
  const failures = await linkRelatedObjects({ type: 'project', id: created.id }, followUp.relatedObjects ?? []);
  const warnings = failures.length > 0 ? [relatedLinkWarning(failures, `dự án ${created.code}`)] : [];
  // Nhóm báo cáo cũng không chặn: dự án đã có, gán hỏng thì nhắc gán lại ở chip "Nhóm báo cáo" trong trang dự án.
  if (followUp.reportGroupId) {
    try {
      await api.setProjectReportGroup(created.id, { reportGroupId: followUp.reportGroupId });
    } catch (cause) {
      const reason = messageOf(cause).replace(/[.\s]+$/, '');
      warnings.push(
        `Dự án ${created.code} đã tạo nhưng chưa gán được nhóm báo cáo${reason ? ` (${reason})` : ''}. Gán lại trong trang dự án.`,
      );
    }
  }
  return warnings;
}
