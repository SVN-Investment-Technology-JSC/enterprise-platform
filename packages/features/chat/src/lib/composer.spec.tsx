/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatPerson } from '@enterprise-platform/contracts-chat';
import { chatApi } from './chat-api';
import { Composer } from './composer';

jest.mock('./chat-api', () => ({ chatApi: { upload: jest.fn(), people: jest.fn(async () => ({ people: [] })) } }));
const upload = chatApi.upload as jest.MockedFunction<typeof chatApi.upload>;

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const AN = 'aaaaaaaa-0000-4000-8000-000000000002';
const people: ChatPerson[] = [
  { id: ME, fullName: 'Hồ Thọ', email: 'tho@test.local', avatarVersion: null },
  { id: AN, fullName: 'Nguyễn Văn An', email: 'an@test.local', avatarVersion: null },
];

beforeAll(() => {
  Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:preview'), revokeObjectURL: jest.fn() });
});

function setup(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSubmit = jest.fn(async () => undefined);
  const onTyping = jest.fn();
  render(
    <Composer
      conversationId="c1"
      me={ME}
      people={people}
      nameOf={(id) => people.find((p) => p.id === id)?.fullName ?? '?'}
      replyTo={null}
      editing={null}
      onCancelContext={jest.fn()}
      onSubmit={onSubmit}
      onSaveEdit={jest.fn()}
      onTyping={onTyping}
      {...overrides}
    />,
  );
  return { onSubmit, onTyping, input: screen.getByLabelText('Nội dung tin nhắn') as HTMLTextAreaElement };
}

describe('Composer', () => {
  beforeEach(() => upload.mockReset());

  it('Enter gửi, Shift+Enter không gửi; báo đang gõ rồi ngừng khi gửi xong', async () => {
    const { input, onSubmit, onTyping } = setup();
    fireEvent.change(input, { target: { value: 'Xin chào', selectionStart: 8 } });
    expect(onTyping).toHaveBeenCalledWith(true);
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onSubmit).toHaveBeenCalledWith({ body: 'Xin chào', mentions: [], attachments: [], replyTo: null });
    expect(onTyping).toHaveBeenLastCalledWith(false);
    expect(input.value).toBe('');
  });

  it('gõ "@" hiện gợi ý (không có chính mình), chọn bằng Enter thì chèn tên và gửi kèm người được nhắc', async () => {
    const { input, onSubmit } = setup();
    fireEvent.change(input, { target: { value: 'Chào @ngu', selectionStart: 9 } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('Nguyễn Văn An');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('Chào @Nguyễn Văn An ');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ body: 'Chào @Nguyễn Văn An', mentions: [AN] }));
  });

  it('dán ảnh (Ctrl+V) là đính kèm ngay, chờ tải xong mới gửi được', async () => {
    let finish: (value: Awaited<ReturnType<typeof chatApi.upload>>) => void = () => undefined;
    upload.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { input, onSubmit } = setup();
    const image = new File(['png'], 'image.png', { type: 'image/png' });
    fireEvent.paste(input, { clipboardData: { files: [image], getData: () => '' } });
    expect(await screen.findByText('Đang tải lên…')).toBeTruthy();
    expect((screen.getByLabelText('Gửi') as HTMLButtonElement).disabled).toBe(true);
    expect(upload.mock.calls[0][1].name).toMatch(/^anh-dan-\d{8}-\d{6}\.png$/);
    const attachment = { id: 'f1', fileName: 'anh.png', contentType: 'image/png', sizeBytes: 3, isImage: true };
    await act(async () => finish(attachment));
    await waitFor(() => expect((screen.getByLabelText('Gửi') as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Gửi'));
    });
    expect(onSubmit).toHaveBeenCalledWith({ body: '', mentions: [], attachments: [attachment], replyTo: null });
  });

  it('chặn loại tệp không gửi được', async () => {
    const { input } = setup();
    fireEvent.paste(input, { clipboardData: { files: [new File(['x'], 'virus.exe', { type: 'application/x-msdownload' })], getData: () => '' } });
    expect((await screen.findByRole('alert')).textContent).toContain('loại tệp này không gửi được');
    expect(upload).not.toHaveBeenCalled();
  });

  it('chèn biểu tượng cảm xúc từ bảng chọn', () => {
    const { input } = setup();
    fireEvent.click(screen.getByLabelText('Biểu tượng cảm xúc'));
    const cells = screen.getByRole('dialog', { name: 'Chọn biểu tượng cảm xúc' }).querySelectorAll('button[class*="emojiCell"]');
    expect(cells.length).toBeGreaterThan(20);
    fireEvent.click(cells[0]);
    expect(input.value).toBe(String.fromCodePoint(0x1f600));
  });
});
