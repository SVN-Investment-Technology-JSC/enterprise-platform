import {
  SOCIAL_PERMISSIONS,
  type SocialMe,
  type SocialPermission,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import { mayManage, mayModerate, mayRead, mayWrite } from '../domain/social-principal.js';
import { SocialForbiddenError } from '../domain/social.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { SocialActor } from './social-actor.js';
import { UNKNOWN_USER_NAME } from './social-views.js';

/** Số gợi ý mention tối đa. */
const PEOPLE_LIMIT = 10;
const PEOPLE_QUERY_MAX = 80;

/** Người đang đăng nhập và gợi ý người để nhắc tên. */
export class SocialMeService {
  constructor(private readonly directory: OrganizationDirectory) {}

  async me(actor: SocialActor): Promise<SocialMe> {
    if (!mayRead(actor)) throw new SocialForbiddenError();
    const held: Record<SocialPermission, boolean> = {
      'social.read': mayRead(actor),
      'social.post.write': mayWrite(actor),
      'social.post.moderate': mayModerate(actor),
      'social.manage': mayManage(actor),
    };
    const profile = (await this.directory.resolve(actor.tenantId, [actor.userId])).get(actor.userId.toLowerCase());
    const user: SocialUserRef = profile ?? {
      id: actor.userId,
      name: actor.displayName || UNKNOWN_USER_NAME,
    };
    return { user, permissions: SOCIAL_PERMISSIONS.filter((permission) => held[permission]) };
  }

  /** Gợi ý người để nhắc tên; chỉ người có quyền đăng bài mới cần. Truy vấn rỗng trả danh sách rỗng. */
  async people(actor: SocialActor, query: string | undefined): Promise<{ items: readonly SocialUserRef[] }> {
    if (!mayWrite(actor)) throw new SocialForbiddenError();
    const text = (query ?? '').trim().slice(0, PEOPLE_QUERY_MAX);
    if (!text) return { items: [] };
    return { items: await this.directory.search(actor.tenantId, text, PEOPLE_LIMIT) };
  }
}
