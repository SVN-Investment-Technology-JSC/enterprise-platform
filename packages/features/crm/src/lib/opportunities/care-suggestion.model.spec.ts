import {
  buildCareActivityRequest,
  defaultCareDate,
  defaultCareSubject,
  shouldOfferCareFollowUp,
} from './care-suggestion.model';

describe('gợi ý chăm sóc lại khi Thua (P2F-01)', () => {
  it('TC-CARE-01/04/05: chỉ hiện khi server báo careSuggestion.enabled', () => {
    expect(shouldOfferCareFollowUp({ careSuggestion: { enabled: true } })).toBe(true);
    expect(shouldOfferCareFollowUp({ careSuggestion: { enabled: false } })).toBe(false);
    expect(shouldOfferCareFollowUp({})).toBe(false);
  });

  it('ngày mặc định cộng 30 ngày, qua tháng và năm', () => {
    expect(defaultCareDate(new Date(2026, 10, 2))).toBe('2026-12-02');
    expect(defaultCareDate(new Date(2026, 11, 20))).toBe('2027-01-19');
  });

  it('nội dung mặc định có tên dự án và không dài quá 300 ký tự', () => {
    expect(defaultCareSubject('Dự án A')).toContain('Dự án A');
    expect(defaultCareSubject('x'.repeat(500)).length).toBe(300);
  });

  it('TC-CARE-03: tạo yêu cầu đúng người, ngày, gắn cơ hội, có hạn nhắc', () => {
    const result = buildCareActivityRequest({
      opportunityId: 'opp-1',
      subject: ' Gọi lại ',
      description: ' ',
      assigneeUserId: 'u1',
      date: '2026-12-02',
    });
    expect(result).toMatchObject({ type: 'CALL', subject: 'Gọi lại', description: null, opportunityId: 'opp-1', assigneeUserId: 'u1' });
    const due = new Date((result as { dueAt: string }).dueAt);
    expect([due.getFullYear(), due.getMonth(), due.getDate(), due.getHours()]).toEqual([2026, 11, 2, 9]);
  });

  it('báo lỗi tiếng Việt khi thiếu nội dung, người hoặc ngày', () => {
    const base = { opportunityId: 'o', subject: 'x', description: '', assigneeUserId: 'u', date: '2026-12-02' };
    expect(buildCareActivityRequest({ ...base, subject: ' ' })).toEqual({ error: 'Vui lòng nhập nội dung chăm sóc.' });
    expect(buildCareActivityRequest({ ...base, assigneeUserId: '' })).toEqual({ error: 'Vui lòng chọn người phụ trách chăm sóc.' });
    expect(buildCareActivityRequest({ ...base, date: '' })).toEqual({ error: 'Vui lòng chọn ngày chăm sóc.' });
  });
});
