import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { HrmEmployeeController } from './hrm-employee.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));

const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111';
const req = { headers: {} } as Request;

function setup(query: jest.Mock) {
  const pool = { query };
  const ctx = {
    getRequestContext: jest.fn().mockResolvedValue({ pool, tenantId: 'tenant-a' }),
    getContext: jest.fn().mockResolvedValue({ pool, tenantId: 'tenant-a', principal: { userId: 'user-a' } }),
  };
  return { ctx, controller: new HrmEmployeeController(ctx as never) };
}

describe('Lịch sử công tác của nhân viên (ISS-BE-050)', () => {
  it('không có quyền: trả 403, không đọc DB (SEC-BE050-01)', async () => {
    const query = jest.fn();
    const { ctx, controller } = setup(query);
    ctx.getRequestContext.mockRejectedValue(new ForbiddenException());
    await expect(controller.getCareerHistory(req, EMPLOYEE_ID)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.getRequestContext).toHaveBeenCalledWith(req, EMPLOYEE_ID, 'hrm.employee.read', 'hrm.self.read');
    expect(query).not.toHaveBeenCalled();
  });

  it('lỗi DB thật: ném lỗi (500), không trả danh sách rỗng (SEC-BE050-02)', async () => {
    const failure = new Error('connection terminated');
    const { controller } = setup(jest.fn().mockRejectedValue(failure));
    await expect(controller.getCareerHistory(req, EMPLOYEE_ID)).rejects.toBe(failure);
  });

  it('nhân viên không tồn tại: 404', async () => {
    const { controller } = setup(jest.fn().mockResolvedValue({ rows: [] }));
    const error = await controller.getCareerHistory(req, EMPLOYEE_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      code: 'HRM_EMPLOYEE_NOT_FOUND',
      message: 'Không tìm thấy nhân viên',
    });
  });

  it('có dữ liệu: trả lịch sử theo user_id liên kết', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-b' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            assignment_id: 'a1',
            position_node_id: 'p1',
            position_name: 'Kế toán viên',
            position_code: null,
            unit_node_id: null,
            unit_name: null,
            is_primary: true,
            start_date: '2025-01-02',
            end_date: null,
            status: 'active',
            note: null,
          },
        ],
      });
    const { controller } = setup(query);
    const result = await controller.getCareerHistory(req, EMPLOYEE_ID);
    expect(query.mock.calls[1][1]).toEqual([EMPLOYEE_ID, 'user-b']);
    expect(result.data).toEqual([
      {
        assignmentId: 'a1',
        positionNodeId: 'p1',
        positionName: 'Kế toán viên',
        positionCode: '',
        unitNodeId: null,
        unitName: 'Hội đồng / Trực thuộc doanh nghiệp',
        isPrimary: true,
        startDate: '2025-01-02',
        endDate: null,
        status: 'active',
        note: null,
      },
    ]);
  });

  it('lịch sử của chính mình: lỗi DB không bị nuốt, chưa liên kết nhân viên thì rỗng', async () => {
    const failure = new Error('relation does not exist');
    const failing = setup(jest.fn().mockRejectedValue(failure));
    await expect(failing.controller.getMyCareerHistory(req)).rejects.toBe(failure);

    const unlinked = setup(jest.fn().mockResolvedValue({ rows: [] }));
    await expect(unlinked.controller.getMyCareerHistory(req)).resolves.toEqual({ data: [] });
  });
});
