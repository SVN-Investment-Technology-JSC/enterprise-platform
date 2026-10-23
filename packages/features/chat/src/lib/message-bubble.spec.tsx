/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatMessageView } from '@enterprise-platform/contracts-chat';
import { MessageBubble } from './message-bubble';

jest.mock('./chat-api', () => ({ chatApi: { people: jest.fn(async () => ({ people: [] })) } }));

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const AN = 'aaaaaaaa-0000-4000-8000-000000000002';

function message(over: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: 'm1',
    conversationId: 'c1',
    senderId: AN,
    kind: 'text',
    body: 'Chào cả nhà',
    mentions: [],
    replyTo: null,
    attachments: [],
    reactions: [],
    systemEvent: null,
    clientId: null,
    isEdited: false,
    isDeleted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function setup(view: ChatMessageView) {
  const onReact = jest.fn();
  render(
    <MessageBubble
      message={view}
      me={ME}
      mine={view.senderId === ME}
      first
      last
      showSender
      nameOf={(id) => (id === ME ? 'Bạn' : 'Nguyễn Văn An')}
      onReply={jest.fn()}
      onEdit={jest.fn()}
      onRecall={jest.fn()}
      onReact={onReact}
    />,
  );
  return { onReact };
}

describe('thả cảm xúc theo tin nhắn', () => {
  it('nút tim thả nhanh, bấm đúp vào tin cũng thả tim', () => {
    const view = message();
    const { onReact } = setup(view);
    fireEvent.click(screen.getByLabelText('Thả tim'));
    expect(onReact).toHaveBeenLastCalledWith(view, 'love');
    fireEvent.doubleClick(screen.getByText('Chào cả nhà'));
    expect(onReact).toHaveBeenCalledTimes(2);
    expect(onReact).toHaveBeenLastCalledWith(view, 'love');
  });

  it('đã thả tim rồi thì bấm lại là bỏ; chọn cảm xúc khác từ bảng chọn', () => {
    const view = message({ reactions: [{ reaction: 'love', userIds: [ME, AN] }] });
    const { onReact } = setup(view);
    expect(screen.getByTitle('Yêu thích: Bạn, Nguyễn Văn An').textContent).toBe('2');
    fireEvent.click(screen.getByLabelText('Bỏ thả tim'));
    expect(onReact).toHaveBeenLastCalledWith(view, null);
    fireEvent.click(screen.getByLabelText('Thả cảm xúc'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Haha' }));
    expect(onReact).toHaveBeenLastCalledWith(view, 'haha');
  });

  it('tin đã thu hồi không thả được cảm xúc', () => {
    const { onReact } = setup(message({ isDeleted: true, body: '' }));
    expect(screen.queryByLabelText('Thả tim')).toBeNull();
    fireEvent.doubleClick(screen.getByText('Tin nhắn đã được thu hồi'));
    expect(onReact).not.toHaveBeenCalled();
  });
});
