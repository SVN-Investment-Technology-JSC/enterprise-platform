import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import type {
  CalendarEvent,
  ChatChannel,
  ChatEntityType,
  ChatMessage,
  CostEntry,
  CreateProjectRequest,
  CreateWorkItemRequest,
  DependencyType,
  DocumentAccessAction,
  DocumentFolder,
  DocumentLink,
  DocumentLinkEntityType,
  DocumentStatus,
  DocumentSummary,
  DocumentVersion,
  EventParticipant,
  EventType,
  ExternalModuleKey,
  ExternalReference,
  MyWorkEvent,
  MyWorkExternalCard,
  MyWorkMention,
  OverdueRow,
  ParticipantResponse,
  Project,
  ProjectMember,
  ProjectProgressRow,
  ProjectRole,
  ProjectStatus,
  UpdateProjectFinanceRequest,
  UpdateProjectRequest,
  UpdateWorkItemCostRequest,
  UpdateWorkItemRequest,
  WorkItem,
  WorkItemCost,
  WorkItemDependency,
  WorkItemStatus,
  WorkItemStatusHistoryEntry,
  WorkloadRow,
  WorkspaceDocument,
} from '@enterprise-platform/contracts-workspace';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { FinanceInputs } from '../domain/finance.rules.js';
import {
  ChatMessageNotFoundError,
  DocumentNotFoundError,
  EventNotFoundError,
  NameConflictError,
  ProjectCodeConflictError,
  ProjectNotFoundError,
  WorkItemNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type {
  EventException,
  EventWriteModel,
  MyWorkAssignedRow,
  ParticipantBusySlot,
  ProjectRollup,
  ReportScopeFilter,
  UnreadRow,
  WorkItemProgressRow,
  WorkspaceSchemaStatus,
  WorkspaceStore,
} from '../application/workspace-store.port.js';

type Row = QueryResultRow & Record<string, unknown>;

const str = (value: unknown) => String(value);
const opt = (value: unknown) => (value == null ? undefined : String(value));
const num = (value: unknown) => Number(value ?? 0);
const optNum = (value: unknown) => (value == null ? undefined : Number(value));
const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
/** Cột `date` của Postgres về client thành Date; chỉ giữ phần ngày. */
const day = (value: unknown) =>
  value == null ? undefined : (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);

const PROJECT_COLUMNS = `id, code, name, description, status, owner_user_id, org_unit_id,
       customer_ref, start_date, end_date, progress_percent, metadata,
       created_by, created_at, updated_at`;

function mapProject(row: Row): Project {
  return {
    id: str(row.id),
    code: str(row.code),
    name: str(row.name),
    description: opt(row.description),
    status: str(row.status) as ProjectStatus,
    ownerUserId: str(row.owner_user_id),
    orgUnitId: opt(row.org_unit_id),
    customerRef: opt(row.customer_ref),
    startDate: day(row.start_date),
    endDate: day(row.end_date),
    progressPercent: num(row.progress_percent),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const WORK_ITEM_COLUMNS = `id, project_id, parent_id, code, title, description, item_type,
       execution_type, status, priority, assignee_user_id, planned_start, planned_end,
       actual_start, actual_end, estimate_hours, progress_percent, sort_order, depth,
       created_by, created_at, updated_at`;

/**
 * Gắn tiền tố bảng cho từng cột của một hằng `*_COLUMNS`.
 *
 * Các hằng này viết nhiều dòng, nên phải tách theo dấu phẩy KÈM mọi khoảng
 * trắng. Tách theo `', '` thì cột đầu mỗi dòng không được gắn tiền tố, và
 * `created_by` — có ở cả `work_items` lẫn `projects` — thành mơ hồ khi JOIN.
 */
export function qualified(columns: string, alias: string): string {
  return columns
    .split(/,\s*/)
    .map((column) => column.trim())
    .filter(Boolean)
    .map((column) => `${alias}.${column}`)
    .join(', ');
}

function mapWorkItem(row: Row): WorkItem {
  return {
    id: str(row.id),
    projectId: str(row.project_id),
    parentId: opt(row.parent_id),
    code: str(row.code),
    title: str(row.title),
    description: opt(row.description),
    itemType: str(row.item_type) as WorkItem['itemType'],
    executionType: str(row.execution_type) as WorkItem['executionType'],
    status: str(row.status) as WorkItemStatus,
    priority: str(row.priority) as WorkItem['priority'],
    assigneeUserId: opt(row.assignee_user_id),
    plannedStart: day(row.planned_start),
    plannedEnd: day(row.planned_end),
    actualStart: day(row.actual_start),
    actualEnd: day(row.actual_end),
    estimateHours: optNum(row.estimate_hours),
    progressPercent: num(row.progress_percent),
    sortOrder: num(row.sort_order),
    depth: num(row.depth),
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapDependency(row: Row): WorkItemDependency {
  return {
    id: str(row.id),
    projectId: str(row.project_id),
    predecessorId: str(row.predecessor_id),
    successorId: str(row.successor_id),
    dependencyType: str(row.dependency_type) as DependencyType,
    lagDays: num(row.lag_days),
    createdAt: iso(row.created_at),
  };
}

function mapHistory(row: Row): WorkItemStatusHistoryEntry {
  return {
    id: str(row.id),
    workItemId: str(row.work_item_id),
    fromStatus: opt(row.from_status) as WorkItemStatus | undefined,
    toStatus: str(row.to_status) as WorkItemStatus,
    note: opt(row.note),
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
  };
}


const EVENT_COLUMNS = `id, series_id, project_id, work_item_id, title, description, location,
       event_type, start_at, end_at, all_day, timezone, recurrence_rule, recurrence_until,
       recurrence_count, org_unit_id, status, organizer_user_id, created_by, created_at, updated_at`;

function mapEvent(row: Row): CalendarEvent {
  return {
    id: str(row.id),
    seriesId: opt(row.series_id),
    projectId: opt(row.project_id),
    workItemId: opt(row.work_item_id),
    title: str(row.title),
    description: opt(row.description),
    location: opt(row.location),
    eventType: str(row.event_type) as EventType,
    startAt: iso(row.start_at),
    endAt: iso(row.end_at),
    allDay: Boolean(row.all_day),
    timezone: str(row.timezone),
    recurrenceRule: opt(row.recurrence_rule),
    recurrenceUntil: row.recurrence_until == null ? undefined : iso(row.recurrence_until),
    recurrenceCount: optNum(row.recurrence_count),
    orgUnitId: opt(row.org_unit_id),
    status: str(row.status) as CalendarEvent['status'],
    organizerUserId: str(row.organizer_user_id),
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapParticipant(row: Row): EventParticipant {
  return {
    id: str(row.id),
    eventId: str(row.event_id),
    userId: str(row.user_id),
    responseStatus: str(row.response_status) as ParticipantResponse,
    isOrganizer: Boolean(row.is_organizer),
    respondedAt: row.responded_at == null ? undefined : iso(row.responded_at),
  };
}

function mapCostEntry(row: Row): CostEntry {
  return {
    id: str(row.id),
    workItemId: str(row.work_item_id),
    projectId: str(row.project_id),
    amount: num(row.amount),
    note: str(row.note),
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    workItemCode: str(row.code),
    workItemTitle: str(row.title),
  };
}

function mapException(row: Row): EventException {
  return {
    id: str(row.id),
    seriesId: str(row.series_id),
    occurrenceDate: day(row.occurrence_date) as string,
    exceptionType: str(row.exception_type) as 'cancelled' | 'moved',
    replacementEventId: opt(row.replacement_event_id),
  };
}


const FOLDER_COLUMNS = `id, project_id, parent_id, name, depth, is_active, created_by, created_at`;

function mapFolder(row: Row): DocumentFolder {
  return {
    id: str(row.id),
    projectId: opt(row.project_id),
    parentId: opt(row.parent_id),
    name: str(row.name),
    depth: num(row.depth),
    isActive: Boolean(row.is_active),
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
  };
}

const DOCUMENT_COLUMNS = `id, folder_id, project_id, name, description, current_version_id,
       status, locked_by_user_id, locked_at, created_by, created_at, updated_at`;

function mapDocument(row: Row): WorkspaceDocument {
  return {
    id: str(row.id),
    folderId: str(row.folder_id),
    projectId: opt(row.project_id),
    name: str(row.name),
    description: opt(row.description),
    currentVersionId: opt(row.current_version_id),
    status: str(row.status) as DocumentStatus,
    lockedByUserId: opt(row.locked_by_user_id),
    lockedAt: row.locked_at == null ? undefined : iso(row.locked_at),
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * Cột `storage_key` CỐ Ý không có mặt.
 *
 * Khoá object không bao giờ được rời khỏi server dưới dạng thô; client chỉ
 * nhận URL đã ký. Chỉ `storageKeyOf` đọc cột đó, và nó trả về một chuỗi trần
 * chứ không phải một `DocumentVersion`.
 */
const VERSION_COLUMNS = `id, document_id, version_no, file_name, content_type, size_bytes,
       checksum, change_note, uploaded_by, created_at`;

function mapVersion(row: Row): DocumentVersion {
  return {
    id: str(row.id),
    documentId: str(row.document_id),
    versionNo: num(row.version_no),
    fileName: str(row.file_name),
    contentType: str(row.content_type),
    // `bigint` của Postgres về client thành chuỗi; `optNum` đổi lại thành số.
    sizeBytes: optNum(row.size_bytes),
    checksum: opt(row.checksum),
    changeNote: opt(row.change_note),
    uploadedBy: str(row.uploaded_by),
    createdAt: iso(row.created_at),
  };
}

function mapLink(row: Row): DocumentLink {
  return {
    id: str(row.id),
    documentId: str(row.document_id),
    entityType: str(row.entity_type) as DocumentLinkEntityType,
    entityId: str(row.entity_id),
    createdAt: iso(row.created_at),
  };
}

const EXTERNAL_REF_COLUMNS = `id, entity_type, entity_id, project_id, module_key, external_id,
       external_code, launch_url, cached_label, cached_status, synced_at, created_at`;

function mapExternalRef(row: Row): ExternalReference {
  return {
    id: str(row.id),
    entityType: str(row.entity_type) as ExternalReference['entityType'],
    entityId: str(row.entity_id),
    projectId: str(row.project_id),
    moduleKey: str(row.module_key) as ExternalModuleKey,
    externalId: str(row.external_id),
    externalCode: opt(row.external_code),
    launchUrl: str(row.launch_url),
    cachedLabel: opt(row.cached_label),
    cachedStatus: opt(row.cached_status),
    syncedAt: row.synced_at == null ? undefined : iso(row.synced_at),
    createdAt: iso(row.created_at),
  };
}
const CHANNEL_COLUMNS = `id, entity_type, entity_id, project_id, last_message_at`;

function mapMyWorkEvent(row: Row): MyWorkEvent {
  return {
    eventId: str(row.id),
    title: str(row.title),
    startAt: iso(row.start_at),
    endAt: iso(row.end_at),
    allDay: Boolean(row.all_day),
    location: opt(row.location),
    responseStatus: str(row.response_status) as ParticipantResponse,
    projectId: opt(row.project_id),
  };
}

function mapChannel(row: Row): ChatChannel {
  return {
    id: str(row.id),
    entityType: str(row.entity_type) as ChatEntityType,
    entityId: str(row.entity_id),
    projectId: str(row.project_id),
    lastMessageAt: row.last_message_at == null ? undefined : iso(row.last_message_at),
  };
}

const MESSAGE_COLUMNS = `id, channel_id, parent_id, body, mentions, attachment_document_id,
       is_edited, is_deleted, created_by, created_at, updated_at`;

function mapMessage(row: Row): ChatMessage {
  return {
    id: str(row.id),
    channelId: str(row.channel_id),
    parentId: opt(row.parent_id),
    body: str(row.body),
    // `uuid[]` của Postgres về client thành mảng JS; phòng trường hợp NULL.
    mentions: Array.isArray(row.mentions) ? row.mentions.map(String) : [],
    attachmentDocumentId: opt(row.attachment_document_id),
    isEdited: Boolean(row.is_edited),
    isDeleted: Boolean(row.is_deleted),
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
/**
 * Dựng mệnh đề SET cho UPDATE từ những trường thật sự được gửi lên.
 *
 * `undefined` nghĩa là không đụng tới cột; `null` nghĩa là xoá giá trị. Phân
 * biệt hai thứ đó là lý do không thể dùng một câu UPDATE cố định.
 */
function buildSet(
  input: Record<string, unknown>,
  columns: Readonly<Record<string, string>>,
  startIndex: number,
): { clause: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const [field, column] of Object.entries(columns)) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value === undefined) continue;
    values.push(value);
    parts.push(`${column} = $${startIndex + values.length - 1}`);
  }
  return { clause: parts.join(', '), values };
}

/**
 * Hiện thực cổng dữ liệu bằng PostgreSQL, truy vấn thô bằng `pg`.
 *
 * Không dùng ORM — đúng như `PostgresInventoryStore`. Connection pool được
 * phân giải theo tenant: `references` giữ thông tin database do guard đăng ký
 * sau access-decision, `pools` là LRU cache pool có giới hạn.
 */
export class PostgresWorkspaceStore implements WorkspaceStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  private poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  readonly diagnostics = {
    schemaStatus: async (tenantId: string): Promise<WorkspaceSchemaStatus> => {
      const pool = await this.poolFor(tenantId);
      // `to_regclass` trả NULL thay vì ném lỗi khi đối tượng chưa tồn tại,
      // nên kiểm tra được cả schema lẫn bảng mà không cần try/catch.
      const result = await pool.query<{ schema_exists: boolean; tables_ready: boolean }>(
        `SELECT EXISTS (
                  SELECT 1 FROM information_schema.schemata WHERE schema_name = 'workspace_schema'
                ) AS schema_exists,
                to_regclass('workspace_schema.projects') IS NOT NULL AS tables_ready`,
      );
      const row = result.rows[0];
      return {
        schemaExists: row?.schema_exists ?? false,
        tablesReady: row?.tables_ready ?? false,
      };
    },
  };

  readonly project = {
    list: async (
      tenantId: string,
      options: {
        userId?: string;
        search?: string;
        status?: ProjectStatus;
        page: number;
        pageSize: number;
      },
    ) => {
      const pool = await this.poolFor(tenantId);
      const where: string[] = [];
      const values: unknown[] = [];

      // userId rỗng = quản trị viên tenant: bỏ hàng rào thành viên.
      if (options.userId) {
        values.push(options.userId);
        where.push(`EXISTS (SELECT 1 FROM workspace_schema.project_members m
                             WHERE m.project_id = p.id AND m.user_id = $${values.length})`);
      }
      if (options.search) {
        values.push(`%${options.search.trim()}%`);
        where.push(`(p.code ILIKE $${values.length} OR p.name ILIKE $${values.length})`);
      }
      if (options.status) {
        values.push(options.status);
        where.push(`p.status = $${values.length}`);
      }
      const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

      const totalResult = await pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM workspace_schema.projects p ${clause}`,
        values,
      );

      // LIMIT và OFFSET đi qua tham số, không nội suy chuỗi: tầng application
      // đã kẹp giá trị, nhưng store không được phụ thuộc vào điều đó.
      const limit = Math.max(Math.trunc(options.pageSize) || 1, 1);
      const offset = (Math.max(Math.trunc(options.page) || 1, 1) - 1) * limit;
      const rows = await pool.query<Row>(
        `SELECT ${PROJECT_COLUMNS} FROM workspace_schema.projects p ${clause}
          ORDER BY p.created_at DESC
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      );
      return { items: rows.rows.map(mapProject), total: Number(totalResult.rows[0]?.total ?? 0) };
    },

    findById: async (tenantId: string, projectId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${PROJECT_COLUMNS} FROM workspace_schema.projects WHERE id = $1`,
        [projectId],
      );
      const row = result.rows[0];
      return row ? mapProject(row) : undefined;
    },

    findByCode: async (tenantId: string, code: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${PROJECT_COLUMNS} FROM workspace_schema.projects WHERE code = $1`,
        [code],
      );
      const row = result.rows[0];
      return row ? mapProject(row) : undefined;
    },

    rollup: async (
      tenantId: string,
      projectIds: readonly string[],
      today: string,
    ): Promise<ProjectRollup[]> => {
      if (projectIds.length === 0) return [];
      const pool = await this.poolFor(tenantId);
      // Đếm bằng SQL thay vì tải cả cây về rồi cộng ở tầng ứng dụng.
      // Việc đóng muộn không tính là quá hạn, nên điều kiện quá hạn gồm cả
      // ràng buộc trạng thái còn mở.
      const result = await pool.query<Row>(
        `SELECT project_id,
                COUNT(*)::text AS total_items,
                COUNT(*) FILTER (WHERE status IN ('done','cancelled'))::text AS closed_items,
                COUNT(*) FILTER (
                  WHERE status NOT IN ('done','cancelled')
                    AND planned_end IS NOT NULL
                    AND planned_end < $2::date
                )::text AS overdue_items
           FROM workspace_schema.work_items
          WHERE project_id = ANY($1::uuid[])
          GROUP BY project_id`,
        [projectIds, today],
      );
      return result.rows.map((row) => ({
        projectId: str(row.project_id),
        totalItems: num(row.total_items),
        closedItems: num(row.closed_items),
        overdueItems: num(row.overdue_items),
      }));
    },

    create: async (tenantId: string, actorUserId: string, input: CreateProjectRequest) => {
      const pool = await this.poolFor(tenantId);
      // Dự án và dòng owner phải cùng một transaction: một dự án không có
      // owner thì không ai sửa hay huỷ được nó nữa.
      return inTransaction(pool, async (client) => {
        // Hai request cùng mã đều qua được bước kiểm ở tầng ứng dụng; khi đó
        // chính UNIQUE chặn lại và người thua nhận 409 như bình thường.
        const created = await onUniqueViolation(
          () =>
            client.query<Row>(
              `INSERT INTO workspace_schema.projects
                 (code, name, description, org_unit_id, customer_ref, start_date, end_date,
                  owner_user_id, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
               RETURNING ${PROJECT_COLUMNS}`,
              [
                input.code,
                input.name,
                input.description ?? null,
                input.orgUnitId ?? null,
                input.customerRef ?? null,
                input.startDate ?? null,
                input.endDate ?? null,
                actorUserId,
              ],
            ),
          () => new ProjectCodeConflictError(String(input.code)),
        );
        const project = mapProject(created.rows[0] as Row);
        await client.query(
          `INSERT INTO workspace_schema.project_members (project_id, user_id, role, created_by)
           VALUES ($1, $2, 'owner', $2)`,
          [project.id, actorUserId],
        );
        await writeOutbox(client, tenantId, {
          type: 'workspace.project.created',
          aggregateType: 'workspace-project',
          aggregateId: project.id,
          payload: {
            projectId: project.id,
            code: project.code,
            name: project.name,
            ownerUserId: project.ownerUserId,
          },
        });
        return project;
      });
    },

    update: async (tenantId: string, projectId: string, input: UpdateProjectRequest) => {
      const pool = await this.poolFor(tenantId);
      const { clause, values } = buildSet(
        input as Record<string, unknown>,
        {
          name: 'name',
          description: 'description',
          status: 'status',
          ownerUserId: 'owner_user_id',
          orgUnitId: 'org_unit_id',
          customerRef: 'customer_ref',
          startDate: 'start_date',
          endDate: 'end_date',
        },
        1,
      );
      if (!clause) {
        const current = await this.project.findById(tenantId, projectId);
        if (!current) throw new ProjectNotFoundError(projectId);
        return current;
      }
      // Transaction vì sự kiện `completed` phải ghi cùng lúc với đổi trạng
      // thái: ghi sau là một cửa sổ mà trạng thái đã đổi nhưng không ai được
      // báo, và không có gì bù lại được.
      return inTransaction(pool, async (client) => {
        const before = await client.query<{ status: string }>(
          `SELECT status FROM workspace_schema.projects WHERE id = $1 FOR UPDATE`,
          [projectId],
        );
        const previous = before.rows[0]?.status;
        if (!previous) throw new ProjectNotFoundError(projectId);

        const result = await client.query<Row>(
          `UPDATE workspace_schema.projects
              SET ${clause}, updated_at = now()
            WHERE id = $${values.length + 1}
            RETURNING ${PROJECT_COLUMNS}`,
          [...values, projectId],
        );
        const project = mapProject(result.rows[0] as Row);

        // Chỉ phát khi thật sự CHUYỂN sang completed; lưu lại một dự án đã
        // hoàn thành không được sinh sự kiện lần thứ hai.
        if (project.status === 'completed' && previous !== 'completed') {
          await writeOutbox(client, tenantId, {
            type: 'workspace.project.completed',
            aggregateType: 'workspace-project',
            aggregateId: project.id,
            payload: { projectId: project.id, code: project.code, name: project.name },
          });
        }
        return project;
      });
    },

    updateProgress: async (tenantId: string, projectId: string, percent: number) => {
      const pool = await this.poolFor(tenantId);
      await pool.query(
        `UPDATE workspace_schema.projects
            SET progress_percent = $2, updated_at = now()
          WHERE id = $1 AND progress_percent <> $2`,
        [projectId, percent],
      );
    },
  };

  readonly member = {
    list: async (tenantId: string, projectId: string): Promise<ProjectMember[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT id, project_id, user_id, role, joined_at
           FROM workspace_schema.project_members
          WHERE project_id = $1
          ORDER BY joined_at`,
        [projectId],
      );
      return result.rows.map((row) => ({
        id: str(row.id),
        projectId: str(row.project_id),
        userId: str(row.user_id),
        role: str(row.role) as ProjectRole,
        joinedAt: iso(row.joined_at),
      }));
    },

    roleOf: async (tenantId: string, projectId: string, userId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<{ role: string }>(
        `SELECT role FROM workspace_schema.project_members
          WHERE project_id = $1 AND user_id = $2`,
        [projectId, userId],
      );
      const row = result.rows[0];
      return row ? (row.role as ProjectRole) : undefined;
    },

    replaceAll: async (
      tenantId: string,
      projectId: string,
      actorUserId: string,
      members: readonly { userId: string; role: ProjectRole }[],
    ) => {
      const pool = await this.poolFor(tenantId);
      await inTransaction(pool, async (client) => {
        const keep = members.map((member) => member.userId);
        await client.query(
          `DELETE FROM workspace_schema.project_members
            WHERE project_id = $1 AND NOT (user_id = ANY($2::uuid[]))`,
          [projectId, keep],
        );
        for (const member of members) {
          await client.query(
            `INSERT INTO workspace_schema.project_members (project_id, user_id, role, created_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (project_id, user_id)
             DO UPDATE SET role = EXCLUDED.role, updated_at = now()`,
            [projectId, member.userId, member.role, actorUserId],
          );
        }
        // Chủ nhiệm dự án là cột trên bảng projects, giữ đồng bộ với bảng
        // thành viên để hai nơi không nói khác nhau.
        const owner = members.find((member) => member.role === 'owner');
        if (owner) {
          await client.query(
            `UPDATE workspace_schema.projects
                SET owner_user_id = $2, updated_at = now()
              WHERE id = $1 AND owner_user_id <> $2`,
            [projectId, owner.userId],
          );
        }
      });
      return this.member.list(tenantId, projectId);
    },

    openItemCounts: async (
      tenantId: string,
      projectId: string,
      userIds: readonly string[],
    ): Promise<ReadonlyMap<string, number>> => {
      if (userIds.length === 0) return new Map();
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT assignee_user_id, COUNT(*)::text AS open_items
           FROM workspace_schema.work_items
          WHERE project_id = $1
            AND assignee_user_id = ANY($2::uuid[])
            AND status NOT IN ('done','cancelled')
          GROUP BY assignee_user_id`,
        [projectId, userIds],
      );
      return new Map(result.rows.map((row) => [str(row.assignee_user_id), num(row.open_items)]));
    },
  };

  readonly workItem = {
    listByProject: async (tenantId: string, projectId: string): Promise<WorkItem[]> => {
      const pool = await this.poolFor(tenantId);
      // Trả phẳng, đã sắp sẵn; client dựng cây. Cây 10 cấp lồng nhau dưới
      // dạng JSON sẽ phình nhanh và khó cập nhật một node lẻ.
      const result = await pool.query<Row>(
        `SELECT ${WORK_ITEM_COLUMNS} FROM workspace_schema.work_items
          WHERE project_id = $1
          ORDER BY depth, sort_order, created_at`,
        [projectId],
      );
      return result.rows.map(mapWorkItem);
    },

    findById: async (tenantId: string, workItemId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${WORK_ITEM_COLUMNS} FROM workspace_schema.work_items WHERE id = $1`,
        [workItemId],
      );
      const row = result.rows[0];
      return row ? mapWorkItem(row) : undefined;
    },

    progressRows: async (tenantId: string, projectId: string): Promise<WorkItemProgressRow[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT id, parent_id, status, progress_percent, estimate_hours
           FROM workspace_schema.work_items WHERE project_id = $1`,
        [projectId],
      );
      return result.rows.map((row) => ({
        id: str(row.id),
        parentId: row.parent_id == null ? null : str(row.parent_id),
        status: str(row.status) as WorkItemStatus,
        progressPercent: num(row.progress_percent),
        estimateHours: row.estimate_hours == null ? null : Number(row.estimate_hours),
      }));
    },

    openChildCount: async (tenantId: string, workItemId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<{ open_children: string }>(
        `SELECT COUNT(*)::text AS open_children FROM workspace_schema.work_items
          WHERE parent_id = $1 AND status NOT IN ('done','cancelled')`,
        [workItemId],
      );
      return num(result.rows[0]?.open_children);
    },

    create: async (
      tenantId: string,
      actorUserId: string,
      input: CreateWorkItemRequest & { depth: number; sortOrder: number },
    ) => {
      const pool = await this.poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        // Hai người tạo việc cùng lúc trong một dự án sẽ cùng đọc được MAX và
        // cùng sinh một mã. Khoá tư vấn theo dự án buộc hai lượt xếp hàng, và
        // lượt sau đọc MAX sau khi lượt trước đã ghi. Khoá tự nhả khi
        // transaction kết thúc.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `workspace-work-item-code:${input.projectId}`,
        ]);
        const next = await client.query<{ next: string }>(
          `SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::int), 0) + 1 AS next
             FROM workspace_schema.work_items WHERE project_id = $1`,
          [input.projectId],
        );
        const code = `CV-${String(num(next.rows[0]?.next) || 1).padStart(3, '0')}`;

        const created = await client.query<Row>(
          `INSERT INTO workspace_schema.work_items
             (project_id, parent_id, code, title, description, item_type, execution_type,
              priority, assignee_user_id, planned_start, planned_end, estimate_hours,
              sort_order, depth, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING ${WORK_ITEM_COLUMNS}`,
          [
            input.projectId,
            input.parentId ?? null,
            code,
            input.title,
            input.description ?? null,
            input.itemType ?? 'task',
            input.executionType ?? 'manual',
            input.priority ?? 'normal',
            input.assigneeUserId ?? null,
            input.plannedStart ?? null,
            input.plannedEnd ?? null,
            input.estimateHours ?? null,
            input.sortOrder,
            input.depth,
            actorUserId,
          ],
        );
        const item = mapWorkItem(created.rows[0] as Row);
        // Dòng nhật ký đầu tiên có from_status rỗng, đánh dấu lúc khởi tạo.
        await client.query(
          `INSERT INTO workspace_schema.work_item_status_history
             (work_item_id, project_id, from_status, to_status, created_by)
           VALUES ($1, $2, NULL, $3, $4)`,
          [item.id, item.projectId, item.status, actorUserId],
        );
        if (item.assigneeUserId) {
          await writeOutbox(client, tenantId, assignedEvent(item, undefined));
        }
        return item;
      });
    },

    update: async (tenantId: string, workItemId: string, input: UpdateWorkItemRequest) => {
      const pool = await this.poolFor(tenantId);
      const { clause, values } = buildSet(
        input as Record<string, unknown>,
        {
          title: 'title',
          description: 'description',
          priority: 'priority',
          assigneeUserId: 'assignee_user_id',
          plannedStart: 'planned_start',
          plannedEnd: 'planned_end',
          estimateHours: 'estimate_hours',
          progressPercent: 'progress_percent',
        },
        1,
      );
      if (!clause) {
        const current = await this.workItem.findById(tenantId, workItemId);
        if (!current) throw new WorkItemNotFoundError(workItemId);
        return current;
      }
      return inTransaction(pool, async (client) => {
        const before = await client.query<{ assignee_user_id: string | null }>(
          `SELECT assignee_user_id FROM workspace_schema.work_items WHERE id = $1 FOR UPDATE`,
          [workItemId],
        );
        if (!before.rows[0]) throw new WorkItemNotFoundError(workItemId);
        const previousAssignee = before.rows[0].assignee_user_id ?? undefined;

        const result = await client.query<Row>(
          `UPDATE workspace_schema.work_items
              SET ${clause}, updated_at = now()
            WHERE id = $${values.length + 1}
            RETURNING ${WORK_ITEM_COLUMNS}`,
          [...values, workItemId],
        );
        const item = mapWorkItem(result.rows[0] as Row);

        // Chỉ phát khi người phụ trách thật sự đổi sang một người khác. Gỡ
        // người phụ trách (về rỗng) không phải "giao việc", nên không phát.
        if (item.assigneeUserId && item.assigneeUserId !== previousAssignee) {
          await writeOutbox(client, tenantId, assignedEvent(item, previousAssignee));
        }
        return item;
      });
    },

    changeStatus: async (
      tenantId: string,
      workItemId: string,
      actorUserId: string,
      next: WorkItemStatus,
      note: string | undefined,
      today: string,
    ) => {
      const pool = await this.poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        const before = await client.query<Row>(
          `SELECT status FROM workspace_schema.work_items WHERE id = $1 FOR UPDATE`,
          [workItemId],
        );
        const current = before.rows[0];
        if (!current) throw new WorkItemNotFoundError(workItemId);

        const updated = await client.query<Row>(
          `UPDATE workspace_schema.work_items
              -- Tham số 2 ép về varchar ở MỌI chỗ dùng: Postgres suy kiểu tham
              -- số theo từng lần xuất hiện, và phép gán vào cột (varchar) cạnh
              -- phép so với chuỗi hằng (text) là lỗi 42P08.
              SET status = $2::varchar,
                  -- Mốc bắt đầu chỉ ghi lần đầu vào in_progress; mốc kết thúc
                  -- ghi khi đóng và xoá đi nếu việc được mở lại.
                  actual_start = CASE WHEN $2::varchar = 'in_progress' AND actual_start IS NULL
                                      THEN $3::date ELSE actual_start END,
                  actual_end   = CASE WHEN $2::varchar IN ('done','cancelled') THEN $3::date ELSE NULL END,
                  progress_percent = CASE WHEN $2::varchar = 'done' THEN 100
                                          WHEN $2::varchar = 'todo' THEN 0
                                          ELSE progress_percent END,
                  updated_at = now()
            WHERE id = $1
            RETURNING ${WORK_ITEM_COLUMNS}`,
          [workItemId, next, today],
        );
        const item = mapWorkItem(updated.rows[0] as Row);

        await client.query(
          `INSERT INTO workspace_schema.work_item_status_history
             (work_item_id, project_id, from_status, to_status, note, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [item.id, item.projectId, str(current.status), next, note ?? null, actorUserId],
        );

        // Mở lại rồi đóng lần nữa vẫn phát lại — mỗi lần hoàn thành là một sự
        // thật nghiệp vụ riêng, bên tiêu thụ tự quyết có bỏ trùng hay không.
        if (next === 'done' && str(current.status) !== 'done') {
          await writeOutbox(client, tenantId, {
            type: 'workspace.work-item.completed',
            aggregateType: 'workspace-work-item',
            aggregateId: item.id,
            payload: {
              workItemId: item.id,
              projectId: item.projectId,
              code: item.code,
              title: item.title,
              completedBy: actorUserId,
            },
          });
        }
        return item;
      });
    },

    move: async (
      tenantId: string,
      workItemId: string,
      parentId: string | null,
      sortOrder: number,
      depthDelta: number,
    ) => {
      const pool = await this.poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        const moved = await client.query<Row>(
          `UPDATE workspace_schema.work_items
              SET parent_id = $2, sort_order = $3, depth = depth + $4, updated_at = now()
            WHERE id = $1
            RETURNING ${WORK_ITEM_COLUMNS}`,
          [workItemId, parentId, sortOrder, depthDelta],
        );
        const row = moved.rows[0];
        if (!row) throw new WorkItemNotFoundError(workItemId);

        // Cả nhánh con đi theo, nên depth của chúng phải dịch cùng một lượng.
        if (depthDelta !== 0) {
          await client.query(
            `WITH RECURSIVE branch AS (
               SELECT id FROM workspace_schema.work_items WHERE parent_id = $1
               UNION ALL
               SELECT child.id
                 FROM workspace_schema.work_items child
                 JOIN branch ON child.parent_id = branch.id
             )
             UPDATE workspace_schema.work_items
                SET depth = depth + $2, updated_at = now()
              WHERE id IN (SELECT id FROM branch)`,
            [workItemId, depthDelta],
          );
        }
        return mapWorkItem(row);
      });
    },

    applyProgress: async (tenantId: string, updates: ReadonlyMap<string, number>) => {
      if (updates.size === 0) return;
      const pool = await this.poolFor(tenantId);
      const ids = [...updates.keys()];
      const values = ids.map((id) => updates.get(id) as number);
      // Một câu UPDATE dùng unnest thay vì N câu riêng lẻ: cây lớn có thể có
      // hàng trăm node cha cần cập nhật sau một lần đổi trạng thái.
      await pool.query(
        `UPDATE workspace_schema.work_items AS w
            SET progress_percent = v.percent, updated_at = now()
           FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::int[]) AS percent) AS v
          WHERE w.id = v.id AND w.progress_percent <> v.percent`,
        [ids, values],
      );
    },
  };

  readonly dependency = {
    listByProject: async (tenantId: string, projectId: string): Promise<WorkItemDependency[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT id, project_id, predecessor_id, successor_id, dependency_type, lag_days, created_at
           FROM workspace_schema.work_item_dependencies WHERE project_id = $1`,
        [projectId],
      );
      return result.rows.map(mapDependency);
    },

    listBySuccessor: async (tenantId: string, successorId: string): Promise<WorkItemDependency[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT id, project_id, predecessor_id, successor_id, dependency_type, lag_days, created_at
           FROM workspace_schema.work_item_dependencies WHERE successor_id = $1`,
        [successorId],
      );
      return result.rows.map(mapDependency);
    },

    add: async (
      tenantId: string,
      actorUserId: string,
      input: {
        projectId: string;
        predecessorId: string;
        successorId: string;
        dependencyType: DependencyType;
        lagDays: number;
      },
    ) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `INSERT INTO workspace_schema.work_item_dependencies
           (project_id, predecessor_id, successor_id, dependency_type, lag_days, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, project_id, predecessor_id, successor_id, dependency_type, lag_days, created_at`,
        [
          input.projectId,
          input.predecessorId,
          input.successorId,
          input.dependencyType,
          input.lagDays,
          actorUserId,
        ],
      );
      return mapDependency(result.rows[0] as Row);
    },

    remove: async (tenantId: string, dependencyId: string) => {
      const pool = await this.poolFor(tenantId);
      await pool.query(`DELETE FROM workspace_schema.work_item_dependencies WHERE id = $1`, [
        dependencyId,
      ]);
    },
  };


  readonly calendar = {
    listCandidates: async (
      tenantId: string,
      options: {
        from: Date;
        to: Date;
        projectId?: string;
        userId?: string;
      },
    ): Promise<CalendarEvent[]> => {
      const pool = await this.poolFor(tenantId);
      const values: unknown[] = [options.from, options.to];
      const where: string[] = [
        `e.status = 'scheduled'`,
        // Sự kiện đơn lẻ giao khoảng, HOẶC bất kỳ chuỗi nào chưa kết thúc
        // trước khoảng. Không lọc chặt hơn được: một chuỗi bắt đầu từ năm
        // ngoái vẫn có buổi rơi vào tuần này, và chỉ tầng domain mới biết.
        `(
           (e.recurrence_rule IS NULL AND e.start_at <= $2 AND e.end_at >= $1)
           OR (e.recurrence_rule IS NOT NULL
               AND e.start_at <= $2
               AND (e.recurrence_until IS NULL OR e.recurrence_until >= $1))
         )`,
      ];

      if (options.projectId) {
        values.push(options.projectId);
        where.push(`e.project_id = $${values.length}`);
      }
      if (options.userId) {
        values.push(options.userId);
        where.push(`(e.organizer_user_id = $${values.length}
                     OR EXISTS (SELECT 1 FROM workspace_schema.calendar_event_participants p
                                 WHERE p.event_id = e.id AND p.user_id = $${values.length}))`);
      }

      const result = await pool.query<Row>(
        `SELECT ${EVENT_COLUMNS} FROM workspace_schema.calendar_events e
          WHERE ${where.join(' AND ')}
          ORDER BY e.start_at`,
        values,
      );
      return result.rows.map(mapEvent);
    },

    findEvent: async (tenantId: string, eventId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${EVENT_COLUMNS} FROM workspace_schema.calendar_events WHERE id = $1`,
        [eventId],
      );
      const row = result.rows[0];
      return row ? mapEvent(row) : undefined;
    },

    listExceptions: async (
      tenantId: string,
      seriesIds: readonly string[],
    ): Promise<EventException[]> => {
      if (seriesIds.length === 0) return [];
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT id, series_id, occurrence_date, exception_type, replacement_event_id
           FROM workspace_schema.calendar_event_exceptions
          WHERE series_id = ANY($1::uuid[])`,
        [seriesIds],
      );
      return result.rows.map(mapException);
    },

    createEvent: async (
      tenantId: string,
      actorUserId: string,
      input: EventWriteModel,
      participantUserIds: readonly string[],
    ) => {
      const pool = await this.poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        const created = await client.query<Row>(
          `INSERT INTO workspace_schema.calendar_events
             (series_id, project_id, work_item_id, title, description, location, event_type,
              start_at, end_at, all_day, timezone, recurrence_rule, recurrence_until,
              recurrence_count, organizer_user_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
           RETURNING ${EVENT_COLUMNS}`,
          [
            input.seriesId ?? null,
            input.projectId ?? null,
            input.workItemId ?? null,
            input.title,
            input.description ?? null,
            input.location ?? null,
            input.eventType,
            input.startAt,
            input.endAt,
            input.allDay,
            input.timezone,
            input.recurrenceRule ?? null,
            input.recurrenceUntil ?? null,
            input.recurrenceCount ?? null,
            actorUserId,
          ],
        );
        const event = mapEvent(created.rows[0] as Row);

        // Chuỗi lặp cần `series_id` trỏ về chính nó, để buổi tách ra làm
        // ngoại lệ sau này có chỗ bám. Đặt sau INSERT vì id do CSDL sinh.
        if (input.recurrenceRule && !input.seriesId) {
          await client.query(
            `UPDATE workspace_schema.calendar_events SET series_id = id WHERE id = $1`,
            [event.id],
          );
        }

        await replaceParticipants(client, event.id, event.organizerUserId, participantUserIds, actorUserId);

        const participants = await readParticipants(client, event.id);
        await writeOutbox(client, tenantId, {
          type: 'workspace.calendar-event.scheduled',
          aggregateType: 'workspace-calendar-event',
          aggregateId: event.id,
          payload: {
            eventId: event.id,
            projectId: event.projectId,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
            recurring: Boolean(event.recurrenceRule),
            organizerUserId: event.organizerUserId,
            participantUserIds: participants.map((participant) => participant.userId),
          },
        });

        return {
          event: input.recurrenceRule && !input.seriesId ? { ...event, seriesId: event.id } : event,
          participants: await readParticipants(client, event.id),
        };
      });
    },

    updateEvent: async (
      tenantId: string,
      actorUserId: string,
      eventId: string,
      input: Partial<EventWriteModel>,
      participantUserIds: readonly string[] | undefined,
    ) => {
      const pool = await this.poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        const { clause, values } = buildSet(
          input as Record<string, unknown>,
          {
            title: 'title',
            description: 'description',
            location: 'location',
            eventType: 'event_type',
            startAt: 'start_at',
            endAt: 'end_at',
            allDay: 'all_day',
            timezone: 'timezone',
            recurrenceRule: 'recurrence_rule',
            recurrenceUntil: 'recurrence_until',
            recurrenceCount: 'recurrence_count',
          },
          1,
        );

        const updated = clause
          ? await client.query<Row>(
              `UPDATE workspace_schema.calendar_events
                  SET ${clause}, updated_at = now()
                WHERE id = $${values.length + 1}
                RETURNING ${EVENT_COLUMNS}`,
              [...values, eventId],
            )
          : await client.query<Row>(
              `SELECT ${EVENT_COLUMNS} FROM workspace_schema.calendar_events WHERE id = $1`,
              [eventId],
            );

        const row = updated.rows[0];
        if (!row) throw new EventNotFoundError(eventId);
        const event = mapEvent(row);

        if (participantUserIds) {
          await replaceParticipants(client, event.id, event.organizerUserId, participantUserIds, actorUserId);
        }

        return {
          event,
          participants: await readParticipants(client, event.id),
        };
      });
    },

    cancelEvent: async (tenantId: string, eventId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `UPDATE workspace_schema.calendar_events
            SET status = 'cancelled', updated_at = now()
          WHERE id = $1
          RETURNING ${EVENT_COLUMNS}`,
        [eventId],
      );
      const row = result.rows[0];
      if (!row) throw new EventNotFoundError(eventId);
      return mapEvent(row);
    },

    listParticipants: async (tenantId: string, eventId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT id, event_id, user_id, response_status, is_organizer, responded_at
           FROM workspace_schema.calendar_event_participants
          WHERE event_id = $1
          ORDER BY is_organizer DESC, created_at`,
        [eventId],
      );
      return result.rows.map(mapParticipant);
    },

    respond: async (
      tenantId: string,
      eventId: string,
      userId: string,
      response: ParticipantResponse,
    ) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `UPDATE workspace_schema.calendar_event_participants
            SET response_status = $3, responded_at = now(), updated_at = now()
          WHERE event_id = $1 AND user_id = $2
          RETURNING id, event_id, user_id, response_status, is_organizer, responded_at`,
        [eventId, userId, response],
      );
      const row = result.rows[0];
      if (!row) throw new EventNotFoundError(eventId);
      return mapParticipant(row);
    },

    busySlots: async (
      tenantId: string,
      userIds: readonly string[],
      from: Date,
      to: Date,
      excludeEventId?: string,
    ): Promise<ParticipantBusySlot[]> => {
      if (userIds.length === 0) return [];
      const pool = await this.poolFor(tenantId);
      // Người đã từ chối lời mời thì không tính là bận.
      const result = await pool.query<Row>(
        `SELECT p.user_id, e.id AS event_id, e.start_at, e.end_at
           FROM workspace_schema.calendar_event_participants p
           JOIN workspace_schema.calendar_events e ON e.id = p.event_id
          WHERE p.user_id = ANY($1::uuid[])
            AND p.response_status <> 'declined'
            AND e.status = 'scheduled'
            AND e.start_at <= $3 AND e.end_at >= $2
            AND ($4::uuid IS NULL OR e.id <> $4)`,
        [userIds, from, to, excludeEventId ?? null],
      );
      return result.rows.map((row) => ({
        userId: str(row.user_id),
        eventId: str(row.event_id),
        startAt: iso(row.start_at),
        endAt: iso(row.end_at),
      }));
    },

    addException: async (
      tenantId: string,
      actorUserId: string,
      input: {
        seriesId: string;
        occurrenceDate: string;
        exceptionType: 'cancelled' | 'moved';
        replacementEventId?: string;
      },
    ) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `INSERT INTO workspace_schema.calendar_event_exceptions
           (series_id, occurrence_date, exception_type, replacement_event_id, created_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (series_id, occurrence_date)
         DO UPDATE SET exception_type = EXCLUDED.exception_type,
                       replacement_event_id = EXCLUDED.replacement_event_id,
                       updated_at = now()
         RETURNING id, series_id, occurrence_date, exception_type, replacement_event_id`,
        [
          input.seriesId,
          input.occurrenceDate,
          input.exceptionType,
          input.replacementEventId ?? null,
          actorUserId,
        ],
      );
      return mapException(result.rows[0] as Row);
    },
  };


  readonly document = {
    listFolders: async (tenantId: string, projectId?: string): Promise<DocumentFolder[]> => {
      const pool = await this.poolFor(tenantId);
      // `projectId` rỗng: trả cả thư mục cấp đơn vị lẫn thư mục dự án, dùng
      // cho trang Tài liệu chung. Có `projectId`: thư mục của dự án đó cộng
      // thư mục cấp đơn vị, vì cấp đơn vị dùng chung cho mọi dự án.
      const result = await pool.query<Row>(
        `SELECT ${FOLDER_COLUMNS} FROM workspace_schema.document_folders
          WHERE is_active
            AND ($1::uuid IS NULL OR project_id = $1 OR project_id IS NULL)
          ORDER BY depth, name`,
        [projectId ?? null],
      );
      return result.rows.map(mapFolder);
    },

    findFolder: async (tenantId: string, folderId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${FOLDER_COLUMNS} FROM workspace_schema.document_folders WHERE id = $1`,
        [folderId],
      );
      const row = result.rows[0];
      return row ? mapFolder(row) : undefined;
    },

    deactivateFolder: async (tenantId: string, folderId: string) => {
      const pool = await this.poolFor(tenantId);
      await pool.query(
        `UPDATE workspace_schema.document_folders SET is_active = false WHERE id = $1`,
        [folderId],
      );
    },

    countActiveDocuments: async (tenantId: string, folderId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM workspace_schema.documents
          WHERE folder_id = $1 AND status = 'active'`,
        [folderId],
      );
      return Number(result.rows[0]?.count ?? '0');
    },

    createFolder: async (
      tenantId: string,
      actorUserId: string,
      input: {
        projectId?: string | null;
        parentId?: string | null;
        name: string;
        depth: number;
      },
    ) => {
      const pool = await this.poolFor(tenantId);
      const result = await onUniqueViolation(
        () =>
          pool.query<Row>(
            `INSERT INTO workspace_schema.document_folders
               (project_id, parent_id, name, depth, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING ${FOLDER_COLUMNS}`,
            [input.projectId ?? null, input.parentId ?? null, input.name, input.depth, actorUserId],
          ),
        () => new NameConflictError(`Đã có thư mục "${input.name}" ở cùng cấp.`),
      );
      return mapFolder(result.rows[0] as Row);
    },

    list: async (
      tenantId: string,
      options: {
        projectId?: string;
        folderId?: string;
        status?: DocumentStatus;
        search?: string;
        linkedTo?: { entityType: DocumentLinkEntityType; entityId: string };
      },
    ): Promise<DocumentSummary[]> => {
      const pool = await this.poolFor(tenantId);
      const where: string[] = [];
      const values: unknown[] = [];

      if (options.projectId) {
        values.push(options.projectId);
        where.push(`d.project_id = $${values.length}`);
      }
      if (options.folderId) {
        values.push(options.folderId);
        where.push(`d.folder_id = $${values.length}`);
      }
      if (options.status) {
        values.push(options.status);
        where.push(`d.status = $${values.length}`);
      }
      if (options.search) {
        values.push(`%${options.search.trim()}%`);
        where.push(`d.name ILIKE $${values.length}`);
      }
      if (options.linkedTo) {
        values.push(options.linkedTo.entityType, options.linkedTo.entityId);
        where.push(`EXISTS (SELECT 1 FROM workspace_schema.document_links l
                             WHERE l.document_id = d.id
                               AND l.entity_type = $${values.length - 1}
                               AND l.entity_id = $${values.length})`);
      }
      const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

      // Phiên bản hiện hành lấy kèm bằng LEFT JOIN, không phải N+1 lời gọi.
      const result = await pool.query<Row>(
        `SELECT ${qualified(DOCUMENT_COLUMNS, 'd')},
                v.id AS v_id, v.document_id AS v_document_id, v.version_no AS v_version_no,
                v.file_name AS v_file_name, v.content_type AS v_content_type,
                v.size_bytes AS v_size_bytes, v.checksum AS v_checksum,
                v.change_note AS v_change_note, v.uploaded_by AS v_uploaded_by,
                v.created_at AS v_created_at,
                (SELECT COUNT(*) FROM workspace_schema.document_versions vv
                  WHERE vv.document_id = d.id)::text AS version_count
           FROM workspace_schema.documents d
           LEFT JOIN workspace_schema.document_versions v ON v.id = d.current_version_id
           ${clause}
          ORDER BY d.updated_at DESC`,
        values,
      );

      return result.rows.map((row) => ({
        ...mapDocument(row),
        currentVersion: row.v_id
          ? mapVersion({
              id: row.v_id,
              document_id: row.v_document_id,
              version_no: row.v_version_no,
              file_name: row.v_file_name,
              content_type: row.v_content_type,
              size_bytes: row.v_size_bytes,
              checksum: row.v_checksum,
              change_note: row.v_change_note,
              uploaded_by: row.v_uploaded_by,
              created_at: row.v_created_at,
            } as Row)
          : undefined,
        versionCount: num(row.version_count),
      }));
    },

    findById: async (tenantId: string, documentId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${DOCUMENT_COLUMNS} FROM workspace_schema.documents WHERE id = $1`,
        [documentId],
      );
      const row = result.rows[0];
      return row ? mapDocument(row) : undefined;
    },

    listVersions: async (tenantId: string, documentId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${VERSION_COLUMNS} FROM workspace_schema.document_versions
          WHERE document_id = $1
          ORDER BY version_no DESC`,
        [documentId],
      );
      return result.rows.map(mapVersion);
    },

    findVersion: async (tenantId: string, versionId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${VERSION_COLUMNS} FROM workspace_schema.document_versions WHERE id = $1`,
        [versionId],
      );
      const row = result.rows[0];
      return row ? mapVersion(row) : undefined;
    },

    storageKeyOf: async (tenantId: string, versionId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<{ storage_key: string }>(
        `SELECT storage_key FROM workspace_schema.document_versions WHERE id = $1`,
        [versionId],
      );
      return result.rows[0]?.storage_key;
    },

    completeVersion: async (tenantId: string, versionId: string, sizeBytes: number) => {
      const pool = await this.poolFor(tenantId);
      // `size_bytes IS NULL` làm lệnh này lặp lại được: bấm lại sau khi mạng
      // chập chờn không ghi đè con số đã có.
      await pool.query(
        `UPDATE workspace_schema.document_versions
            SET size_bytes = $2
          WHERE id = $1 AND size_bytes IS NULL`,
        [versionId, sizeBytes],
      );
      const result = await pool.query<Row>(
        `SELECT ${VERSION_COLUMNS} FROM workspace_schema.document_versions WHERE id = $1`,
        [versionId],
      );
      const row = result.rows[0];
      return row ? mapVersion(row) : undefined;
    },

    create: async (
      tenantId: string,
      actorUserId: string,
      input: {
        folderId: string;
        projectId?: string | null;
        name: string;
        description?: string | null;
        storageKey: string;
        fileName: string;
        contentType: string;
        sizeBytes?: number | null;
        changeNote?: string | null;
      },
    ) => {
      const pool = await this.poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        const created = await onUniqueViolation(
          () =>
            client.query<Row>(
              `INSERT INTO workspace_schema.documents
                 (folder_id, project_id, name, description, created_by)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING ${DOCUMENT_COLUMNS}`,
              [
                input.folderId,
                input.projectId ?? null,
                input.name,
                input.description ?? null,
                actorUserId,
              ],
            ),
          () => new NameConflictError(`Thư mục này đã có tài liệu tên "${input.name}".`),
        );
        const document = mapDocument(created.rows[0] as Row);

        const version = await client.query<Row>(
          `INSERT INTO workspace_schema.document_versions
             (document_id, version_no, storage_key, file_name, content_type, size_bytes,
              change_note, uploaded_by)
           VALUES ($1, 1, $2, $3, $4, $5, $6, $7)
           RETURNING ${VERSION_COLUMNS}`,
          [
            document.id,
            input.storageKey,
            input.fileName,
            input.contentType,
            input.sizeBytes ?? null,
            input.changeNote ?? null,
            actorUserId,
          ],
        );
        const first = mapVersion(version.rows[0] as Row);

        // Khoá ngoại `current_version_id` là DEFERRABLE INITIALLY DEFERRED,
        // nên gán được ngay ở đây dù nó vừa mới tồn tại trong transaction.
        await client.query(
          `UPDATE workspace_schema.documents SET current_version_id = $2 WHERE id = $1`,
          [document.id, first.id],
        );

        await writeOutbox(client, tenantId, publishedEvent(document, first));
        return { document: { ...document, currentVersionId: first.id }, version: first };
      });
    },

    addVersion: async (
      tenantId: string,
      actorUserId: string,
      input: {
        documentId: string;
        versionNo: number;
        storageKey: string;
        fileName: string;
        contentType: string;
        sizeBytes?: number | null;
        changeNote: string;
      },
    ) => {
      const pool = await this.poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        const created = await client.query<Row>(
          `INSERT INTO workspace_schema.document_versions
             (document_id, version_no, storage_key, file_name, content_type, size_bytes,
              change_note, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING ${VERSION_COLUMNS}`,
          [
            input.documentId,
            input.versionNo,
            input.storageKey,
            input.fileName,
            input.contentType,
            input.sizeBytes ?? null,
            input.changeNote,
            actorUserId,
          ],
        );
        const version = mapVersion(created.rows[0] as Row);
        const updated = await client.query<Row>(
          `UPDATE workspace_schema.documents
              SET current_version_id = $2, updated_at = now()
            WHERE id = $1
            RETURNING ${DOCUMENT_COLUMNS}`,
          [input.documentId, version.id],
        );
        await writeOutbox(client, tenantId, publishedEvent(mapDocument(updated.rows[0] as Row), version));
        return version;
      });
    },

    archive: async (tenantId: string, documentId: string) => {
      const pool = await this.poolFor(tenantId);
      // Không xoá cứng, và cũng không xoá tệp vật lý: adapter storage chỉ có
      // `createUploadUrl` và `createDownloadUrl`, không có API xoá object.
      const result = await pool.query<Row>(
        `UPDATE workspace_schema.documents
            SET status = 'archived', locked_by_user_id = NULL, locked_at = NULL,
                updated_at = now()
          WHERE id = $1
          RETURNING ${DOCUMENT_COLUMNS}`,
        [documentId],
      );
      const row = result.rows[0];
      if (!row) throw new DocumentNotFoundError(documentId);
      return mapDocument(row);
    },

    setLock: async (tenantId: string, documentId: string, userId: string | null) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `UPDATE workspace_schema.documents
            SET locked_by_user_id = $2,
                locked_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END,
                updated_at = now()
          WHERE id = $1
          RETURNING ${DOCUMENT_COLUMNS}`,
        [documentId, userId],
      );
      const row = result.rows[0];
      if (!row) throw new DocumentNotFoundError(documentId);
      return mapDocument(row);
    },

    listLinks: async (tenantId: string, documentId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT id, document_id, entity_type, entity_id, created_at
           FROM workspace_schema.document_links WHERE document_id = $1`,
        [documentId],
      );
      return result.rows.map(mapLink);
    },

    addLink: async (
      tenantId: string,
      actorUserId: string,
      input: {
        documentId: string;
        entityType: DocumentLinkEntityType;
        entityId: string;
      },
    ) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `INSERT INTO workspace_schema.document_links
           (document_id, entity_type, entity_id, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (document_id, entity_type, entity_id)
         DO UPDATE SET updated_at = now()
         RETURNING id, document_id, entity_type, entity_id, created_at`,
        [input.documentId, input.entityType, input.entityId, actorUserId],
      );
      return mapLink(result.rows[0] as Row);
    },

    removeLink: async (tenantId: string, linkId: string) => {
      const pool = await this.poolFor(tenantId);
      await pool.query(`DELETE FROM workspace_schema.document_links WHERE id = $1`, [linkId]);
    },

    log: async (
      tenantId: string,
      actorUserId: string,
      input: {
        documentId: string;
        versionId?: string | null;
        action: DocumentAccessAction;
      },
    ) => {
      const pool = await this.poolFor(tenantId);
      await pool.query(
        `INSERT INTO workspace_schema.document_access_logs
           (document_id, version_id, action, created_by)
         VALUES ($1, $2, $3, $4)`,
        [input.documentId, input.versionId ?? null, input.action, actorUserId],
      );
    },
  };
  readonly chat = {
    findChannelById: async (tenantId: string, channelId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${CHANNEL_COLUMNS} FROM workspace_schema.chat_channels WHERE id = $1`,
        [channelId],
      );
      const row = result.rows[0];
      return row ? mapChannel(row) : undefined;
    },

    findChannel: async (tenantId: string, entityType: ChatEntityType, entityId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${CHANNEL_COLUMNS} FROM workspace_schema.chat_channels
          WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, entityId],
      );
      const row = result.rows[0];
      return row ? mapChannel(row) : undefined;
    },

    ensureChannel: async (
      tenantId: string,
      actorUserId: string,
      input: { entityType: ChatEntityType; entityId: string; projectId: string },
    ) => {
      const pool = await this.poolFor(tenantId);
      // `DO UPDATE` thay vì `DO NOTHING`: `DO NOTHING` không trả dòng nào khi
      // đụng khoá, nên hai người cùng gửi tin đầu tiên sẽ có một người nhận
      // kết quả rỗng.
      const result = await pool.query<Row>(
        `INSERT INTO workspace_schema.chat_channels (entity_type, entity_id, project_id, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (entity_type, entity_id)
         DO UPDATE SET updated_at = workspace_schema.chat_channels.updated_at
         RETURNING ${CHANNEL_COLUMNS}`,
        [input.entityType, input.entityId, input.projectId, actorUserId],
      );
      return mapChannel(result.rows[0] as Row);
    },

    listMessages: async (tenantId: string, channelId: string, limit: number) => {
      const pool = await this.poolFor(tenantId);
      // Lấy N tin mới nhất rồi đảo lại: Drawer đọc từ trên xuống theo thời
      // gian, nhưng phần cần cắt bỏ là phần cũ nhất.
      const result = await pool.query<Row>(
        `SELECT * FROM (
           SELECT ${MESSAGE_COLUMNS} FROM workspace_schema.chat_messages
            WHERE channel_id = $1
            ORDER BY created_at DESC
            LIMIT $2
         ) recent
         ORDER BY created_at`,
        [channelId, limit],
      );
      return result.rows.map(mapMessage);
    },

    findMessage: async (tenantId: string, messageId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${MESSAGE_COLUMNS} FROM workspace_schema.chat_messages WHERE id = $1`,
        [messageId],
      );
      const row = result.rows[0];
      return row ? mapMessage(row) : undefined;
    },

    sendMessage: async (
      tenantId: string,
      actorUserId: string,
      input: {
        channelId: string;
        parentId?: string | null;
        body: string;
        mentions: readonly string[];
        attachmentDocumentId?: string | null;
      },
    ) => {
      const pool = await this.poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        const created = await client.query<Row>(
          `INSERT INTO workspace_schema.chat_messages
             (channel_id, parent_id, body, mentions, attachment_document_id, created_by)
           VALUES ($1, $2, $3, $4::uuid[], $5, $6)
           RETURNING ${MESSAGE_COLUMNS}`,
          [
            input.channelId,
            input.parentId ?? null,
            input.body,
            input.mentions,
            input.attachmentDocumentId ?? null,
            actorUserId,
          ],
        );
        const message = mapMessage(created.rows[0] as Row);
        // `last_message_at` phải đổi cùng lúc với tin, nếu không danh sách
        // kênh sẽ sắp sai khi một trong hai câu lệnh hỏng.
        await client.query(
          `UPDATE workspace_schema.chat_channels
              SET last_message_at = $2, updated_at = now()
            WHERE id = $1`,
          [input.channelId, message.createdAt],
        );
        return message;
      });
    },

    editMessage: async (
      tenantId: string,
      messageId: string,
      body: string,
      mentions: readonly string[],
    ) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `UPDATE workspace_schema.chat_messages
            SET body = $2, mentions = $3::uuid[], is_edited = true, updated_at = now()
          WHERE id = $1
          RETURNING ${MESSAGE_COLUMNS}`,
        [messageId, body, mentions],
      );
      const row = result.rows[0];
      if (!row) throw new ChatMessageNotFoundError(messageId);
      return mapMessage(row);
    },

    softDeleteMessage: async (tenantId: string, messageId: string) => {
      const pool = await this.poolFor(tenantId);
      // Nội dung bị xoá thật khỏi cột, chỉ giữ lại cái vỏ: giữ nguyên chữ
      // trong CSDL nghĩa là "thu hồi" chỉ là một lớp che ở giao diện.
      const result = await pool.query<Row>(
        `UPDATE workspace_schema.chat_messages
            SET is_deleted = true, body = '', mentions = '{}', updated_at = now()
          WHERE id = $1
          RETURNING ${MESSAGE_COLUMNS}`,
        [messageId],
      );
      const row = result.rows[0];
      if (!row) throw new ChatMessageNotFoundError(messageId);
      return mapMessage(row);
    },

    unreadByProject: async (
      tenantId: string,
      projectId: string,
      userId: string,
    ): Promise<UnreadRow[]> => {
      const pool = await this.poolFor(tenantId);
      // Một truy vấn cho cả cây. Chưa có dòng `chat_reads` nghĩa là chưa đọc
      // gì, nên `COALESCE` về mốc xa nhất để mọi tin đều tính là chưa đọc.
      // Tin của chính mình không tính — vừa gõ xong đã thấy chấm đỏ là vô lý.
      const result = await pool.query<Row>(
        `SELECT c.entity_type, c.entity_id, COUNT(m.id)::text AS unread
           FROM workspace_schema.chat_channels c
           LEFT JOIN workspace_schema.chat_reads r
                  ON r.channel_id = c.id AND r.user_id = $2
           LEFT JOIN workspace_schema.chat_messages m
                  ON m.channel_id = c.id
                 AND m.is_deleted = false
                 AND m.created_by <> $2
                 AND m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamptz)
          WHERE c.project_id = $1
          GROUP BY c.entity_type, c.entity_id
         HAVING COUNT(m.id) > 0`,
        [projectId, userId],
      );
      return result.rows.map((row) => ({
        entityType: str(row.entity_type) as ChatEntityType,
        entityId: str(row.entity_id),
        unread: num(row.unread),
      }));
    },

    markRead: async (tenantId: string, channelId: string, userId: string) => {
      const pool = await this.poolFor(tenantId);
      await pool.query(
        `INSERT INTO workspace_schema.chat_reads (channel_id, user_id, last_read_at)
         VALUES ($1, $2, now())
         ON CONFLICT (channel_id, user_id)
         DO UPDATE SET last_read_at = now(), updated_at = now()`,
        [channelId, userId],
      );
    },
  };

  readonly myWork = {
    assignedItems: async (
      tenantId: string,
      userId: string,
    ): Promise<MyWorkAssignedRow[]> => {
      const pool = await this.poolFor(tenantId);
      // JOIN lấy sẵn mã và tên dự án: danh sách này luôn trộn nhiều dự án,
      // gọi thêm một vòng cho mỗi dòng là N+1 không cần thiết.
      // `idx_work_items_assignee` phủ đúng bộ lọc này.
      const result = await pool.query<Row>(
        `SELECT ${qualified(WORK_ITEM_COLUMNS, 'w')},
                p.code AS project_code, p.name AS project_name
           FROM workspace_schema.work_items w
           JOIN workspace_schema.projects p ON p.id = w.project_id
          WHERE w.assignee_user_id = $1
            AND w.status NOT IN ('done','cancelled')
            AND p.status <> 'cancelled'
          ORDER BY w.planned_end NULLS LAST, w.created_at`,
        [userId],
      );
      return result.rows.map((row) => ({
        item: mapWorkItem(row),
        projectCode: str(row.project_code),
        projectName: str(row.project_name),
      }));
    },

    completedCount: async (tenantId: string, userId: string, from: Date, to: Date) => {
      const pool = await this.poolFor(tenantId);
      // Đếm theo nhật ký chứ không theo `actual_end`: nhật ký ghi CHÍNH XÁC
      // ai bấm hoàn thành và lúc nào, còn `actual_end` chỉ là ngày và bị ghi
      // đè nếu việc được mở lại rồi đóng lần nữa.
      const result = await pool.query<{ total: string }>(
        `SELECT COUNT(DISTINCT h.work_item_id)::text AS total
           FROM workspace_schema.work_item_status_history h
          WHERE h.created_by = $1
            AND h.to_status = 'done'
            AND h.created_at BETWEEN $2 AND $3`,
        [userId, from, to],
      );
      return num(result.rows[0]?.total);
    },

    eventsForUser: async (
      tenantId: string,
      userId: string,
      from: Date,
      to: Date,
    ) => {
      const pool = await this.poolFor(tenantId);
      // Đã từ chối thì không còn là lịch của tôi.
      //
      // Điều kiện khoảng giống hệt `calendar.listCandidates`: chuỗi lặp bắt
      // đầu từ trước vẫn phải lọt vào, để tầng ứng dụng khai triển ra buổi
      // hôm nay. Lọc `start_at` theo hôm nay sẽ đánh rơi mọi cuộc họp định kỳ.
      // Bọc truy vấn con để `EVENT_COLUMNS` (không tiền tố bảng) không đụng
      // cột cùng tên của bảng người tham dự.
      const result = await pool.query<Row>(
        `SELECT ${EVENT_COLUMNS}, response_status FROM (
           SELECT e.*, p.response_status
             FROM workspace_schema.calendar_event_participants p
             JOIN workspace_schema.calendar_events e ON e.id = p.event_id
            WHERE p.user_id = $1
              AND p.response_status <> 'declined'
              AND e.status = 'scheduled'
              AND (
                (e.recurrence_rule IS NULL AND e.start_at <= $3 AND e.end_at >= $2)
                OR (e.recurrence_rule IS NOT NULL
                    AND e.start_at <= $3
                    AND (e.recurrence_until IS NULL OR e.recurrence_until >= $2))
              )
         ) mine
         ORDER BY start_at`,
        [userId, from, to],
      );
      return result.rows.map((row) => ({
        event: mapEvent(row),
        responseStatus: str(row.response_status) as ParticipantResponse,
      }));
    },

    pendingInvitations: async (tenantId: string, userId: string): Promise<MyWorkEvent[]> => {
      const pool = await this.poolFor(tenantId);
      // Lời mời cho sự kiện đã qua không còn gì để trả lời, nên chỉ lấy
      // những buổi còn ở phía trước.
      const result = await pool.query<Row>(
        `SELECT e.id, e.title, e.start_at, e.end_at, e.all_day, e.location,
                e.project_id, p.response_status
           FROM workspace_schema.calendar_event_participants p
           JOIN workspace_schema.calendar_events e ON e.id = p.event_id
          WHERE p.user_id = $1
            AND p.response_status = 'needs_action'
            AND e.status = 'scheduled'
            AND e.end_at >= now()
          ORDER BY e.start_at
          LIMIT 20`,
        [userId],
      );
      return result.rows.map(mapMyWorkEvent);
    },

    mentions: async (
      tenantId: string,
      userId: string,
      limit: number,
    ): Promise<MyWorkMention[]> => {
      const pool = await this.poolFor(tenantId);
      // `mentions @> ARRAY[...]` dùng được index GIN; `= ANY(mentions)` thì
      // không, và sẽ quét toàn bảng tin nhắn.
      const result = await pool.query<Row>(
        `SELECT m.id, m.channel_id, m.body, m.created_by, m.created_at,
                c.entity_type, c.entity_id, c.project_id
           FROM workspace_schema.chat_messages m
           JOIN workspace_schema.chat_channels c ON c.id = m.channel_id
          WHERE m.mentions @> ARRAY[$1]::uuid[]
            AND m.is_deleted = false
            AND m.created_by <> $1
            -- Cùng quy tắc với danh sách việc: dự án đã huỷ không còn đẩy
            -- gì lên trang Công việc của tôi.
            AND NOT EXISTS (
              SELECT 1 FROM workspace_schema.projects p
               WHERE p.id = c.project_id AND p.status = 'cancelled'
            )
          ORDER BY m.created_at DESC
          LIMIT $2`,
        [userId, limit],
      );
      return result.rows.map((row) => ({
        messageId: str(row.id),
        channelId: str(row.channel_id),
        entityType: str(row.entity_type) as ChatEntityType,
        entityId: str(row.entity_id),
        projectId: str(row.project_id),
        excerpt: str(row.body).slice(0, 160),
        createdBy: str(row.created_by),
        createdAt: iso(row.created_at),
      }));
    },

    externalCards: async (
      tenantId: string,
      userId: string,
    ): Promise<MyWorkExternalCard[]> => {
      const pool = await this.poolFor(tenantId);
      // Chỉ nhãn cache để hiển thị nhanh. Nguồn sự thật là module gốc, và
      // `cached_status` KHÔNG được dùng làm căn cứ cho quyết định nghiệp vụ.
      const result = await pool.query<Row>(
        `SELECT r.id, r.entity_id AS work_item_id, w.title AS work_item_title,
                r.module_key, r.external_code, r.launch_url,
                r.cached_label, r.cached_status, r.synced_at
           FROM workspace_schema.external_references r
           JOIN workspace_schema.work_items w ON w.id = r.entity_id
          WHERE r.entity_type = 'work_item'
            AND w.assignee_user_id = $1
            AND w.status NOT IN ('done','cancelled')
          ORDER BY r.updated_at DESC
          LIMIT 30`,
        [userId],
      );
      return result.rows.map((row) => ({
        id: str(row.id),
        workItemId: str(row.work_item_id),
        workItemTitle: str(row.work_item_title),
        moduleKey: str(row.module_key),
        externalCode: opt(row.external_code),
        launchUrl: str(row.launch_url),
        cachedLabel: opt(row.cached_label),
        cachedStatus: opt(row.cached_status),
        syncedAt: row.synced_at == null ? undefined : iso(row.synced_at),
      }));
    },
  };

  readonly report = {
    scopedProjectIds: async (
      tenantId: string,
      scope: ReportScopeFilter,
    ): Promise<string[]> => {
      const pool = await this.poolFor(tenantId);
      const where: string[] = [`p.status <> 'cancelled'`];
      const values: unknown[] = [];

      if (scope.level !== 'tenant') {
        values.push(scope.userId);
        // `managed` chỉ lấy dự án người gọi phụ trách; `self` lấy mọi dự án
        // họ tham gia. Điều kiện nằm trong SQL, không lọc sau khi đọc.
        const roleClause =
          scope.level === 'managed' ? `AND m.role IN ('owner','manager')` : '';
        where.push(`EXISTS (SELECT 1 FROM workspace_schema.project_members m
                             WHERE m.project_id = p.id
                               AND m.user_id = $${values.length}
                               ${roleClause})`);
      }
      if (scope.projectIds && scope.projectIds.length > 0) {
        values.push(scope.projectIds);
        where.push(`p.id = ANY($${values.length}::uuid[])`);
      }

      const result = await pool.query<{ id: string }>(
        `SELECT p.id FROM workspace_schema.projects p
          WHERE ${where.join(' AND ')}
          ORDER BY p.code`,
        values,
      );
      return result.rows.map((row) => row.id);
    },

    myBlock: async (tenantId: string, userId: string, from: Date, to: Date, today: string) => {
      const pool = await this.poolFor(tenantId);
      // Ba con số trong một lượt đi lại; ba truy vấn riêng chỉ tốn ba vòng
      // mạng cho cùng một khối nhỏ ở đầu trang.
      //
      // "Hôm nay" nhận từ tầng ứng dụng theo múi giờ tenant, không dùng
      // `CURRENT_DATE`: máy chủ CSDL chạy UTC, nên từ 0 giờ tới 7 giờ sáng giờ
      // Việt Nam hai hàm cho hai ngày khác nhau, và khối này sẽ lệch một ngày
      // so với bảng quá hạn ngay bên dưới nó.
      const result = await pool.query<Row>(
        `SELECT
           (SELECT COUNT(*) FROM workspace_schema.work_items w
             WHERE w.assignee_user_id = $1
               AND w.status NOT IN ('done','cancelled'))::text AS open_items,
           (SELECT COUNT(*) FROM workspace_schema.work_items w
             WHERE w.assignee_user_id = $1
               AND w.status NOT IN ('done','cancelled')
               AND w.planned_end IS NOT NULL
               AND w.planned_end < $4::date)::text AS overdue_items,
           (SELECT COUNT(DISTINCT h.work_item_id)
              FROM workspace_schema.work_item_status_history h
             WHERE h.created_by = $1
               AND h.to_status = 'done'
               AND h.created_at BETWEEN $2 AND $3)::text AS completed_in_period`,
        [userId, from, to, today],
      );
      const row = result.rows[0];
      return {
        openItems: num(row?.open_items),
        overdueItems: num(row?.overdue_items),
        completedInPeriod: num(row?.completed_in_period),
      };
    },

    projectProgress: async (
      tenantId: string,
      projectIds: readonly string[],
      today: string,
    ): Promise<ProjectProgressRow[]> => {
      if (projectIds.length === 0) return [];
      const pool = await this.poolFor(tenantId);
      // Đếm bằng LEFT JOIN cộng FILTER thay vì ba truy vấn con: một lần quét
      // `idx_work_items_project_status` cho cả ba con số.
      const result = await pool.query<Row>(
        `SELECT p.id, p.code, p.name, p.status, p.progress_percent,
                p.start_date, p.end_date,
                COUNT(w.id)::text AS total_items,
                COUNT(w.id) FILTER (WHERE w.status IN ('done','cancelled'))::text AS closed_items,
                COUNT(w.id) FILTER (
                  WHERE w.status NOT IN ('done','cancelled')
                    AND w.planned_end IS NOT NULL
                    AND w.planned_end < $2::date
                )::text AS overdue_items
           FROM workspace_schema.projects p
           LEFT JOIN workspace_schema.work_items w ON w.project_id = p.id
          WHERE p.id = ANY($1::uuid[])
          GROUP BY p.id
          ORDER BY p.code`,
        [projectIds, today],
      );
      return result.rows.map((row) => ({
        projectId: str(row.id),
        projectCode: str(row.code),
        projectName: str(row.name),
        status: str(row.status) as ProjectStatus,
        progressPercent: num(row.progress_percent),
        totalItems: num(row.total_items),
        closedItems: num(row.closed_items),
        overdueItems: num(row.overdue_items),
        startDate: day(row.start_date),
        endDate: day(row.end_date),
      }));
    },

    workload: async (
      tenantId: string,
      projectIds: readonly string[],
      today: string,
      weekEnd: string,
      onlySelfUserId?: string,
    ): Promise<WorkloadRow[]> => {
      if (projectIds.length === 0) return [];
      const pool = await this.poolFor(tenantId);
      const values: unknown[] = [projectIds, today, weekEnd];
      // `member` và `viewer` không được nhìn khối lượng của đồng nghiệp;
      // điều kiện nằm trong SQL chứ không cắt sau khi lấy về.
      let selfClause = '';
      if (onlySelfUserId) {
        values.push(onlySelfUserId);
        selfClause = `AND w.assignee_user_id = $${values.length}`;
      }

      const result = await pool.query<Row>(
        `SELECT w.assignee_user_id,
                COUNT(*)::text AS open_items,
                COUNT(*) FILTER (
                  WHERE w.planned_end IS NOT NULL AND w.planned_end < $2::date
                )::text AS overdue_items,
                COUNT(*) FILTER (
                  WHERE w.planned_end BETWEEN $2::date AND $3::date
                )::text AS due_this_week,
                COALESCE(SUM(w.estimate_hours), 0)::text AS estimated_hours
           FROM workspace_schema.work_items w
          WHERE w.project_id = ANY($1::uuid[])
            AND w.status NOT IN ('done','cancelled')
            AND w.assignee_user_id IS NOT NULL
            ${selfClause}
          GROUP BY w.assignee_user_id
          ORDER BY COUNT(*) DESC`,
        values,
      );
      return result.rows.map((row) => ({
        userId: str(row.assignee_user_id),
        openItems: num(row.open_items),
        overdueItems: num(row.overdue_items),
        dueThisWeek: num(row.due_this_week),
        estimatedHours: num(row.estimated_hours),
      }));
    },

    overdue: async (
      tenantId: string,
      projectIds: readonly string[],
      today: string,
      onlySelfUserId: string | undefined,
      limit: number,
    ): Promise<OverdueRow[]> => {
      if (projectIds.length === 0) return [];
      const pool = await this.poolFor(tenantId);
      const values: unknown[] = [projectIds, today];
      let selfClause = '';
      if (onlySelfUserId) {
        values.push(onlySelfUserId);
        selfClause = `AND w.assignee_user_id = $${values.length}`;
      }
      values.push(limit);

      const result = await pool.query<Row>(
        `SELECT w.id, w.code, w.title, w.assignee_user_id, w.planned_end, w.status,
                p.code AS project_code, p.name AS project_name,
                ($2::date - w.planned_end)::text AS days_late
           FROM workspace_schema.work_items w
           JOIN workspace_schema.projects p ON p.id = w.project_id
          WHERE w.project_id = ANY($1::uuid[])
            AND w.status NOT IN ('done','cancelled')
            AND w.planned_end IS NOT NULL
            AND w.planned_end < $2::date
            ${selfClause}
          ORDER BY w.planned_end
          LIMIT $${values.length}`,
        values,
      );
      return result.rows.map((row) => ({
        workItemId: str(row.id),
        code: str(row.code),
        title: str(row.title),
        projectCode: str(row.project_code),
        projectName: str(row.project_name),
        assigneeUserId: opt(row.assignee_user_id),
        plannedEnd: day(row.planned_end) as string,
        daysLate: num(row.days_late),
        status: str(row.status) as WorkItemStatus,
      }));
    },
  };

  readonly externalRef = {
    listByEntity: async (
      tenantId: string,
      entityType: 'project' | 'work_item',
      entityId: string,
    ): Promise<ExternalReference[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${EXTERNAL_REF_COLUMNS} FROM workspace_schema.external_references
          WHERE entity_type = $1 AND entity_id = $2
          ORDER BY created_at`,
        [entityType, entityId],
      );
      return result.rows.map(mapExternalRef);
    },

    listByProject: async (tenantId: string, projectId: string): Promise<ExternalReference[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${EXTERNAL_REF_COLUMNS} FROM workspace_schema.external_references
          WHERE project_id = $1
          ORDER BY created_at`,
        [projectId],
      );
      return result.rows.map(mapExternalRef);
    },

    findById: async (tenantId: string, referenceId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${EXTERNAL_REF_COLUMNS} FROM workspace_schema.external_references WHERE id = $1`,
        [referenceId],
      );
      const row = result.rows[0];
      return row ? mapExternalRef(row) : undefined;
    },

    upsert: async (
      tenantId: string,
      actorUserId: string,
      input: {
        entityType: 'project' | 'work_item';
        entityId: string;
        projectId: string;
        moduleKey: ExternalModuleKey;
        externalId: string;
        externalCode?: string | null;
        launchUrl: string;
        cachedLabel?: string | null;
        cachedStatus?: string | null;
      },
    ) => {
      const pool = await this.poolFor(tenantId);
      // Bước 5 của luồng quy trình có thể chạy lại khi người dùng bấm Thử
      // lại; `ON CONFLICT` giữ cho nó là thao tác lặp được, không sinh dòng
      // trùng.
      const result = await pool.query<Row>(
        `INSERT INTO workspace_schema.external_references
           (entity_type, entity_id, project_id, module_key, external_id, external_code,
            launch_url, cached_label, cached_status, synced_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)
         ON CONFLICT (entity_type, entity_id, module_key, external_id)
         DO UPDATE SET external_code = EXCLUDED.external_code,
                       launch_url    = EXCLUDED.launch_url,
                       cached_label  = COALESCE(EXCLUDED.cached_label, workspace_schema.external_references.cached_label),
                       cached_status = COALESCE(EXCLUDED.cached_status, workspace_schema.external_references.cached_status),
                       synced_at     = now(),
                       updated_at    = now()
         RETURNING ${EXTERNAL_REF_COLUMNS}`,
        [
          input.entityType,
          input.entityId,
          input.projectId,
          input.moduleKey,
          input.externalId,
          input.externalCode ?? null,
          input.launchUrl,
          input.cachedLabel ?? null,
          input.cachedStatus ?? null,
          actorUserId,
        ],
      );
      return mapExternalRef(result.rows[0] as Row);
    },

    refreshCache: async (
      tenantId: string,
      updates: readonly { id: string; cachedLabel?: string | null; cachedStatus?: string | null }[],
    ) => {
      if (updates.length === 0) return;
      const pool = await this.poolFor(tenantId);
      // Một câu cho cả lô bằng `unnest`, không phải N câu riêng lẻ.
      await pool.query(
        `UPDATE workspace_schema.external_references AS r
            SET cached_label  = COALESCE(v.label, r.cached_label),
                cached_status = COALESCE(v.status, r.cached_status),
                synced_at     = now(),
                updated_at    = now()
           FROM (SELECT unnest($1::uuid[]) AS id,
                        unnest($2::text[]) AS label,
                        unnest($3::text[]) AS status) AS v
          WHERE r.id = v.id`,
        [
          updates.map((entry) => entry.id),
          updates.map((entry) => entry.cachedLabel ?? null),
          updates.map((entry) => entry.cachedStatus ?? null),
        ],
      );
    },

    remove: async (tenantId: string, referenceId: string) => {
      const pool = await this.poolFor(tenantId);
      // Xoá cứng có chủ đích: dòng này chỉ là một liên kết. Gỡ con trỏ KHÔNG
      // tác động gì tới hồ sơ gốc ở module kia.
      await pool.query(`DELETE FROM workspace_schema.external_references WHERE id = $1`, [
        referenceId,
      ]);
    },
  };

  readonly finance = {
    inputs: async (
      tenantId: string,
      projectIds: readonly string[],
    ): Promise<Map<string, FinanceInputs>> => {
      if (projectIds.length === 0) return new Map();
      const pool = await this.poolFor(tenantId);
      // Một truy vấn cho cả danh sách dự án: trang Báo cáo cộng hàng chục dự
      // án, gọi từng cái là hàng chục lượt đi lại. `LEFT JOIN` để dự án chưa
      // có công việc nào vẫn trả một dòng với tổng bằng 0.
      // Hai phép SUM chạy bằng index-only scan trên `idx_work_items_project_costs`.
      const result = await pool.query<Row>(
        `SELECT p.id, p.contract_value, p.budget, p.committed_cost, p.forecast_cost_override,
                COALESCE(SUM(w.actual_cost), 0)::text AS actual_cost,
                COALESCE(SUM(w.estimated_cost)
                           FILTER (WHERE w.status NOT IN ('done','cancelled')), 0)::text
                  AS remaining_estimate
           FROM workspace_schema.projects p
           LEFT JOIN workspace_schema.work_items w ON w.project_id = p.id
          WHERE p.id = ANY($1::uuid[])
          GROUP BY p.id`,
        [projectIds],
      );
      return new Map(
        result.rows.map((row) => [
          str(row.id),
          {
            // `numeric` về client thành chuỗi; đổi sang số ngay tại biên.
            contractValue: optNum(row.contract_value) ?? null,
            budget: optNum(row.budget) ?? null,
            committedCost: num(row.committed_cost),
            forecastCostOverride: optNum(row.forecast_cost_override) ?? null,
            actualCost: num(row.actual_cost),
            remainingEstimate: num(row.remaining_estimate),
          },
        ]),
      );
    },

    itemCosts: async (tenantId: string, projectId: string): Promise<WorkItemCost[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT id, code, title, status, estimated_cost, actual_cost
           FROM workspace_schema.work_items
          WHERE project_id = $1
            AND item_type <> 'phase'
          ORDER BY code`,
        [projectId],
      );
      return result.rows.map((row) => ({
        workItemId: str(row.id),
        code: str(row.code),
        title: str(row.title),
        status: str(row.status) as WorkItemStatus,
        estimatedCost: optNum(row.estimated_cost) ?? null,
        actualCost: num(row.actual_cost),
      }));
    },

    updateProject: async (
      tenantId: string,
      projectId: string,
      input: UpdateProjectFinanceRequest,
    ) => {
      const pool = await this.poolFor(tenantId);
      const { clause, values } = buildSet(
        input as Record<string, unknown>,
        {
          contractValue: 'contract_value',
          budget: 'budget',
          committedCost: 'committed_cost',
          forecastCostOverride: 'forecast_cost_override',
        },
        1,
      );
      if (!clause) return;
      const result = await pool.query(
        `UPDATE workspace_schema.projects
            SET ${clause}, updated_at = now()
          WHERE id = $${values.length + 1}`,
        [...values, projectId],
      );
      if (result.rowCount === 0) throw new ProjectNotFoundError(projectId);
    },

    updateItem: async (tenantId: string, workItemId: string, input: UpdateWorkItemCostRequest) => {
      const pool = await this.poolFor(tenantId);
      const { clause, values } = buildSet(
        input as Record<string, unknown>,
        // Chi phí thực tế không sửa thẳng được nữa — chỉ qua `addCostEntry`.
        { estimatedCost: 'estimated_cost' },
        1,
      );
      if (!clause) return;
      const result = await pool.query(
        `UPDATE workspace_schema.work_items
            SET ${clause}, updated_at = now()
          WHERE id = $${values.length + 1}`,
        [...values, workItemId],
      );
      if (result.rowCount === 0) throw new WorkItemNotFoundError(workItemId);
    },

    addCostEntry: async (
      tenantId: string,
      actorUserId: string,
      input: { workItemId: string; projectId: string; amount: number; note: string },
    ): Promise<CostEntry> => {
      const pool = await this.poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        // Khoá dòng công việc: hai người ghi chi phí cùng lúc phải xếp hàng,
        // nếu không cả hai cùng đọc một tổng cũ và cùng kiểm "không âm" sai.
        const locked = await client.query<{ actual_cost: string; code: string; title: string }>(
          `SELECT actual_cost, code, title FROM workspace_schema.work_items WHERE id = $1 FOR UPDATE`,
          [input.workItemId],
        );
        const current = locked.rows[0];
        if (!current) throw new WorkItemNotFoundError(input.workItemId);
        if (num(current.actual_cost) + input.amount < 0) {
          throw new WorkspaceValidationError(
            'Điều chỉnh này làm tổng chi phí thực tế của công việc bị âm.',
          );
        }

        const inserted = await client.query<Row>(
          `INSERT INTO workspace_schema.cost_entries
             (work_item_id, project_id, amount, note, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, work_item_id, project_id, amount, note, created_by, created_at`,
          [input.workItemId, input.projectId, input.amount, input.note, actorUserId],
        );
        // Cột tổng cập nhật cùng transaction: sổ và tổng không bao giờ lệch.
        await client.query(
          `UPDATE workspace_schema.work_items
              SET actual_cost = actual_cost + $2, updated_at = now()
            WHERE id = $1`,
          [input.workItemId, input.amount],
        );
        return mapCostEntry({ ...(inserted.rows[0] as Row), code: current.code, title: current.title });
      });
    },

    listCostEntries: async (
      tenantId: string,
      filter: { workItemId?: string; projectId?: string },
      limit: number,
    ): Promise<CostEntry[]> => {
      const pool = await this.poolFor(tenantId);
      const column = filter.workItemId ? 'e.work_item_id' : 'e.project_id';
      const value = filter.workItemId ?? filter.projectId;
      if (!value) return [];
      const result = await pool.query<Row>(
        `SELECT e.id, e.work_item_id, e.project_id, e.amount, e.note, e.created_by, e.created_at,
                w.code, w.title
           FROM workspace_schema.cost_entries e
           JOIN workspace_schema.work_items w ON w.id = e.work_item_id
          WHERE ${column} = $1
          ORDER BY e.created_at DESC
          LIMIT $2`,
        [value, limit],
      );
      return result.rows.map(mapCostEntry);
    },
  };
  readonly history = {
    listByWorkItem: async (
      tenantId: string,
      workItemId: string,
      limit: number,
    ): Promise<WorkItemStatusHistoryEntry[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT id, work_item_id, from_status, to_status, note, created_by, created_at
           FROM workspace_schema.work_item_status_history
          WHERE work_item_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [workItemId, limit],
      );
      return result.rows.map(mapHistory);
    },

    listByProject: async (
      tenantId: string,
      projectId: string,
      limit: number,
    ): Promise<WorkItemStatusHistoryEntry[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT id, work_item_id, from_status, to_status, note, created_by, created_at
           FROM workspace_schema.work_item_status_history
          WHERE project_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [projectId, limit],
      );
      return result.rows.map(mapHistory);
    },
  };
}

/* =========================================================================
   TRỢ GIÚP CHO LỊCH BIỂU

   Đặt ngoài lớp vì chúng chạy TRÊN MỘT `PoolClient` đã ở trong transaction,
   không tự mở kết nối. Gọi chúng ngoài transaction là sai cách dùng.
   ========================================================================= */

async function readParticipants(client: PoolClient, eventId: string) {
  const result = await client.query<Row>(
    `SELECT id, event_id, user_id, response_status, is_organizer, responded_at
       FROM workspace_schema.calendar_event_participants
      WHERE event_id = $1
      ORDER BY is_organizer DESC, created_at`,
    [eventId],
  );
  return result.rows.map(mapParticipant);
}

/**
 * Đặt lại danh sách người tham dự.
 *
 * Người tổ chức luôn có mặt và luôn `accepted`: không gỡ được khỏi sự kiện
 * của chính mình, và không phải tự bấm đồng ý với lời mời mình gửi đi.
 */
async function replaceParticipants(
  client: PoolClient,
  eventId: string,
  organizerUserId: string,
  userIds: readonly string[],
  actorUserId: string,
): Promise<void> {
  const keep = [...new Set([organizerUserId, ...userIds])];

  await client.query(
    `DELETE FROM workspace_schema.calendar_event_participants
      WHERE event_id = $1 AND NOT (user_id = ANY($2::uuid[]))`,
    [eventId, keep],
  );

  for (const userId of keep) {
    const isOrganizer = userId === organizerUserId;
    await client.query(
      `INSERT INTO workspace_schema.calendar_event_participants
         (event_id, user_id, response_status, is_organizer, responded_at, created_by)
       VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN now() ELSE NULL END, $5)
       ON CONFLICT (event_id, user_id) DO UPDATE
         SET is_organizer = EXCLUDED.is_organizer, updated_at = now()`,
      [eventId, userId, isOrganizer ? 'accepted' : 'needs_action', isOrganizer, actorUserId],
    );
  }
}

/* =========================================================================
   OUTBOX

   Sự kiện ghi vào `integration_schema.outbox_events` TRONG CÙNG transaction
   với dữ liệu nghiệp vụ. Ghi sau khi commit là một cửa sổ mà dữ liệu đã đổi
   nhưng không ai được báo — tiến trình chết đúng lúc đó là mất sự kiện vĩnh
   viễn. Tiến trình `worker` đọc bảng này và đẩy sang RabbitMQ.

   Workspace chỉ PHÁT, không tiêu thụ sự kiện nào.
   ========================================================================= */

interface OutboxInput {
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Chạy một lệnh ghi, đổi lỗi vi phạm `UNIQUE` (`23505`) thành lỗi nghiệp vụ.
 *
 * Tầng ứng dụng thường kiểm trùng trước để trả thông điệp sớm, nhưng hai
 * request vào cùng lúc vẫn cùng qua được bước kiểm đó; khi ấy chính ràng
 * buộc trong CSDL là thứ chặn lại, và người dùng phải nhận `409`, không phải
 * một lỗi 500 khó hiểu.
 */
async function onUniqueViolation<TValue>(
  work: () => Promise<TValue>,
  toError: () => Error,
): Promise<TValue> {
  try {
    return await work();
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '23505') throw toError();
    throw error;
  }
}

async function writeOutbox(
  client: PoolClient,
  tenantId: string,
  input: OutboxInput,
): Promise<void> {
  const event = createIntegrationEvent({
    id: randomUUID(),
    type: input.type,
    version: 1,
    tenantId,
    source: 'workspace',
    correlationId: input.aggregateId,
    payload: input.payload,
  });
  await client.query(
    `INSERT INTO integration_schema.outbox_events
       (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      event.id,
      input.aggregateType,
      input.aggregateId,
      event.type,
      event.version,
      JSON.stringify(event),
      event.occurredAt,
    ],
  );
}

function assignedEvent(item: WorkItem, previousAssignee: string | undefined): OutboxInput {
  return {
    type: 'workspace.work-item.assigned',
    aggregateType: 'workspace-work-item',
    aggregateId: item.id,
    payload: {
      workItemId: item.id,
      projectId: item.projectId,
      code: item.code,
      title: item.title,
      assigneeUserId: item.assigneeUserId,
      previousAssigneeUserId: previousAssignee ?? null,
      plannedEnd: item.plannedEnd ?? null,
    },
  };
}

/**
 * Tạo tài liệu và thêm phiên bản đều là "phát hành".
 *
 * `storage_key` KHÔNG nằm trong payload: sự kiện đi ra khỏi module, còn khoá
 * object thì không bao giờ được rời server dưới dạng thô.
 */
function publishedEvent(document: WorkspaceDocument, version: DocumentVersion): OutboxInput {
  return {
    type: 'workspace.document.published',
    aggregateType: 'workspace-document',
    aggregateId: document.id,
    payload: {
      documentId: document.id,
      projectId: document.projectId ?? null,
      name: document.name,
      versionId: version.id,
      versionNo: version.versionNo,
      fileName: version.fileName,
      uploadedBy: version.uploadedBy,
    },
  };
}
