'use client';
import { useInventoryPermissions } from '../inventory-permissions';

import type { Material, SerialCoverage, SerialTracking } from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useState } from 'react';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { loadSerialCoverage, loadSerials, registerSerials, updateSerial } from '../inventory-api';
import { ASSET_STATUS_LABEL, QUALITY_STATUS_LABEL, SERIAL_STOCK_STATE_LABEL } from '../inventory-labels';
import { SerialAssignDialog } from './serial-assign-dialog';
import { SerialEnableDialog } from './serial-enable-dialog';
import { SerialLifecycleDrawer } from './serial-lifecycle-drawer';
import { Button } from '../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';
import { Textarea } from '../ui/textarea';

/**
 * Cá thể theo sê-ri của một mã vật tư.
 *
 * Khi một mã được theo dõi theo sê-ri thì **tình trạng và "vị trí" nằm trên
 * từng cá thể**, không nằm trên mã. Năm cái rơ-le cùng mã có thể một cái đang
 * vận hành, một cái gửi đi sửa, ba cái nằm kho — ghi trạng thái ở mức mã thì cả
 * năm cái mang chung một câu trả lời sai.
 *
 * Mã KHÔNG theo sê-ri thì ngược lại: khối này không hiện, và hai ô đó nằm ở hồ
 * sơ của chính mã.
 */
export function SerialPanel({
  material,
  statuses,
  usageStates,
  busy,
  warehouseCode,
  warehouseCodeById,
}: {
  material: Material;
  /** Tình trạng được phép chọn, theo cấu hình admin. */
  statuses: readonly string[];
  /** Danh mục "vị trí", theo cấu hình admin. */
  usageStates: readonly string[];
  busy?: boolean;
  /** Kho của dòng tồn đang mở: bảng chỉ liệt kê serial của kho này (có nút xem tất cả). */
  warehouseCode?: string;
  warehouseCodeById?: ReadonlyMap<string, string>;
}) {
  const { canManage } = useInventoryPermissions();
  const [rows, setRows] = useState<SerialTracking[]>();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [coverage, setCoverage] = useState<SerialCoverage[]>();
  const [showAll, setShowAll] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [lifecycleOf, setLifecycleOf] = useState<string>();
  const [enabled, setEnabled] = useState(false);
  const serialized = material.isSerialized || material.trackingMode === 'SERIAL' || enabled;

  const reload = useCallback(async () => {
    try {
      const [list, cover] = await Promise.all([loadSerials(material.code), loadSerialCoverage(material.code)]);
      setRows(list);
      setCoverage(cover);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đọc được danh sách sê-ri.');
    }
  }, [material.code]);

  useEffect(() => {
    setRows(undefined);
    void reload();
  }, [reload]);

  const trackingBlocked = material.trackingMode === 'LOT' || material.kind === 'SERVICE';
  const here = coverage?.find((item) => item.warehouseCode === warehouseCode);

  // Mã chưa theo dõi serial: cho bật ngay tại đây (trừ dịch vụ và hàng đang theo lô).
  if (!serialized) {
    if (trackingBlocked || !canManage) return null;
    return (
      <>
      <section className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3">
        <p className="m-0 text-sm text-slate-600">
          Mã này chưa theo dõi theo serial. Bật lên để gắn số serial và xem vòng đời từng cái.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={busy || saving || coverage === undefined}
          onClick={() => setEnabling(true)}
        >
          Bật theo dõi serial
        </Button>
      </section>
      {enabling ? (
        <SerialEnableDialog
          materialCode={material.code}
          materialName={material.name}
          coverage={coverage ?? []}
          onCancel={() => setEnabling(false)}
          onDone={(count) => {
            setEnabling(false);
            setEnabled(true);
            toast.success(count > 0 ? `Đã bật theo dõi serial và gắn ${count} serial.` : 'Đã bật theo dõi serial.');
            void reload();
          }}
        />
      ) : null}
      </>
    );
  }

  const visibleRows = (rows ?? []).filter((row) => {
    if (showAll || !warehouseCode) return true;
    return row.stockState === 'IN_STOCK' && warehouseCodeById?.get(row.currentWarehouseId ?? '') === warehouseCode;
  });
  const hiddenCount = (rows?.length ?? 0) - visibleRows.length;

  const disabled = !canManage || busy || saving;

  const add = async () => {
    // Nhận cả xuống dòng, dấu phẩy và chấm phẩy: người dùng thường dán thẳng
    // một cột từ Excel hoặc gõ liền một dãy.
    const serialNumbers = draft
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (serialNumbers.length === 0) return;

    setSaving(true);
    try {
      const result = await registerSerials({ materialCode: material.code, serialNumbers });
      setDraft('');
      if (result.added < serialNumbers.length) {
        toast.warning(`Đã thêm ${result.added}/${serialNumbers.length} — số còn lại đã có sẵn.`);
      }
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Không khai được sê-ri.');
    } finally {
      setSaving(false);
    }
  };

  const patch = async (serialNumber: string, change: Parameters<typeof updateSerial>[2]) => {
    setSaving(true);
    try {
      await updateSerial(material.code, serialNumber, change);
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Không lưu được.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-2">
        <strong className="text-sm font-semibold text-slate-900">Cá thể theo sê-ri</strong>
        <span className="text-[13px] text-slate-500">{rows ? `${visibleRows.length} cá thể` : 'Đang tải…'}</span>
      </header>

      {here ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <span className="text-slate-700">
            Kho {here.warehouseCode}: tồn <strong>{here.quantity}</strong> · đã có serial{' '}
            <strong>{here.serialized}</strong> ·{' '}
            <strong className={here.unassigned > 0 ? 'text-amber-700' : undefined}>
              chưa có serial {here.unassigned}
            </strong>
          </span>
          {here.unassigned > 0 && canManage ? (
            <Button type="button" disabled={busy || saving} onClick={() => setAssigning(true)}>
              Gắn serial cho {here.unassigned} cái
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 rounded-[0.65rem] border border-[#f0c2c2] bg-[#fdf2f2] px-4 py-[0.8rem] text-[#a12b2b]">
          {error}
        </p>
      ) : null}

      {rows && visibleRows.length > 0 ? (
        <TableWrap className="rounded-xl border border-slate-200 bg-white">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Số sê-ri</TableHeaderCell>
              {showAll ? <TableHeaderCell>Theo sổ kho</TableHeaderCell> : null}
              <TableHeaderCell>Chất lượng</TableHeaderCell>
              <TableHeaderCell>Tình trạng</TableHeaderCell>
              <TableHeaderCell>Vị trí</TableHeaderCell>
              <TableHeaderCell>Vòng đời</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono font-bold tracking-[0.03em] text-slate-800">{row.serialNumber}</TableCell>
                {showAll ? (
                  <TableCell>
                    {row.stockState ? SERIAL_STOCK_STATE_LABEL[row.stockState] : 'Chưa vào kho'}
                    {row.currentWarehouseId ? ` · ${warehouseCodeById?.get(row.currentWarehouseId) ?? ''}` : ''}
                  </TableCell>
                ) : null}
                <TableCell>{QUALITY_STATUS_LABEL[row.qualityStatus ?? 'PASSED']}</TableCell>
                <TableCell>
                  <div role="group" aria-label={`Tình trạng của ${row.serialNumber}`}>
                  <SearchableSelect
                    value={row.currentStatus}
                    disabled={disabled}
                    clearable={false}
                    height={32}
                    onChange={(value) => void patch(row.serialNumber, { currentStatus: value })}
                    options={withCurrent(statuses, row.currentStatus).map((status) => ({
                      value: status,
                      label: ASSET_STATUS_LABEL[status as keyof typeof ASSET_STATUS_LABEL] ?? status,
                    }))}
                  />
                  </div>
                </TableCell>
                <TableCell>
                  {usageStates.length === 0 ? (
                    <span className="text-slate-500">Chưa khai danh mục trong Cài đặt</span>
                  ) : (
                    <div role="group" aria-label={`Vị trí sử dụng của ${row.serialNumber}`}>
                    <SearchableSelect
                      value={row.locationType}
                      disabled={disabled}
                      height={32}
                      placeholder="— Chưa xác định —"
                      onChange={(value) => void patch(row.serialNumber, { locationType: value })}
                      options={withCurrent(usageStates, row.locationType).map((state) => ({
                        value: state,
                        label: state,
                      }))}
                    />
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Button type="button" variant="link" size="xs" className="h-auto p-0 font-bold" onClick={() => setLifecycleOf(row.serialNumber)}>
                    Xem
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </TableWrap>
      ) : rows ? (
        <p className="m-0 py-8 text-center text-slate-500">
          {warehouseCode && !showAll ? `Kho ${warehouseCode} chưa có serial nào.` : 'Chưa khai sê-ri nào cho mã này.'}
        </p>
      ) : null}

      {warehouseCode && rows && (hiddenCount > 0 || showAll) ? (
        <Button type="button" variant="link" size="xs" className="h-auto self-start p-0 font-bold" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Chỉ xem serial của kho này' : `Xem tất cả serial của mã (${hiddenCount} ở nơi khác)`}
        </Button>
      ) : null}

      {assigning && here ? (
        <SerialAssignDialog
          materialCode={material.code}
          materialName={material.name}
          warehouseCode={here.warehouseCode}
          unassigned={here.unassigned}
          onCancel={() => setAssigning(false)}
          onDone={(count) => {
            setAssigning(false);
            toast.success(`Đã gắn ${count} serial.`);
            void reload();
          }}
        />
      ) : null}
      {lifecycleOf ? (
        <SerialLifecycleDrawer serialNumber={lifecycleOf} materialCode={material.code} onClose={() => setLifecycleOf(undefined)} />
      ) : null}

      <div className="flex flex-col items-start gap-2">
        <Textarea
          rows={2}
          value={draft}
          disabled={disabled}
          aria-label="Số sê-ri mới"
          placeholder="Mỗi sê-ri một dòng, hoặc ngăn bằng dấu phẩy"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="button" disabled={disabled || !draft.trim()} onClick={() => void add()}>
          Khai sê-ri
        </Button>
      </div>
      {/* T8-11: khai ở đây không đưa sê-ri vào kho, nói rõ để người dùng không
          tưởng đã có hàng để xuất. */}
      <p className="m-0 text-[0.8125rem] leading-normal text-slate-500">
        Ô trên chỉ khai trước danh mục cá thể, chưa tính vào tồn kho. Hàng đã có trong kho mà thiếu
        serial thì dùng nút "Gắn serial"; hàng mới vào kho thì nhập qua phiếu nhập kèm số sê-ri.
      </p>
    </section>
  );
}

/** Danh mục kèm giá trị đang dùng, để một lần sửa không xoá mất dữ liệu cũ. */
function withCurrent(options: readonly string[], current: string): string[] {
  if (!current || options.includes(current)) return [...options];
  return [...options, current];
}
