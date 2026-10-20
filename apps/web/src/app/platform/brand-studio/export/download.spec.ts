import { copyText, downloadBlob, REVOKE_DELAY_MS } from './download';

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('không đọc được blob'));
    reader.readAsText(blob);
  });
}

describe('downloadBlob', () => {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  let blobs: Blob[];
  let revoked: string[];
  let clicked: { download: string; href: string; attached: boolean }[];

  beforeEach(() => {
    jest.useFakeTimers();
    blobs = [];
    revoked = [];
    clicked = [];
    URL.createObjectURL = jest.fn((blob: Blob | MediaSource) => {
      blobs.push(blob as Blob);
      return `blob:file-${blobs.length}`;
    });
    URL.revokeObjectURL = jest.fn((url: string) => {
      revoked.push(url);
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href, attached: document.body.contains(this) });
    });
  });

  afterEach(() => {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('bấm vào liên kết tạm có tên tệp, rồi gỡ liên kết khỏi trang', () => {
    downloadBlob('nha-kho.svg', '<svg />', 'image/svg+xml');
    expect(clicked).toEqual([{ download: 'nha-kho.svg', href: 'blob:file-1', attached: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('giữ nguyên kiểu và nội dung chữ', async () => {
    downloadBlob('a.svg', 'nội dung có dấu', 'image/svg+xml');
    expect(blobs[0].type).toBe('image/svg+xml');
    expect(await readBlob(blobs[0])).toBe('nội dung có dấu');
  });

  it('nhận dữ liệu nhị phân', () => {
    downloadBlob('a.zip', new Uint8Array([1, 2, 3, 4]), 'application/zip');
    expect(blobs[0].size).toBe(4);
    expect(blobs[0].type).toBe('application/zip');
  });

  it('nhận sẵn Blob và không bọc lại', () => {
    const blob = new Blob(['x'], { type: 'text/plain' });
    downloadBlob('a.txt', blob, 'text/plain');
    expect(blobs[0]).toBe(blob);
  });

  it('giải phóng URL sau một khoảng chờ, đúng một lần', () => {
    downloadBlob('a.svg', 'x', 'image/svg+xml');
    expect(revoked).toEqual([]);
    jest.advanceTimersByTime(REVOKE_DELAY_MS - 1);
    expect(revoked).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(revoked).toEqual(['blob:file-1']);
    jest.runAllTimers();
    expect(revoked).toHaveLength(1);
  });

  it('click lỗi: giải phóng URL ngay, gỡ liên kết và ném lại lỗi', () => {
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('bị chặn');
    });
    expect(() => downloadBlob('a.svg', 'x', 'image/svg+xml')).toThrow('bị chặn');
    expect(revoked).toEqual(['blob:file-1']);
    expect(document.querySelector('a[download]')).toBeNull();
    jest.runAllTimers();
    expect(revoked).toHaveLength(1);
  });
});

describe('copyText', () => {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const realExec = (document as { execCommand?: unknown }).execCommand;

  afterEach(() => {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
    (document as { execCommand?: unknown }).execCommand = realExec;
    jest.restoreAllMocks();
  });

  const setClipboard = (value: unknown) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

  it('dùng clipboard của trình duyệt khi có', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyText('mã svg')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('mã svg');
  });

  it('clipboard từ chối thì rơi xuống cách dự phòng', async () => {
    setClipboard({ writeText: jest.fn().mockRejectedValue(new Error('không có quyền')) });
    const exec = jest.fn(() => true);
    (document as { execCommand?: unknown }).execCommand = exec;
    await expect(copyText('mã')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('cách dự phòng cũng lỗi thì trả false và không để lại phần tử thừa', async () => {
    setClipboard(undefined);
    (document as { execCommand?: unknown }).execCommand = () => {
      throw new Error('không hỗ trợ');
    };
    await expect(copyText('mã')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
