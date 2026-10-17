import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPostgresPool,
  type PostgresPoolRegistry,
  type TenantDatabaseRegistry,
} from '@enterprise-platform/adapter-database';
import type { SharedFolder } from '@enterprise-platform/contracts-shared';
import type { Pool } from 'pg';
import type { DocumentInsert, FolderInsert } from '../application/shared-store.port.js';
import { SharedNameTakenError } from '../domain/shared.error.js';
import { PostgresSharedStore } from './postgres-shared-store.js';

const integration = process.env.SHARED_TEST_ADMIN_URL ? describe : describe.skip;

const TENANT = 'tenant-1';
const MIGRATIONS = resolve(process.cwd(), '../../../migrations/tenant/shared');

integration('Kho tài liệu công ty: xoá, Thùng rác, khôi phục (PostgreSQL)', () => {
  const databaseName = 'shared_test_' + randomUUID().replace(/-/g, '');
  const alice = randomUUID();
  const bob = randomUUID();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: Pool;
  let store: PostgresSharedStore;

  const meta = { docKind: null, docNumber: null, partner: null, issuedOn: null, effectiveTo: null } as const;

  async function folder(name: string, parent?: SharedFolder): Promise<SharedFolder> {
    const input: FolderInsert = {
      parentId: parent?.id ?? null,
      name,
      depth: parent ? parent.depth + 1 : 0,
      note: null,
      ...meta,
    };
    return store.folders.create(TENANT, alice, input);
  }

  /** Tài liệu một phiên bản đã tải lên xong, dung lượng `bytes`. */
  async function document(
    inFolder: SharedFolder,
    name: string,
    options: { bytes?: number; confidentiality?: DocumentInsert['confidentiality']; createdBy?: string } = {},
  ) {
    const created = await store.documents.create(TENANT, options.createdBy ?? alice, {
      folderId: inFolder.id,
      name,
      description: null,
      effectiveFrom: null,
      confidentiality: options.confidentiality ?? 'internal',
      tags: [],
      sourceLabel: null,
      storageKey: `tenants/${TENANT}/shared/${randomUUID()}/v1-${name}.pdf`,
      fileName: `${name}.pdf`,
      contentType: 'application/pdf',
      changeNote: null,
      ...meta,
    });
    await store.documents.completeVersion(TENANT, created.version.id, options.bytes ?? 1000);
    return created;
  }

  const count = async (table: string, where = 'true') =>
    Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM shared_schema.${table} WHERE ${where}`)).rows[0]?.n);

  beforeAll(async () => {
    const url = new URL(process.env.SHARED_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString()) as unknown as Pool;
    // Bảng người dùng của migration lõi; kho chỉ đọc tên, thư điện tử và trạng thái từ đây.
    await pool.query(`CREATE SCHEMA core_schema;
      CREATE TABLE core_schema.users (
        id UUID PRIMARY KEY, full_name TEXT NOT NULL, email TEXT,
        status TEXT NOT NULL DEFAULT 'active', is_active BOOLEAN NOT NULL DEFAULT true)`);
    await pool.query(
      `INSERT INTO core_schema.users (id, full_name, email, status) VALUES
         ($1, 'An', 'an@savina.vn', 'active'), ($2, 'Bình', NULL, 'disabled')`,
      [alice, bob],
    );
    for (const file of (await readdir(MIGRATIONS)).filter((name) => name.endsWith('.sql')).sort()) {
      await pool.query(await readFile(resolve(MIGRATIONS, file), 'utf8'));
    }
    store = new PostgresSharedStore(
      { require: () => ({}) } as unknown as TenantDatabaseRegistry,
      { forTenant: async () => pool } as unknown as PostgresPoolRegistry,
    );
  }, 60_000);

  afterAll(async () => {
    // Đóng pool của DB test trước, nếu không DROP DATABASE báo "is being accessed by other users".
    await pool?.end();
    if (admin) {
      if (!/^shared_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  it('migration mới nhất chạy lại được mà không lỗi', async () => {
    const file = (await readdir(MIGRATIONS)).filter((name) => name.endsWith('.sql')).sort().at(-1)!;
    await expect(pool.query(await readFile(resolve(MIGRATIONS, file), 'utf8'))).resolves.toBeDefined();
  });

  it('nhật ký truy cập nhận thao tác xoá và khôi phục', async () => {
    const root = await folder('Nhật ký');
    const { document: doc } = await document(root, 'HĐ');
    await store.documents.log(TENANT, alice, { documentId: doc.id, action: 'delete' });
    await store.documents.log(TENANT, alice, { documentId: doc.id, action: 'restore' });
    expect(await store.documents.accessLog(TENANT, doc.id, 10)).toHaveLength(2);
  });

  describe('xoá một tài liệu', () => {
    it('vào Thùng rác: biến khỏi danh sách, thư mục và dung lượng thư mục, nhưng vẫn tính vào dung lượng kho', async () => {
      const root = await folder('Xoá lẻ');
      const { document: doc } = await document(root, 'HĐ A', { bytes: 5000 });
      const before = (await store.storage.usageByModule(TENANT)).find((item) => item.moduleKey === 'shared')!;
      expect((await store.folders.list(TENANT)).find((item) => item.id === root.id)).toMatchObject({
        documentCount: 1,
        totalBytes: 5000,
      });

      await store.documents.setLock(TENANT, doc.id, bob);
      await store.documents.trash(TENANT, doc.id, alice);

      expect(await store.documents.list(TENANT, { folderId: root.id, status: 'active', limit: 100 })).toEqual([]);
      expect((await store.folders.list(TENANT)).find((item) => item.id === root.id)).toMatchObject({
        documentCount: 0,
        totalBytes: 0,
      });
      // `find` vẫn trả dòng đã xoá, kèm dấu xoá và đã mở khoá.
      const found = await store.documents.find(TENANT, doc.id);
      expect(found?.deletedAt).toBeTruthy();
      expect(found?.lockedByUserId).toBeUndefined();
      const after = (await store.storage.usageByModule(TENANT)).find((item) => item.moduleKey === 'shared')!;
      expect(after.bytes).toBe(before.bytes);

      const item = (await store.trash.list(TENANT)).find((entry) => entry.id === doc.id);
      expect(item).toMatchObject({
        kind: 'document',
        name: 'HĐ A',
        location: 'Xoá lẻ',
        locationAvailable: true,
        totalBytes: 5000,
        deletedBy: alice,
        deletedByName: 'An',
        fileName: 'HĐ A.pdf',
        confidentiality: 'internal',
        createdBy: alice,
      });
    });

    it('tên của tài liệu đã xoá không chặn tạo tài liệu mới cùng tên', async () => {
      const root = await folder('Cùng tên');
      const { document: first } = await document(root, 'HĐ');
      await store.documents.trash(TENANT, first.id, alice);
      await expect(document(root, 'HĐ')).resolves.toBeDefined();
    });

    it('khôi phục về chỗ cũ; trùng tên tài liệu đang dùng thì báo trùng và không đổi gì', async () => {
      const root = await folder('Khôi phục lẻ');
      const { document: first } = await document(root, 'HĐ');
      await store.documents.trash(TENANT, first.id, alice);
      await document(root, 'HĐ');

      await expect(
        store.documents.restoreFromTrash(TENANT, first.id, { folderId: root.id, name: 'HĐ' }),
      ).rejects.toBeInstanceOf(SharedNameTakenError);
      expect((await store.documents.find(TENANT, first.id))?.deletedAt).toBeTruthy();

      await store.documents.restoreFromTrash(TENANT, first.id, { folderId: root.id, name: 'HĐ (khôi phục)' });
      const restored = await store.documents.find(TENANT, first.id);
      expect(restored).toMatchObject({ name: 'HĐ (khôi phục)', folderId: root.id });
      expect(restored?.deletedAt).toBeUndefined();
      expect((await store.trash.list(TENANT)).some((entry) => entry.id === first.id)).toBe(false);
    });

    it('khôi phục sang thư mục khác', async () => {
      const from = await folder('Nguồn');
      const to = await folder('Đích khác');
      const { document: doc } = await document(from, 'Báo cáo');
      await store.documents.trash(TENANT, doc.id, alice);
      await store.documents.restoreFromTrash(TENANT, doc.id, { folderId: to.id, name: 'Báo cáo' });
      expect(await store.documents.find(TENANT, doc.id)).toMatchObject({ folderId: to.id });
    });

    it('xoá vĩnh viễn: mất dòng, mọi phiên bản, nhật ký; trả khoá tệp; ghi nhật ký xoá', async () => {
      const root = await folder('Vĩnh viễn lẻ');
      const created = await document(root, 'HĐ B', { bytes: 700 });
      const second = await store.documents.addVersion(TENANT, alice, {
        documentId: created.document.id,
        versionNo: 2,
        storageKey: `tenants/${TENANT}/shared/${randomUUID()}/v2-HĐ B.pdf`,
        fileName: 'HĐ B.pdf',
        contentType: 'application/pdf',
        changeNote: 'Bản ký',
      });
      await store.documents.completeVersion(TENANT, second.id, 300);
      await store.documents.log(TENANT, alice, { documentId: created.document.id, action: 'view' });
      const keys = [
        await store.documents.storageKeyOf(TENANT, created.version.id),
        await store.documents.storageKeyOf(TENANT, second.id),
      ];
      const usedBefore = (await store.storage.usageByModule(TENANT)).find((item) => item.moduleKey === 'shared')!;

      // Chưa vào Thùng rác thì không xoá vĩnh viễn được.
      await expect(store.documents.purge(TENANT, created.document.id, bob)).resolves.toEqual({
        storageKeys: [],
        documents: 0,
        folders: 0,
      });
      expect(await store.documents.find(TENANT, created.document.id)).toBeDefined();

      await store.documents.trash(TENANT, created.document.id, alice);
      const result = await store.documents.purge(TENANT, created.document.id, bob);
      expect([...result.storageKeys].sort()).toEqual([...keys].sort());
      expect(result).toMatchObject({ documents: 1, folders: 0 });

      expect(await store.documents.find(TENANT, created.document.id)).toBeUndefined();
      expect(await count('document_versions', `document_id = '${created.document.id}'`)).toBe(0);
      expect(await count('document_access_logs', `document_id = '${created.document.id}'`)).toBe(0);
      const usedAfter = (await store.storage.usageByModule(TENANT)).find((item) => item.moduleKey === 'shared')!;
      expect(usedBefore.bytes - usedAfter.bytes).toBe(1000);

      const logged = await pool.query(
        `SELECT * FROM shared_schema.purge_log WHERE name = 'HĐ B' AND kind = 'document'`,
      );
      expect(logged.rows).toHaveLength(1);
      expect(logged.rows[0]).toMatchObject({
        location: 'Vĩnh viễn lẻ',
        document_count: 1,
        version_count: 2,
        deleted_by: alice,
        purged_by: bob,
      });
      expect(Number(logged.rows[0].total_bytes)).toBe(1000);
    });
  });

  describe('xoá cả thư mục', () => {
    let trees = 0;
    async function tree() {
      // Tên gốc phải khác nhau giữa các lần dựng: hai thư mục gốc đang dùng không được trùng tên.
      const root = await folder(`Gốc ${++trees}`);
      const mid = await folder('Giữa', root);
      const leaf = await folder('Lá', mid);
      const sibling = await folder('Anh em', root);
      const inRoot = await document(root, 'Ở gốc', { bytes: 100 });
      const inLeaf = await document(leaf, 'Ở lá', { bytes: 200 });
      const inSibling = await document(sibling, 'Ở anh em', { bytes: 400 });
      return { root, mid, leaf, sibling, inRoot, inLeaf, inSibling };
    }

    it('chuyển cả nhánh và tài liệu bên trong vào Thùng rác; nhánh khác không bị đụng', async () => {
      const { root, mid, leaf, sibling, inRoot, inLeaf, inSibling } = await tree();
      const result = await store.folders.trash(TENANT, mid.id, bob);
      expect(result).toEqual({ folders: 1, documents: 1 });
      expect((await store.documents.find(TENANT, inRoot.document.id))?.deletedAt).toBeUndefined();
      expect((await store.documents.find(TENANT, inSibling.document.id))?.deletedAt).toBeUndefined();

      const active = (await store.folders.list(TENANT)).map((item) => item.id);
      expect(active).toEqual(expect.arrayContaining([root.id, sibling.id]));
      expect(active).not.toContain(mid.id);
      expect(active).not.toContain(leaf.id);
      expect((await store.folders.find(TENANT, mid.id))?.isActive).toBe(false);
      expect((await store.documents.find(TENANT, inLeaf.document.id))?.deletedAt).toBeTruthy();

      const trashed = await store.folders.findTrashed(TENANT, mid.id);
      expect(trashed).toMatchObject({ folders: 1, documents: 1, maxDepth: 2 });
      expect(await store.folders.findTrashed(TENANT, leaf.id)).toBeUndefined();
      expect(await store.folders.findTrashed(TENANT, root.id)).toBeUndefined();

      const items = (await store.trash.list(TENANT)).filter((entry) => entry.kind === 'folder');
      expect(items.find((entry) => entry.id === mid.id)).toMatchObject({
        name: 'Giữa',
        location: root.name,
        locationAvailable: true,
        folderCount: 1,
        documentCount: 1,
        totalBytes: 200,
        deletedByName: 'Bình',
      });
      // Thư mục con của nhánh không hiện riêng.
      expect(items.some((entry) => entry.id === leaf.id)).toBe(false);
    });

    it('tài liệu từng xoá riêng trước đó không bị gộp vào lượt xoá thư mục', async () => {
      const { root, mid, leaf, inLeaf } = await tree();
      const second = await document(leaf, 'Ở lá 2');
      await store.documents.trash(TENANT, inLeaf.document.id, alice);
      const result = await store.folders.trash(TENANT, mid.id, bob);
      expect(result.documents).toBe(1);
      const standalone = (await store.trash.list(TENANT)).find((entry) => entry.id === inLeaf.document.id);
      expect(standalone).toMatchObject({
        kind: 'document',
        locationAvailable: false,
        location: `${root.name} / Giữa / Lá`,
      });

      await store.folders.restoreBranch(TENANT, mid.id, { parentId: root.id, name: 'Giữa', depthDelta: 0 });
      // Tài liệu xoá lẻ vẫn nằm trong Thùng rác, tài liệu của lượt xoá đã trở lại.
      expect((await store.documents.find(TENANT, inLeaf.document.id))?.deletedAt).toBeTruthy();
      expect((await store.documents.find(TENANT, second.document.id))?.deletedAt).toBeUndefined();
    });

    it('khôi phục cả nhánh về chỗ cũ, giữ cấp và tài liệu', async () => {
      const { root, mid, leaf, inLeaf } = await tree();
      await store.folders.trash(TENANT, mid.id, bob);
      const restored = await store.folders.restoreBranch(TENANT, mid.id, {
        parentId: root.id,
        name: 'Giữa',
        depthDelta: 0,
      });
      expect(restored).toMatchObject({ id: mid.id, isActive: true, depth: 1 });
      const folders = await store.folders.list(TENANT);
      expect(folders.find((item) => item.id === leaf.id)).toMatchObject({ depth: 2, parentId: mid.id });
      expect((await store.documents.find(TENANT, inLeaf.document.id))?.deletedAt).toBeUndefined();
      expect(await store.folders.findTrashed(TENANT, mid.id)).toBeUndefined();
    });

    it('khôi phục sang chỗ khác: cả nhánh đổi cấp, thư mục gốc đổi cha và tên', async () => {
      const { mid, leaf } = await tree();
      const elsewhere = await folder('Chỗ khác');
      await store.folders.trash(TENANT, mid.id, bob);
      const restored = await store.folders.restoreBranch(TENANT, mid.id, {
        parentId: elsewhere.id,
        name: 'Giữa mới',
        depthDelta: 0,
      });
      expect(restored).toMatchObject({ name: 'Giữa mới', parentId: elsewhere.id, depth: 1 });
      expect((await store.folders.list(TENANT)).find((item) => item.id === leaf.id)?.depth).toBe(2);

      const deeper = await folder('Sâu', await folder('Mức 1', await folder('Mức 0')));
      await store.folders.trash(TENANT, mid.id, bob);
      // `mid` đang ở cấp 1 và sẽ ở cấp ngay dưới `deeper`.
      const moved = await store.folders.restoreBranch(TENANT, mid.id, {
        parentId: deeper.id,
        name: 'Giữa mới',
        depthDelta: deeper.depth + 1 - mid.depth,
      });
      expect(moved.depth).toBe(deeper.depth + 1);
      expect((await store.folders.list(TENANT)).find((item) => item.id === leaf.id)?.depth).toBe(deeper.depth + 2);
    });

    it('khôi phục vào chỗ đã có thư mục cùng tên thì báo trùng và nhánh vẫn ở Thùng rác', async () => {
      const { root, mid, leaf } = await tree();
      await store.folders.trash(TENANT, mid.id, bob);
      await folder('Giữa', root);
      await expect(
        store.folders.restoreBranch(TENANT, mid.id, { parentId: root.id, name: 'Giữa', depthDelta: 0 }),
      ).rejects.toBeInstanceOf(SharedNameTakenError);
      expect((await store.folders.find(TENANT, mid.id))?.isActive).toBe(false);
      expect((await store.folders.find(TENANT, leaf.id))?.isActive).toBe(false);
      expect(await store.folders.findTrashed(TENANT, mid.id)).toBeDefined();
    });

    it('tên thư mục đã xoá không chặn tạo thư mục mới cùng tên', async () => {
      const { root, mid } = await tree();
      await store.folders.trash(TENANT, mid.id, bob);
      await expect(folder('Giữa', root)).resolves.toBeDefined();
    });

    it('xoá vĩnh viễn cả nhánh nhiều cấp, kể cả tài liệu từng xoá riêng, trả đủ khoá tệp', async () => {
      const { root, mid, leaf, inLeaf } = await tree();
      const extra = await document(leaf, 'Xoá riêng', { bytes: 50 });
      await store.documents.trash(TENANT, extra.document.id, alice);
      await store.folders.trash(TENANT, mid.id, bob);
      const keys = [
        await store.documents.storageKeyOf(TENANT, inLeaf.version.id),
        await store.documents.storageKeyOf(TENANT, extra.version.id),
      ];

      const result = await store.folders.purgeBranch(TENANT, mid.id, bob);
      expect([...result.storageKeys].sort()).toEqual([...keys].sort());
      expect(result).toMatchObject({ documents: 2, folders: 1 });

      expect(await store.folders.find(TENANT, mid.id)).toBeUndefined();
      expect(await store.folders.find(TENANT, leaf.id)).toBeUndefined();
      expect(await store.documents.find(TENANT, inLeaf.document.id)).toBeUndefined();
      expect(await store.documents.find(TENANT, extra.document.id)).toBeUndefined();
      expect((await store.trash.list(TENANT)).some((entry) => [mid.id, extra.document.id].includes(entry.id))).toBe(
        false,
      );

      const logged = await pool.query(`SELECT * FROM shared_schema.purge_log WHERE kind = 'folder' AND name = 'Giữa'`);
      expect(logged.rows.at(-1)).toMatchObject({
        location: root.name,
        document_count: 2,
        version_count: 2,
        purged_by: bob,
      });
      expect(Number(logged.rows.at(-1).total_bytes)).toBe(250);
    });

    it('xoá vĩnh viễn nhánh có thư mục con từng xoá riêng ở lượt trước: cây con đi theo hết', async () => {
      const { root, mid, leaf, inLeaf } = await tree();
      // Xoá lá trước (lượt riêng), rồi mới xoá thư mục giữa chứa nó.
      await store.folders.trash(TENANT, leaf.id, alice);
      await store.folders.trash(TENANT, mid.id, bob);
      expect((await store.trash.list(TENANT)).filter((entry) => [mid.id, leaf.id].includes(entry.id))).toHaveLength(2);
      const keys = [await store.documents.storageKeyOf(TENANT, inLeaf.version.id)];

      const result = await store.folders.purgeBranch(TENANT, mid.id, bob);
      expect(result).toMatchObject({ documents: 1, folders: 1 });
      expect(result.storageKeys).toEqual(keys);
      expect(await store.folders.find(TENANT, mid.id)).toBeUndefined();
      expect(await store.folders.find(TENANT, leaf.id)).toBeUndefined();
      expect(await store.documents.find(TENANT, inLeaf.document.id)).toBeUndefined();
      expect((await store.trash.list(TENANT)).some((entry) => [mid.id, leaf.id].includes(entry.id))).toBe(false);
      // Thư mục gốc của cây và tài liệu của nó không bị đụng tới.
      expect((await store.folders.find(TENANT, root.id))?.isActive).toBe(true);
    });

    it('khôi phục thư mục cha thì thư mục con từng xoá riêng vẫn ở Thùng rác, và giờ có chỗ cũ để về', async () => {
      const { root, mid, leaf } = await tree();
      await store.folders.trash(TENANT, leaf.id, alice);
      await store.folders.trash(TENANT, mid.id, bob);
      let item = (await store.trash.list(TENANT)).find((entry) => entry.id === leaf.id);
      expect(item).toMatchObject({ location: `${root.name} / Giữa`, locationAvailable: false });

      await store.folders.restoreBranch(TENANT, mid.id, { parentId: root.id, name: 'Giữa', depthDelta: 0 });
      item = (await store.trash.list(TENANT)).find((entry) => entry.id === leaf.id);
      expect(item).toMatchObject({ locationAvailable: true });
      await store.folders.restoreBranch(TENANT, leaf.id, { parentId: mid.id, name: 'Lá', depthDelta: 0 });
      expect((await store.folders.list(TENANT)).find((entry) => entry.id === leaf.id)).toMatchObject({
        parentId: mid.id,
        depth: 2,
      });
    });

    it('xoá vĩnh viễn một thư mục không ở trong Thùng rác thì không làm gì', async () => {
      const { mid } = await tree();
      await expect(store.folders.purgeBranch(TENANT, mid.id, bob)).resolves.toEqual({
        storageKeys: [],
        documents: 0,
        folders: 0,
      });
      expect(await store.folders.find(TENANT, mid.id)).toBeDefined();
    });
  });

  describe('đếm trước khi xoá thư mục', () => {
    it('đếm tài liệu bị người khác khoá, bỏ qua tài liệu của chính mình và tài liệu đã xoá', async () => {
      const root = await folder('Khoá');
      const mine = await document(root, 'Của tôi');
      const theirs = await document(root, 'Của họ');
      const gone = await document(root, 'Đã xoá');
      await store.documents.setLock(TENANT, mine.document.id, alice);
      await store.documents.setLock(TENANT, theirs.document.id, bob);
      await store.documents.setLock(TENANT, gone.document.id, bob);
      await store.documents.trash(TENANT, gone.document.id, alice);
      await expect(store.documents.countLockedByOthers(TENANT, [root.id], alice)).resolves.toBe(1);
      await expect(store.documents.countLockedByOthers(TENANT, [root.id], bob)).resolves.toBe(1);
      await expect(store.documents.countLockedByOthers(TENANT, [], alice)).resolves.toBe(0);
    });

    it('đếm tài liệu người xem không được thấy theo độ mật, giống luật canSee', async () => {
      const root = await folder('Mật');
      await document(root, 'Nội bộ', { createdBy: bob });
      await document(root, 'Hạn chế', { createdBy: bob, confidentiality: 'restricted' });
      await document(root, 'Mật của họ', { createdBy: bob, confidentiality: 'confidential' });
      await document(root, 'Mật của tôi', { createdBy: alice, confidentiality: 'confidential' });
      await expect(store.documents.countHiddenFrom(TENANT, [root.id], { userId: alice, canSeeRestricted: true })).resolves.toBe(1);
      await expect(store.documents.countHiddenFrom(TENANT, [root.id], { userId: alice, canSeeRestricted: false })).resolves.toBe(2);
    });
  });

  describe('chia sẻ thư mục', () => {
    const unit = randomUUID();
    const position = randomUUID();
    // Các dòng ghi trong cùng một câu lệnh có cùng `created_at`: so theo thứ tự đối tượng.
    const order = ['everyone', 'unit', 'position', 'user'];
    const rows = async (folderId: string) =>
      (await store.shares.list(TENANT))
        .filter((share) => share.folderId === folderId)
        .sort((left, right) => order.indexOf(left.principalType) - order.indexOf(right.principalType))
        .map((share) => [share.principalType, share.principalId ?? null, share.role, share.expiresOn ?? null]);

    it('thay cả danh sách: thêm, đổi quyền, bỏ dòng; "mọi người" không có id', async () => {
      const root = await folder('Chia sẻ');
      await store.shares.replace(TENANT, root.id, alice, [
        { principalType: 'everyone', role: 'viewer' },
        { principalType: 'unit', principalId: unit, role: 'editor', expiresOn: '2026-12-31' },
        { principalType: 'user', principalId: bob, role: 'manager' },
      ]);
      expect(await rows(root.id)).toEqual([
        ['everyone', null, 'viewer', null],
        ['unit', unit, 'editor', '2026-12-31'],
        ['user', bob, 'manager', null],
      ]);

      await store.shares.replace(TENANT, root.id, bob, [
        { principalType: 'unit', principalId: unit, role: 'manager' },
        { principalType: 'position', principalId: position, role: 'viewer' },
      ]);
      expect(await rows(root.id)).toEqual([
        ['unit', unit, 'manager', null],
        ['position', position, 'viewer', null],
      ]);

      await store.shares.replace(TENANT, root.id, bob, []);
      expect(await rows(root.id)).toEqual([]);
    });

    it('dòng giữ nguyên quyền và thời hạn thì giữ người sửa cuối', async () => {
      const root = await folder('Người sửa cuối');
      await store.shares.replace(TENANT, root.id, alice, [
        { principalType: 'unit', principalId: unit, role: 'viewer' },
        { principalType: 'everyone', role: 'viewer' },
      ]);
      await store.shares.replace(TENANT, root.id, bob, [
        { principalType: 'unit', principalId: unit, role: 'viewer' },
        { principalType: 'everyone', role: 'editor' },
      ]);
      const byType = new Map(
        (await store.shares.list(TENANT))
          .filter((share) => share.folderId === root.id)
          .map((share) => [share.principalType, share.updatedBy]),
      );
      expect(byType.get('unit')).toBe(alice);
      expect(byType.get('everyone')).toBe(bob);
    });

    it('ràng buộc của bảng: "mọi người" không mang id, mỗi đối tượng một dòng, quyền đúng danh mục', async () => {
      const root = await folder('Ràng buộc');
      const insert = (type: string, id: string | null, role = 'viewer') =>
        pool.query(
          `INSERT INTO shared_schema.folder_shares (folder_id, principal_type, principal_id, role, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          [root.id, type, id, role, alice],
        );
      await expect(insert('everyone', unit)).rejects.toMatchObject({ code: '23514' });
      await expect(insert('unit', null)).rejects.toMatchObject({ code: '23514' });
      await expect(insert('unit', unit, 'owner')).rejects.toMatchObject({ code: '23514' });
      await insert('everyone', null);
      await expect(insert('everyone', null, 'editor')).rejects.toMatchObject({ code: '23505' });
      await insert('unit', unit);
      await expect(insert('unit', unit, 'manager')).rejects.toMatchObject({ code: '23505' });
    });

    it('thư mục vào Thùng rác vẫn giữ chia sẻ; xoá vĩnh viễn thì mất theo', async () => {
      const root = await folder('Giữ chia sẻ');
      const child = await folder('Con', root);
      await store.shares.replace(TENANT, child.id, alice, [{ principalType: 'unit', principalId: unit, role: 'editor' }]);
      await store.folders.trash(TENANT, root.id, alice);
      expect(await rows(child.id)).toHaveLength(1);
      const skeleton = await store.folders.skeleton(TENANT);
      expect(skeleton.find((item) => item.id === child.id)).toEqual({
        id: child.id,
        parentId: root.id,
        name: 'Con',
        createdBy: alice,
        isActive: false,
      });
      await store.folders.purgeBranch(TENANT, root.id, alice);
      expect(await rows(child.id)).toEqual([]);
    });

    it('lọc tài liệu theo danh sách thư mục được vào', async () => {
      const left = await folder('Trái');
      const right = await folder('Phải');
      await document(left, 'Tài liệu trái');
      await document(right, 'Tài liệu phải');
      const names = async (folderIds: string[]) =>
        (await store.documents.list(TENANT, { folderIds, status: 'active', search: 'Tài liệu', limit: 100 })).map(
          (doc) => doc.name,
        );
      expect(await names([left.id])).toEqual(['Tài liệu trái']);
      expect(await names([])).toEqual([]);
    });

    it('Thùng rác ghi thư mục chứa tài liệu; danh sách người dùng kèm trạng thái', async () => {
      const root = await folder('Thư mục chứa');
      const { document: doc } = await document(root, 'Bỏ');
      await store.documents.trash(TENANT, doc.id, alice);
      expect((await store.trash.list(TENANT)).find((entry) => entry.id === doc.id)?.folderId).toBe(root.id);
      const people = await store.people.list(TENANT);
      expect(people).toEqual(
        expect.arrayContaining([
          { id: alice, name: 'An', email: 'an@savina.vn', active: true },
          { id: bob, name: 'Bình', email: undefined, active: false },
        ]),
      );
    });
  });
});
