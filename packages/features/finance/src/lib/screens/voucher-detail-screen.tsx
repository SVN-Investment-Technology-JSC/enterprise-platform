'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, BookCheck, Check, CornerUpLeft, Lock, Paperclip, Pencil, RefreshCw, Send, Trash2, Undo2, UserCheck, X } from 'lucide-react';
import { Popconfirm, toast } from '@enterprise-platform/shared-ui';
import {
  FINANCE_ALLOCATION_LABELS,
  FINANCE_VOUCHER_EVENT_LABELS,
  financeAllocationLabel,
  type FinanceProcedureProgress,
  type FinanceSourceLockedField,
  type FinanceVoucher,
  type FinanceVoucherSource,
  type FinanceVoucherKind,
} from '@enterprise-platform/contracts-finance';
import { formatBytes, openFinanceAttachment } from '../attachment-upload';
import { financeDelete, financeErrorMessage, financeFetch, financePost } from '../finance-api';
import { useFinanceCrumbs } from '../finance-crumbs';
import { dateTimeVn, dateVn, money, newFinanceIdempotencyKey } from '../finance-format';
import { FINANCE_KIND_CONFIG } from '../finance-kinds';
import { Button } from '../ui/button';
import { EmptyState, ErrorBanner, StatusBadge } from '../ui/form-parts';
import { NoteView } from '../ui/note-view';

const STEP_STATUS_TEXT: Record<string, string> = {
  running: 'Đang chạy',
  completed: 'Đã hoàn thành',
  rejected: 'Bị từ chối',
  cancelled: 'Đã huỷ',
  reversed: 'Đã huỷ hiệu lực',
};

/** Khối theo dõi hồ sơ quy trình của phiếu: ai đang xử lý, tiến độ và lỗi cần người dùng xử lý. */
function ProcedurePanel({ procedure }: { procedure: FinanceProcedureProgress }) {
  const stuck = procedure.syncStatus === 'CONFLICT';
  return (
    <section aria-label="Quy trình duyệt" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Quy trình duyệt</h2>
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
        <Info label="Hồ sơ quy trình">
          {procedure.instanceId ? (
            <a className="font-medium text-link hover:underline" href={`/modules/procedure#workspace/${encodeURIComponent(procedure.instanceId)}`}>
              {procedure.instanceCode ?? 'Mở hồ sơ'}
            </a>
          ) : (
            'Đang khởi tạo'
          )}
        </Info>
        <Info label="Trạng thái">{STEP_STATUS_TEXT[procedure.status] ?? procedure.status}</Info>
        <Info label="Bước hiện tại">
          {procedure.currentStepName}
          {procedure.currentAssigneeName ? <span className="block text-xs text-slate-500">Người xử lý: {procedure.currentAssigneeName}</span> : null}
        </Info>
      </dl>
      {procedure.syncStatus === 'START_PENDING' || procedure.syncStatus === 'FAILED' ? (
        <p role="status" className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
          Hồ sơ quy trình chưa được tạo{procedure.lastError ? `: ${procedure.lastError}` : ''}. Hệ thống sẽ tự thử lại; có thể bấm Thử lại.
        </p>
      ) : null}
      {stuck ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">
          Quy trình đã duyệt nhưng chưa ghi sổ được: {procedure.lastError}. Xử lý nguyên nhân (ví dụ nạp tiền vào tài khoản) rồi bấm Áp lại.
        </p>
      ) : null}
    </section>
  );
}

const SOURCE_STATUS_TEXT: Record<FinanceVoucherSource['status'], string> = {
  OPEN: 'Chờ ghi sổ',
  RETURNED: 'Đã trả hồ sơ, chờ hồ sơ quay lại',
  POSTED: 'Đã ghi sổ',
  CLOSED: 'Đã đóng',
  REVERSAL_PENDING: 'Hồ sơ đã huỷ hiệu lực, chờ đảo phiếu',
};

/** Khối "Nguồn": hồ sơ quy trình đã tạo ra phiếu, giá trị nhận từ hồ sơ, ai phụ trách và ai đang xử lý. */
function SourcePanel({ source }: { source: FinanceVoucherSource }) {
  const values = source.values;
  return (
    <section aria-label="Nguồn hồ sơ quy trình" className="rounded-xl border border-sky-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">
        Nguồn: hồ sơ{' '}
        <a className="font-semibold text-link hover:underline" href={`/modules/procedure#workspace/${encodeURIComponent(source.instanceId)}`}>
          {source.instanceCode}
        </a>
        {source.definitionName ? <span className="font-normal text-slate-600"> – {source.definitionName}</span> : null}
      </h2>
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
        <Info label="Bước">{source.stepName}</Info>
        <Info label="Tình trạng">{SOURCE_STATUS_TEXT[source.status]}</Info>
        <Info label="Phụ trách">{source.assigneeLabel}</Info>
        <Info label="Số tiền đề nghị">{values.amount !== null ? <span className="tabular-nums">{money(values.amount)}</span> : null}</Info>
        <Info label="Người nhận">{values.counterpartyName}</Info>
        <Info label="Tài khoản người nhận">{[values.counterpartyAccountNo, values.counterpartyBank].filter(Boolean).join(' · ')}</Info>
        <div className="sm:col-span-3"><Info label="Nội dung đề nghị">{values.content}</Info></div>
      </dl>
      {source.handlingBy ? (
        <p role="status" className="mt-3 text-sm text-slate-700">
          Đang xử lý: <span className="font-medium">{source.handlingByName ?? 'Người khác'}</span>
          {source.handlingSince ? ` (từ ${dateTimeVn(source.handlingSince)})` : ''}
        </p>
      ) : null}
      {source.status === 'OPEN' && source.canAct === null && source.canActReason ? (
        <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{source.canActReason}</p>
      ) : null}
      {source.status === 'REVERSAL_PENDING' ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">
          {source.reversalReason ? `${source.reversalReason}. ` : ''}Chưa đảo được phiếu{source.reversalError ? `: ${source.reversalError}` : ''}. Xử lý nguyên
          nhân (mở khoá sổ, bổ sung số dư) rồi bấm Đảo lại.
        </p>
      ) : null}
      {source.status === 'OPEN' && source.canAct === false ? (
        <p role="status" className="mt-3 rounded-lg bg-slate-50 p-2 text-sm text-slate-600">
          {source.canActReason ?? 'Bạn không được giao bước Tài chính của hồ sơ này.'} Phiếu chỉ xem.
        </p>
      ) : null}
    </section>
  );
}

/** Nhãn kèm biểu tượng khoá cho trường lấy từ hồ sơ. */
function lockedLabel(label: string, source: FinanceVoucherSource | null, field: FinanceSourceLockedField): ReactNode {
  const locked = Boolean(source && (field === 'content' || field === 'amount' || source.lockedFields.includes(field)));
  if (!locked) return label;
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <span title="Lấy từ hồ sơ, muốn sửa thì trả hồ sơ về" className="inline-flex text-slate-400">
        <Lock className="size-3" aria-label="Lấy từ hồ sơ" />
      </span>
    </span>
  );
}

function Info({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-900">{children || <span className="text-slate-400">-</span>}</dd>
    </div>
  );
}

export default function VoucherDetailScreen({ kind, id }: { kind: FinanceVoucherKind; id: string }) {
  const config = FINANCE_KIND_CONFIG[kind];
  const router = useRouter();
  const [voucher, setVoucher] = useState<FinanceVoucher | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFinanceCrumbs([config.singular.replace(/^./, (c) => c.toUpperCase()), voucher?.code ?? '']);

  const load = useCallback(async () => {
    try {
      setVoucher(await financeFetch<FinanceVoucher>(`/vouchers/${id}`));
      setError(null);
    } catch (e) {
      setError(financeErrorMessage(e, 'Không tải được phiếu.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string, body: unknown, success: string) {
    setBusy(true);
    try {
      setVoucher(await financePost<FinanceVoucher>(`/vouchers/${id}/${path}`, body));
      setError(null);
      toast.success(success);
    } catch (e) {
      setError(financeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const viaProcedure = voucher?.approvalMode === 'PROCEDURE';
  const decide = (action: 'approve' | 'reject', comment: string | undefined, success: string) =>
    viaProcedure
      ? act('procedure-action', { action, comment, idempotencyKey: newFinanceIdempotencyKey() }, success)
      : act(action, { note: comment }, success);

  async function remove() {
    setBusy(true);
    try {
      await financeDelete(`/vouchers/${id}`);
      toast.success('Đã xoá phiếu');
      router.push(config.path);
    } catch (e) {
      setError(financeErrorMessage(e));
      setBusy(false);
    }
  }

  if (loading) return <div role="status" className="p-8 text-sm text-slate-500">Đang tải phiếu…</div>;
  if (!voucher)
    return (
      <div className="p-4">
        <ErrorBanner message={error ?? 'Không tìm thấy phiếu.'} />
        <Button type="button" variant="outline" className="mt-3" onClick={() => router.push(config.path)}>Về danh sách</Button>
      </div>
    );

  const can = voucher.permissions;
  const sourced = can.sourced;
  const source = voucher.approvalMode === 'INHERITED' ? voucher.source : null;
  const isTransfer = kind === 'TRANSFER';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{voucher.code}</h1>
            {voucher.draftCode && voucher.draftCode !== voucher.code ? (
              <p className="text-xs text-slate-500">Mã nháp: {voucher.draftCode}</p>
            ) : null}
          </div>
          <StatusBadge status={voucher.status} />
          {voucher.posted && voucher.status === 'APPROVED' ? <span className="text-xs text-emerald-700">Đã ghi sổ tài khoản</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sourced.canEditSourced ? (
            <Button type="button" variant="outline" onClick={() => router.push(`${config.path}/${id}/edit`)}>
              <Pencil aria-hidden /> Nhập thông tin kế toán
            </Button>
          ) : null}
          {sourced.canPost ? (
            <Popconfirm
              title="Ghi sổ phiếu này?"
              description="Tiền được ghi vào sổ tài khoản, phiếu nhận mã chính thức và bước Tài chính của hồ sơ được đóng."
              okType="primary"
              okText="Ghi sổ"
              onConfirm={() => act('post-sourced', { revision: voucher.revision }, 'Đã ghi sổ')}
            >
              <Button type="button" disabled={busy}><BookCheck aria-hidden /> Ghi sổ</Button>
            </Popconfirm>
          ) : null}
          {sourced.canReturnSource ? (
            <Popconfirm
              title="Trả hồ sơ"
              description="Hồ sơ quay về bước đã cấu hình để người lập sửa; phiếu chỉ xem cho tới khi hồ sơ quay lại."
              reasonRequired
              reasonLabel="Lý do trả hồ sơ"
              reasonPlaceholder="Nhập lý do để người lập chỉnh sửa hồ sơ"
              okText="Trả hồ sơ"
              onConfirm={(reason) => act('return-source', { reason, revision: voucher.revision }, 'Đã trả hồ sơ')}
            >
              <Button type="button" variant="destructive" disabled={busy}><CornerUpLeft aria-hidden /> Trả hồ sơ</Button>
            </Popconfirm>
          ) : null}
          {sourced.canTakeOver ? (
            <Popconfirm
              title="Nhận xử lý thay?"
              description={`${source?.handlingByName ?? 'Người khác'} đang xử lý phiếu này. Việc nhận thay được ghi vào lịch sử phiếu.`}
              okType="primary"
              okText="Nhận xử lý"
              onConfirm={() => act('take-over', {}, 'Đã nhận xử lý phiếu')}
            >
              <Button type="button" variant="outline" disabled={busy}><UserCheck aria-hidden /> Nhận xử lý thay</Button>
            </Popconfirm>
          ) : null}
          {sourced.canRetryReversal ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => act('retry-source-reversal', {}, 'Đã đảo phiếu theo hồ sơ')}>
              <RefreshCw aria-hidden /> Đảo lại
            </Button>
          ) : null}
          {can.canEdit ? (
            <Button type="button" variant="outline" onClick={() => router.push(`${config.path}/${id}/edit`)}>
              <Pencil aria-hidden /> Sửa
            </Button>
          ) : null}
          {can.canSubmit ? (
            <Popconfirm title="Gửi phiếu để duyệt?" description="Sau khi gửi, phiếu không sửa được cho đến khi được duyệt hoặc từ chối." okType="primary" okText="Gửi duyệt" onConfirm={() => act('submit', {}, 'Đã gửi duyệt')}>
              <Button type="button" disabled={busy}><Send aria-hidden /> Gửi duyệt</Button>
            </Popconfirm>
          ) : null}
          {can.canApprove ? (
            <Popconfirm title="Duyệt và ghi sổ phiếu này?" description={viaProcedure ? 'Phiếu qua quy trình: tiền được ghi sổ khi bước duyệt cuối hoàn tất.' : 'Tiền sẽ được ghi vào sổ tài khoản ngay khi duyệt.'} okType="primary" okText="Duyệt" onConfirm={() => decide('approve', undefined, viaProcedure ? 'Đã duyệt bước của bạn' : 'Đã duyệt và ghi sổ')}>
              <Button type="button" disabled={busy}><Check aria-hidden /> Duyệt</Button>
            </Popconfirm>
          ) : null}
          {can.canReject ? (
            <Popconfirm title="Từ chối phiếu" reasonRequired reasonLabel="Lý do từ chối" reasonPlaceholder="Nhập lý do để người lập chỉnh sửa" okText="Từ chối" onConfirm={(reason) => decide('reject', reason, 'Đã từ chối phiếu')}>
              <Button type="button" variant="destructive" disabled={busy}><X aria-hidden /> Từ chối</Button>
            </Popconfirm>
          ) : null}
          {can.canRetryProcedure ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => act('procedure-retry', {}, 'Đã thử lại')}>
              <RefreshCw aria-hidden /> {voucher.procedure?.syncStatus === 'CONFLICT' ? 'Áp lại' : 'Thử lại'}
            </Button>
          ) : null}
          {can.canCancel ? (
            <Popconfirm title="Huỷ phiếu" reasonRequired reasonLabel="Lý do huỷ" reasonPlaceholder="Nhập lý do huỷ phiếu" okText="Huỷ phiếu" onConfirm={(reason) => act('cancel', { note: reason }, 'Đã huỷ phiếu')}>
              <Button type="button" variant="outline" disabled={busy}><Ban aria-hidden /> Huỷ phiếu</Button>
            </Popconfirm>
          ) : null}
          {can.canReverse ? (
            <Popconfirm title="Huỷ phiếu đã ghi sổ" description="Hệ thống ghi bút toán đảo vào hôm nay; số của kỳ đã qua không bị sửa." reasonRequired reasonLabel="Lý do huỷ" reasonPlaceholder="Nhập lý do huỷ phiếu đã ghi sổ" okText="Đảo bút toán" onConfirm={(reason) => act('reverse', { note: reason }, 'Đã huỷ phiếu và đảo bút toán')}>
              <Button type="button" variant="destructive" disabled={busy}><Undo2 aria-hidden /> Huỷ phiếu đã ghi sổ</Button>
            </Popconfirm>
          ) : null}
          {can.canDelete ? (
            <Popconfirm title="Xoá phiếu?" description="Phiếu chưa ghi sổ nên xoá được; bị xoá hẳn và không khôi phục được." okText="Xoá" onConfirm={remove}>
              <Button type="button" variant="ghost" disabled={busy}><Trash2 aria-hidden /> Xoá</Button>
            </Popconfirm>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
        <ErrorBanner message={error} />
        <div className="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            {source ? <SourcePanel source={source} /> : null}
            <section aria-label="Thông tin chung" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Thông tin chung</h2>
              <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
                <Info label={config.dateLabel}>{dateVn(voucher.voucherDate)}</Info>
                <Info label="Ngày hạch toán">{dateVn(voucher.postingDate)}</Info>
                <Info label={lockedLabel('Số tiền', source, 'amount')}><span className="font-semibold tabular-nums">{money(voucher.totalAmount)}</span></Info>
                <div className="sm:col-span-3"><Info label={lockedLabel(config.contentLabel, source, 'content')}>{voucher.content}</Info></div>
                {isTransfer ? (
                  <>
                    <Info label={config.accountLabel}>{voucher.accountName}</Info>
                    <Info label="Tài khoản đích">{voucher.destAccountName}</Info>
                  </>
                ) : (
                  <>
                    <Info label={config.reasonLabel}>{voucher.reasonName}</Info>
                    <Info label={config.accountLabel}>{voucher.accountName}</Info>
                    <Info label={config.counterpartyLabel}>{voucher.counterpartyGroupName}</Info>
                    <Info label={lockedLabel('Hạch toán nội bộ', source, 'allocation')}>
                      {voucher.allocation ? `${FINANCE_ALLOCATION_LABELS[voucher.allocation.type]}: ${financeAllocationLabel(voucher.allocation)}` : null}
                    </Info>
                    {voucher.allocation?.workItemId ? (
                      <Info label="Dự án của công việc">{`${voucher.allocation.projectCode} - ${voucher.allocation.projectName}`}</Info>
                    ) : null}
                  </>
                )}
                <Info label="Người tạo">{voucher.createdByName}</Info>
                <Info label="Ngày tạo">{dateTimeVn(voucher.createdAt)}</Info>
              </dl>
              {voucher.decisionNote ? (
                <p className="mt-3 rounded-lg bg-slate-50 p-2 text-sm text-slate-700">
                  <span className="font-medium">{voucher.status === 'REJECTED' ? 'Lý do từ chối: ' : 'Ghi chú xử lý: '}</span>
                  {voucher.decisionNote}
                </p>
              ) : null}
            </section>

            {voucher.procedure ? <ProcedurePanel procedure={voucher.procedure} /> : null}

            {!isTransfer ? (
              <section aria-label={config.detailTitle} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-slate-900">{config.detailTitle}</h2>
                {voucher.lines.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                          <th className="py-1.5 pr-2 font-medium">Diễn giải</th>
                          <th className="px-2 text-right font-medium">Số lượng</th>
                          <th className="px-2 text-right font-medium">Số tiền</th>
                          <th className="pl-2 text-right font-medium">Tổng tiền</th>
                        </tr>
                      </thead>
                      <tbody>
                        {voucher.lines.map((line) => (
                          <tr key={line.id ?? line.lineNo} className="border-b border-slate-50">
                            <td className="py-1.5 pr-2">{line.description}</td>
                            <td className="px-2 text-right tabular-nums">{line.quantity}</td>
                            <td className="px-2 text-right tabular-nums">{money(line.unitAmount)}</td>
                            <td className="pl-2 text-right tabular-nums">{money(line.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3} className="pt-2 text-right font-semibold">Tổng cộng</td>
                          <td className="pt-2 text-right font-semibold tabular-nums">{money(voucher.totalAmount)}</td>
                        </tr>
                        {voucher.taxIncluded ? (
                          <tr>
                            <td colSpan={3} className="text-right text-xs text-slate-500">Đã gồm thuế {voucher.taxRate}%, trong đó thuế</td>
                            <td className="text-right text-xs tabular-nums text-slate-500">{money(voucher.taxAmount)}</td>
                          </tr>
                        ) : null}
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <EmptyState>Chưa có dòng chi tiết.</EmptyState>
                )}
                {voucher.invoices.length ? (
                  <div className="mt-4">
                    <h3 className="mb-1 text-xs font-semibold text-slate-600">Hóa đơn</h3>
                    <ul className="space-y-1 text-sm">
                      {voucher.invoices.map((invoice) => (
                        <li key={invoice.id} className="flex justify-between gap-2">
                          <span>{invoice.invoiceNo}{invoice.invoiceDate ? ` · ${dateVn(invoice.invoiceDate)}` : ''}{invoice.taxCode ? ` · MST ${invoice.taxCode}` : ''}</span>
                          <span className="tabular-nums">{money(invoice.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}

            {voucher.attachments.length ? (
              <section aria-label="Đính kèm" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-slate-900">Đính kèm</h2>
                <ul className="divide-y divide-slate-100 text-sm">
                  {voucher.attachments.map((file) => (
                    <li key={file.id} className="flex items-center gap-2 py-1.5">
                      <Paperclip className="size-4 shrink-0 text-slate-400" aria-hidden />
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left font-medium text-link hover:underline"
                        onClick={() => void openFinanceAttachment(voucher.id, file.id).catch((e) => setError(financeErrorMessage(e)))}
                      >
                        {file.fileName}
                      </button>
                      <span className="text-xs text-slate-500">{formatBytes(file.sizeBytes)}</span>
                      <span className="hidden text-xs text-slate-400 sm:inline">{file.uploadedByName}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {voucher.note || voucher.relatedProjects.length ? (
              <section aria-label="Ghi chú và đối tượng liên quan" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                {voucher.note ? (
                  <>
                    <h2 className="mb-1 text-sm font-semibold text-slate-900">Ghi chú</h2>
                    <NoteView voucherId={voucher.id} html={voucher.note} />
                  </>
                ) : null}
                {voucher.relatedProjects.length ? (
                  <>
                    <h2 className="mt-3 mb-1 text-sm font-semibold text-slate-900">Đối tượng liên quan</h2>
                    <ul className="list-inside list-disc text-sm text-slate-700">
                      {voucher.relatedProjects.map((project) => (
                        <li key={project.projectId}>{`${project.projectCode} - ${project.projectName}`}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </section>
            ) : null}
          </div>

          <aside aria-label="Lịch sử xử lý" className="h-fit rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Lịch sử xử lý</h2>
            <ol className="space-y-3">
              {voucher.events.map((event) => (
                <li key={event.id} className="border-l-2 border-emerald-200 pl-3">
                  <div className="text-sm font-medium text-slate-900">{FINANCE_VOUCHER_EVENT_LABELS[event.action]}</div>
                  <div className="text-xs text-slate-500">{event.actorName ?? 'Hệ thống'} · {dateTimeVn(event.createdAt)}</div>
                  {event.note ? <div className="mt-0.5 text-xs text-slate-700">{event.note}</div> : null}
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </div>
    </div>
  );
}
