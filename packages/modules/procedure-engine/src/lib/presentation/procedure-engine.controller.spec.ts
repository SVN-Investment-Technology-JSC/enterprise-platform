import { HttpException } from '@nestjs/common';
import type { ProcedureAttachmentService } from '../application/procedure-attachment.service.js';
import type { ProcedureEngineApplication } from '../application/procedure-engine.application.js';
import { ProcedureEngineError } from '../domain/procedure-engine.error.js';
import { ProcedureEngineController } from './procedure-engine.controller.js';

describe('PUT internal/instances/:id/source-summary', () => {
  const update = jest.fn();
  const controller = new ProcedureEngineController(
    { updateSourceSummaryForService: update } as unknown as ProcedureEngineApplication,
    {} as ProcedureAttachmentService,
  );
  const request = { headers: { 'x-tenant-id': 'tenant-1' } };

  beforeEach(() => update.mockReset());

  const status = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      return { status: (error as HttpException).getStatus(), body: (error as HttpException).getResponse() };
    }
    throw new Error('Expected an HttpException');
  };

  it('TC-TSK-03: chuyển body cho application theo tenant ở x-tenant-id; null là xoá', async () => {
    update.mockResolvedValue({ id: 'i-1', sourceSummary: null });
    await expect(controller.internalUpdateSourceSummary(request, 'i-1', { sourceSummary: null })).resolves.toEqual({
      id: 'i-1',
      sourceSummary: null,
    });
    expect(update).toHaveBeenCalledWith('tenant-1', 'i-1', null);
  });

  it('TC-TSK-03: thiếu trường sourceSummary trả 400, không hiểu ngầm là xoá', async () => {
    const result = await status(controller.internalUpdateSourceSummary(request, 'i-1', {}));
    expect(result.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('TC-TSK-03: lỗi kiểm thông tin nguồn thành 400, không thấy hồ sơ thành 404', async () => {
    update.mockRejectedValueOnce(new ProcedureEngineError('validation', 'Dòng 1: thiếu nhãn.'));
    expect(await status(controller.internalUpdateSourceSummary(request, 'i-1', { sourceSummary: {} }))).toEqual({
      status: 400,
      body: { statusCode: 400, message: 'Dòng 1: thiếu nhãn.', error: 'validation' },
    });
    update.mockRejectedValueOnce(new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.'));
    expect((await status(controller.internalUpdateSourceSummary(request, 'missing', { sourceSummary: null }))).status).toBe(404);
  });

  it('thiếu x-tenant-id trả 400', () => {
    expect(() => controller.internalUpdateSourceSummary({ headers: {} }, 'i-1', { sourceSummary: null })).toThrow(HttpException);
  });
});
