import type { HttpException } from '@nestjs/common';
import { RelatedObjectCreateRejectedError, type RelatedObjectService } from '../application/related-object.service.js';
import type { WorkspaceActor } from '../application/workspace.application.js';
import { RelatedObjectsController } from './related-objects.controller.js';

const actor = { tenantId: 't-1', userId: 'u-1', displayName: 'Người A' } as WorkspaceActor;

function setup() {
  const related = {
    createRecord: jest.fn().mockResolvedValue({ kind: 'crm.contract', id: 'c-9' }),
    createForm: jest.fn().mockResolvedValue({ kind: 'crm.contract', title: 'Lập hợp đồng', fields: [] }),
    search: jest.fn().mockResolvedValue({ items: [] }),
    createPreview: jest.fn().mockResolvedValue({ field: 'quoteId', value: 'q-1', columns: [], rows: [] }),
  };
  return { related, controller: new RelatedObjectsController(related as unknown as RelatedObjectService) };
}

describe('RelatedObjectsController tạo nhanh', () => {
  it('chuyển tiếp token và CSRF của chính phiên người gọi', async () => {
    const { controller, related } = setup();
    await controller.createRecord(
      {
        workspaceActor: actor,
        headers: { authorization: 'Bearer user-token', 'x-csrf-token': 'csrf-1' },
        cookies: { ep_csrf: 'csrf-1' },
      },
      'crm.contract',
      { values: {} },
    );
    expect(related.createRecord).toHaveBeenCalledWith(actor, 'user-token', 'csrf-1', 'crm.contract', { values: {} });
  });

  it('CSRF header không khớp cookie thì không chuyển tiếp', async () => {
    const { controller, related } = setup();
    await controller.createRecord(
      { workspaceActor: actor, headers: { 'x-csrf-token': 'a' }, cookies: { ep_access: 'cookie-token', ep_csrf: 'b' } },
      'crm.contract',
      {},
    );
    expect(related.createRecord).toHaveBeenCalledWith(actor, 'cookie-token', undefined, 'crm.contract', {});
  });

  it('lời từ chối của module gốc giữ mã HTTP, kèm cảnh báo và ô sai', async () => {
    const { controller, related } = setup();
    related.createRecord.mockRejectedValueOnce(
      new RelatedObjectCreateRejectedError('LINKABLE_CONFIRM_REQUIRED', 'Mã số thuế đã có.', 409, ['KH001 - Công ty A'], 'taxCode'),
    );
    const error = (await controller
      .createRecord({ workspaceActor: actor, headers: {} }, 'crm.customer', {})
      .catch((cause) => cause)) as HttpException;
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      code: 'LINKABLE_CONFIRM_REQUIRED',
      message: 'Mã số thuế đã có.',
      warnings: ['KH001 - Công ty A'],
      field: 'taxCode',
    });
  });

  it('tìm kiếm: chỉ gom tham số `f.*` (giá trị chuỗi đơn) làm lọc của ô tham chiếu', async () => {
    const { controller, related } = setup();
    await controller.search(
      { workspaceActor: actor, headers: { authorization: 'Bearer user-token' } },
      'crm.quote',
      'BG',
      undefined,
      { kind: 'crm.quote', q: 'BG', 'f.customerId': 'k-1', 'f.contractLinkable': 'true', 'f.many': ['a', 'b'], other: 'x' },
    );
    expect(related.search).toHaveBeenCalledWith(actor, 'user-token', 'crm.quote', 'BG', undefined, {
      customerId: 'k-1',
      contractLinkable: 'true',
    });
  });

  it('xem trước theo ô: GET dưới token của người gọi', async () => {
    const { controller, related } = setup();
    await controller.createPreview(
      { workspaceActor: actor, headers: { authorization: 'Bearer user-token' } },
      'crm.contract',
      'quoteId',
      'q-1',
    );
    expect(related.createPreview).toHaveBeenCalledWith(actor, 'user-token', 'crm.contract', 'quoteId', 'q-1');
  });

  it('thiếu actor thì 401', async () => {
    const { controller } = setup();
    await expect(controller.createForm({}, 'crm.contract')).rejects.toMatchObject({ status: 401 });
  });
});
