import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { TENANT_PERMISSION_ACTIONS } from '@enterprise-platform/contracts-identity';
import {
  HRM_PUBLIC_ROUTE,
  HRM_REQUIRED_PERMISSION,
} from '../infrastructure/hrm-access.guard.js';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));
jest.mock('../infrastructure/hrm-procedure-bridge.service.js', () => ({ HrmProcedureBridgeService: class {} }));

interface RouteInfo {
  route: string;
  handler: string;
  permission?: string;
  isPublic: boolean;
}

/** Đọc đúng metadata mà Nest dùng để đăng ký route và HrmAccessGuard dùng để kiểm quyền. */
function hrmRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const file of readdirSync(__dirname).filter((f) => f.endsWith('.controller.ts'))) {
    const exports = require(`./${file}`) as Record<string, { prototype?: object; name?: string }>;
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
        routes.push({
          route: `${RequestMethod[method]} ${[prefix, path].join('/').replace(/\/+$/g, '').replace(/\/+/g, '/')}`,
          handler: `${controller.name}.${key}`,
          permission:
            Reflect.getMetadata(HRM_REQUIRED_PERMISSION, handler) ??
            Reflect.getMetadata(HRM_REQUIRED_PERMISSION, controller),
          isPublic: Boolean(
            Reflect.getMetadata(HRM_PUBLIC_ROUTE, handler) ?? Reflect.getMetadata(HRM_PUBLIC_ROUTE, controller),
          ),
        });
      }
    }
  }
  return routes;
}

describe('HRM: mọi route khai báo quyền (SEC-BE019-01)', () => {
  const routes = hrmRoutes();
  const byHandler = new Map(routes.map((r) => [r.handler, r]));

  it('quét được toàn bộ controller HRM', () => {
    expect(routes.length).toBeGreaterThan(300);
    expect(routes.every((r) => r.handler.startsWith('Hrm'))).toBe(true);
  });

  it('mọi handler có @RequirePermission hoặc @HrmPublicRoute', () => {
    const missing = routes.filter((r) => !r.permission && !r.isPublic).map((r) => `${r.handler} (${r.route})`);
    expect(missing).toEqual([]);
  });

  it('quyền khai báo là action có trong TENANT_PERMISSION_ACTIONS', () => {
    const known = new Set<string>(TENANT_PERMISSION_ACTIONS.map((a) => a.key));
    const unknown = routes.filter((r) => r.permission && !known.has(r.permission)).map((r) => r.handler);
    expect(unknown).toEqual([]);
  });

  it('route công khai chỉ là route nội bộ (service token) và capabilities', () => {
    const publicRoutes = routes.filter((r) => r.isPublic).map((r) => r.route);
    expect(publicRoutes.every((r) => r.startsWith('GET v1/internal/') || r === 'GET v1/capabilities')).toBe(true);
  });

  it('khai báo khớp điều kiện thật của handler (SEC-BE019-03)', () => {
    // Hủy quyết định: người lập hoặc người duyệt, handler đòi hrm.appointment.read rồi kiểm tiếp.
    expect(byHandler.get('HrmPersonnelDecisionController.cancel')?.permission).toBe('hrm.appointment.read');
    // Cấu hình tách nhiệm vụ lương: người xem lương HOẶC người cấu hình lương.
    expect(byHandler.get('HrmPayrollSodController.get')?.permission).toBe('hrm.read');
    // Duyệt tạm ứng: người được giao đúng đơn vẫn vào được khi không có hrm.request.approve.
    expect(byHandler.get('HrmSalaryController.approveAdvance')?.permission).toBe('hrm.read');
    // Tuyến báo cáo: người có hrm.employee.read không cần quyền tự phục vụ.
    expect(byHandler.get('HrmPersonnelDecisionController.reportingLines')?.permission).toBe('hrm.read');
  });

  it('route nhạy cảm đòi đúng quyền nghiệp vụ', () => {
    const expected: Record<string, string> = {
      'HrmPayrollController.listItems': 'hrm.payroll.read',
      'HrmPayrollController.exportRun': 'hrm.payroll.export',
      'HrmPayrollSettingsController.totals': 'hrm.payroll.read',
      'HrmPayrollSettingsController.payment': 'hrm.payroll.pay',
      'HrmSalaryController.listGrades': 'hrm.salary.read',
      'HrmSalaryController.createEmployeeSalaryProfile': 'hrm.salary.manage',
      'HrmEmployeeController.listEmployees': 'hrm.employee.read',
      'HrmEmployeeController.updateEmployeeProfile': 'hrm.employee.manage',
      'HrmPersonnelDecisionController.approve': 'hrm.appointment.approve',
      'HrmPolicyController.listPolicies': 'hrm.manage',
    };
    for (const [handler, permission] of Object.entries(expected))
      expect([handler, byHandler.get(handler)?.permission]).toEqual([handler, permission]);
  });

  it('đã bỏ endpoint nộp đơn sửa công không làm gì (SEC-BE019-08)', () => {
    expect(routes.map((r) => r.route)).not.toContain('POST v1/attendance-corrections/:id/submit');
  });
});
