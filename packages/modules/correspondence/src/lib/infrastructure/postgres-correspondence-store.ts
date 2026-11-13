import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import {
  DEFAULT_CORRESPONDENCE_SETTINGS,
  RETURN_TARGETS,
  type ApproverRule,
  type CatalogItem,
  type CatalogKind,
  type CorrespondenceSettings,
  type DeliveryStatus,
  type LetterHistoryAction,
  type LetterStage,
  type ReturnTarget,
  type Workflow,
  type WorkflowStep,
} from '@enterprise-platform/contracts-correspondence';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  AssignmentRecord,
  AttachmentRecord,
  CatalogUpsert,
  CommentRecord,
  CorrespondenceStore,
  HistoryInsert,
  HistoryRecord,
  LetterInsert,
  LetterListFilter,
  LetterListRow,
  LetterPatch,
  LetterRecord,
  LetterTransaction,
  OutboxEvent,
  StepRecord,
  StepUpdate,
  WorkflowUpsert,
} from '../application/ports.js';
import {
  CorrespondenceNotProvisionedError,
  CorrespondenceValidationError,
  LetterNotFoundError,
} from '../domain/correspondence.error.js';
import { formatSequenceNo } from '../domain/letter-rules.js';

const SETTINGS_KEY = 'register';

/** Ngày đọc ra dạng chuỗi `YYYY-MM-DD` nhờ cast `::text`. */
const LETTER_COLUMNS = `l.id, l.direction, l.year, l.seq, l.incoming_no, l.received_on::text AS received_on, l.sender_org,
  l.sender_ref, l.sender_date::text AS sender_date, l.subject, l.kind, l.urgency, l.confidentiality,
  l.due_on::text AS due_on, l.stage, l.workflow_id, l.workflow_name, l.instruction,
  l.author_user_id, l.author_unit_id, l.author_unit_name, l.related_letter_id, l.completion_note,
  l.outgoing_no, l.published_on::text AS published_on, l.recipient, l.delivery_method, l.delivery_status,
  l.delivery_note, l.delivered_on::text AS delivered_on, l.archive_code, l.archived_on::text AS archived_on,
  l.cancel_reason, l.shared_folder_id, l.received_by, l.created_at, l.updated_at`;

const STEP_COLUMNS = `s.id, s.seq, s.name, s.approver, s.reject_to, s.due_days, s.status, s.chosen_user_id,
  s.assignee_user_ids::text[] AS assignee_user_ids, s.activated_at, s.acted_by, s.acted_at, s.decision, s.note`;

const ASSIGNMENT_COLUMNS = `a.id, a.letter_id, a.unit_id, a.unit_name, a.round, a.status, a.handler_user_id,
  a.response_note, a.submitted_by, a.submitted_at, a.revision_reason`;

const ATTACHMENT_COLUMNS = `t.id, t.letter_id, t.kind, t.assignment_id, t.shared_document_id, t.shared_version_id,
  t.file_name, t.content_type, t.size_bytes, t.version_no, t.uploaded_by, t.created_at`;

const COMMENT_COLUMNS = `m.id, m.stage, m.step_name, m.body, m.mentioned_user_ids::text[] AS mentioned_user_ids,
  m.author_id, m.created_at`;

const CATALOG_COLUMNS = `c.id, c.kind, c.code, c.name, c.sort_order, c.is_active, c.default_due_days, c.workflow_id,
  c.outgoing_workflow_id, c.default_unit_ids::text[] AS default_unit_ids, c.highlight, c.restricted,
  EXISTS (SELECT 1 FROM correspondence_schema.letters u
           WHERE (c.kind = 'letter_type' AND u.kind = c.code)
              OR (c.kind = 'urgency' AND u.urgency = c.code)
              OR (c.kind = 'confidentiality' AND u.confidentiality = c.code)) AS in_use`;

const WORKFLOW_COLUMNS = `id, name, description, direction, is_active, is_default, steps, updated_at`;

/** Cột được phép ghi qua `update`, theo tên trường của `LetterPatch`. */
const PATCH_COLUMNS: Readonly<Record<keyof LetterPatch, string>> = {
  receivedOn: 'received_on',
  senderOrg: 'sender_org',
  senderRef: 'sender_ref',
  senderDate: 'sender_date',
  subject: 'subject',
  kind: 'kind',
  urgency: 'urgency',
  confidentiality: 'confidentiality',
  dueOn: 'due_on',
  stage: 'stage',
  workflowId: 'workflow_id',
  workflowName: 'workflow_name',
  instruction: 'instruction',
  authorUserId: 'author_user_id',
  authorUnitId: 'author_unit_id',
  authorUnitName: 'author_unit_name',
  relatedLetterId: 'related_letter_id',
  completionNote: 'completion_note',
  outgoingNo: 'outgoing_no',
  publishedOn: 'published_on',
  recipient: 'recipient',
  deliveryMethod: 'delivery_method',
  deliveryStatus: 'delivery_status',
  deliveryNote: 'delivery_note',
  deliveredOn: 'delivered_on',
  archiveCode: 'archive_code',
  archivedOn: 'archived_on',
  cancelReason: 'cancel_reason',
  sharedFolderId: 'shared_folder_id',
};

type Row = Record<string, unknown>;

export class PostgresCorrespondenceStore implements CorrespondenceStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  private poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  /** Bảng chưa có (`42P01`, `3F000`) hay cột chưa có (`42703`) nghĩa là migration chưa chạy xong cho tenant này. */
  private async run<T>(tenantId: string, operation: (pool: Pool) => Promise<T>): Promise<T> {
    const pool = await this.poolFor(tenantId);
    try {
      return await operation(pool);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === '42P01' || code === '3F000' || code === '42703') throw new CorrespondenceNotProvisionedError();
      throw error;
    }
  }

  async tablesReady(tenantId: string): Promise<boolean> {
    const pool = await this.poolFor(tenantId);
    const result = await pool.query<{ ready: boolean }>(
      `SELECT to_regclass('correspondence_schema.letter_steps') IS NOT NULL
          AND to_regclass('correspondence_schema.catalog_items') IS NOT NULL
          AND to_regclass('correspondence_schema.comments') IS NOT NULL AS ready`,
    );
    return Boolean(result.rows[0]?.ready);
  }

  settings(tenantId: string): Promise<CorrespondenceSettings> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<{ value: Partial<CorrespondenceSettings> }>(
        `SELECT value FROM correspondence_schema.settings WHERE key = $1`,
        [SETTINGS_KEY],
      );
      return { ...DEFAULT_CORRESPONDENCE_SETTINGS, ...(result.rows[0]?.value ?? {}) };
    });
  }

  saveSettings(tenantId: string, userId: string, settings: CorrespondenceSettings): Promise<void> {
    return this.run(tenantId, async (pool) => {
      await pool.query(
        `INSERT INTO correspondence_schema.settings (key, value, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [SETTINGS_KEY, JSON.stringify(settings), userId],
      );
    });
  }

  /* -------------------------------------------------------------- danh mục */

  catalog(tenantId: string): Promise<CatalogItem[]> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<Row>(
        `SELECT ${CATALOG_COLUMNS} FROM correspondence_schema.catalog_items c ORDER BY c.kind, c.sort_order, c.name`,
      );
      return result.rows.map(mapCatalog);
    });
  }

  saveCatalogItem(tenantId: string, userId: string, id: string | undefined, input: CatalogUpsert): Promise<CatalogItem> {
    return this.run(tenantId, async (pool) => {
      const params = [
        input.kind,
        input.code,
        input.name,
        input.sortOrder,
        input.isActive,
        input.defaultDueDays,
        input.workflowId,
        input.outgoingWorkflowId,
        input.defaultUnitIds,
        input.highlight,
        input.restricted,
        userId,
      ];
      try {
        const result = id
          ? await pool.query<Row>(
              `UPDATE correspondence_schema.catalog_items AS c
                  SET kind = $1, code = $2, name = $3, sort_order = $4, is_active = $5, default_due_days = $6,
                      workflow_id = $7, outgoing_workflow_id = $8, default_unit_ids = $9::uuid[], highlight = $10,
                      restricted = $11, updated_by = $12, updated_at = now()
                WHERE c.id = $13
                RETURNING ${CATALOG_COLUMNS}`,
              [...params, id],
            )
          : await pool.query<Row>(
              `INSERT INTO correspondence_schema.catalog_items AS c
                      (kind, code, name, sort_order, is_active, default_due_days, workflow_id, outgoing_workflow_id,
                       default_unit_ids, highlight, restricted, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], $10, $11, $12)
               RETURNING ${CATALOG_COLUMNS}`,
              params,
            );
        return mapCatalog(first(result.rows));
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code === '23505') throw new CorrespondenceValidationError(`Mã "${input.code}" đã có trong danh mục này.`);
        if (code === '22P02') throw new CorrespondenceValidationError('Phòng ban gợi ý không hợp lệ.');
        throw error;
      }
    });
  }

  deleteCatalogItem(tenantId: string, id: string): Promise<boolean> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query(
        `DELETE FROM correspondence_schema.catalog_items c
          WHERE c.id = $1
            AND NOT EXISTS (SELECT 1 FROM correspondence_schema.letters u
                             WHERE (c.kind = 'letter_type' AND u.kind = c.code)
                                OR (c.kind = 'urgency' AND u.urgency = c.code)
                                OR (c.kind = 'confidentiality' AND u.confidentiality = c.code))`,
        [id],
      );
      return (result.rowCount ?? 0) > 0;
    }).catch((error: unknown) => {
      if ((error as { code?: string } | null)?.code === '22P02') return false;
      throw error;
    });
  }

  /* ------------------------------------------------------------- quy trình */

  workflows(tenantId: string): Promise<Workflow[]> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<Row>(
        `SELECT ${WORKFLOW_COLUMNS} FROM correspondence_schema.workflows ORDER BY direction, is_default DESC, name`,
      );
      return result.rows.map(mapWorkflow);
    });
  }

  saveWorkflow(tenantId: string, userId: string, id: string | undefined, input: WorkflowUpsert): Promise<Workflow> {
    return this.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        if (input.isDefault) {
          await client.query(
            `UPDATE correspondence_schema.workflows SET is_default = false
              WHERE is_default AND direction = $1 AND id IS DISTINCT FROM $2`,
            [input.direction, id ?? null],
          );
        }
        const params = [input.name, input.description, input.isActive, input.isDefault, JSON.stringify(input.steps), userId, input.direction];
        const result = id
          ? await client.query<Row>(
              `UPDATE correspondence_schema.workflows
                  SET name = $1, description = $2, is_active = $3, is_default = $4, steps = $5::jsonb,
                      updated_by = $6, direction = $7, updated_at = now()
                WHERE id = $8
                RETURNING ${WORKFLOW_COLUMNS}`,
              [...params, id],
            )
          : await client.query<Row>(
              `INSERT INTO correspondence_schema.workflows (name, description, is_active, is_default, steps, updated_by, direction)
               VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
               RETURNING ${WORKFLOW_COLUMNS}`,
              params,
            );
        return mapWorkflow(first(result.rows));
      }),
    );
  }

  deleteWorkflow(tenantId: string, id: string): Promise<boolean> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query(
        `DELETE FROM correspondence_schema.workflows w
          WHERE w.id = $1 AND NOT w.is_default
            AND NOT EXISTS (SELECT 1 FROM correspondence_schema.letters l WHERE l.workflow_id = w.id)
            AND NOT EXISTS (SELECT 1 FROM correspondence_schema.catalog_items c
                             WHERE c.workflow_id = w.id OR c.outgoing_workflow_id = w.id)`,
        [id],
      );
      return (result.rowCount ?? 0) > 0;
    }).catch((error: unknown) => {
      if ((error as { code?: string } | null)?.code === '22P02') return false;
      throw error;
    });
  }

  /* -------------------------------------------------------------- công văn */

  createLetter(
    tenantId: string,
    input: LetterInsert,
    numbering: { readonly counter: 'incoming' | 'draft'; readonly suffix: string },
    after: (tx: LetterTransaction) => Promise<void>,
  ): Promise<LetterRecord> {
    return this.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        const year = Number(input.receivedOn.slice(0, 4));
        const seq = await nextCounter(client, numbering.counter, year);
        const result = await client.query<Row>(
          `INSERT INTO correspondence_schema.letters AS l
                  (direction, stage, year, seq, incoming_no, received_on, sender_org, sender_ref, sender_date, subject,
                   kind, urgency, confidentiality, due_on, author_user_id, author_unit_id, author_unit_name,
                   related_letter_id, recipient, received_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
           RETURNING ${LETTER_COLUMNS}`,
          [
            input.direction,
            input.stage,
            year,
            seq,
            formatSequenceNo(seq, numbering.suffix),
            input.receivedOn,
            input.senderOrg,
            input.senderRef ?? null,
            input.senderDate ?? null,
            input.subject,
            input.kind,
            input.urgency,
            input.confidentiality,
            input.dueOn ?? null,
            input.authorUserId ?? null,
            input.authorUnitId ?? null,
            input.authorUnitName ?? null,
            input.relatedLetterId ?? null,
            input.recipient ?? null,
            input.receivedBy,
          ],
        );
        const letter = mapLetter(first(result.rows));
        const tx = new PostgresLetterTransaction(client, tenantId, letter);
        await after(tx);
        return tx.letter;
      }),
    );
  }

  withLetter<T>(tenantId: string, letterId: string, work: (tx: LetterTransaction) => Promise<T>): Promise<T> {
    return this.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        const locked = await client.query<Row>(
          `SELECT ${LETTER_COLUMNS} FROM correspondence_schema.letters l WHERE l.id = $1 FOR UPDATE`,
          [letterId],
        );
        if (!locked.rows[0]) throw new LetterNotFoundError();
        const tx = new PostgresLetterTransaction(client, tenantId, mapLetter(locked.rows[0]));
        await tx.reload();
        return work(tx);
      }),
    ).catch((error: unknown) => {
      if ((error as { code?: string } | null)?.code === '22P02') throw new LetterNotFoundError();
      throw error;
    });
  }

  findLetter(tenantId: string, letterId: string): Promise<LetterRecord | undefined> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<Row>(`SELECT ${LETTER_COLUMNS} FROM correspondence_schema.letters l WHERE l.id = $1`, [
        letterId,
      ]);
      return result.rows[0] ? mapLetter(result.rows[0]) : undefined;
    }).catch(notFoundOnBadId);
  }

  listLetters(tenantId: string, filter: LetterListFilter): Promise<LetterListRow[]> {
    return this.run(tenantId, async (pool) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const param = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };
      if (filter.visibleTo) where.push(visibilityClause(filter.visibleTo, param));
      if (filter.direction) where.push(`l.direction = ${param(filter.direction)}`);
      if (filter.stages?.length) where.push(`l.stage = ANY(${param(filter.stages)}::text[])`);
      if (filter.year) where.push(`l.year = ${param(filter.year)}`);
      if (filter.search) {
        const pattern = param(`%${escapeLike(filter.search)}%`);
        where.push(`(l.incoming_no ILIKE ${pattern} OR l.subject ILIKE ${pattern} OR l.sender_org ILIKE ${pattern}
                      OR l.sender_ref ILIKE ${pattern} OR l.outgoing_no ILIKE ${pattern} OR l.archive_code ILIKE ${pattern}
                      OR l.recipient ILIKE ${pattern} OR l.author_unit_name ILIKE ${pattern})`);
      }
      const result = await pool.query<Row & { assignments: Row[] | null; steps: Row[] | null; mentioned: string[] | null }>(
        `SELECT ${LETTER_COLUMNS},
                (SELECT json_agg(json_build_object('unitId', a.unit_id, 'unitName', a.unit_name, 'status', a.status,
                                                   'submittedBy', a.submitted_by, 'submittedAt', a.submitted_at,
                                                   'handlerUserId', a.handler_user_id)
                                 ORDER BY a.created_at, a.unit_name)
                   FROM correspondence_schema.assignments a WHERE a.letter_id = l.id) AS assignments,
                (SELECT json_agg(json_build_object('seq', s.seq, 'name', s.name, 'status', s.status, 'rejectTo', s.reject_to,
                                                   'assigneeUserIds', s.assignee_user_ids, 'actedBy', s.acted_by)
                                 ORDER BY s.seq)
                   FROM correspondence_schema.letter_steps s WHERE s.letter_id = l.id) AS steps,
                (SELECT array_agg(DISTINCT mentioned)::text[]
                   FROM correspondence_schema.comments cm, unnest(cm.mentioned_user_ids) AS mentioned
                  WHERE cm.letter_id = l.id) AS mentioned
           FROM correspondence_schema.letters l
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY l.received_on DESC, l.created_at DESC
          LIMIT ${param(filter.limit)}`,
        params,
      );
      return result.rows.map((row) => ({
        ...mapLetter(row),
        assignments: (row.assignments ?? []).map((item) => ({
          unitId: String(item['unitId']),
          unitName: String(item['unitName']),
          status: item['status'] === 'submitted' ? ('submitted' as const) : ('pending' as const),
          submittedBy: optional(item['submittedBy']),
          submittedAt: optional(item['submittedAt']),
          handlerUserId: optional(item['handlerUserId']),
        })),
        steps: (row.steps ?? []).map((item) => ({
          seq: Number(item['seq']),
          name: String(item['name']),
          status: String(item['status']) as StepRecord['status'],
          rejectTo: returnTarget(item['rejectTo']),
          assigneeUserIds: Array.isArray(item['assigneeUserIds']) ? (item['assigneeUserIds'] as unknown[]).map(String) : [],
          actedBy: optional(item['actedBy']),
        })),
        mentionedUserIds: (row.mentioned ?? []).map(String),
      }));
    });
  }

  countArchived(tenantId: string, visibleTo?: LetterListFilter['visibleTo']): Promise<number> {
    return this.run(tenantId, async (pool) => {
      const params: unknown[] = [];
      const param = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };
      const visibility = visibleTo ? ` AND ${visibilityClause(visibleTo, param)}` : '';
      const result = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM correspondence_schema.letters l WHERE l.stage = 'archived'${visibility}`,
        params,
      );
      return Number(result.rows[0]?.count ?? 0);
    });
  }

  steps(tenantId: string, letterId: string): Promise<StepRecord[]> {
    return this.run(tenantId, async (pool) => loadSteps(pool, letterId)).catch(emptyOnBadId);
  }

  assignments(tenantId: string, letterId: string): Promise<AssignmentRecord[]> {
    return this.run(tenantId, async (pool) => loadAssignments(pool, letterId)).catch(emptyOnBadId);
  }

  attachments(tenantId: string, letterId: string): Promise<AttachmentRecord[]> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<Row>(
        `SELECT ${ATTACHMENT_COLUMNS} FROM correspondence_schema.attachments t WHERE t.letter_id = $1 ORDER BY t.created_at`,
        [letterId],
      );
      return result.rows.map(mapAttachment);
    }).catch(emptyOnBadId);
  }

  findAttachment(tenantId: string, attachmentId: string): Promise<AttachmentRecord | undefined> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<Row>(`SELECT ${ATTACHMENT_COLUMNS} FROM correspondence_schema.attachments t WHERE t.id = $1`, [
        attachmentId,
      ]);
      return result.rows[0] ? mapAttachment(result.rows[0]) : undefined;
    }).catch(notFoundOnBadId);
  }

  attachmentsOf(tenantId: string, letterIds: readonly string[]): Promise<(AttachmentRecord & { readonly unitName?: string })[]> {
    if (letterIds.length === 0) return Promise.resolve([]);
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<Row>(
        `SELECT ${ATTACHMENT_COLUMNS}, a.unit_name AS assignment_unit_name
           FROM correspondence_schema.attachments t
           LEFT JOIN correspondence_schema.assignments a ON a.id = t.assignment_id
          WHERE t.letter_id = ANY($1::uuid[]) ORDER BY t.letter_id, t.created_at`,
        [letterIds],
      );
      return result.rows.map((row) => ({ ...mapAttachment(row), unitName: optional(row['assignment_unit_name']) }));
    });
  }

  completeAttachment(tenantId: string, attachmentId: string, sizeBytes: number): Promise<void> {
    return this.run(tenantId, async (pool) => {
      await pool.query(`UPDATE correspondence_schema.attachments SET size_bytes = $2 WHERE id = $1`, [attachmentId, sizeBytes]);
    });
  }

  comments(tenantId: string, letterId: string): Promise<CommentRecord[]> {
    return this.run(tenantId, async (pool) => loadComments(pool, letterId)).catch(emptyOnBadId);
  }

  history(tenantId: string, letterId: string): Promise<HistoryRecord[]> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<Row>(
        `SELECT id, action, summary, note, actor_user_id, created_at
           FROM correspondence_schema.history WHERE letter_id = $1 ORDER BY created_at, id`,
        [letterId],
      );
      return result.rows.map((row) => ({
        id: String(row['id']),
        action: String(row['action']) as LetterHistoryAction,
        summary: String(row['summary']),
        note: optional(row['note']),
        actorUserId: optional(row['actor_user_id']),
        at: iso(row['created_at']),
      }));
    }).catch(emptyOnBadId);
  }

  async userNames(tenantId: string, userIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return new Map();
    const pool = await this.poolFor(tenantId);
    const result = await pool.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM core_schema.users WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(result.rows.map((row) => [row.id, row.full_name]));
  }

  async people(tenantId: string): Promise<{ userId: string; name: string }[]> {
    const pool = await this.poolFor(tenantId);
    const result = await pool.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM core_schema.users WHERE status = 'active' AND is_active = true ORDER BY full_name`,
    );
    return result.rows.map((row) => ({ userId: row.id, name: row.full_name }));
  }

  /**
   * Người giữ quyền lãnh đạo, cấp đích danh qua vai trò hoặc quyền bổ sung. Cố ý không gồm
   * quản trị tenant: họ có mọi quyền nhưng không phải ai cũng là lãnh đạo duyệt công văn.
   */
  async leaders(tenantId: string): Promise<{ userId: string; name: string }[]> {
    const pool = await this.poolFor(tenantId);
    const result = await pool.query<{ id: string; full_name: string }>(
      `SELECT users.id, users.full_name
         FROM core_schema.users users
        WHERE users.status = 'active' AND users.is_active = true
          AND (
            EXISTS (
              SELECT 1
                FROM core_schema.user_roles user_roles
                JOIN core_schema.role_permissions role_permissions ON role_permissions.role_id = user_roles.role_id
                JOIN core_schema.permission_actions permission_actions
                  ON permission_actions.permission_id = role_permissions.permission_id
               WHERE user_roles.user_id = users.id AND permission_actions.action_key = $1
            )
            OR EXISTS (
              SELECT 1 FROM core_schema.user_permission_grants grants
               WHERE grants.user_id = users.id AND grants.action_key = $1
            )
          )
        ORDER BY users.full_name`,
      ['correspondence.letter.direct'],
    );
    return result.rows.map((row) => ({ userId: row.id, name: row.full_name }));
  }
}

/**
 * Một lượt ghi trên công văn đã khoá; mọi câu lệnh dùng chung `client` của transaction. Công
 * văn, bước, phòng ban và người được nhắc tên luôn là bản mới nhất sau mỗi lần ghi.
 */
class PostgresLetterTransaction implements LetterTransaction {
  /** Số vừa cấp trong lượt này theo bộ đếm. */
  private readonly issued = new Map<'outgoing' | 'archive', { year: number; seq: number }>();
  steps: StepRecord[] = [];
  assignments: AssignmentRecord[] = [];
  mentionedUserIds: string[] = [];

  constructor(
    private readonly client: PoolClient,
    private readonly tenantId: string,
    public letter: LetterRecord,
  ) {}

  async reload(): Promise<void> {
    this.steps = await loadSteps(this.client, this.letter.id);
    this.assignments = await loadAssignments(this.client, this.letter.id);
    this.mentionedUserIds = [...new Set((await loadComments(this.client, this.letter.id)).flatMap((item) => item.mentionedUserIds))];
  }

  async update(patch: LetterPatch): Promise<LetterRecord> {
    const sets: string[] = [];
    const params: unknown[] = [this.letter.id];
    for (const [key, value] of Object.entries(patch) as [keyof LetterPatch, unknown][]) {
      const column = PATCH_COLUMNS[key];
      if (!column) continue;
      params.push(value ?? null);
      sets.push(`${column} = $${params.length}`);
    }
    // Số đi, số hồ sơ ghi kèm năm và số thứ tự vừa cấp ở `nextNumber`, để ràng buộc duy nhất giữ được.
    for (const [kind, field] of [['outgoing', 'outgoingNo'], ['archive', 'archiveCode']] as const) {
      if (patch[field] === undefined) continue;
      const issued = this.issued.get(kind);
      params.push(issued?.year ?? null, issued?.seq ?? null);
      sets.push(`${kind}_year = $${params.length - 1}`, `${kind}_seq = $${params.length}`);
    }
    const result = await this.client.query<Row>(
      `UPDATE correspondence_schema.letters AS l SET ${[...sets, 'updated_at = now()'].join(', ')}
        WHERE l.id = $1 RETURNING ${LETTER_COLUMNS}`,
      params,
    );
    this.letter = mapLetter(first(result.rows));
    return this.letter;
  }

  async nextNumber(kind: 'outgoing' | 'archive', year: number): Promise<number> {
    const seq = await nextCounter(this.client, kind, year);
    this.issued.set(kind, { year, seq });
    return seq;
  }

  async replaceSteps(steps: readonly WorkflowStep[]): Promise<void> {
    await this.client.query(`DELETE FROM correspondence_schema.letter_steps WHERE letter_id = $1`, [this.letter.id]);
    for (const [index, step] of steps.entries()) {
      // Cột `kind` của luồng cũ vẫn bắt buộc: mọi bước bây giờ là bước duyệt.
      await this.client.query(
        `INSERT INTO correspondence_schema.letter_steps (letter_id, seq, name, kind, approver, reject_to, due_days)
         VALUES ($1, $2, $3, 'approve', $4::jsonb, $5, $6)`,
        [this.letter.id, index + 1, step.name, JSON.stringify(step.approver), step.rejectTo ?? null, step.dueDays ?? null],
      );
    }
    this.steps = await loadSteps(this.client, this.letter.id);
  }

  async updateStep(stepId: string, update: StepUpdate): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [stepId, this.letter.id];
    const set = (column: string, value: unknown, cast = '') => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };
    if (update.status !== undefined) set('status', update.status);
    if (update.chosenUserId !== undefined) set('chosen_user_id', update.chosenUserId);
    if (update.assigneeUserIds !== undefined) set('assignee_user_ids', update.assigneeUserIds, '::uuid[]');
    if (update.activate) sets.push('activated_at = now()');
    if (update.actedBy !== undefined) {
      set('acted_by', update.actedBy);
      sets.push(update.actedBy ? 'acted_at = now()' : 'acted_at = NULL');
    }
    if (update.decision !== undefined) set('decision', update.decision);
    if (update.note !== undefined) set('note', update.note);
    if (sets.length === 0) return;
    await this.client.query(
      `UPDATE correspondence_schema.letter_steps SET ${sets.join(', ')} WHERE id = $1 AND letter_id = $2`,
      params,
    );
    this.steps = await loadSteps(this.client, this.letter.id);
  }

  async assign(units: readonly { readonly unitId: string; readonly unitName: string; readonly handlerUserId?: string }[]): Promise<void> {
    for (const unit of units) {
      await this.client.query(
        `INSERT INTO correspondence_schema.assignments AS a (letter_id, unit_id, unit_name, handler_user_id, handler_assigned_at)
         VALUES ($1, $2, $3, $4::uuid, CASE WHEN $4::uuid IS NULL THEN NULL ELSE now() END)
         ON CONFLICT (letter_id, unit_id) DO UPDATE
            SET unit_name = EXCLUDED.unit_name,
                status = 'pending',
                round = CASE WHEN a.status = 'submitted' THEN a.round + 1 ELSE a.round END,
                submitted_at = NULL,
                handler_user_id = EXCLUDED.handler_user_id,
                handler_assigned_at = EXCLUDED.handler_assigned_at`,
        [this.letter.id, unit.unitId, unit.unitName, unit.handlerUserId ?? null],
      );
    }
    this.assignments = await loadAssignments(this.client, this.letter.id);
  }

  async removeAssignments(assignmentIds: readonly string[]): Promise<void> {
    if (assignmentIds.length === 0) return;
    await this.client.query(`DELETE FROM correspondence_schema.assignments WHERE letter_id = $1 AND id = ANY($2::uuid[])`, [
      this.letter.id,
      assignmentIds,
    ]);
    this.assignments = await loadAssignments(this.client, this.letter.id);
  }

  async setHandler(assignmentId: string, handlerUserId: string | null): Promise<void> {
    await this.client.query(
      `UPDATE correspondence_schema.assignments
          SET handler_user_id = $3::uuid, handler_assigned_at = CASE WHEN $3::uuid IS NULL THEN NULL ELSE now() END
        WHERE id = $1 AND letter_id = $2`,
      [assignmentId, this.letter.id, handlerUserId],
    );
    this.assignments = await loadAssignments(this.client, this.letter.id);
  }

  async submitAssignment(assignmentId: string, input: { readonly note: string; readonly userId: string }): Promise<void> {
    await this.client.query(
      `UPDATE correspondence_schema.assignments
          SET status = 'submitted', response_note = $2, submitted_by = $3, submitted_at = now()
        WHERE id = $1 AND letter_id = $4`,
      [assignmentId, input.note, input.userId, this.letter.id],
    );
    this.assignments = await loadAssignments(this.client, this.letter.id);
  }

  async reopenAssignments(assignmentIds: readonly string[], reason: string): Promise<void> {
    await this.client.query(
      `UPDATE correspondence_schema.assignments
          SET status = 'pending', round = round + 1, revision_reason = $2, submitted_at = NULL
        WHERE letter_id = $3 AND id = ANY($1::uuid[])`,
      [assignmentIds, reason, this.letter.id],
    );
    this.assignments = await loadAssignments(this.client, this.letter.id);
  }

  async addAttachment(
    input: Omit<AttachmentRecord, 'id' | 'letterId' | 'createdAt' | 'sizeBytes' | 'versionNo'>,
  ): Promise<AttachmentRecord> {
    const result = await this.client.query<Row>(
      `INSERT INTO correspondence_schema.attachments AS t
              (letter_id, kind, assignment_id, shared_document_id, shared_version_id, file_name, content_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${ATTACHMENT_COLUMNS}`,
      [
        this.letter.id,
        input.kind,
        input.assignmentId ?? null,
        input.sharedDocumentId,
        input.sharedVersionId,
        input.fileName,
        input.contentType,
        input.uploadedBy,
      ],
    );
    return mapAttachment(first(result.rows));
  }

  async setAttachmentVersion(
    attachmentId: string,
    input: {
      readonly sharedVersionId: string;
      readonly versionNo: number;
      readonly fileName: string;
      readonly contentType: string;
      readonly uploadedBy: string;
    },
  ): Promise<void> {
    await this.client.query(
      `UPDATE correspondence_schema.attachments
          SET shared_version_id = $3, version_no = $4, file_name = $5, content_type = $6, uploaded_by = $7, size_bytes = NULL
        WHERE id = $1 AND letter_id = $2`,
      [attachmentId, this.letter.id, input.sharedVersionId, input.versionNo, input.fileName, input.contentType, input.uploadedBy],
    );
  }

  async removeAttachment(attachmentId: string): Promise<void> {
    await this.client.query(`DELETE FROM correspondence_schema.attachments WHERE id = $1 AND letter_id = $2`, [
      attachmentId,
      this.letter.id,
    ]);
  }

  async addComment(input: Omit<CommentRecord, 'id' | 'at'>): Promise<CommentRecord> {
    const result = await this.client.query<Row>(
      `INSERT INTO correspondence_schema.comments AS m (letter_id, stage, step_name, body, mentioned_user_ids, author_id)
       VALUES ($1, $2, $3, $4, $5::uuid[], $6)
       RETURNING ${COMMENT_COLUMNS}`,
      [this.letter.id, input.stage, input.stepName ?? null, input.body, input.mentionedUserIds, input.authorId],
    );
    this.mentionedUserIds = [...new Set([...this.mentionedUserIds, ...input.mentionedUserIds])];
    return mapComment(first(result.rows));
  }

  async history(entry: HistoryInsert): Promise<void> {
    await this.client.query(
      `INSERT INTO correspondence_schema.history (letter_id, action, summary, note, actor_user_id) VALUES ($1, $2, $3, $4, $5)`,
      [this.letter.id, entry.action, entry.summary.slice(0, 500), entry.note ?? null, entry.actorUserId ?? null],
    );
  }

  async outbox(input: OutboxEvent): Promise<void> {
    const event = createIntegrationEvent({
      id: randomUUID(),
      type: input.type,
      version: 1,
      tenantId: this.tenantId,
      source: 'correspondence',
      correlationId: this.letter.id,
      payload: input.payload,
    });
    await this.client.query(
      `INSERT INTO integration_schema.outbox_events
         (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [event.id, 'correspondence-letter', this.letter.id, event.type, event.version, JSON.stringify(event), event.occurredAt],
    );
  }
}

/* ---------------------------------------------------------------- hàm phụ */

type Queryable = Pick<Pool | PoolClient, 'query'>;

async function loadSteps(db: Queryable, letterId: string): Promise<StepRecord[]> {
  const result = await db.query<Row>(
    `SELECT ${STEP_COLUMNS} FROM correspondence_schema.letter_steps s WHERE s.letter_id = $1 ORDER BY s.seq`,
    [letterId],
  );
  return result.rows.map(mapStep);
}

async function loadAssignments(db: Queryable, letterId: string): Promise<AssignmentRecord[]> {
  const result = await db.query<Row>(
    `SELECT ${ASSIGNMENT_COLUMNS} FROM correspondence_schema.assignments a WHERE a.letter_id = $1 ORDER BY a.created_at, a.unit_name`,
    [letterId],
  );
  return result.rows.map(mapAssignment);
}

async function loadComments(db: Queryable, letterId: string): Promise<CommentRecord[]> {
  const result = await db.query<Row>(
    `SELECT ${COMMENT_COLUMNS} FROM correspondence_schema.comments m WHERE m.letter_id = $1 ORDER BY m.created_at, m.id`,
    [letterId],
  );
  return result.rows.map(mapComment);
}

async function nextCounter(client: Queryable, kind: 'incoming' | 'draft' | 'outgoing' | 'archive', year: number): Promise<number> {
  const result = await client.query<{ value: number }>(
    `INSERT INTO correspondence_schema.counters (kind, year, value) VALUES ($1, $2, 1)
     ON CONFLICT (kind, year) DO UPDATE SET value = correspondence_schema.counters.value + 1
     RETURNING value`,
    [kind, year],
  );
  return Number(first(result.rows).value);
}

/**
 * Công văn người dùng được thấy: liên quan (tiếp nhận, soạn hay cùng phòng soạn, được giao hay
 * đã làm một bước, thuộc phòng ban được giao, được phân công, từng gửi kết quả, được nhắc tên),
 * hoặc được xem mọi công văn theo độ mật. Cùng luật với `canViewLetter`.
 */
function visibilityClause(
  visibleTo: NonNullable<LetterListFilter['visibleTo']>,
  param: (value: unknown) => string,
): string {
  const user = param(visibleTo.userId);
  const units = param(visibleTo.unitIds);
  const readAll = param(visibleTo.readAll);
  const readConfidential = param(visibleTo.readConfidential);
  const restricted = `EXISTS (SELECT 1 FROM correspondence_schema.catalog_items k
                               WHERE k.kind = 'confidentiality' AND k.code = l.confidentiality AND k.restricted)`;
  return `(l.received_by = ${user}::uuid
           OR l.author_user_id = ${user}::uuid
           OR l.author_unit_id::text = ANY(${units}::text[])
           OR EXISTS (SELECT 1 FROM correspondence_schema.letter_steps vs
                       WHERE vs.letter_id = l.id
                         AND (vs.acted_by = ${user}::uuid
                              OR (vs.status <> 'waiting' AND ${user}::uuid = ANY(vs.assignee_user_ids))))
           OR EXISTS (SELECT 1 FROM correspondence_schema.assignments v
                       WHERE v.letter_id = l.id
                         AND (v.unit_id::text = ANY(${units}::text[]) OR v.submitted_by = ${user}::uuid
                              OR v.handler_user_id = ${user}::uuid))
           OR EXISTS (SELECT 1 FROM correspondence_schema.comments vc
                       WHERE vc.letter_id = l.id AND ${user}::uuid = ANY(vc.mentioned_user_ids))
           OR (${readAll}::boolean AND NOT ${restricted})
           OR (${readConfidential}::boolean AND ${restricted}))`;
}

function first<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw new Error('Câu lệnh ghi không trả về dòng nào.');
  return row;
}

function optional(value: unknown): string | undefined {
  return value === null || value === undefined || value === '' ? undefined : String(value);
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function returnTarget(value: unknown): ReturnTarget | undefined {
  return (RETURN_TARGETS as readonly unknown[]).includes(value) ? (value as ReturnTarget) : undefined;
}

function notFoundOnBadId(error: unknown): undefined {
  if ((error as { code?: string } | null)?.code === '22P02') return undefined;
  throw error;
}

function emptyOnBadId(error: unknown): never[] {
  if ((error as { code?: string } | null)?.code === '22P02') return [];
  throw error;
}

function mapCatalog(row: Row): CatalogItem {
  const kind = String(row['kind']) as CatalogKind;
  return {
    id: String(row['id']),
    kind,
    code: String(row['code']),
    name: String(row['name']),
    sortOrder: Number(row['sort_order']),
    isActive: Boolean(row['is_active']),
    ...(kind === 'letter_type'
      ? {
          defaultDueDays: row['default_due_days'] === null ? undefined : Number(row['default_due_days']),
          workflowId: optional(row['workflow_id']),
          outgoingWorkflowId: optional(row['outgoing_workflow_id']),
          defaultUnitIds: Array.isArray(row['default_unit_ids']) ? (row['default_unit_ids'] as unknown[]).map(String) : [],
        }
      : {}),
    ...(kind === 'urgency' ? { highlight: Boolean(row['highlight']) } : {}),
    ...(kind === 'confidentiality' ? { restricted: Boolean(row['restricted']) } : {}),
    inUse: Boolean(row['in_use']),
  };
}

/** Bước đọc từ JSON chỉ giữ các trường của bước duyệt (bỏ `kind` của luồng cũ). */
function mapWorkflowStep(raw: Row, index: number): WorkflowStep {
  const rejectTo = returnTarget(raw['rejectTo']);
  const dueDays = raw['dueDays'] === undefined || raw['dueDays'] === null ? undefined : Number(raw['dueDays']);
  return {
    key: String(raw['key'] ?? `step-${index + 1}`),
    name: String(raw['name'] ?? `Bước ${index + 1}`),
    approver: raw['approver'] as ApproverRule,
    ...(rejectTo ? { rejectTo } : {}),
    ...(dueDays !== undefined && Number.isFinite(dueDays) ? { dueDays } : {}),
  };
}

function mapWorkflow(row: Row): Workflow {
  return {
    id: String(row['id']),
    name: String(row['name']),
    description: optional(row['description']),
    direction: row['direction'] === 'outgoing' ? 'outgoing' : 'incoming',
    isActive: Boolean(row['is_active']),
    isDefault: Boolean(row['is_default']),
    steps: Array.isArray(row['steps']) ? (row['steps'] as Row[]).map(mapWorkflowStep) : [],
    updatedAt: iso(row['updated_at']),
  };
}

function mapStep(row: Row): StepRecord {
  return {
    id: String(row['id']),
    seq: Number(row['seq']),
    name: String(row['name']),
    approver: row['approver'] as ApproverRule,
    rejectTo: returnTarget(row['reject_to']),
    dueDays: row['due_days'] === null || row['due_days'] === undefined ? undefined : Number(row['due_days']),
    status: String(row['status']) as StepRecord['status'],
    chosenUserId: optional(row['chosen_user_id']),
    assigneeUserIds: Array.isArray(row['assignee_user_ids']) ? (row['assignee_user_ids'] as unknown[]).map(String) : [],
    activatedAt: row['activated_at'] ? iso(row['activated_at']) : undefined,
    actedBy: optional(row['acted_by']),
    actedAt: row['acted_at'] ? iso(row['acted_at']) : undefined,
    // Quyết định của luồng cũ ('directed', 'closed', 'revision') đọc như "đạt" hay "trả lại".
    decision: row['decision'] === 'returned' || row['decision'] === 'revision' ? 'returned' : row['decision'] ? 'approved' : undefined,
    note: optional(row['note']),
  };
}

function mapLetter(row: Row): LetterRecord {
  return {
    id: String(row['id']),
    direction: row['direction'] === 'outgoing' ? 'outgoing' : 'incoming',
    year: Number(row['year']),
    seq: Number(row['seq']),
    incomingNo: String(row['incoming_no']),
    receivedOn: String(row['received_on']),
    senderOrg: String(row['sender_org']),
    senderRef: optional(row['sender_ref']),
    senderDate: optional(row['sender_date']),
    subject: String(row['subject']),
    kind: String(row['kind']),
    urgency: String(row['urgency']),
    confidentiality: String(row['confidentiality']),
    dueOn: optional(row['due_on']),
    stage: String(row['stage']) as LetterStage,
    workflowId: optional(row['workflow_id']),
    workflowName: optional(row['workflow_name']),
    instruction: optional(row['instruction']),
    authorUserId: optional(row['author_user_id']),
    authorUnitId: optional(row['author_unit_id']),
    authorUnitName: optional(row['author_unit_name']),
    relatedLetterId: optional(row['related_letter_id']),
    completionNote: optional(row['completion_note']),
    outgoingNo: optional(row['outgoing_no']),
    publishedOn: optional(row['published_on']),
    recipient: optional(row['recipient']),
    deliveryMethod: optional(row['delivery_method']),
    deliveryStatus: optional(row['delivery_status']) as DeliveryStatus | undefined,
    deliveryNote: optional(row['delivery_note']),
    deliveredOn: optional(row['delivered_on']),
    archiveCode: optional(row['archive_code']),
    archivedOn: optional(row['archived_on']),
    cancelReason: optional(row['cancel_reason']),
    sharedFolderId: optional(row['shared_folder_id']),
    receivedBy: String(row['received_by']),
    createdAt: iso(row['created_at']),
    updatedAt: iso(row['updated_at']),
  };
}

function mapAssignment(row: Row): AssignmentRecord {
  return {
    id: String(row['id']),
    letterId: String(row['letter_id']),
    unitId: String(row['unit_id']),
    unitName: String(row['unit_name']),
    round: Number(row['round']),
    status: row['status'] === 'submitted' ? 'submitted' : 'pending',
    handlerUserId: optional(row['handler_user_id']),
    responseNote: optional(row['response_note']),
    submittedBy: optional(row['submitted_by']),
    submittedAt: row['submitted_at'] ? iso(row['submitted_at']) : undefined,
    revisionReason: optional(row['revision_reason']),
  };
}

function mapAttachment(row: Row): AttachmentRecord {
  return {
    id: String(row['id']),
    letterId: String(row['letter_id']),
    kind: String(row['kind']) as AttachmentRecord['kind'],
    assignmentId: optional(row['assignment_id']),
    sharedDocumentId: String(row['shared_document_id']),
    sharedVersionId: String(row['shared_version_id']),
    fileName: String(row['file_name']),
    contentType: String(row['content_type']),
    sizeBytes: row['size_bytes'] === null || row['size_bytes'] === undefined ? undefined : Number(row['size_bytes']),
    versionNo: Number(row['version_no'] ?? 1),
    uploadedBy: String(row['uploaded_by']),
    createdAt: iso(row['created_at']),
  };
}

function mapComment(row: Row): CommentRecord {
  return {
    id: String(row['id']),
    stage: String(row['stage']) as LetterStage,
    stepName: optional(row['step_name']),
    body: String(row['body']),
    mentionedUserIds: Array.isArray(row['mentioned_user_ids']) ? (row['mentioned_user_ids'] as unknown[]).map(String) : [],
    authorId: String(row['author_id']),
    at: iso(row['created_at']),
  };
}
