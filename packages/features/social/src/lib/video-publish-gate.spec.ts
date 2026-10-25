import {
  buildVideoWarning,
  collectUnfinishedVideos,
  hasFailedVideo,
  hasNonVideoUploading,
  hasUnfinishedVideos,
  needsVideoConfirmation,
  publishableAttachmentIds,
  type PublishGateFile,
  VIDEO_WARNING_CANCEL_LABEL,
  VIDEO_WARNING_TITLE,
} from './video-publish-gate';

const uploading = (fileName: string, progress = 0.4): PublishGateFile => ({
  fileName,
  status: 'uploading',
  isVideo: true,
  progress,
});
const processing = (fileName: string, status: 'queued' | 'processing' = 'processing'): PublishGateFile => ({
  fileName,
  status: 'done',
  isVideo: true,
  attachment: { processingStatus: status },
});
const ready = (fileName: string): PublishGateFile => ({
  fileName,
  status: 'done',
  isVideo: true,
  attachment: { processingStatus: 'ready' },
});
const failed = (fileName: string): PublishGateFile => ({
  fileName,
  status: 'done',
  isVideo: true,
  attachment: { processingStatus: 'failed' },
});

describe('collectUnfinishedVideos', () => {
  it('không có video chưa xong thì rỗng', () => {
    const result = collectUnfinishedVideos([ready('a.mp4'), { fileName: 'x.png', status: 'uploading' }]);
    expect(hasUnfinishedVideos(result)).toBe(false);
    expect(needsVideoConfirmation([ready('a.mp4')])).toBe(false);
  });

  it('tách video đang tải lên (kèm phần trăm) và video đang xử lý (queued hoặc processing)', () => {
    const result = collectUnfinishedVideos([
      uploading('a.mp4', 0.426),
      processing('b.mp4', 'queued'),
      processing('c.mp4'),
      ready('d.mp4'),
      failed('e.mp4'),
      { fileName: 'lỗi.mp4', status: 'error', isVideo: true },
    ]);
    expect(result.uploading).toEqual([{ fileName: 'a.mp4', percent: 43 }]);
    expect(result.processing).toEqual([{ fileName: 'b.mp4' }, { fileName: 'c.mp4' }]);
    expect(needsVideoConfirmation([uploading('a.mp4')])).toBe(true);
  });

  it('phần trăm bị chặn trong 0..100 và thiếu tiến trình tính là 0', () => {
    const result = collectUnfinishedVideos([
      uploading('a.mp4', 3),
      uploading('b.mp4', -1),
      { ...uploading('c.mp4'), progress: undefined },
    ]);
    expect(result.uploading.map((item) => item.percent)).toEqual([100, 0, 0]);
  });
});

describe('chặn đăng', () => {
  it('chỉ video lỗi xử lý hoặc ảnh/tệp đang tải mới chặn', () => {
    expect(hasFailedVideo([ready('a.mp4'), failed('b.mp4')])).toBe(true);
    expect(hasFailedVideo([processing('a.mp4'), uploading('b.mp4')])).toBe(false);
    expect(hasNonVideoUploading([{ fileName: 'a.png', status: 'uploading' }])).toBe(true);
    expect(hasNonVideoUploading([uploading('a.mp4')])).toBe(false);
  });
});

describe('publishableAttachmentIds', () => {
  it('lấy tệp đã tải xong và không lỗi, kể cả video đang xử lý; bỏ tệp đang tải và lỗi', () => {
    const files = [
      { status: 'done' as const, attachment: { id: 'img', processingStatus: undefined } },
      { status: 'done' as const, attachment: { id: 'queued', processingStatus: 'queued' as const } },
      { status: 'done' as const, attachment: { id: 'proc', processingStatus: 'processing' as const } },
      { status: 'done' as const, attachment: { id: 'bad', processingStatus: 'failed' as const } },
      { status: 'uploading' as const },
      { status: 'error' as const },
    ];
    expect(publishableAttachmentIds(files)).toEqual(['img', 'queued', 'proc']);
  });
});

describe('buildVideoWarning', () => {
  it('chỉ đang xử lý (bài viết)', () => {
    const warning = buildVideoWarning(collectUnfinishedVideos([processing('a.mp4')]), 'post');
    expect(warning.title).toBe(VIDEO_WARNING_TITLE);
    expect(warning.title).toBe('Video chưa xử lý xong');
    expect(warning.cancelLabel).toBe(VIDEO_WARNING_CANCEL_LABEL);
    expect(warning.confirmLabel).toBe('Vẫn đăng');
    expect(warning.paragraphs).toEqual([
      'Video đang được xử lý. Bạn vẫn có thể đăng ngay: mọi người sẽ thấy khung "Đang xử lý" và video tự hiện khi xong, thường chỉ sau vài phút.',
    ]);
  });

  it('chỉ đang tải lên (bài viết và bình luận)', () => {
    const files = [uploading('a.mp4', 0.4)];
    expect(buildVideoWarning(collectUnfinishedVideos(files), 'post').paragraphs).toEqual([
      'Video đang tải lên (40%). Nếu đăng ngay, bài viết sẽ được đăng không kèm video này.',
    ]);
    const comment = buildVideoWarning(collectUnfinishedVideos(files), 'comment');
    expect(comment.confirmLabel).toBe('Vẫn gửi');
    expect(comment.paragraphs).toEqual([
      'Video đang tải lên (40%). Nếu gửi ngay, bình luận sẽ được gửi không kèm video này.',
    ]);
  });

  it('nhiều video thì liệt kê tên tệp', () => {
    const warning = buildVideoWarning(
      collectUnfinishedVideos([
        uploading('a.mp4', 0.1),
        uploading('b.mp4', 0.9),
        processing('c.mp4'),
        processing('d.mp4'),
      ]),
      'comment',
    );
    expect(warning.paragraphs[0]).toContain('2 video đang được xử lý (c.mp4, d.mp4)');
    expect(warning.paragraphs[0]).toContain('gửi ngay');
    expect(warning.paragraphs[1]).toBe(
      'Các video đang tải lên: a.mp4 (10%), b.mp4 (90%). Nếu gửi ngay, bình luận sẽ được gửi không kèm các video này.',
    );
  });

  it('cả hai: hiện cả hai đoạn, đoạn xử lý trước', () => {
    const warning = buildVideoWarning(collectUnfinishedVideos([uploading('a.mp4'), processing('b.mp4')]), 'post');
    expect(warning.paragraphs).toHaveLength(2);
    expect(warning.paragraphs[0]).toContain('đang được xử lý');
    expect(warning.paragraphs[1]).toContain('đang tải lên');
  });

  it('không có video chưa xong thì không có đoạn nào', () => {
    expect(buildVideoWarning(collectUnfinishedVideos([ready('a.mp4')]), 'post').paragraphs).toEqual([]);
  });
});
