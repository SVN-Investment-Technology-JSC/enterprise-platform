'use client';

import { useState, type ReactNode } from 'react';
import { Briefcase, CreditCard, HeartHandshake, User, X } from 'lucide-react';
import type { HrmEmployeeProfile } from '@enterprise-platform/contracts-hrm';
import { employeeCompleteness, employeeInitials, sensitiveDisplay, SENSITIVE_HINT } from '../hrm-employee-view';
import { Badge } from './badge';
import { Button } from './button';
import { CurrentManagerLine } from './employee-reporting-drawer';
import { employmentLabels } from './hrm-lifecycle-actions';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { HrmContractPanel } from './hrm-contract-panel';
import { HrmFamilyPanel } from './hrm-family-panel';
import { HrmProfileDocumentsPanel } from './hrm-profile-documents-panel';

function formatVnDate(val?: string | null): string {
  if (!val) return '----';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(val));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(val).slice(0, 10);
}

/** Hiển thị trường nhạy cảm: "Ẩn" kèm gợi ý khi thiếu quyền, nhãn trống khi chưa nhập. */
function Sensitive({
  value,
  canSee,
  emptyLabel,
}: {
  value: string | null | undefined;
  canSee: boolean;
  emptyLabel?: string;
}) {
  const view = sensitiveDisplay(value, canSee, emptyLabel);
  return (
    <span
      title={view.hidden ? (view.title ?? SENSITIVE_HINT) : undefined}
      className={view.hidden ? 'italic text-slate-400' : undefined}
    >
      {view.text}
    </span>
  );
}

function Row({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0">
      <dt className="shrink-0 text-[11px] text-slate-500">{label}</dt>
      <dd className={`min-w-0 text-right text-xs font-semibold text-slate-900 ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </div>
  );
}

function Block({ icon: Icon, title, children }: { icon: typeof User; title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-slate-200 bg-white p-3">
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-bold text-slate-900">
        <Icon className="size-3.5 text-blue-600" aria-hidden="true" />
        {title}
      </h3>
      <dl>{children}</dl>
    </section>
  );
}

const MARITAL: Record<string, string> = { MARRIED: 'Đã kết hôn', DIVORCED: 'Ly hôn', SINGLE: 'Độc thân' };

type DetailTab = 'documents' | 'family' | 'contracts';

/**
 * Hồ sơ nhân sự dạng hộp thoại rộng: đầu hộp thoại là nhận diện và mức hoàn thiện, thân gồm ba khối gọn
 * (cá nhân, quan hệ lao động và liên hệ khẩn cấp, tài chính và thuế) cùng một hàng; giấy tờ, người phụ thuộc và hợp đồng
 * nằm trong ba tab bên dưới để không phải cuộn dài. Thao tác nghiệp vụ nằm ở chân hộp thoại.
 */
export function EmployeeDetailDialog({
  employee,
  open,
  onOpenChange,
  canSensitive,
  actions,
  onOpenReporting,
  onDependentsChanged,
  onContractsChanged,
}: {
  employee: HrmEmployeeProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canSensitive: boolean;
  /** Các nút thao tác nghiệp vụ ở chân hộp thoại (Tạo quyết định, Sửa, Ngừng, Liên kết tài khoản...). */
  actions?: ReactNode;
  onOpenReporting: () => void;
  onDependentsChanged: (rows: NonNullable<HrmEmployeeProfile['dependents']>) => void;
  onContractsChanged: (rows: NonNullable<HrmEmployeeProfile['contracts']>) => void;
}) {
  const [tab, setTab] = useState<DetailTab>('documents');
  const completeness = employee ? employeeCompleteness(employee, canSensitive) : 0;
  const active = employee ? !['RESIGNED', 'TERMINATED'].includes(employee.employmentStatus) : false;
  const dependents = employee?.dependents ?? [];
  const contracts = employee?.contracts ?? [];
  const tabs: [DetailTab, string][] = [
    ['documents', 'Ảnh và giấy tờ'],
    ['family', `Người phụ thuộc (${dependents.length})`],
    ['contracts', `Hợp đồng (${contracts.length})`],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-[calc(100%-2rem)] max-w-[1180px] flex-col gap-0 overflow-hidden bg-white p-0"
      >
        {employee && (
          <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#091426] text-base font-bold text-white">
                  {employeeInitials(employee)}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="truncate text-base font-bold text-slate-900">
                      {employee.fullName || 'Hồ sơ nhân sự'}
                    </DialogTitle>
                    <Badge
                      className={`border text-[10px] font-bold ${
                        active
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-rose-200 bg-rose-50 text-rose-700'
                      }`}
                    >
                      {employmentLabels[employee.employmentStatus] ?? employee.employmentStatus}
                    </Badge>
                    <Badge variant="outline" className="bg-white font-mono text-[10px] text-slate-700">
                      {employee.employeeCode}
                    </Badge>
                  </div>
                  <DialogDescription className="truncate">
                    {employee.position || 'Chưa phân chức danh'} • {employee.department || 'Chưa phân phòng ban'}
                  </DialogDescription>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-40" title="Mức hoàn thiện hồ sơ">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Hồ sơ hoàn thiện</span>
                    <span className="font-mono font-bold text-slate-800">{completeness}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Mức hoàn thiện hồ sơ"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={completeness}
                    className="h-1.5 overflow-hidden rounded-full bg-slate-200"
                  >
                    <div
                      className={`h-full ${completeness === 100 ? 'bg-emerald-500' : completeness >= 70 ? 'bg-blue-500' : 'bg-amber-500'}`}
                      style={{ width: `${completeness}%` }}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Đóng"
                  onClick={() => onOpenChange(false)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <Block icon={User} title="Thông tin cá nhân">
                  <Row label="Số điện thoại">{employee.phone || '----'}</Row>
                  <Row label="Email" mono>
                    {employee.email || employee.personalEmail || '----'}
                  </Row>
                  <Row label="Ngày sinh · Giới tính">
                    {formatVnDate(employee.dateOfBirth)} · {employee.gender === 'FEMALE' ? 'Nữ' : 'Nam'}
                  </Row>
                  <Row label="CCCD / Hộ chiếu" mono>
                    <Sensitive value={employee.identityCardNumber} canSee={canSensitive} />
                  </Row>
                  <Row label="Hôn nhân">{MARITAL[employee.maritalStatus ?? ''] ?? 'Độc thân'}</Row>
                  <Row label="Quốc tịch · Dân tộc">
                    {employee.nationality || 'Việt Nam'} · {employee.ethnicity || 'Kinh'}
                  </Row>
                  <Row label="Nơi sinh · Quê quán">
                    {employee.placeOfBirth || '----'} · {employee.hometown || '----'}
                  </Row>
                  <Row label="Thường trú">
                    {employee.permanentAddress || employee.currentAddress || '----'}
                  </Row>
                </Block>

                <div className="space-y-3">
                  <Block icon={Briefcase} title="Quan hệ lao động">
                    <Row label="Ngày gia nhập" mono>
                      {employee.joinDate ? formatVnDate(String(employee.joinDate)) : '----'}
                    </Row>
                    <Row label="Ngày chính thức" mono>
                      {employee.officialDate ? formatVnDate(String(employee.officialDate)) : 'Đang thử việc'}
                    </Row>
                    <Row label="Quản lý trực tiếp">
                      <span className="inline-flex items-center gap-2">
                        <CurrentManagerLine employeeId={open ? employee.employeeId : null} />
                        <Button size="xs" variant="outline" onClick={onOpenReporting}>
                          Lịch sử báo cáo
                        </Button>
                      </span>
                    </Row>
                  </Block>
                  <Block icon={HeartHandshake} title="Liên hệ khẩn cấp">
                    <Row label="Người liên hệ">{employee.emergencyContactName || 'Chưa thiết lập'}</Row>
                    <Row label="Mối quan hệ">{employee.emergencyContactRelationship || '----'}</Row>
                    <Row label="Số điện thoại" mono>
                      {employee.emergencyContactPhone || '----'}
                    </Row>
                  </Block>
                </div>

                <Block icon={CreditCard} title="Tài chính nhân sự & thuế">
                  <Row label="Mã số thuế TNCN" mono>
                    <Sensitive value={employee.taxCode} canSee={canSensitive} />
                  </Row>
                  <Row label="Số sổ BHXH" mono>
                    <Sensitive value={employee.socialInsuranceNumber} canSee={canSensitive} />
                  </Row>
                  <Row label="Tài khoản nhận lương" mono>
                    <Sensitive value={employee.bankAccountNumber} canSee={canSensitive} emptyLabel="Chưa liên kết" />
                  </Row>
                  <Row label="Ngân hàng">
                    <Sensitive
                      value={employee.bankName ? `${employee.bankName} ${employee.bankBranch || ''}`.trim() : null}
                      canSee={canSensitive}
                      emptyLabel="----"
                    />
                  </Row>
                  <Row label="Người thân đã khai báo">
                    {dependents.length} người (HR xác minh giảm trừ riêng)
                  </Row>
                </Block>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white">
                <div role="tablist" aria-label="Hồ sơ chi tiết" className="flex gap-1 border-b border-slate-200 px-3">
                  {tabs.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={tab === id}
                      onClick={() => setTab(id)}
                      className={`-mb-px border-b-2 px-3 py-2.5 text-xs font-semibold transition ${
                        tab === id
                          ? 'border-blue-600 text-blue-700'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="p-3" data-testid={`employee-tab-${tab}`}>
                  {tab === 'documents' && <HrmProfileDocumentsPanel employeeId={employee.employeeId} mode="hr" />}
                  {tab === 'family' && (
                    <HrmFamilyPanel
                      employeeId={employee.employeeId}
                      rows={dependents}
                      onChanged={onDependentsChanged}
                    />
                  )}
                  {tab === 'contracts' && (
                    <HrmContractPanel
                      employeeId={employee.employeeId}
                      rows={contracts}
                      onChanged={onContractsChanged}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
                Đóng hồ sơ
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
