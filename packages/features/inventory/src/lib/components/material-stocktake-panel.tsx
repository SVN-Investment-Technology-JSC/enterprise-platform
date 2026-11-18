'use client';

import type { StocktakeLine, StocktakeSession } from '@enterprise-platform/contracts-inventory';
import {
  ClipboardCheck,
  Calendar,
  User,
  Warehouse as WarehouseIcon,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Layers,
  FileSpreadsheet,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { formatDate } from '@enterprise-platform/shared-ui';
import { formatDateTime, formatNumber } from '../inventory-labels';
import { cn } from '../ui/cn';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui';

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; color: string; border: string; icon: typeof CheckCircle2 }
> = {
  MATCHED: {
    label: 'Khớp sổ sách (Không chênh lệch)',
    bg: '#f0fdf4',
    color: '#15803d',
    border: '#bbf7d0',
    icon: CheckCircle2,
  },
  SURPLUS: {
    label: 'Thừa thực tế (Tồn kho thực tế > Sổ sách)',
    bg: '#eff6ff',
    color: '#1d4ed8',
    border: '#bfdbfe',
    icon: TrendingUp,
  },
  DEFICIT: {
    label: 'Thiếu thực tế (Hụt kho / Cần cân kho)',
    bg: '#fef2f2',
    color: '#b91c1c',
    border: '#fecaca',
    icon: TrendingDown,
  },
  UNCOUNTED: {
    label: 'Chưa kiểm đếm',
    bg: '#f8fafc',
    color: '#64748b',
    border: '#cbd5e1',
    icon: Clock,
  },
};

const SESSION_STATUS_LABEL: Record<string, { label: string; bg: string; color: string; border: string }> = {
  DRAFT: { label: 'Bản nháp', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
  COUNTING: { label: 'Đang kiểm đếm', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  PENDING_APPROVAL: { label: 'Chờ phê duyệt', bg: '#fefce8', color: '#854d0e', border: '#fef08a' },
  APPROVED: { label: 'Đã duyệt kết quả', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' },
  POSTED: { label: 'Đã cân kho / Ghi sổ', bg: '#f0fdf4', color: '#15803d', border: '#86efac' },
  CANCELLED: { label: 'Đã hủy đợt', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
};

export function MaterialStocktakePanel(props: {
  stocktakeState?: { session: StocktakeSession; line: StocktakeLine } | 'loading' | 'error' | 'none';
  unit?: string;
}) {
  const { stocktakeState, unit = '' } = props;

  if (stocktakeState === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center gap-[0.65rem] rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
        <div className="size-6 animate-spin rounded-full border-[2.5px] border-slate-200 border-t-blue-600" />
        <span>Đang kiểm tra dữ liệu đối soát kỳ kiểm kê gần nhất...</span>
      </div>
    );
  }

  if (stocktakeState === 'error') {
    return (
      <div className="flex flex-col items-center justify-center gap-[0.65rem] rounded-lg border border-dashed border-red-200 bg-red-50 px-6 py-10 text-center text-sm font-medium text-red-700">
        <AlertTriangle size={20} color="#dc2626" />
        <span>Không thể truy vấn hồ sơ kiểm kê của vật tư này từ hệ thống.</span>
      </div>
    );
  }

  if (!stocktakeState || stocktakeState === 'none') {
    return (
      <div className="flex flex-col items-center justify-center gap-[0.65rem] rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
        <ClipboardCheck size={38} strokeWidth={1.5} color="#94a3b8" />
        <span className="text-sm font-bold text-slate-700">
          Chưa có kỳ kiểm kê nào ghi nhận cho vật tư này
        </span>
        <span className="max-w-[440px] text-[13px] leading-normal text-slate-500">
          Vật tư chưa được đưa vào danh mục kiểm đếm trong bất kỳ đợt kiểm kê kho nào gần đây. Kết quả và chênh lệch đối soát sẽ hiển thị tại đây sau khi hoàn tất kiểm kê.
        </span>
      </div>
    );
  }

  const { session, line } = stocktakeState;
  const statusCfg = STATUS_CONFIG[line.status] ?? STATUS_CONFIG['UNCOUNTED'];
  const StatusIcon = statusCfg.icon;
  const sessionStatus = SESSION_STATUS_LABEL[session.status] ?? {
    label: session.status,
    bg: '#f1f5f9',
    color: '#475569',
    border: '#cbd5e1',
  };

  const sysQty = line.systemQuantity ?? 0;
  const actQty = line.actualQuantity ?? sysQty;
  const diff = line.difference ?? (actQty - sysQty);

  return (
    <div className="flex w-full flex-col gap-[0.95rem]">
      {/* 1. THẺ BANNER KẾT QUẢ ĐỐI SOÁT */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-[1.1rem] py-[0.85rem]"
        style={{ background: statusCfg.bg, borderColor: statusCfg.border }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex size-[38px] items-center justify-center rounded-lg shadow-sm"
            style={{ color: statusCfg.color, background: '#ffffff' }}
          >
            <StatusIcon size={22} strokeWidth={2.2} />
          </div>
          <div className="flex flex-col gap-[0.15rem]">
            <span className="text-xs font-bold uppercase text-slate-500">
              Kết quả đối soát kiểm kê
            </span>
            <h5 className="m-0 text-sm font-extrabold" style={{ color: statusCfg.color }}>
              {statusCfg.label}
            </h5>
          </div>
        </div>

        <div className="flex items-center">
          <span
            className="inline-flex items-center rounded-full border border-transparent px-[9px] py-[3px] text-xs font-bold"
            style={{
              background: sessionStatus.bg,
              color: sessionStatus.color,
              borderColor: sessionStatus.border,
            }}
          >
            {sessionStatus.label}
          </span>
        </div>
      </div>

      {/* 2. BẢNG 3 CHỈ SỐ SO SÁNH SỐ LƯỢNG (METRICS) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-[0.35rem] rounded-lg border border-slate-200 bg-white px-4 py-[0.85rem] shadow-xs">
          <span className="text-xs font-semibold uppercase tracking-[0.02em] text-slate-500">Tồn sổ sách hệ thống</span>
          <div className="flex items-baseline gap-[0.35rem]">
            <strong className="text-xl font-extrabold tabular-nums text-slate-900">{formatNumber(sysQty)}</strong>
            <small className="text-[13px] font-semibold text-slate-500">{unit}</small>
          </div>
          <span className="text-xs leading-[1.35] text-slate-400">Số lượng tại thời điểm chốt sổ</span>
        </div>

        <div className="flex flex-col gap-[0.35rem] rounded-lg border border-slate-200 bg-white px-4 py-[0.85rem] shadow-xs">
          <span className="text-xs font-semibold uppercase tracking-[0.02em] text-slate-500">Thực tế kiểm đếm</span>
          <div className="flex items-baseline gap-[0.35rem]">
            <strong className="text-xl font-extrabold tabular-nums text-slate-900">{formatNumber(actQty)}</strong>
            <small className="text-[13px] font-semibold text-slate-500">{unit}</small>
          </div>
          <span className="text-xs leading-[1.35] text-slate-400">Được thủ kho & tổ kiểm kê xác nhận</span>
        </div>

        <div
          className={cn(
            'flex flex-col gap-[0.35rem] rounded-lg border border-slate-200 bg-white px-4 py-[0.85rem] shadow-xs',
            diff > 0 && 'border-blue-200 bg-blue-50',
            diff < 0 && 'border-red-200 bg-red-50',
          )}
        >
          <span className="text-xs font-semibold uppercase tracking-[0.02em] text-slate-500">Chênh lệch (Variance)</span>
          <div className="flex items-baseline gap-[0.35rem]">
            <strong
              className="text-xl font-extrabold tabular-nums"
              style={{
                color: diff > 0 ? '#1d4ed8' : diff < 0 ? '#b91c1c' : '#15803d',
              }}
            >
              {diff > 0 ? `+${formatNumber(diff)}` : formatNumber(diff)}
            </strong>
            <small className="text-[13px] font-semibold text-slate-500">{unit}</small>
          </div>
          <span className="text-xs leading-[1.35] text-slate-400">
            {diff === 0 ? 'Khớp 100% với hiện vật' : diff > 0 ? 'Phát sinh dôi dư' : 'Hụt so với sổ sách'}
          </span>
        </div>
      </div>

      {/* 3. THÔNG TIN CHI TIẾT ĐỢT KIỂM KÊ */}
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 px-[1.2rem] py-4">
        <div className="flex items-center gap-2 border-b border-slate-200 pb-[0.6rem]">
          <FileSpreadsheet size={15} color="#2563eb" />
          <span className="text-[13px] font-bold text-slate-800">
            Thông tin phiên kiểm kê {session.code}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-x-5 gap-y-[0.65rem] sm:grid-cols-2">
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="inline-flex items-center gap-[0.3rem] font-medium text-slate-500">Tiêu đề đợt:</span>
            <span className="break-words text-right text-slate-800 [&_code]:rounded [&_code]:border [&_code]:border-slate-300 [&_code]:bg-white [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-xs [&_code]:text-blue-600 [&_strong]:text-slate-900">
              <strong>{session.title || session.code}</strong>
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="inline-flex items-center gap-[0.3rem] font-medium text-slate-500">
              <WarehouseIcon size={12} /> Kho kiểm kê:
            </span>
            <span className="break-words text-right text-slate-800 [&_code]:rounded [&_code]:border [&_code]:border-slate-300 [&_code]:bg-white [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-xs [&_code]:text-blue-600 [&_strong]:text-slate-900">
              <strong>{session.warehouseName ? `${session.warehouseName} (${session.warehouseCode})` : session.warehouseCode}</strong>
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="inline-flex items-center gap-[0.3rem] font-medium text-slate-500">
              <Calendar size={12} /> Thời điểm chốt số liệu:
            </span>
            <span className="break-words text-right text-slate-800 [&_code]:rounded [&_code]:border [&_code]:border-slate-300 [&_code]:bg-white [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-xs [&_code]:text-blue-600 [&_strong]:text-slate-900">
              {session.snapshotAt ? formatDateTime(session.snapshotAt) : 'Chưa ghi nhận'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="inline-flex items-center gap-[0.3rem] font-medium text-slate-500">
              <User size={12} /> Trưởng ban / Tổ kiểm kê:
            </span>
            <span className="break-words text-right text-slate-800 [&_code]:rounded [&_code]:border [&_code]:border-slate-300 [&_code]:bg-white [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-xs [&_code]:text-blue-600 [&_strong]:text-slate-900">
              {session.leadAuditor || 'Tổ kiểm kê định kỳ'}
            </span>
          </div>

          {session.approvedBy ? (
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="inline-flex items-center gap-[0.3rem] font-medium text-slate-500">
                <ShieldCheck size={12} /> Người phê duyệt:
              </span>
              <span className="break-words text-right text-slate-800 [&_code]:rounded [&_code]:border [&_code]:border-slate-300 [&_code]:bg-white [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-xs [&_code]:text-blue-600 [&_strong]:text-slate-900">
                {session.approvedBy} {session.approvedAt ? `· ${formatDateTime(session.approvedAt)}` : ''}
              </span>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="inline-flex items-center gap-[0.3rem] font-medium text-slate-500">Vị trí ô kệ kiểm đếm:</span>
            <span className="break-words text-right text-slate-800 [&_code]:rounded [&_code]:border [&_code]:border-slate-300 [&_code]:bg-white [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-xs [&_code]:text-blue-600 [&_strong]:text-slate-900">
              {line.binLocation ? <code>{line.binLocation}</code> : <span>-----</span>}
            </span>
          </div>
        </div>

        {/* Lý do hoặc ghi chú giải trình chênh lệch */}
        {line.reason || line.note ? (
          <div className="mt-1 flex flex-col gap-1 rounded border border-l-[3px] border-slate-200 border-l-amber-500 bg-white px-[0.85rem] py-[0.6rem]">
            <span className="text-xs font-bold uppercase text-amber-700">Giải trình của tổ kiểm kê:</span>
            <p className="m-0 text-[13px] leading-[1.45] text-slate-700">{line.reason || line.note}</p>
          </div>
        ) : null}
      </div>

      {/* 4. CHI TIẾT THEO LÔ HOẶC SÊ-RI TRONG KỲ KIỂM KÊ (NẾU CÓ) */}
      {line.lotAllocations && line.lotAllocations.length > 0 ? (
        <div className="flex flex-col gap-[0.55rem]">
          <h6 className="m-0 flex items-center gap-[0.4rem] text-[13px] font-bold text-slate-800">
            <Layers size={13} color="#2563eb" />
            <span>Phân bổ số lượng theo từng Số Lô (Lot/Batch)</span>
          </h6>
          <TableWrap className="overflow-x-auto rounded-md border border-slate-200 bg-white">
            <Table className="text-[13px]">
              <TableHead>
                <tr>
                  <TableHeaderCell className="px-[10px] py-[6px]">Số Lô</TableHeaderCell>
                  <TableHeaderCell className="px-[10px] py-[6px] text-right">Sổ sách</TableHeaderCell>
                  <TableHeaderCell className="px-[10px] py-[6px] text-right">Thực đếm</TableHeaderCell>
                  <TableHeaderCell className="px-[10px] py-[6px] text-right">Chênh lệch</TableHeaderCell>
                  <TableHeaderCell className="px-[10px] py-[6px]">Hạn sử dụng</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {line.lotAllocations.map((lot, idx) => {
                  const lotDiff = lot.actualQty - lot.systemQty;
                  return (
                    <TableRow key={lot.lotNumber || idx} className="last:border-b-0">
                      <TableCell className="px-[10px] py-[6px]">
                        <strong>{lot.lotNumber}</strong>
                      </TableCell>
                      <TableCell className="px-[10px] py-[6px] text-right">{formatNumber(lot.systemQty)} {unit}</TableCell>
                      <TableCell className="px-[10px] py-[6px] text-right">{formatNumber(lot.actualQty)} {unit}</TableCell>
                      <TableCell
                        className={cn(
                          'px-[10px] py-[6px] text-right font-bold',
                          lotDiff > 0 ? 'text-blue-700' : lotDiff < 0 ? 'text-red-700' : 'text-green-700',
                        )}
                      >
                        {lotDiff > 0 ? `+${formatNumber(lotDiff)}` : formatNumber(lotDiff)}
                      </TableCell>
                      <TableCell className="px-[10px] py-[6px]">{formatDate(lot.expiryDate, '—')}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableWrap>
        </div>
      ) : null}
    </div>
  );
}
