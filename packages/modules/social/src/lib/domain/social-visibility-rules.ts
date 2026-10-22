import {
  SOCIAL_AUDIENCE_MAX_UNITS,
  SOCIAL_AUDIENCE_MAX_USERS,
  SOCIAL_POST_VISIBILITIES,
  type SocialPostAudienceInput,
  type SocialPostVisibility,
} from '@enterprise-platform/contracts-social';
import { SocialVisibilityAudienceError, SocialVisibilityNotAllowedError } from './social-visibility.error.js';
import { isUuid } from './social-rules.js';
import { SocialValidationError } from './social.error.js';

/** Danh sách chia sẻ đã chuẩn hoá: id viết thường, không trùng. */
export interface PostAudience {
  readonly userIds: readonly string[];
  readonly unitIds: readonly string[];
}

export const EMPTY_AUDIENCE: PostAudience = { userIds: [], unitIds: [] };

/** Thiếu là `company`; giá trị lạ là 400 `VALIDATION`. */
export function normalizeVisibility(value: unknown): SocialPostVisibility {
  if (value === undefined || value === null || value === '') return 'company';
  if (!(SOCIAL_POST_VISIBILITIES as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Quyền xem bài viết không hợp lệ.');
  }
  return value as SocialPostVisibility;
}

/** Id người/phòng ban đúng UUID, không trùng, viết thường. Mảng rác hoặc id lạ là 400 `VISIBILITY_AUDIENCE_INVALID`. */
export function normalizeAudienceInput(input: SocialPostAudienceInput | null | undefined): PostAudience {
  if (input === undefined || input === null) return EMPTY_AUDIENCE;
  if (typeof input !== 'object') throw new SocialVisibilityAudienceError();
  return {
    userIds: idList(input.userIds, SOCIAL_AUDIENCE_MAX_USERS, 'người'),
    unitIds: idList(input.unitIds, SOCIAL_AUDIENCE_MAX_UNITS, 'phòng ban hoặc vị trí'),
  };
}

function idList(value: unknown, max: number, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SocialVisibilityAudienceError();
  const ids = [
    ...new Set(
      value.map((item) => {
        if (!isUuid(item)) throw new SocialVisibilityAudienceError(`Mã ${label} trong danh sách chia sẻ không hợp lệ.`);
        return item.toLowerCase();
      }),
    ),
  ];
  if (ids.length > max) throw new SocialVisibilityAudienceError(`Chỉ chia sẻ được tối đa ${max} ${label}.`);
  return ids;
}

export function audienceIsEmpty(audience: PostAudience): boolean {
  return audience.userIds.length === 0 && audience.unitIds.length === 0;
}

/**
 * Những tính năng chỉ đi với bài công khai: thông báo, ghim, nhắc tất cả, xác nhận đã đọc.
 * Ném 400 `VISIBILITY_NOT_ALLOWED` khi bài có quyền xem hẹp mà vẫn đòi các tính năng này.
 */
export function assertCompanyOnlyFeatures(
  visibility: SocialPostVisibility,
  features: {
    readonly announcement: boolean;
    readonly pinned: boolean;
    readonly mentionsAll: boolean;
    readonly requiresReadConfirmation: boolean;
  },
): void {
  if (visibility === 'company') return;
  if (features.announcement || features.pinned || features.mentionsAll || features.requiresReadConfirmation) {
    throw new SocialVisibilityNotAllowedError(
      'Thông báo, ghim bài, nhắc tất cả và xác nhận đã đọc chỉ dùng được với bài công khai.',
    );
  }
}
