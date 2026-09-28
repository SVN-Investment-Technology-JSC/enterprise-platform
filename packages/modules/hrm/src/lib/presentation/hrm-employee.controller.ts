import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { lockEmployee } from '../infrastructure/hrm-time.js';
import {
  requireDate,
  requireText,
  requireUuid,
} from '../infrastructure/hrm-validation.js';
import type {
  HrmEmployeeProfile,
  HrmPositionProfile,
  HrmJobDescriptionItem,
  CreateEmployeeProfileRequest,
  CreateHrmEmployeeRequest,
  UpdateEmployeeProfileRequest,
  CreatePositionProfileRequest,
  UpdatePositionProfileRequest,
  HrmEmployeeDependent,
  CreateEmployeeDependentRequest,
  UpdateEmployeeDependentRequest,
  HrmEmploymentContract,
  CreateEmploymentContractRequest,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  ConflictException,
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

  @Get('employee-options')
  async employeeOptions(
    @Req() req: Request,
    @Query('page') pageStr?: string,
    @Query('page_size') sizeStr?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const page = Math.max(1, Number.parseInt(pageStr || '1', 10) || 1),
      size = Math.min(
        100,
        Math.max(1, Number.parseInt(sizeStr || '100', 10) || 100),
      );
    const result = await pool.query(
      `SELECT employee_id AS "employeeId",employee_code AS "employeeCode",full_name AS "fullName",count(*) OVER()::int AS total FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY full_name,employee_id LIMIT $2 OFFSET $3`,
      [tenantId, size, (page - 1) * size],
    );
    return {
      data: result.rows.map(({ total: _total, ...employee }) => employee),
      meta: { total: result.rows[0]?.total || 0 },
    };
  }

  // --------------------------------------------------------------------------
  // Employee Profile APIs (P2_S3_HRM_API.md § 7)
  // --------------------------------------------------------------------------

  @Get('employees')
  async listEmployees(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('page') pageStr = '1',
    @Query('page_size') sizeStr = '20',
    @Query('search') search = '',
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.employee.read',
    );
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(sizeStr, 10) || 20));
    const filter = `tenant_id = $1 AND deleted_at IS NULL
      AND ($2::text IS NULL OR employment_status = $2)
      AND ($3 = '' OR full_name ILIKE '%' || $3 || '%' OR employee_code ILIKE '%' || $3 || '%')`;
    const args = [tenantId, status || null, search.trim()];
    const count = await pool.query(
      `SELECT count(*)::int AS total FROM hrm_schema.employee_directory WHERE ${filter}`,
      args,
    );
    const rows = await pool.query(
      `SELECT * FROM hrm_schema.employee_directory WHERE ${filter}
      ORDER BY employee_code, employee_id LIMIT $4 OFFSET $5`,
      [...args, pageSize, (page - 1) * pageSize],
    );
    return {
      data: rows.rows.map((row) => this.mapProfile(row)),
      meta: { page, pageSize, total: count.rows[0].total },
    };
  }

  @Get('employees/accounts')
  async listUnlinkedAccounts(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.employee.link-account',
    );
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email FROM core_schema.users u
      WHERE u.status='active' AND u.is_active = true AND NOT EXISTS (
        SELECT 1 FROM core_schema.employees e WHERE e.tenant_id = $1 AND e.user_id = u.id)
      ORDER BY u.full_name, u.id`,
      [tenantId],
    );
    return {
      data: result.rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
      })),
    };
  }

  @Get('my-profile')
  async getMyProfile(@Req() req: Request) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.read',
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.employee_directory
      WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [tenantId, principal.userId],
    );
    if (!res.rows[0])
      throw new NotFoundException({
        code: 'HRM_EMPLOYEE_NOT_FOUND',
        message:
          'Tài khoản chưa được liên kết hồ sơ nhân viên. Vui lòng liên hệ HR.',
      });
    return { data: this.mapProfile(res.rows[0]) };
  }

  @Post('employees/:employeeId/link-account')
  async linkAccount(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: { userId: string; reason: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.link-account',
    );
    requireUuid(employeeId, 'employeeId');
    requireUuid(body.userId, 'userId');
    requireText(body.reason, 'reason', 2000);
    try {
      return await hrmTransaction(pool, async (db) => {
        await lockEmployee(db, tenantId, employeeId);
        const employee = await db.query(
          `SELECT user_id FROM core_schema.employees WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,
          [tenantId, employeeId],
        );
        if (!employee.rows[0])
          throw new NotFoundException('Không tìm thấy nhân viên');
        if (employee.rows[0].user_id === body.userId)
          return { data: { employeeId, userId: body.userId } };
        if (employee.rows[0].user_id)
          throw new ConflictException(
            'Hồ sơ đã liên kết tài khoản; cần xử lý chuyển giao riêng',
          );
        const user = await db.query(
          `SELECT id FROM core_schema.users WHERE id=$1 AND status='active' AND is_active=true FOR SHARE`,
          [body.userId],
        );
        if (!user.rowCount)
          throw new BadRequestException(
            'Tài khoản không hoạt động trong tenant',
          );
        await db.query(
          `UPDATE core_schema.employees SET user_id=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
          [tenantId, employeeId, body.userId],
        );
        await db.query(
          `INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_id,detail) VALUES ($1,$2,'EMPLOYEE_ACCOUNT_LINKED',$3,$4)`,
          [tenantId, principal.userId, employeeId, JSON.stringify(body)],
        );
        return { data: { employeeId, userId: body.userId } };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('Tài khoản đã liên kết hồ sơ khác');
      throw error;
    }
  }

  @Post('employees')
  async createEmployee(
    @Req() req: Request,
    @Body() body: CreateHrmEmployeeRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    this.validateProfile(body);
    const fullName = requireText(body.fullName, 'Họ tên', 180);
    const userId = body.userId ? requireUuid(body.userId, 'Tài khoản') : null;
    const id = randomUUID();
    try {
      const row = await hrmTransaction(pool, async (client) => {
        if (userId) {
          const user = await client.query(
            "SELECT id FROM core_schema.users WHERE id = $1 AND status='active' AND is_active = true",
            [userId],
          );
          if (!user.rows[0])
            throw new BadRequestException(
              'Tài khoản không tồn tại hoặc đã ngừng hoạt động',
            );
        }
        await client.query(
          `INSERT INTO core_schema.employees (id, tenant_id, user_id, full_name, work_email)
          VALUES ($1, $2, $3, $4, $5)`,
          [id, tenantId, userId, fullName, body.workEmail?.trim() || null],
        );
        return this.insertProfile(client, tenantId, id, principal.userId, body);
      });
      return {
        data: this.mapProfile({
          ...row,
          full_name: fullName,
          user_id: userId,
          work_email: body.workEmail,
        }),
      };
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException(
          'Mã nhân viên hoặc tài khoản đã được sử dụng',
        );
      throw error;
    }
  }

  @Patch('my-profile')
  async updateMyProfile(
    @Req() req: Request,
    @Body() body: UpdateEmployeeProfileRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.profile.write',
    );
    const employee = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    const targetEmployeeId = employee.employeeId;
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
        marital_status = COALESCE($12, marital_status),
        nationality = COALESCE($13, nationality),
        ethnicity = COALESCE($14, ethnicity),
        religion = COALESCE($15, religion),
        place_of_birth = COALESCE($16, place_of_birth),
        hometown = COALESCE($17, hometown),
        updated_by = $18,
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
        body.maritalStatus,
        body.nationality,
        body.ethnicity,
        body.religion,
        body.placeOfBirth,
        body.hometown,
        principal.userId,
      ],
    );

    return {
      data: this.mapProfile({
        ...res.rows[0],
        full_name: employee.fullName,
        user_id: principal.userId,
      }),
    };
  }

  @Get('employees/:employeeId/profile')
  async getEmployeeProfile(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
  ) {
    const { pool, tenantId } = await this.ctx.getRequestContext(
      req,
      employeeId,
      'hrm.employee.read',
      'hrm.self.read',
    );
    requireUuid(employeeId, 'Nhân viên');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.employee_directory
      WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
      [tenantId, employeeId],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_EMPLOYEE_NOT_FOUND',
        message: `Employee profile not found for ID: ${employeeId}`,
      });
    }
    // Query dependents for this employee
    const depRes = await pool.query(
      `SELECT * FROM hrm_schema.employee_dependents 
       WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL 
       ORDER BY created_at ASC`,
      [tenantId, employeeId],
    );
    const dependents = depRes.rows.map((r) => this.mapDependent(r));

    // Query employment contracts for this employee
    const contractRes = await pool.query(
      `SELECT * FROM hrm_schema.employment_contracts 
       WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL 
       ORDER BY effective_from DESC`,
      [tenantId, employeeId],
    );
    const contracts = contractRes.rows.map((r) => this.mapContract(r));

    return {
      data: this.mapProfile(res.rows[0], undefined, dependents, contracts),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('employees/:employeeId/profile')
  async createEmployeeProfile(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: CreateEmployeeProfileRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    requireUuid(employeeId, 'Nhân viên');
    this.validateProfile(body);
    try {
      const row = await hrmTransaction(pool, async (client) => {
        // Legacy callers provide a Core user ID. Preserve it when creating the master.
        await client.query(
          `INSERT INTO core_schema.employees (id, tenant_id, user_id, full_name, work_email)
          SELECT id, $1, id, full_name, email FROM core_schema.users WHERE id = $2 AND status='active' AND is_active=true
          ON CONFLICT (id) DO NOTHING`,
          [tenantId, employeeId],
        );
        const employee = await client.query(
          'SELECT id FROM core_schema.employees WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL',
          [tenantId, employeeId],
        );
        if (!employee.rows[0])
          throw new NotFoundException('Nhân viên Core không tồn tại');
        return this.insertProfile(
          client,
          tenantId,
          employeeId,
          principal.userId,
          body,
        );
      });
      return { data: this.mapProfile(row) };
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('Hồ sơ hoặc mã nhân viên đã tồn tại');
      throw error;
    }
  }

  private validateProfile(body: CreateEmployeeProfileRequest) {
    requireText(body.employeeCode, 'Mã nhân viên', 50);
    requireDate(body.joinDate, 'Ngày vào làm');
    if (body.officialDate) requireDate(body.officialDate, 'Ngày chính thức');
    if (
      body.employmentStatus &&
      !['PROBATION', 'OFFICIAL', 'ON_LEAVE', 'RESIGNED', 'TERMINATED'].includes(
        body.employmentStatus,
      )
    ) {
      throw new BadRequestException('Trạng thái nhân viên không hợp lệ');
    }
  }

  private async insertProfile(
    client: PoolClient,
    tenantId: string,
    employeeId: string,
    actorId: string,
    body: CreateEmployeeProfileRequest,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(
      `INSERT INTO hrm_schema.employee_profiles (
        employee_id, tenant_id, employee_code, personal_email, phone, date_of_birth, gender,
        identity_card_number, identity_card_issued_date, identity_card_issued_place,
        tax_code, social_insurance_number, bank_account_number, bank_name, bank_branch,
        current_address, permanent_address, emergency_contact_name, emergency_contact_phone,
        emergency_contact_relationship, join_date, official_date, employment_status, note,
        marital_status, nationality, ethnicity, religion, place_of_birth, hometown,
        created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21, $22, $23, $24,
        $25, $26, $27, $28, $29, $30,
        $31, $31
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
        body.maritalStatus || null,
        body.nationality || 'Việt Nam',
        body.ethnicity || 'Kinh',
        body.religion || null,
        body.placeOfBirth || null,
        body.hometown || null,
        actorId,
      ],
    );
    return res.rows[0];
  }

  @Patch('employees/:employeeId/profile')
  async updateEmployeeProfile(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: UpdateEmployeeProfileRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );

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
        marital_status = COALESCE($23, marital_status),
        nationality = COALESCE($24, nationality),
        ethnicity = COALESCE($25, ethnicity),
        religion = COALESCE($26, religion),
        place_of_birth = COALESCE($27, place_of_birth),
        hometown = COALESCE($28, hometown),
        updated_by = $29,
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
        body.maritalStatus,
        body.nationality,
        body.ethnicity,
        body.religion,
        body.placeOfBirth,
        body.hometown,
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
  async getPositionProfile(
    @Req() req: Request,
    @Param('positionId') positionId: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.employee.read',
    );
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
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
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
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
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
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.employee.read',
    );

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
      const isConfigured = Boolean(
        jobPurpose.trim() || responsibilities.length > 0,
      );

      return {
        positionId: row.position_id as string,
        positionCode: row.position_code as string,
        positionName: row.position_name as string,
        unit: row.unit_id
          ? { id: row.unit_id as string, name: (row.unit_name as string) || '' }
          : null,
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
        (it) =>
          it.positionCode.toLowerCase().includes(s) ||
          it.positionName.toLowerCase().includes(s),
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
      meta: {
        total: items.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Delete('positions/:positionId/profile')
  async deletePositionProfile(
    @Req() req: Request,
    @Param('positionId') positionId: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
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
  // Dependents APIs (Người phụ thuộc - Giảm trừ gia cảnh PIT)
  // --------------------------------------------------------------------------

  @Get('my-dependents')
  async getMyDependents(@Req() req: Request) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.employee_dependents 
       WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [tenantId, principal.userId],
    );
    return {
      data: res.rows.map((r) => this.mapDependent(r)),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('my-dependents')
  async createMyDependent(@Req() req: Request, @Body() body: CreateEmployeeDependentRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `INSERT INTO hrm_schema.employee_dependents (
        tenant_id, employee_id, full_name, relationship, date_of_birth, phone,
        identity_card_number, tax_code, is_dependent, dependent_from, dependent_to, note, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        tenantId,
        principal.userId,
        body.fullName,
        body.relationship,
        body.dateOfBirth || null,
        body.phone || null,
        body.identityCardNumber || null,
        body.taxCode || null,
        body.isDependent !== false,
        body.dependentFrom || null,
        body.dependentTo || null,
        body.note || null,
        principal.userId,
      ],
    );
    return {
      data: this.mapDependent(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('my-dependents/:id')
  async updateMyDependent(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateEmployeeDependentRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `UPDATE hrm_schema.employee_dependents SET
        full_name = COALESCE($4, full_name),
        relationship = COALESCE($5, relationship),
        date_of_birth = COALESCE($6, date_of_birth),
        phone = COALESCE($7, phone),
        identity_card_number = COALESCE($8, identity_card_number),
        tax_code = COALESCE($9, tax_code),
        is_dependent = COALESCE($10, is_dependent),
        dependent_from = COALESCE($11, dependent_from),
        dependent_to = COALESCE($12, dependent_to),
        note = COALESCE($13, note),
        updated_by = $14,
        updated_at = now()
      WHERE tenant_id = $1 AND employee_id = $2 AND id = $3 AND deleted_at IS NULL
      RETURNING *`,
      [
        tenantId,
        principal.userId,
        id,
        body.fullName,
        body.relationship,
        body.dateOfBirth,
        body.phone,
        body.identityCardNumber,
        body.taxCode,
        body.isDependent,
        body.dependentFrom,
        body.dependentTo,
        body.note,
        principal.userId,
      ],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        code: 'HRM_DEPENDENT_NOT_FOUND',
        message: 'Dependent not found',
      });
    }
    return {
      data: this.mapDependent(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Delete('my-dependents/:id')
  async deleteMyDependent(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    await pool.query(
      `UPDATE hrm_schema.employee_dependents 
       SET deleted_at = now(), updated_by = $4 
       WHERE tenant_id = $1 AND employee_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [tenantId, principal.userId, id, principal.userId],
    );
    return {
      success: true,
      message: 'Đã xóa người phụ thuộc',
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Get('employees/:employeeId/dependents')
  async getEmployeeDependents(@Req() req: Request, @Param('employeeId') employeeId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.employee_dependents 
       WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [tenantId, employeeId],
    );
    return {
      data: res.rows.map((r) => this.mapDependent(r)),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('employees/:employeeId/dependents')
  async createEmployeeDependent(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: CreateEmployeeDependentRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.employee_dependents (
        tenant_id, employee_id, full_name, relationship, date_of_birth, phone,
        identity_card_number, tax_code, is_dependent, dependent_from, dependent_to, note, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        tenantId,
        employeeId,
        body.fullName,
        body.relationship,
        body.dateOfBirth || null,
        body.phone || null,
        body.identityCardNumber || null,
        body.taxCode || null,
        body.isDependent !== false,
        body.dependentFrom || null,
        body.dependentTo || null,
        body.note || null,
        principal.userId,
      ],
    );
    return {
      data: this.mapDependent(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Employment Contracts APIs (Hợp đồng lao động)
  // --------------------------------------------------------------------------

  @Get('employees/:employeeId/contracts')
  async getEmployeeContracts(@Req() req: Request, @Param('employeeId') employeeId: string) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    const res = await pool.query(
      `SELECT * FROM hrm_schema.employment_contracts 
       WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL
       ORDER BY effective_from DESC`,
      [tenantId, employeeId],
    );
    return {
      data: res.rows.map((r) => this.mapContract(r)),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('employees/:employeeId/contracts')
  async createEmployeeContract(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body() body: CreateEmploymentContractRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.manage');
    const res = await pool.query(
      `INSERT INTO hrm_schema.employment_contracts (
        tenant_id, employee_id, contract_code, contract_type, sign_date,
        effective_from, effective_to, status, base_salary, note, file_url, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        tenantId,
        employeeId,
        body.contractCode,
        body.contractType,
        body.signDate || null,
        body.effectiveFrom,
        body.effectiveTo || null,
        body.status || 'ACTIVE',
        body.baseSalary || null,
        body.note || null,
        body.fileUrl || null,
        principal.userId,
      ],
    );
    return {
      data: this.mapContract(res.rows[0]),
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

  private mapDependent(row: Record<string, unknown>): HrmEmployeeDependent {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      fullName: row.full_name as string,
      relationship: row.relationship as string,
      dateOfBirth: this.toDateString(row.date_of_birth),
      phone: row.phone as string | null,
      identityCardNumber: row.identity_card_number as string | null,
      taxCode: row.tax_code as string | null,
      isDependent: Boolean(row.is_dependent),
      dependentFrom: this.toDateString(row.dependent_from),
      dependentTo: this.toDateString(row.dependent_to),
      note: row.note as string | null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapContract(row: Record<string, unknown>): HrmEmploymentContract {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      employeeId: row.employee_id as string,
      contractCode: row.contract_code as string,
      contractType: row.contract_type as string,
      signDate: this.toDateString(row.sign_date),
      effectiveFrom: this.toDateString(row.effective_from) || String(row.effective_from),
      effectiveTo: this.toDateString(row.effective_to),
      status: row.status as any,
      baseSalary: row.base_salary != null ? Number(row.base_salary) : null,
      note: row.note as string | null,
      fileUrl: row.file_url as string | null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapProfile(
    row: Record<string, unknown>,
    org?: Record<string, unknown>,
    dependents?: HrmEmployeeDependent[],
    contracts?: HrmEmploymentContract[],
  ): HrmEmployeeProfile {
    const departmentName =
      (org?.department_name as string | null) ||
      (row.department_name as string | null) ||
      null;
    const positionName =
      (org?.position_name as string | null) ||
      (row.position_name as string | null) ||
      null;
    const divisionName =
      (org?.division_name as string | null) ||
      (row.division_name as string | null) ||
      null;
    const positionCode =
      (org?.position_code as string | null) ||
      (row.position_code as string | null) ||
      null;
    const salaryGrade =
      (org?.salary_grade_name as string | null) ||
      (org?.salary_grade_code as string | null) ||
      null;
    const directManagerName =
      (org?.direct_manager_name as string | null) || null;
    const directManagerTitle =
      (org?.direct_manager_title as string | null) || null;
    const directManagerEmail =
      (org?.direct_manager_email as string | null) || null;

    return {
      id: row.employee_id as string,
      employeeId: row.employee_id as string,
      userId: (row.user_id as string | null) ?? null,
      tenantId: row.tenant_id as string,
      employeeCode: row.employee_code as string,
      fullName: (row.full_name as string | null) || null,
      email:
        (row.work_email as string | null) ||
        (row.personal_email as string | null) ||
        null,
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
      maritalStatus: row.marital_status as string | null,
      nationality: (row.nationality as string | null) || 'Việt Nam',
      ethnicity: (row.ethnicity as string | null) || 'Kinh',
      religion: row.religion as string | null,
      placeOfBirth: row.place_of_birth as string | null,
      hometown: row.hometown as string | null,
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
      emergencyContactRelationship: row.emergency_contact_relationship as
        | string
        | null,
      joinDate: this.toDateString(row.join_date) || String(row.join_date),
      officialDate: this.toDateString(row.official_date),
      employmentStatus: row.employment_status as any,
      note: row.note as string | null,
      dependents: dependents || [],
      contracts: contracts || [],
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
