import type {
  HrmRequestReason,
  HrmRequestReasonCategory,
  HrmRequestReasonKind,
  SaveRequestReasonCategoryRequest,
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
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { requireText, requireUuid } from '../infrastructure/hrm-validation.js';

// Loại đơn hệ thống: luôn tồn tại, không xoá được. Tenant có thể thêm loại đơn khác.
const SYSTEM_CATEGORIES: {
  code: string;
  name: string;
  sortOrder: number;
  fixedItems: boolean;
}[] = [
  { code: 'BUSINESS_TRIP', name: 'Lý do công tác', sortOrder: 2, fixedItems: false },
  { code: 'OT_TYPE', name: 'Loại OT', sortOrder: 3, fixedItems: true },
  { code: 'TRIP_TYPE', name: 'Loại công tác', sortOrder: 4, fixedItems: true },
  { code: 'TRIP_VEHICLE', name: 'Phương tiện công tác', sortOrder: 5, fixedItems: false },
];

interface DefaultItem {
  name: string;
  code?: string;
  description?: string;
}

// Lý do mặc định khi tenant chưa cấu hình (trước đây là danh sách cố định trong form).
const plain = (names: string[]): DefaultItem[] => names.map((name) => ({ name }));
const DEFAULT_REASONS: Record<string, DefaultItem[]> = {
  OT_TYPE: [
    { code: 'WEEKDAY', name: 'Ngày thường' },
    { code: 'WEEKEND', name: 'Ngày nghỉ hằng tuần' },
    { code: 'NIGHT', name: 'Làm thêm ca đêm' },
    { code: 'HOLIDAY', name: 'Ngày lễ / Tết' },
    { code: 'NIGHT_WEEKEND', name: 'Làm thêm ca đêm ngày nghỉ hằng tuần' },
    { code: 'NIGHT_HOLIDAY', name: 'Làm thêm ca đêm ngày lễ / Tết' },
  ],
  TRIP_TYPE: [
    { code: 'DOMESTIC', name: 'Công tác trong nước (Nội địa)' },
    { code: 'OVERSEAS', name: 'Công tác nước ngoài (Quốc tế)' },
    { code: 'INTERSITE', name: 'Công tác nội bộ liên chi nhánh' },
  ],
  TRIP_VEHICLE: [
    { name: 'Xe công ty', description: 'Xe công vụ điều động' },
    { name: 'Xe ngoài', description: 'Xe khách, taxi, xe hợp đồng' },
    { name: 'Máy bay', description: 'Chuyến bay công tác xa' },
    { name: 'Phương tiện cá nhân' },
  ],
  BUSINESS_TRIP: plain([
    'Thực hiện công tác thí nghiệm / kiểm định',
    'Bàn giao, lắp đặt thiết bị / công trình',
    'Khảo sát hiện trường / nhà máy / trạm',
    'Tham gia nghiệm thu / hoàn thiện hồ sơ nghiệm thu',
    'Sửa chữa, khắc phục sự cố kỹ thuật',
    'Theo yêu cầu cấp trên / Ban Giám Đốc',
    'Hội thảo, đào tạo & làm việc đối tác',
    'Lý do khác',
  ]),
};

function mapCategory(row: Record<string, any>): HrmRequestReasonCategory {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
    isSystem: Boolean(row.is_system),
    fixedItems: Boolean(row.fixed_items),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

type Queryable = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: any[]; rowCount: number | null }>;
};

async function ensureSystemCategories(pool: Queryable, tenantId: string) {
  await pool.query(
    `INSERT INTO hrm_schema.request_reason_categories (tenant_id, code, name, sort_order, is_system, fixed_items)
     SELECT $1, code, name, ord, true, fixed
       FROM unnest($2::text[], $3::text[], $4::int[], $5::boolean[]) AS t(code, name, ord, fixed)
     ON CONFLICT DO NOTHING`,
    [
      tenantId,
      SYSTEM_CATEGORIES.map((c) => c.code),
      SYSTEM_CATEGORIES.map((c) => c.name),
      SYSTEM_CATEGORIES.map((c) => c.sortOrder),
      SYSTEM_CATEGORIES.map((c) => c.fixedItems),
    ],
  );
}

/** Loại đơn phải tồn tại trong danh mục của tenant thì mới được gắn lý do. */
async function requireKind(
  pool: Queryable,
  tenantId: string,
  kind: unknown,
): Promise<{ code: HrmRequestReasonKind; fixedItems: boolean }> {
  if (typeof kind !== 'string' || !kind.trim())
    throw new BadRequestException('Loại đơn của lý do không hợp lệ');
  await ensureSystemCategories(pool, tenantId);
  const found = await pool.query(
    `SELECT code, fixed_items FROM hrm_schema.request_reason_categories
      WHERE tenant_id=$1 AND upper(code)=upper($2) AND deleted_at IS NULL`,
    [tenantId, kind],
  );
  if (!found.rowCount)
    throw new BadRequestException('Loại đơn của lý do không hợp lệ');
  return {
    code: found.rows[0].code as string,
    fixedItems: Boolean(found.rows[0].fixed_items),
  };
}

function mapReason(row: Record<string, any>): HrmRequestReason {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind,
    code: row.code ?? null,
    name: row.name,
    description: row.description ?? null,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function rethrowDuplicate(error: unknown): never {
  if ((error as { code?: string })?.code === '23505')
    throw new ConflictException('Lý do này đã tồn tại');
  throw error;
}

@Controller('v1')
export class HrmRequestReasonController {
  constructor(private readonly ctx: HrmContextService) {}

  @Get('request-reasons')
  async list(
    @Req() req: Request,
    @Query('kind') kind?: string,
    @Query('active') active?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    await ensureSystemCategories(pool, tenantId);
    // Lọc theo loại đơn; không truyền kind thì trả mọi loại đơn của tenant.
    const kinds = kind
      ? [kind]
      : (
          await pool.query(
            `SELECT code FROM hrm_schema.request_reason_categories
              WHERE tenant_id=$1 AND deleted_at IS NULL`,
            [tenantId],
          )
        ).rows.map((r) => r.code as string);
    // Lần đầu truy cập: nạp danh sách mặc định của loại đơn hệ thống để các lý do vốn có không bị mất.
    for (const k of kinds.filter((x) => DEFAULT_REASONS[x])) {
      const existing = await pool.query(
        'SELECT 1 FROM hrm_schema.request_reasons WHERE tenant_id=$1 AND kind=$2 LIMIT 1',
        [tenantId, k],
      );
      // Loại OT luôn bổ sung các mã còn thiếu (VD: hai mã ca đêm thêm sau) vì hệ thống phân loại theo mã.
      if (existing.rowCount && k !== 'OT_TYPE') continue;
      await pool.query(
        `INSERT INTO hrm_schema.request_reasons (tenant_id, kind, name, code, description, sort_order)
         SELECT $1, $2, name, NULLIF(code,''), NULLIF(description,''), ord
           FROM unnest($3::text[], $4::text[], $5::text[]) WITH ORDINALITY AS t(name, code, description, ord)
         ON CONFLICT DO NOTHING`,
        [
          tenantId,
          k,
          DEFAULT_REASONS[k].map((d) => d.name),
          DEFAULT_REASONS[k].map((d) => d.code ?? ''),
          DEFAULT_REASONS[k].map((d) => d.description ?? ''),
        ],
      );
    }
    const res = await pool.query(
      `SELECT r.* FROM hrm_schema.request_reasons r
       WHERE r.tenant_id=$1 AND r.deleted_at IS NULL AND r.kind = ANY($2::text[])
         AND ($3::boolean IS NULL OR r.active = $3)
         AND ($3::boolean IS DISTINCT FROM true OR EXISTS (
           SELECT 1 FROM hrm_schema.request_reason_categories c
            WHERE c.tenant_id=r.tenant_id AND c.code=r.kind AND c.deleted_at IS NULL AND c.active))
       ORDER BY r.kind, r.sort_order, r.name`,
      [tenantId, kinds, active !== undefined ? active === 'true' : null],
    );
    return {
      data: res.rows.map(mapReason),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('request-reasons')
  async create(@Req() req: Request, @Body() body: SaveRequestReasonRequest) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    const category = await requireKind(pool, tenantId, body.kind);
    if (category.fixedItems)
      throw new ConflictException(
        'Danh mục này do hệ thống tính toán theo mã nên không thêm mục mới; chỉ bật/tắt hoặc đổi tên.',
      );
    const kind = category.code;
    requireText(body.name, 'Tên lý do', 255);
    const res = await pool
      .query(
        `INSERT INTO hrm_schema.request_reasons
           (tenant_id, kind, name, code, description, active, sort_order)
         VALUES ($1,$2,$3,$7,$4,$5,COALESCE($6,
           (SELECT COALESCE(MAX(sort_order),0)+1 FROM hrm_schema.request_reasons WHERE tenant_id=$1 AND kind=$2)))
         RETURNING *`,
        [
          tenantId,
          kind,
          body.name!.trim(),
          body.description?.trim() || null,
          body.active ?? true,
          body.sortOrder ?? null,
          body.code?.trim().toUpperCase() || null,
        ],
      )
      .catch(rethrowDuplicate);
    return {
      data: mapReason(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('request-reasons/:id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SaveRequestReasonRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    requireUuid(id, 'Lý do');
    if (body.name !== undefined) requireText(body.name, 'Tên lý do', 255);
    const current = await pool.query(
      `SELECT r.kind, COALESCE(c.fixed_items,false) AS fixed_items
         FROM hrm_schema.request_reasons r
         LEFT JOIN hrm_schema.request_reason_categories c
           ON c.tenant_id=r.tenant_id AND c.code=r.kind AND c.deleted_at IS NULL
        WHERE r.tenant_id=$1 AND r.id=$2 AND r.deleted_at IS NULL`,
      [tenantId, id],
    );
    if (!current.rowCount) throw new NotFoundException('Không tìm thấy lý do');
    // Mục của danh mục cố định giữ nguyên ký hiệu vì hệ thống tính toán theo mã.
    const codeChange =
      body.code !== undefined && !current.rows[0].fixed_items;
    const res = await pool
      .query(
        `UPDATE hrm_schema.request_reasons SET
           code=CASE WHEN $8::boolean THEN $9 ELSE code END,
           name=COALESCE($3,name),
           description=CASE WHEN $4::boolean THEN $5 ELSE description END,
           active=COALESCE($6,active),
           sort_order=COALESCE($7,sort_order),
           updated_at=now()
         WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING *`,
        [
          tenantId,
          id,
          body.name?.trim() ?? null,
          body.description !== undefined,
          body.description?.trim() || null,
          body.active ?? null,
          body.sortOrder ?? null,
          codeChange,
          body.code?.trim().toUpperCase() || null,
        ],
      )
      .catch(rethrowDuplicate);
    if (!res.rowCount) throw new NotFoundException('Không tìm thấy lý do');
    return {
      data: mapReason(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Delete('request-reasons/:id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    requireUuid(id, 'Lý do');
    const fixed = await pool.query(
      `SELECT 1 FROM hrm_schema.request_reasons r
         JOIN hrm_schema.request_reason_categories c
           ON c.tenant_id=r.tenant_id AND c.code=r.kind AND c.deleted_at IS NULL AND c.fixed_items
        WHERE r.tenant_id=$1 AND r.id=$2`,
      [tenantId, id],
    );
    if (fixed.rowCount)
      throw new ConflictException(
        'Mục của danh mục này không xoá được; hãy ngừng sử dụng nếu không cần.',
      );
    const res = await pool.query(
      `UPDATE hrm_schema.request_reasons SET deleted_at=now(), active=false, updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`,
      [tenantId, id],
    );
    if (!res.rowCount) throw new NotFoundException('Không tìm thấy lý do');
    return {
      data: { id },
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  // --------------------------------------------------------------------------
  // Loại đơn (danh mục động): mỗi loại đơn là một tab và có danh sách lý do riêng
  // --------------------------------------------------------------------------

  @Get('request-reason-categories')
  async listCategories(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.read');
    await ensureSystemCategories(pool, tenantId);
    const res = await pool.query(
      `SELECT * FROM hrm_schema.request_reason_categories
        WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY sort_order, name`,
      [tenantId],
    );
    return {
      data: res.rows.map(mapCategory),
      meta: {
        total: res.rows.length,
        requestId: req.headers['x-request-id'] as string,
      },
    };
  }

  @Post('request-reason-categories')
  async createCategory(
    @Req() req: Request,
    @Body() body: SaveRequestReasonCategoryRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    requireText(body.name, 'Tên loại đơn', 255);
    const code = (body.code ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(code))
      throw new BadRequestException(
        'Mã loại đơn gồm chữ hoa, số, dấu gạch dưới; bắt đầu bằng chữ cái (2-50 ký tự)',
      );
    await ensureSystemCategories(pool, tenantId);
    const res = await pool
      .query(
        `INSERT INTO hrm_schema.request_reason_categories
           (tenant_id, code, name, description, active, sort_order)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,
           (SELECT COALESCE(MAX(sort_order),0)+1 FROM hrm_schema.request_reason_categories WHERE tenant_id=$1)))
         RETURNING *`,
        [
          tenantId,
          code,
          body.name!.trim(),
          body.description?.trim() || null,
          body.active ?? true,
          body.sortOrder ?? null,
        ],
      )
      .catch(rethrowDuplicate);
    return {
      data: mapCategory(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Patch('request-reason-categories/:id')
  async updateCategory(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SaveRequestReasonCategoryRequest,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    requireUuid(id, 'Loại đơn');
    if (body.name !== undefined) requireText(body.name, 'Tên loại đơn', 255);
    // Mã loại đơn không đổi sau khi tạo vì các lý do tham chiếu theo mã.
    const res = await pool.query(
      `UPDATE hrm_schema.request_reason_categories SET
         name=COALESCE($3,name),
         description=CASE WHEN $4::boolean THEN $5 ELSE description END,
         active=COALESCE($6,active),
         sort_order=COALESCE($7,sort_order),
         updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING *`,
      [
        tenantId,
        id,
        body.name?.trim() ?? null,
        body.description !== undefined,
        body.description?.trim() || null,
        body.active ?? null,
        body.sortOrder ?? null,
      ],
    );
    if (!res.rowCount) throw new NotFoundException('Không tìm thấy loại đơn');
    return {
      data: mapCategory(res.rows[0]),
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }

  @Delete('request-reason-categories/:id')
  async removeCategory(@Req() req: Request, @Param('id') id: string) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.leave.manage',
    );
    requireUuid(id, 'Loại đơn');
    const found = await pool.query(
      `SELECT code, is_system FROM hrm_schema.request_reason_categories
        WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    if (!found.rowCount) throw new NotFoundException('Không tìm thấy loại đơn');
    if (found.rows[0].is_system)
      throw new ConflictException(
        'Loại đơn hệ thống không thể xoá; hãy ngừng sử dụng nếu không cần.',
      );
    await pool.query(
      `UPDATE hrm_schema.request_reasons SET deleted_at=now(), active=false, updated_at=now()
        WHERE tenant_id=$1 AND kind=$2 AND deleted_at IS NULL`,
      [tenantId, found.rows[0].code],
    );
    await pool.query(
      `UPDATE hrm_schema.request_reason_categories SET deleted_at=now(), active=false, updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id],
    );
    return {
      data: { id },
      meta: { requestId: req.headers['x-request-id'] as string },
    };
  }
}
