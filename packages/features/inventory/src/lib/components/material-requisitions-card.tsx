'use client';

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
import { formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

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
    <section className={styles.card} style={{ borderLeft: '4px solid #2563eb' }}>
      <div className={styles.cardHead}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              padding: '8px',
              borderRadius: '8px',
              background: '#eff6ff',
              color: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FileSpreadsheet size={20} strokeWidth={2.2} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '15.5px', fontWeight: 700, color: '#0f172a' }}>
              Nhu cầu cấp phát vật tư từ Quy trình (Bảng kê CSV)
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#64748b' }}>
              Quy trình con &amp; lệnh bảo trì tự động kết xuất bảng kê CSV để thủ kho chủ động lập phiếu xuất/giữ chỗ.
            </p>
          </div>
        </div>

        <span
          style={{
            padding: '3px 10px',
            borderRadius: '999px',
            fontSize: '12px',
            fontWeight: 700,
            background: requisitions.length > 0 ? '#dbeafe' : '#f1f5f9',
            color: requisitions.length > 0 ? '#1d4ed8' : '#64748b',
          }}
        >
          {loading ? 'Đang cập nhật…' : `${requisitions.length} yêu cầu`}
        </span>
      </div>

      {loading ? (
        <p style={{ padding: '16px', color: '#64748b', fontSize: '13px', margin: 0 }}>
          Đang quét dữ liệu bảng kê từ Quy trình…
        </p>
      ) : requisitions.length === 0 ? (
        <div
          style={{
            padding: '24px 16px',
            textAlign: 'center',
            background: '#f8fafc',
            borderRadius: '8px',
            border: '1px dashed #cbd5e1',
            margin: '8px 0 4px',
          }}
        >
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            Hiện chưa có hồ sơ quy trình nào gửi yêu cầu vật tư hoặc bảng kê CSV chờ xử lý.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
          {requisitions.map((req) => {
            const isExpanded = expandedId === req.code;
            const totalItems = req.lines.reduce((acc, l) => acc + l.quantity, 0);

            return (
              <div
                key={req.code}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  background: '#ffffff',
                  overflow: 'hidden',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Dòng tóm tắt của yêu cầu */}
                <div
                  style={{
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    background: isExpanded ? '#f8fafc' : '#ffffff',
                    cursor: 'pointer',
                  }}
                  onClick={() => setExpandedId(isExpanded ? null : req.code)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        background: '#eff6ff',
                        color: '#1d4ed8',
                        border: '1px solid #bfdbfe',
                      }}
                    >
                      {req.code}
                    </span>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: '13px',
                          color: '#1e293b',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        <span>{req.title}</span>
                        {req.assetCode ? (
                          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
                            (Thiết bị: {req.assetCode})
                          </span>
                        ) : null}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11.5px', color: '#64748b', marginTop: '3px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Boxes size={13} /> {req.lines.length} dòng vật tư (tổng {formatNumber(totalItems)})
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <FileSpreadsheet size={13} /> {req.csvFileName}
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={13} /> {new Date(req.startedAt).toLocaleDateString('vi-VN')}
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
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginLeft: '6px' }}>
                              {singleCount > 0 ? (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    padding: '1px 6px',
                                    borderRadius: '10px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    background: '#ecfdf5',
                                    color: '#047857',
                                    border: '1px solid #a7f3d0',
                                  }}
                                  title={`${singleCount}/${req.lines.length} vật tư có sẵn tại 1 kho`}
                                >
                                  ● {singleCount} sẵn sàng
                                </span>
                              ) : null}
                              {transferCount > 0 ? (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    padding: '1px 6px',
                                    borderRadius: '10px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    background: '#fffbeb',
                                    color: '#b45309',
                                    border: '1px solid #fde68a',
                                  }}
                                  title={`${transferCount}/${req.lines.length} vật tư đủ nếu gom/chuyển kho`}
                                >
                                  ▲ {transferCount} cần gom kho
                                </span>
                              ) : null}
                              {shortageCount > 0 ? (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    padding: '1px 6px',
                                    borderRadius: '10px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    background: '#fef2f2',
                                    color: '#b91c1c',
                                    border: '1px solid #fecaca',
                                  }}
                                  title={`${shortageCount}/${req.lines.length} vật tư thiếu toàn bộ các kho`}
                                >
                                  ✕ {shortageCount} thiếu hàng
                                </span>
                              ) : null}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Nút mũi tên mở rộng / đóng */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#334155',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onClick={() => setExpandedId(isExpanded ? null : req.code)}
                    >
                      <span>{isExpanded ? 'Đóng chi tiết' : 'Xem chi tiết'}</span>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>

                {/* Bảng chi tiết từng dòng vật tư khi mở rộng (Bấm onclick xem chi tiết mới hiện các nút tác vụ) */}
                {isExpanded ? (
                  <div
                    style={{
                      padding: '14px 16px',
                      background: '#f8fafc',
                      borderTop: '1px solid #e2e8f0',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                    }}
                  >
                    {/* Thanh công cụ tác vụ: Chỉ xuất hiện khi mở xem chi tiết */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '10px',
                        paddingBottom: '10px',
                        borderBottom: '1px solid #e2e8f0',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155' }}>
                          Danh sách {req.lines.length} hạng mục vật tư chi tiết:
                        </span>
                        <a
                          href={`/modules/procedure#workspace`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            color: '#2563eb',
                            textDecoration: 'none',
                            fontSize: '12px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            marginLeft: '8px',
                          }}
                        >
                          Xem hồ sơ gốc <ExternalLink size={12} />
                        </a>
                      </div>

                      {/* Cụm nút tác vụ: Tải CSV, Kiểm tra tồn kho, Xuất toàn bộ */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#334155',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          onClick={() => handleDownloadCsv(req)}
                          title={`Tải xuống tệp ${req.csvFileName}`}
                        >
                          <Download size={13} />
                          <span>Tải bảng kê CSV</span>
                        </button>

                        {onCheckStock && req.lines.length > 0 ? (
                          <button
                            type="button"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              color: '#0f172a',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                            onClick={() => onCheckStock(req.lines[0]?.materialCode || '')}
                            title="Kiểm tra mức độ tồn kho và khả dụng của các vật tư trong bảng kê"
                          >
                            <PackageCheck size={13} style={{ color: '#059669' }} />
                            <span>Kiểm tra tồn kho</span>
                          </button>
                        ) : null}

                        <button
                          type="button"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 14px',
                            borderRadius: '6px',
                            border: '1px solid #2563eb',
                            background: '#2563eb',
                            color: '#ffffff',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            boxShadow: '0 1px 2px rgba(37,99,235,0.2)',
                            transition: 'all 0.15s ease',
                          }}
                          onClick={() => onOpenIssueFromRequisition(req)}
                          title={`Xử lý cấp phát toàn bộ ${req.lines.length} vật tư theo bảng kê`}
                        >
                          <ArrowUpRight size={14} />
                          <span>
                            {req.lines.length > 1
                              ? `Xử lý phiếu yêu cầu (${req.lines.length} vật tư)`
                              : 'Xử lý phiếu yêu cầu'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {req.lines.length === 0 ? (
                      <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
                        Chưa có dòng vật tư chi tiết. Bấm "Xử lý phiếu yêu cầu" để nạp trực tiếp vào phiếu.
                      </p>
                    ) : (
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: '12px',
                          background: '#ffffff',
                          borderRadius: '6px',
                          overflow: 'hidden',
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        <thead>
                          <tr style={{ background: '#f1f5f9', color: '#475569', textAlign: 'left' }}>
                            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Mã vật tư</th>
                            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Tên vật tư</th>
                            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
                              Cần xuất
                            </th>
                            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
                              Khả dụng trong kho
                            </th>
                            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>ĐVT</th>
                            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>
                              Thao tác
                            </th>
                          </tr>
                        </thead>
                        <tbody>
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
                              <tr key={`${line.materialCode}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '8px 10px', fontWeight: 600, color: '#2563eb' }}>
                                  {line.materialCode}
                                </td>
                                <td style={{ padding: '8px 10px', color: '#1e293b' }}>
                                  {line.materialName || '—'}
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                                  {formatNumber(line.quantity)}
                                </td>
                                <td
                                  style={{
                                    padding: '8px 10px',
                                    textAlign: 'right',
                                  }}
                                  title={breakdownTooltip}
                                >
                                  {stockTier === 'single_ready' ? (
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '2px 8px',
                                        borderRadius: '12px',
                                        fontSize: '11.5px',
                                        fontWeight: 600,
                                        background: '#ecfdf5',
                                        color: '#047857',
                                        border: '1px solid #a7f3d0',
                                        cursor: 'help',
                                      }}
                                    >
                                      ● {formatNumber(totalAvail)} (Sẵn sàng 1 kho)
                                    </span>
                                  ) : stockTier === 'transfer_needed' ? (
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '2px 8px',
                                        borderRadius: '12px',
                                        fontSize: '11.5px',
                                        fontWeight: 600,
                                        background: '#fffbeb',
                                        color: '#b45309',
                                        border: '1px solid #fde68a',
                                        cursor: 'help',
                                      }}
                                    >
                                      ▲ {formatNumber(totalAvail)} (Đủ nếu gom kho)
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '2px 8px',
                                        borderRadius: '12px',
                                        fontSize: '11.5px',
                                        fontWeight: 600,
                                        background: '#fef2f2',
                                        color: '#b91c1c',
                                        border: '1px solid #fecaca',
                                        cursor: 'help',
                                      }}
                                    >
                                      ✕ {formatNumber(totalAvail)} (Thiếu toàn kho)
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '8px 10px', color: '#64748b' }}>
                                  {line.unit || '—'}
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    {onCheckStock ? (
                                      <button
                                        type="button"
                                        style={{
                                          border: '1px solid #e2e8f0',
                                          background: '#f8fafc',
                                          color: '#475569',
                                          fontWeight: 600,
                                          fontSize: '11px',
                                          cursor: 'pointer',
                                          padding: '3px 8px',
                                          borderRadius: '4px',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '3px',
                                        }}
                                        onClick={() => onCheckStock(line.materialCode)}
                                        title={`Kiểm tra vị trí và lượng tồn kho của ${line.materialCode}`}
                                      >
                                        <Eye size={11} />
                                        Soi kho
                                      </button>
                                    ) : null}

                                    {/* Nút Tạo phiếu Chuyển kho khi trạng thái là Vàng (Đủ nếu gom kho) */}
                                    {stockTier === 'transfer_needed' && onOpenTransfer ? (
                                      <button
                                        type="button"
                                        style={{
                                          border: '1px solid #fcd34d',
                                          background: '#fffbeb',
                                          color: '#b45309',
                                          fontWeight: 600,
                                          fontSize: '11px',
                                          cursor: 'pointer',
                                          padding: '3px 8px',
                                          borderRadius: '4px',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '3px',
                                        }}
                                        onClick={() => onOpenTransfer(line.materialCode)}
                                        title={`Tạo phiếu điều chuyển nội bộ để gom mã ${line.materialCode} về một kho trước khi xuất`}
                                      >
                                        <ArrowLeftRight size={11} />
                                        Chuyển kho ⇄
                                      </button>
                                    ) : null}

                                    <button
                                      type="button"
                                      style={{
                                        border: 'none',
                                        background: 'transparent',
                                        color:
                                          stockTier === 'single_ready'
                                            ? '#16a34a'
                                            : stockTier === 'transfer_needed'
                                              ? '#d97706'
                                              : '#2563eb',
                                        fontWeight: 600,
                                        fontSize: '11.5px',
                                        cursor: 'pointer',
                                        padding: '3px 6px',
                                        borderRadius: '4px',
                                      }}
                                      onClick={() => onOpenIssueFromRequisition(req, idx)}
                                    >
                                      {stockTier === 'single_ready'
                                        ? 'Xuất kho món này →'
                                        : stockTier === 'transfer_needed'
                                          ? 'Tách kho xuất →'
                                          : 'Đề xuất mua sắm →'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
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
