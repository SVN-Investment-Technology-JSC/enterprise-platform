import type {
  AccessDecisionRequest,
  AuthenticatedPrincipal,
  PlatformAdminPrincipal,
  TenantUserPrincipal,
} from '@enterprise-platform/contracts-identity';
import { TENANT_PERMISSION_ACTIONS } from '@enterprise-platform/contracts-identity';
import type {
  CreateTenantRequest,
  SetTenantEntitlementRequest,
  UpdateTenantRequest,
} from '@enterprise-platform/contracts-tenancy';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformIdentityService } from './platform-identity.service.js';

@Controller('platform')
export class PlatformAccessController {
  constructor(private readonly identity: PlatformIdentityService) {}

  @Post('internal/v1/access-decisions')
  decide(@Req() request: Request, @Body() input: AccessDecisionRequest) {
    this.requireService(request);
    return this.identity.decide(input);
  }

  @Get('internal/v1/tenant-databases/:tenantId')
  async tenantDatabaseForService(
    @Req() request: Request,
    @Param('tenantId') tenantId: string,
    @Query('moduleKey') moduleKey: string,
  ) {
    this.requireService(request);
    if (!moduleKey?.trim()) {
      throw new ForbiddenException({ code: 'MODULE_KEY_REQUIRED' });
    }
    const database = await this.identity.serviceDatabase(tenantId, moduleKey);
    if (!database) {
      throw new ForbiddenException({ code: 'MODULE_NOT_ENTITLED' });
    }
    return { database };
  }

  @Get('internal/v1/organization-snapshots/:tenantId')
  organizationSnapshotForService(
    @Req() request: Request,
    @Param('tenantId') tenantId: string,
  ) {
    this.requireService(request);
    return this.identity.tenantOrganizationSnapshot(tenantId);
  }

  /** Read-only Tenant Core contract for module-to-module calls. */
  @Get('internal/v1/organization-contexts/:tenantId')
  organizationContextForService(
    @Req() request: Request,
    @Param('tenantId') tenantId: string,
  ) {
    this.requireService(request);
    return this.identity.tenantOrganizationSnapshot(tenantId);
  }

  /** Chuỗi quản lý của một người — Procedure dùng để phân giải "quản lý trực tiếp". */
  @Get('internal/v1/organization-contexts/:tenantId/users/:userId/manager-chain')
  managerChainForService(
    @Req() request: Request,
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Query('positionId') positionId?: string,
  ) {
    this.requireService(request);
    return this.identity.managerChain(tenantId, userId, positionId?.trim() || undefined);
  }

  /**
   * Ghi "Báo cáo cho" của một chức danh thay cho module gọi.
   *
   * Màn Quản lý chức danh nằm trong module Quy trình; module đó đã tự kiểm quyền
   * thiết kế của người dùng trước khi gọi. Dữ liệu vẫn chỉ Core được ghi.
   */
  @Put('internal/v1/organization-contexts/:tenantId/positions/:positionId/reports-to')
  setPositionReportsToForService(
    @Req() request: Request,
    @Param('tenantId') tenantId: string,
    @Param('positionId') positionId: string,
    @Body() input: { reportsToPositionId?: string | null },
  ) {
    this.requireService(request);
    return this.identity.setPositionReportsTo(tenantId, positionId, input?.reportsToPositionId ?? null);
  }

  /**
   * HRM áp dụng một quyết định nhân sự lên phân công chức danh. Core vẫn là nơi
   * duy nhất ghi phân công; `decisionId` làm khóa idempotent cho lần thử lại.
   */
  @Post('internal/v1/organization-contexts/:tenantId/appointments')
  applyAppointmentForService(
    @Req() request: Request,
    @Param('tenantId') tenantId: string,
    @Body()
    input: {
      decisionId?: string;
      action?: 'ASSIGN' | 'END';
      userId?: string;
      nodeId?: string | null;
      effectiveDate?: string;
      isPrimary?: boolean;
      endCurrent?: boolean;
      note?: string | null;
    },
  ) {
    this.requireService(request);
    return this.identity.applyAppointment(tenantId, input ?? {});
  }

  /** Ô ghi đè quản lý trực tiếp trong hồ sơ nhân sự (Tenant Portal). */
  @Put('v1/tenant-organization/assignments/:assignmentId/reports-to-override')
  async setAssignmentReportsToOverride(
    @Req() request: Request,
    @Param('assignmentId') assignmentId: string,
    @Body() input: { reportsToPositionId?: string | null },
  ) {
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    return this.identity.setAssignmentReportsToOverride(
      principal.tenantId,
      assignmentId,
      input?.reportsToPositionId ?? null,
    );
  }

  /** Quản lý trực tiếp suy ra cho một người, để hồ sơ nhân sự hiển thị (chỉ đọc). */
  @Get('v1/tenant-organization/users/:userId/manager-chain')
  async managerChainForPortal(
    @Req() request: Request,
    @Param('userId') userId: string,
    @Query('positionId') positionId?: string,
  ) {
    const principal = await this.tenantManager(request);
    return this.identity.managerChain(principal.tenantId, userId, positionId?.trim() || undefined);
  }

  @Get('v1/overview')
  async overview(@Req() request: Request) {
    const principal = await this.principal(request);
    if (principal.kind !== 'platform-admin') throw new ForbiddenException();
    return this.identity.platformOverview();
  }

  @Get('v1/tenants')
  async tenants(@Req() request: Request) {
    await this.platformAdmin(request);
    return { tenants: await this.identity.listTenants() };
  }

  @Get('v1/tenants/:tenantId/modules')
  async tenantModulesForPlatform(
    @Req() request: Request,
    @Param('tenantId') tenantId: string,
  ) {
    await this.platformAdmin(request);
    return this.identity.tenantEntitlementOverview(tenantId);
  }

  @Get('v1/modules')
  async modules(@Req() request: Request) {
    const principal = await this.principal(request);
    if (principal.kind !== 'tenant-user') throw new ForbiddenException();
    const modules = await this.identity.tenantModules(principal.tenantId);
    return modules.filter(module => principal.moduleKeys?.includes('*') || principal.moduleKeys?.includes((module as { key: string }).key));
  }

  @Get('v1/modules/catalog')
  async moduleCatalog(@Req() request: Request) {
    const principal = await this.tenantUser(request);
    const modules = await this.identity.tenantModuleCatalog(principal.tenantId);
    return {
      modules: principal.roles.includes('tenant-admin') ? modules : modules.filter(m => principal.moduleKeys?.includes('*') || principal.moduleKeys?.includes(m.key)),
    };
  }

  @Post('v1/modules/:moduleKey/activation-requests')
  async requestModuleActivation(
    @Req() request: Request,
    @Param('moduleKey') moduleKey: string,
  ) {
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    return this.identity.requestModuleActivation(
      principal.tenantId,
      moduleKey,
      principal.userId,
    );
  }

  @Post('v1/tenants')
  async createTenant(
    @Req() request: Request,
    @Body() input: CreateTenantRequest,
  ) {
    const principal = await this.platformAdmin(request);
    this.requireCsrf(request);
    return this.identity.createTenant(input, principal.userId);
  }

  @Patch('v1/tenants/:tenantId')
  async updateTenant(
    @Req() request: Request,
    @Param('tenantId') tenantId: string,
    @Body() input: UpdateTenantRequest,
  ) {
    const principal = await this.platformAdmin(request);
    this.requireCsrf(request);
    return {
      tenant: await this.identity.updateTenant(
        tenantId,
        input,
        principal.userId,
      ),
    };
  }

  @Post('v1/tenants/:tenantId/admin/password-reset-link')
  async createTenantAdminPasswordResetLink(
    @Req() request: Request,
    @Param('tenantId') tenantId: string,
  ) {
    const principal = await this.platformAdmin(request);
    this.requireCsrf(request);
    return this.identity.createTenantPasswordResetLink(
      tenantId,
      principal.userId,
    );
  }

  @Put('v1/tenants/:tenantId/entitlements/:moduleKey')
  async entitlement(
    @Req() request: Request,
    @Param('tenantId') tenantId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() input: SetTenantEntitlementRequest,
  ) {
    const principal = await this.platformAdmin(request);
    this.requireCsrf(request);
    return this.identity.setEntitlement(
      tenantId,
      moduleKey,
      input.enabled,
      principal.userId,
    );
  }

  @Get('v1/members')
  async members(@Req() request: Request) {
    const principal = await this.principal(request);
    if (
      principal.kind !== 'tenant-user' ||
      !principal.permissions.includes('tenant.manage')
    )
      throw new ForbiddenException();
    return this.identity.tenantMembers(principal.tenantId);
  }

  @Get('v1/tenant-users')
  async coreUsers(@Req() request: Request) {
    const principal = await this.tenantAction(request, 'core.users.read');
    return { users: await this.identity.coreUsers(principal.tenantId) };
  }

  @Post('v1/tenant-users')
  async createCoreUser(
    @Req() request: Request,
    @Body()
    input: {
      fullName?: string;
      email?: string;
      password?: string;
      systemRole?: string;
    },
  ) {
    const principal = await this.tenantAction(request, 'core.users.create');
    this.requireCsrf(request);
    return {
      user: await this.identity.createCoreUser(principal.tenantId, input, principal.userId),
    };
  }

  @Patch('v1/tenant-users/:userId')
  async updateCoreUser(
    @Req() request: Request,
    @Param('userId') userId: string,
    @Body()
    input: {
      fullName?: string;
      email?: string;
      password?: string;
      systemRole?: string;
      status?: string;
    },
  ) {
    const principal = await this.tenantAction(request, 'core.users.update');
    this.requireCsrf(request);
    return {
      user: await this.identity.updateCoreUser(
        principal.tenantId,
        userId,
        input,
        principal.userId,
      ),
    };
  }

  @Delete('v1/tenant-users/:userId')
  async deleteCoreUser(
    @Req() request: Request,
    @Param('userId') userId: string,
  ) {
    const principal = await this.tenantAction(request, 'core.users.delete');
    this.requireCsrf(request);
    await this.identity.deleteCoreUser(
      principal.tenantId,
      userId,
      principal.userId,
    );
    return { status: 'deleted' };
  }

  @Put('v1/members/:membershipId/roles/:roleKey')
  async assignRole(@Req() request: Request) {
    await this.tenantManager(request);
    this.requireCsrf(request);
    throw new ForbiddenException('Sử dụng API tenant-users/:id/roles.');
  }

  @Get('v1/tenant-organization/core-snapshot')
  async coreOrganizationSnapshot(@Req() request: Request) {
    const principal = await this.tenantAction(request, 'core.organization.read');
    return this.identity.coreOrganizationSnapshot(principal.tenantId);
  }

  @Get('v1/tenant-organization/snapshot')
  async organizationSnapshot(@Req() request: Request) {
    const principal = await this.tenantAction(request, 'core.organization.read');
    return this.identity.tenantOrganizationSnapshot(principal.tenantId);
  }

  @Get('v1/tenant-organization/tree')
  async organizationTrees(@Req() request: Request) {
    const principal = await this.tenantAction(request, 'core.organization.read');
    return this.identity.organizationTrees(principal.tenantId);
  }

  @Get('v1/tenant-organization/tree/:treeId')
  async organizationTree(
    @Req() request: Request,
    @Param('treeId') treeId: string,
  ) {
    const principal = await this.tenantAction(request, 'core.organization.read');
    return this.identity.organizationTree(principal.tenantId, treeId);
  }

  @Get('v1/tenant-organization/:resource')
  async listOrganizationResource(
    @Req() request: Request,
    @Param('resource') resource: string,
  ) {
    const principal = await this.tenantAction(request, 'core.organization.read');
    return this.identity.listCoreOrganizationResource(
      principal.tenantId,
      resource,
    );
  }

  @Post('v1/tenant-organization/:resource')
  async createOrganizationResource(
    @Req() request: Request,
    @Param('resource') resource: string,
    @Body() data: Record<string, unknown>,
  ) {
    // The legacy static /core path also matches this parameter route in Express.
    // Dispatch before checking create permission so updates/deletes cannot bypass their gates.
    if (resource === 'core') return this.mutateCoreOrganization(request, data);
    const principal = await this.tenantAction(request, 'core.organization.create');
    this.requireCsrf(request);
    return this.identity.createCoreOrganizationResource(
      principal.tenantId,
      resource,
      data,
    );
  }

  @Patch('v1/tenant-organization/trees/:treeId/layout')
  async saveOrganizationTreeLayout(
    @Req() request: Request,
    @Param('treeId') treeId: string,
    @Body() input: { positions?: unknown },
  ) {
    const principal = await this.tenantAction(request, 'core.organization.update');
    this.requireCsrf(request);
    return this.identity.saveCoreOrganizationTreeLayout(
      principal.tenantId,
      treeId,
      input.positions,
    );
  }

  @Patch('v1/tenant-organization/:resource/:id')
  async updateOrganizationResource(
    @Req() request: Request,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() data: Record<string, unknown>,
  ) {
    const principal = await this.tenantAction(request, 'core.organization.update');
    this.requireCsrf(request);
    return this.identity.updateCoreOrganizationResource(
      principal.tenantId,
      resource,
      id,
      data,
    );
  }

  @Delete('v1/tenant-organization/:resource/:id')
  async deleteOrganizationResource(
    @Req() request: Request,
    @Param('resource') resource: string,
    @Param('id') id: string,
  ) {
    const principal = await this.tenantAction(request, 'core.organization.delete');
    this.requireCsrf(request);
    return this.identity.softDeleteCoreOrganizationResource(
      principal.tenantId,
      resource,
      id,
    );
  }

  @Post('v1/tenant-organization/core')
  async mutateCoreOrganization(
    @Req() request: Request,
    @Body()
    input: { action?: string; id?: string; data?: Record<string, unknown> },
  ) {
    const verb = input.action === 'assign-user' ? 'create' : input.action?.split('-')[0];
    if (!['create', 'update', 'delete'].includes(verb ?? '')) throw new ForbiddenException();
    const principal = await this.tenantAction(request, `core.organization.${verb}`);
    this.requireCsrf(request);
    return this.identity.mutateCoreOrganization(principal.tenantId, input);
  }

  @Get('v1/tenant-permission-actions')
  async permissionActions(@Req() request: Request) {
    await this.tenantManager(request);
    return { actions: TENANT_PERMISSION_ACTIONS };
  }

  @Get('v1/tenant-permissions')
  async permissions(@Req() request: Request) {
    const p = await this.tenantManager(request);
    return { permissions: await this.identity.authorization.listPermissions(p.tenantId) };
  }

  @Get('v1/tenant-permissions/:id')
  async permission(@Req() request: Request, @Param('id') id: string) {
    const p = await this.tenantManager(request);
    const permission = (await this.identity.authorization.listPermissions(p.tenantId)).find(item => item.id === id);
    if (!permission) throw new NotFoundException();
    return { permission };
  }

  @Post('v1/tenant-permissions')
  async createPermission(@Req() request: Request, @Body() input: Record<string, unknown>) {
    const p = await this.tenantManager(request); this.requireCsrf(request);
    return this.identity.authorization.savePermission(p.tenantId, p.userId, input);
  }

  @Patch('v1/tenant-permissions/:id')
  async updatePermission(@Req() request: Request, @Param('id') id: string, @Body() input: Record<string, unknown>) {
    const p = await this.tenantManager(request); this.requireCsrf(request);
    return this.identity.authorization.savePermission(p.tenantId, p.userId, input, id);
  }

  @Delete('v1/tenant-permissions/:id')
  async deletePermission(@Req() request: Request, @Param('id') id: string) {
    const p = await this.tenantManager(request); this.requireCsrf(request);
    return this.identity.authorization.remove(p.tenantId, p.userId, 'permissions', id);
  }

  @Get('v1/tenant-roles')
  async roles(@Req() request: Request) {
    const p = await this.tenantManager(request);
    return { roles: await this.identity.authorization.listRoles(p.tenantId) };
  }

  @Get('v1/tenant-roles/:id')
  async role(@Req() request: Request, @Param('id') id: string) {
    const p = await this.tenantManager(request);
    const role = (await this.identity.authorization.listRoles(p.tenantId)).find(item => item.id === id);
    if (!role) throw new NotFoundException();
    return { role };
  }

  @Post('v1/tenant-roles')
  async createRole(@Req() request: Request, @Body() input: Record<string, unknown>) {
    const p = await this.tenantManager(request); this.requireCsrf(request);
    const modules = await this.identity.tenantModuleCatalog(p.tenantId);
    return this.identity.authorization.saveRole(p.tenantId, p.userId, input, modules.map(m => m.key));
  }

  @Patch('v1/tenant-roles/:id')
  async updateRole(@Req() request: Request, @Param('id') id: string, @Body() input: Record<string, unknown>) {
    const p = await this.tenantManager(request); this.requireCsrf(request);
    const modules = await this.identity.tenantModuleCatalog(p.tenantId);
    return this.identity.authorization.saveRole(p.tenantId, p.userId, input, modules.map(m => m.key), id);
  }

  @Delete('v1/tenant-roles/:id')
  async deleteRole(@Req() request: Request, @Param('id') id: string) {
    const p = await this.tenantManager(request); this.requireCsrf(request);
    return this.identity.authorization.remove(p.tenantId, p.userId, 'roles', id);
  }

  /** Tạo bộ Permission + Role mẫu HRM (idempotent, chỉ tenant admin). */
  @Post('v1/tenant-role-templates/hrm')
  async seedHrmRoleTemplates(@Req() request: Request) {
    const p = await this.tenantManager(request);
    this.requireCsrf(request);
    return this.identity.authorization.seedHrmRoleTemplates(p.tenantId, p.userId);
  }

  @Get('v1/tenant-users/:id/roles')
  async userRoles(@Req() request: Request, @Param('id') id: string) {
    const p = await this.tenantManager(request);
    return this.identity.authorization.userRoles(p.tenantId, id);
  }

  @Put('v1/tenant-users/:id/roles')
  async setUserRoles(@Req() request: Request, @Param('id') id: string, @Body() input: { roleIds?: unknown }) {
    const p = await this.tenantManager(request); this.requireCsrf(request);
    return this.identity.authorization.assignRoles(p.tenantId, p.userId, id, input.roleIds);
  }

  private async principal(request: Request): Promise<AuthenticatedPrincipal> {
    const bearer = request.headers.authorization;
    const token = bearer?.startsWith('Bearer ')
      ? bearer.slice(7)
      : (request.cookies?.ep_access as string | undefined);
    if (!token) throw new UnauthorizedException();
    try {
      return await this.identity.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException();
    }
  }

  private async platformAdmin(
    request: Request,
  ): Promise<PlatformAdminPrincipal> {
    const principal = await this.principal(request);
    if (principal.kind !== 'platform-admin') throw new ForbiddenException();
    return principal;
  }

  private async tenantUser(request: Request): Promise<TenantUserPrincipal> {
    const principal = await this.principal(request);
    if (principal.kind !== 'tenant-user') throw new ForbiddenException();
    return principal;
  }

  private async tenantAction(request: Request, action: string): Promise<TenantUserPrincipal> {
    const principal = await this.tenantUser(request);
    if (!principal.roles.includes('tenant-admin') && !principal.permissions.includes(action)) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Bạn không có quyền thực hiện thao tác này.' });
    return principal;
  }

  private async tenantManager(request: Request): Promise<TenantUserPrincipal> {
    const principal = await this.tenantUser(request);
    if (!principal.roles.includes('tenant-admin')) {
      throw new ForbiddenException();
    }
    return principal;
  }

  private requireService(request: Request): void {
    if (
      !process.env.INTERNAL_SERVICE_TOKEN ||
      request.headers['x-service-token'] !== process.env.INTERNAL_SERVICE_TOKEN
    ) {
      throw new UnauthorizedException('Service identity không hợp lệ.');
    }
  }

  private requireCsrf(request: Request): void {
    const header = request.headers['x-csrf-token'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || value !== request.cookies?.ep_csrf)
      throw new ForbiddenException({ code: 'CSRF_INVALID' });
  }
}
