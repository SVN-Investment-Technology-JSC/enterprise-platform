import {
  APPROVAL_KINDS,
  DEFAULT_QUOTE_APPROVAL_SETTINGS,
  type ApprovalBinding,
  type ApprovalKind,
  type ApprovalMode,
  type QuoteApprovalSettings,
} from '@enterprise-platform/contracts-crm';
import type { QuoteSettingsStore } from '../application/quote-store.port.js';
import { normalizeQuoteApprovalSettings } from '../domain/quote-approval-policy.js';
import type { CrmDatabase } from './crm.database.js';
import { toIso } from './sql-helpers.js';

/** Khoá cấu hình ngưỡng duyệt báo giá (migration 0006 ghi giá trị mặc định). */
export const QUOTE_APPROVAL_SETTING_KEY = 'quote.approval';

interface BindingRow {
  kind: ApprovalKind;
  mode: ApprovalMode;
  procedure_definition_id: string | null;
  procedure_definition_name: string | null;
  updated_at: Date;
}

/** Ngưỡng duyệt (`settings`) và cách duyệt theo loại (`approval_bindings`). */
export class PostgresQuoteSettingsStore implements QuoteSettingsStore {
  constructor(private readonly database: CrmDatabase) {}

  async approvalSettings(tenantId: string): Promise<QuoteApprovalSettings> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ value: unknown }>(`SELECT value FROM crm_schema.settings WHERE key = $1`, [
      QUOTE_APPROVAL_SETTING_KEY,
    ]);
    if (!result.rows[0]) return DEFAULT_QUOTE_APPROVAL_SETTINGS;
    try {
      return normalizeQuoteApprovalSettings(result.rows[0].value);
    } catch {
      // Giá trị hỏng (sửa tay trong DB): dùng mặc định thay vì chặn mọi báo giá.
      return DEFAULT_QUOTE_APPROVAL_SETTINGS;
    }
  }

  async saveApprovalSettings(tenantId: string, settings: QuoteApprovalSettings, actorId: string): Promise<void> {
    const pool = await this.database.pool(tenantId);
    await pool.query(
      `INSERT INTO crm_schema.settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = crm_schema.settings.version + 1,
                                       updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [QUOTE_APPROVAL_SETTING_KEY, JSON.stringify(settings), actorId],
    );
  }

  async bindings(tenantId: string): Promise<ApprovalBinding[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<BindingRow>(
      `SELECT kind, mode, procedure_definition_id, procedure_definition_name, updated_at FROM crm_schema.approval_bindings`,
    );
    return APPROVAL_KINDS.map((kind) => toBinding(kind, result.rows.find((row) => row.kind === kind)));
  }

  async binding(tenantId: string, kind: ApprovalKind): Promise<ApprovalBinding> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<BindingRow>(
      `SELECT kind, mode, procedure_definition_id, procedure_definition_name, updated_at
         FROM crm_schema.approval_bindings WHERE kind = $1`,
      [kind],
    );
    return toBinding(kind, result.rows[0]);
  }

  async saveBinding(tenantId: string, binding: Omit<ApprovalBinding, 'updatedAt'>, actorId: string): Promise<void> {
    const pool = await this.database.pool(tenantId);
    await pool.query(
      `INSERT INTO crm_schema.approval_bindings (kind, mode, procedure_definition_id, procedure_definition_name, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (kind) DO UPDATE SET mode = EXCLUDED.mode, procedure_definition_id = EXCLUDED.procedure_definition_id,
                                        procedure_definition_name = EXCLUDED.procedure_definition_name,
                                        updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [binding.kind, binding.mode, binding.procedureDefinitionId, binding.procedureDefinitionName, actorId],
    );
  }
}

/** Chưa có dòng nghĩa là duyệt trực tiếp. */
function toBinding(kind: ApprovalKind, row: BindingRow | undefined): ApprovalBinding {
  return {
    kind,
    mode: row?.mode ?? 'DIRECT',
    procedureDefinitionId: row?.procedure_definition_id ?? null,
    procedureDefinitionName: row?.procedure_definition_name ?? null,
    updatedAt: row ? toIso(row.updated_at) : null,
  };
}
