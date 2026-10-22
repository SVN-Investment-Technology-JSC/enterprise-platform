import {
  SOCIAL_EVENT_TYPES,
  type SocialGroupJoinDecidedPayload,
  type SocialGroupJoinRequestedPayload,
  type SocialGroupMemberAddedPayload,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { SocialActor } from './social-actor.js';
import type { GroupOutboxEvent } from './social-group-store.port.js';

/** Hiển thị khi danh bạ không có người này (đã nghỉ việc hoặc danh bạ tạm lỗi). */
export const UNKNOWN_GROUP_USER_NAME = 'Người dùng không xác định';

export type GroupUserLookup = (userId: string) => SocialUserRef;

/** Tra danh bạ một lần cho cả nhóm id; id lạ trả về người "không xác định" chứ không lỗi. */
export async function lookupGroupUsers(
  directory: OrganizationDirectory,
  tenantId: string,
  userIds: Iterable<string>,
): Promise<GroupUserLookup> {
  const unique = [...new Set([...userIds].map((id) => id.toLowerCase()))];
  const found = unique.length ? await directory.resolve(tenantId, unique) : new Map<string, SocialUserRef>();
  return (userId) => found.get(userId.toLowerCase()) ?? { id: userId, name: UNKNOWN_GROUP_USER_NAME };
}

/** Tên hiển thị của người thao tác theo danh bạ; thiếu thì dùng tên trong phiên đăng nhập. */
export async function actorNameOf(directory: OrganizationDirectory, actor: SocialActor): Promise<string> {
  const found = (await directory.resolve(actor.tenantId, [actor.userId])).get(actor.userId.toLowerCase());
  return found?.name ?? (actor.displayName || UNKNOWN_GROUP_USER_NAME);
}

/* ------------------------------------------------------------------ sự kiện */

export function memberAddedEvent(input: {
  groupId: string;
  groupName: string;
  userId: string;
  addedBy: string;
  addedByName: string;
  via: SocialGroupMemberAddedPayload['via'];
}): GroupOutboxEvent {
  const payload: SocialGroupMemberAddedPayload & { actorUserId: string } = {
    groupId: input.groupId,
    groupName: input.groupName,
    userId: input.userId,
    addedBy: input.addedBy,
    addedByName: input.addedByName,
    via: input.via,
    actorUserId: input.addedBy,
  };
  return {
    type: SOCIAL_EVENT_TYPES.groupMemberAdded,
    aggregateType: 'social-group',
    aggregateId: input.groupId,
    payload: { ...payload },
  };
}

export function joinRequestedEvent(input: {
  groupId: string;
  groupName: string;
  requestId: string;
  requesterId: string;
  requesterName: string;
  adminUserIds: readonly string[];
}): GroupOutboxEvent {
  const payload: SocialGroupJoinRequestedPayload & { actorUserId: string } = {
    groupId: input.groupId,
    groupName: input.groupName,
    requestId: input.requestId,
    requesterId: input.requesterId,
    requesterName: input.requesterName,
    adminUserIds: input.adminUserIds,
    actorUserId: input.requesterId,
  };
  return {
    type: SOCIAL_EVENT_TYPES.groupJoinRequested,
    aggregateType: 'social-group',
    aggregateId: input.groupId,
    payload: { ...payload },
  };
}

export function joinDecidedEvent(input: {
  groupId: string;
  groupName: string;
  requestId: string;
  requesterId: string;
  decision: 'approved' | 'rejected';
  decidedBy: string;
}): GroupOutboxEvent {
  const payload: SocialGroupJoinDecidedPayload & { actorUserId: string } = {
    groupId: input.groupId,
    groupName: input.groupName,
    requestId: input.requestId,
    requesterId: input.requesterId,
    decision: input.decision,
    decidedBy: input.decidedBy,
    actorUserId: input.decidedBy,
  };
  return {
    type: SOCIAL_EVENT_TYPES.groupJoinDecided,
    aggregateType: 'social-group',
    aggregateId: input.groupId,
    payload: { ...payload },
  };
}
