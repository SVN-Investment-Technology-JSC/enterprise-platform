import {
  insertContract,
  mapContract as mapContractRecord,
} from '../infrastructure/hrm-contracts.js';
import {
  createFamily,
  updateFamily,
  deleteFamily,
} from '../infrastructure/hrm-family.js';
import {
  lockLifecycleRow,
  updateLifecycleRow,
  lifecycleAudit,
  timestamp,
} from '../infrastructure/hrm-lifecycle.js';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { isoDate, lockEmployee } from '../infrastructure/hrm-time.js';
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
      `SELECT employee_id AS "employeeId",employee_code AS "employeeCode",full_name AS "fullName",count(*) OVER()::int AS total FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND deleted_at IS NULL AND employment_status NOT IN ('RESIGNED','TERMINATED') ORDER BY full_name,employee_id LIMIT $2 OFFSET $3`,
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
    const employeeId = res.rows[0].employee_id as string;
    const [family, contracts] = await Promise.all([
      pool.query(
        'SELECT * FROM hrm_schema.employee_family_members WHERE tenant_id=$1 AND employee_id=$2 AND deleted_at IS NULL ORDER BY created_at,id',
        [tenantId, employeeId],
      ),
      pool.query(
        'SELECT * FROM hrm_schema.employment_contracts WHERE tenant_id=$1 AND employee_id=$2 AND deleted_at IS NULL ORDER BY effective_from DESC,id',
        [tenantId, employeeId],
      ),
    ]);
    return {
      data: this.mapProfile(
        res.rows[0],
        undefined,
        family.rows.map((row) => this.mapDependent(row)),
        contracts.rows.map((row) => this.mapContract(row)),
      ),
    };
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
      `SELECT * FROM hrm_schema.employee_family_members
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
    const row = await hrmTransaction(pool, async (db) => {
      await lockEmployee(db, tenantId, employeeId);
      const before = await lockLifecycleRow(
        db,
        'employee_profiles',
        tenantId,
        employeeId,
        body.expectedUpdatedAt,
      );
      if (['RESIGNED', 'TERMINATED'].includes(before.employment_status))
        throw new ConflictException(
          'Hồ sơ đã ngừng hoạt động; cần xử lý tái tuyển riêng',
        );
      if (
        body.employmentStatus !== undefined &&
        !['PROBATION', 'OFFICIAL', 'ON_LEAVE'].includes(body.employmentStatus)
      )
        throw new BadRequestException(
          'Dùng thao tác Ngừng nhân viên kèm ngày và lý do',
        );
      const columns: Record<string, string> = {
        personalEmail: 'personal_email',
        phone: 'phone',
        dateOfBirth: 'date_of_birth',
        gender: 'gender',
        identityCardNumber: 'identity_card_number',
        identityCardIssuedDate: 'identity_card_issued_date',
        identityCardIssuedPlace: 'identity_card_issued_place',
        taxCode: 'tax_code',
        socialInsuranceNumber: 'social_insurance_number',
        bankAccountNumber: 'bank_account_number',
        bankName: 'bank_name',
        bankBranch: 'bank_branch',
        currentAddress: 'current_address',
        permanentAddress: 'permanent_address',
        emergencyContactName: 'emergency_contact_name',
        emergencyContactPhone: 'emergency_contact_phone',
        emergencyContactRelationship: 'emergency_contact_relationship',
        officialDate: 'official_date',
        employmentStatus: 'employment_status',
        note: 'note',
        maritalStatus: 'marital_status',
        nationality: 'nationality',
        ethnicity: 'ethnicity',
        religion: 'religion',
        placeOfBirth: 'place_of_birth',
        hometown: 'hometown',
      };
      const input = body as Record<string, unknown>,
        changes: Record<string, unknown> = { updated_by: principal.userId };
      for (const [key, column] of Object.entries(columns))
        if (input[key] !== undefined) {
          if (input[key] !== null && typeof input[key] !== 'string')
            throw new BadRequestException(`${key} phải là chuỗi hoặc null`);
          changes[column] = input[key];
        }
      if (
        body.joinDate !== undefined &&
        body.joinDate !== isoDate(before.join_date)
      )
        throw new BadRequestException(
          'Ngày vào làm ảnh hưởng công, phép và lương; cần điều chỉnh qua nghiệp vụ tuyển dụng thay vì sửa hồ sơ',
        );
      for (const key of [
        'dateOfBirth',
        'identityCardIssuedDate',
        'officialDate',
      ])
        if (input[key] != null) requireDate(input[key], key);
      if (body.officialDate && body.officialDate < isoDate(before.join_date))
        throw new BadRequestException(
          'Ngày chính thức không được trước ngày vào làm',
        );
      if (
        body.gender != null &&
        !['MALE', 'FEMALE', 'OTHER'].includes(body.gender)
      )
        throw new BadRequestException('Giới tính không hợp lệ');
      for (const key of ['personalEmail', 'workEmail'] as const) {
        const value = body[key];
        if (
          value != null &&
          (typeof value !== 'string' ||
            value.length > 255 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        )
          throw new BadRequestException(`${key} không hợp lệ`);
      }
      if (body.fullName !== undefined)
        requireText(body.fullName, 'Họ tên', 180);
      if (body.fullName !== undefined || body.workEmail !== undefined) {
        await db.query(
          `UPDATE core_schema.employees SET
           full_name=CASE WHEN $3 THEN $4 ELSE full_name END,
           work_email=CASE WHEN $5 THEN $6 ELSE work_email END,
           updated_at=clock_timestamp()
           WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
          [
            tenantId,
            employeeId,
            body.fullName !== undefined,
            body.fullName?.trim(),
            body.workEmail !== undefined,
            body.workEmail,
          ],
        );
      }
      const updated = await updateLifecycleRow(
        db,
        'employee_profiles',
        tenantId,
        employeeId,
        changes,
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'EMPLOYEE_UPDATED',
        employeeId,
        {
          fields: [
            ...Object.keys(changes).filter((x) => x !== 'updated_by'),
            ...(body.fullName !== undefined ? ['full_name'] : []),
            ...(body.workEmail !== undefined ? ['work_email'] : []),
          ],
          previousUpdatedAt: timestamp(before.updated_at),
        },
      );
      const directory = await db.query(
        'SELECT * FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=$2',
        [tenantId, employeeId],
      );
      return { ...directory.rows[0], updated_at: updated.updated_at };
    });
    return { data: this.mapProfile(row) };
  }

  @Post('employees/:employeeId/deactivate')
  async deactivateEmployee(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Body()
    body: { effectiveDate: string; reason: string; expectedUpdatedAt: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    const date = requireDate(body.effectiveDate, 'effectiveDate'),
      reason = requireText(body.reason, 'reason', 2000);
    const row = await hrmTransaction(pool, async (db) => {
      await lockEmployee(db, tenantId, employeeId);
      const before = await lockLifecycleRow(
        db,
        'employee_profiles',
        tenantId,
        employeeId,
        body.expectedUpdatedAt,
      );
      if (['RESIGNED', 'TERMINATED'].includes(before.employment_status))
        throw new ConflictException('Nhân viên đã ngừng hoạt động');
      const today = (await db.query('SELECT CURRENT_DATE AS today')).rows[0]
        .today;
      if (date < isoDate(before.join_date) || date > isoDate(today))
        throw new BadRequestException(
          'Ngày ngừng phải từ ngày vào làm đến hôm nay',
        );
      const updated = await updateLifecycleRow(
        db,
        'employee_profiles',
        tenantId,
        employeeId,
        {
          employment_status: 'RESIGNED',
          inactive_from: date,
          inactive_reason: reason,
          updated_by: principal.userId,
        },
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'EMPLOYEE_DEACTIVATED',
        employeeId,
        {
          effectiveDate: date,
          reason,
          previousStatus: before.employment_status,
        },
      );
      return updated;
    });
    return { data: this.mapProfile(row) };
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
    requireUuid(positionId, 'positionId');
    const row = await hrmTransaction(pool, async (db) => {
      const position = await db.query(
        "SELECT id FROM core_schema.organization_nodes WHERE id=$1 AND category='position' AND deleted_at IS NULL FOR SHARE",
        [positionId],
      );
      if (!position.rowCount)
        throw new NotFoundException(
          'Chức danh không tồn tại trong cơ cấu tổ chức',
        );
      await this.validatePositionReferences(db, tenantId, body);
      const inserted = await db.query(
        `INSERT INTO hrm_schema.position_profiles (position_id,tenant_id,salary_grade_id,default_policy_id,description,responsibilities,requirements,authorities,active,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
         ON CONFLICT (position_id) DO UPDATE SET
           salary_grade_id=EXCLUDED.salary_grade_id, default_policy_id=EXCLUDED.default_policy_id,
           description=EXCLUDED.description, responsibilities=EXCLUDED.responsibilities,
           requirements=EXCLUDED.requirements, authorities=EXCLUDED.authorities,
           active=EXCLUDED.active, updated_by=EXCLUDED.updated_by,
           updated_at=GREATEST(clock_timestamp(),hrm_schema.position_profiles.updated_at+interval '1 millisecond'),
           deleted_at=NULL, deleted_by=NULL
         WHERE hrm_schema.position_profiles.tenant_id=EXCLUDED.tenant_id AND hrm_schema.position_profiles.deleted_at IS NOT NULL
         RETURNING *`,
        [
          positionId,
          tenantId,
          body.salaryGradeId || null,
          body.defaultPolicyId || null,
          body.description || null,
          JSON.stringify(body.responsibilities || []),
          JSON.stringify(body.requirements || []),
          JSON.stringify(body.authorities || []),
          body.active ?? true,
          principal.userId,
        ],
      );
      if (!inserted.rowCount)
        throw new ConflictException(
          'Chức danh đã có cấu hình. Tải lại bản ghi để chỉnh sửa.',
        );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'POSITION_PROFILE_CREATED',
        positionId,
        {},
      );
      return inserted.rows[0];
    });
    return { data: this.mapPosition(row) };
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
    const row = await hrmTransaction(pool, async (db) => {
      await lockLifecycleRow(
        db,
        'position_profiles',
        tenantId,
        positionId,
        body.expectedUpdatedAt,
      );
      await this.validatePositionReferences(db, tenantId, body);
      const updated = await updateLifecycleRow(
        db,
        'position_profiles',
        tenantId,
        positionId,
        {
          salary_grade_id: body.salaryGradeId,
          default_policy_id: body.defaultPolicyId,
          description: body.description,
          responsibilities:
            body.responsibilities === undefined
              ? undefined
              : JSON.stringify(body.responsibilities),
          requirements:
            body.requirements === undefined
              ? undefined
              : JSON.stringify(body.requirements),
          authorities:
            body.authorities === undefined
              ? undefined
              : JSON.stringify(body.authorities),
          active: body.active,
          updated_by: principal.userId,
        },
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'POSITION_PROFILE_UPDATED',
        positionId,
        body,
      );
      return updated;
    });
    return { data: this.mapPosition(row) };
  }

  private async validatePositionReferences(
    db: PoolClient,
    tenantId: string,
    body: CreatePositionProfileRequest,
  ) {
    if (body.active !== undefined && typeof body.active !== 'boolean')
      throw new BadRequestException('active phải là boolean');
    for (const [key, table] of [
      ['salaryGradeId', 'salary_grades'],
      ['defaultPolicyId', 'policies'],
    ] as const) {
      const id = body[key];
      if (id) {
        requireUuid(id, key);
        const ref = await db.query(
          'SELECT id FROM hrm_schema.' +
            table +
            " WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL AND status='ACTIVE' FOR SHARE",
          [tenantId, id],
        );
        if (!ref.rowCount)
          throw new BadRequestException(
            key + ': không tồn tại hoặc đã ngừng hoạt động trong tenant',
          );
      }
    }
    for (const value of [
      body.responsibilities,
      body.requirements,
      body.authorities,
    ])
      if (value !== undefined && !Array.isArray(value))
        throw new BadRequestException('Nội dung JD phải là danh sách');
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
         pp.authorities,
         pp.updated_at,
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
        authorities: row.authorities || [],
        updatedAt: row.updated_at ? timestamp(row.updated_at) : null,
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
    @Body() body: { expectedUpdatedAt: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    await hrmTransaction(pool, async (db) => {
      const before = await lockLifecycleRow(
        db,
        'position_profiles',
        tenantId,
        positionId,
        body.expectedUpdatedAt,
      );
      const used = await db.query(
        'SELECT 1 FROM core_schema.organization_node_assignments WHERE node_id=$1 LIMIT 1',
        [positionId],
      );
      if (used.rowCount)
        throw new ConflictException(
          'Chức danh đã có lịch sử phân công. Chọn ngừng cấu hình để giữ lịch sử.',
        );
      await updateLifecycleRow(db, 'position_profiles', tenantId, positionId, {
        deleted_at: new Date(),
        deleted_by: principal.userId,
        active: false,
      });
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'POSITION_PROFILE_DELETED',
        positionId,
        { previousProfile: before },
      );
    });
    return { data: { deleted: true } };
  }

  // --------------------------------------------------------------------------
  // Dependents APIs (Người phụ thuộc - Giảm trừ gia cảnh PIT)
  // --------------------------------------------------------------------------

  @Get('my-dependents')
  async getMyDependents(@Req() req: Request) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.read',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    const res = await pool.query(
      `SELECT * FROM hrm_schema.employee_family_members
       WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [tenantId, employeeId],
    );
    return {
      data: res.rows.map((r) => this.mapDependent(r)),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('my-dependents')
  async createMyDependent(
    @Req() req: Request,
    @Body() body: CreateEmployeeDependentRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.profile.write',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    return {
      data: this.mapDependent(
        await createFamily(pool, tenantId, employeeId, principal.userId, body),
      ),
    };
  }

  @Patch('my-dependents/:id')
  async updateMyDependent(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateEmployeeDependentRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.profile.write',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    return {
      data: this.mapDependent(
        await updateFamily(
          pool,
          tenantId,
          employeeId,
          principal.userId,
          id,
          body,
        ),
      ),
    };
  }

  @Delete('my-dependents/:id')
  async deleteMyDependent(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { expectedUpdatedAt: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.profile.write',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    await deleteFamily(
      pool,
      tenantId,
      employeeId,
      principal.userId,
      id,
      body?.expectedUpdatedAt,
    );
    return { data: { deleted: true } };
  }

  @Get('employees/:employeeId/dependents')
  async getEmployeeDependents(
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
      `SELECT * FROM hrm_schema.employee_family_members
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
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    return {
      data: this.mapDependent(
        await createFamily(pool, tenantId, employeeId, principal.userId, body),
      ),
    };
  }

  @Patch('employees/:employeeId/dependents/:id')
  async updateEmployeeDependent(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Param('id') id: string,
    @Body() body: UpdateEmployeeDependentRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    return {
      data: this.mapDependent(
        await updateFamily(
          pool,
          tenantId,
          employeeId,
          principal.userId,
          id,
          body,
        ),
      ),
    };
  }
  @Delete('employees/:employeeId/dependents/:id')
  async deleteEmployeeDependent(
    @Req() req: Request,
    @Param('employeeId') employeeId: string,
    @Param('id') id: string,
    @Body() body: { expectedUpdatedAt: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    await deleteFamily(
      pool,
      tenantId,
      employeeId,
      principal.userId,
      id,
      body?.expectedUpdatedAt,
    );
    return { data: { deleted: true } };
  }

  // --------------------------------------------------------------------------
  // Employment Contracts APIs (Hợp đồng lao động)
  // --------------------------------------------------------------------------

  @Get('employees/:employeeId/contracts')
  async getEmployeeContracts(
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
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    const row = await hrmTransaction(pool, (db) =>
      insertContract(db, tenantId, employeeId, principal.userId, body),
    );
    return { data: this.mapContract(row) };
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
      updatedAt: timestamp(row.updated_at),
    };
  }

  private mapContract(row: Record<string, unknown>): HrmEmploymentContract {
    return mapContractRecord(row);
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
      (row.salary_grade_name as string | null) ||
      (row.salary_grade_code as string | null) ||
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
      updatedAt: timestamp(row.updated_at),
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
      authorities: (row.authorities as string[]) || [],
      active: Boolean(row.active),
      createdAt: String(row.created_at),
      updatedAt: timestamp(row.updated_at),
    };
  }
}
