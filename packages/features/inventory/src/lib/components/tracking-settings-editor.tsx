'use client';

import {
  DEFAULT_TRACKING_BY_CATEGORY,
  MATERIAL_TRACKING_MODES,
  isMaterialTrackingMode,
  type InventorySettingsSnapshot,
  type MaterialCategory,
  type MaterialTrackingMode,
  type TrackingDefaultsByCategory,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { MATERIAL_CATEGORY_LABEL, MATERIAL_TRACKING_LABEL } from '../inventory-labels';

/** Bản nháp ở màn Cài đặt: hai công tắc và bảng gợi ý theo nhóm. */
export interface TrackingSettingsDraft {
  readonly lotEnabled: boolean;
  readonly serialEnabled: boolean;
  readonly defaults: TrackingDefaultsByCategory;
}

/** Bản nháp từ cấu hình đã tải. Server cũ chưa có ba khoá này thì rơi về mặc định (tắt, gợi ý tích hợp). */
export function trackingDraftFromSettings(settings: InventorySettingsSnapshot | undefined): TrackingSettingsDraft {
  return {
    lotEnabled: settings?.['tracking.lot.enabled']?.value.enabled === true,
    serialEnabled: settings?.['tracking.serial.enabled']?.value.enabled === true,
    defaults: settings?.['tracking.defaultByCategory']?.value ?? DEFAULT_TRACKING_BY_CATEGORY,
  };
}

const CATEGORIES: readonly MaterialCategory[] = ['SPARE_PART', 'CONSUMABLE', 'TOOL', 'ROTABLE'];

const MODE_OPTIONS = MATERIAL_TRACKING_MODES.map((mode) => ({
  value: mode,
  label: MATERIAL_TRACKING_LABEL[mode],
}));

const CHECKBOX_LABEL =
  'inline-flex cursor-pointer select-none items-start gap-[0.65rem] text-sm font-medium text-slate-700 hover:text-slate-900 [&_input[type=checkbox]]:mt-0.5 [&_input[type=checkbox]]:size-4 [&_input[type=checkbox]]:cursor-pointer [&_input[type=checkbox]]:accent-primary';

const FIELDSET =
  'm-0 mt-1 flex min-w-0 flex-col gap-[0.65rem] rounded-xl border border-slate-200 bg-white px-5 py-[1.1rem] shadow-sm [&>legend]:inline-flex [&>legend]:items-center [&>legend]:gap-1.5 [&>legend]:px-2 [&>legend]:text-sm [&>legend]:font-semibold [&>legend]:text-slate-800';

/**
 * Quản lý theo lô và theo serial là tuỳ chọn của tenant, mặc định tắt. Tắt thì form hàng hóa không hiện lựa
 * chọn đó và server từ chối đặt cách theo dõi tương ứng. Còn mặt hàng đang theo dõi kiểu đó mà có tồn thì
 * server không cho tắt.
 *
 * Bảng gợi ý theo nhóm chỉ là giá trị điền sẵn lúc tạo mặt hàng: đổi nhóm sau đó không đổi cách theo dõi.
 */
export function TrackingSettingsEditor({
  value,
  disabled,
  onChange,
}: {
  value: TrackingSettingsDraft;
  disabled?: boolean;
  onChange: (next: TrackingSettingsDraft) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <label className={CHECKBOX_LABEL}>
        <input
          type="checkbox"
          checked={value.lotEnabled}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, lotEnabled: event.target.checked })}
        />
        <span>
          Quản lý theo lô
          <small className="block text-xs font-normal text-slate-500">
            Nhiều lần nhập cùng thông tin gom thành một lô; có hạn dùng, kiểm định (dầu, hoá chất, đinh, vít...).
          </small>
        </span>
      </label>

      <label className={CHECKBOX_LABEL}>
        <input
          type="checkbox"
          checked={value.serialEnabled}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, serialEnabled: event.target.checked })}
        />
        <span>
          Quản lý theo serial
          <small className="block text-xs font-normal text-slate-500">
            Mỗi cái, chiếc có số serial riêng và lịch sử riêng (máy bơm, động cơ, thiết bị đo).
          </small>
        </span>
      </label>

      <fieldset className={FIELDSET}>
        <legend>Gợi ý theo nhóm</legend>
        <p className="m-0 mb-1 text-[13px] leading-normal text-slate-500">
          Khi tạo mặt hàng mới và chọn nhóm, ô Cách theo dõi được điền sẵn theo bảng này. Người dùng vẫn đổi được, và
          đổi nhóm sau khi tạo không làm đổi cách theo dõi.
        </p>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3 max-sm:grid-cols-1">
          {CATEGORIES.map((category) => (
            <label key={category} className="flex flex-col gap-1 text-xs font-bold text-slate-500">
              {MATERIAL_CATEGORY_LABEL[category]}
              <SearchableSelect
                options={MODE_OPTIONS}
                value={value.defaults[category]}
                placeholder="Chọn cách theo dõi"
                emptyText="Không có lựa chọn phù hợp"
                disabled={disabled}
                onChange={(next) => {
                  if (!isMaterialTrackingMode(next)) return;
                  onChange({
                    ...value,
                    defaults: { ...value.defaults, [category]: next as MaterialTrackingMode },
                  });
                }}
                className="w-full"
              />
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
