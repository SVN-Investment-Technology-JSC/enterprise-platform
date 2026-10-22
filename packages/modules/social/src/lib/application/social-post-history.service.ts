import type { SocialPostEditHistory } from '@enterprise-platform/contracts-social';
import { toIso } from '../domain/social-rules.js';
import { SocialForbiddenError } from '../domain/social.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPostAccess } from './social-post-access.js';
import type { SocialPostHistoryStore } from './social-post-history-store.port.js';
import { lookupUsers } from './social-views.js';

export interface SocialPostHistoryDeps {
  readonly store: SocialPostHistoryStore;
  readonly access: SocialPostAccess;
  readonly directory: OrganizationDirectory;
}

/**
 * `GET /posts/:id/edits`: bản hiện tại cộng các bản cũ, mới nhất trước. Người xem phải thấy được bài
 * (không thì 404 `POST_NOT_FOUND`); xem lịch sử là tác giả, moderator (bài Tường công ty), admin nhóm
 * (bài nhóm), người khác 403 `FORBIDDEN`.
 */
export class SocialPostHistoryService {
  constructor(private readonly deps: SocialPostHistoryDeps) {}

  async get(actor: SocialActor, postId: string): Promise<SocialPostEditHistory> {
    const { access, store, directory } = this.deps;
    const row = await access.requireVisible(actor, postId);
    if (!(await access.mayViewHistory(actor, row))) throw new SocialForbiddenError();

    const records = (row.editCount ?? 0) > 0 ? await store.list(actor.tenantId, postId) : [];
    const userOf = await lookupUsers(
      directory,
      actor.tenantId,
      records.map((record) => record.editedBy),
    );
    return {
      postId: row.id,
      current: {
        version: (row.editCount ?? 0) + 1,
        ...(row.title ? { title: row.title } : {}),
        bodyHtml: row.bodyHtml,
        ...(row.editedAt ? { editedAt: toIso(row.editedAt) } : {}),
      },
      versions: records.map((record) => ({
        version: record.version,
        ...(record.title ? { title: record.title } : {}),
        bodyHtml: record.bodyHtml,
        editedBy: userOf(record.editedBy),
        editedAt: toIso(record.editedAt),
      })),
    };
  }
}
