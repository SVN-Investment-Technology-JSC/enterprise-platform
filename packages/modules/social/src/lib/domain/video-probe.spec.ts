import { parseFfprobeOutput } from './video-probe.js';

const videoStream = (extra: Record<string, unknown> = {}) => ({
  codec_type: 'video',
  codec_name: 'h264',
  width: 1920,
  height: 1080,
  avg_frame_rate: '30000/1001',
  r_frame_rate: '30000/1001',
  ...extra,
});
const audioStream = { codec_type: 'audio', codec_name: 'aac' };

describe('parseFfprobeOutput', () => {
  it('đọc video thông thường', () => {
    const probe = parseFfprobeOutput({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '12.345000', bit_rate: '2500000' },
      streams: [videoStream(), audioStream],
    });
    expect(probe.formatNames).toEqual(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']);
    expect(probe.durationMs).toBe(12345);
    expect(probe.hasVideoStream).toBe(true);
    expect(probe.hasAudioStream).toBe(true);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.audioCodec).toBe('aac');
    expect(probe.width).toBe(1920);
    expect(probe.height).toBe(1080);
    expect(probe.frameRate).toBeCloseTo(29.97, 2);
    expect(probe.bitRate).toBe(2500000);
  });

  it('thiếu thời lượng của format thì lấy từ luồng hình', () => {
    const probe = parseFfprobeOutput({
      format: { format_name: 'matroska,webm' },
      streams: [videoStream({ duration: '3.5' })],
    });
    expect(probe.durationMs).toBe(3500);
  });

  it('thời lượng không hợp lệ (N/A, âm, chữ) cho 0', () => {
    for (const duration of ['N/A', '-3', 'abc', undefined, null, {}]) {
      const probe = parseFfprobeOutput({ format: { format_name: 'mp4', duration }, streams: [videoStream()] });
      expect(probe.durationMs).toBe(0);
    }
  });

  it('xoay 90 và 270 (displaymatrix, có dấu âm) đổi chỗ rộng cao', () => {
    for (const rotation of [-90, 90, 270, -270]) {
      const probe = parseFfprobeOutput({
        format: { format_name: 'mp4', duration: '1' },
        streams: [videoStream({ side_data_list: [{ side_data_type: 'Display Matrix', rotation }] })],
      });
      expect([probe.width, probe.height]).toEqual([1080, 1920]);
    }
  });

  it('xoay 180 và 0 giữ nguyên; thẻ rotate cũng được đọc', () => {
    const keep = parseFfprobeOutput({
      format: { format_name: 'mp4', duration: '1' },
      streams: [videoStream({ side_data_list: [{ rotation: 180 }] })],
    });
    expect([keep.width, keep.height]).toEqual([1920, 1080]);
    const tag = parseFfprobeOutput({
      format: { format_name: 'mp4', duration: '1' },
      streams: [videoStream({ tags: { rotate: '90' } })],
    });
    expect([tag.width, tag.height]).toEqual([1080, 1920]);
  });

  it('bỏ qua ảnh bìa attached_pic: tệp âm thanh không có luồng hình', () => {
    const probe = parseFfprobeOutput({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '5' },
      streams: [audioStream, videoStream({ codec_name: 'mjpeg', disposition: { attached_pic: 1 } })],
    });
    expect(probe.hasVideoStream).toBe(false);
    expect(probe.hasAudioStream).toBe(true);
    expect(probe.width).toBe(0);
  });

  it('chỉ có tiếng thì hasAudioStream=true, hasVideoStream=false', () => {
    const probe = parseFfprobeOutput({ format: { format_name: 'mp3', duration: '5' }, streams: [audioStream] });
    expect(probe.hasVideoStream).toBe(false);
    expect(probe.hasAudioStream).toBe(true);
  });

  it('tốc độ khung: dự phòng r_frame_rate khi avg là 0/0', () => {
    const probe = parseFfprobeOutput({
      format: { format_name: 'mp4', duration: '1' },
      streams: [videoStream({ avg_frame_rate: '0/0', r_frame_rate: '60/1' })],
    });
    expect(probe.frameRate).toBe(60);
    const none = parseFfprobeOutput({
      format: { format_name: 'mp4', duration: '1' },
      streams: [videoStream({ avg_frame_rate: '0/0', r_frame_rate: '1/0' })],
    });
    expect(none.frameRate).toBeUndefined();
  });

  it('kích thước thiếu hoặc sai kiểu cho 0', () => {
    const probe = parseFfprobeOutput({
      format: { format_name: 'mp4', duration: '1' },
      streams: [videoStream({ width: 'x', height: undefined })],
    });
    expect([probe.width, probe.height]).toEqual([0, 0]);
    expect(probe.hasVideoStream).toBe(true);
  });

  it('chịu được đầu vào hỏng mà không ném', () => {
    for (const input of [null, undefined, 42, 'text', [], {}, { format: 5, streams: 'x' }, { streams: [null, 1, 'a'] }]) {
      const probe = parseFfprobeOutput(input);
      expect(probe.hasVideoStream).toBe(false);
      expect(probe.hasAudioStream).toBe(false);
      expect(probe.durationMs).toBe(0);
      expect(probe.formatNames).toEqual([]);
    }
  });
});
