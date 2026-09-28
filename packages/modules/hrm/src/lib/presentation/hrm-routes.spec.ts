import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));
jest.mock('../infrastructure/hrm-procedure-bridge.service.js', () => ({ HrmProcedureBridgeService: class {} }));

/** Read the same decorator metadata Nest uses to register HTTP handlers. */
function registeredRoutes() {
  const routes: string[] = [];
  for (const file of readdirSync(__dirname).filter((f) => f.endsWith('.controller.ts'))) {
    const exports = require(`./${file}`) as Record<string, { prototype?: object }>;
    for (const controller of Object.values(exports)) {
      if (typeof controller !== 'function' || !controller.prototype) continue;
      const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
      if (prefix === undefined) continue;
      for (const key of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = Object.getOwnPropertyDescriptor(controller.prototype, key)?.value;
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (method === undefined) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        routes.push(`${RequestMethod[method]} ${[prefix, path].join('/').replace(/\/+$/g, '').replace(/\/+/g, '/')}`);
      }
    }
  }
  return routes;
}

describe('HRM HTTP route registration after integration', () => {
  it('exposes the leave submission endpoint', () => {
    expect(registeredRoutes()).toContain('POST v1/leave-requests');
  });
  it('keeps one handler per method and route', () => {
    const routes = registeredRoutes();
    expect(routes.filter((route, i) => routes.indexOf(route) !== i)).toEqual([]);
  });
});
