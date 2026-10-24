'use client';
/**
 * Thẻ cài đặt kiểm tra vị trí khi chấm công của cả tenant: bật/tắt, và sai số GPS tối đa chấp nhận. Địa điểm và phòng ban
 * được gán nằm ở danh sách bên dưới. Chỉ lo giao diện: việc lưu nằm ở màn hình cha.
 */
import { useId, useState } from 'react';
import { Button } from '../button';
import { Input } from '../input';
import { InfoNote, SettingsField, SettingsSwitch } from '../settings-kit';
import type { LocationSettings } from './time-settings-model';

export function LocationCard({
  value,
  canConfigure,
  busy,
  activeSites,
  onSave,
}: {
  value: LocationSettings;
  canConfigure: boolean;
  busy: boolean;
  /** Số địa điểm đang dùng: bật kiểm tra vị trí khi chưa có địa điểm nào sẽ khoá mọi nhân viên nên bị chặn. */
  activeSites: number;
  onSave: (next: { locationCheck: boolean; maxGpsAccuracyMeters: number }) => void;
}) {
  const uid = useId();
  const [locationCheck, setLocationCheck] = useState(value.locationCheck);
  const [accuracy, setAccuracy] = useState(value.maxGpsAccuracyMeters);
  const dirty = locationCheck !== value.locationCheck || accuracy !== value.maxGpsAccuracyMeters;
  const accuracyOk = Number.isInteger(accuracy) && accuracy >= 1 && accuracy <= 1000;
  const blocked = locationCheck && activeSites === 0;

  return (
    <section aria-label="Kiểm tra vị trí khi chấm công" className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 @xl:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight text-slate-900">Kiểm tra vị trí khi chấm công</h2>
          <p className="mt-0.5 max-w-prose text-xs text-slate-500">
            Bật thì nhân viên chỉ chấm công được khi nằm trong bán kính của một địa điểm được gán cho họ (và đúng IP của địa
            điểm đó nếu có khai báo).
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <span>{locationCheck ? 'Đang bật' : 'Đang tắt'}</span>
          <SettingsSwitch
            label="Kiểm tra vị trí khi chấm công"
            checked={locationCheck}
            disabled={!canConfigure || busy}
            onChange={setLocationCheck}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <SettingsField label="Sai số GPS tối đa (m)" htmlFor={`${uid}-acc`} hint="Từ 1 đến 1000 m. Vị trí kém chính xác hơn sẽ bị từ chối." className="w-56">
          <Input
            id={`${uid}-acc`}
            type="number"
            min={1}
            max={1000}
            className="h-9 text-xs"
            disabled={!canConfigure || busy}
            value={accuracy}
            onChange={(e) => setAccuracy(Number(e.target.value))}
          />
        </SettingsField>
        <Button
          type="button"
          disabled={!canConfigure || busy || !dirty || !accuracyOk || blocked}
          onClick={() => onSave({ locationCheck, maxGpsAccuracyMeters: accuracy })}
          className="h-9 px-4 text-xs font-semibold"
        >
          {busy ? 'Đang lưu…' : 'Lưu cài đặt'}
        </Button>
      </div>
      {blocked ? (
        <InfoNote tone="amber" className="mt-3">
          Cần thêm ít nhất một địa điểm đang dùng trước khi bật kiểm tra vị trí.
        </InfoNote>
      ) : null}
      {value.legacyPolicy ? (
        <InfoNote tone="amber" className="mt-3">
          Đơn vị đang kiểm chấm công theo IP của cấu hình cũ. Khai báo địa điểm GPS (kèm IP) rồi lưu cài đặt này để chuyển sang
          cách mới; cấu hình IP cũ sẽ không còn dùng sau khi chuyển.
        </InfoNote>
      ) : null}
    </section>
  );
}
