import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { GroupMembershipAdapter } from './application/group-membership.adapter.js';
import { SocialAttachmentService } from './application/social-attachment.service.js';
import { PublishedEventBuilder } from './application/social-publishing-events.js';
import { SocialSchedulerService, type SocialSchedulerResult } from './application/social-scheduler.service.js';
import { HttpOrganizationDirectory } from './infrastructure/http-organization-directory.js';
import { PostgresSocialGroupStore } from './infrastructure/postgres-social-group.store.js';
import { PostgresSocialPublishingStore } from './infrastructure/postgres-social-publishing.store.js';
import { PostgresSocialSettingsStore } from './infrastructure/postgres-social-settings.store.js';
import { PostgresSocialStore } from './infrastructure/postgres-social-store.js';
import { PostgresSocialVideoStore } from './infrastructure/postgres-social-video.store.js';
import { createS3AttachmentStorage } from './infrastructure/s3-attachment-storage.js';

/** Việc định kỳ của Mạng nội bộ cho worker, dựng ngoài Nest (worker không dùng `SocialModule`). */
export interface SocialJobs {
  /** Migration hẹn giờ (0003) đã áp ở tenant này chưa. */
  ready(tenantId: string): Promise<boolean>;
  /** Đăng các bài `scheduled` đã đến hạn. An toàn khi nhiều worker chạy song song. */
  publishDueScheduled(tenantId: string): Promise<SocialSchedulerResult>;
  /** Dọn tệp đính kèm mồ côi (quá 24 giờ chưa gắn bài); trả số tệp đã dọn. */
  cleanupOrphans(tenantId: string): Promise<number>;
  /** Báo lỗi video chờ quá lâu mà chưa từng được nhận và xếp lại hàng video bị kẹt; trả số liệu từng việc. */
  sweepVideos(tenantId: string): Promise<{ requeued: number; failed: number }>;
}

export function createSocialJobs(references: TenantDatabaseRegistry, pools: PostgresPoolRegistry): SocialJobs {
  const publishing = new PostgresSocialPublishingStore(references, pools);
  const settings = new PostgresSocialSettingsStore(references, pools);
  const groups = new GroupMembershipAdapter(new PostgresSocialGroupStore(references, pools));
  const events = new PublishedEventBuilder(new HttpOrganizationDirectory(), groups, publishing);
  const scheduler = new SocialSchedulerService({ store: publishing, groups, settings, events });
  const attachments = new SocialAttachmentService(
    new PostgresSocialStore(references, pools),
    createS3AttachmentStorage(),
    undefined,
    undefined,
    undefined,
    new PostgresSocialVideoStore(references, pools),
  );
  return {
    ready: async (tenantId) => {
      const pool = await pools.forTenant(references.require(tenantId));
      const result = await pool.query<{ ready: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'social_schema' AND table_name = 'posts' AND column_name = 'scheduled_at'
         ) AS ready`,
      );
      return result.rows[0]?.ready === true;
    },
    publishDueScheduled: (tenantId) => scheduler.publishDueScheduled(tenantId),
    cleanupOrphans: (tenantId) => attachments.cleanupOrphans(tenantId),
    sweepVideos: (tenantId) => attachments.sweepVideos(tenantId),
  };
}
