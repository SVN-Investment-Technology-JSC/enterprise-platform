'use client';

import { Building2, User, Users, UsersRound } from 'lucide-react';
import type { HrmOrgUnitOption } from '@enterprise-platform/contracts-hrm';
import { SearchableSelect, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import type { ScopeDraft } from '../../hrm-work-schedule-model';
import { InfoNote, RadioCards, type RadioCardOption } from '../settings-kit';
import { Field } from './common';
import { ScopePicker } from './scope-picker';

const SCOPE_CARDS: Record<ScopeDraft['type'], Omit<RadioCardOption<ScopeDraft['type']>, 'value'>> = {
  EMPLOYEE: {
    title: 'Một nhân viên',
    description: 'Chỉ áp dụng cho một nhân viên được chọn',
    icon: User,
  },
  EMPLOYEES: {
    title: 'Nhiều nhân viên',
    description: 'Chọn nhiều nhân viên cùng lúc',
    icon: Users,
  },
  UNIT: {
    title: 'Theo đơn vị',
    description: 'Áp dụng cho nhân viên thuộc đơn vị được chọn',
    icon: Building2,
  },
  COMPANY: {
    title: 'Toàn bộ nhân viên',
    description: 'Áp dụng cho tất cả nhân viên đang làm việc',
    icon: UsersRound,
  },
};

/**
 * Chọn phạm vi áp dụng bằng thẻ chọn (một thẻ cho mỗi kiểu phạm vi được phép), kiểu cần chọn thêm (nhân viên, đơn vị,
 * loại trừ) hiện ngay bên dưới. Dùng chung cho biểu mẫu Phân ca và Nhả ca.
 */
export function ScopeCards({
  value,
  onChange,
  allowedTypes,
  employeeOptions,
  employeesLoading,
  employeesError,
  units,
  openEnded = false,
  label = 'Phạm vi áp dụng',
}: {
  value: ScopeDraft;
  onChange: (next: ScopeDraft) => void;
  allowedTypes: ScopeDraft['type'][];
  employeeOptions: readonly SearchableSelectOption[];
  employeesLoading: boolean;
  employeesError: string;
  units: readonly HrmOrgUnitOption[];
  openEnded?: boolean;
  label?: string;
}) {
  const options = allowedTypes.map((type) => ({ value: type, ...SCOPE_CARDS[type] }));
  // Số nhân viên chỉ hiện khi có số thật: danh sách nhân viên đang làm việc đã tải xong (trừ những người được loại trừ).
  const loaded = !employeesLoading && !employeesError && employeeOptions.length > 0;
  const companyCount = employeeOptions.length - (openEnded ? 0 : value.excludeEmployeeIds.length);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-xs font-semibold text-slate-700">
          {label}
          <span className="ml-1 font-bold text-red-500" aria-hidden="true">
            *
          </span>
        </span>
        {allowedTypes.length > 1 ? (
          <RadioCards
            label={label}
            value={value.type}
            onChange={(type) => onChange({ ...value, type })}
            options={options}
            className="@4xl:grid-cols-2!"
          />
        ) : null}
      </div>
      {value.type === 'COMPANY' && loaded ? (
        <InfoNote tone="slate" icon={Users} role="status">
          Áp dụng cho <strong className="text-slate-900">{Math.max(0, companyCount)}</strong> nhân viên đang làm việc
        </InfoNote>
      ) : null}
      <ScopePicker
        value={value}
        onChange={onChange}
        allowedTypes={allowedTypes}
        employeeOptions={employeeOptions}
        employeesLoading={employeesLoading}
        employeesError={employeesError}
        units={units}
        openEnded={openEnded}
        hideTypeSwitch={allowedTypes.length > 1}
      />
    </div>
  );
}

/**
 * Chọn đối tượng áp dụng bằng ô chọn: tuỳ đối tượng mà phần chọn thêm (nhân viên, đơn vị, loại trừ) xuất hiện bên dưới.
 * Dùng cho biểu mẫu Phân ca trong trang.
 */
export function ScopeSelect({
  value,
  onChange,
  allowedTypes,
  employeeOptions,
  employeesLoading,
  employeesError,
  units,
  openEnded = false,
  label = 'Đối tượng áp dụng',
}: {
  value: ScopeDraft;
  onChange: (next: ScopeDraft) => void;
  allowedTypes: ScopeDraft['type'][];
  employeeOptions: readonly SearchableSelectOption[];
  employeesLoading: boolean;
  employeesError: string;
  units: readonly HrmOrgUnitOption[];
  openEnded?: boolean;
  label?: string;
}) {
  const options: SearchableSelectOption[] = allowedTypes.map((type) => ({
    value: type,
    label: SCOPE_CARDS[type].title,
  }));
  const loaded = !employeesLoading && !employeesError && employeeOptions.length > 0;
  const companyCount = employeeOptions.length - (openEnded ? 0 : value.excludeEmployeeIds.length);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Field label={label} required hint={SCOPE_CARDS[value.type].description}>
        <SearchableSelect
          height={36}
          options={options}
          value={value.type}
          placeholder="Chọn đối tượng áp dụng…"
          emptyText="Không có đối tượng phù hợp"
          onChange={(type) => type && onChange({ ...value, type: type as ScopeDraft['type'] })}
          clearable={false}
          disabled={allowedTypes.length < 2}
        />
      </Field>
      {value.type === 'COMPANY' && loaded ? (
        <InfoNote tone="slate" icon={Users} role="status">
          Áp dụng cho <strong className="text-slate-900">{Math.max(0, companyCount)}</strong> nhân viên đang làm việc
        </InfoNote>
      ) : null}
      <ScopePicker
        value={value}
        onChange={onChange}
        allowedTypes={allowedTypes}
        employeeOptions={employeeOptions}
        employeesLoading={employeesLoading}
        employeesError={employeesError}
        units={units}
        openEnded={openEnded}
        hideTypeSwitch
      />
    </div>
  );
}
