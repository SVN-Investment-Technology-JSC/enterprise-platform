import { Logger } from '@nestjs/common';
import {
  BRAND_SPEC_MAX_BYTES,
  buildIconModel,
  checkCompliance,
  DEFAULT_PALETTE,
  DEFAULT_RULES,
  getIconSlotMeta,
  isIconSlotId,
  LIMITS,
  normalizeDocument,
  normalizePalette,
  normalizeRules,
  slotSymbolId,
  slugify,
  type BrandIconDetail,
  type BrandIconListResponse,
  type BrandIconSpecResponse,
  type BrandIconStatus,
  type BrandIconSummary,
  type BrandIconVersion,
  type BrandSlotAssignment,
  type BrandSlotListResponse,
  type BrandSlotManifestItem,
  type BrandSlotManifestResponse,
  type BrandStandardsPayload,
  type BrandStandardsResponse,
  type BrandSvgMode,
  type IconDocument,
  type IconSlotId,
  type SaveBrandIconResponse,
  type SaveBrandStandardsResponse,
} from '@enterprise-platform/shared-brand-icon';
import {
  BrandError,
  BrandStoreBusyError,
  BrandStoreConflictError,
  brandErrors,
  isDatabaseConnectionError,
} from './brand.errors.js';
import {
  buildIconArtifacts,
  iconObjectKeys,
  sha256Hex,
  specSha256,
  stableStringify,
  standardsObjectKey,
  type IconArtifacts,
  type IconObjectKeys,
} from './brand-codec.js';
import {
  assertIconId,
  assertSlotId,
  cleanNote,
  parseDocument,
  parseStandards,
  parseVersionNumber,
} from './brand-input.js';
import type { BrandObjectStore } from './brand-object-store.js';
import type {
  BrandStore,
  BrandTransaction,
  IconRow,
  PublishedSlotEntry,
  SlotRow,
  VersionRow,
} from './brand-store.js';

export interface BrandActor {
  readonly userId: string;
}

export interface BrandServiceOptions {
  /** `BRAND_ICON_PUBLIC_READ`: bản đã phát hành đọc công khai (mặc định bật). Đọc ở mỗi request. */
  readonly publicRead?: () => boolean;
  readonly now?: () => Date;
}

/** Người đang đọc SVG: quản trị Platform, người dùng đã đăng nhập khác, hoặc chưa đăng nhập. */
export type SvgViewer = 'admin' | 'user' | 'anonymous';

export interface SvgQuery {
  /** Phiên bản cụ thể; vắng mặt là bản đang phát hành (hoặc bản mới nhất nếu là quản trị và chưa phát hành). */
  readonly version: number | null;
  readonly mode: BrandSvgMode;
}

export type SvgResult =
  | {
      readonly notModified: true;
      readonly etag: string;
      readonly cacheControl: string;
    }
  | {
      readonly notModified: false;
      readonly etag: string;
      readonly cacheControl: string;
      readonly body: string;
      readonly filename: string;
    };

export type SlotManifestResult =
  | {
      readonly notModified: true;
      readonly etag: string;
      readonly cacheControl: string;
    }
  | {
      readonly notModified: false;
      readonly etag: string;
      readonly cacheControl: string;
      readonly manifest: BrandSlotManifestResponse;
    };

const JSON_TYPE = 'application/json; charset=utf-8';
const SVG_TYPE = 'image/svg+xml; charset=utf-8';
/** Dư địa cho object đọc lại: spec đã được giới hạn lúc ghi, SVG dựng ra có thể lớn hơn spec. */
const OBJECT_READ_LIMIT = 4 * BRAND_SPEC_MAX_BYTES;
const STANDARDS_MAX_BYTES = 64 * 1024;
const OBJECT_CACHE_ENTRIES = 128;
const IMMUTABLE = 'max-age=31536000, immutable';

const logger = new Logger('BrandIconService');

const toSummary = (row: IconRow): BrandIconSummary => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  category: row.category,
  status: row.status,
  tags: row.tags,
  currentVersion: row.currentVersion,
  publishedVersion: row.publishedVersion,
  hasUnpublishedChanges:
    row.status === 'published' && row.publishedVersion !== row.currentVersion,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toVersion = (row: VersionRow): BrandIconVersion => ({
  version: row.version,
  specSha256: row.specSha256,
  sizeBytes: row.sizeBytes,
  standardsVersion: row.standardsVersion,
  note: row.note,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
});

const toSlotAssignment = (row: SlotRow): BrandSlotAssignment => ({
  slot: row.slot as IconSlotId,
  iconId: row.iconId,
  iconName: row.iconName,
  iconSlug: row.iconSlug,
  iconStatus: row.iconStatus,
  publishedVersion: row.publishedVersion,
  currentVersion: row.currentVersion,
  updatedBy: row.updatedBy,
  updatedAt: row.updatedAt,
});

/** Bản phát hành công khai: icon đang `published` và phiên bản không vượt `publishedVersion`. */
function isLive(icon: IconRow, version: number | null): version is number {
  return (
    version !== null &&
    icon.status === 'published' &&
    icon.publishedVersion !== null &&
    version <= icon.publishedVersion
  );
}

/** So `If-None-Match` với ETag hiện hành (so yếu, nhận danh sách và `*`). */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
}

export class BrandIconService {
  /** Quy chuẩn theo phiên bản; object đã ghi thì bất biến nên giữ vô thời hạn. */
  private readonly standardsCache = new Map<number, BrandStandardsPayload>();
  /** Nội dung SVG theo khoá object (bất biến); bỏ mục cũ nhất khi đầy. */
  private readonly objectCache = new Map<string, string>();

  constructor(
    private readonly store: BrandStore,
    private readonly objects: BrandObjectStore,
    private readonly options: BrandServiceOptions = {},
  ) {}

  /* ------------------------------------------------------------------ đọc */

  list(statuses?: readonly BrandIconStatus[]): Promise<BrandIconListResponse> {
    return this.guard(async () => ({
      icons: (await this.store.listIcons(statuses)).map(toSummary),
    }));
  }

  detail(id: string): Promise<BrandIconDetail> {
    return this.guard(async () => {
      assertIconId(id);
      const icon = await this.store.findIcon(id);
      if (!icon) throw brandErrors.iconNotFound();
      const versions = await this.store.listVersions(id);
      return { ...toSummary(icon), versions: versions.map(toVersion) };
    });
  }

  /** Tài liệu để mở lại sửa; `version` vắng mặt là phiên bản mới nhất. */
  spec(id: string, version: number | null): Promise<BrandIconSpecResponse> {
    return this.guard(async () => {
      assertIconId(id);
      const icon = await this.store.findIcon(id);
      if (!icon) throw brandErrors.iconNotFound();
      const wanted = version ?? icon.currentVersion;
      const row = await this.store.findVersion(id, wanted);
      if (!row) throw brandErrors.versionNotFound();
      const document = await this.readSpecDocument(row);
      return {
        // `status` trong tài liệu phản ánh đúng bản đang phát hành; trạng thái thật nằm trong DB.
        document: {
          ...document,
          status:
            icon.status === 'published' && icon.publishedVersion === wanted
              ? 'published'
              : 'draft',
        },
        version: wanted,
        specSha256: row.specSha256,
        iconStatus: icon.status,
      };
    });
  }

  standards(): Promise<BrandStandardsResponse> {
    return this.guard(() => this.currentStandards());
  }

  /**
   * Đọc SVG đã dựng sẵn. Bản đang phát hành đọc công khai (trừ khi `BRAND_ICON_PUBLIC_READ=false`, khi đó cần
   * đăng nhập); bản nháp, bản lưu trữ và phiên bản mới hơn bản phát hành chỉ quản trị Platform đọc được.
   * `viewer` chỉ được gọi khi bản đọc không công khai, để bản công khai không tốn kiểm tra phiên.
   */
  readSvg(
    id: string,
    query: SvgQuery,
    viewer: () => Promise<SvgViewer>,
    ifNoneMatch?: string,
  ): Promise<SvgResult> {
    return this.guard(async () => {
      assertIconId(id);
      const publicRead = this.options.publicRead?.() ?? true;
      const icon = await this.store.findIcon(id);
      const liveVersion = icon
        ? (query.version ?? icon.publishedVersion)
        : null;

      let isPublic = false;
      let version: number;
      if (icon && publicRead && isLive(icon, liveVersion)) {
        isPublic = true;
        version = liveVersion;
      } else {
        const reader = await viewer();
        if (reader === 'anonymous')
          throw publicRead
            ? brandErrors.iconNotFound()
            : brandErrors.unauthorized();
        if (!icon) throw brandErrors.iconNotFound();
        const wanted =
          query.version ??
          (reader === 'admin' ? icon.currentVersion : icon.publishedVersion);
        // Người đã đăng nhập nhưng không phải quản trị chỉ đọc được bản đang phát hành.
        if (wanted === null || (reader !== 'admin' && !isLive(icon, wanted)))
          throw brandErrors.iconNotFound();
        version = wanted;
      }
      if (!icon) throw brandErrors.iconNotFound();

      const row = await this.store.findVersion(id, version);
      if (!row) throw brandErrors.versionNotFound();

      const scope = isPublic ? 'public' : 'private';
      const cacheControl =
        query.version !== null
          ? `${scope}, ${IMMUTABLE}`
          : isPublic
            ? 'public, max-age=300'
            : 'private, no-cache';
      return this.serveSvgVersion(
        row,
        query.mode,
        cacheControl,
        `${icon.slug}${query.mode === 'mono' ? '.mono' : ''}.svg`,
        ifNoneMatch,
      );
    });
  }

  /* --------------------------------------------------------------- vị trí */

  listSlots(): Promise<BrandSlotListResponse> {
    return this.guard(async () => ({
      slots: (await this.store.listSlots())
        .filter((row) => isIconSlotId(row.slot))
        .map(toSlotAssignment),
    }));
  }

  assignSlot(
    actor: BrandActor,
    slot: string,
    input: { readonly iconId?: unknown },
  ): Promise<BrandSlotAssignment> {
    return this.guard(async () => {
      assertSlotId(slot);
      assertIconId(input.iconId);
      const iconId = input.iconId;
      const now = this.now().toISOString();
      return this.store.transaction(async (tx) => {
        const icon = await tx.lockIcon(iconId);
        if (!icon) throw brandErrors.iconNotFound();
        if (icon.status !== 'published' || icon.publishedVersion === null) {
          throw brandErrors.slotIconNotPublished();
        }
        const row = await tx.upsertSlot(slot, iconId, actor.userId, now);
        await tx.audit('platform.brand-slot.assigned', actor.userId, {
          slot,
          iconId,
          publishedVersion: icon.publishedVersion,
        });
        return toSlotAssignment(row);
      });
    });
  }

  clearSlot(
    actor: BrandActor,
    slot: string,
  ): Promise<{ readonly slot: IconSlotId; readonly cleared: boolean }> {
    return this.guard(async () => {
      assertSlotId(slot);
      return this.store.transaction(async (tx) => {
        const cleared = await tx.deleteSlot(slot);
        if (cleared) {
          await tx.audit('platform.brand-slot.cleared', actor.userId, { slot });
        }
        return { slot, cleared };
      });
    });
  }

  slotManifest(
    viewer: () => Promise<SvgViewer>,
    ifNoneMatch?: string,
  ): Promise<SlotManifestResult> {
    return this.guard(async () => {
      const publicRead = this.options.publicRead?.() ?? true;
      if (!publicRead) {
        const reader = await viewer();
        if (reader === 'anonymous') throw brandErrors.unauthorized();
      }
      const cacheControl = publicRead
        ? 'public, max-age=60, must-revalidate'
        : 'private, no-cache';

      const entries = (await this.store.listPublishedSlotEntries()).filter(
        (entry): entry is PublishedSlotEntry & { readonly slot: IconSlotId } =>
          isIconSlotId(entry.slot),
      );
      const signature = entries.map((entry) => {
        const meta = getIconSlotMeta(entry.slot)!;
        return `${entry.slot}:${entry.iconId}:${entry.publishedVersion}:${entry.specSha256}:${entry.standardsVersion}:${meta.colorMode}`;
      });
      const hash = sha256Hex(JSON.stringify(signature));
      const etag = `"${hash}"`;
      if (etagMatches(ifNoneMatch, etag)) {
        return { notModified: true, etag, cacheControl };
      }

      const needsBrandPalette = entries.some(
        (entry) => getIconSlotMeta(entry.slot)?.colorMode !== 'mono',
      );
      const palette = needsBrandPalette
        ? (await this.currentStandards()).palette
        : DEFAULT_PALETTE;

      const slots: Record<string, BrandSlotManifestItem> = {};
      for (const entry of entries) {
        const meta = getIconSlotMeta(entry.slot)!;
        const doc = await this.readSpecDocument({ specKey: entry.specKey });
        const model = buildIconModel(doc, {
          colorMode: meta.colorMode === 'mono' ? 'currentColor' : 'brand',
          palette,
          idPrefix: slotSymbolId(entry.slot),
        });
        slots[entry.slot] = {
          slot: entry.slot,
          iconId: entry.iconId,
          version: entry.publishedVersion,
          colorMode: meta.colorMode,
          model,
        };
      }
      return {
        notModified: false,
        etag,
        cacheControl,
        manifest: { hash, slots },
      };
    });
  }

  readSlotSvg(
    slot: string,
    viewer: () => Promise<SvgViewer>,
    ifNoneMatch?: string,
  ): Promise<SvgResult> {
    return this.guard(async () => {
      assertSlotId(slot);
      const publicRead = this.options.publicRead?.() ?? true;
      if (!publicRead) {
        const reader = await viewer();
        if (reader === 'anonymous') throw brandErrors.unauthorized();
      }
      const slotRow = await this.store.findSlot(slot);
      if (
        !slotRow ||
        slotRow.iconStatus !== 'published' ||
        slotRow.publishedVersion === null
      ) {
        throw brandErrors.slotNotFound();
      }
      const version = await this.store.findVersion(
        slotRow.iconId,
        slotRow.publishedVersion,
      );
      if (!version) throw brandErrors.versionNotFound();

      const meta = getIconSlotMeta(slot)!;
      const cacheControl = publicRead
        ? 'public, max-age=60, must-revalidate'
        : 'private, no-cache';
      return this.serveSvgVersion(
        version,
        meta.colorMode,
        cacheControl,
        `${slot}${meta.colorMode === 'mono' ? '.mono' : ''}.svg`,
        ifNoneMatch,
      );
    });
  }

  /* ----------------------------------------------------------------- ghi */

  /** Tạo icon mới ở phiên bản 1; mã icon do client chọn. */
  create(
    actor: BrandActor,
    input: { readonly document?: unknown; readonly note?: unknown },
  ): Promise<SaveBrandIconResponse> {
    return this.guard(async () => {
      const document = parseDocument(input.document);
      const note = cleanNote(input.note);
      const standards = await this.currentStandards();
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await this.createOnce(actor, document, note, standards);
        } catch (error) {
          // Hai người tạo icon trùng tên cùng lúc: thử lại để chọn hậu tố slug khác.
          if (
            error instanceof BrandStoreConflictError &&
            error.kind === 'slug' &&
            attempt < 3
          )
            continue;
          throw error;
        }
      }
    });
  }

  /**
   * Lưu phiên bản mới. `baseVersion` phải là bản hiện hành, trừ khi nội dung giống hệt bản hiện hành (gửi lại
   * sau khi mất phản hồi): khi đó trả về bản hiện hành, không tạo phiên bản.
   */
  update(
    actor: BrandActor,
    id: string,
    input: {
      readonly document?: unknown;
      readonly baseVersion?: unknown;
      readonly note?: unknown;
    },
  ): Promise<SaveBrandIconResponse> {
    return this.guard(async () => {
      assertIconId(id);
      const document = parseDocument(input.document);
      if (document.id !== id) throw brandErrors.iconIdMismatch();
      const baseVersion = parseVersionNumber(input.baseVersion, 'baseVersion');
      const note = cleanNote(input.note);
      const standards = await this.currentStandards();
      const sha = specSha256(document);
      const now = this.now();

      return this.writeTransaction(async (tx, track) => {
        const icon = await tx.lockIcon(id);
        if (!icon) throw brandErrors.iconNotFound();
        if (icon.status === 'archived') throw brandErrors.iconArchived();
        const current = await tx.getVersion(id, icon.currentVersion);
        if (!current) throw brandErrors.storageCorrupt();

        if (
          current.specSha256 === sha &&
          current.standardsVersion === standards.version
        ) {
          return {
            icon: toSummary(icon),
            version: toVersion(current),
            unchanged: true,
          };
        }
        if (baseVersion !== icon.currentVersion)
          throw brandErrors.versionConflict(icon.currentVersion);

        const next = icon.currentVersion + 1;
        const nowIso = now.toISOString();
        const build = buildIconArtifacts(document, {
          palette: standards.palette,
          createdAt: icon.createdAt,
          updatedAt: nowIso,
        });
        this.assertSize(build);
        const keys = iconObjectKeys(id, next);
        await this.putIconObjects(keys, build, track);
        const version = await tx.insertVersion({
          iconId: id,
          version: next,
          specKey: keys.spec,
          svgKey: keys.svg,
          monoSvgKey: keys.monoSvg,
          specSha256: build.specSha256,
          sizeBytes: build.sizeBytes,
          standardsVersion: standards.version,
          note,
          createdBy: actor.userId,
          now: nowIso,
        });
        const saved = await tx.saveHead(id, {
          name: document.name,
          category: document.category,
          tags: document.tags,
          currentVersion: next,
          now: nowIso,
        });
        await tx.audit('platform.brand-icon.updated', actor.userId, {
          iconId: id,
          version: next,
        });
        return {
          icon: toSummary(saved),
          version: toVersion(version),
          unchanged: false,
        };
      });
    });
  }

  /** Phát hành phiên bản hiện hành. Chặn khi icon còn lỗi nặng theo quy chuẩn (ví dụ chưa có hình nào hiển thị). */
  publish(actor: BrandActor, id: string): Promise<BrandIconSummary> {
    return this.guard(async () => {
      assertIconId(id);
      const standards = await this.currentStandards();
      const now = this.now().toISOString();
      return this.store.transaction(async (tx) => {
        const icon = await this.lockUsable(tx, id);
        if (
          icon.status === 'published' &&
          icon.publishedVersion === icon.currentVersion
        )
          return toSummary(icon);
        const row = await tx.getVersion(id, icon.currentVersion);
        if (!row) throw brandErrors.storageCorrupt();
        const document = await this.readSpecDocument(row);
        const blocking = checkCompliance(
          document,
          standards.palette,
          standards.rules,
        )
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message);
        if (blocking.length > 0) throw brandErrors.iconNotPublishable(blocking);
        const updated = await tx.setState(id, {
          status: 'published',
          publishedVersion: icon.currentVersion,
          now,
        });
        await tx.audit('platform.brand-icon.published', actor.userId, {
          iconId: id,
          version: icon.currentVersion,
        });
        return toSummary(updated);
      });
    });
  }

  /** Gỡ phát hành: icon về nháp; các phiên bản vẫn còn nhưng không còn đọc công khai. */
  unpublish(actor: BrandActor, id: string): Promise<BrandIconSummary> {
    return this.changeState(
      actor,
      id,
      'platform.brand-icon.unpublished',
      (icon) =>
        icon.status === 'published'
          ? { status: 'draft', publishedVersion: null }
          : null,
    );
  }

  /** Lưu trữ icon (không xoá object, không xoá phiên bản). Icon đang phát hành thì bị gỡ phát hành. */
  archive(actor: BrandActor, id: string): Promise<BrandIconSummary> {
    return this.changeState(
      actor,
      id,
      'platform.brand-icon.archived',
      (icon) =>
        icon.status === 'archived'
          ? null
          : { status: 'archived', publishedVersion: null },
    );
  }

  /** Khôi phục icon đã lưu trữ về nháp (không tự phát hành lại). */
  restore(actor: BrandActor, id: string): Promise<BrandIconSummary> {
    return this.changeState(
      actor,
      id,
      'platform.brand-icon.restored',
      (icon) =>
        icon.status === 'archived'
          ? { status: 'draft', publishedVersion: null }
          : null,
    );
  }

  /** Lưu bảng màu và quy chuẩn thành phiên bản mới. `baseVersion` là bản người dùng đã mở (0 khi chưa lưu lần nào). */
  saveStandards(
    actor: BrandActor,
    input: {
      readonly palette?: unknown;
      readonly rules?: unknown;
      readonly baseVersion?: unknown;
    },
  ): Promise<SaveBrandStandardsResponse> {
    return this.guard(async () => {
      const payload = parseStandards(input);
      const baseVersion = parseVersionNumber(
        input.baseVersion,
        'baseVersion',
        true,
      );
      const sha = sha256Hex(stableStringify(payload));
      const nowIso = this.now().toISOString();

      const saved = await this.writeTransaction(
        async (tx, track): Promise<SaveBrandStandardsResponse> => {
          const row = await tx.lockStandards();
          if (row.currentVersion > 0 && row.specSha256 === sha) {
            return {
              version: row.currentVersion,
              ...payload,
              updatedBy: row.updatedBy,
              updatedAt: row.updatedAt,
              unchanged: true,
            };
          }
          if (baseVersion !== row.currentVersion)
            throw brandErrors.standardsConflict(row.currentVersion);

          const next = row.currentVersion + 1;
          const key = standardsObjectKey(next);
          const json = JSON.stringify({
            schema: 1,
            palette: payload.palette,
            rules: payload.rules,
          });
          const sizeBytes = Buffer.byteLength(json, 'utf8');
          if (sizeBytes > STANDARDS_MAX_BYTES)
            throw brandErrors.payloadTooLarge();
          track(key);
          await this.objects.put(key, JSON_TYPE, json);
          const updated = await tx.updateStandards({
            currentVersion: next,
            specKey: key,
            specSha256: sha,
            sizeBytes,
            updatedBy: actor.userId,
            now: nowIso,
          });
          await tx.audit('platform.brand-standards.updated', actor.userId, {
            version: next,
          });
          return {
            version: next,
            ...payload,
            updatedBy: updated.updatedBy,
            updatedAt: updated.updatedAt,
            unchanged: false,
          };
        },
      );
      if (!saved.unchanged) this.standardsCache.set(saved.version, payload);
      return saved;
    });
  }

  /* ----------------------------------------------------------- nội bộ */

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async createOnce(
    actor: BrandActor,
    document: IconDocument,
    note: string | null,
    standards: BrandStandardsResponse,
  ): Promise<SaveBrandIconResponse> {
    const nowIso = this.now().toISOString();
    const build = buildIconArtifacts(document, {
      palette: standards.palette,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    this.assertSize(build);
    return this.writeTransaction(async (tx, track) => {
      if ((await tx.countIcons()) >= LIMITS.maxIcons)
        throw brandErrors.iconLimitReached();
      const slug = await tx.freeSlug(slugify(document.name));
      // Chèn hàng icon trước khi ghi object: hai người tạo cùng mã thì người sau bị chặn ở đây, chưa đụng tới kho.
      const icon = await tx.insertIcon({
        id: document.id,
        slug,
        name: document.name,
        category: document.category,
        tags: document.tags,
        createdBy: actor.userId,
        now: nowIso,
      });
      const keys = iconObjectKeys(document.id, 1);
      await this.putIconObjects(keys, build, track);
      const version = await tx.insertVersion({
        iconId: document.id,
        version: 1,
        specKey: keys.spec,
        svgKey: keys.svg,
        monoSvgKey: keys.monoSvg,
        specSha256: build.specSha256,
        sizeBytes: build.sizeBytes,
        standardsVersion: standards.version,
        note,
        createdBy: actor.userId,
        now: nowIso,
      });
      await tx.audit('platform.brand-icon.created', actor.userId, {
        iconId: document.id,
        version: 1,
      });
      return {
        icon: toSummary(icon),
        version: toVersion(version),
        unchanged: false,
      };
    });
  }

  /** Khoá hàng icon và bảo đảm còn dùng được (có tồn tại, chưa lưu trữ). */
  private async lockUsable(tx: BrandTransaction, id: string): Promise<IconRow> {
    const icon = await tx.lockIcon(id);
    if (!icon) throw brandErrors.iconNotFound();
    if (icon.status === 'archived') throw brandErrors.iconArchived();
    return icon;
  }

  private changeState(
    actor: BrandActor,
    id: string,
    action: string,
    next: (
      icon: IconRow,
    ) => { status: BrandIconStatus; publishedVersion: number | null } | null,
  ): Promise<BrandIconSummary> {
    return this.guard(async () => {
      assertIconId(id);
      const now = this.now().toISOString();
      return this.store.transaction(async (tx) => {
        const icon = await tx.lockIcon(id);
        if (!icon) throw brandErrors.iconNotFound();
        const change = next(icon);
        if (!change) return toSummary(icon);
        const updated = await tx.setState(id, { ...change, now });
        await tx.audit(action, actor.userId, {
          iconId: id,
          status: change.status,
        });
        return toSummary(updated);
      });
    });
  }

  /**
   * Chạy `work` trong giao dịch DB và ghi nhớ các khoá object đã ghi. Hàng icon bị khoá suốt lúc ghi object nên
   * không ai khác dùng được cùng số phiên bản, và việc dọn khi lỗi chỉ xoá object của chính lần ghi này.
   * Lỗi xảy ra trước khi `work` xong thì xoá object vừa ghi (cố gắng, không che lỗi gốc). Lỗi sau đó (lúc chốt
   * giao dịch) không rõ đã chốt hay chưa nên giữ nguyên object: dư một object mồ côi còn hơn mất dữ liệu đã chốt.
   */
  private async writeTransaction<T>(
    work: (tx: BrandTransaction, track: (key: string) => void) => Promise<T>,
  ): Promise<T> {
    const written: string[] = [];
    let finished = false;
    try {
      return await this.store.transaction(async (tx) => {
        const result = await work(tx, (key) => written.push(key));
        finished = true;
        return result;
      });
    } catch (error) {
      if (!finished) await this.discard(written);
      else if (written.length > 0) {
        logger.warn(
          `Giao dịch báo lỗi sau khi ghi xong; giữ lại ${written.length} object: ${written.join(', ')}`,
        );
      }
      throw error;
    }
  }

  private async discard(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      const { failed } = await this.objects.remove(keys);
      if (failed.length > 0)
        logger.warn(`Không xoá được object mồ côi: ${failed.join(', ')}`);
    } catch (error) {
      logger.warn(
        `Không dọn được object mồ côi (${keys.join(', ')}): ${(error as Error)?.message ?? error}`,
      );
    }
  }

  /** Ghi tuần tự (không song song) để lúc dọn không còn lệnh ghi nào đang dở. */
  private async putIconObjects(
    keys: IconObjectKeys,
    build: IconArtifacts,
    track: (key: string) => void,
  ): Promise<void> {
    const files: readonly (readonly [string, string, string])[] = [
      [keys.spec, JSON_TYPE, build.specJson],
      [keys.svg, SVG_TYPE, build.svg],
      [keys.monoSvg, SVG_TYPE, build.monoSvg],
    ];
    for (const [key, contentType, body] of files) {
      track(key);
      await this.objects.put(key, contentType, body);
    }
  }

  private assertSize(build: IconArtifacts): void {
    if (build.sizeBytes > BRAND_SPEC_MAX_BYTES)
      throw brandErrors.payloadTooLarge();
  }

  private async serveSvgVersion(
    row: Pick<
      VersionRow,
      'specSha256' | 'standardsVersion' | 'svgKey' | 'monoSvgKey'
    >,
    mode: BrandSvgMode,
    cacheControl: string,
    filename: string,
    ifNoneMatch?: string,
  ): Promise<SvgResult> {
    // Cùng spec, cùng bảng màu và cùng chế độ thì SVG giống hệt, nên không cần đọc kho để trả 304.
    const etag =
      mode === 'mono'
        ? `"${row.specSha256}-mono"`
        : `"${row.specSha256}-brand-s${row.standardsVersion}"`;
    if (etagMatches(ifNoneMatch, etag))
      return { notModified: true, etag, cacheControl };

    const body = await this.readObject(
      mode === 'mono' ? row.monoSvgKey : row.svgKey,
      OBJECT_READ_LIMIT,
    );
    return {
      notModified: false,
      etag,
      cacheControl,
      body,
      filename,
    };
  }

  private async readSpecDocument(
    row: Pick<VersionRow, 'specKey'>,
  ): Promise<IconDocument> {
    const text = await this.readObject(row.specKey, OBJECT_READ_LIMIT, false);
    try {
      const document = normalizeDocument(JSON.parse(text));
      if (document) return document;
    } catch {
      // rơi xuống lỗi bên dưới
    }
    logger.error(`spec.json không hợp lệ: ${row.specKey}`);
    throw brandErrors.storageCorrupt();
  }

  /** Đọc object (có thể qua bộ nhớ đệm); thiếu object mà DB còn trỏ tới là dữ liệu hỏng. */
  private async readObject(
    key: string,
    maxBytes: number,
    cache = true,
  ): Promise<string> {
    const cached = cache ? this.objectCache.get(key) : undefined;
    if (cached !== undefined) {
      this.objectCache.delete(key);
      this.objectCache.set(key, cached);
      return cached;
    }
    const content = await this.objects.get(key, maxBytes);
    if (!content) {
      logger.error(`Thiếu object mà DB còn trỏ tới: ${key}`);
      throw brandErrors.storageCorrupt();
    }
    if (cache) {
      this.objectCache.set(key, content.text);
      if (this.objectCache.size > OBJECT_CACHE_ENTRIES) {
        const oldest = this.objectCache.keys().next().value;
        if (oldest !== undefined) this.objectCache.delete(oldest);
      }
    }
    return content.text;
  }

  private async currentStandards(): Promise<BrandStandardsResponse> {
    const row = await this.store.getStandards();
    if (row.currentVersion === 0 || !row.specKey) {
      return {
        version: 0,
        palette: DEFAULT_PALETTE,
        rules: DEFAULT_RULES,
        updatedBy: null,
        updatedAt: null,
      };
    }
    let payload = this.standardsCache.get(row.currentVersion);
    if (!payload) {
      const text = await this.readObject(
        row.specKey,
        STANDARDS_MAX_BYTES,
        false,
      );
      try {
        const raw = JSON.parse(text) as { palette?: unknown; rules?: unknown };
        payload = {
          palette: normalizePalette(raw.palette),
          rules: normalizeRules(raw.rules),
        };
      } catch {
        logger.error(`Quy chuẩn không hợp lệ: ${row.specKey}`);
        throw brandErrors.storageCorrupt();
      }
      this.standardsCache.set(row.currentVersion, payload);
    }
    return {
      version: row.currentVersion,
      ...payload,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }

  /** Đổi mọi lỗi về `BrandError`; lỗi lạ ghi vào nhật ký máy chủ và chỉ trả thông điệp chung cho client. */
  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): BrandError {
    if (error instanceof BrandError) return error;
    if (error instanceof BrandStoreBusyError) return brandErrors.iconBusy();
    if (error instanceof BrandStoreConflictError) {
      if (error.kind === 'id') return brandErrors.iconExists();
      if (error.kind === 'version') return brandErrors.iconBusy();
    }
    logger.error(`Lỗi không lường trước: ${(error as Error)?.stack ?? error}`);
    return isDatabaseConnectionError(error)
      ? brandErrors.databaseUnavailable()
      : brandErrors.internal();
  }
}
