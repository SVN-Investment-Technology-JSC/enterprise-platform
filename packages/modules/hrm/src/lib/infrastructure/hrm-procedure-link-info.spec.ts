import { attachProcedureLinkInfo } from './hrm-procedure-link-info';

describe('attachProcedureLinkInfo', () => {
  it('gắn instance, revision, id và trạng thái đồng bộ của liên kết mới nhất; đơn DIRECT giữ null', async () => {
    const db = {
      query: jest.fn(async () => ({
        rows: [
          { request_id: 'a', id: 'l1', revision: 2, instance_id: 'i1', sync_status: 'RUNNING' },
        ],
      })),
    };
    const result = await attachProcedureLinkInfo(db as never, 't', 'ot', [
      { id: 'a', procedureInstanceId: null },
      { id: 'b', procedureInstanceId: null },
    ]);
    expect(result[0]).toMatchObject({
      procedureInstanceId: 'i1',
      procedureRevision: 2,
      procedureLinkId: 'l1',
      procedureSyncStatus: 'RUNNING',
    });
    expect(result[1]).toMatchObject({
      procedureInstanceId: null,
      procedureRevision: null,
      procedureLinkId: null,
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('danh sách rỗng không truy vấn', async () => {
    const db = { query: jest.fn() };
    expect(await attachProcedureLinkInfo(db as never, 't', 'leave', [])).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
});
