'use client';

import {
  CRM_LIST_PAGE_SIZE,
  QUOTE_STATUS_LABELS,
  type CreateQuoteRequest,
  type CustomFieldDefinition,
  type CustomerDetail,
  type CustomerSummary,
  type OpportunitySummary,
  type QuoteStatus,
  type QuoteSummary,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeft, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CrmDialog, Field, ListPager, rowOpener, StatusPill } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import { usePagedList } from '../components/use-paged-list';
import { createQuote, getCustomer, getOpportunity, listCustomers, listOpportunities, listQuotes } from '../crm-api';
import { buildQuoteLayoutData, quoteExportFileName } from '../quote-layout/quote-layout.data';
import { openPickerAfterLoad } from './quote-editor';
import { buildCustomFields, generalInfoError, quoteFormErrorMessage, type CustomFieldTexts } from './quote-form-edit.model';
import { CustomFieldsEditor, GeneralFields, TemplatePicker, useQuoteFormLookups, type GeneralState } from './quote-form-parts';
import { labelOptions, peopleOptions, useCrm } from '../crm-context';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';
import { LINES_LOCKED_TEXT, QuoteLinesTable } from './quote-lines-table';
import { QuotePreviewPane, previewLayoutChoice } from './quote-preview-pane';
import { QUOTE_STATUS_TONE } from './quote.model';
import { QuoteActionBar, QuoteWorkspace, blankQuoteDetail } from './quote-workspace';
import { QuoteSellerSection } from './quote-seller-section';
import {
  EMPTY_SELLER_STATE,
  sellerErrors,
  sellerFieldErrorsOf,
  sellerPatch,
  sellerStateFromOrganization,
  withSellerDraft,
  type SellerField,
  type SellerState,
  organizationIdOf,
} from './quote-seller.model';
import { useSalesOrganization, useSalesOrganizations } from './use-sales-organizations';
import { AwaitingApprovalBlock } from '../tasks/awaiting-approval-block';

const formatDate = (value: string | null) => (value ? value.split('-').reverse().join('/') : '');

/** Được lập, sửa báo giá (`crm.quote.write`). */
export function useCanWriteQuote(): boolean {
  const { capabilities } = useCrm();
  return capabilities.isTenantAdmin || capabilities.canWriteQuote;
}

/**
 * Danh sách báo giá trong phạm vi dữ liệu: tìm theo mã báo giá, tên khách; lọc
 * trạng thái, người phụ trách, "Cần tôi duyệt" (D3-33). Phân trang keyset. Đầu danh sách có khối thu gọn "Cần tôi duyệt".
 */
export function QuotesPage({
  onOpen,
  onCreate,
  onOpenProcedure,
}: {
  /** Mở báo giá; nhận id hoặc đoạn `quoteSub` (id kèm khối mở sẵn). */
  onOpen: (id: string) => void;
  /** Mở màn lập mới `quotes/new` (plan 9.5). */
  onCreate: () => void;
  /** Sang hồ sơ Quy trình (spec thay được); mặc định `location.assign`. */
  onOpenProcedure?: (href: string) => void;
}) {
  const { people } = useCrm();
  const canWrite = useCanWriteQuote();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [awaitingMine, setAwaitingMine] = useState(false);
  const q = useDebounced(search.trim(), 350);
  const filter = { q, status, ownerUserId, awaitingMine };
  const list = usePagedList(JSON.stringify(filter), CRM_LIST_PAGE_SIZE, (page) =>
    listQuotes({
      q,
      status: (status || undefined) as QuoteStatus | undefined,
      ownerUserId,
      // Chỉ gửi khi bật: `toQuery` đổi `false` thành chuỗi "false".
      awaitingMyApproval: awaitingMine || undefined,
      page,
      limit: CRM_LIST_PAGE_SIZE,
    }),
  );

  const columns = useMemo<ColumnsType<QuoteSummary>>(
    () => [
      { title: 'Mã', dataIndex: 'code', width: 130, render: (value: string) => <span className={styles.mono}>{value}</span> },
      {
        title: 'Khách hàng',
        key: 'customer',
        ellipsis: true,
        render: (_: unknown, row) => `${row.customerCode} - ${row.customerName}`,
      },
      { title: 'Dự án bán hàng', dataIndex: 'opportunityName', width: 200, ellipsis: true },
      { title: 'Phiên bản', dataIndex: 'currentVersion', width: 90, align: 'right', render: (value: number) => `v${value}` },
      {
        title: 'Trạng thái',
        dataIndex: 'status',
        width: 160,
        render: (value: QuoteStatus) => <StatusPill tone={QUOTE_STATUS_TONE[value]}>{QUOTE_STATUS_LABELS[value]}</StatusPill>,
      },
      { title: 'Tổng cộng', dataIndex: 'totalAmount', width: 150, align: 'right', render: (value: number) => formatMoney(value) },
      { title: 'Hiệu lực đến', dataIndex: 'validUntil', width: 120, render: formatDate },
      { title: 'Người phụ trách', dataIndex: 'ownerUserId', width: 170, ellipsis: true, render: (value: string) => personName(people, value) },
    ],
    [people, onOpen],
  );

  return (
    <div className={styles.page}>
      <AwaitingApprovalBlock onOpenQuote={onOpen} onOpenProcedure={onOpenProcedure} />
      <section className={styles.tableCard} aria-label="Danh sách báo giá">
        <div className={styles.toolbar}>
          {canWrite ? (
            <button type="button" className={styles.buttonPrimary} onClick={onCreate}>
              <Plus size={14} /> Lập báo giá
            </button>
          ) : null}
          <input
            className={`${styles.input} ${styles.search}`}
            type="search"
            placeholder="Tìm theo mã báo giá, tên khách…"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
          />
          <SearchableSelect className={styles.filter} options={labelOptions(QUOTE_STATUS_LABELS)} value={status} placeholder="Mọi trạng thái" clearable onChange={setStatus} />
          <SearchableSelect className={styles.filter} options={peopleOptions(people)} value={ownerUserId} placeholder="Mọi người phụ trách" clearable onChange={setOwnerUserId} />
          <label className={styles.checkbox}>
            <input type="checkbox" checked={awaitingMine} onChange={(event) => setAwaitingMine(event.target.checked)} />
            Cần tôi duyệt
          </label>
        </div>
        {list.error ? <p className={styles.alert}>{list.error}</p> : null}
        <Table<QuoteSummary>
          size="small"
          rowKey="id"
          loading={list.loading}
          columns={columns}
          dataSource={[...list.items]}
          pagination={false}
          scroll={{ x: 1200 }}
          onRow={(row) => rowOpener(() => onOpen(row.id))}
          locale={{
            emptyText: list.loading ? 'Đang tải…' : awaitingMine ? 'Không có báo giá nào đang chờ bạn duyệt.' : 'Chưa có báo giá nào.',
          }}
        />
        <ListPager page={list.page} total={list.total} pageSize={list.pageSize} loading={list.loading} noun="báo giá" onChange={list.goTo} />
      </section>
    </div>
  );
}

/** Thông tin đang nhập của báo giá chưa có bản ghi (hộp thoại lập và màn lập mới dùng chung). */
interface NewQuoteInput {
  readonly opportunityId: string;
  readonly customerId: string;
  readonly general: GeneralState;
  readonly note: string;
  readonly custom: CustomFieldTexts;
  /**
   * Tổ chức báo giá (màn lập mới, plan 16.4). Rỗng (hộp thoại lập nhỏ, hoặc màn lập mới chưa tải xong danh sách tổ chức):
   * không gửi, server dùng tổ chức mặc định.
   */
  readonly seller?: SellerState;
}

type NewQuoteCheck =
  | { readonly ok: true; readonly request: CreateQuoteRequest }
  | {
      readonly ok: false;
      readonly error: string;
      readonly nameError?: string;
      readonly sellerErrors?: Partial<Record<SellerField, string>>;
    };

/** Kiểm và dựng thân `POST /quotes` (giữ đúng kiểm của hộp thoại lập báo giá phase 2). */
function checkNewQuote(input: NewQuoteInput, fields: readonly CustomFieldDefinition[]): NewQuoteCheck {
  const { general, opportunityId, customerId } = input;
  if (!opportunityId && !customerId) return { ok: false, error: 'Vui lòng chọn dự án bán hàng hoặc khách hàng.' };
  const invalid = generalInfoError({ name: general.name, code: general.code, requireCode: false });
  if (invalid) return { ok: false, error: invalid, nameError: invalid };
  // Lập mới chỉ kiểm kiểu; trường bắt buộc kiểm khi lưu thông tin (báo giá chưa có dòng).
  const builtCustom = buildCustomFields(fields, input.custom);
  if (!builtCustom.ok) return { ok: false, error: builtCustom.error };
  const problems = input.seller ? sellerErrors(input.seller) : {};
  const firstProblem = Object.values(problems)[0];
  if (firstProblem) return { ok: false, error: firstProblem, sellerErrors: problems };
  return {
    ok: true,
    request: {
      opportunityId: opportunityId || null,
      customerId: opportunityId ? null : customerId,
      validUntil: general.validUntil || null,
      note: input.note.trim() || null,
      code: general.code.trim() || null,
      quoteName: general.name.trim(),
      quoteDate: general.quoteDate || null,
      templateId: general.templateId || null,
      quoteTypeId: general.typeId || null,
      customFields: builtCustom.values,
      ...(input.seller ? sellerPatch(input.seller) : {}),
    },
  };
}

/** Dữ liệu hộp thoại chuyển sang màn lập mới khi bấm "Mở màn đầy đủ"; màn lập mới đọc một lần rồi xoá. */
let fullScreenHandoff: NewQuoteInput | undefined;

/** Đường dẫn hash của màn lập mới, có điền sẵn khách hoặc dự án (plan 9.5). */
export function newQuoteHash(params: { customerId?: string; opportunityId?: string } = {}): string {
  const query = new URLSearchParams();
  if (params.opportunityId) query.set('opportunityId', params.opportunityId);
  else if (params.customerId) query.set('customerId', params.customerId);
  const text = query.toString();
  return text ? `new?${text}` : 'new';
}

/**
 * Lựa chọn khách hàng: mã khách để ở `description` vì `SearchableSelect` chỉ tìm theo nhãn, giá trị và mô tả
 * (không tìm theo `badge`), để gõ mã "QA-CRM-KH01" cũng ra khách.
 */
export function customerOptions(customers: readonly Pick<CustomerSummary, 'id' | 'name' | 'code'>[]) {
  return customers.map((item) => ({ value: item.id, label: item.name, description: item.code }));
}

const EMPTY_GENERAL: GeneralState = { code: '', name: '', quoteDate: '', validUntil: '', templateId: '', typeId: '' };

/** Chọn sẵn mẫu và loại mặc định khi tải xong; báo giá cũ hoặc tenant chưa cấu hình thì để trống. */
function useDefaultTemplate(lookups: ReturnType<typeof useQuoteFormLookups>, setGeneral: (update: (current: GeneralState) => GeneralState) => void) {
  useEffect(() => {
    if (!lookups.loaded) return;
    setGeneral((current) => ({
      ...current,
      templateId: current.templateId || lookups.templates.find((item) => item.isDefault)?.id || '',
      typeId: current.typeId || lookups.types.find((item) => item.isDefault)?.id || '',
    }));
  }, [lookups.loaded, lookups.templates, lookups.types, setGeneral]);
}

/**
 * Lập báo giá cho một cơ hội (khách lấy theo cơ hội) hoặc thẳng cho một khách.
 * `opportunityId` truyền sẵn khi mở từ màn cơ hội. "Mở màn đầy đủ" chuyển sang màn lập 2 cột, giữ dữ liệu đã nhập.
 */
export function CreateQuoteDialog({
  opportunityId: fixedOpportunityId,
  onClose,
  onCreated,
  onOpenFull,
}: {
  opportunityId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
  /** Mở màn lập mới với hash đã dựng (`new?...`); mặc định đổi `location.hash` sang `#quotes/<hash>`. */
  onOpenFull?: (hash: string) => void;
}) {
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [opportunities, setOpportunities] = useState<readonly OpportunitySummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [opportunityId, setOpportunityId] = useState(fixedOpportunityId ?? '');
  const lookups = useQuoteFormLookups();
  const [general, setGeneral] = useState<GeneralState>(EMPTY_GENERAL);
  const [custom, setCustom] = useState<CustomFieldTexts>({});
  const [nameError, setNameError] = useState<string>();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (fixedOpportunityId) return;
    listCustomers({ limit: 100 })
      .then((page) => setCustomers(page.items))
      .catch(() => undefined);
    listOpportunities({ limit: 100 })
      .then((page) => setOpportunities(page.items.filter((item) => item.stage !== 'WON' && item.stage !== 'LOST')))
      .catch(() => undefined);
  }, [fixedOpportunityId]);

  useDefaultTemplate(lookups, setGeneral);

  async function save() {
    const checked = checkNewQuote({ opportunityId, customerId, general, note, custom }, lookups.fields);
    if (!checked.ok) {
      setNameError(checked.nameError);
      return setError(checked.error);
    }
    setNameError(undefined);
    setSaving(true);
    setError(undefined);
    try {
      const created = await createQuote(checked.request);
      toast.success(`Đã lập báo giá ${created.code}.`);
      onCreated(created.id);
    } catch (cause) {
      setError(quoteFormErrorMessage(cause, 'Không lập được báo giá.'));
    } finally {
      setSaving(false);
    }
  }

  function openFull() {
    fullScreenHandoff = { opportunityId, customerId, general, note, custom };
    const hash = newQuoteHash({ opportunityId: opportunityId || undefined, customerId: customerId || undefined });
    onClose();
    if (onOpenFull) onOpenFull(hash);
    else window.location.hash = `quotes/${hash}`;
  }

  return (
    <CrmDialog open wide title="Lập báo giá" submitLabel="Lập báo giá" cancelLabel="Huỷ bỏ" submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <div className={styles.toolbar}>
        <span className={styles.muted}>Cần xem trước bản in hoặc nhập dòng hàng ngay?</span>
        <button type="button" className={styles.linkButton} disabled={saving} onClick={openFull}>
          Mở màn đầy đủ
        </button>
      </div>
      <div className={styles.fieldGrid}>
        {fixedOpportunityId ? null : (
          <>
            <Field label="Dự án bán hàng" hint="Khách hàng và người phụ trách lấy theo dự án bán hàng">
              <SearchableSelect
                options={opportunities.map((item) => ({ value: item.id, label: item.name, description: item.customerName }))}
                value={opportunityId}
                placeholder="Không gắn dự án bán hàng"
                clearable
                onChange={setOpportunityId}
              />
            </Field>
            <Field label="Hoặc khách hàng">
              <SearchableSelect
                options={customerOptions(customers)}
                value={opportunityId ? '' : customerId}
                placeholder="Chọn khách hàng"
                disabled={Boolean(opportunityId)}
                clearable
                onChange={setCustomerId}
              />
            </Field>
          </>
        )}
      </div>
      <h4 className={styles.sectionTitle}>Thông tin chung</h4>
      <GeneralFields
        value={general}
        onChange={setGeneral}
        templates={lookups.templates}
        types={lookups.types}
        codeEditable
        generateCode
        nameError={nameError}
      />
      <h4 className={styles.sectionTitle}>Mô tả</h4>
      <Field label="Mô tả" wide>
        <textarea className={styles.textarea} rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <h4 className={styles.sectionTitle}>Trường tuỳ biến</h4>
      <CustomFieldsEditor definitions={lookups.fields} texts={custom} missing={[]} onChange={setCustom} />
    </CrmDialog>
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NEW_QUOTE_FORBIDDEN_TEXT = 'Bạn không có quyền lập báo giá.';

/**
 * Màn lập báo giá 2 cột `quotes/new` (plan 9.5, task P3C4-06). Báo giá chưa có bản ghi: chỉ có thông tin chung, dòng
 * hàng khoá đến khi lưu; xem trước đã dựng theo mẫu đang chọn. Lưu (hoặc bấm + ở dòng hàng) thì lập báo giá rồi
 * `onCreated` (màn gọi chuyển trang thay lịch sử). `customerId`, `opportunityId` sai hoặc không có thì bỏ qua.
 */
export function NewQuoteScreen(props: { customerId?: string; opportunityId?: string; onBack: () => void; onCreated: (id: string) => void }) {
  const canWrite = useCanWriteQuote();
  if (!canWrite) {
    return (
      <div className={styles.page}>
        <section className={styles.panel} aria-label="Lập báo giá">
          <p className={styles.alert} role="alert">
            {NEW_QUOTE_FORBIDDEN_TEXT}
          </p>
          <div className={styles.toolbar}>
            <button type="button" className={styles.buttonGhost} onClick={props.onBack}>
              <ArrowLeft size={14} /> Danh sách báo giá
            </button>
          </div>
        </section>
      </div>
    );
  }
  return <NewQuoteForm {...props} />;
}

function NewQuoteForm({
  customerId: queryCustomerId,
  opportunityId: queryOpportunityId,
  onBack,
  onCreated,
}: {
  customerId?: string;
  opportunityId?: string;
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const { people, currentUserId } = useCrm();
  const lookups = useQuoteFormLookups();
  const [handoff] = useState(() => fullScreenHandoff);
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [opportunities, setOpportunities] = useState<readonly OpportunitySummary[]>([]);
  const [customerId, setCustomerId] = useState(handoff?.customerId ?? '');
  const [opportunityId, setOpportunityId] = useState(handoff?.opportunityId ?? '');
  const [general, setGeneral] = useState<GeneralState>(handoff?.general ?? EMPTY_GENERAL);
  const [note, setNote] = useState(handoff?.note ?? '');
  const [custom, setCustom] = useState<CustomFieldTexts>(handoff?.custom ?? {});
  /** Rỗng cho tới khi chọn sẵn tổ chức mặc định (hoặc người lập chọn); khi đó lập báo giá không gửi tổ chức. */
  const [seller, setSeller] = useState<SellerState | undefined>(handoff?.seller);
  const [sellerFieldErrors, setSellerFieldErrors] = useState<Partial<Record<SellerField, string>>>({});
  const { organizations, loaded: organizationsLoaded } = useSalesOrganizations();
  const [touched, setTouched] = useState(Boolean(handoff));
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [nameError, setNameError] = useState<string>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  // Chặn bấm Lưu hai lần thật nhanh (state chưa kịp cập nhật) để chỉ tạo một báo giá.
  const creating = useRef(false);

  useEffect(() => {
    listCustomers({ limit: 100 })
      .then((page) => setCustomers((current) => mergeById(page.items, current)))
      .catch(() => undefined);
    listOpportunities({ limit: 100 })
      .then((page) =>
        setOpportunities((current) => mergeById(page.items.filter((item) => item.stage !== 'WON' && item.stage !== 'LOST'), current)),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fullScreenHandoff = undefined;
  }, []);

  // Tham số trên đường dẫn: chỉ nhận id dạng uuid đọc được; sai hoặc không có thì bỏ qua, không báo lỗi trang.
  useEffect(() => {
    if (queryOpportunityId && UUID_PATTERN.test(queryOpportunityId)) {
      getOpportunity(queryOpportunityId)
        .then((found) => {
          setOpportunities((current) => mergeById(current, [found]));
          setOpportunityId(found.id);
        })
        .catch(() => undefined);
    } else if (queryCustomerId && UUID_PATTERN.test(queryCustomerId)) {
      getCustomer(queryCustomerId)
        .then((found) => {
          setCustomers((current) => mergeById(current, [found]));
          setCustomerId(found.id);
        })
        .catch(() => undefined);
    }
  }, [queryCustomerId, queryOpportunityId]);

  useDefaultTemplate(lookups, setGeneral);

  // Chọn sẵn tổ chức mặc định một lần khi tải xong danh sách (D3-26); không có mặc định thì để trống.
  useEffect(() => {
    if (!organizationsLoaded) return;
    setSeller((current) => {
      if (current) return current;
      const fallback = organizations.find((item) => item.isDefault);
      return fallback ? sellerStateFromOrganization(fallback) : EMPTY_SELLER_STATE;
    });
  }, [organizationsLoaded, organizations]);

  const opportunity = opportunities.find((item) => item.id === opportunityId);
  const effectiveCustomerId = opportunityId ? (opportunity?.customerId ?? '') : customerId;
  useEffect(() => {
    if (!effectiveCustomerId) {
      setCustomer(null);
      return undefined;
    }
    let active = true;
    getCustomer(effectiveCustomerId)
      .then((next) => active && setCustomer(next))
      .catch(() => active && setCustomer(null));
    return () => {
      active = false;
    };
  }, [effectiveCustomerId]);

  const input = useMemo<NewQuoteInput>(
    () => ({ opportunityId, customerId, general, note, custom, seller }),
    [opportunityId, customerId, general, note, custom, seller],
  );
  const previewInput = useDebounced(input, 300);
  const chosenOrganization = useSalesOrganization(previewInput.seller ? organizationIdOf(previewInput.seller) : null);
  const summary = customers.find((item) => item.id === effectiveCustomerId);
  const { templates, types, fields } = lookups;
  const previewData = useMemo(() => {
    const built = buildCustomFields(fields, previewInput.custom);
    const shownCustomer = customer ?? summary ?? (opportunity ? { id: opportunity.customerId, code: opportunity.customerCode, name: opportunity.customerName } : null);
    const detail = blankQuoteDetail({
      general: previewInput.general,
      note: previewInput.note,
      customFields: built.ok ? built.values : {},
      customer: shownCustomer,
      opportunity: opportunity ? { id: opportunity.id, name: opportunity.name } : null,
      ownerUserId: opportunity?.ownerUserId ?? currentUserId ?? '',
      templates,
      types,
      today: new Date().toISOString(),
    });
    return buildQuoteLayoutData({
      detail: withSellerDraft(detail, previewInput.seller ?? EMPTY_SELLER_STATE, chosenOrganization),
      customer,
      people,
      customFields: fields,
    });
  }, [previewInput, chosenOrganization, templates, types, fields, customer, summary, opportunity, people, currentUserId]);

  const change = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setTouched(true);
  };

  /** Lập báo giá; `pickSearch` có giá trị (kể cả chuỗi rỗng) là bấm + ở dòng hàng: mở chọn mặt hàng sau khi lập. */
  async function create(pickSearch?: string) {
    if (creating.current) return;
    const checked = checkNewQuote(input, lookups.fields);
    if (!checked.ok) {
      setNameError(checked.nameError);
      setSellerFieldErrors(checked.sellerErrors ?? {});
      setError(checked.error);
      return;
    }
    setNameError(undefined);
    setSellerFieldErrors({});
    setError(undefined);
    creating.current = true;
    setSaving(true);
    try {
      const created = await createQuote(checked.request);
      toast.success(`Đã lập báo giá ${created.code}.`);
      if (pickSearch !== undefined) openPickerAfterLoad(created.id, pickSearch);
      onCreated(created.id);
    } catch (cause) {
      setSellerFieldErrors(sellerFieldErrorsOf(cause));
      setError(quoteFormErrorMessage(cause, 'Không lập được báo giá.'));
      toast.error(quoteFormErrorMessage(cause, 'Không lập được báo giá.'));
    } finally {
      creating.current = false;
      setSaving(false);
    }
  }

  const selectedTemplate = lookups.templates.find((item) => item.id === general.templateId);

  const header = (
    <div className={styles.detailHead}>
      <button type="button" className={styles.buttonGhost} onClick={onBack}>
        <ArrowLeft size={14} /> Danh sách báo giá
      </button>
      <h2 className={styles.detailTitle}>Lập báo giá</h2>
      <StatusPill tone="neutral">Chưa lưu</StatusPill>
    </div>
  );

  const left = (
    <>
      <QuoteSellerSection
        value={seller ?? EMPTY_SELLER_STATE}
        onChange={(next) => {
          change(setSeller)(next);
          setSellerFieldErrors({});
        }}
        editable
        organizations={organizations}
        errors={sellerFieldErrors}
      />
      <section className={styles.panel} aria-label="Thông tin báo giá">
        <h3 className={styles.sectionTitle}>Thông tin chung</h3>
        <div className={styles.fieldGrid}>
          <Field label="Dự án bán hàng" hint="Khách hàng và người phụ trách lấy theo dự án bán hàng">
            <SearchableSelect
              options={opportunities.map((item) => ({ value: item.id, label: item.name, description: item.customerName }))}
              value={opportunityId}
              placeholder="Không gắn dự án bán hàng"
              clearable
              onChange={change(setOpportunityId)}
            />
          </Field>
          <Field label="Báo giá đến (khách hàng)" required={!opportunityId}>
            <SearchableSelect
              options={customerOptions(customers)}
              value={opportunityId ? (opportunity?.customerId ?? '') : customerId}
              placeholder={opportunityId ? (opportunity?.customerName ?? 'Theo dự án bán hàng') : 'Chọn khách hàng'}
              disabled={Boolean(opportunityId)}
              clearable
              onChange={change(setCustomerId)}
            />
          </Field>
        </div>
        <GeneralFields
          value={general}
          onChange={change(setGeneral)}
          templates={lookups.templates}
          types={lookups.types}
          codeEditable
          generateCode
          nameError={nameError}
          showTemplate={false}
        />
        <Field label="Mô tả" wide>
          <textarea className={styles.textarea} rows={3} maxLength={4000} value={note} onChange={(event) => change(setNote)(event.target.value)} />
        </Field>
        {lookups.fields.length ? (
          <>
            <h4 className={styles.sectionTitle}>Trường tuỳ biến</h4>
            <CustomFieldsEditor definitions={lookups.fields} texts={custom} missing={[]} onChange={change(setCustom)} />
          </>
        ) : null}
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
      </section>
      <QuoteLinesTable
        title="Dòng hàng"
        lines={[]}
        editable={false}
        busy={saving}
        lockedText={LINES_LOCKED_TEXT}
        onAdd={(search) => void create(search)}
        onInsert={() => undefined}
        onEdit={() => undefined}
        onView={() => undefined}
        onRemove={() => undefined}
      />
    </>
  );

  return (
    <QuoteWorkspace
      header={header}
      left={left}
      preview={
        <QuotePreviewPane
          choice={previewLayoutChoice(undefined)}
          templateId={general.templateId || null}
          templateName={selectedTemplate?.name}
          templateHasLayout={selectedTemplate?.hasLayout}
          templatePicker={
            <TemplatePicker
              templates={lookups.templates}
              value={general.templateId}
              onChange={(templateId) => change(setGeneral)({ ...general, templateId })}
            />
          }
          data={previewData}
          fileName={quoteExportFileName(general.code, 1)}
        />
      }
      actions={
        <QuoteActionBar
          dirty={touched}
          busy={saving}
          canCancel
          canSave
          canSubmit={false}
          canSend={false}
          submitHint="Lưu báo giá và thêm dòng hàng trước khi trình duyệt."
          cancelMessage="Báo giá chưa được lập; các thông tin vừa nhập sẽ mất."
          onCancel={onBack}
          onSave={() => void create()}
          onSubmit={() => undefined}
          onSend={() => undefined}
        />
      }
    />
  );
}

/** Gộp hai danh sách theo id, giữ thứ tự danh sách đầu. */
function mergeById<T extends { readonly id: string }>(first: readonly T[], second: readonly T[]): T[] {
  const seen = new Set(first.map((item) => item.id));
  return [...first, ...second.filter((item) => !seen.has(item.id))];
}
