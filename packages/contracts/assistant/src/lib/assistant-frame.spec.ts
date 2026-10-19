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

  it('nhận tin của trang form nhúng trong card', () => {
    expect(isAssistantFrameMessage({ type: ASSISTANT_MESSAGE.formReady, requestId: 'r1' })).toBe(true);
    expect(isAssistantFrameMessage({ type: ASSISTANT_MESSAGE.formSize, requestId: 'r1', height: 420 })).toBe(true);
    expect(isAssistantFrameMessage({ type: ASSISTANT_MESSAGE.formReady })).toBe(false);
    expect(isAssistantFrameMessage({ type: ASSISTANT_MESSAGE.formSize, requestId: 'r1', height: -1 })).toBe(false);
    expect(
      isAssistantFrameMessage({ type: ASSISTANT_MESSAGE.formSize, requestId: 'r1', height: Number.NaN }),
    ).toBe(false);
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

describe('isAssistantFrameMessage cho action có trang và biến thể', () => {
  it('nhận trang tương đối, từ chối trang sang tên miền khác', () => {
    const base = { type: ASSISTANT_MESSAGE.action, key: 'hrm.custom-request.create', requestId: 'r', draft: {} };
    expect(isAssistantFrameMessage({ ...base, page: '/modules/hrm/requests', variant: 't1' })).toBe(true);
    expect(isAssistantFrameMessage({ ...base, page: '//evil.example/x' })).toBe(false);
    expect(isAssistantFrameMessage({ ...base, page: 'https://evil.example' })).toBe(false);
    expect(isAssistantFrameMessage({ ...base, variant: 3 })).toBe(false);
    expect(isAssistantFrameMessage({ type: ASSISTANT_MESSAGE.refresh })).toBe(true);
  });
});
