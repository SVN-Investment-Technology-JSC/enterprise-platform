import {
  BRAND_ERROR_CODES,
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  normalizeDocument,
  type BrandErrorCode,
  type BrandIconDetail,
  type BrandIconListResponse,
  type BrandIconSpecResponse,
  type BrandIconStatus,
  type BrandIconSummary,
  type BrandPalette,
  type BrandRules,
  type BrandStandardsResponse,
  type CreateBrandIconRequest,
  type IconDocument,
  type SaveBrandIconRequest,
  type SaveBrandIconResponse,
  type SaveBrandStandardsRequest,
  type SaveBrandStandardsResponse,
} from '@enterprise-platform/shared-brand-icon';
import { BrandApiError } from '../brand-api';
import { contentKey } from '../doc-utils';

/**
 * Máy chủ icon giả trong bộ nhớ cho kiểm thử: cùng quy tắc phiên bản, xung đột, phát hành và lưu trữ như API thật
 * (`packages/platform/brand`), nhưng không cần mạng. Dùng làm thân cho các hàm của `brand-api` khi mock.
 */
interface Row {
  summary: BrandIconSummary;
  readonly versions: Map<number, IconDocument>;
}

const fail = (statusCode: number, code: BrandErrorCode, message: string, extra: { currentVersion?: number; reasons?: string[] } = {}) =>
  new BrandApiError({ statusCode, code, message, ...extra });

const E = BRAND_ERROR_CODES;

export interface FakeBrandServer {
  /** Nhật ký yêu cầu, dạng `PUT icons/<id>`; thêm `?version=` cho `GET .../spec`. */
  readonly calls: string[];
  readonly rows: Map<string, Row>;
  standards: { version: number; palette: BrandPalette; rules: BrandRules };
  /** Số yêu cầu tải spec chạy cùng lúc cao nhất đã gặp. */
  maxConcurrentSpecs: number;
  /** Tạo sẵn một icon trên máy chủ (phiên bản 1). */
  seed(doc: IconDocument, status?: BrandIconStatus): BrandIconSummary;
  /** Người khác lưu một phiên bản mới của icon (để tạo xung đột phiên bản). */
  externalSave(doc: IconDocument): BrandIconSummary;
  /** Gây lỗi cho các yêu cầu có dạng khớp `match`; `times` mặc định là mãi mãi. */
  failWith(match: string | RegExp, error: Error, times?: number): void;
  /** Bỏ mọi lỗi đã đặt. */
  clearFailures(): void;
  /** Gọi trước mỗi yêu cầu khớp, để kiểm thử chặn lại hoặc xen việc khác vào giữa. */
  onRequest(match: string | RegExp, hook: () => Promise<void>): void;
  readonly api: {
    listIcons(options?: { status?: readonly BrandIconStatus[] }): Promise<BrandIconListResponse>;
    getIcon(id: string): Promise<BrandIconDetail>;
    getIconSpec(id: string, version?: number): Promise<BrandIconSpecResponse>;
    createIcon(input: CreateBrandIconRequest): Promise<SaveBrandIconResponse>;
    saveIcon(id: string, input: SaveBrandIconRequest): Promise<SaveBrandIconResponse>;
    publishIcon(id: string): Promise<BrandIconSummary>;
    unpublishIcon(id: string): Promise<BrandIconSummary>;
    archiveIcon(id: string): Promise<BrandIconSummary>;
    restoreIcon(id: string): Promise<BrandIconSummary>;
    getStandards(): Promise<BrandStandardsResponse>;
    saveStandards(input: SaveBrandStandardsRequest): Promise<SaveBrandStandardsResponse>;
  };
}

export function createFakeBrandServer(): FakeBrandServer {
  const rows = new Map<string, Row>();
  const calls: string[] = [];
  const failures: Array<{ match: string | RegExp; error: Error; remaining: number }> = [];
  const hooks: Array<{ match: string | RegExp; hook: () => Promise<void> }> = [];
  let clock = 0;
  let activeSpecs = 0;

  const now = () => {
    clock += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
  };
  const matches = (match: string | RegExp, call: string) => (typeof match === 'string' ? call === match : match.test(call));

  async function enter(call: string): Promise<void> {
    calls.push(call);
    for (const { match, hook } of hooks) if (matches(match, call)) await hook();
    const failure = failures.find((item) => item.remaining > 0 && matches(item.match, call));
    if (failure) {
      failure.remaining -= 1;
      throw failure.error;
    }
  }

  const withUnpublished = (summary: BrandIconSummary): BrandIconSummary => ({
    ...summary,
    hasUnpublishedChanges: summary.status === 'published' && summary.publishedVersion !== null && summary.publishedVersion < summary.currentVersion,
  });

  function row(id: string): Row {
    const found = rows.get(id);
    if (!found) throw fail(404, E.iconNotFound, 'Không tìm thấy icon.');
    return found;
  }

  function normalized(document: unknown): IconDocument {
    const doc = normalizeDocument(document);
    if (!doc) throw fail(400, E.iconInvalid, 'Icon không hợp lệ.');
    return { ...doc, status: 'draft' };
  }

  function insert(doc: IconDocument): { icon: BrandIconSummary; version: number } {
    const stamp = now();
    const summary: BrandIconSummary = {
      id: doc.id,
      slug: doc.id,
      name: doc.name,
      category: doc.category,
      status: 'draft',
      tags: doc.tags,
      currentVersion: 1,
      publishedVersion: null,
      hasUnpublishedChanges: false,
      createdBy: 'admin-1',
      createdAt: stamp,
      updatedAt: stamp,
    };
    rows.set(doc.id, { summary, versions: new Map([[1, doc]]) });
    return { icon: summary, version: 1 };
  }

  function writeVersion(id: string, doc: IconDocument): BrandIconSummary {
    const target = row(id);
    const next = target.summary.currentVersion + 1;
    target.versions.set(next, doc);
    target.summary = withUnpublished({
      ...target.summary,
      name: doc.name,
      category: doc.category,
      tags: doc.tags,
      currentVersion: next,
      updatedAt: now(),
    });
    return target.summary;
  }

  const versionInfo = (version: number, doc: IconDocument) => ({
    version,
    specSha256: contentKey(doc),
    sizeBytes: JSON.stringify(doc).length,
    standardsVersion: server.standards.version,
    note: null,
    createdBy: 'admin-1',
    createdAt: now(),
  });

  function setState(id: string, patch: Partial<Pick<BrandIconSummary, 'status' | 'publishedVersion'>>): BrandIconSummary {
    const target = row(id);
    target.summary = withUnpublished({ ...target.summary, ...patch, updatedAt: now() });
    return target.summary;
  }

  const server: FakeBrandServer = {
    calls,
    rows,
    standards: { version: 0, palette: DEFAULT_PALETTE, rules: DEFAULT_RULES },
    maxConcurrentSpecs: 0,

    seed(doc, status = 'draft') {
      const { icon } = insert(normalized(doc));
      if (status === 'published') return setState(icon.id, { status: 'published', publishedVersion: 1 });
      if (status === 'archived') return setState(icon.id, { status: 'archived' });
      return icon;
    },
    externalSave(doc) {
      return writeVersion(doc.id, normalized(doc));
    },
    failWith(match, error, times = Number.POSITIVE_INFINITY) {
      failures.push({ match, error, remaining: times });
    },
    clearFailures() {
      failures.length = 0;
    },
    onRequest(match, hook) {
      hooks.push({ match, hook });
    },

    api: {
      async listIcons(options = {}) {
        await enter('GET icons');
        const wanted = options.status;
        const icons = [...rows.values()].map((item) => item.summary).filter((icon) => !wanted || wanted.length === 0 || wanted.includes(icon.status));
        return { icons };
      },
      async getIcon(id) {
        await enter(`GET icons/${id}`);
        return { ...row(id).summary, versions: [] };
      },
      async getIconSpec(id, version) {
        await enter(`GET icons/${id}/spec${version === undefined ? '' : `?version=${version}`}`);
        activeSpecs += 1;
        server.maxConcurrentSpecs = Math.max(server.maxConcurrentSpecs, activeSpecs);
        try {
          await Promise.resolve();
          await Promise.resolve();
          const target = row(id);
          const wanted = version ?? target.summary.currentVersion;
          const doc = target.versions.get(wanted);
          if (!doc) throw fail(404, E.versionNotFound, 'Không tìm thấy phiên bản này của icon.');
          const live = target.summary.status === 'published' && target.summary.publishedVersion === wanted;
          return { document: { ...doc, status: live ? 'published' : 'draft' }, version: wanted, specSha256: contentKey(doc), iconStatus: target.summary.status };
        } finally {
          activeSpecs -= 1;
        }
      },
      async createIcon(input) {
        await enter('POST icons');
        const doc = normalized(input.document);
        if (rows.has(doc.id)) throw fail(409, E.iconExists, 'Mã icon này đã tồn tại.');
        const { icon, version } = insert(doc);
        return { icon, version: versionInfo(version, doc), unchanged: false };
      },
      async saveIcon(id, input) {
        await enter(`PUT icons/${id}`);
        const target = row(id);
        if (target.summary.status === 'archived') throw fail(409, E.iconArchived, 'Icon đã được lưu trữ.');
        const doc = normalized(input.document);
        if (doc.id !== id) throw fail(400, E.iconIdMismatch, 'Mã icon trong nội dung không khớp với đường dẫn.');
        const current = target.versions.get(target.summary.currentVersion);
        if (current && contentKey(current) === contentKey(doc)) {
          return { icon: target.summary, version: versionInfo(target.summary.currentVersion, current), unchanged: true };
        }
        if (input.baseVersion !== target.summary.currentVersion) {
          throw fail(409, E.versionConflict, 'Icon đã có phiên bản mới hơn do người khác lưu.', { currentVersion: target.summary.currentVersion });
        }
        const icon = writeVersion(id, doc);
        return { icon, version: versionInfo(icon.currentVersion, doc), unchanged: false };
      },
      async publishIcon(id) {
        await enter(`POST icons/${id}/publish`);
        const target = row(id);
        if (target.summary.status === 'archived') throw fail(409, E.iconArchived, 'Icon đã được lưu trữ.');
        const doc = target.versions.get(target.summary.currentVersion);
        if (!doc || doc.shapes.length === 0) {
          throw fail(422, E.iconNotPublishable, 'Icon chưa đạt điều kiện phát hành: Icon chưa có hình nào hiển thị.', { reasons: ['Icon chưa có hình nào hiển thị.'] });
        }
        return setState(id, { status: 'published', publishedVersion: target.summary.currentVersion });
      },
      async unpublishIcon(id) {
        await enter(`POST icons/${id}/unpublish`);
        row(id);
        return setState(id, { status: 'draft', publishedVersion: null });
      },
      async archiveIcon(id) {
        await enter(`DELETE icons/${id}`);
        row(id);
        return setState(id, { status: 'archived', publishedVersion: null });
      },
      async restoreIcon(id) {
        await enter(`POST icons/${id}/restore`);
        row(id);
        return setState(id, { status: 'draft', publishedVersion: null });
      },
      async getStandards() {
        await enter('GET standards');
        return { ...server.standards, updatedBy: null, updatedAt: null };
      },
      async saveStandards(input) {
        await enter('PUT standards');
        if (input.baseVersion !== server.standards.version) {
          throw fail(409, E.standardsConflict, 'Bảng màu và quy chuẩn đã được người khác cập nhật.', { currentVersion: server.standards.version });
        }
        server.standards = { version: server.standards.version + 1, palette: input.palette, rules: input.rules };
        return { ...server.standards, updatedBy: 'admin-1', updatedAt: now(), unchanged: false };
      },
    },
  };
  return server;
}

/** Lỗi mạng như `brand-api` ném khi không tới được máy chủ. */
export const networkError = () => new BrandApiError({ statusCode: 0, code: 'NETWORK_ERROR', message: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.' });

/** Lỗi HTTP không có thân chuẩn, như nginx 404 khi chưa có API hoặc 502 khi API đang khởi động. */
export const httpError = (statusCode: number, message: string) => new BrandApiError({ statusCode, code: E.internal, message });
