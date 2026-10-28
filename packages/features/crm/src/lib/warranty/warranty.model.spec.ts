import { CRM_NO_CAPABILITIES, type WarrantyDocument } from '@enterprise-platform/contracts-crm';
import { coverageLabel, dispositionsFor, warrantyActions } from './warranty.model';

const writer = { ...CRM_NO_CAPABILITIES, canWriteWarranty: true };
const document = (kind: WarrantyDocument['kind'], status: WarrantyDocument['status']) => ({ kind, status }) as WarrantyDocument;

describe('màn bảo hành', () => {
  it('nút theo trạng thái và quyền', () => {
    expect(warrantyActions({ status: 'RECEIVED', documents: [] }, writer)).toEqual(['receive', 'reject']);
    expect(warrantyActions({ status: 'AWAITING_GOODS', documents: [document('RETURN_RECEIPT', 'PENDING')] }, writer)).toEqual(['receive']);
    expect(warrantyActions({ status: 'AWAITING_GOODS', documents: [document('RETURN_RECEIPT', 'POSTED')] }, writer)).toEqual([]);
    expect(warrantyActions({ status: 'INSPECTING', documents: [] }, writer)).toEqual(['inspect']);
    expect(warrantyActions({ status: 'RESOLVING', documents: [document('SCRAP', 'PENDING')] }, writer)).toEqual(['resolve', 'sync']);
    expect(warrantyActions({ status: 'RESOLVED', documents: [document('CREDIT', 'PENDING_RECEIVABLE')] }, writer)).toEqual(['sync', 'close']);
    expect(warrantyActions({ status: 'REJECTED', documents: [] }, writer)).toEqual(['close']);
    expect(warrantyActions({ status: 'CLOSED', documents: [] }, writer)).toEqual([]);
    expect(warrantyActions({ status: 'RECEIVED', documents: [] }, CRM_NO_CAPABILITIES)).toEqual([]);
  });

  it('hướng xử lý theo kết quả kiểm định', () => {
    expect(dispositionsFor('PASSED')).toEqual(['RESTOCK']);
    expect(dispositionsFor('DEFECTIVE')).toEqual(['MOVE_TO_DEFECT', 'SCRAP']);
    expect(dispositionsFor(null)).toEqual([]);
  });

  it('nhãn hạn bảo hành', () => {
    const base = { deliveredOn: '2026-07-27', months: 12, source: 'MATERIAL' as const };
    expect(coverageLabel({ ...base, warrantyUntil: '2027-07-27', remainingDays: 273, expired: false })).toBe('Còn 273 ngày (đến 27/07/2027)');
    expect(coverageLabel({ ...base, warrantyUntil: '2026-09-27', remainingDays: 0, expired: true })).toBe('Hết hạn bảo hành (từ sau 27/09/2026)');
    expect(coverageLabel({ ...base, source: 'NONE', warrantyUntil: null, remainingDays: 0, expired: true })).toBe('Không có bảo hành');
  });
});
