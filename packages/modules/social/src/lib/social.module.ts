import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { ATTACHMENT_STORAGE, type AttachmentStorage } from './application/attachment-storage.port.js';
import { GroupMembershipAdapter } from './application/group-membership.adapter.js';
import { ORGANIZATION_DIRECTORY, type OrganizationDirectory } from './application/organization-directory.port.js';
import { GroupPostingAdapter } from './application/group-posting.adapter.js';
import { GROUP_POSTING, type GroupPostingPort } from './application/ports/group-posting.port.js';
import { REPORT_TARGET_RESOLVER, type ReportTargetResolverPort } from './application/ports/report-target.port.js';
import {
  ORG_STRUCTURE,
  VIEWER_SCOPE,
  type OrgStructurePort,
  type ViewerScopePort,
} from './application/ports/viewer-scope.port.js';
import { GROUP_MEMBERSHIP, type GroupMembershipPort } from './application/ports/group-membership.port.js';
import { PEOPLE_PROFILE, type PeopleProfilePort } from './application/ports/people-profile.port.js';
import { POST_VIEW_ASSEMBLER, type PostViewAssembler } from './application/ports/post-view-assembler.port.js';
import { STORAGE_QUOTA, type StorageQuotaPort } from './application/ports/storage-quota.port.js';
import { POST_VISIBILITY, type PostVisibilityPort } from './application/ports/post-visibility.port.js';
import { SOCIAL_SETTINGS, type SocialSettingsPort } from './application/ports/social-settings.port.js';
import { PostVisibilityService } from './application/post-visibility.service.js';
import { SOCIAL_FEED_STORE, type SocialFeedStore } from './application/social-feed-store.port.js';
import { SocialAttachmentService } from './application/social-attachment.service.js';
import { SocialBookmarkService } from './application/social-bookmark.service.js';
import { SocialCommentService } from './application/social-comment.service.js';
import { SOCIAL_GROUP_V2_STORE, type SocialGroupV2Store } from './application/social-group-v2-store.port.js';
import { SOCIAL_POST_HISTORY_STORE, type SocialPostHistoryStore } from './application/social-post-history-store.port.js';
import {
  SOCIAL_COMMENT_ATTACHMENT_STORE,
  type SocialCommentAttachmentStore,
} from './application/social-comment-attachment-store.port.js';
import {
  SOCIAL_COMMENT_REACTION_STORE,
  type SocialCommentReactionStore,
} from './application/social-comment-reaction-store.port.js';
import { SOCIAL_REPORT_STORE, type SocialReportStore } from './application/social-report-store.port.js';
import { SocialGroupPriorityService } from './application/social-group-priority.service.js';
import { SocialGroupSyncService } from './application/social-group-sync.service.js';
import { SocialGroupTopicService } from './application/social-group-topic.service.js';
import { SocialOrgService } from './application/social-org.service.js';
import { SocialPostHistoryService } from './application/social-post-history.service.js';
import { SocialReportTargetResolver } from './application/social-report-target.resolver.js';
import { SocialReportService } from './application/social-report.service.js';
import { SocialFeedService } from './application/social-feed.service.js';
import { SOCIAL_GROUP_STORE, type SocialGroupStore } from './application/social-group-store.port.js';
import { SocialGroupMemberService } from './application/social-group-member.service.js';
import { SocialGroupService } from './application/social-group.service.js';
import { SocialMeService } from './application/social-me.service.js';
import { SocialModerationService } from './application/social-moderation.service.js';
import { SocialMyPostsService } from './application/social-my-posts.service.js';
import { SocialPollService } from './application/social-poll.service.js';
import { SocialPostAccess } from './application/social-post-access.js';
import { SocialPostViewAssembler } from './application/social-post-view.assembler.js';
import { PublishedEventBuilder } from './application/social-publishing-events.js';
import { SOCIAL_PUBLISHING_STORE, type SocialPublishingStore } from './application/social-publishing-store.port.js';
import { SocialPublishingService } from './application/social-publishing.service.js';
import { ReadAudience } from './application/social-read-audience.js';
import { SocialReactionService } from './application/social-reaction.service.js';
import { SocialReadConfirmationService } from './application/social-read-confirmation.service.js';
import { SocialSchedulerService } from './application/social-scheduler.service.js';
import { SocialSettingsService } from './application/social-settings.service.js';
import { SOCIAL_STORE, type SocialStore } from './application/social-store.port.js';
import { SocialTopicService } from './application/social-topic.service.js';
import { HttpOrganizationDirectory } from './infrastructure/http-organization-directory.js';
import { HttpOrgStructure } from './infrastructure/http-org-structure.js';
import { PostgresSocialGroupV2Store } from './infrastructure/postgres-social-group-v2.store.js';
import { PostgresSocialPostHistoryStore } from './infrastructure/postgres-social-post-history.store.js';
import { PostgresSocialCommentAttachmentStore } from './infrastructure/postgres-social-comment-attachment.store.js';
import { PostgresSocialVideoStore } from './infrastructure/postgres-social-video.store.js';
import { SOCIAL_VIDEO_STORE, type SocialVideoStore } from './application/social-video-store.port.js';
import { PostgresSocialCommentReactionStore } from './infrastructure/postgres-social-comment-reaction.store.js';
import { PostgresSocialReportStore } from './infrastructure/postgres-social-report.store.js';
import { PostgresSocialFeedStore } from './infrastructure/postgres-social-feed.store.js';
import { PostgresSocialGroupStore } from './infrastructure/postgres-social-group.store.js';
import { PostgresSocialPublishingStore } from './infrastructure/postgres-social-publishing.store.js';
import { PostgresSocialSettingsStore } from './infrastructure/postgres-social-settings.store.js';
import { PostgresSocialStore } from './infrastructure/postgres-social-store.js';
import { HttpStorageQuota } from './infrastructure/http-storage-quota.js';
import { createS3AttachmentStorage } from './infrastructure/s3-attachment-storage.js';
import { SocialFeedController } from './presentation/social-feed.controller.js';
import { SocialGroupTopicsController } from './presentation/social-group-topics.controller.js';
import { SocialOrgController } from './presentation/social-org.controller.js';
import { SocialPostHistoryController } from './presentation/social-post-history.controller.js';
import { SocialReportsController } from './presentation/social-reports.controller.js';
import { SocialGroupsController } from './presentation/social-groups.controller.js';
import { SocialPublishingController } from './presentation/social-publishing.controller.js';
import { SocialController } from './presentation/social.controller.js';
import { SOCIAL_DISCOVERY_CONTROLLERS, SOCIAL_DISCOVERY_PROVIDERS } from './social-discovery.providers.js';

/**
 * Composition root của Mạng nội bộ.
 *
 * Dựng tường minh bằng `useFactory` như `SharedModule`: các lớp là lớp thường,
 * không gắn `@Injectable`. Export hai registry để guard của app đăng ký
 * database của tenant sau mỗi access-decision, `SocialAttachmentService` để
 * worker gọi `cleanupOrphans`, và `SocialSchedulerService` cho tác vụ hẹn giờ.
 *
 * Đồ thị phụ thuộc (không vòng): các store và `ORGANIZATION_DIRECTORY` -> `GROUP_MEMBERSHIP` ->
 * `POST_VISIBILITY`; `PEOPLE_PROFILE` + `GROUP_MEMBERSHIP` -> `SocialPostAccess`, `ReadAudience` ->
 * `POST_VIEW_ASSEMBLER` -> các service -> controller.
 */
@Module({
  controllers: [
    SocialController,
    SocialPublishingController,
    SocialGroupsController,
    SocialFeedController,
    SocialGroupTopicsController,
    SocialReportsController,
    SocialPostHistoryController,
    SocialOrgController,
    ...SOCIAL_DISCOVERY_CONTROLLERS,
  ],
  providers: [
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
    {
      provide: PostgresSocialStore,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresSocialStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    { provide: SOCIAL_STORE, useExisting: PostgresSocialStore },
    {
      provide: PostgresSocialPublishingStore,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresSocialPublishingStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    { provide: SOCIAL_PUBLISHING_STORE, useExisting: PostgresSocialPublishingStore },
    {
      provide: SOCIAL_SETTINGS,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresSocialSettingsStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: SOCIAL_GROUP_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresSocialGroupStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: SOCIAL_FEED_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresSocialFeedStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      // Một thực thể cho cả app: bản sao 60 giây của danh bạ nằm trong nó.
      provide: ORGANIZATION_DIRECTORY,
      useFactory: () => new HttpOrganizationDirectory(),
    },
    {
      // Một thực thể cho cả app: bản sao 60 giây của cơ cấu tổ chức nằm trong nó.
      provide: HttpOrgStructure,
      useFactory: () => new HttpOrgStructure(),
    },
    { provide: VIEWER_SCOPE, useExisting: HttpOrgStructure },
    { provide: ORG_STRUCTURE, useExisting: HttpOrgStructure },
    {
      provide: SOCIAL_GROUP_V2_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresSocialGroupV2Store(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: SOCIAL_COMMENT_ATTACHMENT_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresSocialCommentAttachmentStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: SOCIAL_VIDEO_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresSocialVideoStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: SOCIAL_COMMENT_REACTION_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresSocialCommentReactionStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: SOCIAL_REPORT_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresSocialReportStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: SOCIAL_POST_HISTORY_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresSocialPostHistoryStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: GROUP_POSTING,
      useFactory: (v2: SocialGroupV2Store) => new GroupPostingAdapter(v2),
      inject: [SOCIAL_GROUP_V2_STORE],
    },
    { provide: ATTACHMENT_STORAGE, useFactory: () => createS3AttachmentStorage() },
    { provide: STORAGE_QUOTA, useFactory: (): StorageQuotaPort => new HttpStorageQuota() },
    {
      provide: GROUP_MEMBERSHIP,
      useFactory: (store: SocialGroupStore) => new GroupMembershipAdapter(store),
      inject: [SOCIAL_GROUP_STORE],
    },
    {
      provide: POST_VISIBILITY,
      useFactory: (membership: GroupMembershipPort, viewerScopes: ViewerScopePort) =>
        new PostVisibilityService(membership, viewerScopes),
      inject: [GROUP_MEMBERSHIP, VIEWER_SCOPE],
    },
    // PEOPLE_PROFILE, SOCIAL_SEARCH_STORE và các service hồ sơ, tìm kiếm, sinh nhật nằm trong đây.
    ...SOCIAL_DISCOVERY_PROVIDERS,
    {
      provide: SocialPostAccess,
      useFactory: (store: SocialPublishingStore, visibility: PostVisibilityPort, groups: GroupMembershipPort) =>
        new SocialPostAccess(store, visibility, groups),
      inject: [SOCIAL_PUBLISHING_STORE, POST_VISIBILITY, GROUP_MEMBERSHIP],
    },
    {
      provide: ReadAudience,
      useFactory: (people: PeopleProfilePort, groups: GroupMembershipPort) => new ReadAudience(people, groups),
      inject: [PEOPLE_PROFILE, GROUP_MEMBERSHIP],
    },
    {
      provide: PublishedEventBuilder,
      useFactory: (directory: OrganizationDirectory, groups: GroupMembershipPort, store: SocialPublishingStore) =>
        new PublishedEventBuilder(directory, groups, store),
      inject: [ORGANIZATION_DIRECTORY, GROUP_MEMBERSHIP, SOCIAL_PUBLISHING_STORE],
    },
    {
      provide: POST_VIEW_ASSEMBLER,
      useFactory: (
        store: SocialStore,
        publishing: SocialPublishingStore,
        directory: OrganizationDirectory,
        storage: AttachmentStorage,
        groups: GroupMembershipPort,
        people: PeopleProfilePort,
        topics: GroupPostingPort,
        orgs: OrgStructurePort,
      ): PostViewAssembler =>
        new SocialPostViewAssembler({ store, publishing, directory, storage, groups, people, topics, orgs }),
      inject: [
        SOCIAL_STORE,
        SOCIAL_PUBLISHING_STORE,
        ORGANIZATION_DIRECTORY,
        ATTACHMENT_STORAGE,
        GROUP_MEMBERSHIP,
        PEOPLE_PROFILE,
        GROUP_POSTING,
        ORG_STRUCTURE,
      ],
    },
    {
      provide: SocialPublishingService,
      useFactory: (
        store: SocialPublishingStore,
        social: SocialStore,
        directory: OrganizationDirectory,
        groups: GroupMembershipPort,
        settings: SocialSettingsPort,
        access: SocialPostAccess,
        assembler: PostViewAssembler,
        events: PublishedEventBuilder,
        posting: GroupPostingPort,
        viewerScopes: ViewerScopePort,
        orgs: OrgStructurePort,
        storage: AttachmentStorage,
      ) =>
        new SocialPublishingService({
          store,
          social,
          attachments: social.attachments,
          storage,
          directory,
          groups,
          settings,
          access,
          assembler,
          events,
          posting,
          viewerScopes,
          orgs,
        }),
      inject: [
        SOCIAL_PUBLISHING_STORE,
        SOCIAL_STORE,
        ORGANIZATION_DIRECTORY,
        GROUP_MEMBERSHIP,
        SOCIAL_SETTINGS,
        SocialPostAccess,
        POST_VIEW_ASSEMBLER,
        PublishedEventBuilder,
        GROUP_POSTING,
        VIEWER_SCOPE,
        ORG_STRUCTURE,
        ATTACHMENT_STORAGE,
      ],
    },
    {
      provide: SocialModerationService,
      useFactory: (
        store: SocialPublishingStore,
        access: SocialPostAccess,
        visibility: PostVisibilityPort,
        assembler: PostViewAssembler,
        events: PublishedEventBuilder,
      ) => new SocialModerationService({ store, access, visibility, assembler, events }),
      inject: [SOCIAL_PUBLISHING_STORE, SocialPostAccess, POST_VISIBILITY, POST_VIEW_ASSEMBLER, PublishedEventBuilder],
    },
    {
      provide: SocialSchedulerService,
      useFactory: (
        store: SocialPublishingStore,
        groups: GroupMembershipPort,
        settings: SocialSettingsPort,
        events: PublishedEventBuilder,
      ) => new SocialSchedulerService({ store, groups, settings, events }),
      inject: [SOCIAL_PUBLISHING_STORE, GROUP_MEMBERSHIP, SOCIAL_SETTINGS, PublishedEventBuilder],
    },
    {
      provide: SocialPollService,
      useFactory: (
        store: SocialPublishingStore,
        access: SocialPostAccess,
        assembler: PostViewAssembler,
        directory: OrganizationDirectory,
      ) => new SocialPollService({ store, access, assembler, directory }),
      inject: [SOCIAL_PUBLISHING_STORE, SocialPostAccess, POST_VIEW_ASSEMBLER, ORGANIZATION_DIRECTORY],
    },
    {
      provide: SocialReadConfirmationService,
      useFactory: (
        store: SocialPublishingStore,
        access: SocialPostAccess,
        assembler: PostViewAssembler,
        directory: OrganizationDirectory,
        audience: ReadAudience,
      ) => new SocialReadConfirmationService({ store, access, assembler, directory, audience }),
      inject: [SOCIAL_PUBLISHING_STORE, SocialPostAccess, POST_VIEW_ASSEMBLER, ORGANIZATION_DIRECTORY, ReadAudience],
    },
    {
      provide: SocialBookmarkService,
      useFactory: (
        store: SocialPublishingStore,
        access: SocialPostAccess,
        visibility: PostVisibilityPort,
        assembler: PostViewAssembler,
      ) => new SocialBookmarkService({ store, access, visibility, assembler }),
      inject: [SOCIAL_PUBLISHING_STORE, SocialPostAccess, POST_VISIBILITY, POST_VIEW_ASSEMBLER],
    },
    {
      provide: SocialMyPostsService,
      useFactory: (store: SocialPublishingStore, visibility: PostVisibilityPort, assembler: PostViewAssembler) =>
        new SocialMyPostsService({ store, visibility, assembler }),
      inject: [SOCIAL_PUBLISHING_STORE, POST_VISIBILITY, POST_VIEW_ASSEMBLER],
    },
    {
      provide: SocialSettingsService,
      useFactory: (settings: SocialSettingsPort) => new SocialSettingsService(settings),
      inject: [SOCIAL_SETTINGS],
    },
    {
      provide: SocialGroupService,
      useFactory: (
        store: SocialGroupStore,
        directory: OrganizationDirectory,
        org: OrgStructurePort,
        v2: SocialGroupV2Store,
      ) => new SocialGroupService(store, directory, org, v2),
      inject: [SOCIAL_GROUP_STORE, ORGANIZATION_DIRECTORY, ORG_STRUCTURE, SOCIAL_GROUP_V2_STORE],
    },
    {
      provide: SocialGroupTopicService,
      useFactory: (v2: SocialGroupV2Store, groups: SocialGroupService) => new SocialGroupTopicService(v2, groups),
      inject: [SOCIAL_GROUP_V2_STORE, SocialGroupService],
    },
    {
      provide: SocialGroupPriorityService,
      useFactory: (v2: SocialGroupV2Store, groups: SocialGroupService) => new SocialGroupPriorityService(v2, groups),
      inject: [SOCIAL_GROUP_V2_STORE, SocialGroupService],
    },
    {
      provide: SocialGroupSyncService,
      useFactory: (
        v2: SocialGroupV2Store,
        directory: OrganizationDirectory,
        org: OrgStructurePort,
        groups: SocialGroupService,
      ) => new SocialGroupSyncService(v2, directory, org, groups),
      inject: [SOCIAL_GROUP_V2_STORE, ORGANIZATION_DIRECTORY, ORG_STRUCTURE, SocialGroupService],
    },
    {
      provide: REPORT_TARGET_RESOLVER,
      useFactory: (store: SocialStore, access: SocialPostAccess, directory: OrganizationDirectory) =>
        new SocialReportTargetResolver({ store, access, directory }),
      inject: [SOCIAL_STORE, SocialPostAccess, ORGANIZATION_DIRECTORY],
    },
    {
      provide: SocialReportService,
      useFactory: (
        reports: SocialReportStore,
        groupStore: SocialGroupStore,
        directory: OrganizationDirectory,
        resolver: ReportTargetResolverPort,
        groups: SocialGroupService,
      ) => new SocialReportService(reports, groupStore, directory, resolver, groups),
      inject: [
        SOCIAL_REPORT_STORE,
        SOCIAL_GROUP_STORE,
        ORGANIZATION_DIRECTORY,
        REPORT_TARGET_RESOLVER,
        SocialGroupService,
      ],
    },
    {
      provide: SocialPostHistoryService,
      useFactory: (store: SocialPostHistoryStore, access: SocialPostAccess, directory: OrganizationDirectory) =>
        new SocialPostHistoryService({ store, access, directory }),
      inject: [SOCIAL_POST_HISTORY_STORE, SocialPostAccess, ORGANIZATION_DIRECTORY],
    },
    {
      provide: SocialOrgService,
      useFactory: (org: OrgStructurePort) => new SocialOrgService(org),
      inject: [ORG_STRUCTURE],
    },
    {
      provide: SocialGroupMemberService,
      useFactory: (store: SocialGroupStore, directory: OrganizationDirectory, groups: SocialGroupService) =>
        new SocialGroupMemberService(store, directory, groups),
      inject: [SOCIAL_GROUP_STORE, ORGANIZATION_DIRECTORY, SocialGroupService],
    },
    {
      provide: SocialFeedService,
      useFactory: (
        store: SocialFeedStore,
        visibility: PostVisibilityPort,
        membership: GroupMembershipPort,
        assembler: PostViewAssembler,
        posting: GroupPostingPort,
      ) => new SocialFeedService(store, visibility, membership, assembler, posting),
      inject: [SOCIAL_FEED_STORE, POST_VISIBILITY, GROUP_MEMBERSHIP, POST_VIEW_ASSEMBLER, GROUP_POSTING],
    },
    {
      provide: SocialReactionService,
      useFactory: (
        store: SocialStore,
        directory: OrganizationDirectory,
        access: SocialPostAccess,
        publishing: SocialPublishingStore,
      ) => new SocialReactionService(store, directory, { access, store: publishing }),
      inject: [SOCIAL_STORE, ORGANIZATION_DIRECTORY, SocialPostAccess, SOCIAL_PUBLISHING_STORE],
    },
    {
      provide: SocialCommentService,
      useFactory: (
        store: SocialStore,
        directory: OrganizationDirectory,
        access: SocialPostAccess,
        viewerScopes: ViewerScopePort,
        reactions: SocialCommentReactionStore,
        commentAttachments: SocialCommentAttachmentStore,
        storage: AttachmentStorage,
      ) => new SocialCommentService(store, directory, access, viewerScopes, reactions, commentAttachments, storage),
      inject: [
        SOCIAL_STORE,
        ORGANIZATION_DIRECTORY,
        SocialPostAccess,
        VIEWER_SCOPE,
        SOCIAL_COMMENT_REACTION_STORE,
        SOCIAL_COMMENT_ATTACHMENT_STORE,
        ATTACHMENT_STORAGE,
      ],
    },
    {
      provide: SocialTopicService,
      useFactory: (store: SocialStore) => new SocialTopicService(store),
      inject: [SOCIAL_STORE],
    },
    {
      provide: SocialAttachmentService,
      useFactory: (
        store: SocialStore,
        storage: AttachmentStorage,
        quota: StorageQuotaPort,
        videoStore: SocialVideoStore,
      ) => new SocialAttachmentService(store, storage, undefined, quota, undefined, videoStore),
      inject: [SOCIAL_STORE, ATTACHMENT_STORAGE, STORAGE_QUOTA, SOCIAL_VIDEO_STORE],
    },
    {
      provide: SocialMeService,
      useFactory: (directory: OrganizationDirectory) => new SocialMeService(directory),
      inject: [ORGANIZATION_DIRECTORY],
    },
  ],
  exports: [SocialAttachmentService, SocialSchedulerService, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class SocialModule {}
