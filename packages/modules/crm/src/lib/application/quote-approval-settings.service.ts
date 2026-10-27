import {
  APPROVAL_KINDS,
  APPROVAL_MODES,
  type ApprovalBinding,
  type ProcedureDefinitionOption,
  type QuoteApprovalSettings,
  type SaveApprovalBindingRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid } from '../domain/fields.js';
import { normalizeQuoteApprovalSettings } from '../domain/quote-approval-policy.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { ForwardedSession, ProcedureClient, QuoteSettingsStore } from './quote-store.port.js';

/**
 * Cấu hình duyệt (T3-17): cách duyệt theo loại (`approval_bindings`: duyệt
 * trực tiếp hoặc qua một quy trình đã công bố) và ngưỡng duyệt báo giá. Ai có
 * `crm.read` xem được; sửa cần `crm.manage`. Gắn quy trình thì hỏi Quy trình
 * `GET /v1/internal/definitions/:id` để chắc định nghĩa có thật và đã công bố.
 */
export class QuoteApprovalSettingsService {
  constructor(
    private readonly settings: QuoteSettingsStore,
    private readonly procedures: ProcedureClient,
  ) {}

  bindings(actor: CrmActor): Promise<ApprovalBinding[]> {
    return this.settings.bindings(actor.tenantId);
  }

  async saveBinding(actor: CrmActor, kind: string, request: SaveApprovalBindingRequest): Promise<ApprovalBinding[]> {
    requireSalesManager(actor);
    const bindingKind = APPROVAL_KINDS.find((value) => value === kind);
    if (!bindingKind) throw new CrmNotFoundError('Không có loại duyệt này.');
    const mode = APPROVAL_MODES.find((value) => value === request?.mode);
    if (!mode) throw new CrmValidationError('INVALID_MODE', 'Vui lòng chọn cách duyệt.');
    if (mode === 'DIRECT') {
      await this.settings.saveBinding(
        actor.tenantId,
        { kind: bindingKind, mode, procedureDefinitionId: null, procedureDefinitionName: null },
        actor.userId,
      );
      return this.bindings(actor);
    }
    const definitionId = request.procedureDefinitionId;
    if (!isUuid(definitionId)) throw new CrmValidationError('PROCEDURE_REQUIRED', 'Vui lòng chọn quy trình duyệt.');
    const definition = await this.procedures.publishedDefinition(actor.tenantId, definitionId.toLowerCase());
    await this.settings.saveBinding(
      actor.tenantId,
      {
        kind: bindingKind,
        mode,
        procedureDefinitionId: definition.id,
        procedureDefinitionName: (definition.name || definition.code || null)?.slice(0, 300) ?? null,
      },
      actor.userId,
    );
    return this.bindings(actor);
  }

  /** Quy trình đã công bố mà người cấu hình được thấy (theo phiên của chính họ ở Quy trình). */
  procedureOptions(actor: CrmActor, session: ForwardedSession): Promise<ProcedureDefinitionOption[]> {
    requireSalesManager(actor);
    return this.procedures.listPublished(session, actor.tenantId);
  }

  approvalSettings(actor: CrmActor): Promise<QuoteApprovalSettings> {
    return this.settings.approvalSettings(actor.tenantId);
  }

  async saveApprovalSettings(actor: CrmActor, request: unknown): Promise<QuoteApprovalSettings> {
    requireSalesManager(actor);
    const settings = normalizeQuoteApprovalSettings(request);
    await this.settings.saveApprovalSettings(actor.tenantId, settings, actor.userId);
    return this.settings.approvalSettings(actor.tenantId);
  }
}
