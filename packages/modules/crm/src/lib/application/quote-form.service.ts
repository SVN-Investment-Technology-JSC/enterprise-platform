import type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  GeneratedQuoteCode,
  QuoteCodeSettings,
  QuoteLayout,
  QuoteTemplate,
  QuoteTemplateLayout,
  QuoteType,
  SaveCustomFieldRequest,
  SaveQuoteCodeSettingsRequest,
  SaveQuoteTemplateLayoutRequest,
  SaveQuoteTemplateRequest,
  SaveQuoteTypeRequest,
} from '@enterprise-platform/contracts-crm';
import {
  CUSTOM_FIELD_ENTITY_TYPES,
  CUSTOM_FIELD_OPTIONS_MAX,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELDS_MAX,
  QUOTE_ADJUSTMENT_MODES,
  utf8ByteLength,
  validateQuoteLayout,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, optionalText, requiredText } from '../domain/fields.js';
import { formatQuoteCodePattern, normalizeQuoteCodePattern } from '../domain/quote-code.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CustomFieldRecord, QuoteFormStore, QuoteTemplateRecord, QuoteTypeRecord } from './quote-form-store.port.js';
import { vietnamToday } from './pricing.service.js';
import { requireQuoteWriter } from './quote.service.js';

/**
 * Cài đặt báo giá theo mẫu (P2I-04, P2I-05): mẫu báo giá, loại báo giá, mẫu mã báo giá.
 *
 * Ai có `crm.read` xem được (để chọn trên form); thêm, sửa, tắt chỉ `crm.manage`. Mẫu mặc định luôn đang bật.
 * Sửa chế độ của mẫu không đổi báo giá đã lập: mỗi phiên bản chụp chế độ lúc chọn mẫu.
 */
export class QuoteFormService {
  constructor(
    private readonly store: QuoteFormStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // Mẫu báo giá ---------------------------------------------------------------

  listTemplates(actor: CrmActor, includeInactive: unknown): Promise<QuoteTemplate[]> {
    return this.store.listTemplates(actor.tenantId, includeInactive === true || includeInactive === 'true');
  }

  async createTemplate(actor: CrmActor, request: SaveQuoteTemplateRequest): Promise<QuoteTemplate> {
    requireSalesManager(actor);
    return this.store.createTemplate(actor.tenantId, templateRecord(request), actor.userId);
  }

  async updateTemplate(actor: CrmActor, id: string, request: SaveQuoteTemplateRequest): Promise<QuoteTemplate> {
    requireSalesManager(actor);
    if (!isUuid(id)) throw new CrmNotFoundError('Không tìm thấy mẫu báo giá.');
    const current = await this.store.getTemplate(actor.tenantId, id);
    if (!current) throw new CrmNotFoundError('Không tìm thấy mẫu báo giá.');
    const record = templateRecord(request, current);
    if (current.isDefault && !record.isDefault) {
      throw new CrmConflictError('DEFAULT_TEMPLATE_REQUIRED', 'Phải luôn có một mẫu mặc định; hãy chọn mẫu khác làm mặc định.');
    }
    const updated = await this.store.updateTemplate(actor.tenantId, id, record, actor.userId);
    if (!updated) throw new CrmNotFoundError('Không tìm thấy mẫu báo giá.');
    return updated;
  }

  // Bố cục in của mẫu (phase 3) ---------------------------------------------------

  /** Đọc bố cục: `crm.read` (guard đã kiểm), kể cả mẫu đang tắt. Mẫu chưa có bố cục: `layout: null`. */
  async getLayout(actor: CrmActor, id: string): Promise<QuoteTemplateLayout> {
    if (!isUuid(id)) throw templateNotFound();
    const stored = await this.store.getTemplateLayout(actor.tenantId, id);
    if (!stored) throw templateNotFound();
    return stored;
  }

  /**
   * Lưu bố cục (`crm.manage`), kể cả mẫu đang tắt (chuẩn bị trước khi bật). `layout: null` là xoá. Bố cục được kiểm
   * và chuẩn hoá bằng `validateQuoteLayout` (trường lạ bị bỏ); lỗi trả 400 kèm `errors` theo từng trường.
   * `expectedUpdatedAt` lệch với bản đang lưu: 409 `LAYOUT_CONFLICT`; không gửi thì ghi đè.
   */
  async saveLayout(actor: CrmActor, id: string, request: SaveQuoteTemplateLayoutRequest): Promise<QuoteTemplateLayout> {
    requireSalesManager(actor);
    if (!isUuid(id)) throw templateNotFound();
    const layout = layoutOf(request?.layout);
    const json = layout ? JSON.stringify(layout) : '';
    const saved = await this.store.saveTemplateLayout(
      actor.tenantId,
      id,
      {
        layout,
        ...(request.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: expectedUpdatedAtOf(request.expectedUpdatedAt) } : {}),
        blockCount: layout?.blocks.length ?? 0,
        sizeBytes: utf8ByteLength(json),
      },
      actor.userId,
    );
    if (!saved) throw templateNotFound();
    return saved;
  }

  // Loại báo giá --------------------------------------------------------------

  listTypes(actor: CrmActor, includeInactive: unknown): Promise<QuoteType[]> {
    return this.store.listTypes(actor.tenantId, includeInactive === true || includeInactive === 'true');
  }

  async createType(actor: CrmActor, request: SaveQuoteTypeRequest): Promise<QuoteType> {
    requireSalesManager(actor);
    return this.store.createType(actor.tenantId, typeRecord(request), actor.userId);
  }

  async updateType(actor: CrmActor, id: string, request: SaveQuoteTypeRequest): Promise<QuoteType> {
    requireSalesManager(actor);
    if (!isUuid(id)) throw new CrmNotFoundError('Không tìm thấy loại báo giá.');
    const current = await this.store.getType(actor.tenantId, id);
    if (!current) throw new CrmNotFoundError('Không tìm thấy loại báo giá.');
    const record = typeRecord(request, current);
    if (current.isDefault && !record.isDefault) {
      throw new CrmConflictError('DEFAULT_TYPE_REQUIRED', 'Phải luôn có một loại mặc định; hãy chọn loại khác làm mặc định.');
    }
    const updated = await this.store.updateType(actor.tenantId, id, record, actor.userId);
    if (!updated) throw new CrmNotFoundError('Không tìm thấy loại báo giá.');
    return updated;
  }

  // Trường tuỳ biến (P2I-06) ----------------------------------------------------

  /** Ai có `crm.read` xem được (để nhập trên form báo giá); thêm, sửa, tắt chỉ `crm.manage`. */
  listCustomFields(actor: CrmActor, entityType: unknown, includeInactive: unknown): Promise<CustomFieldDefinition[]> {
    return this.store.listCustomFields(actor.tenantId, entityTypeOf(entityType), includeInactive === true || includeInactive === 'true');
  }

  async createCustomField(actor: CrmActor, request: SaveCustomFieldRequest): Promise<CustomFieldDefinition> {
    requireSalesManager(actor);
    const entityType = entityTypeOf(request?.entityType);
    const existing = await this.store.listCustomFields(actor.tenantId, entityType, true);
    if (existing.length >= CUSTOM_FIELDS_MAX) {
      throw new CrmConflictError('TOO_MANY_CUSTOM_FIELDS', `Tối đa ${CUSTOM_FIELDS_MAX} trường tuỳ biến cho mỗi loại đối tượng.`);
    }
    return this.store.createCustomField(actor.tenantId, entityType, customFieldRecord(request), actor.userId);
  }

  async updateCustomField(actor: CrmActor, id: string, request: SaveCustomFieldRequest): Promise<CustomFieldDefinition> {
    requireSalesManager(actor);
    if (!isUuid(id)) throw new CrmNotFoundError('Không tìm thấy trường tuỳ biến.');
    const current = await this.store.getCustomField(actor.tenantId, id);
    if (!current) throw new CrmNotFoundError('Không tìm thấy trường tuỳ biến.');
    const record = customFieldRecord(request, current);
    // Đổi kiểu làm giá trị đã lưu sai kiểu; muốn kiểu khác thì tạo trường mới và tắt trường cũ.
    if (record.fieldType !== current.fieldType) {
      throw new CrmConflictError('CUSTOM_FIELD_TYPE_LOCKED', 'Không đổi được kiểu của trường tuỳ biến đã tạo; hãy tạo trường mới và tắt trường này.');
    }
    const updated = await this.store.updateCustomField(actor.tenantId, id, record, actor.userId);
    if (!updated) throw new CrmNotFoundError('Không tìm thấy trường tuỳ biến.');
    return updated;
  }

  // Mã báo giá ----------------------------------------------------------------

  async codeSettings(actor: CrmActor): Promise<QuoteCodeSettings> {
    const [pattern, next] = await Promise.all([this.store.codePattern(actor.tenantId), this.store.peekCode(actor.tenantId)]);
    return this.describeCode(pattern, next);
  }

  async saveCodeSettings(actor: CrmActor, request: SaveQuoteCodeSettingsRequest): Promise<QuoteCodeSettings> {
    requireSalesManager(actor);
    const pattern = normalizeQuoteCodePattern(request?.pattern);
    await this.store.saveCodePattern(actor.tenantId, pattern, actor.userId);
    return this.describeCode(pattern, await this.store.peekCode(actor.tenantId));
  }

  /** Nút "sinh lại": mã kế tiếp, chiếm một số thứ tự (số đã sinh không dùng lại). */
  async generateCode(actor: CrmActor): Promise<GeneratedQuoteCode> {
    requireQuoteWriter(actor);
    return { code: await this.store.generateCode(actor.tenantId) };
  }

  private describeCode(pattern: string | null, next: string): QuoteCodeSettings {
    const today = vietnamToday(this.now());
    const date = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), day: Number(today.slice(8, 10)) };
    return {
      pattern,
      example: pattern ? formatQuoteCodePattern(pattern, date, 1) : `BG${today.slice(2, 4)}00001`,
      next,
    };
  }
}

const templateNotFound = () => new CrmNotFoundError('Không tìm thấy mẫu báo giá.');

/** Bố cục gửi lên: `null` là xoá; còn lại phải qua `validateQuoteLayout` (lỗi đầu tiên làm mã, đủ danh sách ở `errors`). */
function layoutOf(value: unknown): QuoteLayout | null {
  if (value === undefined) throw new CrmValidationError('LAYOUT_INVALID', 'Thiếu bố cục cần lưu.');
  if (value === null) return null;
  const result = validateQuoteLayout(value);
  if (!result.ok) {
    const [first] = result.errors;
    throw new CrmValidationError(first.code, first.message, { errors: result.errors });
  }
  return result.layout;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/** Mốc `updatedAt` đã đọc: `null` (chưa từng lưu) hoặc thời điểm ISO 8601. */
function expectedUpdatedAtOf(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new CrmValidationError('INVALID', 'Mốc cập nhật của bố cục không hợp lệ. Tải lại trình thiết kế rồi lưu lại.');
  }
  return value;
}

function flag(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new CrmValidationError('INVALID', 'Giá trị bật, tắt không hợp lệ.');
  return value;
}

function sortOrderOf(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 10_000) {
    throw new CrmValidationError('INVALID', 'Thứ tự hiển thị phải là số nguyên từ 0 đến 10.000.');
  }
  return value as number;
}

function templateRecord(request: SaveQuoteTemplateRequest, current?: QuoteTemplate): QuoteTemplateRecord {
  const discountMode = QUOTE_ADJUSTMENT_MODES.find((mode) => mode === request?.discountMode);
  const taxMode = QUOTE_ADJUSTMENT_MODES.find((mode) => mode === request?.taxMode);
  if (!discountMode) throw new CrmValidationError('INVALID_MODE', 'Vui lòng chọn chế độ chiết khấu (theo dòng hoặc theo tổng đơn).');
  if (!taxMode) throw new CrmValidationError('INVALID_MODE', 'Vui lòng chọn chế độ thuế (theo dòng hoặc theo tổng đơn).');
  const isDefault = flag(request.isDefault, current?.isDefault ?? false);
  const active = flag(request.active, current?.active ?? true);
  if (isDefault && !active) throw new CrmConflictError('DEFAULT_TEMPLATE_INACTIVE', 'Mẫu mặc định phải đang bật.');
  return {
    name: requiredText(request.name, 200, 'tên mẫu báo giá'),
    discountMode,
    taxMode,
    description: optionalText(request.description, 1000, 'mô tả'),
    active,
    isDefault,
    sortOrder: sortOrderOf(request.sortOrder, current?.sortOrder ?? 0),
  };
}

function typeRecord(request: SaveQuoteTypeRequest, current?: QuoteType): QuoteTypeRecord {
  const isDefault = flag(request?.isDefault, current?.isDefault ?? false);
  const active = flag(request?.active, current?.active ?? true);
  if (isDefault && !active) throw new CrmConflictError('DEFAULT_TYPE_INACTIVE', 'Loại mặc định phải đang bật.');
  return {
    name: requiredText(request?.name, 200, 'tên loại báo giá'),
    description: optionalText(request?.description, 1000, 'mô tả'),
    active,
    isDefault,
    sortOrder: sortOrderOf(request?.sortOrder, current?.sortOrder ?? 0),
  };
}

function entityTypeOf(value: unknown): CustomFieldEntityType {
  if (value === undefined || value === null || value === '') return 'quote';
  const found = CUSTOM_FIELD_ENTITY_TYPES.find((type) => type === value);
  if (!found) throw new CrmValidationError('INVALID', 'Loại đối tượng của trường tuỳ biến không hợp lệ.');
  return found;
}

function customFieldRecord(request: SaveCustomFieldRequest, current?: CustomFieldDefinition): CustomFieldRecord {
  const fieldType = CUSTOM_FIELD_TYPES.find((type) => type === (request?.fieldType ?? current?.fieldType));
  if (!fieldType) throw new CrmValidationError('INVALID', 'Vui lòng chọn kiểu của trường (danh sách chọn, văn bản, số hoặc ngày).');
  let options: string[] = [];
  if (fieldType === 'SELECT') {
    const raw = request?.options ?? current?.options;
    if (!Array.isArray(raw)) throw new CrmValidationError('OPTIONS_REQUIRED', 'Trường danh sách chọn cần ít nhất một lựa chọn.');
    options = raw.map((option, index) => requiredText(option, 200, `lựa chọn ${index + 1}`));
    if (!options.length) throw new CrmValidationError('OPTIONS_REQUIRED', 'Trường danh sách chọn cần ít nhất một lựa chọn.');
    if (options.length > CUSTOM_FIELD_OPTIONS_MAX) {
      throw new CrmValidationError('TOO_MANY_OPTIONS', `Mỗi trường tối đa ${CUSTOM_FIELD_OPTIONS_MAX} lựa chọn.`);
    }
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
      throw new CrmValidationError('OPTIONS_DUPLICATE', 'Các lựa chọn không được trùng nhau.');
    }
  }
  return {
    name: requiredText(request?.name ?? current?.name, 200, 'tên trường'),
    fieldType,
    options,
    required: flag(request?.required, current?.required ?? false),
    sortOrder: sortOrderOf(request?.sortOrder, current?.sortOrder ?? 0),
    active: flag(request?.active, current?.active ?? true),
  };
}
