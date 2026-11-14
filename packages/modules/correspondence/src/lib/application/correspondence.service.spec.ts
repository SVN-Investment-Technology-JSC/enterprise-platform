import {
  CORRESPONDENCE_EVENTS,
  DEFAULT_CORRESPONDENCE_SETTINGS,
  type CatalogItem,
  type CorrespondenceSettings,
  type Workflow,
  type WorkflowStep,
} from '@enterprise-platform/contracts-correspondence';
import {
  CorrespondenceForbiddenError,
  CorrespondenceValidationError,
  LetterNotFoundError,
  LetterStageConflictError,
} from '../domain/correspondence.error.js';
import { formatSequenceNo } from '../domain/letter-rules.js';
import type { OrganizationSnapshot } from '../domain/organization.js';
import { CORRESPONDENCE_FILING_ROOT, CorrespondenceService, flowOf } from './correspondence.service.js';
import {
  FileStoreMissingError,
  type AssignmentRecord,
  type AttachmentRecord,
  type CommentRecord,
  type CorrespondenceActor,
  type CorrespondenceStore,
  type FileStore,
  type HistoryRecord,
  type LetterRecord,
  type LetterTransaction,
  type OutboxEvent,
  type StepRecord,
} from './ports.js';

const TENANT = 'tenant-1';
const TODAY = '2026-11-12';

function actor(userId: string, overrides: Partial<CorrespondenceActor> = {}): CorrespondenceActor {
  return {
    tenantId: TENANT,
    userId,
    displayName: userId,
    isTenantAdmin: false,
    canRegister: false,
    canCreateOutgoing: false,
    canPublish: false,
    canArchive: false,
    canDirect: false,
    canReadAll: false,
    canReadConfidential: false,
    canReadReports: false,
    canConfigure: false,
    ...overrides,
  };
}

const clerk = actor('u-clerk', {
  canRegister: true,
  canCreateOutgoing: true,
  canPublish: true,
  canArchive: true,
  canReadAll: true,
  canReadReports: true,
});
const leader = actor('u-leader', { canDirect: true });
const accountant = actor('u-accountant', { canCreateOutgoing: true });
const financeHead = actor('u-fin-head', { canCreateOutgoing: true });
const lawyer = actor('u-lawyer');
const legalHead = actor('u-legal-head');
const outsider = actor('u-outsider');
const configurer = actor('u-config', { canConfigure: true });

const organization: OrganizationSnapshot = {
  nodes: [
    { id: 'unit-company', name: 'Công ty', kind: 'unit' },
    { id: 'unit-finance', name: 'Phòng Kế toán', parentId: 'unit-company', kind: 'unit' },
    { id: 'pos-fin-head', name: 'Kế toán trưởng', parentId: 'unit-finance', kind: 'position' },
    { id: 'pos-accountant', name: 'Kế toán viên', parentId: 'unit-finance', kind: 'position' },
    { id: 'unit-legal', name: 'Phòng Pháp chế', parentId: 'unit-company', kind: 'unit' },
    { id: 'pos-legal-head', name: 'Trưởng phòng pháp chế', parentId: 'unit-legal', kind: 'position' },
    { id: 'pos-lawyer', name: 'Chuyên viên pháp chế', parentId: 'unit-legal', kind: 'position' },
    { id: 'unit-empty', name: 'Phòng chưa có người', parentId: 'unit-company', kind: 'unit' },
  ],
  members: [
    { userId: 'u-fin-head', name: 'KTT', nodeId: 'pos-fin-head', positionName: 'Kế toán trưởng', isHead: true },
    { userId: 'u-accountant', name: 'Kế toán', nodeId: 'pos-accountant', positionName: 'Kế toán viên', isHead: false },
    { userId: 'u-legal-head', name: 'TP Pháp chế', nodeId: 'pos-legal-head', isHead: true },
    { userId: 'u-lawyer', name: 'Pháp chế', nodeId: 'pos-lawyer', isHead: false },
  ],
  degraded: false,
};

const INCOMING_STEPS: WorkflowStep[] = [
  { key: 'dept-process', name: 'Phòng ban xử lý', type: 'process' },
  { key: 'unit-check', name: 'Trưởng phòng kiểm tra', approver: { type: 'handling_unit_heads' } },
  { key: 'sign', name: 'Lãnh đạo xem xét', approver: { type: 'choose', pool: 'leaders' } },
];
const OUTGOING_STEPS: WorkflowStep[] = [
  { key: 'clerk-check', name: 'Văn thư kiểm tra', type: 'check' },
  { key: 'unit-head', name: 'Trưởng phòng soạn thảo duyệt', approver: { type: 'handling_unit_heads' } },
  { key: 'sign', name: 'Lãnh đạo duyệt ban hành', approver: { type: 'users', userIds: ['u-leader'] }, rejectTo: 'handlers' },
];

function catalogSeed(): CatalogItem[] {
  const item = (kind: CatalogItem['kind'], code: string, name: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
    id: `${kind}-${code}`,
    kind,
    code,
    name,
    sortOrder: 0,
    isActive: true,
    ...extra,
  });
  return [
    item('letter_type', 'finance', 'Tài chính – thuế', { defaultDueDays: 5 }),
    item('letter_type', 'quick', 'Thông báo', { sortOrder: 5, workflowId: 'wf-none', outgoingWorkflowId: 'wf-out-none' }),
    item('letter_type', 'old', 'Đã bỏ', { isActive: false, sortOrder: 9 }),
    item('urgency', 'normal', 'Thường'),
    item('urgency', 'urgent', 'Khẩn', { highlight: true, sortOrder: 1 }),
    item('confidentiality', 'normal', 'Thường'),
    item('confidentiality', 'confidential', 'Mật', { restricted: true, sortOrder: 1 }),
  ];
}

function fakeStore() {
  const letters = new Map<string, LetterRecord>();
  const steps: (StepRecord & { letterId: string })[] = [];
  const assignments: AssignmentRecord[] = [];
  const attachments: AttachmentRecord[] = [];
  const comments: (CommentRecord & { letterId: string })[] = [];
  const history = new Map<string, HistoryRecord[]>();
  const outbox: OutboxEvent[] = [];
  const counters = new Map<string, number>();
  let catalog = catalogSeed();
  const workflows: Workflow[] = [
    { id: 'wf-in', name: 'Xem xét công văn đến', direction: 'incoming', isActive: true, isDefault: true, steps: INCOMING_STEPS, updatedAt: TODAY },
    { id: 'wf-none', name: 'Không cần duyệt', direction: 'incoming', isActive: true, isDefault: false, steps: [INCOMING_STEPS[0]], updatedAt: TODAY },
    { id: 'wf-out', name: 'Duyệt công văn đi', direction: 'outgoing', isActive: true, isDefault: true, steps: OUTGOING_STEPS, updatedAt: TODAY },
    { id: 'wf-out-none', name: 'Ban hành ngay', direction: 'outgoing', isActive: true, isDefault: false, steps: [OUTGOING_STEPS[0]], updatedAt: TODAY },
  ];
  let settings: CorrespondenceSettings = DEFAULT_CORRESPONDENCE_SETTINGS;
  let sequence = 0;
  const id = (prefix: string) => `${prefix}-${++sequence}`;
  const next = (kind: string, year: number) => {
    const value = (counters.get(`${kind}:${year}`) ?? 0) + 1;
    counters.set(`${kind}:${year}`, value);
    return value;
  };
  const stepsOf = (letterId: string) => steps.filter((step) => step.letterId === letterId).sort((a, b) => a.seq - b.seq);
  const assignmentsOf = (letterId: string) => assignments.filter((item) => item.letterId === letterId);
  const commentsOf = (letterId: string) => comments.filter((item) => item.letterId === letterId);
  const mentionsOf = (letterId: string) => [...new Set(commentsOf(letterId).flatMap((item) => item.mentionedUserIds))];
  const patchAssignment = (assignmentId: string, patch: Partial<AssignmentRecord>) => {
    const index = assignments.findIndex((item) => item.id === assignmentId);
    assignments[index] = { ...assignments[index], ...patch };
  };

  const transaction = (letterId: string): LetterTransaction => ({
    get letter() {
      return letters.get(letterId) as LetterRecord;
    },
    get steps() {
      return stepsOf(letterId);
    },
    get assignments() {
      return assignmentsOf(letterId);
    },
    get mentionedUserIds() {
      return mentionsOf(letterId);
    },
    update: async (patch) => {
      const updated = { ...(letters.get(letterId) as LetterRecord), ...patch };
      letters.set(letterId, updated);
      return updated;
    },
    nextNumber: async (kind, year) => next(kind, year),
    replaceSteps: async (definitions) => {
      for (let index = steps.length - 1; index >= 0; index -= 1) if (steps[index].letterId === letterId) steps.splice(index, 1);
      definitions.forEach((step, index) =>
        steps.push({
          id: id('step'),
          letterId,
          seq: index + 1,
          name: step.name,
          kind: step.type ?? 'approve',
          approver: step.approver,
          directs: step.directs,
          rejectTo: step.rejectTo,
          status: 'waiting',
          assigneeUserIds: [],
        }),
      );
    },
    updateStep: async (stepId, update) => {
      const index = steps.findIndex((step) => step.id === stepId);
      const current = steps[index];
      steps[index] = {
        ...current,
        ...(update.status !== undefined ? { status: update.status } : {}),
        ...(update.chosenUserId !== undefined ? { chosenUserId: update.chosenUserId ?? undefined } : {}),
        ...(update.assigneeUserIds !== undefined ? { assigneeUserIds: update.assigneeUserIds } : {}),
        ...(update.actedBy !== undefined ? { actedBy: update.actedBy ?? undefined, actedAt: update.actedBy ? TODAY : undefined } : {}),
        ...(update.decision !== undefined ? { decision: update.decision ?? undefined } : {}),
        ...(update.note !== undefined ? { note: update.note ?? undefined } : {}),
      };
    },
    assign: async (units) => {
      for (const unit of units) {
        const existing = assignments.find((item) => item.letterId === letterId && item.unitId === unit.unitId);
        if (existing) {
          patchAssignment(existing.id, { status: 'pending', submittedAt: undefined, handlerUserId: unit.handlerUserId, role: unit.role ?? 'lead' });
        } else {
          assignments.push({
            id: id('assignment'),
            letterId,
            unitId: unit.unitId,
            unitName: unit.unitName,
            role: unit.role ?? 'lead',
            round: 1,
            status: 'pending',
            handlerUserId: unit.handlerUserId,
          });
        }
      }
    },
    removeAssignments: async (ids) => {
      for (const assignmentId of ids) assignments.splice(assignments.findIndex((item) => item.id === assignmentId), 1);
    },
    setHandler: async (assignmentId, handlerUserId) => patchAssignment(assignmentId, { handlerUserId: handlerUserId ?? undefined }),
    submitAssignment: async (assignmentId, input) =>
      patchAssignment(assignmentId, { status: 'submitted', responseNote: input.note, submittedBy: input.userId, submittedAt: TODAY }),
    reopenAssignments: async (ids, reason) => {
      for (const assignmentId of ids) {
        const current = assignments.find((item) => item.id === assignmentId) as AssignmentRecord;
        patchAssignment(assignmentId, { status: 'pending', round: current.round + 1, revisionReason: reason, submittedAt: undefined });
      }
    },
    addAttachment: async (input) => {
      const created: AttachmentRecord = { ...input, id: id('attachment'), letterId, versionNo: 1, createdAt: TODAY };
      attachments.push(created);
      return created;
    },
    setAttachmentVersion: async (attachmentId, input) => {
      const index = attachments.findIndex((item) => item.id === attachmentId);
      attachments[index] = { ...attachments[index], ...input, sizeBytes: undefined };
    },
    removeAttachment: async (attachmentId) => {
      attachments.splice(attachments.findIndex((item) => item.id === attachmentId), 1);
    },
    addComment: async (input) => {
      const created = { ...input, id: id('comment'), letterId, at: TODAY };
      comments.push(created);
      return created;
    },
    history: async (entry) => {
      history.set(letterId, [...(history.get(letterId) ?? []), { ...entry, id: id('history'), at: TODAY }]);
    },
    outbox: async (event) => {
      outbox.push(event);
    },
  });

  const store: CorrespondenceStore = {
    tablesReady: async () => true,
    settings: async () => settings,
    saveSettings: async (_tenant, _user, value) => {
      settings = value;
    },
    catalog: async () =>
      catalog.map((item) => ({
        ...item,
        inUse: [...letters.values()].some((letter) =>
          item.kind === 'letter_type' ? letter.kind === item.code : item.kind === 'urgency' ? letter.urgency === item.code : letter.confidentiality === item.code,
        ),
      })),
    saveCatalogItem: async (_tenant, _user, itemId, input) => {
      const saved: CatalogItem = {
        id: itemId ?? id('catalog'),
        kind: input.kind,
        code: input.code,
        name: input.name,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        defaultDueDays: input.defaultDueDays ?? undefined,
        workflowId: input.workflowId ?? undefined,
        outgoingWorkflowId: input.outgoingWorkflowId ?? undefined,
        defaultUnitIds: input.defaultUnitIds,
        highlight: input.highlight,
        restricted: input.restricted,
      };
      catalog = [...catalog.filter((item) => item.id !== saved.id), saved];
      return saved;
    },
    deleteCatalogItem: async () => false,
    workflows: async () => workflows,
    saveWorkflow: async (_tenant, _user, workflowId, input) => {
      if (input.isDefault) {
        workflows.forEach((item, index) => {
          if (item.direction === input.direction) workflows[index] = { ...item, isDefault: false };
        });
      }
      const saved: Workflow = {
        ...input,
        id: workflowId ?? id('wf'),
        description: input.description ?? undefined,
        startName: input.startName ?? undefined,
        endName: input.endName ?? undefined,
        endActor: input.endActor ?? undefined,
        updatedAt: TODAY,
      };
      const index = workflows.findIndex((item) => item.id === saved.id);
      if (index >= 0) workflows[index] = saved;
      else workflows.push(saved);
      return saved;
    },
    deleteWorkflow: async () => false,
    createLetter: async (_tenant, input, numbering, after) => {
      const year = Number(input.receivedOn.slice(0, 4));
      const seq = next(numbering.counter, year);
      const letter: LetterRecord = {
        ...input,
        id: id('letter'),
        year,
        seq,
        incomingNo: formatSequenceNo(seq, numbering.suffix),
        createdAt: TODAY,
        updatedAt: TODAY,
      };
      letters.set(letter.id, letter);
      await after(transaction(letter.id));
      return letters.get(letter.id) as LetterRecord;
    },
    withLetter: async (_tenant, letterId, work) => {
      if (!letters.has(letterId) || letters.get(letterId)?.deletedAt) throw new LetterNotFoundError();
      // Lỗi giữa chừng không để lại thay đổi, như rollback.
      const snapshot = {
        letters: new Map(letters),
        steps: steps.map((step) => ({ ...step })),
        assignments: [...assignments],
        attachments: [...attachments],
        comments: [...comments],
        outbox: outbox.length,
      };
      try {
        return await work(transaction(letterId));
      } catch (error) {
        letters.clear();
        snapshot.letters.forEach((value, key) => letters.set(key, value));
        steps.splice(0, steps.length, ...snapshot.steps);
        assignments.splice(0, assignments.length, ...snapshot.assignments);
        attachments.splice(0, attachments.length, ...snapshot.attachments);
        comments.splice(0, comments.length, ...snapshot.comments);
        outbox.splice(snapshot.outbox);
        throw error;
      }
    },
    findLetter: async (_tenant, letterId) => (letters.get(letterId)?.deletedAt ? undefined : letters.get(letterId)),
    listLetters: async (_tenant, filter) =>
      [...letters.values()]
        .filter((letter) => !letter.deletedAt)
        .filter((letter) => !filter.direction || letter.direction === filter.direction)
        .filter((letter) => !filter.stages || filter.stages.includes(letter.stage))
        .filter((letter) => !filter.year || letter.year === filter.year)
        .map((letter) => ({ ...letter, steps: stepsOf(letter.id), assignments: assignmentsOf(letter.id), mentionedUserIds: mentionsOf(letter.id) })),
    countArchived: async () =>
      [...letters.values()].filter((letter) => !letter.deletedAt && (letter.stage === 'archived' || letter.stage === 'revoking')).length,
    steps: async (_tenant, letterId) => stepsOf(letterId),
    assignments: async (_tenant, letterId) => assignmentsOf(letterId),
    attachments: async (_tenant, letterId) => attachments.filter((item) => item.letterId === letterId),
    findAttachment: async (_tenant, attachmentId) => attachments.find((item) => item.id === attachmentId),
    attachmentsOf: async (_tenant, letterIds) =>
      attachments
        .filter((item) => letterIds.includes(item.letterId))
        .map((item) => ({ ...item, unitName: assignments.find((assignment) => assignment.id === item.assignmentId)?.unitName })),
    completeAttachment: async (_tenant, attachmentId, sizeBytes) => {
      const index = attachments.findIndex((item) => item.id === attachmentId);
      attachments[index] = { ...attachments[index], sizeBytes };
    },
    comments: async (_tenant, letterId) => commentsOf(letterId),
    history: async (_tenant, letterId) => history.get(letterId) ?? [],
    userNames: async () =>
      new Map([
        ['u-leader', 'Nguyễn Văn An'],
        ['u-leader-2', 'Trần Minh Châu'],
        ['u-clerk', 'Lê Thu Hà'],
        ['u-fin-head', 'KTT'],
        ['u-legal-head', 'TP Pháp chế'],
        ['u-accountant', 'Kế toán'],
        ['u-lawyer', 'Pháp chế'],
      ]),
    people: async () =>
      ['u-leader', 'u-leader-2', 'u-clerk', 'u-fin-head', 'u-legal-head', 'u-accountant', 'u-lawyer', 'u-outsider'].map((userId) => ({ userId, name: userId })),
    leaders: async () => [
      { userId: 'u-leader', name: 'Nguyễn Văn An' },
      { userId: 'u-leader-2', name: 'Trần Minh Châu' },
    ],
  };
  return {
    store,
    letters,
    steps,
    assignments,
    workflows,
    outbox,
    history,
    setSettings: (value: Partial<CorrespondenceSettings>) => {
      settings = { ...settings, ...value };
    },
  };
}

function fakeFiles() {
  const created: Parameters<FileStore['create']>[1][] = [];
  const versions: { documentId: string; fileName: string }[] = [];
  const trashed: string[] = [];
  const folderUpdates: { folderId: string; docNumber?: string }[] = [];
  const state = { missingFolder: false };
  const files: FileStore = {
    create: async (_tenant, input) => {
      if (input.folderId && state.missingFolder) {
        state.missingFolder = false;
        throw new FileStoreMissingError();
      }
      created.push(input);
      return {
        folderId: input.folderId ?? `folder-${created.length}`,
        documentId: `doc-${created.length}`,
        versionId: `version-${created.length}`,
        uploadUrl: `https://files.example/${created.length}`,
        expiresInSeconds: 300,
      };
    },
    addVersion: async (_tenant, documentId, input) => {
      versions.push({ documentId, fileName: input.fileName });
      return { versionId: `${documentId}-v${versions.length + 1}`, versionNo: versions.length + 1, uploadUrl: 'https://files.example/v', expiresInSeconds: 300 };
    },
    complete: async () => undefined,
    download: async (_tenant, documentId) => ({
      downloadUrl: `https://files.example/download/${documentId}`,
      expiresInSeconds: 300,
      fileName: 'scan.pdf',
      contentType: 'application/pdf',
    }),
    trash: async (_tenant, documentId) => {
      trashed.push(documentId);
    },
    updateFolder: async (_tenant, folderId, input) => {
      folderUpdates.push({ folderId, docNumber: input.docNumber });
    },
  };
  return { files, created, versions, trashed, folderUpdates, state };
}

function setup() {
  const fake = fakeStore();
  const files = fakeFiles();
  const service = new CorrespondenceService(fake.store, files.files, { snapshot: async () => organization }, () => TODAY);
  return { ...fake, ...files, service };
}

const intake = {
  senderOrg: 'Sở Tài chính TP. Đà Nẵng',
  senderRef: '1234/STC-QLNS',
  subject: 'Yêu cầu giải trình số liệu quyết toán thuế TNDN năm 2025',
  kind: 'finance',
};

/** Tiếp nhận rồi giao Kế toán (cả phòng) và Pháp chế (người xử lý: chuyên viên). */
async function dispatched(service: CorrespondenceService, extra: { confidentiality?: string } = {}) {
  const letter = await service.create(clerk, { ...intake, ...extra });
  return service.dispatch(clerk, letter.id, {
    kind: 'finance',
    urgency: 'urgent',
    confidentiality: extra.confidentiality,
    units: [{ unitId: 'unit-finance' }, { unitId: 'unit-legal', handlerUserId: 'u-lawyer' }],
    note: 'Hai phòng phối hợp soạn văn bản giải trình.',
  });
}

/** Hai phòng đã gửi kết quả: đang ở bước "Trưởng phòng kiểm tra". */
async function reviewing(service: CorrespondenceService) {
  const letter = await dispatched(service);
  const [finance, legal] = letter.assignments;
  await service.respond(accountant, letter.id, finance.id, { note: 'Đã đối chiếu số liệu.' });
  return service.respond(lawyer, letter.id, legal.id, { note: 'Đã rà soát căn cứ pháp lý.' });
}

/** Công văn đi do kế toán soạn, đã gửi văn thư kiểm tra. */
async function outgoingChecking(service: CorrespondenceService) {
  const letter = await service.createOutgoing(accountant, { subject: 'Giải trình số liệu quyết toán', recipient: 'Sở Tài chính', kind: 'finance' });
  return service.sendToClerk(accountant, letter.id, {});
}

describe('Công văn đến – tiếp nhận, giao phòng ban', () => {
  it('cấp số đến, hạn theo loại văn bản; thanh tiến trình vẽ theo quy trình sẽ áp dụng', async () => {
    const { service } = setup();
    const letter = await service.create(clerk, intake);
    expect(letter).toMatchObject({ direction: 'incoming', incomingNo: '1/CVĐ', displayNo: '1/CVĐ', stage: 'received', dueOn: '2026-11-17' });
    expect(letter.workflowName).toBe('Xem xét công văn đến');
    expect(letter.flow.map((node) => [node.label, node.state, node.approval])).toEqual([
      ['Văn thư tiếp nhận', 'current', false],
      ['Phòng ban xử lý', 'todo', false],
      ['Trưởng phòng kiểm tra', 'todo', true],
      ['Lãnh đạo xem xét', 'todo', true],
      ['Văn thư hoàn tất, lưu trữ', 'todo', false],
    ]);
    expect(letter.flow[2].people).toBe('Trưởng phòng ban xử lý');
    expect(letter.flow[3].people).toBe('Lãnh đạo được chọn khi trình');
    expect(letter.actions).toMatchObject({ dispatch: true, cancel: true, edit: true, approve: false });
    await expect(service.create(leader, intake)).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    await expect(service.create(clerk, { ...intake, kind: 'old' })).rejects.toThrow('đã ngừng dùng');
  });

  it('đơn vị cha không mang nhân sự của phòng con: giao "Công ty" không có ai nhận, người phòng con không xử lý thay', async () => {
    const { service } = setup();
    const letter = await service.create(clerk, intake);
    await expect(service.dispatch(clerk, letter.id, { kind: 'finance', urgency: 'normal', units: [{ unitId: 'unit-company' }] })).rejects.toThrow(
      'Công ty chưa có nhân sự nào trong sơ đồ tổ chức để nhận công văn.',
    );
    await expect(service.dispatch(clerk, letter.id, { kind: 'finance', urgency: 'normal', units: [{ unitId: 'unit-company', handlerUserId: 'u-accountant' }] })).rejects.toThrow(
      'Người xử lý được chọn không thuộc Công ty.',
    );
    const directory = await service.directory(clerk);
    expect(directory.units.find((unit) => unit.id === 'unit-company')?.members).toEqual([]);
    expect(directory.units.find((unit) => unit.id === 'unit-finance')?.members.map((member) => member.userId)).toEqual(['u-fin-head', 'u-accountant']);
  });

  it('giao phòng ban: cả phòng cùng nhận hoặc một người xử lý; báo đúng người', async () => {
    const { service, outbox } = setup();
    const letter = await dispatched(service);
    expect(letter).toMatchObject({ stage: 'processing', urgencyHighlight: true, assignmentsTotal: 2 });
    expect(letter.assignments.map((item) => [item.unitName, item.handlerName])).toEqual([
      ['Phòng Kế toán', undefined],
      ['Phòng Pháp chế', 'Pháp chế'],
    ]);
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.assigned });
    expect(outbox.at(-1)?.payload['recipientUserIds']).toEqual(['u-fin-head', 'u-accountant', 'u-lawyer']);
    expect(letter.flow.find((node) => node.state === 'current')).toMatchObject({ label: 'Phòng ban xử lý', people: 'Phòng Kế toán, Phòng Pháp chế (Pháp chế)' });
    expect(letter.flow[2].people).toBe('KTT, TP Pháp chế');
    await expect(service.dispatch(clerk, letter.id, { kind: 'finance', urgency: 'normal', units: [{ unitId: 'unit-finance' }] })).rejects.toBeInstanceOf(
      LetterStageConflictError,
    );
  });

  it('cấu hình "phải chọn người xử lý" bắt văn thư chọn một người cho mỗi phòng, người đó phải thuộc phòng', async () => {
    const { service, setSettings } = setup();
    setSettings({ dispatchMode: 'handler' });
    const letter = await service.create(clerk, intake);
    await expect(service.dispatch(clerk, letter.id, { kind: 'finance', urgency: 'normal', units: [{ unitId: 'unit-finance' }] })).rejects.toThrow(
      'Chọn người xử lý cho Phòng Kế toán',
    );
    await expect(
      service.dispatch(clerk, letter.id, { kind: 'finance', urgency: 'normal', units: [{ unitId: 'unit-finance', handlerUserId: 'u-lawyer' }] }),
    ).rejects.toThrow('không thuộc Phòng Kế toán');
    await expect(service.dispatch(clerk, letter.id, { kind: 'finance', urgency: 'normal', units: [{ unitId: 'unit-empty' }] })).rejects.toThrow(
      'Chọn người xử lý',
    );
    const done = await service.dispatch(clerk, letter.id, {
      kind: 'finance',
      urgency: 'normal',
      units: [{ unitId: 'unit-finance', handlerUserId: 'u-accountant' }],
    });
    expect(done.assignments[0]).toMatchObject({ handlerUserId: 'u-accountant' });
  });

  it('người xử lý được phân công thì chỉ người đó (hay trưởng phòng, văn thư) gửi kết quả; trưởng phòng đổi được người', async () => {
    const { service, outbox } = setup();
    const letter = await dispatched(service);
    const [finance, legal] = letter.assignments;
    await expect(service.respond(legalHead, letter.id, finance.id, { note: 'x' })).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    await expect(service.respond(outsider, letter.id, finance.id, { note: 'x' })).rejects.toBeInstanceOf(LetterNotFoundError);
    const reassigned = await service.assignHandler(legalHead, letter.id, legal.id, { handlerUserId: 'u-legal-head' });
    expect(reassigned.assignments[1].handlerName).toBe('TP Pháp chế');
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.handlerAssigned });
    await expect(service.respond(lawyer, letter.id, legal.id, { note: 'x' })).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    await expect(service.assignHandler(financeHead, letter.id, finance.id, { handlerUserId: 'u-lawyer' })).rejects.toThrow('không thuộc Phòng Kế toán');
  });

  it('đủ kết quả các phòng thì sang bước duyệt đầu: trưởng các phòng xử lý', async () => {
    const { service, outbox } = setup();
    const letter = await reviewing(service);
    expect(letter).toMatchObject({ stage: 'reviewing', currentStepName: 'Trưởng phòng kiểm tra', assignmentsDone: 2 });
    expect(letter.currentAssigneeNames).toEqual(['KTT', 'TP Pháp chế']);
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.stepAssigned });
    expect(outbox.at(-1)?.payload['recipientUserIds']).toEqual(['u-fin-head', 'u-legal-head']);
    expect(letter.flow.map((node) => node.state)).toEqual(['done', 'done', 'current', 'todo', 'todo']);
  });

  it('phòng ban trả về văn thư khi không thuộc phòng mình; văn thư giao lại', async () => {
    const { service } = setup();
    const letter = await dispatched(service);
    const back = await service.returnLetter(lawyer, letter.id, { target: 'clerk', reason: 'Không thuộc phạm vi pháp chế.' });
    expect(back.stage).toBe('received');
    const again = await service.dispatch(clerk, letter.id, { kind: 'finance', urgency: 'normal', units: [{ unitId: 'unit-finance' }] });
    expect(again.assignments.map((item) => item.unitName)).toEqual(['Phòng Kế toán']);
  });

  it('loại văn bản gắn quy trình không có bước duyệt: xử lý xong là chờ văn thư hoàn tất', async () => {
    const { service, outbox } = setup();
    const letter = await service.create(clerk, { ...intake, kind: 'quick' });
    expect(letter.flow.map((node) => node.label)).toEqual(['Văn thư tiếp nhận', 'Phòng ban xử lý', 'Văn thư hoàn tất, lưu trữ']);
    const done = await service.dispatch(clerk, letter.id, { kind: 'quick', urgency: 'normal', units: [{ unitId: 'unit-finance' }] });
    const closed = await service.respond(accountant, letter.id, done.assignments[0].id, { note: 'Đã nắm.' });
    expect(closed.stage).toBe('closing');
    expect(outbox.at(-1)).toMatchObject({
      type: CORRESPONDENCE_EVENTS.approved,
      payload: { notifyPermissions: ['correspondence.letter.archive'] },
    });
  });
});

describe('Công văn đến – duyệt, không đạt, hoàn tất', () => {
  it('đạt thì sang bước sau; bước để người duyệt chọn lãnh đạo thì phải chọn đúng nhóm', async () => {
    const { service } = setup();
    const letter = await reviewing(service);
    expect(await service.stepChoice(financeHead, letter.id)).toMatchObject({
      stepName: 'Lãnh đạo xem xét',
      candidates: [expect.objectContaining({ userId: 'u-leader' }), expect.objectContaining({ userId: 'u-leader-2' })],
    });
    await expect(service.approve(financeHead, letter.id, {})).rejects.toThrow('Chọn người cho bước "Lãnh đạo xem xét".');
    await expect(service.approve(financeHead, letter.id, { nextAssigneeUserId: 'u-accountant' })).rejects.toBeInstanceOf(
      CorrespondenceValidationError,
    );
    await expect(service.approve(lawyer, letter.id, { nextAssigneeUserId: 'u-leader' })).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    const next = await service.approve(financeHead, letter.id, { nextAssigneeUserId: 'u-leader', note: 'Số liệu khớp.' });
    expect(next).toMatchObject({ stage: 'reviewing', currentStepName: 'Lãnh đạo xem xét', currentAssigneeNames: ['Nguyễn Văn An'] });
    expect(next.flow[2]).toMatchObject({ state: 'done', people: 'KTT' });
    expect(next.flow[3]).toMatchObject({ state: 'current', people: 'Nguyễn Văn An' });
  });

  it('không đạt mặc định trả về bước trước, có lý do; bước trước duyệt lại thì không phải chọn lại lãnh đạo', async () => {
    const { service, outbox } = setup();
    const letter = await reviewing(service);
    await service.approve(financeHead, letter.id, { nextAssigneeUserId: 'u-leader' });
    const before = await service.detail(leader, letter.id);
    expect(before.actions).toMatchObject({ approve: true, defaultReturnTarget: 'previous-step', returnTargets: ['previous-step', 'handlers', 'clerk'] });
    await expect(service.returnLetter(leader, letter.id, { target: 'previous-step', reason: '' })).rejects.toThrow('Lý do không được để trống.');
    const back = await service.returnLetter(leader, letter.id, { target: 'previous-step', reason: 'Bổ sung bảng đối chiếu.' });
    expect(back).toMatchObject({ stage: 'reviewing', currentStepName: 'Trưởng phòng kiểm tra' });
    expect(back.steps[2]).toMatchObject({ status: 'waiting', decision: 'returned', note: 'Bổ sung bảng đối chiếu.' });
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.returned, payload: { reason: 'Bổ sung bảng đối chiếu.' } });
    expect(outbox.at(-1)?.payload['recipientUserIds']).toEqual(['u-fin-head', 'u-legal-head']);
    // Người trả lại vẫn xem được công văn.
    await expect(service.detail(leader, letter.id)).resolves.toBeDefined();
    const again = await service.approve(legalHead, letter.id, {});
    expect(again.currentAssigneeNames).toEqual(['Nguyễn Văn An']);
  });

  it('không đạt ở bước duyệt đầu trả về phòng ban xử lý; chỉ phòng được chọn phải làm lại', async () => {
    const { service } = setup();
    const letter = await reviewing(service);
    const legal = letter.assignments[1];
    const back = await service.returnLetter(financeHead, letter.id, {
      target: 'handlers',
      reason: 'Thiếu căn cứ pháp lý.',
      assignmentIds: [legal.id],
    });
    expect(back).toMatchObject({ stage: 'processing', assignmentsDone: 1 });
    expect(back.assignments[1]).toMatchObject({ status: 'pending', round: 2, revisionReason: 'Thiếu căn cứ pháp lý.' });
    // Bước phòng ban xử lý chạy lại; các bước duyệt sau nó chờ phòng ban gửi lại kết quả.
    expect(back.steps.map((step) => [step.type, step.status])).toEqual([
      ['process', 'active'],
      ['approve', 'waiting'],
      ['approve', 'waiting'],
    ]);
    const resent = await service.respond(lawyer, letter.id, legal.id, { note: 'Đã bổ sung.' });
    expect(resent).toMatchObject({ stage: 'reviewing', currentStepName: 'Trưởng phòng kiểm tra' });
  });

  it('duyệt xong thì văn thư hoàn tất, cấp số hồ sơ, ghi lên thư mục hồ sơ', async () => {
    const { service, outbox, folderUpdates } = setup();
    const letter = await reviewing(service);
    await service.createAttachment(clerk, letter.id, { kind: 'incoming', fileName: 'scan.pdf', contentType: 'application/pdf', sizeBytes: 10 });
    await service.approve(financeHead, letter.id, { nextAssigneeUserId: 'u-leader' });
    const closing = await service.approve(leader, letter.id, { note: 'Đồng ý.' });
    expect(closing.stage).toBe('closing');
    expect(outbox.at(-1)).toMatchObject({
      type: CORRESPONDENCE_EVENTS.approved,
      payload: { recipientUserIds: ['u-clerk'], notifyPermissions: ['correspondence.letter.archive'] },
    });
    expect(closing.actions.returnTargets).toEqual([]);
    expect((await service.detail(clerk, letter.id)).actions.returnTargets).toEqual(['previous-step', 'handlers']);
    const archived = await service.complete(clerk, letter.id, { note: 'Đã gửi văn bản giải trình.' });
    expect(archived).toMatchObject({ stage: 'archived', archiveCode: 'HS-2026-0001', completionNote: 'Đã gửi văn bản giải trình.' });
    expect(archived.flow.every((node) => node.state === 'done')).toBe(true);
    expect(archived.flow.at(-1)).toMatchObject({ label: 'Văn thư hoàn tất, lưu trữ', people: 'Lê Thu Hà · Hồ sơ HS-2026-0001' });
    expect(folderUpdates).toEqual([{ folderId: 'folder-1', docNumber: 'HS-2026-0001' }]);
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.completed });
  });
});

describe('Công văn đi', () => {
  it('phòng ban soạn: số dự thảo, phòng soạn theo sơ đồ tổ chức, quy trình cấu hình hiện sẵn trên thanh tiến trình', async () => {
    const { service } = setup();
    const draft = await service.createOutgoing(accountant, { subject: 'Giải trình', recipient: 'Sở Tài chính', kind: 'finance' });
    expect(draft).toMatchObject({
      direction: 'outgoing',
      stage: 'drafting',
      displayNo: '1/DT',
      authorUnitName: 'Phòng Kế toán',
      senderOrg: 'Phòng Kế toán',
      recipient: 'Sở Tài chính',
    });
    expect(draft.flow.map((node) => [node.label, node.state, node.people])).toEqual([
      ['Phòng ban soạn thảo', 'current', 'Kế toán · Phòng Kế toán'],
      ['Văn thư kiểm tra', 'todo', undefined],
      ['Trưởng phòng soạn thảo duyệt', 'todo', 'KTT'],
      ['Lãnh đạo duyệt ban hành', 'todo', 'Nguyễn Văn An'],
      ['Văn thư ban hành, lưu trữ', 'todo', undefined],
    ]);
    expect(draft.actions).toMatchObject({ sendToClerk: true, edit: true, cancel: true });
    await expect(service.createOutgoing(lawyer, { subject: 'x', recipient: 'y' })).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    // Mặc định phòng của người soạn; chọn lại được phòng khác có trong sơ đồ tổ chức.
    const forLegal = await service.createOutgoing(accountant, { subject: 'x', recipient: 'y', authorUnitId: 'unit-legal' });
    expect(forLegal).toMatchObject({ authorUnitName: 'Phòng Pháp chế' });
    await expect(service.createOutgoing(accountant, { subject: 'x', recipient: 'y', authorUnitId: 'unit-gone' })).rejects.toThrow(
      'Phòng ban soạn thảo không còn trong sơ đồ tổ chức.',
    );
    // Cùng phòng soạn thì xem được; phòng khác thì không.
    await expect(service.detail(financeHead, draft.id)).resolves.toBeDefined();
    await expect(service.detail(lawyer, draft.id)).rejects.toBeInstanceOf(LetterNotFoundError);
  });

  it('gửi văn thư kiểm tra, văn thư trả lại người soạn, gửi lại, trình duyệt theo quy trình', async () => {
    const { service, outbox } = setup();
    const checking = await outgoingChecking(service);
    expect(checking.stage).toBe('checking');
    expect(outbox.at(-1)).toMatchObject({
      type: CORRESPONDENCE_EVENTS.sentToClerk,
      payload: { notifyPermissions: ['correspondence.letter.register'] },
    });
    const clerkView = await service.detail(clerk, checking.id);
    expect(clerkView.actions).toMatchObject({ submit: true, returnTargets: ['handlers'], defaultReturnTarget: 'handlers' });
    const back = await service.returnLetter(clerk, checking.id, { target: 'handlers', reason: 'Sai thể thức trình bày.' });
    expect(back.stage).toBe('drafting');
    expect(outbox.at(-1)?.payload['recipientUserIds']).toEqual(['u-accountant']);
    await service.sendToClerk(accountant, checking.id, { note: 'Đã sửa thể thức.' });
    const submitted = await service.submit(clerk, checking.id, {});
    expect(submitted).toMatchObject({ stage: 'reviewing', currentStepName: 'Trưởng phòng soạn thảo duyệt', currentAssigneeNames: ['KTT'] });
    const signed = await service.approve(financeHead, checking.id, {});
    expect(signed.currentAssigneeNames).toEqual(['Nguyễn Văn An']);
  });

  it('bước có cấu hình "không đạt về người soạn" thì mặc định trả người soạn; về bước trước thì văn thư kiểm tra lại', async () => {
    const { service } = setup();
    const checking = await outgoingChecking(service);
    await service.submit(clerk, checking.id, {});
    const firstStep = await service.detail(financeHead, checking.id);
    expect(firstStep.actions.defaultReturnTarget).toBe('previous-step');
    const toClerk = await service.returnLetter(financeHead, checking.id, { target: 'previous-step', reason: 'Văn thư soát lại số liệu.' });
    expect(toClerk.stage).toBe('checking');
    await service.submit(clerk, checking.id, {});
    await service.approve(financeHead, checking.id, {});
    const atLeader = await service.detail(leader, checking.id);
    expect(atLeader.actions.defaultReturnTarget).toBe('handlers');
    const toAuthor = await service.returnLetter(leader, checking.id, { target: 'handlers', reason: 'Viết lại đoạn kết.' });
    expect(toAuthor.stage).toBe('drafting');
  });

  it('duyệt xong văn thư đánh số đi, ban hành, lưu trữ và theo dõi tình trạng gửi', async () => {
    const { service, outbox } = setup();
    const checking = await outgoingChecking(service);
    await service.submit(clerk, checking.id, {});
    await service.approve(financeHead, checking.id, {});
    const ready = await service.approve(leader, checking.id, {});
    expect(ready.stage).toBe('publishing');
    expect(outbox.at(-1)).toMatchObject({ payload: { notifyPermissions: ['correspondence.letter.publish'], recipientUserIds: ['u-accountant'] } });
    await expect(service.publish(accountant, checking.id, { recipient: 'Sở Tài chính' })).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    const published = await service.publish(clerk, checking.id, { recipient: 'Sở Tài chính', deliveryMethod: 'Bưu điện' });
    expect(published).toMatchObject({
      stage: 'archived',
      outgoingNo: '1/CV',
      displayNo: '1/CV',
      deliveryStatus: 'sent',
      deliveryMethod: 'Bưu điện',
      archiveCode: 'HS-2026-0001',
    });
    expect(published.actions.updateDelivery).toBe(true);
    const delivered = await service.updateDelivery(clerk, checking.id, { status: 'received', deliveredOn: '2026-11-14' });
    expect(delivered).toMatchObject({ deliveryStatus: 'received', deliveredOn: '2026-11-14' });
  });

  it('quy trình đi không có bước duyệt: văn thư xác nhận là chờ ban hành', async () => {
    const { service } = setup();
    const draft = await service.createOutgoing(accountant, { subject: 'Thông báo nghỉ lễ', recipient: 'Toàn công ty', kind: 'quick' });
    await service.sendToClerk(accountant, draft.id, {});
    const ready = await service.submit(clerk, draft.id, {});
    expect(ready.stage).toBe('publishing');
  });

  it('trả lời công văn đến: gắn công văn liên quan, người soạn phải xem được công văn đến', async () => {
    const { service } = setup();
    const incoming = await dispatched(service);
    const reply = await service.createOutgoing(accountant, { subject: 'Trả lời', recipient: 'Sở Tài chính', relatedLetterId: incoming.id });
    expect(reply).toMatchObject({ relatedLetterId: incoming.id, relatedLetterNo: '1/CVĐ' });
    const other = await service.create(clerk, intake);
    await expect(service.createOutgoing(accountant, { subject: 'x', recipient: 'y', relatedLetterId: other.id })).rejects.toThrow(
      'không còn hay bạn không xem được',
    );
  });
});

describe('Trao đổi, huỷ, quyền xem', () => {
  it('nhắc tên trong trao đổi: người được nhắc nhận thông báo và xem được công văn', async () => {
    const { service, outbox } = setup();
    const letter = await dispatched(service);
    await expect(service.detail(outsider, letter.id)).rejects.toBeInstanceOf(LetterNotFoundError);
    const after = await service.comment(accountant, letter.id, {
      body: '@u-outsider xem giúp số liệu quý 3',
      mentionedUserIds: ['u-outsider', 'u-ghost', 'u-accountant'],
    });
    expect(after.comments).toHaveLength(1);
    expect(after.comments[0]).toMatchObject({ stepLabel: 'Phòng ban xử lý', mentions: [{ userId: 'u-outsider' }] });
    const mentioned = outbox.find((event) => event.type === CORRESPONDENCE_EVENTS.mentioned);
    expect(mentioned?.payload['recipientUserIds']).toEqual(['u-outsider']);
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.commented });
    await expect(service.detail(outsider, letter.id)).resolves.toMatchObject({ id: letter.id });
    await expect(service.comment(outsider, letter.id, { body: '' })).rejects.toThrow('Nội dung trao đổi không được để trống.');
  });

  it('huỷ công văn cần lý do; công văn đã huỷ không thao tác tiếp', async () => {
    const { service, outbox } = setup();
    const letter = await reviewing(service);
    await expect(service.cancel(financeHead, letter.id, { reason: 'x' })).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    const cancelled = await service.cancel(clerk, letter.id, { reason: 'Cơ quan gửi đã thu hồi.' });
    expect(cancelled).toMatchObject({ stage: 'cancelled', cancelReason: 'Cơ quan gửi đã thu hồi.' });
    expect(cancelled.steps.map((step) => step.status)).toEqual(['done', 'skipped', 'skipped']);
    expect(outbox.at(-1)?.payload['recipientUserIds']).toEqual(expect.arrayContaining(['u-accountant', 'u-lawyer', 'u-fin-head', 'u-legal-head']));
    expect(cancelled.actions).toMatchObject({ approve: false, cancel: false, comment: false, returnTargets: [] });
    await expect(service.approve(financeHead, letter.id, {})).rejects.toBeInstanceOf(LetterStageConflictError);
  });

  it('người soạn tự huỷ được dự thảo của mình khi đang soạn', async () => {
    const { service } = setup();
    const draft = await service.createOutgoing(accountant, { subject: 'Nháp', recipient: 'x' });
    await expect(service.cancel(financeHead, draft.id, { reason: 'x' })).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    await expect(service.cancel(accountant, draft.id, { reason: 'Soạn nhầm.' })).resolves.toMatchObject({ stage: 'cancelled' });
  });

  it('công văn mật chỉ người liên quan và người có quyền xem mật thấy', async () => {
    const { service } = setup();
    const letter = await dispatched(service, { confidentiality: 'confidential' });
    await expect(service.detail(actor('u-reader', { canReadAll: true }), letter.id)).rejects.toBeInstanceOf(LetterNotFoundError);
    await expect(service.detail(actor('u-secret', { canReadConfidential: true }), letter.id)).resolves.toBeDefined();
    await expect(service.detail(accountant, letter.id)).resolves.toBeDefined();
    expect((await service.list(actor('u-reader', { canReadAll: true }), { box: 'incoming' })).map((item) => item.id)).toEqual([]);
  });

  it('hộp "Việc của tôi" theo bước: văn thư, phòng ban, người duyệt', async () => {
    const { service } = setup();
    const letter = await reviewing(service);
    expect((await service.list(financeHead, { box: 'mine' })).map((item) => item.id)).toEqual([letter.id]);
    expect(await service.list(accountant, { box: 'mine' })).toEqual([]);
    const draft = await service.createOutgoing(accountant, { subject: 'Nháp', recipient: 'x' });
    expect((await service.list(accountant, { box: 'mine' })).map((item) => item.id)).toEqual([draft.id]);
    expect((await service.list(accountant, { box: 'outgoing' })).map((item) => item.id)).toEqual([draft.id]);
  });
});

describe('Huỷ công văn đã ban hành, xoá công văn đã huỷ', () => {
  /** Công văn đi kế toán soạn (có tệp dự thảo), duyệt qua trưởng phòng và lãnh đạo, văn thư đã ban hành. */
  async function published(service: CorrespondenceService) {
    const draft = await service.createOutgoing(accountant, { subject: 'Giải trình số liệu quyết toán', recipient: 'Sở Tài chính', kind: 'finance' });
    await service.createAttachment(accountant, draft.id, { kind: 'draft', fileName: 'du-thao.docx', contentType: 'application/msword', sizeBytes: 10 });
    await service.sendToClerk(accountant, draft.id, {});
    await service.submit(clerk, draft.id, {});
    await service.approve(financeHead, draft.id, {});
    await service.approve(leader, draft.id, {});
    return service.publish(clerk, draft.id, { recipient: 'Sở Tài chính' });
  }

  it('văn thư đề nghị thu hồi kèm lý do; người duyệt cuối theo cấu hình xác nhận, đồng ý thì công văn bị huỷ', async () => {
    const { service, outbox } = setup();
    const letter = await published(service);
    expect(letter.actions).toMatchObject({ requestRevoke: true, cancel: false });
    expect((await service.detail(accountant, letter.id)).actions.requestRevoke).toBe(false);
    await expect(service.requestRevoke(accountant, letter.id, { kind: 'recall', reason: 'x' })).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    await expect(service.requestRevoke(clerk, letter.id, { kind: 'recall', reason: '  ' })).rejects.toBeInstanceOf(CorrespondenceValidationError);
    await expect(service.requestRevoke(clerk, letter.id, { kind: 'burn' as never, reason: 'x' })).rejects.toBeInstanceOf(CorrespondenceValidationError);

    const pending = await service.requestRevoke(clerk, letter.id, { kind: 'recall', reason: 'Sai số liệu mục 2.' });
    expect(pending).toMatchObject({
      stage: 'revoking',
      stageLabel: 'Chờ duyệt huỷ',
      revoke: { kind: 'recall', kindLabel: 'Thu hồi', reason: 'Sai số liệu mục 2.', approverNames: ['Nguyễn Văn An'] },
    });
    expect(pending.flow.at(-1)).toMatchObject({ key: 'revoke', state: 'current', people: 'Nguyễn Văn An' });
    expect(pending.flow.slice(0, -1).every((node) => node.state === 'done')).toBe(true);
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.revokeRequested, payload: { recipientUserIds: ['u-leader'] } });

    // Người xác nhận thấy việc trong "Cần tôi xử lý"; người soạn, văn thư không xác nhận thay được.
    expect((await service.list(leader, { box: 'mine' })).map((item) => item.id)).toContain(letter.id);
    expect((await service.overview(leader)).awaitingMe).toBe(1);
    expect((await service.detail(leader, letter.id)).actions).toMatchObject({ decideRevoke: true, withdrawRevoke: false });
    await expect(service.decideRevoke(clerk, letter.id, { approve: true })).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    // Vẫn nằm trong kho lưu trữ cho tới khi được đồng ý.
    expect((await service.list(clerk, { box: 'archive' })).map((item) => item.id)).toContain(letter.id);

    const cancelled = await service.decideRevoke(leader, letter.id, { approve: true, note: 'Đồng ý thu hồi.' });
    expect(cancelled).toMatchObject({ stage: 'cancelled', cancelReason: 'Thu hồi: Sai số liệu mục 2.', revoke: { kind: 'recall' } });
    expect(cancelled.flow.at(-1)).toMatchObject({ key: 'revoke', state: 'done', people: 'Nguyễn Văn An' });
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.cancelled });
    expect(outbox.at(-1)?.payload['recipientUserIds']).toEqual(expect.arrayContaining(['u-clerk', 'u-accountant', 'u-fin-head']));
    expect(cancelled.history.map((item) => item.action)).toEqual(expect.arrayContaining(['revoke-request', 'revoke-approve']));
    await expect(service.decideRevoke(leader, letter.id, { approve: false })).rejects.toBeInstanceOf(LetterStageConflictError);
  });

  it('không đồng ý huỷ thì công văn về lại đã lưu trữ, văn thư được báo; văn thư rút được đề nghị', async () => {
    const { service, outbox } = setup();
    const letter = await published(service);
    await service.requestRevoke(clerk, letter.id, { kind: 'amend', reason: 'Ban hành văn bản thay thế.' });
    const kept = await service.decideRevoke(leader, letter.id, { approve: false, note: 'Giữ nguyên, ra văn bản bổ sung.' });
    expect(kept).toMatchObject({ stage: 'archived', revoke: undefined, archiveCode: 'HS-2026-0001' });
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.revokeRejected, payload: { recipientUserIds: ['u-clerk'] } });

    await service.requestRevoke(clerk, letter.id, { kind: 'recall', reason: 'Lần hai.' });
    expect((await service.detail(clerk, letter.id)).actions).toMatchObject({ withdrawRevoke: true, decideRevoke: false });
    const withdrawn = await service.withdrawRevoke(clerk, letter.id);
    expect(withdrawn).toMatchObject({ stage: 'archived', revoke: undefined });
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.revokeWithdrawn, payload: { recipientUserIds: ['u-leader'] } });
  });

  it('quy trình không có bước duyệt thì không có người xác nhận: đề nghị là huỷ luôn', async () => {
    const { service } = setup();
    const draft = await service.createOutgoing(accountant, { subject: 'Thông báo nghỉ lễ', recipient: 'Toàn công ty', kind: 'quick' });
    await service.sendToClerk(accountant, draft.id, {});
    await service.submit(clerk, draft.id, {});
    await service.publish(clerk, draft.id, { recipient: 'Toàn công ty' });
    const cancelled = await service.requestRevoke(clerk, draft.id, { kind: 'recall', reason: 'Đổi lịch nghỉ.' });
    expect(cancelled).toMatchObject({ stage: 'cancelled', cancelReason: 'Thu hồi: Đổi lịch nghỉ.' });
  });

  it('xoá công văn đã huỷ: văn thư mới xoá được, công văn biến mất khỏi danh sách, tệp vào Thùng rác', async () => {
    const { service, trashed } = setup();
    const letter = await published(service);
    // Chưa huỷ thì chưa xoá được (sai bước).
    await expect(service.remove(clerk, letter.id)).rejects.toBeInstanceOf(LetterStageConflictError);
    await service.requestRevoke(clerk, letter.id, { kind: 'recall', reason: 'Sai số liệu.' });
    const cancelled = await service.decideRevoke(leader, letter.id, { approve: true });
    expect(cancelled.actions.remove).toBe(false);
    expect((await service.detail(clerk, letter.id)).actions.remove).toBe(true);
    await expect(service.remove(accountant, letter.id)).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    await service.remove(clerk, letter.id);
    await expect(service.detail(clerk, letter.id)).rejects.toBeInstanceOf(LetterNotFoundError);
    expect((await service.list(clerk, { box: 'outgoing' })).map((item) => item.id)).not.toContain(letter.id);
    expect(trashed).toEqual(['doc-1']);
    await expect(service.remove(clerk, letter.id)).rejects.toBeInstanceOf(LetterNotFoundError);
  });
});

describe('Quy trình động: các bước giữa cấu hình tự do', () => {
  it('công văn đến: lãnh đạo chỉ đạo chọn phòng ban, phòng ban xử lý, trưởng phòng duyệt, văn thư rà soát', async () => {
    const { service } = setup();
    await service.saveWorkflow(configurer, undefined, {
      name: 'Lãnh đạo chỉ đạo trước',
      direction: 'incoming',
      isDefault: true,
      startName: 'Văn thư vào sổ',
      endName: 'Lưu hồ sơ',
      steps: [
        { key: 'direct', name: 'Lãnh đạo chỉ đạo', type: 'approve', approver: { type: 'users', userIds: ['u-leader'] } },
        { key: 'process', name: 'Phòng ban xử lý', type: 'process' },
        { key: 'head', name: 'Trưởng phòng kiểm tra', type: 'approve', approver: { type: 'handling_unit_heads' } },
        { key: 'review', name: 'Văn thư rà soát', type: 'check' },
      ],
    });
    const letter = await service.create(clerk, intake);
    expect(letter.flow.map((node) => [node.kind, node.label])).toEqual([
      ['start', 'Văn thư vào sổ'],
      ['approve', 'Lãnh đạo chỉ đạo'],
      ['process', 'Phòng ban xử lý'],
      ['approve', 'Trưởng phòng kiểm tra'],
      ['check', 'Văn thư rà soát'],
      ['end', 'Lưu hồ sơ'],
    ]);
    // Bước đầu là duyệt: văn thư không phải chọn phòng ban.
    const directing = await service.dispatch(clerk, letter.id, { kind: 'finance', urgency: 'normal' });
    expect(directing).toMatchObject({ stage: 'reviewing', currentStepName: 'Lãnh đạo chỉ đạo', currentAssigneeNames: ['Nguyễn Văn An'] });
    // Bước sau là phòng ban xử lý: lãnh đạo chọn phòng, ý kiến là chỉ đạo.
    await expect(service.approve(leader, letter.id, {})).rejects.toThrow('Chọn phòng ban xử lý cho bước "Phòng ban xử lý".');
    const processing = await service.approve(leader, letter.id, { note: 'Kế toán làm giải trình.', units: [{ unitId: 'unit-finance' }] });
    expect(processing).toMatchObject({ stage: 'processing', instruction: 'Kế toán làm giải trình.' });
    expect(processing.assignments.map((item) => item.unitName)).toEqual(['Phòng Kế toán']);
    const headStep = await service.respond(accountant, letter.id, processing.assignments[0].id, { note: 'Đã giải trình.' });
    expect(headStep).toMatchObject({ stage: 'reviewing', currentStepName: 'Trưởng phòng kiểm tra', currentAssigneeNames: ['KTT'] });
    const checking = await service.approve(financeHead, letter.id, {});
    expect(checking).toMatchObject({ stage: 'checking', stageLabel: 'Văn thư rà soát' });
    const clerkView = await service.detail(clerk, letter.id);
    expect(clerkView.actions).toMatchObject({ submit: true, defaultReturnTarget: 'previous-step' });
    // Văn thư trả lại bước liền trước (trưởng phòng), trưởng phòng duyệt lại.
    const back = await service.returnLetter(clerk, letter.id, { target: 'previous-step', reason: 'Thiếu chữ ký nháy.' });
    expect(back).toMatchObject({ stage: 'reviewing', currentStepName: 'Trưởng phòng kiểm tra' });
    await service.approve(financeHead, letter.id, {});
    const closing = await service.submit(clerk, letter.id, {});
    expect(closing.stage).toBe('closing');
    expect(closing.flow.map((node) => node.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'current']);
  });

  it('công văn đi: lãnh đạo duyệt trước, văn thư kiểm tra sau rồi ban hành', async () => {
    const { service } = setup();
    await service.saveWorkflow(configurer, undefined, {
      name: 'Duyệt trước, kiểm tra sau',
      direction: 'outgoing',
      isDefault: true,
      steps: [
        { key: 'sign', name: 'Lãnh đạo duyệt', type: 'approve', approver: { type: 'users', userIds: ['u-leader'] } },
        { key: 'check', name: 'Văn thư kiểm tra thể thức', type: 'check' },
      ],
    });
    const draft = await service.createOutgoing(accountant, { subject: 'Báo cáo quý', recipient: 'Sở', kind: 'finance' });
    const sent = await service.sendToClerk(accountant, draft.id, {});
    expect(sent).toMatchObject({ stage: 'reviewing', currentStepName: 'Lãnh đạo duyệt' });
    const checking = await service.approve(leader, draft.id, {});
    expect(checking.stage).toBe('checking');
    // Văn thư trả người soạn thì quy trình chạy lại từ đầu.
    expect((await service.detail(clerk, draft.id)).actions.returnTargets).toEqual(['previous-step', 'handlers']);
    const ready = await service.submit(clerk, draft.id, {});
    expect(ready.stage).toBe('publishing');
  });

  it('cấu hình bước: loại bước, bước duyệt phải có người duyệt, không để hai bước phòng ban liền nhau', async () => {
    const { service } = setup();
    const saved = await service.saveWorkflow(configurer, undefined, {
      name: 'Đủ loại',
      direction: 'incoming',
      steps: [
        { key: 'p', name: '', type: 'process' } as never,
        { key: 'c', name: 'Văn thư soát', type: 'check', approver: { type: 'users', userIds: ['u'] } } as never,
        { key: 'a', name: 'Duyệt', approver: { type: 'users', userIds: ['u-leader'] } },
      ],
    });
    expect(saved.steps.map((step) => [step.type, step.name, Boolean(step.approver)])).toEqual([
      ['process', 'Phòng ban xử lý', false],
      ['check', 'Văn thư soát', false],
      ['approve', 'Duyệt', true],
    ]);
    await expect(
      service.saveWorkflow(configurer, undefined, {
        name: 'Sai',
        direction: 'incoming',
        steps: [
          { key: 'p1', name: 'Phòng ban A', type: 'process' },
          { key: 'p2', name: 'Phòng ban B', type: 'process' },
        ],
      }),
    ).rejects.toThrow('đều là phòng ban xử lý, đứng liền nhau');
    await expect(
      service.saveWorkflow(configurer, undefined, { name: 'Thiếu', direction: 'incoming', steps: [{ key: 'a', name: 'Duyệt', type: 'approve' }] }),
    ).rejects.toThrow('chưa chọn cách xác định người duyệt');
  });
});

describe('Quy trình chuẩn văn bản đến: dựng bằng cấu hình', () => {
  /** Tiếp nhận → Lãnh đạo bút phê → Văn thư phân phối theo bút phê → Đơn vị chủ trì, phối hợp xử lý → Hoàn tất. */
  async function standardFlow(service: CorrespondenceService) {
    await service.saveWorkflow(configurer, undefined, {
      name: 'Văn bản đến theo chuẩn',
      direction: 'incoming',
      isDefault: true,
      steps: [
        { key: 'directive', name: 'Lãnh đạo bút phê', type: 'approve', directs: true, approver: { type: 'users', userIds: ['u-leader'] } },
        { key: 'distribute', name: 'Văn thư phân phối', type: 'check' },
        { key: 'process', name: 'Đơn vị xử lý', type: 'process' },
      ],
    });
  }

  it('lãnh đạo bút phê đơn vị chủ trì, phối hợp, thời hạn; văn thư phân phối theo bút phê', async () => {
    const { service } = setup();
    await standardFlow(service);
    const letter = await service.create(clerk, intake);
    const presented = await service.dispatch(clerk, letter.id, { kind: 'finance', urgency: 'urgent' });
    expect(presented).toMatchObject({ stage: 'reviewing', currentStepName: 'Lãnh đạo bút phê' });
    expect(presented.steps[0]).toMatchObject({ directs: true });
    const directed = await service.approve(leader, letter.id, {
      note: 'Kế toán chủ trì, Pháp chế phối hợp, trả lời Sở trước 20/11.',
      dueOn: '2026-11-20',
      units: [{ unitId: 'unit-finance', role: 'lead' }, { unitId: 'unit-legal', role: 'support', handlerUserId: 'u-lawyer' }],
    });
    expect(directed).toMatchObject({ stage: 'checking', stageLabel: 'Văn thư phân phối', dueOn: '2026-11-20' });
    expect(directed.directive).toMatchObject({
      note: 'Kế toán chủ trì, Pháp chế phối hợp, trả lời Sở trước 20/11.',
      dueOn: '2026-11-20',
      stepName: 'Lãnh đạo bút phê',
      byName: 'Nguyễn Văn An',
      units: [
        { unitId: 'unit-finance', unitName: 'Phòng Kế toán', role: 'lead' },
        { unitId: 'unit-legal', unitName: 'Phòng Pháp chế', role: 'support', handlerName: 'Pháp chế' },
      ],
    });
    expect(directed.history.at(-1)?.summary).toBe('Lãnh đạo bút phê: bút phê; giao Phòng Kế toán (chủ trì), Phòng Pháp chế (phối hợp)');
    // Văn thư không chọn lại: giao đúng theo bút phê.
    const distributed = await service.submit(clerk, letter.id, {});
    expect(distributed).toMatchObject({ stage: 'processing', instruction: 'Kế toán chủ trì, Pháp chế phối hợp, trả lời Sở trước 20/11.' });
    expect(distributed.assignments.map((item) => [item.unitName, item.role, item.handlerUserId])).toEqual([
      ['Phòng Kế toán', 'lead', undefined],
      ['Phòng Pháp chế', 'support', 'u-lawyer'],
    ]);
    const [list] = await service.list(clerk, { box: 'incoming' });
    expect(list.unitNames).toEqual(['Phòng Kế toán (chủ trì)', 'Phòng Pháp chế (phối hợp)']);
    await expect(service.approve(leader, letter.id, {})).rejects.toBeInstanceOf(LetterStageConflictError);
  });

  it('ủy quyền: cấp phó được ủy quyền bút phê thay trong khoảng ngày, ghi rõ duyệt thay ai', async () => {
    const { service } = setup();
    await standardFlow(service);
    const leaderTwo = actor('u-leader-2');
    await expect(
      service.saveSettings(configurer, {
        ...DEFAULT_CORRESPONDENCE_SETTINGS,
        delegations: [{ fromUserId: 'u-leader', toUserId: 'u-leader', fromDate: '2026-11-10', toDate: '2026-11-15' }],
      }),
    ).rejects.toThrow('người được ủy quyền phải khác người ủy quyền');
    await expect(
      service.saveSettings(configurer, {
        ...DEFAULT_CORRESPONDENCE_SETTINGS,
        delegations: [{ fromUserId: 'u-leader', toUserId: 'u-leader-2', fromDate: '2026-11-15', toDate: '2026-11-10' }],
      }),
    ).rejects.toThrow('đến ngày phải sau từ ngày');
    await service.saveSettings(configurer, {
      ...DEFAULT_CORRESPONDENCE_SETTINGS,
      delegations: [{ fromUserId: 'u-leader', toUserId: 'u-leader-2', fromDate: '2026-11-10', toDate: '2026-11-15', note: 'TGĐ đi công tác' }],
    });
    const letter = await service.create(clerk, intake);
    const presented = await service.dispatch(clerk, letter.id, { kind: 'finance', urgency: 'normal' });
    expect(presented.currentAssigneeNames).toEqual(['Nguyễn Văn An', 'Trần Minh Châu']);
    expect((await service.list(leaderTwo, { box: 'mine' })).map((item) => item.id)).toContain(letter.id);
    const done = await service.approve(leaderTwo, letter.id, { units: [{ unitId: 'unit-finance' }] });
    expect(done.history.at(-1)?.summary).toContain('(ủy quyền của Nguyễn Văn An)');

    // Hết hạn ủy quyền: chỉ người ủy quyền.
    await service.saveSettings(configurer, {
      ...DEFAULT_CORRESPONDENCE_SETTINGS,
      delegations: [{ fromUserId: 'u-leader', toUserId: 'u-leader-2', fromDate: '2026-11-01', toDate: '2026-11-05' }],
    });
    const later = await service.create(clerk, intake);
    expect((await service.dispatch(clerk, later.id, { kind: 'finance', urgency: 'normal' })).currentAssigneeNames).toEqual(['Nguyễn Văn An']);
  });

  it('tiếp nhận: phân loại sơ bộ (bì, niêm phong, số tờ, số bản), văn bản gửi đích danh báo người nhận', async () => {
    const { service, outbox } = setup();
    await expect(service.create(clerk, { ...intake, envelopeStatus: 'burnt' as never })).rejects.toThrow('Tình trạng bì');
    await expect(service.create(clerk, { ...intake, pageCount: -1 })).rejects.toThrow('Số tờ là số từ 0 đến 10000.');
    const letter = await service.create(clerk, {
      ...intake,
      confidentiality: 'confidential',
      envelopeStatus: 'damaged',
      sealed: true,
      pageCount: 12,
      copyCount: 2,
      addressedTo: 'Công đoàn công ty',
      addressedUserId: 'u-lawyer',
    });
    expect(letter).toMatchObject({
      envelopeStatus: 'damaged',
      sealed: true,
      pageCount: 12,
      copyCount: 2,
      addressedTo: 'Công đoàn công ty',
      addressedUserName: 'Pháp chế',
    });
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.addressed, payload: { recipientUserIds: ['u-lawyer'] } });
    // Người nhận đích danh xem được công văn mật gửi mình.
    await expect(service.detail(lawyer, letter.id)).resolves.toBeDefined();
    const edited = await service.update(clerk, letter.id, { pageCount: 13, addressedTo: '' });
    expect(edited).toMatchObject({ pageCount: 13, addressedTo: undefined, copyCount: 2 });
  });

  it('theo dõi, đôn đốc: văn thư nhắc người đang xử lý; danh sách theo hạn, quá hạn lên đầu', async () => {
    const { service, outbox } = setup();
    const late = await service.create(clerk, { ...intake, receivedOn: '2026-11-01', dueOn: '2026-11-05' });
    const soon = await dispatched(service);
    await service.create(clerk, { ...intake, dueOn: undefined });
    const tracking = await service.list(clerk, { box: 'tracking' });
    expect(tracking.map((item) => item.id).slice(0, 2)).toEqual([late.id, soon.id]);
    expect(soon.actions.remind).toBe(true);
    await expect(service.remind(accountant, soon.id, {})).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    const reminded = await service.remind(clerk, soon.id, { note: 'Sở hỏi lại, gửi kết quả trong hôm nay.' });
    expect(reminded.history.at(-1)).toMatchObject({ action: 'remind', summary: 'Đôn đốc bước "Phòng ban xử lý"' });
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.reminded });
    expect(outbox.at(-1)?.payload['recipientUserIds']).toEqual(expect.arrayContaining(['u-fin-head', 'u-accountant', 'u-lawyer']));
    // Bộ phận tổng hợp (xem báo cáo) cũng đôn đốc được.
    await expect(service.remind(actor('u-outsider', { canReadReports: true, canReadAll: true }), soon.id, {})).resolves.toBeDefined();
  });
});

describe('Ô đầu, ô cuối cấu hình được', () => {
  it('tự chuyển bước đầu khi vào sổ: giao phòng ban gợi ý của loại văn bản', async () => {
    const { service, outbox } = setup();
    await service.saveCatalogItem(configurer, 'letter_type-finance', {
      kind: 'letter_type',
      code: 'finance',
      name: 'Tài chính – thuế',
      defaultDueDays: 7,
      defaultUnitIds: ['unit-finance', 'unit-legal'],
    });
    await service.saveWorkflow(configurer, undefined, {
      name: 'Vào sổ là giao',
      direction: 'incoming',
      isDefault: true,
      autoStart: true,
      steps: [{ key: 'p', name: 'Phòng ban xử lý', type: 'process' }],
    });
    const letter = await service.create(clerk, intake);
    expect(letter).toMatchObject({ stage: 'processing' });
    expect(letter.assignments.map((item) => [item.unitName, item.role])).toEqual([
      ['Phòng Kế toán', 'lead'],
      ['Phòng Pháp chế', 'support'],
    ]);
    expect(outbox.some((event) => event.type === CORRESPONDENCE_EVENTS.assigned)).toBe(true);
    // Loại văn bản không có phòng gợi ý: văn thư chuyển tay như thường.
    expect((await service.create(clerk, { ...intake, kind: 'quick' })).stage).toBe('received');
  });

  it('người làm ô cuối theo cấu hình, không cấp số hồ sơ khi tắt lưu trữ', async () => {
    const { service } = setup();
    await expect(
      service.saveWorkflow(configurer, undefined, {
        name: 'Sai',
        direction: 'incoming',
        endActor: { type: 'choose', pool: 'leaders' },
        steps: [],
      }),
    ).rejects.toThrow('Ô cuối không dùng được luật');
    await service.saveWorkflow(configurer, undefined, {
      name: 'Pháp chế chốt',
      direction: 'incoming',
      isDefault: true,
      endName: 'Pháp chế hoàn tất',
      endActor: { type: 'users', userIds: ['u-legal-head'] },
      archive: false,
      steps: [{ key: 'p', name: 'Phòng ban xử lý', type: 'process' }],
    });
    const letter = await service.create(clerk, intake);
    const processing = await service.dispatch(clerk, letter.id, { kind: 'finance', urgency: 'normal', units: [{ unitId: 'unit-finance' }] });
    const closing = await service.respond(accountant, letter.id, processing.assignments[0].id, { note: 'Xong.' });
    expect(closing).toMatchObject({ stage: 'closing' });
    expect(closing.flow.at(-1)).toMatchObject({ label: 'Pháp chế hoàn tất', state: 'current', people: 'TP Pháp chế' });
    expect((await service.detail(clerk, letter.id)).actions.complete).toBe(false);
    expect((await service.detail(legalHead, letter.id)).actions.complete).toBe(true);
    expect((await service.list(legalHead, { box: 'mine' })).map((item) => item.id)).toContain(letter.id);
    const done = await service.complete(legalHead, letter.id, {});
    expect(done).toMatchObject({ stage: 'archived', stageLabel: 'Đã hoàn tất', archiveCode: undefined });
  });

  it('tự hoàn tất / tự ban hành khi xong bước cuối', async () => {
    const { service } = setup();
    await service.saveWorkflow(configurer, undefined, {
      name: 'Tự hoàn tất',
      direction: 'incoming',
      isDefault: true,
      autoEnd: true,
      steps: [{ key: 'p', name: 'Phòng ban xử lý', type: 'process' }],
    });
    const letter = await service.create(clerk, intake);
    const processing = await service.dispatch(clerk, letter.id, { kind: 'finance', urgency: 'normal', units: [{ unitId: 'unit-finance' }] });
    const done = await service.respond(accountant, letter.id, processing.assignments[0].id, { note: 'Xong.' });
    expect(done).toMatchObject({ stage: 'archived', archiveCode: 'HS-2026-0001' });
    expect(done.history.at(-1)?.summary).toBe('Tự động: Hoàn tất; lưu trữ hồ sơ số HS-2026-0001');

    await service.saveWorkflow(configurer, undefined, {
      name: 'Duyệt là ban hành',
      direction: 'outgoing',
      isDefault: true,
      autoEnd: true,
      steps: [{ key: 'a', name: 'Lãnh đạo duyệt', type: 'approve', approver: { type: 'users', userIds: ['u-leader'] } }],
    });
    const draft = await service.createOutgoing(accountant, { subject: 'Thông báo', recipient: 'Toàn công ty', kind: 'finance' });
    await service.sendToClerk(accountant, draft.id, {});
    const issued = await service.approve(leader, draft.id, {});
    expect(issued).toMatchObject({ stage: 'archived', outgoingNo: '1/CV', recipient: 'Toàn công ty', deliveryStatus: 'sent' });
  });
});

describe('Tệp kèm: lưu ở Hệ dùng chung, có phiên bản', () => {
  it('xếp vào thư mục năm / luồng / hồ sơ của công văn; tệp sau vào thẳng thư mục hồ sơ', async () => {
    const { service, created } = setup();
    const letter = await service.create(clerk, intake);
    const ticket = await service.createAttachment(clerk, letter.id, {
      kind: 'incoming',
      fileName: 'scan.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(ticket).toMatchObject({ uploadUrl: 'https://files.example/1', attachment: { versionNo: 1, canVersion: true } });
    expect(created[0]).toMatchObject({ rootName: CORRESPONDENCE_FILING_ROOT, partner: 'Sở Tài chính TP. Đà Nẵng' });
    expect(created[0].path?.map((segment) => segment.name)).toEqual([
      '2026',
      'Công văn đến',
      '1/CVĐ - Yêu cầu giải trình số liệu quyết toán thuế TNDN năm 2025',
    ]);
    await service.createAttachment(clerk, letter.id, { kind: 'reference', fileName: 'b.pdf', contentType: 'application/pdf', sizeBytes: 1 });
    expect(created[1]).toMatchObject({ folderId: 'folder-1' });
    expect(created[1].path).toBeUndefined();

    const draft = await service.createOutgoing(accountant, { subject: 'Giải trình', recipient: 'Sở Tài chính' });
    await service.createAttachment(accountant, draft.id, { kind: 'draft', fileName: 'du-thao.docx', contentType: 'application/msword', sizeBytes: 5 });
    expect(created[2].path?.map((segment) => segment.name)).toEqual(['2026', 'Công văn đi', '1/DT - Giải trình']);
  });

  it('phòng ban đính kèm kết quả cho phòng mình; tải phiên bản mới, phiên bản cũ giữ ở kho', async () => {
    const { service, versions } = setup();
    const letter = await dispatched(service);
    const [finance, legal] = letter.assignments;
    await expect(
      service.createAttachment(accountant, letter.id, { kind: 'draft', assignmentId: legal.id, fileName: 'a.docx', contentType: 'x', sizeBytes: 1 }),
    ).rejects.toBeInstanceOf(CorrespondenceValidationError);
    const ticket = await service.createAttachment(accountant, letter.id, {
      kind: 'draft',
      assignmentId: finance.id,
      fileName: 'ket-qua.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 100,
    });
    await service.completeAttachment(accountant, letter.id, ticket.attachment.id, 100);
    await expect(
      service.addAttachmentVersion(lawyer, letter.id, ticket.attachment.id, { fileName: 'x.docx', contentType: 'x', sizeBytes: 1 }),
    ).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    const version = await service.addAttachmentVersion(financeHead, letter.id, ticket.attachment.id, {
      fileName: 'ket-qua-v2.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 120,
      note: 'Sửa số liệu',
    });
    expect(version.attachment).toMatchObject({ versionNo: 2, fileName: 'ket-qua-v2.docx', sizeBytes: undefined, uploadedBy: 'u-fin-head' });
    expect(versions).toEqual([{ documentId: 'doc-1', fileName: 'ket-qua-v2.docx' }]);
    await service.completeAttachment(financeHead, letter.id, ticket.attachment.id, 120);
    const detail = await service.detail(accountant, letter.id);
    expect(detail.attachments[0]).toMatchObject({ versionNo: 2, sizeBytes: 120, canVersion: true });
    expect(detail.history.at(-1)).toMatchObject({ action: 'version' });
  });

  it('xem trước lấy URL chế độ xem; tệp chưa tải xong thì chưa mở được', async () => {
    const { service } = setup();
    const letter = await service.create(clerk, intake);
    const ticket = await service.createAttachment(clerk, letter.id, { kind: 'incoming', fileName: 'scan.pdf', contentType: 'application/pdf', sizeBytes: 1 });
    await expect(service.download(clerk, letter.id, ticket.attachment.id, 'preview')).rejects.toThrow('chưa tải lên xong');
    await service.completeAttachment(clerk, letter.id, ticket.attachment.id, 1);
    await expect(service.download(clerk, letter.id, ticket.attachment.id, 'preview')).resolves.toMatchObject({ contentType: 'application/pdf' });
    await expect(service.download(outsider, letter.id, ticket.attachment.id, 'preview')).rejects.toBeInstanceOf(LetterNotFoundError);
  });
});

describe('Cây lưu trữ', () => {
  it('năm › công văn đến / đi › hồ sơ › tệp, chỉ công văn người xem thấy, bỏ công văn đã huỷ', async () => {
    const { service } = setup();
    const letter = await dispatched(service);
    await service.createAttachment(clerk, letter.id, { kind: 'incoming', fileName: 'scan.pdf', contentType: 'application/pdf', sizeBytes: 1 });
    await service.createAttachment(accountant, letter.id, {
      kind: 'draft',
      assignmentId: letter.assignments[0].id,
      fileName: 'ket-qua.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1,
    });
    await service.createOutgoing(accountant, { subject: 'Giải trình', recipient: 'Sở Tài chính' });
    const cancelled = await service.create(clerk, { ...intake, subject: 'Trùng' });
    await service.cancel(clerk, cancelled.id, { reason: 'Trùng.' });

    const tree = await service.archiveTree(clerk);
    expect(tree.rootName).toBe(CORRESPONDENCE_FILING_ROOT);
    expect(tree.years.map((year) => year.year)).toEqual([2026]);
    expect(tree.years[0].groups.map((group) => [group.label, group.dossiers.map((dossier) => dossier.folderName)])).toEqual([
      ['Công văn đến', ['1/CVĐ - Yêu cầu giải trình số liệu quyết toán thuế TNDN năm 2025']],
      ['Công văn đi', ['1/DT - Giải trình']],
    ]);
    expect(tree.years[0].groups[0].dossiers[0].files.map((file) => [file.fileName, file.unitName])).toEqual([
      ['scan.pdf', undefined],
      ['ket-qua.xlsx', 'Phòng Kế toán'],
    ]);
    const forLawyer = await service.archiveTree(lawyer);
    expect(forLawyer.years[0].groups.map((group) => group.label)).toEqual(['Công văn đến']);
    expect((await service.archiveTree(outsider)).years).toEqual([]);
  });
});

describe('Người làm văn thư được chỉ định', () => {
  it('làm được việc văn thư, nhận thông báo thay người giữ quyền, tên hiện ở bước của văn thư', async () => {
    const { service, outbox, setSettings } = setup();
    setSettings({ clerkUserIds: ['u-lawyer'] });
    // Người được chỉ định làm được việc văn thư dù chưa có quyền trong Phân quyền.
    expect((await service.status(lawyer)).capabilities).toMatchObject({ canRegister: true, canPublish: true, canCreateOutgoing: true });
    const draft = await service.createOutgoing(accountant, { subject: 'Giải trình', recipient: 'Sở Tài chính', kind: 'finance' });
    expect(draft.flow[1]).toMatchObject({ label: 'Văn thư kiểm tra', people: 'Pháp chế' });
    expect(draft.flow.at(-1)).toMatchObject({ label: 'Văn thư ban hành, lưu trữ', people: 'Pháp chế' });
    await service.sendToClerk(accountant, draft.id, {});
    expect(outbox.at(-1)).toMatchObject({
      type: CORRESPONDENCE_EVENTS.sentToClerk,
      payload: { recipientUserIds: ['u-lawyer'], notifyPermissions: [] },
    });
    // Việc chờ văn thư: chỉ người được chỉ định thấy trong "Cần tôi xử lý"; văn thư khác vẫn làm thay được.
    expect((await service.list(lawyer, { box: 'mine' })).map((item) => item.id)).toEqual([draft.id]);
    expect(await service.list(clerk, { box: 'mine' })).toEqual([]);
    const submitted = await service.submit(lawyer, draft.id, {});
    expect(submitted.flow[1]).toMatchObject({ state: 'done', people: 'Pháp chế' });
  });

  it('chỉ chọn được người dùng đang hoạt động, tối đa 10 người', async () => {
    const { service } = setup();
    await expect(
      service.saveSettings(configurer, { ...DEFAULT_CORRESPONDENCE_SETTINGS, clerkUserIds: ['u-ghost'] }),
    ).rejects.toThrow('không còn hoạt động');
    await expect(
      service.saveSettings(configurer, { ...DEFAULT_CORRESPONDENCE_SETTINGS, clerkUserIds: Array.from({ length: 11 }, (_, index) => `u-${index}`) }),
    ).rejects.toThrow('tối đa 10');
    const saved = await service.saveSettings(configurer, { ...DEFAULT_CORRESPONDENCE_SETTINGS, clerkUserIds: ['u-clerk', 'u-clerk', 'u-lawyer'] });
    expect(saved.clerkUserIds).toEqual(['u-clerk', 'u-lawyer']);
  });
});

describe('Cấu hình động', () => {
  it('quy trình theo luồng, mỗi luồng một mặc định; không đổi được luồng của quy trình đã có', async () => {
    const { service, workflows } = setup();
    await expect(service.saveWorkflow(configurer, undefined, { name: 'x', steps: [] } as never)).rejects.toThrow('Luồng công văn');
    const saved = await service.saveWorkflow(configurer, undefined, {
      name: 'Đi nhanh',
      direction: 'outgoing',
      isDefault: true,
      steps: [{ key: 'a', name: 'TGĐ duyệt', approver: { type: 'users', userIds: ['u-leader'] }, rejectTo: 'clerk' }],
    });
    expect(saved).toMatchObject({ direction: 'outgoing', isDefault: true });
    expect(saved.steps[0]).toMatchObject({ rejectTo: 'clerk' });
    expect(workflows.find((item) => item.id === 'wf-in')?.isDefault).toBe(true);
    expect(workflows.find((item) => item.id === 'wf-out')?.isDefault).toBe(false);
    await expect(service.saveWorkflow(configurer, saved.id, { ...saved, direction: 'incoming' })).rejects.toThrow('Không đổi được luồng');
    await expect(
      service.saveWorkflow(configurer, undefined, {
        name: 'Sai',
        direction: 'incoming',
        steps: [{ key: 'a', name: 'A', approver: { type: 'users', userIds: ['u'] }, rejectTo: 'nowhere' as never }],
      }),
    ).rejects.toThrow('nơi trả về khi không đạt không hợp lệ');
    await expect(service.saveWorkflow(leader, undefined, { name: 'x', direction: 'incoming', steps: [] })).rejects.toBeInstanceOf(
      CorrespondenceForbiddenError,
    );
  });

  it('loại văn bản gắn quy trình đúng luồng và phòng ban gợi ý', async () => {
    const { service } = setup();
    await expect(
      service.saveCatalogItem(configurer, undefined, { kind: 'letter_type', code: 'contract', name: 'Hợp đồng', outgoingWorkflowId: 'wf-in' }),
    ).rejects.toThrow('Quy trình công văn đi được chọn không còn.');
    const saved = await service.saveCatalogItem(configurer, undefined, {
      kind: 'letter_type',
      code: 'contract',
      name: 'Hợp đồng',
      workflowId: 'wf-none',
      outgoingWorkflowId: 'wf-out-none',
      defaultUnitIds: ['unit-legal', 'unit-legal'],
    });
    expect(saved).toMatchObject({ workflowId: 'wf-none', outgoingWorkflowId: 'wf-out-none', defaultUnitIds: ['unit-legal'] });
  });

  it('thêm nhanh danh mục lúc nhập: văn thư và người cấu hình thêm được, mã tự sinh, không tạo trùng tên', async () => {
    const { service } = setup();
    await expect(service.quickAddCatalogItem(accountant, { kind: 'letter_type', name: 'Tờ trình' })).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    const added = await service.quickAddCatalogItem(clerk, { kind: 'letter_type', name: '  Chỉ đạo - điều  hành ' });
    expect(added).toMatchObject({ kind: 'letter_type', code: 'chi-dao-dieu-hanh', name: 'Chỉ đạo - điều hành', isActive: true });
    const again = await service.quickAddCatalogItem(configurer, { kind: 'letter_type', name: 'chỉ đạo - ĐIỀU HÀNH' });
    expect(again.id).toBe(added.id);
    const other = await service.quickAddCatalogItem(configurer, { kind: 'urgency', name: 'Hoả tốc' });
    expect(other).toMatchObject({ kind: 'urgency', code: 'hoa-toc' });
    await expect(service.quickAddCatalogItem(clerk, { kind: 'letter_type', name: ' ' })).rejects.toBeInstanceOf(CorrespondenceValidationError);
  });

  it('cách giao phòng ban lưu trong cấu hình sổ', async () => {
    const { service } = setup();
    const saved = await service.saveSettings(configurer, { ...DEFAULT_CORRESPONDENCE_SETTINGS, dispatchMode: 'handler' });
    expect(saved.dispatchMode).toBe('handler');
    await expect(service.saveSettings(configurer, { ...DEFAULT_CORRESPONDENCE_SETTINGS, dispatchMode: 'x' as never })).rejects.toThrow(
      'Cách giao phòng ban',
    );
  });
});

describe('Báo cáo', () => {
  it('đếm công văn đến, đi, đã xong, trễ hạn theo tháng, loại văn bản và phòng ban', async () => {
    const { service } = setup();
    await dispatched(service);
    await service.createOutgoing(accountant, { subject: 'Giải trình', recipient: 'Sở Tài chính', kind: 'finance' });
    const cancelled = await service.create(clerk, intake);
    await service.cancel(clerk, cancelled.id, { reason: 'Trùng.' });
    const report = await service.report(clerk);
    expect(report.year).toBe(2026);
    expect(report.totals).toEqual({ incoming: 1, outgoing: 1, completed: 0, open: 2, late: 0 });
    expect(report.byMonth[10]).toMatchObject({ label: 'Tháng 11', incoming: 1, outgoing: 1 });
    expect(report.byType).toEqual([expect.objectContaining({ label: 'Tài chính – thuế', incoming: 1, outgoing: 1 })]);
    expect(report.byUnit.map((row) => [row.label, row.incoming, row.outgoing])).toEqual([
      ['Phòng Kế toán', 1, 1],
      ['Phòng Pháp chế', 1, 0],
    ]);
    await expect(service.report(accountant)).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    await expect(service.report(clerk, '1999')).rejects.toThrow('Năm báo cáo không hợp lệ.');
  });
});

describe('flowOf', () => {
  it('công văn đã huỷ giữ các bước đã xong', () => {
    const nodes = flowOf('incoming', 'cancelled', [
      { seq: 1, name: 'A', status: 'done' },
      { seq: 2, name: 'B', status: 'skipped' },
    ]);
    expect(nodes.map((node) => node.state)).toEqual(['done', 'done', 'todo', 'todo']);
  });
});
