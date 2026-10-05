import {
  HRM_ROLE_TEMPLATES,
  TENANT_PERMISSION_ACTIONS,
  invalidHrmTemplateActions,
} from '@enterprise-platform/contracts-identity';
import { TenantAuthorizationService, hrmTemplateId } from './tenant-authorization';

describe('HRM role templates', () => {
  it('only references valid actions, without duplicates', () => {
    expect(invalidHrmTemplateActions()).toEqual([]);
    const valid = new Set<string>(TENANT_PERMISSION_ACTIONS.map((a) => a.key));
    for (const t of HRM_ROLE_TEMPLATES) {
      expect(t.actions.length).toBeGreaterThan(0);
      expect(new Set(t.actions).size).toBe(t.actions.length);
      t.actions.forEach((a) => expect(valid.has(a)).toBe(true));
    }
    const keys = HRM_ROLE_TEMPLATES.map((t) => t.key);
    const names = HRM_ROLE_TEMPLATES.map((t) => t.name);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
    expect(HRM_ROLE_TEMPLATES).toHaveLength(9);
  });

  it('keeps payroll duties separated', () => {
    const has = (key: string, a: string) =>
      HRM_ROLE_TEMPLATES.find((t) => t.key === key)?.actions.includes(a);
    expect(has('comp-ben', 'hrm.payroll.finalize')).toBe(false);
    expect(has('payroll-approver', 'hrm.payroll.calculate')).toBe(false);
    expect(has('payroll-accountant', 'hrm.payroll.finalize')).toBe(false);
  });

  it('generates stable distinct ids', () => {
    expect(hrmTemplateId('role', 'employee')).toBe(hrmTemplateId('role', 'employee'));
    expect(hrmTemplateId('role', 'employee')).not.toBe(hrmTemplateId('permission', 'employee'));
    expect(hrmTemplateId('role', 'employee')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('seedHrmRoleTemplates idempotency', () => {
  it('creates once and skips on the second run', async () => {
    const existing = new Set<string>();
    const service = new TenantAuthorizationService(async () => {
      throw new Error('unused');
    });
    jest.spyOn(service, 'mutate').mockImplementation(async (_t, _a, op) =>
      op({
        query: async (sql: string, params: unknown[] = []) => {
          if (sql.includes('INSERT INTO core_schema.roles')) {
            const id = params[0] as string;
            if (existing.has(id)) return { rowCount: 0, rows: [] };
            existing.add(id);
            return { rowCount: 1, rows: [] };
          }
          return { rowCount: 1, rows: [] };
        },
      } as never),
    );
    const first = await service.seedHrmRoleTemplates('t', 'a');
    expect(first.created).toHaveLength(HRM_ROLE_TEMPLATES.length);
    const second = await service.seedHrmRoleTemplates('t', 'a');
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toHaveLength(HRM_ROLE_TEMPLATES.length);
  });
});
