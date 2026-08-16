import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import type {
  AccessDecisionRequest,
  AccessDecisionResponse,
  AuthenticatedPrincipal,
  LoginRequest,
  TenantUserPrincipal,
} from '@enterprise-platform/contracts-identity';
import type {
  AssignOrganizationMemberRequest,
  CreateOrganizationPositionRequest,
  CreateOrganizationUnitRequest,
  CreateOrganizationUnitTypeRequest,
  TenantOrganizationSnapshot,
  UpdateOrganizationUnitRequest,
  UpdateOrganizationUnitTypeRequest,
} from '@enterprise-platform/contracts-organization';
import type {
  CreateTenantRequest,
  CreateTenantResponse,
  SetTenantEntitlementResponse,
  TenantDatabaseReference,
  TenantEntitlementOverview,
  TenantModuleEntitlement,
  TenantSummary,
  UpdateTenantRequest,
} from '@enterprise-platform/contracts-tenancy';
import { PlatformOrganizationStore } from '@enterprise-platform/platform-organization';
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
  private readonly organization = new PlatformOrganizationStore();

  async login(input: LoginRequest): Promise<{
    principal: AuthenticatedPrincipal;
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
  }> {
    const email = input?.email?.trim();
    if (!email || !input.password || !['platform', 'tenant'].includes(input.portal)) {
      throw new BadRequestException('Thông tin đăng nhập không hợp lệ.');
    }
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
    if (!row || !(await this.verifyPassword(row.password_hash, input.password))) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    }
    const expectedKind = input.portal === 'platform' ? 'platform-admin' : 'tenant-user';
    if (row.kind !== expectedKind) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    }
    if (row.kind === 'tenant-user' && (!row.tenant_id || !row.membership_id)) {
      throw new UnauthorizedException('Tài khoản không có tenant đang hoạt động.');
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

  async refresh(refreshToken: string, csrfToken: string): Promise<{
    principal: AuthenticatedPrincipal;
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const sessionResult = await client.query<LoginRow & { session_id: string }>(
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

  async logout(sessionId: string): Promise<void> {
    await this.pool.query(
      'UPDATE identity_schema.auth_sessions SET revoked_at = now() WHERE id = $1',
      [sessionId],
    );
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
      [input.tenantId, input.userId, membershipId, input.moduleKey, input.sessionId],
    );
    const row = result.rows[0];
    if (!row || !row.session_active) return { allowed: false, code: 'SESSION_INACTIVE' };
    if (!row.membership_active) return { allowed: false, code: 'MEMBERSHIP_INACTIVE' };
    if (!row.entitled) return { allowed: false, code: 'MODULE_NOT_ENTITLED' };
    const access = await this.rolesAndPermissions(input.userId, row.membership_id);
    if (!access.permissions.includes(input.permission)) {
      return { allowed: false, code: 'PERMISSION_DENIED' };
    }
    const principal: TenantUserPrincipal = {
      kind: 'tenant-user', userId: input.userId, sessionId: input.sessionId,
      email: row.email, displayName: row.display_name,
      tenantId: row.tenant_id, tenantSlug: row.tenant_slug,
      membershipId: row.membership_id, ...access,
    };
    const database: TenantDatabaseReference = {
      tenantId: row.tenant_id, databaseName: row.database_name,
      host: row.host, port: row.port, secretRef: row.secret_ref,
      ssl: row.ssl, configVersion: row.config_version,
    };
    return {
      allowed: true, principal, database,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
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

  async platformOverview(): Promise<{ tenants: TenantSummary[] }> {
    return { tenants: await this.tenantSummaries() };
  }

  async listTenants(): Promise<TenantSummary[]> {
    return this.tenantSummaries();
  }

  async createTenant(input: CreateTenantRequest, actorId: string): Promise<CreateTenantResponse> {
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
      throw new BadRequestException('Tenant slug chỉ gồm chữ thường, số và dấu gạch ngang.');
    }
    if (!name || name.length > 180) throw new BadRequestException('Tên tenant không hợp lệ.');
    if (!adminEmail || adminEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      throw new BadRequestException('Email tenant admin không hợp lệ.');
    }
    if (!adminDisplayName || adminDisplayName.length > 180) {
      throw new BadRequestException('Tên hiển thị tenant admin không hợp lệ.');
    }
    if (!initialPassword || initialPassword.length < 12 || initialPassword.length > 128) {
      throw new BadRequestException('Mật khẩu khởi tạo phải có từ 12 đến 128 ký tự.');
    }
    if (!databaseName || !/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
      throw new BadRequestException('Tên database phải là định danh PostgreSQL chữ thường hợp lệ.');
    }
    if (!host || host.length > 255) throw new BadRequestException('Database host không hợp lệ.');
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new BadRequestException('Database port không hợp lệ.');
    }
    if (!secretRef || !/^[A-Z][A-Z0-9_]*$/.test(secretRef)) {
      throw new BadRequestException('Secret reference phải là tên biến môi trường viết hoa.');
    }

    const existing = await this.pool.query<{ slug_taken: boolean; email_taken: boolean; role_id: string | null }>(
      `SELECT EXISTS (SELECT 1 FROM tenancy_schema.tenants WHERE slug = $1) AS slug_taken,
              EXISTS (SELECT 1 FROM identity_schema.users WHERE lower(email) = lower($2)) AS email_taken,
              (SELECT id FROM authorization_schema.roles
                WHERE key = 'tenant-admin' AND scope = 'tenant' LIMIT 1) AS role_id`,
      [slug, adminEmail],
    );
    if (existing.rows[0]?.slug_taken) throw new ConflictException('Tenant slug đã tồn tại.');
    if (existing.rows[0]?.email_taken) throw new ConflictException('Email tenant admin đã tồn tại.');
    const tenantAdminRoleId = existing.rows[0]?.role_id;
    if (!tenantAdminRoleId) throw new BadRequestException('Role tenant-admin chưa được khởi tạo.');

    const tenantId = randomUUID();
    const userId = randomUUID();
    const membershipId = randomUUID();
    const passwordHash = await this.hashPassword(initialPassword);
    try {
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
          [randomUUID(), tenantId, databaseName, host, port, secretRef, input.database.ssl ?? false],
        );
        await query(
          `INSERT INTO audit_schema.audit_logs (id, actor_id, tenant_id, action, metadata)
           VALUES ($1, $2, $3, 'platform.tenant.created', $4::jsonb)`,
          [randomUUID(), actorId, tenantId, JSON.stringify({ slug, adminEmail, databaseName, secretRef })],
        );
      });
    } catch (error) {
      if (this.isPostgresError(error, '23505')) {
        throw new ConflictException('Tenant slug, admin email hoặc database config đã tồn tại.');
      }
      throw error;
    }
    return { tenant: await this.tenantSummary(tenantId) };
  }

  async updateTenant(tenantId: string, input: UpdateTenantRequest, actorId: string): Promise<TenantSummary> {
    const name = input?.name?.trim() || null;
    const status = input?.status ?? null;
    if (!name && !status) throw new BadRequestException('Không có thay đổi tenant hợp lệ.');
    if (name && name.length > 180) throw new BadRequestException('Tên tenant không hợp lệ.');
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

  async tenantEntitlementOverview(tenantId: string): Promise<TenantEntitlementOverview> {
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
      'SELECT id, version FROM module_registry_schema.modules WHERE key = $1 AND status = \'active\'',
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
        [randomUUID(), actorId, tenantId, JSON.stringify({ moduleKey, targetVersion: registered.version })],
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
      [event.id, tenantId, event.type, event.version, JSON.stringify(event), event.occurredAt],
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

  async assignTenantRole(tenantId: string, membershipId: string, roleKey: string): Promise<void> {
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

  organizationSnapshot(tenantId: string): Promise<TenantOrganizationSnapshot> {
    return this.organization.snapshot(tenantId);
  }

  createOrganizationUnitType(
    tenantId: string,
    input: CreateOrganizationUnitTypeRequest,
  ) {
    return this.organization.createUnitType(tenantId, input);
  }

  updateOrganizationUnitType(
    tenantId: string,
    typeId: string,
    input: UpdateOrganizationUnitTypeRequest,
  ) {
    return this.organization.updateUnitType(tenantId, typeId, input);
  }

  deleteOrganizationUnitType(tenantId: string, typeId: string) {
    return this.organization.deleteUnitType(tenantId, typeId);
  }

  createOrganizationUnit(
    tenantId: string,
    input: CreateOrganizationUnitRequest,
  ) {
    return this.organization.createUnit(tenantId, input);
  }

  updateOrganizationUnit(
    tenantId: string,
    unitId: string,
    input: UpdateOrganizationUnitRequest,
  ) {
    return this.organization.updateUnit(tenantId, unitId, input);
  }

  deleteOrganizationUnit(tenantId: string, unitId: string) {
    return this.organization.deleteUnit(tenantId, unitId);
  }

  createOrganizationPosition(
    tenantId: string,
    input: CreateOrganizationPositionRequest,
  ) {
    return this.organization.createPosition(tenantId, input);
  }

  assignOrganizationMember(
    tenantId: string,
    unitId: string,
    input: AssignOrganizationMemberRequest,
  ) {
    return this.organization.assignMember(tenantId, unitId, input);
  }

  removeOrganizationMember(
    tenantId: string,
    unitId: string,
    membershipId: string,
  ) {
    return this.organization.removeMember(tenantId, unitId, membershipId);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.pool.end(), this.organization.close()]);
  }

  private async tenantSummaries(tenantId?: string): Promise<TenantSummary[]> {
    const result = await this.pool.query<TenantSummary>(
      `SELECT t.id, t.slug, t.name, t.status, t.created_at AS "createdAt",
              CASE WHEN admin.user_id IS NULL THEN NULL ELSE jsonb_build_object(
                'userId', admin.user_id,
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
           SELECT u.id AS user_id, u.email, u.display_name
             FROM tenancy_schema.tenant_memberships m
             JOIN identity_schema.users u ON u.id = m.user_id
             JOIN authorization_schema.user_roles ur ON ur.membership_id = m.id
             JOIN authorization_schema.roles r ON r.id = ur.role_id
            WHERE m.tenant_id = t.id AND r.key = 'tenant-admin'
            ORDER BY m.created_at
            LIMIT 1
         ) admin ON true
         LEFT JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = t.id
         LEFT JOIN subscription_schema.tenant_entitlements e ON e.tenant_id = t.id
         LEFT JOIN module_registry_schema.modules mo ON mo.id = e.module_id
        WHERE ($1::uuid IS NULL OR t.id = $1::uuid)
        GROUP BY t.id, admin.user_id, admin.email, admin.display_name,
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

  private async membershipId(userId: string, tenantId: string): Promise<string> {
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
    const access = await this.rolesAndPermissions(row.id, row.membership_id, queryable);
    const base = {
      userId: row.id, sessionId, email: row.email,
      displayName: row.display_name, ...access,
    };
    if (row.kind === 'platform-admin') return { kind: 'platform-admin', ...base };
    if (!row.tenant_id || !row.tenant_slug || !row.membership_id) {
      throw new UnauthorizedException('Tài khoản không có tenant đang hoạt động.');
    }
    return {
      kind: 'tenant-user', ...base, tenantId: row.tenant_id,
      tenantSlug: row.tenant_slug, membershipId: row.membership_id,
    };
  }

  private async rolesAndPermissions(
    userId: string,
    membershipId: string | null,
    queryable: Pick<typeof this.pool, 'query'> = this.pool,
  ): Promise<{ roles: string[]; permissions: string[] }> {
    const result = await queryable.query<{ roles: string[]; permissions: string[] }>(
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
      .setSubject(principal.userId).setIssuer('enterprise-platform')
      .setAudience('enterprise-platform-apps').setIssuedAt()
      .setExpirationTime('15m').sign(privateKey);
  }

  private async loadKeys() {
    const privatePem = process.env.AUTH_PRIVATE_KEY?.replaceAll('\\n', '\n');
    const publicPem = process.env.AUTH_PUBLIC_KEY?.replaceAll('\\n', '\n');
    const pair = privatePem && publicPem
      ? { privateKey: await importPKCS8(privatePem, 'RS256'), publicKey: await importSPKI(publicPem, 'RS256') }
      : await generateKeyPair('RS256', { modulusLength: 2048 });
    const jwk = await exportJWK(pair.publicKey);
    jwk.kid = KEY_ID; jwk.alg = 'RS256'; jwk.use = 'sig';
    return { ...pair, jwk };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('base64url');
    const derived = await derivePassword(password, salt, 64) as Buffer;
    return `scrypt$${salt}$${derived.toString('base64url')}`;
  }

  private isPostgresError(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
  }

  private async verifyPassword(stored: string, password: string): Promise<boolean> {
    const [algorithm, salt, encoded] = stored.split('$');
    if (algorithm !== 'scrypt' || !salt || !encoded) return false;
    const expected = Buffer.from(encoded, 'base64url');
    const actual = await derivePassword(password, salt, expected.length) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

async function inPlatformTransaction(
  pool: ReturnType<typeof createPostgresPool>,
  operation: (query: (text: string, values?: unknown[]) => Promise<unknown>) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await operation((text, values = []) => client.query(text, values));
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
