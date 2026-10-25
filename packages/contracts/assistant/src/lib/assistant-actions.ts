import {
  tenantModulePermissions,
  type TenantAction,
} from '@enterprise-platform/contracts-identity';

/**
 * Chuẩn khai báo thao tác cho Trợ lý Savina.
 *
 * Mỗi phân hệ khai báo thao tác của mình trong `packages/contracts/<phân hệ>/src/lib/assistant-actions.ts`
 * bằng `defineAssistantActions`. Trợ lý chỉ đọc khai báo để hiểu người dùng muốn làm gì và soạn bản nháp;
 * popup của chính phân hệ hiển thị và lưu, nên mọi kiểm tra dữ liệu và quyền vẫn do phân hệ giữ.
 */

/**
 * Một ô Trợ lý được điền sẵn. Dạng chuỗi là quy tắc điền ô cho mô hình ngôn ngữ; dạng đầy đủ thêm nguồn tra mã và
 * cờ bắt buộc. Trợ lý chỉ nhận tên ô, cờ bắt buộc và quy tắc này rồi tự quyết điền gì: quy tắc riêng của phân hệ viết
 * ở đây, không viết vào prompt của Trợ lý.
 */
export type AssistantDraftField =
  | string
  | {
      readonly describe: string;
      /**
       * GET trả danh sách để đổi tên người dùng nói ra (ví dụ "anh Bình") thành mã. Trợ lý gọi bằng chính phiên
       * của người hỏi, nên chỉ thấy đúng những gì người đó được thấy. Phải là `/api/...`, không dùng route nội bộ.
       */
      readonly lookup?: string;
      /**
       * Cột của kết quả `lookup` mà Trợ lý cần thấy ngoài mã và tên, ví dụ `requiresDescription` của lý do. Trợ lý chỉ
       * giữ cột mã và tên khi tra; cột khai ở đây được giữ nguyên, kể cả mảng.
       */
      readonly columns?: readonly string[];
      /** Form không lưu được khi thiếu ô này và không tự có giá trị mặc định (như kiểm tra của chính form). */
      readonly required?: boolean;
    };

/** Một ô như Trợ lý nhận trong danh mục. */
export interface AssistantCatalogField {
  readonly describe: string;
  readonly lookup?: string;
  readonly columns?: readonly string[];
  readonly required?: boolean;
}

/**
 * Biến thể của thao tác theo cấu hình công ty. Trợ lý gọi `lookup` bằng phiên của người hỏi, in sẵn các biến thể vào
 * danh mục (mã, tên và `columns`) và gửi mã biến thể đã chọn trong `variant`.
 */
export interface AssistantVariants {
  readonly describe: string;
  readonly lookup: string;
  /** Cột của mỗi biến thể cần thấy ngoài mã và tên, ví dụ `timeMode`, `fields` của loại đơn. */
  readonly columns?: readonly string[];
}

/** Các ô của request mà Trợ lý được điền. Khoá là tên trường có thật của request gửi lên API. */
export type AssistantDraft<TRequest> = {
  readonly [K in keyof TRequest]?: AssistantDraftField;
};

export interface AssistantActionDefinition<TRequest = unknown> {
  /** `<tiền tố quyền>.<đối tượng>.<động từ>`, ví dụ `workspace.event.create`. Không đổi sau khi phát hành. */
  readonly key: string;
  /** Tên thao tác hiện cho người dùng, ví dụ "Tạo cuộc họp". */
  readonly title: string;
  /** Những cách người dùng hay nói để gọi thao tác này. */
  readonly hints?: readonly string[];
  /**
   * Khoá quyền sẵn có của phân hệ (trong `TENANT_PERMISSION_ACTIONS`, hoặc `module.access`). Người không có
   * quyền này không thấy thao tác. Không tạo khoá quyền mới riêng cho Trợ lý.
   */
  readonly permission: TenantAction | 'module.access';
  /** Trang có popup của thao tác, ví dụ `/modules/workspace#calendar`. */
  readonly page: string;
  readonly draft: AssistantDraft<TRequest>;
  /**
   * Thao tác có nhiều biến thể theo cấu hình của công ty (loại đơn tuỳ chỉnh, quy trình đã phát hành): Trợ lý gọi
   * `lookup` bằng phiên của người hỏi để liệt kê biến thể và gửi mã biến thể đã chọn trong `variant`.
   */
  readonly variants?: AssistantVariants;
}

/** Một thao tác như Trợ lý nhận qua `GET /api/<phân hệ>/v1/assistant/actions` (đã lọc theo quyền người gọi). */
export interface AssistantCatalogItem {
  readonly key: string;
  readonly module: string;
  readonly title: string;
  readonly hints: readonly string[];
  readonly page: string;
  /** Trang form nhúng của phân hệ mà khung chat đặt trong card (xem `assistantFormPath`). */
  readonly form: string;
  readonly draft: Readonly<Record<string, AssistantCatalogField>>;
  readonly variants?: AssistantVariants;
}

const MODULE_BASE = /^\/modules\/[a-z][a-z-]*/;

/**
 * Trang form nhúng của phân hệ chứa `page`: `/modules/<phân hệ>/assistant/form`. Khung chat đặt trang này trong card
 * (`?key=<thao tác>&rid=<requestId>`), gửi bản nháp qua `postMessage`; trang dựng `AssistantFormHost` của ModuleShell
 * quanh chính form của phân hệ. Mỗi web phân hệ có đúng một route này cho mọi thao tác của nó.
 */
export function assistantFormPath(page: string): string {
  const base = MODULE_BASE.exec(page)?.[0];
  if (!base) throw new Error(`page "${page}" không thuộc trang /modules/<phân hệ>.`);
  return `${base}/assistant/form`;
}

export function toCatalogItem(action: AssistantAction): AssistantCatalogItem {
  const draft: Record<string, AssistantCatalogField> = {};
  for (const [field, spec] of Object.entries(action.draft) as [string, AssistantDraftField | undefined][]) {
    if (spec === undefined) continue;
    draft[field] = typeof spec === 'string' ? { describe: spec } : { ...spec };
  }
  return {
    key: action.key,
    module: action.module,
    title: action.title,
    hints: action.hints ?? [],
    page: action.page,
    form: assistantFormPath(action.page),
    draft,
    ...(action.variants ? { variants: action.variants } : {}),
  };
}

/** Thao tác đã gắn phân hệ, do `defineAssistantActions` trả về. */
export type AssistantAction<TRequest = unknown> =
  AssistantActionDefinition<TRequest> & { readonly module: string };

export type AssistantActionCatalog = Readonly<Record<string, AssistantAction>>;

/**
 * Khai báo ô được điền theo kiểu request của API: gõ sai tên trường là typecheck báo lỗi.
 *
 * @example draft: draftOf<CreateEventRequest>({ title: 'Tiêu đề cuộc họp' })
 */
export function draftOf<TRequest>(
  draft: AssistantDraft<TRequest>,
): AssistantDraft<TRequest> {
  return draft;
}

/**
 * Gắn mã phân hệ (như trong danh mục phân hệ, ví dụ `workspace`, `procedure-engine`) cho từng thao tác.
 * Giữ nguyên tên khoá để phía giao diện dùng `WORKSPACE_ASSISTANT_ACTIONS.createMeeting`.
 */
export function defineAssistantActions<
  TActions extends Record<string, AssistantActionDefinition>,
>(
  module: string,
  actions: TActions,
): { readonly [K in keyof TActions]: TActions[K] & { readonly module: string } } {
  return Object.fromEntries(
    Object.entries(actions).map(([name, action]) => [
      name,
      Object.freeze({ ...action, module }),
    ]),
  ) as { readonly [K in keyof TActions]: TActions[K] & { readonly module: string } };
}

const ACTION_KEY = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/;

/**
 * Lỗi trong một danh mục thao tác; mảng rỗng là hợp lệ. Mỗi phân hệ gọi trong spec của mình:
 * `expect(assistantActionProblems(WORKSPACE_ASSISTANT_ACTIONS)).toEqual([])`.
 */
export function assistantActionProblems(catalog: AssistantActionCatalog): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [name, action] of Object.entries(catalog)) {
    const where = `${action.module}/${name}`;
    const allowed = tenantModulePermissions(action.module);
    const prefixes = new Set(
      allowed.filter((p) => p !== 'module.access').map((p) => p.split('.')[0]),
    );

    if (!ACTION_KEY.test(action.key))
      problems.push(
        `${where}: key "${action.key}" phải có dạng <tiền tố>.<đối tượng>.<động từ>, chữ thường.`,
      );
    else if (prefixes.size > 0 && !prefixes.has(action.key.split('.')[0]))
      problems.push(
        `${where}: key "${action.key}" phải bắt đầu bằng "${[...prefixes].join('" hoặc "')}.".`,
      );
    if (seen.has(action.key)) problems.push(`${where}: key "${action.key}" bị trùng.`);
    seen.add(action.key);

    if (!allowed.includes(action.permission))
      problems.push(
        `${where}: quyền "${action.permission}" không thuộc phân hệ "${action.module}".`,
      );
    if (!action.title.trim()) problems.push(`${where}: thiếu title.`);
    if (!MODULE_BASE.test(action.page))
      problems.push(`${where}: page "${action.page}" phải là trang của phân hệ (/modules/<phân hệ>...).`);

    for (const [field, spec] of Object.entries(action.draft) as [
      string,
      AssistantDraftField | undefined,
    ][]) {
      if (spec === undefined) continue;
      const describe = typeof spec === 'string' ? spec : spec.describe;
      if (!describe.trim()) problems.push(`${where}: ô "${field}" thiếu mô tả.`);
      const lookup = typeof spec === 'string' ? undefined : spec.lookup;
      if (
        lookup !== undefined &&
        (!lookup.startsWith('/api/') || lookup.includes('/internal/'))
      )
        problems.push(
          `${where}: lookup của ô "${field}" phải là /api/... và không dùng route nội bộ.`,
        );
      const columns = typeof spec === 'string' ? undefined : spec.columns;
      if (columns !== undefined && (lookup === undefined || !validColumns(columns)))
        problems.push(
          `${where}: columns của ô "${field}" cần lookup và là danh sách tên cột không rỗng, không trùng.`,
        );
    }
    const variants = action.variants;
    if (
      variants &&
      (!variants.describe.trim() ||
        !variants.lookup.startsWith('/api/') ||
        variants.lookup.includes('/internal/'))
    )
      problems.push(`${where}: variants cần mô tả và lookup /api/... không dùng route nội bộ.`);
    if (variants?.columns !== undefined && !validColumns(variants.columns))
      problems.push(`${where}: columns của variants phải là danh sách tên cột không rỗng, không trùng.`);
  }
  return problems;
}

const COLUMN = /^[A-Za-z][A-Za-z0-9_]*$/;

function validColumns(columns: readonly string[]): boolean {
  return (
    columns.length > 0 &&
    columns.every((column) => COLUMN.test(column)) &&
    new Set(columns).size === columns.length
  );
}
