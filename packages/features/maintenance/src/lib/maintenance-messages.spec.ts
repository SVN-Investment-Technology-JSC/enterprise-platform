import { describeDispatchFailure, describeError } from './maintenance-messages';

describe('describeDispatchFailure', () => {
  it('Quy trình chưa công bố: nói rõ nguyên nhân và việc cần làm, không còn mã 409 hay tên API', () => {
    const text = describeDispatchFailure('Procedure API trả về 409: Quy trình chưa được công bố.');
    expect(text).toContain('chưa được công bố');
    expect(text).toContain('Thử lại');
    expect(text).not.toMatch(/409|Procedure API/);
  });

  it('không có quyền, không thấy quy trình, Quy trình bận', () => {
    expect(describeDispatchFailure('Procedure API trả về 403.')).toContain('quyền');
    expect(describeDispatchFailure('Procedure API trả về 401: Unauthorized')).toContain('quyền');
    expect(describeDispatchFailure('Procedure API trả về 404: Not Found')).toContain('Không tìm thấy quy trình');
    for (const status of [408, 429, 500, 502, 503]) {
      const text = describeDispatchFailure(`Procedure API trả về ${status}.`);
      expect(text).toContain('tạm thời');
      expect(text).not.toMatch(/Procedure API|\d{3}/);
    }
  });

  it('4xx khác: hiện lời nhắn tiếng Việt của Quy trình, còn lời kỹ thuật thì dùng câu chung', () => {
    expect(describeDispatchFailure('Procedure API trả về 400: Thiếu mã thiết bị.')).toBe('Quy trình không nhận yêu cầu: Thiếu mã thiết bị.');
    const generic = describeDispatchFailure('Procedure API trả về 422: ValidationError: definitionId must be a UUID');
    expect(generic).toContain('Quy trình không nhận thông tin');
    expect(generic).not.toMatch(/UUID|422/);
    expect(describeDispatchFailure('Procedure API trả về 400.')).toContain('Quy trình không nhận thông tin');
  });

  it('lỗi mạng của máy chủ ghi lại thành lời dễ hiểu', () => {
    for (const raw of ['fetch failed', 'connect ECONNREFUSED 10.0.0.1:3000', 'The operation was aborted due to timeout', 'getaddrinfo ENOTFOUND procedure']) {
      const text = describeDispatchFailure(raw);
      expect(text).toContain('Không kết nối được tới Quy trình');
    }
  });

  it('lỗi kỹ thuật khác dùng câu chung; câu tiếng Việt thường giữ nguyên; rỗng thì trả rỗng', () => {
    expect(describeDispatchFailure('TypeError: Cannot read properties of undefined')).toContain('Chưa tạo được phiếu bên Quy trình');
    expect(describeDispatchFailure('Thiết bị chưa gắn quy trình')).toBe('Thiết bị chưa gắn quy trình');
    expect(describeDispatchFailure('')).toBe('');
    expect(describeDispatchFailure('   ')).toBe('');
    expect(describeDispatchFailure(undefined)).toBe('');
    expect(describeDispatchFailure(null)).toBe('');
  });
});

describe('describeError', () => {
  it('lời tiếng Việt từ máy chủ giữ nguyên', () => {
    expect(describeError(new Error('Thiết bị này đã có lịch bảo trì.'), 'Không tạo được lịch bảo trì.')).toBe('Thiết bị này đã có lịch bảo trì.');
  });

  it('mất mạng thì báo không kết nối được', () => {
    for (const message of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
      expect(describeError(new TypeError(message), 'Không lưu được.')).toBe('Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.');
    }
  });

  it('mã HTTP, lỗi phân tích dữ liệu: dùng lời của thao tác kèm gợi ý thử lại, không lộ mã', () => {
    for (const message of ['HTTP 500', 'Unexpected token < in JSON at position 0', 'Request failed with status code 502']) {
      const text = describeError(new Error(message), 'Không lưu được ma trận bảo trì.');
      expect(text).toBe('Không lưu được ma trận bảo trì. Máy chủ chưa xử lý được yêu cầu, hãy thử lại sau ít phút.');
    }
  });

  it('lỗi từ Quy trình đi qua cùng bộ đổi lời với lý do gửi lại phiếu', () => {
    expect(describeError(new Error('Procedure API trả về 409: Quy trình chưa được công bố.'), 'Không gửi lại được phiếu.')).toContain('chưa được công bố');
  });

  it('không có nội dung dùng được thì dùng lời dự phòng', () => {
    expect(describeError(undefined, 'Không tạo được sự cố.')).toBe('Không tạo được sự cố.');
    expect(describeError(new Error('  '), 'Không tạo được sự cố.')).toBe('Không tạo được sự cố.');
    expect(describeError({ message: 'x' }, 'Không tạo được sự cố.')).toBe('Không tạo được sự cố.');
    expect(describeError('Lời thẳng dạng chuỗi', 'dự phòng')).toBe('Lời thẳng dạng chuỗi');
  });
});
