import type { MaintenancePriority } from '@enterprise-platform/contracts-maintenance';

/** Giá trị ban đầu của form "Tạo sự cố"; chỉ ô có mặt mới được điền. */
export interface IncidentFormValues {
  readonly assetCode?: string;
  readonly title?: string;
  readonly description?: string;
  readonly priority?: MaintenancePriority;
  readonly procedureDefinitionId?: string;
  readonly assigneeId?: string;
}

const PRIORITIES: readonly MaintenancePriority[] = ['High', 'Normal', 'Low'];

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Đổi bản nháp của Trợ lý (tên trường của `CreateMaintenanceIncidentRequest`) thành giá trị form. Giá trị sai kiểu
 * hoặc không có trong danh mục đang hiện trên form thì bỏ qua, để người dùng tự chọn.
 */
export function incidentDraftToFormValues(
  draft: Readonly<Record<string, unknown>>,
  options: {
    readonly assetCodes: readonly string[];
    readonly procedureDefinitionIds: readonly string[];
    /** Rỗng khi danh bạ chưa nạp được: giữ nguyên mã, form tự bỏ nếu không khớp lúc lưu. */
    readonly memberIds: readonly string[];
  },
): IncidentFormValues {
  const values: {
    -readonly [K in keyof IncidentFormValues]: IncidentFormValues[K];
  } = {};

  const assetCode = text(draft['assetCode']);
  const asset = assetCode
    ? options.assetCodes.find((code) => code.toLowerCase() === assetCode.toLowerCase())
    : undefined;
  if (asset) values.assetCode = asset;

  const title = text(draft['title']);
  if (title) values.title = title;

  const description = text(draft['description']);
  if (description) values.description = description;

  const priority = text(draft['priority']);
  const matchedPriority = priority
    ? PRIORITIES.find((item) => item.toLowerCase() === priority.toLowerCase())
    : undefined;
  if (matchedPriority) values.priority = matchedPriority;

  const procedureDefinitionId = text(draft['procedureDefinitionId']);
  if (procedureDefinitionId && options.procedureDefinitionIds.includes(procedureDefinitionId))
    values.procedureDefinitionId = procedureDefinitionId;

  const assigneeId = text(draft['assigneeId']);
  if (assigneeId && (options.memberIds.length === 0 || options.memberIds.includes(assigneeId)))
    values.assigneeId = assigneeId;

  return values;
}
