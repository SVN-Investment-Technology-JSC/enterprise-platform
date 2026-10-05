import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import type { Pool } from 'pg';

interface OutboxRecord {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: any;
}

@Injectable()
export class OrgHrmBridgeConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrgHrmBridgeConsumer.name);
  private isProcessing = false;
  private intervalTimer?: NodeJS.Timeout;

  constructor(
    private readonly identity: PlatformIdentityService,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  onModuleInit() {
    // Polling định kỳ mỗi 10 giây xử lý Outbox events giữa CORE và HRM
    this.intervalTimer = setInterval(() => {
      void this.handleScheduledPolling();
    }, 10_000);
  }

  onModuleDestroy() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }
  }

  async handleScheduledPolling() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const activeTenants = await this.getActiveTenants();
      for (const tenantId of activeTenants) {
        await this.processTenantEvents(tenantId);
      }
    } catch (error) {
      this.logger.error('Error during Org-HRM Bridge execution', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async getActiveTenants(): Promise<string[]> {
    try {
      const tenants = await this.identity.listTenants();
      return tenants
        .filter((t) => t.status === 'active')
        .map((t) => t.id);
    } catch {
      return [];
    }
  }

  async processTenantEvents(tenantId: string): Promise<void> {
    try {
      const dbRef = await this.identity.serviceDatabase(tenantId, 'hrm');
      if (!dbRef) return;

      const pool = (await this.pools.forTenant(dbRef)) as unknown as Pool;

      // Đọc sự kiện outbox liên quan chưa xử lý với cơ chế lock an toàn FOR UPDATE SKIP LOCKED
      const res = await pool.query<OutboxRecord>(`
        SELECT id, aggregate_type, aggregate_id, event_type, payload
        FROM integration_schema.outbox_events
        WHERE published_at IS NULL
          AND attempts < 5
          AND event_type IN (
            'hrm.employee.offboarded',
            'core.org.assignment.created',
            'core.org.assignment.ended',
            'core.org.position.deleted'
          )
        ORDER BY occurred_at ASC
        LIMIT 25
        FOR UPDATE SKIP LOCKED
      `);

      for (const event of res.rows) {
        try {
          await this.handleSingleEvent(pool, tenantId, event);
          await pool.query(
            `UPDATE integration_schema.outbox_events SET published_at = now() WHERE id = $1`,
            [event.id],
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed handling event ${event.id}: ${message}`);
          await pool.query(
            `UPDATE integration_schema.outbox_events 
             SET attempts = attempts + 1, last_error = $2 
             WHERE id = $1`,
            [event.id, message],
          );
        }
      }
    } catch (err) {
      this.logger.debug(`Tenant ${tenantId} skipped or failed during bridge event processing: ${err}`);
    }
  }

  private async handleSingleEvent(
    pool: Pool,
    tenantId: string,
    event: OutboxRecord,
  ): Promise<void> {
    // 1. Kiểm tra Idempotency thông qua inbox_messages
    const exists = await pool.query(
      `SELECT 1 FROM integration_schema.inbox_messages WHERE consumer = 'org-hrm-bridge' AND event_id = $1`,
      [event.id],
    );
    if (exists.rowCount && exists.rowCount > 0) return;

    const data = event.payload?.payload || event.payload;

    switch (event.event_type) {
      case 'hrm.employee.offboarded':
        await this.deactivateEmployeeAssignments(
          pool,
          tenantId,
          data.employeeId,
          data.effectiveDate,
        );
        break;

      case 'core.org.assignment.created':
        await this.syncAssignmentEmployeeId(
          pool,
          tenantId,
          data.assignmentId,
          data.userId,
        );
        break;

      case 'core.org.assignment.ended':
        await this.checkRemainingAssignments(
          pool,
          tenantId,
          data.employeeId,
          data.userId,
        );
        break;

      case 'core.org.position.deleted':
        await this.deactivatePositionProfile(pool, tenantId, data.nodeId);
        break;
    }

    // 2. Ghi nhận đã xử lý vào inbox_messages
    await pool.query(
      `INSERT INTO integration_schema.inbox_messages (consumer, event_id) VALUES ('org-hrm-bridge', $1) ON CONFLICT DO NOTHING`,
      [event.id],
    );
  }

  // Tác vụ E-04: Nhân viên nghỉ việc (RESIGNED / TERMINATED) -> Chuyển toàn bộ bổ nhiệm CORE sang inactive
  private async deactivateEmployeeAssignments(
    pool: Pool,
    tenantId: string,
    employeeId: string,
    effectiveDate?: string,
  ) {
    if (!employeeId) return;
    const userRes = await pool.query(
      `SELECT user_id FROM core_schema.employees WHERE id = $1 AND tenant_id = $2`,
      [employeeId, tenantId],
    );
    const userId = userRes.rows[0]?.user_id;

    await pool.query(
      `
      UPDATE core_schema.organization_node_assignments
      SET status = 'inactive',
          end_date = COALESCE(end_date, COALESCE($3::date, CURRENT_DATE)),
          updated_at = now()
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND (employee_id = $1 OR (user_id IS NOT NULL AND user_id = $2))
    `,
      [employeeId, userId, effectiveDate || null],
    );

    // Vô hiệu hóa tài khoản liên kết (is_active = false, status = 'disabled')
    if (userId) {
      await pool.query(
        `
        UPDATE core_schema.users
        SET is_active = false,
            status = 'disabled',
            updated_at = now()
        WHERE id = $1 AND status <> 'disabled'
      `,
        [userId],
      );
    }
  }

  // Tác vụ E-01: Tự động map employee_id khi admin bổ nhiệm theo user_id
  private async syncAssignmentEmployeeId(
    pool: Pool,
    tenantId: string,
    assignmentId: string,
    userId: string,
  ) {
    if (!userId || !assignmentId) return;
    await pool.query(
      `
      UPDATE core_schema.organization_node_assignments a
      SET employee_id = e.id, updated_at = now()
      FROM core_schema.employees e
      WHERE a.id = $1
        AND e.user_id = a.user_id
        AND e.tenant_id = $2
        AND e.deleted_at IS NULL
        AND a.employee_id IS NULL
    `,
      [assignmentId, tenantId],
    );
  }

  // Tác vụ E-02: Kiểm tra nếu nhân viên không còn chức danh nào sau khi bãi nhiệm
  private async checkRemainingAssignments(
    pool: Pool,
    tenantId: string,
    employeeId?: string,
    userId?: string,
  ) {
    let empId = employeeId;
    if (!empId && userId) {
      const empRes = await pool.query(
        `SELECT id FROM core_schema.employees WHERE user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [userId, tenantId],
      );
      empId = empRes.rows[0]?.id;
    }
    if (!empId) return;

    const countRes = await pool.query(
      `
      SELECT COUNT(*) AS active_count 
      FROM core_schema.organization_node_assignments
      WHERE status = 'active' 
        AND deleted_at IS NULL 
        AND (employee_id = $1 OR user_id = (SELECT user_id FROM core_schema.employees WHERE id = $1))
    `,
      [empId],
    );

    if (parseInt(countRes.rows[0]?.active_count || '0', 10) === 0) {
      this.logger.warn(
        `Nhân sự ${empId} hiện không còn giữ chức danh active nào trên sơ đồ tổ chức.`,
      );
    }
  }

  // Tác vụ E-03: Node chức vụ bị xóa -> Vô hiệu hóa position_profiles của HRM
  private async deactivatePositionProfile(
    pool: Pool,
    tenantId: string,
    nodeId: string,
  ) {
    if (!nodeId) return;
    await pool.query(
      `
      UPDATE hrm_schema.position_profiles
      SET active = false, deleted_at = now(), updated_at = now()
      WHERE position_id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
    `,
      [nodeId, tenantId],
    );
  }
}
