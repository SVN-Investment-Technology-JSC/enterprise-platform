import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { Pool } from 'pg';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import {
  isProxyKind,
  loadProxyRules,
  mapProxyRule,
  normalizeProxyRuleInput,
  type ProxyRuleInput,
} from '../infrastructure/hrm-request-proxy.js';
import { requireUuid } from '../infrastructure/hrm-validation.js';

const meta = (req: Request) => ({ requestId: req.headers['x-request-id'] as string });

/**
 * Tạo đơn hộ: danh sách nhân viên được chọn ở ô "Tạo cho" (theo phạm vi của người dùng) và cấu hình phạm vi theo tenant.
 * Chỉ áp cho nghỉ phép, tăng ca, công tác. Việc tạo đơn nằm ở các route tạo đơn của từng loại.
 */
@Controller('v1/request-proxy')
export class HrmRequestProxyController {
  constructor(private readonly ctx: HrmContextService) {}

  /** Nhân viên người dùng được tạo hộ cho loại đơn này. 403 khi không có quyền tạo hộ. */
  @RequirePermission('hrm.read')
  @Get('candidates')
  async candidates(@Req() req: Request, @Query('kind') kind?: string, @Query('q') q?: string) {
    if (!kind || !isProxyKind(kind))
      throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: 'Chỉ tạo hộ đơn nghỉ phép, tăng ca hoặc công tác' });
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const data = await this.ctx.proxyScope.candidates({ pool, tenantId, principal }, kind, q ?? '');
    return { data, meta: meta(req) };
  }

  /** Cấu hình hiện có kèm danh sách đơn vị để chọn phạm vi. */
  @RequirePermission('hrm.request.proxy.configure')
  @Get('rules')
  async listRules(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.request.proxy.configure');
    const [rules, units, grantees] = await Promise.all([
      loadProxyRules(pool, tenantId),
      pool.query(
        `SELECT id, parent_id, code, name FROM core_schema.organization_nodes
          WHERE deleted_at IS NULL AND category <> 'position' AND status = 'active'
          ORDER BY sort_order, name`,
      ),
      pool.query(
        `SELECT id AS employee_id, user_id, full_name FROM core_schema.employees
          WHERE tenant_id = $1 AND user_id IS NOT NULL AND deleted_at IS NULL`,
        [tenantId],
      ),
    ]);
    const byUser = new Map(grantees.rows.map((g) => [g.user_id as string, g]));
    return {
      data: rules.map((rule) => {
        const grantee = rule.granteeUserId ? byUser.get(rule.granteeUserId) : undefined;
        return {
          ...rule,
          granteeEmployeeId: (grantee?.employee_id as string | undefined) ?? null,
          granteeName: (grantee?.full_name as string | undefined) ?? null,
        };
      }),
      units: units.rows.map((r) => ({ id: r.id, parentId: r.parent_id ?? null, code: r.code, name: r.name })),
      meta: meta(req),
    };
  }

  private async resolveInput(pool: Pool, tenantId: string, body: Record<string, unknown>) {
    const employeeId = body['granteeEmployeeId'];
    let granteeUserId: string | null = null;
    if (employeeId !== undefined && employeeId !== null && employeeId !== '') {
      const found = await pool.query(
        `SELECT user_id FROM core_schema.employees WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
        [tenantId, requireUuid(employeeId, 'Người được tạo hộ')],
      );
      granteeUserId = found.rows[0]?.user_id ?? null;
      if (!granteeUserId)
        throw new BadRequestException({
          code: 'HRM_INVALID_INPUT',
          message: 'Người được cấp quyền tạo hộ cần có tài khoản đăng nhập.',
        });
    }
    return normalizeProxyRuleInput({ ...body, granteeUserId });
  }

  private values(input: ProxyRuleInput) {
    return [input.name, input.granteeUserId, input.requestKinds, input.scopeType, input.unitIds, input.employeeIds, input.active];
  }

  @RequirePermission('hrm.request.proxy.configure')
  @Post('rules')
  async createRule(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.request.proxy.configure');
    const input = await this.resolveInput(pool, tenantId, body ?? {});
    const row = (
      await pool.query(
        `INSERT INTO hrm_schema.request_proxy_rules
           (tenant_id, name, grantee_user_id, request_kinds, scope_type, unit_ids, employee_ids, active, created_by, updated_by)
         VALUES ($1,$2,$3,$4::text[],$5,$6::uuid[],$7::uuid[],$8,$9,$9) RETURNING *`,
        [tenantId, ...this.values(input), principal.userId],
      )
    ).rows[0];
    await this.audit(pool, tenantId, principal.userId, 'REQUEST_PROXY_RULE_CREATED', row.id, input);
    return { data: mapProxyRule(row), meta: meta(req) };
  }

  @RequirePermission('hrm.request.proxy.configure')
  @Put('rules/:id')
  async updateRule(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.request.proxy.configure');
    const input = await this.resolveInput(pool, tenantId, body ?? {});
    const row = (
      await pool.query(
        `UPDATE hrm_schema.request_proxy_rules
            SET name=$3, grantee_user_id=$4, request_kinds=$5::text[], scope_type=$6, unit_ids=$7::uuid[], employee_ids=$8::uuid[],
                active=$9, updated_by=$10, updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING *`,
        [tenantId, requireUuid(id, 'Cấu hình'), ...this.values(input), principal.userId],
      )
    ).rows[0];
    if (!row) throw new NotFoundException({ code: 'HRM_PROXY_RULE_NOT_FOUND', message: 'Không tìm thấy cấu hình tạo hộ.' });
    await this.audit(pool, tenantId, principal.userId, 'REQUEST_PROXY_RULE_UPDATED', row.id, input);
    return { data: mapProxyRule(row), meta: meta(req) };
  }

  @RequirePermission('hrm.request.proxy.configure')
  @Delete('rules/:id')
  async deleteRule(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.request.proxy.configure');
    const res = await pool.query(
      `UPDATE hrm_schema.request_proxy_rules SET deleted_at=now(), updated_by=$3, updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`,
      [tenantId, requireUuid(id, 'Cấu hình'), principal.userId],
    );
    if (!res.rowCount) throw new NotFoundException({ code: 'HRM_PROXY_RULE_NOT_FOUND', message: 'Không tìm thấy cấu hình tạo hộ.' });
    await this.audit(pool, tenantId, principal.userId, 'REQUEST_PROXY_RULE_DELETED', id, {});
    return { data: { id }, meta: meta(req) };
  }

  private async audit(
    pool: Pool,
    tenantId: string,
    actorId: string,
    action: string,
    entityId: string,
    detail: unknown,
  ) {
    await pool.query(
      `INSERT INTO hrm_schema.audit_log(tenant_id, actor_id, action, entity_type, entity_id, detail)
       VALUES($1,$2,$3,'REQUEST_PROXY_RULE',$4,$5)`,
      [tenantId, actorId, action, entityId, JSON.stringify(detail)],
    );
  }
}
