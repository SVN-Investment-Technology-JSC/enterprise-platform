import type {
  CreatePolicyRequest,
  CreatePolicyVersionRequest,
  HrmPolicy,
  HrmPolicyVersion,
  UpdatePolicyRequest,
} from '@enterprise-platform/contracts-hrm';
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';

@Controller('v1/policies')
export class HrmPolicyController {
  constructor(private readonly ctx: HrmContextService) {}

  // --------------------------------------------------------------------------
  // Policy Master APIs (P2_S3_HRM_API.md § 9.1)
  // --------------------------------------------------------------------------

  @Get()
  async listPolicies(
    @Req() req: Request,
    @Query('policy_type') policyType?: string,
    @Query('status') status?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.policies
       WHERE tenant_id = $1
         AND ($2::text IS NULL OR policy_type = $2)
         AND ($3::text IS NULL OR status = $3)
       ORDER BY created_at DESC`,
      [tenantId, policyType || null, status || null],
    );
    return {
      data: res.rows.map(this.mapPolicy),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post()
  async createPolicy(@Req() req: Request, @Body() body: CreatePolicyRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.policies (
        tenant_id, code, name, policy_type, status, description, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
      RETURNING *`,
      [
        tenantId,
        body.code,
        body.name,
        body.policyType,
        body.status || 'ACTIVE',
        body.description || null,
        principal.userId,
      ],
    );
    return {
      data: this.mapPolicy(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get(':policyId')
  async getPolicy(@Req() req: Request, @Param('policyId') policyId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.policies WHERE tenant_id = $1 AND id = $2`,
      [tenantId, policyId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_POLICY_NOT_FOUND', message: 'Policy not found' });
    }
    return {
      data: this.mapPolicy(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch(':policyId')
  async updatePolicy(
    @Req() req: Request,
    @Param('policyId') policyId: string,
    @Body() body: UpdatePolicyRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.policies SET
        name = COALESCE($3, name),
        status = COALESCE($4, status),
        description = COALESCE($5, description),
        updated_by = $6,
        updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING *`,
      [tenantId, policyId, body.name, body.status, body.description, principal.userId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_POLICY_NOT_FOUND', message: 'Policy not found' });
    }
    return {
      data: this.mapPolicy(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Policy Versions APIs (P2_S3_HRM_API.md § 9.2)
  // --------------------------------------------------------------------------

  @Get(':policyId/versions')
  async listVersions(@Req() req: Request, @Param('policyId') policyId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT pv.* FROM hrm_schema.policy_versions pv
       JOIN hrm_schema.policies p ON p.id = pv.policy_id
       WHERE p.tenant_id = $1 AND pv.policy_id = $2
       ORDER BY pv.version_no DESC`,
      [tenantId, policyId],
    );
    return {
      data: res.rows.map(this.mapVersion),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post(':policyId/versions')
  async createVersion(
    @Req() req: Request,
    @Param('policyId') policyId: string,
    @Body() body: CreatePolicyVersionRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const policyCheck = await pool.query(
      `SELECT id FROM hrm_schema.policies WHERE tenant_id = $1 AND id = $2`,
      [tenantId, policyId],
    );
    if (policyCheck.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_POLICY_NOT_FOUND', message: 'Policy not found' });
    }

    const res = await pool.query(
      `INSERT INTO hrm_schema.policy_versions (
        policy_id, version_no, effective_from, effective_to, config_json, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6)
      RETURNING *`,
      [
        policyId,
        body.versionNo,
        body.effectiveFrom,
        body.effectiveTo || null,
        JSON.stringify(body.configJson || {}),
        principal.userId,
      ],
    );
    return {
      data: this.mapVersion(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post(':policyId/versions/:versionId/activate')
  async activateVersion(
    @Req() req: Request,
    @Param('policyId') policyId: string,
    @Param('versionId') versionId: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    // Supersede other versions
    await pool.query(
      `UPDATE hrm_schema.policy_versions SET status = 'SUPERSEDED'
       WHERE policy_id = $1 AND status = 'ACTIVE'`,
      [policyId],
    );

    const res = await pool.query(
      `UPDATE hrm_schema.policy_versions pv SET status = 'ACTIVE'
       FROM hrm_schema.policies p
       WHERE pv.policy_id = p.id AND p.tenant_id = $1 AND pv.policy_id = $2 AND pv.id = $3
       RETURNING pv.*`,
      [tenantId, policyId, versionId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_VERSION_NOT_FOUND', message: 'Version not found' });
    }
    return {
      data: this.mapVersion(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post(':policyId/versions/:versionId/deactivate')
  async deactivateVersion(
    @Req() req: Request,
    @Param('policyId') policyId: string,
    @Param('versionId') versionId: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.policy_versions pv SET status = 'SUPERSEDED'
       FROM hrm_schema.policies p
       WHERE pv.policy_id = p.id AND p.tenant_id = $1 AND pv.policy_id = $2 AND pv.id = $3
       RETURNING pv.*`,
      [tenantId, policyId, versionId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({ code: 'HRM_VERSION_NOT_FOUND', message: 'Version not found' });
    }
    return {
      data: this.mapVersion(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  private mapPolicy(row: Record<string, unknown>): HrmPolicy {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      code: row.code as string,
      name: row.name as string,
      policyType: row.policy_type as any,
      status: row.status as any,
      description: row.description as string | null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      createdBy: row.created_by as string | null,
      updatedBy: row.updated_by as string | null,
    };
  }

  private mapVersion(row: Record<string, unknown>): HrmPolicyVersion {
    return {
      id: row.id as string,
      policyId: row.policy_id as string,
      versionNo: row.version_no as number,
      effectiveFrom: String(row.effective_from),
      effectiveTo: row.effective_to ? String(row.effective_to) : null,
      configJson: (row.config_json as Record<string, unknown>) || {},
      status: row.status as any,
      createdAt: String(row.created_at),
      createdBy: row.created_by as string | null,
    };
  }
}
