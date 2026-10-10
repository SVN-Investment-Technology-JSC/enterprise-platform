import type {
  HrmRequestReason,
  SaveRequestReasonRequest,
} from '@enterprise-platform/contracts-hrm';
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
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import {
  DEFAULT_REQUEST_REASONS,
  REQUEST_REASON_CODE_PATTERN,
  REQUEST_REASON_KINDS,
  REQUEST_REASON_KIND_LABELS,
  isRequestReasonKind,
  reasonCodeFromName,
  uniqueReasonCode,
  type RequestReasonKind,
} from '../infrastructure/hrm-request-reason.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { requireText, requireUuid } from '../infrastructure/hrm-validation.js';

/**
 * Danh mục LÝ DO ĐƠN (cố định 4 loại đơn: làm thêm giờ, công tác, giải trình công, đổi ca).
 *
 * Phân biệt hai khái niệm, đừng nhầm:
 *  - LÝ DO (file này): mục trong danh mục cấu hình, người làm đơn chỉ CHỌN (reasonId trên đơn).
 *  - MÔ TẢ: văn bản tự do bổ sung của đơn (`description`), không thuộc danh mục này.
 * Đơn nghỉ không dùng danh mục: lý do nghỉ chính là loại nghỉ (leave_types).
 *
 * Quyền: đọc cần `hrm.read` (người làm đơn phải đọc được để chọn lý do); ghi cần `hrm.leave.manage`, cùng quyền
 * với tab "Danh mục đơn từ" trong màn Cấu hình (HRM chưa có quyền riêng cho cấu hình đơn từ).
 */
const MANAGE_PERMISSION = 'hrm.leave.manage';

/** Số đơn đã chọn lý do này. Đơn lưu reason_id nên dùng để chặn xóa cứng khi lý do đã có đơn. */
const USAGE_COUNT_SQL = `(CASE r.kind
    WHEN 'OVERTIME' THEN (SELECT count(*) FROM hrm_schema.ot_requests x WHERE x.tenant_id = r.tenant_id AND x.reason_id = r.id)
    WHEN 'BUSINESS_TRIP' THEN (SELECT count(*) FROM hrm_schema.business_trip_requests x WHERE x.tenant_id = r.tenant_id AND x.reason_id = r.id)
    WHEN 'ATTENDANCE_CORRECTION' THEN (SELECT count(*) FROM hrm_schema.attendance_corrections x WHERE x.tenant_id = r.tenant_id AND x.reason_id = r.id)
    WHEN 'SHIFT_CHANGE' THEN (SELECT count(*) FROM hrm_schema.shift_change_requests x WHERE x.tenant_id = r.tenant_id AND x.reason_id = r.id)
    ELSE 0 END)::int`;
const REASON_SELECT = `SELECT r.*, ${USAGE_COUNT_SQL} AS usage_count FROM hrm_schema.request_reasons r`;

const KIND_HINT = REQUEST_REASON_KINDS.map(
  (kind) => REQUEST_REASON_KIND_LABELS[kind].toLowerCase(),
).join(', ');

type Row = Record<string, any>;

function mapReason(row: Row): HrmRequestReason {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    paid: row.paid !== false,
    requiresDescription: row.requires_description === true,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
    usageCount: row.usage_count === undefined ? undefined : Number(row.usage_count),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function requireKind(kind: unknown): RequestReasonKind {
  if (!isRequestReasonKind(kind))
    throw new BadRequestException(
      `Loại đơn của lý do không hợp lệ; chỉ có danh mục lý do cho đơn ${KIND_HINT}.`,
    );
  return kind;
}

function requireBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Dữ liệu lý do không hợp lệ.');
  return body as Record<string, unknown>;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean')
    throw new BadRequestException(`${label} phải là đúng hoặc sai.`);
  return value;
}

/** Diễn giải cho người chọn lý do: văn bản ngắn, rỗng thì bỏ (null). KHÔNG phải mô tả của đơn. */
function optionalExplanation(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim().length > 1000)
    throw new BadRequestException('Diễn giải của lý do tối đa 1000 ký tự.');
  return value.trim() || null;
}

function optionalSortOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100000)
    throw new BadRequestException('Thứ tự hiển thị phải là số nguyên từ 0 đến 100000.');
  return value as number;
}

/**
 * Chỉ làm thêm giờ mới có "không lương" (OT không lương không sinh công làm thêm và tiền). Với công tác, giải trình
 * công, đổi ca, lương không phụ thuộc lý do nên `paid` luôn true dù client gửi gì, để dữ liệu không mâu thuẫn.
 */
function effectivePaid(kind: RequestReasonKind, paid: boolean | undefined): boolean {
  return kind === 'OVERTIME' ? (paid ?? true) : true;
}

function rethrowDuplicate(error: unknown): never {
  if ((error as { code?: string })?.code === '23505')
    throw new ConflictException('Lý do hoặc mã lý do này đã tồn tại trong danh mục.');
  throw error;
}

async function assertNameFree(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  kind: RequestReasonKind,
  name: string,
  exceptId?: string,
) {
  const found = await db.query(
    `SELECT id FROM hrm_schema.request_reasons
      WHERE tenant_id = $1 AND kind = $2 AND lower(name) = lower($3) AND deleted_at IS NULL
        AND ($4::uuid IS NULL OR id <> $4)
      LIMIT 1`,
    [tenantId, kind, name, exceptId ?? null],
  );
  if (found.rowCount)
    throw new ConflictException(
      `Lý do "${name}" đã có trong danh mục đơn ${REQUEST_REASON_KIND_LABELS[kind].toLowerCase()}.`,
    );
}

async function writeAudit(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  detail: unknown,
) {
  await db.query(
    `INSERT INTO hrm_schema.audit_log (tenant_id, actor_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, actorId, action, entityType, entityId, JSON.stringify(detail)],
  );
}

async function loadReason(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  id: string,
  lock = false,
): Promise<Row | undefined> {
  const res = await db.query(
    `${REASON_SELECT} WHERE r.tenant_id = $1 AND r.id = $2 AND r.deleted_at IS NULL${lock ? ' FOR UPDATE OF r' : ''}`,
    [tenantId, id],
  );
  return res.rows[0];
}

/** Ảnh chụp các trường cấu hình của lý do để ghi audit (trước / sau). */
function snapshot(row: Row) {
  return {
    kind: row.kind,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    paid: row.paid !== false,
    requiresDescription: row.requires_description === true,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
  };
}

@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1')
export class HrmRequestReasonController {
  constructor(private readonly ctx: HrmContextService) {}

  /** Danh sách lý do (người làm đơn gọi với `kind` và `active=true` để chọn). */
  @Get('request-reasons')
  async list(
    @Req() req: Request,
    @Query('kind') kind?: string,
    @Query('active') active?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    if (kind !== undefined && kind !== '') requireKind(kind);
    if (active !== undefined && active !== 'true' && active !== 'false')
      throw new BadRequestException('Bộ lọc active chỉ nhận true hoặc false.');
    const res = await pool.query(
      `${REASON_SELECT}
        WHERE r.tenant_id = $1 AND r.deleted_at IS NULL AND r.kind = ANY($2::text[])
          AND ($3::boolean IS NULL OR r.active = $3)
        ORDER BY r.kind, r.sort_order, r.name`,
      [
        tenantId,
        kind ? [kind] : [...REQUEST_REASON_KINDS],
        active === undefined ? null : active === 'true',
      ],
    );
    return {
      data: res.rows.map(mapReason),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  /** Tạo lý do mặc định cho loại đơn nào chưa có lý do nào (nút "Tạo lý do mặc định"); gọi lại không tạo trùng. */
  @Post('request-reasons/defaults')
  async createDefaults(@Req() req: Request) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, MANAGE_PERMISSION);
    const created = await hrmTransaction(pool, async (db) => {
      const createdByKind: Record<string, number> = {};
      for (const kind of REQUEST_REASON_KINDS) {
        const existing = await db.query(
          `SELECT 1 FROM hrm_schema.request_reasons
            WHERE tenant_id = $1 AND kind = $2 AND deleted_at IS NULL LIMIT 1`,
          [tenantId, kind],
        );
        if (existing.rowCount) continue;
        const defaults = DEFAULT_REQUEST_REASONS.filter((d) => d.kind === kind);
        const inserted = await db.query(
          `INSERT INTO hrm_schema.request_reasons
             (tenant_id, kind, code, name, description, paid, requires_description, sort_order)
           SELECT $1, $2, d.code, d.name, d.description, true, d.requires_description, d.sort_order
             FROM unnest($3::text[], $4::text[], $5::text[], $6::boolean[], $7::int[])
                  AS d(code, name, description, requires_description, sort_order)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            tenantId,
            kind,
            defaults.map((d) => d.code),
            defaults.map((d) => d.name),
            defaults.map((d) => d.description),
            defaults.map((d) => d.requiresDescription),
            defaults.map((d) => d.sortOrder),
          ],
        );
        if (inserted.rowCount) createdByKind[kind] = inserted.rowCount;
      }
      const total = Object.values(createdByKind).reduce((sum, n) => sum + n, 0);
      if (total)
        await writeAudit(
          db,
          tenantId,
          principal.userId,
          'REQUEST_REASON_DEFAULTS_CREATED',
          'request_reason_catalog',
          tenantId,
          { created: total, byKind: createdByKind },
        );
      return total;
    });
    return {
      data: { created },
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Post('request-reasons')
  async create(@Req() req: Request, @Body() body: SaveRequestReasonRequest) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, MANAGE_PERMISSION);
    const input = requireBody(body);
    const kind = requireKind(input.kind);
    const name = requireText(input.name, 'Tên lý do', 255);
    const description = optionalExplanation(input.description);
    const paid = effectivePaid(kind, optionalBoolean(input.paid, 'Có lương'));
    const requiresDescription =
      optionalBoolean(input.requiresDescription, 'Bắt buộc mô tả') ?? false;
    const active = optionalBoolean(input.active, 'Đang sử dụng') ?? true;
    const sortOrder = optionalSortOrder(input.sortOrder);
    let explicitCode: string | undefined;
    if (input.code !== undefined && input.code !== null && input.code !== '') {
      explicitCode = String(input.code).trim().toUpperCase();
      if (!REQUEST_REASON_CODE_PATTERN.test(explicitCode))
        throw new BadRequestException(
          'Mã lý do gồm chữ hoa không dấu, số, dấu gạch dưới; bắt đầu bằng chữ cái (2-50 ký tự).',
        );
    }

    const data = await hrmTransaction(pool, async (db) => {
      await assertNameFree(db, tenantId, kind, name);
      // Mã lý do dùng làm khóa cấu hình ổn định nên không tái dùng mã của lý do đã xóa mềm.
      const codes = (
        await db.query(
          `SELECT upper(code) AS code FROM hrm_schema.request_reasons
            WHERE tenant_id = $1 AND kind = $2 AND code IS NOT NULL`,
          [tenantId, kind],
        )
      ).rows.map((r) => String(r.code));
      let code = explicitCode;
      if (code) {
        if (codes.includes(code))
          throw new ConflictException(`Mã lý do "${code}" đã tồn tại.`);
      } else {
        code = uniqueReasonCode(reasonCodeFromName(name), codes);
      }
      const inserted = await db
        .query(
          `INSERT INTO hrm_schema.request_reasons
             (tenant_id, kind, code, name, description, paid, requires_description, active, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             COALESCE($9::int,
               (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM hrm_schema.request_reasons
                 WHERE tenant_id = $1 AND kind = $2 AND deleted_at IS NULL)))
           RETURNING id`,
          [
            tenantId,
            kind,
            code,
            name,
            description ?? null,
            paid,
            requiresDescription,
            active,
            sortOrder ?? null,
          ],
        )
        .catch(rethrowDuplicate);
      const row = (await loadReason(db, tenantId, inserted.rows[0].id))!;
      await writeAudit(
        db,
        tenantId,
        principal.userId,
        'REQUEST_REASON_CREATED',
        'request_reason',
        row.id,
        { after: snapshot(row) },
      );
      return row;
    });
    return {
      data: mapReason(data),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  /** Sửa tên, diễn giải, có lương, bắt buộc mô tả, đang dùng, thứ tự. Không đổi loại đơn và mã. */
  @Patch('request-reasons/:id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SaveRequestReasonRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, MANAGE_PERMISSION);
    requireUuid(id, 'Lý do');
    const input = requireBody(body);
    const name = input.name === undefined ? undefined : requireText(input.name, 'Tên lý do', 255);
    const description = optionalExplanation(input.description);
    const paid = optionalBoolean(input.paid, 'Có lương');
    const requiresDescription = optionalBoolean(input.requiresDescription, 'Bắt buộc mô tả');
    const active = optionalBoolean(input.active, 'Đang sử dụng');
    const sortOrder = optionalSortOrder(input.sortOrder);
    const hasChange = [name, description, paid, requiresDescription, active, sortOrder].some(
      (v) => v !== undefined,
    );
    if (!hasChange && input.kind === undefined && input.code === undefined)
      throw new BadRequestException('Không có thay đổi nào để lưu.');

    const data = await hrmTransaction(pool, async (db) => {
      const before = await loadReason(db, tenantId, id, true);
      if (!before) throw new NotFoundException('Không tìm thấy lý do.');
      // Loại đơn và mã là khóa cấu hình (cách duyệt, đơn đã lưu) nên không đổi; client gửi lại nguyên giá trị cũ thì bỏ qua.
      if (input.kind !== undefined && input.kind !== before.kind)
        throw new BadRequestException('Không đổi được loại đơn của lý do.');
      if (
        input.code !== undefined &&
        input.code !== null &&
        String(input.code).trim().toUpperCase() !== String(before.code).toUpperCase()
      )
        throw new BadRequestException('Không đổi được mã của lý do.');
      // Body chỉ lặp lại loại đơn và mã hiện có: không có gì để lưu, không ghi audit.
      if (!hasChange) return before;
      if (name !== undefined && name.toLowerCase() !== String(before.name).toLowerCase())
        await assertNameFree(db, tenantId, before.kind, name, id);
      // Đổi `paid` chỉ ảnh hưởng đơn tạo sau đó: đơn cũ đã lưu bản chụp paid lúc tạo.
      const nextPaid = paid === undefined ? undefined : effectivePaid(before.kind, paid);
      await db
        .query(
          `UPDATE hrm_schema.request_reasons SET
             name = COALESCE($3, name),
             description = CASE WHEN $4::boolean THEN $5 ELSE description END,
             paid = COALESCE($6, paid),
             requires_description = COALESCE($7, requires_description),
             active = COALESCE($8, active),
             sort_order = COALESCE($9::int, sort_order),
             updated_at = now()
           WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [
            tenantId,
            id,
            name ?? null,
            description !== undefined,
            description ?? null,
            nextPaid ?? null,
            requiresDescription ?? null,
            active ?? null,
            sortOrder ?? null,
          ],
        )
        .catch(rethrowDuplicate);
      const after = (await loadReason(db, tenantId, id))!;
      await writeAudit(
        db,
        tenantId,
        principal.userId,
        'REQUEST_REASON_UPDATED',
        'request_reason',
        id,
        { before: snapshot(before), after: snapshot(after) },
      );
      return after;
    });
    return {
      data: mapReason(data),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  /**
   * Xóa mềm lý do. Lý do đã có đơn dùng thì KHÔNG xóa: chỉ chuyển sang ngừng sử dụng (active=false) để đơn cũ
   * vẫn hiện đúng tên lý do; kết quả cho biết `deleted: false` kèm thông báo tiếng Việt.
   */
  @Delete('request-reasons/:id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, MANAGE_PERMISSION);
    requireUuid(id, 'Lý do');
    const result = await hrmTransaction(pool, async (db) => {
      const before = await loadReason(db, tenantId, id, true);
      if (!before) throw new NotFoundException('Không tìm thấy lý do.');
      const usageCount = Number(before.usage_count ?? 0);
      if (usageCount > 0) {
        if (before.active)
          await db.query(
            `UPDATE hrm_schema.request_reasons SET active = false, updated_at = now()
              WHERE tenant_id = $1 AND id = $2`,
            [tenantId, id],
          );
        await writeAudit(
          db,
          tenantId,
          principal.userId,
          'REQUEST_REASON_DEACTIVATED',
          'request_reason',
          id,
          { before: snapshot(before), usageCount },
        );
        return {
          deleted: false,
          active: false,
          usageCount,
          message: `Lý do "${before.name}" đã được dùng trong ${usageCount} đơn nên không xóa được; hệ thống chỉ ngừng sử dụng lý do này.`,
        };
      }
      await db.query(
        `UPDATE hrm_schema.request_reasons
            SET deleted_at = now(), active = false, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      await writeAudit(
        db,
        tenantId,
        principal.userId,
        'REQUEST_REASON_DELETED',
        'request_reason',
        id,
        { before: snapshot(before) },
      );
      return {
        deleted: true,
        active: false,
        usageCount: 0,
        message: `Đã xóa lý do "${before.name}".`,
      };
    });
    const { message, ...data } = result;
    return {
      data: { id, ...data },
      message,
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }
}
