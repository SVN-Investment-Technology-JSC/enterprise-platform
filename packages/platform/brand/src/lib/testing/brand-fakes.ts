/**
 * Bản giả của hai cổng (DB và kho object) dùng cho test; không đưa vào `index.ts`.
 * `FakeBrandStore.transaction` mô phỏng giao dịch thật: chạy lần lượt (như khoá hàng), hoàn tác khi lỗi.
 */
import type { BrandIconStatus } from '@enterprise-platform/shared-brand-icon';
import { BrandStoreConflictError, brandErrors } from '../brand.errors.js';
import type {
  BrandObjectContent,
  BrandObjectStore,
} from '../brand-object-store.js';
import type {
  BrandStore,
  BrandTransaction,
  IconRow,
  IconStateInput,
  NewIconInput,
  NewVersionInput,
  PublishedSlotEntry,
  SavedHeadInput,
  SlotRow,
  StandardsRow,
  StandardsUpdateInput,
  VersionRow,
} from '../brand-store.js';

export interface AuditEntry {
  readonly action: string;
  readonly actorId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

const EMPTY_STANDARDS: StandardsRow = {
  currentVersion: 0,
  specKey: null,
  specSha256: null,
  sizeBytes: 0,
  updatedBy: null,
  updatedAt: null,
};

interface StoredSlot {
  readonly slot: string;
  readonly iconId: string;
  readonly updatedBy: string | null;
  readonly updatedAt: string;
}

interface State {
  icons: Map<string, IconRow>;
  versions: VersionRow[];
  standards: StandardsRow;
  slots: Map<string, StoredSlot>;
  audits: AuditEntry[];
}

export type FailPoint =
  | 'insertIcon'
  | 'insertVersion'
  | 'saveHead'
  | 'setState'
  | 'updateStandards'
  | 'upsertSlot'
  | 'deleteSlot'
  | 'audit';

export class FakeBrandStore implements BrandStore {
  private state: State = {
    icons: new Map(),
    versions: [],
    standards: EMPTY_STANDARDS,
    slots: new Map(),
    audits: [],
  };
  private tail: Promise<unknown> = Promise.resolve();
  /** Thao tác sẽ ném lỗi giả (mô phỏng DB hỏng giữa chừng). */
  failAt: FailPoint | null = null;
  /** Lỗi ở bước chốt giao dịch, sau khi `work` đã xong. */
  failCommit = false;
  /** Lỗi tuỳ ý cho thao tác đọc (để thử lỗi không lường trước). */
  failReads: Error | null = null;
  /** Lần `freeSlug` kế tiếp trả slug này dù đã có người dùng (mô phỏng hai người tạo cùng tên một lúc). */
  forcedSlug: string | null = null;
  transactions = 0;

  get icons(): readonly IconRow[] {
    return [...this.state.icons.values()];
  }
  get versions(): readonly VersionRow[] {
    return this.state.versions;
  }
  get audits(): readonly AuditEntry[] {
    return this.state.audits;
  }
  get standardsRow(): StandardsRow {
    return this.state.standards;
  }
  get slots(): readonly StoredSlot[] {
    return [...this.state.slots.values()];
  }

  async listIcons(
    statuses?: readonly BrandIconStatus[],
  ): Promise<readonly IconRow[]> {
    this.maybeFailRead();
    return this.icons
      .filter(
        (icon) =>
          !statuses || statuses.length === 0 || statuses.includes(icon.status),
      )
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      );
  }

  async findIcon(id: string): Promise<IconRow | null> {
    this.maybeFailRead();
    return this.state.icons.get(id) ?? null;
  }

  async listVersions(iconId: string): Promise<readonly VersionRow[]> {
    this.maybeFailRead();
    return this.state.versions
      .filter((row) => row.iconId === iconId)
      .sort((a, b) => b.version - a.version);
  }

  async findVersion(
    iconId: string,
    version: number,
  ): Promise<VersionRow | null> {
    this.maybeFailRead();
    return (
      this.state.versions.find(
        (row) => row.iconId === iconId && row.version === version,
      ) ?? null
    );
  }

  async getStandards(): Promise<StandardsRow> {
    this.maybeFailRead();
    return this.state.standards;
  }

  async listSlots(): Promise<readonly SlotRow[]> {
    this.maybeFailRead();
    const rows: SlotRow[] = [];
    for (const stored of this.state.slots.values()) {
      const icon = this.state.icons.get(stored.iconId);
      if (!icon) continue;
      rows.push(toFakeSlotRow(stored, icon));
    }
    return rows.sort((a, b) => a.slot.localeCompare(b.slot));
  }

  async findSlot(slot: string): Promise<SlotRow | null> {
    this.maybeFailRead();
    const stored = this.state.slots.get(slot);
    if (!stored) return null;
    const icon = this.state.icons.get(stored.iconId);
    return icon ? toFakeSlotRow(stored, icon) : null;
  }

  async listPublishedSlotEntries(): Promise<readonly PublishedSlotEntry[]> {
    this.maybeFailRead();
    const entries: PublishedSlotEntry[] = [];
    for (const stored of this.state.slots.values()) {
      const icon = this.state.icons.get(stored.iconId);
      if (!icon || icon.status !== 'published' || icon.publishedVersion === null)
        continue;
      const version = this.state.versions.find(
        (v) => v.iconId === icon.id && v.version === icon.publishedVersion,
      );
      if (!version) continue;
      entries.push({
        slot: stored.slot,
        iconId: icon.id,
        iconSlug: icon.slug,
        publishedVersion: icon.publishedVersion,
        specKey: version.specKey,
        svgKey: version.svgKey,
        monoSvgKey: version.monoSvgKey,
        specSha256: version.specSha256,
        standardsVersion: version.standardsVersion,
      });
    }
    return entries.sort((a, b) => a.slot.localeCompare(b.slot));
  }

  transaction<T>(work: (tx: BrandTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.transactions += 1;
      const snapshot: State = {
        icons: new Map(this.state.icons),
        versions: [...this.state.versions],
        standards: this.state.standards,
        slots: new Map(this.state.slots),
        audits: [...this.state.audits],
      };
      try {
        const result = await work(
          new FakeTransaction(
            this,
            (next) => (this.state = next),
            () => this.state,
          ),
        );
        if (this.failCommit) throw new Error('commit failed');
        return result;
      } catch (error) {
        this.state = snapshot;
        throw error;
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  shouldFail(point: FailPoint): boolean {
    return this.failAt === point;
  }

  takeForcedSlug(): string | null {
    const slug = this.forcedSlug;
    this.forcedSlug = null;
    return slug;
  }

  private maybeFailRead(): void {
    if (this.failReads) throw this.failReads;
  }
}

class FakeTransaction implements BrandTransaction {
  constructor(
    private readonly store: FakeBrandStore,
    private readonly write: (state: State) => void,
    private readonly read: () => State,
  ) {}

  private fail(point: FailPoint): void {
    if (this.store.shouldFail(point))
      throw new Error(`Injected failure at ${point}`);
  }

  async lockIcon(id: string): Promise<IconRow | null> {
    return this.read().icons.get(id) ?? null;
  }

  async countIcons(): Promise<number> {
    return this.read().icons.size;
  }

  async freeSlug(base: string): Promise<string> {
    const forced = this.store.takeForcedSlug();
    if (forced) return forced;
    const used = new Set(
      [...this.read().icons.values()].map((icon) => icon.slug),
    );
    if (!used.has(base)) return base;
    for (let n = 2; ; n += 1)
      if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  async insertIcon(input: NewIconInput): Promise<IconRow> {
    this.fail('insertIcon');
    const state = this.read();
    if (state.icons.has(input.id)) throw new BrandStoreConflictError('id');
    if ([...state.icons.values()].some((icon) => icon.slug === input.slug))
      throw new BrandStoreConflictError('slug');
    const row: IconRow = {
      id: input.id,
      slug: input.slug,
      name: input.name,
      category: input.category,
      status: 'draft',
      tags: input.tags,
      currentVersion: 1,
      publishedVersion: null,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.write({ ...state, icons: new Map(state.icons).set(row.id, row) });
    return row;
  }

  async getVersion(
    iconId: string,
    version: number,
  ): Promise<VersionRow | null> {
    return (
      this.read().versions.find(
        (row) => row.iconId === iconId && row.version === version,
      ) ?? null
    );
  }

  async insertVersion(input: NewVersionInput): Promise<VersionRow> {
    this.fail('insertVersion');
    const state = this.read();
    if (
      state.versions.some(
        (row) => row.iconId === input.iconId && row.version === input.version,
      )
    ) {
      throw new BrandStoreConflictError('version');
    }
    const row: VersionRow = {
      iconId: input.iconId,
      version: input.version,
      specKey: input.specKey,
      svgKey: input.svgKey,
      monoSvgKey: input.monoSvgKey,
      specSha256: input.specSha256,
      sizeBytes: input.sizeBytes,
      standardsVersion: input.standardsVersion,
      note: input.note,
      createdBy: input.createdBy,
      createdAt: input.now,
    };
    this.write({ ...state, versions: [...state.versions, row] });
    return row;
  }

  async saveHead(id: string, input: SavedHeadInput): Promise<IconRow> {
    this.fail('saveHead');
    return this.patch(id, {
      name: input.name,
      category: input.category,
      tags: input.tags,
      currentVersion: input.currentVersion,
      updatedAt: input.now,
    });
  }

  async setState(id: string, input: IconStateInput): Promise<IconRow> {
    this.fail('setState');
    return this.patch(id, {
      status: input.status,
      publishedVersion: input.publishedVersion,
      updatedAt: input.now,
    });
  }

  async lockStandards(): Promise<StandardsRow> {
    return this.read().standards;
  }

  async updateStandards(input: StandardsUpdateInput): Promise<StandardsRow> {
    this.fail('updateStandards');
    const state = this.read();
    const row: StandardsRow = {
      currentVersion: input.currentVersion,
      specKey: input.specKey,
      specSha256: input.specSha256,
      sizeBytes: input.sizeBytes,
      updatedBy: input.updatedBy,
      updatedAt: input.now,
    };
    this.write({ ...state, standards: row });
    return row;
  }

  async upsertSlot(
    slot: string,
    iconId: string,
    actorId: string,
    now: string,
  ): Promise<SlotRow> {
    this.fail('upsertSlot');
    const state = this.read();
    const icon = state.icons.get(iconId);
    if (!icon) throw new Error('No such icon');
    const stored: StoredSlot = {
      slot,
      iconId,
      updatedBy: actorId,
      updatedAt: now,
    };
    this.write({
      ...state,
      slots: new Map(state.slots).set(slot, stored),
    });
    return toFakeSlotRow(stored, icon);
  }

  async deleteSlot(slot: string): Promise<boolean> {
    this.fail('deleteSlot');
    const state = this.read();
    if (!state.slots.has(slot)) return false;
    const next = new Map(state.slots);
    next.delete(slot);
    this.write({ ...state, slots: next });
    return true;
  }

  async audit(
    action: string,
    actorId: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    this.fail('audit');
    const state = this.read();
    this.write({
      ...state,
      audits: [...state.audits, { action, actorId, metadata }],
    });
  }

  private patch(id: string, change: Partial<IconRow>): IconRow {
    const state = this.read();
    const current = state.icons.get(id);
    if (!current) throw new Error('No such icon');
    const row = { ...current, ...change };
    this.write({ ...state, icons: new Map(state.icons).set(id, row) });
    return row;
  }
}

function toFakeSlotRow(stored: StoredSlot, icon: IconRow): SlotRow {
  return {
    slot: stored.slot,
    iconId: icon.id,
    iconName: icon.name,
    iconSlug: icon.slug,
    iconStatus: icon.status,
    publishedVersion: icon.publishedVersion,
    currentVersion: icon.currentVersion,
    updatedBy: stored.updatedBy,
    updatedAt: stored.updatedAt,
  };
}

export class FakeObjectStore implements BrandObjectStore {
  readonly objects = new Map<string, { contentType: string; body: string }>();
  /** Mọi khoá đã ghi, theo thứ tự (kể cả khoá sau này bị xoá). */
  readonly puts: string[] = [];
  readonly removed: string[] = [];
  /** Trả true để lần ghi khoá đó ném lỗi (đã ghi các khoá trước). */
  failPut: ((key: string) => boolean) | null = null;
  failRemove = false;
  failGet: Error | null = null;
  gets: string[] = [];

  async put(key: string, contentType: string, body: string): Promise<void> {
    if (this.failPut?.(key)) throw brandErrors.storageUnavailable();
    this.objects.set(key, { contentType, body });
    this.puts.push(key);
  }

  async get(key: string): Promise<BrandObjectContent | null> {
    this.gets.push(key);
    if (this.failGet) throw this.failGet;
    const entry = this.objects.get(key);
    return entry
      ? { text: entry.body, sizeBytes: Buffer.byteLength(entry.body) }
      : null;
  }

  async remove(
    keys: readonly string[],
  ): Promise<{ failed: readonly string[] }> {
    if (this.failRemove) throw new Error('storage down');
    for (const key of keys) {
      this.objects.delete(key);
      this.removed.push(key);
    }
    return { failed: [] };
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}
