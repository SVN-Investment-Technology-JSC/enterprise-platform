'use client';

import { toast } from '@enterprise-platform/shared-ui';
import { Download, FileSpreadsheet, Loader2, UploadCloud, X } from 'lucide-react';
import { useState } from 'react';
import * as XLSX from 'xlsx';
import type { BulkStorageLocationItem, BulkStorageLocationsResult } from '@enterprise-platform/contracts-inventory';
import { bulkUpsertStorageLocations } from '../inventory-api';
import { Button } from '../ui/button';

interface ParsedRow {
  readonly materialCode: string;
  readonly warehouseCode: string;
  readonly locationText: string;
  readonly isPrimary: boolean;
  readonly note?: string;
  readonly error?: string;
}

export function StorageLocationBulkImportDialog({
  open,
  onClose,
  onSuccess,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess?: () => void;
}) {
  const [fileName, setFileName] = useState<string>('');
  const [rows, setRows] = useState<readonly ParsedRow[]>([]);
  const [overwritePrimary, setOverwritePrimary] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importResult, setImportResult] = useState<BulkStorageLocationsResult | null>(null);

  if (!open) return null;

  const handleDownloadSample = () => {
    const wsData = [
      ['Mã vật tư (*)', 'Mã kho (*)', 'Vị trí lưu trữ (*)', 'Vị trí chính', 'Ghi chú'],
      ['MAT-001', 'WH-01', 'Khu A / Kệ 03 / Tầng 2', 'Có', 'Gần cửa ra vào'],
      ['MAT-001', 'WH-02', 'Dãy 1 / Ô 10', 'Có', 'Hàng phụ tùng'],
      ['MAT-002', 'WH-01', 'Khu B / Kệ 01', 'Không', 'Vị trí phụ để tạm'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 14 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vi_Tri_Luu_Tru');
    XLSX.writeFile(wb, 'Mau_Nap_Vi_Tri_Luu_Tru.xlsx');
  };

  const handleFileChange = (file: File) => {
    setFileName(file.name);
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) return;
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) return;

        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
        const parsed: ParsedRow[] = raw.map((r) => {
          const mat = String(r['Mã vật tư (*)'] || r['Mã vật tư'] || r['Ma vat tu'] || r['Mã hàng'] || r['MaterialCode'] || '').trim();
          const wh = String(r['Mã kho (*)'] || r['Mã kho'] || r['Ma kho'] || r['WarehouseCode'] || '').trim();
          const loc = String(r['Vị trí lưu trữ (*)'] || r['Vị trí lưu trữ'] || r['Vị trí'] || r['Vi tri'] || r['Location'] || '').trim();
          const primaryStr = String(r['Vị trí chính'] || r['Chính'] || r['IsPrimary'] || '').trim().toLowerCase();
          const isPrimary = primaryStr === 'có' || primaryStr === 'yes' || primaryStr === '1' || primaryStr === 'true';
          const note = String(r['Ghi chú'] || r['Ghi chu'] || r['Note'] || '').trim() || undefined;

          let error: string | undefined;
          if (!mat) error = 'Thiếu mã vật tư';
          else if (!wh) error = 'Thiếu mã kho';
          else if (!loc) error = 'Thiếu vị trí';
          else if (loc.length > 255) error = 'Vị trí quá 255 ký tự';

          return { materialCode: mat, warehouseCode: wh, locationText: loc, isPrimary, note, error };
        });

        setRows(parsed);
      } catch (err: unknown) {
        toast.error('Không thể đọc file Excel: ' + (err instanceof Error ? err.message : 'Lỗi định dạng.'));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const validRows = rows.filter((r) => !r.error);

  const handleExecuteImport = async () => {
    if (validRows.length === 0) {
      toast.error('Không có dòng dữ liệu hợp lệ để nạp.');
      return;
    }
    setLoading(true);
    try {
      const payloadItems: BulkStorageLocationItem[] = validRows.map((r) => ({
        materialCode: r.materialCode,
        warehouseCode: r.warehouseCode,
        locationText: r.locationText,
        isPrimary: r.isPrimary,
        note: r.note,
      }));

      const res = await bulkUpsertStorageLocations({
        items: payloadItems,
        overwritePrimary,
      });
      setImportResult(res);
      if (res.errorCount === 0) {
        toast.success(`Đã nạp thành công ${res.successCount} vị trí lưu trữ.`);
        if (onSuccess) onSuccess();
      } else {
        toast.warning(`Nạp được ${res.successCount} vị trí, ${res.errorCount} dòng gặp lỗi.`);
      }
    } catch (err: unknown) {
      toast.error('Lỗi khi nạp vị trí: ' + (err instanceof Error ? err.message : 'Lỗi hệ thống.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[4px] p-4">
      <div className="flex flex-col w-full max-w-[720px] max-h-[85vh] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-[#f8fafc]">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-blue-600" />
            <div>
              <h3 className="m-0 text-base font-bold text-slate-900">Nạp vị trí lưu trữ hàng loạt từ Excel</h3>
              <p className="m-0 text-xs text-slate-500">
                Khởi tạo hoặc cập nhật vị trí cho nhiều vật tư cùng lúc mà không làm đổi số tồn kho
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Tải mẫu & Drag drop */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
            <div className="text-xs text-slate-600">
              Chưa có file mẫu? Tải file mẫu chuẩn với các cột: <strong>Mã vật tư, Mã kho, Vị trí lưu trữ</strong>.
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadSample}
              className="gap-1.5 text-xs text-blue-700 border-blue-200 hover:bg-blue-50"
            >
              <Download size={14} />
              <span>Tải file mẫu Excel</span>
            </Button>
          </div>

          {/* Khung upload */}
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-lg p-5 cursor-pointer hover:border-blue-500 hover:bg-blue-50/30 transition-colors">
            <UploadCloud size={28} className="text-slate-400 mb-1" />
            <span className="text-sm font-semibold text-slate-700">
              {fileName ? fileName : 'Bấm để chọn file Excel (.xlsx, .xls, .csv)'}
            </span>
            <span className="text-xs text-slate-400 mt-0.5">Dung lượng tối đa 10MB</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileChange(file);
              }}
            />
          </label>

          {/* Tùy chọn */}
          {rows.length > 0 ? (
            <div className="flex items-center gap-2 pt-1 text-xs text-slate-700">
              <input
                type="checkbox"
                id="overwritePrimary"
                checked={overwritePrimary}
                onChange={(e) => setOverwritePrimary(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="overwritePrimary" className="cursor-pointer select-none">
                Cập nhật vị trí chính theo file (nếu vật tư đã có vị trí chính khác ở kho đó)
              </label>
            </div>
          ) : null}

          {/* Bảng xem trước dữ liệu */}
          {rows.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>
                  Đã đọc <strong>{rows.length}</strong> dòng ({validRows.length} hợp lệ, {rows.length - validRows.length} lỗi).
                </span>
                {validRows.length > 50 ? <span className="text-slate-400">Hiển thị trước 50 dòng</span> : null}
              </div>

              <div className="max-h-56 overflow-y-auto rounded border border-slate-200">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-2 w-10 text-center">STT</th>
                      <th className="p-2">Mã VT</th>
                      <th className="p-2">Mã kho</th>
                      <th className="p-2">Vị trí lưu trữ</th>
                      <th className="p-2 text-center">Chính</th>
                      <th className="p-2">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.slice(0, 50).map((r, idx) => (
                      <tr key={idx} className={r.error ? 'bg-red-50/60' : undefined}>
                        <td className="p-2 text-center text-slate-400">{idx + 1}</td>
                        <td className="p-2 font-mono font-medium">{r.materialCode || '—'}</td>
                        <td className="p-2 font-mono">{r.warehouseCode || '—'}</td>
                        <td className="p-2 font-medium">{r.locationText || '—'}</td>
                        <td className="p-2 text-center text-slate-600">{r.isPrimary ? 'Có' : 'Không'}</td>
                        <td className="p-2">
                          {r.error ? (
                            <span className="text-red-600 font-medium">{r.error}</span>
                          ) : (
                            <span className="text-emerald-700 font-medium">Hợp lệ</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Kết quả nạp */}
          {importResult ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2 text-xs">
              <div className="font-semibold text-slate-800">
                Kết quả nạp: {importResult.successCount} thành công, {importResult.errorCount} lỗi.
              </div>
              {importResult.errors.length > 0 ? (
                <div className="max-h-32 overflow-y-auto rounded border border-red-200 bg-red-50/50 p-2 text-red-700 space-y-1">
                  {importResult.errors.map((err, i) => (
                    <div key={i}>
                      [Kho: {err.warehouseCode}, Mã: {err.materialCode}]: {err.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            {importResult && importResult.errorCount === 0 ? 'Đóng' : 'Hủy'}
          </Button>
          {(!importResult || importResult.errorCount > 0) && validRows.length > 0 ? (
            <Button
              type="button"
              onClick={handleExecuteImport}
              disabled={loading}
              className="gap-2 bg-blue-600 font-bold text-white hover:bg-blue-700"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : null}
              <span>Bắt đầu nạp ({validRows.length} dòng)</span>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
