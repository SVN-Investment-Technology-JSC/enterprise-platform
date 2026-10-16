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

export type HrmPolicyType =
  | 'ATTENDANCE'
  | 'LEAVE'
  | 'OT'
  | 'PAYROLL'
  | 'SHIFT'
  | 'GENERAL';
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
  readonly status: 'ACTIVE' | 'INACTIVE';
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
  readonly expectedUpdatedAt?: string;
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
  readonly status?: 'ACTIVE' | 'INACTIVE';
  readonly expectedUpdatedAt?: string;
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
export type HrmEmploymentStatus =
  | 'PROBATION'
  | 'OFFICIAL'
  | 'ON_LEAVE'
  | 'RESIGNED'
  | 'TERMINATED';

export interface HrmEmployeeDependent {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly fullName: string;
  readonly relationship: string;
  readonly dateOfBirth?: string | null;
  readonly phone?: string | null;
  readonly identityCardNumber?: string | null;
  readonly taxCode?: string | null;
  readonly isDependent: boolean;
  readonly dependentFrom?: string | null;
  readonly dependentTo?: string | null;
  readonly note?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateEmployeeDependentRequest {
  readonly fullName: string;
  readonly relationship: string;
  readonly dateOfBirth?: string | null;
  readonly phone?: string | null;
  readonly identityCardNumber?: string | null;
  readonly taxCode?: string | null;
  readonly isDependent?: boolean;
  readonly dependentFrom?: string | null;
  readonly dependentTo?: string | null;
  readonly note?: string | null;
}

export interface UpdateEmployeeDependentRequest {
  readonly expectedUpdatedAt?: string;
  readonly fullName?: string;
  readonly relationship?: string;
  readonly dateOfBirth?: string | null;
  readonly phone?: string | null;
  readonly identityCardNumber?: string | null;
  readonly taxCode?: string | null;
  readonly isDependent?: boolean;
  readonly dependentFrom?: string | null;
  readonly dependentTo?: string | null;
  readonly note?: string | null;
}

export interface HrmEmploymentContract {
  readonly parentContractId?: string | null;
  readonly issuedSnapshot?: Record<string, unknown> | null;
  readonly terminatedOn?: string | null;
  readonly terminationReason?: string | null;
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly contractCode: string;
  readonly contractType: string;
  readonly signDate?: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly status: 'ACTIVE' | 'EXPIRED' | 'TERMINATED' | 'DRAFT';
  readonly baseSalary?: number | null;
  readonly note?: string | null;
  readonly fileUrl?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateEmploymentContractRequest {
  readonly contractCode: string;
  readonly contractType: string;
  readonly signDate?: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly status?: 'ACTIVE' | 'EXPIRED' | 'TERMINATED' | 'DRAFT';
  readonly baseSalary?: number | null;
  readonly note?: string | null;
  readonly fileUrl?: string | null;
}

export interface HrmEmployeeProfile {
  readonly id?: string;
  readonly employeeId: string;
  readonly userId?: string | null;
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
  readonly maritalStatus?: string | null;
  readonly nationality?: string | null;
  readonly ethnicity?: string | null;
  readonly religion?: string | null;
  readonly placeOfBirth?: string | null;
  readonly hometown?: string | null;
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
  readonly companyName?: string | null;
  readonly note?: string | null;
  readonly dependents?: HrmEmployeeDependent[];
  readonly contracts?: HrmEmploymentContract[];
  /** Ngày ký hợp đồng lao động gần nhất / có hiệu lực */
  readonly contractSignDate?: string | null;
  /** Loại hợp đồng lao động gần nhất (DEFINITE, INDEFINITE, PROBATION...) */
  readonly contractType?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type HrmProfileDocumentType = 'PHOTO' | 'ID_CARD_FRONT' | 'ID_CARD_BACK';

/** Hộ chiếu và giấy phép lao động thuộc nhóm bằng cấp, chứng chỉ. */
export type HrmQualificationType =
  | 'DEGREE'
  | 'CERTIFICATE'
  | 'LANGUAGE'
  | 'PROFESSIONAL'
  | 'PASSPORT'
  | 'WORK_PERMIT'
  | 'LICENSE'
  | 'OTHER';

export interface HrmProfileFileRef {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly uploadedAt?: string;
}

export interface HrmQualificationFields {
  readonly type: HrmQualificationType;
  readonly name: string;
  readonly level?: string | null;
  readonly major?: string | null;
  readonly institution?: string | null;
  readonly certificateNumber?: string | null;
  readonly issuedDate?: string | null;
  readonly effectiveFrom?: string | null;
  readonly expiryDate?: string | null;
  readonly grade?: string | null;
  readonly note?: string | null;
  readonly attachmentId?: string | null;
}

export interface HrmQualification extends Omit<HrmQualificationFields, 'attachmentId'> {
  readonly id: string;
  readonly attachment: HrmProfileFileRef | null;
}

export type HrmProfileDocumentChange =
  | {
      readonly op: 'SET_DOCUMENT';
      readonly documentType: HrmProfileDocumentType;
      readonly attachmentId: string;
    }
  | {
      readonly op: 'ADD_QUALIFICATION';
      readonly qualification: HrmQualificationFields;
    }
  | {
      readonly op: 'UPDATE_QUALIFICATION';
      readonly id: string;
      readonly qualification: HrmQualificationFields;
    }
  | { readonly op: 'REMOVE_QUALIFICATION'; readonly id: string };

export interface HrmProfileDocuments {
  readonly employeeId: string;
  readonly identityCardExpiryDate: string | null;
  readonly photo: HrmProfileFileRef | null;
  readonly identityCardFront: HrmProfileFileRef | null;
  readonly identityCardBack: HrmProfileFileRef | null;
  readonly qualifications: HrmQualification[];
  /** CCCD bắt buộc: số, ảnh mặt trước, ảnh mặt sau. */
  readonly missingRequired: ('identityCardNumber' | 'identityCardFront' | 'identityCardBack')[];
}

export interface HrmCareerHistoryItem {
  readonly assignmentId: string;
  readonly positionNodeId: string;
  readonly positionName: string;
  readonly positionCode: string;
  readonly unitNodeId: string;
  readonly unitName: string;
  readonly isPrimary: boolean;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly status: string;
  readonly note?: string | null;
}

/** Một sự kiện trong "Lịch sử bổ nhiệm và công tác": quyết định đã ghi nhận hoặc mốc hợp đồng. */
export interface HrmCareerEvent {
  readonly id: string;
  readonly source: 'DECISION' | 'CONTRACT';
  /** Loại quyết định hoặc loại hợp đồng (mã). */
  readonly kind: string;
  readonly title: string;
  readonly effectiveDate: string;
  readonly endDate: string | null;
  readonly positionName: string | null;
  readonly unitName: string | null;
  readonly reference: string | null;
  readonly note: string | null;
  /** Kiêm nhiệm / Bãi nhiệm: mã nhánh kiêm nhiệm (gốc của chuỗi). */
  readonly laneId?: string | null;
  /** Quyết định kiêm nhiệm mà sự kiện này nối tiếp trong cùng nhánh. */
  readonly replacesId?: string | null;
}

/** Kiêm nhiệm đang giữ (chưa bị thay thế hay bãi nhiệm): chọn để thay thế hoặc bãi nhiệm. */
export interface HrmOpenConcurrentPosition {
  readonly decisionId: string;
  readonly decisionNo: string;
  readonly positionNodeId: string | null;
  readonly positionName: string | null;
  readonly unitName: string | null;
  readonly effectiveDate: string;
}

export interface CreateEmployeeProfileRequest {
  readonly employeeCode: string;
  readonly personalEmail?: string;
  readonly phone?: string;
  readonly dateOfBirth?: string;
  readonly gender?: HrmGender;
  readonly maritalStatus?: string;
  readonly nationality?: string;
  readonly ethnicity?: string;
  readonly religion?: string;
  readonly placeOfBirth?: string;
  readonly hometown?: string;
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

/**
 * Khởi tạo hồ sơ HRM cho một nhân sự đã khai báo ở Core. Chỉ truyền MỘT trong hai: `employeeId` (nhân sự Core) hoặc
 * `userId` (tài khoản chưa có nhân sự, Core sẽ tạo nhân sự). Họ tên, email công việc, đơn vị, chức danh lấy từ Core.
 */
export interface CreateHrmEmployeeRequest extends CreateEmployeeProfileRequest {
  readonly employeeId?: string;
  readonly userId?: string;
}

/** Khởi tạo hồ sơ HRM hàng loạt (tối đa 200 người, tất cả hoặc không). */
export interface InitializeHrmEmployeesRequest {
  readonly items: readonly CreateHrmEmployeeRequest[];
}

/** Người ở Core chưa có hồ sơ HRM (nguồn của danh sách "Khởi tạo hồ sơ HRM"). */
export interface HrmCorePerson {
  readonly employeeId: string | null;
  readonly userId: string | null;
  readonly fullName: string;
  readonly email: string | null;
  readonly source: 'employee' | 'user';
}

export interface UpdateEmployeeProfileRequest {
  readonly expectedUpdatedAt?: string;
  readonly fullName?: string;
  readonly workEmail?: string | null;
  readonly personalEmail?: string | null;
  readonly phone?: string | null;
  readonly dateOfBirth?: string | null;
  readonly gender?: HrmGender | null;
  readonly maritalStatus?: string | null;
  readonly nationality?: string | null;
  readonly ethnicity?: string | null;
  readonly religion?: string | null;
  readonly placeOfBirth?: string | null;
  readonly hometown?: string | null;
  readonly identityCardNumber?: string | null;
  readonly identityCardIssuedDate?: string | null;
  readonly identityCardIssuedPlace?: string | null;
  readonly identityCardExpiryDate?: string | null;
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
  readonly type?:
    | 'EDUCATION'
    | 'EXPERIENCE'
    | 'SKILL'
    | 'CERTIFICATE'
    | 'OTHER';
  readonly title: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface HrmJobDescriptionItem {
  readonly updatedAt?: string | null;
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
  readonly authorities?: readonly string[];
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
  readonly expectedUpdatedAt?: string;
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
  readonly breakStartTime?: string | null;
  readonly breakEndTime?: string | null;
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
  readonly deletedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateShiftDefinitionRequest {
  readonly breakStartTime?: string | null;
  readonly breakEndTime?: string | null;
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
  readonly expectedUpdatedAt?: string;
  readonly breakStartTime?: string | null;
  readonly breakEndTime?: string | null;
  readonly name?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly breakMinutes?: number;
  readonly crossMidnight?: boolean;
  readonly graceLateMinutes?: number;
  readonly graceEarlyMinutes?: number;
  readonly status?: 'ACTIVE' | 'INACTIVE';
}

export interface HrmOrgUnitOption {
  readonly id: string;
  readonly parentId: string | null;
  readonly code: string;
  readonly name: string;
}

export type HrmAttendanceSource =
  | 'BIOMETRIC_DEVICE'
  | 'MOBILE_GPS'
  | 'WEB_PORTAL'
  | 'MANUAL_CORRECTION';
export type HrmAttendanceStatus =
  | 'VALID'
  | 'LATE'
  | 'EARLY_LEAVE'
  | 'MISSING_PUNCH'
  | 'ABNORMAL'
  | 'APPROVED_CORRECTION';

export interface HrmAttendance {
  readonly scheduledMinutes?: number;
  readonly lateMinutes?: number;
  readonly earlyMinutes?: number;
  readonly calculationSnapshot?: Record<string, unknown>;
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
  readonly employeeId?: string;
  readonly externalEventId?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly accuracy?: number;
  readonly occurredAt?: string;
  readonly source?: HrmAttendanceSource;
  readonly deviceId?: string | null;
  readonly verificationMethod?: 'GPS' | 'WIFI_WAN_IP' | 'BIOMETRIC' | 'QR_CODE';
  readonly wifiSsid?: string | null;
  readonly note?: string | null;
}

export interface CheckOutRequest {
  readonly employeeId?: string;
  readonly externalEventId?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly accuracy?: number;
  readonly occurredAt?: string;
  readonly source?: HrmAttendanceSource;
  readonly deviceId?: string | null;
  readonly verificationMethod?: 'GPS' | 'WIFI_WAN_IP' | 'BIOMETRIC' | 'QR_CODE';
  readonly wifiSsid?: string | null;
  readonly note?: string | null;
}

export interface IngestAttendanceRequest {
  readonly kind: 'IN' | 'OUT';
  readonly employeeId: string;
  readonly occurredAt: string;
  readonly source: HrmAttendanceSource;
  readonly deviceId?: string;
  readonly externalEventId?: string;
}

export type HrmAttendanceCorrectionStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

// ----------------------------------------------------------------------------
// Lý do và mô tả của đơn từ (nghỉ, làm thêm giờ, công tác, giải trình công, đổi ca)
// ----------------------------------------------------------------------------
// LÝ DO là danh mục cấu hình (không nhập tự do): làm thêm giờ, công tác, giải trình công, đổi ca chọn từ
// danh mục lý do (`reasonId`); đơn nghỉ chọn loại nghỉ (`leaveTypeId`) làm lý do.
// MÔ TẢ là văn bản tự do bổ sung, tách khỏi lý do; chỉ bắt buộc khi lý do được cấu hình "cần mô tả".

/** Phần mô tả khi tạo hoặc sửa đơn. */
export interface RequestDescriptionInput {
  /** Mô tả tự do (tối đa 2000 ký tự). Bắt buộc khi lý do đã chọn yêu cầu mô tả; còn lại có thể bỏ trống. */
  readonly description?: string;
  /**
   * @deprecated Bí danh cũ của `description` (bản nháp và ứng dụng cũ). Nếu gửi cả hai thì `description` thắng.
   * Không còn là lý do nhập tự do.
   */
  readonly reason?: string;
}

/** Lý do chọn từ danh mục + mô tả, dùng cho đơn làm thêm giờ, công tác, giải trình công, đổi ca. */
export interface RequestReasonInput extends RequestDescriptionInput {
  /** Id lý do trong danh mục của đúng loại đơn (đang sử dụng). BẮT BUỘC; thiếu hoặc sai loại bị từ chối (400). */
  readonly reasonId: string;
}

/** Phần lý do và mô tả trả về của mọi đơn từ. */
export interface HrmRequestReasonView {
  /** Đơn nghỉ: id loại nghỉ. Các đơn khác: id lý do trong danh mục; null với đơn cũ chưa có lý do danh mục. */
  readonly reasonId: string | null;
  /**
   * Tên lý do (bản chụp lúc tạo đơn; đơn nghỉ lấy tên loại nghỉ hiện tại).
   * null với đơn cũ chưa có lý do danh mục.
   */
  readonly reasonName: string | null;
  /** Mô tả tự do; null khi không nhập. Đơn cũ: nội dung lý do cũ. */
  readonly description: string | null;
  /** @deprecated Bằng `description` (chuỗi rỗng khi không có mô tả); dùng `reasonName` và `description`. */
  readonly reason: string;
}

export interface HrmAttendanceCorrection extends HrmRequestReasonView {
  readonly correctedSessions?: readonly { start: string; end: string }[];
  /** Các mốc giờ vào / ra đề nghị bổ sung (đơn theo từng mốc giờ). */
  readonly correctedPunches?: readonly { kind: 'IN' | 'OUT'; at: string }[];
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly attendanceId?: string | null;
  readonly requestDate: string;
  readonly oldCheckInAt?: string | null;
  readonly oldCheckOutAt?: string | null;
  readonly newCheckInAt?: string | null;
  readonly newCheckOutAt?: string | null;
  readonly status: HrmAttendanceCorrectionStatus;
  readonly workflowInstanceId?: string | null;
  readonly procedureInstanceId?: string | null;
  readonly currentStepName?: string | null;
  readonly currentAssigneeName?: string | null;
  readonly workflowStatus?: string | null;
  readonly submittedBy: string;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly rejectionReason?: string | null;
  readonly appliedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Đơn giải trình công: lý do chọn từ danh mục `ATTENDANCE_CORRECTION` (`reasonId`), mô tả tự do (`description`). */
export interface CreateAttendanceCorrectionRequest extends RequestReasonInput {
  /** Thay toàn bộ chấm công trong ngày bằng các cặp giờ vào–ra. */
  readonly sessions?: readonly { start: string; end: string }[];
  /**
   * Bổ sung từng mốc giờ vào hoặc giờ ra (tối đa một giờ vào và một giờ ra). Giờ cùng loại đã chấm trong ngày được thay
   * bằng giờ này; loại còn lại giữ nguyên.
   */
  readonly punches?: readonly { kind: 'IN' | 'OUT'; at: string }[];
  readonly employeeId: string;
  readonly attendanceId?: string | null;
  readonly requestDate: string;
  readonly newCheckInAt?: string | null;
  readonly newCheckOutAt?: string | null;
}

// ----------------------------------------------------------------------------
// 6. Leave Management
// ----------------------------------------------------------------------------

/**
 * Loại đơn có danh mục LÝ DO cấu hình: làm thêm giờ, công tác, giải trình công, đổi ca.
 * Đơn nghỉ không dùng danh mục này vì lý do nghỉ chính là loại nghỉ (HrmLeaveType).
 */
export type HrmRequestReasonKind =
  | 'OVERTIME'
  | 'BUSINESS_TRIP'
  | 'ATTENDANCE_CORRECTION'
  | 'SHIFT_CHANGE'
  // Mã của loại đơn do quản trị tạo (engine GENERIC): lý do của loại đó dùng mã loại làm `kind`.
  | (string & Record<never, never>);

/**
 * Lý do của đơn từ: một mục trong DANH MỤC CẤU HÌNH, người làm đơn chỉ chọn, không nhập tự do.
 * Khác với "mô tả" của đơn (văn bản tự do bổ sung, gửi kèm đơn dưới tên `description`).
 */
export interface HrmRequestReason {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: HrmRequestReasonKind;
  /** Mã ổn định trong (tenant, kind), tự sinh từ tên nếu không nhập; không đổi sau khi tạo. */
  readonly code: string;
  readonly name: string;
  /** Diễn giải cho người chọn lý do (hiện cạnh lý do trong danh sách chọn), KHÔNG phải mô tả của đơn. */
  readonly description: string | null;
  /** Có lương / không lương. Chỉ có ý nghĩa với làm thêm giờ (OT không lương không sinh công và tiền); loại khác luôn true. */
  readonly paid: boolean;
  /** true: người làm đơn bắt buộc nhập mô tả khi chọn lý do này (ví dụ lý do "Khác"). */
  readonly requiresDescription: boolean;
  /**
   * Hệ số tăng ca của lý do (1 đến 10), chỉ có với làm thêm giờ: đơn chọn lý do này lấy hệ số này để tính lương.
   * null = theo chính sách OT (ngày thường / ngày nghỉ / lễ / đêm).
   */
  readonly rateMultiplier?: number | null;
  readonly active: boolean;
  readonly sortOrder: number;
  /** Số đơn đã dùng lý do này; > 0 thì không xóa được, chỉ ngừng sử dụng. */
  readonly usageCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Body của POST và PATCH /request-reasons.
 * POST bắt buộc `kind` và `name`; PATCH chỉ gửi trường cần đổi, KHÔNG đổi được `kind` và `code`.
 * `paid` chỉ nhận giá trị false với làm thêm giờ; loại khác bị ép true.
 */
export interface SaveRequestReasonRequest {
  readonly kind?: HrmRequestReasonKind;
  /** Chỉ dùng khi tạo mới; bỏ trống thì tự sinh từ tên (in hoa, không dấu, gạch dưới). */
  readonly code?: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly paid?: boolean;
  readonly requiresDescription?: boolean;
  /** Hệ số tăng ca (1 đến 10) của lý do OT; null để bỏ hệ số riêng và theo chính sách OT. */
  readonly rateMultiplier?: number | null;
  readonly active?: boolean;
  readonly sortOrder?: number;
}

// ----------------------------------------------------------------------------
// 6b. Loại đơn cấu hình (registry) và thời gian "từ ngày giờ đến ngày giờ"
// ----------------------------------------------------------------------------

/**
 * Engine xử lý của một loại đơn. 7 engine đầu là engine hệ thống (mỗi loại hệ thống đúng một engine, không đổi).
 * GENERIC là engine của mọi loại do quản trị tạo: chỉ ghi nhận và duyệt, không ảnh hưởng bảng công, phép, lương.
 */
export type HrmRequestEngine =
  | 'LEAVE'
  | 'OVERTIME'
  | 'BUSINESS_TRIP'
  | 'SHIFT_CHANGE'
  | 'ATTENDANCE_CORRECTION'
  | 'ADVANCE'
  | 'PROFILE_CORRECTION'
  | 'GENERIC';

/**
 * Cách nhập thời gian của đơn: RANGE_DATETIME (từ ngày giờ đến ngày giờ), DATE_RANGE (khoảng ngày, cả ngày),
 * SINGLE_DATE (một ngày), NONE (không có thời gian).
 */
export type HrmRequestTimeMode = 'RANGE_DATETIME' | 'DATE_RANGE' | 'SINGLE_DATE' | 'NONE';

export type HrmRequestFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'select'
  | 'checkbox';

/** Một trường động của loại đơn GENERIC. `key` ổn định (chữ thường, số, gạch dưới), không đổi sau khi đơn đã dùng. */
export interface HrmRequestTypeField {
  readonly key: string;
  readonly label: string;
  readonly type: HrmRequestFieldType;
  readonly required?: boolean;
  /** Chỉ với type = select. */
  readonly options?: readonly string[];
}

/** Một loại đơn trong danh mục loại đơn của tenant. */
export interface HrmRequestType {
  readonly id: string;
  readonly tenantId: string;
  /** Mã ổn định, chữ in hoa; loại hệ thống có mã cố định (LEAVE, OVERTIME, ...). */
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly engine: HrmRequestEngine;
  /** Loại đơn (`kind`) của đường duyệt/quy trình: tên kind của engine hệ thống, hoặc `custom` với loại tự tạo. */
  readonly kind: HrmRequestKind;
  readonly timeMode: HrmRequestTimeMode;
  readonly requiresAttachment: boolean;
  /** Form đơn của loại này hiện khối "Phương tiện di chuyển" (xe công ty hoặc tự sắp xếp). */
  readonly requiresTransport?: boolean;
  readonly fields: readonly HrmRequestTypeField[];
  readonly icon: string | null;
  readonly isSystem: boolean;
  readonly active: boolean;
  readonly sortOrder: number;
  /** Số đơn đã tạo theo loại (chỉ có ở API quản trị); > 0 thì không xoá được loại tự tạo. */
  readonly usageCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Body của POST và PATCH /request-types. POST chỉ tạo loại GENERIC (bắt buộc `name`). PATCH loại hệ thống chỉ nhận
 * `name`, `description`, `active`, `sortOrder`, `icon`; không đổi `code`, engine, và không ngừng được loại nghỉ phép.
 */
export interface SaveRequestTypeRequest {
  readonly code?: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly timeMode?: HrmRequestTimeMode;
  readonly requiresAttachment?: boolean;
  readonly requiresTransport?: boolean;
  readonly fields?: readonly HrmRequestTypeField[];
  readonly icon?: string | null;
  readonly active?: boolean;
  readonly sortOrder?: number;
  readonly expectedUpdatedAt?: string;
}

/**
 * Khoảng thời gian của một đơn, theo múi giờ của tenant. Đơn cũ chưa lưu giờ có `timeKnown = false`:
 * `fromAt`/`toAt` khi đó là đầu ngày bắt đầu và cuối ngày kết thúc, hiển thị là "cả ngày".
 */
export interface HrmRequestTimeRange {
  readonly fromAt: string | null;
  readonly toAt: string | null;
  readonly timeKnown: boolean;
}

/** Một ngày trong kết quả tính thời gian của đơn (xem trước trước khi gửi). */
export interface HrmRequestTimeDay {
  readonly date: string;
  readonly kind: 'WORK' | 'OFF' | 'HOLIDAY' | 'NO_SHIFT';
  /** Số phút của ngày nằm trong khoảng từ-đến, tính trong ca và đã trừ giờ nghỉ. */
  readonly minutes: number;
  /** Quy đổi theo ca của ngày đó: 0.5 hoặc 1 với đơn vị ngày, hoặc số giờ với đơn vị giờ. */
  readonly quantity: number;
}

/** `GET /requests/time-preview`: số giờ, số ngày công và từng ngày của khoảng thời gian đã chọn. */
export interface HrmRequestTimePreview {
  readonly fromAt: string;
  readonly toAt: string;
  readonly timezone: string;
  readonly totalMinutes: number;
  readonly totalHours: number;
  readonly totalDays: number;
  readonly days: readonly HrmRequestTimeDay[];
  /** Ghi chú không chặn (ví dụ ngày nghỉ, ngày lễ nằm trong khoảng). */
  readonly warnings: readonly string[];
  /** Lỗi chặn gửi đơn (chưa phân ca, nghỉ một phần ngày không hợp lệ, khoảng ngoài giờ làm việc). */
  readonly errors: readonly string[];
}

/** Đơn của loại do quản trị tạo (engine GENERIC). */
export interface HrmCustomRequest extends HrmRequestReasonView {
  readonly id: string;
  readonly tenantId: string;
  readonly typeId: string;
  readonly typeCode: string;
  readonly typeName: string;
  readonly employeeId: string;
  readonly fromAt: string | null;
  readonly toAt: string | null;
  readonly durationMinutes: number | null;
  readonly fields: Record<string, unknown>;
  readonly attachmentFileId: string | null;
  readonly transportMode?: HrmTransportMode | null;
  readonly transportDetail?: string | null;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  readonly submittedBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `POST /custom-requests`. Thời gian bắt buộc theo `timeMode` của loại; trường động theo `fields` của loại. */
export interface CreateCustomRequestPayload extends RequestDescriptionInput {
  /** Bắt buộc khi loại đơn có ít nhất một lý do đang sử dụng; loại không có danh mục lý do thì bỏ trống. */
  readonly reasonId?: string | null;
  readonly employeeId: string;
  readonly typeId: string;
  readonly fromAt?: string | null;
  readonly toAt?: string | null;
  readonly fields?: Record<string, unknown>;
  readonly attachmentFileId?: string | null;
  /** Chỉ nhận khi loại đơn bật `requiresTransport`. */
  readonly transport?: HrmTransportInput;
}

export interface HrmLeaveType {
  readonly mergedIntoId?: string | null;
  /**
   * Lý do nghỉ này là phép năm (mỗi tenant đúng một, do `PUT /annual-leave-policy` đặt).
   * API luôn trả trường này; chỉ lý do phép năm có lịch cộng phép và trừ quỹ phép.
   */
  readonly isAnnual?: boolean;
  readonly deductBalance?: boolean;
  readonly negativeLimit?: number;
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
  readonly deductBalance?: boolean;
  readonly negativeLimit?: number;
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
  readonly deductBalance?: boolean;
  readonly negativeLimit?: number;
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
  readonly accrualBasis: HrmLeaveAccrualBasis;
  readonly startOffsetMonths: number;
  readonly advanceAllowed: boolean;
  readonly annualDays?: number | null;
  readonly seniorityTiers: readonly HrmLeaveSeniorityTier[];
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** JOIN_DATE: lịch cũ theo ngày vào làm. CONTRACT_SIGN_DATE: theo ngày ký HĐLĐ chính thức đầu tiên. */
export type HrmLeaveAccrualBasis = 'JOIN_DATE' | 'CONTRACT_SIGN_DATE';

export interface HrmLeaveSeniorityTier {
  readonly minYears: number;
  readonly bonusDays: number;
}

export interface CreateLeaveAccrualScheduleRequest {
  readonly policyVersionId?: string | null;
  readonly accrualFrequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'MILESTONE';
  readonly accrualAmount: number;
  readonly prorationRule?: string;
  readonly seniorityBonusYears?: number;
  readonly seniorityBonusDays?: number;
  readonly accrualBasis?: HrmLeaveAccrualBasis;
  readonly startOffsetMonths?: number;
  readonly advanceAllowed?: boolean;
  readonly annualDays?: number | null;
  readonly seniorityTiers?: readonly HrmLeaveSeniorityTier[];
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

// ----------------------------------------------------------------------------
// Chính sách phép năm: MỘT cấu hình duy nhất cho mỗi tenant.
// Lưu xuống `leave_accrual_schedules` + `leave_seniority_tiers` + cột chuyển phép của
// `leave_types` (phiên bản cũ vẫn giữ trong bảng, ẩn khỏi giao diện).
// ----------------------------------------------------------------------------

/** Lý do nghỉ đang là phép năm của tenant. */
export interface AnnualLeaveTypeRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** Lý do nghỉ đang dùng có thể chọn làm phép năm khi tenant chưa có phép năm. */
export interface AnnualLeavePolicyCandidate extends AnnualLeaveTypeRef {
  readonly paid: boolean;
  readonly deductBalance: boolean;
}

/** Chuyển phép sang năm sau: phép năm không chuyển nên luôn là { allowed: false, maxDays: 0 }. */
export interface AnnualLeaveCarryover {
  /** Có cho chuyển phép hay không (= `maxDays > 0`). */
  readonly allowed: boolean;
  /** Số ngày tối đa được chuyển sang năm sau. */
  readonly maxDays: number;
  /** Hạn dùng phép chuyển: hết ngày cuối của tháng này (1-12) trong năm nhận phép. */
  readonly expiryMonth: number;
}

export interface AnnualLeavePolicy {
  /** Ngày vào làm hoặc ngày ký HĐLĐ chính thức đầu tiên. */
  readonly accrualBasis: HrmLeaveAccrualBasis;
  /** Số ngày phép một năm; cộng hằng tháng (định mức / 12). */
  readonly annualDays: number;
  /** Bắt đầu hưởng phép sau N tháng kể từ ngày căn cứ. */
  readonly startOffsetMonths: number;
  /** Cho ứng phép: được dùng trước phần chưa cộng tới hết năm. */
  readonly advanceAllowed: boolean;
  /** Ngày có hiệu lực (đầu tháng) của phiên bản chính sách mới nhất; có thể ở tương lai. */
  readonly effectiveFrom: string;
  /** Cứ đạt `minYears` năm thì có `bonusDays` ngày thâm niên (lấy mốc cao nhất đã đạt). */
  readonly seniorityTiers: readonly HrmLeaveSeniorityTier[];
  readonly carryover: AnnualLeaveCarryover;
  /** Dấu phiên bản để gửi lại ở `expectedUpdatedAt` khi lưu (chống ghi đè). */
  readonly updatedAt: string;
}

/** `GET /annual-leave-policy` (quyền hrm.leave.read). */
export interface AnnualLeavePolicyResponse {
  /** null khi tenant chưa có phép năm. */
  readonly leaveType: AnnualLeaveTypeRef | null;
  /** Chỉ có phần tử khi `leaveType = null`; luôn là lý do đang dùng, đơn vị ngày, chọn được làm phép năm. */
  readonly candidates: readonly AnnualLeavePolicyCandidate[];
  /** null khi chưa cấu hình. */
  readonly policy: AnnualLeavePolicy | null;
  /**
   * Số lịch cộng phép của các lý do nghỉ KHÁC đã bị kết thúc (hết tháng hiện tại) hoặc xoá (lịch chưa bắt đầu)
   * khi lưu chính sách lần đầu, để chỉ phép năm còn được tự động cộng. Chỉ khác 0 ở phản hồi của `PUT`
   * khi tenant vừa được đặt lý do phép năm; `GET` và các lần lưu sau luôn trả 0.
   */
  readonly closedOtherSchedules: number;
}

/** `PUT /annual-leave-policy` (quyền hrm.leave.manage). Trả về `AnnualLeavePolicyResponse` mới. */
export interface SaveAnnualLeavePolicyRequest {
  /**
   * Chỉ bắt buộc khi tenant chưa có phép năm: lý do này được đặt là phép năm
   * (server ép có lương, trừ quỹ phép). Khi đã có phép năm thì bỏ trống hoặc gửi đúng lý do hiện tại.
   */
  readonly leaveTypeId?: string;
  readonly accrualBasis: HrmLeaveAccrualBasis;
  readonly annualDays: number;
  readonly startOffsetMonths: number;
  readonly advanceAllowed: boolean;
  readonly seniorityTiers: readonly HrmLeaveSeniorityTier[];
  /**
   * Đầu tháng (YYYY-MM-01). Bỏ trống: lần đầu = ngày 1/1 năm nay; đã có lịch = ngày 1 của tháng sau tháng đã cộng phép
   * (nếu lịch mới nhất chưa cộng phép lần nào thì sửa tại chỗ, giữ nguyên ngày hiệu lực).
   */
  readonly effectiveFrom?: string;
  /** Số ngày tối đa chuyển sang năm sau; phép năm không chuyển nên luôn là 0 (có thể bỏ trống). */
  readonly maxCarryoverDays?: number;
  /** Tháng hết hạn dùng phép chuyển (1-12); bỏ trống giữ giá trị hiện có (mặc định 3). */
  readonly carryoverExpiryMonth?: number;
  /** Lý do thay đổi, ghi vào nhật ký kiểm toán. */
  readonly reason: string;
  /** `policy.updatedAt` vừa tải (nên gửi); khi có gửi mà không khớp phiên bản hiện tại thì trả 409. */
  readonly expectedUpdatedAt?: string;
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
  readonly seniorityDays?: number;
  /** Tổng phép thâm niên đã cộng trong năm (giao dịch SENIORITY_ACCRUAL, đã nằm trong `accrued`). */
  readonly seniorityAccrued?: number;
  readonly carryoverRemaining?: number;
  readonly carryoverExpiryDate?: string | null;
  readonly maxNegativeAllowed?: number;
  /** Quỹ dự kiến cả năm theo chính sách (định mức + thâm niên), null nếu loại nghỉ không có lịch theo HĐ. */
  readonly projectedEntitlement?: number | null;
  /** Số ngày được phép dùng ngay (đã trừ giữ chỗ, gồm phần ứng phép và hạn mức âm). */
  readonly available?: number;
  readonly advanceAllowed?: boolean;
  /** Phép thâm niên cả năm theo chính sách (đã nằm trong `projectedEntitlement`). */
  readonly projectedSeniority?: number;
  /** Ngày ký HĐLĐ chính thức đầu tiên (căn cứ tính phép năm); null khi chưa có HĐLĐ. */
  readonly signDate?: string | null;
  /** Ngày bắt đầu hưởng phép = ngày ký HĐLĐ + số tháng bắt đầu của chính sách. */
  readonly eligibleFrom?: string | null;
  /** Mốc thâm niên cao nhất đã đạt trong năm (số năm); 0 nếu chưa đạt mốc nào. */
  readonly seniorityTierYears?: number;
  /**
   * Được hưởng năm nay kể cả phần chuyển từ năm trước và điều chỉnh:
   * `openingBalance + accrued + adjusted` (= đã dùng + còn lại khi không có giữ chỗ).
   * Chỉ có trong `GET /leave-balances`.
   */
  readonly entitlement?: number;
  /** Phần chuyển từ năm trước (= `openingBalance`); đã nằm trong `entitlement`. Chỉ có trong `GET /leave-balances`. */
  readonly carryover?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Một dòng của `GET /leave-balances?year=&employee_id=&annual_only=1` (quỹ phép = danh sách nhân viên):
 * mã, họ tên, đơn vị, được hưởng (`entitlement`), chuyển từ năm trước (`carryover`), đã dùng (`used`),
 * chờ duyệt (`pending`), còn lại (`remaining`). `annual_only=1` chỉ trả các dòng của lý do phép năm và
 * khi đó trả MỘT dòng cho mỗi nhân viên đang làm việc (không phải RESIGNED/TERMINATED): nhân viên chưa có
 * quỹ năm đó nhận dòng mặc định (`hasBalance=false`, `id=''`, mọi số = 0); tenant chưa có lý do phép năm thì trả mảng rỗng.
 */
export interface HrmLeaveBalanceListItem extends HrmLeaveBalance {
  /** false = dòng mặc định cho nhân viên chưa có quỹ phép của năm (chưa chạy cộng phép); luôn true khi không dùng `annual_only`. */
  readonly hasBalance: boolean;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly department: string | null;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly entitlement: number;
  readonly carryover: number;
}

export type HrmLeaveTransactionType =
  | 'ACCRUAL'
  | 'SENIORITY_ACCRUAL'
  | 'USAGE'
  | 'ADJUSTMENT'
  | 'CARRYOVER_EXPIRE'
  | 'CARRYOVER_IN'
  | 'CARRYOVER_OUT'
  | 'YEAR_END_RESET'
  | 'RECOVERY'
  | 'REVERSAL';

export type HrmLeaveSettlementStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'DEDUCTED'
  | 'WAIVED'
  | 'CLOSED'
  | 'REVERSED';

export interface HrmLeaveSettlement {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeCode?: string;
  readonly employeeName?: string;
  readonly leaveTypeId: string;
  readonly leaveTypeName?: string;
  readonly year: number;
  readonly terminationDate: string;
  readonly entitledDays: number;
  readonly usedDays: number;
  readonly excessDays: number;
  readonly unusedDays: number;
  readonly dailyRate: number;
  readonly recoveryAmount: number;
  readonly payrollPeriodId?: string | null;
  readonly payrollPeriodCode?: string | null;
  readonly payrollRunId?: string | null;
  readonly status: HrmLeaveSettlementStatus;
  readonly note?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type HrmUnusedLeaveDisposition = 'CANCEL' | 'PAYOUT_MARKED';

export interface HrmLeaveSettlementSettings {
  readonly unusedLeaveDisposition: HrmUnusedLeaveDisposition;
}

export interface HrmLeaveSettlementItem {
  readonly leaveTypeId: string;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly entitledDays: number;
  readonly usedDays: number;
  readonly pendingDays: number;
  readonly unusedDays: number;
  readonly overusedDays: number;
  readonly status: string;
  readonly alreadySettled?: boolean;
}

export interface HrmLeaveSettlementResult {
  readonly preview: boolean;
  readonly terminationDate: string;
  readonly disposition: HrmUnusedLeaveDisposition;
  readonly warnings: readonly string[];
  readonly items: readonly HrmLeaveSettlementItem[];
}

/** Xem trước quỹ phép theo chính sách so với sổ hiện tại. */
export interface HrmLeaveEntitlementPreview {
  readonly employeeId: string;
  readonly employeeCode?: string;
  readonly employeeName?: string;
  readonly leaveTypeId: string;
  readonly year: number;
  readonly signDate: string | null;
  readonly startDate: string | null;
  readonly lastWorkingDay: string | null;
  readonly projectedEntitlement: number;
  readonly entitledToDate: number;
  readonly seniorityDays: number;
  readonly seniorityTierYears: number;
  readonly accruedInLedger: number;
  readonly remaining: number;
  readonly used: number;
  readonly pending: number;
  readonly excessIfTerminated: number;
  readonly unusedIfTerminated: number;
  /** Lý do chưa thể quyết toán (đơn chờ duyệt, đơn sau ngày nghỉ...). */
  readonly blockers: readonly string[];
}

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
  /** Năm của quỹ phép mà giao dịch ghi vào (null với dữ liệu cũ). */
  readonly balanceYear?: number | null;
  /** Người thực hiện (mã · tên); null khi giao dịch không gắn người dùng. */
  readonly actorLabel?: string | null;
  /** Nguồn kích hoạt: người dùng bấm hoặc job tự động; null với dữ liệu cũ chưa ghi nhận. */
  readonly triggerSource?: 'MANUAL' | 'AUTOMATION' | null;
  /** Email tài khoản thực hiện (điều chỉnh và đảo điều chỉnh luôn có). */
  readonly actorEmail?: string | null;
  readonly leaveTypeName?: string;
  readonly leaveTypeCode?: string;
  readonly employeeName?: string;
  readonly employeeCode?: string;
  readonly department?: string | null;
  readonly createdAt: string;
}

export type HrmLeaveRequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

/**
 * Đơn nghỉ: lý do nghỉ chính là loại nghỉ (`leaveTypeId`), nên `reasonId` = `leaveTypeId` và `reasonName` = tên loại nghỉ
 * (null khi phản hồi không kèm thông tin loại nghỉ, ví dụ sau thao tác duyệt/từ chối). `description` là mô tả tự do.
 */
export interface HrmLeaveRequest extends HrmRequestReasonView, Partial<HrmRequestTimeRange> {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly leaveTypeId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly duration: number;
  readonly status: HrmLeaveRequestStatus;
  readonly isNegativeLeave?: boolean;
  readonly leaveTypeCode?: string;
  readonly leaveTypeName?: string;
  readonly isPaid?: boolean;
  readonly seniorityDaysUsed?: number;
  readonly workflowInstanceId?: string | null;
  readonly procedureInstanceId?: string | null;
  readonly currentStepName?: string | null;
  readonly currentAssigneeName?: string | null;
  readonly workflowStatus?: string | null;
  readonly attachmentFileId?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly appliedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Đơn nghỉ: LÝ DO là loại nghỉ (`leaveTypeId`, đang sử dụng); MÔ TẢ tự do là `description` (tùy chọn).
 */
export interface CreateLeaveRequestPayload extends RequestDescriptionInput {
  readonly employeeId: string;
  readonly leaveTypeId: string;
  /**
   * Thời gian nghỉ "từ ngày giờ đến ngày giờ" (`YYYY-MM-DDTHH:mm`, giờ địa phương của tenant, hoặc ISO có múi giờ).
   * Server tính số giờ/ngày theo ca của nhân viên. Gửi `fromAt`/`toAt` thì không cần `fromDate`, `toDate`, `duration`.
   */
  readonly fromAt?: string;
  readonly toAt?: string;
  /** Cách cũ: khoảng ngày + số ngày. Dùng khi không gửi `fromAt`/`toAt`. */
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly duration?: number;
  readonly isNegativeLeave?: boolean;
  readonly attachmentFileId?: string | null;
}

/** Sửa đơn nghỉ chờ duyệt. Không gửi mô tả (`description` và `reason` cùng bỏ trống) thì giữ mô tả cũ. */
export interface AmendLeaveRequestPayload extends RequestDescriptionInput {
  readonly fromAt?: string;
  readonly toAt?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly duration?: number;
}

// ----------------------------------------------------------------------------
// 7. HR e-Requests (OT, Business Trip, Shift Change)
// ----------------------------------------------------------------------------

export type HrmOtType = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY' | 'NIGHT';
export type HrmOtStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface HrmOtRequest extends HrmRequestReasonView, Partial<HrmRequestTimeRange> {
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
  /** Nguồn hệ số: REASON = hệ số cấu hình của lý do OT, POLICY = chính sách OT (ngày thường / nghỉ / lễ / đêm). */
  readonly rateSource?: 'REASON' | 'POLICY';
  readonly isNightOt?: boolean;
  readonly exceedsDailyLimit?: boolean;
  readonly exceedsMonthlyLimit?: boolean;
  readonly policyVersionId?: string | null;
  readonly monthlyAccumulatedOtMinutes: number;
  /** Có lương (true) hoặc không lương (false), chụp từ lý do đã chọn lúc tạo đơn; đơn cũ là true. */
  readonly paid: boolean;
  readonly status: HrmOtStatus;
  readonly workflowInstanceId?: string | null;
  readonly procedureInstanceId?: string | null;
  readonly currentStepName?: string | null;
  readonly currentAssigneeName?: string | null;
  readonly workflowStatus?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Đơn làm thêm giờ: lý do chọn từ danh mục `OVERTIME` (`reasonId`, có lương / không lương), mô tả tự do (`description`). */
export interface CreateOtRequestPayload extends RequestReasonInput {
  readonly employeeId: string;
  /**
   * Thời gian làm thêm "từ ngày giờ đến ngày giờ" (dưới 24 giờ, có thể qua đêm). Server suy ra `workDate`
   * (ngày bắt đầu), `startTime`, `endTime`, `plannedMinutes`; gửi `fromAt`/`toAt` thì không cần các trường cũ.
   */
  readonly fromAt?: string;
  readonly toAt?: string;
  readonly workDate?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly plannedMinutes?: number;
  readonly otType?: HrmOtType;
  readonly isNightOt?: boolean;
}

export type HrmBusinessTripType = 'DOMESTIC' | 'OVERSEAS' | 'INTERSITE';
export type HrmBusinessTripStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

/**
 * "Dự án liên kết (Workspace)" của một đơn — trường dùng chung cho mọi loại đơn.
 *
 * `REGISTERING`: đã gửi sang Workspace, chờ mã DT. `REGISTERED`: Workspace đã
 * nhận, có mã `projectRequestCode`. `REJECTED`: Workspace từ chối (người gửi
 * không tham gia dự án, dự án đã đóng…), lý do ở `rejectionReason`.
 */
export interface HrmRequestProjectLink {
  readonly projectId: string;
  readonly projectCode?: string;
  readonly projectName?: string;
  readonly status: 'REGISTERING' | 'REGISTERED' | 'REJECTED';
  readonly projectRequestCode?: string;
  readonly rejectionReason?: string;
}

export interface HrmBusinessTripRequest extends HrmRequestReasonView, Partial<HrmRequestTimeRange> {
  readonly workItemId?: string | null;
  readonly subtaskId?: string | null;
  readonly workReference?: Record<string, unknown>;
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly businessTripType: HrmBusinessTripType;
  readonly destination: string;
  readonly projectId?: string | null;
  readonly projectName?: string | null;
  readonly projectLink?: HrmRequestProjectLink;
  readonly fromDate: string;
  readonly toDate: string;
  readonly daysCount: number;
  readonly allowOt: boolean;
  readonly perDiemPolicyId?: string | null;
  readonly transportMode?: HrmTransportMode | null;
  readonly transportDetail?: string | null;
  readonly status: HrmBusinessTripStatus;
  readonly workflowInstanceId?: string | null;
  readonly procedureInstanceId?: string | null;
  readonly currentStepName?: string | null;
  readonly currentAssigneeName?: string | null;
  readonly workflowStatus?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Đơn công tác: lý do chọn từ danh mục `BUSINESS_TRIP` (`reasonId`), mô tả tự do (`description`). */
export interface CreateBusinessTripRequestPayload extends RequestReasonInput {
  readonly workItemId?: string;
  readonly subtaskId?: string;
  readonly employeeId: string;
  readonly businessTripType?: HrmBusinessTripType;
  readonly destination: string;
  readonly projectId?: string | null;
  /** Mã và tên dự án chỉ để hiển thị; Workspace gửi lại bản chuẩn khi đăng ký. */
  readonly projectCode?: string | null;
  readonly projectName?: string | null;
  /**
   * Thời gian công tác "từ ngày giờ đến ngày giờ"; server suy ra `fromDate`, `toDate`, `daysCount` (số ngày lịch
   * mà khoảng chạm vào). Cách cũ: `fromDate`, `toDate`, `daysCount`.
   */
  readonly fromAt?: string;
  readonly toAt?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly daysCount?: number;
  readonly allowOt?: boolean;
  readonly perDiemPolicyId?: string | null;
  readonly transport?: HrmTransportInput;
}

/** Phương tiện di chuyển ghi trên đơn/công việc: xe công ty (có lịch xe) hoặc tự sắp xếp. */
export type HrmTransportMode = 'COMPANY_VEHICLE' | 'EXTERNAL';

export interface HrmTransportInput {
  readonly mode: HrmTransportMode;
  /** EXTERNAL: taxi/xe ngoài, máy bay, xe cá nhân... */
  readonly detail?: string | null;
  /** COMPANY_VEHICLE: xe và tài xế còn trống trong khung giờ (lấy từ /fleet/availability). */
  readonly vehicleId?: string;
  readonly driverId?: string;
  /** Mặc định lấy theo thời gian của đơn. */
  readonly startAt?: string;
  readonly endAt?: string;
  readonly destination?: string | null;
}

export type HrmFleetEntityStatus = 'ACTIVE' | 'INACTIVE';
export type HrmFleetBookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';
export type HrmFleetSourceModule = 'HRM' | 'WORKSPACE' | 'MAINTENANCE';
export type HrmFleetSourceType =
  | 'BUSINESS_TRIP'
  | 'CUSTOM_REQUEST'
  | 'WORK_ITEM'
  | 'CALENDAR_EVENT'
  | 'INCIDENT';

export interface HrmFleetVehicle {
  readonly id: string;
  readonly plateNo: string;
  readonly name: string;
  readonly seats: number;
  readonly status: HrmFleetEntityStatus;
  readonly note: string | null;
}

export interface SaveFleetVehicleRequest {
  readonly plateNo?: string;
  readonly name?: string;
  readonly seats?: number;
  readonly status?: HrmFleetEntityStatus;
  readonly note?: string | null;
}

export interface HrmFleetDriver {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string | null;
  readonly employeeCode: string | null;
  readonly licenseNo: string | null;
  readonly status: HrmFleetEntityStatus;
}

export interface SaveFleetDriverRequest {
  readonly employeeId?: string;
  readonly licenseNo?: string | null;
  readonly status?: HrmFleetEntityStatus;
}

export interface HrmFleetBooking {
  readonly id: string;
  readonly vehicleId: string;
  readonly vehiclePlateNo: string;
  readonly vehicleName: string;
  readonly driverId: string;
  readonly driverName: string | null;
  readonly startAt: string;
  readonly endAt: string;
  readonly destination: string | null;
  readonly purpose: string | null;
  readonly requesterEmployeeId: string | null;
  readonly requesterName: string | null;
  readonly sourceModule: HrmFleetSourceModule;
  readonly sourceType: HrmFleetSourceType;
  readonly sourceId: string;
  readonly sourceLabel: string | null;
  readonly status: HrmFleetBookingStatus;
}

/** Khoảng bận của xe hoặc tài xế: đủ để form hiển thị lý do không chọn được. */
export interface HrmFleetBusySlot {
  readonly startAt: string;
  readonly endAt: string;
  readonly status: Exclude<HrmFleetBookingStatus, 'CANCELLED'>;
  readonly sourceLabel: string | null;
}

export interface HrmFleetAvailabilityVehicle extends HrmFleetVehicle {
  readonly busy: readonly HrmFleetBusySlot[];
}
export interface HrmFleetAvailabilityDriver {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string | null;
  readonly licenseNo: string | null;
  readonly busy: readonly HrmFleetBusySlot[];
}
/** Xe và tài xế đang hoạt động kèm các khoảng bận trong cửa sổ [from, to]. */
export interface HrmFleetAvailability {
  readonly vehicles: readonly HrmFleetAvailabilityVehicle[];
  readonly drivers: readonly HrmFleetAvailabilityDriver[];
}

export type HrmShiftChangeType = 'SWAP' | 'CHANGE_SHIFT';
export type HrmShiftChangeStatus =
  | 'PENDING'
  | 'PEER_CONFIRMED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export interface HrmShiftChangeRequest extends HrmRequestReasonView {
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
  readonly status: HrmShiftChangeStatus;
  readonly workflowInstanceId?: string | null;
  readonly procedureInstanceId?: string | null;
  readonly currentStepName?: string | null;
  readonly currentAssigneeName?: string | null;
  readonly workflowStatus?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly appliedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Đơn đổi ca: lý do chọn từ danh mục `SHIFT_CHANGE` (`reasonId`), mô tả tự do (`description`). */
export interface CreateShiftChangeRequestPayload extends RequestReasonInput {
  readonly employeeId: string;
  readonly changeType?: HrmShiftChangeType;
  readonly currentShiftId: string;
  readonly requestedShiftId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly swapWithEmployeeId?: string | null;
}

// ----------------------------------------------------------------------------
// 8. Timesheet & Periods
// ----------------------------------------------------------------------------

export type HrmTimesheetPeriodStatus =
  | 'OPEN'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'LOCKED'
  | 'REOPENED';

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

export interface UpdateTimesheetPeriodRequest
  extends Partial<CreateTimesheetPeriodRequest> {
  readonly expectedUpdatedAt: string;
  readonly reason: string;
}

export type HrmTimesheetStatus =
  | 'NORMAL'
  | 'LEAVE'
  | 'HOLIDAY'
  | 'ABSENT'
  | 'ADJUSTED'
  | 'OFF'
  | 'BUSINESS_TRIP'
  | 'ABNORMAL';

export interface HrmTimesheet {
  readonly employeeName?: string;
  readonly employeeCode?: string;
  readonly department?: string;
  readonly position?: string;
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
  readonly adjustmentNeedsReview: boolean;
  readonly adjustedBy?: string | null;
  readonly adjustedReason?: string | null;
  readonly calculationSnapshot: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdjustTimesheetRequest {
  readonly expectedUpdatedAt: string;
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

export type HrmSalaryAdvanceStatus =
  | 'REPAID'
  | 'PENDING'
  | 'APPROVED'
  | 'DISBURSED'
  | 'REJECTED'
  | 'CANCELLED';

export interface HrmSalaryAdvanceRequest {
  readonly employeeName?: string;
  readonly employeeCode?: string;
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
  readonly procedureInstanceId?: string | null;
  readonly currentStepName?: string | null;
  readonly currentAssigneeName?: string | null;
  readonly workflowStatus?: string | null;
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

export type HrmPayrollRunStatus =
  | 'DRAFT'
  | 'CALCULATING'
  | 'CALCULATED'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'FINALIZED'
  | 'CANCELLED';

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

export type HrmPayrollItemType =
  | 'EARNING'
  | 'ALLOWANCE'
  | 'OVERTIME'
  | 'STATUTORY_DEDUCTION'
  | 'TAX_DEDUCTION'
  | 'ADVANCE_DEDUCTION'
  | 'OTHER_DEDUCTION'
  | 'NET_PAY';

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
  readonly updatedAt: string;
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
  readonly operationId?: string;
  readonly employeeId: string;
  readonly itemCode: string;
  readonly itemType: HrmPayrollItemType;
  readonly amount: number;
  readonly reason: string;
}

export type HrmPayslipStatus =
  | 'GENERATED'
  | 'PUBLISHED'
  | 'VIEWED'
  | 'DOWNLOADED';

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
  readonly currentShiftSource?: string | null;
  readonly todayDayKind?: string | null;
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
  readonly todayDayKind?: string | null;
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
    readonly businessTrips?: number;
    readonly shiftChanges?: number;
    readonly profileChanges?: number;
  };
  readonly currentTimesheetPeriod?: HrmTimesheetPeriod | null;
  readonly currentPayrollPeriod?: HrmPayrollPeriod | null;
}

// ----------------------------------------------------------------------------
// 12. Procedure Engine Integration (HRM_LinkPE_PLAN)
// ----------------------------------------------------------------------------

export type HrmRequestKind =
  | 'leave'
  | 'ot'
  | 'business_trip'
  | 'shift_change'
  | 'correction'
  | 'advance'
  | 'profile_correction'
  /** Đơn của loại do quản trị tạo (engine GENERIC); loại cụ thể là `subTypeCode` = mã loại. */
  | 'custom';

export type HrmSyncStatus =
  | 'START_PENDING'
  | 'RUNNING'
  | 'APPLY_PENDING'
  | 'APPLIED'
  | 'FAILED'
  | 'CONFLICT';
export type HrmTerminalStatus = 'APPROVED' | 'REJECTED' | 'CANCELLED';
export interface HrmRequestRef {
  tenantId: string;
  kind: HrmRequestKind;
  requestId: string;
  revision: number;
}
export interface HrmSubmission extends HrmRequestRef {
  employeeId: string;
  initiatedBy: string;
  title: string;
  subTypeCode?: string;
  attributes?: Record<string, unknown>;
}
export interface HrmProcedureLink {
  id: string;
  ref: HrmRequestRef;
  instanceId: string | null;
  syncStatus: HrmSyncStatus;
  /** Tiến độ PE ngay sau khi gửi đơn (chỉ có ở phản hồi tạo đơn). */
  currentStepName?: string;
  currentAssigneeName?: string;
  /** Cảnh báo từ PE, ví dụ không tự hoàn thành được bước S. */
  warnings?: string[];
  /** Lỗi khởi tạo quy trình (ví dụ thiếu thuộc tính bắt buộc của bước S). */
  lastError?: string;
}

export interface HrmRequestProcedureBinding {
  readonly id: string;
  readonly tenantId: string;
  readonly requestKind: HrmRequestKind;
  readonly subTypeCode?: string | null;
  readonly procedureDefinitionId: string;
  readonly conditionRules?: Record<string, unknown>;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ----------------------------------------------------------------------------
// 12b. Cách duyệt đơn: Quản lý trực tiếp hoặc Theo quy trình
// ----------------------------------------------------------------------------

/**
 * Hai cách duyệt một đơn.
 * - DIRECT: đơn đi thẳng lên quản lý trực tiếp của người làm đơn (suy ra từ sơ đồ tổ chức) và
 *   người có quyền duyệt toàn bộ. Đây là mặc định khi chưa có cấu hình.
 * - PROCEDURE: đơn khởi tạo một quy trình duyệt của Procedure Engine.
 */
export type ApprovalRouteMode = 'DIRECT' | 'PROCEDURE';

/**
 * Một dòng trên màn hình cấu hình "Duyệt đơn": một loại đơn, hoặc một lý do của loại đơn.
 * Lý do có ở đơn nghỉ (loại nghỉ, mã = leave_types.code) và ở làm thêm giờ, công tác, giải trình công, đổi ca
 * (danh mục request_reasons, mã = request_reasons.code). Ứng lương và đính chính hồ sơ không có lý do.
 */
export interface ApprovalRouteConfigItem {
  readonly requestKind: HrmRequestKind;
  /** Chỉ có ở dòng theo lý do; dòng của loại đơn để null. */
  readonly reasonId?: string | null;
  /** Mã lý do = sub_type_code của cấu hình; dùng làm `reasonCode` khi PUT. */
  readonly reasonCode?: string | null;
  readonly reasonName?: string | null;
  /** Tên hiển thị tiếng Việt, ví dụ "Làm thêm giờ" hoặc "Làm thêm giờ · Theo yêu cầu công việc". */
  readonly label: string;
  readonly mode: ApprovalRouteMode;
  readonly procedureDefinitionId?: string | null;
  /** Tên quy trình; null khi không đọc được (Procedure Engine không khả dụng hoặc quy trình chưa công bố). */
  readonly procedureName?: string | null;
  /** Id chức danh duyệt dự phòng khi mode là DIRECT (tuỳ chọn). */
  readonly fallbackPositionId?: string | null;
  /** Tên chức danh duyệt dự phòng. */
  readonly fallbackPositionName?: string | null;
  /** Chỉ dòng theo lý do: true nếu lý do chưa có cấu hình riêng và đang dùng cấu hình chung của loại đơn. */
  readonly inherited: boolean;
  /** Id cấu hình đang áp dụng cho dòng này (null nếu mặc định chưa lưu hoặc đang kế thừa). */
  readonly bindingId?: string | null;
  /** true khi có nhiều cấu hình mâu thuẫn nhau; gửi đơn sẽ bị chặn cho tới khi quản trị chọn lại. */
  readonly conflict?: boolean;
}

/** Chức danh trong tổ chức dùng cho ô chọn dự phòng. */
export interface ApprovalRoutePositionOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** Phản hồi của GET và PUT /approval-config. */
export interface ApprovalRouteConfigResult {
  readonly items: readonly ApprovalRouteConfigItem[];
  /** Procedure Engine dùng được cho tenant; false thì chỉ chọn được "Quản lý trực tiếp". */
  readonly procedureAvailable: boolean;
  /** Danh sách chức danh để chọn duyệt dự phòng cho chế độ DIRECT. */
  readonly positions?: readonly ApprovalRoutePositionOption[];
  /** Cảnh báo cấu hình khi gán quy trình (không chặn lưu); chỉ có ở phản hồi của PUT. */
  readonly warnings?: readonly string[];
}

/**
 * Body của PUT /approval-config.
 * `reasonCode` là mã một lý do có thật của đúng loại đơn (loại nghỉ cho đơn nghỉ; danh mục lý do cho làm thêm giờ,
 * công tác, giải trình công, đổi ca); bỏ trống là cấu hình chung của loại đơn.
 * `INHERIT` chỉ hợp lệ khi có `reasonCode`: gỡ cấu hình riêng để lý do dùng lại cấu hình chung của loại đơn.
 * `procedureDefinitionId` bắt buộc khi `mode` là PROCEDURE.
 * `fallbackPositionId` tuỳ chọn khi `mode` là DIRECT (chức danh duyệt dự phòng).
 */
export interface SetApprovalRoutePayload {
  readonly requestKind: HrmRequestKind;
  readonly reasonCode?: string | null;
  readonly mode: ApprovalRouteMode | 'INHERIT';
  readonly procedureDefinitionId?: string;
  readonly fallbackPositionId?: string | null;
}

/** Người duyệt dự kiến hiển thị cho người làm đơn trước khi gửi (GET /approval-route). */
export interface ApprovalRoutePreview {
  readonly mode: ApprovalRouteMode;
  /** Chỉ có khi DIRECT; null nếu nhân viên chưa có quản lý trực tiếp. */
  readonly directManager?: {
    readonly employeeId: string;
    readonly fullName: string;
    readonly positionName: string | null;
  } | null;
  /** Chức danh duyệt dự phòng (chế độ DIRECT). */
  readonly fallbackPosition?: {
    readonly positionId: string;
    readonly positionName: string;
  } | null;
  /** Chỉ có khi PROCEDURE: tên quy trình đã gắn (null nếu không đọc được). */
  readonly procedureName?: string | null;
  /** true khi tenant không cho tự duyệt đơn của chính mình (mặc định), kể cả khi người làm đơn có quyền duyệt. */
  readonly selfApprovalBlocked?: boolean;
  /** Giải thích bằng tiếng Việt khi cần, ví dụ chưa có quản lý trực tiếp. */
  readonly note?: string;
}

export type HrmWorkflowActionType =
  | 'APPROVE'
  | 'REJECT'
  | 'RETURN'
  | 'CANCEL'
  | 'COMPLETE';

export interface ApplyHrmWorkflowActionPayload {
  readonly action: HrmWorkflowActionType;
  readonly comment?: string;
  readonly returnToStepId?: string;
  readonly attributeValues?: Record<string, unknown>;
}

export type HrmPersonnelDecisionType =
  | 'APPOINT'
  | 'PROMOTE'
  | 'TRANSFER'
  | 'CONCURRENT'
  | 'DISMISS'
  /** Bãi nhiệm: chấm dứt một chức danh kiêm nhiệm; chỉ ghi nhận lịch sử. */
  | 'REVOKE'
  /** Chỉ còn trong dữ liệu cũ; không tạo mới được nữa. */
  | 'CHANGE_MANAGER';

export type HrmPersonnelDecisionStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'APPLY_PENDING'
  | 'APPLIED'
  | 'REJECTED'
  | 'CANCELLED'
  /** Chỉ ghi nhận lịch sử công tác, không áp dụng sang chức danh, quan hệ báo cáo hay lương. */
  | 'RECORDED';

/** Chỉ còn trong dữ liệu cũ: quyết định không còn gán quản lý. KEEP: giữ nguyên · SET: đã gán · CLEAR: đã bỏ. */
export type HrmManagerMode = 'KEEP' | 'SET' | 'CLEAR';

/** Chỉ còn trong dữ liệu cũ: quyết định không còn chuyển cấp dưới. */
export type HrmSubordinateMode = 'KEEP' | 'REASSIGN';

export interface HrmPersonnelDecision {
  readonly id: string;
  readonly decisionNo: string;
  readonly decisionType: HrmPersonnelDecisionType;
  readonly status: HrmPersonnelDecisionStatus;
  readonly employeeId: string;
  readonly employeeName?: string | null;
  readonly employeeCode?: string | null;
  readonly effectiveDate: string;
  readonly reason: string;
  readonly replacesDecisionId?: string | null;
  readonly fromPositionName?: string | null;
  readonly fromUnitName?: string | null;
  readonly fromManagerEmployeeId?: string | null;
  readonly fromManagerName?: string | null;
  readonly fromSalaryGradeId?: string | null;
  readonly fromSalaryStepId?: string | null;
  readonly fromBaseSalary?: number | null;
  readonly toPositionNodeId?: string | null;
  readonly toPositionName?: string | null;
  readonly toUnitName?: string | null;
  readonly managerMode: HrmManagerMode;
  readonly toManagerEmployeeId?: string | null;
  readonly toManagerName?: string | null;
  readonly subordinateMode: HrmSubordinateMode;
  readonly subordinateTargetEmployeeId?: string | null;
  readonly subordinateTargetName?: string | null;
  readonly salaryChanged: boolean;
  readonly toSalaryGradeId?: string | null;
  readonly toSalaryStepId?: string | null;
  readonly toSalaryType?: 'GROSS' | 'NET' | null;
  readonly toBaseSalary?: number | null;
  readonly attachmentId?: string | null;
  readonly createdBy?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly rejectedReason?: string | null;
  readonly appliedAt?: string | null;
  /** Các bước đã áp dụng: `core`, `salary` (quyết định cũ còn `manager`, `subordinates`). */
  readonly appliedSteps: Record<string, boolean>;
  readonly applyAttempts: number;
  readonly applyError?: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateHrmPersonnelDecisionPayload {
  readonly decisionType: HrmPersonnelDecisionType;
  readonly employeeId: string;
  readonly effectiveDate: string;
  readonly reason: string;
  /** Bỏ trống để hệ thống cấp số theo năm. */
  readonly decisionNo?: string;
  readonly toPositionNodeId?: string | null;
  /** Kiêm nhiệm / Bãi nhiệm: quyết định Kiêm nhiệm mà quyết định này nối tiếp (thay thế hoặc chấm dứt). */
  readonly replacesDecisionId?: string | null;
  /** Bật khi quyết định thay đổi lương; các trường `toSalary*` khi đó là bắt buộc. */
  readonly salaryChanged?: boolean;
  readonly toSalaryGradeId?: string | null;
  readonly toSalaryStepId?: string | null;
  readonly toSalaryType?: 'GROSS' | 'NET' | null;
  readonly toBaseSalary?: number | null;
  readonly attachmentId?: string | null;
}

export type UpdateHrmPersonnelDecisionPayload = Partial<
  Omit<CreateHrmPersonnelDecisionPayload, 'employeeId' | 'decisionType'>
> & { readonly version: number };

/**
 * Người quản lý trực tiếp đã phân giải: theo "Báo cáo cho" của chức danh trong sơ đồ tổ chức Core, không có thì
 * Tổng giám đốc (CHIEF_FALLBACK).
 */
export interface HrmResolvedManager {
  readonly employeeId: string;
  readonly name: string;
  readonly code: string | null;
  /** Chức danh của người quản lý. */
  readonly title: string | null;
  readonly email: string | null;
  readonly source: 'CORE_POSITION' | 'CHIEF_FALLBACK';
}

export interface HrmReportingOverview {
  /** Quản lý trực tiếp đang áp dụng; null khi chưa xác định được. */
  readonly manager: HrmResolvedManager | null;
}

/** Ảnh chụp hiện trạng để form quyết định hiện cột "Trước". */
export interface HrmAppointmentContext {
  readonly employeeId: string;
  readonly positionNodeId?: string | null;
  readonly positionName?: string | null;
  readonly unitName?: string | null;
  readonly manager?: {
    readonly employeeId: string;
    readonly fullName: string;
    readonly employeeCode?: string | null;
  } | null;
  readonly salary?: {
    readonly salaryGradeId?: string | null;
    readonly salaryStepId?: string | null;
    readonly salaryType: 'GROSS' | 'NET';
    readonly baseSalary: number;
  } | null;
  /** Nhân viên đã liên kết tài khoản — điều kiện để bổ nhiệm vào chức danh ở Core. */
  readonly hasAccount: boolean;
}

// ---------------------------------------------------------------------------
// Phân ca làm việc (lịch tuần, lịch từng ngày, ngày lễ/đặc biệt)
// ---------------------------------------------------------------------------

export type HrmWorkDayType = 'SHIFT' | 'OFF' | 'HOLIDAY';
/** RULE = ngày đến từ lịch định kỳ không có ngày kết thúc (không có dòng sinh sẵn). */
export type HrmWorkDaySource = 'TEMPLATE' | 'MANUAL' | 'EXCEPTION' | 'HOLIDAY' | 'RULE';
export type HrmScheduleScopeType = 'EMPLOYEE' | 'EMPLOYEES' | 'UNIT' | 'COMPANY';
export type HrmScheduleKind = 'ASSIGN' | 'EXCEPTION';
/**
 * Cách xử lý ngày đã có lịch khác:
 * REPORT = báo xung đột, không ghi; SKIP_EXISTING = chỉ gán ngày chưa có lịch;
 * OVERWRITE_KEEP_EXCEPTIONS = ghi đè lịch thường, giữ ngoại lệ và ngày lễ; OVERWRITE_ALL = ghi đè tất cả.
 */
export type HrmScheduleConflictMode =
  | 'REPORT'
  | 'SKIP_EXISTING'
  | 'OVERWRITE_KEEP_EXCEPTIONS'
  | 'OVERWRITE_ALL';

/** Một thứ trong tuần theo ISO: 1 = Thứ Hai ... 7 = Chủ nhật. SKIP = không đụng tới ngày đó. */
export interface HrmWeekdayRule {
  readonly weekday: number;
  readonly dayType: 'SHIFT' | 'OFF' | 'SKIP';
  readonly shiftId?: string | null;
  /** Chỉ có nghĩa với ngày làm việc (SHIFT): tới ngày thì tự sinh chấm công vào/ra đúng giờ bắt đầu/kết thúc ca. */
  readonly autoAttendance?: boolean;
}

export interface HrmScheduleScope {
  readonly type: HrmScheduleScopeType;
  readonly employeeIds?: readonly string[];
  readonly unitIds?: readonly string[];
  readonly includeChildUnits?: boolean;
  readonly excludeEmployeeIds?: readonly string[];
}

export interface HrmScheduleTemplate {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly days: readonly HrmWeekdayRule[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveScheduleTemplateRequest {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly status?: 'ACTIVE' | 'INACTIVE';
  readonly days: readonly HrmWeekdayRule[];
}

export interface HrmApplyScheduleRequest {
  readonly kind?: HrmScheduleKind;
  readonly scope: HrmScheduleScope;
  readonly templateId?: string | null;
  readonly pattern?: readonly HrmWeekdayRule[];
  readonly fromDate: string;
  /**
   * Bỏ trống (null/không gửi) = lịch định kỳ KHÔNG có ngày kết thúc: gán một lần, chạy mãi đến khi kết thúc.
   * Có giá trị = lịch cố định trong khoảng ngày (tối đa 366 ngày), sinh sẵn từng ngày.
   */
  readonly toDate?: string | null;
  readonly conflictMode?: HrmScheduleConflictMode;
  readonly reason?: string | null;
  readonly confirm?: boolean;
}

export interface HrmScheduleConflict {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly date: string;
  readonly existing: {
    readonly dayType: HrmWorkDayType;
    readonly shiftCode: string | null;
    readonly source: HrmWorkDaySource;
  };
  readonly incoming: { readonly dayType: HrmWorkDayType; readonly shiftCode: string | null };
}

export interface HrmSchedulePlanSummary {
  readonly insert: number;
  readonly replace: number;
  readonly same: number;
  readonly skipped: number;
  readonly conflicts: number;
  readonly employees: number;
}

/** Một lịch định kỳ đang có sẽ bị cắt ngắn hoặc huỷ khi gán lịch định kỳ mới cùng phạm vi. */
export interface HrmScheduleRuleChange {
  readonly id: string;
  readonly from: string;
  readonly to: string | null;
  readonly templateName: string | null;
  readonly action: 'TRUNCATE' | 'CANCEL';
  readonly newTo: string | null;
}

export interface HrmScheduleRulePreviewItem {
  readonly scopeType: 'EMPLOYEE' | 'UNIT' | 'COMPANY';
  readonly scopeLabel: string;
  readonly changes: readonly HrmScheduleRuleChange[];
}

/** Kết quả xem trước khi gán KHÔNG có ngày kết thúc (lịch định kỳ). */
export interface HrmScheduleRulePreview {
  readonly rules: readonly HrmScheduleRulePreviewItem[];
  readonly ruleCount: number;
  readonly changedRules: number;
  readonly employeeCount: number;
  /** Số phạm vi đã có lịch định kỳ còn hiệu lực (chế độ REPORT coi là xung đột). */
  readonly conflictTotal: number;
  readonly skippedTargets: number;
  /** Ghi đè theo thời gian: số ngày phân ca từng ngày (từ ngày bắt đầu) sẽ bị lịch định kỳ thay, và số nhân viên có các ngày đó. */
  readonly replacedDays?: number;
  readonly replacedEmployees?: number;
  readonly requiresConfirmation: boolean;
  readonly confirmReasons: readonly string[];
  readonly lockedPeriods: readonly string[];
}

export interface HrmScheduleRuleApplyResult {
  readonly batchId: string;
  readonly ruleCount: number;
  readonly changedRules: number;
  readonly skippedTargets: number;
  readonly employeeCount: number;
  /** Số ngày phân ca từng ngày đã bị lịch định kỳ thay (huỷ dòng cũ). */
  readonly replacedDays?: number;
}

export interface HrmScheduleRule {
  readonly id: string;
  readonly scopeType: 'EMPLOYEE' | 'UNIT' | 'COMPANY';
  readonly scopeLabel: string;
  readonly employeeId: string | null;
  readonly unitId: string | null;
  readonly effectiveFrom: string;
  /** null = không có ngày kết thúc. */
  readonly effectiveTo: string | null;
  readonly templateName: string | null;
  readonly status: 'ACTIVE' | 'CANCELLED';
  readonly days: readonly {
    readonly weekday: number;
    readonly dayType: 'SHIFT' | 'OFF';
    readonly shiftId: string | null;
    readonly shiftCode: string | null;
  }[];
  readonly createdAt: string;
}

export interface HrmSchedulePreview {
  readonly summary: HrmSchedulePlanSummary;
  readonly employeeCount: number;
  readonly dayCount: number;
  readonly conflictTotal: number;
  readonly conflicts: readonly HrmScheduleConflict[];
  readonly employees: readonly {
    readonly employeeId: string;
    readonly code: string;
    readonly name: string;
    readonly unitName: string | null;
    readonly days: number;
  }[];
  readonly requiresConfirmation: boolean;
  readonly confirmReasons: readonly string[];
  readonly lockedPeriods: readonly string[];
  /** Ngày đổi ca/OFF/lễ trùng đơn nghỉ hoặc công tác: đơn đã duyệt chặn áp dụng, đơn đang chờ chỉ cảnh báo. */
  readonly requestConflictTotal?: number;
  readonly blockingRequestConflictTotal?: number;
  readonly requestConflicts?: readonly HrmScheduleRequestConflict[];
}

export interface HrmScheduleRequestConflict {
  readonly employeeId: string;
  readonly employeeCode?: string;
  readonly employeeName?: string;
  readonly date: string;
  readonly kind: 'LEAVE' | 'TRIP';
  readonly requestId: string;
  readonly status: 'APPROVED' | 'PENDING';
}

export interface HrmApplyScheduleResult {
  readonly batchId: string;
  readonly summary: HrmSchedulePlanSummary;
  readonly employeeCount: number;
  readonly appliedDays: number;
}

export interface HrmCancelScheduleRequest {
  readonly scope: HrmScheduleScope;
  readonly fromDate: string;
  readonly toDate: string;
  readonly includeExceptions?: boolean;
  readonly reason?: string | null;
  readonly confirm?: boolean;
  readonly dryRun?: boolean;
}

export interface HrmCopyScheduleRequest {
  readonly sourceEmployeeId: string;
  readonly scope: HrmScheduleScope;
  readonly fromDate: string;
  readonly toDate: string;
  readonly conflictMode?: HrmScheduleConflictMode;
  readonly reason?: string | null;
  readonly confirm?: boolean;
  readonly dryRun?: boolean;
}

export interface HrmScheduleEmployee {
  readonly employeeId: string;
  readonly code: string;
  readonly name: string;
  readonly unitId: string | null;
  readonly unitName: string | null;
}

export interface HrmScheduleDay {
  readonly employeeId: string;
  readonly date: string;
  readonly dayType: HrmWorkDayType;
  readonly shiftId: string | null;
  readonly shiftCode: string | null;
  readonly shiftName: string | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly source: HrmWorkDaySource;
  readonly holidayId: string | null;
  readonly note: string | null;
}

export type HrmHolidayKind = 'HOLIDAY' | 'TET' | 'COMPENSATORY' | 'SPECIAL';

export interface HrmHoliday {
  readonly id: string;
  readonly name: string;
  readonly kind: HrmHolidayKind;
  readonly fromDate: string;
  readonly toDate: string;
  readonly scopeType: 'COMPANY' | 'UNIT' | 'EMPLOYEES';
  readonly scope?: HrmScheduleScope;
  readonly treatment: 'OFF' | 'SHIFT';
  readonly shiftId?: string | null;
  readonly paid?: boolean;
  readonly note?: string | null;
  readonly status?: 'ACTIVE' | 'CANCELLED';
}

export interface HrmScheduleGrid {
  readonly employees: readonly HrmScheduleEmployee[];
  readonly days: readonly HrmScheduleDay[];
  readonly holidays: readonly HrmHoliday[];
  /** Đơn nghỉ/công tác (đã duyệt hoặc đang chờ) trùng các ngày của lưới, để hiển thị lớp phủ trên ô. */
  readonly requests?: readonly HrmScheduleRequestConflict[];
  readonly meta: { readonly total: number; readonly page: number; readonly pageSize: number };
}

export interface HrmScheduleListRow {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly unitName: string | null;
  readonly dayType: HrmWorkDayType;
  readonly shiftId: string | null;
  readonly shiftCode: string | null;
  readonly shiftName: string | null;
  readonly source: HrmWorkDaySource;
  readonly batchId: string | null;
  readonly fromDate: string;
  readonly toDate: string;
  readonly days: number;
  readonly weekdays: readonly number[];
  readonly status: 'ACTIVE';
}

export interface CreateHolidayRequest {
  readonly name: string;
  readonly kind: HrmHolidayKind;
  readonly fromDate: string;
  readonly toDate: string;
  readonly scope: HrmScheduleScope;
  readonly treatment: 'OFF' | 'SHIFT';
  readonly shiftId?: string | null;
  readonly paid?: boolean;
  readonly note?: string | null;
}

export interface HrmScheduleAuditEntry {
  readonly id: string;
  readonly batchId: string | null;
  readonly action: string;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly employeeId: string | null;
  readonly employeeCode: string | null;
  readonly employeeName: string | null;
  readonly fromDate: string | null;
  readonly toDate: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Bảng công theo tháng (toàn bộ thời gian, không cần "tạo kỳ công"): xem docs/hrm-bang-cong-thiet-ke.md
// ---------------------------------------------------------------------------------------------------------------

/** Trạng thái chốt của một tháng công. OPEN: đang mở; REQUESTS_CLOSED: đã chốt đơn từ; LOCKED: đã chốt công. */
export type HrmTimesheetMonthState = 'OPEN' | 'REQUESTS_CLOSED' | 'LOCKED';

/** Loại ngày theo lịch phân ca / lịch lễ / ngày nghỉ hằng tuần. */
export type HrmBoardDayKind = 'WORK' | 'OFF' | 'HOLIDAY' | 'NO_SCHEDULE';

/**
 * Kết quả của một ngày công. Thứ tự ưu tiên khi nhiều điều kiện cùng đúng: HOLIDAY, OFF, TRIP, ANNUAL_LEAVE, PAID_LEAVE,
 * UNPAID_LEAVE, ABNORMAL (quên chấm công / dữ liệu lệch), ABSENT (nghỉ không phép), LATE_EARLY, LATE, EARLY_LEAVE, PRESENT.
 */
export type HrmBoardDayStatus =
  | 'PRESENT' // đi làm đủ công
  | 'LATE' // đi trễ
  | 'EARLY_LEAVE' // về sớm
  | 'LATE_EARLY' // vừa đi trễ vừa về sớm
  | 'ABNORMAL' // bất thường: quên chấm công (thiếu vào hoặc ra) hoặc dữ liệu lệch
  | 'ABSENT' // nghỉ không phép: có ca, không chấm công, không có đơn nghỉ được duyệt
  | 'ANNUAL_LEAVE' // nghỉ phép năm (lý do nghỉ là phép năm)
  | 'PAID_LEAVE' // nghỉ có phép, có lương, không phải phép năm
  | 'UNPAID_LEAVE' // nghỉ có đơn được duyệt nhưng không lương
  | 'TRIP' // công tác
  | 'OFF' // ngày nghỉ
  | 'HOLIDAY' // ngày lễ
  | 'NO_SCHEDULE' // chưa có lịch làm việc
  | 'FUTURE'; // chưa tới ngày

export interface HrmBoardLeaveInfo {
  readonly requestId: string;
  readonly reasonName: string | null;
  readonly paid: boolean;
  readonly annual: boolean;
  /** Số ngày nghỉ rơi vào ngày này (0.5 cho nửa ngày). */
  readonly days: number;
}

/** Đơn tác động tới một ngày công (truy vết từ ô công về đơn gốc). */
export interface HrmDaySource {
  readonly kind: 'LEAVE' | 'OT' | 'TRIP' | 'CORRECTION' | 'SHIFT_CHANGE';
  readonly id: string;
  /** Số phút đơn đóng góp cho ngày (nghỉ: phút hưởng lương; làm thêm giờ: phút đã duyệt); null nếu không có. */
  readonly minutes: number | null;
  /** Tên lý do nghỉ hoặc điểm đến công tác nếu có. */
  readonly label: string | null;
}

/** Một đơn từ có dính tới ngày công (mọi trạng thái, không chỉ đơn đã duyệt). */
export interface HrmDayRequest {
  readonly kind: 'LEAVE' | 'OT' | 'TRIP' | 'CORRECTION' | 'SHIFT_CHANGE' | 'CUSTOM';
  readonly id: string;
  readonly status: 'APPROVED' | 'PENDING' | 'REJECTED';
  /** Tên lý do nghỉ, điểm đến công tác, tên loại đơn tuỳ chỉnh... nếu có. */
  readonly label: string | null;
  /** Số phút của đơn rơi vào ngày này nếu biết (OT: số phút của đơn; nghỉ: phút hưởng lương). */
  readonly minutes: number | null;
  readonly fromAt?: string | null;
  readonly toAt?: string | null;
  /** Lý do chọn từ danh mục (nghỉ, làm thêm giờ, công tác, giải trình, đơn tuỳ chỉnh). */
  readonly reasonName?: string | null;
  /** Mô tả tự do người tạo đơn nhập. */
  readonly description?: string | null;
  /** Thời điểm tạo đơn (ISO). */
  readonly createdAt?: string | null;
  /** Làm thêm giờ: hệ số tăng ca của đơn. */
  readonly otRate?: number | null;
  /** Công tác: DOMESTIC | OVERSEAS | INTERSITE. */
  readonly tripType?: string | null;
  /** Giải trình công: giờ vào/ra theo đơn (ISO). */
  readonly punchIn?: string | null;
  readonly punchOut?: string | null;
}

export interface HrmBoardDay {
  readonly date: string;
  readonly kind: HrmBoardDayKind;
  readonly status: HrmBoardDayStatus;
  readonly shiftCode: string | null;
  readonly shiftName: string | null;
  /** Giờ bắt đầu và kết thúc ca, dạng HH:mm theo múi giờ của tenant. */
  readonly shiftStart: string | null;
  readonly shiftEnd: string | null;
  /** Giờ nghỉ giữa ca (HH:mm) và số phút nghỉ của ca; null/0 khi ca không có giờ nghỉ. */
  readonly shiftBreakStart?: string | null;
  readonly shiftBreakEnd?: string | null;
  readonly shiftBreakMinutes?: number;
  /** Giờ chấm vào/ra đầu và cuối ngày, dạng HH:mm; null nếu chưa chấm. */
  readonly checkIn: string | null;
  readonly checkOut: string | null;
  readonly scheduledMinutes: number;
  readonly workedMinutes: number;
  readonly paidMinutes: number;
  /** Số công trong ngày theo ca: paidMinutes / scheduledMinutes (0, 0.5, 1...). */
  readonly workdayUnits: number;
  readonly lateMinutes: number;
  readonly earlyLeaveMinutes: number;
  readonly otMinutes: number;
  /** Mã bất thường: MISSING_CHECK_IN, MISSING_CHECK_OUT, NO_SHIFT, ... (xem calculateAttendance). */
  readonly anomalies: readonly string[];
  readonly leave: HrmBoardLeaveInfo | null;
  readonly tripId: string | null;
  readonly holidayName: string | null;
  /** true: công đã được chỉnh tay. */
  readonly adjusted: boolean;
  /** Các đơn đã duyệt tác động tới ngày này (nghỉ, làm thêm giờ, công tác, giải trình công, đổi ca). */
  readonly sources?: readonly HrmDaySource[];
  /** Mọi đơn từ dính tới ngày này (đã duyệt, chờ duyệt, từ chối) để mở xem từ ô công. */
  readonly requests?: readonly HrmDayRequest[];
}

export interface HrmBoardTotals {
  readonly workdayUnits: number;
  readonly workedMinutes: number;
  readonly paidMinutes: number;
  readonly lateMinutes: number;
  readonly earlyLeaveMinutes: number;
  readonly otMinutes: number;
  readonly lateDays: number;
  readonly earlyLeaveDays: number;
  readonly abnormalDays: number;
  /** Ngày làm việc đã qua nhưng chưa có ca: chưa phải lỗi chấm công nhưng vẫn chặn chốt công. */
  readonly unscheduledDays?: number;
  readonly absentDays: number;
  readonly annualLeaveDays: number;
  readonly paidLeaveDays: number;
  readonly unpaidLeaveDays: number;
  readonly tripDays: number;
  readonly offDays: number;
  readonly holidayDays: number;
}

/** Công chuẩn của tháng theo cấu hình lương: động theo ngày công thực tế, hoặc cố định. */
export interface HrmBoardStandard {
  readonly mode: 'DYNAMIC' | 'FIXED' | 'MINUTES';
  /** Số ngày công chuẩn của tháng (động: số ngày có lịch làm việc; cố định: số ngày cấu hình). */
  readonly workdays: number;
}

/** Cách tính công chuẩn của bảng công một tháng: động theo lịch ca hoặc cố định số ngày công. */
export type HrmTimesheetStandardMode = 'DYNAMIC' | 'FIXED';

/**
 * Chính sách công chuẩn của bảng công: có hiệu lực từ `effectiveMonth` đến khi có chính sách mới thay thế
 * (tách khỏi công chuẩn trong chính sách lương, chỉ dùng để tính lương).
 */
export interface HrmTimesheetStandardPolicy {
  readonly id: string;
  /** Tháng bắt đầu áp dụng, YYYY-MM. */
  readonly effectiveMonth: string;
  readonly mode: HrmTimesheetStandardMode;
  /** Số ngày công chuẩn khi cố định; null khi động. */
  readonly workdays: number | null;
  readonly note: string | null;
  readonly updatedAt: string;
}

/** Danh sách chính sách công chuẩn (mới nhất trước) và chính sách đang áp dụng cho tháng hiện tại (null: mặc định động). */
export interface HrmTimesheetStandardPolicies {
  readonly policies: readonly HrmTimesheetStandardPolicy[];
  readonly currentMonth: string;
  readonly currentId: string | null;
}

/**
 * Cấu hình chấm công tự động của tenant (tách khỏi phân ca): `weekdays` là các thứ áp dụng, 0 = Chủ nhật ... 6 = thứ Bảy.
 * `enabledFrom` là ngày bật gần nhất; chỉ sinh chấm công cho các ngày từ ngày này trở đi.
 * `ready` false khi tenant chưa chạy migration 0055 (chưa lưu được cấu hình).
 */
export interface HrmAutoAttendanceSettings {
  readonly enabled: boolean;
  readonly weekdays: readonly number[];
  readonly enabledFrom: string | null;
  readonly ready: boolean;
  readonly updatedAt: string | null;
}

/**
 * Hạn mức số đơn ĐÃ DUYỆT mỗi tháng của một nhân viên theo từng loại đơn. `monthlyLimit` null là không giới hạn.
 * `ready` false khi tenant chưa chạy migration 0064.
 */
export interface HrmRequestQuotaItem {
  readonly typeCode: string;
  readonly typeName: string;
  readonly active: boolean;
  readonly monthlyLimit: number | null;
}

export interface HrmRequestQuotaSettings {
  readonly ready: boolean;
  readonly items: readonly HrmRequestQuotaItem[];
}

/** Hạn mức và số đơn đã duyệt tháng này của người đang đăng nhập, chỉ gồm loại đơn có đặt hạn mức. */
export interface HrmMyRequestQuota {
  readonly typeCode: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
}

export interface HrmBoardEmployee {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly departmentName: string | null;
  readonly positionName: string | null;
  /** Khóa là ngày YYYY-MM-DD, đủ mọi ngày của tháng. */
  readonly days: Readonly<Record<string, HrmBoardDay>>;
  readonly totals: HrmBoardTotals;
  /** Công chuẩn của tháng (mẫu số tính lương theo công). */
  readonly standard?: HrmBoardStandard;
}

export interface HrmBoardMonthInfo {
  readonly month: string;
  readonly from: string;
  readonly to: string;
  readonly state: HrmTimesheetMonthState;
  readonly periodId: string | null;
  readonly requestsClosedAt: string | null;
  readonly lockedAt: string | null;
  readonly calculatedAt: string | null;
}

/** Ngày chung của công ty trong tháng (lễ, nghỉ hằng tuần theo chính sách chấm công). */
export interface HrmBoardCalendarDay {
  readonly date: string;
  /** 0 = Chủ nhật ... 6 = Thứ bảy. */
  readonly weekday: number;
  readonly kind: 'WORK' | 'OFF' | 'HOLIDAY';
  readonly holidayName: string | null;
}

/**
 * GET /timesheet-board?month=YYYY-MM&employee_id=&q=&page=&page_size=
 * Người có hrm.timesheet.read xem được mọi nhân viên (`canViewAll = true`); người khác chỉ thấy bảng công của chính mình.
 */
/** Bộ lọc nhanh của bảng công, tính trên toàn bộ nhân viên của tháng (không chỉ trang đang xem). */
export type HrmBoardFlag = 'LATE_EARLY' | 'ABNORMAL' | 'ABSENT' | 'PENDING';
export type HrmBoardFlagCounts = Readonly<Record<HrmBoardFlag | 'ALL', number>>;

export interface HrmTimesheetBoard {
  readonly month: HrmBoardMonthInfo;
  readonly canViewAll: boolean;
  readonly calendar: readonly HrmBoardCalendarDay[];
  readonly employees: readonly HrmBoardEmployee[];
  readonly meta: {
    /** Tổng số nhân viên sau khi áp bộ lọc nhanh (dùng để phân trang). */
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
    /** Số nhân viên khớp từng bộ lọc nhanh trên toàn bộ kết quả tìm kiếm của tháng; ALL là chưa lọc. */
    readonly counts?: HrmBoardFlagCounts;
  };
}

/** Việc còn vướng trước khi chốt: đơn chờ duyệt trong tháng, ngày bất thường chưa xử lý... */
export interface HrmMonthCloseBlocker {
  readonly code:
    | 'PENDING_REQUESTS'
    | 'REQUESTS_NOT_CLOSED'
    | 'ABNORMAL_DAYS'
    /** Ngày làm việc đã qua mà nhân viên chưa có ca (cần phân ca trước khi chốt công). */
    | 'UNSCHEDULED_DAYS'
    | 'MONTH_NOT_ENDED'
    | 'ALREADY_LOCKED'
    /** Có kỳ công tùy chỉnh cũ chồng lấn tháng này: không thể tạo kỳ công theo tháng. */
    | 'PERIOD_OVERLAP';
  readonly message: string;
  readonly count: number;
  /** Chi tiết từng ngày công vướng (tối đa 200 dòng đầu), để mở thẳng ô công cần xử lý. */
  readonly items?: readonly HrmMonthCloseItem[];
}

/** Một ngày công đang chặn chốt công. */
export interface HrmMonthCloseItem {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly date: string;
  /** Mã bất thường của ngày (MISSING_CHECK_OUT, NO_SHIFT, LEAVE_TRIP_OVERLAP...). */
  readonly codes: readonly string[];
}

export interface HrmMonthCloseState {
  readonly month: HrmBoardMonthInfo;
  readonly blockersForRequests: readonly HrmMonthCloseBlocker[];
  readonly blockersForLock: readonly HrmMonthCloseBlocker[];
}


/** Một ngày công đã dùng để tính lương của nhân viên (truy vết lương về bảng công và đơn từ). */
export interface HrmPayrollTraceDay {
  readonly date: string;
  readonly status: string;
  readonly scheduledMinutes: number;
  readonly workedMinutes: number;
  readonly paidMinutes: number;
  readonly otMinutes: number;
  readonly lateMinutes: number;
  readonly earlyMinutes: number;
  readonly workdayUnits: number;
  readonly tripAllowanceAmount: number;
  readonly adjusted: boolean;
  readonly anomalies: readonly string[];
  readonly sources: readonly HrmDaySource[];
}

/** `GET /payroll-runs/:runId/employees/:employeeId/trace`: từng ngày công và đối soát với con số đã dùng để tính lương. */
export interface HrmPayrollTrace {
  readonly run: { readonly id: string; readonly status: string; readonly calculatedAt: string | null; readonly stale: boolean };
  readonly period: { readonly from: string; readonly to: string; readonly timesheetPeriodId: string };
  readonly employee: { readonly id: string; readonly code: string; readonly name: string };
  /** Đầu vào hệ thống đã dùng khi tính (BASE_SALARY, PAID_MINUTES, OT_MINUTES, ...); null nếu chưa có dòng lương. */
  readonly inputs: Record<string, number | string> | null;
  readonly totals: {
    readonly scheduledMinutes: number;
    readonly paidMinutes: number;
    readonly workedMinutes: number;
    readonly otMinutes: number;
    readonly lateMinutes: number;
    readonly earlyMinutes: number;
    readonly workdayUnits: number;
    readonly tripAllowanceAmount: number;
  };
  readonly days: readonly HrmPayrollTraceDay[];
  /** true: tổng từng ngày khớp đầu vào lương và bảng công chưa đổi từ lúc tính. */
  readonly reconciled: boolean;
  readonly differences: readonly string[];
}

/** Mức công tác phí mỗi ngày theo hình thức công tác (`/trip-allowance-rates`). */
export interface HrmTripAllowanceRate {
  readonly id: string;
  readonly tripType: 'DOMESTIC' | 'OVERSEAS' | 'INTERSITE';
  readonly dailyAmount: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: 'ACTIVE' | 'CANCELLED';
  readonly note: string | null;
  readonly createdAt: string;
}

// ----------------------------------------------------------------------------
// Trao đổi và ý kiến phê duyệt trên đơn từ
// ----------------------------------------------------------------------------

export type HrmRequestCommentKind = 'COMMENT' | 'DECISION';

export interface HrmCommentAttachment {
  readonly id: string;
  readonly name: string;
  readonly contentType?: string;
  readonly sizeBytes?: number;
}

/** Một dòng trong luồng trao đổi của đơn: bình luận thường hoặc ý kiến đi kèm quyết định phê duyệt. */
export interface HrmRequestComment {
  readonly id: string;
  readonly requestKind: HrmRequestKind;
  readonly requestId: string;
  readonly authorUserId: string;
  readonly authorName: string;
  readonly kind: HrmRequestCommentKind;
  /** APPROVE, REJECT, RETURN, COMPLETE...: chỉ có với kind = DECISION. */
  readonly decision: string | null;
  readonly body: string;
  /** Người được nhắc tên (@) trong nội dung. */
  readonly mentions: readonly HrmCommentMention[];
  /** Tệp đính kèm trong tin nhắn trao đổi. */
  readonly attachments?: readonly HrmCommentAttachment[];
  readonly createdAt: string;
  /** Bình luận của chính người đang xem. */
  readonly mine: boolean;
}

export interface HrmCommentMention {
  readonly userId: string;
  readonly name: string;
}

/** `GET /request-comments?kind=&requestId=`. */
export interface HrmRequestCommentsResponse {
  readonly data: readonly HrmRequestComment[];
}

/** `POST /request-comments`: bình luận, hoặc ý kiến sau khi đã quyết định (kind = DECISION). */
export interface CreateRequestCommentRequest {
  readonly kind: HrmRequestKind | string;
  readonly requestId: string;
  readonly body: string;
  readonly mentionUserIds?: readonly string[];
  readonly commentKind?: HrmRequestCommentKind;
  readonly decision?: string;
  readonly attachments?: readonly HrmCommentAttachment[];
}

/** Người có thể được nhắc tên: nhân viên có tài khoản đăng nhập. */
export interface HrmMentionCandidate {
  readonly userId: string;
  readonly name: string;
  readonly employeeCode: string | null;
  readonly department: string | null;
}

/**
 * Giám sát chấm công theo ngày (GET /v1/attendance-monitor?date=): tình hình vào ca, đi trễ, về sớm, nghỉ phép của
 * nhân viên trong phạm vi người xem (toàn công ty với người có quyền xem chấm công/bảng công, cấp dưới theo sơ đồ tổ chức
 * với người quản lý).
 */
export type HrmMonitorStatus =
  | 'NOT_CHECKED_IN' // đã tới giờ ca nhưng chưa chấm vào
  | 'ABSENT' // ngày đã qua: có ca, không chấm công, không có đơn nghỉ được duyệt
  | 'LATE' // đi trễ
  | 'EARLY_LEAVE' // về sớm
  | 'LATE_EARLY' // vừa đi trễ vừa về sớm
  | 'MISSING_PUNCH' // thiếu lượt chấm (chỉ có vào hoặc chỉ có ra)
  | 'CHECKED_IN' // đã vào ca đúng giờ, đang làm
  | 'COMPLETED' // đã chấm vào và ra đủ
  | 'UPCOMING' // chưa tới giờ ca
  | 'ON_LEAVE' // nghỉ có đơn được duyệt
  | 'ON_TRIP' // công tác
  | 'DAY_OFF' // ngày nghỉ hoặc ngày lễ
  | 'NO_SCHEDULE'; // chưa có lịch làm việc

export interface HrmMonitorRow {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly departmentName: string | null;
  readonly positionName: string | null;
  readonly status: HrmMonitorStatus;
  readonly shiftCode: string | null;
  readonly shiftName: string | null;
  /** Giờ dự kiến của ca, HH:mm. */
  readonly shiftStart: string | null;
  readonly shiftEnd: string | null;
  /** Giờ chấm vào/ra thực tế, HH:mm; null nếu chưa chấm. */
  readonly checkIn: string | null;
  readonly checkOut: string | null;
  readonly lateMinutes: number;
  readonly earlyLeaveMinutes: number;
  /** Tên lý do nghỉ khi đang nghỉ phép. */
  readonly leaveName: string | null;
  /** Số ngày nghỉ rơi vào ngày này (0.5 = nửa ngày). */
  readonly leaveDays: number;
  /** Đơn từ liên quan tới ngày này (đã duyệt, chờ duyệt, từ chối). */
  readonly requests: readonly HrmDayRequest[];
}

export interface HrmMonitorSummary {
  /** Nhân viên trong phạm vi đang làm việc vào ngày này. */
  readonly totalPeople: number;
  /** Nhân viên có ca làm việc ngày này (kể cả đang nghỉ phép/công tác). */
  readonly scheduled: number;
  readonly checkedIn: number;
  readonly notCheckedIn: number;
  readonly late: number;
  readonly earlyLeave: number;
  readonly onLeave: number;
  readonly onTrip: number;
  readonly missingPunch: number;
}

export interface HrmAttendanceMonitor {
  readonly date: string;
  readonly today: string;
  readonly generatedAt: string;
  /** ALL: toàn công ty; TEAM: chỉ cấp dưới của người xem. */
  readonly scope: 'ALL' | 'TEAM';
  readonly summary: HrmMonitorSummary;
  readonly rows: readonly HrmMonitorRow[];
}
