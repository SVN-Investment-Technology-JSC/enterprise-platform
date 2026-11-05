import type { QuoteFollower, QuoteLink, QuoteLinkTargetType } from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from './data-scope.js';

/**
 * Port của người theo dõi và đối tượng liên quan của báo giá (P2I-07).
 *
 * `quoteAccess('read')`: báo giá trong phạm vi đọc (người phụ trách, người được gán giai đoạn, người theo dõi).
 * `quoteAccess('write')`: báo giá trong phạm vi ghi (người phụ trách và cấp trên); người theo dõi chỉ đọc.
 */
export const CRM_QUOTE_RELATION_STORE = Symbol('CRM_QUOTE_RELATION_STORE');

export interface QuoteRelationStore {
  quoteAccess(tenantId: string, scope: CrmDataScope, quoteId: string, mode: 'read' | 'write'): Promise<boolean>;

  listFollowers(tenantId: string, quoteId: string): Promise<QuoteFollower[]>;
  /** `false` khi người này đã theo dõi. */
  addFollower(tenantId: string, quoteId: string, userId: string, actorId: string): Promise<boolean>;
  /** `false` khi người này không theo dõi. */
  removeFollower(tenantId: string, quoteId: string, userId: string, actorId: string): Promise<boolean>;

  listLinks(tenantId: string, quoteId: string): Promise<QuoteLink[]>;
  /** Mã hoặc tên của đối tượng nếu tồn tại và nằm trong phạm vi đọc của người gọi; không thì `undefined`. */
  findTarget(tenantId: string, scope: CrmDataScope, type: QuoteLinkTargetType, id: string): Promise<string | undefined>;
  /** `false` khi đã có liên kết này; ném 409 khi quá số lượng tối đa. */
  addLink(
    tenantId: string,
    quoteId: string,
    target: { readonly type: QuoteLinkTargetType; readonly id: string },
    actorId: string,
  ): Promise<boolean>;
  removeLink(tenantId: string, quoteId: string, linkId: string, actorId: string): Promise<boolean>;
}
