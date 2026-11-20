'use client';

import type { Material, MaterialStorageLocation, Warehouse } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadMaterialStorageLocations, replaceMaterialStorageLocations } from '../inventory-api';
import {
  describeLevels,
  draftsSignature,
  effectiveLevels,
  emptyDraft,
  toDraft,
  toInputs,
  type LocationDraft,
} from '../storage-location.model';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/** Trạng thái sửa của một kho: các dòng đang gõ và chữ ký của bản đã lưu để biết có thay đổi hay không. */
interface WarehouseDraft {
  readonly drafts: readonly LocationDraft[];
  readonly saved: string;
}

function without<T>(all: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const rest = { ...all };
  delete rest[key];
  return rest;
}

/**
 * Vị trí lưu trữ của một mặt hàng, nhóm theo kho. Chỉ là thông tin tùy chọn (chuỗi tự do): không ràng buộc với tồn
 * kho, không bắt khớp cấu trúc kho. Mỗi kho lưu riêng bằng một lần ghi; xóa hết dòng rồi lưu là xóa vị trí của kho đó.
 */
export function StorageLocationPanel({
  material,
  warehouses,
  templateLevels = [],
  canManage,
  onChanged,
}: {
  material: Pick<Material, 'code' | 'kind'>;
  warehouses: readonly Warehouse[];
  /** Mẫu tên cấp của tenant (Cài đặt); kho không có tên cấp riêng thì dùng mẫu này. */
  templateLevels?: readonly string[];
  canManage: boolean;
  onChanged?: () => void;
}) {
  const [locations, setLocations] = useState<readonly MaterialStorageLocation[]>();
  const [error, setError] = useState<string>();
  const [edits, setEdits] = useState<Readonly<Record<string, WarehouseDraft>>>({});
  const [savingCode, setSavingCode] = useState<string>();
  /** Kho vừa được thêm bằng ô chọn nhưng chưa có dòng nào đã lưu. */
  const [addedCodes, setAddedCodes] = useState<readonly string[]>([]);

  const physical = useMemo(
    () => warehouses.filter((warehouse) => warehouse.type === 'PHYSICAL' && warehouse.isActive),
    [warehouses],
  );
  const warehouseByCode = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.code, warehouse])), [warehouses]);

  const isService = material.kind === 'SERVICE';

  const reload = useCallback(async () => {
    // Dịch vụ không có vị trí lưu trữ: không gọi server (server cũng từ chối ghi).
    if (isService) return;
    try {
      setLocations(await loadMaterialStorageLocations(material.code));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được vị trí lưu trữ.');
    }
  }, [material.code, isService]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const levelsOf = useCallback(
    (warehouseCode: string): readonly string[] => {
      const warehouse = warehouseByCode.get(warehouseCode);
      return warehouse ? effectiveLevels(warehouse, templateLevels) : templateLevels;
    },
    [warehouseByCode, templateLevels],
  );

  /** Các kho đang hiện: có vị trí đã lưu, hoặc vừa được thêm. */
  const shownCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const location of locations ?? []) codes.add(location.warehouseCode);
    for (const code of addedCodes) codes.add(code);
    return [...codes].sort();
  }, [locations, addedCodes]);

  const draftFor = (code: string): WarehouseDraft => {
    const existing = edits[code];
    if (existing) return existing;
    // Chưa sửa: dựng từ dữ liệu đã lưu (khóa dòng là id nên ổn định giữa các lần vẽ). Kho vừa thêm có sẵn một dòng
    // trống trong `edits` từ lúc thêm.
    const levels = levelsOf(code);
    const drafts = (locations ?? [])
      .filter((location) => location.warehouseCode === code)
      .map((location) => toDraft(location, levels));
    return { drafts, saved: draftsSignature(drafts, levels) };
  };

  const setDrafts = (code: string, update: (drafts: readonly LocationDraft[]) => readonly LocationDraft[]) => {
    const current = draftFor(code);
    setEdits((all) => ({ ...all, [code]: { ...current, drafts: update(current.drafts) } }));
  };

  const save = async (code: string) => {
    const levels = levelsOf(code);
    const { drafts } = draftFor(code);
    setSavingCode(code);
    try {
      const result = await replaceMaterialStorageLocations(material.code, code, toInputs(drafts, levels));
      setLocations((current) => [...(current ?? []).filter((location) => location.warehouseCode !== code), ...result]);
      setEdits((all) => without(all, code));
      if (result.length === 0) setAddedCodes((current) => current.filter((item) => item !== code));
      toast.success(
        result.length === 0 ? `Đã xóa vị trí của ${material.code} ở kho ${code}.` : `Đã lưu vị trí của ${material.code} ở kho ${code}.`,
      );
      onChanged?.();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Không lưu được vị trí lưu trữ.');
    } finally {
      setSavingCode(undefined);
    }
  };

  const cancel = (code: string) => {
    setEdits((all) => without(all, code));
    if (!(locations ?? []).some((location) => location.warehouseCode === code)) {
      setAddedCodes((current) => current.filter((item) => item !== code));
    }
  };

  if (material.kind === 'SERVICE') {
    return <p className="m-0 py-6 text-center text-slate-500">Dịch vụ không có vị trí lưu trữ.</p>;
  }
  if (error) {
    return (
      <p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }
  if (!locations) return <p className="m-0 py-6 text-center text-slate-500">Đang tải vị trí lưu trữ…</p>;

  const addable = physical
    .filter((warehouse) => !shownCodes.includes(warehouse.code))
    .map((warehouse) => ({ value: warehouse.code, label: `${warehouse.code} - ${warehouse.name}` }));

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13px] leading-normal text-slate-500">
        Thông tin tùy chọn để người kiểm kê và người lấy hàng biết đi đâu. Không ảnh hưởng tồn kho, nhập chuỗi tự do.
      </p>

      {shownCodes.length === 0 ? <p className="m-0 text-sm italic text-slate-400">Chưa khai vị trí ở kho nào.</p> : null}

      {shownCodes.map((code) => {
        const warehouse = warehouseByCode.get(code);
        const levels = levelsOf(code);
        const { drafts, saved } = draftFor(code);
        const dirty = draftsSignature(drafts, levels) !== saved;
        const busy = savingCode === code;
        const source = warehouse?.locationLevels ? 'riêng của kho' : 'theo mẫu chung';

        return (
          <div key={code} className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong className="text-sm text-slate-800">
                {code}
                {warehouse ? ` - ${warehouse.name}` : ''}
              </strong>
              <span className="text-xs text-slate-500">
                Cấp: {describeLevels(levels)} ({source})
              </span>
            </div>

            {drafts.map((draft, index) => (
              <div key={draft.key} className="flex flex-col gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  {levels.length > 0 ? (
                    Array.from({ length: Math.max(levels.length, draft.parts.length) }, (_, at) => (
                      <Input
                        key={at}
                        className="h-8 min-w-[110px] flex-[1_1_110px] text-[13px]"
                        value={draft.parts[at] ?? ''}
                        disabled={!canManage || busy}
                        placeholder={levels[at] ?? `Cấp ${at + 1}`}
                        aria-label={`${levels[at] ?? `Cấp ${at + 1}`} của vị trí ${index + 1} ở kho ${code}`}
                        onChange={(event) =>
                          setDrafts(code, (current) =>
                            current.map((item) =>
                              item.key === draft.key
                                ? {
                                    ...item,
                                    parts: Array.from({ length: Math.max(levels.length, item.parts.length) }, (_, partAt) =>
                                      partAt === at ? event.target.value : (item.parts[partAt] ?? ''),
                                    ),
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                    ))
                  ) : (
                    <Input
                      className="h-8 min-w-[220px] flex-[1_1_220px] text-[13px]"
                      value={draft.text}
                      disabled={!canManage || busy}
                      maxLength={255}
                      placeholder="VD: Khu A / Kệ 3 / Ngăn 2"
                      aria-label={`Vị trí ${index + 1} ở kho ${code}`}
                      onChange={(event) =>
                        setDrafts(code, (current) =>
                          current.map((item) => (item.key === draft.key ? { ...item, text: event.target.value } : item)),
                        )
                      }
                    />
                  )}
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="radio"
                      name={`primary-${code}`}
                      className="accent-primary"
                      checked={draft.isPrimary}
                      disabled={!canManage || busy}
                      onChange={() =>
                        setDrafts(code, (current) => current.map((item) => ({ ...item, isPrimary: item.key === draft.key })))
                      }
                    />
                    Chính
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!canManage || busy}
                    aria-label={`Xóa vị trí ${index + 1} ở kho ${code}`}
                    onClick={() =>
                      setDrafts(code, (current) => {
                        const next = current.filter((item) => item.key !== draft.key);
                        // Xóa dòng chính thì dòng còn lại đầu tiên làm chính.
                        return next.length > 0 && !next.some((item) => item.isPrimary)
                          ? next.map((item, at) => ({ ...item, isPrimary: at === 0 }))
                          : next;
                      })
                    }
                  >
                    <X size={14} />
                  </Button>
                </div>
                <Input
                  className="h-7 text-xs"
                  value={draft.note}
                  disabled={!canManage || busy}
                  maxLength={1000}
                  placeholder="Ghi chú (tùy chọn)"
                  aria-label={`Ghi chú vị trí ${index + 1} ở kho ${code}`}
                  onChange={(event) =>
                    setDrafts(code, (current) =>
                      current.map((item) => (item.key === draft.key ? { ...item, note: event.target.value } : item)),
                    )
                  }
                />
              </div>
            ))}

            {canManage ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setDrafts(code, (current) => [...current, emptyDraft(levels, current.length === 0)])}
                >
                  <Plus size={13} />
                  Thêm vị trí
                </Button>
                <div className="flex items-center gap-2">
                  {dirty || !(locations ?? []).some((location) => location.warehouseCode === code) ? (
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => cancel(code)}>
                      Hủy
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" disabled={busy || !dirty} onClick={() => void save(code)}>
                    {busy ? 'Đang lưu…' : 'Lưu vị trí'}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      {canManage && addable.length > 0 ? (
        <div className="max-w-sm">
          <SearchableSelect
            options={addable}
            value=""
            placeholder="Thêm vị trí ở kho khác…"
            emptyText="Không còn kho nào"
            clearable={false}
            height={36}
            className="w-full"
            onChange={(code) => {
              if (!code) return;
              const levels = levelsOf(code);
              setEdits((all) => ({ ...all, [code]: { drafts: [emptyDraft(levels, true)], saved: draftsSignature([], levels) } }));
              setAddedCodes((current) => [...current, code]);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
