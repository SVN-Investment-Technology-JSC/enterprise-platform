'use client';
import { useRef, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import type { ImportHrmCompOffRow } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../../hrm-comp-off-api';
import { downloadXlsx } from '../../hrm-xlsx';
import { Button } from '../button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { toast } from '../toast';
import { errorText, Notice } from './comp-off-kit';

interface ParsedRow {
  readonly lineNo: number;
  readonly employeeCode: string;
  readonly fullName: string;
  readonly days: number;
  readonly expiresOn: string | null;
  readonly reason: string;
  readonly error?: string;
}

function normalizeExpiry(raw: unknown): string | null | undefined {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return undefined;
}

function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && String(row[k]).trim() !== '') return row[k];
  }
  return '';
}

/** Dialog import điều chỉnh / nhập số dư quỹ nghỉ bù hàng loạt từ file Excel. */
export function CompOffImportDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    downloadXlsx(
      'Mau_Import_Quy_Nghi_Bu.xlsx',
      [
        ['Mã nhân viên', 'Họ tên (tham khảo)', 'Số ngày điều chỉnh (+/-)', 'Hạn sử dụng (dd/mm/yyyy)', 'Lý do'],
        ['NV001', 'Nguyễn Văn A', 2, '31/12/2026', 'Nhập số dư đầu kỳ quỹ nghỉ bù'],
        ['NV002', 'Trần Thị B', -0.5, '', 'Điều chỉnh giảm quỹ nghỉ bù'],
      ],
      'QuyNghiBu',
    );
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const first = wb.SheetNames[0];
      const ws = first ? wb.Sheets[first] : undefined;
      if (!ws) {
        setError('Tệp Excel không có trang tính hợp lệ.');
        setRows([]);
        return;
      }
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      const parsed: ParsedRow[] = raw.map((rec, idx) => {
        const employeeCode = String(
          pick(rec, ['Mã nhân viên', 'Ma nhan vien', 'Mã NV', 'employeeCode']),
        ).trim();
        const fullName = String(pick(rec, ['Họ tên (tham khảo)', 'Họ tên', 'fullName'])).trim();
        const rawDays = pick(rec, ['Số ngày điều chỉnh (+/-)', 'Số ngày', 'days']);
        const days = Number(String(rawDays).replace(',', '.'));
        const expiresOn = normalizeExpiry(
          pick(rec, ['Hạn sử dụng (dd/mm/yyyy)', 'Hạn sử dụng', 'expiresOn']),
        );
        const reason = String(pick(rec, ['Lý do', 'Ly do', 'reason'])).trim();

        let rowErr: string | undefined;
        if (!employeeCode) rowErr = 'Thiếu mã nhân viên';
        else if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 365) {
          rowErr = 'Số ngày phải khác 0 và không quá 365';
        } else if (expiresOn === undefined) {
          rowErr = 'Hạn sử dụng phải dạng dd/mm/yyyy hoặc YYYY-MM-DD';
        } else if (!reason) {
          rowErr = 'Thiếu lý do';
        }

        return {
          lineNo: idx + 2,
          employeeCode,
          fullName,
          days,
          expiresOn: expiresOn ?? null,
          reason,
          error: rowErr,
        };
      });
      setRows(parsed);
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
      const payload: ImportHrmCompOffRow[] = validRows.map((r) => ({
        employeeCode: r.employeeCode,
        days: r.days,
        expiresOn: r.expiresOn,
        reason: r.reason,
      }));
      const res = await compOffApi.importAdjustments({ rows: payload, fileName });
      if (res.skipped.length > 0) {
        toast.warning(
          `Đã import ${res.applied} dòng, bỏ qua ${res.skipped.length} dòng lỗi (${res.skipped[0].employeeCode}: ${res.skipped[0].reason}).`,
        );
      } else {
        toast.success(`Đã import thành công ${res.applied} dòng điều chỉnh quỹ nghỉ bù.`);
      }
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e, 'Không import được quỹ nghỉ bù'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden bg-white p-0 sm:max-w-[680px]">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-5 py-4 pr-12">
          <DialogTitle>Import quỹ nghỉ bù từ Excel</DialogTitle>
          <DialogDescription>
            Mỗi dòng là một lần điều chỉnh: số dương mở lô mới, số âm trừ vào các lô gần hết hạn trước.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <span className="text-xs text-slate-600">Dùng đúng cột của file mẫu: mã nhân viên, số ngày, hạn sử dụng, lý do.</span>
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
