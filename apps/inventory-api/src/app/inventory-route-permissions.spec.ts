import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { InventoryModule } from '@enterprise-platform/module-inventory';
import { HealthController } from './health.controller';
import { InventoryDataImportController } from './inventory-data-import.controller';
import {
  INVENTORY_ROUTE_RULES,
  normalizeInventoryPath,
  resolveInventoryRoute,
} from './inventory-route-permissions';

type Controller = abstract new (...args: never[]) => unknown;

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [value === undefined ? '' : String(value)];
}

/** Mọi route khai trong controller của Inventory API, đọc từ metadata Nest. */
function declaredRoutes(): { method: string; path: string }[] {
  const controllers: Controller[] = [
    ...(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, InventoryModule) as Controller[]),
    InventoryDataImportController,
  ];
  const routes: { method: string; path: string }[] = [];
  for (const controller of controllers) {
    const prefixes = asList(Reflect.getMetadata(PATH_METADATA, controller));
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      for (const prefix of prefixes) {
        for (const path of asList(Reflect.getMetadata(PATH_METADATA, handler))) {
          routes.push({ method: RequestMethod[method], path: normalizeInventoryPath(`${prefix}/${path}`) });
        }
      }
    }
  }
  return routes;
}

describe('INVENTORY_ROUTE_RULES', () => {
  const routes = declaredRoutes();

  it('đọc được route từ metadata (kiểm tra chính bài test)', () => {
    expect(routes.length).toBeGreaterThan(80);
    expect(routes).toContainEqual({ method: 'POST', path: '/v1/movements/batch' });
  });

  // SEC-BE046-01: mọi route có ánh xạ quyền; thiếu dòng thì test đỏ.
  it.each(routes.map((route) => [route.method, route.path]))('%s %s có dòng khớp đúng trong bảng quyền', (method, path) => {
    const rule = resolveInventoryRoute(method, `/api/inventory${path}`);
    expect(rule).toMatchObject({ method, path });
  });

  it('bảng không có dòng thừa hay trùng', () => {
    const declared = new Set(routes.map((route) => `${route.method} ${route.path}`));
    const keys = INVENTORY_ROUTE_RULES.map((rule) => `${rule.method} ${rule.path}`);
    expect(keys.filter((key) => !declared.has(key))).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('route nội bộ là route service, route người dùng không phải', () => {
    for (const rule of INVENTORY_ROUTE_RULES) {
      expect(rule.permission === 'service').toBe(rule.path.startsWith('/v1/internal/'));
    }
  });

  it('GET chỉ cần quyền đọc, route ghi không bao giờ chỉ cần quyền đọc', () => {
    for (const rule of INVENTORY_ROUTE_RULES) {
      if (rule.permission === 'service') continue;
      expect(rule.permission === 'inventory.read').toBe(rule.method === 'GET');
    }
  });

  it('health không đi qua bảng (guard cho qua trước)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, HealthController)).toBe('health');
  });

  // SEC-BE046-02: đường dẫn chứa chuỗi con của route khác lấy đúng quyền của chính nó.
  it('khớp đúng đoạn, không theo chuỗi con', () => {
    expect(resolveInventoryRoute('POST', '/api/inventory/v1/movements/batch')?.permission).toBe(
      'inventory.transaction.write',
    );
    expect(resolveInventoryRoute('PUT', '/api/inventory/v1/settings/documents.approval')?.permission).toBe(
      'inventory.manage',
    );
    expect(resolveInventoryRoute('POST', '/api/inventory/v1/assets/issues/documents')?.permission).toBe(
      'inventory.manage',
    );
    expect(resolveInventoryRoute('POST', '/api/inventory/v1/stock-documents/abc/approve')?.permission).toBe(
      'inventory.document.approve',
    );
    expect(resolveInventoryRoute('GET', '/api/inventory/v1/warehouses/all')?.path).toBe('/v1/warehouses/all');
    expect(resolveInventoryRoute('GET', '/api/inventory/v1/warehouses/K1')?.path).toBe('/v1/warehouses/:code');
    expect(resolveInventoryRoute('HEAD', '/api/inventory/v1/materials/')?.path).toBe('/v1/materials');
  });

  it('route không khai báo không có dòng khớp', () => {
    expect(resolveInventoryRoute('POST', '/api/inventory/v1/receipts/extra')).toBeUndefined();
    expect(resolveInventoryRoute('DELETE', '/api/inventory/v1/receipts')).toBeUndefined();
    expect(resolveInventoryRoute('POST', '/api/inventory/v1/new-feature')).toBeUndefined();
    expect(resolveInventoryRoute('GET', '/api/inventory/v2/materials')).toBeUndefined();
  });
});
