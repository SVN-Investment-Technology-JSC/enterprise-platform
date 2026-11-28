'use client';

import type {
  InventorySettingsSnapshot,
  LegacySupplierCandidate,
  SupplierInputMode,
} from '@enterprise-platform/contracts-inventory';
import { useMemo, useState } from 'react';
import { loadLegacySupplierCandidates, saveInventorySetting } from '../inventory-api';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { FormError, submitErrorMessage } from './form-error';
import { UnitCatalogEditor } from './unit-catalog-editor';

const MODE_OPTIONS: readonly { value: SupplierInputMode; label: string; hint: string }[] = [
  {
    value: 'CATALOG_ONLY',
    label: 'Chỉ chọn từ danh mục',
    hint: 'Form nhập kho, lô và nhập Excel chỉ nhận nhà cung cấp có trong danh mục. Danh mục đang trống thì vẫn nhập tự do.',
  },
  {
    value: 'CATALOG_OR_FREE',
    label: 'Chọn từ danh mục hoặc gõ tự do',
    hint: 'Danh mục chỉ để gợi ý; nhà cung cấp gõ ngoài danh mục vẫn được ghi.',
  },
];

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Khóa so sánh phía giao diện, chỉ để không thêm trùng vào bản nháp; server chuẩn hóa chặt hơn khi lưu. */
function draftKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Khóa để màn cha gắn vào component: đổi phiên bản cấu hình thì bản nháp được tạo lại từ cấu hình mới. */
export function supplierCatalogSectionKey(settings: InventorySettingsSnapshot | undefined): string {
  return `${settings?.['catalog.supplier']?.version ?? 0}-${settings?.['supplier.input']?.version ?? 0}`;
}

/**
 * Cài đặt danh mục nhà cung cấp của Kho.
 *
 * Tự lưu bằng nút riêng (không dùng thanh Lưu chung của màn Cài đặt) vì hai khóa cấu hình đi cùng nhau: danh mục
 * và cách nhập. "Nhập từ dữ liệu cũ" chỉ đưa các mục đã duyệt vào bản nháp; bản nháp chưa lưu thì chưa có gì đổi.
 *
 * Bản nháp khởi tạo từ cấu hình đã lưu, nên màn cha phải gắn `key={supplierCatalogSectionKey(settings)}`: sau khi
 * lưu hoặc khi cấu hình đổi, component được dựng lại với bản nháp mới thay vì đồng bộ bằng hiệu ứng.
 */
export function SupplierCatalogSection({
  settings,
  canManage,
  onSaved,
}: {
  settings: InventorySettingsSnapshot | undefined;
  canManage: boolean;
  /** Gọi sau khi lưu: màn cha hiện thông báo và tải lại cấu hình cho các form dùng danh mục. */
  onSaved: (message: string) => void;
}) {
  const storedNames = settings?.['catalog.supplier']?.value.suppliers;
  const storedMode = settings?.['supplier.input']?.value.mode ?? 'CATALOG_ONLY';
  const catalogVersion = settings?.['catalog.supplier']?.version ?? 0;
  const inputVersion = settings?.['supplier.input']?.version ?? 0;

  const [names, setNames] = useState<string[]>([...(storedNames ?? [])]);
  const [mode, setMode] = useState<SupplierInputMode>(storedMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const namesDirty = JSON.stringify(names) !== JSON.stringify(storedNames ?? []);
  const modeDirty = mode !== storedMode;
  const dirty = namesDirty || modeDirty;

  const save = async () => {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      // Danh mục trước, cách nhập sau: hai khóa độc lập, mỗi khóa kiểm phiên bản riêng.
      if (namesDirty) await saveInventorySetting('catalog.supplier', { suppliers: names }, catalogVersion);
      if (modeDirty) await saveInventorySetting('supplier.input', { mode }, inputVersion);
      onSaved('Đã lưu danh mục nhà cung cấp.');
    } catch (cause) {
      setError(submitErrorMessage(cause, 'Không lưu được danh mục nhà cung cấp.'));
    } finally {
      setSaving(false);
    }
  };

  const [legacy, setLegacy] = useState<readonly LegacySupplierCandidate[]>();
  const [legacyLoading, setLegacyLoading] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const openLegacy = async () => {
    setLegacyLoading(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await loadLegacySupplierCandidates();
      setLegacy(result.candidates);
      setPicked(new Set());
    } catch (cause) {
      setError(submitErrorMessage(cause, 'Không tải được nhà cung cấp trong dữ liệu cũ.'));
    } finally {
      setLegacyLoading(false);
    }
  };

  const addable = useMemo(
    () => (legacy ?? []).filter((candidate) => !candidate.inCatalog),
    [legacy],
  );

  const togglePicked = (name: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const addPicked = () => {
    const present = new Set(names.map(draftKey));
    const additions: string[] = [];
    for (const candidate of addable) {
      if (!picked.has(candidate.name)) continue;
      const key = draftKey(candidate.name);
      if (present.has(key)) continue;
      present.add(key);
      additions.push(candidate.name);
    }
    setNames([...names, ...additions]);
    setLegacy(undefined);
    setPicked(new Set());
    setNotice(
      additions.length > 0
        ? `Đã thêm ${additions.length} nhà cung cấp vào bản nháp. Bấm "Lưu danh mục" để áp dụng.`
        : 'Không có mục mới nào để thêm.',
    );
  };

  const disabled = !canManage || saving;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h4 className="m-0 text-[14px]">Cách nhập nhà cung cấp</h4>
        <div role="radiogroup" aria-label="Cách nhập nhà cung cấp" className="flex flex-col gap-2">
          {MODE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2',
                mode === option.value ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name="supplier-input-mode"
                className="mt-1"
                checked={mode === option.value}
                disabled={disabled}
                onChange={() => setMode(option.value)}
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-[13px] text-slate-500">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="m-0 text-[14px]">Danh mục nhà cung cấp</h4>
        <p className="m-0 text-[13px] text-slate-500">
          Xóa một mục khỏi danh mục không đổi lô và phiếu đã lưu; mục đó chỉ không chọn được nữa.
        </p>
        <UnitCatalogEditor
          units={names}
          usedUnits={EMPTY_SET}
          disabled={disabled}
          noun="nhà cung cấp"
          placeholder="VD: Công ty ABC"
          onChange={setNames}
        />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="m-0 text-[14px]">Nhập từ dữ liệu cũ</h4>
            <p className="m-0 text-[13px] text-slate-500">
              Nhà cung cấp đã gõ tay ở hồ sơ mặt hàng, lô và phiếu nhập, đã gộp các cách viết khác nhau. Duyệt rồi thêm
              vào danh mục; dữ liệu cũ không bị sửa.
            </p>
          </div>
          {canManage ? (
            <Button type="button" variant="outline" disabled={legacyLoading || saving} onClick={() => void openLegacy()}>
              {legacyLoading ? 'Đang tải...' : legacy ? 'Tải lại' : 'Xem dữ liệu cũ'}
            </Button>
          ) : null}
        </div>

        {legacy ? (
          addable.length === 0 ? (
            <p className="m-0 text-sm italic text-slate-500">
              {legacy.length === 0
                ? 'Dữ liệu cũ không có nhà cung cấp nào.'
                : 'Mọi nhà cung cấp trong dữ liệu cũ đã có trong danh mục.'}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPicked(new Set(addable.map((candidate) => candidate.name)))}
                >
                  Chọn tất cả
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setPicked(new Set())}>
                  Bỏ chọn
                </Button>
                <span className="text-[13px] text-slate-500">
                  Đã chọn {picked.size} trên {addable.length}
                </span>
              </div>
              <ul className="m-0 flex max-h-72 list-none flex-col gap-1 overflow-y-auto p-0">
                {addable.map((candidate) => (
                  <li key={candidate.name}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={picked.has(candidate.name)}
                        onChange={() => togglePicked(candidate.name)}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-medium">{candidate.name}</span>
                        <span className="text-xs text-slate-500">
                          {candidate.materialCount} mặt hàng · {candidate.lotCount} lô · {candidate.transactionCount} phiếu
                          {candidate.variants.length > 1
                            ? ` · gộp ${candidate.variants.length} cách viết: ${candidate.variants.join('; ')}`
                            : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button type="button" disabled={picked.size === 0} onClick={addPicked}>
                  Thêm mục đã chọn vào danh mục
                </Button>
                <Button type="button" variant="ghost" onClick={() => setLegacy(undefined)}>
                  Đóng
                </Button>
              </div>
            </>
          )
        ) : null}
      </div>

      <FormError error={error} />
      {notice ? (
        <p role="status" className="m-0 text-[13px] text-emerald-700">
          {notice}
        </p>
      ) : null}

      {canManage ? (
        <div className="flex gap-2">
          <Button type="button" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Đang lưu...' : 'Lưu danh mục'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => {
              setNames([...(storedNames ?? [])]);
              setMode(storedMode);
              setError(undefined);
            }}
          >
            Hủy thay đổi
          </Button>
        </div>
      ) : null}
    </div>
  );
}
