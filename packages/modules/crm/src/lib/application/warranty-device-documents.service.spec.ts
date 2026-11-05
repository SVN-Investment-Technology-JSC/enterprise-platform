import type { WarrantyCaseDetail } from '@enterprise-platform/contracts-crm';
import { CrmNotFoundError } from '../domain/crm.error.js';
import type { CrmActor } from './crm-actor.js';
import { WarrantyDeviceDocumentService, type DeviceDocumentFromInventory } from './warranty-device-documents.service.js';

const actor = { tenantId: 't1', userId: 'u1', sessionId: 's1' } as unknown as CrmActor;
const doc: DeviceDocumentFromInventory = {
  id: 'd1',
  fileName: 'huong-dan.pdf',
  contentType: 'application/pdf',
  sizeBytes: 10,
  note: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  downloadUrl: 'https://s3/x?sig=1',
  expiresInSeconds: 300,
};
const detail = {
  lines: [
    { id: 'l1', materialId: 'm1', materialCode: 'MAY', materialName: 'Máy', serial: 'SN1' },
    { id: 'l2', materialId: 'm1', materialCode: 'MAY', materialName: 'Máy', serial: 'SN2' },
  ],
} as unknown as WarrantyCaseDetail;

function build(canAccessInventory: boolean, list = jest.fn().mockResolvedValue([doc])) {
  const get = jest.fn().mockResolvedValue(detail);
  const read = jest.fn().mockResolvedValue({ inventoryEntitled: true, canAccessInventory });
  return { list, get, read, service: new WarrantyDeviceDocumentService({ get }, { read }, { list }) };
}

describe('WarrantyDeviceDocumentService (TC-DOC-15, TC-DOC-16)', () => {
  it('có quyền Kho: trả tài liệu theo từng thiết bị, gom một lần gọi cho cùng mặt hàng', async () => {
    const { service, list } = build(true);
    const result = await service.list(actor, 'c1');
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith('t1', 'm1');
    expect(result).toEqual([expect.objectContaining({ id: 'd1', lineId: 'l1', materialCode: 'MAY', serial: 'SN1', fileName: 'huong-dan.pdf' })]);
  });

  it('không có quyền Kho: trả [] và không gọi Kho, không lộ tên tệp', async () => {
    const { service, list } = build(false);
    expect(await service.list(actor, 'c1')).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it('không đọc được quyền hoặc Kho lỗi: trả []', async () => {
    const a = build(true, jest.fn().mockRejectedValue(new Error('down')));
    expect(await a.service.list(actor, 'c1')).toEqual([]);
    const get = jest.fn().mockResolvedValue(detail);
    const service = new WarrantyDeviceDocumentService({ get }, { read: jest.fn().mockRejectedValue(new Error('x')) }, { list: jest.fn().mockResolvedValue([doc]) });
    expect(await service.list(actor, 'c1')).toEqual([]);
  });

  it('yêu cầu ngoài phạm vi: lỗi 404 của bảo hành, không hỏi Kho', async () => {
    const { service, get, list } = build(true);
    get.mockRejectedValue(new CrmNotFoundError());
    await expect(service.list(actor, 'c1')).rejects.toBeInstanceOf(CrmNotFoundError);
    expect(list).not.toHaveBeenCalled();
  });
});
