import { randomUUID } from 'node:crypto';
import type {
  CreateSocialGroupTopicRequest,
  SocialGroupTopic,
  SocialGroupTopicList,
  UpdateSocialGroupTopicRequest,
} from '@enterprise-platform/contracts-social';
import { normalizeGroupTopicName, normalizeTopicPosition } from '../domain/social-group-rules.js';
import { SocialGroupTopicNotFoundError } from '../domain/social-group.error.js';
import { isUuid } from '../domain/social-rules.js';
import { SocialValidationError } from '../domain/social.error.js';
import type { SocialActor } from './social-actor.js';
import type { GroupTopicRow, SocialGroupV2Store } from './social-group-v2-store.port.js';
import type { SocialGroupService } from './social-group.service.js';

/**
 * Chủ đề của nhóm (khác chuyên mục của Tường công ty). Xem: người xem được nhóm đầy đủ. Tạo/sửa/xoá:
 * admin nhóm (hoặc quản trị toàn hệ thống). Xoá chủ đề thì bài giữ nguyên, về "không chủ đề".
 */
export class SocialGroupTopicService {
  constructor(
    private readonly v2: SocialGroupV2Store,
    private readonly groups: SocialGroupService,
  ) {}

  async list(actor: SocialActor, groupId: string): Promise<SocialGroupTopicList> {
    const group = await this.groups.requireFullAccess(actor, groupId);
    const rows = await this.v2.topics.list(actor.tenantId, group.id);
    return { items: rows.map(toTopic) };
  }

  async create(actor: SocialActor, groupId: string, request: CreateSocialGroupTopicRequest): Promise<SocialGroupTopic> {
    const group = await this.groups.requireManageable(actor, groupId);
    const name = normalizeGroupTopicName((request ?? ({} as CreateSocialGroupTopicRequest)).name);
    const row = await this.v2.topics.create(actor.tenantId, {
      id: randomUUID(),
      groupId: group.id,
      name,
      createdBy: actor.userId,
    });
    return toTopic(row);
  }

  async update(
    actor: SocialActor,
    groupId: string,
    topicId: string,
    request: UpdateSocialGroupTopicRequest,
  ): Promise<SocialGroupTopic> {
    const group = await this.groups.requireManageable(actor, groupId);
    const input = request ?? {};
    const patch: { name?: string; position?: number } = {};
    if (input.name !== undefined) patch.name = normalizeGroupTopicName(input.name);
    if (input.position !== undefined) patch.position = normalizeTopicPosition(input.position);
    if (Object.keys(patch).length === 0) throw new SocialValidationError('Không có gì để cập nhật.');
    if (!isUuid(topicId)) throw new SocialGroupTopicNotFoundError();
    const row = await this.v2.topics.update(actor.tenantId, group.id, topicId.toLowerCase(), patch);
    if (!row) throw new SocialGroupTopicNotFoundError();
    return toTopic(row);
  }

  async remove(actor: SocialActor, groupId: string, topicId: string): Promise<void> {
    const group = await this.groups.requireManageable(actor, groupId);
    if (!isUuid(topicId)) throw new SocialGroupTopicNotFoundError();
    const removed = await this.v2.topics.remove(actor.tenantId, group.id, topicId.toLowerCase());
    if (!removed) throw new SocialGroupTopicNotFoundError();
  }
}

function toTopic(row: GroupTopicRow): SocialGroupTopic {
  return { id: row.id, groupId: row.groupId, name: row.name, position: row.position, postCount: row.postCount };
}
