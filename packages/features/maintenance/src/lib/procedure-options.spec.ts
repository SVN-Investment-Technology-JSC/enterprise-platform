import type { MaintenanceProcedureCatalogEntry } from '@enterprise-platform/contracts-maintenance';
import { procedureOptionsKeepingInUse, selectableProcedures } from './procedure-options';

const entry = (definitionId: string, status: 'published' | 'archived'): MaintenanceProcedureCatalogEntry => ({
  definitionId,
  code: definitionId.toUpperCase(),
  name: 'Quy trình ' + definitionId,
  versionNumber: 1,
  status,
  synchronizedAt: '2026-11-11T00:00:00.000Z',
});

describe('procedure options', () => {
  const catalog = [entry('a', 'published'), entry('b', 'archived')];

  it('chỉ cho chọn quy trình đang công bố', () => {
    expect(selectableProcedures(catalog).map((item) => item.definitionId)).toEqual(['a']);
    expect(selectableProcedures(undefined)).toEqual([]);
  });

  it('quy trình đã ngừng dùng chỉ hiện khi còn hàng đang gắn, kèm nhãn', () => {
    expect(procedureOptionsKeepingInUse(catalog, new Set()).map((o) => o.value)).toEqual(['a']);
    const withB = procedureOptionsKeepingInUse(catalog, new Set(['b']));
    expect(withB.map((o) => o.value)).toEqual(['a', 'b']);
    expect(withB[1].label).toContain('(không còn dùng)');
  });
});
