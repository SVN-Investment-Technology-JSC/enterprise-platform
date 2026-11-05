import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Pool } from 'pg';
import { CRM_TEST_ADMIN_URL_ENV, crmIntegrationEnabled, dropTestDatabase } from './crm-test-support.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

jest.setTimeout(60_000);

const root = resolve(process.cwd(), '../../../migrations');
const PIPELINE_FILES = ['0017-pipelines.sql', '0018-opportunity-pipeline.sql', '0019-opportunity-stage-plan.sql'];
const STAGES = ['NEW', 'CONTACTED', 'DISCOVERY', 'QUOTING', 'NEGOTIATION', 'WON', 'LOST'];

interface TempDb {
  readonly pool: Pool;
  drop(): Promise<void>;
}

async function crmFiles(): Promise<string[]> {
  return (await readdir(resolve(root, 'tenant/crm'))).filter((name) => name.endsWith('.sql')).sort();
}

/** Chạy một file như migrator: trong một transaction. */
async function applyFile(pool: Pool, file: string): Promise<void> {
  const sql = await readFile(resolve(root, 'tenant/crm', file), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** DB tạm có `0001-integration` và các file crm thoả `include`. */
async function createDb(include: (file: string) => boolean): Promise<TempDb> {
  const url = new URL(process.env[CRM_TEST_ADMIN_URL_ENV] as string);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
  const name = 'crm_test_' + randomUUID().replace(/-/g, '');
  const admin = createPostgresPool(url.toString());
  let pool: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = '/' + name;
    pool = createPostgresPool(url.toString());
    await pool.query(await readFile(resolve(root, 'tenant/0001-integration.sql'), 'utf8'));
    for (const file of (await crmFiles()).filter(include)) await applyFile(pool, file);
  } catch (error) {
    await dropTestDatabase(admin, pool, name).catch(() => undefined);
    await admin.end();
    throw error;
  }
  const ready = pool;
  return { pool: ready, drop: async () => { try { await dropTestDatabase(admin, ready, name); } finally { await admin.end(); } } };
}

/** Các file trước 0017: dữ liệu phase 1 chưa có luồng (các file sau 0019 như 0023 cần bảng luồng nên không nằm ở đây). */
const isPhase1 = (file: string) => file < '0017';

async function seedPhase1(pool: Pool): Promise<{ opportunities: string[] }> {
  const owner = randomUUID();
  const customer = (
    await pool.query(`INSERT INTO crm_schema.customers (code, name, owner_user_id, kind) VALUES ('MIG-1', 'Khách MIG', $1, 'CUSTOMER') RETURNING id`, [owner])
  ).rows[0].id as string;
  const opportunities: string[] = [];
  for (const stage of STAGES) {
    const id = (
      await pool.query(
        `INSERT INTO crm_schema.opportunities (customer_id, name, stage, owner_user_id, lost_reason)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [customer, `Cơ hội ${stage}`, stage, owner, stage === 'LOST' ? 'Giá cao' : null],
      )
    ).rows[0].id as string;
    opportunities.push(id);
    await pool.query(`INSERT INTO crm_schema.opportunity_stage_history (opportunity_id, from_stage, to_stage) VALUES ($1, NULL, 'NEW')`, [id]);
    if (stage !== 'NEW')
      await pool.query(`INSERT INTO crm_schema.opportunity_stage_history (opportunity_id, from_stage, to_stage, reason) VALUES ($1, 'NEW', $2, $3)`, [
        id,
        stage,
        stage === 'LOST' ? 'Giá cao' : null,
      ]);
  }
  return { opportunities };
}

const count = async (pool: Pool, table: string): Promise<number> =>
  Number((await pool.query(`SELECT count(*) AS n FROM crm_schema.${table}`)).rows[0].n);

integration('Migration luồng cơ hội 0017-0019 (PostgreSQL)', () => {
  describe('trên dữ liệu 7 giai đoạn cũ (TC-PL-01, TC-P2MIG-01, TC-P2MIG-06)', () => {
    let db: TempDb;
    let ids: string[];
    let before: { opportunities: number; history: number; rows: unknown[] };

    beforeAll(async () => {
      db = await createDb(isPhase1);
      ids = (await seedPhase1(db.pool)).opportunities;
      const rows = (await db.pool.query(`SELECT id, name, stage, lost_reason, probability, version FROM crm_schema.opportunities ORDER BY id`)).rows;
      before = { opportunities: await count(db.pool, 'opportunities'), history: await count(db.pool, 'opportunity_stage_history'), rows };
      for (const file of PIPELINE_FILES) await applyFile(db.pool, file);
    });
    afterAll(() => db.drop());

    it('TC-PL-01: mỗi cơ hội vào luồng mặc định, stage_id khớp mã stage, số bản ghi và cột cũ không đổi', async () => {
      expect(await count(db.pool, 'opportunities')).toBe(before.opportunities);
      const after = (await db.pool.query(`SELECT id, name, stage, lost_reason, probability, version FROM crm_schema.opportunities ORDER BY id`)).rows;
      expect(after).toEqual(before.rows);
      const joined = (
        await db.pool.query(
          `SELECT o.stage, s.code, p.code AS pipeline_code, p.is_default
             FROM crm_schema.opportunities o
             JOIN crm_schema.pipeline_stages s ON s.id = o.stage_id AND s.pipeline_id = o.pipeline_id
             JOIN crm_schema.pipelines p ON p.id = o.pipeline_id`,
        )
      ).rows;
      expect(joined).toHaveLength(7);
      for (const row of joined) {
        expect(row.code).toBe(row.stage);
        expect(row.pipeline_code).toBe('SALES_STANDARD');
        expect(row.is_default).toBe(true);
      }
    });

    it('TC-PL-01: lịch sử giữ nguyên số dòng và được gán stage id', async () => {
      expect(await count(db.pool, 'opportunity_stage_history')).toBe(before.history);
      const bad = (
        await db.pool.query(
          `SELECT count(*) AS n FROM crm_schema.opportunity_stage_history h
             LEFT JOIN crm_schema.pipeline_stages t ON t.id = h.to_stage_id AND t.code = h.to_stage
             LEFT JOIN crm_schema.pipeline_stages f ON f.id = h.from_stage_id AND f.code = h.from_stage
            WHERE t.id IS NULL OR (h.from_stage IS NOT NULL AND f.id IS NULL)`,
        )
      ).rows[0].n;
      expect(Number(bad)).toBe(0);
    });

    it('luồng mặc định có 7 giai đoạn đúng nghĩa, 14 bước chuyển và điều kiện bắt buộc cho Thắng, Thua', async () => {
      expect(await count(db.pool, 'pipelines')).toBe(1);
      const stages = (await db.pool.query(`SELECT code, semantic, active, skippable, assignee_rule FROM crm_schema.pipeline_stages ORDER BY sort_order`)).rows;
      expect(stages.map((row) => row.code)).toEqual(STAGES);
      expect(stages.map((row) => row.semantic)).toEqual(['OPEN', 'OPEN', 'OPEN', 'OPEN', 'OPEN', 'WON', 'LOST']);
      expect(stages.every((row) => row.active && !row.skippable && row.assignee_rule === 'NONE')).toBe(true);
      const transitions = (
        await db.pool.query(
          `SELECT f.code AS from_code, t.code AS to_code FROM crm_schema.pipeline_stage_transitions x
             JOIN crm_schema.pipeline_stages f ON f.id = x.from_stage_id JOIN crm_schema.pipeline_stages t ON t.id = x.to_stage_id`,
        )
      ).rows;
      const byFrom: Record<string, string[]> = {};
      for (const row of transitions) (byFrom[row.from_code] ??= []).push(row.to_code);
      for (const list of Object.values(byFrom)) list.sort();
      expect(byFrom).toEqual({
        NEW: ['CONTACTED', 'LOST'],
        CONTACTED: ['DISCOVERY', 'LOST', 'NEW'],
        DISCOVERY: ['CONTACTED', 'LOST', 'QUOTING'],
        QUOTING: ['DISCOVERY', 'LOST', 'NEGOTIATION'],
        NEGOTIATION: ['LOST', 'QUOTING', 'WON'],
      });
      const requirements = (
        await db.pool.query(
          `SELECT s.code, r.kind, r.required FROM crm_schema.pipeline_stage_requirements r JOIN crm_schema.pipeline_stages s ON s.id = r.stage_id ORDER BY s.code`,
        )
      ).rows;
      expect(requirements).toEqual([
        { code: 'LOST', kind: 'REASON', required: true },
        { code: 'WON', kind: 'QUOTE_APPROVED', required: true },
      ]);
    });

    it('CHECK cứng đã gỡ, stage_id/pipeline_id NOT NULL, from/to_stage rộng 32 ký tự', async () => {
      const checks = (
        await db.pool.query(
          `SELECT conname FROM pg_constraint WHERE conrelid = 'crm_schema.opportunities'::regclass AND contype = 'c'`,
        )
      ).rows.map((row) => row.conname);
      expect(checks).not.toContain('opportunities_stage_check');
      expect(checks).not.toContain('ck_crm_opportunities_lost_reason');
      const customer = (await db.pool.query(`SELECT customer_id FROM crm_schema.opportunities LIMIT 1`)).rows[0].customer_id;
      const stageId = (await db.pool.query(`SELECT id FROM crm_schema.pipeline_stages WHERE code = 'LOST'`)).rows[0].id;
      // Thua không lý do không còn bị CHECK chặn (quy tắc chuyển sang ứng dụng).
      await expect(
        db.pool.query(
          `INSERT INTO crm_schema.opportunities (customer_id, name, stage, owner_user_id, pipeline_id, stage_id)
           SELECT $1, 'Thua không lý do', 'LOST', $2, pipeline_id, $3 FROM crm_schema.pipeline_stages WHERE id = $3`,
          [customer, randomUUID(), stageId],
        ),
      ).resolves.toBeDefined();
      await expect(db.pool.query(`UPDATE crm_schema.opportunities SET stage_id = NULL WHERE id = $1`, [ids[0]])).rejects.toThrow(/null value/);
      const width = (
        await db.pool.query(
          `SELECT column_name, character_maximum_length AS len FROM information_schema.columns
            WHERE table_schema = 'crm_schema' AND table_name = 'opportunity_stage_history' AND column_name IN ('from_stage', 'to_stage')`,
        )
      ).rows;
      expect(width.every((row) => row.len === 32)).toBe(true);
      // Mã giai đoạn dài tới 32 ký tự ghi được.
      await expect(
        db.pool.query(`INSERT INTO crm_schema.opportunity_stage_history (opportunity_id, to_stage) VALUES ($1, $2)`, [ids[0], 'X'.repeat(32)]),
      ).resolves.toBeDefined();
    });

    it('trigger tương thích: bản app cũ chỉ ghi mã stage vẫn có stage_id', async () => {
      const customer = (await db.pool.query(`SELECT customer_id FROM crm_schema.opportunities LIMIT 1`)).rows[0].customer_id;
      const created = (
        await db.pool.query(`INSERT INTO crm_schema.opportunities (customer_id, name, owner_user_id) VALUES ($1, 'App cũ', $2) RETURNING id, stage_id`, [customer, randomUUID()])
      ).rows[0];
      expect(created.stage_id).not.toBeNull();
      await db.pool.query(`UPDATE crm_schema.opportunities SET stage = 'CONTACTED' WHERE id = $1`, [created.id]);
      const moved = (
        await db.pool.query(`SELECT s.code FROM crm_schema.opportunities o JOIN crm_schema.pipeline_stages s ON s.id = o.stage_id WHERE o.id = $1`, [created.id])
      ).rows[0];
      expect(moved.code).toBe('CONTACTED');
    });

    it('TC-P2MIG-06: 0001–0016 không đổi so với nhánh gốc (check-migrations)', () => {
      const out = execFileSync('node', ['tools/check-migrations.mjs'], { cwd: resolve(root, '..'), encoding: 'utf8' });
      expect(out).toContain('OK');
    });
  });

  describe('kế hoạch giai đoạn (P2B-13)', () => {
    let db: TempDb;
    beforeAll(async () => {
      db = await createDb(isPhase1);
      await seedPhase1(db.pool);
      for (const file of PIPELINE_FILES) await applyFile(db.pool, file);
    });
    afterAll(() => db.drop());

    it('TC-P2MIG-01: mỗi cơ hội có dòng cho mọi giai đoạn; ACTIVE ở giai đoạn hiện tại, DONE ở các giai đoạn mở đứng trước, chưa gán người', async () => {
      expect(await count(db.pool, 'opportunity_stage_plan')).toBe(49);
      const rows = (
        await db.pool.query(
          `SELECT o.stage AS current, s.code, p.status, p.assignee_user_id
             FROM crm_schema.opportunity_stage_plan p
             JOIN crm_schema.opportunities o ON o.id = p.opportunity_id JOIN crm_schema.pipeline_stages s ON s.id = p.stage_id`,
        )
      ).rows;
      expect(rows.every((row) => row.assignee_user_id === null)).toBe(true);
      const status = (current: string, code: string) => rows.find((row) => row.current === current && row.code === code)?.status;
      expect(status('QUOTING', 'QUOTING')).toBe('ACTIVE');
      expect(status('QUOTING', 'NEW')).toBe('DONE');
      expect(status('QUOTING', 'NEGOTIATION')).toBe('PENDING');
      expect(status('WON', 'WON')).toBe('DONE');
      expect(status('NEW', 'NEW')).toBe('ACTIVE');
    });

    it('ràng buộc: SKIPPED cần lý do, quy tắc gán chỉ nhận giá trị hợp lệ, index theo người đảm nhận có mặt', async () => {
      await expect(db.pool.query(`UPDATE crm_schema.opportunity_stage_plan SET status = 'SKIPPED' WHERE ctid IN (SELECT ctid FROM crm_schema.opportunity_stage_plan LIMIT 1)`)).rejects.toThrow(/ck_crm_opportunity_stage_plan_skipped/);
      await expect(db.pool.query(`UPDATE crm_schema.pipeline_stages SET assignee_rule = 'RANDOM' WHERE code = 'NEW'`)).rejects.toThrow(/ck_crm_pipeline_stages_assignee_rule/);
      const indexes = (await db.pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'opportunity_stage_plan'`)).rows.map((row) => row.indexname);
      expect(indexes).toContain('ix_crm_opportunity_stage_plan_assignee');
    });
  });

  describe('chạy lại (TC-PL-02, TC-P2MIG-03, TC-P2MIG-04)', () => {
    it('TC-PL-02: áp lại 0017–0019 không lỗi, không nhân đôi luồng, giai đoạn, bước chuyển, điều kiện, kế hoạch', async () => {
      const db = await createDb(isPhase1);
      try {
        await seedPhase1(db.pool);
        for (const file of PIPELINE_FILES) await applyFile(db.pool, file);
        const tables = ['pipelines', 'pipeline_stages', 'pipeline_stage_transitions', 'pipeline_stage_requirements', 'opportunities', 'opportunity_stage_history', 'opportunity_stage_plan'];
        const before = await Promise.all(tables.map((table) => count(db.pool, table)));
        for (const file of PIPELINE_FILES) await applyFile(db.pool, file);
        expect(await Promise.all(tables.map((table) => count(db.pool, table)))).toEqual(before);
        expect(before).toEqual([1, 7, 14, 2, 7, 13, 49]);
      } finally {
        await db.drop();
      }
    });

    it('TC-P2MIG-03/04: DB trống chạy hết 0001 tới mới nhất, luồng mặc định có sẵn, chạy lại cả bộ không lỗi', async () => {
      const db = await createDb(() => true);
      try {
        // Luồng mặc định (7 giai đoạn) và luồng mẫu "Chào thầu" (6 giai đoạn, 0024); chỉ một luồng mặc định.
        expect(await count(db.pool, 'pipelines')).toBe(2);
        expect(await count(db.pool, 'pipeline_stages')).toBe(13);
        expect(Number((await db.pool.query(`SELECT count(*) AS n FROM crm_schema.pipelines WHERE is_default`)).rows[0].n)).toBe(1);
        for (const file of await crmFiles()) if (PIPELINE_FILES.includes(file) || file >= '0023') await applyFile(db.pool, file);
        expect(await count(db.pool, 'pipelines')).toBe(2);
        expect(await count(db.pool, 'pipeline_stages')).toBe(13);
      } finally {
        await db.drop();
      }
    });
  });

  describe('mã giai đoạn lạ (TC-PL-03)', () => {
    it('migration dừng nêu cơ hội và mã lạ, không để lại thay đổi dở', async () => {
      const db = await createDb(isPhase1);
      try {
        await db.pool.query(`ALTER TABLE crm_schema.opportunities DROP CONSTRAINT opportunities_stage_check`);
        const customer = (await db.pool.query(`INSERT INTO crm_schema.customers (code, name, owner_user_id, kind) VALUES ('MIG-X', 'Khách X', $1, 'CUSTOMER') RETURNING id`, [randomUUID()])).rows[0].id;
        const odd = (await db.pool.query(`INSERT INTO crm_schema.opportunities (customer_id, name, stage, owner_user_id) VALUES ($1, 'Lạ', 'ON_HOLD', $2) RETURNING id`, [customer, randomUUID()])).rows[0].id as string;
        await applyFile(db.pool, '0017-pipelines.sql');
        await expect(applyFile(db.pool, '0018-opportunity-pipeline.sql')).rejects.toThrow(new RegExp(`${odd}.*ON_HOLD`));
        const columns = (await db.pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'crm_schema' AND table_name = 'opportunities' AND column_name = 'stage_id'`)).rows;
        expect(columns).toHaveLength(0);
      } finally {
        await db.drop();
      }
    });
  });
});
