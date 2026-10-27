import {
  CRM_API_ROOT,
  type Activity,
  type ActivityListQuery,
  type ChangeOpportunityStageRequest,
  type ConvertLeadRequest,
  type ConvertLeadResult,
  type CreateActivityRequest,
  type CreateCustomerRequest,
  type CreateLeadRequest,
  type CreateOpportunityRequest,
  type CrmPage,
  type CrmPerson,
  type CrmSettings,
  type CrmStatus,
  type CustomerDetail,
  type CustomerGroup,
  type CustomerListQuery,
  type CustomerSummary,
  type CustomerTimelineEntry,
  type Lead,
  type LeadListQuery,
  type OpportunityBoard,
  type OpportunityDetail,
  type OpportunityListQuery,
  type OpportunitySummary,
  type SaveContactRequest,
  type SaveCustomerGroupRequest,
  type TaxCodeMatch,
  type UpdateActivityRequest,
  type UpdateCustomerRequest,
  type UpdateLeadRequest,
  type UpdateOpportunityRequest,
} from '@enterprise-platform/contracts-crm';
import { authFetch } from '@enterprise-platform/shared-ui';

/** Lỗi API: thân lỗi đã có `code` và `message` tiếng Việt; có thể kèm dữ liệu thêm như `matches`. */
export interface CrmApiError {
  readonly statusCode?: number;
  readonly code?: string;
  readonly message?: string;
  readonly matches?: readonly TaxCodeMatch[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // `authFetch` tự gắn cookie phiên, `x-csrf-token` và làm mới phiên một lần khi gặp 401.
  const response = await authFetch(`${CRM_API_ROOT}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (response.status === 401) {
    window.location.assign('/');
    throw { code: 'UNAUTHENTICATED', message: 'Phiên đăng nhập đã hết.' } satisfies CrmApiError;
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw { statusCode: response.status, ...body } as CrmApiError;
  return body as T;
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

/** Chuỗi truy vấn từ bộ lọc, bỏ giá trị rỗng. */
export function toQuery(params: object): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** Lời nhắn lỗi để hiện thẳng cho người dùng. */
export function errorMessage(cause: unknown, fallback: string): string {
  const message = (cause as CrmApiError | undefined)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

export const loadCrmStatus = () => request<CrmStatus>('/status', { cache: 'no-store' });

// Khách hàng
export const listCustomers = (query: CustomerListQuery) =>
  request<CrmPage<CustomerSummary>>(`/customers${toQuery(query)}`, { cache: 'no-store' });
export const getCustomer = (id: string) => request<CustomerDetail>(`/customers/${encodeURIComponent(id)}`);
export const findTaxCodeMatches = (taxCode: string, excludeId?: string) =>
  request<TaxCodeMatch[]>(`/customers/tax-code-matches${toQuery({ taxCode, excludeId })}`);
export const createCustomer = (body: CreateCustomerRequest) => send<CustomerDetail>('POST', '/customers', body);
export const updateCustomer = (id: string, body: UpdateCustomerRequest) =>
  send<CustomerDetail>('PATCH', `/customers/${encodeURIComponent(id)}`, body);
export const addContact = (customerId: string, body: SaveContactRequest) =>
  send<CustomerDetail>('POST', `/customers/${encodeURIComponent(customerId)}/contacts`, body);
export const updateContact = (customerId: string, contactId: string, body: SaveContactRequest) =>
  send<CustomerDetail>('PATCH', `/customers/${encodeURIComponent(customerId)}/contacts/${encodeURIComponent(contactId)}`, body);
export const setPrimaryContact = (customerId: string, contactId: string) =>
  send<CustomerDetail>('POST', `/customers/${encodeURIComponent(customerId)}/contacts/${encodeURIComponent(contactId)}/primary`);
export const deleteContact = (customerId: string, contactId: string) =>
  send<CustomerDetail>('DELETE', `/customers/${encodeURIComponent(customerId)}/contacts/${encodeURIComponent(contactId)}`);
export const loadTimeline = (customerId: string, cursor?: string) =>
  request<CrmPage<CustomerTimelineEntry>>(
    `/customers/${encodeURIComponent(customerId)}/timeline${toQuery({ cursor, limit: 30 })}`,
    { cache: 'no-store' },
  );

// Nhóm khách, cấu hình, danh bạ
export const listGroups = () => request<CustomerGroup[]>('/customer-groups', { cache: 'no-store' });
export const createGroup = (body: SaveCustomerGroupRequest) => send<CustomerGroup>('POST', '/customer-groups', body);
export const updateGroup = (id: string, body: SaveCustomerGroupRequest) =>
  send<CustomerGroup>('PATCH', `/customer-groups/${encodeURIComponent(id)}`, body);
export const deleteGroup = (id: string) => send<void>('DELETE', `/customer-groups/${encodeURIComponent(id)}`);
export const loadSettings = () => request<CrmSettings>('/settings', { cache: 'no-store' });
export const saveSettings = (body: Partial<CrmSettings>) => send<CrmSettings>('PUT', '/settings', body);
export const listPeople = () => request<CrmPerson[]>('/people');

// Lead
export const listLeads = (query: LeadListQuery) => request<CrmPage<Lead>>(`/leads${toQuery(query)}`, { cache: 'no-store' });
export const createLead = (body: CreateLeadRequest) => send<Lead>('POST', '/leads', body);
export const updateLead = (id: string, body: UpdateLeadRequest) => send<Lead>('PATCH', `/leads/${encodeURIComponent(id)}`, body);
export const convertLead = (id: string, body: ConvertLeadRequest) =>
  send<ConvertLeadResult>('POST', `/leads/${encodeURIComponent(id)}/convert`, body);

// Cơ hội
export const listOpportunities = (query: OpportunityListQuery) =>
  request<CrmPage<OpportunitySummary>>(`/opportunities${toQuery(query)}`, { cache: 'no-store' });
export const loadBoard = (query: { ownerUserId?: string; q?: string }) =>
  request<OpportunityBoard>(`/opportunities/board${toQuery(query)}`, { cache: 'no-store' });
export const getOpportunity = (id: string) => request<OpportunityDetail>(`/opportunities/${encodeURIComponent(id)}`);
export const createOpportunity = (body: CreateOpportunityRequest) =>
  send<OpportunityDetail>('POST', '/opportunities', body);
export const updateOpportunity = (id: string, body: UpdateOpportunityRequest) =>
  send<OpportunityDetail>('PATCH', `/opportunities/${encodeURIComponent(id)}`, body);
export const changeOpportunityStage = (id: string, body: ChangeOpportunityStageRequest) =>
  send<OpportunityDetail>('PATCH', `/opportunities/${encodeURIComponent(id)}/stage`, body);

// Hoạt động
export const listActivities = (query: ActivityListQuery) =>
  request<CrmPage<Activity>>(`/activities${toQuery(query)}`, { cache: 'no-store' });
export const getActivity = (id: string) => request<Activity>(`/activities/${encodeURIComponent(id)}`);
export const createActivity = (body: CreateActivityRequest) => send<Activity>('POST', '/activities', body);
export const updateActivity = (id: string, body: UpdateActivityRequest) =>
  send<Activity>('PATCH', `/activities/${encodeURIComponent(id)}`, body);

/** Đường về Tenant Portal cho nút Trang chủ trên thanh bên. */
export async function loadTenantHomePath(): Promise<string> {
  try {
    const response = await authFetch('/api/auth/v1/me');
    return response.ok ? '/applications' : '/';
  } catch {
    return '/';
  }
}
