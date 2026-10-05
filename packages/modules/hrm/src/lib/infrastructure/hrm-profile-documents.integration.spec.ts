import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import {
  applyDocumentChanges,
  loadProfileDocuments,
  parseDocumentChanges,
} from './hrm-profile-documents.js';
import { approveProfileCorrection } from './hrm-request-transition.js';

jest.mock('./hrm-context.service.js', () => ({ HrmContextService: class {} }));
const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

integration('HRM profile documents', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID(),
    employeeId = randomUUID(),
    otherEmployeeId = randomUUID(),
    actorId = randomUUID();
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;
  const migrate = async (path: string) =>
    pool.query(
      await readFile(
        resolve(process.cwd(), '../../../migrations/tenant', path),
        'utf8',
      ),
    );
  async function attachment(owner: string, contentType = 'image/png') {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO hrm_schema.attachments(id,tenant_id,employee_id,file_name,object_key,content_type,size_bytes,status,uploaded_by)
       VALUES($1,$2,$3,'file',$4,$5,100,'READY',$6)`,
      [id, tenantId, owner, `k/${id}`, contentType, actorId],
    );
    return id;
  }
  async function inTx<T>(work: (db: never) => Promise<T>): Promise<T> {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const result = await work(db as never);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of [
      'core/0001-core-schema.sql',
      'core/0002-organization-soft-delete.sql',
      'core/0006-employees.sql',
      '0001-integration.sql',
      'hrm/0001-hrm.sql',
      'hrm/0002-employee-identity.sql',
      'hrm/0003-time-operations.sql',
      'hrm/0008-profile-corrections.sql',
      'hrm/0010-attachments.sql',
      'hrm/0014-hrm-profile-compatibility.sql',
      'hrm/0019-timesheet-attachment-lifecycle.sql',
      'hrm/0031-hrm-profile-documents.sql',
    ])
      await migrate(path);
    await pool.query(
      `INSERT INTO core_schema.employees(id,tenant_id,full_name) VALUES($1,$3,'A'),($2,$3,'B')`,
      [employeeId, otherEmployeeId, tenantId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles(employee_id,tenant_id,employee_code,join_date)
       VALUES($1,$3,'DOC-A','2026-01-01'),($2,$3,'DOC-B','2026-01-01')`,
      [employeeId, otherEmployeeId, tenantId],
    );
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName))
        throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 30_000);

  it('reports the identity card as missing until number and both images exist', async () => {
    const before = await loadProfileDocuments(pool, tenantId, employeeId);
    expect(before?.missingRequired).toEqual([
      'identityCardNumber',
      'identityCardFront',
      'identityCardBack',
    ]);
    await pool.query(
      `UPDATE hrm_schema.employee_profiles SET identity_card_number='079000000001' WHERE employee_id=$1`,
      [employeeId],
    );
    const front = await attachment(employeeId);
    const back = await attachment(employeeId, 'application/pdf');
    await inTx((db) =>
      applyDocumentChanges(
        db,
        tenantId,
        employeeId,
        actorId,
        parseDocumentChanges([
          {
            op: 'SET_DOCUMENT',
            documentType: 'ID_CARD_FRONT',
            attachmentId: front,
          },
          {
            op: 'SET_DOCUMENT',
            documentType: 'ID_CARD_BACK',
            attachmentId: back,
          },
        ]),
      ),
    );
    const after = await loadProfileDocuments(pool, tenantId, employeeId);
    expect(after?.missingRequired).toEqual([]);
    const flags = await pool.query(
      `SELECT document_type,is_confidential FROM hrm_schema.attachments WHERE id=ANY($1::uuid[]) ORDER BY document_type`,
      [[front, back]],
    );
    expect(flags.rows).toEqual([
      { document_type: 'ID_CARD_BACK', is_confidential: true },
      { document_type: 'ID_CARD_FRONT', is_confidential: true },
    ]);
  });

  it('rejects files of another employee and non-image photos', async () => {
    const foreign = await attachment(otherEmployeeId);
    await expect(
      inTx((db) =>
        applyDocumentChanges(db as never, tenantId, employeeId, actorId, [
          { op: 'SET_DOCUMENT', documentType: 'PHOTO', attachmentId: foreign },
        ]),
      ),
    ).rejects.toThrow('Tệp đính kèm không tồn tại');
    const pdf = await attachment(employeeId, 'application/pdf');
    await expect(
      inTx((db) =>
        applyDocumentChanges(db as never, tenantId, employeeId, actorId, [
          { op: 'SET_DOCUMENT', documentType: 'PHOTO', attachmentId: pdf },
        ]),
      ),
    ).rejects.toThrow('Ảnh thẻ phải là');
  });

  it('adds, updates and removes a passport as a qualification', async () => {
    const scan = await attachment(employeeId, 'application/pdf');
    await inTx((db) =>
      applyDocumentChanges(db as never, tenantId, employeeId, actorId, [
        {
          op: 'ADD_QUALIFICATION',
          qualification: {
            type: 'PASSPORT',
            name: 'Hộ chiếu',
            effectiveFrom: '2024-01-01',
            expiryDate: '2034-01-01',
            attachmentId: scan,
          },
        },
      ]),
    );
    let docs = await loadProfileDocuments(pool, tenantId, employeeId);
    expect(docs?.qualifications).toHaveLength(1);
    const q = docs!.qualifications[0];
    expect(q.expiryDate).toBe('2034-01-01');
    const flagged = await pool.query(
      `SELECT is_confidential FROM hrm_schema.attachments WHERE id=$1`,
      [scan],
    );
    expect(flagged.rows[0].is_confidential).toBe(true);
    await inTx((db) =>
      applyDocumentChanges(db as never, tenantId, employeeId, actorId, [
        {
          op: 'UPDATE_QUALIFICATION',
          id: q.id as string,
          qualification: {
            type: 'PASSPORT',
            name: 'Hộ chiếu gia hạn',
            expiryDate: '2036-01-01',
          },
        },
      ]),
    );
    docs = await loadProfileDocuments(pool, tenantId, employeeId);
    expect(docs?.qualifications[0].name).toBe('Hộ chiếu gia hạn');
    await inTx((db) =>
      applyDocumentChanges(db as never, tenantId, employeeId, actorId, [
        { op: 'REMOVE_QUALIFICATION', id: q.id as string },
      ]),
    );
    docs = await loadProfileDocuments(pool, tenantId, employeeId);
    expect(docs?.qualifications).toHaveLength(0);
  });

  it('applies document changes and the card expiry only when the request is approved', async () => {
    const photo = await attachment(employeeId);
    const request = (
      await pool.query(
        `INSERT INTO hrm_schema.profile_corrections(tenant_id,employee_id,changes,previous_values,reason,submitted_by,document_changes)
         VALUES($1,$2,$3,$4,'Đổi ảnh',$5,$6) RETURNING id`,
        [
          tenantId,
          employeeId,
          JSON.stringify({ identityCardExpiryDate: '2040-05-05' }),
          JSON.stringify({ identityCardExpiryDate: null }),
          actorId,
          JSON.stringify([
            { op: 'SET_DOCUMENT', documentType: 'PHOTO', attachmentId: photo },
          ]),
        ],
      )
    ).rows[0].id;
    expect(
      (await loadProfileDocuments(pool, tenantId, employeeId))?.photo,
    ).toBeNull();
    await inTx((db) =>
      approveProfileCorrection(db as never, tenantId, actorId, request),
    );
    const docs = await loadProfileDocuments(pool, tenantId, employeeId);
    expect(docs?.photo?.id).toBe(photo);
    expect(docs?.identityCardExpiryDate).toBe('2040-05-05');
  });
});
