import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CRM_NO_CAPABILITIES, type QuoteSeller, type SaveSalesOrganizationRequest } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { PriceListService } from './application/price-list.service.js';
import type { CatalogMaterial, CatalogReader } from './application/pricing-store.port.js';
import type { ApprovalLinks } from './application/quote-store.port.js';
import { QuoteService } from './application/quote.service.js';
import { SalesOrganizationService } from './application/sales-organization.service.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { PendingCatalogReader } from './infrastructure/pending-catalog-reader.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPriceListStore, PostgresPricingStore } from './infrastructure/postgres-pricing.store.js';
import { PostgresQuoteFormStore } from './infrastructure/postgres-quote-form.store.js';
import { PostgresQuoteSettingsStore } from './infrastructure/postgres-quote-settings.store.js';
import { PostgresQuoteStore } from './infrastructure/postgres-quote.store.js';
import { PostgresSalesOrganizationStore } from './infrastructure/postgres-sales-organization.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const CAP = randomUUID();
const NV1 = randomUUID();
const ORGANIZATION: ReportingLineSnapshot = {
  positions: [{ id: 'p-nv1', reportsToPositionId: null }],
  assignments: [{ userId: NV1, positionId: 'p-nv1' }],
};

class FakeCatalog implements CatalogReader {
  readonly known: CatalogMaterial[] = [
    { id: CAP, code: 'QA-ORG-CAP', name: 'Cáp đồng', unit: 'Cái', category: 'Thiết bị', kind: 'STOCK', avgCost: 800_000, totalAvailable: 70 },
  ];
  async materials(_tenantId: string, ids: readonly string[]) {
    return new Map(this.known.filter((material) => ids.includes(material.id)).map((material) => [material.id, material]));
  }
  async search() {
    return this.known;
  }
}

const noLinks: ApprovalLinks = { start: async () => undefined };

/** Ảnh PNG giả (đúng chữ ký PNG) kích thước `size` byte, khác nhau theo `fill`. */
const png = (size: number, fill = 0x41) => {
  const bytes = Buffer.alloc(size, fill);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return `data:image/png;base64,${bytes.toString('base64')}`;
};

const requireSeller = (seller: QuoteSeller | null): QuoteSeller => {
  if (!seller) throw new Error('Báo giá chưa có thông tin tổ chức.');
  return seller;
};

const organization = (name: string, extra: Partial<SaveSalesOrganizationRequest> = {}): SaveSalesOrganizationRequest => ({
  name,
  address: `Địa chỉ ${name}`,
  taxCode: '0101234567',
  phone: '024 1111 2222',
  email: 'lienhe@example.vn',
  ...extra,
});

integration('Bán hàng phase 3: tổ chức báo giá (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  const tenantId = randomUUID();
  const actor = (userId: string, extra: Partial<CrmActor> = {}): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Người dùng',
    ...extra,
  });
  /** NV1: lập báo giá, không có `crm.manage`. */
  const nv1 = actor(NV1, { canWriteOpportunity: true, canWriteQuote: true });
  /** KTV: chỉ `crm.read`. */
  const ktv = actor(randomUUID());
  /** QTBH: `crm.manage`. */
  const admin = actor(randomUUID(), { canManage: true, canReadAll: true, canWriteQuote: true, canWriteOpportunity: true });

  let quotes: QuoteService;
  let organizations: SalesOrganizationService;
  let customerId: string;

  const audits = async (id: string) =>
    (
      await handle.pool.query<{ action: string; metadata: Record<string, unknown> }>(
        `SELECT action, metadata FROM crm_schema.audit_log WHERE entity_type = 'sales_organization' AND entity_id = $1 ORDER BY at, id`,
        [id],
      )
    ).rows;
  const versionRow = async (quoteId: string, versionNo: number) =>
    (
      await handle.pool.query<{ organization_id: string | null; seller: unknown; seller_logo_snapshot: string | null }>(
        `SELECT organization_id, seller, seller_logo_snapshot FROM crm_schema.quote_versions WHERE quote_id = $1 AND version_no = $2`,
        [quoteId, versionNo],
      )
    ).rows[0];

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const customerStore = new PostgresCustomerStore(handle.database);
    const organizationStore = new PostgresSalesOrganizationStore(handle.database);
    quotes = new QuoteService(
      new PostgresQuoteStore(handle.database),
      new PostgresQuoteSettingsStore(handle.database),
      new PostgresPricingStore(handle.database),
      new FakeCatalog(),
      customerStore,
      new PostgresOpportunityStore(handle.database),
      scopes,
      noLinks,
      { snapshot: async () => ORGANIZATION },
      undefined,
      undefined,
      new PostgresQuoteFormStore(handle.database),
      organizationStore,
    );
    organizations = new SalesOrganizationService(organizationStore);
    const lists = new PriceListService(new PostgresPriceListStore(handle.database), new PendingCatalogReader());
    const list = await lists.create(admin, { code: 'BG-ORG', name: 'Bảng giá chuẩn', isStandard: true, validFrom: '2026-01-01' });
    await lists.upsertItems(admin, list.id, {
      items: [{ materialId: CAP, materialCode: 'QA-ORG-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 10 }],
    });
    customerId = (await new CustomerService(customerStore, scopes).create(nv1, { name: 'Khách tổ chức báo giá', ownerUserId: NV1 })).id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  async function draft(extra: Record<string, unknown> = {}) {
    const created = await quotes.create(nv1, { customerId, ...extra });
    return quotes.addLine(nv1, created.id, created.currentVersion, { revision: created.version.revision, materialId: CAP, quantity: 1 });
  }

  async function sent(extra: Record<string, unknown> = {}) {
    let current = await draft(extra);
    current = await quotes.submit(nv1, current.id, 1, { revision: current.version.revision });
    current = await quotes.send(nv1, current.id, 1, { revision: current.version.revision });
    expect(current.status).toBe('SENT');
    return current;
  }

  it('TC-ORG-03: 0035 tạo bảng, 3 index duy nhất, 3 cột cho phép rỗng; chạy lại không lỗi', async () => {
    const columns = await handle.pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'crm_schema' AND table_name = 'quote_versions'
          AND column_name IN ('organization_id', 'seller', 'seller_logo_snapshot')
        ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'organization_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'seller', data_type: 'jsonb', is_nullable: 'YES' },
      { column_name: 'seller_logo_snapshot', data_type: 'text', is_nullable: 'YES' },
    ]);
    const indexes = await handle.pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'crm_schema' AND tablename = 'sales_organizations' AND indexdef LIKE 'CREATE UNIQUE%'
        ORDER BY indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'sales_organizations_pkey',
      'uq_crm_sales_organizations_code',
      'uq_crm_sales_organizations_default',
      'uq_crm_sales_organizations_name',
    ]);
    const sql = await readFile(resolve(process.cwd(), '../../../migrations/tenant/crm/0035-sales-organizations.sql'), 'utf8');
    const client = await handle.pool.connect();
    try {
      for (let run = 0; run < 2; run += 1) {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
      }
    } finally {
      client.release();
    }
  });

  it('TC-ORG-12: báo giá cũ không có tổ chức: đọc, sửa, gửi không lỗi; tổ chức và thông tin rỗng', async () => {
    const old = await handle.pool.query<{ id: string }>(
      `INSERT INTO crm_schema.quotes (code, customer_id, owner_user_id) VALUES ('BG-ORG-OLD', $1, $2) RETURNING id`,
      [customerId, NV1],
    );
    const id = old.rows[0].id;
    await handle.pool.query(`INSERT INTO crm_schema.quote_versions (quote_id, version_no) VALUES ($1, 1)`, [id]);
    const loaded = await quotes.get(nv1, id);
    expect(loaded.version.form).toMatchObject({ organizationId: null, organizationName: null, seller: null });
    expect(loaded.version.sellerLogo).toBeNull();
    let current = await quotes.addLine(nv1, id, 1, { revision: loaded.version.revision, materialId: CAP, quantity: 1 });
    expect(current.version.form).toMatchObject({ organizationId: null, seller: null });
    current = await quotes.submit(nv1, id, 1, { revision: current.version.revision });
    current = await quotes.send(nv1, id, 1, { revision: current.version.revision });
    expect(current.version.sellerLogo).toBeNull();
    expect(await versionRow(id, 1)).toEqual({ organization_id: null, seller: null, seller_logo_snapshot: '' });
  });

  it('TC-ORG-04: tạo, sửa, tắt, bật, xoá tổ chức chưa dùng; danh sách không có logo; audit không chứa logo', async () => {
    const logo = png(2_000);
    const created = await organizations.create(admin, organization('Công ty CRUD', { code: 'CRUD', logo, sortOrder: 5 }));
    expect(created).toMatchObject({ name: 'Công ty CRUD', code: 'CRUD', hasLogo: true, logo, active: true, isDefault: false, inUse: false });
    const listed = (await organizations.list(ktv, undefined)).find((item) => item.id === created.id);
    expect(listed).toMatchObject({ hasLogo: true, inUse: false });
    expect(listed).not.toHaveProperty('logo');
    expect(await organizations.get(ktv, created.id)).toMatchObject({ logo });

    const updated = await organizations.update(admin, created.id, organization('Công ty CRUD mới', { code: 'CRUD', logo: null }));
    expect(updated).toMatchObject({ name: 'Công ty CRUD mới', hasLogo: false, logo: null });
    await organizations.update(admin, created.id, { active: false });
    expect((await organizations.list(ktv, undefined)).some((item) => item.id === created.id)).toBe(false);
    expect((await organizations.list(ktv, 'true')).find((item) => item.id === created.id)).toMatchObject({ active: false });
    expect(await organizations.update(admin, created.id, { active: true })).toMatchObject({ active: true, name: 'Công ty CRUD mới' });

    await organizations.remove(admin, created.id);
    await expect(organizations.get(admin, created.id)).rejects.toMatchObject({ statusCode: 404, code: 'SALES_ORGANIZATION_NOT_FOUND' });
    const entries = await audits(created.id);
    expect(entries.map((entry) => entry.action)).toEqual(['create', 'update', 'update', 'update', 'delete']);
    expect(entries[0].metadata).toMatchObject({ name: 'Công ty CRUD', hasLogo: true });
    expect(JSON.stringify(entries)).not.toContain('base64');
  });

  it('TC-ORG-04: lỗi kiểm trả 400 SALES_ORGANIZATION_INVALID kèm fieldErrors', async () => {
    await expect(organizations.create(admin, organization('Thiếu MST', { taxCode: '123', logo: 'data:image/svg+xml;base64,AAAA' }))).rejects.toMatchObject({
      statusCode: 400,
      code: 'SALES_ORGANIZATION_INVALID',
      details: {
        fieldErrors: [
          { field: 'taxCode', message: expect.any(String) },
          { field: 'logo', message: 'Logo phải là ảnh PNG hoặc JPEG.' },
        ],
      },
    });
  });

  it('TC-ORG-05: trùng tên (khác hoa thường), trùng mã: 409 tiếng Việt; xoá tổ chức đã dùng: 409', async () => {
    const first = await organizations.create(admin, organization('Công ty Trùng', { code: 'TRUNG' }));
    await expect(organizations.create(admin, organization('CÔNG TY TRÙNG'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'SALES_ORGANIZATION_NAME_EXISTS',
      message: 'Tên tổ chức đã tồn tại.',
    });
    await expect(organizations.create(admin, organization('Công ty khác', { code: 'trung' }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'SALES_ORGANIZATION_CODE_EXISTS',
      message: 'Mã tổ chức đã tồn tại.',
    });
    const other = await organizations.create(admin, organization('Công ty khác'));
    await expect(organizations.update(admin, other.id, organization('công ty trùng'))).rejects.toMatchObject({
      code: 'SALES_ORGANIZATION_NAME_EXISTS',
    });

    await draft({ organizationId: first.id });
    expect((await organizations.list(ktv, undefined)).find((item) => item.id === first.id)).toMatchObject({ inUse: true });
    await expect(organizations.remove(admin, first.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SALES_ORGANIZATION_IN_USE',
      message: 'Tổ chức đã có báo giá, chỉ tắt được.',
    });
    expect(await organizations.update(admin, first.id, { active: false })).toMatchObject({ active: false });
  });

  it('TC-ORG-07: NV1 không tạo, sửa, xoá được (403); KTV chỉ đọc được', async () => {
    const target = await organizations.create(admin, organization('Công ty Quyền'));
    for (const who of [nv1, ktv]) {
      await expect(organizations.create(who, organization('Công ty NV1'))).rejects.toMatchObject({ statusCode: 403 });
      await expect(organizations.update(who, target.id, organization('Đổi tên'))).rejects.toMatchObject({ statusCode: 403 });
      await expect(organizations.remove(who, target.id)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect((await organizations.list(ktv, undefined)).some((item) => item.id === target.id)).toBe(true);
    expect(await organizations.get(ktv, target.id)).toMatchObject({ name: 'Công ty Quyền' });
    await organizations.update(admin, target.id, { active: false });
  });

  describe('tổ chức trên báo giá', () => {
    let a: string;
    let b: string;
    const logoA1 = png(1_000, 0x41);
    const logoA2 = png(1_000, 0x42);

    beforeAll(async () => {
      a = (await organizations.create(admin, organization('Công ty A', { code: 'ORG-A', isDefault: true, logo: logoA1, shortName: 'A' }))).id;
      b = (await organizations.create(admin, organization('Công ty B', { code: 'ORG-B', phone: '028 3333 4444' }))).id;
    });

    it('TC-ORG-06: đặt mặc định A rồi B: chỉ B là mặc định', async () => {
      const c = await organizations.create(admin, organization('Công ty Mặc định C', { isDefault: true }));
      await organizations.update(admin, b, { isDefault: true });
      const listed = await organizations.list(admin, 'true');
      expect(listed.filter((item) => item.isDefault).map((item) => item.id)).toEqual([b]);
      // Trả A làm mặc định cho các ca sau.
      await organizations.update(admin, a, { isDefault: true });
      expect((await organizations.list(admin, 'true')).filter((item) => item.isDefault).map((item) => item.id)).toEqual([a]);
      await organizations.remove(admin, c.id);
    });

    it('TC-ORG-08: lập không gửi tổ chức: A; với B: B; với tổ chức tắt: 400; seller sửa tay giữ chữ; null: không chọn', async () => {
      const byDefault = await quotes.create(nv1, { customerId });
      expect(byDefault.version.form).toMatchObject({
        organizationId: a,
        organizationName: 'Công ty A',
        seller: { name: 'Công ty A', shortName: 'A', taxCode: '0101234567', phone: '024 1111 2222', website: null },
      });
      expect(byDefault.version.sellerLogo).toBe(logoA1);

      const withB = await quotes.create(nv1, { customerId, organizationId: b });
      expect(withB.version.form).toMatchObject({ organizationId: b, organizationName: 'Công ty B', seller: { name: 'Công ty B', phone: '028 3333 4444' } });
      expect(withB.version.sellerLogo).toBeNull();

      const inactive = await organizations.create(admin, organization('Công ty đã tắt', { active: false }));
      await expect(quotes.create(nv1, { customerId, organizationId: inactive.id })).rejects.toMatchObject({
        statusCode: 400,
        code: 'SALES_ORGANIZATION_INACTIVE',
      });
      await expect(quotes.create(nv1, { customerId, organizationId: randomUUID() })).rejects.toMatchObject({
        statusCode: 404,
        code: 'SALES_ORGANIZATION_NOT_FOUND',
      });

      const manual = await quotes.create(nv1, {
        customerId,
        organizationId: b,
        seller: { ...requireSeller(withB.version.form.seller), phone: '0909 000 111' },
      });
      expect(manual.version.form).toMatchObject({ organizationId: b, seller: { name: 'Công ty B', phone: '0909 000 111' } });

      const none = await quotes.create(nv1, { customerId, organizationId: null });
      expect(none.version.form).toMatchObject({ organizationId: null, organizationName: null, seller: null });
      expect(none.version.sellerLogo).toBeNull();

      await expect(
        quotes.create(nv1, { customerId, seller: { name: 'x'.repeat(201) } as never }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'SALES_ORGANIZATION_INVALID', details: { fieldErrors: [expect.objectContaining({ field: 'name' })] } });
    });

    it('TC-ORG-09: Nháp đổi tổ chức chép thông tin mới; bỏ tổ chức thì rỗng; giữ tổ chức đã tắt được; Chờ duyệt bị chặn', async () => {
      const created = await draft();
      expect(created.version.form.organizationId).toBe(a);
      let current = await quotes.updateVersion(nv1, created.id, 1, { revision: created.version.revision, organizationId: b });
      expect(current.version.form).toMatchObject({ organizationId: b, seller: { name: 'Công ty B', phone: '028 3333 4444' } });

      current = await quotes.updateVersion(nv1, created.id, 1, {
        revision: current.version.revision,
        seller: { ...requireSeller(current.version.form.seller), email: 'rieng@example.vn' },
      });
      expect(current.version.form).toMatchObject({ organizationId: b, seller: { email: 'rieng@example.vn' } });

      current = await quotes.updateVersion(nv1, created.id, 1, { revision: current.version.revision, organizationId: null });
      expect(current.version.form).toMatchObject({ organizationId: null, organizationName: null, seller: null });

      // Giữ nguyên tổ chức đã tắt: không bị chặn, thông tin sửa tay giữ nguyên.
      const kept = await organizations.create(admin, organization('Công ty Giữ'));
      current = await quotes.updateVersion(nv1, created.id, 1, { revision: current.version.revision, organizationId: kept.id });
      await organizations.update(admin, kept.id, { active: false });
      current = await quotes.updateVersion(nv1, created.id, 1, {
        revision: current.version.revision,
        organizationId: kept.id,
        note: 'Giữ tổ chức đã tắt',
      });
      expect(current.version.form).toMatchObject({ organizationId: kept.id, seller: { name: 'Công ty Giữ' } });
      // Đổi sang tổ chức đã tắt khác thì bị chặn.
      const off = await organizations.create(admin, organization('Công ty Tắt khác', { active: false }));
      await expect(
        quotes.updateVersion(nv1, created.id, 1, { revision: current.version.revision, organizationId: off.id }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'SALES_ORGANIZATION_INACTIVE' });

      await handle.pool.query(`UPDATE crm_schema.quote_versions SET status = 'PENDING' WHERE quote_id = $1`, [created.id]);
      await handle.pool.query(`UPDATE crm_schema.quotes SET status = 'PENDING' WHERE id = $1`, [created.id]);
      await expect(
        quotes.updateVersion(nv1, created.id, 1, { revision: current.version.revision, organizationId: a }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'QUOTE_PENDING' });
      expect((await versionRow(created.id, 1)).organization_id).toBe(kept.id);
    });

    it('TC-ORG-10, TC-ORG-11: gửi khách chụp logo A; đổi, xoá logo A không đổi báo giá đã gửi; phiên bản mới chép tổ chức, chưa chụp', async () => {
      const quote = await sent();
      expect(quote.version.form.organizationId).toBe(a);
      expect(quote.version.sellerLogo).toBe(logoA1);
      expect((await versionRow(quote.id, 1)).seller_logo_snapshot).toBe(logoA1);

      await organizations.update(admin, a, { logo: logoA2 });
      expect((await quotes.get(nv1, quote.id)).version.sellerLogo).toBe(logoA1);
      await organizations.update(admin, a, { logo: null });
      expect((await quotes.get(nv1, quote.id)).version.sellerLogo).toBe(logoA1);

      // Tổ chức không có logo lúc gửi: rỗng mãi, kể cả khi sau đó tổ chức có logo.
      await organizations.update(admin, a, { logo: null });
      const noLogo = await sent();
      expect(noLogo.version.sellerLogo).toBeNull();
      expect((await versionRow(noLogo.id, 1)).seller_logo_snapshot).toBe('');
      await organizations.update(admin, a, { logo: logoA2 });
      expect((await quotes.get(nv1, noLogo.id)).version.sellerLogo).toBeNull();

      // TC-ORG-11: sửa báo giá đã gửi sinh phiên bản 2 cùng tổ chức, cùng thông tin; chưa có bản chụp logo.
      const v1 = await quotes.get(nv1, quote.id);
      const v2 = await quotes.revise(nv1, quote.id, 1, { revision: v1.version.revision });
      expect(v2).toMatchObject({ currentVersion: 2, status: 'DRAFT' });
      expect(v2.version.form).toMatchObject({ organizationId: a, seller: v1.version.form.seller });
      expect((await versionRow(quote.id, 2)).seller_logo_snapshot).toBeNull();
      // Chưa gửi: logo hiện tại của tổ chức.
      expect(v2.version.sellerLogo).toBe(logoA2);
      expect((await quotes.get(nv1, quote.id, '1')).version.sellerLogo).toBe(logoA1);
    });
  });
});
