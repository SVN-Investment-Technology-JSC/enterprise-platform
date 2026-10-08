import type {
  HrmEmployeeProfile,
  HrmEmploymentContract,
} from '@enterprise-platform/contracts-hrm';

/**
 * Trường liên quan lương trong payload hồ sơ nhân viên chỉ trả cho người có `hrm.salary.read`
 * (hoặc hrm.manage/tenant.manage), hoặc khi người xem là chính nhân viên đó.
 */
export function canSeeSalaryFields(
  permissions: readonly string[] | undefined,
  isSelf: boolean,
): boolean {
  if (isSelf) return true;
  const list = permissions ?? [];
  return (
    list.includes('hrm.salary.read') ||
    list.includes('hrm.manage') ||
    list.includes('tenant.manage')
  );
}

export function redactContractSalary(
  contract: HrmEmploymentContract,
): HrmEmploymentContract {
  return { ...contract, baseSalary: null, issuedSnapshot: null };
}

export function redactProfileSalary(
  profile: HrmEmployeeProfile,
): HrmEmployeeProfile {
  return {
    ...profile,
    salaryGrade: null,
    contracts: profile.contracts?.map(redactContractSalary),
  };
}
