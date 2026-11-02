import {
  QUOTE_LINK_TARGET_LABELS,
  QUOTE_LINK_TARGET_TYPES,
  type AddQuoteFollowerRequest,
  type AddQuoteLinkRequest,
  type QuoteFollower,
  type QuoteLink,
  type QuoteLinkTargetType,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid } from '../domain/fields.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import type { QuoteRelationStore } from './quote-relation-store.port.js';
import { requireQuoteWriter } from './quote.service.js';
import type { PeopleDirectory } from './sales-store.port.js';

const QUOTE_NOT_FOUND = 'Không tìm thấy báo giá.';

/**
 * Người theo dõi và đối tượng liên quan của báo giá (P2I-07; TC-QF-13, TC-QF-14).
 *
 * - Xem danh sách: ai đọc được báo giá. Người theo dõi đọc được báo giá mình theo dõi (chỉ đọc, không sửa) cùng cơ
 *   chế với người được gán giai đoạn; bỏ theo dõi thì hết quyền đọc theo lý do này.
 * - Thêm, bỏ người theo dõi của người khác, thêm, xoá đối tượng liên quan: `crm.quote.write` và báo giá trong phạm vi
 *   ghi (như sửa báo giá). Người theo dõi tự bỏ theo dõi được dù chỉ có quyền đọc.
 * - Đối tượng liên quan phải tồn tại và nằm trong phạm vi dữ liệu của người thêm: ngoài phạm vi trả 404, như không có.
 */
export class QuoteRelationService {
  constructor(
    private readonly store: QuoteRelationStore,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    /** Danh bạ nhân sự để kiểm người theo dõi còn hoạt động; rỗng thì chỉ kiểm định dạng. */
    private readonly people?: PeopleDirectory,
  ) {}

  private async require(actor: CrmActor, quoteId: string, mode: 'read' | 'write') {
    if (!isUuid(quoteId)) throw new CrmNotFoundError(QUOTE_NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    if (!(await this.store.quoteAccess(actor.tenantId, scope, quoteId, mode))) throw new CrmNotFoundError(QUOTE_NOT_FOUND);
    return scope;
  }

  async listFollowers(actor: CrmActor, quoteId: string): Promise<QuoteFollower[]> {
    await this.require(actor, quoteId, 'read');
    return this.store.listFollowers(actor.tenantId, quoteId);
  }

  async addFollower(actor: CrmActor, quoteId: string, request: AddQuoteFollowerRequest): Promise<QuoteFollower[]> {
    requireQuoteWriter(actor);
    await this.require(actor, quoteId, 'write');
    const userId = typeof request?.userId === 'string' ? request.userId.toLowerCase() : '';
    if (!isUuid(userId)) throw new CrmValidationError('FOLLOWER_REQUIRED', 'Vui lòng chọn người theo dõi.');
    if (this.people) {
      const people = await this.people.people(actor.tenantId);
      if (!people.some((person) => person.userId === userId)) {
        throw new CrmValidationError('FOLLOWER_INVALID', 'Người theo dõi không còn hoạt động hoặc không thuộc tổ chức.');
      }
    }
    if (!(await this.store.addFollower(actor.tenantId, quoteId, userId, actor.userId))) {
      throw new CrmConflictError('FOLLOWER_EXISTS', 'Người này đã theo dõi báo giá.');
    }
    return this.store.listFollowers(actor.tenantId, quoteId);
  }

  async removeFollower(actor: CrmActor, quoteId: string, userId: string): Promise<QuoteFollower[]> {
    const target = typeof userId === 'string' ? userId.toLowerCase() : '';
    if (!isUuid(target)) throw new CrmNotFoundError('Không tìm thấy người theo dõi.');
    if (target === actor.userId) {
      // Tự bỏ theo dõi: chỉ cần đọc được báo giá.
      await this.require(actor, quoteId, 'read');
    } else {
      requireQuoteWriter(actor);
      await this.require(actor, quoteId, 'write');
    }
    if (!(await this.store.removeFollower(actor.tenantId, quoteId, target, actor.userId))) {
      throw new CrmNotFoundError('Không tìm thấy người theo dõi.');
    }
    return this.store.listFollowers(actor.tenantId, quoteId);
  }

  async listLinks(actor: CrmActor, quoteId: string): Promise<QuoteLink[]> {
    await this.require(actor, quoteId, 'read');
    return this.store.listLinks(actor.tenantId, quoteId);
  }

  async addLink(actor: CrmActor, quoteId: string, request: AddQuoteLinkRequest): Promise<QuoteLink[]> {
    requireQuoteWriter(actor);
    const scope = await this.require(actor, quoteId, 'write');
    const type = QUOTE_LINK_TARGET_TYPES.find((candidate): candidate is QuoteLinkTargetType => candidate === request?.targetType);
    if (!type) {
      throw new CrmValidationError('LINK_TYPE_INVALID', 'Loại đối tượng liên quan phải là khách hàng, dự án bán hàng, hợp đồng, đơn bán hoặc báo giá.');
    }
    const targetId = typeof request.targetId === 'string' ? request.targetId.toLowerCase() : '';
    const label = QUOTE_LINK_TARGET_LABELS[type].toLowerCase();
    if (!isUuid(targetId)) throw new CrmValidationError('LINK_TARGET_REQUIRED', `Vui lòng chọn ${label} cần liên kết.`);
    if (type === 'QUOTE' && targetId === quoteId.toLowerCase()) {
      throw new CrmValidationError('LINK_SELF', 'Không liên kết một báo giá với chính nó.');
    }
    // Chỉ liên kết được đối tượng trong phạm vi dữ liệu của người dùng; ngoài phạm vi hay không có đều 404.
    if ((await this.store.findTarget(actor.tenantId, scope, type, targetId)) === undefined) {
      throw new CrmNotFoundError(`Không tìm thấy ${label}.`);
    }
    if (!(await this.store.addLink(actor.tenantId, quoteId, { type, id: targetId }, actor.userId))) {
      throw new CrmConflictError('LINK_EXISTS', `${QUOTE_LINK_TARGET_LABELS[type]} này đã được liên kết với báo giá.`);
    }
    return this.store.listLinks(actor.tenantId, quoteId);
  }

  async removeLink(actor: CrmActor, quoteId: string, linkId: string): Promise<QuoteLink[]> {
    requireQuoteWriter(actor);
    await this.require(actor, quoteId, 'write');
    if (!isUuid(linkId) || !(await this.store.removeLink(actor.tenantId, quoteId, linkId, actor.userId))) {
      throw new CrmNotFoundError('Không tìm thấy đối tượng liên quan.');
    }
    return this.store.listLinks(actor.tenantId, quoteId);
  }
}
