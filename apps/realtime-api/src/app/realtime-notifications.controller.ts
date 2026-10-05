import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type {
  NotificationModule,
  NotificationPreference,
  NotificationPriority,
} from '@enterprise-platform/contracts-realtime';
import {
  NotificationInputError,
  NotificationNotFoundError,
} from '@enterprise-platform/module-notifications';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { REALTIME_REQUEST_CONTEXTS } from './realtime-tokens';
import { RealtimeMetrics } from './realtime-health';
import { RealtimeMutationPolicy } from './realtime-operational';

const MODULES = new Set<NotificationModule>([
  'identity',
  'procedure',
  'workspace',
  'hrm',
  'inventory',
  'maintenance',
]);
const PRIORITIES = new Set<NotificationPriority>([
  'required',
  'actionable',
  'informational',
]);

export interface RealtimeNotificationStore {
  list(
    userId: string,
    options?: {
      readonly cursor?: string;
      readonly limit?: number;
      readonly unread?: boolean;
      readonly module?: NotificationModule;
    },
  ): ReturnType<
    import('@enterprise-platform/module-notifications').PostgresNotificationStore['list']
  >;
  sync(
    userId: string,
    afterSequence: number,
  ): ReturnType<
    import('@enterprise-platform/module-notifications').PostgresNotificationStore['sync']
  >;
  summary(
    userId: string,
  ): ReturnType<
    import('@enterprise-platform/module-notifications').PostgresNotificationStore['summary']
  >;
  setRead(
    tenantId: string,
    userId: string,
    notificationId: string,
    read: boolean,
  ): ReturnType<
    import('@enterprise-platform/module-notifications').PostgresNotificationStore['setRead']
  >;
  readAll(
    tenantId: string,
    userId: string,
  ): ReturnType<
    import('@enterprise-platform/module-notifications').PostgresNotificationStore['readAll']
  >;
  preferences(
    userId: string,
  ): ReturnType<
    import('@enterprise-platform/module-notifications').PostgresNotificationStore['preferences']
  >;
  setPreferences(
    userId: string,
    preferences: readonly NotificationPreference[],
  ): ReturnType<
    import('@enterprise-platform/module-notifications').PostgresNotificationStore['setPreferences']
  >;
}

export interface RealtimeRequestContext {
  readonly principal: TenantUserPrincipal;
  readonly store: RealtimeNotificationStore;
}

export interface RealtimeRequestContextResolver {
  resolve(request: Request): Promise<RealtimeRequestContext>;
  requireCsrf(request: Request): void;
}

@Controller('realtime/v1')
export class RealtimeNotificationsController {
  constructor(
    @Inject(REALTIME_REQUEST_CONTEXTS)
    private readonly contexts: RealtimeRequestContextResolver,
    private readonly metrics: RealtimeMetrics = new RealtimeMetrics(),
    private readonly mutations: RealtimeMutationPolicy =
      new RealtimeMutationPolicy(true),
  ) {}

  @Get('notifications')
  async notifications(
    @Req() request: Request,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('unread') unread?: string,
    @Query('module') module?: string,
  ) {
    const { principal, store } = await this.contexts.resolve(request);
    try {
      return await store.list(principal.userId, {
        ...(cursor === undefined ? {} : { cursor: requireCursor(cursor) }),
        ...(limit === undefined ? {} : { limit: parsePageSize(limit) }),
        ...(unread === undefined ? {} : { unread: parseBoolean(unread, 'unread') }),
        ...(module === undefined ? {} : { module: parseModule(module) }),
      });
    } catch (error) {
      if (error instanceof NotificationInputError) {
        throw new BadRequestException('cursor is invalid.');
      }
      throw error;
    }
  }

  @Get('sync')
  async sync(
    @Req() request: Request,
    @Query('afterSequence') afterSequence?: string,
  ) {
    const { principal, store } = await this.contexts.resolve(request);
    const sequence =
      afterSequence === undefined ? 0 : parseSequence(afterSequence);
    const result = await store.sync(
      principal.userId,
      sequence,
    );
    if (result.resetRequired) {
      this.metrics.syncReset();
    } else if (result.events[0]?.sequence > sequence + 1) {
      this.metrics.sequenceGap();
    }
    return result;
  }

  @Get('summary')
  async summary(@Req() request: Request) {
    const { principal, store } = await this.contexts.resolve(request);
    return store.summary(principal.userId);
  }

  @Patch('notifications/:id')
  async setRead(
    @Req() request: Request,
    @Param('id') notificationId: string,
    @Body() input: { readonly read?: unknown },
  ) {
    this.mutations.assertEnabled();
    this.contexts.requireCsrf(request);
    if (typeof input?.read !== 'boolean') {
      throw new BadRequestException('read must be a boolean.');
    }
    const { principal, store } = await this.contexts.resolve(request);
    try {
      return await store.setRead(
        principal.tenantId,
        principal.userId,
        requireIdentifier(notificationId, 'notification id'),
        input.read,
      );
    } catch (error) {
      if (error instanceof NotificationNotFoundError) {
        throw new NotFoundException('Notification was not found.');
      }
      throw error;
    }
  }

  @Post('notifications/read-all')
  async readAll(@Req() request: Request) {
    this.mutations.assertEnabled();
    this.contexts.requireCsrf(request);
    const { principal, store } = await this.contexts.resolve(request);
    return store.readAll(principal.tenantId, principal.userId);
  }

  @Get('preferences')
  async preferences(@Req() request: Request) {
    const { principal, store } = await this.contexts.resolve(request);
    return store.preferences(principal.userId);
  }

  @Put('preferences')
  async setPreferences(
    @Req() request: Request,
    @Body() input: { readonly preferences?: readonly unknown[] },
  ) {
    this.mutations.assertEnabled();
    this.contexts.requireCsrf(request);
    if (!input || !Array.isArray(input.preferences) || input.preferences.length > 200) {
      throw new BadRequestException('preferences must be an array with at most 200 items.');
    }
    const preferences = input.preferences.map(parsePreference);
    const { principal, store } = await this.contexts.resolve(request);
    return store.setPreferences(principal.userId, preferences);
  }
}

function requireCursor(value: string): string {
  if (!value || value.length > 1_024) {
    throw new BadRequestException('cursor is invalid.');
  }
  return value;
}

function parsePageSize(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new BadRequestException('limit must be an integer from 1 to 100.');
  }
  return parsed;
}

function parseBoolean(value: string, field: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException(`${field} must be true or false.`);
}

function parseSequence(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new BadRequestException('afterSequence must be a non-negative integer.');
  }
  return parsed;
}

function parseModule(value: string): NotificationModule {
  if (!MODULES.has(value as NotificationModule)) {
    throw new BadRequestException('module is not supported.');
  }
  return value as NotificationModule;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireIdentifier(value: string, field: string): string {
  if (!value || value.length > 200 || !UUID_PATTERN.test(value)) {
    throw new BadRequestException(`${field} is invalid.`);
  }
  return value;
}

function parsePreference(value: unknown): NotificationPreference {
  if (!isRecord(value)) throw new BadRequestException('preference must be an object.');
  const module = parseModule(String(value.module ?? ''));
  const category = typeof value.category === 'string' ? value.category.trim() : '';
  if (!category || category.length > 120) {
    throw new BadRequestException('preference category is invalid.');
  }
  if (!PRIORITIES.has(value.priority as NotificationPriority)) {
    throw new BadRequestException('preference priority is invalid.');
  }
  if (typeof value.feedEnabled !== 'boolean' || typeof value.toastEnabled !== 'boolean') {
    throw new BadRequestException('preference delivery flags must be boolean.');
  }
  return {
    module,
    category,
    priority: value.priority as NotificationPriority,
    feedEnabled: value.feedEnabled,
    toastEnabled: value.toastEnabled,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
