'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchableSelect, Popconfirm } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import {
  Sliders,
  AlertTriangle,
} from 'lucide-react';
import { useHrmPermissions } from '../hrm-permissions';
import { resolveTimeSettingsTab } from '../hrm-navigation';
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
    policy_code?: string;
    policy_name?: string;
  }[];
  holidayStatus?: {
    year: number;
    count: number;
    missing: boolean;
    warning: string | null;
    templateLabel: string;
  };
};
type HolidayDraftItem = {
  date: string | null;
  name: string;
  paid: boolean;
  note: string;
  exists: boolean;
};
type EmployeeOption = { employeeId: string; fullName: string; employeeCode?: string };
const today = () => new Date().toLocaleDateString('en-CA');

type PolicyVersion = Settings['versions'][number];
const versionEmployees = (v: PolicyVersion) =>
  Array.isArray(v.config_json.employeeIds)
    ? (v.config_json.employeeIds as string[])
    : [];
/** Trang thai tinh theo ngay, khong dua vao cot status. */
function versionStatusLabel(v: PolicyVersion, day: string) {
  const from = v.effective_from.slice(0, 10);
  const to = v.effective_to?.slice(0, 10) ?? null;
  if (from > day) return 'Chưa hiệu lực';
  if (to && to < day) return 'Hết hiệu lực';
  return 'Đang áp dụng';
}
const addDays = (date: string, delta: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

const TIME_SETTINGS_TABS = [
  { id: 'rules', label: 'Quy định chấm công', permission: 'time' },
  { id: 'calendar', label: 'Lịch làm / OFF / lễ', permission: 'time' },
  { id: 'sites', label: 'Địa điểm GPS', permission: 'time' },
  { id: 'devices', label: 'Thiết bị', permission: 'device' },
] as const;

type TimeSettingsTab = (typeof TIME_SETTINGS_TABS)[number]['id'];

export default function TimeSettingsScreen() {
  const { can } = useHrmPermissions();
  const allowedTabs = TIME_SETTINGS_TABS.filter((tab) =>
    tab.permission === 'time'
      ? can('hrm.time.configure')
      : can('hrm.device.manage'),
  );
  const allowedTabIds = allowedTabs.map((tab) => tab.id);
  const [requestedTab, setRequestedTab] = useState<string | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const activeTab = resolveTimeSettingsTab(
    requestedTab,
    allowedTabIds,
  ) as TimeSettingsTab | '';
  const [calendarSearch, setCalendarSearch] = useState('');
  const [siteSearch, setSiteSearch] = useState('');
  const [deviceSearch, setDeviceSearch] = useState('');

  useEffect(() => {
    const sync = () => {
      setRequestedTab(new URLSearchParams(window.location.search).get('tab'));
      setUrlReady(true);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const selectTab = useCallback((tab: TimeSettingsTab) => {
    setRequestedTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    if (urlReady && activeTab && requestedTab !== activeTab) {
      selectTab(activeTab);
    }
  }, [activeTab, requestedTab, selectTab, urlReady]);

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
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
  const [holidayLabel, setHolidayLabel] = useState('');
  const [holidayItems, setHolidayItems] = useState<HolidayDraftItem[]>([]);
  const [holidayReason, setHolidayReason] = useState('');
  const [policy, setPolicy] = useState({
    effectiveFrom: today(),
    effectiveTo: '',
    reason: '',
    scope: 'ALL' as 'ALL' | 'EMPLOYEES',
    employeeIds: [] as string[],
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
  const filteredCalendar = useMemo(() => {
    const query = calendarSearch.trim().toLocaleLowerCase('vi');
    if (!query) return data.calendar;
    return data.calendar.filter((row) =>
      [row.work_date, row.name, row.day_kind].some((value) =>
        value.toLocaleLowerCase('vi').includes(query),
      ),
    );
  }, [calendarSearch, data.calendar]);
  const filteredSites = useMemo(() => {
    const query = siteSearch.trim().toLocaleLowerCase('vi');
    if (!query) return data.sites;
    return data.sites.filter((row) =>
      [row.name, String(row.latitude), String(row.longitude)].some((value) =>
        value.toLocaleLowerCase('vi').includes(query),
      ),
    );
  }, [data.sites, siteSearch]);
  const filteredDevices = useMemo(() => {
    const query = deviceSearch.trim().toLocaleLowerCase('vi');
    if (!query) return data.devices;
    return data.devices.filter((row) =>
      [row.full_name, row.name, row.status].some((value) =>
        value.toLocaleLowerCase('vi').includes(query),
      ),
    );
  }, [data.devices, deviceSearch]);
  const load = useCallback(async () => {
    setError('');
    try {
      const result = await hrmFetch<{ data: Settings }>('/time-settings');
      setData(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được cấu hình');
    }
  }, []);
  const policyPreview = useMemo(() => {
    const from = policy.effectiveFrom;
    const to = policy.effectiveTo || null;
    const mine = policy.scope === 'EMPLOYEES' ? policy.employeeIds : [];
    const closing: string[] = [];
    const blocking: string[] = [];
    for (const v of data.versions) {
      const theirs = versionEmployees(v);
      const collide =
        (!mine.length && !theirs.length) ||
        (mine.length > 0 && theirs.some((id) => mine.includes(id)));
      const vFrom = v.effective_from.slice(0, 10);
      const vTo = v.effective_to?.slice(0, 10) ?? null;
      const overlap = (!to || vFrom <= to) && (!vTo || from <= vTo);
      if (!collide || !overlap) continue;
      const label = `v${v.version_no} (${v.policy_code ?? 'chính sách'}, ${vFrom} - ${vTo ?? 'chưa kết thúc'})`;
      if (vFrom >= from || vTo) blocking.push(label);
      else closing.push(`${label} sẽ kết thúc ngày ${addDays(from, -1)}`);
    }
    return { closing, blocking };
  }, [data.versions, policy]);
  async function loadEmployees() {
    if (employees.length) return;
    try {
      const rows: EmployeeOption[] = [];
      let page = 1;
      let total = 0;
      do {
        const payload = await hrmFetch<{
          data: EmployeeOption[];
          meta: { total: number };
        }>(`/employees?page_size=100&page=${page}`);
        rows.push(...payload.data);
        total = payload.meta.total;
        if (!payload.data.length) break;
        page++;
      } while (rows.length < total);
      setEmployees(rows);
    } catch {
      setError('Không tải được danh sách nhân viên để chọn phạm vi áp dụng');
    }
  }
  async function openHoliday(source: 'template' | 'previous') {
    setError('');
    setBusy(true);
    try {
      const result = await hrmFetch<{
        data: { label: string; items: HolidayDraftItem[] };
      }>(
        `/time-settings/calendar/holiday-draft?year=${holidayYear}&source=${source}`,
      );
      setHolidayLabel(result.data.label);
      setHolidayItems(result.data.items);
      setHolidayReason('');
      setHolidayOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tạo được bản nháp');
    } finally {
      setBusy(false);
    }
  }
  async function confirmHoliday() {
    setBusy(true);
    setError('');
    try {
      await hrmFetch('/time-settings/calendar/holiday-draft/confirm', {
        method: 'POST',
        body: JSON.stringify({
          year: holidayYear,
          reason: holidayReason || undefined,
          items: holidayItems.filter((i) => !i.exists && i.date),
        }),
      });
      await load();
      setHolidayOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được lịch nghỉ lễ');
    } finally {
      setBusy(false);
    }
  }
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
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Sliders className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Quy định Chấm công & Thiết bị
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Cấu hình chính sách chấm công theo mốc hiệu lực, lịch ngày làm / OFF / lễ, tọa độ GPS địa điểm làm việc và đăng ký thiết bị.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs flex items-center gap-2"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {allowedTabs.length === 0 ? (
        <div role="alert" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 text-center">
          Bạn không có quyền xem nhóm cấu hình này.
        </div>
      ) : (
        <div
          role="tablist"
          aria-label="Cấu hình công và thiết bị"
          className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3"
        >
          {allowedTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`time-settings-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`time-settings-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectTab(tab.id)}
                className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs font-semibold'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="min-h-0">
        <section
          id="time-settings-panel-rules"
          role="tabpanel"
          aria-labelledby="time-settings-tab-rules"
          hidden={activeTab !== 'rules'}
          className="max-h-[70vh] space-y-3 overflow-auto rounded-xl border bg-white p-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Chính sách chấm công</h2>
            <Button
              permission="hrm.time.configure"
              onClick={() => {
                setDialog('policy');
                void loadEmployees();
              }}
            >
              Thêm phiên bản
            </Button>
          </div>
          {data.versions.length === 0 && (
            <p className="text-sm text-slate-500">
              Chưa cấu hình điều kiện IP, GPS hoặc thiết bị.
            </p>
          )}
          {data.versions.length > 0 && (
            <Table<Settings['versions'][number]>
              size="small"
              rowKey="id"
              dataSource={data.versions}
              scroll={{ x: 900 }}
              pagination={{ pageSize: 10 }}
              columns={[
                {
                  title: 'Phiên bản',
                  width: 120,
                  render: (_, v) => `v${v.version_no} - ${v.policy_code ?? ''}`,
                },
                {
                  title: 'Hiệu lực',
                  width: 190,
                  render: (_, v) =>
                    `${v.effective_from.slice(0, 10)} - ${v.effective_to?.slice(0, 10) || 'Chưa kết thúc'}`,
                },
                {
                  title: 'Phạm vi',
                  width: 140,
                  render: (_, v) => {
                    const ids = versionEmployees(v);
                    return ids.length
                      ? `${ids.length} nhân viên`
                      : 'Toàn công ty';
                  },
                },
                {
                  title: 'Trạng thái',
                  width: 120,
                  render: (_, v) => versionStatusLabel(v, today()),
                },
                {
                  title: 'Điều kiện',
                  render: (_, v) =>
                    `${String(v.config_json.timezone ?? '')} · IP: ${v.config_json.requireIp ? 'Bắt buộc' : 'Không'} · GPS: ${v.config_json.requireGps ? 'Bắt buộc' : 'Không'} · Thiết bị: ${v.config_json.requireDevice ? 'Đã duyệt' : 'Không yêu cầu'}`,
                },
              ]}
            />
          )}
        </section>
        <section
          id="time-settings-panel-calendar"
          role="tabpanel"
          aria-labelledby="time-settings-tab-calendar"
          hidden={activeTab !== 'calendar'}
          className="max-h-[70vh] space-y-3 overflow-auto rounded-xl border bg-white p-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Lịch ngày làm / OFF / lễ</h2>
            <Button
              permission="hrm.time.configure"
              onClick={() => setDialog('calendar')}
            >
              Cấu hình ngày
            </Button>
          </div>
          {data.holidayStatus?.warning && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800"
            >
              <AlertTriangle className="size-4 shrink-0" />
              <span>{data.holidayStatus.warning}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs">
              Năm
              <Input
                type="number"
                min={2000}
                max={2100}
                className="w-24"
                value={holidayYear}
                onChange={(e) => setHolidayYear(Number(e.target.value))}
              />
            </label>
            <Button
              permission="hrm.time.configure"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void openHoliday('template')}
            >
              Nạp lịch nghỉ lễ theo năm
            </Button>
            <Button
              permission="hrm.time.configure"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void openHoliday('previous')}
            >
              Nhân bản từ năm trước
            </Button>
          </div>
          <Input
            value={calendarSearch}
            onChange={(event) => setCalendarSearch(event.target.value)}
            placeholder="Tìm theo ngày, tên hoặc loại ngày"
            aria-label="Tìm lịch làm việc"
          />
          <Table<Settings['calendar'][number]>
            size="small"
            rowKey="id"
            dataSource={filteredCalendar}
            scroll={{ x: 660, y: 300 }}
            pagination={{ pageSize: 10, showSizeChanger: true }}
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
        <section
          id="time-settings-panel-sites"
          role="tabpanel"
          aria-labelledby="time-settings-tab-sites"
          hidden={activeTab !== 'sites'}
          className="max-h-[70vh] space-y-3 overflow-auto rounded-xl border bg-white p-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Địa điểm chấm công</h2>
            <Button
              permission="hrm.time.configure"
              onClick={() => setDialog('site')}
            >
              Thêm địa điểm
            </Button>
          </div>
          <Input
            value={siteSearch}
            onChange={(event) => setSiteSearch(event.target.value)}
            placeholder="Tìm theo tên hoặc tọa độ"
            aria-label="Tìm địa điểm chấm công"
          />
          <Table<Settings['sites'][number]>
            size="small"
            rowKey="id"
            dataSource={filteredSites}
            scroll={{ x: 700, y: 300 }}
            pagination={{ pageSize: 10, showSizeChanger: true }}
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
        <section
          id="time-settings-panel-devices"
          role="tabpanel"
          aria-labelledby="time-settings-tab-devices"
          hidden={activeTab !== 'devices'}
          className="max-h-[70vh] space-y-3 overflow-auto rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Thiết bị đăng ký</h2>
          <p className="text-sm text-slate-500">
            Duyệt thiết bị mới sẽ thu hồi thiết bị đang hoạt động của nhân viên.
            Định danh gắn với trình duyệt đã đăng ký.
          </p>
          <Input
            value={deviceSearch}
            onChange={(event) => setDeviceSearch(event.target.value)}
            placeholder="Tìm theo nhân viên, thiết bị hoặc trạng thái"
            aria-label="Tìm thiết bị chấm công"
          />
          <Table<Settings['devices'][number]>
            size="small"
            rowKey="id"
            dataSource={filteredDevices}
            scroll={{ x: 640, y: 300 }}
            pagination={{ pageSize: 10, showSizeChanger: true }}
            columns={[
              { title: 'Nhân viên', dataIndex: 'full_name', width: 190 },
              { title: 'Thiết bị', dataIndex: 'name', width: 190 },
              { title: 'Trạng thái', dataIndex: 'status', width: 110 },
              {
                title: 'Thao tác',
                width: 220,
                fixed: 'right',
                render: (_, device) => (
                  <span className="inline-flex gap-1">
                    {device.status === 'PENDING' && (
                      <Popconfirm
                        title="Duyệt thiết bị mới và thu hồi thiết bị cũ?"
                        onConfirm={() =>
                          save(
                            `/time-settings/devices/${device.id}/approve`,
                            {},
                          )
                        }
                      >
                        <Button
                          permission="hrm.device.manage"
                          size="sm"
                          disabled={busy}
                        >
                          Duyệt
                        </Button>
                      </Popconfirm>
                    )}
                    {device.status !== 'REVOKED' && (
                      <Popconfirm
                        title="Thu hồi thiết bị chấm công?"
                        onConfirm={() =>
                          save(
                            `/time-settings/devices/${device.id}/revoke`,
                            {},
                          )
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
                  </span>
                ),
              },
            ]}
          />
        </section>
      </div>
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-md p-0 flex flex-col overflow-hidden bg-white max-h-[90vh]">
          <DialogHeader className="shrink-0 p-5 border-b border-slate-200 bg-slate-50/80">
            <DialogTitle className="text-base font-bold text-slate-900">
              {dialog === 'policy'
                ? 'Phiên bản chính sách'
                : dialog === 'calendar'
                  ? 'Lịch làm việc'
                  : 'Địa điểm chấm công'}
            </DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0 overflow-hidden"
            onSubmit={(e) => {
              e.preventDefault();
              if (dialog === 'policy')
                void save('/time-settings/policy', {
                  effectiveFrom: policy.effectiveFrom,
                  effectiveTo: policy.effectiveTo || null,
                  reason: policy.reason,
                  employeeIds:
                    policy.scope === 'EMPLOYEES' ? policy.employeeIds : [],
                  timezone: policy.timezone,
                  requireIp: policy.requireIp,
                  requireGps: policy.requireGps,
                  maxGpsAccuracyMeters: policy.maxGpsAccuracyMeters,
                  requireDevice: policy.requireDevice,
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
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
              {dialog === 'policy' && (
              <>
                <div className="grid grid-cols-2 gap-3">
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
                    Hiệu lực đến (tùy chọn)
                    <Input
                      type="date"
                      min={policy.effectiveFrom}
                      value={policy.effectiveTo}
                      onChange={(e) =>
                        setPolicy({ ...policy, effectiveTo: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label className="block text-sm">
                  Lý do thay đổi
                  <Input
                    required
                    maxLength={2000}
                    value={policy.reason}
                    onChange={(e) =>
                      setPolicy({ ...policy, reason: e.target.value })
                    }
                  />
                </label>
                <div className="space-y-2 text-sm">
                  <span>Phạm vi áp dụng</span>
                  <SearchableSelect
                    value={policy.scope}
                    onChange={(scope) =>
                      setPolicy({
                        ...policy,
                        scope: scope === 'EMPLOYEES' ? 'EMPLOYEES' : 'ALL',
                      })
                    }
                    options={[
                      { value: 'ALL', label: 'Toàn công ty' },
                      { value: 'EMPLOYEES', label: 'Một số nhân viên (chạy thử)' },
                    ]}
                  />
                  {policy.scope === 'EMPLOYEES' && (
                    <>
                      <SearchableSelect
                        value=""
                        placeholder="Tìm nhân viên để thêm"
                        onChange={(id) =>
                          id &&
                          !policy.employeeIds.includes(id) &&
                          setPolicy({
                            ...policy,
                            employeeIds: [...policy.employeeIds, id],
                          })
                        }
                        options={employees
                          .filter((e) => !policy.employeeIds.includes(e.employeeId))
                          .map((e) => ({
                            value: e.employeeId,
                            label: e.fullName,
                            description: e.employeeCode,
                          }))}
                      />
                      <div className="flex flex-wrap gap-1">
                        {policy.employeeIds.map((id) => (
                          <button
                            key={id}
                            type="button"
                            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs"
                            onClick={() =>
                              setPolicy({
                                ...policy,
                                employeeIds: policy.employeeIds.filter(
                                  (x) => x !== id,
                                ),
                              })
                            }
                          >
                            {employees.find((e) => e.employeeId === id)?.fullName ?? id}{' '}
                            (bỏ)
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {(policyPreview.closing.length > 0 ||
                  policyPreview.blocking.length > 0) && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                    {policyPreview.closing.map((t) => (
                      <p key={t}>{t}</p>
                    ))}
                    {policyPreview.blocking.length > 0 && (
                      <p className="font-semibold text-red-700">
                        Khoảng hiệu lực giao với phiên bản đã có ngày kết thúc
                        hoặc bắt đầu muộn hơn, hệ thống sẽ từ chối:{' '}
                        {policyPreview.blocking.join('; ')}
                      </p>
                    )}
                  </div>
                )}
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
                  Dung sai GPS (m)
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
            </div>

            <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialog(null)}
                className="text-xs h-8"
              >
                Hủy
              </Button>
              <Button
                type="submit"
                disabled={busy}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 font-semibold shadow-xs"
              >
                {busy ? 'Đang lưu…' : 'Lưu cấu hình'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={holidayOpen}
        onOpenChange={(open) => {
          if (!open && !busy) setHolidayOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-3xl p-0 flex flex-col overflow-hidden bg-white max-h-[90vh]">
          <DialogHeader className="shrink-0 p-5 border-b border-slate-200 bg-slate-50/80">
            <DialogTitle className="text-base font-bold text-slate-900">
              Bản nháp lịch nghỉ lễ năm {holidayYear}
            </DialogTitle>
            <p className="text-xs font-semibold text-amber-700">
              {holidayLabel}
            </p>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
            <p className="text-xs text-slate-500">
              Rà soát, chỉnh ngày và tên rồi xác nhận. Ngày đã có trong lịch
              không bị ghi đè; dòng chưa có ngày cần được nhập trước khi lưu.
            </p>
            {holidayItems.map((item, index) => (
              <div
                key={`${index}-${item.name}`}
                className="grid grid-cols-[150px_1fr_110px] items-center gap-2 text-sm"
              >
                <Input
                  type="date"
                  aria-label={`Ngày ${item.name}`}
                  disabled={item.exists}
                  value={item.date ?? ''}
                  onChange={(e) =>
                    setHolidayItems(
                      holidayItems.map((x, i) =>
                        i === index ? { ...x, date: e.target.value || null } : x,
                      ),
                    )
                  }
                />
                <div>
                  <Input
                    aria-label="Tên ngày lễ"
                    disabled={item.exists}
                    value={item.name}
                    onChange={(e) =>
                      setHolidayItems(
                        holidayItems.map((x, i) =>
                          i === index ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {item.exists ? 'Đã có trong lịch - bỏ qua' : item.note}
                  </p>
                </div>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    disabled={item.exists}
                    checked={item.paid}
                    onChange={(e) =>
                      setHolidayItems(
                        holidayItems.map((x, i) =>
                          i === index ? { ...x, paid: e.target.checked } : x,
                        ),
                      )
                    }
                  />
                  Hưởng lương
                </label>
              </div>
            ))}
            <label className="block text-sm">
              Ghi chú nguồn quyết định (tùy chọn)
              <Input
                value={holidayReason}
                onChange={(e) => setHolidayReason(e.target.value)}
              />
            </label>
          </div>
          <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="text-xs h-8"
              onClick={() => setHolidayOpen(false)}
            >
              Hủy
            </Button>
            <Button
              type="button"
              disabled={busy}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 font-semibold shadow-xs"
              onClick={() => void confirmHoliday()}
            >
              {busy ? 'Đang lưu…' : 'Xác nhận và lưu'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
