import type {
  PipelineAdminSnapshot,
  PipelineAdminStore,
  PipelineAdminTx,
  StageColumns,
} from '../application/pipeline-admin-store.port.js';
import type { CrmAuditEntry } from '../domain/audit-log.js';
import type { StageUsage, ValidatedRequirement } from '../domain/pipeline-config.js';
import { writeAuditLog } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { loadPipelinesFrom, type PipelineQueryable } from './postgres-pipeline-config.store.js';

/** Khoá tư vấn tuần tự hoá mọi thay đổi cấu hình luồng của một DB tenant. */
const CONFIG_LOCK_KEY = 'crm_schema.pipeline_config';

const STAGE_COLUMN_SQL: Readonly<Record<keyof StageColumns, string>> = {
  code: 'code',
  name: 'name',
  semantic: 'semantic',
  defaultProbability: 'default_probability',
  active: 'active',
  skippable: 'skippable',
  assigneeRule: 'assignee_rule',
  assigneeParam: 'assignee_param',
};

/**
 * Ghi cấu hình luồng (GĐ G, P2G-01). Mỗi lần ghi là một transaction: lấy khoá tư vấn, đọc cấu hình mới nhất (không
 * qua cache), kiểm quy tắc ở service, ghi, ghi `audit_log`. Không bao giờ đụng `opportunity_stage_history`.
 */
export class PostgresPipelineAdminStore implements PipelineAdminStore {
  constructor(private readonly database: CrmDatabase) {}

  /** Ảnh chụp mới nhất từ DB (không qua cache, không giữ khoá) cho màn quản trị. */
  async snapshot(tenantId: string): Promise<PipelineAdminSnapshot> {
    return new Tx(await this.database.pool(tenantId)).load();
  }

  run<T>(tenantId: string, work: (tx: PipelineAdminTx) => Promise<T>): Promise<T> {
    return this.database.transaction(tenantId, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [CONFIG_LOCK_KEY]);
      return work(new Tx(client));
    });
  }
}

/** Xếp hàng truy vấn của một client để `Promise.all` không chạy song song hai truy vấn trên cùng một kết nối. */
function serial(client: PipelineQueryable): PipelineQueryable {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    query: <TRow>(text: string, values?: unknown[]) => {
      const result = tail.then(() => client.query<TRow>(text, values));
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

class Tx implements PipelineAdminTx {
  private readonly client: PipelineQueryable;

  constructor(client: PipelineQueryable) {
    this.client = serial(client);
  }

  async load(): Promise<PipelineAdminSnapshot> {
    const pipelines = await loadPipelinesFrom(this.client);
    const [counts, used, pipelineCounts, types] = await Promise.all([
      this.client.query<{ stage_id: string; n: number }>(
        `SELECT stage_id, count(*)::int AS n FROM crm_schema.opportunities WHERE stage_id IS NOT NULL GROUP BY stage_id`,
      ),
      this.client.query<{ stage_id: string }>(
        `SELECT stage_id FROM (
            SELECT from_stage_id AS stage_id FROM crm_schema.opportunity_stage_history
            UNION SELECT to_stage_id FROM crm_schema.opportunity_stage_history
            UNION SELECT stage_id FROM crm_schema.opportunity_stage_plan WHERE status <> 'PENDING'
          ) u WHERE stage_id IS NOT NULL`,
      ),
      this.client.query<{ pipeline_id: string; n: number }>(
        `SELECT pipeline_id, count(*)::int AS n FROM crm_schema.opportunities WHERE pipeline_id IS NOT NULL GROUP BY pipeline_id`,
      ),
      this.client.query<{ code: string }>(`SELECT code FROM crm_schema.document_types`),
    ]);
    const opportunityCount = new Map(counts.rows.map((row) => [row.stage_id, row.n]));
    const usedIds = new Set(used.rows.map((row) => row.stage_id));
    const stageUsage = new Map<string, StageUsage>();
    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages) {
        const count = opportunityCount.get(stage.id) ?? 0;
        stageUsage.set(stage.id, { opportunityCount: count, used: count > 0 || usedIds.has(stage.id) });
      }
    }
    return {
      pipelines,
      stageUsage,
      pipelineOpportunityCount: new Map(pipelineCounts.rows.map((row) => [row.pipeline_id, row.n])),
      documentTypeCodes: new Set(types.rows.map((row) => row.code)),
    };
  }

  async insertPipeline(input: {
    code: string;
    name: string;
    profile: string;
    careSuggestion: boolean;
    actorId: string;
  }): Promise<string> {
    const result = await this.client.query<{ id: string }>(
      `INSERT INTO crm_schema.pipelines (code, name, profile, is_default, active, sort_order, care_suggestion, created_by, updated_by)
       VALUES ($1, $2, $3, false, true,
               COALESCE((SELECT max(sort_order) FROM crm_schema.pipelines), 0) + 10, $4, $5::uuid, $5::uuid)
       RETURNING id`,
      [input.code, input.name, input.profile, input.careSuggestion, input.actorId],
    );
    return result.rows[0].id;
  }

  async updatePipeline(
    id: string,
    patch: { name?: string; active?: boolean; careSuggestion?: boolean },
    actorId: string,
  ): Promise<void> {
    await this.client.query(
      `UPDATE crm_schema.pipelines
          SET name = COALESCE($2, name), active = COALESCE($3, active), care_suggestion = COALESCE($4, care_suggestion),
              updated_at = now(), updated_by = $5::uuid
        WHERE id = $1::uuid`,
      [id, patch.name ?? null, patch.active ?? null, patch.careSuggestion ?? null, actorId],
    );
  }

  async setPipelineOrder(ids: readonly string[], actorId: string): Promise<void> {
    await this.client.query(
      `UPDATE crm_schema.pipelines p SET sort_order = o.position * 10, updated_at = now(), updated_by = $2::uuid
         FROM unnest($1::uuid[]) WITH ORDINALITY AS o (id, position) WHERE p.id = o.id`,
      [ids, actorId],
    );
  }

  async setDefaultPipeline(id: string, actorId: string): Promise<void> {
    await this.client.query(
      `UPDATE crm_schema.pipelines SET is_default = false, updated_at = now(), updated_by = $1::uuid WHERE is_default AND id <> $2::uuid`,
      [actorId, id],
    );
    await this.client.query(
      `UPDATE crm_schema.pipelines SET is_default = true, updated_at = now(), updated_by = $2::uuid WHERE id = $1::uuid`,
      [id, actorId],
    );
  }

  async deletePipeline(id: string): Promise<void> {
    await this.client.query(`DELETE FROM crm_schema.pipeline_stages WHERE pipeline_id = $1::uuid`, [id]);
    await this.client.query(`DELETE FROM crm_schema.pipelines WHERE id = $1::uuid`, [id]);
  }

  async insertStage(pipelineId: string, input: Required<StageColumns>, actorId: string): Promise<string> {
    const result = await this.client.query<{ id: string }>(
      `INSERT INTO crm_schema.pipeline_stages
         (pipeline_id, code, name, semantic, sort_order, default_probability, active, skippable, assignee_rule,
          assignee_param, created_by, updated_by)
       VALUES ($1::uuid, $2, $3, $4,
               COALESCE((SELECT max(sort_order) FROM crm_schema.pipeline_stages WHERE pipeline_id = $1::uuid), 0) + 10,
               $5, $6, $7, $8, $9, $10::uuid, $10::uuid)
       RETURNING id`,
      [
        pipelineId,
        input.code,
        input.name,
        input.semantic,
        input.defaultProbability,
        input.active,
        input.skippable,
        input.assigneeRule,
        input.assigneeParam,
        actorId,
      ],
    );
    const id = result.rows[0].id;
    if (input.semantic === 'OPEN') {
      // Dự án đang chạy của luồng nhận thêm dòng kế hoạch "chờ" cho giai đoạn mới.
      await this.client.query(
        `INSERT INTO crm_schema.opportunity_stage_plan (opportunity_id, stage_id, status)
         SELECT o.id, $1::uuid, 'PENDING'
           FROM crm_schema.opportunities o
           JOIN crm_schema.pipeline_stages cur ON cur.id = o.stage_id
          WHERE o.pipeline_id = $2::uuid AND cur.semantic = 'OPEN'
         ON CONFLICT (opportunity_id, stage_id) DO NOTHING`,
        [id, pipelineId],
      );
    }
    return id;
  }

  async updateStage(id: string, patch: StageColumns, actorId: string): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const key of Object.keys(STAGE_COLUMN_SQL) as (keyof StageColumns)[]) {
      if (!(key in patch)) continue;
      values.push(patch[key] ?? null);
      sets.push(`${STAGE_COLUMN_SQL[key]} = $${values.length}`);
    }
    if (sets.length === 0) return;
    values.push(actorId);
    await this.client.query(
      `UPDATE crm_schema.pipeline_stages SET ${sets.join(', ')}, updated_at = now(), updated_by = $${values.length}::uuid
        WHERE id = $1::uuid`,
      values,
    );
  }

  async setStageOrder(pipelineId: string, ids: readonly string[], actorId: string): Promise<void> {
    await this.client.query(
      `UPDATE crm_schema.pipeline_stages s SET sort_order = o.position * 10, updated_at = now(), updated_by = $3::uuid
         FROM unnest($1::uuid[]) WITH ORDINALITY AS o (id, position)
        WHERE s.id = o.id AND s.pipeline_id = $2::uuid`,
      [ids, pipelineId, actorId],
    );
  }

  async deleteStage(id: string): Promise<void> {
    // Chỉ còn dòng kế hoạch "chờ" (kiểm ở service); bước chuyển và điều kiện xoá theo (ON DELETE CASCADE).
    await this.client.query(`DELETE FROM crm_schema.opportunity_stage_plan WHERE stage_id = $1::uuid AND status = 'PENDING'`, [id]);
    await this.client.query(`DELETE FROM crm_schema.pipeline_stages WHERE id = $1::uuid`, [id]);
  }

  async replaceTransitions(fromStageId: string, toStageIds: readonly string[]): Promise<void> {
    await this.client.query(`DELETE FROM crm_schema.pipeline_stage_transitions WHERE from_stage_id = $1::uuid`, [fromStageId]);
    if (toStageIds.length === 0) return;
    await this.client.query(
      `INSERT INTO crm_schema.pipeline_stage_transitions (from_stage_id, to_stage_id)
       SELECT $1::uuid, t FROM unnest($2::uuid[]) AS t`,
      [fromStageId, toStageIds],
    );
  }

  async replaceRequirements(stageId: string, requirements: readonly ValidatedRequirement[]): Promise<void> {
    await this.client.query(`DELETE FROM crm_schema.pipeline_stage_requirements WHERE stage_id = $1::uuid`, [stageId]);
    for (const requirement of requirements) {
      await this.client.query(
        `INSERT INTO crm_schema.pipeline_stage_requirements (stage_id, kind, ref, required, message, sort_order)
         VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
        [stageId, requirement.kind, requirement.ref, requirement.required, requirement.message, requirement.sortOrder],
      );
    }
  }

  async audit(entry: CrmAuditEntry): Promise<void> {
    await writeAuditLog(this.client, entry);
  }
}
