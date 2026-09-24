// ============================================================================
// HRM Contracts (Phase 1 — 23 Tables & API Specifications)
// Source specs: D:\HRM\DOCX_md\P2_S3_HRM_API.md & HRM_Lược đồ ERD.md
// ============================================================================

// ----------------------------------------------------------------------------
// 1. Common Response & Meta Types
// ----------------------------------------------------------------------------

export interface HrmApiMeta {
  readonly requestId?: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly total?: number;
}

export interface HrmApiResponse<T> {
  readonly data: T;
  readonly meta?: HrmApiMeta;
}

export interface HrmApiError {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
  readonly meta?: HrmApiMeta;
}

// ----------------------------------------------------------------------------
// 2. Foundation: Policies & Policy Versions
// ----------------------------------------------------------------------------

export type HrmPolicyType = 'ATTENDANCE' | 'LEAVE' | 'OT' | 'PAYROLL' | 'SHIFT' | 'GENERAL';
export type HrmPolicyStatus = 'ACTIVE' | 'INACTIVE' | 'DEPRECATED';
export type HrmPolicyVersionStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';

export interface HrmPolicy {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
  readonly policyType: HrmPolicyType;
  readonly status: HrmPolicyStatus;
  readonly description?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy?: string | null;
  readonly updatedBy?: string | null;
}

export interface HrmPolicyVersion {
  readonly id: string;
  readonly policyId: string;
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly configJson: Record<string, unknown>;
  readonly status: HrmPolicyVersionStatus;
  readonly createdAt: string;
  readonly createdBy?: string | null;
}

export interface CreatePolicyRequest {
  readonly code: string;
  readonly name: string;
  readonly policyType: HrmPolicyType;
  readonly description?: string;
  readonly status?: HrmPolicyStatus;
}

export interface UpdatePolicyRequest {
  readonly name?: string;
  readonly status?: HrmPolicyStatus;
  readonly description?: string;
}

export interface CreatePolicyVersionRequest {
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly configJson: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// 3. Foundation: Salary Grades & Steps
// ----------------------------------------------------------------------------

export interface HrmSalaryGrade {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HrmSalaryGradeStep {
  readonly id: string;
  readonly tenantId: string;
  readonly salaryGradeId: string;
  readonly stepNo: number;
  readonly minSalary: number;
  readonly midSalary: number;
  readonly maxSalary: number;
  readonly baseSalary: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSalaryGradeRequest {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly status?: 'ACTIVE' | 'INACTIVE';
}

export interface UpdateSalaryGradeRequest {
  readonly name?: string;
  readonly description?: string;
  readonly status?: 'ACTIVE' | 'INACTIVE';
}

export interface CreateSalaryGradeStepRequest {
  readonly stepNo: number;
  readonly minSalary: number;
  readonly midSalary: number;
  readonly maxSalary: number;
  readonly baseSalary: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

export interface UpdateSalaryGradeStepRequest {
  readonly minSalary?: number;
  readonly midSalary?: number;
  readonly maxSalary?: number;
  readonly baseSalary?: number;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string | null;
}

// ----------------------------------------------------------------------------
// 4. Profiles: Employee Profile & Position Profile
// ----------------------------------------------------------------------------

export type HrmGender = 'MALE' | 'FEMALE' | 'OTHER';
export type HrmEmploymentStatus = 'PROBATION' | 'OFFICIAL' | 'ON_LEAVE' | 'RESIGNED' | 'TERMINATED';

export interface HrmEmployeeProfile {
  readonly employeeId: string;
  readonly tenantId: string;
  readonly employeeCode: string;
  readonly fullName?: string | null;
  readonly email?: string | null;
  readonly department?: string | null;
  readonly position?: string | null;
  readonly personalEmail?: string | null;
  readonly phone?: string | null;
  readonly dateOfBirth?: string | null;
  readonly gender?: HrmGender | null;
  readonly identityCardNumber?: string | null;
  readonly identityCardIssuedDate?: string | null;
  readonly identityCardIssuedPlace?: string | null;
  readonly taxCode?: string | null;
  readonly socialInsuranceNumber?: string | null;
  readonly bankAccountNumber?: string | null;
  readonly bankName?: string | null;
  readonly bankBranch?: string | null;
  readonly currentAddress?: string | null;
  readonly permanentAddress?: string | null;
  readonly emergencyContactName?: string | null;
  readonly emergencyContactPhone?: string | null;
  readonly emergencyContactRelationship?: string | null;
  readonly joinDate: string;
  readonly officialDate?: string | null;
  readonly employmentStatus: HrmEmploymentStatus;
  readonly division?: string | null;
  readonly team?: string | null;
  readonly location?: string | null;
  readonly positionCode?: string | null;
  readonly salaryGrade?: string | null;
  readonly appointmentDecisionNo?: string | null;
  readonly directManagerName?: string | null;
  readonly directManagerTitle?: string | null;
  readonly directManagerEmail?: string | null;
  readonly note?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateEmployeeProfileRequest {
  readonly employeeCode: string;
  readonly personalEmail?: string;
  readonly phone?: string;
  readonly dateOfBirth?: string;
  readonly gender?: HrmGender;
  readonly identityCardNumber?: string;
  readonly identityCardIssuedDate?: string;
  readonly identityCardIssuedPlace?: string;
  readonly taxCode?: string;
  readonly socialInsuranceNumber?: string;
  readonly bankAccountNumber?: string;
  readonly bankName?: string;
  readonly bankBranch?: string;
  readonly currentAddress?: string;
  readonly permanentAddress?: string;
  readonly emergencyContactName?: string;
  readonly emergencyContactPhone?: string;
  readonly emergencyContactRelationship?: string;
  readonly joinDate: string;
  readonly officialDate?: string | null;
  readonly employmentStatus?: HrmEmploymentStatus;
  readonly note?: string | null;
}

export interface UpdateEmployeeProfileRequest {
  readonly personalEmail?: string;
  readonly phone?: string;
  readonly dateOfBirth?: string;
  readonly gender?: HrmGender;
  readonly identityCardNumber?: string;
  readonly identityCardIssuedDate?: string;
  readonly identityCardIssuedPlace?: string;
  readonly taxCode?: string;
  readonly socialInsuranceNumber?: string;
  readonly bankAccountNumber?: string;
  readonly bankName?: string;
  readonly bankBranch?: string;
  readonly currentAddress?: string;
  readonly permanentAddress?: string;
  readonly emergencyContactName?: string;
  readonly emergencyContactPhone?: string;
  readonly emergencyContactRelationship?: string;
  readonly joinDate?: string;
  readonly officialDate?: string | null;
  readonly employmentStatus?: HrmEmploymentStatus;
  readonly note?: string | null;
}

export interface HrmResponsibilityItem {
  readonly title: string;
  readonly description?: string;
  readonly weight?: number;
  readonly sortOrder?: number;
}

export interface HrmRequirementItem {
  readonly type?: 'EDUCATION' | 'EXPERIENCE' | 'SKILL' | 'CERTIFICATE' | 'OTHER';
  readonly title: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface HrmJobDescriptionItem {
  readonly positionId: string;
  readonly positionCode: string;
  readonly positionName: string;
  readonly unit?: {
    readonly id: string;
    readonly name: string;
  } | null;
  readonly salaryGrade?: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  } | null;
  readonly defaultPolicyId?: string | null;
  readonly jdStatus: 'CONFIGURED' | 'NOT_CONFIGURED';
  readonly jobPurpose?: string | null;
  readonly responsibilities: readonly (string | HrmResponsibilityItem)[];
  readonly requirements: readonly (string | HrmRequirementItem)[];
  readonly authorities?: readonly string[];
  readonly active: boolean;
  readonly activeEmployeeCount: number;
}

export interface HrmPositionProfile {
  readonly positionId: string;
  readonly tenantId: string;
  readonly salaryGradeId?: string | null;
  readonly defaultPolicyId?: string | null;
  readonly description?: string | null;
  readonly responsibilities: readonly (string | HrmResponsibilityItem)[];
  readonly requirements: readonly (string | HrmRequirementItem)[];
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePositionProfileRequest {
  readonly salaryGradeId?: string | null;
  readonly defaultPolicyId?: string | null;
  readonly description?: string | null;
  readonly responsibilities?: readonly (string | HrmResponsibilityItem)[];
  readonly requirements?: readonly (string | HrmRequirementItem)[];
  readonly authorities?: readonly string[];
  readonly active?: boolean;
}

export interface UpdatePositionProfileRequest {
  readonly salaryGradeId?: string | null;
  readonly defaultPolicyId?: string | null;
  readonly description?: string | null;
  readonly responsibilities?: readonly (string | HrmResponsibilityItem)[];
  readonly requirements?: readonly (string | HrmRequirementItem)[];
  readonly authorities?: readonly string[];
  readonly active?: boolean;
}

// ----------------------------------------------------------------------------
// 5. Time & Attendance (Shifts, Assignments, Attendance, Corrections)
// ----------------------------------------------------------------------------

export interface HrmShiftDefinition {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly breakMinutes: number;
  readonly crossMidnight: boolean;
  readonly graceLateMinutes: number;
  readonly graceEarlyMinutes: number;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateShiftDefinitionRequest {
  readonly code: string;
  readonly name: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly breakMinutes?: number;
  readonly crossMidnight?: boolean;
  readonly graceLateMinutes?: number;
  readonly graceEarlyMinutes?: number;
  readonly status?: 'ACTIVE' | 'INACTIVE';
}

export interface UpdateShiftDefinitionRequest {
  readonly name?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly breakMinutes?: number;
  readonly crossMidnight?: boolean;
  readonly graceLateMinutes?: number;
  readonly graceEarlyMinutes?: number;
  readonly status?: 'ACTIVE' | 'INACTIVE';
}

export type HrmShiftAssignmentSource = 'MANUAL' | 'SCHEDULE_POLICY' | 'SWAP_REQUEST';
export type HrmShiftAssignmentStatus = 'ACTIVE' | 'SUPERSEDED' | 'CANCELLED';

export interface HrmShiftAssignment {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly positionId?: string | null;
  readonly shiftId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly source: HrmShiftAssignmentSource;
  readonly status: HrmShiftAssignmentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateShiftAssignmentRequest {
  readonly shiftId: string;
  readonly positionId?: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly source?: HrmShiftAssignmentSource;
}

export type HrmAttendanceSource = 'BIOMETRIC_DEVICE' | 'MOBILE_GPS' | 'WEB_PORTAL' | 'MANUAL_CORRECTION';
export type HrmAttendanceStatus = 'VALID' | 'LATE' | 'EARLY_LEAVE' | 'MISSING_PUNCH' | 'ABNORMAL' | 'APPROVED_CORRECTION';

export interface HrmAttendance {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly workDate: string;
  readonly checkInAt?: string | null;
  readonly checkOutAt?: string | null;
  readonly attendanceSource: HrmAttendanceSource;
  readonly deviceId?: string | null;
  readonly status: HrmAttendanceStatus;
  readonly workedMinutes: number;
  readonly note?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CheckInRequest {
  readonly employeeId: string;
  readonly occurredAt?: string;
  readonly source?: HrmAttendanceSource;
  readonly deviceId?: string | null;
}

export interface CheckOutRequest {
  readonly employeeId: string;
  readonly occurredAt?: string;
  readonly source?: HrmAttendanceSource;
  readonly deviceId?: string | null;
}

export interface IngestAttendanceRequest {
  readonly employeeId: string;
  readonly occurredAt: string;
  readonly source: HrmAttendanceSource;
  readonly deviceId?: string;
  readonly externalEventId?: string;
}

export type HrmAttendanceCorrectionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface HrmAttendanceCorrection {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly attendanceId?: string | null;
  readonly requestDate: string;
  readonly oldCheckInAt?: string | null;
  readonly oldCheckOutAt?: string | null;
  readonly newCheckInAt?: string | null;
  readonly newCheckOutAt?: string | null;
  readonly reason: string;
  readonly status: HrmAttendanceCorrectionStatus;
  readonly workflowInstanceId?: string | null;
  readonly submittedBy: string;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly rejectionReason?: string | null;
  readonly appliedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateAttendanceCorrectionRequest {
  readonly employeeId: string;
  readonly attendanceId?: string | null;
  readonly requestDate: string;
  readonly newCheckInAt?: string | null;
  readonly newCheckOutAt?: string | null;
  readonly reason: string;
}

// ----------------------------------------------------------------------------
// 6. Leave Management
// ----------------------------------------------------------------------------

export interface HrmLeaveType {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
  readonly unit: 'DAYS' | 'HOURS';
  readonly paid: boolean;
  readonly requiresAttachment: boolean;
  readonly carryoverAllowed: boolean;
  readonly maxCarryoverDays: number;
  readonly carryoverExpiryMonth: number;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateLeaveTypeRequest {
  readonly code: string;
  readonly name: string;
  readonly unit?: 'DAYS' | 'HOURS';
  readonly paid?: boolean;
  readonly requiresAttachment?: boolean;
  readonly carryoverAllowed?: boolean;
  readonly maxCarryoverDays?: number;
  readonly carryoverExpiryMonth?: number;
  readonly active?: boolean;
}

export interface UpdateLeaveTypeRequest {
  readonly name?: string;
  readonly paid?: boolean;
  readonly requiresAttachment?: boolean;
  readonly carryoverAllowed?: boolean;
  readonly maxCarryoverDays?: number;
  readonly carryoverExpiryMonth?: number;
  readonly active?: boolean;
}

export interface HrmLeaveAccrualSchedule {
  readonly id: string;
  readonly tenantId: string;
  readonly leaveTypeId: string;
  readonly policyVersionId?: string | null;
  readonly accrualFrequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'MILESTONE';
  readonly accrualAmount: number;
  readonly prorationRule?: string | null;
  readonly seniorityBonusYears: number;
  readonly seniorityBonusDays: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateLeaveAccrualScheduleRequest {
  readonly policyVersionId?: string | null;
  readonly accrualFrequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'MILESTONE';
  readonly accrualAmount: number;
  readonly prorationRule?: string;
  readonly seniorityBonusYears?: number;
  readonly seniorityBonusDays?: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

export interface HrmLeaveBalance {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly leaveTypeId: string;
  readonly year: number;
  readonly openingBalance: number;
  readonly accrued: number;
  readonly used: number;
  readonly pending: number;
  readonly adjusted: number;
  readonly remaining: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type HrmLeaveTransactionType = 'ACCRUAL' | 'USAGE' | 'ADJUSTMENT' | 'CARRYOVER_EXPIRE' | 'REVERSAL';

export interface HrmLeaveTransaction {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly leaveTypeId: string;
  readonly transactionType: HrmLeaveTransactionType;
  readonly daysChanged: number;
  readonly balanceAfter: number;
  readonly referenceRequestId?: string | null;
  readonly accrualScheduleId?: string | null;
  readonly note?: string | null;
  readonly createdAt: string;
}

export type HrmLeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface HrmLeaveRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly leaveTypeId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly duration: number;
  readonly reason: string;
  readonly status: HrmLeaveRequestStatus;
  readonly workflowInstanceId?: string | null;
  readonly attachmentFileId?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly appliedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateLeaveRequestPayload {
  readonly employeeId: string;
  readonly leaveTypeId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly duration: number;
  readonly reason: string;
  readonly attachmentFileId?: string | null;
}

export interface AmendLeaveRequestPayload {
  readonly fromDate: string;
  readonly toDate: string;
  readonly duration: number;
  readonly reason: string;
}

// ----------------------------------------------------------------------------
// 7. HR e-Requests (OT, Business Trip, Shift Change)
// ----------------------------------------------------------------------------

export type HrmOtType = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY' | 'NIGHT';
export type HrmOtStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface HrmOtRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly workDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly plannedMinutes: number;
  readonly approvedMinutes: number;
  readonly actualMinutes: number;
  readonly billableOtMinutes: number;
  readonly otType: HrmOtType;
  readonly otRateMultiplier: number;
  readonly policyVersionId?: string | null;
  readonly monthlyAccumulatedOtMinutes: number;
  readonly reason: string;
  readonly status: HrmOtStatus;
  readonly workflowInstanceId?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateOtRequestPayload {
  readonly employeeId: string;
  readonly workDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly plannedMinutes: number;
  readonly otType?: HrmOtType;
  readonly reason: string;
}

export type HrmBusinessTripType = 'DOMESTIC' | 'OVERSEAS' | 'INTERSITE';
export type HrmBusinessTripStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface HrmBusinessTripRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly businessTripType: HrmBusinessTripType;
  readonly destination: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly daysCount: number;
  readonly allowOt: boolean;
  readonly perDiemPolicyId?: string | null;
  readonly reason: string;
  readonly status: HrmBusinessTripStatus;
  readonly workflowInstanceId?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateBusinessTripRequestPayload {
  readonly employeeId: string;
  readonly businessTripType?: HrmBusinessTripType;
  readonly destination: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly daysCount: number;
  readonly allowOt?: boolean;
  readonly perDiemPolicyId?: string | null;
  readonly reason: string;
}

export type HrmShiftChangeType = 'SWAP' | 'CHANGE_SHIFT';
export type HrmShiftChangeStatus = 'PENDING' | 'PEER_CONFIRMED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface HrmShiftChangeRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly changeType: HrmShiftChangeType;
  readonly currentShiftId: string;
  readonly requestedShiftId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly swapWithEmployeeId?: string | null;
  readonly swapPeerConfirmed: boolean;
  readonly reason: string;
  readonly status: HrmShiftChangeStatus;
  readonly workflowInstanceId?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly appliedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateShiftChangeRequestPayload {
  readonly employeeId: string;
  readonly changeType?: HrmShiftChangeType;
  readonly currentShiftId: string;
  readonly requestedShiftId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly swapWithEmployeeId?: string | null;
  readonly reason: string;
}

// ----------------------------------------------------------------------------
// 8. Timesheet & Periods
// ----------------------------------------------------------------------------

export type HrmTimesheetPeriodStatus = 'OPEN' | 'SUBMITTED' | 'APPROVED' | 'LOCKED' | 'REOPENED';

export interface HrmTimesheetPeriod {
  readonly id: string;
  readonly tenantId: string;
  readonly periodCode: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly status: HrmTimesheetPeriodStatus;
  readonly submittedBy?: string | null;
  readonly submittedAt?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly lockedBy?: string | null;
  readonly lockedAt?: string | null;
  readonly reopenedBy?: string | null;
  readonly reopenedAt?: string | null;
  readonly reopenReason?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTimesheetPeriodRequest {
  readonly periodCode: string;
  readonly fromDate: string;
  readonly toDate: string;
}

export type HrmTimesheetStatus = 'NORMAL' | 'LEAVE' | 'HOLIDAY' | 'ABSENT' | 'ADJUSTED';

export interface HrmTimesheet {
  readonly id: string;
  readonly tenantId: string;
  readonly periodId: string;
  readonly employeeId: string;
  readonly workDate: string;
  readonly shiftId?: string | null;
  readonly attendanceId?: string | null;
  readonly leaveRequestId?: string | null;
  readonly otRequestId?: string | null;
  readonly businessTripRequestId?: string | null;
  readonly scheduledMinutes: number;
  readonly workedMinutes: number;
  readonly paidMinutes: number;
  readonly otMinutes: number;
  readonly lateMinutes: number;
  readonly earlyLeaveMinutes: number;
  readonly workdayUnits: number;
  readonly status: HrmTimesheetStatus;
  readonly isManuallyAdjusted: boolean;
  readonly adjustedBy?: string | null;
  readonly adjustedReason?: string | null;
  readonly calculationSnapshot: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdjustTimesheetRequest {
  readonly workdayUnits?: number;
  readonly paidMinutes?: number;
  readonly status?: HrmTimesheetStatus;
  readonly reason: string;
}

// ----------------------------------------------------------------------------
// 9. Salary Profiles & Salary Advance
// ----------------------------------------------------------------------------

export type HrmSalaryType = 'GROSS' | 'NET';
export type HrmEmployeeSalaryStatus = 'ACTIVE' | 'SUPERSEDED' | 'CANCELLED';

export interface HrmEmployeeSalaryProfile {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly salaryGradeId?: string | null;
  readonly salaryStepId?: string | null;
  readonly salaryType: HrmSalaryType;
  readonly baseSalary: number;
  readonly currency: string;
  readonly changeReason?: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly approvedBy?: string | null;
  readonly status: HrmEmployeeSalaryStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateEmployeeSalaryProfileRequest {
  readonly salaryGradeId?: string | null;
  readonly salaryStepId?: string | null;
  readonly salaryType?: HrmSalaryType;
  readonly baseSalary: number;
  readonly currency?: string;
  readonly changeReason?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

export type HrmSalaryAdvanceStatus = 'PENDING' | 'APPROVED' | 'DISBURSED' | 'REJECTED' | 'CANCELLED';

export interface HrmSalaryAdvanceRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly requestDate: string;
  readonly requestedAmount: number;
  readonly approvedAmount: number;
  readonly disbursedAmount: number;
  readonly numberOfInstallments: number;
  readonly totalDeductedAmount: number;
  readonly remainingBalance: number;
  readonly reason: string;
  readonly status: HrmSalaryAdvanceStatus;
  readonly workflowInstanceId?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly disbursedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSalaryAdvanceRequestPayload {
  readonly employeeId: string;
  readonly requestDate?: string;
  readonly requestedAmount: number;
  readonly numberOfInstallments?: number;
  readonly reason: string;
}

export interface DisburseSalaryAdvancePayload {
  readonly disbursedAmount: number;
}

export interface HrmSalaryAdvanceDeduction {
  readonly id: string;
  readonly tenantId: string;
  readonly advanceRequestId: string;
  readonly payrollPeriodId: string;
  readonly installmentNo: number;
  readonly scheduledAmount: number;
  readonly actualDeductedAmount: number;
  readonly status: 'SCHEDULED' | 'DEDUCTED' | 'SKIPPED' | 'CANCELLED';
  readonly deductedAt?: string | null;
  readonly payrollRunId?: string | null;
  readonly note?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ----------------------------------------------------------------------------
// 10. Payroll & Payslips
// ----------------------------------------------------------------------------

export type HrmPayrollPeriodStatus = 'OPEN' | 'PROCESSING' | 'LOCKED' | 'PAID';

export interface HrmPayrollPeriod {
  readonly id: string;
  readonly tenantId: string;
  readonly periodCode: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly timesheetPeriodId?: string | null;
  readonly paymentDate: string;
  readonly status: HrmPayrollPeriodStatus;
  readonly lockedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePayrollPeriodRequest {
  readonly periodCode: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly timesheetPeriodId?: string | null;
  readonly paymentDate: string;
}

export type HrmPayrollRunStatus = 'DRAFT' | 'CALCULATING' | 'CALCULATED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'FINALIZED';

export interface HrmPayrollRun {
  readonly id: string;
  readonly tenantId: string;
  readonly payrollPeriodId: string;
  readonly runNo: number;
  readonly calculationVersion: string;
  readonly status: HrmPayrollRunStatus;
  readonly reviewerId?: string | null;
  readonly reviewedAt?: string | null;
  readonly reviewNotes?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly rejectedBy?: string | null;
  readonly rejectionReason?: string | null;
  readonly finalizedBy?: string | null;
  readonly finalizedAt?: string | null;
  readonly calculatedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type HrmPayrollItemType = 'EARNING' | 'ALLOWANCE' | 'OVERTIME' | 'STATUTORY_DEDUCTION' | 'TAX_DEDUCTION' | 'ADVANCE_DEDUCTION' | 'NET_PAY';

export interface HrmPayrollItem {
  readonly id: string;
  readonly tenantId: string;
  readonly payrollRunId: string;
  readonly employeeId: string;
  readonly itemCode: string;
  readonly itemType: HrmPayrollItemType;
  readonly description: string;
  readonly quantity: number;
  readonly rate: number;
  readonly amount: number;
  readonly sourceType?: string | null;
  readonly sourceId?: string | null;
  readonly policyVersionId?: string | null;
  readonly calculationSnapshot: Record<string, unknown>;
  readonly createdAt: string;
}

export interface HrmPayrollEmployeeTotal {
  readonly id: string;
  readonly tenantId: string;
  readonly payrollRunId: string;
  readonly employeeId: string;
  readonly grossSalary: number;
  readonly totalAllowance: number;
  readonly totalOtPay: number;
  readonly totalStatutoryDeductions: number;
  readonly advanceDeductions: number;
  readonly taxableIncome: number;
  readonly personalIncomeTax: number;
  readonly otherDeductions: number;
  readonly netSalary: number;
  readonly currency: string;
  readonly paymentStatus: 'UNPAID' | 'PAYMENT_QUEUED' | 'PAID';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePayrollAdjustmentRequest {
  readonly employeeId: string;
  readonly itemCode: string;
  readonly itemType: HrmPayrollItemType;
  readonly amount: number;
  readonly reason: string;
}

export type HrmPayslipStatus = 'GENERATED' | 'PUBLISHED' | 'VIEWED' | 'DOWNLOADED';

export interface HrmPayslip {
  readonly id: string;
  readonly tenantId: string;
  readonly payrollRunId: string;
  readonly employeeId: string;
  readonly payslipNo: string;
  readonly status: HrmPayslipStatus;
  readonly issuedAt: string;
  readonly publishedAt?: string | null;
  readonly fileId?: string | null;
  readonly snapshotJson: Record<string, unknown>;
  readonly createdAt: string;
}

// ----------------------------------------------------------------------------
// 11. Read Models / Dashboard Overviews
// ----------------------------------------------------------------------------

export interface HrmEmployeeOverview {
  readonly profile: HrmEmployeeProfile;
  readonly currentPosition?: HrmPositionProfile | null;
  readonly currentShift?: HrmShiftDefinition | null;
  readonly leaveBalances: readonly HrmLeaveBalance[];
  readonly currentAttendance?: HrmAttendance | null;
  readonly currentTimesheet?: HrmTimesheet | null;
  readonly latestPayslip?: HrmPayslip | null;
  readonly pendingRequestsCount: {
    readonly leave: number;
    readonly ot: number;
    readonly correction: number;
    readonly advance: number;
  };
}

export interface HrmDashboardOverview {
  readonly periodCode: string;
  readonly totalEmployees: number;
  readonly officialEmployees: number;
  readonly probationEmployees: number;
  readonly todayAttendance: {
    readonly checkedInCount: number;
    readonly missingPunchCount: number;
    readonly lateCount: number;
    readonly onLeaveCount: number;
  };
  readonly pendingApprovals: {
    readonly leaveRequests: number;
    readonly otRequests: number;
    readonly corrections: number;
    readonly advances: number;
  };
  readonly currentTimesheetPeriod?: HrmTimesheetPeriod | null;
  readonly currentPayrollPeriod?: HrmPayrollPeriod | null;
}
