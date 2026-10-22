/**
 * Hợp đồng đợt 2: quyền xem bài, danh bạ phòng ban/vị trí, lịch sử chỉnh sửa.
 *
 * Quyền xem chỉ áp cho bài Tường công ty (`group_id IS NULL`); bài trong nhóm luôn theo nhóm.
 * Luật đầy đủ và quyết định đã chốt: docs/architecture/social-p2-p3-api.md, mục "Đợt 2".
 */
import type { SocialUserRef } from './contracts-social.js';

/* ------------------------------------------------------------ quyền xem */

/**
 * - `company`: Công khai, mọi đồng nghiệp đang làm việc.
 * - `unit`: Phòng ban, chỉ người thuộc phòng ban của tác giả (kể cả phòng con của nó) và tác giả.
 * - `custom`: Tùy chỉnh, chỉ người/phòng ban được chọn (phòng ban gồm cả phòng con) và tác giả.
 * - `private`: Chỉ mình tôi (tác giả).
 */
export const SOCIAL_POST_VISIBILITIES = ['company', 'unit', 'custom', 'private'] as const;
export type SocialPostVisibility = (typeof SOCIAL_POST_VISIBILITIES)[number];

export const SOCIAL_DEFAULT_POST_VISIBILITY: SocialPostVisibility = 'company';

export const SOCIAL_POST_VISIBILITY_LABELS: Readonly<Record<SocialPostVisibility, string>> = {
  company: 'Công khai',
  unit: 'Phòng ban',
  custom: 'Tùy chỉnh',
  private: 'Chỉ mình tôi',
};

export const SOCIAL_POST_VISIBILITY_DESCRIPTIONS: Readonly<Record<SocialPostVisibility, string>> = {
  company: 'Mọi đồng nghiệp trong công ty đều xem được.',
  unit: 'Chỉ đồng nghiệp trong phòng ban của bạn (gồm các phòng ban con) xem được.',
  custom: 'Chỉ những người và phòng ban bạn chọn xem được.',
  private: 'Chỉ mình bạn xem được.',
};

/** Giới hạn danh sách chia sẻ của một bài `custom`. */
export const SOCIAL_AUDIENCE_MAX_USERS = 200;
export const SOCIAL_AUDIENCE_MAX_UNITS = 50;

export const SOCIAL_AUDIENCE_PRINCIPAL_TYPES = ['user', 'unit'] as const;
export type SocialAudiencePrincipalType = (typeof SOCIAL_AUDIENCE_PRINCIPAL_TYPES)[number];

/** Dữ liệu gửi lên: id thuần. Cả hai mảng thiếu hoặc rỗng nghĩa là không chia sẻ cho ai. */
export interface SocialPostAudienceInput {
  readonly userIds?: readonly string[];
  /** Id nút phòng ban (loại `unit`) hoặc vị trí (loại `position`) trong sơ đồ tổ chức. */
  readonly unitIds?: readonly string[];
}

/** Dữ liệu trả về, đã tra tên. */
export interface SocialPostAudience {
  readonly users: readonly SocialUserRef[];
  readonly units: readonly SocialUnitRef[];
}

/** Mã lỗi nghiệp vụ của quyền xem (cùng khung `{ statusCode, code, message }`). */
export const SOCIAL_VISIBILITY_ERROR_CODES = {
  /** 400: nhóm hoặc loại bài/tính năng không đi cùng quyền xem này. */
  notAllowed: 'VISIBILITY_NOT_ALLOWED',
  /** 400: `custom` nhưng không có ai; hoặc người/phòng ban không có trong danh bạ. */
  audienceInvalid: 'VISIBILITY_AUDIENCE_INVALID',
  /** 400: chọn `unit` nhưng tác giả chưa thuộc phòng ban nào. */
  unitUnknown: 'VISIBILITY_UNIT_UNKNOWN',
  /** 403: không có quyền đổi (không phải tác giả) hoặc bài ở trạng thái không đổi được. */
  changeForbidden: 'VISIBILITY_CHANGE_FORBIDDEN',
  /** 403: bài đã tắt bình luận. */
  commentsDisabled: 'COMMENTS_DISABLED',
} as const;

/* ------------------------------------------------------ sơ đồ tổ chức */

/** `unit`: phòng ban/đơn vị. `position`: vị trí/chức danh (nút loại `position` của sơ đồ tổ chức). */
export const SOCIAL_ORG_NODE_KINDS = ['unit', 'position'] as const;
export type SocialOrgNodeKind = (typeof SOCIAL_ORG_NODE_KINDS)[number];

export const SOCIAL_ORG_NODE_KIND_LABELS: Readonly<Record<SocialOrgNodeKind, string>> = {
  unit: 'Phòng ban',
  position: 'Vị trí',
};

/** Phòng ban/vị trí rút gọn gắn vào đối tượng chia sẻ và nguồn thành viên nhóm. */
export interface SocialUnitRef {
  readonly id: string;
  readonly name: string;
  readonly kind: SocialOrgNodeKind;
  /** Tên nút cha gần nhất, để phân biệt hai phòng trùng tên. */
  readonly parentName?: string;
}

export interface SocialOrgNode extends SocialUnitRef {
  readonly parentId?: string;
  /** Số người đang làm việc ở nút này và các nút con. */
  readonly memberCount: number;
}

/** `GET /org/nodes?kind&query&limit`: để chọn phòng ban/vị trí khi chia sẻ bài và tạo nhóm. */
export interface SocialOrgNodeQuery {
  readonly kind?: SocialOrgNodeKind;
  /** Tìm theo tên, không phân biệt dấu và hoa thường. */
  readonly query?: string;
  /** Mặc định `SOCIAL_ORG_NODE_PAGE_SIZE`, tối đa `SOCIAL_ORG_NODE_MAX_PAGE_SIZE`. */
  readonly limit?: number;
}

export const SOCIAL_ORG_NODE_PAGE_SIZE = 50;
export const SOCIAL_ORG_NODE_MAX_PAGE_SIZE = 200;

export interface SocialOrgNodePage {
  readonly items: readonly SocialOrgNode[];
}

/* ------------------------------------------------ lịch sử chỉnh sửa */

/** Một bản cũ của bài, lưu ngay trước khi bị ghi đè. */
export interface SocialPostEditVersion {
  /** 1 là bản gốc lúc đăng; tăng dần theo mỗi lần sửa. */
  readonly version: number;
  readonly title?: string;
  /** HTML đã làm sạch; hiển thị trực tiếp. */
  readonly bodyHtml: string;
  /** Người đã SỬA bản này thành bản kế tiếp (thường là tác giả; có thể là moderator). */
  readonly editedBy: SocialUserRef;
  /** Thời điểm bản này bị thay thế. */
  readonly editedAt: string;
}

/** `GET /posts/:id/edits`: bản hiện tại cộng các bản cũ, mới nhất trước. */
export interface SocialPostEditHistory {
  readonly postId: string;
  readonly current: {
    readonly version: number;
    readonly title?: string;
    readonly bodyHtml: string;
    readonly editedAt?: string;
  };
  readonly versions: readonly SocialPostEditVersion[];
}
