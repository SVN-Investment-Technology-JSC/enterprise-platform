import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import type {
  CreateMaintenanceIncidentRequest,
  CreateMaintenanceScheduleRequest,
  MaintenanceHistoryFilter,
  MaintenanceHistoryPage,
  MaintenanceFrequency,
  MaintenanceOccurrence,
  MaintenanceProcedureCatalogEntry,
  MaintenanceSchedule,
  MaintenanceSettingsEntry,
  UpdateMaintenanceScheduleRequest,
} from '@enterprise-platform/contracts-maintenance';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { MaintenanceActor, MaintenanceSnapshot, MaintenanceStore } from '../application/maintenance-store.port.js';
import { MaintenanceError } from '../domain/maintenance.error.js';
import {
  DEFAULT_FREQUENCY_CATALOG,
  normalizeMaintenanceSetting,
} from '../application/maintenance-settings.js';

type Row = QueryResultRow & Record<string, unknown>;

function mapSettingsEntry(row: Row): MaintenanceSettingsEntry<unknown> {
  return {
    key: String(row.key),
    value: row.value,
    version: Number(row.version ?? 0),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(String(row.updated_at)).toISOString(),
    updatedBy: row.updated_by == null ? undefined : String(row.updated_by),
  };
}

/** An occurrence claimed in phase 1, awaiting the phase 2 HTTP dispatch. */
interface DispatchTarget {
  readonly occurrenceId: string;
  readonly idempotencyKey: string;
  readonly title: string;
  /** null when the schedule has no published procedure to start. */
  readonly definitionId: string | null;
  /**
   * Thiết bị mà phiếu này thực sự làm trên đó.
   *
   * Quy trình dùng nó để nạp đầu việc của ĐÚNG máy này, thay vì mã thiết bị gõ
   * tay vào popover vai E lúc thiết kế. Thiếu nó thì một quy trình bảo trì dùng
   * chung cho cả dãy máy sẽ sinh phiếu nào cũng ra đầu việc của máy đầu tiên.
   */
  readonly assetCode: string | null;
}

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
      // LEFT JOIN: sự cố không có lịch cha, INNER JOIN sẽ làm chúng biến mất
      // khỏi mọi màn hình. COALESCE để phiếu định kỳ vẫn lấy được thiết bị và
      // tiêu đề từ lịch, còn sự cố dùng của chính nó.
      pool.query<Row>(`SELECT o.*, s.title AS schedule_title,
          COALESCE(o.asset_code, s.asset_code) AS asset_code,
          COALESCE(o.title, s.title) AS display_title
        FROM maintenance_schema.occurrences o
        LEFT JOIN maintenance_schema.schedules s ON s.id = o.schedule_id
        ORDER BY o.due_at DESC`),
      pool.query<Row>('SELECT * FROM maintenance_schema.procedure_catalog ORDER BY code'),
    ]);
    return {
      schedules: schedules.rows.map(mapSchedule),
      occurrences: occurrences.rows.map(mapOccurrence),
      procedureCatalog: procedureCatalog.rows.map(mapProcedureCatalog),
    };
  }

  async readHistory(
    tenantId: string,
    filter: MaintenanceHistoryFilter,
  ): Promise<MaintenanceHistoryPage> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);

    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace('?', `$${params.length}`));
    };

    if (filter.assetCode?.trim()) {
      add('COALESCE(o.asset_code, s.asset_code) ILIKE ?', `%${filter.assetCode.trim()}%`);
    }
    if (filter.kind) add('o.kind = ?', filter.kind);
    if (filter.status) add('o.status = ?', filter.status);
    if (filter.from) add('o.due_at >= ?', new Date(filter.from));
    if (filter.to) add('o.due_at <= ?', new Date(filter.to));

    // Keyset thay OFFSET: danh sách sắp theo (due_at, id) giảm dần, nên trang sau
    // chỉ cần "nhỏ hơn con trỏ". OFFSET sẽ nhảy cóc hoặc lặp khi có phiếu mới chèn vào.
    if (filter.cursor) {
      const [dueAt, id] = filter.cursor.split('|');
      params.push(new Date(dueAt), id);
      where.push(`(o.due_at, o.id) < ($${params.length - 1}, $${params.length})`);
    }

    const predicate = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    // Thống kê tính trên toàn bộ tập lọc, không theo trang — Flow B cần "tổng số
    // lần" và "tỷ lệ đúng hạn" của cả kết quả lọc.
    const statsPredicate = predicate
      .replace(/ AND \(o\.due_at, o\.id\) < \(\$\d+, \$\d+\)/, '')
      .replace(/WHERE \(o\.due_at, o\.id\) < \(\$\d+, \$\d+\)/, '');
    const statsParams = filter.cursor ? params.slice(0, -2) : params;

    const [rows, stats] = await Promise.all([
      pool.query<Row>(
        `SELECT o.*, s.title AS schedule_title,
            COALESCE(o.asset_code, s.asset_code) AS asset_code,
            COALESCE(o.title, s.title) AS display_title
           FROM maintenance_schema.occurrences o
           LEFT JOIN maintenance_schema.schedules s ON s.id = o.schedule_id
           ${predicate}
          ORDER BY o.due_at DESC, o.id DESC
          LIMIT ${limit + 1}`,
        params,
      ),
      pool.query<Row>(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE o.status = 'completed') AS completed,
                count(*) FILTER (WHERE o.status = 'completed' AND o.completed_at <= o.due_at) AS on_time
           FROM maintenance_schema.occurrences o
           LEFT JOIN maintenance_schema.schedules s ON s.id = o.schedule_id
           ${statsPredicate}`,
        statsParams,
      ),
    ]);

    const items = rows.rows.slice(0, limit).map(mapOccurrence);
    const last = items[items.length - 1];
    const stat = stats.rows[0];
    const completed = Number(stat?.completed ?? 0);

    return {
      items,
      nextCursor:
        rows.rows.length > limit && last ? `${last.dueAt}|${last.id}` : undefined,
      stats: {
        total: Number(stat?.total ?? 0),
        completed,
        onTimeRate: completed > 0 ? Math.round((Number(stat?.on_time ?? 0) / completed) * 100) : 0,
      },
    };
  }

  async findOccurrence(tenantId: string, id: string): Promise<MaintenanceOccurrence | undefined> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const result = await pool.query<Row>(
      `SELECT o.*, s.title AS schedule_title,
          COALESCE(o.asset_code, s.asset_code) AS asset_code,
          COALESCE(o.title, s.title) AS display_title
         FROM maintenance_schema.occurrences o
         LEFT JOIN maintenance_schema.schedules s ON s.id = o.schedule_id
        WHERE o.id = $1`,
      [id],
    );
    return result.rows[0] ? mapOccurrence(result.rows[0]) : undefined;
  }

  /** Actor nội bộ có userId 'system' — không phải uuid, ghi NULL thay vì vỡ kiểu. */
  async removeSchedulesForAsset(tenantId: string, assetCode: string): Promise<number> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    return inTransaction(pool, async (client) => {
      // Phiếu tham chiếu lịch bằng khoá ngoại nên phải xoá trước; phiếu đã mở hồ
      // sơ bên Quy trình thì hồ sơ đó vẫn còn, chỉ mất đường quay ngược về lịch.
      await client.query(
        `DELETE FROM maintenance_schema.occurrences
          WHERE schedule_id IN (SELECT id FROM maintenance_schema.schedules WHERE asset_code = $1)`,
        [assetCode],
      );
      const result = await client.query(
        `DELETE FROM maintenance_schema.schedules WHERE asset_code = $1`,
        [assetCode],
      );
      return result.rowCount ?? 0;
    });
  }

  async markSchedulesDueNow(tenantId: string, assetCode: string): Promise<number> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const result = await pool.query(
      `UPDATE maintenance_schema.schedules
          SET next_due_at = now(), updated_at = now()
        WHERE asset_code = $1 AND status = 'active'`,
      [assetCode],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Bỏ qua đúng MỘT lần bảo trì: đẩy hạn sang chu kỳ kế, không sinh phiếu.
   *
   * Dùng khi lần đó đã thuê bên thứ ba làm, hoặc thiết bị đang ngừng vận hành.
   * Khác "ngưng tạo lịch" ở chỗ lịch vẫn chạy tiếp — chỉ nhảy qua một kỳ.
   *
   * Tính hạn mới từ hạn HIỆN TẠI chứ không từ hôm nay: lịch quý đến hạn ngày 1/9
   * mà bỏ qua vào ngày 15/9 thì kỳ sau vẫn phải là 1/12, không phải 15/12 — nếu
   * không, mỗi lần bỏ qua là lịch trôi đi vài ngày và sau vài năm lệch hẳn mùa.
   */
  async skipNextOccurrence(tenantId: string, scheduleId: string): Promise<MaintenanceSchedule> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const current = await pool.query<Row>(
      `SELECT * FROM maintenance_schema.schedules WHERE id = $1`,
      [scheduleId],
    );
    const row = current.rows[0];
    if (!row) throw new MaintenanceError('not_found', 'Không tìm thấy lịch bảo trì.');

    const catalog = await readFrequencyCatalog(pool);
    const next = nextDue(asDate(row.next_due_at), String(row.frequency), catalog);
    const updated = await pool.query<Row>(
      `UPDATE maintenance_schema.schedules
          SET next_due_at = $2, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [scheduleId, next],
    );
    const saved = updated.rows[0];
    if (!saved) throw new MaintenanceError('not_found', 'Không cập nhật được lịch bảo trì.');
    return mapSchedule(saved);
  }

  async listSettings(tenantId: string): Promise<MaintenanceSettingsEntry<unknown>[]> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const result = await pool.query<Row>(
      `SELECT key, value, version, updated_at, updated_by
         FROM maintenance_schema.module_settings
        ORDER BY key`,
    );
    return result.rows.map(mapSettingsEntry);
  }

  async putSetting(
    tenantId: string,
    key: string,
    value: unknown,
    updatedBy: string,
    expectedVersion?: number,
  ): Promise<MaintenanceSettingsEntry<unknown> | undefined> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    // WHERE nằm trên nhánh DO UPDATE: dòng chưa có thì INSERT đi thẳng, dòng đã
    // có mà version lệch thì không update và không trả dòng nào — bên gọi đọc
    // "không có dòng" thành xung đột version.
    const result = await pool.query<Row>(
      `INSERT INTO maintenance_schema.module_settings (key, value, version, updated_at, updated_by)
       VALUES ($1, $2::jsonb, 1, now(), $3)
       ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value,
              version = maintenance_schema.module_settings.version + 1,
              updated_at = now(),
              updated_by = EXCLUDED.updated_by
        WHERE $4::int IS NULL OR maintenance_schema.module_settings.version = $4::int
       RETURNING key, value, version, updated_at, updated_by`,
      [key, JSON.stringify(value), updatedBy, expectedVersion ?? null],
    );
    return result.rows[0] ? mapSettingsEntry(result.rows[0]) : undefined;
  }

  private actorUuid(actor: MaintenanceActor): string | null {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor.userId)
      ? actor.userId
      : null;
  }

  async completeOccurrence(
    tenantId: string,
    actor: MaintenanceActor,
    id: string,
    note?: string,
  ): Promise<MaintenanceOccurrence> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    // `status <> 'completed'` trong WHERE: đóng rồi thì không mở lại được (AC-HST-06).
    const result = await pool.query<Row>(
      `UPDATE maintenance_schema.occurrences
          SET status = 'completed', completed_at = now(), completion_note = $2,
              completed_by = $3, completed_by_name = $4
        WHERE id = $1 AND status <> 'completed'
        RETURNING id`,
      [id, note?.trim() || null, this.actorUuid(actor), actor.displayName],
    );
    if (result.rowCount === 0) {
      const existing = await this.findOccurrence(tenantId, id);
      throw new MaintenanceError(
        existing ? 'conflict' : 'not_found',
        existing ? 'Phiếu này đã được đánh dấu hoàn thành.' : 'Không tìm thấy phiếu bảo trì.',
      );
    }
    const saved = await this.findOccurrence(tenantId, id);
    if (!saved) throw new MaintenanceError('not_found', 'Không tìm thấy phiếu bảo trì.');
    return saved;
  }

  async createIncident(
    tenantId: string,
    actor: MaintenanceActor,
    input: CreateMaintenanceIncidentRequest,
  ): Promise<MaintenanceOccurrence> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const id = randomUUID();
    const code = `INC-${new Date().getFullYear()}-${id.slice(0, 4).toUpperCase()}`;
    const hasProcedure = Boolean(input.procedureDefinitionId);

    await pool.query(
      `INSERT INTO maintenance_schema.occurrences
        (id, schedule_id, kind, code, title, asset_code, description, due_at, status,
         priority, procedure_definition_id, assignee_id, assignee_name,
         idempotency_key, created_by, created_by_name)
       VALUES ($1, NULL, 'incident', $2, $3, $4, $5, now(), $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id, code, input.title.trim(), input.assetCode.trim(), input.description?.trim() || null,
        hasProcedure ? 'dispatch_pending' : 'in_progress',
        input.priority ?? 'High',
        input.procedureDefinitionId ?? null,
        input.assigneeId ?? null, input.assigneeName?.trim() || null,
        `maintenance:incident:${id}`,
        this.actorUuid(actor), actor.displayName,
      ],
    );

    // Dispatch nằm ngoài transaction chèn, đúng như generateDueOccurrences: giữ
    // một lời gọi HTTP bên trong transaction sẽ khoá hàng suốt vòng round-trip.
    if (hasProcedure) {
      await this.dispatchToProcedure(pool, tenantId, {
        occurrenceId: id,
        idempotencyKey: `maintenance:incident:${id}`,
        title: input.title.trim(),
        definitionId: input.procedureDefinitionId as string,
        assetCode: input.assetCode.trim() || null,
      });
    }

    const saved = await this.findOccurrence(tenantId, id);
    if (!saved) throw new MaintenanceError('not_found', 'Không đọc lại được sự cố vừa tạo.');
    return saved;
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

  /**
   * Runs in two phases on purpose.
   *
   * Phase 1 (one transaction): claim due schedules, insert occurrences, advance
   * next_due_at. Phase 2 (no transaction): call Procedure over HTTP and record the
   * outcome per occurrence.
   *
   * They must stay separate. Doing the HTTP call inside the transaction would hold
   * row locks across a network round trip, and — worse — a failed call aborts the
   * transaction, so the "mark as failed" recovery write would itself fail with
   * "current transaction is aborted".
   */
  async generateDueOccurrences(tenantId: string, now: Date): Promise<number> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));

    const pending = await inTransaction(pool, async (client) => {
      const lock = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtext('maintenance-scheduler')) AS acquired`,
      );
      if (!lock.rows[0]?.acquired) return [];
      const due = await client.query<Row>(`SELECT s.*, p.version_number AS procedure_version
        FROM maintenance_schema.schedules s
        LEFT JOIN maintenance_schema.procedure_catalog p ON p.definition_id=s.procedure_definition_id
        WHERE s.status='active' AND s.next_due_at <= $1 FOR UPDATE OF s SKIP LOCKED`, [now]);

      // Đọc một lần cho cả lượt: mọi lịch trong lượt này dùng chung một bản
      // danh mục tần suất.
      const frequencyCatalog = await readFrequencyCatalog(client);
      const claimed: DispatchTarget[] = [];
      for (const schedule of due.rows) {
        const target = await this.insertOccurrence(client, schedule, frequencyCatalog);
        if (target) claimed.push(target);
      }
      return claimed;
    });

    for (const target of pending) {
      if (target.definitionId) await this.dispatchToProcedure(pool, tenantId, target);
    }
    return pending.length;
  }

  /**
   * Re-dispatches occurrences left in 'dispatch_pending'.
   *
   * There is no distributed transaction with Procedure, so a crash between the
   * HTTP call and the status write strands an occurrence: the work order may or
   * may not exist. Retrying is safe because idempotencyKey is derived from
   * (scheduleId, dueAt) — Procedure returns the existing instance rather than
   * creating a second one, so this converges either way.
   *
   * `staleAfterMs` keeps the sweep off occurrences the scheduler is dispatching
   * right now; only ones stuck longer than that are retried.
   */
  async reconcileStuckDispatches(
    tenantId: string,
    now: Date,
    staleAfterMs = 5 * 60_000,
    limit = 50,
  ): Promise<number> {
    const pool = await this.pools.forTenant(this.references.require(tenantId));
    const staleBefore = new Date(now.getTime() - staleAfterMs);

    const stuck = await pool.query<Row>(
      // LEFT JOIN + COALESCE: sự cố không có lịch, quy trình xử lý nằm ngay trên
      // chính nó. INNER JOIN sẽ khiến sự cố kẹt dispatch không bao giờ được gửi lại.
      `SELECT o.id, o.idempotency_key,
              COALESCE(o.title, s.title) AS title,
              COALESCE(o.procedure_definition_id, s.procedure_definition_id) AS procedure_definition_id,
              COALESCE(o.asset_code, s.asset_code) AS asset_code
         FROM maintenance_schema.occurrences o
         LEFT JOIN maintenance_schema.schedules s ON s.id = o.schedule_id
        WHERE o.status = 'dispatch_pending'
          AND o.procedure_instance_id IS NULL
          AND COALESCE(o.procedure_definition_id, s.procedure_definition_id) IS NOT NULL
          AND o.created_at < $1
        ORDER BY o.created_at
        LIMIT $2`,
      [staleBefore, limit],
    );

    let recovered = 0;
    for (const row of stuck.rows) {
      await this.dispatchToProcedure(pool, tenantId, {
        occurrenceId: String(row.id),
        idempotencyKey: String(row.idempotency_key),
        title: String(row.title),
        definitionId: String(row.procedure_definition_id),
        assetCode: row.asset_code ? String(row.asset_code) : null,
      });
      recovered += 1;
    }
    return recovered;
  }

  /** Inserts the occurrence and moves the schedule forward. No network I/O here. */
  private async insertOccurrence(
    client: PoolClient,
    schedule: Row,
    frequencyCatalog: ReadonlyMap<string, { unit: string; count: number }>,
  ): Promise<DispatchTarget | null> {
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

    await client.query(`UPDATE maintenance_schema.schedules SET next_due_at=$2,updated_at=now() WHERE id=$1`, [
      schedule.id, nextDue(dueAt, String(schedule.frequency), frequencyCatalog),
    ]);

    if (!inserted.rowCount) return null;
    return {
      occurrenceId,
      idempotencyKey,
      title: String(schedule.title),
      definitionId: hasProcedure ? String(schedule.procedure_definition_id) : null,
      assetCode: schedule.asset_code ? String(schedule.asset_code) : null,
    };
  }

  /** Each occurrence gets its own statement, so one failure cannot poison the rest. */
  private async dispatchToProcedure(
    pool: Awaited<ReturnType<PostgresPoolRegistry['forTenant']>>,
    tenantId: string,
    target: DispatchTarget,
  ): Promise<void> {
    try {
      const response = await fetch(`${this.procedureApiUrl}/v1/internal/instances`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId,
          'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
        },
        body: JSON.stringify({
          definitionId: target.definitionId,
          title: target.title,
          sourceType: 'maintenance_occurrence',
          sourceId: target.occurrenceId,
          idempotencyKey: target.idempotencyKey,
          assetCode: target.assetCode ?? undefined,
        }),
      });

      if (!response.ok) {
        await this.markDispatchFailed(pool, target.occurrenceId, `Procedure API trả về ${response.status}.`);
        return;
      }

      const instance = (await response.json()) as { id: string; code: string };
      await pool.query(`UPDATE maintenance_schema.occurrences
        SET procedure_instance_id=$2, procedure_instance_code=$3, status='generated', failure_reason=NULL
        WHERE id=$1`, [target.occurrenceId, instance.id, instance.code]);
    } catch (error) {
      await this.markDispatchFailed(
        pool,
        target.occurrenceId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async markDispatchFailed(
    pool: Awaited<ReturnType<PostgresPoolRegistry['forTenant']>>,
    occurrenceId: string,
    reason: string,
  ): Promise<void> {
    await pool.query(
      `UPDATE maintenance_schema.occurrences SET status='failed', failure_reason=$2 WHERE id=$1`,
      [occurrenceId, reason.slice(0, 1000)],
    );
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
    kind: (row.kind as MaintenanceOccurrence['kind']) ?? 'preventive',
    code: optional(row.code),
    scheduleId: optional(row.schedule_id),
    scheduleTitle: optional(row.schedule_title),
    title: String(row.display_title ?? row.title ?? row.schedule_title ?? ''),
    description: optional(row.description),
    assetCode: String(row.asset_code ?? ''),
    dueAt: iso(row.due_at),
    priority: row.priority as MaintenanceOccurrence['priority'],
    status: row.status as MaintenanceOccurrence['status'],
    procedureInstanceId: optional(row.procedure_instance_id),
    procedureInstanceCode: optional(row.procedure_instance_code),
    failureReason: optional(row.failure_reason),
    idempotencyKey: optional(row.idempotency_key),
    assigneeId: optional(row.assignee_id),
    assigneeName: optional(row.assignee_name),
    completionNote: optional(row.completion_note),
    completedBy: optional(row.completed_by),
    completedByName: optional(row.completed_by_name),
    createdBy: optional(row.created_by),
    createdByName: optional(row.created_by_name),
    createdAt: iso(row.created_at),
    completedAt: row.completed_at ? iso(row.completed_at) : undefined,
  };
}
function mapProcedureCatalog(row: Row): MaintenanceProcedureCatalogEntry {
  return { definitionId:String(row.definition_id),code:String(row.code),name:String(row.name),versionNumber:Number(row.version_number),
    status:row.status as MaintenanceProcedureCatalogEntry['status'],synchronizedAt:iso(row.synchronized_at) };
}
/**
 * Ngày đến hạn kế tiếp, tính từ interval trong danh mục tần suất.
 *
 * Đây là phần thật sự quan trọng khi cho admin tự định nghĩa tần suất: đổi nhãn
 * không ảnh hưởng gì, nhưng đổi `intervalUnit`/`intervalCount` là đổi lịch. Mã
 * không có trong danh mục thì rơi về mặc định dựng sẵn, và nếu vẫn không khớp
 * thì lùi một tháng — thà sinh phiếu hơi thưa còn hơn đứng im không sinh nữa.
 */
function nextDue(
  date: Date,
  frequency: MaintenanceFrequency,
  catalog: ReadonlyMap<string, { unit: string; count: number }>,
): Date {
  const interval = catalog.get(frequency) ?? { unit: 'month', count: 1 };
  const next = new Date(date);
  const count = Number.isInteger(interval.count) && interval.count > 0 ? interval.count : 1;
  if (interval.unit === 'day') next.setUTCDate(next.getUTCDate() + count);
  else if (interval.unit === 'week') next.setUTCDate(next.getUTCDate() + count * 7);
  else if (interval.unit === 'year') next.setUTCFullYear(next.getUTCFullYear() + count);
  else next.setUTCMonth(next.getUTCMonth() + count);
  return next;
}

/**
 * Đọc danh mục tần suất từ cấu hình module.
 *
 * Đọc trong chính transaction sinh phiếu để mọi lịch trong một lượt dùng cùng
 * một bản danh mục; admin sửa giữa chừng cũng không làm nửa lượt tính theo bản
 * cũ, nửa lượt theo bản mới.
 */
async function readFrequencyCatalog(
  client: Pick<PoolClient, 'query'>,
): Promise<Map<string, { unit: string; count: number }>> {
  const fallback = new Map(
    DEFAULT_FREQUENCY_CATALOG.options.map((option) => [
      option.code,
      { unit: option.intervalUnit, count: option.intervalCount },
    ]),
  );
  try {
    const result = await client.query<Row>(
      `SELECT value FROM maintenance_schema.module_settings WHERE key = 'catalog.frequency' LIMIT 1`,
    );
    const raw = result.rows[0]?.value;
    if (!raw) return fallback;
    const normalized = normalizeMaintenanceSetting('catalog.frequency', raw);
    const map = new Map(
      normalized.options.map((option) => [
        option.code,
        { unit: option.intervalUnit, count: option.intervalCount },
      ]),
    );
    // Giữ luôn các mã mặc định làm nền: một lịch đang chạy theo mã mà admin vừa
    // xoá khỏi danh mục vẫn phải tính được ngày kế tiếp.
    for (const [code, interval] of fallback) if (!map.has(code)) map.set(code, interval);
    return map;
  } catch {
    return fallback;
  }
}
