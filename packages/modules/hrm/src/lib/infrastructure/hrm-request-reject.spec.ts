import { ConflictException, NotFoundException } from '@nestjs/common';
import { REQUEST_NOT_PENDING, throwWhyNotRejectable } from './hrm-request-reject.js';

const NOT_FOUND = { code: 'HRM_OT_NOT_FOUND', message: 'Không tìm thấy đơn' };

describe('throwWhyNotRejectable', () => {
  it('đơn không tồn tại: 404', async () => {
    const db = { query: jest.fn(async () => ({ rows: [] })) };
    await expect(throwWhyNotRejectable(db as never, 'ot_requests', 't', 'id', NOT_FOUND)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đơn đã xử lý: 409 kèm mã HRM_REQUEST_NOT_PENDING', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ status: 'APPROVED' }] })) };
    const error = await throwWhyNotRejectable(db as never, 'attendance_corrections', 't', 'id', NOT_FOUND).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: REQUEST_NOT_PENDING });
  });
});

describe('rejectionNote', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { rejectionNote, REJECT_REASON_REQUIRED } = require('./hrm-validation.js') as typeof import('./hrm-validation.js');

  it('bắt buộc có lý do: thiếu, rỗng hoặc toàn khoảng trắng bị từ chối 400', () => {
    for (const bad of [undefined, null, '', '   ']) {
      try {
        rejectionNote(bad);
        throw new Error('phải ném lỗi');
      } catch (error) {
        expect((error as { getResponse(): unknown }).getResponse()).toMatchObject({ code: REJECT_REASON_REQUIRED });
      }
    }
  });

  it('có lý do thì trả về đã cắt khoảng trắng', () => {
    expect(rejectionNote('  Trùng lịch  ')).toBe('Trùng lịch');
  });

  it('không còn lối từ chối nhanh: gửi cờ quick cũng không bỏ được yêu cầu lý do', () => {
    expect(() => (rejectionNote as (reason: unknown, quick?: unknown) => unknown)('', true)).toThrow();
  });
});
