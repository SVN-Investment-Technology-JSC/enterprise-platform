'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { FinanceLedgerReport, FinanceLedgerReportRow } from '@enterprise-platform/contracts-finance';
import { financeErrorMessage, financeFetch, toQuery } from '../finance-api';
import { buildCsv, downloadCsv } from '../finance-csv';
import { FINANCE_KIND_CONFIG } from '../finance-kinds';
import { dateVn, money } from '../finance-format';
import { Button } from '../ui/button';
import { ErrorBanner } from '../ui/form-parts';

/** Số dòng mỗi lần tải; cuộn gần cuối bảng thì tải thêm một lượt. */
export const LEDGER_PAGE_SIZE = 60;
const ALL_LIMIT = 5000;

const moneyOrBlank = (value: number) => (value ? money(value) : '');

/**
 * Báo cáo thu chi dạng sổ: dòng "Dư đầu kỳ", mỗi chứng từ một dòng với tồn quỹ chạy, dòng cộng phát sinh ở cuối.
 * Bảng chia cột theo phần trăm nên luôn vừa một bề ngang, không cuộn ngang.
 */
export function LedgerReport({ from, to, accountId }: { from: string; to: string; accountId: string }) {
  const [report, setReport] = useState<FinanceLedgerReport | null>(null);
  const [rows, setRows] = useState<FinanceLedgerReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  // Mỗi lần đổi bộ lọc là một "phiên" mới: kết quả của phiên cũ về muộn thì bỏ.
  const session = useRef(0);

  const fetchPage = useCallback(
    (offset: number, limit: number) => financeFetch<FinanceLedgerReport>(`/reports/ledger${toQuery({ from, to, accountId, offset, limit })}`),
    [from, to, accountId],
  );

  const load = useCallback(async () => {
    if (!from || !to) return;
    const mine = ++session.current;
    setLoading(true);
    try {
      const first = await fetchPage(0, LEDGER_PAGE_SIZE);
      if (mine !== session.current) return;
      setReport(first);
      setRows(first.items);
      setError(null);
    } catch (e) {
      if (mine !== session.current) return;
      setError(financeErrorMessage(e, 'Không tải được báo cáo.'));
    } finally {
      if (mine === session.current) setLoading(false);
    }
  }, [from, to, fetchPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = report?.total ?? 0;
  const hasMore = rows.length < total;

  const loadMore = useCallback(
    async (limit: number) => {
      if (!report || loadingMore || rows.length >= report.total) return;
      const mine = session.current;
      setLoadingMore(true);
      try {
        const next = await fetchPage(rows.length, limit);
        if (mine !== session.current) return;
        setRows((current) => (current.length === next.offset ? [...current, ...next.items] : current));
      } catch (e) {
        setError(financeErrorMessage(e, 'Không tải thêm được dòng báo cáo.'));
      } finally {
        setLoadingMore(false);
      }
    },
    [report, loadingMore, rows.length, fetchPage],
  );

  // Kéo gần cuối bảng thì tải thêm (trình duyệt không có IntersectionObserver thì dùng nút "Hiện tất cả").
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore(LEDGER_PAGE_SIZE);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  async function exportCsv() {
    if (!report) return;
    try {
      const all = rows.length >= report.total ? rows : (await fetchPage(0, ALL_LIMIT)).items;
      downloadCsv(
        `bao-cao-thu-chi-${report.from}-${report.to}`,
        buildCsv([
          [`Báo cáo thu chi từ ${dateVn(report.from)} đến ${dateVn(report.to)}`],
          ['STT', 'Nội dung', 'Mã chứng từ', 'Người tạo', 'Ngày tạo', 'Ngày hạch toán', 'Tài khoản', 'Phát sinh thu', 'Phát sinh chi', 'Tồn quỹ'],
          ['', 'Dư đầu kỳ', '', '', '', '', '', '', '', report.openingBalance],
          ...all.map((r, index) => [index + 1, r.content, r.voucherCode, r.createdByName ?? '', dateVn(r.createdAt), dateVn(r.postedDate), r.accountName, r.receipt, r.payment, r.balanceAfter]),
          ['', 'Cộng phát sinh', '', '', '', '', '', report.totalReceipts, report.totalPayments, report.closingBalance],
        ]),
      );
    } catch (e) {
      setError(financeErrorMessage(e, 'Không xuất được báo cáo.'));
    }
  }

  return (
    <section aria-label="Báo cáo thu chi dạng sổ" className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900">
          Báo cáo thu chi từ {dateVn(from)} đến {dateVn(to)}
        </h2>
        <Button type="button" variant="outline" disabled={!report} onClick={() => void exportCsv()}>
          <Download aria-hidden /> Export
        </Button>
      </div>

      <div className="px-4 pt-3">
        <ErrorBanner message={error} />
      </div>
      {loading && !report ? <div role="status" className="p-6 text-sm text-slate-500">Đang tải báo cáo…</div> : null}

      {report ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
            <table className="w-full table-fixed text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="w-[4%] px-2 py-2 text-center font-medium">STT</th>
                  <th className="w-[19%] px-2 font-medium">Nội dung</th>
                  <th className="w-[11%] px-2 font-medium">Mã chứng từ</th>
                  <th className="w-[9%] px-2 font-medium">Người tạo</th>
                  <th className="w-[8%] px-2 font-medium">Ngày tạo</th>
                  <th className="w-[9%] px-2 font-medium">Ngày hạch toán</th>
                  <th className="w-[12%] px-2 font-medium">Tài khoản</th>
                  <th className="w-[9%] px-2 text-right font-medium">Phát sinh thu</th>
                  <th className="w-[9%] px-2 text-right font-medium">Phát sinh chi</th>
                  <th className="w-[10%] px-2 text-right font-medium">Tồn quỹ</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100 bg-slate-50/60 font-medium">
                  <td className="px-2 py-1.5" />
                  <td className="px-2">Dư đầu kỳ</td>
                  <td colSpan={6} />
                  <td className="px-2" />
                  <td className="px-2 text-right tabular-nums">{money(report.openingBalance)}</td>
                </tr>
                {rows.map((row, index) => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-2 py-1.5 text-center text-slate-500">{index + 1}</td>
                    <td className="truncate px-2" title={row.content}>
                      {row.isReversal ? 'Huỷ: ' : ''}
                      {row.content}
                    </td>
                    <td className="truncate px-2">
                      <a href={`${FINANCE_KIND_CONFIG[row.voucherKind].path}/${row.voucherId}`} className="font-medium text-link hover:underline">
                        {row.voucherCode}
                      </a>
                    </td>
                    <td className="truncate px-2" title={row.createdByName ?? ''}>{row.createdByName}</td>
                    <td className="px-2">{dateVn(row.createdAt)}</td>
                    <td className="px-2">{dateVn(row.postedDate)}</td>
                    <td className="truncate px-2" title={row.accountName}>{row.accountName}</td>
                    <td className="px-2 text-right tabular-nums text-emerald-700">{moneyOrBlank(row.receipt)}</td>
                    <td className="px-2 text-right tabular-nums text-red-600">{moneyOrBlank(row.payment)}</td>
                    <td className="px-2 text-right tabular-nums">{money(row.balanceAfter)}</td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={10} className="px-2 py-6 text-center text-slate-500">Không có phát sinh trong kỳ.</td>
                  </tr>
                ) : null}
              </tbody>
              {!hasMore ? (
                <tfoot>
                  <tr className="border-t border-slate-200 font-semibold">
                    <td className="px-2 py-2" />
                    <td className="px-2">Cộng phát sinh</td>
                    <td colSpan={5} />
                    <td className="px-2 text-right tabular-nums text-emerald-700">{money(report.totalReceipts)}</td>
                    <td className="px-2 text-right tabular-nums text-red-600">{money(report.totalPayments)}</td>
                    <td className="px-2 text-right tabular-nums">{money(report.closingBalance)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
            <div ref={sentinel} aria-hidden className="h-1" />
          </div>

          {hasMore ? (
            <div role="status" className="flex flex-wrap items-center justify-center gap-2 border-t border-slate-100 px-4 py-2 text-sm text-slate-600">
              <span>
                Đang hiện {rows.length}/{total} dòng, kéo xuống để tải thêm
              </span>
              <span aria-hidden>-</span>
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore(Math.min(total - rows.length, ALL_LIMIT))}
                className="font-medium text-link hover:underline disabled:opacity-50"
              >
                Hiện tất cả
              </button>
            </div>
          ) : (
            <div className="border-t border-slate-100 px-4 py-2 text-center text-xs text-slate-500">Đã hiện tất cả {total} dòng.</div>
          )}
        </>
      ) : null}
    </section>
  );
}
