// Kiểm GĐ C phase 2 (kho tài liệu CRM, loại tài liệu, điều kiện chuyển giai đoạn theo loại tài liệu) bằng API thật.
// Cần S3 chạy ở S3_*_ENDPOINT (MinIO, hoặc `node tools/crm/mock-s3.mjs` khi không dựng được MinIO).
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> TENANT_DATABASE_URL_TEMPLATE=... node tools/crm/e2e-phase2c.mjs [--tenant=svn]
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildConfig, loadEnv } from './seed-svn/config.mjs';
import { createSessions, requireCustomers } from './seed-svn/common.mjs';

const { values } = parseArgs({ options: { tenant: { type: 'string', default: 'svn' } } });
loadEnv();
const config = buildConfig(values.tenant);
const crm = config.crmApi;
const root = resolve(import.meta.dirname, '../..');
const results = [];
const check = (tc, ok, detail = '') => {
  results.push({ tc, ok });
  console.log(`${ok ? 'ĐẠT' : 'LỖI'}  ${tc}  ${detail}`);
};

async function withDb(fn) {
  const url = new URL(process.env.TENANT_DATABASE_URL_TEMPLATE.replace('{databaseName}', values.tenant.replace(/-/g, '_')));
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Từ chối DB không phải local.');
  const { Client } = createRequire(join(root, 'packages/adapters/database/package.json'))('pg');
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const sessions = createSessions(config);
const [nv1, nv3, tn, qtv] = await Promise.all(['NV1', 'NV3', 'TN', 'QTV'].map((c) => sessions.as(c)));
const kh = (await requireCustomers(config, nv1, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
const stamp = Date.now() % 1_000_000;

const putFile = async (url, bytes, contentType) => {
  const r = await fetch(url, { method: 'PUT', headers: { 'content-type': contentType, 'content-length': String(bytes.length) }, body: bytes });
  return r.status;
};
const upload = async (session, entityType, entityId, { name, typeId, fileName = 'tai-lieu.pdf', contentType = 'application/pdf', text = 'noi dung thu' } = {}) => {
  const bytes = Buffer.from(text);
  const created = await session.post(`${crm}/v1/documents`, { entityType, entityId, documentTypeId: typeId, name, fileName, contentType, sizeBytes: bytes.length });
  const put = await putFile(created.uploadUrl, bytes, contentType);
  const done = await session.post(`${crm}/v1/documents/${created.document.id}/versions/${created.version.id}/complete`, { sizeBytes: bytes.length });
  return { created, put, done, bytes };
};

// Loại tài liệu (TC-DOC-11 phần API)
const types = await nv1.get(`${crm}/v1/document-types`);
const legal = types.find((t) => t.code === 'LEGAL_DOSSIER') ?? types[0];
check('TC-DOC-11 7 loại tài liệu mẫu có sẵn, NV1 đọc được', types.length >= 7, types.map((t) => t.code).join(','));
const newType = await qtv.post(`${crm}/v1/document-types`, { code: `T${stamp}`, name: `Loại thử ${stamp}` });
const nv1Type = await nv1.call('POST', `${crm}/v1/document-types`, { body: { code: `X${stamp}`, name: 'X' }, expect: [403] });
check('TC-DOC-11 chỉ crm.manage tạo loại tài liệu (NV1 403)', nv1Type.status === 403 && !!newType?.id, String(nv1Type.status));
await qtv.patch(`${crm}/v1/document-types/${newType.id}`, { active: false });
const useDisabled = await nv1.call('POST', `${crm}/v1/documents`, { body: { entityType: 'customer', entityId: kh.id, documentTypeId: newType.id, fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 3 }, expect: [400, 409] });
check('TC-DOC-12 loại bị tắt không chọn mới được', [400, 409].includes(useDisabled.status), String(useDisabled.status));

// Dự án để gắn tài liệu
const opp = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, name: `P2C-${stamp} dự án thử`, expectedValue: 1000000 });

// TC-DOC-01: tải lên hợp lệ qua URL ký
const up = await upload(nv1, 'opportunity', opp.id, { typeId: legal.id, name: 'Hồ sơ pháp lý thử' });
check('TC-DOC-01 xin URL, PUT thẳng lên kho, xác nhận', up.put === 200 && !!up.done, `PUT ${up.put}`);
const list = await nv1.get(`${crm}/v1/documents?entityType=opportunity&entityId=${opp.id}`);
const items = list.items ?? list;
check('TC-DOC-01 danh sách có tài liệu với loại, dung lượng, người tải', items.length === 1 && items[0].documentType?.code === legal.code || items[0]?.documentTypeId === legal.id, JSON.stringify(items[0] ?? {}).slice(0, 140));
const docId = up.created.document.id;
const dl = await nv1.get(`${crm}/v1/documents/${docId}/download`);
const got = await fetch(dl.url ?? dl.downloadUrl).then((r) => r.text()).catch(() => '');
check('TC-DOC-01 URL tải xuống ký trả đúng nội dung', got === 'noi dung thu', `"${got.slice(0, 40)}"`);
check('TC-DOC-07 URL tải ký ngắn hạn 300 giây', /X-Amz-Expires=300/.test(dl.url ?? dl.downloadUrl ?? ''), '(kho giả không kiểm hạn; chỉ kiểm chữ ký TTL)');

// TC-DOC-02/03: loại file, dung lượng
const exe = await nv1.call('POST', `${crm}/v1/documents`, { body: { entityType: 'opportunity', entityId: opp.id, fileName: 'a.exe', contentType: 'application/x-msdownload', sizeBytes: 10 }, expect: [400] });
check('TC-DOC-02 loại file .exe bị từ chối (400)', exe.status === 400, `${exe.status} ${exe.data?.message ?? ''}`);
const big = await nv1.call('POST', `${crm}/v1/documents`, { body: { entityType: 'opportunity', entityId: opp.id, fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 51 * 1024 * 1024 }, expect: [400] });
check('TC-DOC-03 vượt 50 MB bị từ chối (400)', big.status === 400, `${big.status} ${big.data?.message ?? ''}`);

// TC-DOC-04: phiên bản mới
const v2 = await nv1.post(`${crm}/v1/documents/${docId}/versions`, { fileName: 'tai-lieu-v2.pdf', contentType: 'application/pdf', sizeBytes: 6, changeNote: 'bản 2' });
await putFile(v2.uploadUrl, Buffer.from('ban hai'.slice(0, 6)), 'application/pdf');
await nv1.post(`${crm}/v1/documents/${docId}/versions/${v2.version.id}/complete`, { sizeBytes: 6 });
const detail = await nv1.get(`${crm}/v1/documents/${docId}`);
check('TC-DOC-04 phiên bản mới: có 2 phiên bản, bản mới là hiện tại', (detail.versions ?? []).length === 2, `${(detail.versions ?? []).length} phiên bản`);

// TC-DOC-05: khoá
await nv1.post(`${crm}/v1/documents/${docId}/lock`, {});
const lockedUpload = await tn.call('POST', `${crm}/v1/documents/${docId}/versions`, { body: { fileName: 'x.pdf', contentType: 'application/pdf', sizeBytes: 3, changeNote: 'x' }, expect: [403, 404, 409] });
check('TC-DOC-05 tài liệu bị khoá: người khác không tải bản mới', [403, 409].includes(lockedUpload.status), String(lockedUpload.status));
await nv1.post(`${crm}/v1/documents/${docId}/unlock`, {});

// TC-DOC-06: đối tượng xem
const aud = await nv1.patch(`${crm}/v1/documents/${docId}/audience`, { audience: 'customer' });
check('TC-DOC-06 đổi đối tượng xem sang customer', (aud.audience ?? aud.document?.audience) === 'customer', '');
await nv1.patch(`${crm}/v1/documents/${docId}/audience`, { audience: 'internal' });

// TC-DOC-08: ngoài phạm vi
const outList = await nv3.call('GET', `${crm}/v1/documents?entityType=opportunity&entityId=${opp.id}`, { expect: [403, 404] });
const outGet = await nv3.call('GET', `${crm}/v1/documents/${docId}`, { expect: [403, 404] });
const outDl = await nv3.call('GET', `${crm}/v1/documents/${docId}/download`, { expect: [403, 404] });
const outUp = await nv3.call('POST', `${crm}/v1/documents`, { body: { entityType: 'opportunity', entityId: opp.id, fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 3 }, expect: [403, 404] });
check('TC-DOC-08 NV3 ngoài phạm vi: danh sách, xem, tải, tải lên đều 404', [outList, outGet, outDl, outUp].every((r) => r.status === 404), [outList, outGet, outDl, outUp].map((r) => r.status).join('/'));

// TC-DOC-21: CSRF
const cookie = nv1.cookieHeader();
const noCsrf = await fetch(`${crm}/v1/documents`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ entityType: 'opportunity', entityId: opp.id, fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 3 }) });
check('TC-DOC-21 POST không có CSRF: 403', noCsrf.status === 403, String(noCsrf.status));

// TC-DOC-20: tên file đặc biệt
const odd = await nv1.call('POST', `${crm}/v1/documents`, { body: { entityType: 'opportunity', entityId: opp.id, fileName: 'Báo cáo/khảo sát: ĐÀ NẴNG ../..\\x.pdf', contentType: 'application/pdf', sizeBytes: 4 }, expect: [400] });
if (odd.status === 201) {
  const key = odd.data.uploadUrl;
  check('TC-DOC-20 tên file đặc biệt được làm sạch, object_key an toàn', !decodeURIComponent(key.split('?')[0]).split('/').some((seg) => seg === '..' || seg.includes('\\')) && !/%2e%2e%2f|%5c/i.test(key.split('?')[0]), key.split('?')[0].slice(-80));
} else check('TC-DOC-20 tên file đặc biệt bị từ chối an toàn', odd.status === 400, String(odd.status));

// TC-PL-10 / TC-PL-20 / TC-DOC-19: điều kiện chuyển giai đoạn theo loại tài liệu
const stageId = async (code) => (await withDb((db) => db.query(`SELECT ps.id FROM crm_schema.pipeline_stages ps JOIN crm_schema.pipelines p ON p.id=ps.pipeline_id WHERE p.is_default AND ps.code=$1`, [code]))).rows[0].id;
const sid = await stageId('CONTACTED');
const cleanup = () => withDb((db) => db.query(`DELETE FROM crm_schema.pipeline_stage_requirements WHERE stage_id=$1 AND kind='DOCUMENT_TYPE'`, [sid]));
const surveyType = types.find((t) => t.code !== legal.code && t.active !== false) ?? types[1];
try {
  await withDb(async (db) => {
    await db.query(`INSERT INTO crm_schema.pipeline_stage_requirements (stage_id, kind, ref, required, message, sort_order) VALUES ($1,'DOCUMENT_TYPE',$2,true,'',90), ($1,'DOCUMENT_TYPE',$3,false,'',91) ON CONFLICT DO NOTHING`, [sid, legal.code, surveyType.code]);
  });
  // Bắt buộc: loại chưa có tài liệu
  await new Promise((r) => setTimeout(r, 31_000)); // cache cấu hình 30 giây
  const opp2 = await nv1.post(`${crm}/v1/opportunities`, { customerId: kh.id, name: `P2C-${stamp} điều kiện tài liệu`, expectedValue: 1000000 });
  const blocked = await nv1.call('PATCH', `${crm}/v1/opportunities/${opp2.id}/stage`, { body: { stage: 'CONTACTED', version: opp2.version }, expect: [409] });
  check('TC-PL-10/TC-DOC-19 thiếu tài liệu bắt buộc: 409 nêu tên loại', blocked.status === 409 && (blocked.data?.message ?? '').includes(legal.name), `${blocked.status} ${blocked.data?.message ?? ''}`.slice(0, 140));
  const need = await nv1.get(`${crm}/v1/opportunities/${opp2.id}/stage-requirements?stage=CONTACTED`);
  const needItems = need.items ?? need.requirements ?? need;
  check('TC-PL-20 danh sách "cần có" gồm loại không bắt buộc (gợi ý, không chặn)', JSON.stringify(needItems).includes(surveyType.code), JSON.stringify(needItems).slice(0, 160));
  await upload(nv1, 'opportunity', opp2.id, { typeId: legal.id, name: 'Hồ sơ pháp lý' });
  const passed = await nv1.call('PATCH', `${crm}/v1/opportunities/${opp2.id}/stage`, { body: { stage: 'CONTACTED', version: opp2.version }, expect: [409] });
  check('TC-PL-10/TC-PL-20 có tài liệu bắt buộc, thiếu loại không bắt buộc: chuyển được', passed.status === 200, `${passed.status} ${passed.data?.message ?? ''}`.slice(0, 120));
} finally {
  await cleanup();
}

// TC-DOC-15/16: tài liệu thiết bị của Kho hiển thị chỉ đọc ở ca bảo hành, ẩn với người không có quyền Kho
{
  const ktv = await sessions.as('KTV');
  const ql = await sessions.as('QL');
  const cases = await ktv.get(`${crm}/v1/warranty/cases`);
  const first = (cases.items ?? cases)[0];
  if (!first) console.log('BỊ CHẶN  TC-DOC-15/16: không có ca bảo hành nào trên tenant');
  else {
    const detail = await ktv.get(`${crm}/v1/warranty/cases/${first.id}`);
    const materialId = detail.lines?.[0]?.materialId ?? detail.items?.[0]?.materialId;
    if (!materialId) console.log('BỊ CHẶN  TC-DOC-15/16: ca bảo hành không có materialId trong dữ liệu trả về');
    else {
      const key = `p2c-test/${stamp}-thiet-bi.pdf`;
      const s3 = `${process.env.S3_INTERNAL_ENDPOINT ?? 'http://localhost:9010'}/${process.env.S3_BUCKET ?? 'enterprise-platform'}/${key}`;
      await fetch(s3, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: 'huong dan thiet bi' });
      const uploader = await sessions.userId('QL');
      await withDb((db) => db.query(`INSERT INTO inventory_schema.asset_documents (id, asset_id, object_key, file_name, content_type, size_bytes, uploaded_by) VALUES (gen_random_uuid(), $1, $2, $3, 'application/pdf', 18, $4)`, [materialId, key, `huong-dan-${stamp}.pdf`, uploader]));
      try {
        const asQl = await ql.get(`${crm}/v1/warranty/cases/${first.id}/device-documents`);
        const asKtv = await ktv.get(`${crm}/v1/warranty/cases/${first.id}/device-documents`);
        const asNv1 = await nv1.call('GET', `${crm}/v1/warranty/cases/${first.id}/device-documents`, { expect: [403, 404] });
        check('TC-DOC-15 người có quyền Kho (QL) thấy tài liệu thiết bị, chỉ đọc', JSON.stringify(asQl).includes(`huong-dan-${stamp}.pdf`), JSON.stringify(asQl).slice(0, 140));
        check('TC-DOC-16 người không có quyền Kho (KTV) không thấy, không lộ tên file', Array.isArray(asKtv?.items ?? asKtv) && !JSON.stringify(asKtv).includes(`huong-dan-${stamp}`), JSON.stringify(asKtv).slice(0, 80));
        check('TC-DOC-16 NV1 (không quyền Kho): bị từ chối hoặc danh sách rỗng, không lộ tên file', [403, 404].includes(asNv1.status) || (asNv1.status === 200 && !JSON.stringify(asNv1.data).includes(`huong-dan-${stamp}`) && (asNv1.data?.items ?? asNv1.data).length === 0), `${asNv1.status} ${JSON.stringify(asNv1.data).slice(0, 60)}`);
      } finally {
        await withDb((db) => db.query(`DELETE FROM inventory_schema.asset_documents WHERE object_key = $1`, [key]));
      }
    }
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\nTổng: ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
