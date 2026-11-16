import { ObjectNotFoundError, readObjectSize } from './adapter-storage.js';
import {
  UploadFileRejectedError,
  checkUploadFile,
  downloadContentTypeFor,
  isBlockedUploadExtension,
  uploadFileExtension,
} from './upload-file-type.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function rejection(run: () => unknown): UploadFileRejectedError {
  try {
    run();
  } catch (error) {
    if (error instanceof UploadFileRejectedError) return error;
    throw error;
  }
  throw new Error('expected UploadFileRejectedError');
}

describe('checkUploadFile', () => {
  // SEC-BE017-01
  it.each([
    ['a.exe', 'text/plain'],
    ['a.html', 'text/plain'],
    ['a.pdf', 'text/html'],
    ['a.svg', 'image/svg+xml'],
    ['a.htm', 'text/html'],
    ['a.js', 'text/plain'],
    ['a.bat', 'text/plain'],
    ['a.sh', 'text/plain'],
    ['a.xhtml', 'application/xhtml+xml'],
    ['a.PDF.exe', 'application/pdf'],
    ['a.html.', 'text/plain'],
    ['noextension', 'text/plain'],
  ])('từ chối %s khai %s', (fileName, contentType) => {
    const error = rejection(() => checkUploadFile({ fileName, contentType, sizeBytes: 10 }));
    expect(error.reason).toBe('type');
    expect(error.message).toBe('Loại tệp không được phép.');
  });

  // SEC-BE017-02
  it.each([
    ['a.pdf', 'application/pdf'],
    ['a.docx', DOCX],
    ['a.png', 'image/png'],
    ['Báo cáo.XLSX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['a.csv', 'application/vnd.ms-excel'],
    ['a.txt', 'text/plain; charset=utf-8'],
  ])('chấp nhận %s khai %s', (fileName, contentType) => {
    const file = checkUploadFile({ fileName, contentType, sizeBytes: 2048 });
    expect(file.contentType).toBe(contentType.split(';')[0]);
    expect(file.sizeBytes).toBe(2048);
  });

  // SEC-BE017-03
  it.each([[-1], [0], ['abc'], [1.5], [''], [null], [undefined], [Number.MAX_SAFE_INTEGER + 2]])(
    'từ chối sizeBytes %p',
    (sizeBytes) => {
      const error = rejection(() => checkUploadFile({ fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes }));
      expect(error.reason).toBe('size');
    },
  );

  it('sizeBytes dạng chuỗi số vẫn nhận', () => {
    expect(checkUploadFile({ fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: '12' }).sizeBytes).toBe(12);
  });

  it('requireSize: false thì bỏ qua khi client không gửi, gửi sai vẫn từ chối', () => {
    expect(checkUploadFile({ fileName: 'a.pdf', contentType: 'application/pdf' }, { requireSize: false }).sizeBytes)
      .toBeUndefined();
    expect(() =>
      checkUploadFile({ fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: -5 }, { requireSize: false }),
    ).toThrow(UploadFileRejectedError);
  });

  it('loại không rõ chỉ nhận khi bật acceptUnknownContentType, và thay bằng loại chuẩn của đuôi', () => {
    expect(() => checkUploadFile({ fileName: 'a.csv', contentType: '', sizeBytes: 1 })).toThrow(UploadFileRejectedError);
    expect(
      checkUploadFile(
        { fileName: 'a.csv', contentType: 'application/octet-stream', sizeBytes: 1 },
        { acceptUnknownContentType: true },
      ).contentType,
    ).toBe('text/csv');
    expect(() =>
      checkUploadFile({ fileName: 'a.exe', contentType: '', sizeBytes: 1 }, { acceptUnknownContentType: true }),
    ).toThrow(UploadFileRejectedError);
  });

  it('danh sách riêng của phân hệ vẫn không mở được đuôi bị chặn', () => {
    const allowed = { pdf: 'application/pdf', svg: 'image/svg+xml', mp4: 'video/mp4' };
    expect(checkUploadFile({ fileName: 'a.mp4', contentType: 'video/mp4', sizeBytes: 1 }, { allowed }).contentType)
      .toBe('video/mp4');
    expect(() =>
      checkUploadFile({ fileName: 'a.svg', contentType: 'image/svg+xml', sizeBytes: 1 }, { allowed }),
    ).toThrow(UploadFileRejectedError);
    expect(() =>
      checkUploadFile({ fileName: 'a.docx', contentType: DOCX, sizeBytes: 1 }, { allowed }),
    ).toThrow(UploadFileRejectedError);
  });

  it('allowedContentTypes lọc thêm trên danh sách đuôi', () => {
    expect(() =>
      checkUploadFile(
        { fileName: 'a.gif', contentType: 'image/gif', sizeBytes: 1 },
        { allowedContentTypes: ['application/pdf', 'image/png'] },
      ),
    ).toThrow(UploadFileRejectedError);
  });

  it('không bị lừa bởi khoá kế thừa của object', () => {
    expect(() => checkUploadFile({ fileName: 'a.constructor', contentType: 'text/plain', sizeBytes: 1 }))
      .toThrow(UploadFileRejectedError);
  });
});

describe('tiện ích đuôi tệp', () => {
  it('lấy đuôi chữ thường', () => {
    expect(uploadFileExtension('Hợp đồng.v2.PDF')).toBe('pdf');
    expect(uploadFileExtension('README')).toBe('');
    expect(uploadFileExtension('a.html. ')).toBe('html');
  });

  it('nhận ra đuôi chạy được', () => {
    expect(isBlockedUploadExtension('setup.EXE')).toBe(true);
    expect(isBlockedUploadExtension('report.pdf')).toBe(false);
  });

  it('loại tải xuống do server quyết theo đuôi', () => {
    expect(downloadContentTypeFor('a.pdf')).toBe('application/pdf');
    expect(downloadContentTypeFor('a.html')).toBe('application/octet-stream');
    expect(downloadContentTypeFor('a.unknown')).toBe('application/octet-stream');
    expect(downloadContentTypeFor('a.mov', { mov: 'video/quicktime' })).toBe('video/quicktime');
  });
});

describe('readObjectSize', () => {
  const storageThrowing = (error: unknown) => ({
    objectMetadata: async () => {
      throw error;
    },
  });

  it('trả dung lượng thật khi object có', async () => {
    await expect(
      readObjectSize({ objectMetadata: async () => ({ sizeBytes: 42, contentType: 'application/pdf' }) }, 'k'),
    ).resolves.toBe(42);
  });

  it.each([
    [Object.assign(new Error('x'), { name: 'NotFound' })],
    [Object.assign(new Error('x'), { name: 'NoSuchKey' })],
    [Object.assign(new Error('x'), { $metadata: { httpStatusCode: 404 } })],
    [new ObjectNotFoundError('k')],
  ])('khoá không có thì null', async (error) => {
    await expect(readObjectSize(storageThrowing(error), 'k')).resolves.toBeNull();
  });

  it('lỗi khác của kho thì ném tiếp', async () => {
    await expect(readObjectSize(storageThrowing(new Error('AccessDenied')), 'k')).rejects.toThrow('AccessDenied');
  });
});
