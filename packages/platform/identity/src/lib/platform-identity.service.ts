import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  createPostgresPool,
  resolveTenantDatabaseUrl,
} from '@enterprise-platform/adapter-database';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import type {
  AccessDecisionRequest,
  AccessDecisionResponse,
  AuthenticatedPrincipal,
  LoginRequest,
  TenantUserPrincipal,
} from '@enterprise-platform/contracts-identity';
import type {
  CreateTenantRequest,
  CreateTenantResponse,
  ModuleActivationRequestResponse,
  SetTenantEntitlementResponse,
  TenantDatabaseReference,
  TenantEntitlementOverview,
  TenantModuleCatalogItem,
  TenantModuleEntitlement,
  TenantSummary,
  UpdateTenantRequest,
} from '@enterprise-platform/contracts-tenancy';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import {
  exportJWK,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWK,
} from 'jose';

interface LoginRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  kind: 'platform-admin' | 'tenant-user';
  membership_id: string | null;
  tenant_id: string | null;
  tenant_slug: string | null;
}

interface DatabaseRow {
  tenant_id: string;
  tenant_slug: string;
  membership_id: string;
  email: string;
  display_name: string;
  database_name: string;
  host: string;
  port: number;
  secret_ref: string;
  ssl: boolean;
  config_version: number;
  entitled: boolean;
  session_active: boolean;
  membership_active: boolean;
}

interface TenantResetRow {
  token_id: string;
  tenant_id: string;
  core_user_id: string;
  tenant_slug: string;
  secret_ref: string;
  database_name: string;
}

const KEY_ID = 'platform-core-rs256-v1';
const derivePassword = promisify(scrypt);

@Injectable()
export class PlatformIdentityService implements OnModuleDestroy {
  private readonly pool = createPostgresPool(
    process.env.PLATFORM_DATABASE_URL ??
      'postgresql://platform:platform@localhost:55432/platform',
    { max: 10, application_name: 'enterprise-platform:platform-api' },
  );
  private readonly keys = this.loadKeys();

  async login(input: LoginRequest): Promise<{
    principal: AuthenticatedPrincipal;
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
  }> {
    const email = input?.email?.trim();
    if (
      !email ||
      !input.password ||
      !['platform', 'tenant'].includes(input.portal)
    ) {
      throw new BadRequestException('Thông tin đăng nhập không hợp lệ.');
    }
    if (input.portal === 'tenant') return this.loginTenantCore(input, email);
    const result = await this.pool.query<LoginRow>(
      `SELECT u.id, u.email, u.display_name, u.password_hash, u.kind,
              m.id AS membership_id, t.id AS tenant_id, t.slug AS tenant_slug
         FROM identity_schema.users u
         LEFT JOIN tenancy_schema.tenant_memberships m
           ON m.user_id = u.id AND m.status = 'active'
         LEFT JOIN tenancy_schema.tenants t
           ON t.id = m.tenant_id AND t.status = 'active'
        WHERE lower(u.email) = lower($1) AND u.status = 'active'
        ORDER BY m.created_at ASC
        LIMIT 1`,
      [email],
    );
    const row = result.rows[0];
    if (
      !row ||
      !(await this.verifyPassword(row.password_hash, input.password))
    ) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    }
    const expectedKind = 'platform-admin';
    if (row.kind !== expectedKind) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    }
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    await this.pool.query(
      `INSERT INTO identity_schema.auth_sessions
         (id, user_id, refresh_token_hash, csrf_token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '30 days')`,
      [sessionId, row.id, this.hash(refreshToken), this.hash(csrfToken)],
    );
    const principal = await this.createPrincipal(row, sessionId);
    return {
      principal,
      accessToken: await this.sign(principal),
      refreshToken,
      csrfToken,
    };
  }

  private async loginTenantCore(
    input: LoginRequest,
    email: string,
  ): Promise<{
    principal: AuthenticatedPrincipal;
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
  }> {
    const slug = input.tenantSlug?.trim().toLowerCase();
    if (!slug)
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    const tenant = await this.pool.query<{
      tenant_id: string;
      tenant_slug: string;
      secret_ref: string;
      database_name: string;
    }>(
      `SELECT t.id AS tenant_id, t.slug AS tenant_slug, db.secret_ref, db.database_name
         FROM tenancy_schema.tenants t
         JOIN tenancy_schema.tenant_db_configs db ON db.tenant_id = t.id AND db.status = 'active'
        WHERE t.slug = $1 AND t.status = 'active'`,
      [slug],
    );
    const target = tenant.rows[0];
    const connectionString =
      target &&
      this.tenantConnectionString(target.secret_ref, target.database_name);
    if (!target || !connectionString)
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    const tenantPool = createPostgresPool(connectionString, {
      max: 1,
      application_name: 'enterprise-platform:tenant-login',
    });
    try {
      const user = await tenantPool.query<{
        id: string;
        email: string;
        full_name: string;
        password_hash: string;
        system_role: string;
      }>(
        `SELECT id, email, full_name, password_hash, system_role FROM core_schema.users
          WHERE lower(email) = lower($1) AND status = 'active' AND is_active = true`,
        [email],
      );
      const coreUser = user.rows[0];
      if (
        !coreUser ||
        !(await this.verifyPassword(coreUser.password_hash, input.password))
      ) {
        throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
      }
      const sessionId = randomUUID();
      const refreshToken = randomBytes(48).toString('base64url');
      const csrfToken = randomBytes(24).toString('base64url');
      await this.pool.query(
        `INSERT INTO identity_schema.tenant_auth_sessions
           (id, tenant_id, core_user_id, refresh_token_hash, csrf_token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '30 days')`,
        [
          sessionId,
          target.tenant_id,
          coreUser.id,
          this.hash(refreshToken),
          this.hash(csrfToken),
        ],
      );
      const principal: TenantUserPrincipal = {
        kind: 'tenant-user',
        userId: coreUser.id,
        sessionId,
        email: coreUser.email,
        displayName: coreUser.full_name,
        tenantId: target.tenant_id,
        tenantSlug: target.tenant_slug,
        membershipId: coreUser.id,
        roles: [coreUser.system_role],
        permissions: ['tenant.manage'],
      };
      return {
        principal,
        accessToken: await this.sign(principal),
        refreshToken,
        csrfToken,
      };
    } finally {
      await tenantPool.end();
    }
  }

  async refresh(
    refreshToken: string,
    csrfToken: string,
  ): Promise<{
    principal: AuthenticatedPrincipal;
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
  }> {
    const tenantSession = await this.refreshTenantCoreSession(
      refreshToken,
      csrfToken,
    );
    if (tenantSession) return tenantSession;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const sessionResult = await client.query<
        LoginRow & { session_id: string }
      >(
        `SELECT s.id AS session_id,
                u.id, u.email, u.display_name, u.password_hash, u.kind,
                m.id AS membership_id, t.id AS tenant_id, t.slug AS tenant_slug
           FROM identity_schema.auth_sessions s
           JOIN identity_schema.users u ON u.id = s.user_id AND u.status = 'active'
           LEFT JOIN tenancy_schema.tenant_memberships m
             ON m.user_id = u.id AND m.status = 'active'
           LEFT JOIN tenancy_schema.tenants t
             ON t.id = m.tenant_id AND t.status = 'active'
          WHERE s.refresh_token_hash = $1 AND s.csrf_token_hash = $2
            AND s.revoked_at IS NULL AND s.expires_at > now()
          FOR UPDATE OF s`,
        [this.hash(refreshToken), this.hash(csrfToken)],
      );
      const row = sessionResult.rows[0];
      if (!row) throw new UnauthorizedException('Phiên đăng nhập đã hết hạn.');
      const rotatedRefresh = randomBytes(48).toString('base64url');
      const rotatedCsrf = randomBytes(24).toString('base64url');
      await client.query(
        `UPDATE identity_schema.auth_sessions
            SET refresh_token_hash = $2, csrf_token_hash = $3, rotated_at = now()
          WHERE id = $1`,
        [row.session_id, this.hash(rotatedRefresh), this.hash(rotatedCsrf)],
      );
      const principal = await this.createPrincipal(row, row.session_id, client);
      await client.query('COMMIT');
      return {
        principal,
        accessToken: await this.sign(principal),
        refreshToken: rotatedRefresh,
        csrfToken: rotatedCsrf,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async refreshTenantCoreSession(
    refreshToken: string,
    csrfToken: string,
  ): Promise<
    | {
        principal: AuthenticatedPrincipal;
        accessToken: string;
        refreshToken: string;
        csrfToken: string;
      }
    | undefined
  > {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        session_id: string;
        tenant_id: string;
        core_user_id: string;
        tenant_slug: string;
        secret_ref: string;
        database_name: string;
      }>(
        `SELECT s.id AS session_id, s.tenant_id, s.core_user_id, t.slug AS tenant_slug, db.secret_ref, db.database_name
           FROM identity_schema.tenant_auth_sessions s
           JOIN tenancy_schema.tenants t ON t.id = s.tenant_id AND t.status = 'active'
           JOIN tenancy_schema.tenant_db_configs db ON db.tenant_id = s.tenant_id AND db.status = 'active'
          WHERE s.refresh_token_hash = $1 AND s.csrf_token_hash = $2
            AND s.revoked_at IS NULL AND s.expires_at > now()
          FOR UPDATE OF s`,
        [this.hash(refreshToken), this.hash(csrfToken)],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return undefined;
      }
      const tenantPool = createPostgresPool(
        this.tenantConnectionString(row.secret_ref, row.database_name),
        {
          max: 1,
          application_name: 'enterprise-platform:tenant-session-refresh',
        },
      );
      let coreUser:
        | { email: string; full_name: string; system_role: string }
        | undefined;
      try {
        const user = await tenantPool.query<{
          email: string;
          full_name: string;
          system_role: string;
        }>(
          `SELECT email, full_name, system_role FROM core_schema.users
            WHERE id = $1 AND status = 'active' AND is_active = true`,
          [row.core_user_id],
        );
        coreUser = user.rows[0];
      } finally {
        await tenantPool.end();
      }
      if (!coreUser) {
        await client.query('ROLLBACK');
        return undefined;
      }
      const rotatedRefresh = randomBytes(48).toString('base64url');
      const rotatedCsrf = randomBytes(24).toString('base64url');
      await client.query(
        `UPDATE identity_schema.tenant_auth_sessions
            SET refresh_token_hash = $2, csrf_token_hash = $3, rotated_at = now() WHERE id = $1`,
        [row.session_id, this.hash(rotatedRefresh), this.hash(rotatedCsrf)],
      );
      const principal: TenantUserPrincipal = {
        kind: 'tenant-user',
        userId: row.core_user_id,
        sessionId: row.session_id,
        email: coreUser.email,
        displayName: coreUser.full_name,
        tenantId: row.tenant_id,
        tenantSlug: row.tenant_slug,
        membershipId: row.core_user_id,
        roles: [coreUser.system_role],
        permissions: ['tenant.manage'],
      };
      await client.query('COMMIT');
      return {
        principal,
        accessToken: await this.sign(principal),
        refreshToken: rotatedRefresh,
        csrfToken: rotatedCsrf,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async logout(sessionId: string): Promise<void> {
    await Promise.all([
      this.pool.query(
        'UPDATE identity_schema.auth_sessions SET revoked_at = now() WHERE id = $1',
        [sessionId],
      ),
      this.pool.query(
        'UPDATE identity_schema.tenant_auth_sessions SET revoked_at = now() WHERE id = $1',
        [sessionId],
      ),
    ]);
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedPrincipal> {
    const { publicKey } = await this.keys;
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
      issuer: 'enterprise-platform',
      audience: 'enterprise-platform-apps',
    });
    return payload.principal as unknown as AuthenticatedPrincipal;
  }

  async jwks(): Promise<{ keys: JWK[] }> {
    return { keys: [(await this.keys).jwk] };
  }

  async decide(input: AccessDecisionRequest): Promise<AccessDecisionResponse> {
    const tenantSessionDecision = await this.decideTenantCoreSession(input);
    if (tenantSessionDecision) return tenantSessionDecision;
    const membershipId = await this.membershipId(input.userId, input.tenantId);
    const result = await this.pool.query<DatabaseRow>(
      `SELECT t.id AS tenant_id, t.slug AS tenant_slug, m.id AS membership_id,
              u.email, u.display_name, d.database_name, d.host, d.port,
              d.secret_ref, d.ssl, d.config_version,
              EXISTS (
                SELECT 1 FROM subscription_schema.tenant_entitlements e
                JOIN module_registry_schema.modules mo ON mo.id = e.module_id
                WHERE e.tenant_id = t.id AND mo.key = $4 AND e.status = 'active'
              ) AS entitled,
              (s.revoked_at IS NULL AND s.expires_at > now()) AS session_active,
              (m.status = 'active' AND t.status = 'active') AS membership_active
         FROM identity_schema.auth_sessions s
         JOIN identity_schema.users u ON u.id = s.user_id AND u.id = $2
         JOIN tenancy_schema.tenant_memberships m ON m.user_id = u.id AND m.id = $3
         JOIN tenancy_schema.tenants t ON t.id = m.tenant_id AND t.id = $1
         JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = t.id AND d.status = 'active'
        WHERE s.id = $5`,
      [
        input.tenantId,
        input.userId,
        membershipId,
        input.moduleKey,
        input.sessionId,
      ],
    );
    const row = result.rows[0];
    if (!row || !row.session_active)
      return { allowed: false, code: 'SESSION_INACTIVE' };
    if (!row.membership_active)
      return { allowed: false, code: 'MEMBERSHIP_INACTIVE' };
    if (!row.entitled) return { allowed: false, code: 'MODULE_NOT_ENTITLED' };
    const access = await this.rolesAndPermissions(
      input.userId,
      row.membership_id,
    );
    if (!access.permissions.includes(input.permission)) {
      return { allowed: false, code: 'PERMISSION_DENIED' };
    }
    const principal: TenantUserPrincipal = {
      kind: 'tenant-user',
      userId: input.userId,
      sessionId: input.sessionId,
      email: row.email,
      displayName: row.display_name,
      tenantId: row.tenant_id,
      tenantSlug: row.tenant_slug,
      membershipId: row.membership_id,
      ...access,
    };
    const database: TenantDatabaseReference = {
      tenantId: row.tenant_id,
      databaseName: row.database_name,
      host: row.host,
      port: row.port,
      secretRef: row.secret_ref,
      ssl: row.ssl,
      configVersion: row.config_version,
    };
    return {
      allowed: true,
      principal,
      database,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    };
  }

  /** Dedicated tenant users have sessions in tenant_auth_sessions, not auth_sessions. */
  private async decideTenantCoreSession(input: AccessDecisionRequest): Promise<AccessDecisionResponse | undefined> {
    const result = await this.pool.query<DatabaseRow & { core_user_id: string }>(
      `SELECT t.id AS tenant_id, t.slug AS tenant_slug, s.core_user_id,
              d.database_name, d.host, d.port, d.secret_ref, d.ssl, d.config_version,
              EXISTS (SELECT 1 FROM subscription_schema.tenant_entitlements e JOIN module_registry_schema.modules mo ON mo.id = e.module_id WHERE e.tenant_id = t.id AND mo.key = $4 AND e.status = 'active') AS entitled,
              (s.revoked_at IS NULL AND s.expires_at > now()) AS session_active,
              (t.status = 'active') AS membership_active
         FROM identity_schema.tenant_auth_sessions s
         JOIN tenancy_schema.tenants t ON t.id = s.tenant_id
         JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = t.id AND d.status = 'active'
        WHERE s.id = $3 AND s.tenant_id = $1 AND s.core_user_id = $2`,
      [input.tenantId, input.userId, input.sessionId, input.moduleKey],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    if (!row.session_active) return { allowed: false, code: 'SESSION_INACTIVE' };
    if (!row.membership_active) return { allowed: false, code: 'MEMBERSHIP_INACTIVE' };
    if (!row.entitled) return { allowed: false, code: 'MODULE_NOT_ENTITLED' };
    // Tenant Portal user/role management has not been introduced yet. Until it
    // is, every active core user receives the same capabilities for each module
    // that the tenant has enabled. Platform RBAC remains for platform accounts.
    const access = this.defaultTenantModuleAccess(input.moduleKey);
    if (!access.permissions.includes(input.permission)) return { allowed: false, code: 'PERMISSION_DENIED' };
    const coreUser = await this.withTenantCoreDatabase(row.tenant_id, async (pool) => (
      await pool.query<{ id: string; email: string; full_name: string }>(
        `SELECT id, email, full_name FROM core_schema.users WHERE id = $1 AND status = 'active' AND is_active = true`,
        [row.core_user_id],
      )
    ).rows[0]);
    if (!coreUser) return { allowed: false, code: 'SESSION_INACTIVE' };
    return {
      allowed: true,
      principal: {
        kind: 'tenant-user', userId: coreUser.id, sessionId: input.sessionId,
        email: coreUser.email, displayName: coreUser.full_name,
        tenantId: row.tenant_id, tenantSlug: row.tenant_slug,
        // Dedicated database assignments are keyed by the core user id.
        membershipId: coreUser.id, ...access,
      },
      database: {
        tenantId: row.tenant_id, databaseName: row.database_name, host: row.host,
        port: row.port, secretRef: row.secret_ref, ssl: row.ssl, configVersion: row.config_version,
      },
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    };
  }

  private defaultTenantModuleAccess(moduleKey: string): {
    roles: string[];
    permissions: string[];
  } {
    const permissions: Record<string, string[]> = {
      'procedure-engine': [
        'procedure.read',
        'procedure.act',
        'procedure.design',
        'procedure.manage',
      ],
      maintenance: [
        'maintenance.read',
        'maintenance.manage',
        'maintenance.occurrence.manage',
      ],
      inventory: [
        'inventory.read',
        'inventory.manage',
        'inventory.transaction.write',
      ],
      crm: ['crm.read', 'crm.manage'],
    };
    return {
      roles: ['tenant-user'],
      permissions: permissions[moduleKey] ?? [],
    };
  }

  /**
   * Resolves a tenant database for a trusted service call (no user session).
   * Still enforces tenant status and module entitlement — only the user-identity
   * checks in decide() are skipped, since the caller is a service, not a person.
   */
  async serviceDatabase(
    tenantId: string,
    moduleKey: string,
  ): Promise<TenantDatabaseReference | null> {
    const result = await this.pool.query<DatabaseRow>(
      `SELECT t.id AS tenant_id, d.database_name, d.host, d.port,
              d.secret_ref, d.ssl, d.config_version,
              EXISTS (
                SELECT 1 FROM subscription_schema.tenant_entitlements e
                JOIN module_registry_schema.modules mo ON mo.id = e.module_id
                WHERE e.tenant_id = t.id AND mo.key = $2 AND e.status = 'active'
              ) AS entitled
         FROM tenancy_schema.tenants t
         JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = t.id AND d.status = 'active'
        WHERE t.id = $1 AND t.status = 'active'`,
      [tenantId, moduleKey],
    );
    const row = result.rows[0];
    if (!row || !row.entitled) return null;
    return {
      tenantId: row.tenant_id,
      databaseName: row.database_name,
      host: row.host,
      port: row.port,
      secretRef: row.secret_ref,
      ssl: row.ssl,
      configVersion: row.config_version,
    };
  }

  async tenantModules(tenantId: string): Promise<unknown[]> {
    const result = await this.pool.query(
      `SELECT mo.key, mo.name, mo.description, mo.launch_url AS "launchUrl",
              mo.icon, mo.version, e.status
         FROM subscription_schema.tenant_entitlements e
         JOIN module_registry_schema.modules mo ON mo.id = e.module_id
        WHERE e.tenant_id = $1 AND e.status IN ('active', 'disabled')
        ORDER BY mo.name`,
      [tenantId],
    );
    return result.rows;
  }

  async tenantModuleCatalog(
    tenantId: string,
  ): Promise<TenantModuleCatalogItem[]> {
    const result = await this.pool.query<TenantModuleCatalogItem>(
      `SELECT mo.key, mo.name, mo.description, mo.launch_url AS "launchUrl",
              mo.icon, mo.version,
              coalesce(e.status, 'not-entitled') AS "entitlementStatus"
         FROM module_registry_schema.modules mo
         LEFT JOIN subscription_schema.tenant_entitlements e
           ON e.module_id = mo.id AND e.tenant_id = $1
        WHERE mo.status = 'active'
        ORDER BY CASE coalesce(e.status, 'not-entitled')
                   WHEN 'active' THEN 0
                   WHEN 'provisioning' THEN 1
                   WHEN 'disabled' THEN 2
                   WHEN 'failed' THEN 3
                   ELSE 4
                 END,
                 mo.name`,
      [tenantId],
    );
    return result.rows;
  }

  async requestModuleActivation(
    tenantId: string,
    moduleKey: string,
    actorId: string,
  ): Promise<ModuleActivationRequestResponse> {
    const module = await this.pool.query<{ entitlementStatus: string }>(
      `SELECT coalesce(e.status, 'not-entitled') AS "entitlementStatus"
         FROM module_registry_schema.modules mo
         LEFT JOIN subscription_schema.tenant_entitlements e
           ON e.module_id = mo.id AND e.tenant_id = $1
        WHERE mo.key = $2 AND mo.status = 'active'`,
      [tenantId, moduleKey],
    );
    const entitlementStatus = module.rows[0]?.entitlementStatus;
    if (!entitlementStatus) {
      throw new NotFoundException('Module chưa được đăng ký trên hệ thống.');
    }
    if (
      entitlementStatus === 'active' ||
      entitlementStatus === 'provisioning'
    ) {
      throw new ConflictException(
        entitlementStatus === 'active'
          ? 'Module đã được kích hoạt.'
          : 'Module đang được kích hoạt.',
      );
    }

    const existing = await this.pool.query<{ requestedAt: string }>(
      `SELECT created_at::text AS "requestedAt"
         FROM audit_schema.audit_logs
        WHERE tenant_id = $1
          AND action = 'platform.module.activation-requested'
          AND metadata ->> 'moduleKey' = $2
          AND created_at >= now() - interval '24 hours'
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId, moduleKey],
    );
    if (existing.rows[0]) {
      return {
        status: 'already-requested',
        moduleKey,
        requestedAt: existing.rows[0].requestedAt,
      };
    }

    const created = await this.pool.query<{ requestedAt: string }>(
      `INSERT INTO audit_schema.audit_logs
         (id, actor_id, tenant_id, action, metadata)
       VALUES ($1, $2, $3, 'platform.module.activation-requested', $4::jsonb)
       RETURNING created_at::text AS "requestedAt"`,
      [randomUUID(), actorId, tenantId, JSON.stringify({ moduleKey })],
    );
    return {
      status: 'requested',
      moduleKey,
      requestedAt: created.rows[0].requestedAt,
    };
  }

  async coreUsers(tenantId: string): Promise<unknown[]> {
    return this.withTenantCoreDatabase(
      tenantId,
      async (pool) =>
        (
          await pool.query(
            `SELECT id, username, full_name AS "fullName", email, system_role AS "systemRole",
                status, is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
           FROM core_schema.users ORDER BY created_at DESC`,
          )
        ).rows,
    );
  }

  async coreOrganizationSnapshot(tenantId: string): Promise<unknown> {
    return this.withTenantCoreDatabase(tenantId, async (pool) => {
      const [trees, nodeTypes, nodes, assignments, users] = await Promise.all([
        pool.query(
          `SELECT id, code, name, description, is_primary AS "isPrimary", status, layout, created_at AS "createdAt", updated_at AS "updatedAt" FROM core_schema.organization_trees WHERE deleted_at IS NULL ORDER BY is_primary DESC, name`,
        ),
        pool.query(
          `SELECT id, code, name, category, description, sort_order AS "sortOrder", is_system AS "isSystem", is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt" FROM core_schema.organization_node_types WHERE deleted_at IS NULL ORDER BY category, sort_order, name`,
        ),
        pool.query(
          `SELECT id, tree_id AS "treeId", parent_id AS "parentId", node_type_id AS "nodeTypeId", code, name, description, sort_order AS "sortOrder", status, metadata, created_at AS "createdAt", updated_at AS "updatedAt" FROM core_schema.organization_nodes WHERE deleted_at IS NULL ORDER BY sort_order, name`,
        ),
        pool.query(
          `SELECT id, node_id AS "nodeId", user_id AS "userId", is_primary AS "isPrimary", start_date AS "startDate", end_date AS "endDate", note, status, created_at AS "createdAt", updated_at AS "updatedAt" FROM core_schema.organization_node_assignments WHERE deleted_at IS NULL ORDER BY created_at DESC`,
        ),
        pool.query(
          `SELECT id, full_name AS "fullName", email FROM core_schema.users WHERE status = 'active' AND is_active = true ORDER BY full_name`,
        ),
      ]);
      return {
        trees: trees.rows,
        nodeTypes: nodeTypes.rows,
        nodes: nodes.rows,
        assignments: assignments.rows,
        users: users.rows,
      };
    });
  }

  /** Compatibility view for modules using units and members over the core node model. */
  async tenantOrganizationSnapshot(tenantId: string): Promise<unknown> {
    return this.withTenantCoreDatabase(tenantId, async (pool) => {
      const [nodeTypes, nodes, assignments] = await Promise.all([
        pool.query(`SELECT id, code AS key, name, created_at AS "createdAt" FROM core_schema.organization_node_types WHERE deleted_at IS NULL AND is_active = true ORDER BY sort_order, name`),
        pool.query(`SELECT n.id, n.code, n.name, n.node_type_id AS "typeId", nt.name AS "typeName", n.parent_id AS "parentId", n.created_at AS "createdAt", n.updated_at AS "updatedAt" FROM core_schema.organization_nodes n JOIN core_schema.organization_node_types nt ON nt.id = n.node_type_id WHERE n.deleted_at IS NULL ORDER BY n.sort_order, n.name`),
        pool.query(`SELECT a.node_id AS "unitId", a.user_id AS "userId", a.is_primary AS "isHead", u.full_name AS "displayName", u.email FROM core_schema.organization_node_assignments a JOIN core_schema.users u ON u.id = a.user_id WHERE a.deleted_at IS NULL AND a.status = 'active' AND u.status = 'active' AND u.is_active = true`),
      ]);
      const members = assignments.rows.map((assignment) => ({ membershipId: assignment.userId, userId: assignment.userId, displayName: assignment.displayName, email: assignment.email, unitId: assignment.unitId, isHead: assignment.isHead }));
      const byUnit = new Map<string, typeof members>();
      for (const member of members) byUnit.set(member.unitId, [...(byUnit.get(member.unitId) ?? []), member]);
      const membershipSubjects: Record<string, { organizationUnitIds: string[]; positionIds: string[] }> = {};
      for (const member of members) {
        const subject = membershipSubjects[member.membershipId] ?? { organizationUnitIds: [], positionIds: [] };
        if (!subject.organizationUnitIds.includes(member.unitId)) subject.organizationUnitIds.push(member.unitId);
        membershipSubjects[member.membershipId] = subject;
      }
      return {
        version: 1 as const,
        source: 'tenant-core' as const,
        tenantId, generatedAt: new Date().toISOString(),
        unitTypes: nodeTypes.rows.map((type) => ({ ...type, usageCount: 0 })),
        units: nodes.rows.map((node) => {
          const unitMembers = byUnit.get(node.id) ?? [];
          const head = unitMembers.find((member) => member.isHead);
          return { ...node, parentId: node.parentId ?? undefined, headMembershipId: head?.membershipId, headName: head?.displayName, memberCount: unitMembers.length };
        }),
        positions: [], members, membershipSubjects,
      };
    });
  }

  /**
   * Returns an organization tree in a render-ready shape.
   * Node types and active user assignments are joined here so consumers do not
   * need to recreate the organization model from the administrative snapshot.
   */
  async organizationTree(tenantId: string, treeId: string): Promise<unknown> {
    return this.withTenantCoreDatabase(tenantId, async (pool) => {
      const treeResult = await pool.query<OrganizationTreeRow>(
        `SELECT id, code, name
           FROM core_schema.organization_trees
          WHERE id = $1
            AND deleted_at IS NULL
          LIMIT 1`,
        [treeId],
      );
      const tree = treeResult.rows[0];
      if (!tree)
        throw new NotFoundException('Không tìm thấy cây sơ đồ tổ chức.');

      const nodeResult = await pool.query<OrganizationTreeNodeRow>(
        `SELECT n.id,
                n.parent_id AS "parentId",
                n.code,
                n.name,
                t.id AS "typeId",
                t.code AS "typeCode",
                t.name AS "typeName",
                t.category AS "typeCategory",
                COALESCE(
                  json_agg(
                    json_build_object(
                      'id', u.id,
                      'name', u.full_name,
                      'email', u.email,
                      'isPrimary', a.is_primary
                    )
                    ORDER BY a.is_primary DESC, u.full_name
                  ) FILTER (WHERE u.id IS NOT NULL),
                  '[]'::json
                ) AS assignees
           FROM core_schema.organization_nodes n
           JOIN core_schema.organization_node_types t
             ON t.id = n.node_type_id
            AND t.deleted_at IS NULL
           LEFT JOIN core_schema.organization_node_assignments a
             ON a.node_id = n.id
            AND a.status = 'active'
            AND a.deleted_at IS NULL
            AND (a.start_date IS NULL OR a.start_date <= CURRENT_DATE)
            AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
           LEFT JOIN core_schema.users u
             ON u.id = a.user_id
            AND u.status = 'active'
            AND u.is_active = true
          WHERE n.tree_id = $1
            AND n.status = 'active'
            AND n.deleted_at IS NULL
          GROUP BY n.id, n.parent_id, n.code, n.name,
                   t.id, t.code, t.name, t.category, n.sort_order
          ORDER BY n.sort_order, n.name`,
        [tree.id],
      );

      return {
        id: tree.id,
        code: tree.code,
        name: tree.name,
        nodes: toOrganizationTree(nodeResult.rows),
      };
    });
  }

  async organizationTrees(tenantId: string): Promise<unknown> {
    return this.withTenantCoreDatabase(tenantId, async (pool) => {
      const result = await pool.query<OrganizationTreeRow>(
        `SELECT id, code, name
           FROM core_schema.organization_trees
          WHERE deleted_at IS NULL
          ORDER BY name`,
      );
      return { trees: result.rows };
    });
  }

  async listCoreOrganizationResource(
    tenantId: string,
    resource: string,
  ): Promise<unknown> {
    const snapshot = (await this.coreOrganizationSnapshot(tenantId)) as Record<
      string,
      unknown
    >;
    const fields: Record<string, string> = {
      trees: 'trees',
      'node-types': 'nodeTypes',
      nodes: 'nodes',
      assignments: 'assignments',
    };
    const field = fields[resource];
    if (!field)
      throw new NotFoundException('Tài nguyên sơ đồ tổ chức không hợp lệ.');
    return { [field]: snapshot[field] };
  }

  async createCoreOrganizationResource(
    tenantId: string,
    resource: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    const action: Record<string, string> = {
      trees: 'create-tree',
      'node-types': 'create-type',
      nodes: 'create-node',
      assignments: 'assign-user',
    };
    if (!action[resource])
      throw new NotFoundException('Tài nguyên sơ đồ tổ chức không hợp lệ.');
    return this.mutateCoreOrganization(tenantId, {
      action: action[resource],
      data,
    });
  }

  async updateCoreOrganizationResource(
    tenantId: string,
    resource: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    const action: Record<string, string> = {
      trees: 'update-tree',
      'node-types': 'update-type',
      nodes: 'update-node',
      assignments: 'update-assignment',
    };
    if (!action[resource])
      throw new NotFoundException('Tài nguyên sơ đồ tổ chức không hợp lệ.');
    return this.mutateCoreOrganization(tenantId, {
      action: action[resource],
      id,
      data,
    });
  }

  async saveCoreOrganizationTreeLayout(
    tenantId: string,
    treeId: string,
    input: unknown,
  ): Promise<{ status: 'saved'; updatedAt: string }> {
    const positions = organizationTreePositions(input);
    return this.withTenantCoreDatabase(tenantId, async (pool) => {
      const nodes = await pool.query<{ id: string }>(
        `SELECT id
           FROM core_schema.organization_nodes
          WHERE tree_id = $1 AND deleted_at IS NULL`,
        [treeId],
      );
      const nodeIds = new Set(nodes.rows.map((node) => node.id));
      const unknownNode = Object.keys(positions).find((id) => !nodeIds.has(id));
      if (unknownNode) {
        throw new BadRequestException(
          'Layout chứa node không thuộc sơ đồ đang lưu.',
        );
      }
      const result = await pool.query<{ updatedAt: string }>(
        `UPDATE core_schema.organization_trees
            SET layout = $2::jsonb, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING updated_at AS "updatedAt"`,
        [treeId, JSON.stringify({ version: 1, positions })],
      );
      if (!result.rows[0])
        throw new NotFoundException('Không tìm thấy sơ đồ tổ chức.');
      return { status: 'saved', updatedAt: result.rows[0].updatedAt };
    });
  }

  async softDeleteCoreOrganizationResource(
    tenantId: string,
    resource: string,
    id: string,
  ): Promise<{ status: 'deleted' }> {
    return this.withTenantCoreDatabase(tenantId, async (pool) => {
      const target = requireOrganizationResource(resource);
      if (resource === 'trees') {
        const dependent = await pool.query(
          'SELECT 1 FROM core_schema.organization_nodes WHERE tree_id=$1 AND deleted_at IS NULL LIMIT 1',
          [id],
        );
        if (dependent.rowCount)
          throw new BadRequestException(
            'Không thể xóa sơ đồ còn node đang hoạt động.',
          );
      }
      if (resource === 'node-types') {
        const dependent = await pool.query(
          'SELECT 1 FROM core_schema.organization_nodes WHERE node_type_id=$1 AND deleted_at IS NULL LIMIT 1',
          [id],
        );
        if (dependent.rowCount)
          throw new BadRequestException(
            'Không thể xóa loại node đang được sử dụng.',
          );
      }
      if (resource === 'nodes') {
        const dependent = await pool.query(
          'SELECT 1 FROM core_schema.organization_nodes WHERE parent_id=$1 AND deleted_at IS NULL LIMIT 1',
          [id],
        );
        const assigned = await pool.query(
          'SELECT 1 FROM core_schema.organization_node_assignments WHERE node_id=$1 AND deleted_at IS NULL AND status = $2 LIMIT 1',
          [id, 'active'],
        );
        if (dependent.rowCount || assigned.rowCount)
          throw new BadRequestException(
            'Không thể xóa node còn node con hoặc bổ nhiệm hiệu lực.',
          );
      }
      const status = resource === 'assignments' ? 'ended' : 'archived';
      const result = await pool.query(
        `UPDATE core_schema.${target} SET deleted_at=now(), updated_at=now(), status=$2 WHERE id=$1 AND deleted_at IS NULL`,
        [id, status],
      );
      if (!result.rowCount)
        throw new NotFoundException('Không tìm thấy bản ghi đang hoạt động.');
      return { status: 'deleted' };
    });
  }

  async mutateCoreOrganization(
    tenantId: string,
    input: { action?: string; id?: string; data?: Record<string, unknown> },
  ): Promise<unknown> {
    const data = input.data ?? {};
    const action = input.action;
    const required = (value: unknown, label: string) => {
      if (typeof value !== 'string' || !value.trim())
        throw new BadRequestException(`${label} là bắt buộc.`);
      return value.trim();
    };
    return this.withTenantCoreDatabase(tenantId, async (pool) => {
      if (action === 'create-tree') {
        const id = randomUUID();
        const code = required(data.code, 'Mã sơ đồ');
        const name = required(data.name, 'Tên sơ đồ');
        if (data.isPrimary)
          await pool.query(
            'UPDATE core_schema.organization_trees SET is_primary = false WHERE is_primary = true',
          );
        return (
          await pool.query(
            `INSERT INTO core_schema.organization_trees (id, code, name, description, is_primary) VALUES ($1,$2,$3,$4,$5) RETURNING id,code,name,description,is_primary AS "isPrimary",status`,
            [
              id,
              code,
              name,
              typeof data.description === 'string' ? data.description : null,
              data.isPrimary === true,
            ],
          )
        ).rows[0];
      }
      if (action === 'update-tree') {
        const id = required(input.id, 'Sơ đồ');
        if (data.isPrimary === true)
          await pool.query(
            'UPDATE core_schema.organization_trees SET is_primary=false, updated_at=now() WHERE id <> $1 AND is_primary=true AND deleted_at IS NULL',
            [id],
          );
        const result = await pool.query(
          `UPDATE core_schema.organization_trees SET code=coalesce($2,code), name=coalesce($3,name), description=CASE WHEN $4 THEN $5 ELSE description END, is_primary=coalesce($6,is_primary), status=coalesce($7,status), updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id,code,name,description,is_primary AS "isPrimary",status`,
          [
            id,
            optionalString(data.code),
            optionalString(data.name),
            Object.hasOwn(data, 'description'),
            nullableString(data.description),
            data.isPrimary === undefined ? null : data.isPrimary === true,
            organizationStatus(data.status),
          ],
        );
        if (!result.rows[0])
          throw new NotFoundException('Không tìm thấy sơ đồ.');
        return result.rows[0];
      }
      if (action === 'create-type') {
        const id = randomUUID();
        const category = data.category === 'position' ? 'position' : 'unit';
        return (
          await pool.query(
            `INSERT INTO core_schema.organization_node_types (id,code,name,category) VALUES ($1,$2,$3,$4) RETURNING id,code,name,category,is_system AS "isSystem",is_active AS "isActive"`,
            [
              id,
              required(data.code, 'Mã loại node').toUpperCase(),
              required(data.name, 'Tên loại node'),
              category,
            ],
          )
        ).rows[0];
      }
      if (action === 'update-type') {
        const result = await pool.query(
          `UPDATE core_schema.organization_node_types SET code=coalesce($2,code), name=coalesce($3,name), category=coalesce($4,category), description=CASE WHEN $5 THEN $6 ELSE description END, sort_order=coalesce($7,sort_order), is_active=coalesce($8,is_active), updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id,code,name,category,description,sort_order AS "sortOrder",is_system AS "isSystem",is_active AS "isActive"`,
          [
            required(input.id, 'Loại node'),
            optionalString(data.code)?.toUpperCase() ?? null,
            optionalString(data.name),
            data.category === undefined ? null : category(data.category),
            Object.hasOwn(data, 'description'),
            nullableString(data.description),
            integerOrNull(data.sortOrder),
            data.isActive === undefined ? null : data.isActive === true,
          ],
        );
        if (!result.rows[0])
          throw new NotFoundException('Không tìm thấy loại node.');
        return result.rows[0];
      }
      if (action === 'create-node') {
        const id = randomUUID();
        const treeId = required(data.treeId, 'Sơ đồ');
        const typeId = required(data.nodeTypeId, 'Loại node');
        await validateNodeParent(
          pool,
          treeId,
          nullableString(data.parentId),
          id,
        );
        return (
          await pool.query(
            `INSERT INTO core_schema.organization_nodes (id,tree_id,parent_id,node_type_id,code,name,description) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,tree_id AS "treeId",parent_id AS "parentId",node_type_id AS "nodeTypeId",code,name,status`,
            [
              id,
              treeId,
              typeof data.parentId === 'string' && data.parentId
                ? data.parentId
                : null,
              typeId,
              required(data.code, 'Mã node'),
              required(data.name, 'Tên node'),
              typeof data.description === 'string' ? data.description : null,
            ],
          )
        ).rows[0];
      }
      if (action === 'update-node') {
        const id = required(input.id, 'Node');
        const current = await pool.query<{
          tree_id: string;
          parent_id: string | null;
        }>(
          'SELECT tree_id,parent_id FROM core_schema.organization_nodes WHERE id=$1 AND deleted_at IS NULL',
          [id],
        );
        if (!current.rows[0])
          throw new NotFoundException('Không tìm thấy node.');
        const treeId = optionalString(data.treeId) ?? current.rows[0].tree_id;
        const parentId = Object.hasOwn(data, 'parentId')
          ? nullableString(data.parentId)
          : current.rows[0].parent_id;
        if (treeId !== current.rows[0].tree_id) {
          const children = await pool.query(
            'SELECT 1 FROM core_schema.organization_nodes WHERE parent_id=$1 AND deleted_at IS NULL LIMIT 1',
            [id],
          );
          if (children.rowCount) {
            throw new BadRequestException(
              'Không thể chuyển node sang sơ đồ khác khi vẫn còn node con.',
            );
          }
        }
        await validateNodeParent(pool, treeId, parentId, id);
        const result = await pool.query(
          `UPDATE core_schema.organization_nodes SET tree_id=$2,parent_id=$3,node_type_id=coalesce($4,node_type_id),code=coalesce($5,code),name=coalesce($6,name),description=CASE WHEN $7 THEN $8 ELSE description END,sort_order=coalesce($9,sort_order),status=coalesce($10,status),updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id,tree_id AS "treeId",parent_id AS "parentId",node_type_id AS "nodeTypeId",code,name,description,sort_order AS "sortOrder",status`,
          [
            id,
            treeId,
            parentId,
            optionalString(data.nodeTypeId),
            optionalString(data.code),
            optionalString(data.name),
            Object.hasOwn(data, 'description'),
            nullableString(data.description),
            integerOrNull(data.sortOrder),
            organizationStatus(data.status),
          ],
        );
        return result.rows[0];
      }
      if (action === 'assign-user') {
        const id = randomUUID();
        const nodeId = required(data.nodeId, 'Node');
        const userId = required(data.userId, 'Người dùng');
        await validateAssignment(
          pool,
          nodeId,
          userId,
          nullableString(data.startDate),
          nullableString(data.endDate),
        );
        if (data.isPrimary === true)
          await pool.query(
            `UPDATE core_schema.organization_node_assignments SET is_primary=false,updated_at=now() WHERE user_id=$1 AND status='active' AND deleted_at IS NULL`,
            [userId],
          );
        return (
          await pool.query(
            `INSERT INTO core_schema.organization_node_assignments (id,node_id,user_id,is_primary,start_date,end_date,note,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,node_id AS "nodeId",user_id AS "userId",is_primary AS "isPrimary",start_date AS "startDate",end_date AS "endDate",note,status`,
            [
              id,
              nodeId,
              userId,
              data.isPrimary === true,
              nullableString(data.startDate),
              nullableString(data.endDate),
              nullableString(data.note),
              organizationAssignmentStatus(data.status) ?? 'active',
            ],
          )
        ).rows[0];
      }
      if (action === 'update-assignment') {
        const id = required(input.id, 'Bổ nhiệm');
        const current = await pool.query<{ node_id: string; user_id: string }>(
          'SELECT node_id,user_id FROM core_schema.organization_node_assignments WHERE id=$1 AND deleted_at IS NULL',
          [id],
        );
        if (!current.rows[0])
          throw new NotFoundException('Không tìm thấy bổ nhiệm.');
        const nodeId = optionalString(data.nodeId) ?? current.rows[0].node_id;
        const userId = optionalString(data.userId) ?? current.rows[0].user_id;
        await validateAssignment(
          pool,
          nodeId,
          userId,
          nullableString(data.startDate),
          nullableString(data.endDate),
        );
        if (data.isPrimary === true)
          await pool.query(
            `UPDATE core_schema.organization_node_assignments SET is_primary=false,updated_at=now() WHERE user_id=$1 AND id<>$2 AND status='active' AND deleted_at IS NULL`,
            [userId, id],
          );
        const result = await pool.query(
          `UPDATE core_schema.organization_node_assignments SET node_id=$2,user_id=$3,is_primary=coalesce($4,is_primary),start_date=CASE WHEN $5 THEN $6 ELSE start_date END,end_date=CASE WHEN $7 THEN $8 ELSE end_date END,note=CASE WHEN $9 THEN $10 ELSE note END,status=coalesce($11,status),updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id,node_id AS "nodeId",user_id AS "userId",is_primary AS "isPrimary",start_date AS "startDate",end_date AS "endDate",note,status`,
          [
            id,
            nodeId,
            userId,
            data.isPrimary === undefined ? null : data.isPrimary === true,
            Object.hasOwn(data, 'startDate'),
            nullableString(data.startDate),
            Object.hasOwn(data, 'endDate'),
            nullableString(data.endDate),
            Object.hasOwn(data, 'note'),
            nullableString(data.note),
            organizationAssignmentStatus(data.status),
          ],
        );
        return result.rows[0];
      }
      if (action === 'delete-tree') {
        await pool.query(
          'DELETE FROM core_schema.organization_trees WHERE id=$1',
          [required(input.id, 'Sơ đồ')],
        );
        return { status: 'deleted' };
      }
      if (action === 'delete-type') {
        await pool.query(
          'DELETE FROM core_schema.organization_node_types WHERE id=$1',
          [required(input.id, 'Loại node')],
        );
        return { status: 'deleted' };
      }
      if (action === 'delete-node') {
        await pool.query(
          'DELETE FROM core_schema.organization_nodes WHERE id=$1',
          [required(input.id, 'Node')],
        );
        return { status: 'deleted' };
      }
      if (action === 'delete-assignment') {
        await pool.query(
          'DELETE FROM core_schema.organization_node_assignments WHERE id=$1',
          [required(input.id, 'Bổ nhiệm')],
        );
        return { status: 'deleted' };
      }
      throw new BadRequestException('Thao tác tổ chức không hợp lệ.');
    });
  }

  async createCoreUser(
    tenantId: string,
    input: {
      fullName?: string;
      email?: string;
      password?: string;
      systemRole?: string;
    },
  ): Promise<unknown> {
    const fullName = input.fullName?.trim();
    const email = input.email?.trim().toLowerCase();
    const password = input.password;
    const systemRole =
      input.systemRole === 'tenant-admin' ? 'tenant-admin' : 'tenant-user';
    if (
      !fullName ||
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !password ||
      password.length < 12 ||
      password.length > 128
    ) {
      throw new BadRequestException('Thông tin người dùng không hợp lệ.');
    }
    try {
      return await this.withTenantCoreDatabase(
        tenantId,
        async (pool) =>
          (
            await pool.query(
              `INSERT INTO core_schema.users (id, username, full_name, email, password_hash, system_role)
           VALUES ($1, $2, $3, $2, $4, $5)
           RETURNING id, username, full_name AS "fullName", email, system_role AS "systemRole",
                     status, is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`,
              [
                randomUUID(),
                email,
                fullName,
                await this.hashPassword(password),
                systemRole,
              ],
            )
          ).rows[0],
      );
    } catch (error) {
      if (this.isPostgresError(error, '23505'))
        throw new ConflictException('Email người dùng đã tồn tại.');
      throw error;
    }
  }

  async updateCoreUser(
    tenantId: string,
    userId: string,
    input: {
      fullName?: string;
      email?: string;
      systemRole?: string;
      status?: string;
      password?: string;
    },
  ): Promise<unknown> {
    const fullName = input.fullName?.trim();
    const email = input.email?.trim().toLowerCase();
    const role = input.systemRole;
    const status = input.status;
    if (fullName !== undefined && !fullName)
      throw new BadRequestException('Tên người dùng không hợp lệ.');
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new BadRequestException('Email người dùng không hợp lệ.');
    if (role !== undefined && !['tenant-admin', 'tenant-user'].includes(role))
      throw new BadRequestException('Role người dùng không hợp lệ.');
    if (status !== undefined && !['active', 'disabled'].includes(status))
      throw new BadRequestException('Trạng thái người dùng không hợp lệ.');
    if (
      input.password !== undefined &&
      (input.password.length < 12 || input.password.length > 128)
    )
      throw new BadRequestException('Mật khẩu cần từ 12 đến 128 ký tự.');
    const directory = await this.pool.query<{ core_user_id: string }>(
      'SELECT core_user_id FROM tenancy_schema.tenant_admin_directory WHERE tenant_id = $1',
      [tenantId],
    );
    if (
      directory.rows[0]?.core_user_id === userId &&
      (status === 'disabled' || role === 'tenant-user')
    ) {
      throw new BadRequestException(
        'Không thể vô hiệu hóa hoặc hạ quyền Tenant Admin chính.',
      );
    }
    try {
      const result = await this.withTenantCoreDatabase(tenantId, async (pool) =>
        pool.query(
          `UPDATE core_schema.users SET full_name = coalesce($2, full_name), email = coalesce($3, email),
           username = coalesce($3, username), system_role = coalesce($4, system_role),
           status = coalesce($5, status), is_active = CASE WHEN $5 = 'disabled' THEN false WHEN $5 = 'active' THEN true ELSE is_active END,
           password_hash = coalesce($6, password_hash), updated_at = now()
         WHERE id = $1
         RETURNING id, username, full_name AS "fullName", email, system_role AS "systemRole",
                   status, is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`,
          [
            userId,
            fullName ?? null,
            email ?? null,
            role ?? null,
            status ?? null,
            input.password ? await this.hashPassword(input.password) : null,
          ],
        ),
      );
      if (!result.rows[0])
        throw new NotFoundException('Không tìm thấy người dùng.');
      return result.rows[0];
    } catch (error) {
      if (this.isPostgresError(error, '23505'))
        throw new ConflictException('Email người dùng đã tồn tại.');
      throw error;
    }
  }

  async deleteCoreUser(
    tenantId: string,
    userId: string,
    actorId: string,
  ): Promise<void> {
    if (userId === actorId)
      throw new BadRequestException('Không thể xóa tài khoản đang đăng nhập.');
    const directory = await this.pool.query<{ core_user_id: string }>(
      'SELECT core_user_id FROM tenancy_schema.tenant_admin_directory WHERE tenant_id = $1',
      [tenantId],
    );
    if (directory.rows[0]?.core_user_id === userId)
      throw new BadRequestException('Không thể xóa Tenant Admin chính.');
    const result = await this.withTenantCoreDatabase(tenantId, async (pool) =>
      pool.query('DELETE FROM core_schema.users WHERE id = $1', [userId]),
    );
    if (!result.rowCount)
      throw new NotFoundException('Không tìm thấy người dùng.');
    await this.pool.query(
      'UPDATE identity_schema.tenant_auth_sessions SET revoked_at = now() WHERE tenant_id = $1 AND core_user_id = $2 AND revoked_at IS NULL',
      [tenantId, userId],
    );
  }

  async platformOverview(): Promise<{ tenants: TenantSummary[] }> {
    return { tenants: await this.tenantSummaries() };
  }

  async listTenants(): Promise<TenantSummary[]> {
    return this.tenantSummaries();
  }

  async createTenant(
    input: CreateTenantRequest,
    actorId: string,
  ): Promise<CreateTenantResponse> {
    const slug = input?.slug?.trim().toLowerCase();
    const name = input?.name?.trim();
    const adminEmail = input?.admin?.email?.trim().toLowerCase();
    const adminDisplayName = input?.admin?.displayName?.trim();
    const initialPassword = input?.admin?.initialPassword;
    const databaseName = input?.database?.databaseName?.trim().toLowerCase();
    const host = input?.database?.host?.trim();
    const port = Number(input?.database?.port);
    const secretRef = input?.database?.secretRef?.trim();

    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new BadRequestException(
        'Tenant slug chỉ gồm chữ thường, số và dấu gạch ngang.',
      );
    }
    if (!name || name.length > 180)
      throw new BadRequestException('Tên tenant không hợp lệ.');
    if (
      !adminEmail ||
      adminEmail.length > 255 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)
    ) {
      throw new BadRequestException('Email tenant admin không hợp lệ.');
    }
    if (!adminDisplayName || adminDisplayName.length > 180) {
      throw new BadRequestException('Tên hiển thị tenant admin không hợp lệ.');
    }
    if (
      !initialPassword ||
      initialPassword.length < 12 ||
      initialPassword.length > 128
    ) {
      throw new BadRequestException(
        'Mật khẩu khởi tạo phải có từ 12 đến 128 ký tự.',
      );
    }
    if (!databaseName || !/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
      throw new BadRequestException(
        'Tên database phải là định danh PostgreSQL chữ thường hợp lệ.',
      );
    }
    if (!host || host.length > 255)
      throw new BadRequestException('Database host không hợp lệ.');
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new BadRequestException('Database port không hợp lệ.');
    }
    if (!secretRef || !/^[A-Z][A-Z0-9_]*$/.test(secretRef)) {
      throw new BadRequestException(
        'Secret reference phải là tên biến môi trường viết hoa.',
      );
    }

    const existing = await this.pool.query<{
      slug_taken: boolean;
      email_taken: boolean;
      role_id: string | null;
    }>(
      `SELECT EXISTS (SELECT 1 FROM tenancy_schema.tenants WHERE slug = $1) AS slug_taken,
              EXISTS (SELECT 1 FROM identity_schema.users WHERE lower(email) = lower($2)) AS email_taken,
              (SELECT id FROM authorization_schema.roles
                WHERE key = 'tenant-admin' AND scope = 'tenant' LIMIT 1) AS role_id`,
      [slug, adminEmail],
    );
    if (existing.rows[0]?.slug_taken)
      throw new ConflictException('Tenant slug đã tồn tại.');
    if (existing.rows[0]?.email_taken)
      throw new ConflictException('Email tenant admin đã tồn tại.');
    const tenantAdminRoleId = existing.rows[0]?.role_id;
    if (!tenantAdminRoleId)
      throw new BadRequestException('Role tenant-admin chưa được khởi tạo.');

    const tenantId = randomUUID();
    const userId = randomUUID();
    const membershipId = randomUUID();
    const passwordHash = await this.hashPassword(initialPassword);
    let databaseCreated = false;
    let coreAdminProvisioned = false;
    try {
      await this.createTenantDatabase(databaseName);
      databaseCreated = true;
      await this.provisionTenantCoreAdmin({
        secretRef,
        databaseName,
        userId,
        email: adminEmail,
        fullName: adminDisplayName,
        passwordHash,
      });
      coreAdminProvisioned = true;
      await inPlatformTransaction(this.pool, async (query) => {
        await query(
          `INSERT INTO tenancy_schema.tenants (id, slug, name) VALUES ($1, $2, $3)`,
          [tenantId, slug, name],
        );
        await query(
          `INSERT INTO identity_schema.users
             (id, email, display_name, password_hash, kind)
           VALUES ($1, $2, $3, $4, 'tenant-user')`,
          [userId, adminEmail, adminDisplayName, passwordHash],
        );
        await query(
          `INSERT INTO tenancy_schema.tenant_memberships (id, tenant_id, user_id)
           VALUES ($1, $2, $3)`,
          [membershipId, tenantId, userId],
        );
        await query(
          `INSERT INTO authorization_schema.user_roles
             (user_id, role_id, membership_id, assignment_key)
           VALUES ($1, $2, $3, $4)`,
          [userId, tenantAdminRoleId, membershipId, `${tenantId}:tenant-admin`],
        );
        await query(
          `INSERT INTO tenancy_schema.tenant_db_configs
             (id, tenant_id, database_name, host, port, secret_ref, ssl, config_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
          [
            randomUUID(),
            tenantId,
            databaseName,
            host,
            port,
            secretRef,
            input.database.ssl ?? false,
          ],
        );
        await query(
          `INSERT INTO tenancy_schema.tenant_admin_directory
             (tenant_id, core_user_id, email, full_name)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, userId, adminEmail, adminDisplayName],
        );
        await query(
          `INSERT INTO audit_schema.audit_logs (id, actor_id, tenant_id, action, metadata)
           VALUES ($1, $2, $3, 'platform.tenant.created', $4::jsonb)`,
          [
            randomUUID(),
            actorId,
            tenantId,
            JSON.stringify({ slug, adminEmail, databaseName, secretRef }),
          ],
        );
      });
    } catch (error) {
      if (coreAdminProvisioned)
        await this.removeProvisionedTenantCoreAdmin(
          secretRef,
          databaseName,
          userId,
        );
      if (databaseCreated) await this.dropTenantDatabase(databaseName);
      if (this.isPostgresError(error, '23505')) {
        throw new ConflictException(
          'Tenant slug, admin email hoặc database config đã tồn tại.',
        );
      }
      throw error;
    }
    return { tenant: await this.tenantSummary(tenantId) };
  }

  async createTenantPasswordResetLink(
    tenantId: string,
    actorId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const admin = await this.pool.query<{
      slug: string;
      core_user_id: string;
      status: string;
    }>(
      `SELECT t.slug, d.core_user_id, d.status
         FROM tenancy_schema.tenants t
         JOIN tenancy_schema.tenant_admin_directory d ON d.tenant_id = t.id
        WHERE t.id = $1 AND t.status = 'active'`,
      [tenantId],
    );
    const row = admin.rows[0];
    if (!row || row.status !== 'active') {
      throw new NotFoundException(
        'Không tìm thấy Tenant Admin đang hoạt động.',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1_000);
    await inPlatformTransaction(this.pool, async (query) => {
      await query(
        `UPDATE identity_schema.tenant_password_reset_tokens
            SET used_at = now()
          WHERE tenant_id = $1 AND core_user_id = $2
            AND used_at IS NULL AND expires_at > now()`,
        [tenantId, row.core_user_id],
      );
      await query(
        `INSERT INTO identity_schema.tenant_password_reset_tokens
           (id, tenant_id, core_user_id, token_hash, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          tenantId,
          row.core_user_id,
          this.hash(token),
          expiresAt,
          actorId,
        ],
      );
      await query(
        `INSERT INTO audit_schema.audit_logs (id, actor_id, tenant_id, action, metadata)
         VALUES ($1, $2, $3, 'platform.tenant-admin.password-reset-link.created', $4::jsonb)`,
        [
          randomUUID(),
          actorId,
          tenantId,
          JSON.stringify({
            coreUserId: row.core_user_id,
            expiresAt: expiresAt.toISOString(),
          }),
        ],
      );
    });
    const baseUrl = (
      process.env.WEB_APP_URL ?? 'http://localhost:3002'
    ).replace(/\/$/, '');
    return {
      url: `${baseUrl}/t/${encodeURIComponent(row.slug)}/reset-password?token=${encodeURIComponent(token)}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async resetTenantPassword(input: {
    tenantSlug?: string;
    token?: string;
    password?: string;
  }): Promise<void> {
    const genericError =
      'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.';
    const tenantSlug = input?.tenantSlug?.trim().toLowerCase();
    const token = input?.token?.trim();
    if (
      !tenantSlug ||
      !token ||
      !input?.password ||
      input.password.length < 12 ||
      input.password.length > 128
    ) {
      throw new BadRequestException(genericError);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<TenantResetRow>(
        `SELECT r.id AS token_id, r.tenant_id, r.core_user_id, t.slug AS tenant_slug, db.secret_ref, db.database_name
           FROM identity_schema.tenant_password_reset_tokens r
           JOIN tenancy_schema.tenants t ON t.id = r.tenant_id AND t.slug = $1 AND t.status = 'active'
           JOIN tenancy_schema.tenant_admin_directory d
             ON d.tenant_id = r.tenant_id AND d.core_user_id = r.core_user_id AND d.status = 'active'
           JOIN tenancy_schema.tenant_db_configs db ON db.tenant_id = t.id AND db.status = 'active'
          WHERE r.token_hash = $2 AND r.used_at IS NULL AND r.expires_at > now()
          FOR UPDATE OF r`,
        [tenantSlug, this.hash(token)],
      );
      const reset = result.rows[0];
      if (!reset) throw new BadRequestException(genericError);
      const connectionString = this.tenantConnectionString(
        reset.secret_ref,
        reset.database_name,
      );
      if (!connectionString) throw new BadRequestException(genericError);
      const tenantPool = createPostgresPool(connectionString, {
        max: 1,
        application_name: 'enterprise-platform:password-reset',
      });
      try {
        const update = await tenantPool.query(
          `UPDATE core_schema.users
              SET password_hash = $2, updated_at = now()
            WHERE id = $1 AND status = 'active' AND is_active = true`,
          [reset.core_user_id, await this.hashPassword(input.password)],
        );
        if (update.rowCount !== 1) throw new BadRequestException(genericError);
      } finally {
        await tenantPool.end();
      }
      await client.query(
        `UPDATE identity_schema.tenant_password_reset_tokens
            SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
        [reset.token_id],
      );
      await client.query(
        `UPDATE identity_schema.tenant_auth_sessions SET revoked_at = now()
          WHERE tenant_id = $1 AND core_user_id = $2 AND revoked_at IS NULL`,
        [reset.tenant_id, reset.core_user_id],
      );
      await client.query(
        `INSERT INTO audit_schema.audit_logs (id, tenant_id, action, metadata)
         VALUES ($1, $2, 'tenant.admin.password-reset.completed', $3::jsonb)`,
        [
          randomUUID(),
          reset.tenant_id,
          JSON.stringify({ coreUserId: reset.core_user_id }),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(genericError);
    } finally {
      client.release();
    }
  }

  async updateTenant(
    tenantId: string,
    input: UpdateTenantRequest,
    actorId: string,
  ): Promise<TenantSummary> {
    const name = input?.name?.trim() || null;
    const status = input?.status ?? null;
    if (!name && !status)
      throw new BadRequestException('Không có thay đổi tenant hợp lệ.');
    if (name && name.length > 180)
      throw new BadRequestException('Tên tenant không hợp lệ.');
    if (status && !['active', 'disabled'].includes(status)) {
      throw new BadRequestException('Trạng thái tenant không hợp lệ.');
    }
    const result = await this.pool.query<{ id: string }>(
      `UPDATE tenancy_schema.tenants
          SET name = coalesce($2, name), status = coalesce($3, status)
        WHERE id = $1
        RETURNING id`,
      [tenantId, name, status],
    );
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy tenant.');
    await this.pool.query(
      `INSERT INTO audit_schema.audit_logs (id, actor_id, tenant_id, action, metadata)
       VALUES ($1, $2, $3, 'platform.tenant.updated', $4::jsonb)`,
      [randomUUID(), actorId, tenantId, JSON.stringify({ name, status })],
    );
    return this.tenantSummary(tenantId);
  }

  async tenantEntitlementOverview(
    tenantId: string,
  ): Promise<TenantEntitlementOverview> {
    const tenant = await this.tenantSummary(tenantId);
    const modules = await this.pool.query<TenantModuleEntitlement>(
      `SELECT mo.key, mo.name, mo.description, mo.launch_url AS "launchUrl",
              mo.icon, mo.version,
              coalesce(e.status, 'not-entitled') AS "entitlementStatus",
              e.provisioned_version AS "provisionedVersion",
              e.updated_at AS "updatedAt",
              CASE WHEN job.id IS NULL THEN NULL ELSE jsonb_build_object(
                'status', job.status,
                'targetVersion', job.target_version,
                'error', job.error,
                'createdAt', job.created_at,
                'completedAt', job.completed_at
              ) END AS "latestJob"
         FROM module_registry_schema.modules mo
         LEFT JOIN subscription_schema.tenant_entitlements e
           ON e.module_id = mo.id AND e.tenant_id = $1
         LEFT JOIN LATERAL (
           SELECT j.id, j.status, j.target_version, j.error, j.created_at, j.completed_at
             FROM integration_schema.provisioning_jobs j
            WHERE j.tenant_id = $1 AND j.module_key = mo.key
            ORDER BY j.created_at DESC
            LIMIT 1
         ) job ON true
        WHERE mo.status = 'active'
        ORDER BY mo.name`,
      [tenantId],
    );
    return { tenant, modules: modules.rows };
  }

  async setEntitlement(
    tenantId: string,
    moduleKey: string,
    enabled: boolean,
    actorId: string,
  ): Promise<SetTenantEntitlementResponse> {
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('Trường enabled phải là boolean.');
    }
    await this.tenantSummary(tenantId);
    const module = await this.pool.query<{ id: string; version: string }>(
      "SELECT id, version FROM module_registry_schema.modules WHERE key = $1 AND status = 'active'",
      [moduleKey],
    );
    const registered = module.rows[0];
    if (!registered) throw new NotFoundException('Module chưa được đăng ký.');
    if (!enabled) {
      const current = await this.pool.query<{ id: string }>(
        `SELECT id FROM subscription_schema.tenant_entitlements
          WHERE tenant_id = $1 AND module_id = $2`,
        [tenantId, registered.id],
      );
      if (!current.rows[0]) return { status: 'not-entitled' };
      await inPlatformTransaction(this.pool, async (query) => {
        await query(
          `UPDATE integration_schema.provisioning_jobs
              SET status = 'cancelled', completed_at = now(), error = 'Entitlement disabled by platform admin.'
            WHERE tenant_id = $1 AND module_key = $2 AND status IN ('pending', 'processing')`,
          [tenantId, moduleKey],
        );
        await query(
          `UPDATE subscription_schema.tenant_entitlements SET status = 'disabled', updated_at = now()
            WHERE tenant_id = $1 AND module_id = $2`,
          [tenantId, registered.id],
        );
        await query(
          `INSERT INTO audit_schema.audit_logs (id, actor_id, tenant_id, action, metadata)
           VALUES ($1, $2, $3, 'platform.entitlement.disabled', $4::jsonb)`,
          [randomUUID(), actorId, tenantId, JSON.stringify({ moduleKey })],
        );
        await this.appendEntitlementEvent(query, tenantId, moduleKey, false);
      });
      return { status: 'disabled' };
    }
    await inPlatformTransaction(this.pool, async (query) => {
      await query(
        `UPDATE integration_schema.provisioning_jobs
            SET status = 'cancelled', completed_at = now(), error = 'Superseded by a newer provisioning request.'
          WHERE tenant_id = $1 AND module_key = $2 AND status IN ('pending', 'processing')`,
        [tenantId, moduleKey],
      );
      await query(
        `INSERT INTO subscription_schema.tenant_entitlements
           (id, tenant_id, module_id, status, provisioned_version)
         VALUES ($1, $2, $3, 'provisioning', NULL)
         ON CONFLICT (tenant_id, module_id)
         DO UPDATE SET status = 'provisioning', updated_at = now()`,
        [randomUUID(), tenantId, registered.id],
      );
      await query(
        `INSERT INTO integration_schema.provisioning_jobs
           (id, tenant_id, module_key, target_version, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [randomUUID(), tenantId, moduleKey, registered.version],
      );
      await query(
        `INSERT INTO audit_schema.audit_logs (id, actor_id, tenant_id, action, metadata)
         VALUES ($1, $2, $3, 'platform.entitlement.provisioning_requested', $4::jsonb)`,
        [
          randomUUID(),
          actorId,
          tenantId,
          JSON.stringify({ moduleKey, targetVersion: registered.version }),
        ],
      );
      await this.appendEntitlementEvent(query, tenantId, moduleKey, true);
    });
    return { status: 'provisioning' };
  }

  private async appendEntitlementEvent(
    query: (text: string, values?: unknown[]) => Promise<unknown>,
    tenantId: string,
    moduleKey: string,
    enabled: boolean,
  ): Promise<void> {
    const event = createIntegrationEvent({
      id: randomUUID(),
      type: 'platform.entitlement.changed',
      version: 1,
      tenantId,
      source: 'platform-core',
      correlationId: tenantId,
      payload: { tenantId, moduleKey, enabled },
    });
    await query(
      `INSERT INTO integration_schema.outbox_events
       (id,aggregate_type,aggregate_id,event_type,event_version,payload,occurred_at)
       VALUES ($1,'tenant-entitlement',$2,$3,$4,$5::jsonb,$6)`,
      [
        event.id,
        tenantId,
        event.type,
        event.version,
        JSON.stringify(event),
        event.occurredAt,
      ],
    );
  }

  async tenantMembers(tenantId: string): Promise<unknown[]> {
    const result = await this.pool.query(
      `SELECT m.id, u.id AS "userId", u.email, u.display_name AS "displayName", m.status,
              coalesce(array_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles
         FROM tenancy_schema.tenant_memberships m
         JOIN identity_schema.users u ON u.id = m.user_id
         LEFT JOIN authorization_schema.user_roles ur ON ur.membership_id = m.id
         LEFT JOIN authorization_schema.roles r ON r.id = ur.role_id
        WHERE m.tenant_id = $1 GROUP BY m.id, u.id ORDER BY u.display_name`,
      [tenantId],
    );
    return result.rows;
  }

  async assignTenantRole(
    tenantId: string,
    membershipId: string,
    roleKey: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO authorization_schema.user_roles (user_id, role_id, membership_id, assignment_key)
       SELECT m.user_id, r.id, m.id, concat(m.id::text, ':', r.key)
         FROM tenancy_schema.tenant_memberships m
         JOIN authorization_schema.roles r ON r.key = $3 AND r.scope = 'tenant'
        WHERE m.id = $2 AND m.tenant_id = $1
       ON CONFLICT (assignment_key) DO NOTHING`,
      [tenantId, membershipId, roleKey],
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async tenantSummaries(tenantId?: string): Promise<TenantSummary[]> {
    const result = await this.pool.query<TenantSummary>(
      `SELECT t.id, t.slug, t.name, t.status, t.created_at AS "createdAt",
              CASE WHEN admin.core_user_id IS NULL THEN NULL ELSE jsonb_build_object(
                'userId', admin.core_user_id,
                'email', admin.email,
                'displayName', admin.display_name
              ) END AS admin,
              CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
                'databaseName', d.database_name,
                'host', d.host,
                'port', d.port,
                'secretRef', d.secret_ref,
                'ssl', d.ssl,
                'status', d.status
              ) END AS database,
              coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'key', mo.key,
                    'name', mo.name,
                    'version', mo.version,
                    'status', e.status
                  ) ORDER BY mo.name
                ) FILTER (WHERE mo.id IS NOT NULL),
                '[]'::jsonb
              ) AS modules
         FROM tenancy_schema.tenants t
         LEFT JOIN LATERAL (
           SELECT d.core_user_id, d.email, d.full_name AS display_name
             FROM tenancy_schema.tenant_admin_directory d
            WHERE d.tenant_id = t.id
            LIMIT 1
         ) admin ON true
         LEFT JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = t.id
         LEFT JOIN subscription_schema.tenant_entitlements e ON e.tenant_id = t.id
         LEFT JOIN module_registry_schema.modules mo ON mo.id = e.module_id
        WHERE ($1::uuid IS NULL OR t.id = $1::uuid)
        GROUP BY t.id, admin.core_user_id, admin.email, admin.display_name,
                 d.id, d.database_name, d.host, d.port, d.secret_ref, d.ssl, d.status
        ORDER BY t.name`,
      [tenantId ?? null],
    );
    return result.rows;
  }

  private async tenantSummary(tenantId: string): Promise<TenantSummary> {
    const tenant = (await this.tenantSummaries(tenantId))[0];
    if (!tenant) throw new NotFoundException('Không tìm thấy tenant.');
    return tenant;
  }

  private async membershipId(
    userId: string,
    tenantId: string,
  ): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM tenancy_schema.tenant_memberships
        WHERE user_id = $1 AND tenant_id = $2 AND status = 'active' LIMIT 1`,
      [userId, tenantId],
    );
    return result.rows[0]?.id ?? '';
  }

  private async createPrincipal(
    row: LoginRow,
    sessionId: string,
    queryable: Pick<typeof this.pool, 'query'> = this.pool,
  ): Promise<AuthenticatedPrincipal> {
    const access = await this.rolesAndPermissions(
      row.id,
      row.membership_id,
      queryable,
    );
    const base = {
      userId: row.id,
      sessionId,
      email: row.email,
      displayName: row.display_name,
      ...access,
    };
    if (row.kind === 'platform-admin')
      return { kind: 'platform-admin', ...base };
    if (!row.tenant_id || !row.tenant_slug || !row.membership_id) {
      throw new UnauthorizedException(
        'Tài khoản không có tenant đang hoạt động.',
      );
    }
    return {
      kind: 'tenant-user',
      ...base,
      tenantId: row.tenant_id,
      tenantSlug: row.tenant_slug,
      membershipId: row.membership_id,
    };
  }

  private async rolesAndPermissions(
    userId: string,
    membershipId: string | null,
    queryable: Pick<typeof this.pool, 'query'> = this.pool,
  ): Promise<{ roles: string[]; permissions: string[] }> {
    const result = await queryable.query<{
      roles: string[];
      permissions: string[];
    }>(
      `SELECT coalesce(array_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles,
              coalesce(array_agg(DISTINCT p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS permissions
         FROM authorization_schema.user_roles ur
         JOIN authorization_schema.roles r ON r.id = ur.role_id
         LEFT JOIN authorization_schema.role_permissions rp ON rp.role_id = r.id
         LEFT JOIN authorization_schema.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = $1 AND ur.membership_id IS NOT DISTINCT FROM $2`,
      [userId, membershipId],
    );
    return result.rows[0] ?? { roles: [], permissions: [] };
  }

  private async sign(principal: AuthenticatedPrincipal): Promise<string> {
    const { privateKey } = await this.keys;
    return new SignJWT({ principal })
      .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
      .setSubject(principal.userId)
      .setIssuer('enterprise-platform')
      .setAudience('enterprise-platform-apps')
      .setIssuedAt()
      .setExpirationTime('60m')
      .sign(privateKey);
  }

  private async loadKeys() {
    const privatePem = process.env.AUTH_PRIVATE_KEY?.replaceAll('\\n', '\n');
    const publicPem = process.env.AUTH_PUBLIC_KEY?.replaceAll('\\n', '\n');
    const pair =
      privatePem && publicPem
        ? {
            privateKey: await importPKCS8(privatePem, 'RS256'),
            publicKey: await importSPKI(publicPem, 'RS256'),
          }
        : await generateKeyPair('RS256', { modulusLength: 2048 });
    const jwk = await exportJWK(pair.publicKey);
    jwk.kid = KEY_ID;
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    return { ...pair, jwk };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('base64url');
    const derived = (await derivePassword(password, salt, 64)) as Buffer;
    return `scrypt$${salt}$${derived.toString('base64url')}`;
  }

  private async provisionTenantCoreAdmin(input: {
    secretRef: string;
    databaseName: string;
    userId: string;
    email: string;
    fullName: string;
    passwordHash: string;
  }): Promise<void> {
    const connectionString = this.tenantConnectionString(
      input.secretRef,
      input.databaseName,
    );
    const migrationPath = join(
      process.cwd(),
      'migrations',
      'tenant',
      'core',
      '0001-core-schema.sql',
    );
    const pool = createPostgresPool(connectionString, {
      max: 1,
      application_name: 'enterprise-platform:tenant-provisioning',
    });
    try {
      await pool.query(await readFile(migrationPath, 'utf8'));
      await pool.query(
        await readFile(
          join(
            process.cwd(),
            'migrations',
            'tenant',
            'core',
            '0002-organization-soft-delete.sql',
          ),
          'utf8',
        ),
      );
      await pool.query(
        await readFile(
          join(
            process.cwd(),
            'migrations',
            'tenant',
            'core',
            '0003-organization-tree-layout.sql',
          ),
          'utf8',
        ),
      );
      await pool.query(
        `INSERT INTO core_schema.users
           (id, username, full_name, email, password_hash, system_role)
         VALUES ($1, $2, $3, $2, $4, 'tenant-admin')`,
        [input.userId, input.email, input.fullName, input.passwordHash],
      );
    } finally {
      await pool.end();
    }
  }

  private async removeProvisionedTenantCoreAdmin(
    secretRef: string,
    databaseName: string,
    userId: string,
  ): Promise<void> {
    const connectionString = this.tenantConnectionString(
      secretRef,
      databaseName,
    );
    const pool = createPostgresPool(connectionString, {
      max: 1,
      application_name: 'enterprise-platform:tenant-provisioning-cleanup',
    });
    try {
      await pool.query('DELETE FROM core_schema.users WHERE id = $1', [userId]);
    } catch {
      // Preserve the original Platform transaction error; cleanup can be retried operationally.
    } finally {
      await pool.end();
    }
  }

  private tenantConnectionString(
    secretRef: string,
    databaseName: string,
  ): string {
    try {
      return resolveTenantDatabaseUrl(secretRef, databaseName);
    } catch {
      throw new BadRequestException(
        'Không tìm thấy database secret dành cho tenant.',
      );
    }
  }

  private async withTenantCoreDatabase<T>(
    tenantId: string,
    operation: (pool: ReturnType<typeof createPostgresPool>) => Promise<T>,
  ): Promise<T> {
    const config = await this.pool.query<{
      secret_ref: string;
      database_name: string;
    }>(
      `SELECT secret_ref, database_name FROM tenancy_schema.tenant_db_configs
        WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
      [tenantId],
    );
    const database = config.rows[0];
    if (!database)
      throw new NotFoundException('Tenant chưa có database đang hoạt động.');
    const pool = createPostgresPool(
      this.tenantConnectionString(database.secret_ref, database.database_name),
      {
        max: 2,
        application_name: 'enterprise-platform:tenant-user-management',
      },
    );
    try {
      return await operation(pool);
    } finally {
      await pool.end();
    }
  }

  private async createTenantDatabase(databaseName: string): Promise<void> {
    const adminUrl = process.env.TENANT_DATABASE_ADMIN_URL;
    if (!adminUrl) {
      throw new BadRequestException(
        'TENANT_DATABASE_ADMIN_URL chưa được cấu hình.',
      );
    }
    const pool = createPostgresPool(adminUrl, {
      max: 1,
      application_name: 'enterprise-platform:database-provisioning',
    });
    try {
      await pool.query(`CREATE DATABASE "${databaseName}"`);
    } catch (error) {
      if (this.isPostgresError(error, '42P04')) {
        throw new ConflictException('Database dành cho tenant đã tồn tại.');
      }
      throw error;
    } finally {
      await pool.end();
    }
  }

  private async dropTenantDatabase(databaseName: string): Promise<void> {
    const adminUrl = process.env.TENANT_DATABASE_ADMIN_URL;
    if (!adminUrl) return;
    const pool = createPostgresPool(adminUrl, {
      max: 1,
      application_name: 'enterprise-platform:database-provisioning-cleanup',
    });
    try {
      await pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } catch {
      // Keep the provisioning error as the primary error; operational cleanup can retry this database.
    } finally {
      await pool.end();
    }
  }

  private isPostgresError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === code
    );
  }

  private async verifyPassword(
    stored: string,
    password: string,
  ): Promise<boolean> {
    const [algorithm, salt, encoded] = stored.split('$');
    if (algorithm !== 'scrypt' || !salt || !encoded) return false;
    const expected = Buffer.from(encoded, 'base64url');
    const actual = (await derivePassword(
      password,
      salt,
      expected.length,
    )) as Buffer;
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
}

async function inPlatformTransaction(
  pool: ReturnType<typeof createPostgresPool>,
  operation: (
    query: (text: string, values?: unknown[]) => Promise<unknown>,
  ) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await operation((text, values = []) => client.query(text, values));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

type OrganizationQueryable = {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

type OrganizationTreeRow = {
  id: string;
  code: string;
  name: string;
};

type OrganizationTreeAssignee = {
  id: string;
  name: string;
  email: string;
  isPrimary: boolean;
};

type OrganizationTreeNodeRow = {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  typeId: string;
  typeCode: string;
  typeName: string;
  typeCategory: 'unit' | 'position';
  assignees: OrganizationTreeAssignee[];
};

type OrganizationTreeNode = Omit<OrganizationTreeNodeRow, 'parentId'> & {
  children: OrganizationTreeNode[];
};

function toOrganizationTree(
  rows: OrganizationTreeNodeRow[],
): OrganizationTreeNode[] {
  const nodes = new Map<string, OrganizationTreeNode>();
  const children = new Map<string, OrganizationTreeNode[]>();
  const roots: OrganizationTreeNode[] = [];

  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      code: row.code,
      name: row.name,
      typeId: row.typeId,
      typeCode: row.typeCode,
      typeName: row.typeName,
      typeCategory: row.typeCategory,
      assignees: row.assignees,
      children: [],
    });
  }
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (!node) continue;
    if (!row.parentId || !nodes.has(row.parentId)) {
      roots.push(node);
      continue;
    }
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(node);
    children.set(row.parentId, siblings);
  }
  for (const [parentId, childNodes] of children) {
    const parent = nodes.get(parentId);
    if (parent) parent.children = childNodes;
  }
  return roots;
}

function requireOrganizationResource(
  resource: string,
):
  | 'organization_trees'
  | 'organization_node_types'
  | 'organization_nodes'
  | 'organization_node_assignments' {
  const targets = {
    trees: 'organization_trees',
    'node-types': 'organization_node_types',
    nodes: 'organization_nodes',
    assignments: 'organization_node_assignments',
  } as const;
  const target = targets[resource as keyof typeof targets];
  if (!target)
    throw new NotFoundException('Tài nguyên sơ đồ tổ chức không hợp lệ.');
  return target;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function nullableString(value: unknown): string | null {
  return optionalString(value);
}
function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
function category(value: unknown): 'unit' | 'position' {
  if (value === 'unit' || value === 'position') return value;
  throw new BadRequestException('Nhóm node phải là UNIT hoặc POSITION.');
}
function organizationStatus(value: unknown): string | null {
  if (value === undefined) return null;
  if (['active', 'inactive', 'archived'].includes(String(value)))
    return String(value);
  throw new BadRequestException('Trạng thái tổ chức không hợp lệ.');
}
function organizationAssignmentStatus(value: unknown): string | null {
  if (value === undefined) return null;
  if (['active', 'inactive', 'ended'].includes(String(value)))
    return String(value);
  throw new BadRequestException('Trạng thái bổ nhiệm không hợp lệ.');
}

function organizationTreePositions(
  value: unknown,
): Record<string, { x: number; y: number }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Tọa độ sơ đồ không hợp lệ.');
  }
  const entries = Object.entries(value);
  if (entries.length > 5000) {
    throw new BadRequestException('Sơ đồ vượt quá giới hạn 5.000 node.');
  }
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [id, position] of entries) {
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      throw new BadRequestException('Tọa độ node không hợp lệ.');
    }
    const { x, y } = position as { x?: unknown; y?: unknown };
    if (
      typeof x !== 'number' ||
      !Number.isFinite(x) ||
      Math.abs(x) > 1_000_000 ||
      typeof y !== 'number' ||
      !Number.isFinite(y) ||
      Math.abs(y) > 1_000_000
    ) {
      throw new BadRequestException('Tọa độ node không hợp lệ.');
    }
    positions[id] = { x, y };
  }
  return positions;
}

async function validateNodeParent(
  pool: OrganizationQueryable,
  treeId: string,
  parentId: string | null,
  nodeId: string,
): Promise<void> {
  if (!parentId) return;
  if (parentId === nodeId)
    throw new BadRequestException('Node không thể là node cha của chính nó.');
  const parent = await pool.query<{
    tree_id: string;
    parent_id: string | null;
  }>(
    'SELECT tree_id,parent_id FROM core_schema.organization_nodes WHERE id=$1 AND deleted_at IS NULL',
    [parentId],
  );
  if (!parent.rows[0] || parent.rows[0].tree_id !== treeId)
    throw new BadRequestException('Node cha phải thuộc cùng sơ đồ tổ chức.');
  let cursor = parent.rows[0];
  while (cursor.parent_id) {
    if (cursor.parent_id === nodeId)
      throw new BadRequestException(
        'Không thể tạo vòng lặp trong sơ đồ tổ chức.',
      );
    const row = await pool.query<{ tree_id: string; parent_id: string | null }>(
      'SELECT tree_id,parent_id FROM core_schema.organization_nodes WHERE id=$1 AND deleted_at IS NULL',
      [cursor.parent_id],
    );
    if (!row.rows[0]) break;
    cursor = row.rows[0];
  }
}

async function validateAssignment(
  pool: OrganizationQueryable,
  nodeId: string,
  userId: string,
  startDate: string | null,
  endDate: string | null,
): Promise<void> {
  if (startDate && endDate && startDate > endDate)
    throw new BadRequestException('Ngày bắt đầu không thể sau ngày kết thúc.');
  const [node, user] = await Promise.all([
    pool.query<{ category: string }>(
      `SELECT t.category FROM core_schema.organization_nodes n JOIN core_schema.organization_node_types t ON t.id=n.node_type_id WHERE n.id=$1 AND n.deleted_at IS NULL AND t.deleted_at IS NULL`,
      [nodeId],
    ),
    pool.query(
      `SELECT 1 FROM core_schema.users WHERE id=$1 AND status='active' AND is_active=true`,
      [userId],
    ),
  ]);
  if (node.rows[0]?.category !== 'position')
    throw new BadRequestException(
      'Chỉ có thể bổ nhiệm vào node loại POSITION.',
    );
  if (!user.rows[0])
    throw new BadRequestException(
      'Người dùng không tồn tại hoặc đã ngừng hoạt động.',
    );
}
