'use client';

import { useCallback, useEffect, useState } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

type Settings = {
  calendar: {
    id: string;
    work_date: string;
    name: string;
    day_kind: string;
    paid: boolean;
  }[];
  sites: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radius_meters: number;
  }[];
  devices: { id: string; full_name: string; name: string; status: string }[];
  versions: {
    id: string;
    version_no: number;
    effective_from: string;
    effective_to: string | null;
    config_json: Record<string, unknown>;
  }[];
};
const today = () => new Date().toLocaleDateString('en-CA');
export default function TimeSettingsScreen() {
  const [data, setData] = useState<Settings>({
    calendar: [],
    sites: [],
    devices: [],
    versions: [],
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'policy' | 'calendar' | 'site' | null>(
    null,
  );
  const [policy, setPolicy] = useState({
    effectiveFrom: today(),
    timezone: 'Asia/Ho_Chi_Minh',
    requireIp: false,
    allowedIps: '',
    requireGps: false,
    maxGpsAccuracyMeters: 100,
    requireDevice: false,
  });
  const [calendar, setCalendar] = useState({
    date: today(),
    kind: 'HOLIDAY',
    name: '',
    paid: true,
  });
  const [site, setSite] = useState({
    name: '',
    latitude: 0,
    longitude: 0,
    radiusMeters: 100,
  });
  const load = useCallback(async () => {
    try {
      const result = await hrmFetch<{ data: Settings }>('/time-settings');
      setData(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được cấu hình');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function save(path: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      await hrmFetch(path, { method: 'POST', body: JSON.stringify(body) });
      await load();
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được cấu hình');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Quy định công và thiết bị</h1>
        <p className="text-sm text-slate-500">
          Phiên bản theo ngày hiệu lực, lịch nghỉ và điều kiện ghi nhận chấm
          công.
        </p>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-red-700"
        >
          {error}
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="space-y-3 rounded-xl border bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Chính sách chấm công</h2>
            <Button
              permission="hrm.time.configure"
              onClick={() => setDialog('policy')}
            >
              Thêm phiên bản
            </Button>
          </div>
          {data.versions.length === 0 && (
            <p className="text-sm text-slate-500">
              Chưa cấu hình điều kiện IP, GPS hoặc thiết bị.
            </p>
          )}
          {data.versions.map((v) => (
            <article key={v.id} className="border-t py-3 text-sm">
              <strong>Phiên bản {v.version_no}</strong>
              <p>
                {v.effective_from.slice(0, 10)} —{' '}
                {v.effective_to?.slice(0, 10) || 'Chưa kết thúc'}
              </p>
              <p>
                {String(v.config_json.timezone)} · IP:{' '}
                {v.config_json.requireIp ? 'Bắt buộc' : 'Không'} · GPS:{' '}
                {v.config_json.requireGps ? 'Bắt buộc' : 'Không'} · Thiết bị:{' '}
                {v.config_json.requireDevice ? 'Đã duyệt' : 'Không yêu cầu'}
              </p>
            </article>
          ))}
        </section>
        <section className="space-y-3 rounded-xl border bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Lịch ngày làm / OFF / lễ</h2>
            <Button
              permission="hrm.time.configure"
              onClick={() => setDialog('calendar')}
            >
              Cấu hình ngày
            </Button>
          </div>
          <div className="max-h-80 overflow-auto">
            {data.calendar.length === 0 ? (
              <p className="text-sm text-slate-500">
                Chưa khai báo ngày ngoại lệ.
              </p>
            ) : (
              data.calendar.map((d) => (
                <p key={d.id} className="border-t py-3 text-sm">
                  {d.work_date.slice(0, 10)} · {d.name} · {d.day_kind} ·{' '}
                  {d.paid ? 'Hưởng lương' : 'Không hưởng lương'}
                </p>
              ))
            )}
          </div>
        </section>
        <section className="space-y-3 rounded-xl border bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Địa điểm chấm công</h2>
            <Button
              permission="hrm.time.configure"
              onClick={() => setDialog('site')}
            >
              Thêm địa điểm
            </Button>
          </div>
          {data.sites.map((s) => (
            <p key={s.id} className="border-t py-3 text-sm">
              {s.name} · {s.latitude}, {s.longitude} · Bán kính{' '}
              {s.radius_meters} m
            </p>
          ))}
        </section>
        <section className="space-y-3 rounded-xl border bg-white p-5">
          <h2 className="font-semibold">Thiết bị đăng ký</h2>
          <p className="text-sm text-slate-500">
            Duyệt thiết bị mới sẽ thu hồi thiết bị đang hoạt động của nhân viên.
            Định danh gắn với trình duyệt đã đăng ký.
          </p>
          <div className="max-h-80 overflow-auto">
            {data.devices.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 border-t py-3"
              >
                <div className="text-sm">
                  <strong>{d.full_name}</strong>
                  <p>
                    {d.name} · {d.status}
                  </p>
                </div>
                {d.status === 'PENDING' && (
                  <Button
                    permission="hrm.device.manage"
                    disabled={busy}
                    onClick={() =>
                      void save(`/time-settings/devices/${d.id}/approve`, {})
                    }
                  >
                    Duyệt thiết bị
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === 'policy'
                ? 'Phiên bản chính sách'
                : dialog === 'calendar'
                  ? 'Lịch làm việc'
                  : 'Địa điểm chấm công'}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (dialog === 'policy')
                void save('/time-settings/policy', {
                  ...policy,
                  allowedIps: policy.allowedIps
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              else if (dialog === 'calendar')
                void save('/time-settings/calendar', calendar);
              else void save('/time-settings/sites', site);
            }}
          >
            {dialog === 'policy' && (
              <>
                <label className="block text-sm">
                  Hiệu lực từ
                  <Input
                    type="date"
                    required
                    value={policy.effectiveFrom}
                    onChange={(e) =>
                      setPolicy({ ...policy, effectiveFrom: e.target.value })
                    }
                  />
                </label>
                <label className="block text-sm">
                  Múi giờ
                  <Input
                    required
                    value={policy.timezone}
                    onChange={(e) =>
                      setPolicy({ ...policy, timezone: e.target.value })
                    }
                  />
                </label>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={policy.requireIp}
                    onChange={(e) =>
                      setPolicy({ ...policy, requireIp: e.target.checked })
                    }
                  />
                  Yêu cầu IP được phép
                </label>
                <label className="block text-sm">
                  Các IP chính xác, phân cách dấu phẩy
                  <Input
                    value={policy.allowedIps}
                    onChange={(e) =>
                      setPolicy({ ...policy, allowedIps: e.target.value })
                    }
                  />
                </label>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={policy.requireGps}
                    onChange={(e) =>
                      setPolicy({ ...policy, requireGps: e.target.checked })
                    }
                  />
                  Yêu cầu GPS trong bán kính
                </label>
                <label className="block text-sm">
                  Sai số GPS tối đa (m)
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={policy.maxGpsAccuracyMeters}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        maxGpsAccuracyMeters: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={policy.requireDevice}
                    onChange={(e) =>
                      setPolicy({ ...policy, requireDevice: e.target.checked })
                    }
                  />
                  Một trình duyệt chấm công đã duyệt cho mỗi nhân viên
                </label>
              </>
            )}
            {dialog === 'calendar' && (
              <>
                <label className="block text-sm">
                  Ngày
                  <Input
                    type="date"
                    required
                    value={calendar.date}
                    onChange={(e) =>
                      setCalendar({ ...calendar, date: e.target.value })
                    }
                  />
                </label>
                <label className="block text-sm">
                  Tên ngày
                  <Input
                    required
                    value={calendar.name}
                    onChange={(e) =>
                      setCalendar({ ...calendar, name: e.target.value })
                    }
                  />
                </label>
                <SearchableSelect
                  value={calendar.kind}
                  onChange={(kind) =>
                    setCalendar({ ...calendar, kind: kind || 'HOLIDAY' })
                  }
                  options={[
                    { value: 'WORK', label: 'Ngày làm' },
                    { value: 'OFF', label: 'OFF' },
                    { value: 'HOLIDAY', label: 'Lễ / Tết' },
                  ]}
                />
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={calendar.paid}
                    onChange={(e) =>
                      setCalendar({ ...calendar, paid: e.target.checked })
                    }
                  />
                  Hưởng lương
                </label>
              </>
            )}
            {dialog === 'site' && (
              <>
                <label className="block text-sm">
                  Tên địa điểm
                  <Input
                    required
                    value={site.name}
                    onChange={(e) => setSite({ ...site, name: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Vĩ độ
                  <Input
                    required
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    value={site.latitude}
                    onChange={(e) =>
                      setSite({ ...site, latitude: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="block text-sm">
                  Kinh độ
                  <Input
                    required
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    value={site.longitude}
                    onChange={(e) =>
                      setSite({ ...site, longitude: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="block text-sm">
                  Bán kính (m)
                  <Input
                    required
                    type="number"
                    min={1}
                    max={100000}
                    value={site.radiusMeters}
                    onChange={(e) =>
                      setSite({ ...site, radiusMeters: Number(e.target.value) })
                    }
                  />
                </label>
              </>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu cấu hình'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
