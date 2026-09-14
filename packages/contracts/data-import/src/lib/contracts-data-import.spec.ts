import {
  dataImportRowCounts,
  emptyDataImportDataset,
  requiredDataImportModules,
} from './contracts-data-import.js';

describe('data import contracts', () => {
  it('starts with a stable empty dataset shape', () => {
    const dataset = emptyDataImportDataset();

    expect(new Set(Object.values(dataImportRowCounts(dataset)))).toEqual(
      new Set([0]),
    );
    expect(requiredDataImportModules(dataset)).toEqual([]);
  });

  it('derives required modules from populated sections', () => {
    const dataset = {
      ...emptyDataImportDataset(),
      inventoryMaterials: [
        {
          code: 'VT-01',
          name: 'Vật tư',
          category: 'SPARE_PART' as const,
          unit: 'Cái',
        },
      ],
      maintenanceSchedules: [
        {
          assetCode: 'TB-01',
          frequency: 'month' as const,
        },
      ],
    };

    expect(requiredDataImportModules(dataset)).toEqual([
      'inventory',
      'maintenance',
    ]);
  });
});
