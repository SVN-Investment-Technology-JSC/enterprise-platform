import type {
  Pipeline,
  PipelineProfile,
  PipelineStage,
  StageAssigneeRule,
  StageRequirement,
  StageRequirementKind,
  StageSemantic,
} from '@enterprise-platform/contracts-crm';
import type { PipelineConfigReader } from '../application/pipeline-config.port.js';
import type { CrmDatabase } from './crm.database.js';

interface PipelineRow {
  id: string;
  code: string;
  name: string;
  profile: PipelineProfile;
  is_default: boolean;
  active: boolean;
  sort_order: number;
}

interface StageRow {
  id: string;
  pipeline_id: string;
  code: string;
  name: string;
  semantic: StageSemantic;
  sort_order: number;
  default_probability: number;
  active: boolean;
  skippable: boolean;
  assignee_rule: StageAssigneeRule;
  assignee_param: string | null;
}

interface TransitionRow {
  from_stage_id: string;
  to_stage_id: string;
}

interface RequirementRow {
  stage_id: string;
  kind: StageRequirementKind;
  ref: string;
  required: boolean;
  message: string;
  sort_order: number;
}

/**
 * Đọc luồng, giai đoạn, bước chuyển và điều kiện từ `crm_schema` (0017, 0019).
 * Bốn truy vấn đọc nhanh; cache nằm ở `CachedPipelineConfig`.
 */
export class PostgresPipelineConfigReader implements PipelineConfigReader {
  constructor(private readonly database: CrmDatabase) {}

  async loadPipelines(tenantId: string): Promise<readonly Pipeline[]> {
    const pool = await this.database.pool(tenantId);
    const [pipelines, stages, transitions, requirements] = await Promise.all([
      pool.query<PipelineRow>(
        `SELECT id, code, name, profile, is_default, active, sort_order
           FROM crm_schema.pipelines ORDER BY sort_order, code`,
      ),
      pool.query<StageRow>(
        `SELECT id, pipeline_id, code, name, semantic, sort_order, default_probability, active, skippable,
                assignee_rule, assignee_param
           FROM crm_schema.pipeline_stages ORDER BY sort_order, code`,
      ),
      pool.query<TransitionRow>(`SELECT from_stage_id, to_stage_id FROM crm_schema.pipeline_stage_transitions`),
      pool.query<RequirementRow>(
        `SELECT stage_id, kind, ref, required, message, sort_order
           FROM crm_schema.pipeline_stage_requirements ORDER BY sort_order, kind, ref`,
      ),
    ]);
    const next = new Map<string, string[]>();
    for (const row of transitions.rows) {
      const list = next.get(row.from_stage_id) ?? [];
      list.push(row.to_stage_id);
      next.set(row.from_stage_id, list);
    }
    const required = new Map<string, StageRequirement[]>();
    for (const row of requirements.rows) {
      const list = required.get(row.stage_id) ?? [];
      list.push({ kind: row.kind, ref: row.ref, required: row.required, message: row.message, sortOrder: row.sort_order });
      required.set(row.stage_id, list);
    }
    return pipelines.rows.map((pipeline): Pipeline => ({
      id: pipeline.id,
      code: pipeline.code,
      name: pipeline.name,
      profile: pipeline.profile,
      isDefault: pipeline.is_default,
      active: pipeline.active,
      sortOrder: pipeline.sort_order,
      stages: stages.rows
        .filter((stage) => stage.pipeline_id === pipeline.id)
        .map((stage): PipelineStage => ({
          id: stage.id,
          pipelineId: stage.pipeline_id,
          code: stage.code,
          name: stage.name,
          semantic: stage.semantic,
          sortOrder: stage.sort_order,
          defaultProbability: stage.default_probability,
          active: stage.active,
          skippable: stage.skippable,
          assigneeRule: stage.assignee_rule,
          assigneeParam: stage.assignee_param,
          nextStageIds: next.get(stage.id) ?? [],
          requirements: required.get(stage.id) ?? [],
        })),
    }));
  }
}
