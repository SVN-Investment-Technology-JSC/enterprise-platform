import {
  SOCIAL_ORG_NODE_KINDS,
  SOCIAL_ORG_NODE_MAX_PAGE_SIZE,
  SOCIAL_ORG_NODE_PAGE_SIZE,
  type SocialOrgNodeKind,
  type SocialOrgNodePage,
} from '@enterprise-platform/contracts-social';
import { SocialValidationError } from '../domain/social.error.js';
import type { OrgStructurePort } from './ports/viewer-scope.port.js';
import type { SocialActor } from './social-actor.js';

const QUERY_MAX = 100;

/** `GET /org/nodes`: danh sách phòng ban/vị trí để chọn khi chia sẻ bài và tạo nhóm. Mọi thành viên tenant dùng được. */
export class SocialOrgService {
  constructor(private readonly org: Pick<OrgStructurePort, 'listNodes'>) {}

  async list(
    actor: SocialActor,
    query: { kind?: string; query?: string; limit?: number | string } = {},
  ): Promise<SocialOrgNodePage> {
    const kind = normalizeKind(query.kind);
    const text = typeof query.query === 'string' ? query.query.trim() : '';
    if (text.length > QUERY_MAX) throw new SocialValidationError(`Từ khoá tối đa ${QUERY_MAX} ký tự.`);
    const items = await this.org.listNodes(actor.tenantId, {
      ...(kind ? { kind } : {}),
      ...(text ? { query: text } : {}),
      limit: normalizeNodeLimit(query.limit),
    });
    return { items: [...items] };
  }
}

function normalizeKind(value: unknown): SocialOrgNodeKind | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!(SOCIAL_ORG_NODE_KINDS as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Loại phòng ban hoặc vị trí không hợp lệ.');
  }
  return value as SocialOrgNodeKind;
}

function normalizeNodeLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return SOCIAL_ORG_NODE_PAGE_SIZE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new SocialValidationError('Số mục mỗi trang không hợp lệ.');
  return Math.min(parsed, SOCIAL_ORG_NODE_MAX_PAGE_SIZE);
}
