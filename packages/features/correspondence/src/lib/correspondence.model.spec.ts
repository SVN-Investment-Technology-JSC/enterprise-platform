import type { LetterSummary } from '@enterprise-platform/contracts-correspondence';
import { dueText, formatDay, isPreviewable, matchesSearch, stageTone } from './correspondence.model';

const letter = (overrides: Partial<LetterSummary> = {}): LetterSummary => ({
  id: 'l1',
  incomingNo: '41/CVĐ',
  receivedOn: '2026-11-10',
  senderOrg: 'Sở Tài chính TP. Đà Nẵng',
  subject: 'Yêu cầu giải trình số liệu quyết toán thuế',
  kind: 'finance',
  urgency: 'urgent',
  confidentiality: 'normal',
  dueOn: '2026-11-14',
  stage: 'processing',
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

  it('định dạng ngày, màu bước và tệp xem trước được', () => {
    expect(formatDay('2026-11-05')).toBe('05/11/2026');
    expect(stageTone('reviewing')).toBe('warning');
    expect(stageTone('archived')).toBe('success');
    expect(isPreviewable('application/pdf')).toBe(true);
    expect(isPreviewable('application/msword')).toBe(false);
  });
});
