'use client';
/** Hộp thoại thêm địa điểm chấm công GPS: một cột khi hẹp, vĩ độ và kinh độ cạnh nhau khi đủ rộng. Chỉ lo giao diện. */
import { useId } from 'react';
import { Button } from '../button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { Input } from '../input';
import { SettingsField } from '../settings-kit';

export interface SiteFormState {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export function SiteDialog({
  open,
  busy,
  site,
  setSite,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  site: SiteFormState;
  setSite: (next: SiteFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const uid = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] gap-0 bg-white p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-5 py-4 pr-12">
          <DialogTitle>Thêm địa điểm chấm công</DialogTitle>
          <DialogDescription>Nhân viên chấm công trong bán kính quanh tọa độ này được coi là hợp lệ.</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="@container min-h-0 flex-1 overflow-y-auto p-4 @xl:p-5">
            <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
              <SettingsField label="Tên địa điểm" required htmlFor={`${uid}-name`} className="@sm:col-span-2">
                <Input
                  id={`${uid}-name`}
                  required
                  className="h-9 text-xs"
                  value={site.name}
                  onChange={(e) => setSite({ ...site, name: e.target.value })}
                />
              </SettingsField>
              <SettingsField label="Vĩ độ" required htmlFor={`${uid}-lat`} hint="Từ -90 đến 90.">
                <Input
                  id={`${uid}-lat`}
                  required
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  className="h-9 text-xs"
                  value={site.latitude}
                  onChange={(e) => setSite({ ...site, latitude: Number(e.target.value) })}
                />
              </SettingsField>
              <SettingsField label="Kinh độ" required htmlFor={`${uid}-lng`} hint="Từ -180 đến 180.">
                <Input
                  id={`${uid}-lng`}
                  required
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                  className="h-9 text-xs"
                  value={site.longitude}
                  onChange={(e) => setSite({ ...site, longitude: Number(e.target.value) })}
                />
              </SettingsField>
              <SettingsField
                label="Bán kính (m)"
                required
                htmlFor={`${uid}-radius`}
                hint="Từ 1 đến 100000 m."
                className="@sm:col-span-2"
              >
                <Input
                  id={`${uid}-radius`}
                  required
                  type="number"
                  min={1}
                  max={100000}
                  className="h-9 text-xs"
                  value={site.radiusMeters}
                  onChange={(e) => setSite({ ...site, radiusMeters: Number(e.target.value) })}
                />
              </SettingsField>
            </div>
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose} className="h-9 px-4 text-xs">
              Hủy
            </Button>
            <Button type="submit" disabled={busy} className="h-9 px-4 text-xs font-semibold">
              {busy ? 'Đang lưu…' : 'Lưu địa điểm'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
