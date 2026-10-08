'use client';
import { DatePickerInput } from '../ui/date-picker-input';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  Settings,
  Plus,
  Clock,
  UserCheck,
  Pencil,
  Trash2,
  Copy,
  AlertTriangle,
  Loader2,
  Lock,
  FileText,
} from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import {
  PAYROLL_SYSTEM_INPUTS,
  buildPayrollTemplate,
  formatInputs,
  minutesToTime,
  unfilledTemplateInputs,
} from '../hrm-payroll-config';
import { formatDateVn } from '../personnel-decision-rules';
import { toast } from '../ui/toast';
import { PayrollOtDialog } from '../ui/payroll-ot-dialog';
import { PayrollDryRunPanel } from '../ui/payroll-dry-run-panel';
import { PayrollVersionTimeline } from '../ui/payroll-version-timeline';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { PayrollInputsPanel } from '../ui/payroll-inputs-panel';
import { useHrmPermissions } from '../hrm-permissions';
import {
  PAYROLL_SETTINGS_TABS,
  resolvePayrollSettingsTab,
  type PayrollSettingsTabId,
} from '../hrm-navigation';

type Component = { code: string; name: string; type: string; formula: string };
type Version = {
  id: string;
  policy_id: string;
  policy_type: string;
  version_no: number;
  effective_from: string;
  effective_to: string | null;
  updated_at: string;
  status: string;
  /** Đã được kỳ lương / OT / phép tham chiếu: khóa sửa và xóa. */
  used?: boolean;
  used_by_finalized?: boolean;
  config_json: {
    components?: Component[];
    inputs?: Record<string, number>;
    salaryType?: string;
    standardMinutes?: number;
    [key: string]: unknown;
  };
};

const otFields = [
  ['dailyLimitMinutes', 'Giới hạn phút / ngày'],
  ['weeklyLimitMinutes', 'Giới hạn phút / tuần'],
  ['monthlyLimitMinutes', 'Giới hạn phút / tháng'],
  ['yearlyLimitMinutes', 'Giới hạn phút / năm'],
  ['weekdayRate', 'Hệ số ngày thường'],
  ['offRate', 'Hệ số ngày OFF'],
  ['holidayRate', 'Hệ số lễ / Tết'],
  ['nightRate', 'Hệ số ban đêm'],
  ['nightOffRate', 'Hệ số ban đêm ngày OFF'],
  ['nightHolidayRate', 'Hệ số ban đêm lễ / Tết'],
] as const;

const types = [
  ['EARNING', 'Lương / thưởng'],
  ['ALLOWANCE', 'Phụ cấp'],
  ['OVERTIME', 'Tăng ca'],
  ['STATUTORY_DEDUCTION', 'Bảo hiểm / bắt buộc'],
  ['TAX_DEDUCTION', 'Thuế TNCN'],
  ['ADVANCE_DEDUCTION', 'Thu hồi ứng lương'],
  ['OTHER_DEDUCTION', 'Khấu trừ khác'],
  ['NET_PAY', 'Thực lĩnh'],
].map(([value, label]) => ({ value, label }));

const salaryTypeOptions = [
  { value: 'GROSS', label: 'Gross (trước thuế)' },
  { value: 'NET', label: 'Net (thực nhận)' },
];

/** Bộ thành phần khởi tạo khi soạn công thức lương mới. */
function defaultComponents(): Component[] {
  return [
    {
      code: 'SALARY',
      name: 'Lương theo công',
      type: 'EARNING',
      formula: 'PRORATED_BASE_PAY',
    },
    {
      code: 'ADVANCE',
      name: 'Thu hồi ứng lương',
      type: 'ADVANCE_DEDUCTION',
      formula: 'ADVANCE_DUE',
    },
    {
      code: 'NET',
      name: 'Thực lĩnh',
      type: 'NET_PAY',
      formula: 'SALARY + MANUAL_EARNINGS - ADVANCE - MANUAL_DEDUCTIONS',
    },
  ];
}

/**
 * Lý do khóa nút Sửa: backend từ chối sửa phiên bản đã được tham chiếu hoặc đã có
 * phiên bản mới hơn cùng chính sách (assertUnusedConfiguration).
 */
function editLockReason(v: Version, all: Version[]): string {
  if (v.used)
    return 'Đã được kỳ lương/OT/phép tham chiếu: tạo phiên bản kế tiếp để thay đổi';
  const newer = all.find(
    (x) =>
      x.policy_type === v.policy_type &&
      x.policy_id === v.policy_id &&
      x.version_no > v.version_no,
  );
  if (newer)
    return `Đã có phiên bản mới hơn (v${newer.version_no}): chỉ sửa được phiên bản mới nhất, hãy tạo phiên bản kế tiếp`;
  return '';
}

function parameters(text: string) {
  const result: Record<string, number> = {};
  for (const line of text
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [key, value, ...rest] = line.split('=');
    if (
      rest.length ||
      !key?.trim() ||
      !value?.trim() ||
      !Number.isFinite(Number(value))
    )
      throw new Error(
        'Tham số theo dạng MA=giá trị; mỗi tham số cách bằng dấu chấm phẩy',
      );
    if (Object.hasOwn(result, key.trim())) throw new Error('Trùng mã tham số');
    result[key.trim()] = Number(value);
  }
  return result;
}

export default function PayrollSettingsScreen() {
  const { can } = useHrmPermissions();
  const [versions, setVersions] = useState<Version[]>([]);
  const [employees, setEmployees] = useState<{ value: string; label: string }[]>([]);
  const [error, setError] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);

  // Tab navigation & URL Sync (policies | inputs)
  const allowedTabs = PAYROLL_SETTINGS_TABS.filter((tab) => can(tab.permission));
  const allowedTabIds = allowedTabs.map((tab) => tab.id);
  const [requestedTab, setRequestedTab] = useState<string | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const activeTab = resolvePayrollSettingsTab(
    requestedTab,
    allowedTabIds,
  ) as PayrollSettingsTabId | '';

  useEffect(() => {
    const sync = () => {
      setRequestedTab(new URLSearchParams(window.location.search).get('tab'));
      setUrlReady(true);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const selectTab = useCallback((tab: PayrollSettingsTabId) => {
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

  const [editor, setEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Version | null>(null);
  const [otDialog, setOtDialog] = useState<{ base?: Version; editing: boolean } | null>(null);
  const [templateNote, setTemplateNote] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [salaryType, setSalaryType] = useState('GROSS');
  const [standardMinutes, setStandardMinutes] = useState('');
  const [inputs, setInputs] = useState('');
  const [components, setComponents] = useState<Component[]>(defaultComponents);

  const load = useCallback(async () => {
    const [v, e] = await Promise.all([
      hrmFetch<{ data: Version[] }>('/payroll-configuration'),
      hrmEmployeeOptions(),
    ]);
    setVersions(v.data);
    setEmployees(e);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  /**
   * Ghi xong là thành công: hộp thoại đóng ngay, danh sách tải lại riêng để lỗi tải lại
   * không giữ hộp thoại mở (bấm lưu lần nữa sẽ tạo trùng phiên bản).
   */
  async function save(path: string, body: unknown, method = 'POST') {
    await hrmFetch(path, { method, body: JSON.stringify(body) });
    toast.success('Đã lưu thay đổi');
    void load().catch((e) =>
      setError(
        `Đã lưu nhưng không tải lại được danh sách: ${e instanceof Error ? e.message : 'lỗi không xác định'}`,
      ),
    );
  }

  function newVersion() {
    setEditing(null);
    setTemplateNote([]);
    setReason('');
    setEffectiveFrom('');
    setSalaryType('GROSS');
    setStandardMinutes('');
    setInputs('');
    setComponents(defaultComponents());
    setError('');
    setEditor(true);
  }

  function editOvertime(version?: Version, clone = false) {
    setOtDialog({ base: version, editing: !!version && !clone });
  }

  function editVersion(v: Version, clone = false) {
    setEditing(clone ? null : v);
    setTemplateNote([]);
    setReason('');
    setEffectiveFrom(clone ? '' : v.effective_from.slice(0, 10));
    setSalaryType(v.config_json.salaryType || 'GROSS');
    setStandardMinutes(
      v.config_json.standardMinutes
        ? String(v.config_json.standardMinutes)
        : '',
    );
    setInputs(
      Object.entries(v.config_json.inputs || {})
        .map(([k, value]) => `${k}=${value}`)
        .join('; '),
    );
    setComponents((v.config_json.components || []).map((c) => ({ ...c })));
    setError('');
    setEditor(true);
  }

  function endVersion(v: Version, remove = false) {
    setAction({
      title: remove
        ? 'Xóa phiên bản chưa sử dụng'
        : 'Kết thúc hiệu lực phiên bản',
      confirmTitle: remove
        ? 'Xóa phiên bản chưa được sử dụng?'
        : 'Kết thúc hiệu lực theo ngày đã chọn?',
      description: remove
        ? 'Chỉ xóa được phiên bản mới nhất, chưa có hiệu lực và chưa được kỳ lương tham chiếu. Phiên bản liền trước sẽ được mở lại.'
        : 'Phiên bản đã được tính lương hoặc tham chiếu nghiệp vụ được giữ lại để đối soát.',
      fields: [
        ...(!remove
          ? [
              {
                key: 'effectiveTo',
                label: 'Ngày hiệu lực cuối',
                type: 'date' as const,
              },
            ]
          : []),
        { key: 'reason', label: 'Lý do' },
      ],
      submit: (values) =>
        save(
          `/payroll-configuration/${v.id}${remove ? '' : '/deactivate'}`,
          { ...values, expectedUpdatedAt: v.updated_at },
          remove ? 'DELETE' : 'POST',
        ),
    });
  }

  function update(index: number, patch: Partial<Component>) {
    setComponents((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Settings className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Cấu hình Lương & Tăng ca (OT)
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Quy định công thức và hệ số theo mốc thời gian hiệu lực; hỗ trợ tham số cá nhân hóa theo từng nhân viên.
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

      {/* 2. Page-level Tabs Navigation (Đồng bộ với layout của policies & leave-settings) */}
      {allowedTabs.length === 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 text-center"
        >
          Bạn không có quyền xem cấu hình lương.
        </div>
      ) : (
        <div
          role="tablist"
          aria-label="Cấu hình lương và tăng ca"
          className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3"
        >
          {allowedTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`payroll-settings-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`payroll-settings-panel-${tab.id}`}
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
        {/* TAB 1: Danh sách chính sách & Quy định lương / OT */}
        <div
          id="payroll-settings-panel-policies"
          role="tabpanel"
          aria-labelledby="payroll-settings-tab-policies"
          hidden={activeTab !== 'policies'}
          className="space-y-6"
        >
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                  Danh sách phiên bản chính sách & quy định ({versions.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Quản lý phiên bản công thức tính lương và hệ số làm thêm giờ (OT) theo thời gian hiệu lực.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  permission="hrm.payroll.configure"
                  onClick={newVersion}
                  className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs text-xs"
                >
                  <Plus className="size-4" />
                  <span>Thêm công thức lương</span>
                </Button>
                <Button
                  permission="hrm.payroll.configure"
                  variant="outline"
                  onClick={() => editOvertime()}
                  className="text-xs flex items-center gap-1.5"
                >
                  <Clock className="size-3.5" />
                  <span>Cấu hình OT</span>
                </Button>
              </div>
            </div>

            <Table<Version>
              size="small"
              rowKey="id"
              dataSource={versions}
              pagination={{
                pageSize: 10,
                showSizeChanger: true,
                showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} phiên bản`,
              }}
              columns={[
                {
                  title: 'Loại quy định',
                  dataIndex: 'policy_type',
                  width: 150,
                  render: (v) =>
                    v === 'OT' ? (
                      <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-xs">Tăng ca (OT)</Badge>
                    ) : (
                      <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">Công thức lương</Badge>
                    ),
                },
                {
                  title: 'Phiên bản',
                  dataIndex: 'version_no',
                  width: 110,
                  render: (v) => <span className="font-semibold font-mono text-slate-900">v{v}</span>,
                },
                {
                  title: 'Trạng thái',
                  dataIndex: 'status',
                  width: 130,
                  render: (_, row) => {
                    const day = new Date().toLocaleDateString('en-CA');
                    const from = row.effective_from.slice(0, 10);
                    const to = row.effective_to?.slice(0, 10) ?? null;
                    if (from > day)
                      return (
                        <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-xs">Chưa hiệu lực</Badge>
                      );
                    if (to && to < day)
                      return (
                        <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs">Hết hiệu lực</Badge>
                      );
                    return (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Đang áp dụng</Badge>
                    );
                  },
                },
                {
                  title: 'Thời gian hiệu lực',
                  render: (_, v) => (
                    <span className="text-xs text-slate-700">
                      {formatDateVn(v.effective_from)} - {v.effective_to ? formatDateVn(v.effective_to) : 'Đến nay'}
                    </span>
                  ),
                },
                {
                  title: 'Thao tác',
                  width: 320,
                  render: (_, v) => {
                    const lock = editLockReason(v, versions);
                    return (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {v.used && (
                        <Badge
                          title="Đã được kỳ lương/OT/phép tham chiếu: không sửa hoặc xóa; tạo phiên bản kế tiếp có hiệu lực sau kỳ đó"
                          className="bg-slate-100 text-slate-700 border-slate-200 text-[11px] flex items-center gap-1"
                        >
                          <Lock className="size-3" />
                          Đã dùng - khóa sửa
                        </Badge>
                      )}
                      {v.policy_type === 'OT' && (
                        <>
                          <span title={lock || undefined} className="inline-flex">
                            <Button
                              permission="hrm.payroll.configure"
                              variant="outline"
                              disabled={!!lock}
                              aria-label={lock ? `Sửa (${lock})` : undefined}
                              onClick={() => editOvertime(v)}
                              className="h-7 text-xs px-2"
                            >
                              <Pencil className="size-3 mr-1" />
                              Sửa
                            </Button>
                          </span>
                          <Button
                            permission="hrm.payroll.configure"
                            variant="outline"
                            onClick={() => editOvertime(v, true)}
                            className="h-7 text-xs px-2 text-blue-600 hover:bg-blue-50 border-blue-200"
                          >
                            <Copy className="size-3 mr-1" />
                            Tạo bản kế tiếp
                          </Button>
                        </>
                      )}
                      {v.policy_type === 'PAYROLL' && (
                        <>
                          <span title={lock || undefined} className="inline-flex">
                            <Button
                              permission="hrm.payroll.configure"
                              variant="outline"
                              disabled={!!lock}
                              aria-label={lock ? `Sửa (${lock})` : undefined}
                              onClick={() => editVersion(v)}
                              className="h-7 text-xs px-2"
                            >
                              <Pencil className="size-3 mr-1" />
                              Sửa
                            </Button>
                          </span>
                          <Button
                            permission="hrm.payroll.configure"
                            variant="outline"
                            onClick={() => editVersion(v, true)}
                            className="h-7 text-xs px-2 text-blue-600 hover:bg-blue-50 border-blue-200"
                          >
                            <Copy className="size-3 mr-1" />
                            Tạo bản kế tiếp
                          </Button>
                        </>
                      )}
                      {!v.effective_to && (
                        <Button
                          permission="hrm.payroll.configure"
                          variant="outline"
                          onClick={() => endVersion(v)}
                          className="h-7 text-xs px-2 text-amber-700 hover:bg-amber-50 border-amber-200"
                        >
                          Kết thúc
                        </Button>
                      )}
                      <Button
                        permission="hrm.payroll.configure"
                        variant="outline"
                        disabled={
                          !!v.used ||
                          v.effective_from.slice(0, 10) <= new Date().toLocaleDateString('en-CA')
                        }
                        onClick={() => endVersion(v, true)}
                        className="h-7 text-xs px-2 text-rose-600 hover:bg-rose-50 border-rose-200"
                      >
                        <Trash2 className="size-3 mr-1" />
                        Xóa chưa dùng
                      </Button>
                    </div>
                    );
                  },
                },
              ]}
              expandable={{
                expandedRowRender: (v) => (
                  <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-200 space-y-2">
                    {v.policy_type === 'OT' && (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
                        {otFields.map(([key, label]) => (
                          <div key={key} className="bg-white p-2 rounded border border-slate-200">
                            <span className="text-slate-500 block text-[11px]">{label}</span>
                            <span className="font-semibold text-slate-800">
                              {String(v.config_json[key] ?? 'Chưa cấu hình')}
                            </span>
                          </div>
                        ))}
                        {(
                          [
                            ['nightStartMinute', 'Bắt đầu giờ đêm'],
                            ['nightEndMinute', 'Kết thúc giờ đêm'],
                          ] as const
                        ).map(([key, label]) => (
                          <div key={key} className="bg-white p-2 rounded border border-slate-200">
                            <span className="text-slate-500 block text-[11px]">{label}</span>
                            <span className="font-semibold text-slate-800">
                              {minutesToTime(v.config_json[key] as number | undefined) || 'Mặc định'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {v.config_json.components?.map((c) => (
                      <div key={c.code} className="flex items-center justify-between text-xs bg-white p-2.5 rounded border border-slate-200">
                        <span className="font-semibold text-slate-900">{c.name} ({c.code})</span>
                        <span className="font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{c.formula}</span>
                      </div>
                    ))}
                  </div>
                ),
              }}
            />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <div className="pb-3 border-b border-slate-100">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                Dòng thời gian phiên bản
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Kiểm tra khoảng trống hoặc chồng lấn hiệu lực giữa các phiên bản cùng loại.
              </p>
            </div>
            <PayrollVersionTimeline versions={versions} />
          </section>
        </div>

        {/* TAB 2: Tham số lương theo nhân viên */}
        <div
          id="payroll-settings-panel-inputs"
          role="tabpanel"
          aria-labelledby="payroll-settings-tab-inputs"
          hidden={activeTab !== 'inputs'}
          className="space-y-6"
        >
          {/* Mức lương theo nhân viên; tham số cá nhân nằm trong PayrollInputsPanel */}
          {can('hrm.salary.manage') && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                Mức lương nhân viên
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Cập nhật mức lương thỏa thuận theo nhân viên. Tham số cá nhân (người phụ thuộc, bảo hiểm...) quản lý ở bảng bên dưới.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                permission="hrm.salary.manage"
                onClick={() =>
                  setAction({
                    title: 'Mức lương nhân viên',
                    fields: [
                      { key: 'employeeId', label: 'Nhân viên', options: employees },
                      {
                        key: 'baseSalary',
                        label: 'Mức lương tháng (VND)',
                        type: 'number',
                        min: 0,
                      },
                      {
                        key: 'salaryType',
                        label: 'Loại lương',
                        options: salaryTypeOptions,
                      },
                      { key: 'effectiveFrom', label: 'Hiệu lực từ', type: 'date' },
                      { key: 'changeReason', label: 'Căn cứ thay đổi' },
                    ],
                    submit: (v) =>
                      save(`/employees/${v.employeeId}/salary-profiles`, {
                        ...v,
                        baseSalary: Number(v.baseSalary),
                        currency: 'VND',
                      }),
                  })
                }
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs flex items-center gap-1.5 shadow-xs"
              >
                <UserCheck className="size-3.5" />
                <span>Mức lương nhân viên</span>
              </Button>
            </div>
          </section>
          )}

          <PayrollInputsPanel employees={employees} parse={parameters} />
        </div>
      </div>

      {/* 4. Edit Dialog */}
      <Dialog
        open={editor}
        onOpenChange={(open) => {
          if (!busy) setEditor(open);
        }}
      >
        <DialogContent className="sm:max-w-[1080px] max-h-[90vh] p-0 flex flex-col overflow-hidden bg-white">
          <DialogHeader className="shrink-0 p-5 border-b border-slate-200 bg-slate-50/80">
            <DialogTitle className="text-base font-bold text-slate-900">Phiên bản công thức lương</DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Cấu hình chu kỳ hiệu lực, các khoản thu nhập / khấu trừ và công thức tính lương động
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0 overflow-hidden"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await save(
                  editing
                    ? `/payroll-configuration/${editing.id}`
                    : '/payroll-configuration',
                  {
                    effectiveFrom,
                    salaryType,
                    components,
                    inputs: parameters(inputs),
                    reason,
                    ...(editing
                      ? { expectedUpdatedAt: editing.updated_at }
                      : {}),
                    ...(standardMinutes
                      ? { standardMinutes: Number(standardMinutes) }
                      : {}),
                  },
                  editing ? 'PATCH' : 'POST',
                );
                setEditor(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Không lưu được');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Ngày hiệu lực *
                </label>
                <DatePickerInput
  required
  disabled={!!editing}
  value={effectiveFrom}
  onChange={(v: string) => setEffectiveFrom(v)}
/>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Loại lương mặc định
                </label>
                <SearchableSelect
                  value={salaryType}
                  clearable={false}
                  options={salaryTypeOptions}
                  onChange={(v) => setSalaryType(v || 'GROSS')}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Số phút công chuẩn của toàn kỳ
              </label>
              <Input
                type="number"
                min={1}
                max={90720}
                step={1}
                value={standardMinutes}
                onChange={(e) => setStandardMinutes(e.target.value)}
                className="text-xs h-9"
                placeholder="Để trống nếu tính theo phân ca thực tế"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Bắt buộc khi có nhân viên vào giữa kỳ. Nếu để trống, dùng tổng phút phân ca của nhân viên trong kỳ.
              </span>
            </div>

            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-600 space-y-1.5">
              <strong className="text-slate-800 block">Biến hệ thống (tự tính theo kỳ, không nhập trong tham số):</strong>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
                {PAYROLL_SYSTEM_INPUTS.map((item) => (
                  <div key={item.code} className="flex gap-1.5 min-w-0">
                    <dt className="font-mono font-semibold text-slate-800 shrink-0">{item.code}</dt>
                    <dd className="text-slate-500 truncate" title={item.label}>{item.label}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Toán tử: <code className="font-mono">+ - * /</code>, so sánh{' '}
                <code className="font-mono">{'< > <= >= == !='}</code>; hàm{' '}
                <code className="font-mono">MIN(a, b)</code>, <code className="font-mono">MAX(a, b)</code>,{' '}
                <code className="font-mono">ROUND(x, số chữ số)</code>, <code className="font-mono">IF(điều kiện, a, b)</code>.
                Có thể dùng mã thành phần khác và mã tham số chung.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Popconfirm
                title="Nạp mẫu công thức?"
                description="Các thành phần và tham số đang soạn sẽ được thay bằng mẫu tham khảo."
                okText="Nạp mẫu"
                cancelText="Quay lại"
                onConfirm={() => {
                  const t = buildPayrollTemplate();
                  setComponents(t.components.map((c) => ({ ...c })));
                  setInputs(formatInputs(t.inputs));
                  setTemplateNote(
                    unfilledTemplateInputs(t.inputs, t).map((k) => `${k}: ${t.inputNotes[k] ?? ''}`),
                  );
                }}
              >
                <Button type="button" variant="outline" className="text-xs flex items-center gap-1.5">
                  <FileText className="size-3.5" />
                  <span>Dùng mẫu</span>
                </Button>
              </Popconfirm>
              <span className="text-[11px] text-slate-500">
                Mẫu gồm lương theo công, OT, phụ cấp, BHXH/BHYT/BHTN, giảm trừ gia cảnh, thuế TNCN, tạm ứng, thực lĩnh.
              </span>
            </div>
            {templateNote.length > 0 && (
              <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="size-3.5" />
                  Tham số mẫu đang bằng 0, HR/kế toán cần nhập và xác nhận theo quy định hiện hành trước khi lưu
                </div>
                <ul className="list-disc pl-5 columns-1 md:columns-2">
                  {templateNote.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {components.map((c, i) => (
                <div
                  className="grid grid-cols-[120px_150px_170px_minmax(160px,1fr)_auto] gap-2 items-center"
                  key={i}
                >
                  <Input
                    aria-label={`Mã khoản ${i + 1}`}
                    required
                    placeholder="MÃ"
                    value={c.code}
                    onChange={(e) =>
                      update(i, { code: e.target.value.toUpperCase() })
                    }
                    className="text-xs font-mono h-9"
                  />
                  <Input
                    aria-label={`Tên khoản ${i + 1}`}
                    required
                    placeholder="Tên khoản"
                    value={c.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    className="text-xs h-9"
                  />
                  <SearchableSelect
                    value={c.type}
                    options={types}
                    clearable={false}
                    onChange={(v) => update(i, { type: v || 'EARNING' })}
                  />
                  <Input
                    aria-label={`Công thức ${i + 1}`}
                    required
                    placeholder="Công thức tính"
                    value={c.formula}
                    onChange={(e) => update(i, { formula: e.target.value })}
                    className="text-xs font-mono h-9"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setComponents((rows) =>
                        rows.filter((_, index) => index !== i),
                      )
                    }
                    className="h-9 px-2.5 text-xs text-rose-600 hover:bg-rose-50 border-rose-200"
                  >
                    Bỏ
                  </Button>
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              type="button"
              onClick={() =>
                setComponents([
                  ...components,
                  { code: '', name: '', type: 'EARNING', formula: '0' },
                ])
              }
              className="text-xs flex items-center gap-1.5"
            >
              <Plus className="size-3.5" />
              <span>Thêm thành phần lương</span>
            </Button>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Tham số chung (MA=giá trị; MA_KHAC=giá trị)
              </label>
              <Input
                value={inputs}
                onChange={(e) => setInputs(e.target.value)}
                placeholder="VD: PHUCAP_AN=730000; DONG_PHUC=500000"
                className="text-xs h-9 font-mono"
              />
            </div>

            <PayrollDryRunPanel
              components={components}
              inputs={() => parameters(inputs)}
            />

            {error && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 font-medium"
              >
                {error}
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Lý do thay đổi *
              </label>
              <Input
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Nhập lý do (ghi vào nhật ký kiểm toán)"
                className="text-xs h-9"
              />
            </div>

            </div>

            <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditor(false)}
                className="text-xs h-8"
              >
                Hủy bỏ
              </Button>
              <Button
                type="submit"
                disabled={busy}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 font-semibold shadow-xs"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
                {busy ? 'Đang lưu…' : 'Lưu phiên bản'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {otDialog && (
        <PayrollOtDialog
          base={otDialog.base}
          editing={otDialog.editing}
          onSubmit={(path, body, method) => save(path, body, method)}
          onClose={() => setOtDialog(null)}
        />
      )}

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
