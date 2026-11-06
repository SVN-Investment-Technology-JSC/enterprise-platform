import type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldType,
  QuoteAdjustmentMode,
  QuoteLayout,
  QuoteTemplate,
  QuoteTemplateLayout,
  QuoteType,
} from '@enterprise-platform/contracts-crm';

/**
 * Port của báo giá theo mẫu (GĐI): mẫu báo giá, loại báo giá, mẫu mã báo giá. Cài đặt đọc cho mọi người có
 * `crm.read` (chọn trên form); ghi chỉ `crm.manage` (kiểm ở `QuoteFormService`).
 */
export const CRM_QUOTE_FORM_STORE = Symbol('CRM_QUOTE_FORM_STORE');

export interface QuoteTemplateRecord {
  readonly name: string;
  readonly discountMode: QuoteAdjustmentMode;
  readonly taxMode: QuoteAdjustmentMode;
  readonly description: string | null;
  readonly active: boolean;
  readonly isDefault: boolean;
  readonly sortOrder: number;
}

export interface QuoteTypeRecord {
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly isDefault: boolean;
  readonly sortOrder: number;
}

export interface CustomFieldRecord {
  readonly name: string;
  readonly fieldType: CustomFieldType;
  readonly options: readonly string[];
  readonly required: boolean;
  readonly sortOrder: number;
  readonly active: boolean;
}

/** Bố cục đang lưu của mẫu; bố cục trong DB sai cấu trúc thì `layout` rỗng. */
export type StoredQuoteTemplateLayout = QuoteTemplateLayout;

/** Lưu hoặc xoá bố cục (`layout: null`). `expectedUpdatedAt` không có (`undefined`) là ghi đè không kiểm. */
export interface QuoteTemplateLayoutWrite {
  readonly layout: QuoteLayout | null;
  readonly expectedUpdatedAt?: string | null;
  /** Ghi vào `audit_log` thay cho cả JSON: số khối và kích thước (byte). */
  readonly blockCount: number;
  readonly sizeBytes: number;
}

export interface QuoteFormStore {
  listTemplates(tenantId: string, includeInactive: boolean): Promise<QuoteTemplate[]>;
  getTemplate(tenantId: string, id: string): Promise<QuoteTemplate | undefined>;
  createTemplate(tenantId: string, record: QuoteTemplateRecord, actorId: string): Promise<QuoteTemplate>;
  updateTemplate(tenantId: string, id: string, record: QuoteTemplateRecord, actorId: string): Promise<QuoteTemplate | undefined>;
  /** Bố cục in của mẫu (phase 3); mẫu không có: `undefined`. Mẫu đang tắt vẫn đọc được. */
  getTemplateLayout(tenantId: string, id: string): Promise<StoredQuoteTemplateLayout | undefined>;
  /**
   * Ghi bố cục và `audit_log` (`quote_template.layout_updated`) trong một transaction, khoá dòng mẫu. Mẫu không có:
   * `undefined`. `expectedUpdatedAt` lệch với bản đang lưu: `CrmConflictError` `LAYOUT_CONFLICT`.
   */
  saveTemplateLayout(
    tenantId: string,
    id: string,
    write: QuoteTemplateLayoutWrite,
    actorId: string,
  ): Promise<StoredQuoteTemplateLayout | undefined>;

  listTypes(tenantId: string, includeInactive: boolean): Promise<QuoteType[]>;
  getType(tenantId: string, id: string): Promise<QuoteType | undefined>;
  createType(tenantId: string, record: QuoteTypeRecord, actorId: string): Promise<QuoteType>;
  updateType(tenantId: string, id: string, record: QuoteTypeRecord, actorId: string): Promise<QuoteType | undefined>;

  /** Mẫu mã báo giá đã lưu; rỗng là dùng mã mặc định. */
  codePattern(tenantId: string): Promise<string | null>;
  saveCodePattern(tenantId: string, pattern: string | null, actorId: string): Promise<void>;
  /** Sinh mã kế tiếp (chiếm một số thứ tự) theo mẫu đã cấu hình, hoặc mã mặc định; không bao giờ trùng mã đang có. */
  generateCode(tenantId: string): Promise<string>;
  codeExists(tenantId: string, code: string, excludeQuoteId?: string): Promise<boolean>;

  // Trường tuỳ biến (P2I-06) ---------------------------------------------------
  listCustomFields(tenantId: string, entityType: CustomFieldEntityType, includeInactive: boolean): Promise<CustomFieldDefinition[]>;
  getCustomField(tenantId: string, id: string): Promise<CustomFieldDefinition | undefined>;
  createCustomField(
    tenantId: string,
    entityType: CustomFieldEntityType,
    record: CustomFieldRecord,
    actorId: string,
  ): Promise<CustomFieldDefinition>;
  updateCustomField(tenantId: string, id: string, record: CustomFieldRecord, actorId: string): Promise<CustomFieldDefinition | undefined>;
}
