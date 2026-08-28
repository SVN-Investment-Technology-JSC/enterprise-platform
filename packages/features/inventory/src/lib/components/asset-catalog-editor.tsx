'use client';

import type { InventoryCatalogSettings } from '@enterprise-platform/contracts-inventory';
import { UnitCatalogEditor } from './unit-catalog-editor';
import styles from '../inventory.module.scss';

/**
 * Admin chọn trường nào của hồ sơ thiết bị được hiện.
 *
 * Chỉ ẩn/hiện ở giao diện, KHÔNG xoá dữ liệu: tắt "giá mua" rồi bật lại thì giá
 * cũ vẫn còn nguyên. Nếu tắt mà xoá thì một cú bấm nhầm sẽ mất dữ liệu của cả
 * tenant, và không có đường hoàn tác.
 */
/** Không có mã nào "đang dùng" một trạng thái theo nghĩa chặn xoá, nên tập rỗng. */
const EMPTY: ReadonlySet<string> = new Set();

export function AssetCatalogEditor({
  value,
  disabled,
  onChange,
}: {
  value: InventoryCatalogSettings;
  disabled?: boolean;
  onChange: (next: InventoryCatalogSettings) => void;
}) {


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
        <legend>Tình trạng vật tư</legend>
        {/* Danh sách MỞ, không phải bốn ô tích cố định. Bốn giá trị dựng sẵn chỉ
            là điểm khởi đầu: đơn vị nào cần "chờ nghiệm thu" hay "niêm cất" thì
            tự thêm, không phải chờ bản mới. */}
        <p className={styles.hint}>
          Ví dụ: đang vận hành, đang dừng, đang bảo trì, chờ nghiệm thu. Để trống thì dùng bốn
          trạng thái dựng sẵn.
        </p>
        <UnitCatalogEditor
          units={value.enabledStatuses}
          usedUnits={EMPTY}
          disabled={disabled}
          noun="tình trạng"
          placeholder="VD: Chờ nghiệm thu"
          onChange={(enabledStatuses) => onChange({ ...value, enabledStatuses })}
        />
      </fieldset>

      <fieldset className={styles.catalogGroup}>
        <legend>Loại vật tư</legend>
        <p className={styles.hint}>
          Phân loại nghiệp vụ của riêng đơn vị bạn. Để trống thì cột Loại bỏ trống — không có bộ
          dựng sẵn nào đúng cho mọi ngành.
        </p>
        <UnitCatalogEditor
          units={value.types}
          usedUnits={EMPTY}
          disabled={disabled}
          noun="loại"
          placeholder="VD: Máy chính, Dụng cụ đo"
          onChange={(types) => onChange({ ...value, types })}
        />
      </fieldset>

      <fieldset className={styles.catalogGroup}>
        <legend>Vị trí vật tư</legend>
        {/* Câu hỏi ĐỘC LẬP với tình trạng: một máy có thể vừa còn tốt vừa đang
            cho mượn. Danh sách do tenant tự khai vì mỗi đơn vị gọi tên các
            trạng thái này một khác — không có bộ dựng sẵn nào đúng cho tất cả. */}
        <p className={styles.hint}>
          Ví dụ: đang vận hành, mượn thí nghiệm, gửi đi sửa, dự phòng. Để trống thì ô này không
          hiện trong hồ sơ vật tư.
        </p>
        <UnitCatalogEditor
          units={value.usageStates}
          usedUnits={EMPTY}
          disabled={disabled}
          noun="vị trí"
          placeholder="VD: Mượn thí nghiệm"
          onChange={(usageStates) => onChange({ ...value, usageStates })}
        />
      </fieldset>
    </div>
  );
}
