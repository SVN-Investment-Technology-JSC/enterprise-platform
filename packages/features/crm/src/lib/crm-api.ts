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
import type {
  BulkPriceListItemsRequest,
  DiscountPolicy,
  PriceListDetail,
  PriceListSummary,
  PricingResult,
  PricingSettings,
  QuotePreviewRequest,
  SaveDiscountPolicyRequest,
  SavePriceListItemRequest,
  SavePriceListRequest,
} from '@enterprise-platform/contracts-crm';
import type {
  ApprovalBinding,
  ApprovalKind,
  CreateQuoteRequest,
  CrmCatalogMaterial,
  ProcedureDefinitionOption,
  QuoteApprovalSettings,
  QuoteComparison,
  QuoteDecisionRequest,
  QuoteDetail,
  QuoteListQuery,
  QuoteSummary,
  SaveApprovalBindingRequest,
  SaveQuoteLineRequest,
  UpdateQuoteVersionRequest,
} from '@enterprise-platform/contracts-crm';
import type {
  ContractActionRequest,
  ContractDetail,
  ContractListQuery,
  ContractSummary,
  ConvertQuoteResult,
  CreateSalesOrderRequest,
  CrmMaterialStock,
  SalesOrderActionRequest,
  SalesOrderDetail,
  SalesOrderListQuery,
  SalesOrderSummary,
  SalesSettings,
  SaveContractRequest,
  SaveDeliveryPlanRequest,
  SavePaymentTermsRequest,
  UpdateSalesOrderRequest,
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

// Bảng giá, chính sách chiết khấu, thử tính giá
export const listPriceLists = () => request<PriceListSummary[]>('/price-lists', { cache: 'no-store' });
export const getPriceList = (id: string) =>
  request<PriceListDetail>(`/price-lists/${encodeURIComponent(id)}`, { cache: 'no-store' });
export const createPriceList = (body: SavePriceListRequest) => send<PriceListDetail>('POST', '/price-lists', body);
export const updatePriceList = (id: string, body: SavePriceListRequest) =>
  send<PriceListDetail>('PATCH', `/price-lists/${encodeURIComponent(id)}`, body);
export const deletePriceList = (id: string) => send<void>('DELETE', `/price-lists/${encodeURIComponent(id)}`);
export const addPriceListItem = (id: string, body: SavePriceListItemRequest) =>
  send<PriceListDetail>('POST', `/price-lists/${encodeURIComponent(id)}/items`, body);
export const upsertPriceListItems = (id: string, body: BulkPriceListItemsRequest) =>
  send<PriceListDetail>('POST', `/price-lists/${encodeURIComponent(id)}/items/bulk`, body);
export const updatePriceListItem = (id: string, itemId: string, body: SavePriceListItemRequest) =>
  send<PriceListDetail>('PATCH', `/price-lists/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, body);
export const deletePriceListItem = (id: string, itemId: string) =>
  send<PriceListDetail>('DELETE', `/price-lists/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`);
export const listDiscountPolicies = () => request<DiscountPolicy[]>('/discount-policies', { cache: 'no-store' });
export const createDiscountPolicy = (body: SaveDiscountPolicyRequest) =>
  send<DiscountPolicy>('POST', '/discount-policies', body);
export const updateDiscountPolicy = (id: string, body: SaveDiscountPolicyRequest) =>
  send<DiscountPolicy>('PATCH', `/discount-policies/${encodeURIComponent(id)}`, body);
export const deleteDiscountPolicy = (id: string) => send<void>('DELETE', `/discount-policies/${encodeURIComponent(id)}`);
export const loadPricingSettings = () => request<PricingSettings>('/pricing/settings', { cache: 'no-store' });
export const savePricingSettings = (body: PricingSettings) => send<PricingSettings>('PUT', '/pricing/settings', body);
export const previewQuote = (body: QuotePreviewRequest) => send<PricingResult>('POST', '/pricing/quote-preview', body);

// Báo giá
const quotePath = (id: string, versionNo?: number) =>
  `/quotes/${encodeURIComponent(id)}${versionNo === undefined ? '' : `/versions/${versionNo}`}`;
export const listQuotes = (query: QuoteListQuery) =>
  request<CrmPage<QuoteSummary>>(`/quotes${toQuery(query)}`, { cache: 'no-store' });
export const getQuote = (id: string, versionNo?: number) =>
  request<QuoteDetail>(`${quotePath(id)}${toQuery({ version: versionNo })}`, { cache: 'no-store' });
export const createQuote = (body: CreateQuoteRequest) => send<QuoteDetail>('POST', '/quotes', body);
export const updateQuoteVersion = (id: string, versionNo: number, body: UpdateQuoteVersionRequest) =>
  send<QuoteDetail>('PATCH', quotePath(id, versionNo), body);
export const addQuoteLine = (id: string, versionNo: number, body: SaveQuoteLineRequest) =>
  send<QuoteDetail>('POST', `${quotePath(id, versionNo)}/lines`, body);
export const updateQuoteLine = (id: string, versionNo: number, lineId: string, body: SaveQuoteLineRequest) =>
  send<QuoteDetail>('PATCH', `${quotePath(id, versionNo)}/lines/${encodeURIComponent(lineId)}`, body);
export const removeQuoteLine = (id: string, versionNo: number, lineId: string, revision: number) =>
  send<QuoteDetail>('DELETE', `${quotePath(id, versionNo)}/lines/${encodeURIComponent(lineId)}${toQuery({ revision })}`);
/** `recalculate`, `revise`, `submit`, `approve`, `reject`, `send`, `accept`, `decline`. */
export type QuoteAction = 'recalculate' | 'revise' | 'submit' | 'approve' | 'reject' | 'send' | 'accept' | 'decline';
export const quoteAction = (id: string, versionNo: number, action: QuoteAction, body: QuoteDecisionRequest) =>
  send<QuoteDetail>('POST', `${quotePath(id, versionNo)}/${action}`, body);
export const compareQuote = (id: string, from: number, to: number) =>
  request<QuoteComparison>(`${quotePath(id)}/compare${toQuery({ from, to })}`, { cache: 'no-store' });
export const searchCatalog = (search: string) =>
  request<CrmCatalogMaterial[]>(`/catalog/materials${toQuery({ search, limit: 30 })}`, { cache: 'no-store' });

// Cách duyệt, ngưỡng duyệt
export const listApprovalBindings = () => request<ApprovalBinding[]>('/approval-bindings', { cache: 'no-store' });
export const saveApprovalBinding = (kind: ApprovalKind, body: SaveApprovalBindingRequest) =>
  send<ApprovalBinding[]>('PUT', `/approval-bindings/${kind}`, body);
export const listProcedureOptions = () =>
  request<ProcedureDefinitionOption[]>('/approval-bindings/procedures', { cache: 'no-store' });
export const loadQuoteApprovalSettings = () =>
  request<QuoteApprovalSettings>('/quote-approval/settings', { cache: 'no-store' });
export const saveQuoteApprovalSettings = (body: QuoteApprovalSettings) =>
  send<QuoteApprovalSettings>('PUT', '/quote-approval/settings', body);

// Hợp đồng
export const listContracts = (query: ContractListQuery) =>
  request<CrmPage<ContractSummary>>(`/contracts${toQuery(query)}`, { cache: 'no-store' });
export const getContract = (id: string) => request<ContractDetail>(`/contracts/${encodeURIComponent(id)}`, { cache: 'no-store' });
export const createContract = (body: SaveContractRequest) => send<ContractDetail>('POST', '/contracts', body);
export const updateContract = (id: string, body: Partial<SaveContractRequest>) =>
  send<ContractDetail>('PATCH', `/contracts/${encodeURIComponent(id)}`, body);
export const savePaymentTerms = (id: string, body: SavePaymentTermsRequest) =>
  send<ContractDetail>('PUT', `/contracts/${encodeURIComponent(id)}/payment-terms`, body);
export type ContractAction = 'confirm' | 'cancel' | 'complete' | 'liquidate';
export const contractAction = (id: string, action: ContractAction, body: ContractActionRequest) =>
  send<ContractDetail>('POST', `/contracts/${encodeURIComponent(id)}/${action}`, body);

// Đơn bán, kế hoạch giao
export const listOrders = (query: SalesOrderListQuery) =>
  request<CrmPage<SalesOrderSummary>>(`/orders${toQuery(query)}`, { cache: 'no-store' });
export const getOrder = (id: string) => request<SalesOrderDetail>(`/orders/${encodeURIComponent(id)}`, { cache: 'no-store' });
export const createOrder = (body: CreateSalesOrderRequest) => send<SalesOrderDetail>('POST', '/orders', body);
export const updateOrder = (id: string, body: UpdateSalesOrderRequest) =>
  send<SalesOrderDetail>('PATCH', `/orders/${encodeURIComponent(id)}`, body);
export type OrderAction = 'confirm' | 'cancel' | 'close';
export const orderAction = (id: string, action: OrderAction, body: SalesOrderActionRequest) =>
  send<SalesOrderDetail>('POST', `/orders/${encodeURIComponent(id)}/${action}`, body);
export const saveDelivery = (orderId: string, deliveryId: string | null, body: SaveDeliveryPlanRequest) =>
  deliveryId
    ? send<SalesOrderDetail>('PATCH', `/orders/${encodeURIComponent(orderId)}/deliveries/${encodeURIComponent(deliveryId)}`, body)
    : send<SalesOrderDetail>('POST', `/orders/${encodeURIComponent(orderId)}/deliveries`, body);
export const deliveryAction = (orderId: string, deliveryId: string, action: 'request-issue' | 'cancel', body: SalesOrderActionRequest) =>
  send<SalesOrderDetail>('POST', `/orders/${encodeURIComponent(orderId)}/deliveries/${encodeURIComponent(deliveryId)}/${action}`, body);
export const loadMaterialStock = (materialIds: readonly string[]) =>
  request<CrmMaterialStock[]>(`/catalog/stock${toQuery({ materialIds: materialIds.join(',') })}`, { cache: 'no-store' });
export const convertQuote = (quoteId: string) => send<ConvertQuoteResult>('POST', `/quotes/${encodeURIComponent(quoteId)}/convert`);
export const loadSalesSettings = () => request<SalesSettings>('/sales-settings', { cache: 'no-store' });
export const saveSalesSettings = (body: SalesSettings) => send<SalesSettings>('PUT', '/sales-settings', body);

/** Đường về Tenant Portal cho nút Trang chủ trên thanh bên. */
export async function loadTenantHomePath(): Promise<string> {
  try {
    const response = await authFetch('/api/auth/v1/me');
    return response.ok ? '/applications' : '/';
  } catch {
    return '/';
  }
}
