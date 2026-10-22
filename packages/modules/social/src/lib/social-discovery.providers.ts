import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { Provider } from '@nestjs/common';
import { ORGANIZATION_DIRECTORY, type OrganizationDirectory } from './application/organization-directory.port.js';
import { PEOPLE_PROFILE, type PeopleProfilePort } from './application/ports/people-profile.port.js';
import { GROUP_MEMBERSHIP, type GroupMembershipPort } from './application/ports/group-membership.port.js';
import { POST_VIEW_ASSEMBLER, type PostViewAssembler } from './application/ports/post-view-assembler.port.js';
import { POST_VISIBILITY, type PostVisibilityPort } from './application/ports/post-visibility.port.js';
import { SOCIAL_SEARCH_STORE, type SocialSearchStore } from './application/social-search-store.port.js';
import { SocialBirthdayService } from './application/social-birthday.service.js';
import { SocialProfileService } from './application/social-profile.service.js';
import { SocialRealtimeAccessService } from './application/social-realtime-access.service.js';
import { SocialSearchService } from './application/social-search.service.js';
import { HttpPeopleProfile } from './infrastructure/http-people-profile.js';
import { PostgresSocialSearchStore } from './infrastructure/postgres-social-search.store.js';
import { SocialDiscoveryController } from './presentation/social-discovery.controller.js';

/**
 * Nhà cung cấp của mảng hồ sơ / tìm kiếm / sinh nhật cho `SocialModule` (người điều phối nối vào
 * `providers`, thêm `SocialDiscoveryController` vào `controllers`).
 *
 * Cần sẵn trong module (do BE-1/BE-2 và module cung cấp): `TenantDatabaseRegistry`, `PostgresPoolRegistry`,
 * `ORGANIZATION_DIRECTORY`, `POST_VISIBILITY`, `POST_VIEW_ASSEMBLER`, `GROUP_MEMBERSHIP`.
 */
export const SOCIAL_DISCOVERY_CONTROLLERS = [SocialDiscoveryController];

export const SOCIAL_DISCOVERY_PROVIDERS: Provider[] = [
  {
    // Một thực thể cho cả app: bản sao ngắn hạn của danh bạ và dữ kiện HRM nằm trong nó.
    provide: PEOPLE_PROFILE,
    useFactory: () => new HttpPeopleProfile(),
  },
  {
    provide: SOCIAL_SEARCH_STORE,
    useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
      new PostgresSocialSearchStore(references, pools),
    inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
  },
  {
    provide: SocialProfileService,
    useFactory: (people: PeopleProfilePort, visibility: PostVisibilityPort, store: SocialSearchStore) =>
      new SocialProfileService(people, visibility, store),
    inject: [PEOPLE_PROFILE, POST_VISIBILITY, SOCIAL_SEARCH_STORE],
  },
  {
    provide: SocialBirthdayService,
    useFactory: (people: PeopleProfilePort) => new SocialBirthdayService(people),
    inject: [PEOPLE_PROFILE],
  },
  {
    provide: SocialSearchService,
    useFactory: (
      store: SocialSearchStore,
      visibility: PostVisibilityPort,
      assembler: PostViewAssembler,
      directory: OrganizationDirectory,
    ) => new SocialSearchService(store, visibility, assembler, directory),
    inject: [SOCIAL_SEARCH_STORE, POST_VISIBILITY, POST_VIEW_ASSEMBLER, ORGANIZATION_DIRECTORY],
  },
  {
    provide: SocialRealtimeAccessService,
    useFactory: (groups: GroupMembershipPort) => new SocialRealtimeAccessService(groups),
    inject: [GROUP_MEMBERSHIP],
  },
];
