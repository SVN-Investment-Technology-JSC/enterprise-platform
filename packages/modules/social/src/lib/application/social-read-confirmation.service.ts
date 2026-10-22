import {
  SOCIAL_READ_CONFIRMATION_FILTERS,
  type SocialReadConfirmationFilter,
  type SocialReadConfirmationPage,
  type SocialReadConfirmationSummary,
} from '@enterprise-platform/contracts-social';
import { decodeOffsetCursor, encodeOffsetCursor } from '../domain/social-publishing-rules.js';
import { normalizeLimit, toIso } from '../domain/social-rules.js';
import { SocialReadConfirmationNotRequiredError } from '../domain/social-publishing.error.js';
import { SocialForbiddenError, SocialValidationError } from '../domain/social.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { ExtendedPostRow } from './ports/post-read-model.js';
import type { PostViewAssembler } from './ports/post-view-assembler.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPostAccess } from './social-post-access.js';
import type { SocialPublishingStore } from './social-publishing-store.port.js';
import type { ReadAudience } from './social-read-audience.js';
import { lookupUsers } from './social-views.js';

export interface SocialReadConfirmationDeps {
  readonly store: SocialPublishingStore;
  readonly access: SocialPostAccess;
  readonly assembler: PostViewAssembler;
  readonly directory: OrganizationDirectory;
  readonly audience: ReadAudience;
}

/**
 * Xác nhận đã đọc. Phạm vi: bài Tường công ty là mọi người đang làm việc, bài nhóm là thành viên;
 * trừ tác giả. Xem danh sách đã/chưa xác nhận: tác giả, moderator, admin nhóm.
 */
export class SocialReadConfirmationService {
  constructor(private readonly deps: SocialReadConfirmationDeps) {}

  /** Idempotent: xác nhận lại không đổi gì. */
  async confirm(actor: SocialActor, postId: string): Promise<SocialReadConfirmationSummary> {
    const row = await this.deps.access.requirePublished(actor, postId);
    if (!row.requiresReadConfirmation) throw new SocialReadConfirmationNotRequiredError();
    const audience = await this.deps.audience.session(actor.tenantId).of(row);
    if (!audience.includes(actor.userId.toLowerCase())) {
      throw new SocialForbiddenError('Bạn không thuộc phạm vi cần xác nhận đã đọc bài viết này.');
    }
    await this.deps.store.confirmRead(actor.tenantId, postId, actor.userId);
    return this.summary(actor, row);
  }

  async list(
    actor: SocialActor,
    postId: string,
    query: { filter?: string; cursor?: string; limit?: number | string } = {},
  ): Promise<SocialReadConfirmationPage> {
    const row = await this.deps.access.requirePublished(actor, postId);
    if (!(await this.deps.access.mayViewReadConfirmations(actor, row))) throw new SocialForbiddenError();
    if (!row.requiresReadConfirmation) throw new SocialReadConfirmationNotRequiredError();

    const filter = normalizeFilter(query.filter);
    const limit = normalizeLimit(query.limit);
    const offset = decodeOffsetCursor(query.cursor);

    const audience = await this.deps.audience.session(actor.tenantId).of(row);
    const inAudience = new Set(audience);
    const records = (await this.deps.store.listConfirmations(actor.tenantId, postId)).filter((record) =>
      inAudience.has(record.userId.toLowerCase()),
    );
    const confirmedIds = new Set(records.map((record) => record.userId.toLowerCase()));

    const entries =
      filter === 'confirmed'
        ? records.map((record) => ({ userId: record.userId, confirmedAt: record.confirmedAt }))
        : audience.filter((id) => !confirmedIds.has(id)).sort().map((userId) => ({ userId, confirmedAt: undefined }));

    const page = entries.slice(offset, offset + limit);
    const userOf = await lookupUsers(
      this.deps.directory,
      actor.tenantId,
      page.map((entry) => entry.userId),
    );
    return {
      items: page.map((entry) => ({
        user: userOf(entry.userId),
        ...(entry.confirmedAt ? { confirmedAt: toIso(entry.confirmedAt) } : {}),
      })),
      confirmedCount: records.length,
      audienceCount: audience.length,
      ...(offset + limit < entries.length ? { nextCursor: encodeOffsetCursor(offset + limit) } : {}),
    };
  }

  private async summary(actor: SocialActor, row: ExtendedPostRow): Promise<SocialReadConfirmationSummary> {
    const post = (await this.deps.assembler.assemble(actor, [row]))[0];
    if (!post.readConfirmation) throw new SocialReadConfirmationNotRequiredError();
    return post.readConfirmation;
  }
}

function normalizeFilter(value: string | undefined): SocialReadConfirmationFilter {
  if (value === undefined || value === '') return 'pending';
  if (!(SOCIAL_READ_CONFIRMATION_FILTERS as readonly string[]).includes(value)) {
    throw new SocialValidationError('Bộ lọc xác nhận đã đọc không hợp lệ.');
  }
  return value as SocialReadConfirmationFilter;
}
