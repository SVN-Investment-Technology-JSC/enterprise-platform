'use client';

import {
  isSupplierCatalogEnforced,
  type InventorySettingsSnapshot,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { createContext, useContext, useMemo } from 'react';
import { Input } from './ui/input';

/** Hộp thoại nhập kho hiện thông báo này khi không tìm thấy nhà cung cấp trong danh mục. */
export const SUPPLIER_NOT_IN_CATALOG_HINT =
  'Chưa có trong danh mục. Nhờ người quản lý thêm ở Cài đặt';

export interface SupplierInputState {
  /** Tên chuẩn trong danh mục, theo thứ tự đã khai. */
  readonly names: readonly string[];
  /**
   * Chỉ được chọn từ danh mục. Khớp quy tắc của server: chọn `CATALOG_ONLY` và danh mục không rỗng. Danh mục
   * rỗng thì vẫn nhập tự do, để tenant chưa khai danh mục không bị chặn nhập kho.
   */
  readonly enforced: boolean;
}

export const FREE_SUPPLIER_INPUT: SupplierInputState = { names: [], enforced: false };

/** Dựng trạng thái nhập nhà cung cấp từ cấu hình đã tải; chưa tải thì nhập tự do như trước. */
export function supplierInputState(
  settings: Pick<InventorySettingsSnapshot, 'catalog.supplier' | 'supplier.input'> | undefined,
): SupplierInputState {
  const names = settings?.['catalog.supplier']?.value.suppliers ?? [];
  const mode = settings?.['supplier.input']?.value.mode ?? 'CATALOG_ONLY';
  return { names, enforced: isSupplierCatalogEnforced(names, mode) };
}

const SupplierInputContext = createContext<SupplierInputState>(FREE_SUPPLIER_INPUT);

export const SupplierInputProvider = SupplierInputContext.Provider;

/** Quy tắc nhập nhà cung cấp của tenant; ngoài Provider thì nhập tự do. */
export const useSupplierInput = () => useContext(SupplierInputContext);

/**
 * Ô nhập nhà cung cấp.
 *
 * Đang chặn thì chỉ chọn được từ danh mục (không có thêm nhanh: nhà cung cấp mới do người quản lý thêm ở
 * Cài đặt). Không chặn thì là ô chữ tự do như cũ. Giá trị cũ ngoài danh mục vẫn hiện được để người dùng thấy
 * mình đang sửa gì; server mới là nơi từ chối.
 */
export function SupplierField({
  value,
  onChange,
  disabled,
  placeholder,
  maxLength,
  height,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  height?: number;
}) {
  const { names, enforced } = useSupplierInput();
  const options = useMemo(() => {
    const list = names.map((name) => ({ value: name, label: name }));
    const trimmed = value.trim();
    // Giá trị đang có mà không nằm trong danh mục (dữ liệu cũ) vẫn phải hiện trong ô.
    if (trimmed && !names.includes(trimmed)) list.unshift({ value: trimmed, label: trimmed });
    return list;
  }, [names, value]);

  if (!enforced) {
    return (
      <Input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
      />
    );
  }
  return (
    <SearchableSelect
      options={options}
      value={value}
      placeholder={placeholder ?? 'Chọn nhà cung cấp từ danh mục...'}
      searchPlaceholder="Tìm nhà cung cấp..."
      emptyText={SUPPLIER_NOT_IN_CATALOG_HINT}
      onChange={onChange}
      clearable
      disabled={disabled}
      height={height}
    />
  );
}
