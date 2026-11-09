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
import { Layers, ShieldCheck } from 'lucide-react';
import { SearchableSelect, formatDate, CloseGuard } from '@enterprise-platform/shared-ui';
import { changeLotQuality, loadLots } from '../inventory-api';
import { QUALITY_STATUS_BADGE, QUALITY_STATUS_LABEL, formatNumber } from '../inventory-labels';
import { cn } from '../ui/cn';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

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

  const qualityDirty =
    editing !== undefined &&
    (reason.trim() !== '' || nextStatus !== (editing.qualityStatus === 'PASSED' ? 'QUARANTINE' : 'PASSED'));

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
      render: (value: string) => <strong className="font-mono">{value}</strong>,
    },
    {
      title: 'Hạn dùng',
      dataIndex: 'expiresOn',
      key: 'expiresOn',
      sorter: (left, right) => (left.expiresOn ?? '9999-12-31').localeCompare(right.expiresOn ?? '9999-12-31'),
      render: (value: string | undefined) =>
        value ? (
          <span className={cn(value < today && 'font-semibold text-red-700')}>
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
            className="rounded px-2 py-0.5 text-xs font-semibold"
            style={{ background: badge.bg, color: badge.text, border: `1px solid ${badge.border}` }}
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
          <span className="text-slate-500">Đã xuất hết</span>
        ) : (
          <div className="flex flex-col gap-0.5">
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
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => openQualityDialog(lot)}
          >
            Đổi chất lượng
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-primary" />
          <h4 className="m-0 text-sm font-bold text-slate-900">
            Lô hàng và hạn dùng
          </h4>
        </div>
        <p className="m-0 mt-[3px] text-[13px] text-slate-500">
          Lô được tạo khi lập phiếu nhập có khai báo lô; phiếu xuất gợi ý lô theo hạn dùng gần nhất (FEFO). Lô
          không ở trạng thái Đạt không tính vào tồn khả dụng.
        </p>
      </div>

      {error ? <p className="m-0 py-8 text-center text-slate-500">{error}</p> : null}

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
        <Dialog onEscape={!saving && !qualityDirty ? () => setEditing(undefined) : undefined}>
          <DialogContent className="max-w-[480px]" aria-label={`Đổi trạng thái chất lượng lô ${editing.lotNo}`}>
            <DialogHeader>
              <div>
                <DialogTitle>Đổi trạng thái chất lượng lô {editing.lotNo}</DialogTitle>
                <DialogDescription>
                  {materialName ?? materialCode} ({materialCode}) · đang {QUALITY_STATUS_LABEL[editing.qualityStatus]}
                </DialogDescription>
              </div>
              <CloseGuard dirty={qualityDirty} busy={saving} onClose={() => setEditing(undefined)}>
                <DialogCloseButton />
              </CloseGuard>
            </DialogHeader>
            <form onSubmit={saveQuality} className="flex min-h-0 flex-col">
              <DialogBody className="flex flex-col gap-3.5">
              <div className="flex flex-col gap-1">
                <Label>Trạng thái mới</Label>
                <SearchableSelect
                  options={QUALITY_OPTIONS.filter((option) => option.value !== editing.qualityStatus)}
                  value={nextStatus}
                  onChange={(value) => setNextStatus(value as QualityStatus)}
                  clearable={false}
                  placeholder="Chọn trạng thái chất lượng"
                  emptyText="Không có trạng thái phù hợp"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label required>Lý do</Label>
                <Textarea
                  required
                  rows={3}
                  value={reason}
                  placeholder="VD: Bao bì rách, chờ kiểm định lại"
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              {nextStatus !== 'PASSED' ? (
                <p className="m-0 text-[13px] text-amber-700">
                  Toàn bộ tồn của lô ở mọi kho sẽ không tính vào tồn khả dụng cho đến khi lô về trạng thái Đạt.
                </p>
              ) : null}
              {saveError ? <p className="m-0 text-[13px] text-red-700">{saveError}</p> : null}
              </DialogBody>
              <DialogFooter>
                <CloseGuard dirty={qualityDirty} busy={saving} onClose={() => setEditing(undefined)}>
                  <Button type="button" variant="outline">
                    Huỷ
                  </Button>
                </CloseGuard>
                <Button type="submit" disabled={saving || !reason.trim()}>
                  <ShieldCheck size={14} />
                  <span>{saving ? 'Đang lưu…' : 'Lưu trạng thái'}</span>
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
