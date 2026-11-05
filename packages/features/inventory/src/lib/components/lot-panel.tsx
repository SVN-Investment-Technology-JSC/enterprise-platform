'use client';
import { useInventoryPermissions } from '../inventory-permissions';

import {
  QUALITY_STATUSES,
  type Lot,
  type QualityStatus,
  type Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { Table, type TableColumnsType } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Layers, ShieldCheck, X } from 'lucide-react';
import { SearchableSelect, formatDate } from '@enterprise-platform/shared-ui';
import { changeLotQuality, loadLots } from '../inventory-api';
import { QUALITY_STATUS_BADGE, QUALITY_STATUS_LABEL, formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

const QUALITY_OPTIONS = QUALITY_STATUSES.map((status) => ({
  value: status,
  label: QUALITY_STATUS_LABEL[status],
}));

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Lô của một mặt hàng, đọc từ server (T1-18). Lô sinh ra khi nhập kho có khai lô
 * và cộng trừ theo phiếu xuất, chuyển; ở đây chỉ xem tồn từng kho và đổi trạng
 * thái chất lượng (cần quyền `inventory.quality.write`, bắt buộc ghi lý do).
 */
export function LotPanel({
  materialCode,
  materialName,
  unit,
  busy,
}: {
  materialCode: string;
  materialName?: string;
  unit?: string;
  /** Giữ cho nơi gọi cũ; tồn theo kho nay lấy từ chính lô. */
  warehouses?: readonly Warehouse[];
  busy?: boolean;
}) {
  const { canWriteQuality } = useInventoryPermissions();
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<Lot>();
  const [nextStatus, setNextStatus] = useState<QualityStatus>('PASSED');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setLots(await loadLots(materialCode));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Không tải được danh sách lô.');
    } finally {
      setLoading(false);
    }
  }, [materialCode]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openQualityDialog = (lot: Lot) => {
    setEditing(lot);
    setNextStatus(lot.qualityStatus === 'PASSED' ? 'QUARANTINE' : 'PASSED');
    setReason('');
    setSaveError(undefined);
  };

  const saveQuality = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || !reason.trim()) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await changeLotQuality(editing.id, { qualityStatus: nextStatus, reason: reason.trim() });
      setEditing(undefined);
      await reload();
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'Không đổi được trạng thái chất lượng.');
    } finally {
      setSaving(false);
    }
  };

  const today = todayIso();
  const columns: TableColumnsType<Lot> = [
    {
      title: 'Số lô',
      dataIndex: 'lotNo',
      key: 'lotNo',
      render: (value: string) => <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{value}</strong>,
    },
    {
      title: 'Hạn dùng',
      dataIndex: 'expiresOn',
      key: 'expiresOn',
      sorter: (left, right) => (left.expiresOn ?? '9999-12-31').localeCompare(right.expiresOn ?? '9999-12-31'),
      render: (value: string | undefined) =>
        value ? (
          <span style={{ color: value < today ? '#b91c1c' : undefined, fontWeight: value < today ? 600 : undefined }}>
            {formatDate(value)}
            {value < today ? ' (hết hạn)' : ''}
          </span>
        ) : (
          'Không thời hạn'
        ),
    },
    {
      title: 'Ngày sản xuất',
      dataIndex: 'manufacturedOn',
      key: 'manufacturedOn',
      render: (value: string | undefined) => formatDate(value, '—'),
    },
    {
      title: 'Chất lượng',
      dataIndex: 'qualityStatus',
      key: 'qualityStatus',
      render: (value: QualityStatus) => {
        const badge = QUALITY_STATUS_BADGE[value];
        return (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 600,
              background: badge.bg,
              color: badge.text,
              border: `1px solid ${badge.border}`,
            }}
          >
            {QUALITY_STATUS_LABEL[value]}
          </span>
        );
      },
    },
    {
      title: `Tồn theo kho${unit ? ` (${unit})` : ''}`,
      key: 'balances',
      render: (_: unknown, lot: Lot) =>
        lot.balances.filter((balance) => balance.quantity > 0).length === 0 ? (
          <span style={{ color: '#64748b' }}>Đã xuất hết</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {lot.balances
              .filter((balance) => balance.quantity > 0)
              .map((balance) => (
                <span key={balance.warehouseId}>
                  {balance.warehouseCode}: <strong>{formatNumber(balance.quantity)}</strong>
                  {balance.available !== balance.quantity ? ` (khả dụng ${formatNumber(balance.available)})` : ''}
                </span>
              ))}
          </div>
        ),
    },
    {
      title: 'Nhà cung cấp, CO/CQ',
      key: 'supplier',
      render: (_: unknown, lot: Lot) => [lot.supplier, lot.certificateNo].filter(Boolean).join(' · ') || '—',
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      render: (_: unknown, lot: Lot) =>
        canWriteQuality ? (
          <button
            type="button"
            className={styles.btnSecondary}
            disabled={busy}
            onClick={() => openQualityDialog(lot)}
          >
            Đổi chất lượng
          </button>
        ) : null,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div
        style={{
          padding: '12px 16px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={16} color="#2563eb" />
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
            Lô hàng và hạn dùng
          </h4>
        </div>
        <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#64748b' }}>
          Lô được tạo khi lập phiếu nhập có khai báo lô; phiếu xuất gợi ý lô theo hạn dùng gần nhất (FEFO). Lô
          không ở trạng thái Đạt không tính vào tồn khả dụng.
        </p>
      </div>

      {error ? <p className={styles.empty}>{error}</p> : null}

      <Table<Lot>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={lots}
        pagination={lots.length > 20 ? { pageSize: 20 } : false}
        locale={{ emptyText: 'Chưa có lô nào cho vật tư này. Lập phiếu nhập có khai báo lô để tạo lô.' }}
      />

      {editing ? (
        <div className={styles.modalOverlay} onClick={() => setEditing(undefined)}>
          <div
            className={styles.modalDialog}
            style={{ maxWidth: '480px', background: '#ffffff', borderRadius: '8px', padding: '24px' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                  Đổi trạng thái chất lượng lô {editing.lotNo}
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
                  {materialName ?? materialCode} ({materialCode}) · đang {QUALITY_STATUS_LABEL[editing.qualityStatus]}
                </p>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setEditing(undefined)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={saveQuality} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Trạng thái mới</label>
                <SearchableSelect
                  options={QUALITY_OPTIONS.filter((option) => option.value !== editing.qualityStatus)}
                  value={nextStatus}
                  onChange={(value) => setNextStatus(value as QualityStatus)}
                  clearable={false}
                  placeholder="Chọn trạng thái chất lượng"
                  emptyText="Không có trạng thái phù hợp"
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                  Lý do <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={reason}
                  placeholder="VD: Bao bì rách, chờ kiểm định lại"
                  style={{ padding: '8px 10px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              {nextStatus !== 'PASSED' ? (
                <p style={{ margin: 0, fontSize: '13px', color: '#b45309' }}>
                  Toàn bộ tồn của lô ở mọi kho sẽ không tính vào tồn khả dụng cho đến khi lô về trạng thái Đạt.
                </p>
              ) : null}
              {saveError ? <p style={{ margin: 0, fontSize: '13px', color: '#b91c1c' }}>{saveError}</p> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className={styles.modalCancelBtn} onClick={() => setEditing(undefined)}>
                  Huỷ
                </button>
                <button
                  type="submit"
                  className={`${styles.drawerActionBtn} ${styles.drawerActionBtnPrimary}`}
                  disabled={saving || !reason.trim()}
                >
                  <ShieldCheck size={14} />
                  <span>{saving ? 'Đang lưu…' : 'Lưu trạng thái'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
