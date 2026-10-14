import type { HrmRequestEngine, SaveRequestTypeRequest } from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { assertLifecycleVersion } from '../infrastructure/hrm-lifecycle.js';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import {
  ENGINE_REQUEST_KIND,
  REQUEST_TIME_MODES,
  ensureSystemRequestTypes,
  mapRequestType,
  requireTypeCode,
  validateRequestTypeFields,
} from '../infrastructure/hrm-request-types.js';
import { reasonCodeFromName } from '../infrastructure/hrm-request-reason.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { requireText, requireUuid } from '../infrastructure/hrm-validation.js';

/**
 * Danh mục LOẠI ĐƠN (registry): 7 loại hệ thống + loại do quản trị tạo (engine GENERIC).
 * Đọc danh sách loại đang bật cần `hrm.read` (người làm đơn chọn loại); quản trị (xem đủ, tạo, sửa, xoá) cần
 * `hrm.leave.manage`, cùng quyền với danh mục lý do đơn từ.
 */
const MANAGE_PERMISSION = 'hrm.leave.manage';

type Row = Record<string, any>;

const TYPE_SELECT = `SELECT c.*,
    (CASE WHEN c.engine = 'GENERIC'
       THEN (SELECT count(*) FROM hrm_schema.custom_requests x WHERE x.tenant_id = c.tenant_id AND x.type_id = c.id)
       ELSE 0 END)::int AS usage_count
  FROM hrm_schema.request_reason_categories c`;

function requireBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Dữ liệu loại đơn không hợp lệ.');
  return body as Record<string, unknown>;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new BadRequestException(`${label} phải là đúng hoặc sai.`);
  return value;
}

function optionalText(value: unknown, label: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim().length > max)
    throw new BadRequestException(`${label} tối đa ${max} ký tự.`);
  return value.trim() || null;
}

function optionalSortOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100000)
    throw new BadRequestException('Thứ tự hiển thị phải là số nguyên từ 0 đến 100000.');
  return value as number;
}

function optionalIcon(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(value))
    throw new BadRequestException('Biểu tượng không hợp lệ (chữ thường, số, gạch ngang).');
  return value;
}

function optionalTimeMode(value: unknown) {
  if (value === undefined) return undefined;
  if (!REQUEST_TIME_MODES.includes(value as never))
    throw new BadRequestException('Cách nhập thời gian không hợp lệ.');
  return value as (typeof REQUEST_TIME_MODES)[number];
}

function rethrowDuplicate(error: unknown): never {
  if ((error as { code?: string })?.code === '23505')
    throw new ConflictException('Mã hoặc tên loại đơn này đã tồn tại.');
  throw error;
}

async function writeAudit(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  actorId: string,
  action: string,
  entityId: string,
  detail: unknown,
) {
  await db.query(
    `INSERT INTO hrm_schema.audit_log (tenant_id, actor_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, 'request_type', $4, $5)`,
    [tenantId, actorId, action, entityId, JSON.stringify(detail)],
  );
}

async function loadType(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  id: string,
  lock = false,
): Promise<Row | undefined> {
  const res = await db.query(
    `${TYPE_SELECT} WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL${lock ? ' FOR UPDATE OF c' : ''}`,
    [tenantId, id],
  );
  return res.rows[0];
}

function snapshot(row: Row) {
  return {
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    engine: row.engine,
    timeMode: row.time_mode,
    requiresAttachment: row.requires_attachment === true,
    fields: row.fields,
    icon: row.icon ?? null,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
  };
}

@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1')
export class HrmRequestTypeController {
  constructor(private readonly ctx: HrmContextService) {}

  /** Loại đơn đang bật, theo thứ tự hiển thị: danh mục để người làm đơn chọn loại. */
  @Get('request-types')
  async list(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    await ensureSystemRequestTypes(pool, tenantId);
    const res = await pool.query(
      `SELECT c.* FROM hrm_schema.request_reason_categories c
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND c.active
        ORDER BY c.sort_order, c.name`,
      [tenantId],
    );
    return {
      data: res.rows.map(mapRequestType),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  /** Quản trị: đủ loại (kể cả đã ngừng) kèm số đơn đã dùng. */
  @Get('request-types/manage')
  async listForManage(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, MANAGE_PERMISSION);
    await ensureSystemRequestTypes(pool, tenantId);
    const res = await pool.query(
      `${TYPE_SELECT} WHERE c.tenant_id = $1 AND c.deleted_at IS NULL ORDER BY c.sort_order, c.name`,
      [tenantId],
    );
    return {
      data: res.rows.map(mapRequestType),
      meta: { total: res.rows.length, requestId: req.headers['x-request-id'] as string },
    };
  }

  /** Tạo loại đơn mới (luôn engine GENERIC). */
  @Post('request-types')
  async create(@Req() req: Request, @Body() body: SaveRequestTypeRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, MANAGE_PERMISSION);
    const input = requireBody(body);
    const name = requireText(input.name, 'Tên loại đơn', 255);
    const description = optionalText(input.description, 'Mô tả', 1000);
    const timeMode = optionalTimeMode(input.timeMode) ?? 'RANGE_DATETIME';
    const requiresAttachment = optionalBoolean(input.requiresAttachment, 'Bắt buộc chứng từ') ?? false;
    const fields = input.fields === undefined ? [] : validateRequestTypeFields(input.fields);
    const icon = optionalIcon(input.icon);
    const active = optionalBoolean(input.active, 'Đang sử dụng') ?? true;
    const sortOrder = optionalSortOrder(input.sortOrder);
    const explicitCode =
      input.code !== undefined && input.code !== null && input.code !== '' ? requireTypeCode(input.code) : undefined;

    const row = await hrmTransaction(pool, async (db) => {
      await ensureSystemRequestTypes(db, tenantId);
      const taken = (
        await db.query(
          `SELECT upper(code) AS code FROM hrm_schema.request_reason_categories WHERE tenant_id = $1`,
          [tenantId],
        )
      ).rows.map((r) => String(r.code));
      let code = explicitCode;
      if (code) {
        if (taken.includes(code)) throw new ConflictException(`Mã loại đơn "${code}" đã tồn tại.`);
      } else {
        const base = reasonCodeFromName(name);
        code = base;
        for (let n = 2; taken.includes(code) || requireTypeCodeSafe(code) === false; n++) code = `${base}_${n}`;
      }
      const dup = await db.query(
        `SELECT 1 FROM hrm_schema.request_reason_categories
          WHERE tenant_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL LIMIT 1`,
        [tenantId, name],
      );
      if (dup.rowCount) throw new ConflictException(`Loại đơn "${name}" đã có.`);
      const inserted = await db
        .query(
          `INSERT INTO hrm_schema.request_reason_categories
             (tenant_id, code, name, description, engine, time_mode, requires_attachment, fields, icon, is_system, active, sort_order)
           VALUES ($1, $2, $3, $4, 'GENERIC', $5, $6, $7::jsonb, $8, false, $9,
             COALESCE($10::int,
               (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM hrm_schema.request_reason_categories
                 WHERE tenant_id = $1 AND deleted_at IS NULL)))
           RETURNING id`,
          [
            tenantId,
            code,
            name,
            description ?? null,
            timeMode,
            requiresAttachment,
            JSON.stringify(fields),
            icon ?? null,
            active,
            sortOrder ?? null,
          ],
        )
        .catch(rethrowDuplicate);
      const created = (await loadType(db, tenantId, inserted.rows[0].id))!;
      await writeAudit(db, tenantId, principal.userId, 'REQUEST_TYPE_CREATED', created.id, { after: snapshot(created) });
      return created;
    });
    return { data: mapRequestType(row), meta: { requestId: req.headers['x-request-id'] as string } };
  }

  /**
   * Sửa loại đơn. Loại hệ thống chỉ đổi tên, mô tả, thứ tự, biểu tượng, bật/tắt (loại Nghỉ phép luôn bật).
   * Loại tự tạo đổi thêm cách nhập thời gian, chứng từ, trường động. Không đổi mã và engine.
   */
  @Patch('request-types/:id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: SaveRequestTypeRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, MANAGE_PERMISSION);
    requireUuid(id, 'Loại đơn');
    const input = requireBody(body);
    const name = input.name === undefined ? undefined : requireText(input.name, 'Tên loại đơn', 255);
    const description = optionalText(input.description, 'Mô tả', 1000);
    const timeMode = optionalTimeMode(input.timeMode);
    const requiresAttachment = optionalBoolean(input.requiresAttachment, 'Bắt buộc chứng từ');
    const fields = input.fields === undefined ? undefined : validateRequestTypeFields(input.fields);
    const icon = optionalIcon(input.icon);
    const active = optionalBoolean(input.active, 'Đang sử dụng');
    const sortOrder = optionalSortOrder(input.sortOrder);

    const row = await hrmTransaction(pool, async (db) => {
      const before = await loadType(db, tenantId, id, true);
      if (!before) throw new NotFoundException('Không tìm thấy loại đơn.');
      assertLifecycleVersion({ updated_at: before.updated_at }, input.expectedUpdatedAt);
      if (input.code !== undefined && String(input.code).trim().toUpperCase() !== String(before.code).toUpperCase())
        throw new BadRequestException('Không đổi được mã loại đơn.');
      if (before.is_system) {
        if (timeMode !== undefined || requiresAttachment !== undefined || fields !== undefined)
          throw new BadRequestException(
            'Loại đơn hệ thống không đổi được cách nhập thời gian, chứng từ và trường; chỉ đổi tên, mô tả, thứ tự, biểu tượng, bật/tắt.',
          );
        if (active === false && before.code === 'LEAVE')
          throw new ConflictException('Không thể ngừng loại đơn Nghỉ phép.');
      }
      if (name !== undefined && name.toLowerCase() !== String(before.name).toLowerCase()) {
        const dup = await db.query(
          `SELECT 1 FROM hrm_schema.request_reason_categories
            WHERE tenant_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL AND id <> $3 LIMIT 1`,
          [tenantId, name, id],
        );
        if (dup.rowCount) throw new ConflictException(`Loại đơn "${name}" đã có.`);
      }
      await db
        .query(
          `UPDATE hrm_schema.request_reason_categories SET
             name = COALESCE($3, name),
             description = CASE WHEN $4::boolean THEN $5 ELSE description END,
             time_mode = COALESCE($6, time_mode),
             requires_attachment = COALESCE($7, requires_attachment),
             fields = COALESCE($8::jsonb, fields),
             icon = CASE WHEN $9::boolean THEN $10 ELSE icon END,
             active = COALESCE($11, active),
             sort_order = COALESCE($12::int, sort_order),
             updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
           WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [
            tenantId,
            id,
            name ?? null,
            description !== undefined,
            description ?? null,
            timeMode ?? null,
            requiresAttachment ?? null,
            fields === undefined ? null : JSON.stringify(fields),
            icon !== undefined,
            icon ?? null,
            active ?? null,
            sortOrder ?? null,
          ],
        )
        .catch(rethrowDuplicate);
      const after = (await loadType(db, tenantId, id))!;
      await writeAudit(db, tenantId, principal.userId, 'REQUEST_TYPE_UPDATED', id, {
        before: snapshot(before),
        after: snapshot(after),
      });
      return after;
    });
    return { data: mapRequestType(row), meta: { requestId: req.headers['x-request-id'] as string } };
  }

  /**
   * Xoá mềm loại đơn (kể cả loại hệ thống) khi loại đã ngừng sử dụng. Chỉ đặt `deleted_at` cho loại và lý do của nó,
   * gỡ liên kết quy trình duyệt của loại; đơn đã tạo và engine xử lý giữ nguyên nên đơn cũ vẫn xem được. Còn hồ sơ
   * quy trình đang chạy của loại thì chưa xoá được. Loại hệ thống bị xoá không được tự tạo lại.
   */
  @Delete('request-types/:id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, MANAGE_PERMISSION);
    requireUuid(id, 'Loại đơn');
    const result = await hrmTransaction(pool, async (db) => {
      const before = await loadType(db, tenantId, id, true);
      if (!before) throw new NotFoundException('Không tìm thấy loại đơn.');
      if (before.active)
        throw new ConflictException('Cần ngừng sử dụng loại đơn trước khi xoá.');
      const usageCount = Number(before.usage_count ?? 0);
      const kind = ENGINE_REQUEST_KIND[before.engine as HrmRequestEngine];
      if (before.engine !== 'GENERIC') {
        const links = await db.query(`SELECT to_regclass('hrm_schema.procedure_links') IS NOT NULL AS ok`);
        if (links.rows[0]?.ok === true) {
          const running = await db.query(
            `SELECT count(*)::int AS n FROM hrm_schema.procedure_links
              WHERE tenant_id = $1 AND request_kind = $2 AND sync_status IN ('START_PENDING', 'RUNNING', 'APPLY_PENDING')`,
            [tenantId, kind],
          );
          const count = Number(running.rows[0]?.n ?? 0);
          if (count > 0)
            throw new ConflictException(
              `Loại đơn "${before.name}" còn ${count} đơn đang chạy quy trình duyệt nên chưa xoá được; chờ các đơn này xử lý xong.`,
            );
        }
      }
      await db.query(
        `UPDATE hrm_schema.request_reason_categories
            SET deleted_at = now(), active = false, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      // Lý do của loại này (kind = mã loại) không còn chỗ dùng: xoá mềm cùng lúc.
      await db.query(
        `UPDATE hrm_schema.request_reasons SET deleted_at = now(), active = false, updated_at = now()
          WHERE tenant_id = $1 AND kind = $2 AND deleted_at IS NULL`,
        [tenantId, before.code],
      );
      // Gỡ liên kết quy trình duyệt của loại: loại hệ thống theo kind của engine, loại tự tạo theo mã loại.
      await db.query(
        `UPDATE hrm_schema.request_procedure_bindings SET is_active = false, updated_at = now()
          WHERE tenant_id = $1 AND request_kind = $2 AND is_active
            AND ($3::text IS NULL OR sub_type_code = $3::text)`,
        [tenantId, kind, before.engine === 'GENERIC' ? before.code : null],
      );
      await writeAudit(db, tenantId, principal.userId, 'REQUEST_TYPE_DELETED', id, {
        before: snapshot(before),
        usageCount,
        system: before.is_system === true,
      });
      return {
        deleted: true,
        active: false,
        usageCount,
        message:
          usageCount > 0
            ? `Đã xoá loại đơn "${before.name}". ${usageCount} đơn đã tạo vẫn được giữ nguyên.`
            : `Đã xoá loại đơn "${before.name}".`,
      };
    });
    const { message, ...data } = result;
    return { data: { id, ...data }, message, meta: { requestId: req.headers['x-request-id'] as string } };
  }
}

/** Mã sinh từ tên không được trùng mã loại hệ thống (kết quả false thì thêm hậu tố). */
function requireTypeCodeSafe(code: string): boolean {
  try {
    requireTypeCode(code);
    return true;
  } catch {
    return false;
  }
}
