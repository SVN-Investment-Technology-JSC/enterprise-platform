import { CRM_NO_CAPABILITIES, type DeliveryPlan, type SalesOrderLine } from '@enterprise-platform/contracts-crm';
import { canRequestDelivery, canTriggerPaymentTerm, contractActions, warehouseOptions, orderActions, paymentTermTotals, remainingToPlan } from './fulfillment.model';

const writer = { ...CRM_NO_CAPABILITIES, canWriteContract: true, canWriteOrder: true };

describe('màn hợp đồng, đơn bán', () => {
  it('nút hợp đồng theo trạng thái và quyền', () => {
    expect(contractActions({ status: 'DRAFT' }, writer)).toEqual(['edit', 'confirm', 'cancel']);
    expect(contractActions({ status: 'ACTIVE' }, writer)).toEqual(['complete', 'cancel']);
    expect(contractActions({ status: 'EXPIRED' }, writer)).toEqual(['liquidate']);
    expect(contractActions({ status: 'DRAFT' }, CRM_NO_CAPABILITIES)).toEqual([]);
  });

  it('TC-CON-06: nút ghi nhận nghiệm thu chỉ với đợt nghiệm thu chưa đến hạn, hợp đồng hiệu lực, quyền hợp đồng', () => {
    const term = { condition: 'ACCEPTANCE', status: 'PENDING' } as const;
    expect(canTriggerPaymentTerm({ status: 'ACTIVE' }, term, writer)).toBe(true);
    expect(canTriggerPaymentTerm({ status: 'COMPLETED' }, term, writer)).toBe(true);
    expect(canTriggerPaymentTerm({ status: 'DRAFT' }, term, writer)).toBe(false);
    expect(canTriggerPaymentTerm({ status: 'ACTIVE' }, { ...term, status: 'DUE' }, writer)).toBe(false);
    expect(canTriggerPaymentTerm({ status: 'ACTIVE' }, { ...term, condition: 'SIGN' }, writer)).toBe(false);
    expect(canTriggerPaymentTerm({ status: 'ACTIVE' }, term, { ...CRM_NO_CAPABILITIES, canWriteReceivable: true })).toBe(false);
  });

  it('TC-ORD-04: ô chọn kho xuất: kho đang hoạt động, giữ kho đang chọn kể cả đã ngừng hay không còn', () => {
    const list = [
      { id: '1', code: 'KHO-1', name: 'Kho Hà Nội', isActive: true },
      { id: '2', code: 'KHO-2', name: 'Kho cũ', isActive: false },
    ];
    expect(warehouseOptions(list, null)).toEqual([{ value: 'KHO-1', label: 'Kho Hà Nội', badge: 'KHO-1' }]);
    expect(warehouseOptions(list, 'KHO-2').map((option) => option.value)).toEqual(['KHO-1', 'KHO-2']);
    expect(warehouseOptions([], 'KHO-9')).toEqual([{ value: 'KHO-9', label: 'KHO-9', badge: 'KHO-9' }]);
  });

  it('nút đơn theo trạng thái; đóng tay chỉ quản lý', () => {
    const line = { id: 'l1' } as SalesOrderLine;
    expect(orderActions({ status: 'DRAFT', lines: [line] }, writer)).toEqual(['edit', 'confirm', 'plan', 'cancel']);
    expect(orderActions({ status: 'DRAFT', lines: [] }, writer)).toEqual(['edit', 'plan', 'cancel']);
    expect(orderActions({ status: 'DELIVERED', lines: [line] }, writer)).toEqual([]);
    expect(orderActions({ status: 'DELIVERED', lines: [line] }, { ...writer, canReadAll: true })).toEqual(['close']);
    expect(canRequestDelivery({ status: 'CONFIRMED' }, { status: 'PLANNED' })).toBe(true);
    expect(canRequestDelivery({ status: 'DRAFT' }, { status: 'PLANNED' })).toBe(false);
  });

  it('số còn lập đợt: trừ phần đã lập, cộng lại phần của đợt đang sửa', () => {
    const order = {
      lines: [{ id: 'l1', quantity: 10, plannedQuantity: 4 } as SalesOrderLine],
      deliveries: [],
    };
    expect(remainingToPlan(order).get('l1')).toBe(6);
    const editing = { lines: [{ orderLineId: 'l1', plannedQuantity: 4 }] } as unknown as DeliveryPlan;
    expect(remainingToPlan(order, editing).get('l1')).toBe(10);
  });

  it('tổng đợt thanh toán: 30/50/20 khớp, 30/60 lệch', () => {
    expect(paymentTermTotals([{ percent: 30 }, { percent: 50 }, { percent: 20 }], 100_000_000)).toEqual({ percent: 100, amount: 100_000_000, balanced: true });
    expect(paymentTermTotals([{ percent: 30 }, { percent: 60 }], 100_000_000).balanced).toBe(false);
    expect(paymentTermTotals([{ percent: 40 }, { amount: 60_000_000 }], 100_000_000).balanced).toBe(true);
  });
});
