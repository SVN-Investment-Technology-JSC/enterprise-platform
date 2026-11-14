/**
 * @jest-environment jsdom
 */
import type {
  CatalogItem,
  CorrespondenceConfig,
  CorrespondenceDirectory,
  FlowNode,
  LetterActions,
  LetterDetail,
  LetterSummary,
} from '@enterprise-platform/contracts-correspondence';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { localToday } from '../correspondence.model';
import { decideRevoke, quickAddCatalogItem, removeLetter, requestRevoke, submitLetter, approveLetter, cancelLetter, commentLetter, loadStepChoice, returnLetter } from '../correspondence-api';
import { CommentsSection } from './comments-section';
import { FlowStepper } from './flow-stepper';
import { CheckGroup, FilePickField, FormDialog } from './form-dialog';
import { LetterActionPanel } from './letter-actions';
import { IntakeDialog } from './intake-dialog';
import { LetterTable } from './letter-table';
import { OutgoingDialog } from './outgoing-dialog';
import { OverviewView } from './overview-view';

jest.mock('../correspondence-api', () => ({
  ...jest.requireActual('../correspondence-api'),
  approveLetter: jest.fn(),
  returnLetter: jest.fn(),
  cancelLetter: jest.fn(),
  commentLetter: jest.fn(),
  loadStepChoice: jest.fn(),
  requestRevoke: jest.fn(),
  decideRevoke: jest.fn(),
  removeLetter: jest.fn(),
  quickAddCatalogItem: jest.fn(),
  submitLetter: jest.fn(),
}));

const mocked = {
  approve: approveLetter as jest.MockedFunction<typeof approveLetter>,
  ret: returnLetter as jest.MockedFunction<typeof returnLetter>,
  cancel: cancelLetter as jest.MockedFunction<typeof cancelLetter>,
  comment: commentLetter as jest.MockedFunction<typeof commentLetter>,
  choice: loadStepChoice as jest.MockedFunction<typeof loadStepChoice>,
  requestRevoke: requestRevoke as jest.MockedFunction<typeof requestRevoke>,
  decideRevoke: decideRevoke as jest.MockedFunction<typeof decideRevoke>,
  removeLetter: removeLetter as jest.MockedFunction<typeof removeLetter>,
  quickAdd: quickAddCatalogItem as jest.MockedFunction<typeof quickAddCatalogItem>,
  submit: submitLetter as jest.MockedFunction<typeof submitLetter>,
};

const NO_ACTIONS: LetterActions = {
  edit: false,
  dispatch: false,
  sendToClerk: false,
  submit: false,
  approve: false,
  complete: false,
  publish: false,
  updateDelivery: false,
  cancel: false,
  requestRevoke: false,
  decideRevoke: false,
  withdrawRevoke: false,
  remove: false,
  returnTargets: [],
  comment: true,
  reply: false,
  attachKinds: [],
};

function letter(overrides: Partial<LetterDetail> = {}, actions: Partial<LetterActions> = {}): LetterDetail {
  return {
    id: 'letter-1',
    direction: 'incoming',
    displayNo: '3/CVĐ',
    incomingNo: '3/CVĐ',
    receivedOn: '2026-11-13',
    senderOrg: 'Sở Kế hoạch và Đầu tư',
    subject: 'Đề nghị báo cáo tình hình thực hiện dự án',
    kind: 'directive',
    kindName: 'Chỉ đạo – điều hành',
    urgency: 'normal',
    urgencyName: 'Thường',
    urgencyHighlight: false,
    confidentiality: 'normal',
    confidentialityName: 'Thường',
    restricted: false,
    dueOn: '2026-11-20',
    stage: 'reviewing',
    stageLabel: 'Lãnh đạo duyệt và ký',
    currentStepName: 'Lãnh đạo duyệt và ký',
    currentAssigneeNames: ['Hà Nguyên Hoàng'],
    assignmentsDone: 1,
    assignmentsTotal: 1,
    receivedBy: 'u-clerk',
    receivedByName: 'Hồ Thọ',
    updatedAt: '2026-11-13T12:00:00.000Z',
    awaitingMe: true,
    steps: [],
    flow: [],
    assignments: [],
    attachments: [],
    comments: [],
    history: [],
    ...overrides,
    actions: { ...NO_ACTIONS, ...actions },
  };
}

const config: CorrespondenceConfig = {
  settings: { incomingSuffix: 'CVĐ', outgoingSuffix: 'CV', archivePrefix: 'HS', defaultDueDays: 7, dispatchMode: 'all', clerkUserIds: [] },
  catalog: [],
  workflows: [],
};

const directory: CorrespondenceDirectory = {
  units: [],
  positions: [],
  people: [
    { userId: 'u-an', name: 'Nguyễn Văn An' },
    { userId: 'u-ha', name: 'Lê Thu Hà' },
    { userId: 'u-me', name: 'Hồ Thọ' },
  ],
  leaders: [],
  myUnitIds: [],
  degraded: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked.choice.mockResolvedValue(null);
});

describe('Thanh tiến trình', () => {
  it('vẽ đúng các bước của quy trình, đánh dấu bước đang xử lý, ghi người và lúc xong', () => {
    const nodes: FlowNode[] = [
      { key: 'received', label: 'Văn thư tiếp nhận', kind: 'start', state: 'done', approval: false, people: 'Hồ Thọ', at: '2026-11-13' },
      { key: 'step-1', label: 'Phòng ban xử lý', kind: 'process', state: 'done', approval: false, people: 'Phòng Kinh doanh' },
      { key: 'step-2', label: 'Lãnh đạo duyệt và ký', kind: 'approve', state: 'current', approval: true, people: 'Hà Nguyên Hoàng' },
      { key: 'closing', label: 'Văn thư hoàn tất, lưu trữ', kind: 'end', state: 'todo', approval: false, people: 'Lê Thu Hà' },
    ];
    render(<FlowStepper nodes={nodes} workflowName="Quy trình mặc định" />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('span:nth-child(2)')?.textContent)).toEqual([
      'Văn thư tiếp nhận',
      'Phòng ban xử lý',
      'Lãnh đạo duyệt và ký',
      'Văn thư hoàn tất, lưu trữ',
    ]);
    expect(items[2].getAttribute('aria-current')).toBe('step');
    expect(within(items[2]).getByText('Đang xử lý')).toBeTruthy();
    expect(within(items[0]).getByText('13/11/2026')).toBeTruthy();
    expect(within(items[3]).getByText('Lê Thu Hà')).toBeTruthy();
    expect(screen.getByText(/Quy trình: Quy trình mặc định · 4 bước, 1 bước duyệt/)).toBeTruthy();
  });
});

describe('Bước duyệt: Đạt / Không đạt', () => {
  const reviewing = letter({}, { approve: true, comment: true, returnTargets: ['previous-step', 'handlers', 'clerk'], defaultReturnTarget: 'previous-step' });

  it('Duyệt một thao tác: bấm Duyệt, xác nhận tại chỗ rồi mới chuyển bước', async () => {
    const onDone = jest.fn();
    mocked.approve.mockResolvedValue(reviewing);
    render(<LetterActionPanel letter={reviewing} config={config} onDone={onDone} onDirtyChange={jest.fn()} />);
    // Không còn bước chọn Đạt / Không đạt.
    expect(screen.queryByRole('radio')).toBeNull();
    const send = await screen.findByRole('button', { name: 'Duyệt' });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Ý kiến (nếu có)'), { target: { value: 'Đồng ý trình TGĐ' } });
    fireEvent.click(send);
    // Bấm nhầm thì chưa có gì xảy ra: phải xác nhận.
    expect(await screen.findByText('Duyệt công văn này?')).toBeTruthy();
    expect(mocked.approve).not.toHaveBeenCalled();
    const confirm = screen.getAllByRole('button', { name: 'Duyệt' }).find((button) => button !== send) as HTMLElement;
    fireEvent.click(confirm);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocked.approve).toHaveBeenCalledWith('letter-1', { note: 'Đồng ý trình TGĐ', nextAssigneeUserId: undefined });
  });

  it('Xem lại thì đóng hỏi xác nhận, không duyệt', async () => {
    render(<LetterActionPanel letter={reviewing} config={config} onDone={jest.fn()} onDirtyChange={jest.fn()} />);
    const send = await screen.findByRole('button', { name: 'Duyệt' });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(send);
    fireEvent.click(await screen.findByRole('button', { name: 'Xem lại' }));
    await waitFor(() => expect(screen.queryByText('Duyệt công văn này?')).toBeNull());
    expect(mocked.approve).not.toHaveBeenCalled();
  });

  it('Không đạt mở hộp thoại, bắt nhập lý do, trả về bước trước theo mặc định của bước', async () => {
    const onDone = jest.fn();
    mocked.ret.mockResolvedValue(reviewing);
    render(<LetterActionPanel letter={reviewing} config={config} onDone={onDone} onDirtyChange={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Không đạt' }));
    const dialog = screen.getByRole('dialog', { name: 'Không đạt, trả lại' });
    const send = within(dialog).getByRole('button', { name: 'Xác nhận trả lại' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Lý do/), { target: { value: 'Thiếu số liệu quý 3' } });
    fireEvent.click(send);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocked.ret).toHaveBeenCalledWith('letter-1', { target: 'previous-step', reason: 'Thiếu số liệu quý 3', assignmentIds: undefined });
    expect(mocked.approve).not.toHaveBeenCalled();
  });
});

describe('Huỷ và trả lại dùng chung một kiểu hộp thoại', () => {
  it('Huỷ công văn mở hộp thoại, bắt nhập lý do rồi mới huỷ', async () => {
    const onDone = jest.fn();
    const drafting = letter(
      { direction: 'outgoing', stage: 'drafting', stageLabel: 'Đang soạn thảo', currentStepName: undefined, currentAssigneeNames: [] },
      { cancel: true },
    );
    mocked.cancel.mockResolvedValue({ ...drafting, stage: 'cancelled' });
    render(<LetterActionPanel letter={drafting} config={config} onDone={onDone} onDirtyChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ công văn' }));
    const dialog = screen.getByRole('dialog', { name: 'Huỷ công văn' });
    const confirm = within(dialog).getByRole('button', { name: 'Huỷ công văn' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Lý do huỷ/), { target: { value: 'Soạn trùng' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ stage: 'cancelled' }), 'Đã huỷ công văn.'));
    expect(mocked.cancel).toHaveBeenCalledWith('letter-1', 'Soạn trùng');
    expect(screen.queryByRole('dialog', { name: 'Huỷ công văn' })).toBeNull();
  });

  it('phòng ban trả lại văn thư: hộp thoại ghi rõ nơi trả về', async () => {
    const onDone = jest.fn();
    const processing = letter({ stage: 'processing', stageLabel: 'Phòng ban xử lý', currentStepName: undefined }, { returnTargets: ['clerk'] });
    mocked.ret.mockResolvedValue({ ...processing, stage: 'received' });
    render(<LetterActionPanel letter={processing} config={config} onDone={onDone} onDirtyChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Trả lại văn thư' }));
    const dialog = screen.getByRole('dialog', { name: 'Trả lại văn thư' });
    expect(within(dialog).getByText('Văn thư')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Lý do/), { target: { value: 'Không thuộc phòng' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận trả lại' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocked.ret).toHaveBeenCalledWith('letter-1', { target: 'clerk', reason: 'Không thuộc phòng', assignmentIds: undefined });
  });
});

describe('Trao đổi có nhắc tên', () => {
  it('mỗi ý kiến chỉ ghi tên người viết và thời gian, không kèm nhãn bước', () => {
    const current = letter({
      comments: [
        { id: 'c-1', stepLabel: 'Phòng ban xử lý', body: 'Xin phép chiều xử lý', mentions: [], authorId: 'u-1', authorName: 'Hoàng Ngọc Linh', at: '2026-11-13T12:45:00Z' },
      ],
    });
    render(<CommentsSection letter={current} directory={directory} currentUserId="u-me" onDone={jest.fn()} onDirtyChange={jest.fn()} />);
    const item = screen.getByText('Hoàng Ngọc Linh').closest('li') as HTMLElement;
    expect(within(item).getByText('Xin phép chiều xử lý')).toBeTruthy();
    expect(within(item).queryByText('Phòng ban xử lý')).toBeNull();
  });

  it('gõ @ gợi ý người, chọn thì chèn tên, gửi kèm người được nhắc', async () => {
    const current = letter();
    mocked.comment.mockResolvedValue(current);
    const onDone = jest.fn();
    render(<CommentsSection letter={current} directory={directory} currentUserId="u-me" onDone={onDone} onDirtyChange={jest.fn()} />);
    const box = screen.getByRole('textbox', { name: 'Nội dung trao đổi' });
    fireEvent.change(box, { target: { value: 'Nhờ @nguy' } });
    const option = await screen.findByRole('button', { name: /Nguyễn Văn An/ });
    expect(screen.queryByRole('button', { name: /Hồ Thọ/ })).toBeNull();
    fireEvent.mouseDown(option);
    expect((box as HTMLTextAreaElement).value).toBe('Nhờ @Nguyễn Văn An ');
    fireEvent.change(box, { target: { value: 'Nhờ @Nguyễn Văn An xem giúp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocked.comment).toHaveBeenCalledWith('letter-1', { body: 'Nhờ @Nguyễn Văn An xem giúp', mentionedUserIds: ['u-an'] });
  });
});

describe('Hộp thoại và chọn tệp', () => {
  it('chân hộp thoại (Huỷ, Lưu) nằm ngoài vùng cuộn nên luôn hiện', () => {
    render(
      <FormDialog open title="Soạn công văn đi" submitLabel="Tạo dự thảo" dirty={false} onClose={jest.fn()} onSubmit={jest.fn()}>
        <p>Nội dung dài</p>
      </FormDialog>,
    );
    const footer = screen.getByRole('button', { name: 'Tạo dự thảo' }).closest('footer') as HTMLElement;
    const body = screen.getByText('Nội dung dài').parentElement as HTMLElement;
    expect(footer).toBeTruthy();
    expect(body.contains(footer)).toBe(false);
    expect(footer.parentElement).toBe(body.parentElement);
  });

  it('chọn nhiều tệp, hiện tên và dung lượng, bỏ được từng tệp', () => {
    const onChange = jest.fn();
    const files = [new File(['abc'], 'du-thao.docx'), new File(['a'], 'phu-luc.pdf')];
    const view = render(<FilePickField label="Tệp dự thảo" files={[]} onChange={onChange} />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files } });
    expect(onChange).toHaveBeenCalledWith(files);
    view.rerender(<FilePickField label="Tệp dự thảo" files={files} onChange={onChange} />);
    expect(screen.getByText('du-thao.docx')).toBeTruthy();
    expect(screen.getByText('Đã chọn 2 tệp')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ du-thao.docx' }));
    expect(onChange).toHaveBeenLastCalledWith([files[1]]);
  });
});

describe('Bảng công văn đến và đi cùng bố cục', () => {
  it('cùng các cột, khác nhãn số và hạn theo luồng', () => {
    const base = letter();
    const summary = (overrides: Partial<LetterSummary>): LetterSummary => ({ ...base, ...overrides });
    const incoming = render(
      <LetterTable letters={[summary({})]} mode="incoming" today="2026-11-13" emptyText="" onOpen={jest.fn()} />,
    );
    const incomingHeads = Array.from(incoming.container.querySelectorAll('th')).map((th) => th.textContent);
    incoming.unmount();
    const outgoing = render(
      <LetterTable
        letters={[summary({ direction: 'outgoing', displayNo: '1/DT', recipient: 'EVN', authorUnitName: 'Khối Văn phòng' })]}
        mode="outgoing"
        today="2026-11-13"
        emptyText=""
        onOpen={jest.fn()}
      />,
    );
    const outgoingHeads = Array.from(outgoing.container.querySelectorAll('th')).map((th) => th.textContent);
    expect(incomingHeads).toEqual(['Số đến', 'Trích yếu', 'Độ khẩn', 'Bước xử lý', 'Hạn xử lý']);
    expect(outgoingHeads).toEqual(['Số', 'Trích yếu', 'Độ khẩn', 'Bước xử lý', 'Hạn ban hành']);
    expect(screen.getByText('Khối Văn phòng → EVN')).toBeTruthy();
  });
});

describe('Tổng quan theo bước', () => {
  it('đủ bước của cả hai luồng, đếm tổng và mở đúng bước', () => {
    const onOpenStage = jest.fn();
    render(
      <OverviewView
        overview={{
          incomingOpen: 3,
          outgoingOpen: 0,
          awaitingApproval: 1,
          overdue: 0,
          archived: 0,
          awaitingMe: 0,
          byStage: { incoming: { received: 2, reviewing: 1 }, outgoing: {} },
          urgent: [],
        }}
        today="2026-11-14"
        onNavigate={jest.fn()}
        onOpenStage={onOpenStage}
        onOpenLetter={jest.fn()}
      />,
    );
    expect(screen.getByText('3 công văn đang mở')).toBeTruthy();
    expect(screen.getByText('Không có công văn đang mở')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Văn thư tiếp nhận: 2 công văn' }));
    expect(onOpenStage).toHaveBeenCalledWith('incoming', 'received');
    fireEvent.click(screen.getByRole('button', { name: 'Văn thư kiểm tra: 0 công văn' }));
    expect(onOpenStage).toHaveBeenLastCalledWith('outgoing', 'checking');
  });
});

describe('Nhóm ô đánh dấu', () => {
  it('ô đánh dấu nằm trong nhóm có nhãn, không mang kiểu ô nhập', () => {
    render(
      <CheckGroup label="Trạng thái">
        <label>
          <input type="checkbox" defaultChecked /> Đang dùng
        </label>
      </CheckGroup>,
    );
    const group = screen.getByRole('group', { name: 'Trạng thái' });
    expect(within(group).getByRole('checkbox', { name: 'Đang dùng' })).toBeTruthy();
  });
});

describe('Ô chọn ngày điền sẵn hôm nay', () => {
  const dates = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]')).map((input) => input.value);

  it('tiếp nhận công văn đến: ngày văn bản, ngày đến, hạn xử lý', () => {
    render(<IntakeDialog open config={config} onClose={jest.fn()} onCreated={jest.fn()} />);
    const dialog = screen.getByRole('dialog');
    const values = dates(dialog);
    expect(values).toHaveLength(3);
    expect(values.slice(0, 2)).toEqual([localToday(), localToday()]);
    // Hạn tính từ số ngày cấu hình; không có thì cũng là hôm nay. Không bao giờ để trống.
    expect(values[2] >= localToday()).toBe(true);
  });

  it('soạn công văn đi: hạn ban hành', () => {
    render(<OutgoingDialog open config={config} onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(dates(screen.getByRole('dialog'))).toEqual([localToday()]);
  });
});

describe('Huỷ công văn đã ban hành, xoá công văn đã huỷ', () => {
  const issued = letter(
    {
      direction: 'outgoing',
      displayNo: '7/CV',
      stage: 'archived',
      stageLabel: 'Đã lưu trữ',
      archiveCode: 'HS-2026-0007',
      currentStepName: undefined,
      steps: [
        {
          id: 'step-1',
          seq: 1,
          name: 'Lãnh đạo duyệt ban hành',
          type: 'approve',
          approver: { type: 'users', userIds: ['u-leader'] },
          status: 'done',
          assignees: [{ userId: 'u-leader', name: 'Nguyễn Văn An' }],
          actedBy: 'u-leader',
          actedByName: 'Nguyễn Văn An',
        },
      ],
    },
    { requestRevoke: true },
  );

  it('quy trình không có bước duyệt: hộp thoại nói rõ là huỷ ngay', () => {
    render(<LetterActionPanel letter={{ ...issued, steps: [] }} config={config} onDone={jest.fn()} onDirtyChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đề nghị huỷ công văn' }));
    const dialog = screen.getByRole('dialog', { name: 'Đề nghị huỷ công văn' });
    expect(within(dialog).getByRole('button', { name: 'Huỷ công văn' })).toBeTruthy();
    expect(within(dialog).getByText(/huỷ ngay khi gửi/)).toBeTruthy();
  });

  it('văn thư đề nghị huỷ: chọn hình thức, bắt nhập lý do', async () => {
    const onDone = jest.fn();
    mocked.requestRevoke.mockResolvedValue({ ...issued, stage: 'revoking' });
    render(<LetterActionPanel letter={issued} config={config} onDone={onDone} onDirtyChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đề nghị huỷ công văn' }));
    const dialog = screen.getByRole('dialog', { name: 'Đề nghị huỷ công văn' });
    expect(within(dialog).getByRole('radio', { name: /Thu hồi/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Sửa đổi, thay thế/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gửi đề nghị' }));
    expect(await within(dialog).findByText('Nhập lý do.')).toBeTruthy();
    expect(mocked.requestRevoke).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Lý do/), { target: { value: 'Ban hành văn bản thay thế.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gửi đề nghị' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocked.requestRevoke).toHaveBeenCalledWith('letter-1', { kind: 'amend', reason: 'Ban hành văn bản thay thế.' });
  });

  it('người có thẩm quyền đồng ý huỷ phải xác nhận lần nữa', async () => {
    const onDone = jest.fn();
    const pending = letter(
      {
        ...issued,
        stage: 'revoking',
        stageLabel: 'Chờ duyệt huỷ',
        revoke: { kind: 'recall', kindLabel: 'Thu hồi', reason: 'Sai số liệu mục 2.', requestedByName: 'Văn thư', approverNames: ['Nguyễn Văn An'] },
      },
      { decideRevoke: true },
    );
    mocked.decideRevoke.mockResolvedValue({ ...pending, stage: 'cancelled' });
    render(<LetterActionPanel letter={pending} config={config} onDone={onDone} onDirtyChange={jest.fn()} />);
    expect(screen.getByText('Sai số liệu mục 2.')).toBeTruthy();
    expect(screen.getByText('Thu hồi')).toBeTruthy();
    const agree = screen.getByRole('button', { name: 'Đồng ý huỷ' });
    fireEvent.click(agree);
    expect(await screen.findByText('Đồng ý huỷ công văn này?')).toBeTruthy();
    expect(mocked.decideRevoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Đồng ý huỷ' }).find((button) => button !== agree) as HTMLElement);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocked.decideRevoke).toHaveBeenCalledWith('letter-1', { approve: true, note: undefined });
  });

  it('xoá công văn đã huỷ: hỏi xác nhận rồi đóng ngăn chi tiết', async () => {
    const onRemoved = jest.fn();
    const cancelled = letter({ ...issued, stage: 'cancelled', stageLabel: 'Đã huỷ', cancelReason: 'Thu hồi: sai số liệu' }, { remove: true });
    mocked.removeLetter.mockResolvedValue(undefined);
    render(<LetterActionPanel letter={cancelled} config={config} onDone={jest.fn()} onDirtyChange={jest.fn()} onRemoved={onRemoved} />);
    const remove = screen.getByRole('button', { name: 'Xoá công văn' });
    fireEvent.click(remove);
    expect(await screen.findByText('Xoá công văn khỏi Văn thư?')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Xoá công văn' }).find((button) => button !== remove) as HTMLElement);
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith('Đã xoá công văn 7/CV.'));
    expect(mocked.removeLetter).toHaveBeenCalledWith('letter-1');
  });
});

describe('Thêm nhanh danh mục, phòng ban soạn thảo', () => {
  const catalogItem = (kind: CatalogItem['kind'], code: string, name: string, sortOrder: number): CatalogItem => ({
    id: `${kind}-${code}`,
    kind,
    code,
    name,
    sortOrder,
    isActive: true,
    defaultUnitIds: [],
    highlight: false,
    restricted: false,
    inUse: false,
  });
  const withCatalog: CorrespondenceConfig = {
    ...config,
    catalog: [catalogItem('letter_type', 'finance', 'Tài chính', 10), catalogItem('urgency', 'normal', 'Thường', 10), catalogItem('confidentiality', 'normal', 'Thường', 10)],
  };
  const org: CorrespondenceDirectory = {
    ...directory,
    units: [
      { id: 'unit-legal', name: 'Phòng Pháp chế', path: 'Công ty', members: [] },
      { id: 'unit-finance', name: 'Phòng Kế toán', path: 'Công ty', members: [] },
    ],
    myUnitIds: ['unit-finance'],
  } as unknown as CorrespondenceDirectory;

  it('nút + thêm loại văn bản ngay trên form, chọn luôn mục mới, không mất phần đang nhập', async () => {
    const onCatalogAdded = jest.fn();
    const added = catalogItem('letter_type', 'to-trinh', 'Tờ trình', 20);
    mocked.quickAdd.mockResolvedValue(added);
    const { rerender } = render(
      <OutgoingDialog open config={withCatalog} directory={org} canQuickAdd onCatalogAdded={onCatalogAdded} onClose={jest.fn()} onCreated={jest.fn()} />,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Trích yếu/), { target: { value: 'Báo cáo quý IV' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm loại văn bản' }));
    const name = within(dialog).getByRole('textbox', { name: 'Tên loại văn bản mới' });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(await within(dialog).findByText('Nhập tên loại văn bản.')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'Tờ trình' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() => expect(onCatalogAdded).toHaveBeenCalledWith(added));
    expect(mocked.quickAdd).toHaveBeenCalledWith('letter_type', 'Tờ trình');
    // Màn hình cập nhật cấu hình: form giữ nguyên, ô loại văn bản chọn mục mới.
    rerender(
      <OutgoingDialog
        open
        config={{ ...withCatalog, catalog: [...withCatalog.catalog, added] }}
        directory={org}
        canQuickAdd
        onCatalogAdded={onCatalogAdded}
        onClose={jest.fn()}
        onCreated={jest.fn()}
      />,
    );
    expect((within(dialog).getByLabelText(/Trích yếu/) as HTMLTextAreaElement).value).toBe('Báo cáo quý IV');
    expect(within(dialog).getByDisplayValue('Tờ trình')).toBeTruthy();
    expect(within(dialog).queryByRole('textbox', { name: 'Tên loại văn bản mới' })).toBeNull();
  });

  it('người không được thêm danh mục thì không có nút +', () => {
    render(<OutgoingDialog open config={withCatalog} directory={org} onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /^Thêm (loại văn bản|độ khẩn|độ mật)$/ })).toBeNull();
  });

  it('phòng ban soạn thảo mặc định là phòng của người soạn, chọn lại được phòng khác', () => {
    render(<OutgoingDialog open config={withCatalog} directory={org} onClose={jest.fn()} onCreated={jest.fn()} />);
    const unitGroup = screen.getByRole('group', { name: 'Phòng ban soạn thảo' });
    const unit = within(unitGroup).getByDisplayValue('Phòng Kế toán');
    fireEvent.click(unit);
    const options = within(unitGroup).getAllByRole('option').map((option) => option.textContent ?? '');
    expect(options[0]).toContain('Phòng Kế toán');
    expect(options[0]).toContain('Phòng của bạn');
    expect(options.some((text) => text.includes('Phòng Pháp chế'))).toBe(true);
  });
});

describe('Quy trình động trên khối thao tác', () => {
  const org = {
    ...directory,
    units: [
      {
        id: 'unit-sales',
        name: 'Phòng Kinh doanh',
        path: 'Công ty',
        members: [{ userId: 'u-an', name: 'Nguyễn Văn An', positionName: 'Trưởng phòng', isHead: true }],
      },
    ],
  } as unknown as CorrespondenceDirectory;
  const directing = letter(
    {
      stage: 'reviewing',
      currentStepName: 'Lãnh đạo chỉ đạo',
      flow: [
        { key: 'received', label: 'Văn thư tiếp nhận', kind: 'start', state: 'done', approval: false },
        { key: 'step-1', label: 'Lãnh đạo chỉ đạo', kind: 'approve', state: 'current', approval: true },
        { key: 'step-2', label: 'Phòng ban xử lý', kind: 'process', state: 'todo', approval: false },
        { key: 'closing', label: 'Văn thư hoàn tất, lưu trữ', kind: 'end', state: 'todo', approval: false },
      ],
    },
    { approve: true, returnTargets: ['clerk'] },
  );

  it('bước sau là phòng ban xử lý: người duyệt chọn phòng ban rồi mới duyệt được', async () => {
    const onDone = jest.fn();
    mocked.approve.mockResolvedValue(directing);
    render(<LetterActionPanel letter={directing} config={config} directory={org} onDone={onDone} onDirtyChange={jest.fn()} />);
    const send = await screen.findByRole('button', { name: 'Duyệt' });
    await waitFor(() => expect(mocked.choice).toHaveBeenCalled());
    expect((send as HTMLButtonElement).disabled).toBe(true);
    const group = screen.getByRole('group', { name: 'Phòng ban cho bước "Phòng ban xử lý"' });
    fireEvent.click(within(group).getByRole('textbox'));
    fireEvent.click(within(group).getByRole('option', { name: /Phòng Kinh doanh/ }));
    expect(await screen.findByRole('button', { name: 'Bỏ Phòng Kinh doanh' })).toBeTruthy();
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText(/Ý kiến, chỉ đạo cho phòng ban/), { target: { value: 'Kinh doanh xử lý.' } });
    fireEvent.click(send);
    expect(await screen.findByText('Công văn chuyển sang bước "Phòng ban xử lý".')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Duyệt' }).find((button) => button !== send) as HTMLElement);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocked.approve).toHaveBeenCalledWith('letter-1', {
      note: 'Kinh doanh xử lý.',
      nextAssigneeUserId: undefined,
      units: [{ unitId: 'unit-sales', handlerUserId: undefined }],
    });
  });

  it('bước văn thư kiểm tra ở giữa quy trình đến: đạt thì chuyển bước kế tiếp', async () => {
    const onDone = jest.fn();
    const checking = letter(
      {
        stage: 'checking',
        currentStepName: 'Văn thư rà soát',
        flow: [
          { key: 'received', label: 'Văn thư tiếp nhận', kind: 'start', state: 'done', approval: false },
          { key: 'step-1', label: 'Văn thư rà soát', kind: 'check', state: 'current', approval: false },
          { key: 'step-2', label: 'Lãnh đạo ký', kind: 'approve', state: 'todo', approval: true },
          { key: 'closing', label: 'Văn thư hoàn tất, lưu trữ', kind: 'end', state: 'todo', approval: false },
        ],
      },
      { submit: true, returnTargets: ['clerk'] },
    );
    mocked.submit.mockResolvedValue(checking);
    render(<LetterActionPanel letter={checking} config={config} onDone={onDone} onDirtyChange={jest.fn()} />);
    expect(screen.getByRole('heading', { name: 'Văn thư rà soát' })).toBeTruthy();
    const send = await screen.findByRole('button', { name: 'Đạt, chuyển "Lãnh đạo ký"' });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocked.submit).toHaveBeenCalledWith('letter-1', { assigneeUserId: undefined, units: undefined, note: undefined });
  });
});
