import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmApprovalPolicyService } from '../infrastructure/hrm-approval-policy.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import {
  assertCanWrite,
  createComment,
  listComments,
  loadRequestOwner,
  normalizeRequestKind,
  resolveThreadAccess,
  searchMentionCandidates,
  validateCommentBody,
  validMentions,
} from '../infrastructure/hrm-request-comment.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { requireUuid } from '../infrastructure/hrm-validation.js';

const DECISIONS = ['APPROVE', 'REJECT', 'RETURN', 'COMPLETE'];

/**
 * Trao đổi và ý kiến phê duyệt trên đơn từ (mọi loại đơn). Ai được đọc và viết do `resolveThreadAccess` quyết định:
 * chủ đơn, người xem được mọi đơn, người duyệt trong phạm vi cấp dưới, và người đã được nhắc tên trong luồng.
 */
@Controller('v1')
export class HrmRequestCommentController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly approvals: HrmApprovalPolicyService,
  ) {}

  /** Tính quyền của người gọi trên một đơn; ném 404 nếu đơn không tồn tại, 403 nếu không có quyền. */
  private async access(req: Request, kindInput: unknown, requestIdInput: unknown) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.self.read');
    const kind = normalizeRequestKind(kindInput);
    const requestId = requireUuid(requestIdInput, 'Đơn');
    const owner = await loadRequestOwner(pool, tenantId, kind, requestId);
    const actor = { userId: principal.userId, permissions: principal.permissions };
    const access = await resolveThreadAccess(pool, tenantId, actor, kind, requestId, owner, async () => {
      try {
        // Cùng phạm vi cấp dưới với thao tác duyệt; 'reverse' bỏ qua kiểm tra quy trình đang chạy.
        await this.approvals.assertCanDecide({ pool, tenantId, principal }, requestId, kind, 'reverse');
        return true;
      } catch {
        return false;
      }
    });
    assertCanWrite(access);
    return { pool, tenantId, principal, kind, requestId, owner, access };
  }

  @RequirePermission('hrm.self.read')
  @Get('request-comments')
  async list(@Req() req: Request, @Query('kind') kind?: string, @Query('requestId') requestId?: string) {
    const c = await this.access(req, kind, requestId);
    return { data: await listComments(c.pool, c.tenantId, c.kind, c.requestId, c.principal.userId) };
  }

  @RequirePermission('hrm.self.read')
  @Get('request-comments/mention-candidates')
  async candidates(@Req() req: Request, @Query('q') q = '') {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.self.read');
    return { data: await searchMentionCandidates(pool, tenantId, String(q).slice(0, 80), principal.userId) };
  }

  @RequirePermission('hrm.self.read')
  @Post('request-comments')
  async create(
    @Req() req: Request,
    @Body()
    body: {
      kind?: string;
      requestId?: string;
      body?: string;
      mentionUserIds?: string[];
      commentKind?: 'COMMENT' | 'DECISION';
      decision?: string;
      attachments?: Array<{ id: string; name: string; contentType?: string; sizeBytes?: number }>;
    },
  ) {
    const c = await this.access(req, body?.kind, body?.requestId);
    const text = validateCommentBody(body?.body);
    const commentKind = body?.commentKind === 'DECISION' ? 'DECISION' : 'COMMENT';
    const decision = commentKind === 'DECISION' ? String(body?.decision ?? '').toUpperCase() : null;
    // Ý kiến kèm quyết định chỉ do người có quyền xử lý đơn ghi, không phải người tham gia thường.
    if (commentKind === 'DECISION' && (!decision || !DECISIONS.includes(decision) || c.access === 'PARTICIPANT'))
      assertCanWrite(null);
    const me = await this.ctx.resolveEmployee(c.pool, c.tenantId, c.principal.userId).catch(() => null);
    const created = await hrmTransaction(c.pool, async (db) => {
      const mentions = await validMentions(db, c.tenantId, c.principal.userId, body?.mentionUserIds);
      return createComment(db, {
        tenantId: c.tenantId,
        kind: c.kind,
        requestId: c.requestId,
        actor: {
          userId: c.principal.userId,
          permissions: c.principal.permissions,
          name: me?.fullName ?? c.principal.displayName ?? 'Người dùng',
        },
        owner: c.owner,
        access: c.access,
        body: text,
        mentionUserIds: mentions,
        commentKind,
        decision,
        attachments: body?.attachments,
      });
    });
    return { data: created };
  }
}
