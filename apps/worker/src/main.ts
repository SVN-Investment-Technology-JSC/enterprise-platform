import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { IdempotentInbox, RabbitMqConsumer, RabbitMqPublisher, TransactionalOutboxRelay } from '@enterprise-platform/adapter-events';
import { createIntegrationEvent, type IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { ProcedureDefinition, ProcedureInstance, ProcedureInstanceStep } from '@enterprise-platform/contracts-procedure-engine';
import { randomUUID } from 'node:crypto';
import { TenantProvisioningProcessor } from '@enterprise-platform/platform-entitlement/provisioning';

try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }

const publisher = new RabbitMqPublisher(process.env.RABBITMQ_URL ?? 'amqp://platform:platform@localhost:5672');
const platformPool = createPostgresPool(process.env.PLATFORM_DATABASE_URL ?? 'postgresql://platform:platform@localhost:55432/platform');
const tenantPools = new Map([
  ['11111111-1111-4111-8111-111111111111', createPostgresPool(process.env.TENANT_DAKROSA_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55433/dakrosa')],
  ['22222222-2222-4222-8222-222222222222', createPostgresPool(process.env.TENANT_ANPHAT_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55434/anphat')],
  ['33333333-3333-4333-8333-333333333333', createPostgresPool(process.env.TENANT_MINHLONG_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55435/minhlong')],
  ['44444444-4444-4444-8444-444444444444', createPostgresPool(process.env.TENANT_SAVINA_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55436/savina')],
]);
const pools = [platformPool, ...tenantPools.values()];
const relays = pools.map((pool) => new TransactionalOutboxRelay(pool, publisher));
const consumer = new RabbitMqConsumer(process.env.RABBITMQ_URL ?? 'amqp://platform:platform@localhost:5672', {
  queue: 'maintenance.integrations.v1',
  // 'maintenance.procedure-start.requested' giữ lại làm nhánh dự phòng: hiện không
  // nơi nào phát, đường đi sống là lời gọi HTTP trực tiếp từ maintenance store.
  bindings: ['procedure.definition.published', 'procedure.definition.archived', 'procedure.instance.started', 'procedure.instance.completed', 'platform.entitlement.changed', 'maintenance.procedure-start.requested'],
});
const provisioning = new TenantProvisioningProcessor(
  process.env.PLATFORM_DATABASE_URL ?? 'postgresql://platform:platform@localhost:55432/platform',
);
let running = false;

async function handleMaintenanceEvent(event: IntegrationEventEnvelope) {
  const pool = tenantPools.get(event.tenantId);
  if (!pool) return;
  const exists = await pool.query<{ exists: string | null }>(`SELECT to_regclass('maintenance_schema.schedules')::text AS exists`);
  if (!exists.rows[0]?.exists) return;
  const inbox = new IdempotentInbox(pool, 'maintenance.integrations.v1');
  await inbox.process(event, async () => {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === 'procedure.definition.published') {
      await pool.query(`INSERT INTO maintenance_schema.procedure_catalog
        (definition_id,code,name,version_number,status,synchronized_at)
        VALUES ($1,$2,$3,$4,'published',now()) ON CONFLICT (definition_id)
        DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name,version_number=EXCLUDED.version_number,status='published',synchronized_at=now()`,
        [payload.definitionId,payload.code,payload.name,payload.versionNumber]);
    } else if (event.type === 'procedure.definition.archived') {
      await pool.query(`UPDATE maintenance_schema.procedure_catalog SET status='archived',synchronized_at=now() WHERE definition_id=$1`,[payload.definitionId]);
      await pool.query(`UPDATE maintenance_schema.schedules SET status='paused',paused_reason='PROCEDURE_DEFINITION_UNAVAILABLE',updated_at=now() WHERE procedure_definition_id=$1 AND status='active'`,[payload.definitionId]);
    } else if (event.type === 'procedure.instance.started') {
      await pool.query(`UPDATE maintenance_schema.occurrences SET status='generated',procedure_instance_id=$2,procedure_instance_code=$3 WHERE id=$1`,[payload.occurrenceId,payload.instanceId,payload.instanceCode]);
    } else if (event.type === 'procedure.instance.completed') {
      // Chỉ đóng phiếu khi công việc THẬT SỰ được làm xong. Hồ sơ bị từ chối hay
      // huỷ nghĩa là bảo trì không diễn ra — ghi 'completed' sẽ làm sai cả lịch sử
      // lẫn tỷ lệ đúng hạn.
      const done = payload.status === 'completed';
      // `OR id=$1` phủ nhánh dispatch cũ của worker, nơi instance.id = occurrenceId.
      await pool.query(done
        ? `UPDATE maintenance_schema.occurrences
              SET status='completed', completed_at=COALESCE($2::timestamptz, now()),
                  completion_note=COALESCE(completion_note,'Tự động hoàn thành khi workorder kết thúc.')
            WHERE (procedure_instance_id=$1 OR id=$1) AND status<>'completed'`
        : `UPDATE maintenance_schema.occurrences
              SET status='failed', failure_reason=$2
            WHERE (procedure_instance_id=$1 OR id=$1) AND status<>'completed'`,
        // Số tham số phải khớp đúng số ô $n mà câu lệnh dùng. Trước đây nhánh
        // thất bại đánh số $3 nhưng không dùng $2, nên Postgres không suy được
        // kiểu của $2 và ném "could not determine data type of parameter $2" —
        // message lặp vô hạn, phiếu bảo trì không bao giờ được ghi 'failed'.
        done
          ? [payload.instanceId, payload.completedAt ?? null]
          : [
              payload.instanceId,
              `Workorder ${String(payload.instanceCode)} đã bị ${
                payload.status === 'rejected' ? 'từ chối' : 'huỷ'
              }.`,
            ]);
    } else if (event.type === 'maintenance.procedure-start.requested') {
      await startProcedureFromMaintenance(pool, event, payload);
    } else if (event.type === 'platform.entitlement.changed' && payload.moduleKey === 'procedure-engine') {
      if (payload.enabled === false) {
        await pool.query(`UPDATE maintenance_schema.schedules SET status='paused',paused_reason='PROCEDURE_ENTITLEMENT_DISABLED',updated_at=now() WHERE procedure_definition_id IS NOT NULL AND status='active'`);
      } else {
        await pool.query(`UPDATE maintenance_schema.schedules s SET status='active',paused_reason=NULL,updated_at=now()
          FROM maintenance_schema.procedure_catalog p WHERE s.procedure_definition_id=p.definition_id
          AND p.status='published' AND s.status='paused' AND s.paused_reason='PROCEDURE_ENTITLEMENT_DISABLED'`);
        await pool.query(`UPDATE maintenance_schema.schedules s SET paused_reason='PROCEDURE_DEFINITION_UNAVAILABLE',updated_at=now()
          WHERE s.status='paused' AND s.paused_reason='PROCEDURE_ENTITLEMENT_DISABLED'
          AND NOT EXISTS (SELECT 1 FROM maintenance_schema.procedure_catalog p WHERE p.definition_id=s.procedure_definition_id AND p.status='published')`);
      }
    }
  });
}

interface ProcedureState {
  definitions: ProcedureDefinition[];
  instances: ProcedureInstance[];
  idempotency: Record<string,string>;
}

async function startProcedureFromMaintenance(
  pool: ReturnType<typeof createPostgresPool>,
  event: IntegrationEventEnvelope,
  payload: Record<string,unknown>,
): Promise<void> {
  const occurrenceId=String(payload.occurrenceId);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const legacyResult=await client.query<{state:ProcedureState}>(`SELECT state FROM procedure_schema.runtime_state WHERE singleton=true FOR UPDATE`);
    const state=legacyResult.rows[0]?.state ?? {definitions:[],instances:[],idempotency:{}};
    const existing=state.instances.find((item)=>item.id===occurrenceId);
    if(existing){await client.query('COMMIT');return;}
    const definitionId=String(payload.definitionId);
    const normalized=await client.query<{version_id:string;snapshot:ProcedureDefinition}>(`SELECT v.id AS version_id,v.snapshot
      FROM procedure_schema.versions v WHERE v.definition_id=$1 AND v.status='published'
      ORDER BY v.version_number DESC LIMIT 1`,[definitionId]);
    const definition=normalized.rows[0]?.snapshot ?? state.definitions.find((item)=>item.id===definitionId);
    if(!definition||definition.status!=='published'){
      await client.query(`UPDATE maintenance_schema.occurrences SET status='blocked',failure_reason='PROCEDURE_DEFINITION_UNAVAILABLE' WHERE id=$1`,[occurrenceId]);
      await client.query('COMMIT');return;
    }
    const now=new Date().toISOString();
    const steps:ProcedureInstanceStep[]=definition.steps.map((step,index)=>({
      id:randomUUID(),definitionStepId:step.id,key:step.key,order:step.order,name:step.name,
      status:index===0?'active':'pending',currentRoleStage:step.assignments[0]?.role??null,
      assignments:structuredClone(step.assignments),startedAt:index===0?now:undefined,
    }));
    const instance:ProcedureInstance={
      id:occurrenceId,code:`PM-${occurrenceId.slice(0,8).toUpperCase()}`,title:String(payload.title),
      definitionId:definition.id,definitionCode:definition.code,definitionName:definition.name,
      definitionVersion:definition.versionNumber,status:'running',currentStepId:steps[0]?.id,
      initiatedBy:'00000000-0000-4000-8000-000000000001',startedAt:now,steps,
      activity:[{id:randomUUID(),action:'start',actorId:'00000000-0000-4000-8000-000000000001',actorName:'Maintenance Scheduler',summary:'Khởi tạo từ lịch bảo trì.',createdAt:now}],
    };
    state.instances.push(instance);
    state.idempotency[`start:${String(payload.idempotencyKey)}`]=instance.id;
    await client.query(`UPDATE procedure_schema.runtime_state SET state=$1::jsonb,updated_at=now() WHERE singleton=true`,[JSON.stringify(state)]);
    const versionId=normalized.rows[0]?.version_id;
    if(versionId){
      await client.query(`INSERT INTO procedure_schema.instances
        (id,definition_id,version_id,code,title,status,current_step_id,initiated_by,idempotency_key,snapshot,started_at)
        VALUES ($1,$2,$3,$4,$5,'running',$6,$7,$8,$9::jsonb,$10) ON CONFLICT (id) DO NOTHING`,
        [instance.id,instance.definitionId,versionId,instance.code,instance.title,steps[0]?.definitionStepId??null,instance.initiatedBy,payload.idempotencyKey,JSON.stringify(instance),now]);
      for(const step of steps) await client.query(`INSERT INTO procedure_schema.step_instances
        (id,instance_id,step_id,step_order,status,current_role_stage,snapshot,started_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (id) DO NOTHING`,
        [step.id,instance.id,step.definitionStepId,step.order,step.status,step.currentRoleStage,JSON.stringify(step),step.startedAt??null]);
      const activity=instance.activity[0];
      if(activity) await client.query(`INSERT INTO procedure_schema.activity_logs
        (id,instance_id,actor_id,action,summary,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
        ON CONFLICT (id) DO NOTHING`,[activity.id,instance.id,activity.actorId,activity.action,activity.summary,'{}',activity.createdAt]);
    }
    const started=createIntegrationEvent({id:occurrenceId,type:'procedure.instance.started',version:1,tenantId:event.tenantId,
      source:'procedure-engine',correlationId:event.correlationId,causationId:event.id,
      payload:{occurrenceId,scheduleId:payload.scheduleId,instanceId:instance.id,instanceCode:instance.code}});
    await client.query(`INSERT INTO integration_schema.outbox_events
      (id,aggregate_type,aggregate_id,event_type,event_version,payload,occurred_at)
      VALUES ($1,'procedure-instance',$2,$3,$4,$5::jsonb,$6) ON CONFLICT (id) DO NOTHING`,
      [started.id,instance.id,started.type,started.version,JSON.stringify(started),started.occurredAt]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

void consumer.start(handleMaintenanceEvent).catch((error) => {
  console.error('Maintenance consumer will require process restart:', error instanceof Error ? error.message : error);
});

async function tick() {
  if (running) return;
  running = true;
  try {
    await Promise.all([
      provisioning.processPending(),
      ...relays.map((relay) => relay.flush()),
    ]);
  } catch (error) {
    console.error('Worker tick will retry:', error instanceof Error ? error.message : error);
  } finally { running = false; }
}

const timer = setInterval(() => { void tick(); }, 1_000);
void tick();

async function shutdown() {
  clearInterval(timer);
  await Promise.all([
    provisioning.close(),
    publisher.close(),
    consumer.close(),
    ...pools.map((pool) => pool.end()),
  ]);
}

process.on('SIGINT', () => { void shutdown().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { void shutdown().finally(() => process.exit(0)); });
