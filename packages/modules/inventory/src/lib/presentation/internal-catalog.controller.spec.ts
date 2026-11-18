import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { AssetDocumentService } from '../application/asset-document.service.js';
import { InventoryApplication, type InventoryActor } from '../application/inventory.application.js';
import type { InventoryStore } from '../application/inventory-store.port.js';
import type { StockDocumentStore } from '../application/stock-document-store.port.js';
import { InventoryModule } from '../inventory.module.js';
import { InternalCatalogController } from './internal-catalog.controller.js';
import { InventoryController } from './inventory.controller.js';

const service: InventoryActor = {
  tenantId: 't1',
  userId: '00000000-0000-4000-8000-000000000002',
  displayName: 'Hệ thống',
  canManage: false,
  canWriteTransactions: false,
};

const FINGERPRINT = { count: 2, fingerprint: '0123456789abcdef0123456789abcdef' };

function fakeStore() {
  const material = {
    catalog: jest.fn().mockResolvedValue([]),
    catalogFingerprint: jest.fn().mockResolvedValue(FINGERPRINT),
    findByCode: jest.fn().mockResolvedValue({ code: 'M1', name: 'Vật tư', unit: 'Cái', isActive: true }),
  };
  return { material };
}

function controllerWith(store: ReturnType<typeof fakeStore>) {
  return new InternalCatalogController(
    new InventoryApplication(store as unknown as InventoryStore, {} as StockDocumentStore),
  );
}

async function rejection(promise: Promise<unknown>): Promise<{ getStatus(): number; getResponse(): unknown }> {
  try {
    await promise;
  } catch (error) {
    return error as { getStatus(): number; getResponse(): unknown };
  }
  throw new Error('expected rejection');
}

describe('InternalCatalogController GET internal/materials/fingerprint', () => {
  it('không truyền kind thì tính trên cả hàng hoá và dịch vụ, trả { count, fingerprint }', async () => {
    const store = fakeStore();
    const result = await controllerWith(store).materialsFingerprint({ inventoryActor: service });

    expect(result).toEqual(FINGERPRINT);
    expect(store.material.catalogFingerprint).toHaveBeenCalledWith('t1', ['STOCK', 'SERVICE']);
  });

  it('nhận danh sách kind cách nhau bằng dấu phẩy, bỏ phần tử rỗng và trùng', async () => {
    const store = fakeStore();
    await controllerWith(store).materialsFingerprint({ inventoryActor: service }, ' SERVICE, ,SERVICE');

    expect(store.material.catalogFingerprint).toHaveBeenCalledWith('t1', ['SERVICE']);
  });

  it('A9.5: kind không hợp lệ thì 400, không chạm DB', async () => {
    const store = fakeStore();
    const error = await rejection(
      controllerWith(store).materialsFingerprint({ inventoryActor: service }, 'STOCK,ASSET'),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ code: 'VALIDATION', message: 'Loại mặt hàng phải là hàng hoá hoặc dịch vụ.' });
    expect(store.material.catalogFingerprint).not.toHaveBeenCalled();
  });

  it('A9.6: thiếu actor dịch vụ (guard chưa xác thực) thì 401', async () => {
    const store = fakeStore();
    const error = await rejection(controllerWith(store).materialsFingerprint({}));

    expect(error.getStatus()).toBe(401);
    expect(store.material.catalogFingerprint).not.toHaveBeenCalled();
  });
});

describe('InternalCatalogController GET internal/materials includeInactive', () => {
  it('A9.7: không truyền tham số thì giữ hành vi cũ: chỉ STOCK, không kèm includeInactive', async () => {
    const store = fakeStore();
    await controllerWith(store).listMaterials({ inventoryActor: service });

    const [, query] = store.material.catalog.mock.calls[0];
    expect(query.kinds).toEqual(['STOCK']);
    expect(query.includeInactive).toBeUndefined();
  });

  it('A9.7: includeInactive=true được chuyển xuống store; giá trị khác bị bỏ qua', async () => {
    const store = fakeStore();
    const controller = controllerWith(store);
    const call = (includeInactive?: string) =>
      controller.listMaterials(
        { inventoryActor: service },
        undefined,
        undefined,
        undefined,
        undefined,
        'STOCK,SERVICE',
        '500',
        undefined,
        undefined,
        includeInactive,
      );

    await call('true');
    await call('1');
    expect(store.material.catalog.mock.calls[0][1]).toMatchObject({
      kinds: ['STOCK', 'SERVICE'],
      includeInactive: true,
      limit: 500,
    });
    expect(store.material.catalog.mock.calls[1][1].includeInactive).toBeUndefined();
  });
});

describe('Định tuyến internal/materials/fingerprint', () => {
  let app: NestExpressApplication;
  let base: string;
  const store = fakeStore();

  beforeAll(async () => {
    // Giữ đúng thứ tự controller của InventoryModule: Express khớp route theo thứ tự đăng ký.
    const registered = Reflect.getMetadata('controllers', InventoryModule) as unknown[];
    const controllers = registered.filter(
      (controller) => controller === InternalCatalogController || controller === InventoryController,
    ) as (typeof InternalCatalogController | typeof InventoryController)[];
    const moduleRef = await Test.createTestingModule({
      controllers,
      providers: [
        {
          provide: InventoryApplication,
          useValue: new InventoryApplication(store as unknown as InventoryStore, {} as StockDocumentStore),
        },
        { provide: AssetDocumentService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use((request: { inventoryActor?: InventoryActor }, _response: unknown, next: () => void) => {
      request.inventoryActor = service;
      next();
    });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}/v1`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('InventoryModule đăng ký InternalCatalogController trước InventoryController', () => {
    const registered = Reflect.getMetadata('controllers', InventoryModule) as unknown[];
    expect(registered.indexOf(InternalCatalogController)).toBeLessThan(registered.indexOf(InventoryController));
  });

  it('fingerprint không bị internal/materials/:code nuốt; route theo mã vẫn chạy', async () => {
    const fingerprint = await fetch(`${base}/internal/materials/fingerprint?kind=STOCK,SERVICE`);
    expect(fingerprint.status).toBe(200);
    expect(await fingerprint.json()).toEqual(FINGERPRINT);
    expect(store.material.findByCode).not.toHaveBeenCalled();

    const byCode = await fetch(`${base}/internal/materials/M1`);
    expect(byCode.status).toBe(200);
    expect(await byCode.json()).toEqual({ code: 'M1', name: 'Vật tư', unit: 'Cái', isActive: true });
  });

  it('A9.5: kind không hợp lệ qua HTTP trả 400', async () => {
    const response = await fetch(`${base}/internal/materials/fingerprint?kind=ASSET`);
    expect(response.status).toBe(400);
  });
});
