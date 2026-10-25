import { StorageQuotaExceededError } from '../domain/shared.error.js';
import type { StorageQuotaService } from '../application/storage-quota.service.js';
import { SharedController } from './shared.controller.js';

const actor = {
  tenantId: 't1',
  userId: 'system',
  displayName: 'Hệ thống',
  isTenantAdmin: false,
  canManage: false,
  canWriteDocuments: false,
  canDeleteDocuments: false,
};

function controller(ensureCapacity: jest.Mock) {
  const quota = { ensureCapacity } as unknown as StorageQuotaService;
  return new SharedController({} as never, {} as never, quota, {} as never);
}

describe('SharedController.capacityCheck', () => {
  it('trong hạn mức thì allowed true', async () => {
    const ensure = jest.fn().mockResolvedValue(undefined);
    await expect(controller(ensure).capacityCheck({ sharedActor: actor }, { sizeBytes: 100 })).resolves.toEqual({
      allowed: true,
    });
    expect(ensure).toHaveBeenCalledWith('t1', 100);
  });

  it('vượt hạn mức thì allowed false kèm thông báo tiếng Việt', async () => {
    const ensure = jest.fn().mockRejectedValue(new StorageQuotaExceededError('Vượt hạn mức dung lượng.'));
    await expect(controller(ensure).capacityCheck({ sharedActor: actor }, { sizeBytes: 100 })).resolves.toEqual({
      allowed: false,
      message: 'Vượt hạn mức dung lượng.',
    });
  });

  it.each([undefined, {}, { sizeBytes: '5' }, { sizeBytes: -1 }, { sizeBytes: 1.5 }, { sizeBytes: Number.NaN }])(
    'sizeBytes sai (%p) thì 400 và không đụng tới hạn mức',
    (body) => {
      const ensure = jest.fn();
      expect(() => controller(ensure).capacityCheck({ sharedActor: actor }, body)).toThrow(
        expect.objectContaining({ status: 400 }),
      );
      expect(ensure).not.toHaveBeenCalled();
    },
  );

  it('lỗi khác (bug, DB) vẫn lan ra để bên gọi tính là lỗi', async () => {
    const ensure = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(controller(ensure).capacityCheck({ sharedActor: actor }, { sizeBytes: 1 })).rejects.toThrow('db down');
  });
});
