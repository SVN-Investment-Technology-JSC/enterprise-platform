import {
  CORRESPONDENCE_EVENTS,
  DEFAULT_CORRESPONDENCE_SETTINGS,
  type CorrespondenceSettings,
} from '@enterprise-platform/contracts-correspondence';
import {
  CorrespondenceForbiddenError,
  CorrespondenceValidationError,
  LetterNotFoundError,
  LetterStageConflictError,
} from '../domain/correspondence.error.js';
import { formatSequenceNo } from '../domain/letter-rules.js';
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
  type OrganizationSnapshot,
  type OutboxEvent,
} from './ports.js';

const TENANT = 'tenant-1';
const TODAY = '2026-11-12';

function actor(overrides: Partial<CorrespondenceActor> = {}): CorrespondenceActor {
  return {
    tenantId: TENANT,
    userId: 'u-clerk',
    displayName: 'Lê Thu Hà',
    isTenantAdmin: false,
    canRegister: true,
    canDirect: false,
    canManage: false,
    ...overrides,
  };
}

const clerk = actor();
const leader = actor({ userId: 'u-leader', displayName: 'Nguyễn Văn An', canRegister: false, canDirect: true });
const otherLeader = actor({ userId: 'u-leader-2', displayName: 'Trần Minh Châu', canRegister: false, canDirect: true });
const accountant = actor({ userId: 'u-accountant', displayName: 'Kế toán', canRegister: false });
const lawyer = actor({ userId: 'u-lawyer', displayName: 'Pháp chế', canRegister: false });
const outsider = actor({ userId: 'u-outsider', displayName: 'Người ngoài', canRegister: false });

const organization: OrganizationSnapshot = {
  nodes: [
    { id: 'unit-company', name: 'Công ty', kind: 'unit' },
    { id: 'unit-finance', name: 'Phòng Kế toán – Tài chính', parentId: 'unit-company', kind: 'unit' },
    { id: 'unit-legal', name: 'Phòng Pháp chế', parentId: 'unit-company', kind: 'unit' },
    { id: 'pos-accountant', name: 'Kế toán viên', parentId: 'unit-finance', kind: 'position' },
    { id: 'pos-lawyer', name: 'Chuyên viên pháp chế', parentId: 'unit-legal', kind: 'position' },
  ],
  assignments: [
    { userId: 'u-accountant', nodeId: 'pos-accountant' },
    { userId: 'u-lawyer', nodeId: 'pos-lawyer' },
  ],
  degraded: false,
};

function fakeStore() {
  const letters = new Map<string, LetterRecord>();
  const assignments: AssignmentRecord[] = [];
  const attachments: AttachmentRecord[] = [];
  const history = new Map<string, HistoryRecord[]>();
  const outbox: OutboxEvent[] = [];
  const counters = new Map<string, number>();
  let settings: CorrespondenceSettings = DEFAULT_CORRESPONDENCE_SETTINGS;
  let sequence = 0;
  const id = (prefix: string) => `${prefix}-${++sequence}`;
  const next = (kind: string, year: number) => {
    const value = (counters.get(`${kind}:${year}`) ?? 0) + 1;
    counters.set(`${kind}:${year}`, value);
    return value;
  };

  const transaction = (letterId: string): LetterTransaction => {
    const tx: LetterTransaction = {
      get letter() {
        return letters.get(letterId)!;
      },
      get assignments() {
        return assignments.filter((item) => item.letterId === letterId);
      },
      update: async (patch) => {
        const updated = { ...letters.get(letterId)!, ...patch };
        letters.set(letterId, updated);
        return updated;
      },
      nextNumber: async (kind, year) => next(kind, year),
      assign: async (units) => {
        for (const unit of units) {
          const index = assignments.findIndex((item) => item.letterId === letterId && item.unitId === unit.unitId);
          if (index >= 0) {
            assignments[index] = { ...assignments[index], status: 'pending', round: assignments[index].round + 1 };
          } else {
            assignments.push({ id: id('assignment'), letterId, unitId: unit.unitId, unitName: unit.unitName, round: 1, status: 'pending' });
          }
        }
      },
      submitAssignment: async (assignmentId, input) => {
        const index = assignments.findIndex((item) => item.id === assignmentId);
        assignments[index] = {
          ...assignments[index],
          status: 'submitted',
          responseNote: input.note,
          submittedBy: input.userId,
          submittedAt: '2026-11-12T03:00:00.000Z',
        };
      },
      reopenAssignments: async (ids, reason) => {
        for (const assignmentId of ids) {
          const index = assignments.findIndex((item) => item.id === assignmentId);
          assignments[index] = {
            ...assignments[index],
            status: 'pending',
            round: assignments[index].round + 1,
            revisionReason: reason,
            submittedAt: undefined,
          };
        }
      },
      addAttachment: async (input) => {
        const created: AttachmentRecord = { ...input, id: id('attachment'), letterId, createdAt: '2026-11-12T03:00:00.000Z' };
        attachments.push(created);
        return created;
      },
      removeAttachment: async (attachmentId) => {
        attachments.splice(attachments.findIndex((item) => item.id === attachmentId), 1);
      },
      history: async (entry) => {
        history.set(letterId, [...(history.get(letterId) ?? []), { ...entry, id: id('history'), at: '2026-11-12T03:00:00.000Z' }]);
      },
      outbox: async (event) => {
        outbox.push(event);
      },
    };
    return tx;
  };

  const store: CorrespondenceStore = {
    tablesReady: async () => true,
    settings: async () => settings,
    saveSettings: async (_tenant, _user, value) => {
      settings = value;
    },
    createLetter: async (_tenant, input, suffix, after) => {
      const year = Number(input.receivedOn.slice(0, 4));
      const seq = next('incoming', year);
      const letter: LetterRecord = {
        ...input,
        id: id('letter'),
        year,
        seq,
        incomingNo: formatSequenceNo(seq, suffix),
        stage: 'received',
        createdAt: '2026-11-12T03:00:00.000Z',
        updatedAt: '2026-11-12T03:00:00.000Z',
      };
      letters.set(letter.id, letter);
      await after(transaction(letter.id));
      return letter;
    },
    withLetter: async (_tenant, letterId, work) => {
      if (!letters.has(letterId)) throw new LetterNotFoundError();
      // Ghi trên bản sao để lỗi giữa chừng không để lại thay đổi, như rollback.
      const snapshot = { letters: new Map(letters), assignments: [...assignments], attachments: [...attachments], outbox: outbox.length };
      try {
        return await work(transaction(letterId));
      } catch (error) {
        letters.clear();
        snapshot.letters.forEach((value, key) => letters.set(key, value));
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
        .map((letter) => ({ ...letter, assignments: assignments.filter((item) => item.letterId === letter.id) })),
    countArchived: async () => [...letters.values()].filter((letter) => letter.stage === 'archived').length,
    assignments: async (_tenant, letterId) => assignments.filter((item) => item.letterId === letterId),
    attachments: async (_tenant, letterId) => attachments.filter((item) => item.letterId === letterId),
    findAttachment: async (_tenant, attachmentId) => attachments.find((item) => item.id === attachmentId),
    completeAttachment: async (_tenant, attachmentId, sizeBytes) => {
      const index = attachments.findIndex((item) => item.id === attachmentId);
      attachments[index] = { ...attachments[index], sizeBytes };
    },
    history: async (_tenant, letterId) => history.get(letterId) ?? [],
    userNames: async () => new Map([['u-leader', 'Nguyễn Văn An'], ['u-clerk', 'Lê Thu Hà']]),
    leaders: async () => [
      { userId: 'u-leader', name: 'Nguyễn Văn An' },
      { userId: 'u-leader-2', name: 'Trần Minh Châu' },
    ],
  };
  return { store, letters, assignments, attachments, outbox };
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
};

/** Đi tới bước "Phòng ban xử lý" với hai phòng ban. */
async function toProcessing(service: CorrespondenceService) {
  const letter = await service.create(clerk, intake);
  await service.classify(clerk, letter.id, { kind: 'finance', urgency: 'urgent' });
  await service.submit(clerk, letter.id, { leaderUserId: 'u-leader' });
  return service.direct(leader, letter.id, {
    unitIds: ['unit-finance', 'unit-legal'],
    instruction: 'Hai phòng phối hợp soạn văn bản giải trình.',
  });
}

describe('CorrespondenceService – tiếp nhận', () => {
  it('văn thư vào sổ: cấp số đến theo năm, hạn mặc định theo cấu hình', async () => {
    const { service } = setup();
    const first = await service.create(clerk, intake);
    const second = await service.create(clerk, { ...intake, dueOn: '2026-11-20' });
    expect(first).toMatchObject({ incomingNo: '1/CVĐ', stage: 'received', receivedOn: TODAY, dueOn: '2026-11-19' });
    expect(second.incomingNo).toBe('2/CVĐ');
    expect(first.history[0]).toMatchObject({ action: 'receive', actorUserId: 'u-clerk' });
    expect(first.actions).toMatchObject({ classify: true, submit: false, cancel: true });
  });

  it('chỉ văn thư tiếp nhận được; thiếu trích yếu thì báo rõ', async () => {
    const { service } = setup();
    await expect(service.create(leader, intake)).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    await expect(service.create(clerk, { ...intake, subject: ' ' })).rejects.toThrow('Trích yếu không được để trống.');
    await expect(service.create(clerk, { ...intake, dueOn: '2026-11-01' })).rejects.toBeInstanceOf(
      CorrespondenceValidationError,
    );
  });

  it('bấm hai lần cùng một bước thì lần sau là xung đột, không chuyển bước hai lần', async () => {
    const { service } = setup();
    const letter = await service.create(clerk, intake);
    await service.classify(clerk, letter.id, { kind: 'finance', urgency: 'flash' });
    await expect(service.classify(clerk, letter.id, { kind: 'finance', urgency: 'flash' })).rejects.toBeInstanceOf(
      LetterStageConflictError,
    );
  });

  it('chỉ trình được cho người có quyền chỉ đạo, và báo lãnh đạo đó', async () => {
    const { service, outbox } = setup();
    const letter = await service.create(clerk, intake);
    await service.classify(clerk, letter.id, { kind: 'finance', urgency: 'normal' });
    await expect(service.submit(clerk, letter.id, { leaderUserId: 'u-accountant' })).rejects.toBeInstanceOf(
      CorrespondenceValidationError,
    );
    const submitted = await service.submit(clerk, letter.id, { leaderUserId: 'u-leader' });
    expect(submitted).toMatchObject({ stage: 'directing', leaderName: 'Nguyễn Văn An' });
    expect(outbox.at(-1)).toMatchObject({
      type: CORRESPONDENCE_EVENTS.submitted,
      payload: { recipientUserIds: ['u-leader'], actorUserId: 'u-clerk', deepLink: `/modules/correspondence#letters/${letter.id}` },
    });
  });

  it('huỷ chỉ khi chưa trình, kèm lý do', async () => {
    const { service } = setup();
    const letter = await service.create(clerk, intake);
    await expect(service.cancel(clerk, letter.id, { reason: '' })).rejects.toBeInstanceOf(CorrespondenceValidationError);
    const cancelled = await service.cancel(clerk, letter.id, { reason: 'Gửi nhầm địa chỉ' });
    expect(cancelled).toMatchObject({ stage: 'cancelled', cancelReason: 'Gửi nhầm địa chỉ' });
    expect(cancelled.actions.edit).toBe(false);
  });
});

describe('CorrespondenceService – lãnh đạo chỉ đạo', () => {
  it('chỉ lãnh đạo được trình mới chỉ đạo; giao phòng ban phát sự kiện theo đơn vị', async () => {
    const { service, outbox } = setup();
    const letter = await service.create(clerk, intake);
    await service.classify(clerk, letter.id, { kind: 'finance', urgency: 'urgent' });
    await service.submit(clerk, letter.id, { leaderUserId: 'u-leader' });
    const request = { unitIds: ['unit-finance'], instruction: 'Soạn giải trình.' };
    await expect(service.direct(otherLeader, letter.id, request)).rejects.toBeInstanceOf(LetterNotFoundError);
    await expect(service.direct(clerk, letter.id, request)).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    await expect(service.direct(leader, letter.id, { ...request, unitIds: ['pos-accountant'] })).rejects.toBeInstanceOf(
      CorrespondenceValidationError,
    );
    const directed = await service.direct(leader, letter.id, { ...request, dueOn: '2026-11-25' });
    expect(directed).toMatchObject({ stage: 'processing', instruction: 'Soạn giải trình.', dueOn: '2026-11-25' });
    expect(directed.assignments).toEqual([expect.objectContaining({ unitName: 'Phòng Kế toán – Tài chính', status: 'pending' })]);
    expect(outbox.at(-1)).toMatchObject({
      type: CORRESPONDENCE_EVENTS.assigned,
      payload: { assignments: [{ subjectType: 'organization_unit', subjectId: 'unit-finance', role: 'E' }] },
    });
  });

  it('trả lại văn thư thì về bước đã phân loại và báo người tiếp nhận', async () => {
    const { service, outbox } = setup();
    const letter = await service.create(clerk, intake);
    await service.classify(clerk, letter.id, { kind: 'other', urgency: 'normal' });
    await service.submit(clerk, letter.id, { leaderUserId: 'u-leader' });
    const returned = await service.returnToClerk(leader, letter.id, { reason: 'Trình nhầm, chuyển PTGĐ Kỹ thuật' });
    expect(returned.stage).toBe('registered');
    expect(outbox.at(-1)).toMatchObject({ type: CORRESPONDENCE_EVENTS.returned, payload: { recipientUserIds: ['u-clerk'] } });
  });

  it('lưu để biết: chuyển thẳng sang chờ lưu trữ', async () => {
    const { service, outbox } = setup();
    const letter = await service.create(clerk, intake);
    await service.classify(clerk, letter.id, { kind: 'other', urgency: 'normal' });
    await service.submit(clerk, letter.id, { leaderUserId: 'u-leader' });
    const closed = await service.closeForInfo(leader, letter.id, { note: 'Lưu, để biết.' });
    expect(closed.stage).toBe('closing');
    expect(outbox.at(-1)?.type).toBe(CORRESPONDENCE_EVENTS.archiveRequested);
  });
});

describe('CorrespondenceService – phòng ban xử lý và duyệt', () => {
  it('chỉ người thuộc phòng ban thấy và gửi được phản hồi; đủ phản hồi thì tự trình lại lãnh đạo', async () => {
    const { service, outbox } = setup();
    const letter = await toProcessing(service);
    const [finance, legal] = letter.assignments;
    await expect(service.detail(outsider, letter.id)).rejects.toBeInstanceOf(LetterNotFoundError);
    const seenByAccountant = await service.detail(accountant, letter.id);
    expect(seenByAccountant.awaitingMe).toBe(true);
    expect(seenByAccountant.assignments.map((item) => item.canRespond)).toEqual([true, false]);
    await expect(service.respond(accountant, letter.id, legal.id, { note: 'x' })).rejects.toBeInstanceOf(
      CorrespondenceForbiddenError,
    );

    const half = await service.respond(accountant, letter.id, finance.id, { note: 'Đã soạn số liệu giải trình.' });
    expect(half).toMatchObject({ stage: 'processing', assignmentsDone: 1, assignmentsTotal: 2 });
    const full = await service.respond(lawyer, letter.id, legal.id, { note: 'Đã rà soát pháp lý.' });
    expect(full.stage).toBe('reviewing');
    expect(full.history.at(-1)).toMatchObject({ action: 'review-requested', actorUserId: undefined });
    expect(outbox.at(-1)).toMatchObject({
      type: CORRESPONDENCE_EVENTS.reviewRequested,
      payload: { recipientUserIds: ['u-leader'] },
    });
    expect((await service.list(leader, { box: 'mine' })).map((item) => item.id)).toEqual([letter.id]);
  });

  it('yêu cầu sửa một phòng: phòng đó về chờ, báo người đã gửi; gửi lại thì trình lại', async () => {
    const { service, outbox } = setup();
    const letter = await toProcessing(service);
    const [finance, legal] = letter.assignments;
    await service.respond(accountant, letter.id, finance.id, { note: 'Bản 1' });
    await service.respond(lawyer, letter.id, legal.id, { note: 'Bản 1' });
    const revised = await service.requestRevision(leader, letter.id, {
      reason: 'Bổ sung số liệu quý IV.',
      assignmentIds: [finance.id],
    });
    expect(revised.stage).toBe('processing');
    expect(revised.assignments.find((item) => item.id === finance.id)).toMatchObject({
      status: 'pending',
      round: 2,
      revisionReason: 'Bổ sung số liệu quý IV.',
    });
    expect(outbox.at(-1)).toMatchObject({
      type: CORRESPONDENCE_EVENTS.revisionRequested,
      payload: { recipientUserIds: ['u-accountant'], unitIds: ['unit-finance'] },
    });
    const again = await service.respond(accountant, letter.id, finance.id, { note: 'Bản 2' });
    expect(again.stage).toBe('reviewing');
  });

  it('duyệt, cấp số đi, lưu trữ: số theo bộ đếm và ghi số hồ sơ lên thư mục bên Hệ dùng chung', async () => {
    const { service, outbox, folderUpdates } = setup();
    const letter = await toProcessing(service);
    await service.createAttachment(clerk, letter.id, { kind: 'incoming', fileName: 'scan.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
    for (const [assignment, who] of [[letter.assignments[0], accountant], [letter.assignments[1], lawyer]] as const) {
      await service.respond(who, letter.id, assignment.id, { note: 'Xong' });
    }
    await expect(service.publish(clerk, letter.id, { recipient: 'Sở Tài chính' })).rejects.toBeInstanceOf(
      LetterStageConflictError,
    );
    const approved = await service.approve(leader, letter.id, { note: 'Đồng ý, ký.' });
    expect(approved.stage).toBe('publishing');
    expect(outbox.at(-1)).toMatchObject({
      type: CORRESPONDENCE_EVENTS.approved,
      payload: { recipientUserIds: ['u-clerk', 'u-accountant', 'u-lawyer'] },
    });
    const published = await service.publish(clerk, letter.id, { recipient: 'Sở Tài chính TP. Đà Nẵng' });
    expect(published).toMatchObject({ stage: 'closing', outgoingNo: '1/CV', publishedOn: TODAY });
    const archived = await service.archive(clerk, letter.id, {});
    expect(archived).toMatchObject({ stage: 'archived', archiveCode: 'HS-2026-0001', archivedOn: TODAY });
    expect(folderUpdates).toEqual([{ folderId: 'folder-1', docNumber: 'HS-2026-0001' }]);
    expect((await service.list(clerk, { box: 'archive' })).map((item) => item.archiveCode)).toEqual(['HS-2026-0001']);
    expect((await service.list(clerk, { box: 'outgoing' })).map((item) => item.outgoingNo)).toEqual(['1/CV']);
  });
});

describe('CorrespondenceService – tệp hồ sơ ở Hệ dùng chung', () => {
  it('lần đầu dựng thư mục hồ sơ theo năm, lần sau dùng lại thư mục đó', async () => {
    const { service, created } = setup();
    const letter = await service.create(clerk, intake);
    const ticket = await service.createAttachment(clerk, letter.id, {
      kind: 'incoming',
      fileName: 'cong-van-den.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    });
    expect(ticket.uploadUrl).toBe('https://files.example/1');
    expect(created[0]).toMatchObject({
      rootName: CORRESPONDENCE_FILING_ROOT,
      path: [{ name: '2026' }, { name: 'Công văn đến' }, expect.objectContaining({ name: `1/CVĐ - ${intake.subject}` })],
      docKind: 'official_letter',
      docNumber: intake.senderRef,
      partner: intake.senderOrg,
      confidentiality: 'internal',
    });
    await service.createAttachment(clerk, letter.id, { kind: 'reference', fileName: 'phu-luc.pdf', contentType: 'application/pdf', sizeBytes: 10 });
    expect(created[1]).toMatchObject({ folderId: 'folder-1' });
    expect(created[1].path).toBeUndefined();
  });

  it('thư mục hồ sơ đã bị xoá bên Hệ dùng chung thì dựng lại theo đường dẫn', async () => {
    const { service, created, state, letters } = setup();
    const letter = await service.create(clerk, intake);
    await service.createAttachment(clerk, letter.id, { kind: 'incoming', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1 });
    state.missingFolder = true;
    await service.createAttachment(clerk, letter.id, { kind: 'incoming', fileName: 'b.pdf', contentType: 'application/pdf', sizeBytes: 1 });
    expect(created[1].path).toBeDefined();
    expect(letters.get(letter.id)?.sharedFolderId).toBe('folder-2');
  });

  it('phòng ban chỉ nộp dự thảo cho phòng mình khi đang xử lý; người ngoài không mở được tệp', async () => {
    const { service } = setup();
    const letter = await toProcessing(service);
    const [finance, legal] = letter.assignments;
    const draft = { kind: 'draft' as const, fileName: 'du-thao.docx', contentType: 'application/msword', sizeBytes: 100 };
    await expect(service.createAttachment(accountant, letter.id, { ...draft, assignmentId: legal.id })).rejects.toBeInstanceOf(
      CorrespondenceValidationError,
    );
    await expect(service.createAttachment(accountant, letter.id, { ...draft, kind: 'outgoing' })).rejects.toBeInstanceOf(
      CorrespondenceForbiddenError,
    );
    const ticket = await service.createAttachment(accountant, letter.id, { ...draft, assignmentId: finance.id });
    await service.completeAttachment(accountant, letter.id, ticket.attachment.id, 100);
    await expect(service.download(outsider, letter.id, ticket.attachment.id, 'download')).rejects.toBeInstanceOf(
      LetterNotFoundError,
    );
    await expect(service.download(leader, letter.id, ticket.attachment.id, 'download')).resolves.toMatchObject({
      downloadUrl: 'https://files.example/download/doc-1',
    });
  });

  it('gỡ dự thảo khi phòng ban chưa gửi; đã gửi thì không gỡ được', async () => {
    const { service, trashed } = setup();
    const letter = await toProcessing(service);
    const [finance] = letter.assignments;
    const draft = { kind: 'draft' as const, assignmentId: finance.id, fileName: 'a.docx', contentType: 'application/msword', sizeBytes: 1 };
    const first = await service.createAttachment(accountant, letter.id, draft);
    await service.deleteAttachment(accountant, letter.id, first.attachment.id);
    expect(trashed).toEqual(['doc-1']);
    const second = await service.createAttachment(accountant, letter.id, draft);
    await service.respond(accountant, letter.id, finance.id, { note: 'Gửi' });
    await expect(service.deleteAttachment(accountant, letter.id, second.attachment.id)).rejects.toBeInstanceOf(
      CorrespondenceForbiddenError,
    );
  });
});

describe('CorrespondenceService – tổng quan và cấu hình', () => {
  it('đếm theo bước, quá hạn và việc của người xem', async () => {
    const { service } = setup();
    await toProcessing(service);
    const overdue = await service.create(clerk, { ...intake, receivedOn: '2026-11-01', dueOn: '2026-11-05' });
    const forClerk = await service.overview(clerk);
    expect(forClerk).toMatchObject({ open: 2, overdue: 1, awaitingMe: 1, byStage: { processing: 1, received: 1 } });
    expect(forClerk.urgent[0].id).toBe(overdue.id);
    const forAccountant = await service.overview(accountant);
    expect(forAccountant).toMatchObject({ awaitingMe: 1 });
  });

  it('chỉ quản trị văn thư sửa cấu hình sổ', async () => {
    const { service } = setup();
    const settings = { incomingSuffix: 'CVĐ-ĐDX', outgoingSuffix: 'CV-ĐDX', archivePrefix: 'HS', defaultDueDays: 5 };
    await expect(service.saveSettings(clerk, settings)).rejects.toBeInstanceOf(CorrespondenceForbiddenError);
    await service.saveSettings(actor({ canManage: true }), settings);
    const letter = await service.create(clerk, intake);
    expect(letter).toMatchObject({ incomingNo: '1/CVĐ-ĐDX', dueOn: '2026-11-17' });
  });
});
