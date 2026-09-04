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
} from 'lucide-react';
import type { ProcedureRequisition } from '../inventory-api';
import { generateRequisitionCsvContent } from '../inventory-api';
import { formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

export function MaterialRequisitionsCard({
  requisitions,
  loading = false,
  onOpenIssueFromRequisition,
}: {
  requisitions: readonly ProcedureRequisition[];
  loading?: boolean;
  onOpenIssueFromRequisition: (req: ProcedureRequisition, lineIndex?: number) => void;
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
            const isPurchase = req.kind === 'purchase';
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
                        background: isPurchase ? '#fef3c7' : '#e0f2fe',
                        color: isPurchase ? '#92400e' : '#0369a1',
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
                      </div>
                    </div>
                  </div>

                  {/* Hành động nhanh */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Nút tải file CSV */}
                    <button
                      type="button"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '5px 10px',
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

                    {/* Nút Tạo phiếu xuất / Mua sắm */}
                    <button
                      type="button"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '5px 12px',
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
                      title={`Xuất toàn bộ ${req.lines.length} vật tư theo bảng kê`}
                    >
                      <ArrowUpRight size={13} />
                      <span>
                        {isPurchase
                          ? 'Lập phiếu mua sắm'
                          : req.lines.length > 1
                            ? `Xuất kho theo bảng kê (${req.lines.length} vật tư)`
                            : 'Xuất kho theo bảng kê'}
                      </span>
                    </button>

                    <button
                      type="button"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#64748b',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      onClick={() => setExpandedId(isExpanded ? null : req.code)}
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {/* Bảng chi tiết từng dòng vật tư khi mở rộng */}
                {isExpanded ? (
                  <div
                    style={{
                      padding: '12px 14px',
                      background: '#f8fafc',
                      borderTop: '1px solid #e2e8f0',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#475569',
                        marginBottom: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>Danh mục vật tư trong bảng kê ({req.lines.length} mục):</span>
                      <a
                        href={`/modules/procedure#workspace`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: '#2563eb',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        Xem hồ sơ gốc <ExternalLink size={12} />
                      </a>
                    </div>

                    {req.lines.length === 0 ? (
                      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                        Chi tiết từng dòng vật tư được đính kèm trực tiếp trong tệp{' '}
                        <strong>{req.csvFileName}</strong>. Bấm nút <em>&quot;Tải bảng kê CSV&quot;</em> hoặc{' '}
                        <em>&quot;Xuất kho theo bảng kê&quot;</em> để xem đầy đủ.
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
                              Số lượng
                            </th>
                            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>ĐVT</th>
                            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>
                              Thao tác
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {req.lines.map((line, idx) => (
                            <tr key={`${line.materialCode}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '6px 10px', fontWeight: 600, color: '#2563eb' }}>
                                {line.materialCode}
                              </td>
                              <td style={{ padding: '6px 10px', color: '#1e293b' }}>
                                {line.materialName || '—'}
                              </td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                                {formatNumber(line.quantity)}
                              </td>
                              <td style={{ padding: '6px 10px', color: '#64748b' }}>
                                {line.unit || '—'}
                              </td>
                              <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: '#2563eb',
                                    fontWeight: 600,
                                    fontSize: '11.5px',
                                    cursor: 'pointer',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                  }}
                                  onClick={() => onOpenIssueFromRequisition(req, idx)}
                                >
                                  Xuất món này →
                                </button>
                              </td>
                            </tr>
                          ))}
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
