import {
  addPollOption,
  buildPollRequest,
  emptyPollDraft,
  formatVnDateTime,
  isoToVnParts,
  pollPercent,
  postStatusBadges,
  readConfirmationProgress,
  removePollOption,
  sameSelection,
  setPollOption,
  toggleSelection,
  validatePollDraft,
  validateSchedule,
  vnPartsToIso,
} from './post-extras.model';

describe('giờ Việt Nam', () => {
  it('đổi ngày giờ VN sang ISO UTC và ngược lại', () => {
    expect(vnPartsToIso('2026-03-10', '08:30')).toBe(
      '2026-03-10T01:30:00.000Z',
    );
    expect(vnPartsToIso('2026-03-10', '02:00')).toBe(
      '2026-03-09T19:00:00.000Z',
    );
    expect(isoToVnParts('2026-03-09T19:00:00.000Z')).toEqual({
      date: '2026-03-10',
      time: '02:00',
    });
    expect(formatVnDateTime('2026-03-10T01:30:00.000Z')).toBe(
      '08:30 10/03/2026',
    );
  });

  it('từ chối ngày giờ không có thật', () => {
    expect(vnPartsToIso('2026-02-30', '08:00')).toBeUndefined();
    expect(vnPartsToIso('2026-02-10', '25:00')).toBeUndefined();
    expect(vnPartsToIso('10/02/2026', '08:00')).toBeUndefined();
  });

  it('kiểm khoảng hẹn giờ', () => {
    const now = Date.parse('2026-03-10T00:00:00.000Z'); // 07:00 VN
    expect(validateSchedule('', '', now)).toMatch(/chọn ngày/);
    expect(validateSchedule('2026-03-10', '07:00', now)).toMatch(
      /ít nhất 1 phút/,
    );
    expect(validateSchedule('2026-03-10', '07:30', now)).toBeUndefined();
    expect(validateSchedule('2028-03-10', '07:30', now)).toMatch(/365/);
  });
});

describe('bình chọn', () => {
  const valid = {
    ...emptyPollDraft(),
    question: 'Ăn gì?',
    options: ['Phở', 'Bún'],
  };

  it('giữ 2 đến 10 lựa chọn', () => {
    let draft = emptyPollDraft();
    expect(removePollOption(draft, 0).options).toHaveLength(2);
    for (let i = 0; i < 12; i += 1) draft = addPollOption(draft);
    expect(draft.options).toHaveLength(10);
    expect(setPollOption(draft, 0, 'A').options[0]).toBe('A');
  });

  it('kiểm bản nháp', () => {
    expect(validatePollDraft(emptyPollDraft())).toMatch(/câu hỏi/);
    expect(validatePollDraft({ ...valid, options: ['Phở', ''] })).toMatch(
      /nội dung/,
    );
    expect(validatePollDraft({ ...valid, options: ['Phở', 'phở'] })).toMatch(
      /trùng/,
    );
    expect(validatePollDraft({ ...valid, closeDate: '2026-03-10' })).toMatch(
      /đủ ngày và giờ/,
    );
    expect(validatePollDraft(valid)).toBeUndefined();
    const now = Date.parse('2026-03-10T00:00:00.000Z');
    expect(
      validatePollDraft(
        { ...valid, closeDate: '2026-03-10', closeTime: '06:00' },
        now,
      ),
    ).toMatch(/tương lai/);
  });

  it('dựng yêu cầu tạo bình chọn', () => {
    const request = buildPollRequest({
      ...valid,
      question: ' Ăn gì? ',
      allowMultiple: true,
      closeDate: '2026-03-10',
      closeTime: '08:30',
    });
    expect(request).toEqual({
      question: 'Ăn gì?',
      options: ['Phở', 'Bún'],
      allowMultiple: true,
      anonymous: false,
      closesAt: '2026-03-10T01:30:00.000Z',
    });
    expect(buildPollRequest(valid)).not.toHaveProperty('closesAt');
  });

  it('tính phần trăm và lựa chọn', () => {
    expect(pollPercent(1, 3)).toBe(33);
    expect(pollPercent(0, 0)).toBe(0);
    expect(toggleSelection(['a'], 'b', false)).toEqual(['b']);
    expect(toggleSelection(['a'], 'a', false)).toEqual([]);
    expect(toggleSelection(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleSelection(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(sameSelection(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSelection(['a'], ['b'])).toBe(false);
  });
});

describe('huy hiệu trạng thái', () => {
  it('bài đã đăng chỉ có thông báo và ghim', () => {
    const badges = postStatusBadges({ kind: 'announcement', pinned: true });
    expect(badges.map((item) => item.key)).toEqual(['announcement', 'pinned']);
  });

  it('bài hẹn giờ kèm giờ VN', () => {
    const [badge] = postStatusBadges({
      status: 'scheduled',
      kind: 'post',
      pinned: false,
      scheduledAt: '2026-03-10T01:30:00.000Z',
    });
    expect(badge?.label).toBe('Hẹn giờ đăng 08:30 10/03/2026');
    expect(
      postStatusBadges({ status: 'pending', kind: 'post', pinned: false })[0]
        ?.tone,
    ).toBe('warning');
    expect(
      postStatusBadges({ status: 'rejected', kind: 'post', pinned: false })[0]
        ?.tone,
    ).toBe('danger');
  });

  it('tiến độ xác nhận đã đọc', () => {
    expect(readConfirmationProgress(3, 4)).toBe(75);
    expect(readConfirmationProgress(0, 0)).toBe(100);
    expect(readConfirmationProgress(undefined, 4)).toBeUndefined();
  });
});
