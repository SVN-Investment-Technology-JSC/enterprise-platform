import { SocialAttachmentService, SOCIAL_ORPHAN_TTL_MS } from './social-attachment.service.js';
import type { AttachmentStorage } from './attachment-storage.port.js';
import type { OrphanAttachment, SocialStore } from './social-store.port.js';
import type { SocialVideoStore } from './social-video-store.port.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-01-01T12:00:00.000Z');

interface Harness {
  readonly service: SocialAttachmentService;
  readonly listedBefore: string[];
  readonly deletedKeys: string[];
  readonly deletedRows: string[];
  readonly aborted: string[];
  readonly clearedSources: string[];
  readonly requeued: { staleAfterSeconds: number; limit: number }[];
  readonly calls: string[];
  readonly failedStuck: { olderThanSeconds: number; limit: number; message: string }[];
}

function harness(options: {
  orphans: readonly OrphanAttachment[];
  sources?: readonly { id: string; sourceKey: string }[];
  failKeys?: readonly string[];
  withAbort?: boolean;
  withVideoStore?: boolean;
  stuck?: readonly { id: string; storageKey: string }[];
  requeueCount?: number;
  throwOnDelete?: boolean;
}): Harness {
  const listedBefore: string[] = [];
  const deletedKeys: string[] = [];
  const deletedRows: string[] = [];
  const aborted: string[] = [];
  const clearedSources: string[] = [];
  const requeued: { staleAfterSeconds: number; limit: number }[] = [];
  const calls: string[] = [];
  const failedStuck: { olderThanSeconds: number; limit: number; message: string }[] = [];
  let served = false;
  const store = {
    attachments: {
      listOrphans: async (_tenantId: string, olderThan: string) => {
        listedBefore.push(olderThan);
        if (served) return [];
        served = true;
        return options.orphans;
      },
      deleteByIds: async (_tenantId: string, ids: readonly string[]) => {
        deletedRows.push(...ids);
      },
    },
  } as unknown as SocialStore;
  const storage = {
    deleteObjects: async (keys: readonly string[]) => {
      if (options.throwOnDelete) throw new Error('kho lỗi');
      calls.push('deleteObjects');
      deletedKeys.push(...keys);
      return { failed: keys.filter((key) => options.failKeys?.includes(key)) };
    },
    ...(options.withAbort === false
      ? {}
      : {
          abortIncompleteMultipartUploads: async (key: string) => {
            aborted.push(key);
            return 1;
          },
        }),
  } as unknown as AttachmentStorage;
  const videoStore = {
    listSourceKeysToDelete: async () => options.sources ?? [],
    clearSourceKeys: async (_tenantId: string, ids: readonly string[]) => {
      clearedSources.push(...ids);
    },
    requeueStale: async (_tenantId: string, staleAfterSeconds: number, limit: number) => {
      calls.push('requeueStale');
      requeued.push({ staleAfterSeconds, limit });
      return options.requeueCount ?? 0;
    },
    failStuckQueued: async (_tenantId: string, olderThanSeconds: number, limit: number, message: string) => {
      calls.push('failStuckQueued');
      failedStuck.push({ olderThanSeconds, limit, message });
      return options.stuck ?? [];
    },
  } as unknown as SocialVideoStore;
  const service = new SocialAttachmentService(
    store,
    storage,
    () => NOW,
    undefined,
    undefined,
    options.withVideoStore === false ? undefined : videoStore,
  );
  return { service, listedBefore, deletedKeys, deletedRows, aborted, clearedSources, requeued, calls, failedStuck };
}

describe('dọn tệp mồ côi', () => {
  it('ngưỡng là 2 giờ', async () => {
    expect(SOCIAL_ORPHAN_TTL_MS).toBe(2 * 60 * 60 * 1000);
    const h = harness({ orphans: [] });
    await h.service.cleanupOrphans(TENANT);
    expect(h.listedBefore).toEqual([new Date(NOW.getTime() - SOCIAL_ORPHAN_TTL_MS).toISOString()]);
  });

  it('xoá storage, poster và bản gốc của tệp mồ côi rồi xoá dòng', async () => {
    const h = harness({
      orphans: [{ id: 'a', storageKey: 'k/video.mp4', posterKey: 'k/poster.jpg', sourceKey: 'k/src.mov', completed: true }],
    });
    expect(await h.service.cleanupOrphans(TENANT)).toBe(1);
    expect(h.deletedKeys.sort()).toEqual(['k/poster.jpg', 'k/src.mov', 'k/video.mp4']);
    expect(h.deletedRows).toEqual(['a']);
  });

  it('chỉ huỷ phần tải dở của tệp chưa hoàn tất', async () => {
    const h = harness({
      orphans: [
        { id: 'unfinished', storageKey: 'k/unfinished', completed: false },
        { id: 'done', storageKey: 'k/done', completed: true },
        { id: 'unknown', storageKey: 'k/unknown' },
      ],
    });
    await h.service.cleanupOrphans(TENANT);
    expect(h.aborted).toEqual(['k/unfinished']);
    expect(h.deletedRows.sort()).toEqual(['done', 'unfinished', 'unknown']);
  });

  it('kho không có hàm huỷ phần tải dở thì vẫn dọn bình thường', async () => {
    const h = harness({ orphans: [{ id: 'a', storageKey: 'k/a', completed: false }], withAbort: false });
    expect(await h.service.cleanupOrphans(TENANT)).toBe(1);
    expect(h.deletedRows).toEqual(['a']);
  });

  it('kho từ chối xoá một object thì giữ lại dòng của tệp đó để thử lại', async () => {
    const h = harness({
      orphans: [
        { id: 'ok', storageKey: 'k/ok', completed: true },
        { id: 'stuck', storageKey: 'k/stuck', posterKey: 'k/stuck-poster', completed: true },
      ],
      failKeys: ['k/stuck-poster'],
    });
    expect(await h.service.cleanupOrphans(TENANT)).toBe(1);
    expect(h.deletedRows).toEqual(['ok']);
  });

  it('xoá bản gốc còn sót sau chuyển mã và bỏ source_key khi kho đã xoá được', async () => {
    const h = harness({
      orphans: [],
      sources: [
        { id: 'a', sourceKey: 'k/a.mov' },
        { id: 'b', sourceKey: 'k/b.mov' },
      ],
      failKeys: ['k/b.mov'],
    });
    await h.service.cleanupOrphans(TENANT);
    expect(h.deletedKeys.sort()).toEqual(['k/a.mov', 'k/b.mov']);
    expect(h.clearedSources).toEqual(['a']);
  });

  it('cleanupOrphans không còn xếp lại hàng hay báo lỗi video kẹt (việc của sweepVideos)', async () => {
    const h = harness({ orphans: [] });
    await h.service.cleanupOrphans(TENANT);
    expect(h.requeued).toEqual([]);
    expect(h.failedStuck).toEqual([]);
  });

  it('sweepVideos: báo lỗi video chưa từng được nhận (30 phút) trước, rồi xếp lại hàng (10 phút)', async () => {
    const h = harness({ orphans: [], stuck: [{ id: 'a', storageKey: 'k/a.mov' }], requeueCount: 2 });
    expect(await h.service.sweepVideos(TENANT)).toEqual({ requeued: 2, failed: 1 });
    expect(h.calls).toEqual(['failStuckQueued', 'deleteObjects', 'requeueStale']);
    expect(h.failedStuck).toEqual([
      {
        olderThanSeconds: 30 * 60,
        limit: 200,
        message: 'Hệ thống xử lý video chưa sẵn sàng. Hãy tải video lên lại sau.',
      },
    ]);
    expect(h.deletedKeys).toEqual(['k/a.mov']);
    expect(h.requeued).toEqual([{ staleAfterSeconds: 10 * 60, limit: 200 }]);
    expect(h.deletedRows).toEqual([]);
  });

  it('sweepVideos: không có video kẹt thì không gọi kho xoá', async () => {
    const h = harness({ orphans: [] });
    expect(await h.service.sweepVideos(TENANT)).toEqual({ requeued: 0, failed: 0 });
    expect(h.calls).toEqual(['failStuckQueued', 'requeueStale']);
  });

  it('sweepVideos: kho xoá lỗi hoặc từ chối một khoá thì vẫn xếp lại hàng và không ném lỗi', async () => {
    const thrown = harness({ orphans: [], stuck: [{ id: 'a', storageKey: 'k/a.mov' }], throwOnDelete: true });
    await expect(thrown.service.sweepVideos(TENANT)).resolves.toEqual({ requeued: 0, failed: 1 });
    expect(thrown.requeued).toHaveLength(1);

    const refused = harness({
      orphans: [],
      stuck: [{ id: 'a', storageKey: 'k/a.mov' }],
      failKeys: ['k/a.mov'],
    });
    await expect(refused.service.sweepVideos(TENANT)).resolves.toEqual({ requeued: 0, failed: 1 });
    expect(refused.requeued).toHaveLength(1);
  });

  it('sweepVideos: không có videoStore thì không làm gì', async () => {
    const h = harness({ orphans: [], withVideoStore: false });
    expect(await h.service.sweepVideos(TENANT)).toEqual({ requeued: 0, failed: 0 });
  });

  it('không có videoStore thì bỏ qua bước dọn bản gốc', async () => {
    const h = harness({ orphans: [], sources: [{ id: 'a', sourceKey: 'k/a.mov' }], withVideoStore: false });
    await h.service.cleanupOrphans(TENANT);
    expect(h.deletedKeys).toEqual([]);
    expect(h.clearedSources).toEqual([]);
  });
});
