/**
 * Lỗi mà `VideoTranscoder` ném để dịch vụ xử lý phân biệt việc có thử lại được hay không.
 * Lỗi khác (kho object, DB, mạng) được coi là tạm thời và thử lại.
 */

/** ffmpeg thoát khác 0 vì tệp hỏng hoặc không chuyển mã được: không thử lại. */
export class VideoTranscodeFailedError extends Error {
  constructor(
    message: string,
    readonly exitCode?: number,
  ) {
    super(message);
    this.name = 'VideoTranscodeFailedError';
  }
}

/** ffmpeg chạy quá `timeoutMs` và đã bị giết: không thử lại. */
export class VideoTranscodeTimeoutError extends Error {
  constructor(message = 'Chuyển mã video quá thời gian cho phép.') {
    super(message);
    this.name = 'VideoTranscodeTimeoutError';
  }
}

/** Bị huỷ vì worker đang tắt: thử lại (RabbitMQ gửi lại tin nhắn). */
export class VideoTranscodeAbortedError extends Error {
  constructor(message = 'Chuyển mã video bị huỷ.') {
    super(message);
    this.name = 'VideoTranscodeAbortedError';
  }
}
