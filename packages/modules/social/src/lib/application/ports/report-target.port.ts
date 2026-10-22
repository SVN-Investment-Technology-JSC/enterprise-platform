import type { SocialReportTargetSummary, SocialReportTargetType } from '@enterprise-platform/contracts-social';
import type { SocialActor } from '../social-actor.js';

/**
 * Cổng tra đối tượng bị báo cáo (đợt 2). BE-G sở hữu bảng `reports` và hàng đợi; bài và bình
 * luận thuộc BE-V, nên BE-V hiện thực cổng này (cho `post` và `comment`; `group` BE-G tự tra).
 * Luật nhìn thấy bài vẫn áp: người không thấy đối tượng không báo cáo được (404).
 */
export const REPORT_TARGET_RESOLVER = Symbol('SOCIAL_REPORT_TARGET_RESOLVER');

export interface ResolvedReportTarget {
  readonly targetType: Exclude<SocialReportTargetType, 'group'>;
  readonly targetId: string;
  /** Bài của đối tượng (chính nó nếu là bài). */
  readonly postId: string;
  /** Nhóm chứa bài; thiếu là Tường công ty. */
  readonly groupId?: string;
  readonly groupPrivacy?: 'public' | 'private';
  readonly authorId: string;
  readonly summary: SocialReportTargetSummary;
}

export interface ReportTargetResolverPort {
  /**
   * Tra đối tượng cho NGƯỜI BÁO CÁO: `undefined` nếu không có, đã xoá, hoặc người này không thấy
   * (luật nhìn thấy). Không cho báo cáo bài/bình luận của chính mình (service BE-G kiểm `authorId`).
   */
  resolveForReporter(
    actor: SocialActor,
    targetType: Exclude<SocialReportTargetType, 'group'>,
    targetId: string,
  ): Promise<ResolvedReportTarget | undefined>;

  /**
   * Tra tóm tắt cho NGƯỜI XỬ LÝ khi đọc hàng đợi. Khoá kết quả là `${targetType}:${targetId}`.
   * Không có mục khi đối tượng đã xoá (báo cáo vẫn hiện, không có `target`) hoặc bài có quyền xem
   * riêng (`unit|custom|private`) mà người xử lý không xem được: không lộ nội dung.
   */
  summariesForHandler(
    actor: SocialActor,
    targets: readonly { readonly targetType: Exclude<SocialReportTargetType, 'group'>; readonly targetId: string }[],
  ): Promise<ReadonlyMap<string, SocialReportTargetSummary>>;
}
