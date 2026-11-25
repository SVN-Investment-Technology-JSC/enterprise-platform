import {
  DEFAULT_CORRESPONDENCE_SETTINGS,
  LETTER_DIRECTIONS,
  LETTER_STAGES,
  LETTER_STAGE_LABELS,
  OPEN_LETTER_STAGES,
  isOpenStage,
  stepTypeOf,
  type ArchiveDossier,
  type ArchiveTree,
  type CorrespondenceConfig,
  type CorrespondenceDirectory,
  type CorrespondenceOverview,
  type CorrespondenceReport,
  type CorrespondenceReportRow,
  type CorrespondenceStatus,
  type LetterDirection,
  type LetterQuery,
  type LetterStage,
  type LetterSummary,
  type StepType,
  type StepChoice,
} from '@enterprise-platform/contracts-correspondence';
import { chooseCandidates } from '../../domain/approvers.js';
import {
  CorrespondenceForbiddenError,
  CorrespondenceValidationError,
  LetterNotFoundError,
} from '../../domain/correspondence.error.js';
import { awaitsViewer, canViewLetter, dossierFolderName } from '../../domain/letter-rules.js';
import { nodePath, unitMembers } from '../../domain/organization.js';
import { type CorrespondenceActor, type StepRecord } from '../ports.js';
import {
  LIST_LIMIT,
  OVERVIEW_LIMIT,
  REPORT_LIMIT,
  CORRESPONDENCE_FILING_ROOT,
  FOLDER_BY_DIRECTION,
  PLANNING_STAGES,
  AWAITING_STAGES,
  ARCHIVE_STAGES,
  type Row,
  applicableSteps,
  facts,
  sortedSteps,
  ownUnits,
  displayNo,
  optionalText,
  optionalDate,
  requireEnum,
  parseOptional,
} from '../core/letter-helpers.js';
import { CorrespondenceCore } from '../core/correspondence-core.js';

/** Tra cứu: trạng thái, cấu hình, danh sách, tổng quan, sổ, báo cáo, kho lưu trữ. */
export class LetterQueries extends CorrespondenceCore {
  async status(original: CorrespondenceActor): Promise<CorrespondenceStatus> {
    const actor = await this.effective(original);
    return {
      tenantId: actor.tenantId,
      userId: actor.userId,
      tablesReady: await this.store.tablesReady(actor.tenantId),
      capabilities: {
        isTenantAdmin: actor.isTenantAdmin,
        canRegister: actor.canRegister || actor.isTenantAdmin,
        canCreateOutgoing: actor.canCreateOutgoing || actor.isTenantAdmin,
        canPublish: actor.canPublish || actor.isTenantAdmin,
        canArchive: actor.canArchive || actor.isTenantAdmin,
        canDirect: actor.canDirect,
        canReadAll: actor.canReadAll || actor.isTenantAdmin,
        canReadConfidential: actor.canReadConfidential || actor.isTenantAdmin,
        canReadReports: actor.canReadReports || actor.isTenantAdmin,
        canConfigure: actor.canConfigure || actor.isTenantAdmin,
      },
    };
  }

  async config(actor: CorrespondenceActor): Promise<CorrespondenceConfig> {
    if (!(await this.store.tablesReady(actor.tenantId))) {
      return { settings: DEFAULT_CORRESPONDENCE_SETTINGS, catalog: [], workflows: [], registers: [] };
    }
    const [settings, catalog, workflows, registers] = await Promise.all([
      this.store.settings(actor.tenantId),
      this.store.catalog(actor.tenantId),
      this.store.workflows(actor.tenantId),
      this.store.registers(actor.tenantId),
    ]);
    return { settings, catalog, workflows, registers };
  }

  /** Sơ đồ tổ chức: phòng ban kèm thành viên và trưởng đơn vị, chức danh kèm người giữ. */
  async directory(actor: CorrespondenceActor): Promise<CorrespondenceDirectory> {
    const [snapshot, people, leaders] = await Promise.all([
      this.organization.snapshot(actor.tenantId),
      this.store.people(actor.tenantId),
      this.store.leaders(actor.tenantId),
    ]);
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const units = snapshot.nodes
      .filter((node) => node.kind === 'unit')
      .map((node) => ({
        id: node.id,
        name: node.name,
        parentId: node.parentId,
        path: nodePath(snapshot, node.id),
        members: unitMembers(snapshot, node.id).map((member) => ({
          userId: member.userId,
          name: member.name,
          positionName: member.positionName,
          isHead: member.isHead,
        })),
      }))
      .sort((left, right) => `${left.path} ${left.name}`.localeCompare(`${right.path} ${right.name}`, 'vi'));
    const positions = snapshot.nodes
      .filter((node) => node.kind === 'position')
      .map((node) => ({
        id: node.id,
        name: node.name,
        unitName: node.parentId ? byId.get(node.parentId)?.name : undefined,
        holderNames: snapshot.members.filter((member) => member.nodeId === node.id).map((member) => member.name),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'));
    return { units, positions, people, leaders, myUnitIds: ownUnits(snapshot, actor.userId), degraded: snapshot.degraded };
  }

  async list(actor: CorrespondenceActor, query: LetterQuery = {}): Promise<LetterSummary[]> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const box = query.box ?? 'incoming';
    const stage = parseOptional(query.stage, LETTER_STAGES, 'Bước xử lý');
    const rows = await this.store.listLetters(actor.tenantId, {
      visibleTo: this.visibility(viewer),
      direction: box === 'incoming' ? 'incoming' : box === 'outgoing' ? 'outgoing' : undefined,
      stages:
        box === 'archive' ? ARCHIVE_STAGES : box === 'mine' ? AWAITING_STAGES : box === 'tracking' ? OPEN_LETTER_STAGES : stage ? [stage] : undefined,
      search: query.search?.trim() || undefined,
      registerId: optionalText(query.registerId, 'Sổ đăng ký', 64),
      fromDate: optionalDate(query.fromDate, 'Từ ngày'),
      toDate: optionalDate(query.toDate, 'Đến ngày'),
      kind: optionalText(query.kind, 'Loại văn bản', 40),
      limit: LIST_LIMIT,
    });
    let visible = rows.filter((row) => canViewLetter(viewer, facts(row, catalog)));
    if (box === 'mine') visible = visible.filter((row) => awaitsViewer(viewer, facts(row, catalog)));
    // Theo dõi, đôn đốc: công văn còn mở có hạn, hạn gần nhất (quá hạn) lên đầu.
    if (box === 'tracking') {
      visible = visible.filter((row) => Boolean(row.dueOn)).sort((left, right) => (left.dueOn ?? '').localeCompare(right.dueOn ?? ''));
    }
    return this.summaries(actor, viewer, catalog, visible);
  }

  async overview(actor: CorrespondenceActor): Promise<CorrespondenceOverview> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const visibleTo = this.visibility(viewer);
    const [rows, archived] = await Promise.all([
      this.store.listLetters(actor.tenantId, { visibleTo, stages: AWAITING_STAGES, limit: OVERVIEW_LIMIT }),
      this.store.countArchived(actor.tenantId, visibleTo),
    ]);
    const visible = rows.filter((row) => canViewLetter(viewer, facts(row, catalog)));
    const open = visible.filter((row) => isOpenStage(row.stage));
    const today = this.today();
    const byStage: Record<LetterDirection, Partial<Record<LetterStage, number>>> = { incoming: {}, outgoing: {} };
    for (const row of open) byStage[row.direction][row.stage] = (byStage[row.direction][row.stage] ?? 0) + 1;
    const urgent = [...open]
      .sort((left, right) => (left.dueOn ?? '9999-12-31').localeCompare(right.dueOn ?? '9999-12-31'))
      .slice(0, 6);
    return {
      incomingOpen: open.filter((row) => row.direction === 'incoming').length,
      outgoingOpen: open.filter((row) => row.direction === 'outgoing').length,
      awaitingApproval: open.filter((row) => row.stage === 'reviewing').length,
      overdue: open.filter((row) => row.dueOn && row.dueOn < today).length,
      archived,
      awaitingMe: visible.filter((row) => awaitsViewer(viewer, facts(row, catalog))).length,
      byStage,
      urgent: await this.summaries(actor, viewer, catalog, urgent),
    };
  }

  /**
   * Ứng viên khi bước duyệt sắp tới để người thao tác chọn người duyệt (luật "chọn trong nhóm"):
   * bước kế tiếp của thao tác đang làm; bước kế tiếp là phòng ban xử lý thì bước duyệt ngay sau
   * nó (phòng ban gửi kết quả xong là tự chuyển, không ai chọn lúc đó). Không cần chọn thì `null`.
   */
  async stepChoice(actor: CorrespondenceActor, letterId: string, kind?: string): Promise<StepChoice | null> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const { letter, steps, assignments, row } = await this.loadRow(actor.tenantId, letterId);
    if (!canViewLetter(viewer, facts(row, catalog))) throw new LetterNotFoundError();
    let upcoming: readonly (Pick<StepRecord, 'name' | 'approver' | 'chosenUserId'> & { readonly kind: StepType })[] = [];
    if (PLANNING_STAGES.includes(letter.stage)) {
      const typeCode = kind && catalog.get('letter_type')?.has(kind) ? kind : letter.kind;
      const workflow = await this.pickWorkflow(actor.tenantId, { ...letter, kind: typeCode });
      upcoming = applicableSteps(workflow, { ...letter, kind: typeCode }).map((step) => ({ ...step, kind: stepTypeOf(step) }));
    } else if (letter.stage === 'reviewing' || letter.stage === 'checking') {
      const current = steps.find((step) => step.status === 'active');
      if (current) upcoming = sortedSteps(steps).filter((step) => step.seq > current.seq && step.status === 'waiting');
    }
    const target = upcoming[0]?.kind === 'process' ? upcoming[1] : upcoming[0];
    if (!target || target.kind !== 'approve' || target.approver?.type !== 'choose' || target.chosenUserId) return null;
    const context = await this.approverContext(actor.tenantId, letter, assignments);
    return { stepName: target.name, candidates: chooseCandidates(target.approver, context) };
  }

  /** Báo cáo theo năm: số công văn đến, đi, đã xong, trễ hạn theo tháng, loại văn bản, phòng ban. */
  /**
   * Sổ theo dõi công văn đến / đi của một năm, như bảng văn thư vẫn ghi tay: mọi công văn người xem được thấy,
   * công văn đến theo số đến, công văn đi theo số đi (chưa ban hành thì theo số dự thảo, xếp cuối).
   * Văn thư, người xem báo cáo, quản trị xem được.
   */
  async ledger(original: CorrespondenceActor, directionValue: unknown, yearValue?: unknown): Promise<LetterSummary[]> {
    const actor = await this.effective(original);
    if (!actor.canReadReports && !actor.canRegister && !actor.canPublish && !actor.canArchive && !actor.isTenantAdmin) {
      throw new CorrespondenceForbiddenError('Bạn không có quyền xem sổ theo dõi công văn.');
    }
    const direction = requireEnum(directionValue, LETTER_DIRECTIONS, 'Luồng công văn');
    const year = yearValue === undefined || yearValue === '' ? Number(this.today().slice(0, 4)) : Number(yearValue);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new CorrespondenceValidationError('Năm không hợp lệ.');
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const rows = (await this.store.listLetters(actor.tenantId, { visibleTo: this.visibility(viewer), direction, year, limit: REPORT_LIMIT })).filter((row) =>
      canViewLetter(viewer, facts(row, catalog)),
    );
    const order = (row: Row) =>
      direction === 'incoming'
        ? `${row.receivedOn}|${String(row.seq).padStart(8, '0')}`
        : row.outgoingNo
          ? `0|${row.publishedOn ?? ''}|${row.outgoingNo.padStart(16, '0')}`
          : `1|${row.receivedOn}|${String(row.seq).padStart(8, '0')}`;
    return this.summaries(actor, viewer, catalog, [...rows].sort((left, right) => order(left).localeCompare(order(right))));
  }

  async report(actor: CorrespondenceActor, yearValue?: unknown): Promise<CorrespondenceReport> {
    if (!actor.canReadReports && !actor.isTenantAdmin) throw new CorrespondenceForbiddenError('Bạn không có quyền xem báo cáo văn thư.');
    const year = yearValue === undefined || yearValue === '' ? Number(this.today().slice(0, 4)) : Number(yearValue);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new CorrespondenceValidationError('Năm báo cáo không hợp lệ.');
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const rows = (await this.store.listLetters(actor.tenantId, { visibleTo: this.visibility(viewer), year, limit: REPORT_LIMIT })).filter(
      (row) => row.stage !== 'cancelled' && canViewLetter(viewer, facts(row, catalog)),
    );
    const today = this.today();
    // Đang chờ duyệt huỷ vẫn là công văn đã xong cho tới khi được đồng ý huỷ.
    const done = (row: Row) => row.stage === 'archived' || row.stage === 'revoking';
    const late = (row: Row) => Boolean(row.dueOn && (done(row) ? (row.archivedOn ?? '') > row.dueOn : row.dueOn < today));
    const tally = (label: string, list: readonly Row[]): CorrespondenceReportRow => ({
      label,
      incoming: list.filter((row) => row.direction === 'incoming').length,
      outgoing: list.filter((row) => row.direction === 'outgoing').length,
      completed: list.filter(done).length,
      late: list.filter(late).length,
    });
    const groups = (key: (row: Row) => readonly string[]) => {
      const map = new Map<string, Row[]>();
      for (const row of rows) for (const label of new Set(key(row))) map.set(label, [...(map.get(label) ?? []), row]);
      return [...map.entries()]
        .map(([label, list]) => tally(label, list))
        .sort((left, right) => right.incoming + right.outgoing - (left.incoming + left.outgoing) || left.label.localeCompare(right.label, 'vi'));
    };
    return {
      year,
      totals: {
        incoming: rows.filter((row) => row.direction === 'incoming').length,
        outgoing: rows.filter((row) => row.direction === 'outgoing').length,
        completed: rows.filter(done).length,
        open: rows.filter((row) => !done(row)).length,
        late: rows.filter(late).length,
      },
      byMonth: Array.from({ length: 12 }, (_, index) =>
        tally(`Tháng ${index + 1}`, rows.filter((row) => Number(row.receivedOn.slice(5, 7)) === index + 1)),
      ),
      byType: groups((row) => [catalog.get('letter_type')?.get(row.kind)?.name ?? row.kind]),
      byUnit: groups((row) =>
        row.direction === 'incoming'
          ? row.assignments.length > 0
            ? row.assignments.map((item) => item.unitName)
            : ['Chưa giao phòng ban']
          : [row.authorUnitName ?? 'Chưa rõ phòng ban'],
      ),
    };
  }

  /**
   * Cây lưu trữ của Văn thư, cùng cấu trúc thư mục bên Hệ dùng chung (năm › công văn đến / đi ›
   * hồ sơ › tệp), để xem tài liệu ngay trong Văn thư. Chỉ gồm công văn người xem được thấy;
   * công văn đã huỷ không có trong cây.
   */
  async archiveTree(actor: CorrespondenceActor): Promise<ArchiveTree> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const rows = (await this.store.listLetters(actor.tenantId, { visibleTo: this.visibility(viewer), limit: REPORT_LIMIT })).filter(
      (row) => row.stage !== 'cancelled' && canViewLetter(viewer, facts(row, catalog)),
    );
    const files = await this.store.attachmentsOf(
      actor.tenantId,
      rows.map((row) => row.id),
    );
    const byLetter = new Map<string, (typeof files)[number][]>();
    for (const file of files) byLetter.set(file.letterId, [...(byLetter.get(file.letterId) ?? []), file]);
    const years = new Map<number, Map<LetterDirection, ArchiveDossier[]>>();
    for (const row of rows) {
      const dossier: ArchiveDossier = {
        letterId: row.id,
        direction: row.direction,
        folderName: dossierFolderName(row.incomingNo, row.subject),
        displayNo: displayNo(row),
        subject: row.subject,
        stage: row.stage,
        stageLabel: LETTER_STAGE_LABELS[row.stage] ?? row.stage,
        partner: row.direction === 'outgoing' ? row.recipient : row.senderOrg,
        archiveCode: row.archiveCode,
        archivedOn: row.archivedOn,
        receivedOn: row.receivedOn,
        files: (byLetter.get(row.id) ?? []).map((file) => ({
          id: file.id,
          fileName: file.fileName,
          kind: file.kind,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          versionNo: file.versionNo,
          createdAt: file.createdAt,
          unitName: file.unitName,
        })),
      };
      const groups = years.get(row.year) ?? new Map<LetterDirection, ArchiveDossier[]>();
      groups.set(row.direction, [...(groups.get(row.direction) ?? []), dossier]);
      years.set(row.year, groups);
    }
    return {
      rootName: CORRESPONDENCE_FILING_ROOT,
      years: [...years.entries()]
        .sort(([left], [right]) => right - left)
        .map(([year, groups]) => ({
          year,
          groups: LETTER_DIRECTIONS.filter((direction) => groups.has(direction)).map((direction) => ({
            direction,
            label: FOLDER_BY_DIRECTION[direction],
            dossiers: (groups.get(direction) ?? []).sort((left, right) => left.folderName.localeCompare(right.folderName, 'vi', { numeric: true })),
          })),
        })),
    };
  }
}
