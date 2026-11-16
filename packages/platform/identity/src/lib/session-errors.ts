import { UnauthorizedException } from '@nestjs/common';

/**
 * Refresh token đúng là của một phiên có thật nhưng phiên đã hết hạn hoặc đã bị thu hồi (đăng xuất, đổi mật khẩu).
 * Đây là chuyện bình thường của trình duyệt mở lâu, nên controller không đếm vào giới hạn thất bại (ISS-BE-010).
 */
export class RefreshSessionExpiredException extends UnauthorizedException {
  constructor(code = 'SESSION_EXPIRED', message = 'Phiên đăng nhập đã hết hạn.') {
    super({ statusCode: 401, code, message });
  }
}

/**
 * Phiên không được làm mới quá thời gian chờ (mặc định 8 giờ) nên đã bị thu hồi. Vẫn là hết hạn tự nhiên, không đếm
 * vào giới hạn thất bại.
 */
export class RefreshSessionIdleExpiredException extends RefreshSessionExpiredException {
  constructor() {
    super(
      'SESSION_IDLE_EXPIRED',
      'Phiên đăng nhập đã hết hạn do không hoạt động, vui lòng đăng nhập lại.',
    );
  }
}
