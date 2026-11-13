import type { LetterSummary } from '@enterprise-platform/contracts-correspondence';
import {
  applyMention,
  catalogOptions,
  dueText,
  findMentionQuery,
  formatDay,
  keptMentions,
  matchesSearch,
  plannedWorkflow,
  previewKind,
  splitMentions,
  stageTone,
} from './correspondence.model';

const letter = (overrides: Partial<LetterSummary> = {}): LetterSummary => ({
  id: 'l1',
  direction: 'incoming',
  displayNo: '41/CVĐ',
  incomingNo: '41/CVĐ',
  receivedOn: '2026-11-10',
  senderOrg: 'Sở Tài chính TP. Đà Nẵng',
  subject: 'Yêu cầu giải trình số liệu quyết toán thuế',
  kind: 'finance',
  kindName: 'Tài chính – thuế',
  urgency: 'urgent',
  urgencyName: 'Khẩn',
  urgencyHighlight: true,
  confidentiality: 'normal',
  confidentialityName: 'Thường',
  restricted: false,
  currentAssigneeNames: [],
  dueOn: '2026-11-14',
  stage: 'processing',
  stageLabel: 'Phòng ban xử lý',
  assignmentsDone: 1,
  assignmentsTotal: 2,
  receivedBy: 'u1',
  updatedAt: '2026-11-10T00:00:00.000Z',
  awaitingMe: false,
  ...overrides,
});

describe('correspondence.model', () => {
  it('ghi hạn còn lại cho công văn còn mở, không ghi cho hồ sơ đã đóng', () => {
    expect(dueText(letter(), '2026-11-10')).toEqual({ text: 'Còn 4 ngày', tone: 'muted' });
    expect(dueText(letter(), '2026-11-13')).toEqual({ text: 'Còn 1 ngày', tone: 'warning' });
    expect(dueText(letter(), '2026-11-14')).toEqual({ text: 'Đến hạn hôm nay', tone: 'warning' });
    expect(dueText(letter(), '2026-11-16')).toEqual({ text: 'Quá hạn 2 ngày', tone: 'danger' });
    expect(dueText(letter({ stage: 'archived' }), '2026-11-16')).toBeUndefined();
  });

  it('tìm không dấu theo số, trích yếu và cơ quan gửi', () => {
    expect(matchesSearch(letter(), 'giai trinh')).toBe(true);
    expect(matchesSearch(letter(), 'so tai chinh')).toBe(true);
    expect(matchesSearch(letter(), '41/cvd')).toBe(true);
    expect(matchesSearch(letter(), 'hợp đồng')).toBe(false);
  });

  it('định dạng ngày, màu bước', () => {
    expect(formatDay('2026-11-05')).toBe('05/11/2026');
    expect(stageTone('reviewing')).toBe('warning');
    expect(stageTone('checking')).toBe('neutral');
    expect(stageTone('archived')).toBe('success');
  });

  it('xem trước được mọi định dạng văn phòng thường dùng, chỉ định dạng nhị phân cũ phải tải về', () => {
    expect(previewKind('application/pdf', 'a.pdf')).toBe('pdf');
    expect(previewKind('image/png', 'a.png')).toBe('image');
    expect(previewKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe('docx');
    expect(previewKind('application/octet-stream', 'bang-luong.xlsx')).toBe('sheet');
    expect(previewKind('application/vnd.ms-excel', 'cu.xls')).toBe('sheet');
    expect(previewKind('text/csv', 'a.csv')).toBe('sheet');
    expect(previewKind('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'a.pptx')).toBe('pptx');
    expect(previewKind('text/plain', 'ghi-chu.txt')).toBe('text');
    expect(previewKind('video/mp4', 'hop.mp4')).toBe('video');
    expect(previewKind('application/msword', 'cu.doc')).toBe('none');
  });

  it('nhắc tên như ô chat: dò "@", chèn tên, chỉ giữ người còn trong nội dung', () => {
    expect(findMentionQuery('Nhờ @ngu', 8)).toEqual({ start: 4, query: 'ngu' });
    expect(findMentionQuery('email@abc', 9)).toBeNull();
    const applied = applyMention('Nhờ @ngu xem', { start: 4, query: 'ngu' }, 8, 'Nguyễn Văn An');
    expect(applied).toEqual({ text: 'Nhờ @Nguyễn Văn An  xem', caret: 19 });
    const picked = new Map([['u1', 'Nguyễn Văn An'], ['u2', 'Lê Hà']]);
    expect(keptMentions('Nhờ @Nguyễn Văn An xem', picked)).toEqual(['u1']);
    expect(splitMentions('Nhờ @Nguyễn Văn An xem', [{ userId: 'u1', name: 'Nguyễn Văn An' }])).toEqual([
      { text: 'Nhờ ', mention: false },
      { text: '@Nguyễn Văn An', mention: true },
      { text: ' xem', mention: false },
    ]);
  });

  it('quy trình sẽ áp dụng: theo loại văn bản của luồng, không có thì mặc định của luồng', () => {
    const workflow = (id: string, direction: 'incoming' | 'outgoing', isDefault = false) => ({
      id,
      name: id,
      direction,
      isActive: true,
      isDefault,
      steps: [],
      updatedAt: '',
    });
    const config = {
      settings: { incomingSuffix: 'CVĐ', outgoingSuffix: 'CV', archivePrefix: 'HS', defaultDueDays: 7, dispatchMode: 'all' as const, clerkUserIds: [] },
      catalog: [{ id: 't', kind: 'letter_type' as const, code: 'hd', name: 'Hợp đồng', sortOrder: 0, isActive: true, outgoingWorkflowId: 'out-hd' }],
      workflows: [workflow('in', 'incoming', true), workflow('out', 'outgoing', true), workflow('out-hd', 'outgoing')],
    };
    expect(plannedWorkflow(config, 'incoming', 'hd')?.id).toBe('in');
    expect(plannedWorkflow(config, 'outgoing', 'hd')?.id).toBe('out-hd');
    expect(plannedWorkflow(config, 'outgoing', 'khac')?.id).toBe('out');
  });

  it('lựa chọn danh mục chỉ gồm mục đang dùng, giữ giá trị cũ đã ngừng dùng', () => {
    const catalog = [
      { id: '1', kind: 'urgency' as const, code: 'b', name: 'Khẩn', sortOrder: 2, isActive: true },
      { id: '2', kind: 'urgency' as const, code: 'a', name: 'Thường', sortOrder: 1, isActive: true },
      { id: '3', kind: 'urgency' as const, code: 'old', name: 'Cũ', sortOrder: 3, isActive: false },
    ];
    expect(catalogOptions(catalog, 'urgency').map((option) => option.value)).toEqual(['a', 'b']);
    expect(catalogOptions(catalog, 'urgency', 'old').at(-1)).toEqual({ value: 'old', label: 'Cũ (ngừng dùng)' });
  });
});
