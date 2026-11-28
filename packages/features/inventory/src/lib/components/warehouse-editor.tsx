'use client';

import type { Warehouse } from '@enterprise-platform/contracts-inventory';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { toast } from '@enterprise-platform/shared-ui';
import { createWarehouse, loadAllWarehouses, setWarehouseLocationLevels, updateWarehouse } from '../inventory-api';
import { describeLevels, effectiveLevels } from '../storage-location.model';
import { LocationLevelsEditor } from './location-levels-editor';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';

/**
 * Danh sách kho, khai ngay trong Cài đặt.
 *
 * Trước đây kho chỉ có đường ĐỌC — muốn thêm một kho phải sửa dữ liệu seed. Mà
 * kho là thứ đầu tiên một đơn vị mới cần khai, trước cả vật tư.
 *
 * Không có nút xoá: mã kho nằm trong mọi bút toán của sổ cái, xoá đi là làm mồ
 * côi toàn bộ lịch sử nhập xuất của kho đó. Ngừng dùng thì kho biến khỏi các ô
 * chọn nhưng lịch sử vẫn đọc được — và kho còn hàng thì server từ chối ngừng.
 */
export function WarehouseEditor({
  disabled,
  templateLevels = [],
}: {
  disabled?: boolean;
  /** Mẫu tên cấp vị trí của tenant (Cài đặt); kho không có tên cấp riêng thì dùng mẫu này. */
  templateLevels?: readonly string[];
}) {
  const [rows, setRows] = useState<Warehouse[]>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  /** Kho đang mở phần khai tên cấp vị trí: dùng mẫu chung hay đặt riêng, kèm danh sách cấp đang soạn. */
  const [levelsEdit, setLevelsEdit] = useState<{ code: string; own: boolean; levels: string[] }>();

  const reload = useCallback(async () => {
    try {
      setRows(await loadAllWarehouses());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đọc được danh sách kho.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const busy = disabled || saving;

  const run = async (action: () => Promise<unknown>) => {
    setSaving(true);
    setError(undefined);
    try {
      await action();
      await reload();
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Không lưu được.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    const ok = await run(() =>
      createWarehouse({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        location: location.trim() || undefined,
      }),
    );
    if (ok) {
      setCode('');
      setName('');
      setLocation('');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <p role="alert" className="m-0 mb-4 rounded-[0.65rem] border border-[#f0c2c2] bg-[#fdf2f2] px-4 py-[0.8rem] text-[#a12b2b]">
          {error}
        </p>
      ) : null}

      <TableWrap className="rounded-xl border border-slate-200 bg-white">
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Mã</TableHeaderCell>
            <TableHeaderCell>Tên kho</TableHeaderCell>
            <TableHeaderCell>Vị trí</TableHeaderCell>
            <TableHeaderCell>Cấp vị trí lưu trữ</TableHeaderCell>
            <TableHeaderCell>Đang dùng</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(rows ?? []).map((warehouse) => (
            <Fragment key={warehouse.code}>
            <TableRow className={cn(!warehouse.isActive && 'text-slate-500')}>
              <TableCell className="font-mono font-bold tracking-[0.03em] text-slate-800">{warehouse.code}</TableCell>
              <TableCell>
                <Input
                  className="h-8 text-[13px]"
                  value={warehouse.name}
                  disabled={busy}
                  aria-label={`Tên kho ${warehouse.code}`}
                  onChange={(event) =>
                    setRows((current) =>
                      (current ?? []).map((item) =>
                        item.code === warehouse.code ? { ...item, name: event.target.value } : item,
                      ),
                    )
                  }
                  onBlur={(event) =>
                    void run(() => updateWarehouse(warehouse.code, { name: event.target.value }))
                  }
                />
              </TableCell>
              <TableCell>
                <Input
                  className="h-8 text-[13px]"
                  value={warehouse.location ?? ''}
                  disabled={busy}
                  placeholder="Địa chỉ, khu vực…"
                  aria-label={`Vị trí kho ${warehouse.code}`}
                  onChange={(event) =>
                    setRows((current) =>
                      (current ?? []).map((item) =>
                        item.code === warehouse.code
                          ? { ...item, location: event.target.value }
                          : item,
                      ),
                    )
                  }
                  onBlur={(event) =>
                    void run(() =>
                      updateWarehouse(warehouse.code, { location: event.target.value }),
                    )
                  }
                />
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="text-slate-700">
                    {describeLevels(effectiveLevels(warehouse, templateLevels))}
                    <span className="text-slate-400"> ({warehouse.locationLevels ? 'riêng' : 'mẫu chung'})</span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      setLevelsEdit(
                        levelsEdit?.code === warehouse.code
                          ? undefined
                          : {
                              code: warehouse.code,
                              own: warehouse.locationLevels !== undefined,
                              levels: [...(warehouse.locationLevels ?? templateLevels)],
                            },
                      )
                    }
                  >
                    {levelsEdit?.code === warehouse.code ? 'Đóng' : 'Sửa cấp'}
                  </Button>
                </div>
              </TableCell>
              <TableCell>
                <input
                  type="checkbox"
                  className="size-[1.05rem] cursor-pointer accent-primary"
                  checked={warehouse.isActive}
                  disabled={busy}
                  aria-label={`Đang dùng kho ${warehouse.code}`}
                  title="Kho còn hàng thì không ngừng dùng được — chuyển hàng đi trước."
                  onChange={(event) =>
                    void run(() =>
                      updateWarehouse(warehouse.code, { isActive: event.target.checked }),
                    )
                  }
                />
              </TableCell>
            </TableRow>
            {levelsEdit?.code === warehouse.code ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex flex-col gap-3 py-2">
                    <div className="flex flex-wrap items-center gap-5 text-[13px] text-slate-700">
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="radio"
                          name={`levels-source-${warehouse.code}`}
                          className="accent-primary"
                          checked={!levelsEdit.own}
                          disabled={busy}
                          onChange={() => setLevelsEdit({ ...levelsEdit, own: false })}
                        />
                        Dùng mẫu chung ({describeLevels(templateLevels)})
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="radio"
                          name={`levels-source-${warehouse.code}`}
                          className="accent-primary"
                          checked={levelsEdit.own}
                          disabled={busy}
                          onChange={() => setLevelsEdit({ ...levelsEdit, own: true })}
                        />
                        Đặt cấp riêng cho kho này
                      </label>
                    </div>
                    {levelsEdit.own ? (
                      <LocationLevelsEditor
                        levels={levelsEdit.levels}
                        disabled={busy}
                        onChange={(next) => setLevelsEdit({ ...levelsEdit, levels: next })}
                      />
                    ) : null}
                    <p className="m-0 text-xs text-slate-500">
                      Đổi tên hay số cấp không đổi vị trí đã nhập: mỗi vị trí đã lưu là một chuỗi hoàn chỉnh.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            setWarehouseLocationLevels(warehouse.code, levelsEdit.own ? levelsEdit.levels : null),
                          ).then((ok) => {
                            if (ok) setLevelsEdit(undefined);
                          })
                        }
                      >
                        Lưu cấp vị trí
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setLevelsEdit(undefined)}>
                        Hủy
                      </Button>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : null}
            </Fragment>
          ))}
          {rows && rows.length === 0 ? (
            <TableEmpty colSpan={5}>Chưa khai kho nào.</TableEmpty>
          ) : null}
        </TableBody>
      </Table>
      </TableWrap>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-5 py-[1.1rem]">
        <div className="flex items-center gap-[0.45rem] text-sm font-semibold text-slate-800">
          <span>Thêm kho lưu trữ mới</span>
        </div>
        <div className="grid grid-cols-1 items-center gap-[0.65rem] md:grid-cols-[140px_1.2fr_1.5fr_auto]">
          <Input
            className="font-mono font-semibold uppercase tracking-[0.04em]"
            value={code}
            disabled={busy}
            placeholder="Mã kho"
            aria-label="Mã kho mới"
            onChange={(event) => setCode(event.target.value)}
          />
          <Input
            value={name}
            disabled={busy}
            placeholder="Tên kho"
            aria-label="Tên kho mới"
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            value={location}
            disabled={busy}
            placeholder="Vị trí (tuỳ chọn)"
            aria-label="Vị trí kho mới"
            onChange={(event) => setLocation(event.target.value)}
          />
          <Button
            type="button"
            disabled={busy || !code.trim() || !name.trim()}
            onClick={() => void add()}
          >
            Thêm kho
          </Button>
        </div>
        {/* Mã là khoá nghiệp vụ: mọi bút toán trỏ vào kho qua nó, nên nói trước
            rằng đổi mã là không được, thay vì để người dùng phát hiện lúc bấm. */}
        <p className="m-0 mb-1 text-[0.8125rem] leading-normal text-slate-500">Mã kho không sửa được sau khi tạo.</p>
      </div>
    </div>
  );
}
