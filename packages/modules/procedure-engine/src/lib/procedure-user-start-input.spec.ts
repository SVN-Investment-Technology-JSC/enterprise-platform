import { userStartInput } from './presentation/procedure-engine.controller.js';

type Input = Parameters<typeof userStartInput>[0];

describe('mở hồ sơ từ người dùng (POST v1/instances) luôn là nguồn manual', () => {
  it('bỏ nguồn khác manual người dùng tự khai, để không lách được luật bắt buộc chọn dự án', () => {
    const result = userStartInput({
      definitionId: 'd-1',
      title: 'Thanh toán',
      sourceType: 'hrm_request',
      sourceId: 'x-1',
    } as unknown as Input) as unknown as Record<string, unknown>;
    expect(result).toEqual({ definitionId: 'd-1', title: 'Thanh toán' });
  });

  it('giữ nguyên đầu vào bình thường (không khai nguồn, hoặc khai manual)', () => {
    const plain = { definitionId: 'd-1', title: 'A' } as unknown as Input;
    expect(userStartInput(plain)).toEqual(plain);
    expect(userStartInput({ definitionId: 'd-1', sourceType: 'manual' } as unknown as Input)).toEqual({
      definitionId: 'd-1',
      sourceType: 'manual',
    });
  });
});
