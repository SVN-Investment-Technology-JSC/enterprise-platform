import type { FinanceAllocation, FinanceRelatedProject } from '@enterprise-platform/contracts-finance';
import { invalid } from '../domain/finance.error.js';
import type { NormalizedVoucher } from '../domain/voucher.rules.js';
import { fetchWorkspaceProject, fetchWorkspaceWorkItem } from './workspace-api.js';
import type { ResolvedWorkspaceLinks } from './vouchers.store.js';

/**
 * Xác nhận hạch toán và dự án liên quan với Workspace, lấy mã/tên chuẩn để lưu kèm phiếu.
 *
 * Client chỉ gửi id: mã và tên không bao giờ nhận từ client, nên không ai gắn nhãn tuỳ ý vào phiếu. Mọi id phải tồn tại trong
 * tenant (Workspace tra theo tenant của lời gọi) và dự án mới gắn không được là dự án đã huỷ. Phần đã lưu trên phiếu mà không đổi
 * thì dùng lại nhãn đã lưu, không hỏi Workspace: sửa nội dung phiếu không phụ thuộc Workspace đang chạy, và dự án huỷ sau này không
 * làm phiếu cũ không lưu lại được.
 */
export async function resolveWorkspaceLinks(
  tenantId: string,
  voucher: Pick<NormalizedVoucher, 'allocation' | 'relatedProjectIds'>,
  stored: ResolvedWorkspaceLinks | null,
): Promise<ResolvedWorkspaceLinks> {
  const { allocation, relatedProjectIds } = voucher;
  if (!allocation && relatedProjectIds.length === 0) return { allocation: null, relatedProjects: [] };

  const known = new Map<string, FinanceRelatedProject>();
  if (stored?.allocation)
    known.set(stored.allocation.projectId, { projectId: stored.allocation.projectId, projectCode: stored.allocation.projectCode, projectName: stored.allocation.projectName });
  for (const project of stored?.relatedProjects ?? []) known.set(project.projectId, project);

  const projectOf = async (projectId: string): Promise<FinanceRelatedProject> => {
    const reused = known.get(projectId);
    if (reused) return reused;
    const found = await fetchWorkspaceProject(tenantId, projectId);
    if (!found) throw invalid('Dự án không tồn tại.');
    if (found.status === 'cancelled') throw invalid(`Dự án ${found.code} đã huỷ, không thể gắn vào phiếu.`);
    return { projectId: found.id, projectCode: found.code, projectName: found.name };
  };

  let resolvedAllocation: FinanceAllocation | null = null;
  if (allocation) {
    const project = await projectOf(allocation.projectId);
    if (allocation.type === 'PROJECT') {
      resolvedAllocation = { type: 'PROJECT', ...project, workItemId: null, workItemCode: null, workItemTitle: null };
    } else {
      const same = stored?.allocation?.workItemId === allocation.workItemId && stored.allocation.projectId === allocation.projectId ? stored.allocation : null;
      if (same) {
        resolvedAllocation = { ...same, type: 'WORK_ITEM' };
      } else {
        const item = await fetchWorkspaceWorkItem(tenantId, String(allocation.workItemId));
        if (!item) throw invalid('Công việc không tồn tại.');
        if (item.project.id !== allocation.projectId) throw invalid(`Công việc ${item.code} không thuộc dự án đã chọn.`);
        if (item.status === 'cancelled') throw invalid(`Công việc ${item.code} đã huỷ, không thể hạch toán.`);
        resolvedAllocation = { type: 'WORK_ITEM', ...project, workItemId: item.id, workItemCode: item.code, workItemTitle: item.title };
      }
    }
  }

  // Tuần tự theo thứ tự người dùng chọn: lỗi nêu đúng dự án đầu tiên sai, kết quả ổn định.
  const relatedProjects: FinanceRelatedProject[] = [];
  for (const id of relatedProjectIds) relatedProjects.push(await projectOf(id));
  return { allocation: resolvedAllocation, relatedProjects };
}
