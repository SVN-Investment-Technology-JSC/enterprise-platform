import {
  CRM_CUSTOMER_EVENTS,
  type CrmCustomerEventPayload,
  type CrmCustomerReference,
} from '@enterprise-platform/contracts-integration';
import type {
  CrmCustomerOption,
  CrmCustomerSearchResult,
  Customer,
  LinkCrmCustomerRequest,
} from '@enterprise-platform/contracts-workspace';
import { isCrmCustomerVersion } from '../domain/crm-customer-sync.js';
import {
  CrmNotEnabledError,
  WorkspaceError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type {
  CrmCustomerCopyResult,
  CrmCustomerCopyStore,
  CrmCustomerDirectory,
} from './crm-customer.port.js';
import type { WorkspaceActor } from './workspace.application.js';

/** Id hệ thống ghi vào `created_by` khi bản sao do sự kiện tạo mà sự kiện không có người làm. */
export const WORKSPACE_CRM_SYNC_ACTOR_ID = '00000000-0000-4000-8000-000000000004';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCH_LIMIT = 50;
const SEARCH_MAX_LENGTH = 100;

/**
 * Khách hàng Workspace khi tenant bật Bán hàng (D1).
 *
 * - Form dự án tra khách ở Bán hàng qua đây (`search`); chọn một khách thì
 *   `link` tạo hoặc gắn bản sao cục bộ để dự án trỏ tới.
 * - Worker nhận `crm.customer.created|updated` và gọi `handleEvent`.
 *
 * Mọi thao tác ghi chỉ chạm `workspace_schema`; dữ liệu Bán hàng chỉ đọc qua API.
 */
export class CrmCustomerLinkService {
  constructor(
    private readonly directory: CrmCustomerDirectory,
    private readonly copies: CrmCustomerCopyStore,
  ) {}

  /** Tenant có bật Bán hàng không (cờ cho giao diện và chặn sửa khách ở Workspace). */
  enabled(tenantId: string): Promise<boolean> {
    return this.directory.enabled(tenantId);
  }

  async search(actor: WorkspaceActor, query: { readonly search?: string }): Promise<CrmCustomerSearchResult> {
    if (!(await this.directory.enabled(actor.tenantId))) return { enabled: false, items: [] };
    const search = query.search?.trim().slice(0, SEARCH_MAX_LENGTH) || undefined;
    const found = await this.directory.lookup(actor.tenantId, { search, limit: SEARCH_LIMIT });
    const linked = await this.copies.linkedIds(
      actor.tenantId,
      found.map((item) => item.id),
    );
    const items: CrmCustomerOption[] = found.map((item) => ({
      crmCustomerId: item.id,
      code: item.code,
      name: item.name,
      taxCode: item.taxCode,
      ...(linked.get(item.id) ? { customerId: linked.get(item.id) } : {}),
    }));
    return { enabled: true, items };
  }

  /**
   * Bảo đảm có bản sao của một khách Bán hàng rồi trả bản sao. Đọc khách từ
   * Bán hàng (không tin dữ liệu trình duyệt gửi lên). `customerId` chỉ định
   * khách Workspace có sẵn để gắn — chỉ quản trị dùng được (script chuyển khách).
   */
  async link(
    actor: WorkspaceActor,
    crmCustomerId: string,
    body: LinkCrmCustomerRequest = {},
  ): Promise<Customer> {
    if (!UUID_PATTERN.test(crmCustomerId)) throw notFound();
    const target = body.customerId?.trim() || undefined;
    if (target) {
      if (!actor.isTenantAdmin && !actor.canManage) {
        throw new WorkspaceError(
          'FORBIDDEN',
          'Chỉ quản trị được gắn khách hàng Workspace có sẵn với khách hàng Bán hàng.',
          403,
        );
      }
      if (!UUID_PATTERN.test(target)) throw new WorkspaceValidationError('Khách hàng Workspace không hợp lệ.');
    }
    if (!(await this.directory.enabled(actor.tenantId))) throw new CrmNotEnabledError();
    const [reference] = await this.directory.lookup(actor.tenantId, { ids: [crmCustomerId], limit: 1 });
    if (!reference || reference.id.toLowerCase() !== crmCustomerId.toLowerCase()) throw notFound();
    const result = await this.copies.apply(actor.tenantId, reference, {
      actorUserId: actor.userId,
      targetCustomerId: target,
    });
    return result.customer;
  }

  /**
   * Sự kiện `crm.customer.*` từ worker. Payload sai hình dạng là lỗi vĩnh viễn
   * (ném để vào dead letter); loại sự kiện khác thì bỏ qua.
   */
  async handleEvent(
    tenantId: string,
    type: string,
    payload: unknown,
  ): Promise<CrmCustomerCopyResult | undefined> {
    if (!(CRM_CUSTOMER_EVENTS as readonly string[]).includes(type)) return undefined;
    const event = parseEventPayload(payload);
    return this.copies.apply(tenantId, event.reference, {
      actorUserId: event.actorUserId ?? WORKSPACE_CRM_SYNC_ACTOR_ID,
    });
  }
}

function notFound(): WorkspaceError {
  return new WorkspaceError('CRM_CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng ở Bán hàng.', 404);
}

/** Kiểm payload `crm.customer.*`; sai thì ném lỗi (dữ liệu hỏng, thử lại cũng không khá hơn). */
export function parseEventPayload(payload: unknown): {
  reference: CrmCustomerReference;
  actorUserId: string | null;
} {
  const value = (payload ?? {}) as Partial<Record<keyof CrmCustomerEventPayload, unknown>>;
  const text = (field: unknown) => (typeof field === 'string' ? field.trim() : '');
  const customerId = text(value.customerId);
  const code = text(value.code);
  const name = text(value.name);
  if (!UUID_PATTERN.test(customerId) || !code || !name || !isCrmCustomerVersion(value.version)) {
    throw new Error('Invalid crm.customer event payload.');
  }
  const actor = text(value.actorUserId);
  return {
    reference: {
      id: customerId.toLowerCase(),
      code,
      name,
      taxCode: text(value.taxCode) || null,
      version: value.version,
    },
    actorUserId: UUID_PATTERN.test(actor) ? actor : null,
  };
}
