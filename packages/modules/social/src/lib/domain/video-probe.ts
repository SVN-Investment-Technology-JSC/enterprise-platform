import type { VideoProbe } from './video-transcode.types.js';

type Dict = Record<string, unknown>;

const UNREADABLE_PROBE: VideoProbe = {
  formatNames: [],
  durationMs: 0,
  hasVideoStream: false,
  hasAudioStream: false,
  width: 0,
  height: 0,
};

function asDict(value: unknown): Dict | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Dict) : undefined;
}

/** Số hữu hạn từ số hoặc chuỗi số (ffprobe trả nhiều trường dạng chuỗi); không hợp lệ thì `undefined`. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Phân số dạng `30000/1001` hoặc số thường; `0/0` và mẫu số 0 là không hợp lệ. */
function parseRate(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const [numText, denText, extra] = value.split('/');
  if (extra !== undefined) return undefined;
  const num = toNumber(numText);
  const den = denText === undefined ? 1 : toNumber(denText);
  if (num === undefined || den === undefined || den === 0) return undefined;
  const rate = num / den;
  return rate > 0 && Number.isFinite(rate) ? rate : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Góc xoay hiển thị của luồng hình, chuẩn hoá về 0/90/180/270 (displaymatrix và thẻ `rotate`). */
function readRotation(stream: Dict): number {
  let rotation: number | undefined;
  const sideData = stream['side_data_list'];
  if (Array.isArray(sideData)) {
    for (const item of sideData) {
      const r = toNumber(asDict(item)?.['rotation']);
      if (r !== undefined) {
        rotation = r;
        break;
      }
    }
  }
  if (rotation === undefined) rotation = toNumber(asDict(stream['tags'])?.['rotate']);
  if (rotation === undefined) return 0;
  return ((Math.round(rotation) % 360) + 360) % 360;
}

function isAttachedPicture(stream: Dict): boolean {
  return toNumber(asDict(stream['disposition'])?.['attached_pic']) === 1;
}

/**
 * Đổi JSON của `ffprobe -v error -print_format json -show_format -show_streams` thành `VideoProbe`.
 * Không ném lỗi: đầu vào sai kiểu hoặc thiếu trường cho giá trị an toàn (không có luồng hình, thời lượng 0, ...)
 * để `planTranscode` từ chối bằng thông báo rõ ràng.
 */
export function parseFfprobeOutput(output: unknown): VideoProbe {
  const root = asDict(output);
  if (!root) return UNREADABLE_PROBE;

  const format = asDict(root['format']);
  const rawStreams = Array.isArray(root['streams']) ? root['streams'] : [];
  const streams = rawStreams.map(asDict).filter((s): s is Dict => s !== undefined);

  // Ảnh bìa của tệp âm thanh (attached_pic) là luồng "video" nhưng không phải video thật.
  const video = streams.find((s) => s['codec_type'] === 'video' && !isAttachedPicture(s));
  const audio = streams.find((s) => s['codec_type'] === 'audio');

  const formatNames = (str(format?.['format_name']) ?? '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n !== '');

  const durationSeconds = [toNumber(format?.['duration']), toNumber(video?.['duration'])].find(
    (d): d is number => d !== undefined && d > 0,
  );
  const durationMs = durationSeconds === undefined ? 0 : Math.round(durationSeconds * 1000);

  let width = 0;
  let height = 0;
  if (video) {
    const w = toNumber(video['width']);
    const h = toNumber(video['height']);
    if (w !== undefined && h !== undefined && w > 0 && h > 0) {
      const rotation = readRotation(video);
      const swap = rotation === 90 || rotation === 270;
      width = Math.floor(swap ? h : w);
      height = Math.floor(swap ? w : h);
    }
  }

  const frameRate = video ? (parseRate(video['avg_frame_rate']) ?? parseRate(video['r_frame_rate'])) : undefined;
  const bitRateValue = toNumber(video?.['bit_rate']) ?? toNumber(format?.['bit_rate']);
  const bitRate = bitRateValue !== undefined && bitRateValue > 0 ? bitRateValue : undefined;

  return {
    formatNames,
    durationMs,
    hasVideoStream: video !== undefined,
    hasAudioStream: audio !== undefined,
    ...(video && str(video['codec_name']) ? { videoCodec: str(video['codec_name']) } : {}),
    ...(audio && str(audio['codec_name']) ? { audioCodec: str(audio['codec_name']) } : {}),
    width,
    height,
    ...(frameRate !== undefined ? { frameRate } : {}),
    ...(bitRate !== undefined ? { bitRate } : {}),
  };
}
