import {
  SOCIAL_GROUP_ADMIN_MAX,
  SOCIAL_GROUP_DEFAULT_COVER_PRESET,
  SOCIAL_GROUP_DESCRIPTION_HTML_MAX,
  SOCIAL_GROUP_MEMBER_SOURCES_MAX,
  SOCIAL_GROUP_NAME_MAX,
  SOCIAL_GROUP_POST_PERMITTED_MAX,
  SOCIAL_REPORT_REASON_MAX,
  SOCIAL_REPORT_REASON_MIN,
  type CreateSocialGroupRequest,
  type SocialGroupColor,
  type SocialGroupCoverPreset,
  type SocialGroupDetail,
  type SocialGroupMemberSource,
  type SocialGroupMemberSourceInput,
  type SocialGroupMembershipMode,
  type SocialGroupPostPermission,
  type SocialGroupSummary,
  type SocialOrgNodeKind,
  type SocialUserRef,
  type UpdateSocialGroupRequest,
} from '@enterprise-platform/contracts-social';

/** Màu bìa theo khoá màu của nhóm (nhóm cũ chưa có `coverPreset`): [đầu, cuối] của dải chuyển màu. */
export const GROUP_COVER_COLORS: Readonly<Record<SocialGroupColor, readonly [string, string]>> = {
  blue: ['#1d4ed8', '#3b82f6'],
  teal: ['#0f766e', '#14b8a6'],
  green: ['#047857', '#10b981'],
  amber: ['#a16207', '#d9ab00'],
  orange: ['#c2410c', '#ea580c'],
  red: ['#b91c1c', '#ef4444'],
  violet: ['#6d28d9', '#8b5cf6'],
  slate: ['#334155', '#64748b'],
};

/** Ảnh bìa mặc định: dải chuyển màu dịu, không dùng ảnh ngoài. */
export const GROUP_COVER_PRESET_GRADIENTS: Readonly<Record<SocialGroupCoverPreset, readonly [string, string]>> = {
  aurora: ['#0f766e', '#6d28d9'],
  ocean: ['#1d4ed8', '#0ea5e9'],
  forest: ['#047857', '#65a30d'],
  sunset: ['#c2410c', '#d9ab00'],
  mountain: ['#334155', '#64748b'],
  city: ['#1e293b', '#3b82f6'],
  geometric: ['#6d28d9', '#ec4899'],
  paper: ['#a8a29e', '#e7e5e4'],
};

export function coverGradient(color: SocialGroupColor): string {
  const [from, to] = GROUP_COVER_COLORS[color] ?? GROUP_COVER_COLORS.blue;
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/** Nền bìa của nhóm: ảnh bìa mặc định nếu có, ngược lại theo màu. */
export function groupCover(group: Pick<SocialGroupSummary, 'coverPreset' | 'color'>): string {
  const preset = group.coverPreset ? GROUP_COVER_PRESET_GRADIENTS[group.coverPreset] : undefined;
  if (!preset) return coverGradient(group.color);
  return `linear-gradient(135deg, ${preset[0]}, ${preset[1]})`;
}

export function presetGradient(preset: SocialGroupCoverPreset): string {
  const [from, to] = GROUP_COVER_PRESET_GRADIENTS[preset];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/** Trạng thái nút hành động chính trên thẻ nhóm. */
export type GroupJoinState = 'member' | 'pending' | 'join' | 'request';

export function joinState(
  group: Pick<SocialGroupSummary, 'myMembership' | 'myJoinRequestId' | 'privacy'>,
): GroupJoinState {
  if (group.myMembership) return 'member';
  if (group.myJoinRequestId) return 'pending';
  return group.privacy === 'private' ? 'request' : 'join';
}

/** Mục con của trang nhóm, đọc từ `/groups/:id/<mục>`. */
export const GROUP_SECTIONS = ['feed', 'announcements', 'members', 'requests', 'topics', 'reports'] as const;
export type GroupSection = (typeof GROUP_SECTIONS)[number];

/** Đoạn thứ hai của đường dẫn nhóm thành mục; thiếu hoặc lạ thì về bảng tin của nhóm. */
export function parseGroupSection(section: string | undefined): GroupSection {
  return (GROUP_SECTIONS as readonly string[]).includes(section ?? '') ? (section as GroupSection) : 'feed';
}

/** Đoạn đường dẫn của một mục; bảng tin nhóm không có đoạn. */
export function sectionSegment(section: GroupSection): string | undefined {
  return section === 'feed' ? undefined : section;
}

/** Gộp trang kế vào danh sách, bỏ trùng theo `id` (giữ bản đầu). */
export function appendUnique<T extends { readonly id: string }>(
  current: readonly T[],
  next: readonly T[],
): readonly T[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !seen.has(item.id))];
}

/** Nhóm tôi chưa là thành viên. */
export function discoverable(groups: readonly SocialGroupSummary[]): readonly SocialGroupSummary[] {
  return groups.filter((group) => !group.myMembership);
}

export const memberCountLabel = (count: number) => `${count} thành viên`;

/* --------------------------------------------------------------------- biểu mẫu tạo/sửa nhóm */

export interface GroupSourceDraft {
  /** Id nút trong sơ đồ tổ chức. */
  readonly id: string;
  readonly type: SocialOrgNodeKind;
  readonly name: string;
  readonly includeDescendants: boolean;
}

export interface GroupFormState {
  readonly name: string;
  readonly mode: SocialGroupMembershipMode;
  /** Quản lý thêm (người tạo luôn là quản lý, không nằm trong danh sách). Chỉ dùng khi tạo. */
  readonly admins: readonly SocialUserRef[];
  /** Thành viên thêm ngay khi tạo (kiểu danh sách người dùng). */
  readonly members: readonly SocialUserRef[];
  readonly sources: readonly GroupSourceDraft[];
  readonly postPermission: SocialGroupPostPermission;
  readonly permitted: readonly SocialUserRef[];
  readonly descriptionHtml: string;
  readonly isPublic: boolean;
  readonly coverPreset: SocialGroupCoverPreset;
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Chữ thuần thành HTML đơn giản (mỗi dòng một đoạn) cho nhóm cũ chỉ có `description`. */
export function plainToHtml(text: string | undefined): string {
  if (!text?.trim()) return '';
  return text
    .split(/\r?\n/)
    .map((line) => `<p>${line.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char)}</p>`)
    .join('');
}

/** HTML rỗng về mặt chữ (chỉ thẻ và khoảng trắng) và không có ảnh/bảng. */
export function isHtmlEmpty(html: string): boolean {
  if (/<(img|table|hr|iframe)\b/i.test(html)) return false;
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') === '';
}

export function emptyGroupForm(): GroupFormState {
  return {
    name: '',
    mode: 'manual',
    admins: [],
    members: [],
    sources: [],
    postPermission: 'all',
    permitted: [],
    descriptionHtml: '',
    isPublic: false,
    coverPreset: SOCIAL_GROUP_DEFAULT_COVER_PRESET,
  };
}

export function groupFormFrom(group: SocialGroupDetail): GroupFormState {
  return {
    ...emptyGroupForm(),
    name: group.name,
    mode: group.membershipMode ?? 'manual',
    sources: (group.memberSources ?? []).map((source) => ({
      id: source.sourceId,
      type: source.type,
      name: source.name,
      includeDescendants: source.includeDescendants,
    })),
    postPermission: group.postPermission ?? 'all',
    permitted: group.postPermittedUsers ?? [],
    descriptionHtml: group.descriptionHtml ?? plainToHtml(group.description),
    isPublic: group.privacy === 'public',
    coverPreset: group.coverPreset ?? SOCIAL_GROUP_DEFAULT_COVER_PRESET,
  };
}

/** Lỗi đầu tiên của biểu mẫu, hoặc `undefined` khi hợp lệ. */
export function validateGroupForm(state: GroupFormState, editing: boolean): string | undefined {
  const name = state.name.trim();
  if (!name) return 'Hãy nhập tên nhóm.';
  if (name.length > SOCIAL_GROUP_NAME_MAX) return `Tên nhóm tối đa ${SOCIAL_GROUP_NAME_MAX} ký tự.`;
  if (!editing && state.admins.length + 1 > SOCIAL_GROUP_ADMIN_MAX) {
    return `Nhóm có tối đa ${SOCIAL_GROUP_ADMIN_MAX} quản lý.`;
  }
  if (state.mode === 'org') {
    if (state.sources.length === 0) return 'Hãy chọn ít nhất một phòng ban hoặc vị trí.';
    if (state.sources.length > SOCIAL_GROUP_MEMBER_SOURCES_MAX) {
      return `Chọn tối đa ${SOCIAL_GROUP_MEMBER_SOURCES_MAX} phòng ban, vị trí.`;
    }
  }
  if (state.postPermission === 'selected') {
    if (state.permitted.length === 0) return 'Hãy chọn người được phép đăng bài.';
    if (state.permitted.length > SOCIAL_GROUP_POST_PERMITTED_MAX) {
      return `Chọn tối đa ${SOCIAL_GROUP_POST_PERMITTED_MAX} người được phép đăng bài.`;
    }
  }
  if (state.descriptionHtml.length > SOCIAL_GROUP_DESCRIPTION_HTML_MAX) return 'Mô tả quá dài.';
  return undefined;
}

const toSourceInput = (source: GroupSourceDraft): SocialGroupMemberSourceInput => ({
  type: source.type,
  id: source.id,
  includeDescendants: source.includeDescendants,
});

export function buildCreateGroupRequest(state: GroupFormState): CreateSocialGroupRequest {
  const html = isHtmlEmpty(state.descriptionHtml) ? undefined : state.descriptionHtml;
  return {
    name: state.name.trim(),
    privacy: state.isPublic ? 'public' : 'private',
    descriptionHtml: html,
    coverPreset: state.coverPreset,
    adminUserIds: state.admins.length > 0 ? state.admins.map((user) => user.id) : undefined,
    membership:
      state.mode === 'org'
        ? { mode: 'org', sources: state.sources.map(toSourceInput) }
        : state.members.length > 0
          ? { mode: 'manual', userIds: state.members.map((user) => user.id) }
          : undefined,
    postPermission: state.postPermission,
    postPermittedUserIds: state.postPermission === 'selected' ? state.permitted.map((user) => user.id) : undefined,
  };
}

export function buildUpdateGroupRequest(state: GroupFormState): UpdateSocialGroupRequest {
  return {
    name: state.name.trim(),
    privacy: state.isPublic ? 'public' : 'private',
    descriptionHtml: isHtmlEmpty(state.descriptionHtml) ? null : state.descriptionHtml,
    coverPreset: state.coverPreset,
    postPermission: state.postPermission,
    postPermittedUserIds: state.postPermission === 'selected' ? state.permitted.map((user) => user.id) : undefined,
  };
}

const sourceKey = (type: string, id: string, includeDescendants: boolean) =>
  `${type}:${id}:${includeDescendants ? 1 : 0}`;

/**
 * Danh sách nguồn thành viên cần gửi `PUT /member-sources` sau khi sửa nhóm, hoặc `undefined` nếu không đổi.
 * Chuyển về "theo danh sách người dùng" thì gửi mảng rỗng.
 */
export function memberSourcesChange(
  state: GroupFormState,
  current: readonly SocialGroupMemberSource[] | undefined,
  currentMode: SocialGroupMembershipMode | undefined,
): readonly SocialGroupMemberSourceInput[] | undefined {
  const before = new Set((current ?? []).map((item) => sourceKey(item.type, item.sourceId, item.includeDescendants)));
  if (state.mode === 'manual') return (currentMode ?? 'manual') === 'org' ? [] : undefined;
  const after = state.sources.map((item) => sourceKey(item.type, item.id, item.includeDescendants));
  const same = currentMode === 'org' && after.length === before.size && after.every((key) => before.has(key));
  return same ? undefined : state.sources.map(toSourceInput);
}

/** Thêm một nguồn vào danh sách nếu chưa có (cùng loại và id). */
export function addSource(
  sources: readonly GroupSourceDraft[],
  next: Omit<GroupSourceDraft, 'includeDescendants'>,
): readonly GroupSourceDraft[] {
  if (sources.some((item) => item.type === next.type && item.id === next.id)) return sources;
  return [...sources, { ...next, includeDescendants: true }];
}

/* ----------------------------------------------------------------------------- báo cáo */

export function reportReasonError(reason: string): string | undefined {
  const text = reason.trim();
  if (text.length < SOCIAL_REPORT_REASON_MIN) return `Lý do cần ít nhất ${SOCIAL_REPORT_REASON_MIN} ký tự.`;
  if (text.length > SOCIAL_REPORT_REASON_MAX) return `Lý do tối đa ${SOCIAL_REPORT_REASON_MAX} ký tự.`;
  return undefined;
}
