'use client';

import { useState, useEffect, type ReactNode } from 'react';
import {
  Briefcase,
  CreditCard,
  HeartHandshake,
  Loader2,
  Lock,
  PencilLine,
  Save,
  User,
  X,
  Sparkles,
} from 'lucide-react';
import type { HrmEmployeeProfile } from '@enterprise-platform/contracts-hrm';
import {
  employeeCompleteness,
  employeeInitials,
  sensitiveDisplay,
  SENSITIVE_HINT,
} from '../hrm-employee-view';
import { Badge } from './badge';
import { Button } from './button';
import { Input } from './input';
import { CurrentManagerLine } from './current-manager-line';
import { employmentLabels } from './hrm-lifecycle-actions';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './sheet';
import { HrmContractPanel } from './hrm-contract-panel';
import { HrmFamilyPanel } from './hrm-family-panel';
import { HrmProfileDocumentsPanel } from './hrm-profile-documents-panel';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { toast } from './toast';
import { useHrmPermissions } from '../hrm-permissions';

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

function Row({
  label,
  children,
  mono = false,
  isEditing = false,
  editControl,
  isCoreOwned = false,
  isSensitiveHidden = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  isEditing?: boolean;
  editControl?: ReactNode;
  isCoreOwned?: boolean;
  isSensitiveHidden?: boolean;
}) {
  if (isEditing) {
    if (isCoreOwned) {
      return (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0">
          <dt className="shrink-0 text-[11px] text-slate-400 flex items-center gap-1">
            {label}
            <Lock className="size-3 text-slate-400" aria-label="Quản lý tại Core" />
          </dt>
          <dd className="min-w-0 text-right text-xs font-semibold text-slate-500 flex items-center justify-end gap-1.5">
            {children}
            <span className="text-[10px] font-normal text-slate-500 bg-slate-100 px-1 py-0.2 rounded border border-slate-200">
              Core
            </span>
          </dd>
        </div>
      );
    }
    if (isSensitiveHidden) {
      return (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0">
          <dt className="shrink-0 text-[11px] text-slate-400">{label}</dt>
          <dd className="min-w-0 text-right text-xs text-slate-400 italic">
            Ẩn (Không có quyền)
          </dd>
        </div>
      );
    }
    return (
      <div className="space-y-1 border-b border-blue-100/70 py-2 last:border-b-0">
        <label className="flex items-center justify-between text-[11px] font-medium text-slate-700">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-blue-600 animate-pulse" />
            {label}
          </span>
          <span className="text-[10px] text-blue-600 font-semibold bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200/60">
            Chỉnh sửa trực tiếp
          </span>
        </label>
        <div>{editControl}</div>
      </div>
    );
  }

  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0">
      <dt className="shrink-0 text-[11px] text-slate-500">{label}</dt>
      <dd
        className={`min-w-0 text-right text-xs font-semibold text-slate-900 ${mono ? 'font-mono' : ''
          }`}
      >
        {children}
      </dd>
    </div>
  );
}

function Block({
  icon: Icon,
  title,
  children,
  isEditing = false,
}: {
  icon: typeof User;
  title: string;
  children: ReactNode;
  isEditing?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-xl border bg-white p-3.5 transition-all shadow-2xs ${isEditing
          ? 'border-blue-200 ring-1 ring-blue-500/15'
          : 'border-slate-200 hover:border-slate-300'
        }`}
    >
      <h3 className="mb-2 flex items-center justify-between text-xs font-bold text-slate-900 border-b border-slate-100 pb-1.5">
        <span className="flex items-center gap-1.5">
          <Icon className="size-3.5 text-blue-600" aria-hidden="true" />
          {title}
        </span>
        {isEditing && (
          <span className="text-[10px] text-blue-600 font-normal">
            Trực tiếp trên Drawer
          </span>
        )}
      </h3>
      <dl>{children}</dl>
    </section>
  );
}

const MARITAL: Record<string, string> = {
  MARRIED: 'Đã kết hôn',
  DIVORCED: 'Ly hôn',
  SINGLE: 'Độc thân',
};

function maritalLabel(value: string | null | undefined): string {
  const text = value?.trim();
  if (!text) return '----';
  return MARITAL[text] ?? text;
}

type DetailTab = 'documents' | 'family' | 'contracts';

const GENDER_OPTIONS: SearchableSelectOption[] = [
  { value: 'MALE', label: 'Nam' },
  { value: 'FEMALE', label: 'Nữ' },
  { value: 'OTHER', label: 'Khác' },
];

const MARITAL_OPTIONS: SearchableSelectOption[] = [
  { value: 'SINGLE', label: 'Độc thân' },
  { value: 'MARRIED', label: 'Đã kết hôn' },
  { value: 'DIVORCED', label: 'Ly hôn' },
  { value: 'Khác', label: 'Khác' },
];

const EMPLOYMENT_STATUS_OPTIONS: SearchableSelectOption[] = [
  { value: 'PROBATION', label: employmentLabels['PROBATION'] || 'Thử việc' },
  { value: 'OFFICIAL', label: employmentLabels['OFFICIAL'] || 'Chính thức' },
  { value: 'ON_LEAVE', label: employmentLabels['ON_LEAVE'] || 'Tạm nghỉ' },
];

interface EmployeeEditForm {
  phone: string;
  personalEmail: string;
  dateOfBirth: string;
  gender: string;
  maritalStatus: string;
  nationality: string;
  ethnicity: string;
  religion: string;
  placeOfBirth: string;
  hometown: string;
  permanentAddress: string;
  currentAddress: string;
  officialDate: string;
  employmentStatus: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  identityCardNumber: string;
  identityCardIssuedDate: string;
  identityCardIssuedPlace: string;
  taxCode: string;
  socialInsuranceNumber: string;
  bankAccountNumber: string;
  bankName: string;
  bankBranch: string;
  note: string;
}

const toEditState = (emp: HrmEmployeeProfile | null): EmployeeEditForm => ({
  phone: emp?.phone || '',
  personalEmail: emp?.personalEmail || '',
  dateOfBirth: emp?.dateOfBirth ? String(emp.dateOfBirth).slice(0, 10) : '',
  gender: emp?.gender || '',
  maritalStatus: emp?.maritalStatus || '',
  nationality: emp?.nationality || 'Việt Nam',
  ethnicity: emp?.ethnicity || 'Kinh',
  religion: emp?.religion || '',
  placeOfBirth: emp?.placeOfBirth || '',
  hometown: emp?.hometown || '',
  permanentAddress: emp?.permanentAddress || '',
  currentAddress: emp?.currentAddress || '',
  officialDate: emp?.officialDate ? String(emp.officialDate).slice(0, 10) : '',
  employmentStatus: emp?.employmentStatus || 'OFFICIAL',
  emergencyContactName: emp?.emergencyContactName || '',
  emergencyContactRelationship: emp?.emergencyContactRelationship || '',
  emergencyContactPhone: emp?.emergencyContactPhone || '',
  identityCardNumber: emp?.identityCardNumber || '',
  identityCardIssuedDate: emp?.identityCardIssuedDate
    ? String(emp.identityCardIssuedDate).slice(0, 10)
    : '',
  identityCardIssuedPlace: emp?.identityCardIssuedPlace || '',
  taxCode: emp?.taxCode || '',
  socialInsuranceNumber: emp?.socialInsuranceNumber || '',
  bankAccountNumber: emp?.bankAccountNumber || '',
  bankName: emp?.bankName || '',
  bankBranch: emp?.bankBranch || '',
  note: emp?.note || '',
});

/**
 * Ngăn kéo (Drawer) Hồ sơ nhân sự: trượt từ cạnh phải (580px - 720px), hiển thị toàn diện hồ sơ,
 * hỗ trợ chỉnh sửa trực tiếp (inline edit) ngay trên Drawer với hiệu ứng highlight trực quan,
 * tích hợp lưu thay đổi qua PATCH /employees/:id/profile.
 */
export function EmployeeDetailDialog({
  employee,
  open,
  onOpenChange,
  canSensitive,
  actions,
  onDependentsChanged,
  onContractsChanged,
  onEmployeeUpdated,
}: {
  employee: HrmEmployeeProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canSensitive: boolean;
  /** Các nút thao tác nghiệp vụ ở chân Drawer (Tạo quyết định, Ngừng, Liên kết tài khoản...). */
  actions?: ReactNode;
  onDependentsChanged: (
    rows: NonNullable<HrmEmployeeProfile['dependents']>,
  ) => void;
  onContractsChanged: (
    rows: NonNullable<HrmEmployeeProfile['contracts']>,
  ) => void;
  onEmployeeUpdated?: (updated: HrmEmployeeProfile) => void;
}) {
  const { can } = useHrmPermissions();
  const canManage = can('hrm.employee.manage');
  const [tab, setTab] = useState<DetailTab>('documents');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<EmployeeEditForm>(() =>
    toEditState(employee),
  );

  // Khởi tạo lại form edit khi đổi nhân viên hoặc đóng/mở drawer
  const empId = employee?.employeeId;
  useEffect(() => {
    setEditForm(toEditState(employee));
    setIsEditing(false);
  }, [empId, open]);

  const completeness = employee
    ? employeeCompleteness(employee, canSensitive)
    : 0;
  const active = employee
    ? !['RESIGNED', 'TERMINATED'].includes(employee.employmentStatus)
    : false;
  const dependents = employee?.dependents ?? [];
  const contracts = employee?.contracts ?? [];
  const tabs: [DetailTab, string][] = [
    ['documents', 'Ảnh và giấy tờ'],
    ['family', `Người phụ thuộc (${dependents.length})`],
    ['contracts', `Hợp đồng (${contracts.length})`],
  ];

  const handleStartEdit = () => {
    setEditForm(toEditState(employee));
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditForm(toEditState(employee));
    setIsEditing(false);
  };

  const handleFieldChange = (key: keyof EmployeeEditForm, value: string) => {
    setEditForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveEdit = async () => {
    if (!employee) return;
    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...Object.fromEntries(
          Object.entries(editForm).map(([k, v]) => [
            k,
            typeof v === 'string' ? v.trim() || null : v,
          ]),
        ),
        expectedUpdatedAt: employee.updatedAt,
      };

      // Bảo vệ trường nhạy cảm nếu không có quyền
      if (!canSensitive) {
        delete payload['identityCardNumber'];
        delete payload['identityCardIssuedDate'];
        delete payload['identityCardIssuedPlace'];
        delete payload['taxCode'];
        delete payload['socialInsuranceNumber'];
        delete payload['bankAccountNumber'];
        delete payload['bankName'];
        delete payload['bankBranch'];
      }

      const res = await hrmFetch<{ data: HrmEmployeeProfile }>(
        `/employees/${employee.employeeId}/profile`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
      );

      toast.success('Đã cập nhật hồ sơ thành công');
      setIsEditing(false);
      if (onEmployeeUpdated) {
        onEmployeeUpdated(res.data);
      }
    } catch (err) {
      toast.error({
        title: 'Không cập nhật được hồ sơ',
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const editableInputClass =
    'h-8 border-blue-300 bg-blue-50/20 ring-2 ring-blue-500/15 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/35 text-xs rounded-lg transition-all shadow-2xs';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        showCloseButton={false}
        className="flex h-full w-full max-w-[720px] sm:w-[720px] flex-col gap-0 overflow-hidden bg-white p-0 shadow-2xl border-l border-slate-200"
      >
        {employee && (
          <>
            {/* Header Drawer */}
            <SheetHeader className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-slate-50/90 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#091426] text-base font-bold text-white shadow-xs">
                    {employeeInitials(employee)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SheetTitle className="truncate text-base font-bold text-slate-900">
                        {employee.fullName || 'Hồ sơ nhân sự'}
                      </SheetTitle>
                      <Badge
                        className={`border text-[10px] font-bold ${active
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-rose-200 bg-rose-50 text-rose-700'
                          }`}
                      >
                        {employmentLabels[employee.employmentStatus] ??
                          employee.employmentStatus}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="bg-white font-mono text-[10px] text-slate-700 border-slate-300"
                      >
                        {employee.employeeCode}
                      </Badge>
                    </div>
                    <SheetDescription className="truncate mt-0.5 text-xs text-slate-500">
                      {employee.position || 'Chưa phân chức danh'} •{' '}
                      {employee.department || 'Chưa phân phòng ban'}
                    </SheetDescription>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Đóng"
                    onClick={() => onOpenChange(false)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 transition-colors"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              {/* Mức hoàn thiện và badge thông báo có thể chỉnh sửa */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-200/60 text-xs">
                <div
                  className="w-48 sm:w-56"
                  title="Mức hoàn thiện hồ sơ nhân sự"
                >
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Hồ sơ hoàn thiện</span>
                    <span className="font-mono font-bold text-slate-800">
                      {completeness}%
                    </span>
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
                      className={`h-full transition-all duration-300 ${completeness === 100
                          ? 'bg-emerald-500'
                          : completeness >= 70
                            ? 'bg-blue-500'
                            : 'bg-amber-500'
                        }`}
                      style={{ width: `${completeness}%` }}
                    />
                  </div>
                </div>

                {/* Highlight chỉ báo tính năng chỉnh sửa */}
                <div className="flex items-center gap-2">
                  {!isEditing ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 border border-blue-200/80 shadow-2xs">
                      <Sparkles className="size-3 text-blue-600" />
                      {/* Chỉnh sửa trực tiếp trên Drawer */}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800 border border-amber-300 shadow-2xs animate-pulse">
                      <PencilLine className="size-3 text-amber-600" />
                      Đang ở chế độ chỉnh sửa
                    </span>
                  )}
                </div>
              </div>
            </SheetHeader>

            {/* Nội dung scroll bên trong Drawer */}
            <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-4 sm:p-5 text-xs">
              {/* Highlight Banner khi chế độ sửa đang bật */}
              {isEditing && (
                <div className="rounded-xl border border-blue-300 bg-gradient-to-r from-blue-50 via-sky-50 to-indigo-50 p-3.5 shadow-sm ring-2 ring-blue-500/25">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs">
                        <PencilLine className="size-4.5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-blue-950">
                            Chế độ chỉnh sửa trực tiếp đang bật
                          </span>
                          <Badge className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 font-bold">
                            Đang sửa
                          </Badge>
                        </div>
                        <p className="text-xs text-blue-800/90 mt-0.5">
                          Các trường có viền nổi bật màu xanh cho phép chỉnh sửa
                          trực tiếp. Nhấn "Lưu thay đổi" khi hoàn tất.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isSaving}
                        onClick={handleCancelEdit}
                        className="h-8 border-slate-300 bg-white px-3 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        Hủy
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={isSaving}
                        onClick={handleSaveEdit}
                        className="h-8 gap-1.5 bg-blue-600 px-3.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-xs"
                      >
                        {isSaving ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Save className="size-3.5" />
                        )}
                        Lưu thay đổi
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Khối 1: Thông tin cá nhân */}
              <Block icon={User} title="Thông tin cá nhân" isEditing={isEditing}>
                <Row
                  label="Số điện thoại"
                  isEditing={isEditing}
                  editControl={
                    <Input
                      value={editForm.phone}
                      onChange={(e) => handleFieldChange('phone', e.target.value)}
                      placeholder="Nhập số điện thoại"
                      className={editableInputClass}
                    />
                  }
                >
                  {employee.phone || '----'}
                </Row>
                <Row
                  label="Email cá nhân"
                  mono
                  isEditing={isEditing}
                  editControl={
                    <Input
                      value={editForm.personalEmail}
                      onChange={(e) =>
                        handleFieldChange('personalEmail', e.target.value)
                      }
                      placeholder="email@canhan.com"
                      className={`${editableInputClass} font-mono`}
                    />
                  }
                >
                  {employee.personalEmail || employee.email || '----'}
                </Row>
                <Row
                  label="Ngày sinh"
                  isEditing={isEditing}
                  editControl={
                    <Input
                      type="date"
                      value={editForm.dateOfBirth}
                      onChange={(e) =>
                        handleFieldChange('dateOfBirth', e.target.value)
                      }
                      className={`${editableInputClass} font-mono`}
                    />
                  }
                >
                  {formatVnDate(employee.dateOfBirth)}
                </Row>
                <Row
                  label="Giới tính"
                  isEditing={isEditing}
                  editControl={
                    <SearchableSelect
                      options={GENDER_OPTIONS}
                      value={editForm.gender}
                      onChange={(val) => handleFieldChange('gender', val)}
                      placeholder="Chọn giới tính"
                      clearable={false}
                    />
                  }
                >
                  {employee.gender === 'FEMALE'
                    ? 'Nữ'
                    : employee.gender === 'MALE'
                      ? 'Nam'
                      : employee.gender || '----'}
                </Row>
                <Row
                  label="CCCD / Hộ chiếu"
                  mono
                  isEditing={isEditing}
                  isSensitiveHidden={!canSensitive}
                  editControl={
                    <Input
                      value={editForm.identityCardNumber}
                      onChange={(e) =>
                        handleFieldChange('identityCardNumber', e.target.value)
                      }
                      placeholder="Số CCCD / Hộ chiếu"
                      className={`${editableInputClass} font-mono`}
                    />
                  }
                >
                  <Sensitive
                    value={employee.identityCardNumber}
                    canSee={canSensitive}
                  />
                </Row>
                <Row
                  label="Hôn nhân"
                  isEditing={isEditing}
                  editControl={
                    <SearchableSelect
                      options={MARITAL_OPTIONS}
                      value={editForm.maritalStatus}
                      onChange={(val) => handleFieldChange('maritalStatus', val)}
                      placeholder="Tình trạng hôn nhân"
                      clearable={false}
                    />
                  }
                >
                  {maritalLabel(employee.maritalStatus)}
                </Row>
                <Row
                  label="Quốc tịch"
                  isEditing={isEditing}
                  editControl={
                    <Input
                      value={editForm.nationality}
                      onChange={(e) =>
                        handleFieldChange('nationality', e.target.value)
                      }
                      placeholder="Việt Nam"
                      className={editableInputClass}
                    />
                  }
                >
                  {employee.nationality || 'Việt Nam'}
                </Row>
                <Row
                  label="Dân tộc"
                  isEditing={isEditing}
                  editControl={
                    <Input
                      value={editForm.ethnicity}
                      onChange={(e) =>
                        handleFieldChange('ethnicity', e.target.value)
                      }
                      placeholder="Kinh"
                      className={editableInputClass}
                    />
                  }
                >
                  {employee.ethnicity || 'Kinh'}
                </Row>
                <Row
                  label="Nơi sinh"
                  isEditing={isEditing}
                  editControl={
                    <Input
                      value={editForm.placeOfBirth}
                      onChange={(e) =>
                        handleFieldChange('placeOfBirth', e.target.value)
                      }
                      placeholder="Nơi sinh"
                      className={editableInputClass}
                    />
                  }
                >
                  {employee.placeOfBirth || '----'}
                </Row>
                <Row
                  label="Quê quán"
                  isEditing={isEditing}
                  editControl={
                    <Input
                      value={editForm.hometown}
                      onChange={(e) =>
                        handleFieldChange('hometown', e.target.value)
                      }
                      placeholder="Quê quán"
                      className={editableInputClass}
                    />
                  }
                >
                  {employee.hometown || '----'}
                </Row>
                <Row
                  label="Thường trú"
                  isEditing={isEditing}
                  editControl={
                    <Input
                      value={editForm.permanentAddress}
                      onChange={(e) =>
                        handleFieldChange('permanentAddress', e.target.value)
                      }
                      placeholder="Địa chỉ thường trú"
                      className={editableInputClass}
                    />
                  }
                >
                  {employee.permanentAddress || '----'}
                </Row>
                <Row
                  label="Địa chỉ hiện tại"
                  isEditing={isEditing}
                  editControl={
                    <Input
                      value={editForm.currentAddress}
                      onChange={(e) =>
                        handleFieldChange('currentAddress', e.target.value)
                      }
                      placeholder="Địa chỉ tạm trú / liên hệ"
                      className={editableInputClass}
                    />
                  }
                >
                  {employee.currentAddress || '----'}
                </Row>
              </Block>

              {/* Khối 2: Quan hệ lao động */}
              <Block
                icon={Briefcase}
                title="Quan hệ lao động"
                isEditing={isEditing}
              >
                <Row
                  label="Ngày gia nhập"
                  mono
                  isEditing={isEditing}
                  isCoreOwned={true}
                >
                  {employee.joinDate ? formatVnDate(String(employee.joinDate)) : '----'}
                </Row>
                <Row
                  label="Ngày chính thức"
                  mono
                  isEditing={isEditing}
                  editControl={
                    <Input
                      type="date"
                      value={editForm.officialDate}
                      onChange={(e) =>
                        handleFieldChange('officialDate', e.target.value)
                      }
                      className={`${editableInputClass} font-mono`}
                    />
                  }
                >
                  {employee.officialDate
                    ? formatVnDate(String(employee.officialDate))
                    : 'Đang thử việc'}
                </Row>
                <Row
                  label="Trạng thái làm việc"
                  isEditing={isEditing}
                  editControl={
                    <SearchableSelect
                      options={EMPLOYMENT_STATUS_OPTIONS}
                      value={editForm.employmentStatus}
                      onChange={(val) =>
                        handleFieldChange('employmentStatus', val)
                      }
                      placeholder="Trạng thái"
                      clearable={false}
                    />
                  }
                >
                  <Badge
                    className={`border text-[10px] font-bold ${active
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-rose-200 bg-rose-50 text-rose-700'
                      }`}
                  >
                    {employmentLabels[employee.employmentStatus] ??
                      employee.employmentStatus}
                  </Badge>
                </Row>
                <Row
                  label="Quản lý trực tiếp"
                  isEditing={isEditing}
                  isCoreOwned={true}
                >
                  <CurrentManagerLine
                    employeeId={open ? employee.employeeId : null}
                  />
                </Row>
              </Block>

              {/* Khối 3: Liên hệ khẩn cấp */}
              <Block
                icon={HeartHandshake}
                title="Liên hệ khẩn cấp"
                isEditing={isEditing}
              >
                <Row
                  label="Người liên hệ"
                  isEditing={isEditing}
                  editControl={
                    <Input
                      value={editForm.emergencyContactName}
                      onChange={(e) =>
                        handleFieldChange('emergencyContactName', e.target.value)
                      }
                      placeholder="Họ tên người liên hệ"
                      className={editableInputClass}
                    />
                  }
                >
                  {employee.emergencyContactName || 'Chưa thiết lập'}
                </Row>
                <Row
                  label="Mối quan hệ"
                  isEditing={isEditing}
                  editControl={
                    <Input
                      value={editForm.emergencyContactRelationship}
                      onChange={(e) =>
                        handleFieldChange(
                          'emergencyContactRelationship',
                          e.target.value,
                        )
                      }
                      placeholder="Bố/Mẹ/Vợ/Chồng..."
                      className={editableInputClass}
                    />
                  }
                >
                  {employee.emergencyContactRelationship || '----'}
                </Row>
                <Row
                  label="Số điện thoại"
                  mono
                  isEditing={isEditing}
                  editControl={
                    <Input
                      value={editForm.emergencyContactPhone}
                      onChange={(e) =>
                        handleFieldChange('emergencyContactPhone', e.target.value)
                      }
                      placeholder="Số điện thoại khẩn cấp"
                      className={`${editableInputClass} font-mono`}
                    />
                  }
                >
                  {employee.emergencyContactPhone || '----'}
                </Row>
              </Block>

              {/* Khối 4: Tài chính nhân sự & thuế */}
              <Block
                icon={CreditCard}
                title="Tài chính nhân sự & thuế"
                isEditing={isEditing}
              >
                <Row
                  label="Mã số thuế TNCN"
                  mono
                  isEditing={isEditing}
                  isSensitiveHidden={!canSensitive}
                  editControl={
                    <Input
                      value={editForm.taxCode}
                      onChange={(e) =>
                        handleFieldChange('taxCode', e.target.value)
                      }
                      placeholder="Mã số thuế"
                      className={`${editableInputClass} font-mono`}
                    />
                  }
                >
                  <Sensitive value={employee.taxCode} canSee={canSensitive} />
                </Row>
                <Row
                  label="Số sổ BHXH"
                  mono
                  isEditing={isEditing}
                  isSensitiveHidden={!canSensitive}
                  editControl={
                    <Input
                      value={editForm.socialInsuranceNumber}
                      onChange={(e) =>
                        handleFieldChange(
                          'socialInsuranceNumber',
                          e.target.value,
                        )
                      }
                      placeholder="Số sổ BHXH"
                      className={`${editableInputClass} font-mono`}
                    />
                  }
                >
                  <Sensitive
                    value={employee.socialInsuranceNumber}
                    canSee={canSensitive}
                  />
                </Row>
                <Row
                  label="Tài khoản nhận lương"
                  mono
                  isEditing={isEditing}
                  isSensitiveHidden={!canSensitive}
                  editControl={
                    <Input
                      value={editForm.bankAccountNumber}
                      onChange={(e) =>
                        handleFieldChange('bankAccountNumber', e.target.value)
                      }
                      placeholder="Số tài khoản ngân hàng"
                      className={`${editableInputClass} font-mono`}
                    />
                  }
                >
                  <Sensitive
                    value={employee.bankAccountNumber}
                    canSee={canSensitive}
                    emptyLabel="Chưa liên kết"
                  />
                </Row>
                <Row
                  label="Ngân hàng"
                  isEditing={isEditing}
                  isSensitiveHidden={!canSensitive}
                  editControl={
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={editForm.bankName}
                        onChange={(e) =>
                          handleFieldChange('bankName', e.target.value)
                        }
                        placeholder="Tên ngân hàng"
                        className={editableInputClass}
                      />
                      <Input
                        value={editForm.bankBranch}
                        onChange={(e) =>
                          handleFieldChange('bankBranch', e.target.value)
                        }
                        placeholder="Chi nhánh"
                        className={editableInputClass}
                      />
                    </div>
                  }
                >
                  <Sensitive
                    value={
                      employee.bankName
                        ? `${employee.bankName} ${employee.bankBranch || ''
                          }`.trim()
                        : null
                    }
                    canSee={canSensitive}
                    emptyLabel="----"
                  />
                </Row>
                <Row label="Người thân đã khai báo">
                  {dependents.length} người (HR xác minh giảm trừ riêng)
                </Row>
              </Block>

              {/* Các tab giấy tờ, người phụ thuộc, hợp đồng */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-2xs">
                <div
                  role="tablist"
                  aria-label="Hồ sơ chi tiết"
                  className="flex gap-1 border-b border-slate-200 px-3 bg-slate-50/50"
                >
                  {tabs.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={tab === id}
                      onClick={() => setTab(id)}
                      className={`-mb-px border-b-2 px-3 py-2.5 text-xs font-semibold transition ${tab === id
                          ? 'border-blue-600 text-blue-700 bg-white'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="p-3.5" data-testid={`employee-tab-${tab}`}>
                  {tab === 'documents' && (
                    <HrmProfileDocumentsPanel
                      employeeId={employee.employeeId}
                      mode="hr"
                      readOnly={!isEditing}
                    />
                  )}
                  {tab === 'family' && (
                    <HrmFamilyPanel
                      employeeId={employee.employeeId}
                      rows={dependents}
                      onChanged={onDependentsChanged}
                      readOnly={!isEditing}
                    />
                  )}
                  {tab === 'contracts' && (
                    <HrmContractPanel
                      employeeId={employee.employeeId}
                      rows={contracts}
                      onChanged={onContractsChanged}
                      readOnly={!isEditing}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Chân Drawer */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {isEditing ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isSaving}
                      onClick={handleSaveEdit}
                      className="h-8 gap-1.5 bg-blue-600 px-3.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-xs"
                    >
                      {isSaving ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      Lưu thay đổi
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isSaving}
                      onClick={handleCancelEdit}
                      className="h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      Hủy
                    </Button>
                  </>
                ) : (
                  <>
                    {canManage && active && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleStartEdit}
                        className="h-8 gap-1.5 border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold shadow-xs"
                      >
                        <PencilLine className="size-3.5" />
                        Sửa hồ sơ
                      </Button>
                    )}
                    {actions}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export const EmployeeDetailDrawer = EmployeeDetailDialog;