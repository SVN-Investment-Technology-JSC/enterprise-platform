'use client';
import { useRef, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import type { ImportHrmLeaveResult, ImportHrmLeaveRow } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { downloadXlsx } from '../hrm-xlsx';
import { Button } from './button';
import { errorText, Notice } from './comp-off/comp-off-kit';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';
import { toast } from './toast';

export interface ParsedLeaveImportRow {
  readonly lineNo: number;
  readonly employeeCode: string;
  readonly year: number;
  readonly days: number;
  readonly reason: string;
  readonly error?: string;
}

function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && String(row[k]).trim() !== '') return row[k];
  }
  return '';
}

/** Đọc và kiểm tra các dòng Excel của file import phép năm; tách riêng để kiểm thử. */
export function parseLeaveImportRows(
  raw: readonly Record<string, unknown>[],
  defaultYear: number,
): ParsedLeaveImportRow[] {
  return raw.map((rec, idx) => {
    const employeeCode = String(pick(rec, ['Mã nhân viên', 'Ma nhan vien', 'Mã NV', 'employeeCode'])).trim();
    const rawYear = String(pick(rec, ['Năm', 'Nam', 'year'])).trim();
    const year = rawYear ? Number(rawYear) : defaultYear;
    const days = Number(String(pick(rec, ['Số ngày điều chỉnh (+/-)', 'Số ngày', 'days'])).replace(',', '.'));
    const reason = String(pick(rec, ['Lý do', 'Ly do', 'reason'])).trim();

    let error: string | undefined;
    if (!employeeCode) error = 'Thiếu mã nhân viên';
    else if (!Number.isInteger(year) || year < 2000 || year > 2200) error = 'Năm không hợp lệ';
    else if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 366) error = 'Số ngày phải khác 0 và không quá 366';
    else if (!reason) error = 'Thiếu lý do';
    return { lineNo: idx + 2, employeeCode, year, days, reason, error };
  });
}

/** Dialog import điều chỉnh quỹ phép năm hàng loạt từ file Excel; mỗi dòng được ghi vào "Lịch sử điều chỉnh". */
export function LeaveImportDialog({
  year,
  onClose,
  onDone,
}: {
  /** Năm mặc định cho dòng không ghi năm: năm đang xem trên màn hình. */
  year: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<ParsedLeaveImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    downloadXlsx(
      'Mau_Import_Quy_Phep_Nam.xlsx',
      [
        ['Mã nhân viên', 'Họ tên (tham khảo)', 'Năm', 'Số ngày điều chỉnh (+/-)', 'Lý do'],
        ['NV001', 'Nguyễn Văn A', year, 2, 'Nhập số dư phép đầu kỳ'],
        ['NV002', 'Trần Thị B', year, -0.5, 'Điều chỉnh giảm theo đối soát'],
      ],
      'QuyPhepNam',
    );
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const first = wb.SheetNames[0];
      const ws = first ? wb.Sheets[first] : undefined;
      if (!ws) {
        setError('Tệp Excel không có trang tính hợp lệ.');
        setRows([]);
        return;
      }
      setRows(parseLeaveImportRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' }), year));
    } catch {
      setError('Không đọc được tệp Excel. Vui lòng kiểm tra định dạng .xlsx/.xls/.csv.');
      setRows([]);
    }
  }

  const validRows = rows.filter((r) => !r.error);

  async function submit() {
    if (validRows.length === 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      const payload: ImportHrmLeaveRow[] = validRows.map((r) => ({
        employeeCode: r.employeeCode,
        days: r.days,
        reason: r.reason,
        year: r.year,
      }));
      const res = (
        await hrmFetch<{ data: ImportHrmLeaveResult }>('/leave-adjustments/import', {
          method: 'POST',
          body: JSON.stringify({ rows: payload, fileName }),
        })
      ).data;
      if (res.skipped.length > 0) {
        toast.warning(
          `Đã import ${res.applied} dòng, bỏ qua ${res.skipped.length} dòng lỗi (${res.skipped[0].employeeCode}: ${res.skipped[0].reason}).`,
        );
      } else {
        toast.success(`Đã import thành công ${res.applied} dòng điều chỉnh quỹ phép năm.`);
      }
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e, 'Không import được quỹ phép năm'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden bg-white p-0 sm:max-w-[680px]">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-5 py-4 pr-12">
          <DialogTitle>Import quỹ phép năm từ Excel</DialogTitle>
          <DialogDescription>
            Mỗi dòng là một lần điều chỉnh: số dương cộng ngày phép, số âm trừ. Kết quả được ghi vào Lịch sử điều chỉnh kèm tài khoản thực hiện.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <span className="text-xs text-slate-600">
              Dùng đúng cột của file mẫu: mã nhân viên, năm (bỏ trống là năm {year}), số ngày, lý do.
            </span>
            <Button type="button" size="sm" variant="outline" onClick={downloadTemplate}>
              Tải file mẫu
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              aria-label="Tệp Excel"
              className="sr-only"
              onChange={(e) => void handleFile(e)}
            />
            <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              {fileName ? 'Chọn tệp khác' : 'Chọn tệp Excel'}
            </Button>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
              {fileName || 'Chưa chọn tệp (.xlsx, .xls hoặc .csv)'}
            </span>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {rows.length > 0 ? (
            <div className="max-h-60 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2.5 py-2 font-semibold">Dòng</th>
                    <th className="px-2.5 py-2 font-semibold">Mã NV</th>
                    <th className="px-2.5 py-2 font-semibold">Năm</th>
                    <th className="px-2.5 py-2 font-semibold">Số ngày</th>
                    <th className="px-2.5 py-2 font-semibold">Lý do</th>
                    <th className="px-2.5 py-2 font-semibold">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice(0, 100).map((r) => (
                    <tr key={r.lineNo} className={r.error ? 'bg-rose-50/60' : ''}>
                      <td className="px-2.5 py-1.5">{r.lineNo}</td>
                      <td className="px-2.5 py-1.5 font-medium">{r.employeeCode || '—'}</td>
                      <td className="px-2.5 py-1.5">{Number.isFinite(r.year) ? r.year : '—'}</td>
                      <td className="px-2.5 py-1.5">{Number.isFinite(r.days) ? r.days : '—'}</td>
                      <td className="px-2.5 py-1.5">{r.reason || '—'}</td>
                      <td className="px-2.5 py-1.5">
                        {r.error ? <span className="text-rose-700">{r.error}</span> : <span className="text-emerald-700">Hợp lệ</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {rows.length > 100 ? <p className="text-xs text-slate-500">Chỉ hiện 100 dòng đầu; toàn bộ dòng hợp lệ vẫn được import.</p> : null}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
          <span className="text-xs text-slate-500">{rows.length > 0 ? `${validRows.length}/${rows.length} dòng hợp lệ` : ''}</span>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Đóng
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={busy || validRows.length === 0}>
              {busy ? 'Đang import…' : `Xác nhận import (${validRows.length})`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
