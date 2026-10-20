import { normalizeDocument, type BrandIconSummary, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import * as api from './brand-api';
import { runPool } from './concurrency';
import { findLocalOnly, makeCopy, presetDocs, sameContent } from './doc-utils';
import { freshId, isPresetId, localStore } from './local-store';
import { remoteStore } from './remote-store';
import type { ServerIconInfo, SyncResult } from './types';

/** Số yêu cầu ghi chạy cùng lúc khi thao tác hàng loạt. */
export const BATCH_CONCURRENCY = 3;

// Thao tác trên thư viện lưu ở máy chủ. Mọi thao tác hiện kết quả ngay (lạc quan) rồi hoàn lại nếu máy chủ từ
// chối; lỗi được ném lại nguyên (`BrandApiError`, có `code` và `message` tiếng Việt). Xung đột phiên bản
// (`BRAND_ICON_VERSION_CONFLICT`) không bao giờ ghi đè: thư viện giữ bản trên máy chủ.

/** Spec mà máy chủ sẽ lưu cho `doc`: cùng bộ chuẩn hoá, `status` luôn là nháp. Null nếu không chuẩn hoá được. */
function expectedSpec(doc: IconDocument, version: number): { readonly version: number; readonly doc: IconDocument } | undefined {
  const normalized = normalizeDocument({ ...doc, status: 'draft' });
  return normalized ? { version, doc: normalized } : undefined;
}

async function applyStatus(summary: BrandIconSummary, wantPublished: boolean): Promise<BrandIconSummary> {
  if (wantPublished && summary.status !== 'published') return api.publishIcon(summary.id);
  if (!wantPublished && summary.status === 'published') return api.unpublishIcon(summary.id);
  return summary;
}

/** Lỗi ở bước đổi trạng thái sau khi đã lưu xong: giữ nguyên mã, thêm câu cho biết phần đã lưu. */
function statusStepError(error: unknown, wantPublished: boolean): Error {
  const action = wantPublished ? 'phát hành' : 'gỡ phát hành';
  if (api.isBrandApiError(error)) {
    return new api.BrandApiError({
      statusCode: error.statusCode,
      code: error.code,
      message: `Đã lưu icon nhưng chưa ${action} được. ${error.message}`,
      currentVersion: error.currentVersion,
      reasons: error.reasons,
    });
  }
  return new Error(`Đã lưu icon nhưng chưa ${action} được. ${api.errorMessage(error)}`);
}

/**
 * Lưu một icon lên máy chủ: tạo mới (POST), hoặc ghi phiên bản mới (PUT với phiên bản đang giữ), rồi đổi trạng thái
 * phát hành cho khớp `doc.status`. Chỉ đổi trạng thái (nội dung vẽ không đổi) thì không tạo phiên bản mới.
 */
export async function saveToServer(doc: IconDocument): Promise<IconDocument> {
  const wantPublished = doc.status === 'published';
  const before = remoteStore.getSummary(doc.id);
  remoteStore.begin(doc.id, { ...doc, updatedAt: new Date().toISOString() });

  let summary: BrandIconSummary;
  let saved: { readonly version: number; readonly doc: IconDocument } | undefined;
  try {
    if (!before) {
      const response = await api.createIcon({ document: doc });
      summary = response.icon;
      saved = expectedSpec(doc, response.version.version);
    } else {
      const known = remoteStore.getSpec(before.id, before.currentVersion);
      if (before.status !== 'archived' && known && sameContent(doc, known)) {
        summary = before;
      } else {
        const response = await api.saveIcon(doc.id, { document: doc, baseVersion: before.currentVersion });
        summary = response.icon;
        // Kể cả khi máy chủ báo "không đổi": nội dung trùng bản hiện hành nên đó cũng là spec của phiên bản này.
        saved = expectedSpec(doc, response.version.version);
      }
    }
  } catch (error) {
    remoteStore.revert(doc.id);
    throw error;
  }

  let final = summary;
  let statusError: unknown = null;
  try {
    final = await applyStatus(summary, wantPublished);
  } catch (error) {
    statusError = error;
  }
  // Một lần ghi duy nhất vào kho, kể cả khi bước đổi trạng thái lỗi: phần đã lưu trên máy chủ phải hiện đúng.
  remoteStore.commit(final, saved);
  if (statusError) throw statusStepError(statusError, wantPublished);
  return remoteStore.getDoc(doc.id) ?? doc;
}

function throwBatchFailure(total: number, failures: readonly string[], done: string) {
  if (failures.length === 0) return;
  const succeeded = total - failures.length;
  throw new Error(succeeded === 0 ? failures[0] : `${done} ${succeeded}/${total} icon. ${failures[0]}`);
}

export async function saveManyToServer(docs: readonly IconDocument[]): Promise<void> {
  const failures: string[] = [];
  await runPool(docs, BATCH_CONCURRENCY, async (doc) => {
    try {
      await saveToServer(doc);
    } catch (error) {
      failures.push(api.errorMessage(error));
    }
  });
  throwBatchFailure(docs.length, failures, 'Đã lưu');
}

/** Lưu trữ icon (máy chủ không xoá dữ liệu). Icon mẫu không xoá được. */
export async function removeFromServer(id: string): Promise<void> {
  if (isPresetId(id)) return;
  const before = remoteStore.getSummary(id);
  if (!before || before.status === 'archived') return;
  remoteStore.begin(id, null);
  try {
    remoteStore.commit(await api.archiveIcon(id));
  } catch (error) {
    remoteStore.revert(id);
    throw error;
  }
}

export async function removeManyFromServer(ids: readonly string[]): Promise<number> {
  const targets = ids.filter((id) => {
    const summary = remoteStore.getSummary(id);
    return !isPresetId(id) && summary !== undefined && summary.status !== 'archived';
  });
  const failures: string[] = [];
  await runPool(targets, BATCH_CONCURRENCY, async (id) => {
    try {
      await removeFromServer(id);
    } catch (error) {
      failures.push(api.errorMessage(error));
    }
  });
  throwBatchFailure(targets.length, failures, 'Đã lưu trữ');
  return targets.length;
}

export async function duplicateOnServer(id: string): Promise<IconDocument | null> {
  const source = remoteStore.getDoc(id);
  if (!source) return null;
  return saveToServer(makeCopy(source));
}

export async function importToServer(incoming: readonly IconDocument[]): Promise<number> {
  const { docs, summaries } = remoteStore.getSnapshot();
  const taken = new Set<string>([...docs.map((doc) => doc.id), ...summaries.keys()]);
  const fresh: IconDocument[] = [];
  for (const doc of incoming) {
    const next = taken.has(doc.id) ? { ...doc, id: freshId() } : doc;
    taken.add(next.id);
    fresh.push(next);
  }
  const failures: string[] = [];
  await runPool(fresh, BATCH_CONCURRENCY, async (doc) => {
    try {
      await saveToServer(doc);
    } catch (error) {
      failures.push(api.errorMessage(error));
    }
  });
  throwBatchFailure(fresh.length, failures, 'Chỉ nhập được');
  return fresh.length;
}

/** Đưa icon mẫu về bản gốc. Icon mẫu chưa từng lưu lên máy chủ thì vốn đang là bản gốc. */
export async function resetPresetOnServer(id: string): Promise<void> {
  const preset = presetDocs().find((item) => item.id === id);
  if (!preset || !remoteStore.getSummary(id)) return;
  await saveToServer(preset);
}

/** Phát hành phiên bản mới nhất. */
export async function publishOnServer(id: string): Promise<IconDocument | null> {
  const before = remoteStore.getSummary(id);
  if (!before || before.status === 'archived') return null;
  if (before.status === 'published' && !before.hasUnpublishedChanges) return remoteStore.getDoc(id) ?? null;
  const current = remoteStore.getDoc(id);
  if (current) remoteStore.begin(id, { ...current, status: 'published' });
  try {
    remoteStore.commit(await api.publishIcon(id));
  } catch (error) {
    remoteStore.revert(id);
    throw error;
  }
  return remoteStore.getDoc(id) ?? null;
}

/** Đẩy icon chỉ có trong trình duyệt lên máy chủ, mỗi icon một lượt. Icon đã lên máy chủ nhưng chưa phát hành được vẫn tính là đã đẩy. */
export async function syncLocalToServer(): Promise<SyncResult> {
  const targets = findLocalOnly(localStore.getSnapshot().docs, remoteStore.getSnapshot().summaries);
  let pushed = 0;
  let failed = 0;
  await runPool(targets, BATCH_CONCURRENCY, async (doc) => {
    try {
      await saveToServer(doc);
      pushed += 1;
    } catch {
      if (remoteStore.getSummary(doc.id)) pushed += 1;
      else failed += 1;
    }
  });
  return { pushed, failed };
}

export function serverInfoOf(summaries: ReadonlyMap<string, BrandIconSummary>, id: string): ServerIconInfo | null {
  const summary = summaries.get(id);
  if (!summary || summary.status === 'archived') return null;
  return {
    version: summary.currentVersion,
    publishedVersion: summary.publishedVersion,
    hasUnpublishedChanges: summary.hasUnpublishedChanges,
    svgUrl: api.svgUrl(id, summary.currentVersion, 'brand'),
    publicSvgUrl: summary.publishedVersion === null ? null : api.svgUrl(id, summary.publishedVersion, 'brand'),
  };
}
