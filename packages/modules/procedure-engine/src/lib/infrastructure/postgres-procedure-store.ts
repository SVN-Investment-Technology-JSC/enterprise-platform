import { PostgresPoolRegistry, TenantDatabaseRegistry, inTransaction } from '@enterprise-platform/adapter-database';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import type { ProcedureDefinition, ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ProcedureStore, ProcedureTenantState } from '../application/procedure-store.port.js';

interface StateRow { state: ProcedureTenantState }
interface SnapshotRow<T> { snapshot: T }

export class PostgresProcedureStore implements ProcedureStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  async read(tenantId: string): Promise<ProcedureTenantState> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    return this.readState(pool);
  }

  async transaction<TValue>(tenantId: string, operation: (state: ProcedureTenantState) => Promise<TValue> | TValue): Promise<TValue> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    return inTransaction(pool, async (client) => {
      const compatibility = await client.query<StateRow>(
        `SELECT state FROM procedure_schema.runtime_state WHERE singleton=true FOR UPDATE`,
      );
      const legacy = structuredClone(compatibility.rows[0]?.state ?? emptyState());
      const state = await this.readNormalized(client, legacy);
      const before = structuredClone(state);
      const value = await operation(state);
      await this.synchronizeNormalized(client, state);
      await client.query(`INSERT INTO procedure_schema.runtime_state (singleton,state,updated_at)
        VALUES (true,$1::jsonb,now()) ON CONFLICT (singleton)
        DO UPDATE SET state=EXCLUDED.state,updated_at=now()`, [JSON.stringify(state)]);
      await this.appendEvents(client, tenantId, before, state);
      return structuredClone(value);
    });
  }

  private async readState(pool: Pool): Promise<ProcedureTenantState> {
    const legacyResult = await pool.query<StateRow>(`SELECT state FROM procedure_schema.runtime_state WHERE singleton=true`);
    return this.readNormalized(pool, structuredClone(legacyResult.rows[0]?.state ?? emptyState()));
  }

  private async readNormalized(client: Pick<Pool, 'query'> | PoolClient, legacy: ProcedureTenantState): Promise<ProcedureTenantState> {
    try {
      const [definitions, instances] = await Promise.all([
        client.query<SnapshotRow<ProcedureDefinition>>(`SELECT v.snapshot
          FROM procedure_schema.definitions d JOIN procedure_schema.versions v ON v.id=d.current_version_id
          ORDER BY d.name`),
        client.query<SnapshotRow<ProcedureInstance>>(`SELECT snapshot FROM procedure_schema.instances ORDER BY started_at DESC`),
      ]);
      if (definitions.rowCount === 0 && instances.rowCount === 0) return legacy;
      return {
        definitions: definitions.rows.map((row) => row.snapshot),
        instances: instances.rows.map((row) => row.snapshot),
        idempotency: legacy.idempotency ?? {},
      };
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (code === '42P01') return legacy;
      throw error;
    }
  }

  private async synchronizeNormalized(client: PoolClient, state: ProcedureTenantState): Promise<void> {
    await client.query('UPDATE procedure_schema.definitions SET current_version_id=NULL');
    await client.query('DELETE FROM procedure_schema.subtasks');
    await client.query('DELETE FROM procedure_schema.delegations');
    await client.query('DELETE FROM procedure_schema.activity_logs');
    await client.query('DELETE FROM procedure_schema.actions');
    await client.query('DELETE FROM procedure_schema.step_instances');
    await client.query('DELETE FROM procedure_schema.instances');
    await client.query('DELETE FROM procedure_schema.raci_assignments');
    await client.query('DELETE FROM procedure_schema.steps');
    await client.query('DELETE FROM procedure_schema.versions');
    await client.query('DELETE FROM procedure_schema.definitions');

    const versionByDefinition = new Map<string, string>();
    for (const definition of state.definitions) {
      await client.query(`INSERT INTO procedure_schema.definitions
        (id,code,name,description,kind,status,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [definition.id,definition.code,definition.name,
        definition.description ?? null,definition.kind,definition.status,definition.createdAt,definition.updatedAt]);
    }
    for (const definition of state.definitions) {
      const versionId = randomUUID();
      versionByDefinition.set(definition.id, versionId);
      await client.query(`INSERT INTO procedure_schema.versions
        (id,definition_id,version_number,status,snapshot,published_at,created_at)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`, [versionId,definition.id,Math.max(1,definition.versionNumber),
        definition.status === 'published' ? 'published' : 'draft',JSON.stringify(definition),definition.publishedAt ?? null,definition.createdAt]);
      for (const step of definition.steps) {
        await client.query(`INSERT INTO procedure_schema.steps
          (id,version_id,step_key,step_order,name,description,linked_definition_id,config)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb)`, [step.id,versionId,step.key,step.order,step.name,
          step.description ?? null,step.linkedDefinitionId ?? null]);
      }
      for (const step of definition.steps) for (const assignment of step.assignments) {
        await client.query(`INSERT INTO procedure_schema.raci_assignments
          (id,version_id,step_id,role_letter,subject_type,subject_id,subject_label,fixed_rollback_step_id,e_task_source,e_task_config)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [assignment.id,versionId,step.id,assignment.role,
          assignment.subjectType,assignment.subjectId,assignment.subjectLabel ?? null,assignment.fixedRollbackStepId ?? null,
          assignment.eTaskSource ?? null,JSON.stringify(assignment.eTaskConfig ?? {})]);
      }
      await client.query('UPDATE procedure_schema.definitions SET current_version_id=$2 WHERE id=$1', [definition.id,versionId]);
    }

    for (const instance of state.instances) {
      const versionId = versionByDefinition.get(instance.definitionId);
      if (!versionId) continue;
      const currentDefinitionStep = instance.steps.find((step) => step.id === instance.currentStepId)?.definitionStepId;
      const idempotencyKey = Object.entries(state.idempotency).find(([key,value]) => key.startsWith('start:') && value === instance.id)?.[0]?.slice(6);
      await client.query(`INSERT INTO procedure_schema.instances
        (id,definition_id,version_id,code,title,status,current_step_id,initiated_by,source_type,source_id,idempotency_key,snapshot,started_at,completed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`, [instance.id,instance.definitionId,versionId,
        instance.code,instance.title,instance.status,currentDefinitionStep ?? null,instance.initiatedBy,
        instance.sourceType ?? null,instance.sourceId ?? null,idempotencyKey ?? null,
        JSON.stringify(instance),instance.startedAt,instance.completedAt ?? null]);
      for (const step of instance.steps) {
        await client.query(`INSERT INTO procedure_schema.step_instances
          (id,instance_id,step_id,step_order,status,current_role_stage,snapshot,started_at,completed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`, [step.id,instance.id,step.definitionStepId,step.order,step.status,
          step.currentRoleStage,JSON.stringify(step),step.startedAt ?? null,step.completedAt ?? null]);
      }
      for (const subtask of instance.subtasks ?? []) {
        await client.query(`INSERT INTO procedure_schema.subtasks
          (id,instance_id,step_instance_id,title,assignee_id,assignee_name,weight,status,due_at,created_at,completed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [subtask.id,instance.id,subtask.stepInstanceId ?? null,
          subtask.title,subtask.assigneeId ?? null,subtask.assigneeName ?? null,subtask.weight,subtask.status,
          subtask.dueAt ?? null,subtask.createdAt,subtask.completedAt ?? null]);
      }
      for (const delegation of instance.delegations ?? []) {
        await client.query(`INSERT INTO procedure_schema.delegations
          (id,instance_id,step_instance_id,delegated_by,delegated_by_name,delegated_to,roles,reason,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [delegation.id,instance.id,delegation.stepInstanceId ?? null,
          delegation.delegatedBy,delegation.delegatedByName,delegation.delegatedTo,delegation.roles,
          delegation.reason ?? null,delegation.createdAt]);
      }

      const stepInstanceIds = new Set(instance.steps.map((step) => step.id));
      for (const activity of instance.activity) {
        await client.query(`INSERT INTO procedure_schema.activity_logs
          (id,instance_id,actor_id,action,summary,metadata,created_at)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [activity.id,instance.id,activity.actorId,activity.action,
          activity.summary,JSON.stringify({ actorName: activity.actorName, comment: activity.comment }),activity.createdAt]);

        // actions is the authoritative audit row: who did what, with which
        // comment, under which idempotency key. It used to be deleted here and
        // never written back, so every approval history was wiped on each save.
        await client.query(`INSERT INTO procedure_schema.actions
          (id,instance_id,step_instance_id,actor_id,action,comment,metadata,idempotency_key,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
          ON CONFLICT (idempotency_key) DO NOTHING`, [
          activity.id,
          instance.id,
          // Older rows predate stepInstanceId; drop the link rather than break the FK.
          activity.stepInstanceId && stepInstanceIds.has(activity.stepInstanceId)
            ? activity.stepInstanceId
            : null,
          activity.actorId,
          activity.action,
          activity.comment ?? null,
          JSON.stringify({ actorName: activity.actorName }),
          // Entries recorded before the key was carried fall back to their own id,
          // which is unique and keeps the NOT NULL column satisfiable.
          activity.idempotencyKey ?? activity.id,
          activity.createdAt,
        ]);
      }
    }
  }

  private async appendEvents(client: PoolClient, tenantId: string, before: ProcedureTenantState, after: ProcedureTenantState): Promise<void> {
    // Quy trình biến mất khỏi state = bị xoá. Phải báo cho các module đang giữ
    // bản sao danh mục (Bảo trì dùng nó để chọn quy trình xử lý), nếu không họ
    // vẫn chào một quy trình không còn tồn tại và phiếu sinh ra sẽ hỏng ngay.
    const stillThere = new Set(after.definitions.map((item) => item.id));
    for (const removed of before.definitions.filter((item) => !stillThere.has(item.id))) {
      const event = createIntegrationEvent({ id:randomUUID(),type:'procedure.definition.archived',version:1,tenantId,
        source:'procedure-engine',correlationId:removed.id,payload:{ definitionId:removed.id,code:removed.code } });
      await client.query(`INSERT INTO integration_schema.outbox_events
        (id,aggregate_type,aggregate_id,event_type,event_version,payload,occurred_at)
        VALUES ($1,'procedure-definition',$2,$3,$4,$5::jsonb,$6)`, [event.id,removed.id,event.type,event.version,JSON.stringify(event),event.occurredAt]);
    }

    const previouslyPublished = new Set(before.definitions.filter((item) => item.status === 'published').map((item) => `${item.id}:${item.versionNumber}`));
    const published = after.definitions.filter((item) => item.status === 'published' && !previouslyPublished.has(`${item.id}:${item.versionNumber}`));
    for (const definition of published) {
      const event = createIntegrationEvent({ id:randomUUID(),type:'procedure.definition.published',version:1,tenantId,
        source:'procedure-engine',correlationId:definition.id,payload:{ definitionId:definition.id,code:definition.code,
          name:definition.name,versionNumber:definition.versionNumber } });
      await client.query(`INSERT INTO integration_schema.outbox_events
        (id,aggregate_type,aggregate_id,event_type,event_version,payload,occurred_at)
        VALUES ($1,'procedure-definition',$2,$3,$4,$5::jsonb,$6)`, [event.id,definition.id,event.type,event.version,JSON.stringify(event),event.occurredAt]);
    }

    // Hồ sơ vừa rời trạng thái running. Phát cho mọi kết cục — completed, rejected,
    // cancelled — vì đây là sự thật nghiệp vụ; bên tiêu thụ tự quyết phản ứng. Bảo
    // trì cần nó để đóng phiếu sự cố khi workorder xử lý xong.
    const wasRunning = new Map(before.instances.map((item) => [item.id, item.status]));
    for (const instance of after.instances) {
      if (wasRunning.get(instance.id) !== 'running' || instance.status === 'running') continue;
      const event = createIntegrationEvent({ id:randomUUID(),type:'procedure.instance.completed',version:1,tenantId,
        source:'procedure-engine',correlationId:instance.id,payload:{ instanceId:instance.id,instanceCode:instance.code,
          status:instance.status,sourceType:instance.sourceType,sourceId:instance.sourceId,completedAt:instance.completedAt } });
      await client.query(`INSERT INTO integration_schema.outbox_events
        (id,aggregate_type,aggregate_id,event_type,event_version,payload,occurred_at)
        VALUES ($1,'procedure-instance',$2,$3,$4,$5::jsonb,$6)`, [event.id,instance.id,event.type,event.version,JSON.stringify(event),event.occurredAt]);
    }
  }
}

function emptyState(): ProcedureTenantState { return { definitions: [], instances: [], idempotency: {} }; }
