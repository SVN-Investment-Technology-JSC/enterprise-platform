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
      fields: [
        {
          key: 'personalEmail',
          label: 'Email cá nhân',
          value: employee.personalEmail || '',
          optional: true,
        },
        {
          key: 'phone',
          label: 'Số điện thoại',
          value: employee.phone || '',
          optional: true,
        },
        {
          key: 'currentAddress',
          label: 'Địa chỉ liên hệ',
          value: employee.currentAddress || '',
          optional: true,
        },
        {
          key: 'emergencyContactName',
          label: 'Người liên hệ khẩn cấp',
          value: employee.emergencyContactName || '',
          optional: true,
        },
        {
          key: 'emergencyContactPhone',
          label: 'Điện thoại khẩn cấp',
          value: employee.emergencyContactPhone || '',
          optional: true,
        },
        {
          key: 'employmentStatus',
          label: 'Trạng thái làm việc',
          value: employee.employmentStatus,
          options: ['PROBATION', 'OFFICIAL', 'ON_LEAVE'].map((value) => ({
            value,
            label: employmentLabels[value],
          })),
        },
        {
          key: 'note',
          label: 'Ghi chú',
          value: employee.note || '',
          optional: true,
        },
      ],
      submit: async (values) => {
        await hrmFetch(`/employees/${employee.employeeId}/profile`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...values,
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
      submit: async (values) => {
        await hrmFetch(`/employees/${employee.employeeId}/deactivate`, {
          method: 'POST',
          body: JSON.stringify({
            ...values,
            expectedUpdatedAt: employee.updatedAt,
          }),
        });
        await onChanged();
        toast.success('Đã ngừng hồ sơ; lịch sử và tài khoản được giữ nguyên');
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
}: {
  path: string;
  version: string;
  label: string;
  permission: 'hrm.salary.manage' | 'hrm.employee.manage';
  onChanged: Changed;
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
}: {
  path: string;
  version: string;
  active: boolean;
  permission: 'hrm.salary.manage' | 'hrm.employee.manage';
  onChanged: Changed;
  position?: boolean;
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
      <Button permission={permission} size="sm" variant="outline">
        {active ? 'Ngừng' : 'Kích hoạt'}
      </Button>
    </Popconfirm>
  );
}

export function GradeLifecycleActions({
  grade,
  onChanged,
}: {
  grade: HrmSalaryGrade;
  onChanged: Changed;
}) {
  return (
    <span
      className="inline-flex gap-1"
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
}: {
  position: HrmJobDescriptionItem;
  onChanged: Changed;
}) {
  if (!position.updatedAt) return null;
  const path = `/positions/${position.positionId}/profile`;
  return (
    <span className="inline-flex gap-1">
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
