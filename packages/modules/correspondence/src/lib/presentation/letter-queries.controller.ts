import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { LetterBox, LetterStage } from '@enterprise-platform/contracts-correspondence';
import { CorrespondenceService } from '../application/correspondence.service.js';
import { CorrespondenceHttp, type CorrespondenceRequest } from './correspondence-http.js';

/** Tra cứu: trạng thái, danh bạ, tổng quan, báo cáo, sổ, kho lưu trữ, danh sách và chi tiết công văn. */
@Controller('v1')
export class LetterQueriesController extends CorrespondenceHttp {
  constructor(service: CorrespondenceService) {
    super(service);
  }

  @Get('status')
  status(@Req() request: CorrespondenceRequest) {
    return this.execute(() => this.service.status(this.actor(request)));
  }

  @Get('directory')
  directory(@Req() request: CorrespondenceRequest) {
    return this.execute(() => this.service.directory(this.actor(request)));
  }

  @Get('overview')
  overview(@Req() request: CorrespondenceRequest) {
    return this.execute(() => this.service.overview(this.actor(request)));
  }

  /** Cây lưu trữ (năm › công văn đến / đi › hồ sơ › tệp) như thư mục Văn thư bên Hệ dùng chung. */
  @Get('archive-tree')
  archiveTree(@Req() request: CorrespondenceRequest) {
    return this.execute(() => this.service.archiveTree(this.actor(request)));
  }

  @Get('reports')
  report(@Req() request: CorrespondenceRequest, @Query('year') year?: string) {
    return this.execute(() => this.service.report(this.actor(request), year));
  }

  /** Sổ theo dõi công văn đến / đi theo năm (bảng văn thư). */
  @Get('ledger')
  ledger(@Req() request: CorrespondenceRequest, @Query('direction') direction?: string, @Query('year') year?: string) {
    return this.execute(async () => ({ items: await this.service.ledger(this.actor(request), direction, year) }));
  }

  @Get('letters')
  list(
    @Req() request: CorrespondenceRequest,
    @Query('box') box?: string,
    @Query('stage') stage?: string,
    @Query('search') search?: string,
    @Query('registerId') registerId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('kind') kind?: string,
  ) {
    return this.execute(async () => ({
      items: await this.service.list(this.actor(request), {
        box: (box || undefined) as LetterBox | undefined,
        stage: (stage || undefined) as LetterStage | undefined,
        search,
        registerId: registerId || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        kind: kind || undefined,
      }),
    }));
  }

  @Get('letters/:id')
  detail(@Req() request: CorrespondenceRequest, @Param('id') id: string) {
    return this.execute(() => this.service.detail(this.actor(request), id));
  }

  /**
   * Ứng viên cho bước duyệt sắp bắt đầu khi bước đó để người thao tác chọn người duyệt.
   * `kind`: loại văn bản văn thư đang chọn khi giao (quy trình theo loại văn bản).
   */
  @Get('letters/:id/step-choice')
  stepChoice(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Query('kind') kind?: string) {
    return this.execute(async () => ({ choice: await this.service.stepChoice(this.actor(request), id, kind || undefined) }));
  }
}
