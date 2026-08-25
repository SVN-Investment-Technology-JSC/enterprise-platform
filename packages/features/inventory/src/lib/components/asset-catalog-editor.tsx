'use client';

import type { InventoryCatalogSettings } from '@enterprise-platform/contracts-inventory';
import { ASSET_STATUS_LABEL } from '../inventory-labels';
import styles from '../inventory.module.scss';

/**
 * Admin chọn trường nào của hồ sơ thiết bị được hiện.
 *
 * Chỉ ẩn/hiện ở giao diện, KHÔNG xoá dữ liệu: tắt "giá mua" rồi bật lại thì giá
 * cũ vẫn còn nguyên. Nếu tắt mà xoá thì một cú bấm nhầm sẽ mất dữ liệu của cả
 * tenant, và không có đường hoàn tác.
 */
export function AssetCatalogEditor({
  value,
  disabled,
  onChange,
}: {
  value: InventoryCatalogSettings;
  disabled?: boolean;
  onChange: (next: InventoryCatalogSettings) => void;
}) {
  const toggleStatus = (status: string, on: boolean) => {
    const enabled = new Set(value.enabledStatuses);
    if (on) enabled.add(status);
    else enabled.delete(status);
    onChange({ ...value, enabledStatuses: [...enabled] });
  };

  // Danh sách rỗng nghĩa là "bật hết" — tenant chưa đụng tới cấu hình vẫn thấy
  // đủ mọi trạng thái, thay vì thấy một danh sách trống.
  const statusOn = (status: string) =>
    value.enabledStatuses.length === 0 || value.enabledStatuses.includes(status);

  return (
    <div className={styles.catalogEditor}>
      <label className={styles.catalogToggle}>
        <input
          type="checkbox"
          checked={value.priceFieldsEnabled}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, priceFieldsEnabled: event.target.checked })}
        />
        Hiện giá mua và mã tiền tệ
      </label>

      <label className={styles.catalogToggle}>
        <input
          type="checkbox"
          checked={value.warrantyFieldsEnabled}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, warrantyFieldsEnabled: event.target.checked })}
        />
        Hiện hạn bảo hành
      </label>

      <fieldset className={styles.catalogGroup}>
        <legend>Trạng thái thiết bị được dùng</legend>
        {Object.entries(ASSET_STATUS_LABEL).map(([status, label]) => (
          <label key={status} className={styles.catalogToggle}>
            <input
              type="checkbox"
              checked={statusOn(status)}
              disabled={disabled}
              onChange={(event) => toggleStatus(status, event.target.checked)}
            />
            {label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
