'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Check, Pencil, Send, Trash2, Undo2, X } from 'lucide-react';
import { Popconfirm, toast } from '@enterprise-platform/shared-ui';
import {
  FINANCE_VOUCHER_EVENT_LABELS,
  type FinanceVoucher,
  type FinanceVoucherKind,
} from '@enterprise-platform/contracts-finance';
import { financeDelete, financeErrorMessage, financeFetch, financePost } from '../finance-api';
import { useFinanceCrumbs } from '../finance-crumbs';
import { dateTimeVn, dateVn, money } from '../finance-format';
import { FINANCE_KIND_CONFIG } from '../finance-kinds';
import { Button } from '../ui/button';
import { EmptyState, ErrorBanner, StatusBadge } from '../ui/form-parts';

function Info({ label, children }: { label: string; children: ReactNode }) {
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

  async function remove() {
    setBusy(true);
    try {
      await financeDelete(`/vouchers/${id}`);
      toast.success('Đã xoá phiếu nháp');
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
  const isTransfer = kind === 'TRANSFER';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-slate-900">{voucher.code}</h1>
          <StatusBadge status={voucher.status} />
          {voucher.posted && voucher.status === 'APPROVED' ? <span className="text-xs text-emerald-700">Đã ghi sổ tài khoản</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            <Popconfirm title="Duyệt và ghi sổ phiếu này?" description="Tiền sẽ được ghi vào sổ tài khoản ngay khi duyệt." okType="primary" okText="Duyệt" onConfirm={() => act('approve', {}, 'Đã duyệt và ghi sổ')}>
              <Button type="button" disabled={busy}><Check aria-hidden /> Duyệt</Button>
            </Popconfirm>
          ) : null}
          {can.canReject ? (
            <Popconfirm title="Từ chối phiếu" reasonRequired reasonLabel="Lý do từ chối" reasonPlaceholder="Nhập lý do để người lập chỉnh sửa" okText="Từ chối" onConfirm={(reason) => act('reject', { note: reason }, 'Đã từ chối phiếu')}>
              <Button type="button" variant="destructive" disabled={busy}><X aria-hidden /> Từ chối</Button>
            </Popconfirm>
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
            <Popconfirm title="Xoá phiếu nháp?" description="Phiếu nháp bị xoá hẳn và không khôi phục được." okText="Xoá" onConfirm={remove}>
              <Button type="button" variant="ghost" disabled={busy}><Trash2 aria-hidden /> Xoá</Button>
            </Popconfirm>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
        <ErrorBanner message={error} />
        <div className="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            <section aria-label="Thông tin chung" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Thông tin chung</h2>
              <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
                <Info label={config.dateLabel}>{dateVn(voucher.voucherDate)}</Info>
                <Info label="Ngày hạch toán">{dateVn(voucher.postingDate)}</Info>
                <Info label="Số tiền"><span className="font-semibold tabular-nums">{money(voucher.totalAmount)}</span></Info>
                <div className="sm:col-span-3"><Info label={config.contentLabel}>{voucher.content}</Info></div>
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
                    <Info label={config.personLabel}>{voucher.counterpartyName}</Info>
                    <Info label={config.personAccountLabel}>{voucher.counterpartyAccountNo}</Info>
                    <Info label={config.personBankLabel}>{voucher.counterpartyBank}</Info>
                    <Info label="Hạch toán nội bộ">{voucher.costCenterName}</Info>
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

            {voucher.note || voucher.related.length ? (
              <section aria-label="Ghi chú và đối tượng liên quan" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                {voucher.note ? (
                  <>
                    <h2 className="mb-1 text-sm font-semibold text-slate-900">Ghi chú</h2>
                    <p className="whitespace-pre-line text-sm text-slate-700">{voucher.note}</p>
                  </>
                ) : null}
                {voucher.related.length ? (
                  <>
                    <h2 className="mt-3 mb-1 text-sm font-semibold text-slate-900">Đối tượng liên quan</h2>
                    <ul className="list-inside list-disc text-sm text-slate-700">
                      {voucher.related.map((related) => (
                        <li key={related.id}>{related.label}</li>
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
