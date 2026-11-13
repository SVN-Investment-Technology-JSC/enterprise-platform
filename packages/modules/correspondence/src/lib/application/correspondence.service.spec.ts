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
import { CORRESPONDENCE_FILING_ROOT, CorrespondenceService } from './correspondence.service.js';
import {
  FileStoreMissingError,
  type AssignmentRecord,
  type AttachmentRecord,
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
    canPublish: false,
    canArchive: false,
    canDirect: false,
    canReadAll: false,
    canReadConfidential: false,
    canConfigure: false,
    ...overrides,
  };
}

const clerk = actor('u-clerk', { canRegister: true, canPublish: true, canArchive: true, canReadAll: true });
const leader = actor('u-leader', { canDirect: true });
const otherLeader = actor('u-leader-2', { canDirect: true });
const accountant = actor('u-accountant');
const financeHead = actor('u-fin-head');
const lawyer = actor('u-lawyer');
const legalHead = actor('u-legal-head');
const chief = actor('u-chief');
const outsider = actor('u-outsider');
const reader = actor('u-reader', { canReadAll: true });
const configurer = actor('u-config', { canConfigure: true });

const organization: OrganizationSnapshot = {
  nodes: [
    { id: 'unit-company', name: 'Công ty', kind: 'unit' },
    { id: 'unit-office', name: 'Văn phòng', parentId: 'unit-company', kind: 'unit' },
    { id: 'pos-chief', name: 'Chánh văn phòng', parentId: 'unit-office', kind: 'position' },
    { id: 'unit-finance', name: 'Phòng Kế toán – Tài chính', parentId: 'unit-company', kind: 'unit' },
    { id: 'pos-fin-head', name: 'Kế toán trưởng', parentId: 'unit-finance', kind: 'position' },
    { id: 'pos-accountant', name: 'Kế toán viên', parentId: 'unit-finance', kind: 'position' },
    { id: 'unit-legal', name: 'Phòng Pháp chế', parentId: 'unit-company', kind: 'unit' },
    { id: 'pos-legal-head', name: 'Trưởng phòng pháp chế', parentId: 'unit-legal', kind: 'position' },
    { id: 'pos-lawyer', name: 'Chuyên viên pháp chế', parentId: 'unit-legal', kind: 'position' },
  ],
  members: [
    { userId: 'u-chief', name: 'Chánh VP', nodeId: 'pos-chief', positionName: 'Chánh văn phòng', isHead: true },
    { userId: 'u-fin-head', name: 'KTT', nodeId: 'pos-fin-head', positionName: 'Kế toán trưởng', isHead: true },
    { userId: 'u-accountant', name: 'Kế toán', nodeId: 'pos-accountant', positionName: 'Kế toán viên', isHead: false },
    { userId: 'u-legal-head', name: 'TP Pháp chế', nodeId: 'pos-legal-head', isHead: true },
    { userId: 'u-lawyer', name: 'Pháp chế', nodeId: 'pos-lawyer', isHead: false },
  ],
  degraded: false,
};

const DEFAULT_STEPS: WorkflowStep[] = [
  { key: 'direct', name: 'Lãnh đạo chỉ đạo', kind: 'direct', approver: { type: 'choose', pool: 'leaders' } },
  { key: 'unit-check', name: 'Trưởng phòng kiểm tra', kind: 'approve', approver: { type: 'assigned_unit_heads' } },
  { key: 'sign', name: 'Lãnh đạo duyệt và ký', kind: 'approve', approver: { type: 'director' } },
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
    item('letter_type', 'other', 'Khác', { sortOrder: 9 }),
    item('letter_type', 'old', 'Đã bỏ', { isActive: false }),
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
  const history = new Map<string, HistoryRecord[]>();
  const outbox: OutboxEvent[] = [];
  const counters = new Map<string, number>();
  let catalog = catalogSeed();
  const workflows: Workflow[] = [
    { id: 'wf-default', name: 'Quy trình mặc định', isActive: true, isDefault: true, steps: DEFAULT_STEPS, updatedAt: TODAY },
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

  const transaction = (letterId: string): LetterTransaction => ({
    get letter() {
      return letters.get(letterId) as LetterRecord;
    },
    get steps() {
      return stepsOf(letterId);
    },
    get assignments() {
      return assignments.filter((item) => item.letterId === letterId);
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
        steps.push({ id: id('step'), letterId, seq: index + 1, name: step.name, kind: step.kind, approver: step.approver, status: 'waiting', assigneeUserIds: [] }),
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
        ...(update.actedBy !== undefined ? { actedBy: update.actedBy ?? undefined } : {}),
        ...(update.decision !== undefined ? { decision: update.decision ?? undefined } : {}),
        ...(update.note !== undefined ? { note: update.note ?? undefined } : {}),
      };
    },
    assign: async (units) => {
      for (const unit of units) {
        assignments.push({ id: id('assignment'), letterId, unitId: unit.unitId, unitName: unit.unitName, round: 1, status: 'pending' });
      }
    },
    submitAssignment: async (assignmentId, input) => {
      const index = assignments.findIndex((item) => item.id === assignmentId);
      assignments[index] = { ...assignments[index], status: 'submitted', responseNote: input.note, submittedBy: input.userId, submittedAt: TODAY };
    },
    reopenAssignments: async (ids, reason) => {
      for (const assignmentId of ids) {
        const index = assignments.findIndex((item) => item.id === assignmentId);
        assignments[index] = { ...assignments[index], status: 'pending', round: assignments[index].round + 1, revisionReason: reason, submittedAt: undefined };
      }
    },
    addAttachment: async (input) => {
      const created: AttachmentRecord = { ...input, id: id('attachment'), letterId, createdAt: TODAY };
      attachments.push(created);
      return created;
    },
    removeAttachment: async (attachmentId) => {
      attachments.splice(attachments.findIndex((item) => item.id === attachmentId), 1);
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
      if (catalog.some((item) => item.kind === input.kind && item.code === input.code && item.id !== itemId)) {
        throw new CorrespondenceValidationError('trùng mã');
      }
      const saved: CatalogItem = {
        id: itemId ?? id('catalog'),
        kind: input.kind,
        code: input.code,
        name: input.name,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        defaultDueDays: input.defaultDueDays ?? undefined,
        workflowId: input.workflowId ?? undefined,
        highlight: input.highlight,
        restricted: input.restricted,
      };
      catalog = [...catalog.filter((item) => item.id !== saved.id), saved];
      return saved;
    },
    deleteCatalogItem: async (_tenant, itemId) => {
      const item = catalog.find((entry) => entry.id === itemId);
      if (!item || [...letters.values()].some((letter) => letter.kind === item.code)) return false;
      catalog = catalog.filter((entry) => entry.id !== itemId);
      return true;
    },
    workflows: async () => workflows,
    saveWorkflow: async (_tenant, _user, workflowId, input) => {
      if (input.isDefault) workflows.forEach((item, index) => (workflows[index] = { ...item, isDefault: false }));
      const saved: Workflow = { ...input, id: workflowId ?? id('wf'), description: input.description ?? undefined, updatedAt: TODAY };
      const index = workflows.findIndex((item) => item.id === saved.id);
      if (index >= 0) workflows[index] = saved;
      else workflows.push(saved);
      return saved;
    },
    deleteWorkflow: async () => false,
    createLetter: async (_tenant, input, suffix, after) => {
      const year = Number(input.receivedOn.slice(0, 4));
      const seq = next('incoming', year);
      const letter: LetterRecord = { ...input, id: id('letter'), year, seq, incomingNo: formatSequenceNo(seq, suffix), stage: 'received', createdAt: TODAY, updatedAt: TODAY };
      letters.set(letter.id, letter);
      await after(transaction(letter.id));
      return letter;
    },
    withLetter: async (_tenant, letterId, work) => {
      if (!letters.has(letterId)) throw new LetterNotFoundError();
      // Lỗi giữa chừng không để lại thay đổi, như rollback.
      const snapshot = {
        letters: new Map(letters),
        steps: steps.map((step) => ({ ...step })),
        assignments: [...assignments],
        attachments: [...attachments],
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
        outbox.splice(snapshot.outbox);
        throw error;
      }
    },
    findLetter: async (_tenant, letterId) => letters.get(letterId),
    listLetters: async (_tenant, filter) =>
      [...letters.values()]
        .filter((letter) => !filter.stages || filter.stages.includes(letter.stage))
        .filter((letter) => !filter.onlyPublished || Boolean(letter.outgoingNo))
        .map((letter) => ({ ...letter, steps: stepsOf(letter.id), assignments: assignments.filter((item) => item.letterId === letter.id) })),
    countArchived: async () => [...letters.values()].filter((letter) => letter.stage === 'archived').length,
    steps: async (_tenant, letterId) => stepsOf(letterId),
    assignments: async (_tenant, letterId) => assignments.filter((item) => item.letterId === letterId),
    attachments: async (_tenant, letterId) => attachments.filter((item) => item.letterId === letterId),
    findAttachment: async (_tenant, attachmentId) => attachments.find((item) => item.id === attachmentId),
    completeAttachment: async (_tenant, attachmentId, sizeBytes) => {
      const index = attachments.findIndex((item) => item.id === attachmentId);
      attachments[index] = { ...attachments[index], sizeBytes };
    },
    history: async (_tenant, letterId) => history.get(letterId) ?? [],
    userNames: async () => new Map([['u-leader', 'Nguyễn Văn An'], ['u-clerk', 'Lê Thu Hà']]),
    people: async () => [],
    leaders: async () => [
      { userId: 'u-leader', name: 'Nguyễn Văn An' },
      { userId: 'u-leader-2', name: 'Trần Minh Châu' },
    ],
  };
  return { store, letters, steps, workflows, outbox };
}

function fakeFiles() {
  const created: Parameters<FileStore['create']>[1][] = [];
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
  return { files, created, trashed, folderUpdates, state };
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

/** Vào sổ, phân loại, trình theo quy trình mặc định cho lãnh đạo `u-leader`. */
async function submitted(service: CorrespondenceService, extra: Partial<typeof intake> & { confidentiality?: string } = {}) {
  const letter = await service.create(clerk, { ...intake, ...extra });
  await service.classify(clerk, letter.id, { kind: 'finance', urgency: 'urgent', confidentiality: extra.confidentiality });
  return service.submit(clerk, letter.id, { assigneeUserId: 'u-leader' });
}

async function processing(service: CorrespondenceService) {
  const letter = await submitted(service);
  return service.direct(leader, letter.id, {
    unitIds: ['unit-finance', 'unit-legal'],
    instruction: 'Hai phòng phối hợp soạn văn bản giải trình.',
  });
}

describe('CorrespondenceService – tiếp nhận theo danh mục cấu hình', () => {
  it('cấp số đến, hạn theo loại văn bản, mã danh mục phải đang dùng', async () => {
    const { service } = setup();
    const first = await service.create(clerk, intake);
    expect(first).toMatchObject({ incomingNo: '1/CVĐ', stage: 'received', dueOn: '2026-11-17', kindName: 'Tài chính – thuế' });
    const other = await service.create(clerk, { ...intake, kind: undefined });
    expect(other).toMatchObject({ incomingNo: '2/CVĐ', kind: 'finance', dueOn: '2026-11-17' });
    await expect(service.create(clerk, { ...intake, kind: 'old' })).rejects.toThrow('đã ngừng dùng');
    await expect(service.create(clerk, { ...intake, urgency: 'khong-co' })).rejects.toBeInstanceOf(CorrespondenceValidationError);
    await expect(service.create(leader, intake)).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
  });

  it('bấm hai lần cùng một bước thì lần sau là xung đột', async () => {
    const { service } = setup();
    const letter = await service.create(clerk, intake);
    await service.classify(clerk, letter.id, { kind: 'finance', urgency: 'normal' });
    await expect(service.classify(clerk, letter.id, { kind: 'finance', urgency: 'normal' })).rejects.toBeInstanceOf(
      LetterStageConflictError,
    );
  });
});

describe('CorrespondenceService – quy trình mặc định', () => {
  it('trình phải chọn lãnh đạo trong nhóm có quyền chỉ đạo; báo đúng người', async () => {
    const { service, outbox } = setup();
    const letter = await service.create(clerk, intake);
    await service.classify(clerk, letter.id, { kind: 'finance', urgency: 'normal' });
    expect(await service.stepChoice(clerk, letter.id)).toMatchObject({
      stepName: 'Lãnh đạo chỉ đạo',
      candidates: [expect.objectContaining({ userId: 'u-leader' }), expect.objectContaining({ userId: 'u-leader-2' })],
    });
    await expect(service.submit(clerk, letter.id, {})).rejects.toThrow('Chọn người cho bước "Lãnh đạo chỉ đạo".');
    await expect(service.submit(clerk, letter.id, { assigneeUserId: 'u-accountant' })).rejects.toBeInstanceOf(
      CorrespondenceValidationError,
    );
    const done = await service.submit(clerk, letter.id, { assigneeUserId: 'u-leader' });
    expect(done).toMatchObject({ stage: 'directing', workflowName: 'Quy trình mặc định', currentStepName: 'Lãnh đạo chỉ đạo' });
    expect(done.flow.map((node) => node.label)).toEqual([
      'Tiếp nhận',
      'Phân loại',
      'Lãnh đạo chỉ đạo',
      'Phòng ban xử lý',
      'Trưởng phòng kiểm tra',
      'Lãnh đạo duyệt và ký',
      'Phát hành',
      'Lưu trữ',
    ]);
    expect(done.flow.find((node) => node.state === 'current')?.label).toBe('Lãnh đạo chỉ đạo');
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.stepAssigned, payload: { recipientUserIds: ['u-leader'] } });
  });

  it('đi hết: chỉ đạo → phòng ban → trưởng các phòng kiểm tra → người chỉ đạo ký → phát hành → lưu trữ', async () => {
    const { service, outbox, folderUpdates } = setup();
    const submittedLetter = await submitted(service);
    await expect(service.direct(otherLeader, submittedLetter.id, { unitIds: ['unit-finance'], instruction: 'x' })).rejects.toBeInstanceOf(
      LetterNotFoundError,
    );
    const letter = await processing(service);
    expect(outbox.at(-1)).toMatchObject({
      type: CORRESPONDENCE_EVENTS.assigned,
      payload: { assignments: [expect.objectContaining({ subjectId: 'unit-finance' }), expect.objectContaining({ subjectId: 'unit-legal' })] },
    });
    expect(letter.assignments.map((item) => item.headNames)).toEqual([['KTT'], ['TP Pháp chế']]);
    await service.createAttachment(clerk, letter.id, { kind: 'incoming', fileName: 'scan.pdf', contentType: 'application/pdf', sizeBytes: 10 });

    const [finance, legal] = letter.assignments;
    await expect(service.detail(outsider, letter.id)).rejects.toBeInstanceOf(LetterNotFoundError);
    await service.respond(accountant, letter.id, finance.id, { note: 'Số liệu' });
    const reviewing = await service.respond(lawyer, letter.id, legal.id, { note: 'Pháp lý' });
    expect(reviewing).toMatchObject({ stage: 'reviewing', currentStepName: 'Trưởng phòng kiểm tra' });
    expect(reviewing.steps[1].assignees.map((item) => item.userId).sort()).toEqual(['u-fin-head', 'u-legal-head']);
    expect((await service.list(financeHead, { box: 'mine' })).map((item) => item.id)).toEqual([letter.id]);

    await expect(service.approve(leader, letter.id, {})).rejects.toBeInstanceOf(LetterStageConflictError);
    const signing = await service.approve(financeHead, letter.id, { note: 'Đúng số liệu' });
    expect(signing).toMatchObject({ stage: 'reviewing', currentStepName: 'Lãnh đạo duyệt và ký' });
    expect(signing.steps[2].assignees.map((item) => item.userId)).toEqual(['u-leader']);

    const approved = await service.approve(leader, letter.id, { note: 'Ký' });
    expect(approved.stage).toBe('publishing');
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.approved });
    const published = await service.publish(clerk, letter.id, { recipient: 'Sở Tài chính' });
    expect(published).toMatchObject({ stage: 'closing', outgoingNo: '1/CV' });
    const archived = await service.archive(clerk, letter.id, {});
    expect(archived).toMatchObject({ stage: 'archived', archiveCode: 'HS-2026-0001' });
    expect(archived.flow.every((node) => node.state === 'done')).toBe(true);
    expect(folderUpdates).toEqual([{ folderId: 'folder-1', docNumber: 'HS-2026-0001' }]);
  });

  it('yêu cầu sửa ở bước duyệt: phòng đó về chờ, các bước duyệt chạy lại khi đủ phản hồi', async () => {
    const { service, outbox } = setup();
    const letter = await processing(service);
    const [finance, legal] = letter.assignments;
    await service.respond(accountant, letter.id, finance.id, { note: 'Bản 1' });
    await service.respond(lawyer, letter.id, legal.id, { note: 'Bản 1' });
    await service.approve(financeHead, letter.id, {});
    const revised = await service.requestRevision(leader, letter.id, { reason: 'Bổ sung quý IV', assignmentIds: [finance.id] });
    expect(revised.stage).toBe('processing');
    expect(revised.steps.slice(1).every((step) => step.status === 'waiting')).toBe(true);
    expect(outbox.at(-1)).toMatchObject({
      type: CORRESPONDENCE_EVENTS.revisionRequested,
      payload: { recipientUserIds: ['u-accountant'], unitIds: ['unit-finance'] },
    });
    const again = await service.respond(accountant, letter.id, finance.id, { note: 'Bản 2' });
    expect(again).toMatchObject({ stage: 'reviewing', currentStepName: 'Trưởng phòng kiểm tra' });
  });

  it('lưu để biết ở bước chỉ đạo bỏ các bước còn lại; trả lại văn thư thì bỏ các bước để trình lại', async () => {
    const { service } = setup();
    const first = await submitted(service);
    const closed = await service.closeForInfo(leader, first.id, { note: 'Để biết' });
    expect(closed.stage).toBe('closing');
    expect(closed.steps.map((step) => step.status)).toEqual(['done', 'skipped', 'skipped']);
    const second = await submitted(service);
    const returned = await service.returnToClerk(leader, second.id, { reason: 'Trình nhầm' });
    expect(returned.stage).toBe('registered');
    expect(returned.steps.map((step) => step.decision ?? step.status)).toEqual(['returned', 'skipped', 'skipped']);
    const again = await service.submit(clerk, second.id, { assigneeUserId: 'u-leader-2' });
    expect(again).toMatchObject({ stage: 'directing', steps: [expect.objectContaining({ status: 'active' }), expect.anything(), expect.anything()] });
  });
});

describe('CorrespondenceService – quy trình tự cấu hình', () => {
  const custom: WorkflowStep[] = [
    { key: 'office', name: 'Chánh văn phòng xem xét', kind: 'approve', approver: { type: 'positions', positionIds: ['pos-chief'] } },
    { key: 'direct', name: 'Giám đốc chỉ đạo', kind: 'direct', approver: { type: 'users', userIds: ['u-leader-2'] } },
    { key: 'legal', name: 'Pháp chế rà soát', kind: 'approve', approver: { type: 'unit_heads', unitIds: ['unit-legal'] } },
  ];

  it('người có quyền cấu hình tạo quy trình; gắn với loại văn bản; công văn chạy theo đúng các bước', async () => {
    const { service } = setup();
    await expect(service.saveWorkflow(clerk, undefined, { name: 'X', steps: custom })).rejects.toBeInstanceOf(
      CorrespondenceForbiddenError,
    );
    const workflow = await service.saveWorkflow(configurer, undefined, { name: 'Công văn tài chính', steps: custom });
    await service.saveCatalogItem(configurer, 'letter_type-finance', {
      kind: 'letter_type',
      code: 'finance',
      name: 'Tài chính – thuế',
      workflowId: workflow.id,
    });
    const letter = await service.create(clerk, intake);
    await service.classify(clerk, letter.id, { kind: 'finance', urgency: 'normal' });
    expect(await service.stepChoice(clerk, letter.id)).toBeNull();
    const atOffice = await service.submit(clerk, letter.id, {});
    expect(atOffice).toMatchObject({ stage: 'reviewing', currentStepName: 'Chánh văn phòng xem xét', workflowName: 'Công văn tài chính' });
    expect(atOffice.actions).toMatchObject({ approve: false });
    expect((await service.detail(chief, letter.id)).actions).toMatchObject({ approve: true, returnToClerk: true, requestRevision: false });

    const atDirector = await service.approve(chief, letter.id, { note: 'Trình giám đốc' });
    expect(atDirector).toMatchObject({ stage: 'directing', currentStepName: 'Giám đốc chỉ đạo' });
    await service.direct(otherLeader, letter.id, { unitIds: ['unit-finance'], instruction: 'Kế toán xử lý' });
    const [finance] = (await service.detail(otherLeader, letter.id)).assignments;
    const atLegal = await service.respond(accountant, letter.id, finance.id, { note: 'Xong' });
    expect(atLegal.steps[2].assignees.map((item) => item.userId)).toEqual(['u-legal-head']);
    expect((await service.approve(legalHead, letter.id, {})).stage).toBe('publishing');
  });

  it('kiểm cấu hình quy trình: đúng một bước chỉ đạo, luật theo kết quả chỉ đạo phải đặt sau', async () => {
    const { service } = setup();
    await expect(
      service.saveWorkflow(configurer, undefined, { name: 'Thiếu chỉ đạo', steps: [custom[0]] }),
    ).rejects.toThrow('đúng một bước chỉ đạo');
    await expect(
      service.saveWorkflow(configurer, undefined, {
        name: 'Sai thứ tự',
        steps: [{ key: 'a', name: 'Ký trước', kind: 'approve', approver: { type: 'director' } }, custom[1]],
      }),
    ).rejects.toThrow('phải đặt sau bước chỉ đạo');
    await expect(
      service.saveWorkflow(configurer, undefined, {
        name: 'Thiếu người',
        steps: [{ key: 'd', name: 'Chỉ đạo', kind: 'direct', approver: { type: 'positions', positionIds: [] } }],
      }),
    ).rejects.toThrow('chọn ít nhất một chức danh');
  });

  it('bước không tìm ra người duyệt theo sơ đồ tổ chức thì báo rõ, công văn không đổi', async () => {
    const { service, letters } = setup();
    const workflow = await service.saveWorkflow(configurer, undefined, {
      name: 'Chức danh trống',
      steps: [{ key: 'd', name: 'Phó giám đốc chỉ đạo', kind: 'direct', approver: { type: 'positions', positionIds: ['pos-empty'] } }],
    });
    const letter = await service.create(clerk, intake);
    await service.classify(clerk, letter.id, { kind: 'finance', urgency: 'normal' });
    await expect(service.submit(clerk, letter.id, { workflowId: workflow.id })).rejects.toThrow('chưa xác định được người duyệt');
    expect(letters.get(letter.id)?.stage).toBe('registered');
  });
});

describe('CorrespondenceService – quyền xem theo độ mật', () => {
  it('xem mọi công văn không thấy công văn mật; người liên quan và người có quyền xem mật thì thấy', async () => {
    const { service } = setup();
    const secret = await submitted(service, { confidentiality: 'confidential' });
    const normal = await submitted(service);
    expect((await service.list(reader)).map((item) => item.id)).toEqual([normal.id]);
    await expect(service.detail(reader, secret.id)).rejects.toBeInstanceOf(LetterNotFoundError);
    await expect(service.detail(actor('u-secret', { canReadConfidential: true }), secret.id)).resolves.toMatchObject({ restricted: true });
    await expect(service.detail(leader, secret.id)).resolves.toMatchObject({ id: secret.id });
  });
});

describe('CorrespondenceService – danh mục', () => {
  it('thêm mục mới, không trùng mã, không xoá mục đã dùng', async () => {
    const { service } = setup();
    await expect(
      service.saveCatalogItem(clerk, undefined, { kind: 'urgency', code: 'thuong-gap', name: 'Thượng khẩn' }),
    ).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    await expect(
      service.saveCatalogItem(configurer, undefined, { kind: 'urgency', code: 'Thượng khẩn', name: 'Thượng khẩn' }),
    ).rejects.toThrow('Mã chỉ gồm chữ thường');
    const item = await service.saveCatalogItem(configurer, undefined, { kind: 'urgency', code: 'top', name: 'Thượng khẩn', highlight: true });
    expect(item).toMatchObject({ code: 'top', highlight: true, restricted: false });
    await service.create(clerk, intake);
    await expect(service.deleteCatalogItem(configurer, 'letter_type-finance')).rejects.toThrow('ngừng dùng');
  });
});

describe('CorrespondenceService – tệp hồ sơ ở Hệ dùng chung', () => {
  it('lần đầu dựng thư mục hồ sơ theo năm, lần sau dùng lại; công văn mật thì tệp cũng mật', async () => {
    const { service, created } = setup();
    const letter = await service.create(clerk, { ...intake, confidentiality: 'confidential' });
    await service.createAttachment(clerk, letter.id, { kind: 'incoming', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 2 });
    expect(created[0]).toMatchObject({
      rootName: CORRESPONDENCE_FILING_ROOT,
      path: [{ name: '2026' }, { name: 'Công văn đến' }, expect.objectContaining({ name: `1/CVĐ - ${intake.subject}` })],
      confidentiality: 'confidential',
    });
    await service.createAttachment(clerk, letter.id, { kind: 'reference', fileName: 'b.pdf', contentType: 'application/pdf', sizeBytes: 2 });
    expect(created[1]).toMatchObject({ folderId: 'folder-1' });
  });

  it('thư mục hồ sơ bị xoá bên Hệ dùng chung thì dựng lại theo đường dẫn', async () => {
    const { service, created, state, letters } = setup();
    const letter = await service.create(clerk, intake);
    await service.createAttachment(clerk, letter.id, { kind: 'incoming', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1 });
    state.missingFolder = true;
    await service.createAttachment(clerk, letter.id, { kind: 'incoming', fileName: 'b.pdf', contentType: 'application/pdf', sizeBytes: 1 });
    expect(created[1].path).toBeDefined();
    expect(letters.get(letter.id)?.sharedFolderId).toBe('folder-2');
  });

  it('phòng ban chỉ nộp dự thảo cho phòng mình; gỡ được khi phòng chưa gửi', async () => {
    const { service, trashed } = setup();
    const letter = await processing(service);
    const [finance, legal] = letter.assignments;
    const draft = { kind: 'draft' as const, fileName: 'du-thao.docx', contentType: 'application/msword', sizeBytes: 100 };
    await expect(service.createAttachment(accountant, letter.id, { ...draft, assignmentId: legal.id })).rejects.toBeInstanceOf(
      CorrespondenceValidationError,
    );
    const ticket = await service.createAttachment(accountant, letter.id, { ...draft, assignmentId: finance.id });
    await service.completeAttachment(accountant, letter.id, ticket.attachment.id, 100);
    await expect(service.download(outsider, letter.id, ticket.attachment.id, 'download')).rejects.toBeInstanceOf(LetterNotFoundError);
    await service.deleteAttachment(accountant, letter.id, ticket.attachment.id);
    expect(trashed).toEqual(['doc-1']);
  });
});

describe('CorrespondenceService – tổng quan và cấu hình sổ', () => {
  it('đếm theo bước, quá hạn và việc của người xem', async () => {
    const { service } = setup();
    await processing(service);
    await service.create(clerk, { ...intake, receivedOn: '2026-11-01', dueOn: '2026-11-05' });
    expect(await service.overview(clerk)).toMatchObject({ open: 2, overdue: 1, awaitingMe: 1 });
    expect(await service.overview(accountant)).toMatchObject({ awaitingMe: 1 });
  });

  it('chỉ người có quyền cấu hình sửa cấu hình sổ', async () => {
    const { service } = setup();
    const settings = { incomingSuffix: 'CVĐ-ĐDX', outgoingSuffix: 'CV-ĐDX', archivePrefix: 'HS', defaultDueDays: 5 };
    await expect(service.saveSettings(clerk, settings)).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    await service.saveSettings(configurer, settings);
    expect((await service.create(clerk, { ...intake, kind: 'other' })).incomingNo).toBe('1/CVĐ-ĐDX');
  });
});
