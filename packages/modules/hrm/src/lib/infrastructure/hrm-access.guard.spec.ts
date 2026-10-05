jest.mock('./hrm-context.service', () => ({ HrmContextService: class HrmContextService {} }));
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  HrmAccessGuard,
  HrmPublicRoute,
  RequirePermission,
  hrmAccessGuardMode,
} from './hrm-access.guard';

class HrmDemoController {
  declared() {
    return 1;
  }
  undeclared() {
    return 2;
  }
  open() {
    return 3;
  }
}
const descriptor = (name: 'declared' | 'open') =>
  Object.getOwnPropertyDescriptor(
    HrmDemoController.prototype,
    name,
  ) as PropertyDescriptor;
RequirePermission('hrm.payroll.read')(
  HrmDemoController.prototype,
  'declared',
  descriptor('declared'),
);
HrmPublicRoute()(HrmDemoController.prototype, 'open', descriptor('open'));
class OtherController {
  x() {
    return 1;
  }
}

const ctxFor = (cls: unknown, handler: () => unknown) =>
  ({
    getType: () => 'http',
    getClass: () => cls,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({}) }),
  }) as unknown as ExecutionContext;

describe('HrmAccessGuard', () => {
  const original = process.env.HRM_ACCESS_GUARD_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.HRM_ACCESS_GUARD_MODE;
    else process.env.HRM_ACCESS_GUARD_MODE = original;
  });
  const make = () => {
    const getContext = jest.fn().mockResolvedValue({});
    const guard = new HrmAccessGuard(new Reflector(), { getContext } as never);
    const warn = jest
      .spyOn(
        (guard as never as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    return { guard, getContext, warn };
  };

  it('defaults to audit mode', () => {
    delete process.env.HRM_ACCESS_GUARD_MODE;
    expect(hrmAccessGuardMode()).toBe('audit');
    expect(hrmAccessGuardMode({ HRM_ACCESS_GUARD_MODE: 'bogus' })).toBe(
      'audit',
    );
  });

  it('audit: warns once for undeclared routes and never blocks', async () => {
    delete process.env.HRM_ACCESS_GUARD_MODE;
    const { guard, warn, getContext } = make();
    const c = ctxFor(HrmDemoController, HrmDemoController.prototype.undeclared);
    await expect(guard.canActivate(c)).resolves.toBe(true);
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    await expect(
      guard.canActivate(
        ctxFor(HrmDemoController, HrmDemoController.prototype.declared),
      ),
    ).resolves.toBe(true);
    expect(getContext).not.toHaveBeenCalled();
  });

  it('enforce: rejects undeclared routes, checks declared ones, allows public', async () => {
    process.env.HRM_ACCESS_GUARD_MODE = 'enforce';
    const { guard, getContext } = make();
    await expect(
      guard.canActivate(
        ctxFor(HrmDemoController, HrmDemoController.prototype.undeclared),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        ctxFor(HrmDemoController, HrmDemoController.prototype.declared),
      ),
    ).resolves.toBe(true);
    expect(getContext).toHaveBeenCalledWith({}, 'hrm.payroll.read');
    getContext.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      guard.canActivate(
        ctxFor(HrmDemoController, HrmDemoController.prototype.declared),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        ctxFor(HrmDemoController, HrmDemoController.prototype.open),
      ),
    ).resolves.toBe(true);
  });

  it('ignores controllers outside HRM', async () => {
    process.env.HRM_ACCESS_GUARD_MODE = 'enforce';
    const { guard } = make();
    await expect(
      guard.canActivate(ctxFor(OtherController, OtherController.prototype.x)),
    ).resolves.toBe(true);
  });
});
