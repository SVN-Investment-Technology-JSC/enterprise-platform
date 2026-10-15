import {
  activeTypers,
  nextTypingSignal,
  pruneTyping,
  TYPING_TTL_MS,
  typingLabel,
  withTyping,
} from './chat-typing';

const T0 = 1_000_000;

describe('bảng "đang nhập"', () => {
  it('có tín hiệu thì hiện, hết hạn thì tự mất', () => {
    const map = withTyping({}, 'a', true, T0);
    expect(activeTypers(map, T0 + 1_000)).toEqual(['a']);
    expect(activeTypers(map, T0 + TYPING_TTL_MS)).toEqual([]);
  });

  it('tín hiệu mới gia hạn thời gian', () => {
    let map = withTyping({}, 'a', true, T0);
    map = withTyping(map, 'a', true, T0 + 4_000);
    expect(activeTypers(map, T0 + 8_000)).toEqual(['a']);
  });

  it('báo ngừng thì bỏ ngay; bỏ người không có thì giữ nguyên đối tượng', () => {
    const map = withTyping({}, 'a', true, T0);
    expect(activeTypers(withTyping(map, 'a', false, T0 + 100), T0 + 100)).toEqual([]);
    expect(withTyping(map, 'zzz', false, T0)).toBe(map);
  });

  it('nhiều người cùng gõ: giữ thứ tự bắt đầu', () => {
    let map = withTyping({}, 'a', true, T0);
    map = withTyping(map, 'b', true, T0 + 500);
    expect(activeTypers(map, T0 + 600)).toEqual(['a', 'b']);
  });

  it('pruneTyping bỏ mục hết hạn và trả lại đúng đối tượng cũ khi không đổi', () => {
    const map = withTyping(withTyping({}, 'a', true, T0), 'b', true, T0 + 4_000);
    expect(pruneTyping(map, T0 + 1_000)).toBe(map);
    expect(Object.keys(pruneTyping(map, T0 + 6_000))).toEqual(['b']);
  });
});

describe('typingLabel', () => {
  it('theo số người, không kèm dấu chấm lửng', () => {
    expect(typingLabel([])).toBe('');
    expect(typingLabel(['A'])).toBe('A đang nhập');
    expect(typingLabel(['A', 'B'])).toBe('A và B đang nhập');
    expect(typingLabel(['A', 'B', 'C', 'D'])).toBe('A, B và 2 người khác đang nhập');
  });
});

describe('nextTypingSignal', () => {
  const idle = { typing: false, at: 0 };

  it('ô trống từ đầu thì không báo gì', () => {
    expect(nextTypingSignal(idle, false, 1_000).send).toBeUndefined();
  });

  it('bắt đầu gõ thì báo ngay một lần', () => {
    const first = nextTypingSignal(idle, true, 1_000);
    expect(first.send).toBe(true);
    expect(first.state).toEqual({ typing: true, at: 1_000 });
  });

  it('đang gõ liên tục: chỉ nhắc lại sau mỗi 3 giây, không báo mỗi phím', () => {
    let state = nextTypingSignal(idle, true, 1_000).state;
    const sends: boolean[] = [];
    for (let t = 1_100; t <= 8_000; t += 100) {
      const step = nextTypingSignal(state, true, t);
      if (step.send !== undefined) sends.push(step.send);
      state = step.state;
    }
    expect(sends).toEqual([true, true]);
  });

  it('xoá hết nội dung thì báo ngừng đúng một lần', () => {
    const stop = nextTypingSignal({ typing: true, at: 1_000 }, false, 1_500);
    expect(stop.send).toBe(false);
    expect(nextTypingSignal(stop.state, false, 1_600).send).toBeUndefined();
  });
});
