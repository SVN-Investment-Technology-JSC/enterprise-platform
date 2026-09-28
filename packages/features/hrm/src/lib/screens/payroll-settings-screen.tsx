'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  Settings,
  Plus,
  Clock,
  UserCheck,
  ShieldCheck,
  Pencil,
  Trash2,
  Copy,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { PayrollInputsPanel } from '../ui/payroll-inputs-panel';

type Component = { code: string; name: string; type: string; formula: string };
type Version = {
  id: string;
  policy_type: string;
  version_no: number;
  effective_from: string;
  effective_to: string | null;
  updated_at: string;
  status: string;
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
  ['nightStartMinute', 'Bắt đầu giờ đêm (phút từ 00:00; 22:00 = 1320)'],
  ['nightEndMinute', 'Kết thúc giờ đêm (phút từ 00:00; 06:00 = 360)'],
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
  const [versions, setVersions] = useState<Version[]>([]);
  const [employees, setEmployees] = useState<{ value: string; label: string }[]>([]);
  const [error, setError] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);
  const [editor, setEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Version | null>(null);
  const [reason, setReason] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [salaryType, setSalaryType] = useState('GROSS');
  const [standardMinutes, setStandardMinutes] = useState('');
  const [inputs, setInputs] = useState('');
  const [components, setComponents] = useState<Component[]>([
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
  ]);

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

  async function save(path: string, body: unknown, method = 'POST') {
    await hrmFetch(path, { method, body: JSON.stringify(body) });
    await load();
  }

  function editOvertime(version?: Version, clone = false) {
    const editing = version && !clone ? version : null;
    setAction({
      title: editing ? 'Sửa quy định OT' : 'Phiên bản quy định OT',
      columns: 2,
      description: editing
        ? 'Chỉ sửa phiên bản chưa được sử dụng. Quy định đã áp dụng cần phiên bản kế tiếp.'
        : undefined,
      fields: [
        ...(!editing
          ? [
              {
                key: 'effectiveFrom',
                label: 'Ngày hiệu lực',
                type: 'date' as const,
              },
            ]
          : []),
        ...otFields.map(([key, label]) => ({
          key,
          label,
          type: 'number' as const,
          min: 0,
          step: '0.01',
          value:
            version?.config_json[key] === undefined
              ? ''
              : String(version.config_json[key]),
        })),
        ...(editing ? [{ key: 'reason', label: 'Lý do' }] : []),
      ],
      submit: (values) =>
        save(
          editing
            ? `/payroll-configuration/${editing.id}`
            : '/ot-configuration',
          {
            ...Object.fromEntries(
              otFields.map(([key]) => [key, Number(values[key])]),
            ),
            effectiveFrom: editing
              ? editing.effective_from.slice(0, 10)
              : values.effectiveFrom,
            ...(editing
              ? { reason: values.reason, expectedUpdatedAt: editing.updated_at }
              : {}),
          },
          editing ? 'PATCH' : 'POST',
        ),
    });
  }

  function editVersion(v: Version, clone = false) {
    setEditing(clone ? null : v);
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
      description:
        'Phiên bản đã được tính lương hoặc tham chiếu nghiệp vụ được giữ lại để đối soát.',
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
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            permission="hrm.payroll.configure"
            onClick={() => {
              setEditing(null);
              setReason('');
              setEffectiveFrom('');
              setError('');
              setEditor(true);
            }}
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
          <Button
            permission="hrm.salary.manage"
            variant="outline"
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
                    options: [
                      { value: 'GROSS', label: 'GROSS' },
                      { value: 'NET', label: 'NET' },
                    ],
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
            className="text-xs flex items-center gap-1.5"
          >
            <UserCheck className="size-3.5" />
            <span>Mức lương nhân viên</span>
          </Button>
          <Button
            permission="hrm.payroll.configure"
            variant="outline"
            onClick={() =>
              setAction({
                title: 'Tham số lương cá nhân',
                fields: [
                  { key: 'employeeId', label: 'Nhân viên', options: employees },
                  { key: 'effectiveFrom', label: 'Hiệu lực từ', type: 'date' },
                  {
                    key: 'inputs',
                    label:
                      'Tham số (ví dụ DEPENDANTS=2; INSURANCE_BASE=10000000)',
                  },
                ],
                submit: (v) =>
                  save(`/employees/${v.employeeId}/payroll-inputs`, {
                    effectiveFrom: v.effectiveFrom,
                    inputs: parameters(v.inputs),
                  }),
              })
            }
            className="text-xs flex items-center gap-1.5"
          >
            <ShieldCheck className="size-3.5" />
            <span>Giảm trừ / Bảo hiểm</span>
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

      {/* 2. Versions Table Card */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-xs p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Danh sách phiên bản chính sách & quy định ({versions.length})
          </span>
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
              render: (v) =>
                v === 'ACTIVE' ? (
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Đang áp dụng</Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs">Hết hiệu lực</Badge>
                ),
            },
            {
              title: 'Thời gian hiệu lực',
              render: (_, v) => (
                <span className="text-xs text-slate-700">
                  {v.effective_from.slice(0, 10)} → {v.effective_to?.slice(0, 10) || 'Đến nay'}
                </span>
              ),
            },
            {
              title: 'Thao tác',
              width: 320,
              render: (_, v) => (
                <div className="flex flex-wrap items-center gap-1.5">
                  {v.policy_type === 'OT' && (
                    <>
                      <Button
                        permission="hrm.payroll.configure"
                        variant="outline"
                        onClick={() => editOvertime(v)}
                        className="h-7 text-xs px-2"
                      >
                        <Pencil className="size-3 mr-1" />
                        Sửa
                      </Button>
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
                      <Button
                        permission="hrm.payroll.configure"
                        variant="outline"
                        onClick={() => editVersion(v)}
                        className="h-7 text-xs px-2"
                      >
                        <Pencil className="size-3 mr-1" />
                        Sửa
                      </Button>
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
                    onClick={() => endVersion(v, true)}
                    className="h-7 text-xs px-2 text-rose-600 hover:bg-rose-50 border-rose-200"
                  >
                    <Trash2 className="size-3 mr-1" />
                    Xóa chưa dùng
                  </Button>
                </div>
              ),
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

      {/* 3. Personalized Inputs Panel */}
      <PayrollInputsPanel employees={employees} parse={parameters} />

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
                    ...(editing
                      ? { reason, expectedUpdatedAt: editing.updated_at }
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
                <Input
                  required
                  type="date"
                  disabled={!!editing}
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="text-xs h-9"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Loại lương mặc định
                </label>
                <SearchableSelect
                  value={salaryType}
                  clearable={false}
                  options={[
                    { value: 'GROSS', label: 'GROSS' },
                    { value: 'NET', label: 'NET' },
                  ]}
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

            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-600">
              <strong className="text-slate-800">Biến hệ thống:</strong> PAID_MINUTES, SCHEDULED_MINUTES,
              STANDARD_PERIOD_MINUTES, OT_MINUTES, WEIGHTED_OT_MINUTES,
              LATE_MINUTES, EARLY_MINUTES. Biến lương: BASE_SALARY,
              PRORATED_BASE_PAY, ADVANCE_DUE, MANUAL_EARNINGS,
              MANUAL_DEDUCTIONS. Hỗ trợ toán tử + − × /, MIN, MAX, ROUND, IF.
            </div>

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

            {error && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 font-medium"
              >
                {error}
              </div>
            )}

            {editing && (
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Lý do sửa *
                </label>
                <Input
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Nhập lý do điều chỉnh phiên bản"
                  className="text-xs h-9"
                />
              </div>
            )}

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

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
