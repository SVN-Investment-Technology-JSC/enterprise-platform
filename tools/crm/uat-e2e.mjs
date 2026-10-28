#!/usr/bin/env node
// UAT tự động (docs/crm/TEST.md mục 3.9): TC-UAT-01 21 bước xuyên suốt từ lead tới bảo hành đổi serial, chạy qua API
// thật bằng đúng tài khoản ở từng bước, cộng kiểm tra nhanh theo vai trò TC-UAT-02 đến 09.
//
//   node tools/crm/uat-e2e.mjs --tenant=svn
//
// Chạy lại được: mỗi lượt dùng mã mới tiền tố QA-UAT-<thời điểm>, nhập 21 serial mới (QAU<thời điểm>-01..21) để
// không đụng serial seed (SN001..SN040, SN-DP01..05) mà test case khác cần. Biến môi trường như seed-svn.mjs
// (SVN_SEED_PASSWORD bắt buộc). Bước 3 (nhắc lịch) đọc bảng thông báo ở DB tenant local (chỉ đọc), vì API đọc
// thông báo ở realtime-api không chạy trong stack dev. Mã thoát 1 khi có bước LỖI.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildConfig, loadEnv } from './seed-svn/config.mjs';
import { addDays, allPages, createSessions, vnToday, waitFor } from './seed-svn/common.mjs';

const root = resolve(import.meta.dirname, '../..');
const EVENT_TIMEOUT_MS = Number(process.env.UAT_EVENT_TIMEOUT_MS ?? 60_000);
const WAREHOUSE = 'QA-KHO-HN';
const LAP = 'QA-KHO-LAP';
const BT = 'QA-KHO-BT';
const LAP_QTY = 20;

// ---------------------------------------------------------------------------
// Ghi kết quả
// ---------------------------------------------------------------------------

const results = [];
function record(step, account, check, status, details = '') {
  results.push({ step: String(step), account, check, status, details: String(details).replace(/\s+/g, ' ').slice(0, 220) });
  const mark = status === 'PASS' ? 'ĐẠT' : status === 'FAIL' ? 'LỖI' : status;
  console.log(`[${mark}] ${step} ${account}: ${check}${details ? ` | ${String(details).slice(0, 300)}` : ''}`);
}

class StepFailure extends Error {}

/** Khẳng định trong một bước: sai thì ghi LỖI và dừng bước (ném StepFailure). */
function makeExpect(step, account) {
  return (condition, check, details = '') => {
    if (condition) record(step, account, check, 'PASS', details);
    else {
      record(step, account, check, 'FAIL', details);
      throw new StepFailure(check);
    }
  };
}

const wait = (label, check) => waitFor(label, check, { timeoutMs: EVENT_TIMEOUT_MS, intervalMs: 1500 });
const near = (a, b, tolerance = 1) => Math.abs(Number(a) - Number(b)) <= tolerance;
const vnd = (value) => `${Math.round(Number(value)).toLocaleString('vi-VN')}`;

function printTable() {
  const head = ['Bước', 'Tài khoản', 'Kiểm tra', 'KQ', 'Chi tiết'];
  const rows = results.map((r) => [r.step, r.account, r.check, r.status, r.details]);
  const widths = head.map((h, i) => Math.min(Math.max(h.length, ...rows.map((r) => r[i].length)), i === 4 ? 90 : 70));
  const line = (cells) => cells.map((c, i) => c.slice(0, widths[i]).padEnd(widths[i])).join(' | ');
  console.log(`\n${line(head)}\n${widths.map((w) => '-'.repeat(w)).join('-|-')}`);
  for (const row of rows) console.log(line(row));
  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  console.log(`\nTổng: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

// ---------------------------------------------------------------------------
// DB (chỉ đọc, chỉ local) cho bước nhắc lịch
// ---------------------------------------------------------------------------

async function withTenantDb(tenant, fn) {
  const template = process.env.TENANT_DATABASE_URL_TEMPLATE;
  if (!template) throw new Error('Thiếu TENANT_DATABASE_URL_TEMPLATE.');
  const url = new URL(template.replace('{databaseName}', tenant.replace(/-/g, '_')));
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error(`Từ chối DB không phải local: ${url.hostname}`);
  const { Client } = createRequire(join(root, 'packages/adapters/database/package.json'))('pg');
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// TC-UAT-01
// ---------------------------------------------------------------------------

async function runE2E(config, sessions, ctx) {
  const crm = config.crmApi;
  const inv = config.inventoryApi;
  const as = (code) => sessions.as(code);
  const today = vnToday();
  const s = {}; // trạng thái giữa các bước

  const steps = [
    // Tiền điều kiện: hàng có serial mới cho lượt chạy này.
    [0, 'QTV', async (expect) => {
      const admin = await as('QTV');
      s.serials = Array.from({ length: LAP_QTY + 1 }, (_, i) => `QAU${ctx.stamp}-${String(i + 1).padStart(2, '0')}`);
      const doc = await admin.post(`${inv}/v1/stock-documents`, {
        docType: 'RECEIPT_PURCHASE',
        warehouseCode: WAREHOUSE,
        idempotencyKey: `qa-uat:${config.tenantSlug}:${ctx.stamp}:lap`,
        note: `${ctx.prefix}: nhập serial cho UAT`,
        lines: [{ materialCode: LAP, quantity: s.serials.length, unitCost: 15_000_000, serials: s.serials }],
      });
      const posted = doc.status === 'POSTED' ? doc : (await admin.post(`${inv}/v1/stock-documents/${doc.id}/post`)).document;
      expect(posted?.status === 'POSTED', `Nhập ${s.serials.length} serial ${LAP} mới vào ${WAREHOUSE}`, `${posted?.code} ${s.serials[0]}..${s.serials.at(-1)}`);
      const materials = await admin.get(`${crm}/v1/catalog/materials?q=QA-KHO`);
      s.lapId = materials.find((m) => m.code === LAP)?.id;
      s.btId = materials.find((m) => m.code === BT)?.id;
      expect(s.lapId && s.btId, 'Danh mục có QA-KHO-LAP và QA-KHO-BT');
      s.nv1 = await sessions.userId('NV1');
    }],

    [1, 'NV1', async (expect) => {
      const nv1 = await as('NV1');
      s.leadName = `Công ty QA-CRM Minh An ${ctx.prefix}`;
      s.lead = await nv1.post(`${crm}/v1/leads`, { name: s.leadName, source: 'Sự kiện', contactName: 'Anh Minh', phone: '0901234567' });
      expect(s.lead.ownerUserId === s.nv1, 'Lead có người phụ trách NV1', `${s.lead.name}, nguồn ${s.lead.source}`);
    }],

    [2, 'NV1', async (expect) => {
      const nv1 = await as('NV1');
      const result = await nv1.post(`${crm}/v1/leads/${s.lead.id}/convert`, { opportunityName: `${ctx.prefix} Cơ hội Minh An` });
      s.customerId = result.customerId;
      s.opportunityId = result.opportunityId;
      const customer = await nv1.get(`${crm}/v1/customers/${s.customerId}`);
      s.customer = customer;
      expect(!result.attachedToExistingCustomer && /^[A-Z0-9-]+$/.test(customer.code ?? ''), 'Khách mới có mã tự sinh', customer.code);
      const opp = await nv1.get(`${crm}/v1/opportunities/${s.opportunityId}`);
      expect(opp.stage === 'NEW', 'Cơ hội ở giai đoạn Mới', opp.stage);
      const admin = await as('QTV');
      const copy = await wait('Workspace nhận khách mới', async () =>
        (await admin.get(`${config.workspaceApi}/v1/customers`)).find((c) => c.crmCustomerId === s.customerId),
      ).catch(() => null);
      expect(copy, 'Khách xuất hiện ở Workspace (bản sao gắn crmCustomerId)', copy ? `${copy.code} ${copy.name}` : 'không thấy sau 60 giây');
    }],

    [3, 'NV1', async (expect) => {
      const nv1 = await as('NV1');
      const due = new Date(Date.now() + 24 * 3600_000).toISOString();
      const meeting = await nv1.post(`${crm}/v1/activities`, {
        type: 'MEETING', subject: `${ctx.prefix} Gặp khách Minh An`, customerId: s.customerId, opportunityId: s.opportunityId, dueAt: due,
      });
      expect(meeting.status === 'OPEN' && meeting.assigneeUserId === s.nv1, 'Hoạt động gặp mặt hạn ngày mai, giao NV1', meeting.dueAt);
      // Nhắc chỉ phát trước hạn theo cấu hình (mặc định 30 phút): thử bằng một hoạt động đến hạn sau 10 phút.
      const probe = await nv1.post(`${crm}/v1/activities`, {
        type: 'CALL', subject: `${ctx.prefix} Thử nhắc lịch`, customerId: s.customerId, dueAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      const found = await wait('notification-worker phát nhắc hoạt động', () =>
        withTenantDb(config.tenantSlug, async (db) => {
          const { rows } = await db.query(
            `SELECT title FROM notification_schema.notifications WHERE user_id = $1 AND source_id LIKE $2`,
            [s.nv1, `${probe.id}:due-soon:%`],
          );
          return rows[0] ?? null;
        }),
      ).catch(() => null);
      await nv1.patch(`${crm}/v1/activities/${probe.id}`, { version: probe.version, status: 'DONE', result: 'UAT: xong' }).catch(() => undefined);
      expect(found, 'NV1 nhận nhắc lịch trước hạn (hoạt động thử hạn +10 phút)', found ? found.title : 'không có thông báo sau 60 giây');
    }],

    [4, 'NV1', async (expect) => {
      const nv1 = await as('NV1');
      for (const stage of ['CONTACTED', 'DISCOVERY', 'QUOTING']) {
        await nv1.call('PATCH', `${crm}/v1/opportunities/${s.opportunityId}/stage`, { body: { stage } });
      }
      const page = await nv1.get(`${crm}/v1/quotes?opportunityId=${s.opportunityId}`);
      s.quoteId = page.items?.[0]?.id;
      expect(page.items?.length === 1 && page.items[0].status === 'DRAFT', 'Cơ hội sang Báo giá có đúng một nháp báo giá', page.items?.map((q) => `${q.code} ${q.status}`).join(', '));
    }],

    [5, 'NV1', async (expect) => {
      const nv1 = await as('NV1');
      let quote = await nv1.get(`${crm}/v1/quotes/${s.quoteId}`);
      const url = `${crm}/v1/quotes/${s.quoteId}/versions/1/lines`;
      quote = await nv1.post(url, { revision: quote.version.revision, materialId: s.lapId, quantity: LAP_QTY, overrideDiscountPercent: 12 });
      quote = await nv1.post(url, { revision: quote.version.revision, materialId: s.btId, quantity: 1, overrideDiscountPercent: 12 });
      s.quote = quote;
      const reasons = quote.approvalCheck ?? [];
      const text = reasons.map((r) => `${r.code}: ${r.message}`).join('; ');
      expect(quote.version.lines.length === 2, 'Báo giá 20 QA-KHO-LAP + 1 gói bảo trì', `tổng ${vnd(quote.version.totals.totalAmount)}, CK ${quote.version.totals.discountPercent}%`);
      expect(reasons.length > 0 && /5\s*%|hạn mức|ngưỡng/i.test(text), 'Báo giá cần duyệt, lý do vượt hạn mức 5%', text);
    }],

    [6, 'NV1', async (expect) => {
      const nv1 = await as('NV1');
      let quote = await nv1.post(`${crm}/v1/quotes/${s.quoteId}/versions/1/submit`, { revision: s.quote.version.revision });
      expect(quote.version.status === 'PENDING', 'Báo giá Chờ duyệt', quote.version.status);
      quote = await wait('Quy trình tạo phiên duyệt báo giá', async () => {
        const current = await nv1.get(`${crm}/v1/quotes/${s.quoteId}`);
        return current.procedure?.instanceId ? current : null;
      }).catch(() => quote);
      s.instanceId = quote.procedure?.instanceId;
      expect(s.instanceId, 'Phiên Quy trình được tạo', `${quote.procedure?.instanceCode ?? ''} ${quote.procedure?.status ?? 'không có phiên'} ${quote.procedure?.lastError ?? ''}`);
    }],

    [7, 'TN', async (expect) => {
      const tn = await as('TN');
      const instance = await wait('TN thấy được hành động duyệt', async () => {
        const current = await tn.get(`${config.procedureApi}/v1/instances/${s.instanceId}`);
        const actions = current?.authorization?.availableActions ?? current?.availableActions ?? [];
        return actions.includes('approve') || actions.includes('complete') ? current : null;
      }).catch((error) => {
        throw new StepFailure(`TN không có hành động duyệt trên phiên ${s.instanceId}: ${error.message}`);
      });
      const actions = instance?.authorization?.availableActions ?? instance?.availableActions ?? [];
      const action = actions.includes('approve') ? 'approve' : 'complete';
      await tn.post(`${config.procedureApi}/v1/instances/${s.instanceId}/actions`, {
        action, comment: 'UAT: đồng ý chiết khấu 12%', idempotencyKey: `${ctx.prefix}:quote-approve`,
      });
      const nv1 = await as('NV1');
      const quote = await wait('CRM nhận kết quả duyệt', async () => {
        const current = await nv1.get(`${crm}/v1/quotes/${s.quoteId}`);
        return current.version.status === 'APPROVED' ? current : null;
      }).catch(async () => nv1.get(`${crm}/v1/quotes/${s.quoteId}`));
      s.quote = quote;
      expect(quote.version.status === 'APPROVED', `TN ${action} trên Quy trình: báo giá Đã duyệt`, quote.version.status);
    }],

    [8, 'NV1', async (expect) => {
      const nv1 = await as('NV1');
      let quote = await nv1.post(`${crm}/v1/quotes/${s.quoteId}/versions/1/send`, { revision: s.quote.version.revision });
      quote = await nv1.post(`${crm}/v1/quotes/${s.quoteId}/versions/1/accept`, { revision: quote.version.revision });
      expect(quote.version.status === 'ACCEPTED', 'Gửi khách, Khách chấp nhận', quote.version.status);
      const conversion = await nv1.post(`${crm}/v1/quotes/${s.quoteId}/convert`);
      s.contractId = conversion.contractId;
      s.orderId = conversion.orderId;
      const contract = await nv1.get(`${crm}/v1/contracts/${s.contractId}`);
      const order = await nv1.get(`${crm}/v1/orders/${s.orderId}`);
      s.order = order;
      expect(contract.type === 'SALE' && contract.status === 'DRAFT', 'Hợp đồng mua bán nháp', `${contract.code} ${contract.type} ${contract.status}`);
      expect(order.status === 'DRAFT' && order.contractId === s.contractId, 'Đơn nháp gắn hợp đồng', `${order.code} ${order.status}, tổng ${vnd(order.totalAmount)}`);
    }],

    [9, 'QTBH', async (expect) => {
      const qtbh = await as('QTBH');
      const url = `${crm}/v1/contracts/${s.contractId}`;
      let contract = await qtbh.get(url);
      contract = await qtbh.put(`${url}/payment-terms`, {
        revision: contract.revision,
        terms: [
          { name: 'Đợt 1: 30% khi ký', percent: 30, condition: 'SIGN', dueDays: 0 },
          { name: 'Đợt 2: 70% khi giao đủ', percent: 70, condition: 'FULL_DELIVERY', dueDays: 0 },
        ],
      });
      expect(contract.paymentTerms.length === 2, 'Nhập 2 đợt thanh toán 30% và 70%', contract.paymentTerms.map((t) => `${t.name} ${vnd(t.amount)}`).join('; '));
      // Báo giá không có kho nên hợp đồng chuyển từ báo giá chưa có kho giữ hàng: QTBH chọn kho trước khi xác nhận.
      if (!contract.warehouseCode) contract = await qtbh.patch(url, { revision: contract.revision, warehouseCode: WAREHOUSE });
      contract = await qtbh.post(`${url}/confirm`, { revision: contract.revision });
      s.contract = contract;
      expect(contract.status === 'ACTIVE', 'Xác nhận hợp đồng: Hiệu lực', contract.status);
      const kt = await as('KT');
      const order = await kt.get(`${crm}/v1/orders/${s.orderId}`);
      const lapLine = order.lines.find((l) => l.materialCode === LAP);
      const held = contract.reservation?.status === 'HELD' || Number(lapLine?.reservedQuantity) === LAP_QTY;
      expect(held, `Kho giữ ${LAP_QTY} ${LAP}`, `giữ hàng ${contract.reservation?.reservationCode ?? ''} ${contract.reservation?.status ?? ''}, dòng đơn giữ ${lapLine?.reservedQuantity}`);
      const ledger = await kt.get(`${crm}/v1/receivables/customers/${s.customerId}`);
      const term1 = contract.paymentTerms.find((t) => t.condition === 'SIGN');
      const debit = ledger.entries.find((e) => e.kind === 'DEBIT' && e.contractId === s.contractId && near(e.amount, term1.amount));
      s.term1 = term1;
      s.term2 = contract.paymentTerms.find((t) => t.condition === 'FULL_DELIVERY');
      expect(debit, 'Khoản phải thu đợt 1 phát sinh', debit ? `${vnd(debit.amount)} hạn ${debit.dueDate}` : `sổ: ${ledger.entries.map((e) => `${e.kind} ${e.amount}`).join(', ')}`);
    }],

    [10, 'NV1', async (expect) => {
      const nv1 = await as('NV1');
      let order = await nv1.get(`${crm}/v1/orders/${s.orderId}`);
      const lap = order.lines.find((l) => l.materialCode === LAP);
      const bt = order.lines.find((l) => l.materialCode === BT);
      const planned = order.deliveries.filter((d) => d.status === 'PLANNED');
      const first = { plannedDate: addDays(today, 1), warehouseCode: WAREHOUSE, lines: [{ orderLineId: lap.id, quantity: 8 }, { orderLineId: bt.id, quantity: 1 }] };
      const second = { plannedDate: addDays(today, 3), warehouseCode: WAREHOUSE, lines: [{ orderLineId: lap.id, quantity: 12 }] };
      // Kế hoạch mặc định của chuyển đổi (một đợt giao đủ): bỏ đi rồi lập lại 2 đợt.
      for (const delivery of planned) {
        order = await nv1.post(`${crm}/v1/orders/${s.orderId}/deliveries/${delivery.id}/cancel`, { revision: order.revision });
      }
      order = await nv1.post(`${crm}/v1/orders/${s.orderId}/deliveries`, { revision: order.revision, ...first });
      order = await nv1.post(`${crm}/v1/orders/${s.orderId}/deliveries`, { revision: order.revision, ...second });
      const active = order.deliveries.filter((d) => d.status === 'PLANNED');
      expect(active.length === 2, 'Kế hoạch giao 2 đợt: 8 và 12', active.map((d) => `${d.code}: ${d.lines.map((l) => `${l.materialCode} ${l.plannedQuantity}`).join(', ')}`).join(' | '));
      order = await nv1.post(`${crm}/v1/orders/${s.orderId}/confirm`, { revision: order.revision });
      expect(order.status === 'CONFIRMED', 'Kiểm hạn mức công nợ qua; đơn Đã xác nhận', `${order.status}${order.creditRequest ? `, yêu cầu hạn mức ${order.creditRequest.status}` : ''}`);
      [s.delivery1, s.delivery2] = active.sort((a, b) => a.seq - b.seq);
      s.order = order;
    }],

    [11, 'TK', async (expect) => {
      const order = await requestAndIssue(s.delivery1, s.serials.slice(0, 8));
      const lap = order.lines.find((l) => l.materialCode === LAP);
      expect(order.status === 'PARTIAL', 'Đơn Đã giao một phần', order.status);
      expect(Number(lap.actualCost) > 0 && lap.deliveredQuantity === 8, 'Giá vốn thực tế về đơn', `đã giao ${lap.deliveredQuantity}, giá vốn ${vnd(lap.actualCost)}`);
      const ledger = await (await as('KT')).get(`${crm}/v1/receivables/customers/${s.customerId}`);
      const term2Early = ledger.entries.find((e) => e.kind === 'DEBIT' && e.contractId === s.contractId && near(e.amount, s.term2.amount));
      // Điều kiện FULL_DELIVERY: chỉ ghi nợ khi mọi đơn của hợp đồng giao đủ.
      expect(!term2Early, 'Đợt 2 (70% "khi giao đủ hàng") chưa phát sinh khi mới giao một phần',
        term2Early ? `đã ghi nợ ${vnd(term2Early.amount)} ngay ở đợt giao 1` : 'chưa có khoản đợt 2');
    }],

    [12, 'TK', async (expect) => {
      const order = await requestAndIssue(s.delivery2, s.serials.slice(8, LAP_QTY));
      expect(order.status === 'DELIVERED' || order.status === 'DONE', 'Đơn Đã giao đủ', order.status);
      const ledger = await (await as('KT')).get(`${crm}/v1/receivables/customers/${s.customerId}`);
      const debit = ledger.entries.find((e) => e.kind === 'DEBIT' && e.contractId === s.contractId && near(e.amount, s.term2.amount));
      expect(debit, 'Khoản phải thu đợt 2 phát sinh khi giao đủ', debit ? `${vnd(debit.amount)} ngày ${debit.entryDate}` : 'chưa có');
      // Kho đã xuất đủ phần giữ của hợp đồng: hợp đồng hiện "Đã xuất đủ" như bên Kho, không còn "Đang giữ".
      const contract = await (await as('KT')).get(`${crm}/v1/contracts/${s.contractId}`);
      expect(contract.reservation?.status === 'COMPLETED', 'Giữ hàng của hợp đồng: Đã xuất đủ',
        `${contract.reservation?.reservationCode ?? '-'} ${contract.reservation?.status ?? '-'}`);
      s.order = order;
    }],

    [13, 'KT', async (expect) => {
      s.receipt1 = await collect(s.term1, 'đợt 1');
      expect(s.receipt1.financeVoucherId && s.receipt1.status === 'VOUCHER_DRAFT', 'Phiếu thu bên Tài chính được tạo', `${s.receipt1.code} ${s.receipt1.status} phiếu ${s.receipt1.financeVoucherCode ?? '-'} ${s.receipt1.voucherError ?? ''}`);
    }],

    [14, 'QTV', async (expect) => {
      const kt = await as('KT');
      const ledgerUrl = `${crm}/v1/receivables/customers/${s.customerId}`;
      const before = await kt.get(ledgerUrl);
      const receipt = await postVoucher(s.receipt1);
      expect(receipt.status === 'POSTED', 'QTV ghi sổ phiếu thu; lần thu Đã ghi sổ', `${receipt.code} ${receipt.status}`);
      const after = await kt.get(ledgerUrl);
      const order = await kt.get(`${crm}/v1/orders/${s.orderId}`);
      // Đợt "khi ký" ghi nợ theo hợp đồng (không gắn đơn); còn phải thu theo hợp đồng/khách giảm đúng số đã thu.
      const expected = Number(order.totalAmount) - Number(s.term1.amount);
      expect(near(Number(before.balance) - Number(after.balance), s.term1.amount) && near(after.balance, expected),
        'Còn phải thu giảm đúng số thu đợt 1',
        `dư nợ khách trước ${vnd(before.balance)}, sau ${vnd(after.balance)}, mong đợi ${vnd(expected)}; còn phải thu theo đơn ${vnd(order.receivable?.outstanding)}`);
    }],

    [15, 'KT', async (expect) => {
      const receipt = await collect(s.term2, 'đợt 2');
      expect(receipt.financeVoucherId, 'Thu đợt 2: phiếu thu Tài chính được tạo', `${receipt.code} ${receipt.status}`);
      const posted = await postVoucher(receipt);
      expect(posted.status === 'POSTED', 'QTV ghi sổ phiếu thu đợt 2', posted.status);
      const kt = await as('KT');
      const order = await wait('Đơn tự Hoàn tất khi hết nợ', async () => {
        const current = await kt.get(`${crm}/v1/orders/${s.orderId}`);
        return current.status === 'DONE' ? current : null;
      }).catch(async () => kt.get(`${crm}/v1/orders/${s.orderId}`));
      expect(near(order.receivable?.outstanding ?? -1, 0), 'Công nợ đơn bằng 0', vnd(order.receivable?.outstanding));
      expect(order.status === 'DONE', 'Đơn Hoàn tất', order.status);
      s.order = order;
    }],

    [16, 'KTV', async (expect) => {
      const ktv = await as('KTV');
      s.faulty = s.serials[0];
      const [item] = await ktv.get(`${crm}/v1/warranty/lookup?serial=${encodeURIComponent(s.faulty)}`);
      expect(item?.orderId === s.orderId && item.coverage.remainingDays >= 360 && !item.coverage.expired,
        'Tra serial thấy hạn bảo hành còn lại', item ? `${item.coverage.source} ${item.coverage.months} tháng, đến ${item.coverage.warrantyUntil}, còn ${item.coverage.remainingDays} ngày` : 'không thấy');
      s.case = await ktv.post(`${crm}/v1/warranty/cases`, { cause: 'TECHNICAL_FAULT', description: `${ctx.prefix}: máy không lên nguồn`, lines: [{ serial: s.faulty }] });
      const line = s.case.lines[0];
      expect(s.case.status === 'RECEIVED' && line?.coverage?.remainingDays > 0 && !s.case.chargeable, 'Tiếp nhận yêu cầu lỗi kỹ thuật, hiện hạn còn lại', `${s.case.code}: còn ${line?.coverage?.remainingDays} ngày`);
    }],

    [17, 'TK', async (expect) => {
      const ktv = await as('KTV');
      let detail = await ktv.post(`${crm}/v1/warranty/cases/${s.case.id}/receive`, { revision: s.case.revision });
      const receipt = detail.documents.find((d) => d.kind === 'RETURN_RECEIPT');
      expect(receipt?.documentId, 'KTV gửi lệnh nhận hàng về kho cách ly', `${receipt?.documentCode} ${receipt?.status} ${receipt?.lastError ?? ''}`);
      if (receipt.status !== 'POSTED') await postStockDocument(receipt.documentId);
      detail = await wait('CRM nhận chứng từ nhập trả', async () => {
        const current = await ktv.get(`${crm}/v1/warranty/cases/${s.case.id}`);
        return current.status === 'INSPECTING' ? current : null;
      }).catch(async () => ktv.get(`${crm}/v1/warranty/cases/${s.case.id}`));
      s.case = detail;
      const history = await (await as('TK')).get(`${inv}/v1/serials/${encodeURIComponent(s.faulty)}/history?materialCode=${LAP}`);
      expect(detail.status === 'INSPECTING' && history.qualityStatus === 'PENDING_INSPECTION' && history.warehouseCode === 'QA-KHO-CL', 'Serial về kho cách ly, Chờ kiểm định',
        `yêu cầu ${detail.status}; serial ${history.qualityStatus} tại ${history.warehouseCode}`);
    }],

    [18, 'KTV', async (expect) => {
      const ktv = await as('KTV');
      const line = s.case.lines[0];
      let detail = await ktv.post(`${crm}/v1/warranty/cases/${s.case.id}/lines/${line.id}/inspect`, { revision: s.case.revision, result: 'DEFECTIVE', note: 'Hỏng bo mạch' });
      expect(detail.lines[0].inspectionResult === 'DEFECTIVE', 'Kiểm định Lỗi', detail.status);
      detail = await ktv.post(`${crm}/v1/warranty/cases/${s.case.id}/lines/${line.id}/resolve`, {
        revision: detail.revision, disposition: 'MOVE_TO_DEFECT', remedy: 'REPLACE', replacementWarehouseCode: WAREHOUSE, note: 'Đổi máy mới',
      });
      s.case = detail;
      const replacement = detail.documents.find((d) => d.kind === 'REPLACEMENT');
      expect(replacement?.documentId, 'Chọn đổi serial: có yêu cầu xuất bảo hành', `${replacement?.documentCode} ${replacement?.status} ${replacement?.lastError ?? ''}; chứng từ: ${detail.documents.map((d) => `${d.kind}/${d.status}`).join(', ')}`);
    }],

    [19, 'TK', async (expect) => {
      s.spare = s.serials[LAP_QTY];
      for (const doc of s.case.documents.filter((d) => d.documentId && d.status === 'REQUESTED')) {
        await postStockDocument(doc.documentId, doc.kind === 'REPLACEMENT' ? [s.spare] : undefined);
      }
      const ktv = await as('KTV');
      const detail = await wait('CRM nhận chứng từ xuất thay thế', async () => {
        const current = await ktv.get(`${crm}/v1/warranty/cases/${s.case.id}`);
        return current.documents.filter((d) => d.documentId).every((d) => d.status === 'POSTED') && current.lines[0].replacementSerials.length ? current : null;
      }).catch(async () => ktv.get(`${crm}/v1/warranty/cases/${s.case.id}`));
      s.case = detail;
      expect(detail.lines[0].replacementSerials.includes(s.spare), 'Xuất serial thay thế', `${s.spare}, chứng từ ${detail.documents.map((d) => `${d.kind}/${d.status}`).join(', ')}`);
      const oldHistory = await ktv.get(`${crm}/v1/warranty/serials/${encodeURIComponent(s.faulty)}/history`);
      const newHistory = await ktv.get(`${crm}/v1/warranty/serials/${encodeURIComponent(s.spare)}/history`);
      const oldTypes = oldHistory.movements.map((m) => m.movementType);
      const newTypes = newHistory.movements.map((m) => m.movementType);
      expect(oldTypes.length >= 3 && oldHistory.cases.some((c) => c.role === 'ORIGINAL'), `Lịch sử ${s.faulty} đủ bước`, oldTypes.join(' > '));
      expect(newTypes.length >= 2 && newHistory.cases.some((c) => c.role === 'REPLACEMENT'), `Lịch sử ${s.spare} đủ bước`, newTypes.join(' > '));
      const inherited = newHistory.lookup?.coverage;
      const original = detail.lines[0].coverage?.warrantyUntil;
      expect(inherited?.source === 'INHERITED' && inherited.warrantyUntil === original, 'Serial thay thế kế thừa hạn bảo hành (Q9)', `${inherited?.source} ${inherited?.warrantyUntil} / gốc ${original}`);
    }],

    [20, 'KTV', async (expect) => {
      const ktv = await as('KTV');
      const detail = await ktv.post(`${crm}/v1/warranty/cases/${s.case.id}/close`, { revision: s.case.revision });
      expect(detail.status === 'CLOSED', 'Đóng yêu cầu', detail.status);
      const timeline = await ktv.get(`${crm}/v1/customers/${s.customerId}/timeline?limit=200`);
      const entries = Array.isArray(timeline) ? timeline : (timeline.items ?? []);
      const kinds = new Set(entries.map((e) => e.kind));
      const groups = {
        'cơ hội': kinds.has('opportunity-created') || kinds.has('opportunity-stage-changed'),
        'hoạt động': kinds.has('activity'),
        'báo giá': kinds.has('quote'),
        'hợp đồng': kinds.has('contract'),
        'đơn': kinds.has('order'),
        'doanh thu (giao hàng)': entries.some((e) => e.kind === 'order' && /deliver|issue|giao/i.test(`${e.action}`)),
        'công nợ': kinds.has('receivable'),
        'bảo hành': kinds.has('warranty'),
      };
      const missing = Object.entries(groups).filter(([, ok]) => !ok).map(([k]) => k);
      expect(!missing.length, 'Dòng thời gian khách đủ các loại của kịch bản (8/9; đổi trả không có trong kịch bản)',
        missing.length ? `thiếu: ${missing.join(', ')}; có: ${[...kinds].join(', ')}` : `${entries.length} mục: ${[...kinds].join(', ')}`);
    }],

    [21, 'QL', async (expect) => {
      const ql = await as('QL');
      const period = `from=${today}&to=${today}`;
      const sales = await ql.get(`${crm}/v1/reports/sales?${period}&groupBy=customer`);
      const row = sales.rows.find((r) => r.key === s.customerId);
      const order = s.order;
      const lap = order.lines.find((l) => l.materialCode === LAP);
      const netAmount = Number(order.totals.netAmount);
      expect(row && near(row.revenue, netAmount, 2), 'Doanh thu khách khớp đơn (trước VAT)', row ? `${vnd(row.revenue)} / đơn ${vnd(netAmount)}` : 'không có dòng khách');
      const cost = order.lines.reduce((sum, l) => sum + Number(l.actualCost), 0);
      expect(row && near(row.costAmount, cost, 2) && near(row.profit, Number(row.revenue) - cost, 2), 'Lợi nhuận = doanh thu - giá vốn thực tế',
        row ? `giá vốn ${vnd(row.costAmount)} / đơn ${vnd(cost)} (LAP ${vnd(lap.actualCost)}), lãi ${vnd(row.profit)}` : '');
      const conversion = await ql.get(`${crm}/v1/reports/conversion?${period}&ownerUserId=${s.nv1}`);
      const counts = Object.fromEntries(conversion.steps.map((st) => [st.stage, st.count]));
      expect(['OPPORTUNITY', 'QUOTE', 'CONTRACT', 'ORDER'].every((k) => counts[k] >= 1), 'Chuyển đổi có đủ cơ hội, báo giá, hợp đồng, đơn', JSON.stringify(counts));
      const receivables = await ql.get(`${crm}/v1/reports/receivables`);
      const cust = receivables.customers.find((c) => c.customerId === s.customerId);
      expect(cust && near(cust.balance, 0) && near(cust.collected, order.totalAmount), 'Công nợ khách: đã thu đủ, dư nợ 0',
        cust ? `thu ${vnd(cust.collected)} / tổng đơn ${vnd(order.totalAmount)}, dư ${vnd(cust.balance)}` : 'khách không có trong báo cáo công nợ');
    }],
  ];

  // --- Hàm dùng lại giữa các bước -------------------------------------------------

  async function requestAndIssue(delivery, serials) {
    const nv1 = await as('NV1');
    let order = await nv1.get(`${crm}/v1/orders/${s.orderId}`);
    order = await nv1.post(`${crm}/v1/orders/${s.orderId}/deliveries/${delivery.id}/request-issue`, { revision: order.revision });
    const requested = order.deliveries.find((d) => d.id === delivery.id);
    if (!requested.issueDocumentId) throw new StepFailure(`Đợt ${requested.code} không có chứng từ xuất (${requested.status}).`);
    await postStockDocument(requested.issueDocumentId, serials);
    return wait(`CRM nhận xuất kho đợt ${requested.code}`, async () => {
      const current = await nv1.get(`${crm}/v1/orders/${s.orderId}`);
      return current.deliveries.find((d) => d.id === delivery.id)?.status === 'ISSUED' ? current : null;
    });
  }

  /** TK chọn serial (nếu có) cho dòng QA-KHO-LAP rồi ghi sổ chứng từ Kho. */
  async function postStockDocument(documentId, serials) {
    const tk = await as('TK');
    const url = `${inv}/v1/stock-documents/${documentId}`;
    let doc = await tk.get(url);
    if (doc.status === 'POSTED') return doc;
    if (serials?.length) {
      const lines = doc.lines.map((line) => ({
        materialCode: line.materialCode,
        quantity: Number(line.quantity),
        ...(line.reservationId ? { reservationId: line.reservationId } : {}),
        ...(line.materialCode === LAP ? { serials } : line.serials?.length ? { serials: line.serials } : {}),
        ...(line.lotNo ? { lot: { lotNo: line.lotNo } } : {}),
      }));
      doc = await tk.patch(url, { lines });
    }
    const posted = await tk.post(`${url}/post`);
    const result = posted.document ?? posted;
    if (result.status !== 'POSTED') throw new StepFailure(`Chứng từ ${doc.code} sau ghi sổ: ${result.status}`);
    return result;
  }

  /** KT ghi nhận thu tiền một đợt, phân bổ vào khoản nợ của đợt; chờ phiếu Tài chính nháp. */
  async function collect(term, label) {
    const kt = await as('KT');
    const ledger = await kt.get(`${crm}/v1/receivables/customers/${s.customerId}`);
    const item = ledger.openItems.find((o) => o.contractId === s.contractId && near(o.openAmount, term.amount));
    if (!item) throw new StepFailure(`Không thấy khoản nợ ${label} (${vnd(term.amount)}) để phân bổ; mở: ${ledger.openItems.map((o) => `${o.contractCode ?? o.orderCode} ${o.openAmount}`).join(', ')}`);
    const receipt = await kt.post(`${crm}/v1/receipts`, {
      customerId: s.customerId, amount: item.openAmount, method: 'BANK_TRANSFER', receiptDate: today,
      note: `${ctx.prefix}: thu ${label}`, allocations: [{ entryId: item.entryId, amount: item.openAmount }],
    });
    return wait(`Tài chính tạo phiếu thu cho lần thu ${receipt.code}`, async () => {
      const current = await kt.get(`${crm}/v1/receipts/${receipt.id}`);
      return current.financeVoucherId ? current : null;
    }).catch(async () => kt.get(`${crm}/v1/receipts/${receipt.id}`));
  }

  /** QTV ghi sổ phiếu thu nguồn Bán hàng ở Tài chính; chờ Bán hàng nhận kết quả. */
  async function postVoucher(receipt) {
    const qtv = await as('QTV');
    const fin = config.financeApi;
    let voucher = await qtv.get(`${fin}/v1/vouchers/${receipt.financeVoucherId}`);
    // Bán hàng khoá số tiền, nội dung, đối tượng, ngày; phần kế toán (lý do thu, nhóm đối tượng, tài khoản) do người
    // ghi sổ chọn. Lý do thu "Thu tiền bán hàng" tạo một lần nếu tenant chưa có.
    let catalogs = await qtv.get(`${fin}/v1/catalogs`);
    let reason = catalogs.reasons.find((r) => r.kind === 'RECEIPT' && r.code === 'QA-TC-THU-BH');
    if (!reason) {
      await qtv.post(`${fin}/v1/catalogs/reasons`, { kind: 'RECEIPT', code: 'QA-TC-THU-BH', name: 'Thu tiền bán hàng' });
      catalogs = await qtv.get(`${fin}/v1/catalogs`);
      reason = catalogs.reasons.find((r) => r.kind === 'RECEIPT' && r.code === 'QA-TC-THU-BH');
    }
    const group = catalogs.counterpartyGroups.find((g) => g.code === 'KHACH_HANG');
    const account = (await qtv.get(`${fin}/v1/accounts`)).find((a) => a.code === 'QA-TC-VCB');
    if (!voucher.reasonId || !voucher.counterpartyGroupId || !voucher.accountId) {
      voucher = await qtv.put(`${fin}/v1/vouchers/${voucher.id}`, {
        kind: voucher.kind,
        voucherDate: voucher.voucherDate,
        postingDate: voucher.postingDate,
        content: voucher.content,
        reasonId: voucher.reasonId ?? reason.id,
        accountId: voucher.accountId ?? account.id,
        counterpartyGroupId: voucher.counterpartyGroupId ?? group.id,
        counterpartyName: voucher.counterpartyName,
        counterpartyAccountNo: voucher.counterpartyAccountNo,
        counterpartyBank: voucher.counterpartyBank,
        taxIncluded: voucher.taxIncluded,
        taxRate: voucher.taxRate,
        note: voucher.note,
        lines: voucher.lines.map(({ description, quantity, unitAmount, total }) => ({ description, quantity, unitAmount, total })),
        revision: voucher.revision,
      });
    }
    await qtv.post(`${fin}/v1/vouchers/${voucher.id}/post-sourced`, { note: 'UAT: đã nhận tiền', revision: voucher.revision });
    const kt = await as('KT');
    return wait(`CRM nhận phiếu ${voucher.code} đã ghi sổ`, async () => {
      const current = await kt.get(`${crm}/v1/receipts/${receipt.id}`);
      return current.status === 'POSTED' ? current : null;
    }).catch(async () => kt.get(`${crm}/v1/receipts/${receipt.id}`));
  }

  // --- Chạy tuần tự; một bước lỗi thì các bước sau bỏ qua -------------------------
  let stopped = null;
  for (const [step, account, run] of steps) {
    if (stopped !== null) {
      record(step, account, 'Bỏ qua', 'SKIP', `bước ${stopped} lỗi`);
      continue;
    }
    try {
      await run(makeExpect(step, account));
    } catch (error) {
      const recorded = results.at(-1)?.step === String(step) && results.at(-1).status === 'FAIL';
      if (!recorded) {
        record(step, account, error instanceof StepFailure ? 'Không làm được bước' : 'Lỗi khi gọi API', 'FAIL', error instanceof Error ? error.message : String(error));
      }
      stopped = step;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// TC-UAT-02..09: kiểm tra nhanh theo vai trò
// ---------------------------------------------------------------------------

async function runRoleChecks(config, sessions) {
  const crm = config.crmApi;
  const status = async (code, method, url, body) => (await (await sessions.as(code)).call(method, url, { body, expect: [400, 401, 403, 404, 409] })).status;
  const admin = await sessions.as('QTV');
  const customers = await allPages(admin, `${crm}/v1/customers?q=QA-CRM-KH`);
  const byCode = new Map(customers.map((c) => [c.code, c]));
  const nv1 = await sessions.userId('NV1');
  const checks = [
    ['UAT-02', 'NV1', 'Không thấy khách của NV3 (QA-CRM-KH21) theo id: 404', async () => [await status('NV1', 'GET', `${crm}/v1/customers/${byCode.get('QA-CRM-KH21')?.id}`), 404]],
    ['UAT-02', 'NV1', 'Danh sách khách chỉ gồm khách của mình', async () => {
      const mine = await allPages(await sessions.as('NV1'), `${crm}/v1/customers`);
      const others = mine.filter((c) => c.ownerUserId !== nv1);
      return [others.length === 0 && mine.length > 0, true, `${mine.length} khách, của người khác ${others.length}`];
    }],
    ['UAT-02', 'NV1', 'Không xem báo cáo: 403', async () => [await status('NV1', 'GET', `${crm}/v1/reports/sales`), 403]],
    ['UAT-03', 'TN', 'Thấy khách của NV1 (cấp dưới): 200', async () => [await status('TN', 'GET', `${crm}/v1/customers/${byCode.get('QA-CRM-KH01')?.id}`), 200]],
    ['UAT-03', 'TN', 'Không thấy khách của NV3 (khác nhóm): 404', async () => [await status('TN', 'GET', `${crm}/v1/customers/${byCode.get('QA-CRM-KH21')?.id}`), 404]],
    ['UAT-04', 'QTBH', 'Xem bảng giá, chính sách: 200', async () => [Math.max(await status('QTBH', 'GET', `${crm}/v1/price-lists`), await status('QTBH', 'GET', `${crm}/v1/discount-policies`)), 200]],
    ['UAT-05', 'QTBH', 'Xem danh sách hợp đồng: 200', async () => [await status('QTBH', 'GET', `${crm}/v1/contracts`), 200]],
    ['UAT-06', 'TK', 'Không có quyền CRM: báo giá 403', async () => [await status('TK', 'GET', `${crm}/v1/quotes`), 403]],
    ['UAT-06', 'TK', 'Xem chứng từ kho: 200', async () => [await status('TK', 'GET', `${config.inventoryApi}/v1/stock-documents`), 200]],
    ['UAT-07', 'KT', 'Xem tuổi nợ: 200', async () => [await status('KT', 'GET', `${crm}/v1/receivables/aging`), 200]],
    ['UAT-07', 'KT', 'Không lập báo giá: 403', async () => [await status('KT', 'POST', `${crm}/v1/quotes`, { customerId: byCode.get('QA-CRM-KH01')?.id }), 403]],
    ['UAT-08', 'KTV', 'Xem yêu cầu bảo hành: 200', async () => [await status('KTV', 'GET', `${crm}/v1/warranty/cases`), 200]],
    ['UAT-08', 'KTV', 'Không lập đơn bán: 403', async () => [await status('KTV', 'POST', `${crm}/v1/orders`, { customerId: byCode.get('QA-CRM-KH01')?.id }), 403]],
    ['UAT-09', 'QL', 'Xem đủ 4 báo cáo (doanh thu, chuyển đổi, cảnh báo, công nợ): 200', async () => {
      const codes = [];
      for (const path of ['sales', 'conversion', 'alerts', 'receivables']) codes.push(await status('QL', 'GET', `${crm}/v1/reports/${path}`));
      return [codes.every((c) => c === 200), true, codes.join(', ')];
    }],
  ];
  for (const [step, account, check, run] of checks) {
    try {
      const [actual, expected, details] = await run();
      record(step, account, check, actual === expected ? 'PASS' : 'FAIL', details ?? `HTTP ${actual}`);
    } catch (error) {
      record(step, account, check, 'FAIL', error instanceof Error ? error.message : String(error));
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: { tenant: { type: 'string', default: 'svn' }, 'roles-only': { type: 'boolean', default: false } },
  });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.tenant)) throw new Error(`Tenant slug không hợp lệ: ${values.tenant}`);
  loadEnv();
  const config = buildConfig(values.tenant);
  const sessions = createSessions(config);
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
  const ctx = { stamp, prefix: `QA-UAT-${stamp}` };
  console.log(`UAT ${values.tenant}, lượt ${ctx.prefix}\n`);
  if (!values['roles-only']) await runE2E(config, sessions, ctx);
  await runRoleChecks(config, sessions);
  printTable();
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}

main().catch((error) => {
  console.error(`LỖI: ${error instanceof Error ? error.stack : String(error)}`);
  printTable();
  process.exit(1);
});
