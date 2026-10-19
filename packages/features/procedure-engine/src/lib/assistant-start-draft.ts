/** Giá trị điền sẵn vào form "Tạo đơn / yêu cầu"; chỉ ô có mặt mới được điền. */
export interface StartPrefillValues {
  readonly title?: string;
  readonly definitionId?: string;
  /** ISO 8601, như `startDueAt` của request mở hồ sơ. */
  readonly startDueAt?: string;
  readonly endDueAt?: string;
  readonly projectId?: string;
  /** Mô tả công việc khi gắn dự án. */
  readonly description?: string;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isoDateTime(value: unknown): string | undefined {
  const raw = text(value);
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : undefined;
}

/**
 * Đổi bản nháp của Trợ lý (`ProcedureStartAssistantDraft`) và biến thể (mã quy trình) thành giá trị form. Giá trị
 * sai kiểu, ngày không đọc được, hay quy trình không còn công bố thì bỏ qua để người dùng tự chọn.
 */
export function startDraftToPrefill(
  draft: Readonly<Record<string, unknown>>,
  variant: string | undefined,
  publishedDefinitionIds: readonly string[],
): StartPrefillValues {
  const values: { -readonly [K in keyof StartPrefillValues]: StartPrefillValues[K] } = {};

  const title = text(draft['title']);
  if (title) values.title = title;

  if (variant && publishedDefinitionIds.includes(variant)) values.definitionId = variant;

  const startDueAt = isoDateTime(draft['startDueAt']);
  if (startDueAt) values.startDueAt = startDueAt;
  const endDueAt = isoDateTime(draft['endDueAt']);
  if (endDueAt) values.endDueAt = endDueAt;

  const projectId = text(draft['projectId']);
  if (projectId) values.projectId = projectId;

  const description = text(draft['description']);
  if (description) values.description = description;

  return values;
}
