'use client';

/**
 * Ô chọn kho của phân hệ Kho (D3-37, mẫu ô Kho xuất của đợt giao, T4-19): kho đang hoạt động, kho đang chọn luôn có mặt
 * (kể cả đã ngừng). Có `stock` (tồn khả dụng theo kho của mặt hàng) thì mỗi kho ghi "Khả dụng n" để chọn đúng kho còn
 * hàng. Danh sách kho tải một lần trong phiên.
 */
import type { CrmWarehouseOption } from '@enterprise-platform/contracts-crm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useEffect, useState } from 'react';
import { loadWarehouses } from '../crm-api';
import { formatQuantity, warehouseOptions } from '../fulfillment.model';

let cache: Promise<CrmWarehouseOption[]> | undefined;

/** Kho của phân hệ Kho, tải một lần; lỗi thì bỏ cache để lần sau tải lại. */
export function loadWarehouseOptions(): Promise<CrmWarehouseOption[]> {
  if (!cache) {
    const next = loadWarehouses();
    next.catch(() => {
      if (cache === next) cache = undefined;
    });
    cache = next;
  }
  return cache;
}

/** Xoá cache (spec). */
export function clearWarehouseCache(): void {
  cache = undefined;
}

export function WarehouseSelect({
  value,
  onChange,
  placeholder = 'Chọn kho',
  stock,
  disabled,
  height,
  ariaLabel,
}: {
  value: string | null | undefined;
  onChange: (code: string | null) => void;
  placeholder?: string;
  /** Tồn khả dụng theo kho của mặt hàng (dòng hàng). */
  stock?: readonly { readonly warehouseCode: string; readonly available: number }[];
  disabled?: boolean;
  height?: number;
  ariaLabel?: string;
}) {
  const [warehouses, setWarehouses] = useState<readonly CrmWarehouseOption[]>([]);
  useEffect(() => {
    let active = true;
    loadWarehouseOptions()
      .then((rows) => active && setWarehouses(rows))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const available = new Map((stock ?? []).map((entry) => [entry.warehouseCode, entry.available]));
  const options = warehouseOptions(warehouses, value || null).map((option) => ({
    ...option,
    ...(stock ? { description: `Khả dụng ${formatQuantity(available.get(option.value) ?? 0)}` } : {}),
  }));
  const select = (
    <SearchableSelect
      options={options}
      value={value ?? ''}
      placeholder={placeholder}
      searchPlaceholder="Tìm theo mã hoặc tên kho"
      emptyText="Không có kho phù hợp"
      clearable
      disabled={disabled}
      height={height}
      onChange={(next) => onChange(next || null)}
    />
  );
  return ariaLabel ? (
    <span aria-label={ariaLabel} role="group">
      {select}
    </span>
  ) : (
    select
  );
}
