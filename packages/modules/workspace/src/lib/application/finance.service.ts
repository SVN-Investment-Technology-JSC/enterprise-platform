import {
  COST_ENTRY_PAGE_SIZE,
  MAX_COST_NOTE_LENGTH,
  type CostEntry,
  type CostEntryList,
  type CreateCostEntryRequest,
  type ProjectFinance,
  type ProjectSummary,
  type UpdateProjectFinanceRequest,
  type UpdateWorkItemCostRequest,
} from '@enterprise-platform/contracts-workspace';
import { computeFinance } from '../domain/finance.rules.js';
import {
  FinanceForbiddenError,
  ProjectNotFoundError,
  WorkItemNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import { hasProjectRole, type ProjectAccess, type ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Trần loại trừ của một giá trị tiền.
 *
 * `numeric(18,2)` chứa tối đa 16 chữ số phần nguyên, tức mọi số nhỏ hơn
 * 10^16. Không viết hằng `9_999_999_999_999_999.99`: số đó vượt độ chính xác
 * của `number` và bị làm tròn thành đúng 10^16 — lint `no-loss-of-precision`
 * sẽ bắt, và người đọc sẽ tưởng trần là một con số khác.
 */
const MONEY_LIMIT = 1e16;

/**
 * Tài chính dự án.
 *
 * **Quyền chặn ở tầng application, không thêm quyền nền tảng.** Hiện mọi
 * tenant-user được cấp cùng một bộ quyền Workspace, nên thêm một quyền
 * `workspace.finance.read` cũng không phân biệt được ai với ai. Chốt chặn thật
 * là `project_members.role`: chỉ `owner`, `manager` và quản trị viên tenant.
 */
export class FinanceService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly projects: ProjectService,
  ) {}

  /** `member` và `viewer` gọi thẳng vào đây nhận `403 FINANCE_FORBIDDEN`. */
  async forProject(actor: WorkspaceActor, projectId: string): Promise<ProjectFinance> {
    const access = await this.projects.access(actor, projectId);
    requireFinanceAccess(access);
    return this.compute(actor, projectId);
  }

  /**
   * Chi tiết dự án, kèm tài chính **chỉ khi** người gọi được xem.
   *
   * Với `member` và `viewer`, trường `finance` vắng hẳn khỏi payload. Ẩn ở
   * giao diện mà vẫn gửi số xuống là để lộ nó cho bất kỳ ai mở tab Network.
   */
  async detailWithFinance(actor: WorkspaceActor, projectId: string): Promise<ProjectSummary> {
    const summary = await this.projects.detail(actor, projectId);
    const access = await this.projects.access(actor, projectId);
    if (!canSeeFinance(access)) return summary;
    return { ...summary, finance: await this.compute(actor, projectId) };
  }

  async updateProject(
    actor: WorkspaceActor,
    projectId: string,
    input: UpdateProjectFinanceRequest,
  ): Promise<ProjectFinance> {
    const access = await this.projects.access(actor, projectId);
    requireFinanceAccess(access);

    const patch: Record<string, number | null> = {};
    if (input?.contractValue !== undefined) {
      patch.contractValue = money(input.contractValue, 'Giá trị hợp đồng', true);
    }
    if (input?.budget !== undefined) patch.budget = money(input.budget, 'Ngân sách', true);
    if (input?.committedCost !== undefined) {
      patch.committedCost = money(input.committedCost, 'Chi phí đã cam kết', false);
    }
    if (input?.forecastCostOverride !== undefined) {
      patch.forecastCostOverride = money(
        input.forecastCostOverride,
        'Chi phí dự kiến ghi đè',
        true,
      );
    }

    await this.store.finance.updateProject(actor.tenantId, projectId, patch);
    return this.compute(actor, projectId);
  }

  /**
   * Chi phí của một công việc.
   *
   * Endpoint riêng, không nằm trong `PATCH /work-items/:id`: `member` được sửa
   * công việc của mình nhưng không được đụng số tiền, và tách endpoint là cách
   * chặn chắc chắn hơn việc nhớ lọc trường ở từng chỗ.
   */
  async updateItemCost(
    actor: WorkspaceActor,
    workItemId: string,
    input: UpdateWorkItemCostRequest,
  ): Promise<ProjectFinance> {
    const item = await this.store.workItem.findById(actor.tenantId, workItemId);
    if (!item) throw new WorkItemNotFoundError(workItemId);
    const access = await this.projects.access(actor, item.projectId);
    requireFinanceAccess(access);
    // `phase` là vỏ chứa; đặt chi phí lên nó sẽ bị cộng hai lần cùng việc con.
    if (item.itemType === 'phase') {
      throw new WorkspaceValidationError(
        'Nhóm công việc không mang chi phí; hãy nhập ở từng việc con.',
      );
    }

    // Chi phí thực tế không nhận ở đây: gửi `actualCost` lên thì báo rõ phải
    // đi qua sổ, thay vì lặng lẽ bỏ qua khiến người dùng tưởng đã lưu.
    if ((input as { actualCost?: unknown } | undefined)?.actualCost !== undefined) {
      throw new WorkspaceValidationError(
        'Chi phí thực tế ghi qua sổ chi phí, kèm lý do — không sửa thẳng được.',
      );
    }

    const patch: Record<string, number | null> = {};
    if (input?.estimatedCost !== undefined) {
      patch.estimatedCost = money(input.estimatedCost, 'Chi phí dự toán', true);
    }

    await this.store.finance.updateItem(actor.tenantId, workItemId, patch);
    return this.compute(actor, item.projectId);
  }

  /**
   * Ghi một dòng sổ chi phí thực tế.
   *
   * Chỉ ghi thêm: nhập sai thì ghi một dòng điều chỉnh âm kèm lý do. Tổng của
   * công việc không được âm — store kiểm lại sau khi khoá dòng.
   */
  async addCostEntry(
    actor: WorkspaceActor,
    workItemId: string,
    input: CreateCostEntryRequest,
  ): Promise<{ entry: CostEntry; finance: ProjectFinance }> {
    const item = await this.store.workItem.findById(actor.tenantId, workItemId);
    if (!item) throw new WorkItemNotFoundError(workItemId);
    const access = await this.projects.access(actor, item.projectId);
    requireFinanceAccess(access);
    if (item.itemType === 'phase') {
      throw new WorkspaceValidationError(
        'Nhóm công việc không mang chi phí; hãy ghi ở từng việc con.',
      );
    }

    const amount = signedMoney(input?.amount);
    const note = String(input?.note ?? '').trim();
    if (!note) throw new WorkspaceValidationError('Lý do ghi chi phí không được để trống.');
    if (note.length > MAX_COST_NOTE_LENGTH) {
      throw new WorkspaceValidationError(
        `Lý do ghi chi phí không được dài quá ${MAX_COST_NOTE_LENGTH} ký tự.`,
      );
    }

    const entry = await this.store.finance.addCostEntry(actor.tenantId, actor.userId, {
      workItemId,
      projectId: item.projectId,
      amount,
      note,
    });
    return { entry, finance: await this.compute(actor, item.projectId) };
  }

  async costEntriesForWorkItem(actor: WorkspaceActor, workItemId: string): Promise<CostEntryList> {
    const item = await this.store.workItem.findById(actor.tenantId, workItemId);
    if (!item) throw new WorkItemNotFoundError(workItemId);
    requireFinanceAccess(await this.projects.access(actor, item.projectId));
    return {
      items: await this.store.finance.listCostEntries(
        actor.tenantId,
        { workItemId },
        COST_ENTRY_PAGE_SIZE,
      ),
    };
  }

  async costEntriesForProject(actor: WorkspaceActor, projectId: string): Promise<CostEntryList> {
    requireFinanceAccess(await this.projects.access(actor, projectId));
    return {
      items: await this.store.finance.listCostEntries(
        actor.tenantId,
        { projectId },
        COST_ENTRY_PAGE_SIZE,
      ),
    };
  }

  private async compute(actor: WorkspaceActor, projectId: string): Promise<ProjectFinance> {
    const [inputs, items] = await Promise.all([
      this.store.finance.inputs(actor.tenantId, [projectId]),
      this.store.finance.itemCosts(actor.tenantId, projectId),
    ]);
    const raw = inputs.get(projectId);
    if (!raw) throw new ProjectNotFoundError(projectId);

    return {
      projectId,
      ...computeFinance(raw),
      forecastCostOverride: raw.forecastCostOverride,
      items,
    };
  }
}

export function canSeeFinance(access: ProjectAccess): boolean {
  return hasProjectRole(access, 'manager');
}

function requireFinanceAccess(access: ProjectAccess): void {
  if (!canSeeFinance(access)) throw new FinanceForbiddenError();
}

/**
 * Chuẩn hoá một giá trị tiền.
 *
 * Chặn số âm ở **server** chứ không chỉ ở giao diện: ràng buộc `CHECK >= 0`
 * trong CSDL vẫn bắt được, nhưng khi đó người dùng nhận một lỗi 500 khó hiểu
 * thay vì thông điệp nói rõ ô nào sai.
 */
function money(value: unknown, label: string, nullable: boolean): number | null {
  if (value === null) {
    if (nullable) return null;
    throw new WorkspaceValidationError(`${label} không được để trống.`);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new WorkspaceValidationError(`${label} phải là một số.`);
  }
  if (amount < 0) throw new WorkspaceValidationError(`${label} không được là số âm.`);
  if (amount >= MONEY_LIMIT) {
    throw new WorkspaceValidationError(`${label} vượt quá giới hạn lưu trữ.`);
  }
  return Math.round(amount * 100) / 100;
}

/**
 * Số tiền của một dòng sổ: được âm (điều chỉnh), không được bằng 0.
 */
function signedMoney(value: unknown): number {
  const amount = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(amount)) {
    throw new WorkspaceValidationError('Số tiền phải là một số.');
  }
  const rounded = Math.round(amount * 100) / 100;
  if (rounded === 0) throw new WorkspaceValidationError('Số tiền phải khác 0.');
  if (Math.abs(rounded) >= MONEY_LIMIT) {
    throw new WorkspaceValidationError('Số tiền vượt quá giới hạn lưu trữ.');
  }
  return rounded;
}
