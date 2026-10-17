import { ASSISTANT_MESSAGE, isAssistantFrameMessage } from './assistant-frame.js';

describe('isAssistantFrameMessage', () => {
  it('nhận các tin nhắn đúng hình dạng', () => {
    expect(isAssistantFrameMessage({ type: ASSISTANT_MESSAGE.page, page: '/modules/hrm' })).toBe(true);
    expect(isAssistantFrameMessage({ type: ASSISTANT_MESSAGE.ready })).toBe(true);
    expect(
      isAssistantFrameMessage({
        type: ASSISTANT_MESSAGE.action,
        key: 'workspace.event.create',
        requestId: 'r1',
        draft: { title: 'Họp giao ban' },
      }),
    ).toBe(true);
    expect(
      isAssistantFrameMessage({
        type: ASSISTANT_MESSAGE.result,
        key: 'workspace.event.create',
        requestId: 'r1',
        outcome: 'saved',
        id: 'e1',
        href: '/modules/workspace#calendar',
      }),
    ).toBe(true);
  });

  it('bỏ qua tin nhắn lạ hoặc thiếu trường', () => {
    expect(isAssistantFrameMessage(null)).toBe(false);
    expect(isAssistantFrameMessage('savina-assistant:ready')).toBe(false);
    expect(isAssistantFrameMessage({ type: 'other:ready' })).toBe(false);
    expect(isAssistantFrameMessage({ type: ASSISTANT_MESSAGE.page })).toBe(false);
    expect(
      isAssistantFrameMessage({
        type: ASSISTANT_MESSAGE.action,
        key: 'workspace.event.create',
        requestId: 'r1',
        draft: ['Họp giao ban'],
      }),
    ).toBe(false);
    expect(
      isAssistantFrameMessage({
        type: ASSISTANT_MESSAGE.result,
        key: 'workspace.event.create',
        requestId: 'r1',
        outcome: 'done',
      }),
    ).toBe(false);
    expect(
      isAssistantFrameMessage({
        type: ASSISTANT_MESSAGE.result,
        key: 'workspace.event.create',
        requestId: 'r1',
        outcome: 'saved',
        id: 42,
      }),
    ).toBe(false);
  });
});
