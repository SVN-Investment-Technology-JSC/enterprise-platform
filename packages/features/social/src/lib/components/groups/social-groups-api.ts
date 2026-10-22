import type {
  AddSocialGroupMembersRequest,
  AddSocialGroupMembersResponse,
  CreateSocialReportRequest,
  ResolveSocialReportRequest,
  SetSocialGroupMemberSourcesRequest,
  SocialGroupPriorityState,
  SocialGroupSuggestions,
  SocialGroupTopic,
  SocialGroupTopicList,
  SocialOrgNodePage,
  SocialOrgNodeQuery,
  SocialReport,
  SocialReportListQuery,
  SocialReportPage,
  SyncSocialGroupMembersRequest,
  SyncSocialGroupMembersResponse,
  UpdateSocialGroupTopicRequest,
  CreateSocialGroupRequest,
  JoinSocialGroupRequest,
  JoinSocialGroupResponse,
  SocialGroupDetail,
  SocialGroupListQuery,
  SocialGroupMember,
  SocialGroupMemberPage,
  SocialGroupMemberQuery,
  SocialGroupPage,
  SocialGroupRole,
  SocialJoinRequestPage,
  UpdateSocialGroupRequest,
} from '@enterprise-platform/contracts-social';
import { json, request } from '../../social-api';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const enc = encodeURIComponent;

export const listGroups = (query: SocialGroupListQuery) =>
  request<SocialGroupPage>(`/groups${qs({ ...query })}`, { cache: 'no-store' });

export const loadGroup = (id: string) => request<SocialGroupDetail>(`/groups/${enc(id)}`, { cache: 'no-store' });

export const createGroup = (body: CreateSocialGroupRequest) =>
  request<SocialGroupDetail>('/groups', json('POST', body));

export const updateGroup = (id: string, body: UpdateSocialGroupRequest) =>
  request<SocialGroupDetail>(`/groups/${enc(id)}`, json('PATCH', body));

export const deleteGroup = (id: string) => request<void>(`/groups/${enc(id)}`, json('DELETE'));

export const joinGroup = (id: string, body: JoinSocialGroupRequest = {}) =>
  request<JoinSocialGroupResponse>(`/groups/${enc(id)}/join`, json('POST', body));

export const leaveGroup = (id: string) => request<void>(`/groups/${enc(id)}/leave`, json('POST'));

export const cancelJoinRequest = (id: string) => request<void>(`/groups/${enc(id)}/join-request`, json('DELETE'));

export const listGroupMembers = (id: string, query: SocialGroupMemberQuery = {}) =>
  request<SocialGroupMemberPage>(`/groups/${enc(id)}/members${qs({ ...query })}`, { cache: 'no-store' });

export const addGroupMembers = (id: string, body: AddSocialGroupMembersRequest) =>
  request<AddSocialGroupMembersResponse>(`/groups/${enc(id)}/members`, json('POST', body));

export const setGroupMemberRole = (id: string, userId: string, role: SocialGroupRole) =>
  request<SocialGroupMember>(`/groups/${enc(id)}/members/${enc(userId)}`, json('PATCH', { role }));

export const removeGroupMember = (id: string, userId: string) =>
  request<void>(`/groups/${enc(id)}/members/${enc(userId)}`, json('DELETE'));

export const listJoinRequests = (id: string, cursor?: string) =>
  request<SocialJoinRequestPage>(`/groups/${enc(id)}/join-requests${qs({ cursor })}`, { cache: 'no-store' });

export const approveJoinRequest = (id: string, requestId: string) =>
  request<SocialGroupMember>(`/groups/${enc(id)}/join-requests/${enc(requestId)}/approve`, json('POST'));

export const rejectJoinRequest = (id: string, requestId: string) =>
  request<void>(`/groups/${enc(id)}/join-requests/${enc(requestId)}/reject`, json('POST'));

/* ------------------------------------------------------------ đợt 2 */

export const loadGroupSuggestions = (limit = 5) =>
  request<SocialGroupSuggestions>(`/groups/suggestions${qs({ limit })}`, { cache: 'no-store' });

export const setGroupPriority = (id: string, pinned: boolean) =>
  request<SocialGroupPriorityState>(`/groups/${enc(id)}/priority`, json('PUT', { pinned }));

export const listGroupTopics = (id: string) =>
  request<SocialGroupTopicList>(`/groups/${enc(id)}/topics`, { cache: 'no-store' });

export const createGroupTopic = (id: string, name: string) =>
  request<SocialGroupTopic>(`/groups/${enc(id)}/topics`, json('POST', { name }));

export const updateGroupTopic = (id: string, topicId: string, body: UpdateSocialGroupTopicRequest) =>
  request<SocialGroupTopic>(`/groups/${enc(id)}/topics/${enc(topicId)}`, json('PATCH', body));

export const deleteGroupTopic = (id: string, topicId: string) =>
  request<void>(`/groups/${enc(id)}/topics/${enc(topicId)}`, json('DELETE'));

export const setGroupMemberSources = (id: string, body: SetSocialGroupMemberSourcesRequest) =>
  request<SocialGroupDetail>(`/groups/${enc(id)}/member-sources`, json('PUT', body));

export const syncGroupMembers = (id: string, body: SyncSocialGroupMembersRequest = {}) =>
  request<SyncSocialGroupMembersResponse>(`/groups/${enc(id)}/sync-members`, json('POST', body));

export const searchOrgNodes = (query: SocialOrgNodeQuery) =>
  request<SocialOrgNodePage>(`/org/nodes${qs({ ...query })}`, { cache: 'no-store' });

export const createReport = (body: CreateSocialReportRequest) =>
  request<SocialReport>('/reports', json('POST', body));

export const listGroupReports = (id: string, query: SocialReportListQuery = {}) =>
  request<SocialReportPage>(`/groups/${enc(id)}/reports${qs({ ...query })}`, { cache: 'no-store' });

export const resolveGroupReport = (id: string, reportId: string, body: ResolveSocialReportRequest) =>
  request<SocialReport>(`/groups/${enc(id)}/reports/${enc(reportId)}/resolve`, json('POST', body));
