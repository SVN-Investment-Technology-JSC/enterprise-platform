'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Plus, Trash2, X } from 'lucide-react';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import {
  FINANCE_ALLOCATION_LABELS,
  financeIncludedTax,
  financeLineTotal,
  financeLinesTotal,
  type FinanceAccount,
  type FinanceAllocationType,
  type FinanceCatalogs,
  type FinanceSourceLockedField,
  type FinanceVoucher,
  type FinanceVoucherSource,
  type FinanceVoucherAttachment,
  type FinanceVoucherKind,
  type SaveFinanceVoucherRequest,
} from '@enterprise-platform/contracts-finance';
import { MAX_ATTACHMENTS, attachmentProblem, removeFinanceAttachment, uploadFinanceAttachment } from '../attachment-upload';
import { financeErrorMessage, financeFetch, financePost, financePut, toQuery } from '../finance-api';
import { useFinanceCrumbs } from '../finance-crumbs';
import { money, todayVn } from '../finance-format';
import { FINANCE_KIND_CONFIG } from '../finance-kinds';
import {
  PROJECT_STATUS_LABELS,
  WORK_ITEM_STATUS_LABELS,
  loadWorkspaceProjects,
  loadWorkspaceWorkItems,
  projectLabel,
  workItemLabel,
  type WorkspaceProjectOption,
  type WorkspaceWorkItemOption,
} from '../workspace-links';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { AttachmentsField } from '../ui/attachments-field';
import { ErrorBanner, Field, FormSection, MoneyInput } from '../ui/form-parts';
import { NoteEditor } from '../ui/note-editor';

interface LineState {
  key: number;
  description: string;
  quantity: number;
  unitAmount: number;
}
interface InvoiceState {
  key: number;
  invoiceNo: string;
  invoiceDate: string;
  taxCode: string;
  amount: number;
}
interface FormState {
  voucherDate: string;
  postingDate: string;
  content: string;
  reasonId: string;
  accountId: string;
  destAccountId: string;
  counterpartyGroupId: string;
  counterpartyName: string;
  counterpartyAccountNo: string;
  counterpartyBank: string;
  /** Hình thức hạch toán nội bộ; rỗng: không hạch toán. */
  allocType: '' | FinanceAllocationType;
  allocProjectId: string;
  allocWorkItemId: string;
  taxIncluded: boolean;
  taxRate: number;
  note: string;
  amount: number;
  lines: LineState[];
  invoices: InvoiceState[];
  /** Dự án liên quan (chỉ tham chiếu). */
  relatedProjectIds: string[];
}

let keySeed = 0;
const nextKey = () => (keySeed += 1);
const blankLine = (): LineState => ({ key: nextKey(), description: '', quantity: 1, unitAmount: 0 });

function emptyState(): FormState {
  const today = todayVn();
  return {
    voucherDate: today,
    postingDate: today,
    content: '',
    reasonId: '',
    accountId: '',
    destAccountId: '',
    counterpartyGroupId: '',
    counterpartyName: '',
    counterpartyAccountNo: '',
    counterpartyBank: '',
    allocType: '',
    allocProjectId: '',
    allocWorkItemId: '',
    taxIncluded: false,
    taxRate: 0,
    note: '',
    amount: 0,
    lines: [blankLine()],
    invoices: [],
    relatedProjectIds: [],
  };
}

function fromVoucher(voucher: FinanceVoucher): FormState {
  return {
    voucherDate: voucher.voucherDate,
    postingDate: voucher.postingDate,
    content: voucher.content,
    reasonId: voucher.reasonId ?? '',
    accountId: voucher.accountId ?? '',
    destAccountId: voucher.destAccountId ?? '',
    counterpartyGroupId: voucher.counterpartyGroupId ?? '',
    counterpartyName: voucher.counterpartyName ?? '',
    counterpartyAccountNo: voucher.counterpartyAccountNo ?? '',
    counterpartyBank: voucher.counterpartyBank ?? '',
    allocType: voucher.allocation?.type ?? '',
    allocProjectId: voucher.allocation?.projectId ?? '',
    allocWorkItemId: voucher.allocation?.workItemId ?? '',
    taxIncluded: voucher.taxIncluded,
    taxRate: voucher.taxRate,
    note: voucher.note ?? '',
    amount: voucher.kind === 'TRANSFER' ? voucher.totalAmount : 0,
    lines: voucher.lines.length
      ? voucher.lines.map((line) => ({ key: nextKey(), description: line.description, quantity: line.quantity, unitAmount: line.unitAmount }))
      : [blankLine()],
    invoices: voucher.invoices.map((invoice) => ({
      key: nextKey(),
      invoiceNo: invoice.invoiceNo,
      invoiceDate: invoice.invoiceDate ?? '',
      taxCode: invoice.taxCode ?? '',
      amount: invoice.amount,
    })),
    relatedProjectIds: voucher.relatedProjects.map((project) => project.projectId),
  };
}

/** Lỗi hạch toán chưa đủ thông tin (chọn hình thức mà thiếu dự án hoặc công việc); null khi hợp lệ. */
export function allocationProblem(form: Pick<FormState, 'allocType' | 'allocProjectId' | 'allocWorkItemId'>): string | null {
  if (!form.allocType) return null;
  if (!form.allocProjectId) return 'Chọn dự án để hạch toán.';
  if (form.allocType === 'WORK_ITEM' && !form.allocWorkItemId) return 'Chọn công việc để hạch toán.';
  return null;
}

/** Dữ liệu gửi lên server; server tính lại thành tiền và tổng. */
export function buildRequest(kind: FinanceVoucherKind, form: FormState, revision?: number): SaveFinanceVoucherRequest {
  const base: SaveFinanceVoucherRequest = {
    kind,
    voucherDate: form.voucherDate,
    postingDate: form.postingDate,
    content: form.content,
    accountId: form.accountId || null,
    note: form.note || null,
    relatedProjectIds: form.relatedProjectIds,
    revision,
  };
  if (kind === 'TRANSFER') return { ...base, destAccountId: form.destAccountId || null, amount: form.amount };
  return {
    ...base,
    reasonId: form.reasonId || null,
    counterpartyGroupId: form.counterpartyGroupId || null,
    counterpartyName: form.counterpartyName.trim() || null,
    counterpartyAccountNo: form.counterpartyAccountNo.trim() || null,
    counterpartyBank: form.counterpartyBank.trim() || null,
    allocation:
      form.allocType && form.allocProjectId
        ? { type: form.allocType, projectId: form.allocProjectId, workItemId: form.allocType === 'WORK_ITEM' ? form.allocWorkItemId || null : null }
        : null,
    taxIncluded: form.taxIncluded,
    taxRate: form.taxIncluded ? form.taxRate : 0,
    lines: form.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      total: financeLineTotal(line.quantity, line.unitAmount),
    })),
    invoices: form.invoices
      .filter((invoice) => invoice.invoiceNo.trim())
      .map((invoice) => ({ invoiceNo: invoice.invoiceNo, invoiceDate: invoice.invoiceDate || null, taxCode: invoice.taxCode || null, amount: invoice.amount })),
  };
}

export default function VoucherFormScreen({ kind, id }: { kind: FinanceVoucherKind; id?: string }) {
  const config = FINANCE_KIND_CONFIG[kind];
  const router = useRouter();
  /** Nhân bản: tạo mới điền sẵn dữ liệu từ phiếu nguồn (`?from=<id>`), chỉ áp dụng khi đang tạo mới (không có `id`). */
  const fromId = useSearchParams().get('from');
  const [form, setForm] = useState<FormState>(emptyState);
  const [catalogs, setCatalogs] = useState<FinanceCatalogs | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [code, setCode] = useState('');
  const [revision, setRevision] = useState<number | undefined>();
  const [savedId, setSavedId] = useState<string | undefined>(id);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  /** Phiếu tạo từ hồ sơ quy trình: kế toán chỉ nhập phần kế toán; trường lấy từ hồ sơ bị khoá. */
  const [source, setSource] = useState<FinanceVoucherSource | null>(null);
  const [savedFiles, setSavedFiles] = useState<FinanceVoucherAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // Dự án/công việc của Workspace: nạp riêng, lỗi (Workspace tắt hoặc chưa kết nối) chỉ báo ở ô hạch toán, không chặn lưu phiếu.
  const [projects, setProjects] = useState<WorkspaceProjectOption[]>([]);
  const [projectsTruncated, setProjectsTruncated] = useState(false);
  const [workspaceProblem, setWorkspaceProblem] = useState<string | null>(null);
  const [workItems, setWorkItems] = useState<WorkspaceWorkItemOption[]>([]);
  const [workItemsLoading, setWorkItemsLoading] = useState(false);
  /** Nhãn đã lưu trên phiếu, để phiếu cũ vẫn hiện dự án/công việc dù Workspace không trả về nữa (huỷ, tạm tắt). */
  const [storedProjects, setStoredProjects] = useState<WorkspaceProjectOption[]>([]);
  const [storedWorkItem, setStoredWorkItem] = useState<WorkspaceWorkItemOption | null>(null);

  useFinanceCrumbs([config.singular.replace(/^./, (c) => c.toUpperCase()), id ? 'Sửa phiếu' : 'Tạo mới']);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [loadedCatalogs, loadedAccounts] = await Promise.all([
          financeFetch<FinanceCatalogs>('/catalogs'),
          financeFetch<FinanceAccount[]>('/accounts'),
        ]);
        if (!active) return;
        setCatalogs(loadedCatalogs);
        setAccounts(loadedAccounts);
        const applyStoredLinks = (voucher: FinanceVoucher) => {
          const stored = new Map<string, WorkspaceProjectOption>();
          for (const project of voucher.relatedProjects) stored.set(project.projectId, { id: project.projectId, code: project.projectCode, name: project.projectName, status: '' });
          if (voucher.allocation)
            stored.set(voucher.allocation.projectId, { id: voucher.allocation.projectId, code: voucher.allocation.projectCode, name: voucher.allocation.projectName, status: '' });
          setStoredProjects([...stored.values()]);
          if (voucher.allocation?.workItemId)
            setStoredWorkItem({ id: voucher.allocation.workItemId, code: voucher.allocation.workItemCode ?? '', title: voucher.allocation.workItemTitle ?? '', status: '', depth: 0 });
        };
        if (id) {
          const voucher = await financeFetch<FinanceVoucher>(`/vouchers/${id}`);
          if (!active) return;
          setForm(fromVoucher(voucher));
          setCode(voucher.code);
          setRevision(voucher.revision);
          setLocked(!voucher.permissions.canEdit && !voucher.permissions.sourced.canEditSourced);
          setSource(voucher.approvalMode === 'INHERITED' ? voucher.source : null);
          setSavedFiles(voucher.attachments);
          applyStoredLinks(voucher);
        } else {
          const next = await financeFetch<{ code: string }>(`/vouchers/next-code${toQuery({ kind, date: todayVn() })}`);
          if (active) setCode(next.code);
          if (fromId) {
            // Nhân bản: điền sẵn dữ liệu phiếu nguồn, trừ ngày (đặt lại hôm nay) và tệp đính kèm (không copy).
            const source = await financeFetch<FinanceVoucher>(`/vouchers/${fromId}`);
            if (!active) return;
            const today = todayVn();
            setForm({ ...fromVoucher(source), voucherDate: today, postingDate: today });
            applyStoredLinks(source);
          }
        }
      } catch (e) {
        if (active) setError(financeErrorMessage(e, 'Không tải được dữ liệu.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, kind, fromId]);

  useEffect(() => {
    let active = true;
    loadWorkspaceProjects()
      .then((result) => {
        if (!active) return;
        setProjects(result.items);
        setProjectsTruncated(result.truncated);
      })
      .catch((e) => {
        if (active) setWorkspaceProblem(financeErrorMessage(e, 'Chưa kết nối được Workspace.'));
      });
    return () => {
      active = false;
    };
  }, []);

  const allocProjectId = form.allocProjectId;
  const needsWorkItems = form.allocType === 'WORK_ITEM' && Boolean(allocProjectId);
  useEffect(() => {
    if (!needsWorkItems) {
      setWorkItems([]);
      return;
    }
    let active = true;
    setWorkItemsLoading(true);
    loadWorkspaceWorkItems(allocProjectId)
      .then((items) => {
        if (active) setWorkItems(items);
      })
      .catch((e) => {
        if (!active) return;
        setWorkItems([]);
        setWorkspaceProblem(financeErrorMessage(e, 'Chưa kết nối được Workspace.'));
      })
      .finally(() => {
        if (active) setWorkItemsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [needsWorkItems, allocProjectId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  /** Trường lấy từ hồ sơ quy trình (chỉ với phiếu có nguồn). Nội dung và dòng chi tiết luôn thuộc hồ sơ. */
  const fromSource = (field: FinanceSourceLockedField) => Boolean(source && (field === 'content' || field === 'amount' || source.lockedFields.includes(field)));
  const patchLine = (key: number, patch: Partial<LineState>) =>
    setForm((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }));

  const reasonOptions = useMemo(
    () => (catalogs?.reasons ?? []).filter((r) => r.kind === kind && r.isActive).map((r) => ({ value: r.id, label: r.name })),
    [catalogs, kind],
  );
  const groupOptions = useMemo(() => (catalogs?.counterpartyGroups ?? []).filter((g) => g.isActive).map((g) => ({ value: g.id, label: g.name })), [catalogs]);
  const allocationTypeOptions = useMemo(
    () => (['PROJECT', 'WORK_ITEM'] as const).map((type) => ({ value: type, label: FINANCE_ALLOCATION_LABELS[type] })),
    [],
  );
  /** Dự án để chọn: danh sách Workspace cộng dự án đã lưu trên phiếu (nếu Workspace không còn trả về). */
  const projectOptions = useMemo(() => {
    const byId = new Map(projects.map((project) => [project.id, project]));
    for (const project of storedProjects) if (!byId.has(project.id)) byId.set(project.id, project);
    return [...byId.values()]
      .sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }))
      .map((project) => ({ value: project.id, label: projectLabel(project), description: PROJECT_STATUS_LABELS[project.status] ?? undefined }));
  }, [projects, storedProjects]);
  const workItemOptions = useMemo(() => {
    const items = storedWorkItem && form.allocWorkItemId === storedWorkItem.id && !workItems.some((item) => item.id === storedWorkItem.id) ? [...workItems, storedWorkItem] : workItems;
    return items.map((item) => ({
      value: item.id,
      label: workItemLabel(item),
      description: WORK_ITEM_STATUS_LABELS[item.status] ?? undefined,
    }));
  }, [workItems, storedWorkItem, form.allocWorkItemId]);
  const relatedChoices = useMemo(
    () => projectOptions.filter((option) => !form.relatedProjectIds.includes(option.value) && option.value !== form.allocProjectId),
    [projectOptions, form.relatedProjectIds, form.allocProjectId],
  );
  const labelOfProject = (id: string) => projectOptions.find((option) => option.value === id)?.label ?? 'Dự án không còn trong danh sách';
  const workspaceHint = workspaceProblem
    ? `${workspaceProblem} Phiếu vẫn lưu được, chỉ chưa chọn được dự án.`
    : projectsTruncated
      ? 'Danh sách dự án quá dài, chỉ hiện một phần; gõ mã dự án để lọc trong phần đang hiện.'
      : undefined;
  const accountOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.isActive)
        .map((a) => ({
          value: a.id,
          label: a.name,
          description: [a.accountType === 'CASH' ? 'Quỹ tiền mặt' : a.accountNumber, a.balance === null ? null : `Số dư ${money(a.balance)}`].filter(Boolean).join(' · '),
        })),
    [accounts],
  );
  const total = config.hasLines ? financeLinesTotal(form.lines) : form.amount;
  const includedTax = form.taxIncluded ? financeIncludedTax(total, form.taxRate) : 0;

  /**
   * Lưu phiếu, tải các tệp đang chờ, rồi gửi duyệt nếu phiếu chưa sang trạng thái chờ duyệt. Tệp phải lên TRƯỚC khi gửi
   * duyệt vì phiếu đã gửi duyệt không còn nhận tệp. Tải tệp lỗi thì dừng tại form (phiếu đã lưu, tệp lỗi còn trong danh
   * sách để thử lại) và không gửi duyệt. Sửa phiếu đang chờ duyệt (trực tiếp) hoặc bị từ chối thì máy chủ đã tự chuyển
   * thẳng về chờ duyệt trong lần lưu (PUT) nên không cần gọi thêm — chỉ phiếu còn ở dạng nháp mới cần gọi gửi duyệt riêng.
   */
  async function save() {
    const problem = config.hasLines ? allocationProblem(form) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const body = buildRequest(kind, form, revision);
    try {
      const saved = savedId
        ? await financePut<FinanceVoucher>(`/vouchers/${savedId}`, body)
        : await financePost<FinanceVoucher>('/vouchers', body);
      setSavedId(saved.id);
      setRevision(saved.revision);

      const failed: { file: File; message: string }[] = [];
      const uploaded: FinanceVoucherAttachment[] = [];
      for (const file of pendingFiles) {
        try {
          uploaded.push(await uploadFinanceAttachment(saved.id, file));
        } catch (e) {
          failed.push({ file, message: financeErrorMessage(e, `${file.name}: không tải lên được.`) });
        }
      }
      if (uploaded.length) setSavedFiles((current) => [...current, ...uploaded]);
      setPendingFiles(failed.map((item) => item.file));
      if (failed.length) {
        setError(`Phiếu ${saved.code} đã được lưu nhưng ${failed.length} tệp chưa tải lên được:\n${failed.map((item) => item.message).join('\n')}`);
        return;
      }

      if (source) {
        toast.success(`Đã lưu ${saved.code}`);
      } else {
        if (saved.status !== 'PENDING') await financePost<FinanceVoucher>(`/vouchers/${saved.id}/submit`);
        toast.success(`Đã gửi duyệt ${saved.code}`);
      }
      router.push(`${config.path}/${saved.id}`);
    } catch (e) {
      setError(financeErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  /** Ảnh dán/thả vào Ghi chú đi thẳng sang Đính kèm (tải lên khi lưu), cùng kiểm tra định dạng/dung lượng/số lượng. */
  function addPastedImages(files: File[]) {
    const stamp = Date.now();
    const named = files.map((file, index) => {
      // Ảnh dán từ clipboard thường tên "image.png" cho mọi lần: đặt tên riêng để phân biệt trong danh sách.
      const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      return new File([file], `anh-dan-${stamp}-${index + 1}.${ext}`, { type: file.type });
    });
    const problems = named.map((file) => attachmentProblem(file)).filter((p): p is string => Boolean(p));
    const valid = named.filter((file) => !attachmentProblem(file));
    const room = MAX_ATTACHMENTS - savedFiles.length - pendingFiles.length;
    if (valid.length > room) problems.push(`Mỗi phiếu đính kèm tối đa ${MAX_ATTACHMENTS} tệp.`);
    setError(problems.length ? problems.join('\n') : null);
    if (valid.length && room > 0) setPendingFiles((current) => [...current, ...valid.slice(0, room)]);
  }

  async function removeSaved(file: FinanceVoucherAttachment) {
    if (!savedId) return;
    try {
      await removeFinanceAttachment(savedId, file.id);
      setSavedFiles((current) => current.filter((item) => item.id !== file.id));
    } catch (e) {
      setError(financeErrorMessage(e));
    }
  }

  if (loading) return <div role="status" className="p-8 text-sm text-slate-500">Đang tải biểu mẫu…</div>;
  if (locked)
    return (
      <div role="alert" className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {source
          ? 'Phiếu tạo từ hồ sơ quy trình: chỉ kế toán đang được giao bước Tài chính mới nhập được.'
          : 'Phiếu này không còn sửa được (đã gửi duyệt hoặc đã xử lý).'}{' '}
        <button type="button" className="font-semibold underline" onClick={() => router.push(`${config.path}/${id}`)}>
          Xem phiếu
        </button>
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-lg font-semibold text-slate-900">{id ? `Sửa ${config.singular}` : config.createTitle}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
        <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white px-5 shadow-sm">
          <ErrorBanner message={error} />
          {source ? (
            <p role="note" className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              Phiếu tạo từ hồ sơ {source.instanceCode}
              {source.definitionName ? ` (${source.definitionName})` : ''}. Các trường có biểu tượng khoá lấy từ hồ sơ; muốn sửa thì trả hồ sơ về.
            </p>
          ) : null}

          <FormSection title="Thông tin chung">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={config.codeLabel}>{(fieldId) => <Input id={fieldId} value={code} disabled readOnly />}</Field>
              <Field label={config.dateLabel} required locked={fromSource('voucherDate')}>
                {(fieldId) => <DatePickerInput id={fieldId} value={form.voucherDate} disabled={fromSource('voucherDate')} onChange={(value) => set('voucherDate', value)} />}
              </Field>
              <Field label="Ngày hạch toán" required>
                {(fieldId) => <DatePickerInput id={fieldId} value={form.postingDate} onChange={(value) => set('postingDate', value)} />}
              </Field>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={config.contentLabel} required className="sm:col-span-2" locked={fromSource('content')}>
                {(fieldId) => (
                  <Input id={fieldId} value={form.content} disabled={fromSource('content')} placeholder={config.contentPlaceholder} maxLength={500} onChange={(e) => set('content', e.target.value)} />
                )}
              </Field>

              {config.hasLines ? (
                <>
                  <Field label={config.reasonLabel} required>
                    {(fieldId) => <SearchableSelect name={fieldId} options={reasonOptions} value={form.reasonId} onChange={(v) => set('reasonId', v)} placeholder={`Chọn ${config.reasonLabel.toLowerCase()}`} clearable height={32} />}
                  </Field>
                  <Field label={config.accountLabel} required>
                    {(fieldId) => <SearchableSelect name={fieldId} options={accountOptions} value={form.accountId} onChange={(v) => set('accountId', v)} placeholder={`Chọn ${config.accountLabel.toLowerCase()}`} clearable height={32} />}
                  </Field>
                  <Field label={config.counterpartyLabel} required>
                    {(fieldId) => <SearchableSelect name={fieldId} options={groupOptions} value={form.counterpartyGroupId} onChange={(v) => set('counterpartyGroupId', v)} placeholder={`Chọn ${config.counterpartyLabel.toLowerCase()}`} clearable height={32} />}
                  </Field>
                  <Field label={config.personLabel} locked={fromSource('counterpartyName')}>
                    {(fieldId) => (
                      <Input id={fieldId} value={form.counterpartyName} disabled={fromSource('counterpartyName')} maxLength={255} onChange={(e) => set('counterpartyName', e.target.value)} />
                    )}
                  </Field>
                  <Field label={config.personAccountLabel} locked={fromSource('counterpartyAccountNo')}>
                    {(fieldId) => (
                      <Input id={fieldId} value={form.counterpartyAccountNo} disabled={fromSource('counterpartyAccountNo')} maxLength={60} onChange={(e) => set('counterpartyAccountNo', e.target.value)} />
                    )}
                  </Field>
                  <Field label={config.personBankLabel} locked={fromSource('counterpartyBank')}>
                    {(fieldId) => (
                      <Input id={fieldId} value={form.counterpartyBank} disabled={fromSource('counterpartyBank')} maxLength={120} onChange={(e) => set('counterpartyBank', e.target.value)} />
                    )}
                  </Field>
                  <Field
                    label="Hạch toán nội bộ"
                    locked={fromSource('allocation')}
                    hint={form.allocType ? undefined : 'Gắn khoản thu chi vào dự án hoặc công việc của dự án (không bắt buộc).'}
                  >
                    {(fieldId) => (
                      <SearchableSelect
                        disabled={fromSource('allocation')}
                        name={fieldId}
                        options={allocationTypeOptions}
                        value={form.allocType}
                        onChange={(v) =>
                          setForm((current) => ({
                            ...current,
                            allocType: v === 'PROJECT' || v === 'WORK_ITEM' ? v : '',
                            // Bỏ hạch toán thì bỏ luôn dự án/công việc đã chọn; đổi sang "cho dự án" thì bỏ công việc.
                            allocProjectId: v ? current.allocProjectId : '',
                            allocWorkItemId: v === 'WORK_ITEM' ? current.allocWorkItemId : '',
                          }))
                        }
                        placeholder="Không hạch toán"
                        clearable
                        height={32}
                      />
                    )}
                  </Field>
                  {form.allocType ? (
                    <Field label="Dự án" required hint={workspaceHint} locked={fromSource('allocation')}>
                      {(fieldId) => (
                        <SearchableSelect
                          disabled={fromSource('allocation')}
                          name={fieldId}
                          options={projectOptions}
                          value={form.allocProjectId}
                          onChange={(v) => setForm((current) => ({ ...current, allocProjectId: v, allocWorkItemId: '' }))}
                          placeholder="Chọn dự án"
                          searchPlaceholder="Gõ mã hoặc tên dự án"
                          emptyText={workspaceProblem ?? 'Không có dự án nào'}
                          clearable
                          height={32}
                        />
                      )}
                    </Field>
                  ) : null}
                  {form.allocType === 'WORK_ITEM' ? (
                    <Field label="Công việc" required className="sm:col-span-2" locked={fromSource('allocation')}>
                      {(fieldId) => (
                        <SearchableSelect
                          name={fieldId}
                          options={workItemOptions}
                          value={form.allocWorkItemId}
                          onChange={(v) => set('allocWorkItemId', v)}
                          disabled={!form.allocProjectId || fromSource('allocation')}
                          placeholder={!form.allocProjectId ? 'Chọn dự án trước' : workItemsLoading ? 'Đang tải công việc…' : 'Chọn công việc'}
                          searchPlaceholder="Gõ mã hoặc tên công việc"
                          emptyText="Dự án chưa có công việc nào"
                          clearable
                          height={32}
                        />
                      )}
                    </Field>
                  ) : null}
                </>
              ) : (
                <>
                  <Field label="Số tiền" required>{(fieldId) => <MoneyInput id={fieldId} value={form.amount} onChange={(v) => set('amount', v)} />}</Field>
                  <span className="hidden sm:block" />
                  <Field label={config.accountLabel} required>
                    {(fieldId) => <SearchableSelect name={fieldId} options={accountOptions} value={form.accountId} onChange={(v) => set('accountId', v)} placeholder="Chọn tài khoản nguồn" clearable height={32} />}
                  </Field>
                  <Field label="Tài khoản đích" required>
                    {(fieldId) => (
                      <SearchableSelect name={fieldId} options={accountOptions.filter((o) => o.value !== form.accountId)} value={form.destAccountId} onChange={(v) => set('destAccountId', v)} placeholder="Chọn tài khoản đích" clearable height={32} />
                    )}
                  </Field>
                </>
              )}
            </div>
          </FormSection>

          {config.hasLines ? (
            <>
              <FormSection title={config.detailTitle}>
                <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.taxIncluded} onChange={(e) => set('taxIncluded', e.target.checked)} className="size-4 rounded border-slate-300" />
                  Bao gồm thuế
                  {form.taxIncluded ? (
                    <span className="ml-3 flex items-center gap-1 text-xs text-slate-600">
                      Thuế suất
                      <input
                        aria-label="Thuế suất (%)"
                        inputMode="decimal"
                        value={form.taxRate || ''}
                        onChange={(e) => set('taxRate', Math.min(100, Math.max(0, Number(e.target.value.replace(',', '.')) || 0)))}
                        className="h-7 w-16 rounded-md border border-slate-200 px-2 text-right"
                      />
                      %
                    </span>
                  ) : null}
                </label>

                <div role="table" aria-label="Chi tiết" className="grid gap-2">
                  <div role="row" className="hidden grid-cols-[1fr_90px_150px_150px_28px] gap-2 px-1 text-xs font-medium text-slate-500 sm:grid">
                    <span>Diễn giải <span className="text-red-500">*</span></span>
                    <span>Số lượng <span className="text-red-500">*</span></span>
                    <span>Số tiền <span className="text-red-500">*</span></span>
                    <span>Tổng tiền</span>
                    <span />
                  </div>
                  {form.lines.map((line, index) => (
                    <div role="row" key={line.key} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_90px_150px_150px_28px]">
                      <Input aria-label={`Diễn giải dòng ${index + 1}`} className="col-span-2 sm:col-span-1" disabled={fromSource('amount')} placeholder={config.lineDescriptionPlaceholder} value={line.description} maxLength={500} onChange={(e) => patchLine(line.key, { description: e.target.value })} />
                      <input
                        aria-label={`Số lượng dòng ${index + 1}`}
                        inputMode="decimal"
                        disabled={fromSource('amount')}
                        value={line.quantity || ''}
                        onChange={(e) => patchLine(line.key, { quantity: Number(e.target.value.replace(',', '.')) || 0 })}
                        className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-right text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60"
                      />
                      <MoneyInput aria-label={`Số tiền dòng ${index + 1}`} disabled={fromSource('amount')} value={line.unitAmount} onChange={(v) => patchLine(line.key, { unitAmount: v })} />
                      <div aria-label={`Thành tiền dòng ${index + 1}`} className="flex h-8 items-center justify-end rounded-lg bg-slate-50 px-2.5 text-sm tabular-nums text-slate-700">
                        {money(financeLineTotal(line.quantity, line.unitAmount))}
                      </div>
                      <button
                        type="button"
                        aria-label={`Xoá dòng ${index + 1}`}
                        disabled={form.lines.length === 1 || fromSource('amount')}
                        onClick={() => set('lines', form.lines.filter((l) => l.key !== line.key))}
                        className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  {fromSource('amount') ? (
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Lock className="size-3" aria-hidden /> Dòng chi tiết và số tiền lấy từ hồ sơ
                    </span>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => set('lines', [...form.lines, blankLine()])}>
                      <Plus aria-hidden /> Thêm dòng
                    </Button>
                  )}
                  <div className="text-right text-sm">
                    <div className="font-semibold text-slate-900">Tổng tiền: <span data-testid="voucher-total" className="tabular-nums">{money(total)}</span></div>
                    {form.taxIncluded ? <div className="text-xs text-slate-500">Trong đó thuế: {money(includedTax)}</div> : null}
                  </div>
                </div>
              </FormSection>

              <FormSection title="Hóa đơn" defaultOpen={form.invoices.length > 0}>
                <div className="grid gap-2">
                  {form.invoices.map((invoice, index) => (
                    <div key={invoice.key} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_150px_150px_150px_28px]">
                      <Input aria-label={`Số hoá đơn ${index + 1}`} placeholder="Số hóa đơn" value={invoice.invoiceNo} onChange={(e) => set('invoices', form.invoices.map((i) => (i.key === invoice.key ? { ...i, invoiceNo: e.target.value } : i)))} />
                      <DatePickerInput aria-label={`Ngày hoá đơn ${index + 1}`} value={invoice.invoiceDate} onChange={(v) => set('invoices', form.invoices.map((i) => (i.key === invoice.key ? { ...i, invoiceDate: v } : i)))} />
                      <Input aria-label={`Mã số thuế hoá đơn ${index + 1}`} placeholder="Mã số thuế" value={invoice.taxCode} onChange={(e) => set('invoices', form.invoices.map((i) => (i.key === invoice.key ? { ...i, taxCode: e.target.value } : i)))} />
                      <MoneyInput aria-label={`Số tiền hoá đơn ${index + 1}`} value={invoice.amount} onChange={(v) => set('invoices', form.invoices.map((i) => (i.key === invoice.key ? { ...i, amount: v } : i)))} />
                      <button type="button" aria-label={`Xoá hoá đơn ${index + 1}`} onClick={() => set('invoices', form.invoices.filter((i) => i.key !== invoice.key))} className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => set('invoices', [...form.invoices, { key: nextKey(), invoiceNo: '', invoiceDate: '', taxCode: '', amount: 0 }])}>
                  <Plus aria-hidden /> Thêm hóa đơn
                </Button>
              </FormSection>
            </>
          ) : null}

          <FormSection title="Đính kèm">
            <AttachmentsField
              voucherId={savedId}
              saved={savedFiles}
              pending={pendingFiles}
              disabled={saving}
              onAdd={(files) => setPendingFiles((current) => [...current, ...files])}
              onRemovePending={(index) => setPendingFiles((current) => current.filter((_, i) => i !== index))}
              onRemoveSaved={(file) => void removeSaved(file)}
              onProblem={setError}
            />
          </FormSection>

          <FormSection title="Ghi chú">
            <NoteEditor value={form.note} onChange={(html) => set('note', html)} voucherId={savedId} disabled={saving} onProblem={setError} onPasteImages={addPastedImages} />
            <p className="mt-1.5 text-xs text-slate-500">Dán hoặc thả ảnh vào ghi chú sẽ tự chuyển sang mục Đính kèm.</p>
          </FormSection>

          <FormSection title="Đối tượng liên quan" defaultOpen={form.relatedProjectIds.length > 0}>
            <p className="mb-2 text-xs text-slate-500">
              Dự án có liên quan tới phiếu này. Phiếu hiện ở tab Thu chi của các dự án đó nhưng không cộng vào tổng thu chi của dự án; chỉ phần Hạch toán nội bộ mới được cộng.
            </p>
            <Field label="Thêm dự án liên quan" hint={workspaceHint}>
              {(fieldId) => (
                <SearchableSelect
                  name={fieldId}
                  options={relatedChoices}
                  value=""
                  onChange={(v) => v && set('relatedProjectIds', [...form.relatedProjectIds, v])}
                  placeholder="Chọn dự án liên quan"
                  searchPlaceholder="Gõ mã hoặc tên dự án"
                  emptyText={workspaceProblem ?? 'Không còn dự án nào để thêm'}
                  height={32}
                />
              )}
            </Field>
            {form.relatedProjectIds.length ? (
              <ul aria-label="Dự án liên quan" className="mt-2 flex flex-wrap gap-2">
                {form.relatedProjectIds.map((projectId) => (
                  <li key={projectId} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pr-1 pl-3 text-xs text-slate-700">
                    {labelOfProject(projectId)}
                    <button
                      type="button"
                      aria-label={`Bỏ dự án liên quan ${labelOfProject(projectId)}`}
                      onClick={() => set('relatedProjectIds', form.relatedProjectIds.filter((id) => id !== projectId))}
                      className="flex size-5 items-center justify-center rounded-full text-slate-500 hover:bg-red-50 hover:text-red-600"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </FormSection>
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <Button type="button" disabled={saving} onClick={() => void save()}>{source ? 'Lưu' : 'Gửi duyệt'}</Button>
        <Button type="button" variant="outline" disabled={saving} onClick={() => router.push(config.path)}>Hủy bỏ</Button>
      </footer>
    </div>
  );
}
