import { randomUUID } from 'node:crypto';
import {
  inTransaction,
  type createPostgresPool,
  type PostgresClient,
} from '@enterprise-platform/adapter-database';
import type {
  BrandIconStatus,
  BrandSvgMode,
  IconCategory,
} from '@enterprise-platform/shared-brand-icon';
import {
  BrandStoreBusyError,
  BrandStoreConflictError,
} from './brand.errors.js';
import type {
  BrandStore,
  BrandTransaction,
  CustomSlotInput,
  CustomSlotRow,
  IconRow,
  IconStateInput,
  NewIconInput,
  NewVersionInput,
  PublishedSlotEntry,
  SavedHeadInput,
  SlotGroupInput,
  SlotGroupRow,
  SlotRow,
  StandardsRow,
  StandardsUpdateInput,
  VersionRow,
} from './brand-store.js';

type Pool = ReturnType<typeof createPostgresPool>;

interface IconDbRow {
  id: string;
  slug: string;
  name: string;
  category: IconCategory;
  status: BrandIconStatus;
  tags: string[];
  current_version: number;
  published_version: number | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface VersionDbRow {
  icon_id: string;
  version: number;
  spec_key: string;
  svg_key: string;
  mono_svg_key: string;
  spec_sha256: string;
  size_bytes: number;
  standards_version: number;
  note: string | null;
  created_by: string | null;
  created_at: Date;
}

interface StandardsDbRow {
  current_version: number;
  spec_key: string | null;
  spec_sha256: string | null;
  size_bytes: number;
  updated_by: string | null;
  updated_at: Date;
}

interface SlotDbRow {
  slot: string;
  icon_id: string;
  icon_name: string;
  icon_slug: string;
  icon_status: BrandIconStatus;
  published_version: number | null;
  current_version: number;
  updated_by: string | null;
  updated_at: Date;
}

interface PublishedSlotDbRow {
  slot: string;
  icon_id: string;
  icon_slug: string;
  published_version: number;
  spec_key: string;
  svg_key: string;
  mono_svg_key: string;
  spec_sha256: string;
  standards_version: number;
}

const ICON_COLUMNS =
  'id, slug, name, category, status, tags, current_version, published_version, created_by, created_at, updated_at';
const VERSION_COLUMNS =
  'icon_id, version, spec_key, svg_key, mono_svg_key, spec_sha256, size_bytes, standards_version, note, created_by, created_at';
const STANDARDS_COLUMNS =
  'current_version, spec_key, spec_sha256, size_bytes, updated_by, updated_at';
const SLOT_SELECT = `SELECT s.slot, s.icon_id, i.name AS icon_name, i.slug AS icon_slug,
         i.status AS icon_status, i.published_version, i.current_version, s.updated_by, s.updated_at
    FROM brand_schema.icon_slots s
    JOIN brand_schema.icons i ON i.id = s.icon_id`;

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const toIcon = (row: IconDbRow): IconRow => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  category: row.category,
  status: row.status,
  tags: row.tags ?? [],
  currentVersion: row.current_version,
  publishedVersion: row.published_version,
  createdBy: row.created_by,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const toVersion = (row: VersionDbRow): VersionRow => ({
  iconId: row.icon_id,
  version: row.version,
  specKey: row.spec_key,
  svgKey: row.svg_key,
  monoSvgKey: row.mono_svg_key,
  specSha256: row.spec_sha256,
  sizeBytes: row.size_bytes,
  standardsVersion: row.standards_version,
  note: row.note,
  createdBy: row.created_by,
  createdAt: iso(row.created_at),
});

const toStandards = (row: StandardsDbRow): StandardsRow => ({
  currentVersion: row.current_version,
  specKey: row.spec_key,
  specSha256: row.spec_sha256?.trim() ?? null,
  sizeBytes: row.size_bytes,
  updatedBy: row.updated_by,
  updatedAt: iso(row.updated_at),
});

const toSlot = (row: SlotDbRow): SlotRow => ({
  slot: row.slot,
  iconId: row.icon_id,
  iconName: row.icon_name,
  iconSlug: row.icon_slug,
  iconStatus: row.icon_status,
  publishedVersion: row.published_version,
  currentVersion: row.current_version,
  updatedBy: row.updated_by,
  updatedAt: iso(row.updated_at),
});

const toPublishedSlot = (row: PublishedSlotDbRow): PublishedSlotEntry => ({
  slot: row.slot,
  iconId: row.icon_id,
  iconSlug: row.icon_slug,
  publishedVersion: row.published_version,
  specKey: row.spec_key,
  svgKey: row.svg_key,
  monoSvgKey: row.mono_svg_key,
  specSha256: row.spec_sha256,
  standardsVersion: row.standards_version,
});

interface CustomSlotDbRow {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly group_key: string;
  readonly color_mode: BrandSvgMode;
  readonly recommended_size: number;
  readonly created_by: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const toCustomSlot = (row: CustomSlotDbRow): CustomSlotRow => ({
  id: row.id,
  label: row.label,
  description: row.description,
  groupKey: row.group_key,
  colorMode: row.color_mode,
  recommendedSize: row.recommended_size,
  createdBy: row.created_by,
  createdAt: iso(row.created_at)!,
  updatedAt: iso(row.updated_at)!,
});

interface SlotGroupDbRow {
  readonly key: string;
  readonly label: string;
  readonly created_by: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const toSlotGroup = (row: SlotGroupDbRow): SlotGroupRow => ({
  key: row.key,
  label: row.label,
  createdBy: row.created_by,
  createdAt: iso(row.created_at)!,
  updatedAt: iso(row.updated_at)!,
});

const SLOT_GROUP_COLUMNS = 'key, label, created_by, created_at, updated_at';

const NO_STANDARDS: StandardsRow = {
  currentVersion: 0,
  specKey: null,
  specSha256: null,
  sizeBytes: 0,
  updatedBy: null,
  updatedAt: null,
};

/** Đổi lỗi Postgres thành lỗi của cổng dữ liệu; lỗi khác giữ nguyên. */
function translate(error: unknown): unknown {
  const { code, constraint } = (error ?? {}) as {
    code?: string;
    constraint?: string;
  };
  if (code === '23505') {
    if (constraint === 'icons_pkey') return new BrandStoreConflictError('id');
    if (constraint === 'slot_groups_pkey')
      return new BrandStoreConflictError('key');
    if (constraint === 'icons_slug_key')
      return new BrandStoreConflictError('slug');
    return new BrandStoreConflictError('version');
  }
  // 55P03: không lấy được khoá trong lock_timeout; 40P01: deadlock.
  if (code === '55P03' || code === '40P01') return new BrandStoreBusyError();
  return error;
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw translate(error);
  }
}

/** Số hậu tố thử lần lượt khi trùng slug trước khi chuyển sang hậu tố ngẫu nhiên. */
const SLUG_ATTEMPTS = 50;

export function slugCandidates(base: string): string[] {
  const candidates = [base];
  for (let n = 2; n <= SLUG_ATTEMPTS; n += 1) {
    const suffix = `-${n}`;
    const stem = base.slice(0, 64 - suffix.length).replace(/-+$/, '');
    candidates.push(`${stem}${suffix}`);
  }
  return candidates;
}

class PgBrandTransaction implements BrandTransaction {
  constructor(private readonly client: PostgresClient) {}

  async lockIcon(id: string): Promise<IconRow | null> {
    const result = await this.client.query<IconDbRow>(
      `SELECT ${ICON_COLUMNS} FROM brand_schema.icons WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return result.rows[0] ? toIcon(result.rows[0]) : null;
  }

  async countIcons(): Promise<number> {
    const result = await this.client.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM brand_schema.icons WHERE status <> 'archived'",
    );
    return result.rows[0]?.total ?? 0;
  }

  async freeSlug(base: string): Promise<string> {
    const candidates = slugCandidates(base);
    const taken = await this.client.query<{ slug: string }>(
      'SELECT slug FROM brand_schema.icons WHERE slug = ANY($1::text[])',
      [candidates],
    );
    const used = new Set(taken.rows.map((row) => row.slug));
    const free = candidates.find((candidate) => !used.has(candidate));
    if (free) return free;
    // Hơn 50 icon trùng tên: dùng hậu tố ngẫu nhiên để không bao giờ kẹt.
    const suffix = `-${randomUUID().slice(0, 6)}`;
    return `${base.slice(0, 64 - suffix.length).replace(/-+$/, '')}${suffix}`;
  }

  async insertIcon(input: NewIconInput): Promise<IconRow> {
    const result = await run(() =>
      this.client.query<IconDbRow>(
        `INSERT INTO brand_schema.icons (id, slug, name, category, status, tags, current_version, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'draft', $5::text[], 1, $6, $7, $7)
         RETURNING ${ICON_COLUMNS}`,
        [
          input.id,
          input.slug,
          input.name,
          input.category,
          [...input.tags],
          input.createdBy,
          input.now,
        ],
      ),
    );
    return toIcon(result.rows[0]);
  }

  async getVersion(
    iconId: string,
    version: number,
  ): Promise<VersionRow | null> {
    const result = await this.client.query<VersionDbRow>(
      `SELECT ${VERSION_COLUMNS} FROM brand_schema.icon_versions WHERE icon_id = $1 AND version = $2`,
      [iconId, version],
    );
    return result.rows[0] ? toVersion(result.rows[0]) : null;
  }

  async insertVersion(input: NewVersionInput): Promise<VersionRow> {
    const result = await run(() =>
      this.client.query<VersionDbRow>(
        `INSERT INTO brand_schema.icon_versions
           (id, icon_id, version, spec_key, svg_key, mono_svg_key, spec_sha256, size_bytes, standards_version, note, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${VERSION_COLUMNS}`,
        [
          randomUUID(),
          input.iconId,
          input.version,
          input.specKey,
          input.svgKey,
          input.monoSvgKey,
          input.specSha256,
          input.sizeBytes,
          input.standardsVersion,
          input.note,
          input.createdBy,
          input.now,
        ],
      ),
    );
    return toVersion(result.rows[0]);
  }

  async saveHead(id: string, input: SavedHeadInput): Promise<IconRow> {
    const result = await this.client.query<IconDbRow>(
      `UPDATE brand_schema.icons
          SET name = $2, category = $3, tags = $4::text[], current_version = $5, updated_at = $6
        WHERE id = $1
        RETURNING ${ICON_COLUMNS}`,
      [
        id,
        input.name,
        input.category,
        [...input.tags],
        input.currentVersion,
        input.now,
      ],
    );
    return toIcon(result.rows[0]);
  }

  async setState(id: string, input: IconStateInput): Promise<IconRow> {
    const result = await this.client.query<IconDbRow>(
      `UPDATE brand_schema.icons
          SET status = $2, published_version = $3, updated_at = $4
        WHERE id = $1
        RETURNING ${ICON_COLUMNS}`,
      [id, input.status, input.publishedVersion, input.now],
    );
    return toIcon(result.rows[0]);
  }

  async deleteIcon(id: string): Promise<void> {
    await this.client.query('DELETE FROM brand_schema.icons WHERE id = $1', [
      id,
    ]);
  }

  async lockStandards(): Promise<StandardsRow> {
    await this.client.query(
      'INSERT INTO brand_schema.standards (id, current_version) VALUES (1, 0) ON CONFLICT DO NOTHING',
    );
    const result = await this.client.query<StandardsDbRow>(
      `SELECT ${STANDARDS_COLUMNS} FROM brand_schema.standards WHERE id = 1 FOR UPDATE`,
    );
    return result.rows[0] ? toStandards(result.rows[0]) : NO_STANDARDS;
  }

  async updateStandards(input: StandardsUpdateInput): Promise<StandardsRow> {
    const result = await this.client.query<StandardsDbRow>(
      `UPDATE brand_schema.standards
          SET current_version = $1, spec_key = $2, spec_sha256 = $3, size_bytes = $4, updated_by = $5, updated_at = $6
        WHERE id = 1
        RETURNING ${STANDARDS_COLUMNS}`,
      [
        input.currentVersion,
        input.specKey,
        input.specSha256,
        input.sizeBytes,
        input.updatedBy,
        input.now,
      ],
    );
    return toStandards(result.rows[0]);
  }

  async upsertSlot(
    slot: string,
    iconId: string,
    actorId: string,
    now: string,
  ): Promise<SlotRow> {
    const result = await this.client.query<SlotDbRow>(
      `WITH upserted AS (
         INSERT INTO brand_schema.icon_slots (slot, icon_id, updated_by, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (slot) DO UPDATE
           SET icon_id = EXCLUDED.icon_id,
               updated_by = EXCLUDED.updated_by,
               updated_at = EXCLUDED.updated_at
         RETURNING slot, icon_id, updated_by, updated_at
       )
       SELECT u.slot, u.icon_id, i.name AS icon_name, i.slug AS icon_slug,
              i.status AS icon_status, i.published_version, i.current_version, u.updated_by, u.updated_at
         FROM upserted u
         JOIN brand_schema.icons i ON i.id = u.icon_id`,
      [slot, iconId, actorId, now],
    );
    return toSlot(result.rows[0]);
  }

  async deleteSlot(slot: string): Promise<boolean> {
    const result = await this.client.query(
      'DELETE FROM brand_schema.icon_slots WHERE slot = $1',
      [slot],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async audit(
    action: string,
    actorId: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO audit_schema.audit_logs (id, actor_id, tenant_id, action, metadata)
       VALUES ($1, $2, NULL, $3, $4::jsonb)`,
      [randomUUID(), actorId, action, JSON.stringify(metadata)],
    );
  }
}

/** Hiện thực `BrandStore` trên Postgres (DB platform, schema `brand_schema`). */
export class PgBrandStore implements BrandStore {
  constructor(private readonly pool: Pool) {}

  async listIcons(
    statuses?: readonly BrandIconStatus[],
  ): Promise<readonly IconRow[]> {
    const result = await this.pool.query<IconDbRow>(
      `SELECT ${ICON_COLUMNS} FROM brand_schema.icons
        WHERE ($1::text[] IS NULL OR status = ANY($1::text[]))
        ORDER BY updated_at DESC, id`,
      [statuses && statuses.length > 0 ? [...statuses] : null],
    );
    return result.rows.map(toIcon);
  }

  async findIcon(id: string): Promise<IconRow | null> {
    const result = await this.pool.query<IconDbRow>(
      `SELECT ${ICON_COLUMNS} FROM brand_schema.icons WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toIcon(result.rows[0]) : null;
  }

  async listVersions(iconId: string): Promise<readonly VersionRow[]> {
    const result = await this.pool.query<VersionDbRow>(
      `SELECT ${VERSION_COLUMNS} FROM brand_schema.icon_versions WHERE icon_id = $1 ORDER BY version DESC`,
      [iconId],
    );
    return result.rows.map(toVersion);
  }

  async findVersion(
    iconId: string,
    version: number,
  ): Promise<VersionRow | null> {
    const result = await this.pool.query<VersionDbRow>(
      `SELECT ${VERSION_COLUMNS} FROM brand_schema.icon_versions WHERE icon_id = $1 AND version = $2`,
      [iconId, version],
    );
    return result.rows[0] ? toVersion(result.rows[0]) : null;
  }

  async getStandards(): Promise<StandardsRow> {
    const result = await this.pool.query<StandardsDbRow>(
      `SELECT ${STANDARDS_COLUMNS} FROM brand_schema.standards WHERE id = 1`,
    );
    return result.rows[0] ? toStandards(result.rows[0]) : NO_STANDARDS;
  }

  async listSlots(): Promise<readonly SlotRow[]> {
    const result = await this.pool.query<SlotDbRow>(
      `${SLOT_SELECT} ORDER BY s.slot`,
    );
    return result.rows.map(toSlot);
  }

  async findSlot(slot: string): Promise<SlotRow | null> {
    const result = await this.pool.query<SlotDbRow>(
      `${SLOT_SELECT} WHERE s.slot = $1`,
      [slot],
    );
    return result.rows[0] ? toSlot(result.rows[0]) : null;
  }

  async listPublishedSlotEntries(): Promise<readonly PublishedSlotEntry[]> {
    const result = await this.pool.query<PublishedSlotDbRow>(
      `SELECT s.slot, s.icon_id, i.slug AS icon_slug, i.published_version,
              v.spec_key, v.svg_key, v.mono_svg_key, v.spec_sha256, v.standards_version
         FROM brand_schema.icon_slots s
         JOIN brand_schema.icons i ON i.id = s.icon_id
         JOIN brand_schema.icon_versions v
           ON v.icon_id = i.id AND v.version = i.published_version
        WHERE i.status = 'published' AND i.published_version IS NOT NULL
        ORDER BY s.slot`,
    );
    return result.rows.map(toPublishedSlot);
  }

  async listCustomSlots(): Promise<readonly CustomSlotRow[]> {
    const result = await this.pool.query<CustomSlotDbRow>(
      `SELECT id, label, description, group_key, color_mode, recommended_size, created_by, created_at, updated_at
         FROM brand_schema.custom_slots
        ORDER BY created_at ASC`,
    );
    return result.rows.map(toCustomSlot);
  }

  async findCustomSlot(id: string): Promise<CustomSlotRow | null> {
    const result = await this.pool.query<CustomSlotDbRow>(
      `SELECT id, label, description, group_key, color_mode, recommended_size, created_by, created_at, updated_at
         FROM brand_schema.custom_slots
        WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toCustomSlot(result.rows[0]) : null;
  }

  async createCustomSlot(input: CustomSlotInput): Promise<CustomSlotRow> {
    const result = await this.pool.query<CustomSlotDbRow>(
      `INSERT INTO brand_schema.custom_slots (id, label, description, group_key, color_mode, recommended_size, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, label, description, group_key, color_mode, recommended_size, created_by, created_at, updated_at`,
      [
        input.id,
        input.label,
        input.description,
        input.groupKey,
        input.colorMode,
        input.recommendedSize,
        input.createdBy ?? null,
      ],
    );
    return toCustomSlot(result.rows[0]);
  }

  async updateCustomSlot(
    id: string,
    patch: Partial<Omit<CustomSlotInput, 'id' | 'createdBy'>>,
  ): Promise<CustomSlotRow | null> {
    const existing = await this.findCustomSlot(id);
    if (!existing) return null;
    const label = patch.label ?? existing.label;
    const description = patch.description ?? existing.description;
    const groupKey = patch.groupKey ?? existing.groupKey;
    const colorMode = patch.colorMode ?? existing.colorMode;
    const recommendedSize = patch.recommendedSize ?? existing.recommendedSize;

    const result = await this.pool.query<CustomSlotDbRow>(
      `UPDATE brand_schema.custom_slots
          SET label = $2, description = $3, group_key = $4, color_mode = $5, recommended_size = $6, updated_at = now()
        WHERE id = $1
        RETURNING id, label, description, group_key, color_mode, recommended_size, created_by, created_at, updated_at`,
      [id, label, description, groupKey, colorMode, recommendedSize],
    );
    return result.rows[0] ? toCustomSlot(result.rows[0]) : null;
  }

  async deleteCustomSlot(id: string): Promise<boolean> {
    return run(() =>
      inTransaction(this.pool, async (client) => {
        await client.query(`DELETE FROM brand_schema.icon_slots WHERE slot = $1`, [id]);
        const result = await client.query(`DELETE FROM brand_schema.custom_slots WHERE id = $1`, [id]);
        return (result.rowCount ?? 0) > 0;
      }),
    );
  }

  async listSlotGroups(): Promise<readonly SlotGroupRow[]> {
    const result = await this.pool.query<SlotGroupDbRow>(
      `SELECT ${SLOT_GROUP_COLUMNS} FROM brand_schema.slot_groups ORDER BY label ASC, key ASC`,
    );
    return result.rows.map(toSlotGroup);
  }

  async findSlotGroup(key: string): Promise<SlotGroupRow | null> {
    const result = await this.pool.query<SlotGroupDbRow>(
      `SELECT ${SLOT_GROUP_COLUMNS} FROM brand_schema.slot_groups WHERE key = $1`,
      [key],
    );
    return result.rows[0] ? toSlotGroup(result.rows[0]) : null;
  }

  async createSlotGroup(input: SlotGroupInput): Promise<SlotGroupRow> {
    return run(async () => {
      const result = await this.pool.query<SlotGroupDbRow>(
        `INSERT INTO brand_schema.slot_groups (key, label, created_by)
         VALUES ($1, $2, $3)
         RETURNING ${SLOT_GROUP_COLUMNS}`,
        [input.key, input.label, input.createdBy ?? null],
      );
      return toSlotGroup(result.rows[0]);
    });
  }

  async updateSlotGroup(
    key: string,
    label: string,
  ): Promise<SlotGroupRow | null> {
    const result = await this.pool.query<SlotGroupDbRow>(
      `UPDATE brand_schema.slot_groups SET label = $2, updated_at = now()
        WHERE key = $1
        RETURNING ${SLOT_GROUP_COLUMNS}`,
      [key, label],
    );
    return result.rows[0] ? toSlotGroup(result.rows[0]) : null;
  }

  async deleteSlotGroup(key: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM brand_schema.slot_groups WHERE key = $1`,
      [key],
    );
    return (result.rowCount ?? 0) > 0;
  }

  transaction<T>(work: (tx: BrandTransaction) => Promise<T>): Promise<T> {
    return run(() =>
      inTransaction(this.pool, async (client) => {
        // Người ghi khác đang giữ khoá icon thì chờ tối đa 10 giây rồi báo bận thay vì treo.
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        return work(new PgBrandTransaction(client));
      }),
    );
  }

  /** Nest gọi khi tắt ứng dụng. */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
