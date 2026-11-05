import type { UploadEvent } from './documents.model';
import { runUpload } from './run-upload';

jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string }, fallback: string) => cause?.message || fallback,
}));

const pdf = () => new File(['x'.repeat(10)], 'hd.pdf', { type: 'application/pdf' });

function deps(overrides: Partial<Parameters<typeof runUpload>[1]> = {}) {
  const events: UploadEvent[] = [];
  const base = {
    dispatch: (event: UploadEvent) => events.push(event),
    requestTicket: jest.fn().mockResolvedValue({ uploadUrl: 'https://kho/put', versionId: 'v1', documentId: 'd1' }),
    put: jest.fn().mockImplementation(async (_url, _file, _type, onProgress: (a: number, b: number) => void) => onProgress(5, 10)),
    complete: jest.fn().mockResolvedValue({ id: 'v1' }),
  };
  return { events, ...base, ...overrides } as typeof base & { events: UploadEvent[] };
}

describe('runUpload', () => {
  it('đi đủ ba bước và báo tiến trình', async () => {
    const d = deps();
    const result = await runUpload(pdf(), d as never);
    expect(result).toEqual({ id: 'v1' });
    expect(d.requestTicket).toHaveBeenCalledWith({ fileName: 'hd.pdf', contentType: 'application/pdf', sizeBytes: 10 });
    expect(d.put).toHaveBeenCalledWith('https://kho/put', expect.any(File), 'application/pdf', expect.any(Function));
    expect(d.complete).toHaveBeenCalledWith('d1', 'v1', 10);
    expect(d.events.map((event) => event.type)).toEqual(['prepare', 'progress', 'confirm', 'done']);
  });
  it('không gọi máy chủ khi file sai loại', async () => {
    const d = deps();
    const result = await runUpload(new File(['x'], 'a.exe', { type: 'application/x-msdownload' }), d as never);
    expect(result).toBeUndefined();
    expect(d.requestTicket).not.toHaveBeenCalled();
    expect(d.events).toEqual([{ type: 'fail', message: expect.stringContaining('chưa được hỗ trợ') }]);
  });
  it('lỗi PUT thì không xác nhận và báo lỗi tiếng Việt', async () => {
    const d = deps({ put: jest.fn().mockRejectedValue(new Error('Mất kết nối khi tải lên.')) });
    expect(await runUpload(pdf(), d as never)).toBeUndefined();
    expect(d.complete).not.toHaveBeenCalled();
    expect(d.events.at(-1)).toEqual({ type: 'fail', message: 'Mất kết nối khi tải lên.' });
  });
  it('lỗi máy chủ khi xin URL được báo nguyên thông điệp', async () => {
    const d = deps({ requestTicket: jest.fn().mockRejectedValue({ message: 'Tài liệu đang bị khoá.' }) });
    await runUpload(pdf(), d as never);
    expect(d.put).not.toHaveBeenCalled();
    expect(d.events.at(-1)).toEqual({ type: 'fail', message: 'Tài liệu đang bị khoá.' });
  });
});
