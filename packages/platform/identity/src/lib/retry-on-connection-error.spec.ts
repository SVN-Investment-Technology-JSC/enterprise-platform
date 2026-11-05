import { isTransientConnectionError, retryOnConnectionError } from './retry-on-connection-error';

const connectionReset = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

describe('retryOnConnectionError', () => {
  it('thử lại một lần khi kết nối bị reset rồi trả kết quả', async () => {
    const operation = jest.fn().mockRejectedValueOnce(connectionReset()).mockResolvedValueOnce('ok');

    await expect(retryOnConnectionError(operation, 0)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('không thử lại quá một lần', async () => {
    const operation = jest.fn().mockRejectedValue(connectionReset());

    await expect(retryOnConnectionError(operation, 0)).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('không thử lại lỗi không phải đứt kết nối', async () => {
    const failure = Object.assign(new Error('duplicate key'), { code: '23505' });
    const operation = jest.fn().mockRejectedValue(failure);

    await expect(retryOnConnectionError(operation, 0)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('nhận diện các dạng lỗi đứt kết nối thường gặp', () => {
    expect(isTransientConnectionError(connectionReset())).toBe(true);
    expect(isTransientConnectionError({ code: '57P01' })).toBe(true);
    expect(isTransientConnectionError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isTransientConnectionError(new Error('permission denied'))).toBe(false);
    expect(isTransientConnectionError(undefined)).toBe(false);
  });
});
