import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import type {
  CorrespondenceSettings,
  QuickCatalogItemRequest,
  SaveCatalogItemRequest,
  SaveRegisterRequest,
  SaveWorkflowRequest,
} from '@enterprise-platform/contracts-correspondence';
import { CorrespondenceService } from '../application/correspondence.service.js';
import { CorrespondenceHttp, type CorrespondenceRequest } from './correspondence-http.js';

/** Cấu hình: cài đặt, danh mục, quy trình, sổ đăng ký. */
@Controller('v1')
export class CorrespondenceConfigController extends CorrespondenceHttp {
  constructor(service: CorrespondenceService) {
    super(service);
  }

  /** Sổ, danh mục và quy trình duyệt: ai vào được phân hệ cũng đọc được, chỉ người có quyền cấu hình sửa. */
  @Get('config')
  config(@Req() request: CorrespondenceRequest) {
    return this.execute(() => this.service.config(this.actor(request)));
  }

  @Put('settings')
  saveSettings(@Req() request: CorrespondenceRequest, @Body() body: CorrespondenceSettings) {
    return this.execute(() => this.service.saveSettings(this.actor(request), body));
  }

  @Post('catalog')
  createCatalogItem(@Req() request: CorrespondenceRequest, @Body() body: SaveCatalogItemRequest) {
    return this.execute(() => this.service.saveCatalogItem(this.actor(request), undefined, body));
  }

  @Put('catalog/:id')
  updateCatalogItem(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: SaveCatalogItemRequest) {
    return this.execute(() => this.service.saveCatalogItem(this.actor(request), id, body));
  }

  /** Thêm nhanh mục danh mục lúc nhập công văn (người cấu hình, văn thư). */
  @Post('catalog/quick')
  @HttpCode(201)
  quickAddCatalogItem(@Req() request: CorrespondenceRequest, @Body() body: QuickCatalogItemRequest) {
    return this.execute(() => this.service.quickAddCatalogItem(this.actor(request), body));
  }

  @Delete('catalog/:id')
  @HttpCode(204)
  async deleteCatalogItem(@Req() request: CorrespondenceRequest, @Param('id') id: string): Promise<void> {
    await this.execute(() => this.service.deleteCatalogItem(this.actor(request), id));
  }

  @Post('workflows')
  createWorkflow(@Req() request: CorrespondenceRequest, @Body() body: SaveWorkflowRequest) {
    return this.execute(() => this.service.saveWorkflow(this.actor(request), undefined, body));
  }

  @Put('workflows/:id')
  updateWorkflow(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: SaveWorkflowRequest) {
    return this.execute(() => this.service.saveWorkflow(this.actor(request), id, body));
  }

  @Delete('workflows/:id')
  @HttpCode(204)
  async deleteWorkflow(@Req() request: CorrespondenceRequest, @Param('id') id: string): Promise<void> {
    await this.execute(() => this.service.deleteWorkflow(this.actor(request), id));
  }

  /** Sổ đăng ký văn bản đến / đi: mẫu số, sổ mật, loại văn bản. */
  @Post('registers')
  createRegister(@Req() request: CorrespondenceRequest, @Body() body: SaveRegisterRequest) {
    return this.execute(() => this.service.saveRegister(this.actor(request), undefined, body));
  }

  @Put('registers/:id')
  updateRegister(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: SaveRegisterRequest) {
    return this.execute(() => this.service.saveRegister(this.actor(request), id, body));
  }

  @Delete('registers/:id')
  @HttpCode(204)
  async deleteRegister(@Req() request: CorrespondenceRequest, @Param('id') id: string): Promise<void> {
    await this.execute(() => this.service.deleteRegister(this.actor(request), id));
  }
}
