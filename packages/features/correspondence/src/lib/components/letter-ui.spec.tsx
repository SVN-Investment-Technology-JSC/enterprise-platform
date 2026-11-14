/**
 * @jest-environment jsdom
 */
import type {
  CorrespondenceConfig,
  CorrespondenceDirectory,
  FlowNode,
  LetterActions,
  LetterDetail,
  LetterSummary,
} from '@enterprise-platform/contracts-correspondence';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { localToday } from '../correspondence.model';
import { approveLetter, cancelLetter, commentLetter, loadStepChoice, returnLetter } from '../correspondence-api';
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
}));

const mocked = {
  approve: approveLetter as jest.MockedFunction<typeof approveLetter>,
  ret: returnLetter as jest.MockedFunction<typeof returnLetter>,
  cancel: cancelLetter as jest.MockedFunction<typeof cancelLetter>,
  comment: commentLetter as jest.MockedFunction<typeof commentLetter>,
  choice: loadStepChoice as jest.MockedFunction<typeof loadStepChoice>,
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
      { key: 'received', label: 'Văn thư tiếp nhận', state: 'done', approval: false, people: 'Hồ Thọ', at: '2026-11-13' },
      { key: 'processing', label: 'Phòng ban xử lý', state: 'done', approval: false, people: 'Phòng Kinh doanh' },
      { key: 'step-1', label: 'Lãnh đạo duyệt và ký', state: 'current', approval: true, people: 'Hà Nguyên Hoàng' },
      { key: 'closing', label: 'Văn thư hoàn tất, lưu trữ', state: 'todo', approval: false, people: 'Lê Thu Hà' },
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
    expect(screen.getByText(/Quy trình: Quy trình mặc định · 1 bước duyệt/)).toBeTruthy();
  });
});

describe('Bước duyệt: Đạt / Không đạt', () => {
  const reviewing = letter({}, { approve: true, comment: true, returnTargets: ['previous-step', 'handlers', 'clerk'], defaultReturnTarget: 'previous-step' });

  it('Đạt chuyển bước tiếp theo kèm ý kiến', async () => {
    const onDone = jest.fn();
    mocked.approve.mockResolvedValue(reviewing);
    render(<LetterActionPanel letter={reviewing} config={config} onDone={onDone} onDirtyChange={jest.fn()} />);
    const send = await screen.findByRole('button', { name: 'Đạt, chuyển tiếp' });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Ý kiến'), { target: { value: 'Đồng ý trình TGĐ' } });
    fireEvent.click(send);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocked.approve).toHaveBeenCalledWith('letter-1', { note: 'Đồng ý trình TGĐ', nextAssigneeUserId: undefined });
  });

  it('Không đạt bắt nhập lý do, trả về bước trước theo mặc định của bước', async () => {
    const onDone = jest.fn();
    mocked.ret.mockResolvedValue(reviewing);
    render(<LetterActionPanel letter={reviewing} config={config} onDone={onDone} onDirtyChange={jest.fn()} />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Không đạt' }));
    const send = screen.getByRole('button', { name: 'Không đạt, trả lại' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Lý do không đạt/), { target: { value: 'Thiếu số liệu quý 3' } });
    fireEvent.click(send);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocked.ret).toHaveBeenCalledWith('letter-1', { target: 'previous-step', reason: 'Thiếu số liệu quý 3' });
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
