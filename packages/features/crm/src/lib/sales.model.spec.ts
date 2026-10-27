import type { CustomerTimelineEntry, OpportunityBoard, OpportunitySummary } from '@enterprise-platform/contracts-crm';
import {
  canDropStage,
  describeTimelineEntry,
  formatMoney,
  isOverdue,
  moveCard,
  personName,
  replaceCard,
  taxCodeLooksValid,
} from './sales.model';

const card = (id: string, stage: OpportunitySummary['stage'], value = 100): OpportunitySummary => ({
  id, name: id, customerId: 'c', customerCode: 'KH1', customerName: 'Khách', stage, probability: 0,
  expectedValue: value, expectedCloseDate: null, ownerUserId: 'u', version: 1, updatedAt: '',
});

const board: OpportunityBoard = {
  perStageLimit: 50,
  columns: [
    { stage: 'NEW', total: 2, totalValue: 300, items: [card('a', 'NEW'), card('b', 'NEW', 200)] },
    { stage: 'CONTACTED', total: 0, totalValue: 0, items: [] },
    { stage: 'LOST', total: 0, totalValue: 0, items: [] },
  ],
};

describe('kanban cơ hội', () => {
  it('chỉ thả được vào cột kề hoặc Thua; Thắng chỉ từ Đàm phán', () => {
    expect(canDropStage('NEW', 'CONTACTED')).toBe(true);
    expect(canDropStage('NEW', 'DISCOVERY')).toBe(false);
    expect(canDropStage('QUOTING', 'LOST')).toBe(true);
    expect(canDropStage('QUOTING', 'WON')).toBe(false);
    expect(canDropStage('NEGOTIATION', 'WON')).toBe(true);
    expect(canDropStage('WON', 'NEGOTIATION')).toBe(false);
  });

  it('chuyển lạc quan cập nhật hai cột và giữ bảng cũ để hoàn tác', () => {
    const moved = moveCard(board, 'b', 'CONTACTED');
    expect(moved?.from).toBe('NEW');
    expect(moved?.board.columns[0]).toMatchObject({ total: 1, totalValue: 100 });
    expect(moved?.board.columns[1]).toMatchObject({ total: 1, totalValue: 200 });
    expect(moved?.board.columns[1].items[0]).toMatchObject({ id: 'b', stage: 'CONTACTED' });
    // Bảng gốc không bị sửa: hoàn tác là gán lại bảng cũ.
    expect(board.columns[0].items).toHaveLength(2);
    expect(moveCard(board, 'a', 'NEW')).toBeUndefined();
    expect(moveCard(board, 'khong-co', 'LOST')).toBeUndefined();
  });

  it('thay thẻ bằng bản server trả về', () => {
    const next = replaceCard(board, { ...card('a', 'NEW'), version: 5 });
    expect(next.columns[0].items[0].version).toBe(5);
  });
});

describe('tiện ích hiển thị', () => {
  it('quá hạn chỉ khi đang mở và hạn đã qua', () => {
    const now = Date.parse('2026-10-27T10:00:00Z');
    expect(isOverdue({ status: 'OPEN', dueAt: '2026-10-27T09:00:00Z' }, now)).toBe(true);
    expect(isOverdue({ status: 'DONE', dueAt: '2026-10-27T09:00:00Z' }, now)).toBe(false);
    expect(isOverdue({ status: 'OPEN', dueAt: null }, now)).toBe(false);
  });

  it('tên người, tiền, MST', () => {
    expect(personName([{ userId: 'u1', displayName: 'Nguyễn Văn A' }], 'u1')).toBe('Nguyễn Văn A');
    expect(personName([], 'u2')).toBe('Người dùng khác');
    expect(formatMoney(1234567)).toMatch(/^1\.234\.567/);
    expect(formatMoney(null)).toBe('');
    expect(taxCodeLooksValid('0101234567-001')).toBe(true);
    expect(taxCodeLooksValid('0101')).toBe(false);
    expect(taxCodeLooksValid('')).toBe(true);
  });

  it('mô tả mục dòng thời gian, loại lạ không làm vỡ', () => {
    const changed: CustomerTimelineEntry = {
      kind: 'opportunity-stage-changed', id: 'h', at: '', actorId: null, opportunityId: 'o',
      opportunityName: 'Dự án A', fromStage: 'NEGOTIATION', toStage: 'LOST', reason: 'Giá cao',
    };
    expect(describeTimelineEntry(changed)).toEqual({ title: 'Cơ hội "Dự án A": Đàm phán → Thua', detail: 'Lý do: Giá cao' });
    expect(describeTimelineEntry({ kind: 'quote-sent' } as unknown as CustomerTimelineEntry)).toEqual({ title: 'Sự kiện khác' });
  });
});
