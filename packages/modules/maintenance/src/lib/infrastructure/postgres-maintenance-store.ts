import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import type {
  CreateMaintenanceScheduleRequest,
  MaintenanceFrequency,
  MaintenanceOccurrence,
  MaintenanceProcedureCatalogEntry,
  MaintenanceSchedule,
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
    private readonly procedureApiUrl: string = process.env['PROCEDURE_API_URL'] || 'http://localhost:3334/api/procedure',
  ) {}

  async read(tenantId: string): Promise<MaintenanceSnapshot> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const [schedules, occurrences, procedureCatalog] = await Promise.all([
      pool.query<Row>(`SELECT s.*, p.code AS procedure_code, p.name AS procedure_name
        FROM maintenance_schema.schedules s
        LEFT JOIN maintenance_schema.procedure_catalog p ON p.definition_id = s.procedure_definition_id
        ORDER BY s.created_at DESC`),
      pool.query<Row>(`SELECT o.*, s.title AS schedule_title
        FROM maintenance_schema.occurrences o
        JOIN maintenance_schema.schedules s ON s.id = o.schedule_id
        ORDER BY o.due_at DESC`),
      pool.query<Row>('SELECT * FROM maintenance_schema.procedure_catalog ORDER BY code'),
    ]);
    return {
      schedules: schedules.rows.map(mapSchedule),
      occurrences: occurrences.rows.map(mapOccurrence),
      procedureCatalog: procedureCatalog.rows.map(mapProcedureCatalog),
    };
  }

  async createSchedule(tenantId: string, input: CreateMaintenanceScheduleRequest): Promise<MaintenanceSchedule> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const id = randomUUID();
    const code = `SCH-${id.slice(0, 8).toUpperCase()}`;
    const title = input.procedureDefinitionId
      ? `Bảo trì ${input.assetCode}`
      : `Quản lý ${input.assetCode}`;
    try {
      const result = await pool.query<Row>(`INSERT INTO maintenance_schema.schedules
        (id, code, title, asset_code, procedure_definition_id, frequency, priority, status, start_date, timezone, next_due_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date::timestamptz) RETURNING *`, [
        id, code, title, input.assetCode, input.procedureDefinitionId ?? null, input.frequency,
        input.priority ?? 'Normal', input.activate ? 'active' : 'draft', input.startDate,
        input.timezone ?? 'Asia/Ho_Chi_Minh', input.startDate,
      ]);
      if (!result.rows[0]) throw new MaintenanceError('not_found', 'Không thể tạo lịch bảo trì.');
      return mapSchedule(result.rows[0]);
    } catch (error) {
      if (error instanceof MaintenanceError) throw error;
      this.translateDatabaseError(error, 'Lỗi tạo lịch bảo trì.');
    }
  }

  async updateSchedule(tenantId: string, id: string, input: UpdateMaintenanceScheduleRequest): Promise<MaintenanceSchedule> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const result = await pool.query<Row>(`UPDATE maintenance_schema.schedules SET
      status=COALESCE($2,status),
      priority=COALESCE($3,priority),
      paused_reason=CASE WHEN $2='paused' THEN 'MANUAL' WHEN $2='active' THEN NULL ELSE paused_reason END,
      procedure_definition_id=CASE WHEN $4::boolean THEN $5 ELSE procedure_definition_id END,
      updated_at=now() WHERE id=$1 RETURNING *`, [
      id, input.status ?? null, input.priority ?? null,
      'procedureDefinitionId' in input, input.procedureDefinitionId ?? null,
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
      const due = await client.query<Row>(`SELECT s.*, p.version_number AS procedure_version
        FROM maintenance_schema.schedules s
        LEFT JOIN maintenance_schema.procedure_catalog p ON p.definition_id=s.procedure_definition_id
        WHERE s.status='active' AND s.next_due_at <= $1 FOR UPDATE OF s SKIP LOCKED`, [now]);
      let generated = 0;
      for (const schedule of due.rows) {
        const created = await this.insertOccurrence(client, tenantId, schedule);
        if (created) generated += 1;
      }
      return generated;
    });
  }

  private async insertOccurrence(client: PoolClient, tenantId: string, schedule: Row): Promise<boolean> {
    const occurrenceId = randomUUID();
    const dueAt = asDate(schedule.next_due_at);
    const idempotencyKey = `maintenance:${String(schedule.id)}:${dueAt.toISOString()}`;
    const hasProcedure = Boolean(schedule.procedure_definition_id && schedule.procedure_version);

    const inserted = await client.query(`INSERT INTO maintenance_schema.occurrences
      (id, schedule_id, due_at, status, idempotency_key, priority)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`, [
      occurrenceId, schedule.id, dueAt, hasProcedure ? 'dispatch_pending' : 'planned',
      idempotencyKey, schedule.priority ?? 'Normal',
    ]);

    if (inserted.rowCount && hasProcedure) {
      try {
        // Call Procedure API synchronously to create instance
        const instanceResponse = await fetch(`${this.procedureApiUrl}/internal/instances`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId },
          body: JSON.stringify({
            definitionId: schedule.procedure_definition_id,
            title: schedule.title,
            sourceType: 'maintenance_occurrence',
            sourceId: occurrenceId,
            idempotencyKey,
          }),
        });

        if (instanceResponse.ok) {
          const instance = await instanceResponse.json();
          // Update occurrence with procedure instance IDs
          await client.query(`UPDATE maintenance_schema.occurrences
            SET procedure_instance_id = $2, procedure_instance_code = $3, status = 'generated', updated_at = now()
            WHERE id = $1`, [
            occurrenceId, instance.id, instance.code,
          ]);
        } else {
          // Mark as failed if Procedure API call fails
          await client.query(`UPDATE maintenance_schema.occurrences
            SET status = 'failed', updated_at = now()
            WHERE id = $1`, [occurrenceId]);
        }
      } catch (error) {
        console.error(`Failed to call Procedure API for occurrence ${occurrenceId}:`, error);
        // Mark as failed but don't throw - allow other occurrences to process
        await client.query(`UPDATE maintenance_schema.occurrences
          SET status = 'failed', updated_at = now()
          WHERE id = $1`, [occurrenceId]);
      }
    }

    // Update next due date for schedule
    await client.query(`UPDATE maintenance_schema.schedules SET next_due_at=$2,updated_at=now() WHERE id=$1`, [
      schedule.id, nextDue(dueAt, String(schedule.frequency) as MaintenanceFrequency),
    ]);

    return inserted.rowCount > 0;
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

function mapSchedule(row?: Row): MaintenanceSchedule {
  if (!row) throw new MaintenanceError('conflict', 'Database không trả về lịch vừa lưu.');
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    assetCode: String(row.asset_code),
    procedureDefinitionId: optional(row.procedure_definition_id),
    procedureDefinitionCode: optional(row.procedure_code),
    procedureDefinitionName: optional(row.procedure_name),
    frequency: row.frequency as MaintenanceSchedule['frequency'],
    priority: row.priority as MaintenanceSchedule['priority'],
    status: row.status as MaintenanceSchedule['status'],
    pausedReason: row.paused_reason as MaintenanceSchedule['pausedReason'],
    startDate: String(row.start_date).slice(0, 10),
    timezone: String(row.timezone),
    nextDueAt: row.next_due_at ? iso(row.next_due_at) : undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapOccurrence(row: Row): MaintenanceOccurrence {
  return {
    id: String(row.id),
    scheduleId: String(row.schedule_id),
    scheduleTitle: String(row.schedule_title),
    assetCode: String(row.asset_code ?? ''),
    dueAt: iso(row.due_at),
    priority: row.priority as MaintenanceOccurrence['priority'],
    status: row.status as MaintenanceOccurrence['status'],
    procedureInstanceId: optional(row.procedure_instance_id),
    procedureInstanceCode: optional(row.procedure_instance_code),
    failureReason: optional(row.failure_reason),
    idempotencyKey: optional(row.idempotency_key),
    createdAt: iso(row.created_at),
    completedAt: row.completed_at ? iso(row.completed_at) : undefined,
  };
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
