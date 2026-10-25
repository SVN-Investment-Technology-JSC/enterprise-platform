import {
  SOCIAL_VIDEO_LIMITS,
  SOCIAL_VIDEO_MAX_PROCESSING_SECONDS,
  type SocialAttachmentPurpose,
} from '@enterprise-platform/contracts-social';
import type {
  TranscodePlan,
  TranscodePlanResult,
  VideoProbe,
  VideoRejectReason,
  VideoTranscodeFiles,
} from './video-transcode.types.js';

/** Định dạng chứa (ffprobe `format_name`) được nhận; mp4/mov/m4a/3gp là cùng họ ISO BMFF, matroska và webm là họ Matroska. */
const ALLOWED_FORMATS: ReadonlySet<string> = new Set(['mov', 'mp4', 'm4a', '3gp', 'matroska', 'webm']);
/** Cho phép sai số khi so thời lượng với trần (đo thời lượng của ffprobe không chính xác tuyệt đối). */
const DURATION_TOLERANCE_MS = 1000;
const MAX_SOURCE_SIDE = 4096;
const MIN_SIDE = 16;
const MAX_OUTPUT_FPS = 30;
/** Nguồn trên ngưỡng này mới cần giảm xuống 30 fps (tránh đụng vào 30000/1001 ≈ 29.97 hay 30.0x do làm tròn). */
const FPS_REDUCE_THRESHOLD = 30.5;
const POSTER_MAX_SIDE = 1280;
const MIN_TIMEOUT_MS = 120_000;

function reject(reason: VideoRejectReason, message: string): TranscodePlanResult {
  return { ok: false, reason, message };
}

function evenFloor(value: number): number {
  const even = Math.floor(value / 2) * 2;
  return Math.max(MIN_SIDE, even);
}

/**
 * Kích thước đầu ra: cạnh NGẮN = min(nguồn, trần), KHÔNG phóng to, giữ tỉ lệ; mọi chiều làm tròn xuống số chẵn
 * (H.264 yuv420p cần chẵn), tối thiểu 16. Tính theo cạnh ngắn (như "720p" của các nền tảng) để video quay dọc
 * của điện thoại không bị nén xuống còn khoảng một phần ba số điểm ảnh của video ngang: dọc 1080x1920 với
 * trần 720 cho 720x1280 (cùng số điểm ảnh với 1280x720).
 */
function outputSize(probe: VideoProbe, maxShortSide: number): { width: number; height: number } {
  const landscape = probe.width >= probe.height;
  const shortSide = landscape ? probe.height : probe.width;
  const target = Math.min(shortSide, maxShortSide);
  const scaled = (value: number) => Math.round((value * target) / shortSide);
  const width = landscape ? scaled(probe.width) : target;
  const height = landscape ? target : scaled(probe.height);
  return { width: evenFloor(width), height: evenFloor(height) };
}

function buildTimeoutMs(durationMs: number): number {
  return Math.min(SOCIAL_VIDEO_MAX_PROCESSING_SECONDS * 1000, Math.max(MIN_TIMEOUT_MS, durationMs * 3 + MIN_TIMEOUT_MS));
}

/**
 * Kiểm video đầu vào theo giới hạn của `purpose` rồi lập kế hoạch ffmpeg (độ phân giải = nhỏ hơn giữa nguồn và
 * trần, không phóng to).
 *
 * Hạn chế đã biết: video HDR/10-bit được nhận và chuyển về yuv420p 8-bit mà KHÔNG tone-map, nên màu có thể nhạt
 * hơn bản gốc. Chỉ lấy một luồng hình và một luồng tiếng; phụ đề và dữ liệu bị bỏ. `-threads` do worker thêm.
 */
export function planTranscode(probe: VideoProbe, purpose: SocialAttachmentPurpose): TranscodePlanResult {
  const limits = SOCIAL_VIDEO_LIMITS[purpose];

  if (probe.formatNames.length === 0) {
    return reject('unreadable', 'Không đọc được tệp video. Tệp có thể bị hỏng hoặc không phải video.');
  }
  if (!probe.formatNames.some((name) => ALLOWED_FORMATS.has(name))) {
    return reject('unsupported_format', 'Định dạng video không được hỗ trợ. Hãy dùng MP4, MOV, WebM hoặc MKV.');
  }
  if (!probe.hasVideoStream) {
    return reject('no_video_stream', 'Tệp không có hình ảnh video (có thể chỉ chứa âm thanh).');
  }
  if (!(probe.durationMs > 0)) {
    return reject('zero_duration', 'Không xác định được thời lượng video hoặc video dài 0 giây.');
  }
  if (probe.durationMs > limits.maxSeconds * 1000 + DURATION_TOLERANCE_MS) {
    return reject('too_long', `Video dài quá ${limits.maxSeconds} giây cho phép.`);
  }
  if (!Number.isFinite(probe.width) || !Number.isFinite(probe.height) || probe.width <= 0 || probe.height <= 0) {
    return reject('too_large_dimensions', 'Không xác định được kích thước hình của video.');
  }
  if (Math.max(probe.width, probe.height) > MAX_SOURCE_SIDE) {
    return reject('too_large_dimensions', `Độ phân giải video quá lớn (tối đa ${MAX_SOURCE_SIDE} điểm ảnh mỗi cạnh).`);
  }
  if (Math.min(probe.width, probe.height) < MIN_SIDE) {
    return reject('too_large_dimensions', `Kích thước hình của video quá nhỏ (tối thiểu ${MIN_SIDE} điểm ảnh).`);
  }

  const { width: outputWidth, height: outputHeight } = outputSize(probe, limits.maxHeight);
  const reduceFps = probe.frameRate !== undefined && probe.frameRate > FPS_REDUCE_THRESHOLD;
  const filter = `${reduceFps ? `fps=${MAX_OUTPUT_FPS},` : ''}scale=${outputWidth}:${outputHeight}`;
  const maxrate = limits.maxVideoKbps;
  const hasAudio = probe.hasAudioStream;
  // Poster cắt ở 1 giây hoặc giữa video nếu video ngắn hơn 2 giây.
  const posterSeconds = Math.min(1, probe.durationMs / 2000);

  const plan: TranscodePlan = {
    outputWidth,
    outputHeight,
    timeoutMs: buildTimeoutMs(probe.durationMs),
    videoArgs: (files: Pick<VideoTranscodeFiles, 'inputPath' | 'outputPath'>) => [
      '-y',
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-protocol_whitelist',
      'file',
      '-i',
      files.inputPath,
      '-map',
      '0:v:0',
      ...(hasAudio ? ['-map', '0:a:0?'] : []),
      '-sn',
      '-dn',
      '-vf',
      filter,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-maxrate',
      `${maxrate}k`,
      '-bufsize',
      `${maxrate * 2}k`,
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
      ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an']),
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      files.outputPath,
    ],
    posterArgs: (files: Pick<VideoTranscodeFiles, 'inputPath' | 'posterPath'>) => [
      '-y',
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-protocol_whitelist',
      'file',
      '-ss',
      posterSeconds.toFixed(3),
      '-i',
      files.inputPath,
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-dn',
      '-frames:v',
      '1',
      // Cạnh dài tối đa 1280, giữ tỉ lệ, không phóng to (iw/ih đã tính xoay vì ffmpeg tự xoay trước bộ lọc).
      '-vf',
      `scale='if(gte(iw,ih),min(${POSTER_MAX_SIDE},iw),-2)':'if(gte(iw,ih),-2,min(${POSTER_MAX_SIDE},ih))'`,
      '-pix_fmt',
      'yuvj420p',
      '-q:v',
      '3',
      '-f',
      'image2',
      files.posterPath,
    ],
  };
  return { ok: true, plan };
}
