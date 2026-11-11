import {
  QUOTE_LAYOUT_CONFLICT_CODE,
  type CustomFieldDefinition,
  type CustomFieldEntityType,
  type CustomFieldType,
  type QuoteAdjustmentMode,
  type QuoteTemplate,
  type QuoteType,
} from '@enterprise-platform/contracts-crm';
import type {
  CustomFieldRecord,
  QuoteFormStore,
  QuoteTemplateLayoutWrite,
  QuoteTemplateRecord,
  QuoteTypeRecord,
  StoredQuoteTemplateLayout,
} from '../application/quote-form-store.port.js';
import { CrmConflictError } from '../domain/crm.error.js';
import { parseQuoteCodePattern, QUOTE_CODE_SETTING_KEY } from '../domain/quote-code.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { generateQuoteCode, peekQuoteCode } from './postgres-quote.store.js';
import { constraintViolation, toIso } from './sql-helpers.js';
import { parseStoredQuoteLayout } from './stored-quote-layout.js';

/** Khoá thực thể ghi `audit_log` cho cài đặt báo giá theo mẫu. */
export const QUOTE_TEMPLATE_AUDIT_ENTITY = 'quote_template';
export const QUOTE_TYPE_AUDIT_ENTITY = 'quote_type';
export const QUOTE_CODE_SETTING_AUDIT_ENTITY = 'quote_code_setting';
export const CUSTOM_FIELD_AUDIT_ENTITY = 'custom_field';
/** `audit_log.entity_id` là UUID: cài đặt mã chỉ có một bản ghi nên dùng id cố định. */
const QUOTE_CODE_SETTING_ID = '00000000-0000-0000-0000-000000000001';

interface TemplateRow {
  id: string;
  name: string;
  discount_mode: QuoteAdjustmentMode;
  tax_mode: QuoteAdjustmentMode;
  description: string | null;
  active: boolean;
  is_default: boolean;
  sort_order: number;
  has_layout: boolean;
}

interface LayoutRow {
  layout: unknown;
  layout_updated_at: Date | null;
  layout_updated_by: string | null;
}

interface TypeRow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  is_default: boolean;
  sort_order: number;
}

interface CustomFieldRow {
  id: string;
  entity_type: CustomFieldEntityType;
  name: string;
  field_type: CustomFieldType;
  options: string[] | null;
  required: boolean;
  sort_order: number;
  active: boolean;
}

const CUSTOM_FIELD_COLUMNS = 'id, entity_type, name, field_type, options, required, sort_order, active';
const CUSTOM_FIELD_NAME_EXISTS = () => new CrmConflictError('CUSTOM_FIELD_NAME_EXISTS', 'Tên trường tuỳ biến đã tồn tại.');

const TEMPLATE_COLUMNS =
  'id, name, discount_mode, tax_mode, description, active, is_default, sort_order, (layout IS NOT NULL) AS has_layout';
const TYPE_COLUMNS = 'id, name, description, active, is_default, sort_order';

const TEMPLATE_NAME_EXISTS = () => new CrmConflictError('QUOTE_TEMPLATE_NAME_EXISTS', 'Tên mẫu báo giá đã tồn tại.');
const TYPE_NAME_EXISTS = () => new CrmConflictError('QUOTE_TYPE_NAME_EXISTS', 'Tên loại báo giá đã tồn tại.');

export class PostgresQuoteFormStore implements QuoteFormStore {
  constructor(private readonly database: CrmDatabase) {}

  // Mẫu báo giá ---------------------------------------------------------------

  async listTemplates(tenantId: string, includeInactive: boolean): Promise<QuoteTemplate[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<TemplateRow>(
      `SELECT ${TEMPLATE_COLUMNS} FROM crm_schema.quote_templates
        WHERE $1::boolean OR active ORDER BY sort_order, name, id`,
      [includeInactive],
    );
    return result.rows.map(toTemplate);
  }

  async getTemplate(tenantId: string, id: string): Promise<QuoteTemplate | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<TemplateRow>(`SELECT ${TEMPLATE_COLUMNS} FROM crm_schema.quote_templates WHERE id = $1`, [id]);
    return result.rows[0] ? toTemplate(result.rows[0]) : undefined;
  }

  createTemplate(tenantId: string, record: QuoteTemplateRecord, actorId: string): Promise<QuoteTemplate> {
    return this.database
      .transaction(tenantId, async (client) => {
        if (record.isDefault) await client.query(`UPDATE crm_schema.quote_templates SET is_default = FALSE WHERE is_default`);
        const result = await client.query<TemplateRow>(
          `INSERT INTO crm_schema.quote_templates
             (name, discount_mode, tax_mode, description, active, is_default, sort_order, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING ${TEMPLATE_COLUMNS}`,
          [record.name, record.discountMode, record.taxMode, record.description, record.active, record.isDefault, record.sortOrder, actorId],
        );
        const row = result.rows[0];
        await auditSetting(client, QUOTE_TEMPLATE_AUDIT_ENTITY, row.id, 'create', actorId, { name: row.name });
        return toTemplate(row);
      })
      .catch(rethrowName(TEMPLATE_NAME_EXISTS, 'uq_crm_quote_templates_name'));
  }

  updateTemplate(tenantId: string, id: string, record: QuoteTemplateRecord, actorId: string): Promise<QuoteTemplate | undefined> {
    return this.database
      .transaction(tenantId, async (client) => {
        if (record.isDefault) {
          await client.query(`UPDATE crm_schema.quote_templates SET is_default = FALSE WHERE is_default AND id <> $1`, [id]);
        }
        const result = await client.query<TemplateRow>(
          `UPDATE crm_schema.quote_templates
              SET name = $2, discount_mode = $3, tax_mode = $4, description = $5, active = $6, is_default = $7,
                  sort_order = $8, updated_at = now(), updated_by = $9
            WHERE id = $1 RETURNING ${TEMPLATE_COLUMNS}`,
          [id, record.name, record.discountMode, record.taxMode, record.description, record.active, record.isDefault, record.sortOrder, actorId],
        );
        const row = result.rows[0];
        if (!row) return undefined;
        await auditSetting(client, QUOTE_TEMPLATE_AUDIT_ENTITY, id, record.active ? 'update' : 'deactivate', actorId, {
          name: row.name,
          discountMode: row.discount_mode,
          taxMode: row.tax_mode,
          active: row.active,
        });
        return toTemplate(row);
      })
      .catch(rethrowName(TEMPLATE_NAME_EXISTS, 'uq_crm_quote_templates_name'));
  }

  // Bố cục in của mẫu (phase 3) ---------------------------------------------------

  async getTemplateLayout(tenantId: string, id: string): Promise<StoredQuoteTemplateLayout | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<LayoutRow>(
      `SELECT layout, layout_updated_at, layout_updated_by FROM crm_schema.quote_templates WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toLayout(result.rows[0], id) : undefined;
  }

  saveTemplateLayout(
    tenantId: string,
    id: string,
    write: QuoteTemplateLayoutWrite,
    actorId: string,
  ): Promise<StoredQuoteTemplateLayout | undefined> {
    return this.database.transaction(tenantId, async (client) => {
      // `updatedAt` trả cho web ở độ chính xác mili giây nên so cũng ở mili giây.
      const current = await client.query<{ matches: boolean }>(
        `SELECT ($2::timestamptz IS NOT DISTINCT FROM date_trunc('milliseconds', layout_updated_at)) AS matches
           FROM crm_schema.quote_templates WHERE id = $1 FOR UPDATE`,
        [id, write.expectedUpdatedAt ?? null],
      );
      const row = current.rows[0];
      if (!row) return undefined;
      if (write.expectedUpdatedAt !== undefined && !row.matches) {
        throw new CrmConflictError(QUOTE_LAYOUT_CONFLICT_CODE, 'Mẫu vừa được người khác sửa. Tải lại để xem bản mới.');
      }
      // Mốc lưu luôn tăng (tối thiểu 1 ms) để hai lần lưu liền nhau không trùng `updatedAt`.
      const result = await client.query<LayoutRow>(
        `UPDATE crm_schema.quote_templates
            SET layout = $2::jsonb,
                layout_updated_at = GREATEST(
                  date_trunc('milliseconds', clock_timestamp()),
                  date_trunc('milliseconds', layout_updated_at) + interval '1 millisecond'),
                layout_updated_by = $3
          WHERE id = $1
          RETURNING layout, layout_updated_at, layout_updated_by`,
        [id, write.layout === null ? null : JSON.stringify(write.layout), actorId],
      );
      // Không ghi cả JSON (có thể chứa ảnh): chỉ số khối và kích thước.
      await auditSetting(client, QUOTE_TEMPLATE_AUDIT_ENTITY, id, 'layout_updated', actorId, {
        removed: write.layout === null,
        blockCount: write.blockCount,
        sizeBytes: write.sizeBytes,
      });
      return toLayout(result.rows[0], id);
    });
  }

  // Loại báo giá --------------------------------------------------------------

  async listTypes(tenantId: string, includeInactive: boolean): Promise<QuoteType[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<TypeRow>(
      `SELECT ${TYPE_COLUMNS} FROM crm_schema.quote_types WHERE $1::boolean OR active ORDER BY sort_order, name, id`,
      [includeInactive],
    );
    return result.rows.map(toType);
  }

  async getType(tenantId: string, id: string): Promise<QuoteType | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<TypeRow>(`SELECT ${TYPE_COLUMNS} FROM crm_schema.quote_types WHERE id = $1`, [id]);
    return result.rows[0] ? toType(result.rows[0]) : undefined;
  }

  createType(tenantId: string, record: QuoteTypeRecord, actorId: string): Promise<QuoteType> {
    return this.database
      .transaction(tenantId, async (client) => {
        if (record.isDefault) await client.query(`UPDATE crm_schema.quote_types SET is_default = FALSE WHERE is_default`);
        const result = await client.query<TypeRow>(
          `INSERT INTO crm_schema.quote_types (name, description, active, is_default, sort_order, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING ${TYPE_COLUMNS}`,
          [record.name, record.description, record.active, record.isDefault, record.sortOrder, actorId],
        );
        const row = result.rows[0];
        await auditSetting(client, QUOTE_TYPE_AUDIT_ENTITY, row.id, 'create', actorId, { name: row.name });
        return toType(row);
      })
      .catch(rethrowName(TYPE_NAME_EXISTS, 'uq_crm_quote_types_name'));
  }

  updateType(tenantId: string, id: string, record: QuoteTypeRecord, actorId: string): Promise<QuoteType | undefined> {
    return this.database
      .transaction(tenantId, async (client) => {
        if (record.isDefault) {
          await client.query(`UPDATE crm_schema.quote_types SET is_default = FALSE WHERE is_default AND id <> $1`, [id]);
        }
        const result = await client.query<TypeRow>(
          `UPDATE crm_schema.quote_types
              SET name = $2, description = $3, active = $4, is_default = $5, sort_order = $6, updated_at = now(), updated_by = $7
            WHERE id = $1 RETURNING ${TYPE_COLUMNS}`,
          [id, record.name, record.description, record.active, record.isDefault, record.sortOrder, actorId],
        );
        const row = result.rows[0];
        if (!row) return undefined;
        await auditSetting(client, QUOTE_TYPE_AUDIT_ENTITY, id, record.active ? 'update' : 'deactivate', actorId, {
          name: row.name,
          active: row.active,
        });
        return toType(row);
      })
      .catch(rethrowName(TYPE_NAME_EXISTS, 'uq_crm_quote_types_name'));
  }

  // Trường tuỳ biến (P2I-06) ----------------------------------------------------

  async listCustomFields(tenantId: string, entityType: CustomFieldEntityType, includeInactive: boolean): Promise<CustomFieldDefinition[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<CustomFieldRow>(
      `SELECT ${CUSTOM_FIELD_COLUMNS} FROM crm_schema.custom_field_definitions
        WHERE entity_type = $1 AND ($2::boolean OR active) ORDER BY sort_order, name, id`,
      [entityType, includeInactive],
    );
    return result.rows.map(toCustomField);
  }

  async getCustomField(tenantId: string, id: string): Promise<CustomFieldDefinition | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<CustomFieldRow>(
      `SELECT ${CUSTOM_FIELD_COLUMNS} FROM crm_schema.custom_field_definitions WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toCustomField(result.rows[0]) : undefined;
  }

  createCustomField(tenantId: string, entityType: CustomFieldEntityType, record: CustomFieldRecord, actorId: string): Promise<CustomFieldDefinition> {
    return this.database
      .transaction(tenantId, async (client) => {
        const result = await client.query<CustomFieldRow>(
          `INSERT INTO crm_schema.custom_field_definitions
             (entity_type, name, field_type, options, required, sort_order, active, created_by, updated_by)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $8) RETURNING ${CUSTOM_FIELD_COLUMNS}`,
          [entityType, record.name, record.fieldType, JSON.stringify(record.options), record.required, record.sortOrder, record.active, actorId],
        );
        const row = result.rows[0];
        await auditSetting(client, CUSTOM_FIELD_AUDIT_ENTITY, row.id, 'create', actorId, { name: row.name, entityType });
        return toCustomField(row);
      })
      .catch(rethrowName(CUSTOM_FIELD_NAME_EXISTS, 'uq_crm_custom_field_definitions_name'));
  }

  updateCustomField(tenantId: string, id: string, record: CustomFieldRecord, actorId: string): Promise<CustomFieldDefinition | undefined> {
    return this.database
      .transaction(tenantId, async (client) => {
        const result = await client.query<CustomFieldRow>(
          `UPDATE crm_schema.custom_field_definitions
              SET name = $2, field_type = $3, options = $4::jsonb, required = $5, sort_order = $6, active = $7,
                  updated_at = now(), updated_by = $8
            WHERE id = $1 RETURNING ${CUSTOM_FIELD_COLUMNS}`,
          [id, record.name, record.fieldType, JSON.stringify(record.options), record.required, record.sortOrder, record.active, actorId],
        );
        const row = result.rows[0];
        if (!row) return undefined;
        await auditSetting(client, CUSTOM_FIELD_AUDIT_ENTITY, id, record.active ? 'update' : 'deactivate', actorId, {
          name: row.name,
          active: row.active,
        });
        return toCustomField(row);
      })
      .catch(rethrowName(CUSTOM_FIELD_NAME_EXISTS, 'uq_crm_custom_field_definitions_name'));
  }

  // Mã báo giá ----------------------------------------------------------------

  async codePattern(tenantId: string): Promise<string | null> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ value: unknown }>(`SELECT value FROM crm_schema.settings WHERE key = $1`, [
      QUOTE_CODE_SETTING_KEY,
    ]);
    return parseQuoteCodePattern(result.rows[0]?.value);
  }

  saveCodePattern(tenantId: string, pattern: string | null, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO crm_schema.settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, version = crm_schema.settings.version + 1,
               updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [QUOTE_CODE_SETTING_KEY, JSON.stringify({ pattern }), actorId],
      );
      await auditSetting(client, QUOTE_CODE_SETTING_AUDIT_ENTITY, QUOTE_CODE_SETTING_ID, 'update', actorId, { pattern });
    });
  }

  async generateCode(tenantId: string): Promise<string> {
    const pool = await this.database.pool(tenantId);
    return generateQuoteCode(pool);
  }

  async peekCode(tenantId: string): Promise<string> {
    const pool = await this.database.pool(tenantId);
    return peekQuoteCode(pool);
  }

  async codeExists(tenantId: string, code: string, excludeQuoteId?: string): Promise<boolean> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query(
      `SELECT 1 FROM crm_schema.quotes WHERE code = $1 AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
      [code, excludeQuoteId ?? null],
    );
    return result.rows.length > 0;
  }
}

async function auditSetting(
  client: CrmSqlClient,
  entityType: string,
  entityId: string,
  action: string,
  actorId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog(client, { entityType, entityId, action, actorId, metadata });
}

function rethrowName(make: () => CrmConflictError, constraint: string) {
  return (error: unknown): never => {
    if (constraintViolation(error, '23505', constraint)) throw make();
    throw error;
  };
}

function toTemplate(row: TemplateRow): QuoteTemplate {
  return {
    id: row.id,
    name: row.name,
    discountMode: row.discount_mode,
    taxMode: row.tax_mode,
    description: row.description,
    active: row.active,
    isDefault: row.is_default,
    sortOrder: row.sort_order,
    hasLayout: row.has_layout,
  };
}

function toLayout(row: LayoutRow, id: string): StoredQuoteTemplateLayout {
  return {
    layout: parseStoredQuoteLayout(row.layout, `quote_templates ${id}`),
    updatedAt: toIso(row.layout_updated_at),
    updatedBy: row.layout_updated_by,
  };
}

function toType(row: TypeRow): QuoteType {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    isDefault: row.is_default,
    sortOrder: row.sort_order,
  };
}

function toCustomField(row: CustomFieldRow): CustomFieldDefinition {
  return {
    id: row.id,
    entityType: row.entity_type,
    name: row.name,
    fieldType: row.field_type,
    options: row.options ?? [],
    required: row.required,
    sortOrder: row.sort_order,
    active: row.active,
  };
}
