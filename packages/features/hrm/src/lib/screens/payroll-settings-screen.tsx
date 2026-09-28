'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';

type Component = { code: string; name: string; type: string; formula: string };
type Version = {
  id: string;
  policy_type: string;
  version_no: number;
  effective_from: string;
  effective_to: string | null;
  config_json: { components?: Component[]; inputs?: Record<string, number> };
};
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
  const [versions, setVersions] = useState<Version[]>([]),
    [employees, setEmployees] = useState<{ value: string; label: string }[]>(
      [],
    ),
    [error, setError] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null),
    [editor, setEditor] = useState(false),
    [busy, setBusy] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(''),
    [salaryType, setSalaryType] = useState('GROSS'),
    [standardMinutes, setStandardMinutes] = useState(''),
    [inputs, setInputs] = useState('');
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
  async function save(path: string, body: unknown) {
    await hrmFetch(path, { method: 'POST', body: JSON.stringify(body) });
    await load();
  }
  function update(index: number, patch: Partial<Component>) {
    setComponents((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }
  return (
    <main className="space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Cấu hình lương và tăng ca</h1>
        <p className="text-sm text-slate-500">
          Quy định theo ngày hiệu lực; tham số chung có thể được bổ sung theo
          từng nhân viên.
        </p>
      </header>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          permission="hrm.payroll.configure"
          onClick={() => setEditor(true)}
        >
          Thêm công thức lương
        </Button>
        <Button
          permission="hrm.payroll.configure"
          variant="outline"
          onClick={() =>
            setAction({
              title: 'Quy định OT',
              fields: [
                { key: 'effectiveFrom', label: 'Ngày hiệu lực', type: 'date' },
                ...(
                  [
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
                    [
                      'nightStartMinute',
                      'Bắt đầu giờ đêm (phút từ 00:00; 22:00 = 1320)',
                    ],
                    [
                      'nightEndMinute',
                      'Kết thúc giờ đêm (phút từ 00:00; 06:00 = 360)',
                    ],
                  ] as const
                ).map(([key, label]) => ({
                  key,
                  label,
                  type: 'number' as const,
                  min: 0,
                  step: '0.01',
                })),
              ],
              submit: (v) =>
                save(
                  '/ot-configuration',
                  Object.fromEntries(
                    Object.entries(v).map(([k, value]) => [
                      k,
                      k === 'effectiveFrom' ? value : Number(value),
                    ]),
                  ),
                ),
            })
          }
        >
          Cấu hình OT
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
        >
          Mức lương nhân viên
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
        >
          Giảm trừ / bảo hiểm cá nhân
        </Button>
      </div>
      <section className="rounded-xl border bg-white p-4">
        <Table<Version>
          rowKey="id"
          dataSource={versions}
          columns={[
            { title: 'Quy định', dataIndex: 'policy_type' },
            { title: 'Phiên bản', dataIndex: 'version_no' },
            {
              title: 'Hiệu lực',
              render: (_, v) =>
                `${v.effective_from.slice(0, 10)} → ${v.effective_to?.slice(0, 10) || 'Chưa kết thúc'}`,
            },
          ]}
          expandable={{
            expandedRowRender: (v) => (
              <div>
                {v.config_json.components?.map((c) => (
                  <p key={c.code} className="border-b py-2">
                    <strong>{c.name}</strong> · {c.code} = {c.formula}
                  </p>
                ))}
              </div>
            ),
          }}
        />
      </section>
      <Dialog
        open={editor}
        onOpenChange={(open) => {
          if (!busy) setEditor(open);
        }}
      >
        <DialogContent className="sm:max-w-[1080px]">
          <DialogHeader>
            <DialogTitle>Phiên bản công thức lương</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await save('/payroll-configuration', {
                  effectiveFrom,
                  salaryType,
                  components,
                  inputs: parameters(inputs),
                  ...(standardMinutes
                    ? { standardMinutes: Number(standardMinutes) }
                    : {}),
                });
                setEditor(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Không lưu được');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="grid grid-cols-2 gap-4">
              <label className="text-sm">
                Ngày hiệu lực
                <Input
                  required
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Loại lương
                <SearchableSelect
                  value={salaryType}
                  clearable={false}
                  options={[
                    { value: 'GROSS', label: 'GROSS' },
                    { value: 'NET', label: 'NET' },
                  ]}
                  onChange={(v) => setSalaryType(v || 'GROSS')}
                />
              </label>
            </div>
            <label className="block text-sm">
              Số phút công chuẩn của toàn kỳ
              <Input
                type="number"
                min={1}
                max={90720}
                step={1}
                value={standardMinutes}
                onChange={(e) => setStandardMinutes(e.target.value)}
              />
              <span className="text-xs text-slate-500">
                Bắt buộc khi có nhân viên vào giữa kỳ. Nếu để trống, dùng tổng
                phút phân ca của nhân viên trong kỳ.
              </span>
            </label>
            <p className="text-xs text-slate-500">
              Biến công: PAID_MINUTES, SCHEDULED_MINUTES,
              STANDARD_PERIOD_MINUTES, OT_MINUTES, WEIGHTED_OT_MINUTES,
              LATE_MINUTES, EARLY_MINUTES. Biến lương: BASE_SALARY,
              PRORATED_BASE_PAY, ADVANCE_DUE, MANUAL_EARNINGS,
              MANUAL_DEDUCTIONS. Hỗ trợ + − × /, MIN, MAX, ROUND, IF và so sánh.
            </p>
            <div className="max-h-72 overflow-auto">
              {components.map((c, i) => (
                <div
                  className="mb-3 grid grid-cols-[130px_170px_190px_minmax(180px,1fr)] gap-2"
                  key={i}
                >
                  <Input
                    aria-label={`Mã khoản ${i + 1}`}
                    required
                    value={c.code}
                    onChange={(e) =>
                      update(i, { code: e.target.value.toUpperCase() })
                    }
                  />
                  <Input
                    aria-label={`Tên khoản ${i + 1}`}
                    required
                    value={c.name}
                    onChange={(e) => update(i, { name: e.target.value })}
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
                    value={c.formula}
                    onChange={(e) => update(i, { formula: e.target.value })}
                  />
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
            >
              Thêm thành phần
            </Button>
            <label className="block text-sm">
              Tham số chung (MA=giá trị; MA_KHAC=giá trị)
              <Input
                value={inputs}
                onChange={(e) => setInputs(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-red-600">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu phiên bản'}
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
