import type { SocialReportTargetSummary, SocialReportTargetType } from '@enterprise-platform/contracts-social';
import { htmlToPlainText } from '../domain/html-sanitizer.js';
import { isUuid } from '../domain/social-rules.js';
import { SocialError } from '../domain/social.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { ReportTargetResolverPort, ResolvedReportTarget } from './ports/report-target.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPostAccess } from './social-post-access.js';
import type { SocialPublishingStore } from './social-publishing-store.port.js';
import type { SocialStore } from './social-store.port.js';

const LABEL_MAX = 120;

export interface SocialReportTargetResolverDeps {
  readonly access: SocialPostAccess;
  readonly store: Pick<SocialStore, 'comments'>;
  readonly directory: OrganizationDirectory;
}

type ReportableType = Exclude<SocialReportTargetType, 'group'>;
type Row = Awaited<ReturnType<SocialPublishingStore['findForWrite']>>;

/**
 * Hiện thực `ReportTargetResolverPort` cho bài và bình luận. Luật nhìn thấy bài (kể cả quyền xem đợt 2)
 * áp cho người gọi: bài hoặc bình luận không thấy được thì như không có, nên báo cáo không dò ra bài
 * `private/unit/custom` và moderator không đọc được tóm tắt của chúng trong hàng đợi.
 */
export class SocialReportTargetResolver implements ReportTargetResolverPort {
  constructor(private readonly deps: SocialReportTargetResolverDeps) {}

  async resolveForReporter(
    actor: SocialActor,
    targetType: ReportableType,
    targetId: string,
  ): Promise<ResolvedReportTarget | undefined> {
    const found = await this.find(actor, targetType, targetId);
    if (!found) return undefined;
    const { row, label, authorId, commentId } = found;
    const authorName = await this.authorName(actor, authorId);
    return {
      targetType,
      targetId,
      postId: row.id,
      ...(row.groupId ? { groupId: row.groupId } : {}),
      ...(row.groupPrivacy ? { groupPrivacy: row.groupPrivacy } : {}),
      authorId,
      summary: {
        label,
        postId: row.id,
        ...(commentId ? { commentId } : {}),
        ...(authorName ? { authorName } : {}),
      },
    };
  }

  async summariesForHandler(
    actor: SocialActor,
    targets: readonly { readonly targetType: ReportableType; readonly targetId: string }[],
  ): Promise<ReadonlyMap<string, SocialReportTargetSummary>> {
    const summaries = new Map<string, SocialReportTargetSummary>();
    for (const target of targets) {
      const found = await this.find(actor, target.targetType, target.targetId);
      if (!found) continue;
      const authorName = await this.authorName(actor, found.authorId);
      summaries.set(`${target.targetType}:${target.targetId}`, {
        label: found.label,
        postId: found.row.id,
        ...(found.commentId ? { commentId: found.commentId } : {}),
        ...(authorName ? { authorName } : {}),
      });
    }
    return summaries;
  }

  /** Đối tượng đã đăng, chưa xoá và thấy được; bất kỳ lý do nào khác là `undefined` (không lộ sự tồn tại). */
  private async find(
    actor: SocialActor,
    targetType: ReportableType,
    targetId: string,
  ): Promise<{ row: NonNullable<Row>; label: string; authorId: string; commentId?: string } | undefined> {
    if (!isUuid(targetId)) return undefined;
    try {
      if (targetType === 'post') {
        const row = await this.deps.access.requirePublished(actor, targetId);
        return { row, label: postLabel(row), authorId: row.authorId };
      }
      const comment = await this.deps.store.comments.findById(actor.tenantId, targetId);
      if (!comment || comment.deleted) return undefined;
      const row = await this.deps.access.requirePublished(actor, comment.postId);
      return { row, label: truncate(comment.body), authorId: comment.authorId, commentId: comment.id };
    } catch (error) {
      // Không thấy, chưa đăng hoặc id lạ đều là "không có".
      if (error instanceof SocialError) return undefined;
      throw error;
    }
  }

  private async authorName(actor: SocialActor, authorId: string): Promise<string | undefined> {
    const found = await this.deps.directory.resolve(actor.tenantId, [authorId]);
    return found.get(authorId.toLowerCase())?.name;
  }
}

function postLabel(row: { title?: string; bodyHtml: string }): string {
  return truncate(row.title?.trim() || htmlToPlainText(row.bodyHtml));
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX - 1)}…` : flat;
}
