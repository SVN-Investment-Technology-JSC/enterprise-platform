import { lowStockNotificationEvent } from './inventory-notification-events.js';

describe('lowStockNotificationEvent', () => {
  it('emits a permission-routed event with stable material facts', () => {
    expect(
      lowStockNotificationEvent({
        alertId: '60000000-0000-4000-8000-000000000099',
        materialId: '60000000-0000-4000-8000-000000000001',
        materialCode: 'VT-001',
        materialName: 'Vòng bi',
        available: 3,
        minimum: 5,
      }),
    ).toEqual({
      type: 'inventory.stock.low',
      aggregateType: 'inventory-material',
      aggregateId: '60000000-0000-4000-8000-000000000001',
      payload: {
        sourceId: '60000000-0000-4000-8000-000000000099',
        sourceType: 'inventory_material',
        materialId: '60000000-0000-4000-8000-000000000001',
        materialCode: 'VT-001',
        materialName: 'Vòng bi',
        available: 3,
        minimum: 5,
        summary: 'Vòng bi (VT-001) còn 3, dưới mức tối thiểu 5.',
        deepLink: '/inventory/materials/60000000-0000-4000-8000-000000000001',
      },
    });
  });
});
