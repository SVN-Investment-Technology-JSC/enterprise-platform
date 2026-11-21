'use client';

import type { SerialHistory, SerialTracking } from '@enterprise-platform/contracts-inventory';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { useEffect, useState, type FormEvent } from 'react';
import { loadSerialHistory, updateSerial } from '../inventory-api';
import {
  QUALITY_STATUS_LABEL,
  SERIAL_MOVEMENT_LABEL,
  SERIAL_STOCK_STATE_LABEL,
  formatDateTime,
} from '../inventory-labels';
import { FormError, useFormSubmit } from './form-error';
import { DrawerField, DrawerSection } from './material-drawer-sections';
import { Button } from '../ui/button';
import { DialogCloseButton } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Sheet, SheetBody, SheetContent, SheetHeader } from '../ui/sheet';

/**
 * Drawer của MỘT serial: thông tin, vòng đời (nhập, xuất, chuyển kho, đổi chất lượng...) theo thời gian.
 * Truyền `serial` kèm `canManage` thì có thêm chế độ sửa (số serial chỉ đổi được khi chưa phát sinh) và xoá;
 * không truyền thì chỉ xem. Lịch sử serial chỉ ghi thêm ở server nên không sửa được.
 */
export function SerialLifecycleDrawer({
  serialNumber,
  materialCode,
  materialName,
  serial,
  canManage = false,
  warehouseCodeById,
  onClose,
  onChanged,
  onDelete,
}: {
  serialNumber: string;
  materialCode: string;
  materialName?: string;
  /** Dòng serial hiện tại, cần cho chế độ sửa. */
  serial?: SerialTracking;
  canManage?: boolean;
  warehouseCodeById?: ReadonlyMap<string, string>;
  onClose: () => void;
  /** Đã lưu thay đổi; nơi gọi nạp lại danh sách. */
  onChanged?: () => void;
  /** Xoá serial chưa phát sinh; nơi gọi gọi API và đóng drawer. */
  onDelete?: (serial: SerialTracking) => void;
}) {
  const [history, setHistory] = useState<SerialHistory>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    setHistory(undefined);
    setError(undefined);
    loadSerialHistory(serialNumber, materialCode)
      .then((value) => alive && setHistory(value))
      .catch((cause) => alive && setError(cause instanceof Error ? cause.message : 'Không đọc được vòng đời serial.'));
    return () => {
      alive = false;
    };
  }, [serialNumber, materialCode]);

  const locked = Boolean(serial?.stockState || serial?.currentAssetId);
  const editable = canManage && Boolean(serial) && Boolean(onChanged);
  // Đang sửa dở thì Esc hay bấm nền không đóng, tránh mất dữ liệu.
  const close = () => {
    if (!dirty) onClose();
  };

  return (
    <Sheet onEscape={close} onBackdropClick={close}>
      <SheetContent aria-label={`Serial ${serialNumber}`}>
        <SheetHeader>
          <div className="flex min-w-0 flex-1 flex-col gap-[0.3rem]">
            <span className="text-xs font-bold uppercase tracking-[0.04em] text-slate-500">
              {editing ? 'Sửa serial' : 'Serial'}
            </span>
            <h2 className="m-0 font-mono text-xl font-bold leading-[1.3] text-slate-900 [overflow-wrap:anywhere]">
              {serialNumber}
            </h2>
            <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <code className="rounded bg-slate-100 px-[0.35rem] py-[0.1rem] font-mono font-bold text-slate-700">
                {materialCode}
              </code>
              {materialName ?? history?.materialName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {editable && !editing ? (
              <>
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Sửa
                </Button>
                {!locked && onDelete && serial ? (
                  <Popconfirm
                    title="Xoá serial?"
                    description={`Serial ${serial.serialNumber} mới khai, chưa vào kho nên xoá được. Xoá rồi không khôi phục.`}
                    okText="Xoá"
                    cancelText="Huỷ"
                    okType="danger"
                    onConfirm={() => onDelete(serial)}
                  >
                    <Button type="button" variant="outline" className="text-red-700">
                      Xoá
                    </Button>
                  </Popconfirm>
                ) : null}
              </>
            ) : null}
            <DialogCloseButton onClick={close} />
          </div>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-4">
          {error ? (
            <p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {!history && !error ? <p className="m-0 text-slate-500">Đang tải…</p> : null}

          {editing && serial ? (
            <SerialEditSection
              serial={serial}
              locked={locked}
              onDirtyChange={setDirty}
              onCancel={() => {
                setDirty(false);
                setEditing(false);
              }}
              onSaved={() => {
                setDirty(false);
                setEditing(false);
                onChanged?.();
              }}
            />
          ) : null}

          {history ? (
            <>
              {!editing ? (
                <DrawerSection title="Thông tin serial">
                  <div className="grid grid-cols-2 gap-x-5 gap-y-3.5">
                    <DrawerField label="Vị trí theo sổ kho">
                      {history.stockState ? SERIAL_STOCK_STATE_LABEL[history.stockState] : 'Chưa vào sổ kho'}
                      {history.warehouseCode
                        ? ` · ${history.warehouseCode}`
                        : serial?.currentWarehouseId
                          ? ` · ${warehouseCodeById?.get(serial.currentWarehouseId) ?? ''}`
                          : ''}
                    </DrawerField>
                    <DrawerField label="Chất lượng">{QUALITY_STATUS_LABEL[history.qualityStatus]}</DrawerField>
                    <DrawerField label="Mã nội bộ">{serial?.internalCode}</DrawerField>
                    {history.lastIssue ? (
                      <DrawerField label="Xuất gần nhất">
                        {history.lastIssue.documentCode} · {formatDateTime(history.lastIssue.issuedAt)}
                      </DrawerField>
                    ) : null}
                  </div>
                </DrawerSection>
              ) : null}

              <DrawerSection title={`Vòng đời (${history.movements.length})`}>
                {history.movements.length === 0 ? (
                  <p className="m-0 text-sm text-slate-500">Serial này chưa có phát sinh nào.</p>
                ) : (
                  <ol className="m-0 flex list-none flex-col gap-3 p-0">
                    {[...history.movements].reverse().map((movement) => (
                      <li key={movement.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <strong className="text-sm text-slate-900">
                            {SERIAL_MOVEMENT_LABEL[movement.movementType]}
                          </strong>
                          <span className="text-xs text-slate-500">{formatDateTime(movement.occurredAt)}</span>
                        </div>
                        <div className="mt-1 text-[13px] text-slate-600">
                          {movement.fromWarehouseCode || movement.toWarehouseCode
                            ? `${movement.fromWarehouseCode ?? '—'} → ${movement.toWarehouseCode ?? '—'}`
                            : null}
                          {movement.documentCode ? ` · Chứng từ ${movement.documentCode}` : ''}
                          {movement.movementType === 'QUALITY_CHANGE' && movement.previousQualityStatus
                            ? ` · ${QUALITY_STATUS_LABEL[movement.previousQualityStatus]} → ${QUALITY_STATUS_LABEL[movement.qualityStatus]}`
                            : ''}
                        </div>
                        {movement.reason ? (
                          <div className="mt-1 text-[13px] text-slate-500">{movement.reason}</div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </DrawerSection>
            </>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** Chế độ sửa: số serial (chỉ khi chưa phát sinh) và mã nội bộ. Server là nơi chặn, form chỉ báo trước. */
function SerialEditSection({
  serial,
  locked,
  onDirtyChange,
  onCancel,
  onSaved,
}: {
  serial: SerialTracking;
  locked: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { error, submit: send } = useFormSubmit('Không lưu được serial.');
  const [serialNumber, setSerialNumber] = useState(serial.serialNumber);
  const [internalCode, setInternalCode] = useState(serial.internalCode ?? '');
  const [busy, setBusy] = useState(false);
  const isDirty = serialNumber !== serial.serialNumber || internalCode !== (serial.internalCode ?? '');

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isDirty || busy || !serialNumber.trim()) return;
    setBusy(true);
    void send(async () => {
      try {
        await updateSerial(serial.materialCode as string, serial.serialNumber, {
          serialNumber: serialNumber.trim() !== serial.serialNumber ? serialNumber.trim() : undefined,
          internalCode: internalCode.trim() || undefined,
        });
        onSaved();
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <DrawerSection title="Sửa thông tin">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-[0.4rem]">
          <Label htmlFor="serial-edit-number" required>
            Số serial
          </Label>
          <Input
            id="serial-edit-number"
            value={serialNumber}
            disabled={locked || busy}
            onChange={(event) => setSerialNumber(event.target.value)}
          />
          {locked ? (
            <span className="text-[13px] text-slate-500">
              Serial đã phát sinh (đã vào kho hoặc gắn thiết bị) nên không đổi số. Sai thì dùng chứng từ đảo hoặc điều chỉnh.
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-[0.4rem]">
          <Label htmlFor="serial-edit-internal">Mã nội bộ</Label>
          <Input
            id="serial-edit-internal"
            value={internalCode}
            disabled={busy}
            onChange={(event) => setInternalCode(event.target.value)}
          />
        </div>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Huỷ
          </Button>
          <Button type="submit" disabled={busy || !isDirty || !serialNumber.trim()}>
            {busy ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </div>
      </form>
    </DrawerSection>
  );
}
