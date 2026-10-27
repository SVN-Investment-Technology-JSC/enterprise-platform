import type {
  CreateCustomerRequest,
  CrmPage,
  CrmPerson,
  CrmSettings,
  CustomerDetail,
  CustomerGroup,
  CustomerListQuery,
  CustomerSummary,
  CustomerTimelineEntry,
  SaveContactRequest,
  SaveCustomerGroupRequest,
  TaxCodeMatch,
  UpdateCustomerRequest,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { CustomerTimelineService } from '../application/activity.service.js';
import { CrmPeopleService, CrmSettingsService, CustomerGroupService } from '../application/customer-group.service.js';
import { CustomerService } from '../application/customer.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

/** Khách hàng, người liên hệ, dòng thời gian khách hàng. */
@Controller('v1')
export class CustomersController {
  constructor(
    @Inject(CustomerService) private readonly customers: CustomerService,
    @Inject(CustomerTimelineService) private readonly timeline: CustomerTimelineService,
  ) {}

  @Get('customers')
  list(@Req() request: CrmRequest, @Query() query: CustomerListQuery): Promise<CrmPage<CustomerSummary>> {
    return runCrm(() => this.customers.list(crmActor(request), query));
  }

  /** Khách khác đang dùng MST này (cảnh báo khi nhập; không chặn). */
  @Get('customers/tax-code-matches')
  taxCodeMatches(
    @Req() request: CrmRequest,
    @Query('taxCode') taxCode?: string,
    @Query('excludeId') excludeId?: string,
  ): Promise<TaxCodeMatch[]> {
    return runCrm(() => this.customers.taxCodeMatches(crmActor(request), taxCode, excludeId));
  }

  @Post('customers')
  create(@Req() request: CrmRequest, @Body() body: CreateCustomerRequest): Promise<CustomerDetail> {
    return runCrm(() => this.customers.create(crmActor(request), body ?? ({} as never)));
  }

  @Get('customers/:id')
  get(@Req() request: CrmRequest, @Param('id') id: string): Promise<CustomerDetail> {
    return runCrm(() => this.customers.get(crmActor(request), id));
  }

  @Patch('customers/:id')
  update(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: UpdateCustomerRequest,
  ): Promise<CustomerDetail> {
    return runCrm(() => this.customers.update(crmActor(request), id, body ?? ({} as never)));
  }

  @Get('customers/:id/timeline')
  customerTimeline(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<CrmPage<CustomerTimelineEntry>> {
    return runCrm(() => this.timeline.list(crmActor(request), id, { cursor, limit }));
  }

  @Post('customers/:id/contacts')
  addContact(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: SaveContactRequest,
  ): Promise<CustomerDetail> {
    return runCrm(() => this.customers.addContact(crmActor(request), id, body ?? ({} as never)));
  }

  @Patch('customers/:id/contacts/:contactId')
  updateContact(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() body: SaveContactRequest,
  ): Promise<CustomerDetail> {
    return runCrm(() => this.customers.updateContact(crmActor(request), id, contactId, body ?? ({} as never)));
  }

  /** Đặt làm người liên hệ chính; người chính cũ mất cờ. */
  @Post('customers/:id/contacts/:contactId/primary')
  @HttpCode(200)
  setPrimaryContact(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ): Promise<CustomerDetail> {
    return runCrm(() => this.customers.setPrimaryContact(crmActor(request), id, contactId));
  }

  @Delete('customers/:id/contacts/:contactId')
  deleteContact(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ): Promise<CustomerDetail> {
    return runCrm(() => this.customers.deleteContact(crmActor(request), id, contactId));
  }
}

/** Nhóm khách hàng, cấu hình phân hệ, danh bạ chọn người. */
@Controller('v1')
export class CrmSettingsController {
  constructor(
    @Inject(CustomerGroupService) private readonly groups: CustomerGroupService,
    @Inject(CrmSettingsService) private readonly settings: CrmSettingsService,
    @Inject(CrmPeopleService) private readonly people: CrmPeopleService,
  ) {}

  @Get('customer-groups')
  listGroups(@Req() request: CrmRequest): Promise<CustomerGroup[]> {
    return runCrm(() => this.groups.list(crmActor(request)));
  }

  @Post('customer-groups')
  createGroup(@Req() request: CrmRequest, @Body() body: SaveCustomerGroupRequest): Promise<CustomerGroup> {
    return runCrm(() => this.groups.create(crmActor(request), body ?? ({} as never)));
  }

  @Patch('customer-groups/:id')
  updateGroup(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: SaveCustomerGroupRequest,
  ): Promise<CustomerGroup> {
    return runCrm(() => this.groups.update(crmActor(request), id, body ?? ({} as never)));
  }

  @Delete('customer-groups/:id')
  @HttpCode(204)
  deleteGroup(@Req() request: CrmRequest, @Param('id') id: string): Promise<void> {
    return runCrm(() => this.groups.remove(crmActor(request), id));
  }

  @Get('settings')
  getSettings(@Req() request: CrmRequest): Promise<CrmSettings> {
    return runCrm(() => this.settings.get(crmActor(request)));
  }

  @Put('settings')
  saveSettings(@Req() request: CrmRequest, @Body() body: Partial<CrmSettings>): Promise<CrmSettings> {
    return runCrm(() => this.settings.save(crmActor(request), body ?? ({} as never)));
  }

  @Get('people')
  listPeople(@Req() request: CrmRequest): Promise<CrmPerson[]> {
    return runCrm(() => this.people.list(crmActor(request)));
  }
}
