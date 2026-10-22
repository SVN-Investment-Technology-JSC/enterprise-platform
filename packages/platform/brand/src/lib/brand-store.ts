import type {
  BrandIconStatus,
  IconCategory,
} from '@enterprise-platform/shared-brand-icon';

/** Một dòng `brand_schema.icons`; thời điểm là chuỗi ISO. */
export interface IconRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly category: IconCategory;
  readonly status: BrandIconStatus;
  readonly tags: readonly string[];
  readonly currentVersion: number;
  readonly publishedVersion: number | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Một dòng `brand_schema.icon_versions`. */
export interface VersionRow {
  readonly iconId: string;
  readonly version: number;
  readonly specKey: string;
  readonly svgKey: string;
  readonly monoSvgKey: string;
  readonly specSha256: string;
  readonly sizeBytes: number;
  readonly standardsVersion: number;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

/** Dòng duy nhất của `brand_schema.standards`; `currentVersion` 0 là chưa lưu lần nào. */
export interface StandardsRow {
  readonly currentVersion: number;
  readonly specKey: string | null;
  readonly specSha256: string | null;
  readonly sizeBytes: number;
  readonly updatedBy: string | null;
  readonly updatedAt: string | null;
}

export interface NewIconInput {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly category: IconCategory;
  readonly tags: readonly string[];
  readonly createdBy: string;
  readonly now: string;
}

export interface SavedHeadInput {
  readonly name: string;
  readonly category: IconCategory;
  readonly tags: readonly string[];
  readonly currentVersion: number;
  readonly now: string;
}

export interface IconStateInput {
  readonly status: BrandIconStatus;
  readonly publishedVersion: number | null;
  readonly now: string;
}

export interface NewVersionInput {
  readonly iconId: string;
  readonly version: number;
  readonly specKey: string;
  readonly svgKey: string;
  readonly monoSvgKey: string;
  readonly specSha256: string;
  readonly sizeBytes: number;
  readonly standardsVersion: number;
  readonly note: string | null;
  readonly createdBy: string;
  readonly now: string;
}

export interface StandardsUpdateInput {
  readonly currentVersion: number;
  readonly specKey: string;
  readonly specSha256: string;
  readonly sizeBytes: number;
  readonly updatedBy: string;
  readonly now: string;
}

/** Thao tác trong một giao dịch DB; mọi thay đổi chỉ có hiệu lực khi giao dịch hoàn tất. */
export interface BrandTransaction {
  /** Khoá hàng icon tới hết giao dịch (`FOR UPDATE`); null khi không có. */
  lockIcon(id: string): Promise<IconRow | null>;
  countIcons(): Promise<number>;
  /** Mã đọc được chưa ai dùng, dẫn từ `base` và thêm hậu tố số nếu trùng. */
  freeSlug(base: string): Promise<string>;
  /** Ném `BrandStoreConflictError` khi trùng mã hoặc trùng slug. */
  insertIcon(input: NewIconInput): Promise<IconRow>;
  getVersion(iconId: string, version: number): Promise<VersionRow | null>;
  insertVersion(input: NewVersionInput): Promise<VersionRow>;
  saveHead(id: string, input: SavedHeadInput): Promise<IconRow>;
  setState(id: string, input: IconStateInput): Promise<IconRow>;
  /** Khoá dòng quy chuẩn (tạo nếu chưa có) tới hết giao dịch. */
  lockStandards(): Promise<StandardsRow>;
  updateStandards(input: StandardsUpdateInput): Promise<StandardsRow>;
  audit(
    action: string,
    actorId: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

/** Cổng dữ liệu của Brand Studio; hiện thực thật là `PgBrandStore`. */
export interface BrandStore {
  listIcons(statuses?: readonly BrandIconStatus[]): Promise<readonly IconRow[]>;
  findIcon(id: string): Promise<IconRow | null>;
  /** Mới nhất trước. */
  listVersions(iconId: string): Promise<readonly VersionRow[]>;
  findVersion(iconId: string, version: number): Promise<VersionRow | null>;
  getStandards(): Promise<StandardsRow>;
  /**
   * Chạy `work` trong một giao dịch: hoàn tất thì chốt, ném lỗi thì huỷ. Có thể ném `BrandStoreBusyError`
   * khi không lấy được khoá hàng trong thời hạn.
   */
  transaction<T>(work: (tx: BrandTransaction) => Promise<T>): Promise<T>;
}
