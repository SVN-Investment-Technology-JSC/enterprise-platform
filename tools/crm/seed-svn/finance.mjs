// Bước `finance` (T5-14): tài khoản quỹ tiền mặt và ngân hàng, cài đặt Tài chính (không cho tự duyệt), hạn mức công
// nợ của 3 khách (dưới, sát, vượt hạn mức) và dư nợ sẵn, có khoản quá hạn 30, 61, 91 ngày.
//
// Ngày ghi nợ khi giao hàng là lúc Kho ghi sổ chứng từ xuất (`posted_at = now()` trong sự kiện
// `inventory.stock.issued`), không phải ngày chứng từ, nên đơn giao qua API luôn ghi nợ hôm nay. Khoản quá hạn vì vậy
// tạo bằng đợt thanh toán "khi ký" của hợp đồng có ngày ký trong quá khứ: xác nhận hợp đồng ghi nợ ngày ký, hạn = ngày
// ký + số ngày của đợt (0), đúng luồng API `POST /crm/v1/contracts/:id/confirm`.
import { addDays, createSessions, formatVnd, materialsByCode, requireCustomers, vnToday } from './common.mjs';
import { ensureContract, ensureDeliveredOrder } from './sales-flow.mjs';

const ACCOUNTS = [
  {
    code: 'QA-TC-TM',
    name: 'QA Quỹ tiền mặt',
    accountType: 'CASH',
    openingBalance: 50_000_000,
    note: 'Quỹ tiền mặt văn phòng (seed)',
  },
  {
    code: 'QA-TC-VCB',
    name: 'QA Tài khoản Vietcombank',
    accountType: 'BANK',
    bankName: 'Vietcombank (VCB)',
    accountNumber: '0011000123456',
    accountHolder: 'CONG TY SVN TEST',
    branch: 'Hà Nội',
    openingBalance: 500_000_000,
    note: 'Tài khoản nhận chuyển khoản (seed)',
  },
];

/**
 * Hạn mức và dư nợ: mỗi khách một hợp đồng ký cách đây `overdueDays` ngày, đợt "khi ký" 100% hạn 0 ngày.
 * KH01 dưới hạn mức, KH02 sát hạn mức (đơn mới 10 triệu sẽ vượt), KH03 đã vượt hạn mức.
 */
const CREDIT_CASES = [
  { customer: 'QA-CRM-KH01', label: 'dưới hạn mức', creditLimit: 200_000_000, debt: 50_000_000, overdueDays: 30 },
  { customer: 'QA-CRM-KH02', label: 'sát hạn mức', creditLimit: 100_000_000, debt: 95_000_000, overdueDays: 61 },
  { customer: 'QA-CRM-KH03', label: 'vượt hạn mức', creditLimit: 50_000_000, debt: 80_000_000, overdueDays: 91 },
];

/** Một đơn giao hôm nay cho KH01: ghi nợ theo giao hàng (D3), chưa đến hạn (thời hạn thanh toán 30 ngày). */
const DELIVERED_ORDER = {
  customer: 'QA-CRM-KH01',
  owner: 'NV1',
  marker: 'seed-svn:finance:KH01-giao-hang',
  lines: [{ materialCode: 'QA-KHO-CAP', quantity: 2 }],
};

async function ensureAccounts(config, sessions, log) {
  const admin = await sessions.as('QTV');
  const accounts = await admin.get(`${config.financeApi}/v1/accounts?includeInactive=true`);
  for (const account of ACCOUNTS) {
    if (accounts.some((item) => item.code === account.code)) {
      log.skip(`Tài khoản ${account.code} "${account.name}" đã có.`);
      continue;
    }
    await admin.post(`${config.financeApi}/v1/accounts`, {
      ...account,
      openingDate: `${new Date().getFullYear()}-01-01`,
      allowNegative: false,
      isActive: true,
    });
    log.created(`Tài khoản ${account.code} "${account.name}" (${account.accountType}, đầu kỳ ${formatVnd(account.openingBalance)}).`);
  }
  const settings = await admin.get(`${config.financeApi}/v1/settings`);
  if (settings.allowSelfApproval === false) log.skip('Tài chính: không cho người lập tự duyệt (đã đúng).');
  else {
    await admin.put(`${config.financeApi}/v1/settings`, { allowSelfApproval: false });
    log.created('Tài chính: tắt tự duyệt phiếu.');
  }
}

async function ensureCreditCases(config, sessions, customers, log) {
  const admin = await sessions.as('QTV');
  const materials = await materialsByCode(config, admin);
  const service = materials.get('QA-KHO-BT');
  if (!service) throw new Error('Chưa có mặt hàng QA-KHO-BT. Chạy --step=inventory trước.');
  const today = vnToday();
  for (const item of CREDIT_CASES) {
    const customer = customers.get(item.customer);
    const signedDate = addDays(today, -item.overdueDays);
    await ensureContract(config, sessions, log, {
      type: 'SALE',
      customerId: customer.id,
      title: `QA-CRM Công nợ quá hạn ${item.overdueDays} ngày (${item.customer})`,
      signedDate,
      validFrom: signedDate,
      value: item.debt,
      ownerUserId: customer.ownerUserId,
      note: `Seed T5-14: dư nợ ${item.label}, quá hạn ${item.overdueDays} ngày`,
      lines: [{ materialId: service.id, quantity: item.debt / 5_000_000, unitPrice: 5_000_000, vatRate: 0 }],
      paymentTerms: [{ name: 'Thanh toán khi ký', percent: 100, condition: 'SIGN', dueDays: 0 }],
    });
    const current = await admin.get(`${config.crmApi}/v1/customers/${customer.id}`);
    if (Number(current.creditLimit) === item.creditLimit) log.skip(`${item.customer}: hạn mức ${formatVnd(item.creditLimit)} (đã đúng).`);
    else {
      await admin.patch(`${config.crmApi}/v1/customers/${customer.id}`, { version: current.version, creditLimit: item.creditLimit });
      log.created(`${item.customer}: hạn mức ${formatVnd(item.creditLimit)} (${item.label}).`);
    }
  }
}

async function summary(config, sessions, customers, log) {
  const kt = await sessions.as('KT');
  for (const item of CREDIT_CASES) {
    const ledger = await kt.get(`${config.crmApi}/v1/receivables/customers/${customers.get(item.customer).id}`);
    const overdue = ledger.openItems
      .filter((open) => open.daysOverdue > 0)
      .map((open) => `${open.daysOverdue} ngày (${open.bucket})`)
      .join(', ');
    log.info(
      `${item.customer}: dư nợ ${formatVnd(ledger.balance)} / hạn mức ${formatVnd(ledger.creditLimit ?? 0)}` +
        `${ledger.creditExceeded ? ' (vượt)' : ''}; quá hạn ${formatVnd(ledger.overdueAmount)}: ${overdue || 'không'}.`,
    );
  }
  const accounts = await (await sessions.as('QTV')).get(`${config.financeApi}/v1/accounts`);
  log.info(`Tài khoản Tài chính: ${accounts.map((account) => `${account.code} (${account.accountType})`).join(', ')}.`);
}

export async function runFinanceStep(config, log) {
  log.section(`Bước finance cho ${config.tenantSlug}`);
  const sessions = createSessions(config);
  const admin = await sessions.as('QTV');
  const customers = await requireCustomers(config, admin, CREDIT_CASES.map((item) => item.customer));
  log.section('Tài khoản và cài đặt Tài chính');
  await ensureAccounts(config, sessions, log);
  log.section('Hạn mức và dư nợ quá hạn (hợp đồng ký trong quá khứ, đợt "khi ký")');
  await ensureCreditCases(config, sessions, customers, log);
  log.section('Đơn giao hôm nay, ghi nợ theo giao hàng');
  await ensureDeliveredOrder(config, sessions, log, {
    owner: DELIVERED_ORDER.owner,
    customerId: customers.get(DELIVERED_ORDER.customer).id,
    marker: DELIVERED_ORDER.marker,
    label: `${DELIVERED_ORDER.customer} giao hàng`,
    plannedDate: vnToday(),
    lines: DELIVERED_ORDER.lines,
  });
  log.section('Tóm tắt');
  await summary(config, sessions, customers, log);
}
