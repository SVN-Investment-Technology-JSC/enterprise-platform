import {
  SOCIAL_GROUP_ADD_MEMBERS_MAX,
  SOCIAL_GROUP_ADMIN_MAX,
  SOCIAL_GROUP_COVER_PRESETS,
  SOCIAL_GROUP_DESCRIPTION_HTML_MAX,
  SOCIAL_GROUP_MEMBER_SOURCES_MAX,
  SOCIAL_GROUP_POST_PERMISSIONS,
  SOCIAL_GROUP_POST_PERMITTED_MAX,
  SOCIAL_GROUP_TOPIC_NAME_MAX,
  SOCIAL_ORG_NODE_KINDS,
  SOCIAL_REPORT_NOTE_MAX,
  SOCIAL_REPORT_REASON_MAX,
  SOCIAL_REPORT_REASON_MIN,
  SOCIAL_REPORT_STATUSES,
  SOCIAL_REPORT_TARGET_TYPES,
  SOCIAL_GROUP_COLORS,
  SOCIAL_GROUP_DEFAULT_COLOR,
  SOCIAL_GROUP_DEFAULT_ICON,
  SOCIAL_GROUP_DESCRIPTION_MAX,
  SOCIAL_GROUP_ICONS,
  SOCIAL_GROUP_JOIN_MESSAGE_MAX,
  SOCIAL_GROUP_LIST_SCOPES,
  SOCIAL_GROUP_MAX_PAGE_SIZE,
  SOCIAL_GROUP_NAME_MAX,
  SOCIAL_GROUP_PAGE_SIZE,
  SOCIAL_GROUP_PRIVACIES,
  SOCIAL_GROUP_ROLES,
  SOCIAL_FEED_SOURCES,
  SOCIAL_POST_KINDS,
  type SocialFeedSource,
  type SocialGroupCapabilities,
  type SocialGroupColor,
  type SocialGroupCoverPreset,
  type SocialGroupIcon,
  type SocialGroupMemberSourceInput,
  type SocialGroupPostPermission,
  type SocialReportStatus,
  type SocialReportTargetType,
  type SocialGroupListScope,
  type SocialGroupPrivacy,
  type SocialGroupRole,
  type SocialPostKind,
} from '@enterprise-platform/contracts-social';
import { htmlToPlainText, sanitizeHtml } from './html-sanitizer.js';
import { sliceSafe } from './safe-text.js';
import { isUuid, normalizeIdList } from './social-rules.js';
import { SocialValidationError } from './social.error.js';
import type { SocialPrincipal } from './social-principal.js';

/** "Quản trị toàn hệ thống": quản trị tenant hoặc `social.manage`. Thấy và quản lý mọi nhóm. */
export function isGlobalGroupAdmin(actor: SocialPrincipal): boolean {
  return actor.isTenantAdmin || actor.canManage;
}

/* ------------------------------------------------------------ chuẩn hoá */

export function normalizeGroupName(name: unknown): string {
  if (typeof name !== 'string') throw new SocialValidationError('Tên nhóm không hợp lệ.');
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new SocialValidationError('Tên nhóm không được để trống.');
  if (trimmed.length > SOCIAL_GROUP_NAME_MAX) {
    throw new SocialValidationError(`Tên nhóm tối đa ${SOCIAL_GROUP_NAME_MAX} ký tự.`);
  }
  return trimmed;
}

/** Mô tả rỗng nghĩa là không có mô tả (`undefined`). */
export function normalizeGroupDescription(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new SocialValidationError('Mô tả nhóm không hợp lệ.');
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > SOCIAL_GROUP_DESCRIPTION_MAX) {
    throw new SocialValidationError(`Mô tả nhóm tối đa ${SOCIAL_GROUP_DESCRIPTION_MAX} ký tự.`);
  }
  return trimmed;
}

export function normalizeGroupPrivacy(value: unknown): SocialGroupPrivacy {
  if (!(SOCIAL_GROUP_PRIVACIES as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Chế độ riêng tư của nhóm không hợp lệ.');
  }
  return value as SocialGroupPrivacy;
}

export function normalizeGroupColor(value: unknown): SocialGroupColor {
  if (value === undefined || value === null) return SOCIAL_GROUP_DEFAULT_COLOR;
  if (!(SOCIAL_GROUP_COLORS as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Màu của nhóm không hợp lệ.');
  }
  return value as SocialGroupColor;
}

export function normalizeGroupIcon(value: unknown): SocialGroupIcon {
  if (value === undefined || value === null) return SOCIAL_GROUP_DEFAULT_ICON;
  if (!(SOCIAL_GROUP_ICONS as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Biểu tượng của nhóm không hợp lệ.');
  }
  return value as SocialGroupIcon;
}

export function normalizeGroupRole(value: unknown, fallback?: SocialGroupRole): SocialGroupRole {
  if ((value === undefined || value === null) && fallback) return fallback;
  if (!(SOCIAL_GROUP_ROLES as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Vai trò trong nhóm không hợp lệ.');
  }
  return value as SocialGroupRole;
}

export function normalizeJoinMessage(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new SocialValidationError('Lời nhắn không hợp lệ.');
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > SOCIAL_GROUP_JOIN_MESSAGE_MAX) {
    throw new SocialValidationError(`Lời nhắn tối đa ${SOCIAL_GROUP_JOIN_MESSAGE_MAX} ký tự.`);
  }
  return trimmed;
}

/** Danh sách id người dùng, viết thường, không trùng, tối đa `max`. */
export function normalizeUserIds(value: unknown, max = SOCIAL_GROUP_ADD_MEMBERS_MAX): string[] {
  return [...new Set(normalizeIdList(value, 'Người dùng', max).map((id) => id.toLowerCase()))];
}

export function normalizeGroupListScope(value: unknown): SocialGroupListScope {
  if (value === undefined || value === null || value === '') return 'mine';
  if (!(SOCIAL_GROUP_LIST_SCOPES as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Phạm vi danh sách nhóm không hợp lệ.');
  }
  return value as SocialGroupListScope;
}

export function normalizeGroupLimit(limit: unknown): number {
  if (limit === undefined || limit === null || limit === '') return SOCIAL_GROUP_PAGE_SIZE;
  const value = Number(limit);
  if (!Number.isInteger(value) || value < 1) throw new SocialValidationError('Cỡ trang không hợp lệ.');
  return Math.min(value, SOCIAL_GROUP_MAX_PAGE_SIZE);
}

const SEARCH_QUERY_MAX = 80;

/** Từ khoá tìm kiếm; rỗng là không lọc. */
export function normalizeSearchQuery(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new SocialValidationError('Từ khoá không hợp lệ.');
  const trimmed = sliceSafe(value.trim(), SEARCH_QUERY_MAX);
  return trimmed || undefined;
}

/** Phạm vi bảng tin; mặc định `wall` để P1 chạy y nguyên. */
export function normalizeFeedSource(value: unknown): SocialFeedSource {
  if (value === undefined || value === null || value === '') return 'wall';
  if (!(SOCIAL_FEED_SOURCES as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Phạm vi bảng tin không hợp lệ.');
  }
  return value as SocialFeedSource;
}

export function normalizeFeedKind(value: unknown): SocialPostKind | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!(SOCIAL_POST_KINDS as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Loại bài viết không hợp lệ.');
  }
  return value as SocialPostKind;
}

/* ------------------------------------------------------------- quyền nhóm */

export interface GroupCapabilityInput {
  readonly privacy: SocialGroupPrivacy;
  /** Vai trò của người xem trong nhóm; thiếu là không phải thành viên. */
  readonly myRole?: SocialGroupRole;
  readonly globalAdmin: boolean;
  readonly adminCount: number;
  readonly hasPendingRequest: boolean;
  /** Đợt 2. Mặc định `all`. */
  readonly postPermission?: SocialGroupPostPermission;
  /** Đợt 2. Người xem nằm trong danh sách được chọn đăng bài. */
  readonly myPostPermitted?: boolean;
  /** Đợt 2. Nhóm ở chế độ `org` và đã có ít nhất một nguồn. */
  readonly hasMemberSources?: boolean;
}

/**
 * Người này đăng bài thường vào nhóm được không. Admin nhóm luôn đăng được; quản trị toàn hệ
 * thống không phải thành viên thì không (như đợt 1).
 */
export function mayPostToGroup(input: {
  readonly myRole?: SocialGroupRole;
  readonly postPermission?: SocialGroupPostPermission;
  readonly permitted?: boolean;
}): boolean {
  if (input.myRole === undefined) return false;
  if (input.myRole === 'admin') return true;
  const permission = input.postPermission ?? 'all';
  if (permission === 'all') return true;
  return permission === 'selected' && input.permitted === true;
}

export function groupCapabilities(input: GroupCapabilityInput): SocialGroupCapabilities {
  const isMember = input.myRole !== undefined;
  const canManage = input.myRole === 'admin' || input.globalAdmin;
  return {
    canPost: mayPostToGroup({
      myRole: input.myRole,
      postPermission: input.postPermission,
      permitted: input.myPostPermitted,
    }),
    canManage,
    canDelete: canManage,
    canJoin: !isMember && input.privacy === 'public',
    canRequestJoin: !isMember && input.privacy === 'private' && !input.hasPendingRequest,
    canLeave: isMember && (input.myRole !== 'admin' || input.adminCount > 1),
    canSyncMembers: canManage && input.hasMemberSources === true,
    canReport: input.myRole !== 'admin',
    canPrioritize: isMember,
  };
}

/** Người xem chỉ nhận bản xem trước: nhóm riêng tư, không phải thành viên, không phải quản trị toàn hệ thống. */
export function isPreviewOnly(input: {
  readonly privacy: SocialGroupPrivacy;
  readonly isMember: boolean;
  readonly globalAdmin: boolean;
}): boolean {
  return input.privacy === 'private' && !input.isMember && !input.globalAdmin;
}

/* ------------------------------------------------------------- đợt 2 */

/** Chặn HTML thô quá lớn trước khi đưa vào bộ làm sạch. */
const DESCRIPTION_HTML_RAW_MAX = SOCIAL_GROUP_DESCRIPTION_HTML_MAX * 4;

export interface GroupDescription {
  readonly html: string;
  /** Bản chữ thuần, cắt ở `SOCIAL_GROUP_DESCRIPTION_MAX` ký tự (kèm "…" khi bị cắt). */
  readonly text: string;
}

/** Cắt chữ thuần cho thẻ nhóm và tìm kiếm; thêm "…" khi bị cắt. */
export function truncatePlainText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${sliceSafe(text, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Mô tả rich text: làm sạch bằng bộ làm sạch của phân hệ rồi suy bản chữ thuần. Không còn chữ nào
 * sau khi làm sạch thì coi như không có mô tả (`undefined`).
 */
export function normalizeGroupDescriptionHtml(value: unknown): GroupDescription | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new SocialValidationError('Mô tả nhóm không hợp lệ.');
  if (value.length > DESCRIPTION_HTML_RAW_MAX) {
    throw new SocialValidationError(`Mô tả nhóm tối đa ${SOCIAL_GROUP_DESCRIPTION_HTML_MAX} ký tự.`);
  }
  const html = sanitizeHtml(value).trim();
  const text = htmlToPlainText(html);
  if (!text) return undefined;
  if (html.length > SOCIAL_GROUP_DESCRIPTION_HTML_MAX) {
    throw new SocialValidationError(`Mô tả nhóm tối đa ${SOCIAL_GROUP_DESCRIPTION_HTML_MAX} ký tự.`);
  }
  return { html, text: truncatePlainText(text, SOCIAL_GROUP_DESCRIPTION_MAX) };
}

export function normalizeCoverPreset(value: unknown): SocialGroupCoverPreset | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!(SOCIAL_GROUP_COVER_PRESETS as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Ảnh bìa của nhóm không hợp lệ.');
  }
  return value as SocialGroupCoverPreset;
}

export function normalizePostPermission(
  value: unknown,
  fallback?: SocialGroupPostPermission,
): SocialGroupPostPermission {
  if ((value === undefined || value === null) && fallback) return fallback;
  if (!(SOCIAL_GROUP_POST_PERMISSIONS as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Quyền đăng bài của nhóm không hợp lệ.');
  }
  return value as SocialGroupPostPermission;
}

/** Người được chọn đăng bài: không trùng, viết thường, tối đa `SOCIAL_GROUP_POST_PERMITTED_MAX`. */
export function normalizePermittedUserIds(value: unknown): string[] {
  return normalizeUserIds(value, SOCIAL_GROUP_POST_PERMITTED_MAX);
}

/** Quản lý thêm lúc tạo, bỏ người tạo; tổng kể cả người tạo tối đa `SOCIAL_GROUP_ADMIN_MAX`. */
export function normalizeAdminUserIds(value: unknown, creatorId: string): string[] {
  const ids = normalizeUserIds(value, SOCIAL_GROUP_ADMIN_MAX + 1).filter((id) => id !== creatorId.toLowerCase());
  if (ids.length + 1 > SOCIAL_GROUP_ADMIN_MAX) {
    throw new SocialValidationError(`Nhóm có tối đa ${SOCIAL_GROUP_ADMIN_MAX} quản lý.`);
  }
  return ids;
}

export interface NormalizedMemberSource {
  readonly type: SocialGroupMemberSourceInput['type'];
  readonly id: string;
  readonly includeDescendants: boolean;
}

/** Nguồn thành viên theo phòng ban/vị trí: không trùng, tối đa `SOCIAL_GROUP_MEMBER_SOURCES_MAX`. */
export function normalizeMemberSources(value: unknown): NormalizedMemberSource[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SocialValidationError('Nguồn thành viên không hợp lệ.');
  const seen = new Map<string, NormalizedMemberSource>();
  for (const item of value as readonly Partial<SocialGroupMemberSourceInput>[]) {
    if (!item || typeof item !== 'object') throw new SocialValidationError('Nguồn thành viên không hợp lệ.');
    if (!(SOCIAL_ORG_NODE_KINDS as readonly unknown[]).includes(item.type)) {
      throw new SocialValidationError('Loại nguồn thành viên không hợp lệ.');
    }
    if (!isUuid(item.id)) throw new SocialValidationError('Nguồn thành viên không hợp lệ.');
    const id = item.id.toLowerCase();
    seen.set(`${item.type}:${id}`, {
      type: item.type as NormalizedMemberSource['type'],
      id,
      includeDescendants: item.includeDescendants !== false,
    });
  }
  if (seen.size > SOCIAL_GROUP_MEMBER_SOURCES_MAX) {
    throw new SocialValidationError(`Chọn tối đa ${SOCIAL_GROUP_MEMBER_SOURCES_MAX} phòng ban hoặc vị trí.`);
  }
  return [...seen.values()];
}

export function normalizeGroupTopicName(value: unknown): string {
  if (typeof value !== 'string') throw new SocialValidationError('Tên chủ đề không hợp lệ.');
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new SocialValidationError('Tên chủ đề không được để trống.');
  if (trimmed.length > SOCIAL_GROUP_TOPIC_NAME_MAX) {
    throw new SocialValidationError(`Tên chủ đề tối đa ${SOCIAL_GROUP_TOPIC_NAME_MAX} ký tự.`);
  }
  return trimmed;
}

export function normalizeTopicPosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new SocialValidationError('Vị trí chủ đề không hợp lệ.');
  }
  return value;
}

export function normalizeReportTargetType(value: unknown): SocialReportTargetType {
  if (!(SOCIAL_REPORT_TARGET_TYPES as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Đối tượng báo cáo không hợp lệ.');
  }
  return value as SocialReportTargetType;
}

export function normalizeOptionalReportTargetType(value: unknown): SocialReportTargetType | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return normalizeReportTargetType(value);
}

export function normalizeReportReason(value: unknown): string {
  if (typeof value !== 'string') throw new SocialValidationError('Hãy nhập lý do báo cáo.');
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length < SOCIAL_REPORT_REASON_MIN) {
    throw new SocialValidationError(`Lý do báo cáo tối thiểu ${SOCIAL_REPORT_REASON_MIN} ký tự.`);
  }
  if (trimmed.length > SOCIAL_REPORT_REASON_MAX) {
    throw new SocialValidationError(`Lý do báo cáo tối đa ${SOCIAL_REPORT_REASON_MAX} ký tự.`);
  }
  return trimmed;
}

export function normalizeReportNote(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new SocialValidationError('Ghi chú xử lý không hợp lệ.');
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > SOCIAL_REPORT_NOTE_MAX) {
    throw new SocialValidationError(`Ghi chú xử lý tối đa ${SOCIAL_REPORT_NOTE_MAX} ký tự.`);
  }
  return trimmed;
}

export function normalizeReportStatus(value: unknown, fallback?: SocialReportStatus): SocialReportStatus {
  if ((value === undefined || value === null || value === '') && fallback) return fallback;
  if (!(SOCIAL_REPORT_STATUSES as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Trạng thái báo cáo không hợp lệ.');
  }
  return value as SocialReportStatus;
}

/** Trạng thái khi xử lý: `resolved` hoặc `dismissed`. */
export function normalizeResolveStatus(value: unknown): Exclude<SocialReportStatus, 'open'> {
  const status = normalizeReportStatus(value);
  if (status === 'open') throw new SocialValidationError('Trạng thái xử lý phải là "Đã xử lý" hoặc "Bỏ qua".');
  return status;
}
