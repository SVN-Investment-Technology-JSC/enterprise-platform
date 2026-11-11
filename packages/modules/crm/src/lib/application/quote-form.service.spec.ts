import { CRM_NO_CAPABILITIES, defaultQuoteLayout, type QuoteTemplateLayout } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import type { QuoteFormStore, QuoteTemplateLayoutWrite } from './quote-form-store.port.js';
import { QuoteFormService } from './quote-form.service.js';

const TEMPLATE_ID = '6c1f1f9e-6a43-4c7e-9a0e-2a9b0b6f7d11';
const SAVED: QuoteTemplateLayout = { layout: null, updatedAt: '2026-11-06T03:00:00.000Z', updatedBy: 'u-admin' };

const actor = (extra: Partial<CrmActor> = {}): CrmActor => ({
  ...CRM_NO_CAPABILITIES,
  tenantId: 't1',
  userId: 'u1',
  displayName: 'Người dùng',
  ...extra,
});
const reader = actor();
const manager = actor({ userId: 'u-admin', canManage: true });

function setup(found = true) {
  const writes: QuoteTemplateLayoutWrite[] = [];
  const store = {
    getTemplateLayout: jest.fn(async () => (found ? SAVED : undefined)),
    saveTemplateLayout: jest.fn(async (_tenantId: string, _id: string, write: QuoteTemplateLayoutWrite) => {
      writes.push(write);
      return found ? { ...SAVED, layout: write.layout } : undefined;
    }),
  } as unknown as QuoteFormStore;
  return { service: new QuoteFormService(store), store, writes };
}

describe('QuoteFormService: bố cục in của mẫu', () => {
  it('đọc bố cục chỉ cần crm.read (guard đã kiểm); id sai dạng hoặc không có: 404 "Không tìm thấy mẫu báo giá."', async () => {
    const { service, store } = setup();
    await expect(service.getLayout(reader, TEMPLATE_ID)).resolves.toEqual(SAVED);
    await expect(service.getLayout(reader, 'khong-phai-uuid')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Không tìm thấy mẫu báo giá.',
    });
    expect(store.getTemplateLayout).toHaveBeenCalledTimes(1);
    await expect(setup(false).service.getLayout(reader, TEMPLATE_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('TC-P3PERM-01: lưu bố cục cần crm.manage; không có thì 403 tiếng Việt, không gọi store', async () => {
    const { service, store } = setup();
    const writer = actor({ canWriteQuote: true, canWriteOpportunity: true });
    for (const who of [reader, writer]) {
      await expect(service.saveLayout(who, TEMPLATE_ID, { layout: defaultQuoteLayout() })).rejects.toMatchObject({
        statusCode: 403,
        message: 'Chỉ quản trị bán hàng mới được thay đổi cấu hình này.',
      });
    }
    expect(store.saveTemplateLayout).not.toHaveBeenCalled();
  });

  it('lưu bản đã chuẩn hoá (bỏ trường lạ) và chỉ đưa số khối, kích thước cho nhật ký', async () => {
    const { service, writes } = setup();
    const layout = defaultQuoteLayout();
    const dirty = { ...layout, script: 'x', blocks: layout.blocks.map((block) => ({ ...block, onclick: 'alert(1)' })) };
    const saved = await service.saveLayout(manager, TEMPLATE_ID, { layout: dirty as never });
    expect(saved.layout).toEqual(layout);
    expect(writes[0]).toEqual({
      layout,
      blockCount: layout.blocks.length,
      sizeBytes: Buffer.byteLength(JSON.stringify(layout)),
    });
    expect(writes[0]).not.toHaveProperty('expectedUpdatedAt');
  });

  it('layout null là xoá; thiếu layout là 400', async () => {
    const { service, writes } = setup();
    await service.saveLayout(manager, TEMPLATE_ID, { layout: null });
    expect(writes[0]).toEqual({ layout: null, blockCount: 0, sizeBytes: 0 });
    await expect(service.saveLayout(manager, TEMPLATE_ID, {} as never)).rejects.toMatchObject({ statusCode: 400, code: 'LAYOUT_INVALID' });
  });

  it('bố cục sai: 400 với mã lỗi đầu tiên và đủ danh sách errors, không gọi store', async () => {
    const { service, store } = setup();
    const error = await service
      .saveLayout(manager, TEMPLATE_ID, { layout: { ...defaultQuoteLayout(), paper: 'A5', blocks: [] } as never })
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      statusCode: 400,
      code: 'LAYOUT_INVALID',
      details: {
        errors: [
          expect.objectContaining({ path: 'paper', code: 'LAYOUT_INVALID' }),
          expect.objectContaining({ path: 'blocks', code: 'LAYOUT_EMPTY' }),
        ],
      },
    });
    await expect(
      service.saveLayout(manager, TEMPLATE_ID, { layout: { ...defaultQuoteLayout(), version: 2 } as never }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'LAYOUT_VERSION_UNSUPPORTED' });
    expect(store.saveTemplateLayout).not.toHaveBeenCalled();
  });

  it('expectedUpdatedAt: chuyển nguyên giá trị (kể cả null) cho store; sai dạng thì 400', async () => {
    const { service, writes } = setup();
    await service.saveLayout(manager, TEMPLATE_ID, { layout: null, expectedUpdatedAt: '2026-11-06T03:00:00.000Z' });
    await service.saveLayout(manager, TEMPLATE_ID, { layout: null, expectedUpdatedAt: null });
    expect(writes.map((write) => write.expectedUpdatedAt)).toEqual(['2026-11-06T03:00:00.000Z', null]);
    await expect(
      service.saveLayout(manager, TEMPLATE_ID, { layout: null, expectedUpdatedAt: 'hôm qua' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID' });
  });

  it('mẫu không có hoặc id sai dạng: 404', async () => {
    await expect(setup(false).service.saveLayout(manager, TEMPLATE_ID, { layout: null })).rejects.toMatchObject({ statusCode: 404 });
    await expect(setup().service.saveLayout(manager, '123', { layout: null })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Không tìm thấy mẫu báo giá.',
    });
  });
});
