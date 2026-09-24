import type {
  HrmEmployeeProfile,
  HrmPositionProfile,
  HrmJobDescriptionItem,
  CreateEmployeeProfileRequest,
  UpdateEmployeeProfileRequest,
  CreatePositionProfileRequest,
  UpdatePositionProfileRequest,
} from '@enterprise-platform/contracts-hrm';
import {
  Body,
  Controller,
  Delete,
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

@Controller('v1')
export class HrmEmployeeController {
  constructor(private readonly ctx: HrmContextService) {}

  // --------------------------------------------------------------------------
  // Employee Profile APIs (P2_S3_HRM_API.md § 7)
  // --------------------------------------------------------------------------

  @Get('employees')
  async listEmployees(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('page') pageStr = '1',
    @Query('page_size') pageSizeStr = '20',
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr, 10) || 20));
    const offset = (page - 1) * pageSize;

    const countRes = await pool.query(
      `SELECT count(*)::int as total FROM hrm_schema.employee_profiles 
       WHERE tenant_id = $1 AND deleted_at IS NULL AND ($2::text IS NULL OR employment_status = $2)`,
      [tenantId, status || null],
    );
    const total = countRes.rows[0]?.total || 0;

    const res = await pool.query(
      `SELECT 
         ep.*,
         u.full_name,
         u.email as work_email,
         org.position_id,
         org.position_code,
         org.position_name,
         org.department_id,
         org.department_code,
         org.department_name,
         org.division_name,
         org.salary_grade_name,
         org.salary_grade_code
       FROM hrm_schema.employee_profiles ep
       LEFT JOIN core_schema.users u ON u.id = ep.employee_id
       LEFT JOIN LATERAL (
         SELECT 
           pos.id AS position_id,
           pos.code AS position_code,
           pos.name AS position_name,
           unit.id AS department_id,
           unit.code AS department_code,
           unit.name AS department_name,
           div.name AS division_name,
           sg.code AS salary_grade_code,
           sg.name AS salary_grade_name
         FROM core_schema.organization_node_assignments a
         JOIN core_schema.organization_nodes pos 
           ON pos.id = a.node_id 
          AND pos.deleted_at IS NULL
         LEFT JOIN core_schema.organization_nodes unit 
           ON unit.id = pos.parent_id 
          AND unit.deleted_at IS NULL
         LEFT JOIN core_schema.organization_nodes div 
           ON div.id = unit.parent_id 
          AND div.deleted_at IS NULL
         LEFT JOIN core_schema.organization_node_types div_type
           ON div_type.id = div.node_type_id
          AND div_type.category = 'unit'
         LEFT JOIN hrm_schema.position_profiles pp 
           ON pp.position_id = pos.id 
          AND pp.tenant_id = ep.tenant_id
         LEFT JOIN hrm_schema.salary_grades sg 
           ON sg.id = pp.salary_grade_id
         WHERE a.user_id = ep.employee_id 
           AND a.status = 'active' 
           AND a.deleted_at IS NULL
         ORDER BY a.is_primary DESC, a.created_at DESC
         LIMIT 1
       ) org ON true
       WHERE ep.tenant_id = $1 AND ep.deleted_at IS NULL AND ($2::text IS NULL OR ep.employment_status = $2)
       ORDER BY ep.employee_code ASC
       LIMIT $3 OFFSET $4`,
      [tenantId, status || null, pageSize, offset],
    );

    return {
      data: res.rows.map((row) => this.mapProfile(row)),
      meta: { page, pageSize, total, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('my-profile')
  async getMyProfile(@Req() req: Request) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    let res = await pool.query(
      `SELECT * FROM hrm_schema.employee_profiles
       WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
      [tenantId, principal.userId],
    );

    if (res.rows.length === 0) {
      // Auto-provision profile for current logged-in user if not exists
      const userRes = await pool.query(
        `SELECT id, email, full_name FROM core_schema.users WHERE id = $1 AND deleted_at IS NULL`,
        [principal.userId],
      );
      const user = userRes.rows[0];
      const initialCode = principal.email.startsWith('admin') ? 'EMP-ADMIN' : `EMP-${principal.userId.slice(0, 6).toUpperCase()}`;

      await pool.query(
        `INSERT INTO hrm_schema.employee_profiles (
          tenant_id, employee_id, employee_code, personal_email, employment_status, join_date, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'OFFICIAL', CURRENT_DATE, now(), now())
        ON CONFLICT (employee_id) DO UPDATE SET updated_at = now()`,
        [tenantId, principal.userId, initialCode, user?.email || principal.email],
      );

      res = await pool.query(
        `SELECT * FROM hrm_schema.employee_profiles
         WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
        [tenantId, principal.userId],
      );
    }

    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_EMPLOYEE_NOT_FOUND',
        message: 'No employee profile found for current user',
      });
    }

    // Attach user display name and work email
    const userRes = await pool.query(
      `SELECT id, email, full_name FROM core_schema.users WHERE id = $1`,
      [principal.userId],
    );
    const user = userRes.rows[0];

    // Query organization hierarchy and position assignment for this employee
    const orgRes = await pool.query(
      `SELECT 
         pos.id AS position_id,
         pos.code AS position_code,
         pos.name AS position_name,
         pos.metadata AS position_metadata,
         unit.id AS department_id,
         unit.code AS department_code,
         unit.name AS department_name,
         unit.metadata AS department_metadata,
         div.name AS division_name,
         sg.code AS salary_grade_code,
         sg.name AS salary_grade_name
       FROM core_schema.organization_node_assignments a
       JOIN core_schema.organization_nodes pos 
         ON pos.id = a.node_id 
        AND pos.deleted_at IS NULL
       LEFT JOIN core_schema.organization_nodes unit 
         ON unit.id = pos.parent_id 
        AND unit.deleted_at IS NULL
       LEFT JOIN core_schema.organization_nodes div 
         ON div.id = unit.parent_id 
        AND div.deleted_at IS NULL
       LEFT JOIN core_schema.organization_node_types div_type
         ON div_type.id = div.node_type_id
        AND div_type.category = 'unit'
       LEFT JOIN hrm_schema.position_profiles pp 
         ON pp.position_id = pos.id 
        AND pp.tenant_id = $1
       LEFT JOIN hrm_schema.salary_grades sg 
         ON sg.id = pp.salary_grade_id
       WHERE a.user_id = $2 
         AND a.status = 'active' 
         AND a.deleted_at IS NULL
       ORDER BY a.is_primary DESC, a.created_at DESC
       LIMIT 1`,
      [tenantId, principal.userId],
    );
    const org = orgRes.rows[0];

    const profile = this.mapProfile(res.rows[0], org);
    if (user) {
      (profile as any).fullName = user.full_name;
      (profile as any).email = user.email;
    } else {
      (profile as any).fullName = principal.displayName;
      (profile as any).email = principal.email;
    }

    return {
      data: profile,
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('my-profile')
  async updateMyProfile(@Req() req: Request, @Body() body: UpdateEmployeeProfileRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const targetEmployeeId = principal.userId;

    // Check if profile exists; if not, create it first
    const check = await pool.query(
      `SELECT employee_id FROM hrm_schema.employee_profiles WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
      [tenantId, targetEmployeeId],
    );
    if (check.rows.length === 0) {
      const userRes = await pool.query(
        `SELECT id, email, full_name FROM core_schema.users WHERE id = $1`,
        [principal.userId],
      );
      const user = userRes.rows[0];
      const initialCode = principal.email.startsWith('admin') ? 'EMP-ADMIN' : `EMP-${principal.userId.slice(0, 6).toUpperCase()}`;
      await pool.query(
        `INSERT INTO hrm_schema.employee_profiles (
          tenant_id, employee_id, employee_code, personal_email, employment_status, join_date, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'OFFICIAL', CURRENT_DATE, now(), now())
        ON CONFLICT (employee_id) DO UPDATE SET updated_at = now()`,
        [tenantId, principal.userId, initialCode, user?.email || principal.email],
      );
    }

    const res = await pool.query(
      `UPDATE hrm_schema.employee_profiles SET
        personal_email = COALESCE($3, personal_email),
        phone = COALESCE($4, phone),
        date_of_birth = COALESCE($5, date_of_birth),
        gender = COALESCE($6, gender),
        current_address = COALESCE($7, current_address),
        permanent_address = COALESCE($8, permanent_address),
        emergency_contact_name = COALESCE($9, emergency_contact_name),
        emergency_contact_phone = COALESCE($10, emergency_contact_phone),
        emergency_contact_relationship = COALESCE($11, emergency_contact_relationship),
        updated_by = $12,
        updated_at = now()
      WHERE tenant_id = $1 AND employee_id = $2
      RETURNING *`,
      [
        tenantId,
        targetEmployeeId,
        body.personalEmail,
        body.phone,
        body.dateOfBirth,
        body.gender,
        body.currentAddress,
        body.permanentAddress,
        body.emergencyContactName,
        body.emergencyContactPhone,
        body.emergencyContactRelationship,
        principal.userId,
      ],
    );

    const userRes = await pool.query(
      `SELECT id, email, full_name FROM core_schema.users WHERE id = $1`,
      [principal.userId],
    );
    const user = userRes.rows[0];
    const profile = this.mapProfile(res.rows[0]);
    if (user) {
      (profile as any).fullName = user.full_name;
      (profile as any).email = user.email;
    } else {
      (profile as any).fullName = principal.displayName;
      (profile as any).email = principal.email;
    }

    return {
      data: profile,
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('employees/:employeeId/profile')
  async getEmployeeProfile(@Req() req: Request, @Param('employeeId') employeeId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT 
         ep.*,
         u.full_name,
         u.email as work_email,
         org.position_id,
         org.position_code,
         org.position_name,
         org.department_id,
         org.department_code,
         org.department_name,
         org.division_name,
         org.salary_grade_name,
         org.salary_grade_code
       FROM hrm_schema.employee_profiles ep
       LEFT JOIN core_schema.users u ON u.id = ep.employee_id
       LEFT JOIN LATERAL (
         SELECT 
           pos.id AS position_id,
           pos.code AS position_code,
           pos.name AS position_name,
           unit.id AS department_id,
           unit.code AS department_code,
           unit.name AS department_name,
           div.name AS division_name,
           sg.code AS salary_grade_code,
           sg.name AS salary_grade_name
         FROM core_schema.organization_node_assignments a
         JOIN core_schema.organization_nodes pos 
           ON pos.id = a.node_id 
          AND pos.deleted_at IS NULL
         LEFT JOIN core_schema.organization_nodes unit 
           ON unit.id = pos.parent_id 
          AND unit.deleted_at IS NULL
         LEFT JOIN core_schema.organization_nodes div 
           ON div.id = unit.parent_id 
          AND div.deleted_at IS NULL
         LEFT JOIN core_schema.organization_node_types div_type
           ON div_type.id = div.node_type_id
          AND div_type.category = 'unit'
         LEFT JOIN hrm_schema.position_profiles pp 
           ON pp.position_id = pos.id 
          AND pp.tenant_id = ep.tenant_id
         LEFT JOIN hrm_schema.salary_grades sg 
           ON sg.id = pp.salary_grade_id
         WHERE a.user_id = ep.employee_id 
           AND a.status = 'active' 
           AND a.deleted_at IS NULL
         ORDER BY a.is_primary DESC, a.created_at DESC
         LIMIT 1
       ) org ON true
       WHERE ep.tenant_id = $1 AND ep.employee_id = $2 AND ep.deleted_at IS NULL`,
      [tenantId, employeeId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_EMPLOYEE_NOT_FOUND',
        message: `Employee profile not found for ID: ${employeeId}`,
      });
    }
    return {
      data: this.mapProfile(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('employees/:employeeId/profile')
  async createEmployeeProfile(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: CreateEmployeeProfileRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.employee_profiles (
        employee_id, tenant_id, employee_code, personal_email, phone, date_of_birth, gender,
        identity_card_number, identity_card_issued_date, identity_card_issued_place,
        tax_code, social_insurance_number, bank_account_number, bank_name, bank_branch,
        current_address, permanent_address, emergency_contact_name, emergency_contact_phone,
        emergency_contact_relationship, join_date, official_date, employment_status, note,
        created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21, $22, $23, $24,
        $25, $25
      ) RETURNING *`,
      [
        employeeId,
        tenantId,
        body.employeeCode,
        body.personalEmail || null,
        body.phone || null,
        body.dateOfBirth || null,
        body.gender || null,
        body.identityCardNumber || null,
        body.identityCardIssuedDate || null,
        body.identityCardIssuedPlace || null,
        body.taxCode || null,
        body.socialInsuranceNumber || null,
        body.bankAccountNumber || null,
        body.bankName || null,
        body.bankBranch || null,
        body.currentAddress || null,
        body.permanentAddress || null,
        body.emergencyContactName || null,
        body.emergencyContactPhone || null,
        body.emergencyContactRelationship || null,
        body.joinDate,
        body.officialDate || null,
        body.employmentStatus || 'OFFICIAL',
        body.note || null,
        principal.userId,
      ],
    );
    return {
      data: this.mapProfile(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('employees/:employeeId/profile')
  async updateEmployeeProfile(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: UpdateEmployeeProfileRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');

    const check = await pool.query(
      `SELECT employee_id FROM hrm_schema.employee_profiles WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
      [tenantId, employeeId],
    );
    if (check.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_EMPLOYEE_NOT_FOUND',
        message: `Employee profile not found for ID: ${employeeId}`,
      });
    }

    const res = await pool.query(
      `UPDATE hrm_schema.employee_profiles SET
        personal_email = COALESCE($3, personal_email),
        phone = COALESCE($4, phone),
        date_of_birth = COALESCE($5, date_of_birth),
        gender = COALESCE($6, gender),
        identity_card_number = COALESCE($7, identity_card_number),
        identity_card_issued_date = COALESCE($8, identity_card_issued_date),
        identity_card_issued_place = COALESCE($9, identity_card_issued_place),
        tax_code = COALESCE($10, tax_code),
        social_insurance_number = COALESCE($11, social_insurance_number),
        bank_account_number = COALESCE($12, bank_account_number),
        bank_name = COALESCE($13, bank_name),
        bank_branch = COALESCE($14, bank_branch),
        current_address = COALESCE($15, current_address),
        permanent_address = COALESCE($16, permanent_address),
        emergency_contact_name = COALESCE($17, emergency_contact_name),
        emergency_contact_phone = COALESCE($18, emergency_contact_phone),
        emergency_contact_relationship = COALESCE($19, emergency_contact_relationship),
        official_date = COALESCE($20, official_date),
        employment_status = COALESCE($21, employment_status),
        note = COALESCE($22, note),
        updated_by = $23,
        updated_at = now()
      WHERE tenant_id = $1 AND employee_id = $2
      RETURNING *`,
      [
        tenantId,
        employeeId,
        body.personalEmail,
        body.phone,
        body.dateOfBirth,
        body.gender,
        body.identityCardNumber,
        body.identityCardIssuedDate,
        body.identityCardIssuedPlace,
        body.taxCode,
        body.socialInsuranceNumber,
        body.bankAccountNumber,
        body.bankName,
        body.bankBranch,
        body.currentAddress,
        body.permanentAddress,
        body.emergencyContactName,
        body.emergencyContactPhone,
        body.emergencyContactRelationship,
        body.officialDate,
        body.employmentStatus,
        body.note,
        principal.userId,
      ],
    );

    return {
      data: this.mapProfile(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Position Profile APIs (P2_S3_HRM_API.md § 8)
  // --------------------------------------------------------------------------

  @Get('positions/:positionId/profile')
  async getPositionProfile(@Req() req: Request, @Param('positionId') positionId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.position_profiles WHERE tenant_id = $1 AND position_id = $2 AND deleted_at IS NULL`,
      [tenantId, positionId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_POSITION_NOT_FOUND',
        message: `Position profile not found for position ID: ${positionId}`,
      });
    }
    return {
      data: this.mapPosition(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('positions/:positionId/profile')
  async createPositionProfile(
    @Req() req: Request,
    @Param('positionId') positionId: string,
    @Body() body: CreatePositionProfileRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.position_profiles (
        position_id, tenant_id, salary_grade_id, default_policy_id, description,
        responsibilities, requirements, active, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      ON CONFLICT (position_id) DO UPDATE SET
        salary_grade_id = COALESCE($3, hrm_schema.position_profiles.salary_grade_id),
        default_policy_id = COALESCE($4, hrm_schema.position_profiles.default_policy_id),
        description = COALESCE($5, hrm_schema.position_profiles.description),
        responsibilities = CASE WHEN $6::jsonb IS NOT NULL THEN $6::jsonb ELSE hrm_schema.position_profiles.responsibilities END,
        requirements = CASE WHEN $7::jsonb IS NOT NULL THEN $7::jsonb ELSE hrm_schema.position_profiles.requirements END,
        active = COALESCE($8, hrm_schema.position_profiles.active),
        deleted_at = NULL,
        deleted_by = NULL,
        updated_by = $9,
        updated_at = now()
      RETURNING *`,
      [
        positionId,
        tenantId,
        body.salaryGradeId || null,
        body.defaultPolicyId || null,
        body.description || null,
        JSON.stringify(body.responsibilities || []),
        JSON.stringify(body.requirements || []),
        body.active ?? true,
        principal.userId,
      ],
    );
    return {
      data: this.mapPosition(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('positions/:positionId/profile')
  async updatePositionProfile(
    @Req() req: Request,
    @Param('positionId') positionId: string,
    @Body() body: UpdatePositionProfileRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `UPDATE hrm_schema.position_profiles SET
        salary_grade_id = COALESCE($3, salary_grade_id),
        default_policy_id = COALESCE($4, default_policy_id),
        description = COALESCE($5, description),
        responsibilities = CASE WHEN $6::jsonb IS NOT NULL THEN $6::jsonb ELSE responsibilities END,
        requirements = CASE WHEN $7::jsonb IS NOT NULL THEN $7::jsonb ELSE requirements END,
        active = COALESCE($8, active),
        updated_by = $9,
        updated_at = now()
      WHERE tenant_id = $1 AND position_id = $2 AND deleted_at IS NULL
      RETURNING *`,
      [
        tenantId,
        positionId,
        body.salaryGradeId,
        body.defaultPolicyId,
        body.description,
        body.responsibilities ? JSON.stringify(body.responsibilities) : null,
        body.requirements ? JSON.stringify(body.requirements) : null,
        body.active,
        principal.userId,
      ],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_POSITION_NOT_FOUND',
        message: `Position profile not found for position ID: ${positionId}`,
      });
    }
    return {
      data: this.mapPosition(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('positions')
  async listPositions(
    @Req() req: Request,
    @Query('search') search?: string,
    @Query('unit_id') unitId?: string,
    @Query('jd_status') jdStatus?: string,
    @Query('salary_grade_id') salaryGradeId?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');

    const res = await pool.query(
      `SELECT 
         pos.id as position_id,
         pos.code as position_code,
         pos.name as position_name,
         unit.id as unit_id,
         unit.name as unit_name,
         pp.salary_grade_id,
         sg.code as salary_grade_code,
         sg.name as salary_grade_name,
         pp.default_policy_id,
         pp.description as job_purpose,
         pp.responsibilities,
         pp.requirements,
         COALESCE(pp.active, true) as active,
         COALESCE(assign.emp_count, 0)::int as active_employee_count
       FROM core_schema.organization_nodes pos
       JOIN core_schema.organization_node_types pos_type 
         ON pos.node_type_id = pos_type.id 
        AND pos_type.category = 'position'
       LEFT JOIN core_schema.organization_nodes unit 
         ON pos.parent_id = unit.id 
        AND unit.deleted_at IS NULL
       LEFT JOIN hrm_schema.position_profiles pp 
         ON pp.position_id = pos.id 
        AND pp.tenant_id = $1 
        AND pp.deleted_at IS NULL
       LEFT JOIN hrm_schema.salary_grades sg 
         ON sg.id = pp.salary_grade_id
       LEFT JOIN (
         SELECT node_id, count(DISTINCT user_id) as emp_count 
         FROM core_schema.organization_node_assignments 
         WHERE deleted_at IS NULL AND status = 'active' 
         GROUP BY node_id
       ) assign ON assign.node_id = pos.id
       WHERE pos.deleted_at IS NULL
       ORDER BY pos.code ASC`,
      [tenantId],
    );

    let items: HrmJobDescriptionItem[] = res.rows.map((row) => {
      const responsibilities = (row.responsibilities as any[]) || [];
      const requirements = (row.requirements as any[]) || [];
      const jobPurpose = (row.job_purpose as string) || '';
      const isConfigured = Boolean(jobPurpose.trim() || responsibilities.length > 0);

      return {
        positionId: row.position_id as string,
        positionCode: row.position_code as string,
        positionName: row.position_name as string,
        unit: row.unit_id ? { id: row.unit_id as string, name: (row.unit_name as string) || '' } : null,
        salaryGrade: row.salary_grade_id
          ? {
              id: row.salary_grade_id as string,
              code: (row.salary_grade_code as string) || '',
              name: (row.salary_grade_name as string) || '',
            }
          : null,
        defaultPolicyId: (row.default_policy_id as string | null) || null,
        jdStatus: isConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
        jobPurpose: (row.job_purpose as string | null) || null,
        responsibilities,
        requirements,
        active: Boolean(row.active),
        activeEmployeeCount: Number(row.active_employee_count) || 0,
      };
    });

    if (search) {
      const s = search.toLowerCase().trim();
      items = items.filter(
        (it) => it.positionCode.toLowerCase().includes(s) || it.positionName.toLowerCase().includes(s),
      );
    }
    if (unitId && unitId !== 'ALL') {
      items = items.filter((it) => it.unit?.id === unitId);
    }
    if (jdStatus && jdStatus !== 'ALL') {
      items = items.filter((it) => it.jdStatus === jdStatus);
    }
    if (salaryGradeId && salaryGradeId !== 'ALL') {
      if (salaryGradeId === 'ASSIGNED') {
        items = items.filter((it) => Boolean(it.salaryGrade));
      } else if (salaryGradeId === 'UNASSIGNED') {
        items = items.filter((it) => !it.salaryGrade);
      } else {
        items = items.filter((it) => it.salaryGrade?.id === salaryGradeId);
      }
    }

    return {
      data: items,
      meta: { total: items.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  @Delete('positions/:positionId/profile')
  async deletePositionProfile(
    @Req() req: Request,
    @Param('positionId') positionId: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    await pool.query(
      `UPDATE hrm_schema.position_profiles SET
        deleted_at = now(),
        deleted_by = $3,
        updated_at = now()
      WHERE tenant_id = $1 AND position_id = $2 AND deleted_at IS NULL`,
      [tenantId, positionId, principal.userId],
    );

    return {
      success: true,
      message: `Đã xóa cấu hình JD của vị trí ${positionId}`,
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private toDateString(val: unknown): string | null {
    if (!val) return null;
    if (val instanceof Date) {
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const d = String(val.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const str = String(val);
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      return str.slice(0, 10);
    }
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return str;
  }

  private mapProfile(
    row: Record<string, unknown>,
    org?: Record<string, unknown>,
  ): HrmEmployeeProfile {
    const departmentName = (org?.department_name as string | null) || (row.department_name as string | null) || null;
    const positionName = (org?.position_name as string | null) || (row.position_name as string | null) || null;
    const divisionName = (org?.division_name as string | null) || null;
    const positionCode = (org?.position_code as string | null) || null;
    const salaryGrade = (org?.salary_grade_name as string | null) || (org?.salary_grade_code as string | null) || null;
    const directManagerName = (org?.direct_manager_name as string | null) || null;
    const directManagerTitle = (org?.direct_manager_title as string | null) || null;
    const directManagerEmail = (org?.direct_manager_email as string | null) || null;

    return {
      employeeId: row.employee_id as string,
      tenantId: row.tenant_id as string,
      employeeCode: row.employee_code as string,
      fullName: (row.full_name as string | null) || null,
      email: (row.work_email as string | null) || (row.personal_email as string | null) || null,
      department: departmentName,
      position: positionName,
      division: divisionName,
      positionCode: positionCode,
      salaryGrade: salaryGrade,
      directManagerName: directManagerName,
      directManagerTitle: directManagerTitle,
      directManagerEmail: directManagerEmail,
      personalEmail: row.personal_email as string | null,
      phone: row.phone as string | null,
      dateOfBirth: this.toDateString(row.date_of_birth),
      gender: row.gender as any,
      identityCardNumber: row.identity_card_number as string | null,
      identityCardIssuedDate: this.toDateString(row.identity_card_issued_date),
      identityCardIssuedPlace: row.identity_card_issued_place as string | null,
      taxCode: row.tax_code as string | null,
      socialInsuranceNumber: row.social_insurance_number as string | null,
      bankAccountNumber: row.bank_account_number as string | null,
      bankName: row.bank_name as string | null,
      bankBranch: row.bank_branch as string | null,
      currentAddress: row.current_address as string | null,
      permanentAddress: row.permanent_address as string | null,
      emergencyContactName: row.emergency_contact_name as string | null,
      emergencyContactPhone: row.emergency_contact_phone as string | null,
      emergencyContactRelationship: row.emergency_contact_relationship as string | null,
      joinDate: this.toDateString(row.join_date) || String(row.join_date),
      officialDate: this.toDateString(row.official_date),
      employmentStatus: row.employment_status as any,
      note: row.note as string | null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapPosition(row: Record<string, unknown>): HrmPositionProfile {
    return {
      positionId: row.position_id as string,
      tenantId: row.tenant_id as string,
      salaryGradeId: row.salary_grade_id as string | null,
      defaultPolicyId: row.default_policy_id as string | null,
      description: row.description as string | null,
      responsibilities: (row.responsibilities as string[]) || [],
      requirements: (row.requirements as string[]) || [],
      active: Boolean(row.active),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
