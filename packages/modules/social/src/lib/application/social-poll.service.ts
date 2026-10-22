import type {
  SetSocialPollVoteRequest,
  SocialPoll,
  SocialPollVoterPage,
} from '@enterprise-platform/contracts-social';
import { isPollClosed, normalizeVoteOptions } from '../domain/social-poll-rules.js';
import { decodeOffsetCursor, encodeOffsetCursor } from '../domain/social-publishing-rules.js';
import { mayModerate } from '../domain/social-principal.js';
import { normalizeLimit, requireUuid, toIso } from '../domain/social-rules.js';
import {
  SocialPollAnonymousError,
  SocialPollClosedError,
  SocialPollNotFoundError,
} from '../domain/social-publishing.error.js';
import { SocialForbiddenError, SocialValidationError } from '../domain/social.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { ExtendedPostRow, PollRow } from './ports/post-read-model.js';
import type { PostViewAssembler } from './ports/post-view-assembler.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPostAccess } from './social-post-access.js';
import { pollChangedEvent } from './social-publishing-events.js';
import type { SocialPublishingStore } from './social-publishing-store.port.js';
import { lookupUsers } from './social-views.js';

export interface SocialPollDeps {
  readonly store: SocialPublishingStore;
  readonly access: SocialPostAccess;
  readonly assembler: PostViewAssembler;
  readonly directory: OrganizationDirectory;
  readonly now?: () => Date;
}

/**
 * Bình chọn của bài: bỏ phiếu (một hoặc nhiều lựa chọn), đổi và bỏ phiếu khi chưa đóng, xem người
 * bỏ phiếu (chỉ bình chọn công khai), đóng sớm. Bình chọn ẩn danh: không có đường nào trả người bỏ
 * phiếu, kể cả cho tác giả.
 */
export class SocialPollService {
  constructor(private readonly deps: SocialPollDeps) {}

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  /** Đặt lựa chọn của người gọi; `optionIds` rỗng là bỏ phiếu. Đặt lại là đổi phiếu. */
  async vote(actor: SocialActor, postId: string, request: SetSocialPollVoteRequest): Promise<SocialPoll> {
    const row = await this.deps.access.requirePublished(actor, postId);
    const poll = await this.requirePoll(actor, row);
    const optionIds = normalizeVoteOptions(request?.optionIds, poll);
    if (isPollClosed(poll, this.now())) throw new SocialPollClosedError();

    await this.deps.store.vote(actor.tenantId, {
      postId,
      pollId: poll.id,
      userId: actor.userId,
      optionIds,
      events: [pollChangedEvent(row, 'voted', actor.userId)],
    });
    return this.view(actor, row);
  }

  /** Ai chọn gì, chỉ cho bình chọn công khai. Ẩn danh trả 403 `POLL_ANONYMOUS`. */
  async voters(
    actor: SocialActor,
    postId: string,
    query: { optionId?: string; cursor?: string; limit?: number | string } = {},
  ): Promise<SocialPollVoterPage> {
    const row = await this.deps.access.requirePublished(actor, postId);
    const poll = await this.requirePoll(actor, row);
    if (poll.anonymous) throw new SocialPollAnonymousError();

    let optionId: string | undefined;
    if (query.optionId) {
      optionId = requireUuid(query.optionId, 'Mã lựa chọn').toLowerCase();
      if (!poll.options.some((option) => option.id.toLowerCase() === optionId)) {
        throw new SocialValidationError('Lựa chọn không thuộc bình chọn này.');
      }
    }
    const limit = normalizeLimit(query.limit);
    const offset = decodeOffsetCursor(query.cursor);
    const rows = await this.deps.store.listVoters(actor.tenantId, poll.id, optionId, limit + 1, offset);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const userOf = await lookupUsers(
      this.deps.directory,
      actor.tenantId,
      page.map((voter) => voter.userId),
    );
    return {
      items: page.map((voter) => ({
        user: userOf(voter.userId),
        optionId: voter.optionId,
        votedAt: toIso(voter.votedAt),
      })),
      ...(hasMore ? { nextCursor: encodeOffsetCursor(offset + limit) } : {}),
    };
  }

  /** Đóng sớm: tác giả hoặc moderator. */
  async close(actor: SocialActor, postId: string): Promise<SocialPoll> {
    const row = await this.deps.access.requirePublished(actor, postId);
    const poll = await this.requirePoll(actor, row);
    const isAuthor = row.authorId.toLowerCase() === actor.userId.toLowerCase();
    if (!isAuthor && !mayModerate(actor)) throw new SocialForbiddenError('Chỉ tác giả hoặc người kiểm duyệt mới đóng được bình chọn.');
    if (isPollClosed(poll, this.now())) throw new SocialPollClosedError();

    await this.deps.store.closePoll(actor.tenantId, poll.id, actor.userId, [
      pollChangedEvent(row, 'closed', actor.userId),
    ]);
    return this.view(actor, row);
  }

  private async requirePoll(actor: SocialActor, row: ExtendedPostRow): Promise<PollRow> {
    const engagement = await this.deps.store.engagement(actor.tenantId, [row.id], actor.userId);
    const poll = engagement.polls.get(row.id);
    if (!poll) throw new SocialPollNotFoundError();
    return poll;
  }

  private async view(actor: SocialActor, row: ExtendedPostRow): Promise<SocialPoll> {
    const post = (await this.deps.assembler.assemble(actor, [row]))[0];
    if (!post.poll) throw new SocialPollNotFoundError();
    return post.poll;
  }
}
