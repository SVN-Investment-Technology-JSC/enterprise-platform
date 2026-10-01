import { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantDatabaseReference } from '@enterprise-platform/contracts-tenancy';
import { PostgresNotificationStore } from '@enterprise-platform/module-notifications';
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Pool, QueryResultRow } from 'pg';
import type {
  RealtimeRequestContext,
  RealtimeRequestContextResolver,
} from './realtime-notifications.controller';

type FetchLike = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

export interface RealtimeAuthClient {
  authenticate(cookieHeader: string | undefined): Promise<TenantUserPrincipal>;
}

export class HttpRealtimeAuthClient implements RealtimeAuthClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetcher: FetchLike = globalThis.fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async authenticate(cookieHeader: string | undefined): Promise<TenantUserPrincipal> {
    const access = readCookie(cookieHeader, 'ep_access');
    if (!access) throw new UnauthorizedException('Session cookie is required.');

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/api/auth/v1/me`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          cookie: `ep_access=${access}`,
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error ? `Authentication service unavailable: ${error.message}` : 'Authentication service unavailable.',
      );
    }
    if (response.status === 401) throw new UnauthorizedException('Session is not active.');
    if (!response.ok) {
      throw new ServiceUnavailableException(`Authentication service returned ${response.status}.`);
    }

    const value = (await response.json()) as unknown;
    if (!isTenantPrincipal(value)) {
      if (isRecord(value) && value.kind === 'platform-admin') {
        throw new ForbiddenException('Realtime notifications are available to tenant users only.');
      }
      throw new UnauthorizedException('Authentication response is invalid.');
    }
    return value;
  }
}

export interface RealtimeStoreRegistry {
  forTenant(tenantId: string): Promise<PostgresNotificationStore>;
}

interface TenantDatabaseRow extends QueryResultRow {
  tenant_id: string;
  database_name: string;
  host: string;
  port: number;
  secret_ref: string;
  ssl: boolean;
  config_version: number;
}

export class PostgresRealtimeStoreRegistry implements RealtimeStoreRegistry {
  constructor(
    private readonly platform: Pick<Pool, 'query'>,
    private readonly pools: Pick<PostgresPoolRegistry, 'forTenant'>,
  ) {}

  async forTenant(tenantId: string): Promise<PostgresNotificationStore> {
    const result = await this.platform.query<TenantDatabaseRow>(
      `SELECT database.tenant_id, database.database_name, database.host,
              database.port, database.secret_ref, database.ssl,
              database.config_version
         FROM tenancy_schema.tenant_db_configs database
         JOIN tenancy_schema.tenants tenant ON tenant.id = database.tenant_id
        WHERE database.tenant_id = $1
          AND database.status = 'active'
          AND tenant.status = 'active'`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) throw new UnauthorizedException('Tenant is not active.');
    const reference: TenantDatabaseReference = {
      tenantId: row.tenant_id,
      databaseName: row.database_name,
      host: row.host,
      port: row.port,
      secretRef: row.secret_ref,
      ssl: row.ssl,
      configVersion: row.config_version,
    };
    return new PostgresNotificationStore(await this.pools.forTenant(reference));
  }
}

export class DefaultRealtimeRequestContextResolver
  implements RealtimeRequestContextResolver
{
  constructor(
    private readonly auth: RealtimeAuthClient,
    private readonly stores: RealtimeStoreRegistry,
  ) {}

  async resolve(request: Request): Promise<RealtimeRequestContext> {
    const principal = await this.auth.authenticate(request.headers.cookie);
    return {
      principal,
      store: await this.stores.forTenant(principal.tenantId),
    };
  }

  requireCsrf(request: Request): void {
    const header = request.headers['x-csrf-token'];
    const supplied = Array.isArray(header) ? header[0] : header;
    const cookie =
      typeof request.cookies?.ep_csrf === 'string'
        ? request.cookies.ep_csrf
        : readCookie(request.headers.cookie, 'ep_csrf');
    if (!supplied || !cookie || supplied !== cookie) {
      throw new ForbiddenException('CSRF token is invalid.');
    }
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value || undefined;
  }
  return undefined;
}

function isTenantPrincipal(value: unknown): value is TenantUserPrincipal {
  if (!isRecord(value) || value.kind !== 'tenant-user') return false;
  return (
    hasText(value.userId) &&
    hasText(value.sessionId) &&
    hasText(value.email) &&
    hasText(value.displayName) &&
    hasText(value.tenantId) &&
    hasText(value.tenantSlug) &&
    hasText(value.membershipId) &&
    Array.isArray(value.roles) &&
    value.roles.every(hasText) &&
    Array.isArray(value.permissions) &&
    value.permissions.every(hasText)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
