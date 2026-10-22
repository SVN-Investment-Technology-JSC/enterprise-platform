import type {
  SocialBirthday,
  SocialUpcomingBirthday,
  SocialUserRef,
} from '@enterprise-platform/contracts-social';

/**
 * Hồ sơ người và sinh nhật, lấy từ HRM / Tenant Core qua API nội bộ (skill erp-permissions, mục
 * API nội bộ). BE-3 hiện thực, kèm bản sao ngắn hạn như `HttpOrganizationDirectory`. Không sao
 * chép dữ liệu sang `social_schema`.
 */
export const PEOPLE_PROFILE = Symbol('SOCIAL_PEOPLE_PROFILE');

/** Bản ghi hồ sơ thô; `SocialPersonProfile` của contracts được dựng từ đây cộng `postCount` và quyền. */
export interface PersonRecord {
  readonly user: SocialUserRef;
  readonly unitName?: string;
  readonly position?: string;
  readonly email?: string;
  /** Chỉ ngày và tháng. Không bao giờ trả năm sinh ra khỏi cổng này. */
  readonly birthday?: SocialBirthday;
  /** ISO ngày. */
  readonly joinedAt?: string;
}

/** Người có khai ngày sinh.  chỉ để tính tuổi tròn; không được đưa ra ngoài hợp đồng. */
export interface BirthdayPerson {
  readonly user: SocialUserRef;
  readonly birthday: SocialBirthday;
  readonly birthYear?: number;
}

export interface BirthdayWindow {
  /** Ngày "hôm nay" theo múi giờ của công ty, dạng `YYYY-MM-DD`. */
  readonly today: string;
  /** Số ngày tới (không tính hôm nay) cần lấy; 1–30. */
  readonly days: number;
}

export interface PeopleProfilePort {
  /** `undefined` nếu người không có trong danh bạ (đã nghỉ việc, id sai). */
  profileOf(tenantId: string, userId: string): Promise<PersonRecord | undefined>;

  /**
   * Sinh nhật hôm nay và `days` ngày tới của người đang làm việc, sắp theo `daysUntil` rồi tên.
   * Người không khai ngày sinh bị bỏ qua. Sinh 29/2 tính vào 28/2 ở năm không nhuận.
   */
  birthdays(tenantId: string, window: BirthdayWindow): Promise<readonly SocialUpcomingBirthday[]>;

  /** Mọi người đang làm việc có khai ngày sinh (cho trang sinh nhật); rỗng khi HRM không trả lời. */
  listBirthdayPeople(tenantId: string): Promise<readonly BirthdayPerson[]>;

  /** Id mọi người đang làm việc của công ty; dùng cho "chưa xác nhận đã đọc" của bài Tường công ty. */
  listActiveUserIds(tenantId: string): Promise<readonly string[]>;

  /**
   * Người xem có quyền mở hồ sơ người này trong HRM không (để hiện nút sang hồ sơ nhân sự). Lỗi gọi HRM thì trả `false`.
   */
  canOpenInHrm(tenantId: string, viewerId: string, targetUserId: string): Promise<boolean>;
}
