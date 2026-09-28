'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table, Tabs, Tag } from 'antd';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from '../ui/button';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';

type Settings = {
  enabled: boolean;
  timezone: string;
  from_month: string;
  carryover_enabled: boolean;
  run_hour: number;
  last_success_date: string;
  last_error: string;
};
type Run = {
  id: string;
  started_at: string;
  status: string;
  result: unknown;
  error: string;
};
type Workflow = {
  id: string;
  request_kind: string;
  request_id: string;
  instance_id: string;
  instance_code: string;
  status: string;
  attempts: number;
  last_error: string;
  created_at: string;
};
type Rule = { request_kind: string; definition_id: string; enabled: boolean };
type Audit = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_id: string;
  detail: unknown;
};
type Operations = {
  settings: Settings | null;
  runs: Run[];
  rules: Rule[];
  workflows: Workflow[];
  audit: Audit[];
};
const kinds = [
  { value: 'LEAVE', label: 'Đơn nghỉ' },
  { value: 'OT', label: 'Tăng ca' },
  { value: 'SHIFT_CHANGE', label: 'Đổi ca' },
];
const yesNo = [
  { value: 'true', label: 'Bật' },
  { value: 'false', label: 'Tắt' },
];
const stamp = (value: string) =>
  value ? new Date(value).toLocaleString('vi-VN') : '—';
export default function OperationsScreen() {
  const { can } = useHrmPermissions();
  const [data, setData] = useState<Operations>({
      settings: null,
      runs: [],
      rules: [],
      workflows: [],
      audit: [],
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<HrmAction | null>(null);
  const load = useCallback(async () => {
    const result = await hrmFetch<{ data: Operations }>('/operations');
    setData(result.data);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  async function send(path: string, body: unknown = {}) {
    setBusy(true);
    setError('');
    try {
      await hrmFetch(path, { method: 'POST', body: JSON.stringify(body) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Thao tác thất bại');
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function rule() {
    setError('');
    try {
      const definitions = await hrmFetch<{
        data: { id: string; code: string; name: string }[];
      }>('/operations/procedure-definitions');
      setAction({
        title: 'Liên kết quy trình phê duyệt',
        fields: [
          { key: 'requestKind', label: 'Loại đơn', options: kinds },
          {
            key: 'definitionId',
            label: 'Quy trình đã công bố',
            options: definitions.data.map((d) => ({
              value: d.id,
              label: `${d.code} · ${d.name}`,
            })),
          },
          {
            key: 'enabled',
            label: 'Áp dụng cho đơn mới',
            options: yesNo,
            value: 'true',
          },
        ],
        submit: (v) =>
          send('/operations/workflow-rules', {
            ...v,
            enabled: v.enabled === 'true',
          }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được quy trình');
    }
  }
  const tabs = [];
  if (can('hrm.automation.manage'))
    tabs.push({
      key: 'automation',
      label: 'Tác vụ phép',
      children: (
        <div className="grid gap-3 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-3 rounded border bg-white p-3">
            <h2 className="font-semibold">Lịch tự động</h2>
            <p>{data.settings?.enabled ? 'Đang bật' : 'Chưa bật'}</p>
            <p>Múi giờ: {data.settings?.timezone || '—'}</p>
            <p>Giờ chạy: {data.settings?.run_hour ?? '—'}:00</p>
            <p>Tích phép từ: {data.settings?.from_month || '—'}</p>
            <p>
              Lần thành công:{' '}
              {data.settings?.last_success_date?.slice(0, 10) || '—'}
            </p>
            <p className="text-xs text-slate-500">
              Worker chung chạy hàng ngày, cộng các tháng đã kết thúc, chuyển
              phép khi được bật và xử lý phép hết hạn. Chạy lại không cộng
              trùng.
            </p>
            <Button
              disabled={busy}
              onClick={() =>
                setAction({
                  title: 'Cấu hình tác vụ quỹ phép',
                  fields: [
                    {
                      key: 'enabled',
                      label: 'Tự động chạy',
                      options: yesNo,
                      value: String(data.settings?.enabled ?? false),
                    },
                    {
                      key: 'fromMonth',
                      label: 'Tháng bắt đầu tích phép',
                      type: 'month',
                      value:
                        data.settings?.from_month ||
                        new Date().toISOString().slice(0, 7),
                    },
                    {
                      key: 'timezone',
                      label: 'Múi giờ',
                      value: data.settings?.timezone || 'Asia/Ho_Chi_Minh',
                    },
                    {
                      key: 'runHour',
                      label: 'Giờ chạy hàng ngày (0–23)',
                      type: 'number',
                      min: 0,
                      max: 23,
                      value: data.settings?.run_hour ?? 2,
                    },
                    {
                      key: 'carryoverEnabled',
                      label: 'Tự động chuyển phép năm',
                      options: yesNo,
                      value: String(data.settings?.carryover_enabled ?? false),
                    },
                  ],
                  submit: (v) =>
                    send('/operations/automation', {
                      ...v,
                      enabled: v.enabled === 'true',
                      carryoverEnabled: v.carryoverEnabled === 'true',
                      runHour: Number(v.runHour),
                    }),
                })
              }
            >
              Cấu hình lịch
            </Button>
            <Button
              variant="outline"
              disabled={busy || !data.settings}
              onClick={() =>
                void send('/operations/automation/run').catch(() => undefined)
              }
            >
              Chạy đối soát ngay
            </Button>
          </aside>
          <Table<Run>
            rowKey="id"
            dataSource={data.runs}
            pagination={{ pageSize: 15, showSizeChanger: true }}
            scroll={{ x: 700, y: 520 }}
            columns={[
              { title: 'Thời điểm', dataIndex: 'started_at', render: stamp },
              {
                title: 'Kết quả',
                dataIndex: 'status',
                render: (s) => (
                  <Tag color={s === 'SUCCEEDED' ? 'green' : 'red'}>
                    {s === 'SUCCEEDED' ? 'Thành công' : 'Thất bại'}
                  </Tag>
                ),
              },
              { title: 'Chi tiết lỗi', dataIndex: 'error' },
            ]}
            expandable={{
              expandedRowRender: (r) => (
                <pre className="overflow-auto text-xs">
                  {JSON.stringify(r.result, null, 2)}
                </pre>
              ),
            }}
          />
        </div>
      ),
    });
  if (can('hrm.integration.manage'))
    tabs.push({
      key: 'workflow',
      label: 'Quy trình liên module',
      children: (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button onClick={() => void rule()}>Cấu hình quy trình</Button>
            <span className="text-xs text-slate-500">
              Chỉ áp dụng cho đơn mới; đơn đã liên kết giữ nguyên quy trình.
            </span>
          </div>
          <Table<Rule>
            rowKey="request_kind"
            dataSource={data.rules}
            pagination={false}
            columns={[
              {
                title: 'Loại đơn',
                dataIndex: 'request_kind',
                render: (k) => kinds.find((v) => v.value === k)?.label || k,
              },
              { title: 'Quy trình', dataIndex: 'definition_id' },
              {
                title: 'Trạng thái',
                render: (_, r) => (r.enabled ? 'Bật' : 'Tắt'),
              },
              {
                title: 'Thao tác',
                render: (_, r) => (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void send('/operations/workflow-rules', {
                        requestKind: r.request_kind,
                        definitionId: r.definition_id,
                        enabled: !r.enabled,
                      }).catch(() => undefined)
                    }
                  >
                    {r.enabled ? 'Tắt cho đơn mới' : 'Bật cho đơn mới'}
                  </Button>
                ),
              },
            ]}
          />
          <Table<Workflow>
            rowKey="id"
            dataSource={data.workflows}
            scroll={{ x: 1100, y: 440 }}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            columns={[
              { title: 'Loại đơn', dataIndex: 'request_kind', width: 120 },
              { title: 'Mã đơn', dataIndex: 'request_id', ellipsis: true },
              { title: 'Hồ sơ Procedure', dataIndex: 'instance_code' },
              { title: 'Trạng thái', dataIndex: 'status' },
              { title: 'Lần thử', dataIndex: 'attempts', width: 80 },
              { title: 'Lỗi gần nhất', dataIndex: 'last_error' },
              {
                title: 'Thao tác',
                render: (_, r) =>
                  r.status === 'FAILED' ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void send(`/operations/workflows/${r.id}/retry`).catch(
                          () => undefined,
                        )
                      }
                    >
                      Thử lại
                    </Button>
                  ) : null,
              },
            ]}
          />
        </div>
      ),
    });
  if (can('hrm.audit.read'))
    tabs.push({
      key: 'audit',
      label: 'Nhật ký nghiệp vụ',
      children: (
        <Table<Audit>
          rowKey="id"
          dataSource={data.audit}
          scroll={{ x: 1200, y: 540 }}
          pagination={{ pageSize: 30, showSizeChanger: true }}
          columns={[
            { title: 'Thời điểm', dataIndex: 'created_at', render: stamp },
            { title: 'Thao tác', dataIndex: 'action' },
            { title: 'Đối tượng', dataIndex: 'entity_type' },
            { title: 'Mã đối tượng', dataIndex: 'entity_id', ellipsis: true },
            { title: 'Người thực hiện', dataIndex: 'actor_id', ellipsis: true },
          ]}
          expandable={{
            expandedRowRender: (r) => (
              <pre className="overflow-auto text-xs">
                {JSON.stringify(r.detail, null, 2)}
              </pre>
            ),
          }}
        />
      ),
    });
  return (
    <main className="space-y-3">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Vận hành và tích hợp HRM</h1>
        <Button
          variant="outline"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Làm mới
        </Button>
      </header>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <Tabs items={tabs} />
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </main>
  );
}
