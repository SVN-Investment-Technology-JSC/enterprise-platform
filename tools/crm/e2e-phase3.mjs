// Kiểm phase 3 (bố cục in của mẫu báo giá) bằng API thật trên tenant `svn` (P3C5-02): quyền, kiểm hợp lệ, xung đột,
// bản chụp khi gửi và các chuyển trạng thái khác, chèn dòng. Cần đã chạy `seed-svn.mjs --step=phase3`.
// Chạy: SVN_SEED_PASSWORD=<mật khẩu> node tools/crm/e2e-phase3.mjs [--tenant=svn] [--other-tenant=svn2] [--gateway=http://localhost:8089]
//   --gateway: nginx thật (infrastructure/nginx/nginx.conf) cho TC-TL-19; bỏ trống thì TC-TL-19 ghi BỊ CHẶN.
// Tài khoản (test_phase3 mục 1.3): QTV, QTBH, NV1, NV3; XEM = KTV (crm.read, không lập báo giá); KQ = TK (không có quyền CRM).
// Mỗi lượt để lại vài báo giá `QA-P3E <số>` và mẫu thử `QA-P3E Mẫu thử API` (đang tắt); bố cục M-A4 được trả về như cũ.
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { defaultQuoteLayout, utf8ByteLength, validateQuoteLayout } from '../../packages/contracts/crm/src/lib/quote-layout.ts';
import { createSessions, materialsByCode, requireCustomers } from './seed-svn/common.mjs';
import { buildConfig, loadEnv } from './seed-svn/config.mjs';
import { Session } from './seed-svn/http.mjs';
import { M_OFF_TITLE, requirePhase3, sendQuote } from './seed-svn/phase3.mjs';

const { values } = parseArgs({
  options: {
    tenant: { type: 'string', default: 'svn' },
    'other-tenant': { type: 'string', default: 'svn2' },
    gateway: { type: 'string', default: '' },
  },
});
loadEnv();
const config = buildConfig(values.tenant);
const crm = config.crmApi;
const sessions = createSessions(config);

// ---------------------------------------------------------------------------
// Ghi kết quả: mỗi TC gồm nhiều phép kiểm; TC đạt khi mọi phép kiểm đạt. BỊ CHẶN không tính đạt, không tính lỗi.
// ---------------------------------------------------------------------------
const tcs = new Map();
const tcOf = (tc) => {
  if (!tcs.has(tc)) tcs.set(tc, { pass: 0, fail: 0, blocked: [] });
  return tcs.get(tc);
};
const check = (tc, ok, label, detail = '') => {
  const entry = tcOf(tc);
  if (ok) entry.pass += 1;
  else entry.fail += 1;
  console.log(`${ok ? 'ĐẠT' : 'LỖI'}  ${tc}  ${label}${detail ? `  [${detail}]` : ''}`);
};
const blocked = (tc, reason) => {
  tcOf(tc).blocked.push(reason);
  console.log(`BỊ CHẶN  ${tc}  ${reason}`);
};
/** Chạy một nhóm; lỗi bất ngờ ghi LỖI cho TC đó, các nhóm sau vẫn chạy. */
const group = async (tc, fn) => {
  try {
    await fn();
  } catch (error) {
    check(tc, false, 'lỗi bất ngờ khi chạy', (error instanceof Error ? error.message : String(error)).slice(0, 300));
  }
};

const VIETNAMESE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const stamp = Date.now() % 1_000_000;
const ACCEPT = [400, 401, 403, 404, 409, 413];

const [qtv, qtbh, nv1, nv3, xem, kq] = await Promise.all(['QTV', 'QTBH', 'NV1', 'NV3', 'KTV', 'TK'].map((code) => sessions.as(code)));
const qtbhId = await sessions.userId('QTBH');
const fx = await requirePhase3(config, sessions);
const T = fx.templates;
const Q = fx.quotes;
const kh = (await requireCustomers(config, nv1, ['QA-CRM-KH01'])).get('QA-CRM-KH01');
const materials = await materialsByCode(config, qtv);
const mat = (code) => {
  const found = materials.get(code);
  if (!found) throw new Error(`Chưa có mặt hàng ${code}.`);
  return found.id;
};

const layoutUrl = (id) => `${crm}/v1/quote-templates/${id}/layout`;
const getLayout = (session, id) => session.call('GET', layoutUrl(id), { expect: ACCEPT });
const putLayout = (session, id, body) => session.call('PUT', layoutUrl(id), { body, expect: ACCEPT });
const errorText = (r) => `${r.status} ${r.data?.code ?? ''} ${(r.data?.message ?? '').slice(0, 90)}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Mẫu thử của script: đang tắt (không hiện ở ô chọn mẫu của NV1), chỉ dùng để lưu bố cục thử.
const SCRATCH = { name: 'QA-P3E Mẫu thử API', discountMode: 'LINE', taxMode: 'LINE', description: 'QA-P3: mẫu thử của e2e-phase3.mjs', active: false, isDefault: false, sortOrder: 90 };
let scratch = (await qtbh.get(`${crm}/v1/quote-templates?includeInactive=true`)).find((t) => t.name === SCRATCH.name);
if (!scratch) scratch = await qtbh.post(`${crm}/v1/quote-templates`, SCRATCH);

/** Bố cục tối thiểu hợp lệ có các khối cho sẵn. */
const page = (blocks, extra = {}) => ({
  version: 1,
  paper: 'A4',
  orientation: 'portrait',
  marginsMm: { top: 15, right: 15, bottom: 15, left: 15 },
  fontFamily: 'Arial',
  fontSizePt: 12,
  blocks,
  ...extra,
});
const spacer = (id) => ({ id, type: 'spacer', heightMm: 5 });
const text = (id, value) => ({ id, type: 'text', align: 'left', runs: [{ text: value }] });
const image = (id, src) => ({ id, type: 'image', src, heightMm: 20, align: 'left' });
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const fakePng = (bytes) => `data:image/png;base64,${Buffer.concat([PNG_SIG, randomBytes(bytes - PNG_SIG.length)]).toString('base64')}`;
const fakeJpeg = (bytes) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(bytes - 3)]).toString('base64')}`;
const lineTable = (id, columns) => ({ id, type: 'lineTable', columns });
const col = (key, widthPct, visible = true) => ({ key, label: key, widthPct, align: 'left', visible });

/** Lưu bố cục vào mẫu thử, trả kết quả; ghi đè (không gửi expectedUpdatedAt). */
const trySave = (layout, session = qtbh) => putLayout(session, scratch.id, { layout });
const expectCode = (tc, label, r, status, code) =>
  check(tc, r.status === status && (!code || r.data?.code === code), label, errorText(r));

/**
 * Bố cục có kích thước đúng `target` byte (UTF-8 của `JSON.stringify` sau chuẩn hoá, D3-14): 2 ảnh 300 KB, 1 ảnh cỡ
 * vừa, 1 đoạn chữ ASCII đệm cho đủ byte. Trên 1 MB thì dựng đúng 1 MB rồi thêm chữ đệm (mỗi ký tự ASCII 1 byte), vì
 * hàm kiểm từ chối bố cục quá lớn nên không đo được trực tiếp.
 */
function sizedLayout(target) {
  const limit = 1024 * 1024;
  if (target > limit) {
    const layout = sizedLayout(limit);
    const [a, b, c, padBlock] = layout.blocks;
    return { ...layout, blocks: [a, b, c, text('pad', padBlock.runs[0].text + 'x'.repeat(target - limit))] };
  }
  const full = fakePng(300 * 1024);
  const build = (bytes, pad) => page([image('img-1', full), image('img-2', full), image('img-3', fakePng(bytes)), text('pad', pad)]);
  const sizeOf = (layout) => {
    const result = validateQuoteLayout(layout);
    if (!result.ok) throw new Error(`bố cục dựng sai: ${JSON.stringify(result.errors).slice(0, 200)}`);
    return utf8ByteLength(JSON.stringify(result.layout));
  };
  const base = 3 * 30_000;
  const s0 = sizeOf(build(base, ''));
  // Mỗi 3 byte ảnh thêm đúng 4 ký tự base64; phần lẻ bù bằng chữ đệm (0..3999 ký tự).
  const bytes = base + 3 * Math.floor((target - s0 - 2000) / 4);
  if (bytes < 16 || bytes > 300 * 1024) throw new Error(`không dựng được bố cục ${target} byte`);
  const s1 = sizeOf(build(bytes, ''));
  const pad = 'x'.repeat(target - s1);
  const layout = build(bytes, pad);
  const size = sizeOf(layout);
  if (size !== target) throw new Error(`bố cục dựng ra ${size} byte, cần ${target}`);
  return layout;
}

// Quote helpers -----------------------------------------------------------------------------------------------------
const quoteUrl = (id) => `${crm}/v1/quotes/${id}`;
async function newQuote(label, templateId, lines) {
  let detail = await nv1.post(`${crm}/v1/quotes`, { customerId: kh.id, templateId, quoteName: `QA-P3E ${stamp} ${label}` });
  detail = await nv1.post(`${quoteUrl(detail.id)}/versions/${detail.version.versionNo}/lines/batch`, { revision: detail.version.revision, lines });
  return detail;
}
const THREE = () => [
  { materialId: mat('QA-KHO-CAP'), quantity: 2 },
  { materialId: mat('QA-KHO-MUC'), quantity: 3 },
  { materialId: mat('QA-KHO-BT'), quantity: 1 },
];
const titleOf = (layout) => layout?.blocks?.find((block) => block.type === 'title')?.text;

console.log(`Tenant ${values.tenant}; mẫu thử ${scratch.id}; M-A4 ${T['M-A4'].id}\n`);

// ===================================================================================================================
// Quyền và cách ly (TC-P3PERM)
// ===================================================================================================================
await group('TC-P3PERM-02', async () => {
  const tc = 'TC-P3PERM-02';
  for (const [code, session] of [['NV1', nv1], ['XEM (KTV)', xem]]) {
    const r = await getLayout(session, T['M-A4'].id);
    check(tc, r.status === 200 && !!r.data?.layout, `${code} đọc bố cục M-A4: 200`, String(r.status));
  }
  const denied = await getLayout(kq, T['M-A4'].id);
  check(tc, denied.status === 403, 'KQ (TK, không có quyền CRM) đọc bố cục: 403', errorText(denied));
  const anon = await fetch(layoutUrl(T['M-A4'].id), { headers: { accept: 'application/json' } });
  check(tc, anon.status === 401, 'Chưa đăng nhập đọc bố cục: 401', String(anon.status));
});

await group('TC-P3PERM-01', async () => {
  const tc = 'TC-P3PERM-01';
  const before = (await getLayout(qtbh, T['M-A4'].id)).data;
  for (const [code, session] of [['NV1', nv1], ['XEM (KTV)', xem]]) {
    const r = await putLayout(session, T['M-A4'].id, { layout: defaultQuoteLayout(), expectedUpdatedAt: before.updatedAt });
    check(tc, r.status === 403 && VIETNAMESE.test(r.data?.message ?? ''), `${code} lưu bố cục: 403 câu tiếng Việt`, errorText(r));
  }
  const kqPut = await putLayout(kq, T['M-A4'].id, { layout: defaultQuoteLayout() });
  check(tc, kqPut.status === 403, 'KQ lưu bố cục: 403', errorText(kqPut));
  const after = (await getLayout(qtbh, T['M-A4'].id)).data;
  check(tc, after.updatedAt === before.updatedAt && same(after.layout, before.layout), 'DB không đổi sau các lần bị từ chối', `${before.updatedAt} -> ${after.updatedAt}`);
});

await group('TC-P3PERM-07', async () => {
  const tc = 'TC-P3PERM-07';
  const before = (await getLayout(qtbh, scratch.id)).data;
  const response = await fetch(layoutUrl(scratch.id), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json', cookie: qtbh.cookieHeader() },
    body: JSON.stringify({ layout: defaultQuoteLayout() }),
  });
  check(tc, response.status === 403, 'PUT bố cục có phiên nhưng không có x-csrf-token: 403', `${response.status} ${(await response.text()).slice(0, 80)}`);
  const after = (await getLayout(qtbh, scratch.id)).data;
  check(tc, after.updatedAt === before.updatedAt, 'Bố cục không đổi', `${before.updatedAt} -> ${after.updatedAt}`);
});

await group('TC-P3PERM-05', async () => {
  const tc = 'TC-P3PERM-05';
  const r = await nv1.call('GET', quoteUrl(Q['Q-OUT'].id), { expect: ACCEPT });
  check(tc, r.status === 404, `NV1 mở Q-OUT (${Q['Q-OUT'].code}, của NV3) bằng id: 404 như không có`, errorText(r));
  const owner = await nv3.call('GET', quoteUrl(Q['Q-OUT'].id), { expect: ACCEPT });
  check(tc, owner.status === 200, 'NV3 (chủ) vẫn đọc được Q-OUT', String(owner.status));
});

let otherAdmin = null;
let otherTemplateId = null;
await group('TC-P3PERM-06', async () => {
  const tc = 'TC-P3PERM-06';
  const other = buildConfig(values['other-tenant']);
  try {
    otherAdmin = await Session.login(other.platformApi, { email: `qtv@${other.emailDomain}`, password: config.password, portal: 'tenant' });
  } catch (error) {
    blocked(tc, `không đăng nhập được qtv@${other.emailDomain}: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`);
    return;
  }
  const before = (await getLayout(qtbh, T['M-A4'].id)).data;
  const read = await getLayout(otherAdmin, T['M-A4'].id);
  check(tc, read.status === 404, `QTV ${values['other-tenant']} đọc bố cục mẫu của ${values.tenant} bằng id: 404`, errorText(read));
  const write = await putLayout(otherAdmin, T['M-A4'].id, { layout: defaultQuoteLayout() });
  check(tc, write.status === 404, `QTV ${values['other-tenant']} lưu bố cục mẫu của ${values.tenant}: 404`, errorText(write));
  const after = (await getLayout(qtbh, T['M-A4'].id)).data;
  check(tc, after.updatedAt === before.updatedAt, `Bố cục của ${values.tenant} không đổi`, `${before.updatedAt} -> ${after.updatedAt}`);
  otherTemplateId = (await otherAdmin.get(`${crm}/v1/quote-templates?includeInactive=true`))[0]?.id ?? null;
});

await group('TC-P3PERM-08', async () => {
  const tc = 'TC-P3PERM-08';
  const cost = await trySave(page([lineTable('lines', [col('materialName', 70), col('estCost', 30)])]));
  expectCode(tc, 'Lưu bố cục có cột estCost (giá vốn): 400 LAYOUT_TABLE_INVALID', cost, 400, 'LAYOUT_TABLE_INVALID');
  const variable = await trySave(page([text('t', 'Giá vốn {{totals.cost}}')]));
  expectCode(tc, 'Lưu bố cục có biến {{totals.cost}}: 400 LAYOUT_VARIABLE_UNKNOWN', variable, 400, 'LAYOUT_VARIABLE_UNKNOWN');
  const profit = await trySave(page([text('t', 'Lợi nhuận {{totals.profit}}')]));
  expectCode(tc, 'Lưu bố cục có biến {{totals.profit}}: 400 LAYOUT_VARIABLE_UNKNOWN', profit, 400, 'LAYOUT_VARIABLE_UNKNOWN');
  console.log('  ghi chú: phần "người không có crm.quote.cost.read xem trước, xuất Word" kiểm ở e2e-phase3-browser.mjs.');
});

// ===================================================================================================================
// Kiểm hợp lệ (TC-TL-04 đến TC-TL-12, TC-TL-26) trên mẫu thử
// ===================================================================================================================
await group('TC-TL-04', async () => {
  const tc = 'TC-TL-04';
  const before = (await getLayout(qtbh, scratch.id)).data;
  const v2 = await trySave(page([spacer('s')], { version: 2 }));
  check(tc, v2.status === 400 && v2.data?.code === 'LAYOUT_VERSION_UNSUPPORTED' && VIETNAMESE.test(v2.data?.message ?? ''), 'version: 2: 400 LAYOUT_VERSION_UNSUPPORTED, câu tiếng Việt', errorText(v2));
  const noVersion = page([spacer('s')]);
  delete noVersion.version;
  const none = await trySave(noVersion);
  expectCode(tc, 'thiếu version: 400 LAYOUT_VERSION_UNSUPPORTED', none, 400, 'LAYOUT_VERSION_UNSUPPORTED');
  const after = (await getLayout(qtbh, scratch.id)).data;
  check(tc, after.updatedAt === before.updatedAt, 'DB không đổi', `${before.updatedAt} -> ${after.updatedAt}`);
});

await group('TC-TL-05', async () => {
  const tc = 'TC-TL-05';
  const blocks = (n) => Array.from({ length: n }, (_, i) => spacer(`s-${i + 1}`));
  expectCode(tc, '0 khối: 400 LAYOUT_EMPTY', await trySave(page([])), 400, 'LAYOUT_EMPTY');
  const one = await trySave(page(blocks(1)));
  check(tc, one.status === 200 && one.data?.layout?.blocks?.length === 1, '1 khối: lưu được', errorText(one));
  const hundred = await trySave(page(blocks(100)));
  check(tc, hundred.status === 200 && hundred.data?.layout?.blocks?.length === 100, '100 khối: lưu được', errorText(hundred));
  expectCode(tc, '101 khối: 400 LAYOUT_TOO_MANY_BLOCKS', await trySave(page(blocks(101))), 400, 'LAYOUT_TOO_MANY_BLOCKS');
});

await group('TC-TL-06', async () => {
  const tc = 'TC-TL-06';
  const limit = 1024 * 1024;
  const under = await trySave(sizedLayout(limit - 1000));
  check(tc, under.status === 200, `Bố cục ${limit - 1000} byte (dưới 1 MB): lưu được`, errorText(under));
  const exact = await trySave(sizedLayout(limit));
  check(tc, exact.status === 200, `Bố cục đúng ${limit} byte: lưu được`, errorText(exact));
  const over = await trySave(sizedLayout(limit + 1));
  check(tc, over.status === 400 && over.data?.code === 'LAYOUT_TOO_LARGE' && VIETNAMESE.test(over.data?.message ?? ''), `Bố cục ${limit + 1} byte: 400 LAYOUT_TOO_LARGE (không phải 413)`, errorText(over));
  // Thân trên 2 MB: crm-api trả 413 JSON tiếng Việt, cùng mã (D3-14).
  const huge = await qtbh.call('PUT', layoutUrl(scratch.id), { body: { layout: page([text('t', 'x'.repeat(3 * 1024 * 1024))]) }, expect: ACCEPT });
  check(tc, huge.status === 413 && huge.data?.code === 'LAYOUT_TOO_LARGE', 'Thân 3 MB gọi thẳng crm-api: 413 LAYOUT_TOO_LARGE (JSON)', errorText(huge));
});

await group('TC-TL-07', async () => {
  const tc = 'TC-TL-07';
  const ok = async (label, src) => {
    const r = await trySave(page([image('img', src)]));
    check(tc, r.status === 200, label, errorText(r));
  };
  const bad = async (label, src) => {
    const r = await trySave(page([spacer('s'), image('img', src)]));
    check(tc, r.status === 400 && r.data?.code === 'LAYOUT_IMAGE_INVALID' && /khối 2/i.test(r.data?.message ?? ''), `${label}: 400 LAYOUT_IMAGE_INVALID nêu khối 2`, errorText(r));
  };
  await ok('PNG 299 KB: lưu được', fakePng(299 * 1024));
  await bad('PNG 301 KB', fakePng(301 * 1024));
  await ok('JPEG hợp lệ: lưu được', fakeJpeg(20 * 1024));
  await bad('data:image/svg+xml', `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`);
  await bad('data:image/gif', `data:image/gif;base64,${Buffer.from('GIF89a').toString('base64')}`);
  await bad('https://…/logo.png', 'https://example.com/logo.png');
  await bad('javascript:', 'javascript:alert(1)');
  await bad('base64 hỏng', 'data:image/png;base64,@@@@!!!!');
  await bad('khai image/png nhưng là file text', `data:image/png;base64,${Buffer.from('day la file text, khong phai anh').toString('base64')}`);
  await bad('chuỗi rỗng', '');
});

await group('TC-TL-08', async () => {
  const tc = 'TC-TL-08';
  const at = await trySave(page([text('t', 'a'.repeat(4000))]));
  check(tc, at.status === 200, 'Đoạn chữ 4.000 ký tự: lưu được', errorText(at));
  expectCode(tc, 'Đoạn chữ 4.001 ký tự: 400 LAYOUT_TEXT_TOO_LONG', await trySave(page([text('t', 'a'.repeat(4001))])), 400, 'LAYOUT_TEXT_TOO_LONG');
  const grid = (label) => page([{ id: 'g', type: 'fieldGrid', columns: 1, labelWidthPct: 30, items: [{ label, value: 'x' }] }]);
  const label200 = await trySave(grid('n'.repeat(200)));
  check(tc, label200.status === 200, 'Nhãn 200 ký tự: lưu được', errorText(label200));
  expectCode(tc, 'Nhãn 201 ký tự: 400 LAYOUT_TEXT_TOO_LONG', await trySave(grid('n'.repeat(201))), 400, 'LAYOUT_TEXT_TOO_LONG');
  // 4.000 ký tự "ệ" dạng tổ hợp (NFD, 2 code point mỗi ký tự): đếm sau NFC nên vẫn lưu được.
  const nfd = await trySave(page([text('t', 'ệ'.normalize('NFD').repeat(4000))]));
  check(tc, nfd.status === 200, '4.000 ký tự tiếng Việt tổ hợp (NFD): lưu được (đếm sau NFC)', errorText(nfd));
});

await group('TC-TL-09', async () => {
  const tc = 'TC-TL-09';
  const cases = [
    ["paper: 'A5'", page([spacer('s')], { paper: 'A5' }), 'paper'],
    ["orientation: 'up'", page([spacer('s')], { orientation: 'up' }), 'orientation'],
    ['fontSizePt: 8', page([spacer('s')], { fontSizePt: 8 }), 'fontSizePt'],
    ['fontSizePt: 17', page([spacer('s')], { fontSizePt: 17 }), 'fontSizePt'],
    ['marginsMm.top: 4', page([spacer('s')], { marginsMm: { top: 4, right: 15, bottom: 15, left: 15 } }), 'marginsMm.top'],
    ['marginsMm.top: 41', page([spacer('s')], { marginsMm: { top: 41, right: 15, bottom: 15, left: 15 } }), 'marginsMm.top'],
    ['heightMm: -1', page([spacer('s'), spacer('t'), spacer('u'), { id: 'v', type: 'spacer', heightMm: -1 }]), 'blocks[3].heightMm'],
    ["align: 'justify'", page([{ ...text('t', 'x'), align: 'justify' }]), 'blocks[0].align'],
    ['số dạng chuỗi "12"', page([spacer('s')], { fontSizePt: '12' }), 'fontSizePt'],
    ['null ở trường bắt buộc', page([spacer('s')], { paper: null }), 'paper'],
  ];
  for (const [label, layout, path] of cases) {
    const r = await trySave(layout);
    const paths = (r.data?.errors ?? []).map((error) => error.path);
    check(tc, r.status === 400 && r.data?.code === 'LAYOUT_INVALID' && paths.includes(path), `${label}: 400 LAYOUT_INVALID, path ${path}`, `${errorText(r)} paths=${paths.join(',')}`);
  }
});

await group('TC-TL-10', async () => {
  const tc = 'TC-TL-10';
  expectCode(tc, 'Hai khối cùng id: 400 LAYOUT_DUPLICATE_ID', await trySave(page([spacer('a'), spacer('a')])), 400, 'LAYOUT_DUPLICATE_ID');
  for (const id of ['co cach', 'ChuHoa', '']) {
    expectCode(tc, `id "${id}": 400 LAYOUT_INVALID`, await trySave(page([spacer(id)])), 400, 'LAYOUT_INVALID');
  }
});

await group('TC-TL-11', async () => {
  const tc = 'TC-TL-11';
  for (const total of [98, 99, 100, 101, 102]) {
    const r = await trySave(page([lineTable('lines', [col('index', 10), col('materialName', total - 30), col('lineTotal', 20)])]));
    const valid = total >= 99 && total <= 101;
    check(tc, valid ? r.status === 200 : r.status === 400 && r.data?.code === 'LAYOUT_TABLE_INVALID', `Tổng độ rộng ${total}: ${valid ? 'lưu được' : '400 LAYOUT_TABLE_INVALID'}`, errorText(r));
  }
  expectCode(tc, 'Không có cột hiện: 400 LAYOUT_TABLE_INVALID', await trySave(page([lineTable('lines', [col('index', 100, false)])])), 400, 'LAYOUT_TABLE_INVALID');
  expectCode(tc, 'Cột key lạ estCost: 400 LAYOUT_TABLE_INVALID', await trySave(page([lineTable('lines', [col('index', 50), col('estCost', 50)])])), 400, 'LAYOUT_TABLE_INVALID');
  expectCode(tc, 'Hai cột cùng key: 400 LAYOUT_TABLE_INVALID', await trySave(page([lineTable('lines', [col('index', 50), col('index', 50)])])), 400, 'LAYOUT_TABLE_INVALID');
});

await group('TC-TL-12', async () => {
  const tc = 'TC-TL-12';
  for (const variable of ['customer.secret', 'custom.abc', 'totals.cost']) {
    expectCode(tc, `{{${variable}}}: 400 LAYOUT_VARIABLE_UNKNOWN`, await trySave(page([text('t', `x {{${variable}}}`)])), 400, 'LAYOUT_VARIABLE_UNKNOWN');
  }
  const cfOff = fx.fields['CF-OFF'];
  const custom = await trySave(page([text('t', `{{custom.${cfOff.id}}} {{custom.00000000-0000-4000-8000-000000000000}}`)]));
  check(tc, custom.status === 200, '{{custom.<uuid>}} của trường đã tắt và trường không còn: lưu được', errorText(custom));
  const strange = await trySave(page([{ ...text('t', 'x'), onclick: 'alert(1)', html: '<b>x</b>' }], { script: 'x' }));
  const back = (await getLayout(qtbh, scratch.id)).data?.layout;
  const raw = JSON.stringify(back ?? {});
  check(tc, strange.status === 200 && !/onclick|"html"|"script"/.test(raw), 'Trường lạ onclick, html bị bỏ khi lưu, đọc lại không còn', `${strange.status} ${raw.slice(0, 80)}`);
});

await group('TC-TL-26', async () => {
  const tc = 'TC-TL-26';
  for (const width of [-1, 101]) {
    const r = await trySave(page([lineTable('lines', [col('index', width), col('materialName', 100 - width)])]));
    check(tc, r.status === 400 && r.data?.code === 'LAYOUT_INVALID' && (r.data?.errors ?? []).some((e) => /widthPct/.test(e.path)), `widthPct ${width}: 400 LAYOUT_INVALID có path`, errorText(r));
  }
  const header = (logo) => page([{ id: 'c', type: 'companyHeader', name: 'X', lines: [], logo, logoPosition: 'left', align: 'left' }]);
  expectCode(tc, "companyHeader.logo = '': 400 LAYOUT_IMAGE_INVALID", await trySave(header('')), 400, 'LAYOUT_IMAGE_INVALID');
  const nullLogo = await trySave(header(null));
  check(tc, nullLogo.status === 200, 'logo: null hợp lệ', errorText(nullLogo));
  const totals = page([{ id: 't', type: 'totals', align: 'right', showAmountInWords: false, rows: [{ key: 'vat', label: 'a', visible: true }, { key: 'vat', label: 'b', visible: true }] }]);
  expectCode(tc, 'totals có hai dòng cùng key: 400 LAYOUT_INVALID', await trySave(totals), 400, 'LAYOUT_INVALID');
  const id40 = await trySave(page([spacer('a'.repeat(40))]));
  check(tc, id40.status === 200, 'id khối 40 ký tự: hợp lệ', errorText(id40));
  expectCode(tc, 'id khối 41 ký tự: 400 LAYOUT_INVALID', await trySave(page([spacer('a'.repeat(41))])), 400, 'LAYOUT_INVALID');
});

// ===================================================================================================================
// Đọc, lưu, xoá, xung đột (TC-TL-13 đến TC-TL-19)
// ===================================================================================================================
await group('TC-TL-13', async () => {
  const tc = 'TC-TL-13';
  const a4 = await getLayout(nv1, T['M-A4'].id);
  check(tc, a4.status === 200 && !!a4.data?.layout && !!a4.data?.updatedAt && !!a4.data?.updatedBy, 'NV1 đọc M-A4: có bố cục, updatedAt, updatedBy', `${a4.status} ${a4.data?.updatedAt}`);
  const none = await getLayout(nv1, T['M-NONE'].id);
  check(tc, none.status === 200 && none.data?.layout === null, 'NV1 đọc M-NONE: layout null', `${none.status} ${JSON.stringify(none.data).slice(0, 80)}`);
  for (const [label, id] of [['id không phải uuid', 'abc'], ['uuid không tồn tại', '00000000-0000-4000-8000-000000000000']]) {
    const r = await getLayout(nv1, id);
    check(tc, r.status === 404 && r.data?.message === 'Không tìm thấy mẫu báo giá.', `${label}: 404 "Không tìm thấy mẫu báo giá."`, errorText(r));
  }
  if (otherTemplateId) {
    const r = await getLayout(nv1, otherTemplateId);
    check(tc, r.status === 404 && r.data?.message === 'Không tìm thấy mẫu báo giá.', `id mẫu của tenant ${values['other-tenant']}: 404`, errorText(r));
  } else blocked(tc, `không có id mẫu của tenant ${values['other-tenant']} (xem TC-P3PERM-06)`);
});

let savedOnScratch = null;
await group('TC-TL-14', async () => {
  const tc = 'TC-TL-14';
  const layout = { ...defaultQuoteLayout(), extraField: 'bỏ' };
  const r = await putLayout(qtbh, scratch.id, { layout });
  const normalized = validateQuoteLayout(layout);
  check(tc, r.status === 200 && normalized.ok && same(r.data.layout, normalized.layout), 'PUT bố cục hợp lệ: trả bố cục đã chuẩn hoá', errorText(r));
  const read = (await getLayout(qtbh, scratch.id)).data;
  check(tc, same(read.layout, r.data.layout) && read.updatedAt === r.data.updatedAt && read.updatedBy === qtbhId, 'GET lại: đúng bố cục, updatedAt, updatedBy = QTBH', `${read.updatedBy} / ${qtbhId}`);
  const listed = (await qtbh.get(`${crm}/v1/quote-templates?includeInactive=true`)).find((t) => t.id === scratch.id);
  check(tc, listed?.hasLayout === true, 'Danh sách mẫu: hasLayout = true', String(listed?.hasLayout));
  savedOnScratch = read;
});

await group('TC-TL-15', async () => {
  const tc = 'TC-TL-15';
  const before = savedOnScratch ?? (await getLayout(qtbh, scratch.id)).data;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const r = await putLayout(qtbh, scratch.id, { layout: null, expectedUpdatedAt: before.updatedAt });
  check(tc, r.status === 200 && r.data?.layout === null, 'PUT { layout: null }: layout rỗng', errorText(r));
  check(tc, !!r.data?.updatedAt && Date.parse(r.data.updatedAt) > Date.parse(before.updatedAt ?? 0) && r.data?.updatedBy === qtbhId, 'updatedAt, updatedBy vẫn cập nhật khi xoá (D3-14)', `${before.updatedAt} -> ${r.data?.updatedAt}`);
  const listed = (await qtbh.get(`${crm}/v1/quote-templates?includeInactive=true`)).find((t) => t.id === scratch.id);
  check(tc, listed?.hasLayout === false, 'Danh sách mẫu: hasLayout = false', String(listed?.hasLayout));
  console.log('  ghi chú: phần "báo giá nháp xem trước bằng bố cục mặc định, báo giá đã gửi dùng bản chụp" kiểm ở e2e-phase3-browser.mjs.');
});

await group('TC-TL-16', async () => {
  const tc = 'TC-TL-16';
  await putLayout(qtbh, scratch.id, { layout: page([text('t', 'ban dau')]) });
  const readQtv = (await getLayout(qtv, scratch.id)).data;
  const readQtbh = (await getLayout(qtbh, scratch.id)).data;
  const first = await putLayout(qtv, scratch.id, { layout: page([text('t', 'ban cua QTV')]), expectedUpdatedAt: readQtv.updatedAt });
  check(tc, first.status === 200, 'QTV lưu với expectedUpdatedAt đã đọc: 200', errorText(first));
  const second = await putLayout(qtbh, scratch.id, { layout: page([text('t', 'ban cua QTBH')]), expectedUpdatedAt: readQtbh.updatedAt });
  check(tc, second.status === 409 && second.data?.code === 'LAYOUT_CONFLICT' && /người khác sửa/.test(second.data?.message ?? ''), 'QTBH lưu với giá trị cũ: 409 LAYOUT_CONFLICT "Mẫu vừa được người khác sửa…"', errorText(second));
  const kept = (await getLayout(qtbh, scratch.id)).data;
  check(tc, kept.layout?.blocks?.[0]?.runs?.[0]?.text === 'ban cua QTV', 'DB giữ bản của QTV', kept.layout?.blocks?.[0]?.runs?.[0]?.text);
  const blind = await putLayout(qtbh, scratch.id, { layout: page([text('t', 'ghi de')]) });
  check(tc, blind.status === 200, 'Không gửi expectedUpdatedAt: ghi đè (200)', errorText(blind));
  const again = await putLayout(qtbh, scratch.id, { layout: page([text('t', 'ghi de 2')]) });
  check(tc, again.status === 200 && again.data.updatedAt !== blind.data.updatedAt, 'Hai lần lưu liền nhau có updatedAt khác nhau', `${blind.data?.updatedAt} / ${again.data?.updatedAt}`);
  const invalidStamp = await putLayout(qtbh, scratch.id, { layout: page([text('t', 'x')]), expectedUpdatedAt: 'hôm qua' });
  check(tc, invalidStamp.status === 400, 'expectedUpdatedAt sai dạng: 400', errorText(invalidStamp));
});

await group('TC-TL-17', async () => {
  blocked('TC-TL-17', 'audit_log không có API đọc; đã đạt ở integration (crm-quote-form.integration.spec), script API không đọc thẳng DB');
});

await group('TC-TL-18', async () => {
  const tc = 'TC-TL-18';
  const off = T['M-OFF'];
  check(tc, off.active === false, `M-OFF "${off.name}" đang tắt`, String(off.active));
  const read = await getLayout(qtbh, off.id);
  check(tc, read.status === 200 && titleOf(read.data?.layout) === M_OFF_TITLE, 'QTBH đọc bố cục M-OFF', errorText(read));
  const write = await putLayout(qtbh, off.id, { layout: read.data.layout, expectedUpdatedAt: read.data.updatedAt });
  check(tc, write.status === 200, 'QTBH sửa (lưu lại) bố cục M-OFF', errorText(write));
  const active = await nv1.get(`${crm}/v1/quote-templates`);
  check(tc, !active.some((t) => t.id === off.id), 'Danh sách mẫu của NV1 (ô "Mẫu báo giá") không có M-OFF', active.map((t) => t.name).join(' | ').slice(0, 160));
  const used = await nv1.get(quoteUrl(fx.quotes['Q-OFFUSE'].id));
  const nvRead = await getLayout(nv1, off.id);
  check(tc, used.version.form.templateId === off.id && nvRead.status === 200 && titleOf(nvRead.data?.layout) === M_OFF_TITLE, 'Báo giá cũ Q-OFFUSE vẫn gắn M-OFF và NV1 đọc được bố cục M-OFF để xem trước', `${used.code} ${nvRead.status}`);
});

await group('TC-TL-19', async () => {
  const tc = 'TC-TL-19';
  if (!values.gateway) {
    blocked(tc, 'cần nginx thật (--gateway=<url>); gateway dev tools/dev-gateway.mjs không giới hạn thân request');
    return;
  }
  const base = values.gateway.replace(/\/$/, '');
  const url = `${base}/api/crm/v1/quote-templates/${scratch.id}/layout`;
  const put = async (body) => {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json', cookie: qtbh.cookieHeader(), 'x-csrf-token': qtbh.cookies.get('ep_csrf') ?? '' },
      body,
    });
    const textBody = await response.text();
    return { status: response.status, type: response.headers.get('content-type') ?? '', text: textBody };
  };
  const oneMb = JSON.stringify({ layout: sizedLayout(1024 * 1024 - 2000) });
  const r1 = await put(oneMb);
  check(tc, r1.status === 200, `PUT bố cục ~1 MB (thân ${oneMb.length} byte) qua ${base}: lưu được`, `${r1.status} ${r1.type} ${r1.text.slice(0, 80).replace(/\s+/g, ' ')}`);
  const threeMb = JSON.stringify({ layout: page([text('t', 'x'.repeat(3 * 1024 * 1024))]) });
  const r3 = await put(threeMb);
  let code = '';
  try {
    code = JSON.parse(r3.text).code ?? '';
  } catch {
    code = '(không phải JSON)';
  }
  check(tc, r3.status === 413 && code === 'LAYOUT_TOO_LARGE', 'PUT 3 MB qua gateway: 413 JSON LAYOUT_TOO_LARGE câu tiếng Việt', `${r3.status} ${r3.type} ${code}`);
});

// ===================================================================================================================
// Bản chụp khi gửi (TC-TL-20 đến TC-TL-25)
// ===================================================================================================================
const a4Original = (await getLayout(qtbh, T['M-A4'].id)).data;
let sentA = null;
await group('TC-TL-20', async () => {
  const tc = 'TC-TL-20';
  const created = await newQuote('TL-20 gửi có bản chụp', T['M-A4'].id, THREE());
  check(tc, created.version.layoutSnapshot === null, 'Báo giá Nháp: layoutSnapshot rỗng', String(created.version.layoutSnapshot));
  sentA = await sendQuote(config, sessions, created.id);
  const current = (await getLayout(qtbh, T['M-A4'].id)).data;
  check(tc, same(sentA.version.layoutSnapshot, current.layout), `Gửi khách ${sentA.code}: version.layoutSnapshot bằng bố cục M-A4 lúc gửi`, `${sentA.version.status}`);
  check(tc, !!sentA.version.sentAt, 'sentAt có giá trị', String(sentA.version.sentAt));
  const seeded = await nv1.get(quoteUrl(Q['Q-SENT'].id));
  check(tc, seeded.version.status !== 'DRAFT' && !!seeded.version.layoutSnapshot, `Q-SENT (${seeded.code}) của seed có bản chụp`, seeded.version.status);
});

await group('TC-TL-21', async () => {
  const tc = 'TC-TL-21';
  const created = await newQuote('TL-21 mẫu chưa có bố cục', T['M-NONE'].id, THREE());
  const sent = await sendQuote(config, sessions, created.id);
  check(tc, sent.version.status === 'SENT' && sent.version.layoutSnapshot === null, `Gửi báo giá dùng M-NONE (${sent.code}): thành công, layoutSnapshot = null`, `${sent.version.status} ${String(sent.version.layoutSnapshot)}`);
  const old = await nv1.get(quoteUrl(Q['Q-OLD'].id));
  check(tc, !!old.version.sentAt && old.version.layoutSnapshot === null, `Q-OLD (${old.code}) gửi trước khi mẫu có bố cục: không có bản chụp`, old.version.status);
});

const EDITED_TITLE = 'BÁO GIÁ THIẾT BỊ (ĐÃ SỬA E2E)';
let a4Edited = false;
await group('TC-TL-22', async () => {
  const tc = 'TC-TL-22';
  if (!sentA) throw new Error('TC-TL-20 chưa tạo được báo giá đã gửi.');
  const edited = { ...a4Original.layout, blocks: a4Original.layout.blocks.map((block) => (block.type === 'title' ? { ...block, text: EDITED_TITLE } : block)) };
  const saved = await putLayout(qtbh, T['M-A4'].id, { layout: edited, expectedUpdatedAt: a4Original.updatedAt });
  a4Edited = saved.status === 200;
  check(tc, a4Edited, 'QTBH đổi tiêu đề bố cục M-A4', errorText(saved));
  const reopened = await nv1.get(quoteUrl(sentA.id));
  check(tc, titleOf(reopened.version.layoutSnapshot) === titleOf(a4Original.layout), `Báo giá đã gửi ${reopened.code} vẫn giữ tiêu đề cũ (bản chụp)`, titleOf(reopened.version.layoutSnapshot));
  const seeded = await nv1.get(quoteUrl(Q['Q-SENT'].id));
  check(tc, titleOf(seeded.version.layoutSnapshot) !== EDITED_TITLE, `Q-SENT ${seeded.code} không đổi theo mẫu`, titleOf(seeded.version.layoutSnapshot));
  const draft = await nv1.get(quoteUrl(Q['Q-DRAFT'].id));
  const current = (await getLayout(nv1, T['M-A4'].id)).data;
  check(tc, draft.version.layoutSnapshot === null && titleOf(current.layout) === EDITED_TITLE, `Q-DRAFT ${draft.code} không có bản chụp, bố cục hiện tại của mẫu có tiêu đề mới`, titleOf(current.layout));
});

await group('TC-TL-23', async () => {
  const tc = 'TC-TL-23';
  if (!sentA) throw new Error('TC-TL-20 chưa tạo được báo giá đã gửi.');
  let quote = await nv1.get(quoteUrl(sentA.id));
  const v1Snapshot = quote.version.layoutSnapshot;
  quote = await nv1.post(`${quoteUrl(sentA.id)}/versions/${quote.version.versionNo}/revise`, { revision: quote.version.revision });
  check(tc, quote.version.versionNo === 2 && quote.version.status === 'DRAFT' && quote.version.layoutSnapshot === null, 'Sửa báo giá đã gửi tạo phiên bản 2 Nháp, layoutSnapshot = null', `v${quote.version.versionNo} ${quote.version.status}`);
  quote = await sendQuote(config, sessions, sentA.id);
  check(tc, quote.version.versionNo === 2 && titleOf(quote.version.layoutSnapshot) === (a4Edited ? EDITED_TITLE : titleOf(a4Original.layout)), 'Gửi phiên bản 2: có bản chụp mới (bố cục hiện tại của mẫu)', titleOf(quote.version.layoutSnapshot));
  const v1 = await nv1.get(`${quoteUrl(sentA.id)}?version=1`);
  check(tc, v1.version.versionNo === 1 && same(v1.version.layoutSnapshot, v1Snapshot), `Phiên bản 1 (${v1.version.status}) giữ bản chụp cũ`, titleOf(v1.version.layoutSnapshot));
  check('TC-TL-25', v1.version.status === 'SUPERSEDED' && same(v1.version.layoutSnapshot, v1Snapshot), 'SUPERSEDED: bản chụp không đổi', v1.version.status);
});

await group('TC-TL-25', async () => {
  const tc = 'TC-TL-25';
  if (!sentA) throw new Error('TC-TL-20 chưa tạo được báo giá đã gửi.');
  let quote = await nv1.get(quoteUrl(sentA.id));
  const before = quote.version.layoutSnapshot;
  // Mẫu đã sửa (TC-TL-22) trước khi chấp nhận: bản chụp không theo mẫu.
  quote = await nv1.post(`${quoteUrl(sentA.id)}/versions/${quote.version.versionNo}/accept`, { revision: quote.version.revision });
  check(tc, quote.version.status === 'ACCEPTED' && same(quote.version.layoutSnapshot, before), 'Sửa mẫu rồi khách chấp nhận (ACCEPTED): bản chụp không đổi', quote.version.status);
  const other = await sendQuote(config, sessions, (await newQuote('TL-25 khách từ chối', T['M-A4'].id, THREE())).id);
  const declined = await nv1.post(`${quoteUrl(other.id)}/versions/${other.version.versionNo}/decline`, { revision: other.version.revision, reason: 'QA-P3: khách từ chối' });
  check(tc, declined.version.status === 'DECLINED' && same(declined.version.layoutSnapshot, other.version.layoutSnapshot) && !!declined.version.layoutSnapshot, 'Khách từ chối (DECLINED): bản chụp không đổi', declined.version.status);
  console.log('  ghi chú: EXPIRED do việc nền chuyển theo ngày hiệu lực, không gọi được qua API; đã đạt ở integration.');
});

// Trả bố cục M-A4 về như trước khi chạy.
if (a4Edited) {
  const current = (await getLayout(qtbh, T['M-A4'].id)).data;
  const restored = await putLayout(qtbh, T['M-A4'].id, { layout: a4Original.layout, expectedUpdatedAt: current.updatedAt });
  console.log(`  ${restored.status === 200 ? 'đã' : 'KHÔNG'} trả bố cục M-A4 về như cũ (${restored.status})`);
}

// ===================================================================================================================
// Chèn dòng (TC-QW-14, TC-QW-15)
// ===================================================================================================================
const batchUrl = (quote) => `${quoteUrl(quote.id)}/versions/${quote.version.versionNo}/lines/batch`;
const lineCodes = (quote) => quote.version.lines.map((line) => `${line.lineNo}:${line.materialCode}`).join(' ');
const continuous = (quote) => quote.version.lines.every((line, index) => line.lineNo === index + 1);

await group('TC-QW-14', async () => {
  const tc = 'TC-QW-14';
  const quote = await newQuote('QW-14 chèn dòng', T['M-A4'].id, THREE());
  const oldIds = quote.version.lines.map((line) => line.id);
  const after = await nv1.post(batchUrl(quote), {
    revision: quote.version.revision,
    beforeLineNo: 2,
    lines: [
      { materialId: mat('QA-KHO-PM'), quantity: 1 },
      { materialId: mat('QA-KHO-LAP'), quantity: 1 },
    ],
  });
  const codes = after.version.lines.map((line) => line.materialCode);
  check(tc, same(codes, ['QA-KHO-CAP', 'QA-KHO-PM', 'QA-KHO-LAP', 'QA-KHO-MUC', 'QA-KHO-BT']), 'Chèn 2 mặt hàng trước dòng 2: dòng mới ở vị trí 2, 3; dòng cũ 2, 3 thành 4, 5', lineCodes(after));
  check(tc, continuous(after), 'Số thứ tự liên tục 1-5', lineCodes(after));
  const keptIds = [after.version.lines[0].id, after.version.lines[3].id, after.version.lines[4].id];
  check(tc, same(keptIds, oldIds), 'Dòng cũ giữ id (D3-12)', '');
});

await group('TC-QW-15', async () => {
  const tc = 'TC-QW-15';
  let quote = await newQuote('QW-15 chèn biên', T['M-A4'].id, THREE());
  quote = await nv1.post(batchUrl(quote), { revision: quote.version.revision, beforeLineNo: 1, lines: [{ materialId: mat('QA-KHO-PM'), quantity: 1 }] });
  check(tc, quote.version.lines[0].materialCode === 'QA-KHO-PM' && quote.version.lines[0].lineNo === 1 && continuous(quote), 'Chèn trước dòng 1: dòng mới thành dòng 1', lineCodes(quote));
  for (const position of [99, 0]) {
    const r = await nv1.call('POST', batchUrl(quote), { body: { revision: quote.version.revision, beforeLineNo: position, lines: [{ materialId: mat('QA-KHO-PM'), quantity: 1 }] }, expect: ACCEPT });
    expectCode(tc, `beforeLineNo = ${position}: 400 LINE_POSITION_INVALID`, r, 400, 'LINE_POSITION_INVALID');
  }
  const body = (code) => ({ revision: quote.version.revision, beforeLineNo: 2, lines: [{ materialId: mat(code), quantity: 1 }] });
  const both = await Promise.all([
    nv1.call('POST', batchUrl(quote), { body: body('QA-KHO-LAP'), expect: ACCEPT }),
    nv1.call('POST', batchUrl(quote), { body: body('QA-KHO-MUC'), expect: ACCEPT }),
  ]);
  const statuses = both.map((r) => r.status).sort();
  const loser = both.find((r) => r.status === 409);
  check(tc, same(statuses, [201, 409]) && loser?.data?.code === 'STALE_VERSION', 'Hai người cùng chèn với cùng revision: một 201 (POST tạo dòng), người sau 409 STALE_VERSION', both.map(errorText).join(' | '));
  const final = await nv1.get(quoteUrl(quote.id));
  const numbers = final.version.lines.map((line) => line.lineNo);
  check(tc, new Set(numbers).size === numbers.length && continuous(final) && final.version.lines.length === 5, 'Không có line_no trùng, số liên tục', lineCodes(final));
});

// ===================================================================================================================
// Tổng kết
// ===================================================================================================================
console.log('\nKết quả theo TC:');
let failed = 0;
let passed = 0;
let blockedCount = 0;
for (const [tc, entry] of [...tcs].sort(([a], [b]) => a.localeCompare(b))) {
  const status = entry.fail ? 'LỖI' : entry.blocked.length && !entry.pass ? 'BỊ CHẶN' : entry.blocked.length ? 'ĐẠT MỘT PHẦN' : 'ĐẠT';
  if (entry.fail) failed += 1;
  else if (status === 'ĐẠT') passed += 1;
  else blockedCount += 1;
  console.log(`  ${tc.padEnd(14)} ${status.padEnd(13)} ${entry.pass} đạt, ${entry.fail} lỗi${entry.blocked.length ? `; chặn: ${entry.blocked.join('; ')}` : ''}`);
}
console.log(`\nTổng: ${passed}/${tcs.size} TC đạt, ${failed} lỗi, ${blockedCount} bị chặn hoặc đạt một phần`);
process.exit(failed ? 1 : 0);
