import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { CreateEmploymentContractRequest } from '@enterprise-platform/contracts-hrm';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import {
  lockLifecycleRow,
  updateLifecycleRow,
  lifecycleAudit,
} from '../infrastructure/hrm-lifecycle.js';
import {
  contractEmployee,
  contractInput,
  insertContract,
  mapContract,
  validateContract,
} from '../infrastructure/hrm-contracts.js';
import { isoDate } from '../infrastructure/hrm-time.js';
import { requireDate, requireText } from '../infrastructure/hrm-validation.js';
type Version = { expectedUpdatedAt: string };
@Controller('v1')
export class HrmContractController {
  constructor(private readonly ctx: HrmContextService) {}
  @Patch('contracts/:id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Partial<CreateEmploymentContractRequest> & Version,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    try {
      return await hrmTransaction(pool, async (db) => {
        await contractEmployee(db, tenantId, id);
        const before = await lockLifecycleRow(
          db,
          'employment_contracts',
          tenantId,
          id,
          body.expectedUpdatedAt,
        );
        if (before.status !== 'DRAFT')
          throw new ConflictException(
            'Hợp đồng đã ban hành; cần lập phụ lục thay vì sửa trực tiếp',
          );
        if (body.status !== undefined && body.status !== 'DRAFT')
          throw new BadRequestException(
            'Dùng thao tác ban hành hoặc chấm dứt riêng',
          );
        const changes = contractInput(
          body as unknown as Record<string, unknown>,
        );
        validateContract({ ...before, ...changes });
        const row = await updateLifecycleRow(
          db,
          'employment_contracts',
          tenantId,
          id,
          { ...changes, updated_by: principal.userId },
        );
        await lifecycleAudit(
          db,
          tenantId,
          principal.userId,
          'CONTRACT_DRAFT_UPDATED',
          id,
          { fields: Object.keys(changes) },
        );
        return { data: mapContract(row) };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('Số hợp đồng đã tồn tại');
      throw error;
    }
  }
  @Delete('contracts/:id')
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Version,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    return hrmTransaction(pool, async (db) => {
      await contractEmployee(db, tenantId, id);
      const before = await lockLifecycleRow(
        db,
        'employment_contracts',
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      if (before.status !== 'DRAFT')
        throw new ConflictException('Chỉ được xóa hợp đồng nháp');
      await updateLifecycleRow(db, 'employment_contracts', tenantId, id, {
        deleted_at: new Date(),
        deleted_by: principal.userId,
      });
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'CONTRACT_DRAFT_DELETED',
        id,
        { previousContract: mapContract(before) },
      );
      return { data: { deleted: true } };
    });
  }
  @Post('contracts/:id/activate')
  async activate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Version,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    return hrmTransaction(pool, async (db) => {
      await contractEmployee(db, tenantId, id);
      const before = await lockLifecycleRow(
        db,
        'employment_contracts',
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      if (before.status !== 'DRAFT')
        throw new ConflictException('Chỉ ban hành hợp đồng nháp');
      if (before.parent_contract_id) {
        const parent = (
          await db.query(
            "SELECT * FROM hrm_schema.employment_contracts WHERE tenant_id=$1 AND id=$2 AND employee_id=$3 AND status='ACTIVE' AND deleted_at IS NULL",
            [tenantId, before.parent_contract_id, before.employee_id],
          )
        ).rows[0];
        if (!parent)
          throw new ConflictException('Hợp đồng gốc không còn hiệu lực');
        if (isoDate(before.effective_from) < isoDate(parent.effective_from))
          throw new BadRequestException(
            'Phụ lục không được có hiệu lực trước hợp đồng gốc',
          );
      } else {
        const overlap = await db.query(
          "SELECT id FROM hrm_schema.employment_contracts WHERE tenant_id=$1 AND employee_id=$2 AND id<>$3 AND parent_contract_id IS NULL AND status='ACTIVE' AND deleted_at IS NULL AND effective_from<=COALESCE($5::date,'infinity'::date) AND COALESCE(effective_to,'infinity'::date)>=$4::date",
          [
            tenantId,
            before.employee_id,
            id,
            isoDate(before.effective_from),
            before.effective_to ? isoDate(before.effective_to) : null,
          ],
        );
        if (overlap.rowCount)
          throw new ConflictException(
            'Trùng hiệu lực hợp đồng đã ban hành; dùng phụ lục/gia hạn',
          );
      }
      validateContract(before);
      if (!before.sign_date || !before.file_url)
        throw new BadRequestException(
          'Cần ngày ký và chứng từ trước khi ban hành',
        );
      const snapshot = {
        ...before,
        effective_from: isoDate(before.effective_from),
        effective_to: before.effective_to ? isoDate(before.effective_to) : null,
        sign_date: isoDate(before.sign_date),
      };
      const row = await updateLifecycleRow(
        db,
        'employment_contracts',
        tenantId,
        id,
        {
          status: 'ACTIVE',
          issued_at: new Date(),
          issued_by: principal.userId,
          issued_snapshot: JSON.stringify(snapshot),
          updated_by: principal.userId,
        },
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'CONTRACT_ISSUED',
        id,
        { employeeId: before.employee_id },
      );

      // Tự động đồng bộ hồ sơ: Nếu ban hành HĐLĐ chính thức (DEFINITE / INDEFINITE), cập nhật trạng thái OFFICIAL & officialDate
      if (['DEFINITE', 'INDEFINITE'].includes(before.contract_type)) {
        await db.query(
          `UPDATE hrm_schema.employee_profiles
           SET employment_status = 'OFFICIAL',
               official_date = COALESCE(official_date, $3::date),
               updated_by = $4,
               updated_at = clock_timestamp()
           WHERE tenant_id = $1 AND employee_id = $2
             AND deleted_at IS NULL
             AND employment_status NOT IN ('RESIGNED', 'TERMINATED')`,
          [tenantId, before.employee_id, isoDate(before.effective_from), principal.userId],
        );
      }

      return { data: mapContract(row) };
    });
  }
  @Post('contracts/:id/amendments')
  async amend(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: CreateEmploymentContractRequest & Version & { reason: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    requireText(body.reason, 'Lý do', 2000);
    return hrmTransaction(pool, async (db) => {
      await contractEmployee(db, tenantId, id);
      const parent = await lockLifecycleRow(
        db,
        'employment_contracts',
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      if (parent.status !== 'ACTIVE' || parent.parent_contract_id)
        throw new ConflictException(
          'Lập phụ lục từ hợp đồng gốc đang có hiệu lực',
        );
      if (
        requireDate(body.effectiveFrom, 'Ngày hiệu lực') <
        isoDate(parent.effective_from)
      )
        throw new BadRequestException(
          'Phụ lục không được có hiệu lực trước hợp đồng gốc',
        );
      const row = await insertContract(
        db,
        tenantId,
        parent.employee_id,
        principal.userId,
        body,
        id,
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'CONTRACT_AMENDMENT_CREATED',
        row.id,
        { parentContractId: id, reason: body.reason },
      );
      return { data: mapContract(row) };
    });
  }
  @Post('contracts/:id/terminate')
  async terminate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: Version & {
      effectiveDate: string;
      reason: string;
      evidenceReference: string;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.employee.manage',
    );
    const date = requireDate(body.effectiveDate, 'Ngày chấm dứt');
    requireText(body.reason, 'Lý do', 2000);
    requireText(body.evidenceReference, 'Chứng từ', 500);
    return hrmTransaction(pool, async (db) => {
      await contractEmployee(db, tenantId, id);
      const before = await lockLifecycleRow(
        db,
        'employment_contracts',
        tenantId,
        id,
        body.expectedUpdatedAt,
      );
      if (before.status !== 'ACTIVE')
        throw new ConflictException('Chỉ chấm dứt hợp đồng đã ban hành');
      if (
        date < isoDate(before.effective_from) ||
        (before.effective_to && date > isoDate(before.effective_to))
      )
        throw new BadRequestException(
          'Ngày chấm dứt phải trong hiệu lực hợp đồng',
        );
      const children = await db.query(
        "SELECT id FROM hrm_schema.employment_contracts WHERE tenant_id=$1 AND parent_contract_id=$2 AND status='ACTIVE' AND deleted_at IS NULL",
        [tenantId, id],
      );
      if (children.rowCount)
        throw new ConflictException(
          'Cần kết thúc các phụ lục đang có hiệu lực trước',
        );
      const row = await updateLifecycleRow(
        db,
        'employment_contracts',
        tenantId,
        id,
        {
          status: 'TERMINATED',
          terminated_on: date,
          termination_reason: body.reason,
          updated_by: principal.userId,
        },
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'CONTRACT_TERMINATED',
        id,
        {
          effectiveDate: date,
          reason: body.reason,
          evidenceReference: body.evidenceReference,
        },
      );
      return { data: mapContract(row) };
    });
  }
}
