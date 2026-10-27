import { randomUUID } from 'node:crypto';
import type {
  CreateSocialTopicRequest,
  SocialTopic,
  UpdateSocialTopicRequest,
} from '@enterprise-platform/contracts-social';
import { mayManage, mayRead } from '../domain/social-principal.js';
import { normalizeTopicName, requireUuid } from '../domain/social-rules.js';
import { SocialForbiddenError, SocialTopicNotFoundError, SocialValidationError } from '../domain/social.error.js';
import type { SocialActor } from './social-actor.js';
import type { SocialStore, TopicRow } from './social-store.port.js';

function view(row: TopicRow): SocialTopic {
  return { id: row.id, name: row.name, isActive: row.isActive, postCount: row.postCount };
}

/** Chuyên mục của bảng tin. Ai đọc được thì xem được; quản lý cần `social.manage`. */
export class SocialTopicService {
  constructor(private readonly store: SocialStore) {}

  /** Người quản lý thấy cả chuyên mục đã ngừng dùng; người khác chỉ thấy chuyên mục đang dùng. */
  async list(actor: SocialActor): Promise<{ items: SocialTopic[] }> {
    if (!mayRead(actor)) throw new SocialForbiddenError();
    const rows = await this.store.topics.list(actor.tenantId, mayManage(actor));
    return { items: rows.map(view) };
  }

  async create(actor: SocialActor, request: CreateSocialTopicRequest): Promise<SocialTopic> {
    this.assertManage(actor);
    const name = normalizeTopicName(request?.name);
    const id = randomUUID();
    await this.store.topics.insert(actor.tenantId, { id, name, createdBy: actor.userId });
    return this.require(actor, id);
  }

  async update(actor: SocialActor, topicId: string, request: UpdateSocialTopicRequest): Promise<SocialTopic> {
    this.assertManage(actor);
    requireUuid(topicId, 'Mã chuyên mục');
    const input = request ?? {};
    if (input.isActive !== undefined && typeof input.isActive !== 'boolean') {
      throw new SocialValidationError('Trạng thái chuyên mục không hợp lệ.');
    }
    const patch = {
      ...(input.name !== undefined ? { name: normalizeTopicName(input.name) } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    await this.require(actor, topicId);
    if (Object.keys(patch).length > 0) await this.store.topics.update(actor.tenantId, topicId, patch);
    return this.require(actor, topicId);
  }

  /** Xoá hẳn chuyên mục; bài viết vẫn còn, chỉ không còn gắn chuyên mục này. */
  async remove(actor: SocialActor, topicId: string): Promise<void> {
    this.assertManage(actor);
    requireUuid(topicId, 'Mã chuyên mục');
    await this.require(actor, topicId);
    await this.store.topics.remove(actor.tenantId, topicId);
  }

  private assertManage(actor: SocialActor): void {
    if (!mayManage(actor)) throw new SocialForbiddenError('Bạn không có quyền quản lý chuyên mục.');
  }

  private async require(actor: SocialActor, topicId: string): Promise<SocialTopic> {
    const row = await this.store.topics.findById(actor.tenantId, topicId);
    if (!row) throw new SocialTopicNotFoundError();
    return view(row);
  }
}
