import { randomUUID } from 'node:crypto';
import {
  inTransaction,
  type createPostgresPool,
  type PostgresClient,
} from '@enterprise-platform/adapter-database';
import type {
  BrandIconStatus,
  IconCategory,
} from '@enterprise-platform/shared-brand-icon';
import {
  BrandStoreBusyError,
  BrandStoreConflictError,
} from './brand.errors.js';
import type {
  BrandStore,
  BrandTransaction,
  IconRow,
  IconStateInput,
  NewIconInput,
  NewVersionInput,
  SavedHeadInput,
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

const ICON_COLUMNS =
  'id, slug, name, category, status, tags, current_version, published_version, created_by, created_at, updated_at';
const VERSION_COLUMNS =
  'icon_id, version, spec_key, svg_key, mono_svg_key, spec_sha256, size_bytes, standards_version, note, created_by, created_at';
const STANDARDS_COLUMNS =
  'current_version, spec_key, spec_sha256, size_bytes, updated_by, updated_at';

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
      'SELECT count(*)::int AS total FROM brand_schema.icons',
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
