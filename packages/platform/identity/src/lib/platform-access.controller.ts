import type {
  AccessDecisionRequest,
  AuthenticatedPrincipal,
  PlatformAdminPrincipal,
  TenantUserPrincipal,
} from '@enterprise-platform/contracts-identity';
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
    return this.identity.tenantModules(principal.tenantId);
  }

  @Get('v1/modules/catalog')
  async moduleCatalog(@Req() request: Request) {
    const principal = await this.tenantUser(request);
    return {
      modules: await this.identity.tenantModuleCatalog(principal.tenantId),
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
    const principal = await this.tenantManager(request);
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
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    return {
      user: await this.identity.createCoreUser(principal.tenantId, input),
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
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    return {
      user: await this.identity.updateCoreUser(
        principal.tenantId,
        userId,
        input,
      ),
    };
  }

  @Delete('v1/tenant-users/:userId')
  async deleteCoreUser(
    @Req() request: Request,
    @Param('userId') userId: string,
  ) {
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    await this.identity.deleteCoreUser(
      principal.tenantId,
      userId,
      principal.userId,
    );
    return { status: 'deleted' };
  }

  @Put('v1/members/:membershipId/roles/:roleKey')
  async assignRole(
    @Req() request: Request,
    @Param('membershipId') membershipId: string,
    @Param('roleKey') roleKey: string,
  ) {
    const principal = await this.principal(request);
    this.requireCsrf(request);
    if (
      principal.kind !== 'tenant-user' ||
      !principal.permissions.includes('tenant.manage')
    )
      throw new ForbiddenException();
    await this.identity.assignTenantRole(
      principal.tenantId,
      membershipId,
      roleKey,
    );
    return { status: 'assigned' };
  }

  @Get('v1/tenant-organization/core-snapshot')
  async coreOrganizationSnapshot(@Req() request: Request) {
    const principal = await this.tenantUser(request);
    return this.identity.coreOrganizationSnapshot(principal.tenantId);
  }

  @Get('v1/tenant-organization/snapshot')
  async organizationSnapshot(@Req() request: Request) {
    const principal = await this.tenantUser(request);
    return this.identity.tenantOrganizationSnapshot(principal.tenantId);
  }

  @Get('v1/tenant-organization/tree')
  async organizationTrees(@Req() request: Request) {
    const principal = await this.tenantUser(request);
    return this.identity.organizationTrees(principal.tenantId);
  }

  @Get('v1/tenant-organization/tree/:treeId')
  async organizationTree(
    @Req() request: Request,
    @Param('treeId') treeId: string,
  ) {
    const principal = await this.tenantUser(request);
    return this.identity.organizationTree(principal.tenantId, treeId);
  }

  @Get('v1/tenant-organization/:resource')
  async listOrganizationResource(
    @Req() request: Request,
    @Param('resource') resource: string,
  ) {
    const principal = await this.tenantUser(request);
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
    const principal = await this.tenantManager(request);
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
    const principal = await this.tenantManager(request);
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
    const principal = await this.tenantManager(request);
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
    const principal = await this.tenantManager(request);
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
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    return this.identity.mutateCoreOrganization(principal.tenantId, input);
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

  private async tenantManager(request: Request): Promise<TenantUserPrincipal> {
    const principal = await this.tenantUser(request);
    if (!principal.permissions.includes('tenant.manage')) {
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
