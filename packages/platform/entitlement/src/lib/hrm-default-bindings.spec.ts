import {
  HRM_REQUEST_KINDS,
  seedHrmDirectBindings,
} from './tenant-provisioning.processor';

describe('seedHrmDirectBindings', () => {
  it('chèn đủ 7 loại đơn DIRECT cho đúng tenant, chỉ khi chưa có binding mặc định', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 7 });
    const inserted = await seedHrmDirectBindings({ query }, 'tenant-1');
    expect(inserted).toBe(7);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("'DIRECT'");
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('sub_type_code IS NULL');
    expect(values).toEqual(['tenant-1', [...HRM_REQUEST_KINDS]]);
    expect(HRM_REQUEST_KINDS).toHaveLength(7);
  });
});
