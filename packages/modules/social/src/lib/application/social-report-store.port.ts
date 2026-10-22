import type { SocialReportStatus, SocialReportTargetType } from '@enterprise-platform/contracts-social';
import type { GroupOutboxEvent } from './social-group-store.port.js';

/** Token DI của store báo cáo. */
export const SOCIAL_REPORT_STORE = Symbol('SOCIAL_REPORT_STORE');

export interface ReportRow {
  readonly id: string;
  readonly targetType: SocialReportTargetType;
  readonly targetId: string;
  /** Nhóm chứa đối tượng (chính nó với báo cáo nhóm); thiếu là Tường công ty. */
  readonly groupId?: string;
  /** Quyền riêng tư và tình trạng của nhóm trên, đọc cùng lúc để định tuyến hàng đợi. */
  readonly groupPrivacy?: 'public' | 'private';
  readonly groupDeleted?: boolean;
  readonly postId?: string;
  readonly reporterId: string;
  readonly reason: string;
  readonly status: SocialReportStatus;
  /** ISO UTC giữ micro giây (con trỏ phân trang). */
  readonly createdAt: string;
  readonly handledBy?: string;
  readonly handledAt?: string;
  readonly handleNote?: string;
}

/** Hàng đợi báo cáo: của moderator (Tường công ty + nhóm công khai) hoặc của một nhóm. */
export type ReportQueue =
  | { readonly kind: 'moderator' }
  | { readonly kind: 'group'; readonly groupId: string };

export interface ReportListRead {
  readonly queue: ReportQueue;
  readonly status: SocialReportStatus;
  readonly targetType?: SocialReportTargetType;
  readonly limit: number;
  /** Mới nhất trước theo `(createdAt, id)`. */
  readonly cursor?: { readonly at: string; readonly id: string };
}

export interface ReportInsert {
  readonly id: string;
  readonly targetType: SocialReportTargetType;
  readonly targetId: string;
  readonly groupId?: string;
  readonly postId?: string;
  readonly reporterId: string;
  readonly reason: string;
  readonly events: readonly GroupOutboxEvent[];
}

/** Cổng dữ liệu bảng `reports`. Mọi phương thức nhận `tenantId` đầu tiên. */
export interface SocialReportStore {
  /** Ném `SocialReportExistsError` khi người này đã có báo cáo mở cho đối tượng. Sự kiện ghi cùng transaction. */
  insert(tenantId: string, input: ReportInsert): Promise<void>;
  find(tenantId: string, reportId: string): Promise<ReportRow | undefined>;
  list(tenantId: string, read: ReportListRead): Promise<ReportRow[]>;
  /** Số báo cáo đang mở trong hàng đợi (không lọc loại). */
  openCount(tenantId: string, queue: ReportQueue): Promise<number>;
  /** Nguyên tử: chỉ khi báo cáo còn `open`. `undefined` nếu đã có người xử lý (hoặc không có). */
  resolve(
    tenantId: string,
    input: {
      readonly reportId: string;
      readonly status: Exclude<SocialReportStatus, 'open'>;
      readonly note?: string;
      readonly handledBy: string;
    },
  ): Promise<ReportRow | undefined>;
}
