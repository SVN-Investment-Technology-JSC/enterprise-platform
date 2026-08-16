import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import type {
  CreateMaintenanceAssetRequest,
  CreateMaintenanceJobPlanRequest,
  CreateMaintenanceScheduleRequest,
  MaintenanceAsset,
  MaintenanceChecklistItem,
  MaintenanceFrequency,
  MaintenanceJobPlan,
  MaintenanceOccurrence,
  MaintenanceProcedureCatalogEntry,
  MaintenanceSchedule,
  UpdateMaintenanceAssetRequest,
  UpdateMaintenanceScheduleRequest,
} from '@enterprise-platform/contracts-maintenance';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { MaintenanceSnapshot, MaintenanceStore } from '../application/maintenance-store.port.js';
import { MaintenanceError } from '../domain/maintenance.error.js';

type Row = QueryResultRow & Record<string, unknown>;

export class PostgresMaintenanceStore implements MaintenanceStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  async read(tenantId: string): Promise<MaintenanceSnapshot> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const [assets, jobPlans, schedules, occurrences, procedureCatalog] = await Promise.all([
      pool.query<Row>('SELECT * FROM maintenance_schema.assets ORDER BY code'),
      pool.query<Row>('SELECT * FROM maintenance_schema.job_plans ORDER BY code'),
      pool.query<Row>(`SELECT s.*, p.code AS procedure_code, p.name AS procedure_name
        FROM maintenance_schema.schedules s
        LEFT JOIN maintenance_schema.procedure_catalog p ON p.definition_id = s.procedure_definition_id
        ORDER BY s.created_at DESC`),
      pool.query<Row>(`SELECT o.*, s.title AS schedule_title, a.id AS asset_id, a.code AS asset_code, a.name AS asset_name
        FROM maintenance_schema.occurrences o
        JOIN maintenance_schema.schedules s ON s.id = o.schedule_id
        JOIN maintenance_schema.assets a ON a.id = s.asset_id
        ORDER BY o.due_at DESC`),
      pool.query<Row>('SELECT * FROM maintenance_schema.procedure_catalog ORDER BY code'),
    ]);
    return {
      assets: assets.rows.map(mapAsset),
      jobPlans: jobPlans.rows.map(mapJobPlan),
      schedules: schedules.rows.map(mapSchedule),
      occurrences: occurrences.rows.map(mapOccurrence),
      procedureCatalog: procedureCatalog.rows.map(mapProcedureCatalog),
    };
  }

  async createAsset(tenantId: string, input: CreateMaintenanceAssetRequest): Promise<MaintenanceAsset> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    try {
      const result = await pool.query<Row>(`INSERT INTO maintenance_schema.assets
        (id, code, name, asset_type, parent_id, location, manufacturer, organization_unit_id, organization_unit_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [
        randomUUID(), input.code.trim().toUpperCase(), input.name.trim(), input.type, input.parentId ?? null,
        input.location?.trim() || null, input.manufacturer?.trim() || null,
        input.organizationUnitId ?? null, input.organizationUnitName?.trim() || null,
      ]);
      return mapAsset(result.rows[0]);
    } catch (error) {
      this.translateDatabaseError(error, 'Không thể tạo thiết bị với mã đã chọn.');
    }
  }

  async updateAsset(tenantId: string, id: string, input: UpdateMaintenanceAssetRequest): Promise<MaintenanceAsset> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const result = await pool.query<Row>(`UPDATE maintenance_schema.assets SET
      name = COALESCE($2, name), status = COALESCE($3, status), health = COALESCE($4, health),
      location = CASE WHEN $5::boolean THEN $6 ELSE location END,
      manufacturer = CASE WHEN $7::boolean THEN $8 ELSE manufacturer END,
      organization_unit_id = CASE WHEN $9::boolean THEN $10 ELSE organization_unit_id END,
      organization_unit_name = CASE WHEN $11::boolean THEN $12 ELSE organization_unit_name END,
      updated_at = now() WHERE id = $1 RETURNING *`, [
      id, input.name?.trim() || null, input.status ?? null, input.health ?? null,
      'location' in input, input.location?.trim() || null,
      'manufacturer' in input, input.manufacturer?.trim() || null,
      'organizationUnitId' in input, input.organizationUnitId ?? null,
      'organizationUnitName' in input, input.organizationUnitName?.trim() || null,
    ]);
    if (!result.rows[0]) throw new MaintenanceError('not_found', 'Không tìm thấy thiết bị.');
    return mapAsset(result.rows[0]);
  }

  async createJobPlan(tenantId: string, input: CreateMaintenanceJobPlanRequest): Promise<MaintenanceJobPlan> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const checklist: MaintenanceChecklistItem[] = input.checklist.map((item, index) => ({
      id: randomUUID(), order: index + 1, title: item.title.trim(), required: item.required ?? true,
    }));
    try {
      const result = await pool.query<Row>(`INSERT INTO maintenance_schema.job_plans
        (id, code, name, description, status, checklist, published_at)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`, [
        randomUUID(), input.code.trim().toUpperCase(), input.name.trim(), input.description?.trim() || null,
        input.publish ? 'published' : 'draft', JSON.stringify(checklist), input.publish ? new Date() : null,
      ]);
      return mapJobPlan(result.rows[0]);
    } catch (error) {
      this.translateDatabaseError(error, 'Không thể tạo job plan với mã đã chọn.');
    }
  }

  async createSchedule(tenantId: string, input: CreateMaintenanceScheduleRequest): Promise<MaintenanceSchedule> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const id = randomUUID();
    const code = `SCH-${id.slice(0, 8).toUpperCase()}`;
    try {
      const result = await pool.query<Row>(`INSERT INTO maintenance_schema.schedules
        (id, code, title, asset_id, job_plan_id, procedure_definition_id, frequency, status, start_date, timezone, next_due_at)
        SELECT $1,$2,concat(j.name, ' - ', a.name),a.id,j.id,$5,$6,$7,$8,$9,$8::date::timestamptz
        FROM maintenance_schema.assets a CROSS JOIN maintenance_schema.job_plans j
        WHERE a.id=$3 AND j.id=$4 RETURNING *`, [
        id, code, input.assetId, input.jobPlanId, input.procedureDefinitionId ?? null, input.frequency,
        input.activate ? 'active' : 'draft', input.startDate, input.timezone ?? 'Asia/Ho_Chi_Minh',
      ]);
      if (!result.rows[0]) throw new MaintenanceError('not_found', 'Không tìm thấy thiết bị hoặc job plan.');
      return mapSchedule(result.rows[0]);
    } catch (error) {
      if (error instanceof MaintenanceError) throw error;
      this.translateDatabaseError(error, 'Procedure liên kết chưa có trong catalog bảo trì.');
    }
  }

  async updateSchedule(tenantId: string, id: string, input: UpdateMaintenanceScheduleRequest): Promise<MaintenanceSchedule> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const result = await pool.query<Row>(`UPDATE maintenance_schema.schedules SET
      status=COALESCE($2,status),
      paused_reason=CASE WHEN $2='paused' THEN 'MANUAL' WHEN $2='active' THEN NULL ELSE paused_reason END,
      procedure_definition_id=CASE WHEN $3::boolean THEN $4 ELSE procedure_definition_id END,
      updated_at=now() WHERE id=$1 RETURNING *`, [
      id, input.status ?? null, 'procedureDefinitionId' in input, input.procedureDefinitionId ?? null,
    ]);
    if (!result.rows[0]) throw new MaintenanceError('not_found', 'Không tìm thấy lịch bảo trì.');
    return mapSchedule(result.rows[0]);
  }

  async generateDueOccurrences(tenantId: string, now: Date): Promise<number> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    return inTransaction(pool, async (client) => {
      const lock = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtext('maintenance-scheduler')) AS acquired`,
      );
      if (!lock.rows[0]?.acquired) return 0;
      const due = await client.query<Row>(`SELECT s.*, a.code AS asset_code, a.name AS asset_name,
        p.version_number AS procedure_version
        FROM maintenance_schema.schedules s
        JOIN maintenance_schema.assets a ON a.id=s.asset_id
        LEFT JOIN maintenance_schema.procedure_catalog p ON p.definition_id=s.procedure_definition_id
        WHERE s.status='active' AND s.next_due_at <= $1 FOR UPDATE OF s SKIP LOCKED`, [now]);
      let generated = 0;
      for (const schedule of due.rows) {
        await this.insertOccurrence(client, tenantId, schedule);
        generated += 1;
      }
      return generated;
    });
  }

  private async insertOccurrence(client: PoolClient, tenantId: string, schedule: Row): Promise<void> {
    const occurrenceId = randomUUID();
    const dueAt = asDate(schedule.next_due_at);
    const idempotencyKey = `maintenance:${String(schedule.id)}:${dueAt.toISOString()}`;
    const hasProcedure = Boolean(schedule.procedure_definition_id && schedule.procedure_version);
    const inserted = await client.query(`INSERT INTO maintenance_schema.occurrences
      (id, schedule_id, due_at, status, idempotency_key)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`, [
      occurrenceId, schedule.id, dueAt, hasProcedure ? 'dispatch_pending' : 'planned', idempotencyKey,
    ]);
    if (inserted.rowCount && hasProcedure) {
      const event = createIntegrationEvent({
        id: randomUUID(), type: 'maintenance.procedure-start.requested', version: 1,
        tenantId, source: 'maintenance', correlationId: occurrenceId,
        payload: {
          occurrenceId, scheduleId: schedule.id, definitionId: schedule.procedure_definition_id,
          definitionVersion: schedule.procedure_version, title: schedule.title, idempotencyKey,
          equipment: { id: schedule.asset_id, code: schedule.asset_code, name: schedule.asset_name },
        },
      });
      await client.query(`INSERT INTO integration_schema.outbox_events
        (id,aggregate_type,aggregate_id,event_type,event_version,payload,occurred_at)
        VALUES ($1,'maintenance-occurrence',$2,$3,$4,$5::jsonb,$6)`, [
        event.id, occurrenceId, event.type, event.version, JSON.stringify(event), event.occurredAt,
      ]);
    }
    await client.query(`UPDATE maintenance_schema.schedules SET next_due_at=$2,updated_at=now() WHERE id=$1`, [
      schedule.id, nextDue(dueAt, String(schedule.frequency) as MaintenanceFrequency),
    ]);
  }

  private translateDatabaseError(error: unknown, message: string): never {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    if (code === '23505' || code === '23503') throw new MaintenanceError('conflict', message);
    throw error;
  }
}

const iso = (value: unknown): string => asDate(value).toISOString();
const optional = (value: unknown): string | undefined => value == null ? undefined : String(value);
function asDate(value: unknown): Date { return value instanceof Date ? value : new Date(String(value)); }

function mapAsset(row?: Row): MaintenanceAsset {
  if (!row) throw new MaintenanceError('conflict', 'Database không trả về thiết bị vừa lưu.');
  return { id:String(row.id),code:String(row.code),name:String(row.name),type:row.asset_type as MaintenanceAsset['type'],
    parentId:optional(row.parent_id),status:row.status as MaintenanceAsset['status'],health:row.health as MaintenanceAsset['health'],
    location:optional(row.location),manufacturer:optional(row.manufacturer),organizationUnitId:optional(row.organization_unit_id),
    organizationUnitName:optional(row.organization_unit_name),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at) };
}
function mapJobPlan(row?: Row): MaintenanceJobPlan {
  if (!row) throw new MaintenanceError('conflict', 'Database không trả về job plan vừa lưu.');
  return { id:String(row.id),code:String(row.code),name:String(row.name),description:optional(row.description),
    status:row.status as MaintenanceJobPlan['status'],versionNumber:Number(row.version_number),
    checklist:(row.checklist ?? []) as MaintenanceChecklistItem[],createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),
    publishedAt:row.published_at ? iso(row.published_at) : undefined };
}
function mapSchedule(row?: Row): MaintenanceSchedule {
  if (!row) throw new MaintenanceError('conflict', 'Database không trả về lịch vừa lưu.');
  return { id:String(row.id),code:String(row.code),title:String(row.title),assetId:String(row.asset_id),jobPlanId:String(row.job_plan_id),
    procedureDefinitionId:optional(row.procedure_definition_id),procedureDefinitionCode:optional(row.procedure_code),
    procedureDefinitionName:optional(row.procedure_name),frequency:row.frequency as MaintenanceSchedule['frequency'],
    status:row.status as MaintenanceSchedule['status'],pausedReason:row.paused_reason as MaintenanceSchedule['pausedReason'],
    startDate:String(row.start_date).slice(0,10),timezone:String(row.timezone),nextDueAt:row.next_due_at ? iso(row.next_due_at) : undefined,
    createdAt:iso(row.created_at),updatedAt:iso(row.updated_at) };
}
function mapOccurrence(row: Row): MaintenanceOccurrence {
  return { id:String(row.id),scheduleId:String(row.schedule_id),scheduleTitle:String(row.schedule_title),assetId:String(row.asset_id),
    assetCode:String(row.asset_code),assetName:String(row.asset_name),dueAt:iso(row.due_at),status:row.status as MaintenanceOccurrence['status'],
    procedureInstanceId:optional(row.procedure_instance_id),procedureInstanceCode:optional(row.procedure_instance_code),
    failureReason:optional(row.failure_reason),createdAt:iso(row.created_at),completedAt:row.completed_at ? iso(row.completed_at) : undefined };
}
function mapProcedureCatalog(row: Row): MaintenanceProcedureCatalogEntry {
  return { definitionId:String(row.definition_id),code:String(row.code),name:String(row.name),versionNumber:Number(row.version_number),
    status:row.status as MaintenanceProcedureCatalogEntry['status'],synchronizedAt:iso(row.synchronized_at) };
}
function nextDue(date: Date, frequency: MaintenanceFrequency): Date {
  const next = new Date(date);
  if (frequency === 'day') next.setUTCDate(next.getUTCDate()+1);
  if (frequency === 'week') next.setUTCDate(next.getUTCDate()+7);
  if (frequency === 'month') next.setUTCMonth(next.getUTCMonth()+1);
  if (frequency === 'quarter') next.setUTCMonth(next.getUTCMonth()+3);
  if (frequency === 'year') next.setUTCFullYear(next.getUTCFullYear()+1);
  return next;
}
