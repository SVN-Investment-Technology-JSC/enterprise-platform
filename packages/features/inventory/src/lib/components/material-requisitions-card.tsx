'use client';
import { useInventoryPermissions } from '../inventory-permissions';

import { useState } from 'react';
import {
  FileSpreadsheet,
  Download,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Boxes,
  Clock,
  ExternalLink,
  Eye,
  PackageCheck,
  ArrowLeftRight,
} from 'lucide-react';
import type { InventoryWorkspace, ProcedureRequisition } from '../inventory-api';
import { generateRequisitionCsvContent } from '../inventory-api';
import { formatDate } from '@enterprise-platform/shared-ui';
import { formatNumber } from '../inventory-labels';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/table';

export function MaterialRequisitionsCard({
  requisitions,
  loading = false,
  availableByCode,
  workspace,
  onOpenIssueFromRequisition,
  onOpenTransfer,
  onCheckStock,
}: {
  requisitions: readonly ProcedureRequisition[];
  loading?: boolean;
  availableByCode?: ReadonlyMap<string, number>;
  workspace?: InventoryWorkspace;
  onOpenIssueFromRequisition: (req: ProcedureRequisition, lineIndex?: number) => void;
  onOpenTransfer?: (materialCode: string) => void;
  onCheckStock?: (materialCode: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { canWriteTransactions } = useInventoryPermissions();

  const handleDownloadCsv = (req: ProcedureRequisition) => {
    if (req.downloadUrl) {
      window.open(req.downloadUrl, '_blank');
      return;
    }
    // Fallback nếu không có downloadUrl từ S3: tự tạo file CSV blob từ lines
    const csvContent = generateRequisitionCsvContent(req);
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', req.csvFileName || `bang-ke-vat-tu-${req.code}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-[clamp(1rem,2vw,1.5rem)] py-[1.2rem] shadow-sm border-l-4 border-l-blue-600">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className="p-2 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"
          >
            <FileSpreadsheet size={20} strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="m-0 text-[16px] font-bold text-slate-900">
              Nhu cầu cấp phát vật tư từ Quy trình (Bảng kê CSV)
            </h2>
            <p className="mt-0.5 mx-0 mb-0 text-[13px] text-slate-500">
              Quy trình con &amp; lệnh bảo trì tự động kết xuất bảng kê CSV để thủ kho chủ động lập phiếu xuất/giữ chỗ.
            </p>
          </div>
        </div>

        <Badge
          variant="secondary"
          className={cn(
            'h-auto px-2.5 py-[3px] text-[13px] font-bold',
            requisitions.length > 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500',
          )}
        >
          {loading ? 'Đang cập nhật…' : `${requisitions.length} yêu cầu`}
        </Badge>
      </div>

      {loading ? (
        <p className="p-4 text-slate-500 text-[14px] m-0">
          Đang quét dữ liệu bảng kê từ Quy trình…
        </p>
      ) : requisitions.length === 0 ? (
        <div
          className="py-6 px-4 text-center bg-slate-50 rounded-lg border border-dashed border-slate-300 mt-2 mx-0 mb-1"
        >
          <p className="m-0 text-[14px] text-slate-500">
            Hiện chưa có hồ sơ quy trình nào gửi yêu cầu vật tư hoặc bảng kê CSV chờ xử lý.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 mt-2.5">
          {requisitions.map((req) => {
            const isExpanded = expandedId === req.code;
            const totalItems = req.lines.reduce((acc, l) => acc + l.quantity, 0);

            return (
              <div
                key={req.code}
                className="border border-slate-200 rounded-lg bg-white overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all duration-150"
              >
                {/* Dòng tóm tắt của yêu cầu */}
                <div
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 px-3.5 py-3',
                    isExpanded ? 'bg-slate-50' : 'bg-white',
                  )}
                  onClick={() => setExpandedId(isExpanded ? null : req.code)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span
                      className="py-[3px] px-2 rounded-md text-[12px] font-bold font-mono bg-blue-50 text-blue-700 border border-blue-200"
                    >
                      {req.code}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div
                        className="font-semibold text-[14px] text-slate-800 flex items-center gap-1.5 whitespace-nowrap overflow-hidden text-ellipsis"
                      >
                        <span>{req.title}</span>
                        {req.assetCode ? (
                          <span className="text-[12px] text-slate-500 font-medium">
                            (Thiết bị: {req.assetCode})
                          </span>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-3 text-[12px] text-slate-500 mt-[3px]">
                        <span className="inline-flex items-center gap-1">
                          <Boxes size={13} /> {req.lines.length} dòng vật tư (tổng {formatNumber(totalItems)})
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <FileSpreadsheet size={13} /> {req.csvFileName}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock size={13} /> {formatDate(req.startedAt)}
                        </span>
                        {/* Huy hiệu tóm tắt 3 màu cấp độ tồn kho của toàn phiếu */}
                        {(() => {
                          if (req.lines.length === 0) return null;
                          let singleCount = 0;
                          let transferCount = 0;
                          let shortageCount = 0;
                          for (const line of req.lines) {
                            const stocks = workspace?.stock?.filter((s) => s.materialCode === line.materialCode) || [];
                            const totalAvail = stocks.length > 0
                              ? stocks.reduce((sum, s) => sum + s.available, 0)
                              : (availableByCode?.get(line.materialCode) ?? 0);
                            const hasSingle = stocks.some((s) => s.available >= line.quantity);
                            if (totalAvail >= line.quantity) {
                              if (hasSingle) singleCount++;
                              else transferCount++;
                            } else {
                              shortageCount++;
                            }
                          }
                          return (
                            <div className="inline-flex items-center gap-[5px] ml-1.5">
                              {singleCount > 0 ? (
                                <Badge variant="outline"
                                  className="h-auto gap-[3px] py-[1px] px-1.5 text-[12px] font-semibold bg-emerald-50 text-emerald-700 border-emerald-200"
                                  title={`${singleCount}/${req.lines.length} vật tư có sẵn tại 1 kho`}
                                >
                                  ● {singleCount} sẵn sàng
                                </Badge>
                              ) : null}
                              {transferCount > 0 ? (
                                <Badge variant="outline"
                                  className="h-auto gap-[3px] py-[1px] px-1.5 text-[12px] font-semibold bg-amber-50 text-amber-700 border-amber-200"
                                  title={`${transferCount}/${req.lines.length} vật tư đủ nếu gom/chuyển kho`}
                                >
                                  ▲ {transferCount} cần gom kho
                                </Badge>
                              ) : null}
                              {shortageCount > 0 ? (
                                <Badge variant="outline"
                                  className="h-auto gap-[3px] py-[1px] px-1.5 text-[12px] font-semibold bg-red-50 text-red-700 border-red-200"
                                  title={`${shortageCount}/${req.lines.length} vật tư thiếu toàn bộ các kho`}
                                >
                                  ✕ {shortageCount} thiếu hàng
                                </Badge>
                              ) : null}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Nút mũi tên mở rộng / đóng */}
                  <div
                    className="flex items-center gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
 type="button"
 variant="outline"
 size="sm"
 className="h-8 gap-[5px] px-3 text-[13px] font-semibold"
                      onClick={() => setExpandedId(isExpanded ? null : req.code)}
                    >
                      <span>{isExpanded ? 'Đóng chi tiết' : 'Xem chi tiết'}</span>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </Button>
                  </div>
                </div>

                {/* Bảng chi tiết từng dòng vật tư khi mở rộng (Bấm onclick xem chi tiết mới hiện các nút tác vụ) */}
                {isExpanded ? (
                  <div
                    className="py-3.5 px-4 bg-slate-50 border-t border-t-slate-200 flex flex-col gap-3"
                  >
                    {/* Thanh công cụ tác vụ: Chỉ xuất hiện khi mở xem chi tiết */}
                    <div
                      className="flex items-center justify-between flex-wrap gap-2.5 pb-2.5 border-b border-b-slate-200"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-slate-700">
                          Danh sách {req.lines.length} hạng mục vật tư chi tiết:
                        </span>
                        <a
                          href={`/modules/procedure#workspace`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 no-underline text-[13px] inline-flex items-center gap-1 ml-2"
                        >
                          Xem hồ sơ gốc <ExternalLink size={12} />
                        </a>
                      </div>

                      {/* Cụm nút tác vụ: Tải CSV, Kiểm tra tồn kho, Xuất toàn bộ */}
                      <div className="flex items-center gap-2">
                        <Button
 type="button"
 variant="outline"
 size="sm"
 className="h-8 gap-[5px] px-3 text-[13px] font-semibold"
                          onClick={() => handleDownloadCsv(req)}
                          title={`Tải xuống tệp ${req.csvFileName}`}
                        >
                          <Download size={13} />
                          <span>Tải bảng kê CSV</span>
                        </Button>

                        {onCheckStock && req.lines.length > 0 ? (
                          <Button
 type="button"
 variant="outline"
 size="sm"
 className="h-8 gap-[5px] px-3 text-[13px] font-semibold"
                            onClick={() => onCheckStock(req.lines[0]?.materialCode || '')}
                            title="Kiểm tra mức độ tồn kho và khả dụng của các vật tư trong bảng kê"
                          >
                            <PackageCheck size={13} className="text-emerald-600" />
                            <span>Kiểm tra tồn kho</span>
                          </Button>
                        ) : null}

                        <Button
                          type="button"
                          size="sm"
                          className="h-8 gap-1.5 px-3.5 text-[13px] font-semibold"
                          onClick={() => onOpenIssueFromRequisition(req)}
                          disabled={!canWriteTransactions}
                          title={`Xử lý cấp phát toàn bộ ${req.lines.length} vật tư theo bảng kê`}
                        >
                          <ArrowUpRight size={14} />
                          <span>
                            {req.lines.length > 1
                              ? `Xử lý phiếu yêu cầu (${req.lines.length} vật tư)`
                              : 'Xử lý phiếu yêu cầu'}
                          </span>
                        </Button>
                      </div>
                    </div>

                    {req.lines.length === 0 ? (
                      <p className="m-0 text-[13px] text-slate-400 italic">
                        Chưa có dòng vật tư chi tiết. Bấm "Xử lý phiếu yêu cầu" để nạp trực tiếp vào phiếu.
                      </p>
                    ) : (
                      <Table
                        className="w-full border-collapse text-[13px] bg-white rounded-md overflow-hidden border border-slate-200"
                      >
                        <TableHead>
                          <TableRow className="bg-slate-100 text-left text-slate-600 hover:bg-slate-100">
                            <TableHeaderCell className="py-1.5 px-2.5 border-b border-b-slate-200">Mã vật tư</TableHeaderCell>
                            <TableHeaderCell className="py-1.5 px-2.5 border-b border-b-slate-200">Tên vật tư</TableHeaderCell>
                            <TableHeaderCell className="py-1.5 px-2.5 border-b border-b-slate-200 text-right">
                              Cần xuất
                            </TableHeaderCell>
                            <TableHeaderCell className="py-1.5 px-2.5 border-b border-b-slate-200 text-right">
                              Khả dụng trong kho
                            </TableHeaderCell>
                            <TableHeaderCell className="py-1.5 px-2.5 border-b border-b-slate-200">ĐVT</TableHeaderCell>
                            <TableHeaderCell className="py-1.5 px-2.5 border-b border-b-slate-200 text-center">
                              Thao tác
                            </TableHeaderCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {req.lines.map((line, idx) => {
                            // Bóc tách tồn kho chi tiết trên từng kho
                            const matchingStocks = workspace?.stock?.filter(
                              (s) => s.materialCode === line.materialCode,
                            ) || [];

                            // Tồn khả dụng từng kho
                            const warehouseBreakdown = matchingStocks.map((s) => {
                              const wh = workspace?.warehouses?.find((w) => w.code === s.warehouseCode);
                              return {
                                warehouseCode: s.warehouseCode || 'Kho',
                                warehouseName: wh?.name || s.warehouseCode || 'Kho',
                                available: s.available,
                                quantity: s.quantity,
                              };
                            });

                            // Tổng khả dụng gộp cả 3 kho
                            const totalAvail =
                              matchingStocks.length > 0
                                ? matchingStocks.reduce((sum, s) => sum + s.available, 0)
                                : (availableByCode?.get(line.materialCode) ?? 0);

                            // Có ít nhất 1 kho đơn lẻ có tồn >= số lượng yêu cầu không?
                            const singleWhSufficient = matchingStocks.some(
                              (s) => s.available >= line.quantity,
                            );

                            // Phân loại 3 mức trạng thái:
                            // 1. 'single_ready': Đủ xuất ngay tại 1 kho đơn lẻ (Xanh lá)
                            // 2. 'transfer_needed': Đủ nếu gộp các kho (Vàng cam - cần chuyển kho hoặc tách kho)
                            // 3. 'shortage': Toàn hệ thống thiếu hàng (Đỏ)
                            let stockTier: 'single_ready' | 'transfer_needed' | 'shortage' = 'shortage';
                            if (totalAvail >= line.quantity) {
                              stockTier = singleWhSufficient ? 'single_ready' : 'transfer_needed';
                            } else {
                              stockTier = 'shortage';
                            }

                            // Tooltip hiển thị tồn từng kho khi hover
                            const breakdownTooltip =
                              warehouseBreakdown.length > 0
                                ? warehouseBreakdown
                                    .map(
                                      (w) =>
                                        `• ${w.warehouseName} (${w.warehouseCode}): khả dụng ${formatNumber(w.available)} / tồn ${formatNumber(w.quantity)}`,
                                    )
                                    .join('\n')
                                : `Tổng khả dụng: ${formatNumber(totalAvail)}`;

                            return (
                              <TableRow key={`${line.materialCode}-${idx}`} className="border-b border-b-slate-100">
                                <TableCell className="py-2 px-2.5 font-semibold text-blue-600">
                                  {line.materialCode}
                                </TableCell>
                                <TableCell className="py-2 px-2.5 text-slate-800">
                                  {line.materialName || '—'}
                                </TableCell>
                                <TableCell className="py-2 px-2.5 text-right font-bold text-slate-900">
                                  {formatNumber(line.quantity)}
                                </TableCell>
                                <TableCell
                                  className="py-2 px-2.5 text-right"
                                  title={breakdownTooltip}
                                >
                                  {stockTier === 'single_ready' ? (
                                    <Badge variant="outline"
                                      className="h-auto gap-1 py-0.5 px-2 text-[12px] font-semibold bg-emerald-50 text-emerald-700 border-emerald-200 cursor-help"
                                    >
                                      ● {formatNumber(totalAvail)} (Sẵn sàng 1 kho)
                                    </Badge>
                                  ) : stockTier === 'transfer_needed' ? (
                                    <Badge variant="outline"
                                      className="h-auto gap-1 py-0.5 px-2 text-[12px] font-semibold bg-amber-50 text-amber-700 border-amber-200 cursor-help"
                                    >
                                      ▲ {formatNumber(totalAvail)} (Đủ nếu gom kho)
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline"
                                      className="h-auto gap-1 py-0.5 px-2 text-[12px] font-semibold bg-red-50 text-red-700 border-red-200 cursor-help"
                                    >
                                      ✕ {formatNumber(totalAvail)} (Thiếu toàn kho)
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="py-2 px-2.5 text-slate-500">
                                  {line.unit || '—'}
                                </TableCell>
                                <TableCell className="py-2 px-2.5 text-center">
                                  <div className="inline-flex items-center gap-1.5">
                                    {onCheckStock ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="xs"
                                        className="gap-[3px] bg-slate-50 text-[12px] font-semibold text-slate-600"
                                        onClick={() => onCheckStock(line.materialCode)}
                                        title={`Kiểm tra vị trí và lượng tồn kho của ${line.materialCode}`}
                                      >
                                        <Eye size={11} />
                                        Soi kho
                                      </Button>
                                    ) : null}

                                    {/* Nút Tạo phiếu Chuyển kho khi trạng thái là Vàng (Đủ nếu gom kho) */}
                                    {stockTier === 'transfer_needed' && onOpenTransfer && canWriteTransactions ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="xs"
                                        className="gap-[3px] border-amber-300 bg-amber-50 text-[12px] font-semibold text-amber-700 hover:bg-amber-100"
                                        onClick={() => onOpenTransfer(line.materialCode)}
                                        title={`Tạo phiếu điều chuyển nội bộ để gom mã ${line.materialCode} về một kho trước khi xuất`}
                                      >
                                        <ArrowLeftRight size={11} />
                                        Chuyển kho ⇄
                                      </Button>
                                    ) : null}

                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="xs"
                                      className={cn(
                                        'px-1.5 text-[12px] font-semibold',
                                        stockTier === 'single_ready'
                                          ? 'text-green-600'
                                          : stockTier === 'transfer_needed'
                                            ? 'text-amber-600'
                                            : 'text-blue-600',
                                      )}
                                      onClick={() => onOpenIssueFromRequisition(req, idx)}
                                      disabled={!canWriteTransactions}
                                    >
                                      {stockTier === 'single_ready'
                                        ? 'Xuất kho món này →'
                                        : stockTier === 'transfer_needed'
                                          ? 'Tách kho xuất →'
                                          : 'Đề xuất mua sắm →'}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
