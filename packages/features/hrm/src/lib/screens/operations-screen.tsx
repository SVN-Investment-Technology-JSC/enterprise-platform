'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table, Tabs } from 'antd';
import {
  Cpu,
  RefreshCw,
  GitBranch,
  Calendar,
  History,
  AlertTriangle,
  Settings,
  Play,
  RotateCw,
} from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { formatDateVn } from '../personnel-decision-rules';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { HrmAuditTrail } from '../ui/hrm-audit-trail';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { ApprovalPolicyCard } from '../ui/approval-policy-card';
import { ProcedureFieldMappingsDialog } from '../ui/procedure-field-mappings-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

type Settings = {
  enabled: boolean;
  timezone: string;
  from_month: string;
  carryover_enabled: boolean;
  run_hour: number;
  last_success_date: string | null;
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
  definition_version_id: string | null;
  legacy_link_id: string | null;
  related_instances: {
    instanceId: string;
    sourceType: string;
    sourceId: string;
  }[];
  employee_label?: string | null;
  title?: string | null;
  created_at: string;
};
type Rule = {
  id: string;
  request_kind: string;
  sub_type_code: string | null;
  definition_id: string | null;
  mode: 'DIRECT' | 'PROCEDURE';
  configuration_status: 'ACTIVE' | 'CONFLICT';
  enabled: boolean;
  updated_at: string;
};
type Operations = {
  settings: Settings | null;
  runs: Run[];
  rules: Rule[];
  workflows: Workflow[];
  /** false: entitlement Procedure tắt hoặc API Procedure không trả lời. */
  procedureAvailable?: boolean;
};
type SubtypeCatalog = Record<string, { value: string; label: string }[]>;

/** Gửi đơn bị chặn khi còn binding PROCEDURE mà Procedure không khả dụng. */
export function rulesNeedingDirect<T extends Pick<Rule, 'mode'>>(
  rules: T[],
  procedureAvailable: boolean | undefined,
): T[] {
  return procedureAvailable === false
    ? rules.filter((r) => r.mode === 'PROCEDURE')
    : [];
}

/** Liên kết CONFLICT chỉ gắn lại được khi chưa tạo instance nào. */
export function canRelink(
  w: Pick<Workflow, 'status' | 'instance_id' | 'related_instances'>,
) {
  return (
    w.status === 'FAILED' ||
    (w.status === 'CONFLICT' &&
      !w.instance_id &&
      w.related_instances.length === 0)
  );
}

const kinds = [
  { value: 'LEAVE', label: 'Đơn nghỉ' },
  { value: 'OT', label: 'Tăng ca' },
  { value: 'SHIFT_CHANGE', label: 'Đổi ca' },
  { value: 'BUSINESS_TRIP', label: 'Công tác' },
  { value: 'ATTENDANCE', label: 'Giải trình công' },
  { value: 'ADVANCE', label: 'Tạm ứng' },
  { value: 'PROFILE', label: 'Điều chỉnh hồ sơ' },
];

const yesNo = [
  { value: 'true', label: 'Bật' },
  { value: 'false', label: 'Tắt' },
];

/** Trạng thái đồng bộ đơn với Procedure. */
const SYNC_STATUS: Record<string, { label: string; tone: string }> = {
  START_PENDING: { label: 'Chờ tạo hồ sơ', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  RUNNING: { label: 'Đang duyệt', tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  APPLY_PENDING: { label: 'Chờ áp dụng kết quả', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  APPLIED: { label: 'Đã áp dụng', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  FAILED: { label: 'Lỗi đồng bộ', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  CONFLICT: { label: 'Xung đột', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
};
const SKIP_REASON: Record<string, string> = {
  LOCKED: 'Tác vụ đang được worker khác chạy; thử lại sau ít phút.',
  NOT_CONFIGURED: 'Chưa cấu hình lịch tự động.',
  DISABLED: 'Lịch tự động đang tắt.',
};

type RunSummary = {
  createdTransactions: number;
  skipped: number;
  errors: number;
  reset?: number;
  missingContract?: number;
  blocked?: number;
};
type YearEnd = {
  year: number;
  daysToYearEnd: number;
  carryoverEnabled: boolean;
  carryoverTypes: { code: string; name: string; maxCarryoverDays: number; expiryMonth: number }[];
  resetTypes?: { code: string; name: string }[];
  resetsLastYear?: number;
  pendingRequests?: number;
  carryoversCurrentYear: number;
  carryoversNextYear: number;
  expiredPendingCount: number;
  reconcileMismatchCount: number;
  warnCarryoverOff: boolean;
};

/** Reads the summary stored by the worker; older runs are derived from their month/carry-over/expiry parts. */
function runSummary(result: unknown): RunSummary | null {
  const r = result as {
    skipped?: boolean;
    summary?: RunSummary;
    months?: { credited?: number; skipped?: number }[];
    carryovers?: { count?: number }[];
    expiry?: { count?: number };
  } | null;
  if (!r || r.skipped === true) return null;
  if (r.summary) return r.summary;
  return {
    createdTransactions:
      (r.months ?? []).reduce((n, m) => n + (m.credited || 0), 0) +
      (r.carryovers ?? []).reduce((n, c) => n + (c.count || 0) * 2, 0) +
      (r.expiry?.count || 0),
    skipped: (r.months ?? []).reduce((n, m) => n + (m.skipped || 0), 0),
    errors: 0,
  };
}

const stamp = (value: string) =>
  value ? new Date(value).toLocaleString('vi-VN') : '—';

/** Tóm tắt một lần chạy thành các dòng đọc được thay cho JSON. */
function runDetails(result: unknown): string[] {
  const r = (result ?? {}) as {
    skipped?: boolean;
    reason?: string;
    months?: { month?: string; credited?: number; skipped?: number }[];
    carryovers?: { targetYear?: number; count?: number; reset?: number }[];
    expiry?: { count?: number };
    missingContract?: string[];
    blocked?: unknown[];
  };
  if (r.skipped) return [SKIP_REASON[r.reason ?? ''] ?? 'Không có tác vụ nào được thực hiện.'];
  const lines = (r.months ?? []).map(
    (m) => `Cộng phép tháng ${m.month ?? ''}: ${m.credited ?? 0} giao dịch mới, ${m.skipped ?? 0} đã có.`,
  );
  for (const c of r.carryovers ?? [])
    lines.push(
      `Chốt cuối năm sang ${c.targetYear ?? ''}: chuyển phép ${c.count ?? 0} quỹ, reset ${c.reset ?? 0} quỹ.`,
    );
  if (r.expiry) lines.push(`Hết hạn phép chuyển: ${r.expiry.count ?? 0} bản ghi.`);
  if (r.missingContract?.length)
    lines.push(`${r.missingContract.length} nhân viên chưa có HĐLĐ chính thức đã ký nên chưa được cộng phép theo HĐ.`);
  if (r.blocked?.length)
    lines.push(`${r.blocked.length} quỹ chưa chốt cuối năm vì còn đơn nghỉ chờ duyệt.`);
  return lines.length ? lines : ['Không phát sinh giao dịch.'];
}

export default function OperationsScreen() {
  const { can } = useHrmPermissions();
  const canAutomation = can('hrm.automation.manage');
  const canIntegration = can('hrm.integration.manage');
  const [data, setData] = useState<Operations>({
    settings: null,
    runs: [],
    rules: [],
    workflows: [],
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** null: không tải được danh mục Procedure (API tắt hoặc thiếu quyền). */
  const [definitionNames, setDefinitionNames] = useState<Record<
    string,
    string
  > | null>(null);
  const [action, setAction] = useState<HrmAction | null>(null);
  const [runResult, setRunResult] = useState<
    { summary: RunSummary | null; details: string[]; skippedRun: boolean } | null
  >(null);
  const [yearEnd, setYearEnd] = useState<YearEnd | null>(null);
  /** Cảnh báo cấu hình từ lần lưu gán quy trình gần nhất (ví dụ bước đầu không phải bước S). */
  const [bindingWarnings, setBindingWarnings] = useState<string[]>([]);
  // Binding đang cấu hình ánh xạ trường HRM -> thuộc tính Procedure (FIX-E-05).
  const [mappingTarget, setMappingTarget] = useState<{
    bindingId: string;
    definitionId: string;
  } | null>(null);

  // Phụ thuộc giá trị boolean: hàm can() đổi danh tính mỗi lần render sẽ gây tải lặp vô hạn.
  const load = useCallback(async () => {
    const result = await hrmFetch<{ data: Operations }>('/operations');
    setData(result.data);
    if (canIntegration && result.data.procedureAvailable !== false)
      hrmFetch<{ data: { id: string; code: string; name: string }[] }>(
        '/operations/procedure-definitions',
      )
        .then((r) =>
          setDefinitionNames(
            Object.fromEntries(r.data.map((d) => [d.id, `${d.code} · ${d.name}`])),
          ),
        )
        .catch(() => setDefinitionNames(null));
    if (canAutomation)
      try {
        const checklist = await hrmFetch<{ data: YearEnd }>(
          '/operations/leave-year-end-checklist',
        );
        setYearEnd(checklist.data);
      } catch {
        setYearEnd(null);
      }
  }, [canAutomation, canIntegration]);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  async function send(path: string, body: unknown = {}): Promise<void> {
    await sendRaw(path, body);
  }

  async function sendRaw(path: string, body: unknown = {}) {
    setBusy(true);
    setError('');
    try {
      const response = await hrmFetch<{ data?: unknown }>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await load();
      return response;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Thao tác thất bại');
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function rule(current?: Rule) {
    setError('');
    try {
      const available = data.procedureAvailable !== false;
      const definitions = available
        ? await hrmFetch<{
            data: { id: string; code: string; name: string }[];
          }>('/operations/procedure-definitions')
        : { data: [] };
      const catalog = (
        await hrmFetch<{ data: SubtypeCatalog }>('/operations/subtype-catalog')
      ).data;
      setAction({
        title: current
          ? 'Cập nhật cách duyệt đơn'
          : 'Liên kết quy trình phê duyệt',
        description:
          'Cấu hình mới chỉ áp dụng cho lần gửi sau. Đơn đã gửi giữ nguyên phiên bản Procedure đã chụp tại thời điểm gửi.',
        fields: [
          {
            key: 'requestKind',
            label: 'Loại đơn',
            options: kinds,
            value: current?.request_kind,
          },
          {
            key: 'subTypeCode',
            label: 'Mã loại con (đơn nghỉ, tăng ca, công tác)',
            optional: true,
            value: current?.sub_type_code || '',
            optionsFor: (v) => catalog[v.requestKind] ?? [],
          },
          {
            key: 'mode',
            label: 'Chế độ duyệt',
            options: [
              { value: 'DIRECT', label: 'Duyệt trực tiếp trong HRM' },
              ...(available
                ? [{ value: 'PROCEDURE', label: 'Duyệt qua Procedure' }]
                : []),
            ],
            value: available ? current?.mode || 'DIRECT' : 'DIRECT',
          },
          {
            key: 'definitionId',
            label: 'Quy trình đã công bố',
            optional: true,
            value: current?.definition_id || '',
            options: definitions.data.map((d) => ({
              value: d.id,
              label: `${d.code} · ${d.name}`,
            })),
          },
        ],
        submit: async (v) => {
          const response = (await sendRaw('/operations/workflow-rules', {
            requestKind: v.requestKind,
            subTypeCode: v.subTypeCode || undefined,
            mode: v.mode,
            definitionId:
              v.mode === 'PROCEDURE' ? v.definitionId || undefined : undefined,
          })) as {
            data?: {
              warnings?: string[];
              binding?: { id?: string; procedure_definition_id?: string };
            };
          };
          setBindingWarnings(response?.data?.warnings ?? []);
          // Sau khi chọn định nghĩa PE, mở ngay cấu hình ánh xạ thuộc tính.
          const saved = response?.data?.binding;
          if (v.mode === 'PROCEDURE' && saved?.id && v.definitionId)
            setMappingTarget({
              bindingId: saved.id,
              definitionId: v.definitionId,
            });
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được quy trình');
    }
  }

  const tabs = [];
  if (canAutomation)
    tabs.push({
      key: 'automation',
      label: (
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Calendar className="size-3.5" />
          <span>Tác vụ tự động tính phép</span>
        </span>
      ),
      children: (
        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)] pt-2">
          <aside className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-800">Lịch tự động hàng ngày</h2>
              {data.settings?.enabled ? (
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Đang bật</Badge>
              ) : (
                <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs">Đang tắt</Badge>
              )}
            </div>
            <div className="space-y-2 text-xs text-slate-600">
              <p><strong className="text-slate-700">Múi giờ:</strong> {data.settings?.timezone || '—'}</p>
              <p><strong className="text-slate-700">Giờ chạy:</strong> {data.settings ? `${String(data.settings.run_hour).padStart(2, '0')}:00 hàng ngày (${data.settings.timezone})` : '—'}</p>
              <p><strong className="text-slate-700">Tích phép từ tháng:</strong> {data.settings?.from_month ? data.settings.from_month.split('-').reverse().join('/') : '—'}</p>
              <p><strong className="text-slate-700">Tự động chốt phép cuối năm:</strong> {data.settings?.carryover_enabled ? 'Bật' : 'Tắt'}</p>
              <p><strong className="text-slate-700">Lần thành công gần nhất:</strong> {data.settings?.last_success_date ? formatDateVn(data.settings.last_success_date) : '—'}</p>
            </div>
            {data.settings?.last_error && (
              <div role="alert" className="p-2.5 rounded bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0 text-red-600" />
                <span>{data.settings.last_error}</span>
              </div>
            )}
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Hằng ngày tác vụ cộng phép các tháng đã kết thúc, hết hạn phép chuyển quá hạn và (khi bật) chốt phép cuối năm: chuyển phép cho loại được chuyển, reset phần còn lại của loại không được chuyển. Chạy lại không ghi trùng.
            </p>
            <div className="flex flex-col gap-2 pt-2 border-t border-slate-200">
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
                        label: 'Tự động chốt phép cuối năm (chuyển + reset)',
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
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 flex items-center justify-center gap-1.5 shadow-xs"
              >
                <Settings className="size-3.5" />
                <span>Cấu hình lịch</span>
              </Button>
              <Popconfirm
                title="Chạy tác vụ quỹ phép ngay?"
                description="Ghi sổ cộng phép các tháng còn thiếu, hết hạn phép chuyển và chốt cuối năm nếu đang bật. Chạy lại không ghi trùng."
                okText="Chạy ngay"
                cancelText="Quay lại"
                okType="primary"
                onConfirm={() =>
                  void sendRaw('/operations/automation/run')
                    .then((r) =>
                      setRunResult({
                        summary: runSummary(r?.data),
                        details: runDetails(r?.data),
                        skippedRun:
                          (r?.data as { skipped?: boolean } | undefined)
                            ?.skipped === true,
                      }),
                    )
                    .catch(() => undefined)
                }
              >
                <Button
                  variant="outline"
                  disabled={busy || !data.settings}
                  className="text-xs h-8 flex items-center justify-center gap-1.5"
                >
                  <Play className="size-3.5 text-emerald-600" />
                  <span>Chạy tác vụ ngay</span>
                </Button>
              </Popconfirm>
            </div>
          </aside>
          <div className="space-y-4">
            {yearEnd && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                <h2 className="text-sm font-bold text-slate-800">
                  Checklist cuối năm {yearEnd.year} (còn {yearEnd.daysToYearEnd} ngày)
                </h2>
                {yearEnd.warnCarryoverOff && (
                  <div role="alert" className="p-2.5 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                    <span>Còn không quá 60 ngày hết năm nhưng "Tự động chốt phép cuối năm" đang Tắt: phép tồn sẽ không được chuyển hoặc reset tự động; cần bật hoặc bấm "Chốt phép cuối năm" ở trang Quỹ phép.</span>
                  </div>
                )}
                <ul className="text-xs text-slate-700 space-y-1.5">
                  <li>
                    Tự động chốt cuối năm: <strong>{yearEnd.carryoverEnabled ? 'Bật' : 'Tắt'}</strong>.
                  </li>
                  <li>
                    Được chuyển sang năm sau:{' '}
                    {yearEnd.carryoverTypes.length
                      ? yearEnd.carryoverTypes
                          .map((t) => `${t.name} (tối đa ${t.maxCarryoverDays} ngày)`)
                          .join('; ')
                      : 'không có loại nghỉ nào'}
                    .
                  </li>
                  <li>
                    Reset về 0 cuối năm:{' '}
                    {yearEnd.resetTypes?.length
                      ? yearEnd.resetTypes.map((t) => t.name).join('; ')
                      : 'không có loại nghỉ nào'}
                    {yearEnd.resetsLastYear !== undefined &&
                      ` (năm ${yearEnd.year - 1} đã reset ${yearEnd.resetsLastYear} quỹ)`}
                    .
                  </li>
                  {yearEnd.pendingRequests !== undefined && (
                    <li className={yearEnd.pendingRequests ? 'font-semibold text-amber-700' : ''}>
                      Đơn nghỉ trừ quỹ đang chờ duyệt trong năm: {yearEnd.pendingRequests}
                      {yearEnd.pendingRequests > 0 &&
                        ' (quỹ có đơn chờ sẽ bị bỏ qua khi chốt; cần duyệt hoặc hủy trước)'}
                      .
                    </li>
                  )}
                  <li>
                    Hạn dùng phép chuyển:{' '}
                    {yearEnd.carryoverTypes.length
                      ? yearEnd.carryoverTypes
                          .map((t) => `${t.name}: hết hạn cuối tháng ${t.expiryMonth}`)
                          .join('; ')
                      : '—'}
                  </li>
                  <li>
                    Phép đã chuyển: vào năm {yearEnd.year} có {yearEnd.carryoversCurrentYear} quỹ, vào năm {yearEnd.year + 1} có {yearEnd.carryoversNextYear} quỹ.
                  </li>
                  <li>
                    Phép chuyển quá hạn chưa xử lý hết hạn: {yearEnd.expiredPendingCount}
                    {yearEnd.expiredPendingCount > 0 && ' (bấm "Chạy tác vụ ngay" để xử lý)'}.
                  </li>
                  <li>
                    Đối soát số dư đầu năm: {yearEnd.reconcileMismatchCount === 0 ? 'khớp sổ giao dịch' : `${yearEnd.reconcileMismatchCount} quỹ chênh lệch so với sổ giao dịch`}.
                  </li>
                </ul>
              </section>
            )}
            <Table<Run>
              size="small"
              rowKey="id"
              dataSource={data.runs}
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} lần chạy`,
              }}
              scroll={{ x: 700, y: 520 }}
              columns={[
                {
                  title: 'Thời điểm',
                  dataIndex: 'started_at',
                  width: 180,
                  render: stamp,
                },
                {
                  title: 'Kết quả',
                  dataIndex: 'status',
                  width: 140,
                  render: (s) =>
                    s === 'SUCCEEDED' ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Thành công</Badge>
                    ) : (
                      <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-xs">Thất bại</Badge>
                    ),
                },
                {
                  title: 'Số giao dịch mới',
                  dataIndex: 'result',
                  width: 150,
                  render: (v) => {
                    const sm = runSummary(v);
                    return sm ? (
                      <span className="text-xs text-slate-700">
                        {sm.createdTransactions} mới · {sm.skipped} đã có
                        {sm.missingContract ? ` · ${sm.missingContract} thiếu HĐ` : ''}
                        {sm.blocked ? ` · ${sm.blocked} chờ đơn` : ''}
                      </span>
                    ) : (
                      '—'
                    );
                  },
                },
                {
                  title: 'Chi tiết lỗi / Báo cáo',
                  dataIndex: 'error',
                  render: (v) => <span className="text-xs text-slate-600">{v || 'Hoàn tất'}</span>,
                },
              ]}
              expandable={{
                expandedRowRender: (r) => (
                  <ul className="list-disc space-y-1 rounded-lg border border-slate-200 bg-slate-50 py-3 pl-8 pr-3 text-xs text-slate-700">
                    {(r.status === 'SUCCEEDED'
                      ? runDetails(r.result)
                      : [r.error || 'Tác vụ thất bại']
                    ).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                ),
              }}
            />
          </div>
        </div>
      ),
    });

  if (canIntegration)
    tabs.push({
      key: 'workflow',
      label: (
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <GitBranch className="size-3.5" />
          <span>Quy trình liên module (Procedure)</span>
        </span>
      ),
      children: (
        <div className="space-y-5 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 p-3 rounded-lg border border-slate-200">
            <Button
              onClick={() => void rule()}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 flex items-center gap-1.5 shadow-xs"
            >
              <Settings className="size-3.5" />
              <span>Cấu hình quy trình mới</span>
            </Button>
            <span className="text-xs text-slate-500">
              Chỉ áp dụng cho đơn mới; đơn đã liên kết giữ nguyên quy trình tại thời điểm gửi.
            </span>
          </div>

          {bindingWarnings.length > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
            >
              <AlertTriangle className="size-4 shrink-0 text-amber-600" />
              <span>
                Đã lưu cấu hình nhưng cần lưu ý: {bindingWarnings.join(' ')}
              </span>
            </div>
          )}

          {rulesNeedingDirect(data.rules, data.procedureAvailable).length > 0 && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                <span>
                  Procedure Engine đang không khả dụng nhưng còn{' '}
                  {rulesNeedingDirect(data.rules, data.procedureAvailable).length}{' '}
                  cấu hình duyệt qua Procedure. Gửi đơn thuộc các loại này sẽ bị chặn
                  (mã PROCEDURE_UNAVAILABLE) cho đến khi Procedure hoạt động lại.
                </span>
              </span>
              <Popconfirm
                title="Chuyển tất cả cấu hình Procedure sang duyệt trực tiếp trong HRM?"
                okText="Chuyển sang duyệt trực tiếp"
                cancelText="Quay lại"
                okType="danger"
                onConfirm={async () => {
                  setBusy(true);
                  setError('');
                  const failed: string[] = [];
                  for (const r of rulesNeedingDirect(
                    data.rules,
                    data.procedureAvailable,
                  ))
                    await hrmFetch('/operations/workflow-rules', {
                      method: 'POST',
                      body: JSON.stringify({
                        requestKind: r.request_kind,
                        subTypeCode: r.sub_type_code || undefined,
                        mode: 'DIRECT',
                      }),
                    }).catch(() =>
                      failed.push(kinds.find((k) => k.value === r.request_kind)?.label ?? r.request_kind),
                    );
                  if (failed.length)
                    setError(`Không chuyển được: ${failed.join(', ')}`);
                  await load().catch(() => undefined);
                  setBusy(false);
                }}
              >
                <Button
                  variant="outline"
                  disabled={busy}
                  className="h-7 border-amber-400 px-2 text-xs"
                >
                  Chuyển sang duyệt trực tiếp
                </Button>
              </Popconfirm>
            </div>
          )}

          <ApprovalPolicyCard />

          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
              Quy tắc chuyển tiếp Procedure
            </span>
            <Table<Rule>
              size="small"
              rowKey="id"
              dataSource={data.rules}
              pagination={false}
              scroll={{ x: 900, y: 260 }}
              columns={[
                {
                  title: 'Loại đơn',
                  dataIndex: 'request_kind',
                  render: (k) => (
                    <span className="font-semibold text-slate-900">
                      {kinds.find((v) => v.value === k)?.label || k}
                    </span>
                  ),
                },
                {
                  title: 'Loại con',
                  dataIndex: 'sub_type_code',
                  render: (v) => <span className="text-xs text-slate-600">{v || 'Mặc định'}</span>,
                },
                {
                  title: 'Chế độ duyệt',
                  dataIndex: 'mode',
                  render: (v) => (
                    <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                      {v === 'PROCEDURE' ? 'Procedure BPMN' : 'Duyệt trực tiếp'}
                    </Badge>
                  ),
                },
                {
                  title: 'Quy trình liên kết',
                  dataIndex: 'definition_id',
                  render: (v) => (
                    <span className="text-xs text-slate-700">
                      {!v
                        ? '—'
                        : definitionNames === null
                          ? 'Đã liên kết (chưa tải được tên quy trình)'
                          : (definitionNames[v] ?? 'Quy trình không còn trong danh mục')}
                    </span>
                  ),
                },
                {
                  title: 'Cấu hình',
                  dataIndex: 'configuration_status',
                  render: (v) =>
                    v === 'CONFLICT' ? (
                      <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-xs">Cần đối soát</Badge>
                    ) : (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Hoạt động</Badge>
                    ),
                },
                {
                  title: 'Thao tác',
                  render: (_, r) => (
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void rule(r)}
                        className="h-7 text-xs px-2"
                      >
                        Chỉnh cấu hình
                      </Button>
                      {r.mode === 'PROCEDURE' && r.definition_id && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            setMappingTarget({
                              bindingId: r.id,
                              definitionId: r.definition_id as string,
                            })
                          }
                          className="h-7 text-xs px-2"
                        >
                          Ánh xạ trường
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </div>

          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
              Trạng thái đồng bộ đơn ({data.workflows.length})
            </span>
            <Table<Workflow>
              size="small"
              rowKey="id"
              dataSource={data.workflows}
              scroll={{ x: 1100, y: 440 }}
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} tiến độ`,
              }}
              columns={[
                {
                  title: 'Loại đơn',
                  dataIndex: 'request_kind',
                  width: 140,
                  render: (k) => (
                    <span className="font-medium text-slate-800 text-xs">
                      {kinds.find((v) => v.value === k)?.label || k}
                    </span>
                  ),
                },
                {
                  title: 'Đơn / nhân viên',
                  render: (_, r) => (
                    <div className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-800">
                        {r.employee_label ?? 'Nhân viên không còn'}
                      </span>
                      {r.title && (
                        <span className="block truncate text-[11px] text-slate-500">{r.title}</span>
                      )}
                    </div>
                  ),
                },
                {
                  title: 'Hồ sơ Procedure',
                  dataIndex: 'instance_code',
                  render: (v) => <span className="font-mono text-xs text-blue-700">{v || 'Đang tạo'}</span>,
                },
                {
                  title: 'Trạng thái',
                  dataIndex: 'status',
                  render: (value, row) => (
                    <div className="space-y-1">
                      <Badge
                        className={`text-xs ${SYNC_STATUS[value]?.tone ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}
                      >
                        {SYNC_STATUS[value]?.label ?? value}
                      </Badge>
                      {value === 'CONFLICT' && (
                        <p className="text-[11px] text-rose-700">
                          Đối soát {row.related_instances.length} instance liên quan trước khi tiếp tục.
                        </p>
                      )}
                    </div>
                  ),
                },
                {
                  title: 'Lần thử',
                  dataIndex: 'attempts',
                  width: 80,
                  render: (v) => <span className="font-mono text-xs">{v}</span>,
                },
                {
                  title: 'Lỗi gần nhất',
                  dataIndex: 'last_error',
                  render: (v) => <span className="text-xs text-slate-500 truncate block max-w-xs">{v || '—'}</span>,
                },
                {
                  title: 'Thao tác',
                  render: (_, r) =>
                    canRelink(r) ? (
                      <Popconfirm
                        title="Gắn lại quy trình cho đơn này? Thao tác được ghi nhật ký."
                        okText="Gắn lại"
                        cancelText="Quay lại"
                        onConfirm={() =>
                          void send(`/operations/workflows/${r.id}/retry`).catch(
                            () => undefined,
                          )
                        }
                      >
                        <Button
                          variant="outline"
                          disabled={busy}
                          className="h-7 text-xs px-2 flex items-center gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                        >
                          <RotateCw className="size-3" />
                          <span>Gắn lại quy trình</span>
                        </Button>
                      </Popconfirm>
                    ) : null,
                },
              ]}
              expandable={{
                expandedRowRender: (row) => (
                  <div className="space-y-2 text-xs bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <p>
                      <strong className="text-slate-700">Quy trình:</strong>{' '}
                      {definitionNames?.[(row as Workflow & { definition_id?: string }).definition_id ?? ''] ?? 'Chưa tải được tên quy trình'}
                      {row.definition_version_id ? ' (đã chụp phiên bản khi gửi đơn)' : ''}
                    </p>
                    <p>
                      <strong className="text-slate-700">Tạo lúc:</strong> {stamp(row.created_at)}
                    </p>
                    {row.legacy_link_id && (
                      <p><strong className="text-slate-700">Nguồn:</strong> chuyển từ liên kết phiên bản cũ</p>
                    )}
                    {row.related_instances.length > 0 && (
                      <Table
                        size="small"
                        rowKey={(item) =>
                          `${item.instanceId}:${item.sourceType}:${item.sourceId}`
                        }
                        pagination={false}
                        dataSource={row.related_instances}
                        columns={[
                          {
                            title: 'Hồ sơ Procedure liên quan',
                            render: (_, _item, index) => `Hồ sơ #${index + 1}`,
                          },
                          {
                            title: 'Nguồn',
                            dataIndex: 'sourceType',
                            render: (v: string) =>
                              v === 'hrm_request' ? 'Đơn HRM' : v,
                          },
                        ]}
                      />
                    )}
                  </div>
                ),
              }}
            />
          </div>
        </div>
      ),
    });

  if (can('hrm.audit.read'))
    tabs.push({
      key: 'audit',
      label: (
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <History className="size-3.5" />
          <span>Nhật ký nghiệp vụ (Audit Trail)</span>
        </span>
      ),
      children: <HrmAuditTrail />,
    });

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Cpu className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Vận hành Tự động & Tích hợp Quy trình
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Giám sát worker tự động tính quỹ phép, quy tắc chuyển tiếp Procedure BPMN và nhật ký kiểm toán hệ thống.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => void load().catch((e) => setError(e.message))}
            disabled={busy}
            className="text-xs h-9 flex items-center gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </Button>
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

      {/* 2. Tabs Container Card */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs p-5">
        <Tabs items={tabs} />
      </div>

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
      {mappingTarget && (
        <ProcedureFieldMappingsDialog
          key={mappingTarget.bindingId + mappingTarget.definitionId}
          bindingId={mappingTarget.bindingId}
          definitionId={mappingTarget.definitionId}
          onClose={() => setMappingTarget(null)}
        />
      )}
      {runResult && (
        <Dialog open onOpenChange={(open) => !open && setRunResult(null)}>
          <DialogContent className="sm:max-w-[460px] bg-white">
            <DialogHeader>
              <DialogTitle>Kết quả chạy tác vụ quỹ phép</DialogTitle>
            </DialogHeader>
            {runResult.skippedRun || !runResult.summary ? (
              <p className="text-sm text-slate-600">{runResult.details[0]}</p>
            ) : (
              <>
              <dl className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <dt className="text-xs text-slate-600">Giao dịch tạo mới</dt>
                  <dd className="text-xl font-bold text-emerald-700">{runResult.summary.createdTransactions}</dd>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <dt className="text-xs text-slate-600">Bỏ qua (đã xử lý)</dt>
                  <dd className="text-xl font-bold text-slate-700">{runResult.summary.skipped}</dd>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <dt className="text-xs text-slate-600">Cần xử lý</dt>
                  <dd className="text-xl font-bold text-amber-700">
                    {(runResult.summary.missingContract ?? 0) + (runResult.summary.blocked ?? 0)}
                  </dd>
                </div>
              </dl>
              <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
                {runResult.details.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              </>
            )}
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setRunResult(null)}>
                Đóng
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
