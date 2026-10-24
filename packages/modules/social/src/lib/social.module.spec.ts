import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Test } from '@nestjs/testing';
import { ATTACHMENT_STORAGE } from './application/attachment-storage.port.js';
import { ORGANIZATION_DIRECTORY } from './application/organization-directory.port.js';
import { PEOPLE_PROFILE } from './application/ports/people-profile.port.js';
import { SocialPublishingService } from './application/social-publishing.service.js';
import { SocialSchedulerService } from './application/social-scheduler.service.js';
import { SocialFeedController } from './presentation/social-feed.controller.js';
import { SocialGroupsController } from './presentation/social-groups.controller.js';
import { SocialPublishingController } from './presentation/social-publishing.controller.js';
import { SocialDiscoveryController } from './presentation/social-discovery.controller.js';
import { SocialController } from './presentation/social.controller.js';
import { SocialGroupTopicsController } from './presentation/social-group-topics.controller.js';
import { SocialOrgController } from './presentation/social-org.controller.js';
import { SocialPostHistoryController } from './presentation/social-post-history.controller.js';
import { SocialReportsController } from './presentation/social-reports.controller.js';
import { SocialModule } from './social.module.js';

describe('SocialModule (đồ thị DI)', () => {
  it('dựng được mọi provider và controller, không vòng phụ thuộc', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SocialModule] })
      .overrideProvider(ORGANIZATION_DIRECTORY)
      .useValue({})
      .overrideProvider(ATTACHMENT_STORAGE)
      .useValue({})
      .overrideProvider(PEOPLE_PROFILE)
      .useValue({})
      .compile();

    for (const controller of [
      SocialController,
      SocialPublishingController,
      SocialGroupsController,
      SocialFeedController,
      SocialDiscoveryController,
      SocialGroupTopicsController,
      SocialReportsController,
      SocialPostHistoryController,
      SocialOrgController,
    ]) {
      expect(moduleRef.get(controller)).toBeInstanceOf(controller);
    }
    expect(moduleRef.get(SocialPublishingService)).toBeInstanceOf(SocialPublishingService);
    expect(moduleRef.get(SocialSchedulerService)).toBeInstanceOf(SocialSchedulerService);
    expect(moduleRef.get(TenantDatabaseRegistry)).toBeInstanceOf(TenantDatabaseRegistry);
    expect(moduleRef.get(PostgresPoolRegistry)).toBeInstanceOf(PostgresPoolRegistry);
    await moduleRef.close();
  });
});
