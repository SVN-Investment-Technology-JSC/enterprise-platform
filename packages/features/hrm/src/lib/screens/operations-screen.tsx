'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock,
  Calendar,
  GitBranch,
  History,
  ListChecks,
  Play,
  RefreshCw,
  RotateCw,
  Settings,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { Popconfirm, formatDateTime, formatMonth } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { formatDateVn } from '../personnel-decision-rules';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from '../ui/button';
import { HrmAuditTrail } from '../ui/hrm-audit-trail';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { ApprovalPolicyCard } from '../ui/approval-policy-card';
import { ProcedureFieldMappingsDialog } from '../ui/procedure-field-mappings-dialog';
import { PageTitle } from '../ui/page-title';
import { DataList, ExpandToggle, type DataColumn } from '../ui/payroll-settings/data-rows';
import {
  EmptyPanel,
  InfoNote,
  SectionTabs,
  SettingsSection,
  StatusPill,
  kitPanelProps,
  type KitTab,
  type PillTone,
} from '../ui/settings-kit';
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
  { value: 'CUSTOM', label: 'Đơn tuỳ chỉnh' },
];
const kindLabel = (k: string) => kinds.find((v) => v.value === k)?.label || k;

const yesNo = [
  { value: 'true', label: 'Bật' },
  { value: 'false', label: 'Tắt' },
];

/** Trạng thái đồng bộ đơn với Procedure. */
const SYNC_STATUS: Record<string, { label: string; tone: PillTone }> = {
  START_PENDING: { label: 'Chờ tạo hồ sơ', tone: 'slate' },
  RUNNING: { label: 'Đang duyệt', tone: 'blue' },
  APPLY_PENDING: { label: 'Chờ áp dụng kết quả', tone: 'amber' },
  APPLIED: { label: 'Đã áp dụng', tone: 'green' },
  FAILED: { label: 'Lỗi đồng bộ', tone: 'red' },
  CONFLICT: { label: 'Xung đột', tone: 'red' },
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
  resetTypes?: { code: string; name: string }[];
  resetsLastYear?: number;
  pendingRequests?: number;
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

const stamp = (value: string) => formatDateTime(value, '—');

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
    (m) => `Cộng phép tháng ${formatMonth(m.month, m.month ?? '')}: ${m.credited ?? 0} giao dịch mới, ${m.skipped ?? 0} đã có.`,
  );
  for (const c of r.carryovers ?? [])
    lines.push(
      `Chốt cuối năm sang ${c.targetYear ?? ''}: reset ${c.reset ?? 0} quỹ${c.count ? `, chuyển ${c.count} quỹ (dữ liệu cũ)` : ''}.`,
    );
  if (r.expiry?.count) lines.push(`Hết hạn phép chuyển cũ: ${r.expiry.count} bản ghi.`);
  if (r.missingContract?.length)
    lines.push(`${r.missingContract.length} nhân viên chưa có HĐLĐ chính thức đã ký nên chưa được cộng phép theo HĐ.`);
  if (r.blocked?.length)
    lines.push(`${r.blocked.length} quỹ chưa chốt cuối năm vì còn đơn nghỉ chờ duyệt.`);
  return lines.length ? lines : ['Không phát sinh giao dịch.'];
}

type OpsTab = 'automation' | 'workflow' | 'audit';
const TAB_PREFIX = 'operations';

/** Một dòng "nhãn: giá trị" của danh sách thông tin. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-slate-100 py-1.5 text-xs last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-right font-semibold text-slate-800">{children}</dd>
    </div>
  );
}

/**
 * Vận hành và tích hợp: tác vụ tự động tính phép (lịch chạy hằng ngày, checklist cuối năm, các lần chạy), quy trình liên module
 * (Procedure: quy tắc gán quy trình, đồng bộ đơn) và nhật ký nghiệp vụ. Mỗi nhóm là một tab; `?tab=` đồng bộ với địa chỉ trang.
 */
export default function OperationsScreen() {
  const { can } = useHrmPermissions();
  const canAutomation = can('hrm.automation.manage');
  const canIntegration = can('hrm.integration.manage');
  const canAudit = can('hrm.audit.read');
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

  const allowedTabs: OpsTab[] = [
    ...(canAutomation ? (['automation'] as const) : []),
    ...(canIntegration ? (['workflow'] as const) : []),
    ...(canAudit ? (['audit'] as const) : []),
  ];
  const [requestedTab, setRequestedTab] = useState<string | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const activeTab: OpsTab | '' = allowedTabs.find((t) => t === requestedTab) ?? allowedTabs[0] ?? '';

  useEffect(() => {
    const sync = () => {
      setRequestedTab(new URLSearchParams(window.location.search).get('tab'));
      setUrlReady(true);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const selectTab = useCallback((tab: OpsTab) => {
    setRequestedTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url);
  }, []);

  // `?tab=` không hợp lệ (hoặc không đủ quyền) thì sửa lại thành tab đang hiển thị.
  useEffect(() => {
    if (urlReady && activeTab && requestedTab !== null && requestedTab !== activeTab) selectTab(activeTab);
  }, [activeTab, requestedTab, selectTab, urlReady]);

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

  const tabMeta: Record<OpsTab, KitTab> = {
    automation: { id: 'automation', label: 'Tác vụ tự động tính phép', icon: Calendar },
    workflow: { id: 'workflow', label: 'Quy trình liên module (Procedure)', icon: GitBranch },
    audit: { id: 'audit', label: 'Nhật ký nghiệp vụ', icon: History },
  };

  // ------------------------------------------------------------------ Tab Tác vụ tự động
  const runColumns: DataColumn<Run>[] = [
    {
      key: 'expand',
      header: '',
      width: '2.25rem',
      cardOrder: -1,
      cell: (r, ctx) => (
        <ExpandToggle expanded={ctx.expanded} onClick={ctx.toggle} label={`Chi tiết lần chạy ${stamp(r.started_at)}`} />
      ),
    },
    {
      key: 'when',
      header: 'Thời điểm',
      width: 'minmax(0,1.2fr)',
      cardGrow: true,
      cardOrder: -1,
      cell: (r) => <span className="font-semibold text-slate-900">{stamp(r.started_at)}</span>,
    },
    {
      key: 'status',
      header: 'Kết quả',
      width: '6.5rem',
      cell: (r) =>
        r.status === 'SUCCEEDED' ? <StatusPill tone="green">Thành công</StatusPill> : <StatusPill tone="red">Thất bại</StatusPill>,
    },
    {
      key: 'count',
      header: 'Số giao dịch mới',
      width: 'minmax(0,1.3fr)',
      cardLabel: true,
      cell: (r) => {
        const sm = runSummary(r.result);
        return sm ? (
          <span className="text-slate-700">
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
      key: 'error',
      header: 'Chi tiết lỗi / Báo cáo',
      width: 'minmax(0,1.2fr)',
      cardFull: true,
      cell: (r) => <span className="text-slate-600">{r.error || 'Hoàn tất'}</span>,
    },
  ];

  const automationPanel = (
    <div className="grid grid-cols-1 items-start gap-4 @4xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <SettingsSection
        icon={CalendarClock}
        tone="green"
        title="Lịch tự động hàng ngày"
        description="Cộng phép theo tháng và (khi bật) chốt phép cuối năm."
        actions={
          data.settings?.enabled ? <StatusPill tone="green">Đang bật</StatusPill> : <StatusPill tone="slate">Đang tắt</StatusPill>
        }
        bodyClassName="space-y-3"
      >
        <dl>
          <InfoRow label="Múi giờ">{data.settings?.timezone || '—'}</InfoRow>
          <InfoRow label="Giờ chạy">
            {data.settings ? `${String(data.settings.run_hour).padStart(2, '0')}:00 hàng ngày (${data.settings.timezone})` : '—'}
          </InfoRow>
          <InfoRow label="Tích phép từ tháng">
            {data.settings?.from_month ? data.settings.from_month.split('-').reverse().join('/') : '—'}
          </InfoRow>
          <InfoRow label="Tự động chốt phép cuối năm">{data.settings?.carryover_enabled ? 'Bật' : 'Tắt'}</InfoRow>
          <InfoRow label="Lần thành công gần nhất">
            {data.settings?.last_success_date ? formatDateVn(data.settings.last_success_date) : '—'}
          </InfoRow>
        </dl>
        {data.settings?.last_error ? (
          <InfoNote tone="red" role="alert">
            {data.settings.last_error}
          </InfoNote>
        ) : null}
        <p className="text-[11px] leading-relaxed text-slate-500">
          Hằng ngày tác vụ cộng phép theo tháng và (khi bật) chốt phép cuối năm: phép năm không chuyển sang năm sau nên phần còn lại
          được reset về 0. Chạy lại không ghi trùng.
        </p>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
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
                    value: data.settings?.from_month || new Date().toISOString().slice(0, 7),
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
                    label: 'Tự động chốt phép cuối năm (reset, không chuyển)',
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
            className="h-9 flex-1 gap-1.5 text-xs font-semibold"
          >
            <Settings className="size-3.5" aria-hidden />
            <span>Cấu hình lịch</span>
          </Button>
          <Popconfirm
            title="Chạy tác vụ quỹ phép ngay?"
            description="Ghi sổ cộng phép các tháng còn thiếu và chốt cuối năm (reset, không chuyển phép) nếu đang bật. Chạy lại không ghi trùng."
            okText="Chạy ngay"
            cancelText="Quay lại"
            okType="primary"
            onConfirm={() =>
              void sendRaw('/operations/automation/run')
                .then((r) =>
                  setRunResult({
                    summary: runSummary(r?.data),
                    details: runDetails(r?.data),
                    skippedRun: (r?.data as { skipped?: boolean } | undefined)?.skipped === true,
                  }),
                )
                .catch(() => undefined)
            }
          >
            <Button
              variant="outline"
              disabled={busy || !data.settings}
              className="h-9 flex-1 gap-1.5 text-xs font-semibold"
            >
              <Play className="size-3.5 text-emerald-600" aria-hidden />
              <span>Chạy tác vụ ngay</span>
            </Button>
          </Popconfirm>
        </div>
      </SettingsSection>

      <div className="min-w-0 space-y-4">
        {yearEnd ? (
          <SettingsSection
            icon={ListChecks}
            tone="amber"
            title={`Checklist cuối năm ${yearEnd.year}`}
            description={`Còn ${yearEnd.daysToYearEnd} ngày đến hết năm.`}
            bodyClassName="space-y-3"
          >
            {yearEnd.warnCarryoverOff ? (
              <InfoNote tone="amber" role="alert">
                Còn không quá 60 ngày hết năm nhưng "Tự động chốt phép cuối năm" đang Tắt: phép còn lại sẽ không được reset tự động; cần
                bật hoặc bấm "Chốt phép cuối năm" ở Cấu hình, Chính sách phép năm.
              </InfoNote>
            ) : null}
            <ul className="space-y-1.5 text-xs text-slate-700">
              <li>
                Tự động chốt cuối năm: <strong>{yearEnd.carryoverEnabled ? 'Bật' : 'Tắt'}</strong>.
              </li>
              <li>
                Reset về 0 cuối năm:{' '}
                {yearEnd.resetTypes?.length ? yearEnd.resetTypes.map((t) => t.name).join('; ') : 'không có loại nghỉ nào'}
                {yearEnd.resetsLastYear !== undefined && ` (năm ${yearEnd.year - 1} đã reset ${yearEnd.resetsLastYear} quỹ)`}.
              </li>
              {yearEnd.pendingRequests !== undefined && (
                <li className={yearEnd.pendingRequests ? 'font-semibold text-amber-700' : ''}>
                  Đơn nghỉ trừ quỹ đang chờ duyệt trong năm: {yearEnd.pendingRequests}
                  {yearEnd.pendingRequests > 0 && ' (quỹ có đơn chờ sẽ bị bỏ qua khi chốt; cần duyệt hoặc hủy trước)'}.
                </li>
              )}
              <li>
                Đối soát số dư đầu năm:{' '}
                {yearEnd.reconcileMismatchCount === 0
                  ? 'khớp sổ giao dịch'
                  : `${yearEnd.reconcileMismatchCount} quỹ chênh lệch so với sổ giao dịch`}
                .
              </li>
            </ul>
          </SettingsSection>
        ) : null}

        <SettingsSection
          icon={History}
          tone="blue"
          title="Các lần chạy gần đây"
          description={`${data.runs.length} lần chạy; bấm một dòng để xem chi tiết.`}
        >
          <DataList
            label="Các lần chạy tác vụ"
            rows={data.runs}
            columns={runColumns}
            rowKey={(r) => r.id}
            pageSize={10}
            renderExpanded={(r) => (
              <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
                {(r.status === 'SUCCEEDED' ? runDetails(r.result) : [r.error || 'Tác vụ thất bại']).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
            empty={<EmptyPanel icon={CalendarClock} title="Chưa có lần chạy nào" description="Các lần chạy tự động hoặc thủ công sẽ hiện ở đây." />}
          />
        </SettingsSection>
      </div>
    </div>
  );

  // ------------------------------------------------------------------ Tab Quy trình liên module
  const needDirect = rulesNeedingDirect(data.rules, data.procedureAvailable);

  const ruleColumns: DataColumn<Rule>[] = [
    {
      key: 'kind',
      header: 'Loại đơn',
      width: 'minmax(0,1fr)',
      cardGrow: true,
      cardOrder: -1,
      cell: (r) => <span className="font-semibold text-slate-900">{kindLabel(r.request_kind)}</span>,
    },
    {
      key: 'sub',
      header: 'Loại con',
      width: 'minmax(0,1fr)',
      cardLabel: true,
      cell: (r) => <span className="text-slate-600">{r.sub_type_code || 'Mặc định'}</span>,
    },
    {
      key: 'mode',
      header: 'Chế độ duyệt',
      width: 'minmax(0,1fr)',
      cell: (r) => <StatusPill tone="blue">{r.mode === 'PROCEDURE' ? 'Procedure BPMN' : 'Duyệt trực tiếp'}</StatusPill>,
    },
    {
      key: 'definition',
      header: 'Quy trình liên kết',
      width: 'minmax(0,1.5fr)',
      cardFull: true,
      cardLabel: true,
      cell: (r) => (
        <span className="text-slate-700">
          {!r.definition_id
            ? '—'
            : definitionNames === null
              ? 'Đã liên kết (chưa tải được tên quy trình)'
              : (definitionNames[r.definition_id] ?? 'Quy trình không còn trong danh mục')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Cấu hình',
      width: '6.5rem',
      cell: (r) =>
        r.configuration_status === 'CONFLICT' ? (
          <StatusPill tone="red">Cần đối soát</StatusPill>
        ) : (
          <StatusPill tone="green">Hoạt động</StatusPill>
        ),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      width: '12rem',
      cardFull: true,
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" disabled={busy} onClick={() => void rule(r)} className="h-8 px-2.5 text-xs">
            Chỉnh cấu hình
          </Button>
          {r.mode === 'PROCEDURE' && r.definition_id ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setMappingTarget({ bindingId: r.id, definitionId: r.definition_id as string })}
              className="h-8 px-2.5 text-xs"
            >
              Ánh xạ trường
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const workflowColumns: DataColumn<Workflow>[] = [
    {
      key: 'expand',
      header: '',
      width: '2.25rem',
      cardOrder: -1,
      cell: (r, ctx) => (
        <ExpandToggle expanded={ctx.expanded} onClick={ctx.toggle} label={`Chi tiết liên kết ${r.instance_code || r.id}`} />
      ),
    },
    {
      key: 'kind',
      header: 'Loại đơn',
      width: 'minmax(0,0.9fr)',
      cardGrow: true,
      cardOrder: -1,
      cell: (r) => <span className="font-medium text-slate-800">{kindLabel(r.request_kind)}</span>,
    },
    {
      key: 'employee',
      header: 'Đơn / nhân viên',
      width: 'minmax(0,1.4fr)',
      cardFull: true,
      cell: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-semibold text-slate-800">{r.employee_label ?? 'Nhân viên không còn'}</span>
          {r.title ? <span className="block truncate text-[11px] text-slate-500">{r.title}</span> : null}
        </div>
      ),
    },
    {
      key: 'instance',
      header: 'Hồ sơ Procedure',
      width: 'minmax(0,1fr)',
      cardLabel: true,
      cell: (r) => <span className="font-mono text-blue-700">{r.instance_code || 'Đang tạo'}</span>,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      width: 'minmax(0,1.1fr)',
      cell: (r) => (
        <div className="space-y-1">
          <StatusPill tone={SYNC_STATUS[r.status]?.tone ?? 'slate'}>{SYNC_STATUS[r.status]?.label ?? r.status}</StatusPill>
          {r.status === 'CONFLICT' ? (
            <p className="text-[11px] text-rose-700">Đối soát {r.related_instances.length} instance liên quan trước khi tiếp tục.</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'attempts',
      header: 'Lần thử',
      width: '4rem',
      cardLabel: true,
      cell: (r) => <span className="font-mono">{r.attempts}</span>,
    },
    {
      key: 'error',
      header: 'Lỗi gần nhất',
      width: 'minmax(0,1.2fr)',
      cardFull: true,
      cell: (r) => <span className="block break-words text-slate-500">{r.last_error || '—'}</span>,
    },
    {
      key: 'actions',
      header: 'Thao tác',
      width: '10.5rem',
      cell: (r) =>
        canRelink(r) ? (
          <Popconfirm
            title="Gắn lại quy trình cho đơn này? Thao tác được ghi nhật ký."
            okText="Gắn lại"
            cancelText="Quay lại"
            onConfirm={() => void send(`/operations/workflows/${r.id}/retry`).catch(() => undefined)}
          >
            <Button
              variant="outline"
              disabled={busy}
              className="h-8 gap-1 border-blue-200 px-2.5 text-xs text-blue-600 hover:bg-blue-50"
            >
              <RotateCw className="size-3" aria-hidden />
              <span>Gắn lại quy trình</span>
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  const workflowPanel = (
    <div className="space-y-4">
      <SettingsSection
        icon={WorkflowIcon}
        tone="violet"
        title="Gán quy trình phê duyệt cho loại đơn"
        description="Chỉ áp dụng cho đơn mới; đơn đã liên kết giữ nguyên quy trình tại thời điểm gửi."
        actions={
          <Button onClick={() => void rule()} className="h-9 gap-1.5 px-4 text-xs font-semibold">
            <Settings className="size-4" aria-hidden />
            <span>Cấu hình quy trình mới</span>
          </Button>
        }
        bodyClassName="space-y-3"
      >
        {bindingWarnings.length > 0 ? (
          <InfoNote tone="amber" role="alert">
            Đã lưu cấu hình nhưng cần lưu ý: {bindingWarnings.join(' ')}
          </InfoNote>
        ) : null}

        {needDirect.length > 0 ? (
          <InfoNote tone="amber" role="alert">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 flex-1 basis-64">
                Procedure Engine đang không khả dụng nhưng còn {needDirect.length} cấu hình duyệt qua Procedure. Gửi đơn thuộc các loại
                này sẽ bị chặn (mã PROCEDURE_UNAVAILABLE) cho đến khi Procedure hoạt động lại.
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
                  for (const r of needDirect)
                    await hrmFetch('/operations/workflow-rules', {
                      method: 'POST',
                      body: JSON.stringify({
                        requestKind: r.request_kind,
                        subTypeCode: r.sub_type_code || undefined,
                        mode: 'DIRECT',
                      }),
                    }).catch(() => failed.push(kindLabel(r.request_kind)));
                  if (failed.length) setError(`Không chuyển được: ${failed.join(', ')}`);
                  await load().catch(() => undefined);
                  setBusy(false);
                }}
              >
                <Button variant="outline" disabled={busy} className="h-8 border-amber-400 px-2.5 text-xs">
                  Chuyển sang duyệt trực tiếp
                </Button>
              </Popconfirm>
            </div>
          </InfoNote>
        ) : null}

        <ApprovalPolicyCard />
      </SettingsSection>

      <SettingsSection
        icon={GitBranch}
        tone="blue"
        title="Quy tắc chuyển tiếp Procedure"
        description={`${data.rules.length} quy tắc gán loại đơn với quy trình duyệt.`}
      >
        <DataList
          label="Quy tắc chuyển tiếp Procedure"
          rows={data.rules}
          columns={ruleColumns}
          rowKey={(r) => r.id}
          empty={
            <EmptyPanel
              icon={GitBranch}
              title="Chưa có quy tắc nào"
              description="Bấm Cấu hình quy trình mới để gán quy trình duyệt cho một loại đơn."
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        icon={RefreshCw}
        tone="orange"
        title={`Trạng thái đồng bộ đơn (${data.workflows.length})`}
        description="Tiến độ từng đơn đang duyệt qua Procedure; bấm mũi tên để xem chi tiết."
      >
        <DataList
          label="Trạng thái đồng bộ đơn"
          rows={data.workflows}
          columns={workflowColumns}
          rowKey={(r) => r.id}
          pageSize={10}
          renderExpanded={(row) => (
            <div className="space-y-2 text-xs">
              <p>
                <strong className="text-slate-700">Quy trình:</strong>{' '}
                {definitionNames?.[(row as Workflow & { definition_id?: string }).definition_id ?? ''] ?? 'Chưa tải được tên quy trình'}
                {row.definition_version_id ? ' (đã chụp phiên bản khi gửi đơn)' : ''}
              </p>
              <p>
                <strong className="text-slate-700">Tạo lúc:</strong> {stamp(row.created_at)}
              </p>
              {row.legacy_link_id ? (
                <p>
                  <strong className="text-slate-700">Nguồn:</strong> chuyển từ liên kết phiên bản cũ
                </p>
              ) : null}
              {row.related_instances.length > 0 ? (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                  <li className="px-3 py-1.5 text-[11px] font-bold text-slate-600">Hồ sơ Procedure liên quan</li>
                  {row.related_instances.map((item, index) => (
                    <li
                      key={`${item.instanceId}:${item.sourceType}:${item.sourceId}`}
                      className="flex items-center justify-between gap-3 px-3 py-1.5"
                    >
                      <span>{`Hồ sơ #${index + 1}`}</span>
                      <span className="text-slate-500">{item.sourceType === 'hrm_request' ? 'Đơn HRM' : item.sourceType}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          empty={<EmptyPanel icon={RefreshCw} title="Chưa có đơn nào duyệt qua Procedure" />}
        />
      </SettingsSection>
    </div>
  );

  // ------------------------------------------------------------------ Tab Nhật ký
  const auditPanel = (
    <SettingsSection
      icon={History}
      tone="slate"
      title="Nhật ký nghiệp vụ (Audit Trail)"
      description="Mọi thay đổi quan trọng trong HRM: ai làm, làm gì, lúc nào, trên đối tượng nào."
    >
      <HrmAuditTrail />
    </SettingsSection>
  );

  const panels: Record<OpsTab, React.ReactNode> = {
    automation: automationPanel,
    workflow: workflowPanel,
    audit: auditPanel,
  };

  return (
    <div className="@container mx-auto max-w-[1600px] space-y-4">
      <PageTitle
        title="Vận hành & tích hợp"
        description="Giám sát tác vụ tự động tính phép, liên kết quy trình Procedure và nhật ký kiểm toán hệ thống."
        actions={
          <Button
            variant="outline"
            onClick={() => void load().catch((e) => setError(e.message))}
            disabled={busy}
            className="h-9 gap-1.5 px-3 text-xs font-semibold"
          >
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            <span>Làm mới</span>
          </Button>
        }
      />

      {error ? (
        <InfoNote tone="red" role="alert">
          {error}
        </InfoNote>
      ) : null}

      {allowedTabs.length === 0 ? (
        <div role="alert" className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Bạn không có quyền xem vận hành và tích hợp.
        </div>
      ) : (
        <>
          {allowedTabs.length > 1 ? (
            <SectionTabs
              tabs={allowedTabs.map((t) => tabMeta[t])}
              active={activeTab}
              onChange={(id) => selectTab(id as OpsTab)}
              ariaLabel="Vận hành và tích hợp"
              idPrefix={TAB_PREFIX}
            />
          ) : null}
          {activeTab ? <div {...kitPanelProps(TAB_PREFIX, activeTab)}>{panels[activeTab]}</div> : null}
        </>
      )}

      {action && <HrmActionDialog action={action} onClose={() => setAction(null)} />}
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
          <DialogContent className="max-h-[90dvh] overflow-y-auto bg-white sm:max-w-[460px]">
            <DialogHeader>
              <DialogTitle>Kết quả chạy tác vụ quỹ phép</DialogTitle>
            </DialogHeader>
            {runResult.skippedRun || !runResult.summary ? (
              <p className="text-sm text-slate-600">{runResult.details[0]}</p>
            ) : (
              <>
                <dl className="grid grid-cols-1 gap-3 text-center text-sm sm:grid-cols-3">
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
