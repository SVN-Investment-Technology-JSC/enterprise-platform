'use client';

import { useCallback, useEffect, useState } from 'react';
import { SearchableSelect, Popconfirm } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
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
    updated_at: string;
  }[];
  sites: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radius_meters: number;
    active: boolean;
    updated_at: string;
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
  const [action, setAction] = useState<HrmAction | null>(null);
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
    setError('');
    try {
      const result = await hrmFetch<{ data: Settings }>('/time-settings');
      setData(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được cấu hình');
    }
  }, []);
  async function mutate(path: string, method: string, body: unknown) {
    await hrmFetch(path, { method, body: JSON.stringify(body) });
    await load();
  }
  function editSite(row: Settings['sites'][number]) {
    setAction({
      title: 'Cập nhật địa điểm chấm công',
      columns: 2,
      fields: [
        { key: 'name', label: 'Tên địa điểm', value: row.name },
        {
          key: 'latitude',
          label: 'Vĩ độ',
          type: 'number',
          min: -90,
          max: 90,
          step: 'any',
          value: row.latitude,
        },
        {
          key: 'longitude',
          label: 'Kinh độ',
          type: 'number',
          min: -180,
          max: 180,
          step: 'any',
          value: row.longitude,
        },
        {
          key: 'radiusMeters',
          label: 'Bán kính (m)',
          type: 'number',
          min: 1,
          max: 100000,
          value: row.radius_meters,
        },
        { key: 'reason', label: 'Lý do thay đổi' },
      ],
      submit: async (v) =>
        mutate(`/time-settings/sites/${row.id}`, 'PATCH', {
          ...v,
          latitude: Number(v.latitude),
          longitude: Number(v.longitude),
          radiusMeters: Number(v.radiusMeters),
          expectedUpdatedAt: row.updated_at,
        }),
    });
  }
  function editDay(row: Settings['calendar'][number]) {
    setAction({
      title: `Cập nhật ngày ${row.work_date.slice(0, 10)}`,
      columns: 2,
      fields: [
        { key: 'name', label: 'Tên ngày / sự kiện', value: row.name },
        {
          key: 'kind',
          label: 'Loại ngày',
          value: row.day_kind,
          options: [
            { value: 'WORK', label: 'Làm việc' },
            { value: 'OFF', label: 'Nghỉ' },
            { value: 'HOLIDAY', label: 'Lễ / Tết' },
          ],
        },
        {
          key: 'paid',
          label: 'Hưởng lương',
          value: String(row.paid),
          options: [
            { value: 'true', label: 'Có' },
            { value: 'false', label: 'Không' },
          ],
        },
        { key: 'reason', label: 'Lý do thay đổi' },
      ],
      submit: async (v) =>
        mutate('/time-settings/calendar', 'POST', {
          ...v,
          date: row.work_date.slice(0, 10),
          paid: v.paid === 'true',
          expectedUpdatedAt: row.updated_at,
        }),
    });
  }
  function remove(
    row: { id: string; updated_at: string },
    kind: 'calendar' | 'sites',
  ) {
    setAction({
      title: kind === 'calendar' ? 'Xóa ngày ngoại lệ' : 'Ngừng địa điểm',
      confirmTitle: 'Xác nhận thay đổi cấu hình?',
      description:
        'Giữ lịch sử và chứng cứ đã ghi nhận. Kỳ công mở bị ảnh hưởng phải tính lại.',
      fields: [{ key: 'reason', label: 'Lý do' }],
      submit: async (v) =>
        mutate(
          `/time-settings/${kind}/${row.id}${kind === 'sites' ? '/deactivate' : ''}`,
          kind === 'sites' ? 'POST' : 'DELETE',
          { ...v, expectedUpdatedAt: row.updated_at },
        ),
    });
  }
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
          <Table<Settings['calendar'][number]>
            size="small"
            rowKey="id"
            dataSource={data.calendar}
            scroll={{ x: 660, y: 300 }}
            pagination={{ pageSize: 10 }}
            columns={[
              {
                title: 'Ngày',
                dataIndex: 'work_date',
                width: 110,
                render: (v) => v.slice(0, 10),
              },
              { title: 'Tên', dataIndex: 'name', width: 200 },
              { title: 'Loại', dataIndex: 'day_kind', width: 90 },
              {
                title: 'Hưởng lương',
                dataIndex: 'paid',
                width: 110,
                render: (v) => (v ? 'Có' : 'Không'),
              },
              {
                title: 'Thao tác',
                width: 150,
                fixed: 'right',
                render: (_, r) => (
                  <span className="inline-flex gap-1">
                    <Button
                      permission="hrm.time.configure"
                      size="sm"
                      variant="outline"
                      onClick={() => editDay(r)}
                    >
                      Sửa
                    </Button>
                    <Button
                      permission="hrm.time.configure"
                      size="sm"
                      variant="outline"
                      onClick={() => remove(r, 'calendar')}
                    >
                      Xóa
                    </Button>
                  </span>
                ),
              },
            ]}
          />
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
          <Table<Settings['sites'][number]>
            size="small"
            rowKey="id"
            dataSource={data.sites}
            scroll={{ x: 700, y: 300 }}
            pagination={{ pageSize: 10 }}
            columns={[
              { title: 'Địa điểm', dataIndex: 'name', width: 190 },
              {
                title: 'Tọa độ',
                width: 160,
                render: (_, r) => `${r.latitude}, ${r.longitude}`,
              },
              {
                title: 'Bán kính',
                dataIndex: 'radius_meters',
                width: 100,
                render: (v) => `${v} m`,
              },
              {
                title: 'Trạng thái',
                dataIndex: 'active',
                width: 100,
                render: (v) => (v ? 'Đang dùng' : 'Đã ngừng'),
              },
              {
                title: 'Thao tác',
                width: 150,
                fixed: 'right',
                render: (_, r) =>
                  r.active ? (
                    <span className="inline-flex gap-1">
                      <Button
                        permission="hrm.time.configure"
                        size="sm"
                        variant="outline"
                        onClick={() => editSite(r)}
                      >
                        Sửa
                      </Button>
                      <Button
                        permission="hrm.time.configure"
                        size="sm"
                        variant="outline"
                        onClick={() => remove(r, 'sites')}
                      >
                        Ngừng
                      </Button>
                    </span>
                  ) : null,
              },
            ]}
          />
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
                  <Popconfirm
                    title="Duyệt thiết bị mới và thu hồi thiết bị cũ?"
                    onConfirm={() =>
                      save(`/time-settings/devices/${d.id}/approve`, {})
                    }
                  >
                    <Button permission="hrm.device.manage" disabled={busy}>
                      Duyệt thiết bị
                    </Button>
                  </Popconfirm>
                )}
                {d.status !== 'REVOKED' && (
                  <Popconfirm
                    title="Thu hồi thiết bị chấm công?"
                    onConfirm={() =>
                      save(`/time-settings/devices/${d.id}/revoke`, {})
                    }
                  >
                    <Button
                      permission="hrm.device.manage"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                    >
                      Thu hồi
                    </Button>
                  </Popconfirm>
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
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </main>
  );
}
