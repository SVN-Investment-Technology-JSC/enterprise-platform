/** Kết quả `ffprobe`, gom về các trường cần dùng. */
export interface VideoProbe {
  /** `format_name` của ffprobe tách theo dấu phẩy (ví dụ `mov`, `mp4`, `matroska`, `webm`). */
  readonly formatNames: readonly string[];
  readonly durationMs: number;
  readonly hasVideoStream: boolean;
  readonly hasAudioStream: boolean;
  readonly videoCodec?: string;
  readonly audioCodec?: string;
  /** Kích thước hình ĐÃ tính xoay: video quay dọc (xoay 90/270) có `height` lớn hơn `width`. */
  readonly width: number;
  readonly height: number;
  readonly frameRate?: number;
  readonly bitRate?: number;
}

export type VideoRejectReason =
  | 'unsupported_format'
  | 'no_video_stream'
  | 'zero_duration'
  | 'too_long'
  | 'too_large_dimensions'
  | 'unreadable';

/** Đường tệp mà worker đã chuẩn bị trong thư mục tạm của một việc. */
export interface VideoTranscodeFiles {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly posterPath: string;
}

/**
 * Kế hoạch chuyển mã, thuần dữ liệu và hàm: mọi hiểu biết về tham số ffmpeg nằm ở miền (`planTranscode`),
 * worker chỉ chạy tiến trình theo đúng các tham số này.
 */
export interface TranscodePlan {
  readonly outputWidth: number;
  readonly outputHeight: number;
  /** Tham số cho lệnh chuyển mã (chưa gồm tên chương trình ffmpeg). */
  videoArgs(files: Pick<VideoTranscodeFiles, 'inputPath' | 'outputPath'>): readonly string[];
  /** Tham số cho lệnh cắt ảnh poster. */
  posterArgs(files: Pick<VideoTranscodeFiles, 'inputPath' | 'posterPath'>): readonly string[];
  /** Quá thời gian này thì giết ffmpeg và coi là thất bại. */
  readonly timeoutMs: number;
}

export type TranscodePlanResult =
  | { readonly ok: true; readonly plan: TranscodePlan }
  | { readonly ok: false; readonly reason: VideoRejectReason; readonly message: string };
