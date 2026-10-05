import { loadSubtypeCatalog } from './hrm-subtype-catalog';

describe('loadSubtypeCatalog', () => {
  it('gom loại phép của tenant cùng loại OT và công tác cố định', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        { code: 'AL', name: 'Phép năm' },
        { code: 'SL', name: 'Nghỉ ốm' },
      ],
    });
    const catalog = await loadSubtypeCatalog({ query }, 'tenant-1');
    expect(query.mock.calls[0][1]).toEqual(['tenant-1']);
    expect(catalog.LEAVE).toEqual([
      { value: 'AL', label: 'AL · Phép năm' },
      { value: 'SL', label: 'SL · Nghỉ ốm' },
    ]);
    expect(catalog.OT.map((o) => o.value)).toEqual([
      'WEEKDAY',
      'WEEKEND',
      'HOLIDAY',
      'NIGHT',
    ]);
    expect(catalog.BUSINESS_TRIP.map((o) => o.value)).toEqual([
      'DOMESTIC',
      'OVERSEAS',
      'INTERSITE',
    ]);
  });
});
