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

/** Bản nháp ở màn Cài đặt: bảng gợi ý theo nhóm. */
export interface TrackingSettingsDraft {
  readonly defaults: TrackingDefaultsByCategory;
}

/** Bản nháp từ cấu hình đã tải. Server cũ chưa có khoá này thì rơi về gợi ý tích hợp. */
export function trackingDraftFromSettings(settings: InventorySettingsSnapshot | undefined): TrackingSettingsDraft {
  return {
    defaults: settings?.['tracking.defaultByCategory']?.value ?? DEFAULT_TRACKING_BY_CATEGORY,
  };
}

const CATEGORIES: readonly MaterialCategory[] = ['SPARE_PART', 'CONSUMABLE', 'TOOL', 'ROTABLE'];

const MODE_OPTIONS = MATERIAL_TRACKING_MODES.map((mode) => ({
  value: mode,
  label: MATERIAL_TRACKING_LABEL[mode],
}));

const FIELDSET =
  'm-0 mt-1 flex min-w-0 flex-col gap-[0.65rem] rounded-xl border border-slate-200 bg-white px-5 py-[1.1rem] shadow-sm [&>legend]:inline-flex [&>legend]:items-center [&>legend]:gap-1.5 [&>legend]:px-2 [&>legend]:text-sm [&>legend]:font-semibold [&>legend]:text-slate-800';

/**
 * Lô, serial là thuộc tính của từng mặt hàng, chọn lúc tạo mặt hàng (không còn công tắc toàn tenant).
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
