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
import type { FinanceInputs } from '../domain/finance.rules.js';

/**
 * Cổng dữ liệu của Workspace.
 *
 * Interface chia theo namespace con cho từng nhóm nghiệp vụ, đúng như
 * `InventoryStore`. Mọi phương thức nhận `tenantId` làm tham số đầu tiên —
 * store tự phân giải connection pool của đúng tenant từ đó.
 *
 * Token là CHUỖI, không phải Symbol: quy ước của repo dành Symbol cho các
 * port HTTP gọi sang module khác (xem `asset-directory.port.ts` của
 * Maintenance), còn store Postgres của chính module dùng chuỗi.
 */
export const WORKSPACE_STORE = 'WORKSPACE_STORE';

/** Kết quả kiểm tra tenant đã được cài đặt tới đâu. */
export interface WorkspaceSchemaStatus {
  readonly schemaExists: boolean;
  readonly tablesReady: boolean;
}

/** Số liệu tổng hợp của một dự án, tính bằng SQL để không phải tải cả cây. */
export interface ProjectRollup {
  readonly projectId: string;
  readonly totalItems: number;
  readonly closedItems: number;
  readonly overdueItems: number;
}

/** Dữ liệu tối thiểu để tính lại tiến độ, tránh kéo cả bản ghi công việc. */
export interface WorkItemProgressRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly status: WorkItemStatus;
  readonly progressPercent: number;
  readonly estimateHours: number | null;
}


/** Một dòng ngoại lệ của chuỗi lặp. */
export interface EventException {
  readonly id: string;
  readonly seriesId: string;
  readonly occurrenceDate: string;
  readonly exceptionType: 'cancelled' | 'moved';
  readonly replacementEventId?: string;
}

/** Dữ liệu ghi một sự kiện; phần suy ra được tầng application tính sẵn. */
export interface EventWriteModel {
  readonly projectId?: string | null;
  readonly workItemId?: string | null;
  readonly seriesId?: string | null;
  readonly title: string;
  readonly description?: string | null;
  readonly location?: string | null;
  readonly eventType: EventType;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly allDay: boolean;
  readonly timezone: string;
  readonly recurrenceRule?: string | null;
  readonly recurrenceUntil?: Date | null;
  readonly recurrenceCount?: number | null;
}

/** Sự kiện của một người trong một khoảng; dùng để cảnh báo trùng lịch người. */
export interface ParticipantBusySlot {
  readonly userId: string;
  readonly eventId: string;
  readonly startAt: string;
  readonly endAt: string;
}


/** Một việc đang giao cho tôi, kèm nhãn dự án lấy sẵn bằng JOIN. */
export interface MyWorkAssignedRow {
  readonly item: WorkItem;
  readonly projectCode: string;
  readonly projectName: string;
}

/**
 * Phạm vi báo cáo, dịch từ vai trò sang điều kiện SQL.
 *
 * `tenant` bỏ hàng rào thành viên; `managed` giới hạn ở những dự án người gọi
 * là `owner` hoặc `manager`; `self` là mọi dự án người gọi tham gia, nhưng số
 * liệu bị kẹp về chính họ.
 */
export interface ReportScopeFilter {
  readonly level: 'self' | 'managed' | 'tenant';
  readonly userId: string;
  /** Người gọi tự giới hạn vào vài dự án; rỗng nghĩa là cả phạm vi. */
  readonly projectIds?: readonly string[];
}

/** Số tin chưa đọc của một node, trước khi cuộn lên nhánh cha. */
export interface UnreadRow {
  readonly entityType: ChatEntityType;
  readonly entityId: string;
  readonly unread: number;
}

export interface WorkspaceStore {
  readonly diagnostics: {
    schemaStatus(tenantId: string): Promise<WorkspaceSchemaStatus>;
  };

  readonly project: {
    /**
     * Danh sách dự án người dùng được xem.
     *
     * `userId` rỗng nghĩa là quản trị viên tenant: bỏ điều kiện lọc theo
     * thành viên và trả toàn bộ dự án.
     */
    list(
      tenantId: string,
      options: {
        readonly userId?: string;
        readonly search?: string;
        readonly status?: ProjectStatus;
        readonly page: number;
        readonly pageSize: number;
      },
    ): Promise<{ readonly items: readonly Project[]; readonly total: number }>;
    findById(tenantId: string, projectId: string): Promise<Project | undefined>;
    findByCode(tenantId: string, code: string): Promise<Project | undefined>;
    /** `today` là `YYYY-MM-DD` theo múi giờ tenant — mốc để đếm việc quá hạn. */
    rollup(
      tenantId: string,
      projectIds: readonly string[],
      today: string,
    ): Promise<readonly ProjectRollup[]>;
    /** Tạo dự án và ghi người tạo làm `owner` trong cùng một transaction. */
    create(
      tenantId: string,
      actorUserId: string,
      input: CreateProjectRequest,
    ): Promise<Project>;
    update(
      tenantId: string,
      projectId: string,
      input: UpdateProjectRequest,
    ): Promise<Project>;
    updateProgress(tenantId: string, projectId: string, percent: number): Promise<void>;
  };

  readonly member: {
    list(tenantId: string, projectId: string): Promise<readonly ProjectMember[]>;
    /** Vai trò của một người trong một dự án; rỗng nghĩa là không phải thành viên. */
    roleOf(
      tenantId: string,
      projectId: string,
      userId: string,
    ): Promise<ProjectRole | undefined>;
    replaceAll(
      tenantId: string,
      projectId: string,
      actorUserId: string,
      members: readonly { readonly userId: string; readonly role: ProjectRole }[],
    ): Promise<readonly ProjectMember[]>;
    /** Số việc chưa đóng mà những người này đang phụ trách trong dự án. */
    openItemCounts(
      tenantId: string,
      projectId: string,
      userIds: readonly string[],
    ): Promise<ReadonlyMap<string, number>>;
  };

  readonly workItem: {
    /** Toàn bộ cây của một dự án, trả phẳng và đã sắp theo depth rồi sortOrder. */
    listByProject(tenantId: string, projectId: string): Promise<readonly WorkItem[]>;
    findById(tenantId: string, workItemId: string): Promise<WorkItem | undefined>;
    /** Dữ liệu rút gọn cho việc cuộn tiến độ. */
    progressRows(tenantId: string, projectId: string): Promise<readonly WorkItemProgressRow[]>;
    /** Số việc con chưa đóng; dùng để chặn đóng node cha còn dở dang. */
    openChildCount(tenantId: string, workItemId: string): Promise<number>;
    /**
     * Tạo công việc. Mã `CV-xxx` do store sinh BÊN TRONG transaction, sau khi
     * khoá theo dự án — sinh ở ngoài rồi truyền vào thì hai người tạo việc cùng
     * lúc sẽ nhận cùng một mã.
     */
    create(
      tenantId: string,
      actorUserId: string,
      input: CreateWorkItemRequest & {
        readonly depth: number;
        readonly sortOrder: number;
      },
    ): Promise<WorkItem>;
    update(
      tenantId: string,
      workItemId: string,
      input: UpdateWorkItemRequest,
    ): Promise<WorkItem>;
    /** Đổi trạng thái, ghi mốc thực tế và nhật ký trong cùng một transaction. */
    changeStatus(
      tenantId: string,
      workItemId: string,
      actorUserId: string,
      next: WorkItemStatus,
      note: string | undefined,
      /** Ngày ghi vào `actual_start`/`actual_end`, theo múi giờ tenant. */
      today: string,
    ): Promise<WorkItem>;
    /** Đổi cha và thứ tự; cập nhật `depth` cho cả nhánh con bên dưới. */
    move(
      tenantId: string,
      workItemId: string,
      parentId: string | null,
      sortOrder: number,
      depthDelta: number,
    ): Promise<WorkItem>;
    applyProgress(tenantId: string, updates: ReadonlyMap<string, number>): Promise<void>;
  };

  readonly dependency: {
    listByProject(tenantId: string, projectId: string): Promise<readonly WorkItemDependency[]>;
    listBySuccessor(
      tenantId: string,
      successorId: string,
    ): Promise<readonly WorkItemDependency[]>;
    add(
      tenantId: string,
      actorUserId: string,
      input: {
        readonly projectId: string;
        readonly predecessorId: string;
        readonly successorId: string;
        readonly dependencyType: DependencyType;
        readonly lagDays: number;
      },
    ): Promise<WorkItemDependency>;
    remove(tenantId: string, dependencyId: string): Promise<void>;
  };

  readonly calendar: {
    /**
     * Sự kiện có khả năng rơi vào khoảng `[from, to]`.
     *
     * Chuỗi lặp KHÔNG lọc được bằng `start_at` đơn thuần: một chuỗi bắt đầu
     * từ năm ngoái vẫn có buổi trong tuần này. Vì vậy truy vấn lấy cả sự
     * kiện đơn lẻ giao khoảng lẫn mọi chuỗi chưa kết thúc, rồi tầng domain
     * khai triển và lọc lại.
     */
    listCandidates(
      tenantId: string,
      options: {
        readonly from: Date;
        readonly to: Date;
        readonly projectId?: string;
        readonly userId?: string;
      },
    ): Promise<readonly CalendarEvent[]>;
    findEvent(tenantId: string, eventId: string): Promise<CalendarEvent | undefined>;
    /** Ngoại lệ của nhiều chuỗi cùng lúc; tránh gọi từng chuỗi khi vẽ lưới. */
    listExceptions(
      tenantId: string,
      seriesIds: readonly string[],
    ): Promise<readonly EventException[]>;

    /** Tạo sự kiện và gán người tham dự trong MỘT transaction. */
    createEvent(
      tenantId: string,
      actorUserId: string,
      input: EventWriteModel,
      participantUserIds: readonly string[],
    ): Promise<{
      readonly event: CalendarEvent;
      readonly participants: readonly EventParticipant[];
    }>;
    updateEvent(
      tenantId: string,
      actorUserId: string,
      eventId: string,
      input: Partial<EventWriteModel>,
      participantUserIds: readonly string[] | undefined,
    ): Promise<{
      readonly event: CalendarEvent;
      readonly participants: readonly EventParticipant[];
    }>;
    /** Huỷ là chuyển `cancelled`, không xoá dòng. */
    cancelEvent(tenantId: string, eventId: string): Promise<CalendarEvent>;

    listParticipants(tenantId: string, eventId: string): Promise<readonly EventParticipant[]>;
    respond(
      tenantId: string,
      eventId: string,
      userId: string,
      response: ParticipantResponse,
    ): Promise<EventParticipant>;
    /** Những người này đang bận vào khoảng nào, bỏ qua chính sự kiện đang sửa. */
    busySlots(
      tenantId: string,
      userIds: readonly string[],
      from: Date,
      to: Date,
      excludeEventId?: string,
    ): Promise<readonly ParticipantBusySlot[]>;

    /** Ghi ngoại lệ `cancelled` hoặc `moved` cho một buổi của chuỗi. */
    addException(
      tenantId: string,
      actorUserId: string,
      input: {
        readonly seriesId: string;
        readonly occurrenceDate: string;
        readonly exceptionType: 'cancelled' | 'moved';
        readonly replacementEventId?: string;
      },
    ): Promise<EventException>;
  };

  readonly document: {
    listFolders(tenantId: string, projectId?: string): Promise<readonly DocumentFolder[]>;
    findFolder(tenantId: string, folderId: string): Promise<DocumentFolder | undefined>;
    createFolder(
      tenantId: string,
      actorUserId: string,
      input: {
        readonly projectId?: string | null;
        readonly parentId?: string | null;
        readonly name: string;
        readonly depth: number;
      },
    ): Promise<DocumentFolder>;

    /**
     * Gỡ một thư mục khỏi cây: `is_active = false`, không xoá dòng.
     *
     * Giữ dòng lại thì nhật ký truy cập và tài liệu đã lưu trữ vẫn còn đường
     * dẫn để tra ngược; xoá cứng sẽ để lại một chuỗi id trỏ vào hư không.
     */
    deactivateFolder(tenantId: string, folderId: string): Promise<void>;

    /** Số tài liệu còn hoạt động trong thư mục, để chặn xoá nhầm. */
    countActiveDocuments(tenantId: string, folderId: string): Promise<number>;

    list(
      tenantId: string,
      options: {
        readonly projectId?: string;
        readonly folderId?: string;
        readonly status?: DocumentStatus;
        readonly search?: string;
        /** Chỉ tài liệu đã gắn vào thực thể này. */
        readonly linkedTo?: {
          readonly entityType: DocumentLinkEntityType;
          readonly entityId: string;
        };
      },
    ): Promise<readonly DocumentSummary[]>;
    findById(tenantId: string, documentId: string): Promise<WorkspaceDocument | undefined>;
    listVersions(tenantId: string, documentId: string): Promise<readonly DocumentVersion[]>;
    findVersion(tenantId: string, versionId: string): Promise<DocumentVersion | undefined>;
    /**
     * `storage_key` chỉ ra khỏi store ở đúng lời gọi này.
     *
     * Mọi nơi khác nhận `DocumentVersion` đã lược bỏ nó — client chỉ được
     * thấy URL đã ký, không bao giờ thấy khoá thô.
     */
    storageKeyOf(tenantId: string, versionId: string): Promise<string | undefined>;
    /**
     * Ghi `size_bytes` khi trình duyệt báo đã tải lên xong.
     *
     * Chỉ ghi khi cột còn rỗng — gọi lại lần hai trả nguyên phiên bản, không
     * đổi con số đã ghi.
     */
    completeVersion(
      tenantId: string,
      versionId: string,
      sizeBytes: number,
    ): Promise<DocumentVersion | undefined>;

    /**
     * Tạo tài liệu và phiên bản 1 trong MỘT transaction.
     *
     * Khoá ngoại `current_version_id` là DEFERRABLE INITIALLY DEFERRED nên
     * chèn được dòng `documents` trước khi phiên bản tồn tại.
     */
    create(
      tenantId: string,
      actorUserId: string,
      input: {
        readonly folderId: string;
        readonly projectId?: string | null;
        readonly name: string;
        readonly description?: string | null;
        readonly storageKey: string;
        readonly fileName: string;
        readonly contentType: string;
        readonly sizeBytes?: number | null;
        readonly changeNote?: string | null;
      },
    ): Promise<{ readonly document: WorkspaceDocument; readonly version: DocumentVersion }>;

    /** Thêm phiên bản mới và chuyển `current_version_id` sang nó. */
    addVersion(
      tenantId: string,
      actorUserId: string,
      input: {
        readonly documentId: string;
        readonly versionNo: number;
        readonly storageKey: string;
        readonly fileName: string;
        readonly contentType: string;
        readonly sizeBytes?: number | null;
        readonly changeNote: string;
      },
    ): Promise<DocumentVersion>;

    archive(tenantId: string, documentId: string): Promise<WorkspaceDocument>;
    /** `userId` rỗng nghĩa là mở khoá. */
    setLock(
      tenantId: string,
      documentId: string,
      userId: string | null,
    ): Promise<WorkspaceDocument>;

    listLinks(tenantId: string, documentId: string): Promise<readonly DocumentLink[]>;
    addLink(
      tenantId: string,
      actorUserId: string,
      input: {
        readonly documentId: string;
        readonly entityType: DocumentLinkEntityType;
        readonly entityId: string;
      },
    ): Promise<DocumentLink>;
    removeLink(tenantId: string, linkId: string): Promise<void>;

    /** Bảng chỉ ghi thêm; phục vụ yêu cầu kiểm toán. */
    log(
      tenantId: string,
      actorUserId: string,
      input: {
        readonly documentId: string;
        readonly versionId?: string | null;
        readonly action: DocumentAccessAction;
      },
    ): Promise<void>;
  };

  readonly chat: {
    /** Kênh của một node; rỗng nghĩa là chưa ai nhắn gì ở đó. */
    findChannelById(tenantId: string, channelId: string): Promise<ChatChannel | undefined>;
    findChannel(
      tenantId: string,
      entityType: ChatEntityType,
      entityId: string,
    ): Promise<ChatChannel | undefined>;
    /**
     * Lấy kênh, tạo nếu chưa có.
     *
     * Tạo lười: dự án lớn có hàng nghìn node, tạo sẵn kênh cho tất cả sẽ sinh
     * hàng nghìn dòng rỗng. `ON CONFLICT` xử lý hai người cùng gửi tin đầu tiên.
     */
    ensureChannel(
      tenantId: string,
      actorUserId: string,
      input: {
        readonly entityType: ChatEntityType;
        readonly entityId: string;
        readonly projectId: string;
      },
    ): Promise<ChatChannel>;
    listMessages(
      tenantId: string,
      channelId: string,
      limit: number,
    ): Promise<readonly ChatMessage[]>;
    findMessage(tenantId: string, messageId: string): Promise<ChatMessage | undefined>;
    /** Ghi tin và cập nhật `last_message_at` của kênh trong cùng transaction. */
    sendMessage(
      tenantId: string,
      actorUserId: string,
      input: {
        readonly channelId: string;
        readonly parentId?: string | null;
        readonly body: string;
        readonly mentions: readonly string[];
        readonly attachmentDocumentId?: string | null;
      },
    ): Promise<ChatMessage>;
    editMessage(
      tenantId: string,
      messageId: string,
      body: string,
      mentions: readonly string[],
    ): Promise<ChatMessage>;
    /** Xoá mềm: dòng ở lại để các trả lời bên dưới không mất ngữ cảnh. */
    softDeleteMessage(tenantId: string, messageId: string): Promise<ChatMessage>;

    /**
     * Số tin chưa đọc của mọi node trong một dự án, trong MỘT truy vấn.
     *
     * Gọi từng node sẽ là hàng trăm lượt đi lại chỉ để tô chấm đỏ.
     */
    unreadByProject(
      tenantId: string,
      projectId: string,
      userId: string,
    ): Promise<readonly UnreadRow[]>;
    markRead(tenantId: string, channelId: string, userId: string): Promise<void>;
  };

  /**
   * Lớp truy vấn tổng hợp cho trang "Công việc của tôi".
   *
   * Không có bảng riêng — mọi thứ đọc thẳng từ dữ liệu đã có. `userId` luôn
   * là danh tính do guard gắn vào request; store không có đường nào nhận id
   * từ client.
   */
  readonly myWork: {
    /** Việc đang mở được giao cho tôi, kèm mã và tên dự án. */
    assignedItems(
      tenantId: string,
      userId: string,
    ): Promise<readonly MyWorkAssignedRow[]>;
    /** Số việc tôi đã đóng trong khoảng; nuôi ô "hoàn thành tuần này". */
    completedCount(tenantId: string, userId: string, from: Date, to: Date): Promise<number>;
    /**
     * Sự kiện **gốc** tôi có mặt mà có thể có buổi rơi vào khoảng, bỏ những
     * lời mời đã từ chối.
     *
     * Trả chuỗi lặp chưa khai triển, như `calendar.listCandidates`: chỉ tầng
     * domain biết một chuỗi bắt đầu từ tháng trước có buổi nào hôm nay không.
     */
    eventsForUser(
      tenantId: string,
      userId: string,
      from: Date,
      to: Date,
    ): Promise<
      readonly { readonly event: CalendarEvent; readonly responseStatus: ParticipantResponse }[]
    >;
    /** Lời mời chưa phản hồi, kể cả sự kiện tương lai xa. */
    pendingInvitations(tenantId: string, userId: string): Promise<readonly MyWorkEvent[]>;
    /** Những lượt nhắc tên tôi gần đây, mới nhất trước. */
    mentions(
      tenantId: string,
      userId: string,
      limit: number,
    ): Promise<readonly MyWorkMention[]>;
    /** Con trỏ sang module khác, gắn trên công việc đang giao cho tôi. */
    externalCards(
      tenantId: string,
      userId: string,
    ): Promise<readonly MyWorkExternalCard[]>;
  };

  /**
   * Báo cáo tổng hợp.
   *
   * Mọi phương thức nhận `scope` và nhúng nó **thẳng vào câu SQL**. Lấy hết
   * dữ liệu về rồi lọc ở tầng ứng dụng vừa chậm vừa dễ sót một nhánh —
   * và một nhánh sót ở đây nghĩa là rò rỉ số liệu sang dự án người dùng
   * không được xem.
   */
  readonly report: {
    /** Những dự án nằm trong phạm vi người gọi được xem. */
    scopedProjectIds(
      tenantId: string,
      scope: ReportScopeFilter,
    ): Promise<readonly string[]>;
    /** `today` là `YYYY-MM-DD` theo múi giờ tenant, như các báo cáo còn lại. */
    myBlock(
      tenantId: string,
      userId: string,
      from: Date,
      to: Date,
      today: string,
    ): Promise<{
      readonly openItems: number;
      readonly overdueItems: number;
      readonly completedInPeriod: number;
    }>;
    projectProgress(
      tenantId: string,
      projectIds: readonly string[],
      today: string,
    ): Promise<readonly ProjectProgressRow[]>;
    /**
     * Tải công việc theo người.
     *
     * `onlySelfUserId` có giá trị thì chỉ trả dòng của chính người đó —
     * `member` và `viewer` không được nhìn khối lượng của đồng nghiệp.
     */
    workload(
      tenantId: string,
      projectIds: readonly string[],
      today: string,
      weekEnd: string,
      onlySelfUserId?: string,
    ): Promise<readonly WorkloadRow[]>;
    overdue(
      tenantId: string,
      projectIds: readonly string[],
      today: string,
      onlySelfUserId: string | undefined,
      limit: number,
    ): Promise<readonly OverdueRow[]>;
  };

  /**
   * Con trỏ sang module khác.
   *
   * Chỉ lưu con trỏ và nhãn hiển thị, KHÔNG sao chép nội dung nghiệp vụ của
   * module khác. Gỡ con trỏ là xoá cứng — ngoại lệ hợp lý so với quy ước
   * không xoá cứng, vì dòng này không mang giá trị nghiệp vụ.
   */
  readonly externalRef: {
    listByEntity(
      tenantId: string,
      entityType: 'project' | 'work_item',
      entityId: string,
    ): Promise<readonly ExternalReference[]>;
    listByProject(tenantId: string, projectId: string): Promise<readonly ExternalReference[]>;
    findById(tenantId: string, referenceId: string): Promise<ExternalReference | undefined>;
    /** Gắn lại cùng một hồ sơ thì cập nhật nhãn, không sinh dòng thứ hai. */
    upsert(
      tenantId: string,
      actorUserId: string,
      input: {
        readonly entityType: 'project' | 'work_item';
        readonly entityId: string;
        readonly projectId: string;
        readonly moduleKey: ExternalModuleKey;
        readonly externalId: string;
        readonly externalCode?: string | null;
        readonly launchUrl: string;
        readonly cachedLabel?: string | null;
        readonly cachedStatus?: string | null;
      },
    ): Promise<ExternalReference>;
    /** Ghi lại nhãn vừa đọc được từ module gốc, kèm mốc `synced_at`. */
    refreshCache(
      tenantId: string,
      updates: readonly {
        readonly id: string;
        readonly cachedLabel?: string | null;
        readonly cachedStatus?: string | null;
      }[],
    ): Promise<void>;
    remove(tenantId: string, referenceId: string): Promise<void>;
  };

  /**
   * Số liệu tài chính thô.
   *
   * Chỉ cộng bằng SQL; các giá trị dẫn xuất (dự kiến, lợi nhuận, biên) do
   * `domain/finance.rules.ts` tính — một chỗ duy nhất có công thức.
   */
  readonly finance: {
    /** Số liệu thô của nhiều dự án cùng lúc; dùng cho cả trang Báo cáo. */
    inputs(
      tenantId: string,
      projectIds: readonly string[],
    ): Promise<ReadonlyMap<string, FinanceInputs>>;
    itemCosts(tenantId: string, projectId: string): Promise<readonly WorkItemCost[]>;
    updateProject(
      tenantId: string,
      projectId: string,
      input: UpdateProjectFinanceRequest,
    ): Promise<void>;
    updateItem(
      tenantId: string,
      workItemId: string,
      input: UpdateWorkItemCostRequest,
    ): Promise<void>;
    /**
     * Ghi một dòng sổ chi phí và cộng vào `work_items.actual_cost` trong CÙNG
     * transaction, sau khi khoá dòng công việc. Tổng bị âm thì từ chối.
     */
    addCostEntry(
      tenantId: string,
      actorUserId: string,
      input: {
        readonly workItemId: string;
        readonly projectId: string;
        readonly amount: number;
        readonly note: string;
      },
    ): Promise<CostEntry>;
    /** Mới nhất trước. Lọc theo công việc hoặc theo cả dự án. */
    listCostEntries(
      tenantId: string,
      filter: { readonly workItemId?: string; readonly projectId?: string },
      limit: number,
    ): Promise<readonly CostEntry[]>;
  };

  readonly history: {
    listByWorkItem(
      tenantId: string,
      workItemId: string,
      limit: number,
    ): Promise<readonly WorkItemStatusHistoryEntry[]>;
    listByProject(
      tenantId: string,
      projectId: string,
      limit: number,
    ): Promise<readonly WorkItemStatusHistoryEntry[]>;
  };
}
