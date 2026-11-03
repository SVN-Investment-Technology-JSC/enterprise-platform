import type {
  AddQuoteDocumentReferenceRequest,
  QuoteDocumentCandidate,
  QuoteDocumentCandidateQuery,
  QuoteDocumentReference,
  CompleteDocumentUploadRequest,
  CreateDocumentFolderRequest,
  CreateDocumentRequest,
  CreateDocumentResponse,
  CreateDocumentTypeRequest,
  CreateDocumentVersionRequest,
  CrmDocument,
  CrmDocumentDetail,
  CrmDocumentFolder,
  CrmDocumentType,
  CrmDocumentVersion,
  DocumentDownloadTicket,
  DocumentListQuery,
  DocumentUploadTicket,
  UpdateDocumentAudienceRequest,
  UpdateDocumentRequest,
  UpdateDocumentTypeRequest,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { DocumentService, DocumentTypeService } from '../application/document.service.js';
import { QuoteDocumentService } from '../application/quote-document.service.js';
import { CrmValidationError } from '../domain/crm.error.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

/**
 * Tài liệu CRM. Guard bảo đảm `crm.read` và CSRF cho mọi request ghi; quyền theo thao tác
 * (`crm.document.write`, `crm.document.delete`, `crm.manage`) và phạm vi dữ liệu của đối tượng gốc kiểm ở
 * `DocumentService`. Máy chủ không nhận byte của file: tạo tài liệu và phiên bản trả URL ký để tải lên thẳng.
 */
@Controller('v1')
export class DocumentsController {
  constructor(@Inject(DocumentService) private readonly documents: DocumentService) {}

  @Get('documents')
  list(@Req() request: CrmRequest, @Query() query: DocumentListQuery): Promise<CrmDocument[]> {
    return runCrm(() => this.documents.list(crmActor(request), query ?? ({} as never)));
  }

  @Post('documents')
  create(@Req() request: CrmRequest, @Body() body: CreateDocumentRequest): Promise<CreateDocumentResponse> {
    return runCrm(() => this.documents.create(crmActor(request), body ?? ({} as never)));
  }

  @Get('documents/:id')
  get(@Req() request: CrmRequest, @Param('id') id: string): Promise<CrmDocumentDetail> {
    return runCrm(() => this.documents.get(crmActor(request), id));
  }

  @Patch('documents/:id')
  update(@Req() request: CrmRequest, @Param('id') id: string, @Body() body: UpdateDocumentRequest): Promise<CrmDocument> {
    return runCrm(() => this.documents.update(crmActor(request), id, body ?? {}));
  }

  @Delete('documents/:id')
  @HttpCode(204)
  async remove(@Req() request: CrmRequest, @Param('id') id: string): Promise<void> {
    await runCrm(() => this.documents.remove(crmActor(request), id));
  }

  @Post('documents/:id/versions')
  addVersion(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: CreateDocumentVersionRequest,
  ): Promise<DocumentUploadTicket> {
    return runCrm(() => this.documents.addVersion(crmActor(request), id, body ?? ({} as never)));
  }

  @Post('documents/:id/versions/:versionId/complete')
  @HttpCode(200)
  complete(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: CompleteDocumentUploadRequest,
  ): Promise<CrmDocumentVersion> {
    return runCrm(() => this.documents.completeUpload(crmActor(request), id, versionId, body ?? ({} as never)));
  }

  /** URL tải xuống ký 300 giây; `?version=` là số phiên bản, bỏ trống là phiên bản hiện hành. */
  @Get('documents/:id/download')
  download(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Query('version') version?: string,
  ): Promise<DocumentDownloadTicket> {
    return runCrm(async () => {
      let versionNo: number | undefined;
      if (version !== undefined && version !== '') {
        versionNo = Number(version);
        if (!Number.isInteger(versionNo) || versionNo < 1) {
          throw new CrmValidationError('INVALID_VERSION', 'Số phiên bản không hợp lệ.');
        }
      }
      return this.documents.download(crmActor(request), id, versionNo);
    });
  }

  @Post('documents/:id/lock')
  @HttpCode(200)
  lock(@Req() request: CrmRequest, @Param('id') id: string): Promise<CrmDocument> {
    return runCrm(() => this.documents.lock(crmActor(request), id));
  }

  @Post('documents/:id/unlock')
  @HttpCode(200)
  unlock(@Req() request: CrmRequest, @Param('id') id: string): Promise<CrmDocument> {
    return runCrm(() => this.documents.unlock(crmActor(request), id));
  }

  @Patch('documents/:id/audience')
  setAudience(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: UpdateDocumentAudienceRequest,
  ): Promise<CrmDocument> {
    return runCrm(() => this.documents.setAudience(crmActor(request), id, body ?? ({} as never)));
  }

  @Get('document-folders')
  folders(
    @Req() request: CrmRequest,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
  ): Promise<CrmDocumentFolder[]> {
    return runCrm(() => this.documents.listFolders(crmActor(request), entityType, entityId));
  }

  @Post('document-folders')
  createFolder(@Req() request: CrmRequest, @Body() body: CreateDocumentFolderRequest): Promise<CrmDocumentFolder> {
    return runCrm(() => this.documents.createFolder(crmActor(request), body ?? ({} as never)));
  }
}

/** Loại tài liệu (Cài đặt CRM): ai có `crm.read` xem loại còn dùng; thêm, sửa, tắt chỉ `crm.manage`. */
@Controller('v1')
export class DocumentTypesController {
  constructor(@Inject(DocumentTypeService) private readonly types: DocumentTypeService) {}

  @Get('document-types')
  list(@Req() request: CrmRequest, @Query('includeInactive') includeInactive?: string): Promise<CrmDocumentType[]> {
    return runCrm(() => this.types.list(crmActor(request), includeInactive === 'true'));
  }

  @Post('document-types')
  create(@Req() request: CrmRequest, @Body() body: CreateDocumentTypeRequest): Promise<CrmDocumentType> {
    return runCrm(() => this.types.create(crmActor(request), body ?? ({} as never)));
  }

  @Patch('document-types/:id')
  update(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: UpdateDocumentTypeRequest,
  ): Promise<CrmDocumentType> {
    return runCrm(() => this.types.update(crmActor(request), id, body ?? {}));
  }
}

/**
 * Tài liệu có sẵn đính kèm vào báo giá (Q-P2-11). Chọn từ khách hàng, dự án, báo giá cùng dự án trong phạm vi dữ liệu của
 * người gọi; đính kèm, bỏ đính kèm cần `crm.document.write`. Không nhân bản file: tải xuống ký URL theo tài liệu nguồn.
 */
@Controller('v1')
export class QuoteDocumentsController {
  constructor(@Inject(QuoteDocumentService) private readonly references: QuoteDocumentService) {}

  @Get('quotes/:id/document-candidates')
  candidates(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Query() query: QuoteDocumentCandidateQuery,
  ): Promise<QuoteDocumentCandidate[]> {
    return runCrm(() => this.references.candidates(crmActor(request), id, query ?? {}));
  }

  @Get('quotes/:id/document-references')
  list(@Req() request: CrmRequest, @Param('id') id: string): Promise<QuoteDocumentReference[]> {
    return runCrm(() => this.references.list(crmActor(request), id));
  }

  @Post('quotes/:id/document-references')
  add(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: AddQuoteDocumentReferenceRequest,
  ): Promise<QuoteDocumentReference[]> {
    return runCrm(() => this.references.add(crmActor(request), id, body ?? ({} as never)));
  }

  @Delete('quotes/:id/document-references/:referenceId')
  remove(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('referenceId') referenceId: string,
  ): Promise<QuoteDocumentReference[]> {
    return runCrm(() => this.references.remove(crmActor(request), id, referenceId));
  }

  @Get('quotes/:id/document-references/:referenceId/download')
  download(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('referenceId') referenceId: string,
    @Query('version') version?: string,
  ): Promise<DocumentDownloadTicket> {
    return runCrm(async () => {
      let versionNo: number | undefined;
      if (version !== undefined && version !== '') {
        versionNo = Number(version);
        if (!Number.isInteger(versionNo) || versionNo < 1) {
          throw new CrmValidationError('INVALID_VERSION', 'Số phiên bản không hợp lệ.');
        }
      }
      return this.references.download(crmActor(request), id, referenceId, versionNo);
    });
  }
}
