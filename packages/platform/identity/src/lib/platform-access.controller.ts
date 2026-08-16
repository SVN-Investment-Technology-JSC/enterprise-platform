import type {
  AccessDecisionRequest,
  AuthenticatedPrincipal,
  PlatformAdminPrincipal,
  TenantUserPrincipal,
} from '@enterprise-platform/contracts-identity';
import type {
  AssignOrganizationMemberRequest,
  CreateOrganizationPositionRequest,
  CreateOrganizationUnitRequest,
  CreateOrganizationUnitTypeRequest,
  UpdateOrganizationUnitRequest,
  UpdateOrganizationUnitTypeRequest,
} from '@enterprise-platform/contracts-organization';
import type {
  CreateTenantRequest,
  SetTenantEntitlementRequest,
  UpdateTenantRequest,
} from '@enterprise-platform/contracts-tenancy';
import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, Req, UnauthorizedException } from '@nestjs/common';
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

  @Get('internal/v1/organization-snapshots/:tenantId')
  organizationSnapshotForService(
    @Req() request: Request,
    @Param('tenantId') tenantId: string,
  ) {
    this.requireService(request);
    return this.identity.organizationSnapshot(tenantId);
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
  async tenantModulesForPlatform(@Req() request: Request, @Param('tenantId') tenantId: string) {
    await this.platformAdmin(request);
    return this.identity.tenantEntitlementOverview(tenantId);
  }

  @Get('v1/modules')
  async modules(@Req() request: Request) {
    const principal = await this.principal(request);
    if (principal.kind !== 'tenant-user') throw new ForbiddenException();
    return this.identity.tenantModules(principal.tenantId);
  }

  @Post('v1/tenants')
  async createTenant(@Req() request: Request, @Body() input: CreateTenantRequest) {
    const principal = await this.platformAdmin(request); this.requireCsrf(request);
    return this.identity.createTenant(input, principal.userId);
  }

  @Patch('v1/tenants/:tenantId')
  async updateTenant(@Req() request: Request, @Param('tenantId') tenantId: string, @Body() input: UpdateTenantRequest) {
    const principal = await this.platformAdmin(request); this.requireCsrf(request);
    return { tenant: await this.identity.updateTenant(tenantId, input, principal.userId) };
  }

  @Put('v1/tenants/:tenantId/entitlements/:moduleKey')
  async entitlement(@Req() request: Request, @Param('tenantId') tenantId: string, @Param('moduleKey') moduleKey: string, @Body() input: SetTenantEntitlementRequest) {
    const principal = await this.platformAdmin(request); this.requireCsrf(request);
    return this.identity.setEntitlement(tenantId, moduleKey, input.enabled, principal.userId);
  }

  @Get('v1/members')
  async members(@Req() request: Request) {
    const principal = await this.principal(request);
    if (principal.kind !== 'tenant-user' || !principal.permissions.includes('tenant.manage')) throw new ForbiddenException();
    return this.identity.tenantMembers(principal.tenantId);
  }

  @Put('v1/members/:membershipId/roles/:roleKey')
  async assignRole(@Req() request: Request, @Param('membershipId') membershipId: string, @Param('roleKey') roleKey: string) {
    const principal = await this.principal(request); this.requireCsrf(request);
    if (principal.kind !== 'tenant-user' || !principal.permissions.includes('tenant.manage')) throw new ForbiddenException();
    await this.identity.assignTenantRole(principal.tenantId, membershipId, roleKey);
    return { status: 'assigned' };
  }

  @Get('v1/tenant-organization/snapshot')
  async organizationSnapshot(@Req() request: Request) {
    const principal = await this.tenantUser(request);
    return this.identity.organizationSnapshot(principal.tenantId);
  }

  @Get('v1/tenant-organization/unit-types')
  async organizationUnitTypes(@Req() request: Request) {
    const principal = await this.tenantUser(request);
    return {
      unitTypes: (await this.identity.organizationSnapshot(principal.tenantId))
        .unitTypes,
    };
  }

  @Post('v1/tenant-organization/unit-types')
  async createOrganizationUnitType(
    @Req() request: Request,
    @Body() input: CreateOrganizationUnitTypeRequest,
  ) {
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    return this.identity.createOrganizationUnitType(principal.tenantId, input);
  }

  @Patch('v1/tenant-organization/unit-types/:typeId')
  async updateOrganizationUnitType(
    @Req() request: Request,
    @Param('typeId') typeId: string,
    @Body() input: UpdateOrganizationUnitTypeRequest,
  ) {
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    return this.identity.updateOrganizationUnitType(
      principal.tenantId,
      typeId,
      input,
    );
  }

  @Delete('v1/tenant-organization/unit-types/:typeId')
  async deleteOrganizationUnitType(
    @Req() request: Request,
    @Param('typeId') typeId: string,
  ) {
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    await this.identity.deleteOrganizationUnitType(principal.tenantId, typeId);
    return { status: 'deleted' };
  }

  @Get('v1/tenant-organization/units')
  async organizationUnits(@Req() request: Request) {
    const principal = await this.tenantUser(request);
    return {
      units: (await this.identity.organizationSnapshot(principal.tenantId)).units,
    };
  }

  @Post('v1/tenant-organization/units')
  async createOrganizationUnit(
    @Req() request: Request,
    @Body() input: CreateOrganizationUnitRequest,
  ) {
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    return this.identity.createOrganizationUnit(principal.tenantId, input);
  }

  @Patch('v1/tenant-organization/units/:unitId')
  async updateOrganizationUnit(
    @Req() request: Request,
    @Param('unitId') unitId: string,
    @Body() input: UpdateOrganizationUnitRequest,
  ) {
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    return this.identity.updateOrganizationUnit(principal.tenantId, unitId, input);
  }

  @Delete('v1/tenant-organization/units/:unitId')
  async deleteOrganizationUnit(
    @Req() request: Request,
    @Param('unitId') unitId: string,
  ) {
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    await this.identity.deleteOrganizationUnit(principal.tenantId, unitId);
    return { status: 'deleted' };
  }

  @Get('v1/tenant-organization/positions')
  async organizationPositions(@Req() request: Request) {
    const principal = await this.tenantUser(request);
    return {
      positions: (await this.identity.organizationSnapshot(principal.tenantId))
        .positions,
    };
  }

  @Post('v1/tenant-organization/positions')
  async createOrganizationPosition(
    @Req() request: Request,
    @Body() input: CreateOrganizationPositionRequest,
  ) {
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    return this.identity.createOrganizationPosition(principal.tenantId, input);
  }

  @Put('v1/tenant-organization/units/:unitId/members')
  async assignOrganizationMember(
    @Req() request: Request,
    @Param('unitId') unitId: string,
    @Body() input: AssignOrganizationMemberRequest,
  ) {
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    await this.identity.assignOrganizationMember(
      principal.tenantId,
      unitId,
      input,
    );
    return { status: 'assigned' };
  }

  @Delete('v1/tenant-organization/units/:unitId/members/:membershipId')
  async removeOrganizationMember(
    @Req() request: Request,
    @Param('unitId') unitId: string,
    @Param('membershipId') membershipId: string,
  ) {
    const principal = await this.tenantManager(request);
    this.requireCsrf(request);
    await this.identity.removeOrganizationMember(
      principal.tenantId,
      unitId,
      membershipId,
    );
    return { status: 'removed' };
  }

  private async principal(request: Request): Promise<AuthenticatedPrincipal> {
    const bearer = request.headers.authorization;
    const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : request.cookies?.ep_access as string | undefined;
    if (!token) throw new UnauthorizedException();
    try { return await this.identity.verifyAccessToken(token); }
    catch { throw new UnauthorizedException(); }
  }

  private async platformAdmin(request: Request): Promise<PlatformAdminPrincipal> {
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
    if (!value || value !== request.cookies?.ep_csrf) throw new ForbiddenException({ code: 'CSRF_INVALID' });
  }
}
