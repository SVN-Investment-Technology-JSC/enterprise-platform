import type {
  BrandIconStatus,
  BrandSvgMode,
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

/** Một dòng `brand_schema.icon_slots` kết hợp thông tin từ `brand_schema.icons`. */
export interface SlotRow {
  readonly slot: string;
  readonly iconId: string;
  readonly iconName: string;
  readonly iconSlug: string;
  readonly iconStatus: BrandIconStatus;
  readonly publishedVersion: number | null;
  readonly currentVersion: number;
  readonly updatedBy: string | null;
  readonly updatedAt: string;
}

/** Vị trí đang gán icon đã phát hành (`status = 'published'`), kèm thông tin phiên bản đang công khai. */
export interface PublishedSlotEntry {
  readonly slot: string;
  readonly iconId: string;
  readonly iconSlug: string;
  readonly publishedVersion: number;
  readonly specKey: string;
  readonly svgKey: string;
  readonly monoSvgKey: string;
  readonly specSha256: string;
  readonly standardsVersion: number;
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
  deleteIcon(id: string): Promise<void>;
  /** Khoá dòng quy chuẩn (tạo nếu chưa có) tới hết giao dịch. */
  lockStandards(): Promise<StandardsRow>;
  updateStandards(input: StandardsUpdateInput): Promise<StandardsRow>;
  upsertSlot(
    slot: string,
    iconId: string,
    actorId: string,
    now: string,
  ): Promise<SlotRow>;
  /** Trả true nếu có dòng bị xoá, false nếu vị trí vốn chưa được gán. */
  deleteSlot(slot: string): Promise<boolean>;
  audit(
    action: string,
    actorId: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

export interface CustomSlotRow {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly groupKey: string;
  readonly colorMode: BrandSvgMode;
  readonly recommendedSize: number;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CustomSlotInput {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly groupKey: string;
  readonly colorMode: BrandSvgMode;
  readonly recommendedSize: number;
  readonly createdBy?: string | null;
}

/** Một dòng `brand_schema.slot_groups` (chỉ nhóm tùy chỉnh; nhóm có sẵn nằm trong code). */
export interface SlotGroupRow {
  readonly key: string;
  readonly label: string;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SlotGroupInput {
  readonly key: string;
  readonly label: string;
  readonly createdBy?: string | null;
}

/** Giá trị ghi đè của một vị trí có sẵn; null là không ghi đè trường đó (dùng mặc định trong code). */
export interface SlotOverrideValues {
  readonly label: string | null;
  readonly description: string | null;
  readonly groupKey: string | null;
  readonly colorMode: BrandSvgMode | null;
  readonly recommendedSize: number | null;
}

/** Một dòng `brand_schema.slot_overrides`. */
export interface SlotOverrideRow extends SlotOverrideValues {
  readonly slotId: string;
  readonly updatedBy: string | null;
  readonly updatedAt: string;
}

/** Cổng dữ liệu của Brand Studio; hiện thực thật là `PgBrandStore`. */
export interface BrandStore {
  listIcons(statuses?: readonly BrandIconStatus[]): Promise<readonly IconRow[]>;
  findIcon(id: string): Promise<IconRow | null>;
  /** Mới nhất trước. */
  listVersions(iconId: string): Promise<readonly VersionRow[]>;
  findVersion(iconId: string, version: number): Promise<VersionRow | null>;
  getStandards(): Promise<StandardsRow>;
  listSlots(): Promise<readonly SlotRow[]>;
  findSlot(slot: string): Promise<SlotRow | null>;
  listPublishedSlotEntries(): Promise<readonly PublishedSlotEntry[]>;
  listCustomSlots(): Promise<readonly CustomSlotRow[]>;
  findCustomSlot(id: string): Promise<CustomSlotRow | null>;
  createCustomSlot(input: CustomSlotInput): Promise<CustomSlotRow>;
  updateCustomSlot(
    id: string,
    patch: Partial<Omit<CustomSlotInput, 'id' | 'createdBy'>>,
  ): Promise<CustomSlotRow | null>;
  deleteCustomSlot(id: string): Promise<boolean>;
  listSlotOverrides(): Promise<readonly SlotOverrideRow[]>;
  findSlotOverride(slotId: string): Promise<SlotOverrideRow | null>;
  /** Lưu ghi đè của vị trí có sẵn. Mọi giá trị null thì xoá hàng và trả null. */
  saveSlotOverride(
    slotId: string,
    values: SlotOverrideValues,
    updatedBy: string | null,
  ): Promise<SlotOverrideRow | null>;
  /** Trả true nếu có hàng bị xoá. */
  deleteSlotOverride(slotId: string): Promise<boolean>;
  /** Nhóm tùy chỉnh, sắp theo tên hiển thị. */
  listSlotGroups(): Promise<readonly SlotGroupRow[]>;
  findSlotGroup(key: string): Promise<SlotGroupRow | null>;
  /** Ném `BrandStoreConflictError('key')` khi trùng mã nhóm. */
  createSlotGroup(input: SlotGroupInput): Promise<SlotGroupRow>;
  updateSlotGroup(key: string, label: string): Promise<SlotGroupRow | null>;
  deleteSlotGroup(key: string): Promise<boolean>;
  /**
   * Chạy `work` trong một giao dịch: hoàn tất thì chốt, ném lỗi thì huỷ. Có thể ném `BrandStoreBusyError`
   * khi không lấy được khoá hàng trong thời hạn.
   */
  transaction<T>(work: (tx: BrandTransaction) => Promise<T>): Promise<T>;
}
