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
import { formatDateTime, formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

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
  stocktakeState?: { session: StocktakeSession; line: StocktakeLine } | 'loading' | 'error';
  unit?: string;
}) {
  const { stocktakeState, unit = '' } = props;

  if (stocktakeState === 'loading') {
    return (
      <div className={styles.stocktakeLoadingBox}>
        <div className={styles.historySpinner} />
        <span>Đang kiểm tra dữ liệu đối soát kỳ kiểm kê gần nhất...</span>
      </div>
    );
  }

  if (stocktakeState === 'error') {
    return (
      <div className={styles.stocktakeErrorBox}>
        <AlertTriangle size={20} color="#dc2626" />
        <span>Không thể truy vấn hồ sơ kiểm kê của vật tư này từ hệ thống.</span>
      </div>
    );
  }

  if (!stocktakeState) {
    return (
      <div className={styles.stocktakeEmptyBox}>
        <ClipboardCheck size={38} strokeWidth={1.5} color="#94a3b8" />
        <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#334155' }}>
          Chưa có kỳ kiểm kê nào ghi nhận cho vật tư này
        </span>
        <span style={{ fontSize: '12px', color: '#64748b', maxWidth: 440, lineHeight: 1.5 }}>
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
    <div className={styles.stocktakePanelContainer}>
      {/* 1. THẺ BANNER KẾT QUẢ ĐỐI SOÁT */}
      <div
        className={styles.stocktakeVerdictBanner}
        style={{ background: statusCfg.bg, borderColor: statusCfg.border }}
      >
        <div className={styles.stocktakeVerdictLeft}>
          <div
            className={styles.stocktakeVerdictIconWrap}
            style={{ color: statusCfg.color, background: '#ffffff' }}
          >
            <StatusIcon size={22} strokeWidth={2.2} />
          </div>
          <div className={styles.stocktakeVerdictText}>
            <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b' }}>
              Kết quả đối soát kiểm kê
            </span>
            <h5 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: statusCfg.color }}>
              {statusCfg.label}
            </h5>
          </div>
        </div>

        <div className={styles.stocktakeVerdictBadgeWrap}>
          <span
            className={styles.stocktakeSessionStatusBadge}
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
      <div className={styles.stocktakeCompareGrid}>
        <div className={styles.stocktakeCompareCard}>
          <span className={styles.stocktakeCompareLabel}>Tồn sổ sách hệ thống</span>
          <div className={styles.stocktakeCompareValue}>
            <strong>{formatNumber(sysQty)}</strong>
            <small>{unit}</small>
          </div>
          <span className={styles.stocktakeCompareHint}>Số lượng tại thời điểm chốt sổ</span>
        </div>

        <div className={styles.stocktakeCompareCard}>
          <span className={styles.stocktakeCompareLabel}>Thực tế kiểm đếm</span>
          <div className={styles.stocktakeCompareValue}>
            <strong>{formatNumber(actQty)}</strong>
            <small>{unit}</small>
          </div>
          <span className={styles.stocktakeCompareHint}>Được thủ kho & tổ kiểm kê xác nhận</span>
        </div>

        <div
          className={`${styles.stocktakeCompareCard} ${
            diff > 0
              ? styles.stocktakeCompareCardSurplus
              : diff < 0
              ? styles.stocktakeCompareCardDeficit
              : ''
          }`}
        >
          <span className={styles.stocktakeCompareLabel}>Chênh lệch (Variance)</span>
          <div className={styles.stocktakeCompareValue}>
            <strong
              style={{
                color: diff > 0 ? '#1d4ed8' : diff < 0 ? '#b91c1c' : '#15803d',
              }}
            >
              {diff > 0 ? `+${formatNumber(diff)}` : formatNumber(diff)}
            </strong>
            <small>{unit}</small>
          </div>
          <span className={styles.stocktakeCompareHint}>
            {diff === 0 ? 'Khớp 100% với hiện vật' : diff > 0 ? 'Phát sinh dôi dư' : 'Hụt so với sổ sách'}
          </span>
        </div>
      </div>

      {/* 3. THÔNG TIN CHI TIẾT ĐỢT KIỂM KÊ */}
      <div className={styles.stocktakeDetailsCard}>
        <div className={styles.stocktakeDetailsHeader}>
          <FileSpreadsheet size={15} color="#2563eb" />
          <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#1e293b' }}>
            Thông tin phiên kiểm kê {session.code}
          </span>
        </div>

        <div className={styles.stocktakeMetaGrid}>
          <div className={styles.stocktakeMetaItem}>
            <span className={styles.stocktakeMetaLabel}>Tiêu đề đợt:</span>
            <span className={styles.stocktakeMetaVal}>
              <strong>{session.title || session.code}</strong>
            </span>
          </div>

          <div className={styles.stocktakeMetaItem}>
            <span className={styles.stocktakeMetaLabel}>
              <WarehouseIcon size={12} /> Kho kiểm kê:
            </span>
            <span className={styles.stocktakeMetaVal}>
              <strong>{session.warehouseName ? `${session.warehouseName} (${session.warehouseCode})` : session.warehouseCode}</strong>
            </span>
          </div>

          <div className={styles.stocktakeMetaItem}>
            <span className={styles.stocktakeMetaLabel}>
              <Calendar size={12} /> Thời điểm chốt số liệu:
            </span>
            <span className={styles.stocktakeMetaVal}>
              {session.snapshotAt ? formatDateTime(session.snapshotAt) : 'Chưa ghi nhận'}
            </span>
          </div>

          <div className={styles.stocktakeMetaItem}>
            <span className={styles.stocktakeMetaLabel}>
              <User size={12} /> Trưởng ban / Tổ kiểm kê:
            </span>
            <span className={styles.stocktakeMetaVal}>
              {session.leadAuditor || 'Tổ kiểm kê định kỳ'}
            </span>
          </div>

          {session.approvedBy ? (
            <div className={styles.stocktakeMetaItem}>
              <span className={styles.stocktakeMetaLabel}>
                <ShieldCheck size={12} /> Người phê duyệt:
              </span>
              <span className={styles.stocktakeMetaVal}>
                {session.approvedBy} {session.approvedAt ? `· ${formatDateTime(session.approvedAt)}` : ''}
              </span>
            </div>
          ) : null}

          <div className={styles.stocktakeMetaItem}>
            <span className={styles.stocktakeMetaLabel}>Vị trí ô kệ kiểm đếm:</span>
            <span className={styles.stocktakeMetaVal}>
              {line.binLocation ? <code>{line.binLocation}</code> : <span>-----</span>}
            </span>
          </div>
        </div>

        {/* Lý do hoặc ghi chú giải trình chênh lệch */}
        {line.reason || line.note ? (
          <div className={styles.stocktakeReasonBox}>
            <span className={styles.stocktakeReasonTitle}>Giải trình của tổ kiểm kê:</span>
            <p className={styles.stocktakeReasonText}>{line.reason || line.note}</p>
          </div>
        ) : null}
      </div>

      {/* 4. CHI TIẾT THEO LÔ HOẶC SÊ-RI TRONG KỲ KIỂM KÊ (NẾU CÓ) */}
      {line.lotAllocations && line.lotAllocations.length > 0 ? (
        <div className={styles.stocktakeAllocationsBox}>
          <h6 className={styles.stocktakeAllocationsTitle}>
            <Layers size={13} color="#2563eb" />
            <span>Phân bổ số lượng theo từng Số Lô (Lot/Batch)</span>
          </h6>
          <div className={styles.stocktakeTableWrap}>
            <table className={styles.stocktakeMiniTable}>
              <thead>
                <tr>
                  <th>Số Lô</th>
                  <th style={{ textAlign: 'right' }}>Sổ sách</th>
                  <th style={{ textAlign: 'right' }}>Thực đếm</th>
                  <th style={{ textAlign: 'right' }}>Chênh lệch</th>
                  <th>Hạn sử dụng</th>
                </tr>
              </thead>
              <tbody>
                {line.lotAllocations.map((lot, idx) => {
                  const lotDiff = lot.actualQty - lot.systemQty;
                  return (
                    <tr key={lot.lotNumber || idx}>
                      <td>
                        <strong>{lot.lotNumber}</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(lot.systemQty)} {unit}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(lot.actualQty)} {unit}</td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontWeight: 700,
                          color: lotDiff > 0 ? '#1d4ed8' : lotDiff < 0 ? '#b91c1c' : '#15803d',
                        }}
                      >
                        {lotDiff > 0 ? `+${formatNumber(lotDiff)}` : formatNumber(lotDiff)}
                      </td>
                      <td>{lot.expiryDate ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
