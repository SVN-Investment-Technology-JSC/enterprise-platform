import type {
  SocialBirthdaysUpcoming,
  SocialBirthdaysUpcomingQuery,
  SocialFeedPage,
  SocialGroupPage,
  SocialPersonProfile,
  SocialSearchOverview,
  SocialSearchPeopleResponse,
  SocialSearchPostsQuery,
} from '@enterprise-platform/contracts-social';
import { request } from './social-api';
import { toQueryString } from './discovery.model';

const NO_STORE = { cache: 'no-store' } as const;

export const loadProfile = (userId: string) =>
  request<SocialPersonProfile>(`/people/${encodeURIComponent(userId)}/profile`, NO_STORE);

export const searchOverview = (q: string) =>
  request<SocialSearchOverview>(`/search${toQueryString({ q })}`, NO_STORE);

export const searchPosts = (query: SocialSearchPostsQuery) =>
  request<SocialFeedPage>(`/search/posts${toQueryString({ ...query })}`, NO_STORE);

export const searchPeople = (q: string, limit = 30) =>
  request<SocialSearchPeopleResponse>(`/search/people${toQueryString({ q, limit })}`, NO_STORE);

export const searchGroups = (q: string, cursor?: string) =>
  request<SocialGroupPage>(`/search/groups${toQueryString({ q, cursor })}`, NO_STORE);

/** Nhóm tôi tham gia, để làm lựa chọn lọc theo nhóm. */
export const loadMyGroupOptions = async () =>
  (await request<SocialGroupPage>(`/groups${toQueryString({ scope: 'mine', limit: 50 })}`, NO_STORE)).items;

/** Sinh nhật sắp tới nhóm theo tháng (trang `/birthday` và widget). */
export const loadBirthdaysUpcoming = (query: SocialBirthdaysUpcomingQuery = {}) =>
  request<SocialBirthdaysUpcoming>(`/birthdays/upcoming${toQueryString({ months: query.months, q: query.q })}`, NO_STORE);

