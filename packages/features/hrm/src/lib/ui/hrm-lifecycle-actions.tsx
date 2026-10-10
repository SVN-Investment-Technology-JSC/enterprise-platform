'use client';

import { useState } from 'react';
import type {
  HrmEmployeeProfile,
  HrmSalaryGrade,
  HrmSalaryGradeStep,
  HrmJobDescriptionItem,
} from '@enterprise-platform/contracts-hrm';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';
import { toast } from './toast';
import { LeaveSettlementPreview } from './leave-settlement-preview';

export const employmentLabels: Record<string, string> = {
  PROBATION: 'Thử việc',
  OFFICIAL: 'Chính thức',
  ON_LEAVE: 'Tạm nghỉ',
  RESIGNED: 'Đã nghỉ việc',
  TERMINATED: 'Chấm dứt hợp đồng',
};
type Changed = () => Promise<void>;

export function EmployeeLifecycleActions({
  employee,
  onChanged,
}: {
  employee: HrmEmployeeProfile;
  onChanged: Changed;
}) {
  const [action, setAction] = useState<HrmAction | null>(null);
  const inactive = ['RESIGNED', 'TERMINATED'].includes(
    employee.employmentStatus,
  );
  const edit = () =>
    setAction({
      title: `Cập nhật hồ sơ · ${employee.employeeCode}`,
      columns: 2,
      description: `Ngày vào làm: ${employee.joinDate}. Họ tên và email do Core quản lý, không sửa tại đây. Thay đổi hồ sơ không đổi thông tin đăng nhập ERP.`,
      fields: [
        {
          key: 'dateOfBirth',
          label: 'Ngày sinh',
          section: 'Thông tin nhân sự',
          value: employee.dateOfBirth || '',
          optional: true,
          type: 'date',
        },
        {
          key: 'gender',
          label: 'Giới tính',
          section: 'Thông tin nhân sự',
          value: employee.gender || '',
          optional: true,
          options: [
            { value: 'MALE', label: 'Nam' },
            { value: 'FEMALE', label: 'Nữ' },
            { value: 'OTHER', label: 'Khác' },
          ],
        },
        {
          key: 'officialDate',
          label: 'Ngày chính thức',
          section: 'Thông tin nhân sự',
          value: employee.officialDate || '',
          optional: true,
          type: 'date',
        },
        {
          key: 'employmentStatus',
          label: 'Trạng thái làm việc',
          section: 'Thông tin nhân sự',
          value: employee.employmentStatus || '',
          optional: false,
          options: ['PROBATION', 'OFFICIAL', 'ON_LEAVE'].map((value) => ({
            value,
            label: employmentLabels[value],
          })),
        },
        {
          key: 'maritalStatus',
          label: 'Tình trạng hôn nhân',
          section: 'Thông tin nhân sự',
          value: employee.maritalStatus || '',
          optional: true,
        },
        {
          key: 'nationality',
          label: 'Quốc tịch',
          section: 'Thông tin nhân sự',
          value: employee.nationality || '',
          optional: true,
        },
        {
          key: 'ethnicity',
          label: 'Dân tộc',
          section: 'Thông tin nhân sự',
          value: employee.ethnicity || '',
          optional: true,
        },
        {
          key: 'religion',
          label: 'Tôn giáo',
          section: 'Thông tin nhân sự',
          value: employee.religion || '',
          optional: true,
        },
        {
          key: 'placeOfBirth',
          label: 'Nơi sinh',
          section: 'Thông tin nhân sự',
          value: employee.placeOfBirth || '',
          optional: true,
        },
        {
          key: 'hometown',
          label: 'Quê quán',
          section: 'Thông tin nhân sự',
          value: employee.hometown || '',
          optional: true,
        },
        {
          key: 'identityCardNumber',
          label: 'Số giấy tờ định danh',
          section: 'Định danh và chi trả',
          value: employee.identityCardNumber || '',
          optional: true,
        },
        {
          key: 'identityCardIssuedDate',
          label: 'Ngày cấp',
          section: 'Định danh và chi trả',
          value: employee.identityCardIssuedDate || '',
          optional: true,
          type: 'date',
        },
        {
          key: 'identityCardIssuedPlace',
          label: 'Nơi cấp',
          section: 'Định danh và chi trả',
          value: employee.identityCardIssuedPlace || '',
          optional: true,
        },
        {
          key: 'taxCode',
          label: 'Mã số thuế',
          section: 'Định danh và chi trả',
          value: employee.taxCode || '',
          optional: true,
        },
        {
          key: 'socialInsuranceNumber',
          label: 'Số bảo hiểm xã hội',
          section: 'Định danh và chi trả',
          value: employee.socialInsuranceNumber || '',
          optional: true,
        },
        {
          key: 'bankAccountNumber',
          label: 'Tài khoản ngân hàng',
          section: 'Định danh và chi trả',
          value: employee.bankAccountNumber || '',
          optional: true,
        },
        {
          key: 'bankName',
          label: 'Ngân hàng',
          section: 'Định danh và chi trả',
          value: employee.bankName || '',
          optional: true,
        },
        {
          key: 'bankBranch',
          label: 'Chi nhánh ngân hàng',
          section: 'Định danh và chi trả',
          value: employee.bankBranch || '',
          optional: true,
        },
        {
          key: 'personalEmail',
          label: 'Email cá nhân',
          section: 'Liên hệ',
          value: employee.personalEmail || '',
          optional: true,
        },
        {
          key: 'phone',
          label: 'Số điện thoại',
          section: 'Liên hệ',
          value: employee.phone || '',
          optional: true,
        },
        {
          key: 'currentAddress',
          label: 'Địa chỉ liên hệ',
          section: 'Liên hệ',
          value: employee.currentAddress || '',
          optional: true,
        },
        {
          key: 'permanentAddress',
          label: 'Địa chỉ thường trú',
          section: 'Liên hệ',
          value: employee.permanentAddress || '',
          optional: true,
        },
        {
          key: 'emergencyContactName',
          label: 'Người liên hệ khẩn cấp',
          section: 'Liên hệ',
          value: employee.emergencyContactName || '',
          optional: true,
        },
        {
          key: 'emergencyContactPhone',
          label: 'Điện thoại khẩn cấp',
          section: 'Liên hệ',
          value: employee.emergencyContactPhone || '',
          optional: true,
        },
        {
          key: 'emergencyContactRelationship',
          label: 'Quan hệ liên hệ khẩn cấp',
          section: 'Liên hệ',
          value: employee.emergencyContactRelationship || '',
          optional: true,
        },
        {
          key: 'note',
          label: 'Ghi chú',
          section: 'Liên hệ',
          value: employee.note || '',
          optional: true,
        },
      ],
      submit: async (values) => {
        await hrmFetch(`/employees/${employee.employeeId}/profile`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...Object.fromEntries(
              Object.entries(values).map(([key, value]) => [
                key,
                value.trim() || null,
              ]),
            ),
            expectedUpdatedAt: employee.updatedAt,
          }),
        });
        await onChanged();
        toast.success('Đã cập nhật hồ sơ');
      },
    });
  const deactivate = () =>
    setAction({
      title: `Ngừng nhân viên · ${employee.employeeCode}`,
      confirmTitle: 'Ngừng hồ sơ HRM và giữ tài khoản ERP, lịch sử công/lương?',
      fields: [
        {
          key: 'effectiveDate',
          label: 'Ngày ngừng (không sau hôm nay)',
          type: 'date',
        },
        { key: 'reason', label: 'Lý do ngừng' },
      ],
      extra: (values) => (
        <LeaveSettlementPreview
          employeeId={employee.employeeId}
          date={values.effectiveDate}
        />
      ),
      submit: async (values) => {
        await hrmFetch(`/employees/${employee.employeeId}/deactivate`, {
          method: 'POST',
          body: JSON.stringify({
            ...values,
            expectedUpdatedAt: employee.updatedAt,
          }),
        });
        await onChanged();
        toast.success(
          'Đã ngừng hồ sơ và quyết toán phép; lịch sử và tài khoản được giữ nguyên',
        );
      },
    });
  return (
    <span className="inline-flex gap-1">
      {!inactive && (
        <>
          <Button
            permission="hrm.employee.manage"
            size="sm"
            variant="outline"
            onClick={edit}
          >
            Sửa
          </Button>
          <Button
            permission="hrm.employee.manage"
            size="sm"
            variant="outline"
            onClick={deactivate}
          >
            Ngừng
          </Button>
        </>
      )}
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </span>
  );
}

export function CatalogRemoval({
  path,
  version,
  label,
  permission,
  onChanged,
  className,
}: {
  path: string;
  version: string;
  label: string;
  permission: 'hrm.salary.manage' | 'hrm.employee.manage';
  onChanged: Changed;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Popconfirm
      title={`Xóa ${label}?`}
      description="Chỉ xóa cấu hình chưa được sử dụng. Bản ghi có lịch sử phải ngừng hiệu lực."
      okText="Xóa"
      cancelText="Quay lại"
      okType="danger"
      onConfirm={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await hrmFetch(path, {
            method: 'DELETE',
            body: JSON.stringify({ expectedUpdatedAt: version }),
          });
          await onChanged();
          toast.success('Đã xóa cấu hình chưa sử dụng');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Không thể xóa');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Button
        permission={permission}
        variant="outline"
        size="sm"
        disabled={busy}
        className={className || 'h-6.5 text-[11px] px-2 text-rose-600 hover:bg-rose-50 border-rose-200'}
      >
        Xóa
      </Button>
    </Popconfirm>
  );
}

export function SalaryStepActions({
  step,
  onChanged,
}: {
  step: HrmSalaryGradeStep;
  onChanged: Changed;
}) {
  const [action, setAction] = useState<HrmAction | null>(null);
  const path = `/salary-grades/${step.salaryGradeId}/steps/${step.id}`;
  const edit = () =>
    setAction({
      title: `Cập nhật bậc ${step.stepNo}`,
      fields: [
        {
          key: 'minSalary',
          label: 'Lương tối thiểu',
          type: 'number',
          min: 0,
          value: step.minSalary,
        },
        {
          key: 'midSalary',
          label: 'Lương trung vị',
          type: 'number',
          min: 0,
          value: step.midSalary,
        },
        {
          key: 'maxSalary',
          label: 'Lương tối đa',
          type: 'number',
          min: 0,
          value: step.maxSalary,
        },
        {
          key: 'baseSalary',
          label: 'Lương cơ bản',
          type: 'number',
          min: 0,
          value: step.baseSalary,
        },
        {
          key: 'effectiveFrom',
          label: 'Hiệu lực từ',
          type: 'date',
          value: step.effectiveFrom,
        },
        {
          key: 'effectiveTo',
          label: 'Hiệu lực đến',
          type: 'date',
          value: step.effectiveTo || '',
          optional: true,
        },
      ],
      submit: async (values) => {
        await hrmFetch(path, {
          method: 'PATCH',
          body: JSON.stringify({
            ...values,
            minSalary: Number(values.minSalary),
            midSalary: Number(values.midSalary),
            maxSalary: Number(values.maxSalary),
            baseSalary: Number(values.baseSalary),
            effectiveTo: values.effectiveTo || null,
            expectedUpdatedAt: step.updatedAt,
          }),
        });
        await onChanged();
      },
    });
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs">
        {step.status === 'ACTIVE' ? 'Đang dùng' : 'Đã ngừng'}
      </span>
      <Button
        permission="hrm.salary.manage"
        size="sm"
        variant="outline"
        onClick={edit}
      >
        Sửa
      </Button>
      <CatalogStatusAction
        path={path}
        version={step.updatedAt}
        active={step.status === 'ACTIVE'}
        permission="hrm.salary.manage"
        onChanged={onChanged}
      />
      <CatalogRemoval
        path={path}
        version={step.updatedAt}
        label={`bậc ${step.stepNo}`}
        permission="hrm.salary.manage"
        onChanged={onChanged}
      />
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}

function CatalogStatusAction({
  path,
  version,
  active,
  permission,
  onChanged,
  position = false,
  className,
}: {
  path: string;
  version: string;
  active: boolean;
  permission: 'hrm.salary.manage' | 'hrm.employee.manage';
  onChanged: Changed;
  position?: boolean;
  className?: string;
}) {
  return (
    <Popconfirm
      title={
        active ? 'Ngừng sử dụng cấu hình này?' : 'Kích hoạt lại cấu hình này?'
      }
      okText="Xác nhận"
      cancelText="Quay lại"
      onConfirm={async () => {
        try {
          await hrmFetch(path, {
            method: 'PATCH',
            body: JSON.stringify({
              expectedUpdatedAt: version,
              ...(position
                ? { active: !active }
                : { status: active ? 'INACTIVE' : 'ACTIVE' }),
            }),
          });
          await onChanged();
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : 'Không thể đổi trạng thái',
          );
        }
      }}
    >
      <Button
        permission={permission}
        size="sm"
        variant="outline"
        className={className || 'h-6.5 text-[11px] px-2 text-slate-700 hover:bg-slate-50 border-slate-200'}
      >
        {active ? 'Ngừng' : 'Kích hoạt'}
      </Button>
    </Popconfirm>
  );
}

export function GradeLifecycleActions({
  grade,
  onChanged,
  className,
}: {
  grade: HrmSalaryGrade;
  onChanged: Changed;
  className?: string;
}) {
  return (
    <span
      className={className || 'inline-flex items-center gap-1.5'}
      onClick={(event) => event.stopPropagation()}
    >
      <CatalogStatusAction
        path={`/salary-grades/${grade.id}`}
        version={grade.updatedAt}
        active={grade.status === 'ACTIVE'}
        permission="hrm.salary.manage"
        onChanged={onChanged}
      />
      <CatalogRemoval
        path={`/salary-grades/${grade.id}`}
        version={grade.updatedAt}
        label={grade.code}
        permission="hrm.salary.manage"
        onChanged={onChanged}
      />
    </span>
  );
}

export function PositionLifecycleActions({
  position,
  onChanged,
  className,
}: {
  position: HrmJobDescriptionItem;
  onChanged: Changed;
  className?: string;
}) {
  if (!position.updatedAt) return null;
  const path = `/positions/${position.positionId}/profile`;
  return (
    <span className={className || 'inline-flex items-center gap-1.5'}>
      <CatalogStatusAction
        path={path}
        version={position.updatedAt}
        active={position.active}
        permission="hrm.employee.manage"
        onChanged={onChanged}
        position
      />
      <CatalogRemoval
        path={path}
        version={position.updatedAt}
        label={`JD ${position.positionCode}`}
        permission="hrm.employee.manage"
        onChanged={onChanged}
      />
    </span>
  );
}
