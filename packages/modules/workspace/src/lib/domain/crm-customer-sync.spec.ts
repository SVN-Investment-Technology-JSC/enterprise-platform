import { decideCrmCustomerSync, isCrmCustomerVersion } from './crm-customer-sync.js';

const CRM_ID = '10000000-0000-4000-8000-000000000001';

describe('decideCrmCustomerSync', () => {
  it('chưa có bản sao, không trùng mã: tạo mới', () => {
    expect(decideCrmCustomerSync({ crmCustomerId: CRM_ID, incomingVersion: 1 })).toEqual({ kind: 'create' });
  });

  it('có khách Workspace cùng mã chưa gắn: gắn khách đó, không tạo trùng', () => {
    expect(
      decideCrmCustomerSync({
        crmCustomerId: CRM_ID,
        incomingVersion: 1,
        candidate: { id: 'w1', crmCustomerId: null },
      }),
    ).toEqual({ kind: 'link', customerId: 'w1' });
  });

  it('mã đang thuộc bản sao của khách Bán hàng khác: xung đột', () => {
    expect(
      decideCrmCustomerSync({
        crmCustomerId: CRM_ID,
        incomingVersion: 1,
        candidate: { id: 'w1', crmCustomerId: 'other' },
      }),
    ).toEqual({ kind: 'conflict', customerId: 'w1' });
  });

  it('phiên bản mới hơn bản đang giữ: cập nhật', () => {
    expect(
      decideCrmCustomerSync({ crmCustomerId: CRM_ID, incomingVersion: 3, linked: { id: 'w1', crmVersion: 2 } }),
    ).toEqual({ kind: 'update', customerId: 'w1' });
  });

  it('giao lặp (cùng phiên bản) hay đến trễ (phiên bản cũ hơn): bỏ qua', () => {
    for (const incomingVersion of [2, 1]) {
      expect(
        decideCrmCustomerSync({ crmCustomerId: CRM_ID, incomingVersion, linked: { id: 'w1', crmVersion: 2 } }),
      ).toEqual({ kind: 'ignore', customerId: 'w1' });
    }
  });

  it('bản sao chưa có phiên bản (gắn tay trước đây): luôn cập nhật', () => {
    expect(
      decideCrmCustomerSync({ crmCustomerId: CRM_ID, incomingVersion: 1, linked: { id: 'w1', crmVersion: null } }),
    ).toEqual({ kind: 'update', customerId: 'w1' });
  });

  it('bản sao đã có thì mã trùng ở khách khác không làm gắn thêm; khách chỉ định khác bản sao là xung đột', () => {
    expect(
      decideCrmCustomerSync({
        crmCustomerId: CRM_ID,
        incomingVersion: 2,
        linked: { id: 'w1', crmVersion: 1 },
        candidate: { id: 'w1', crmCustomerId: CRM_ID },
      }),
    ).toEqual({ kind: 'update', customerId: 'w1' });
    expect(
      decideCrmCustomerSync({
        crmCustomerId: CRM_ID,
        incomingVersion: 2,
        linked: { id: 'w1', crmVersion: 1 },
        candidate: { id: 'w2', crmCustomerId: null },
      }),
    ).toEqual({ kind: 'conflict', customerId: 'w2' });
  });

  it('phiên bản hợp lệ là số nguyên dương', () => {
    expect(isCrmCustomerVersion(1)).toBe(true);
    expect([0, -1, 1.5, '2', null, undefined].some(isCrmCustomerVersion)).toBe(false);
  });
});
