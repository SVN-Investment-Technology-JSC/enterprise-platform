import type { SocialSettings, UpdateSocialSettingsRequest } from '@enterprise-platform/contracts-social';
import { mayManage } from '../domain/social-principal.js';
import { SocialForbiddenError, SocialValidationError } from '../domain/social.error.js';
import type { SocialSettingsPort } from './ports/social-settings.port.js';
import type { SocialActor } from './social-actor.js';

/** Cài đặt phân hệ: mọi thành viên đọc được, chỉ `social.manage` (hoặc quản trị tenant) sửa được. */
export class SocialSettingsService {
  constructor(private readonly settings: SocialSettingsPort) {}

  get(actor: SocialActor): Promise<SocialSettings> {
    return this.settings.get(actor.tenantId);
  }

  async update(actor: SocialActor, request: UpdateSocialSettingsRequest): Promise<SocialSettings> {
    if (!mayManage(actor)) throw new SocialForbiddenError('Chỉ người quản lý Mạng nội bộ mới đổi được cài đặt.');
    if (typeof request !== 'object' || request === null || Array.isArray(request)) {
      throw new SocialValidationError('Cài đặt không hợp lệ.');
    }
    const patch: { wallRequireApproval?: boolean } = {};
    if (request.wallRequireApproval !== undefined) {
      if (typeof request.wallRequireApproval !== 'boolean') {
        throw new SocialValidationError('Cài đặt duyệt bài không hợp lệ.');
      }
      patch.wallRequireApproval = request.wallRequireApproval;
    }
    if (Object.keys(patch).length === 0) return this.settings.get(actor.tenantId);
    return this.settings.update(actor.tenantId, patch, actor.userId);
  }
}
