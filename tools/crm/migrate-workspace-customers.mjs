#!/usr/bin/env node
// Chuyển khách hàng Workspace sang Bán hàng (T2-15, quyết định D1; docs/crm/TEST.md TC-MIG-05).
// Chỉ gọi API thật bằng phiên quản trị tenant (cookie và CSRF như web app), không ghi thẳng DB, không ghi chéo schema:
//   1. Đọc khách Workspace: GET /api/workspace/v1/customers.
//   2. Khách chưa gắn: tìm ở Bán hàng theo mã (GET /api/crm/v1/customers?q=); chưa có thì tạo (POST /api/crm/v1/customers,
//      giữ mã); trùng mã thì dùng khách đã có.
//   3. Gắn khách Workspace với khách Bán hàng: POST /api/workspace/v1/crm-customers/:id/link { customerId } (ghi
//      crm_customer_id). Sự kiện crm.customer.created cũng tự gắn theo mã; hai đường gặp nhau vẫn ra một bản sao.
// Chạy lại được: khách đã gắn được bỏ qua.
//
//   node tools/crm/migrate-workspace-customers.mjs [--tenant=svn] [--dry-run] [--generate-codes]
//
// Biến môi trường: tools/crm/README.md, mục "Chuyển khách hàng Workspace sang Bán hàng".
import { parseArgs } from 'node:util';
import { adminEmail, buildConfig, loadEnv } from './seed-svn/config.mjs';
import { HttpError, Session } from './seed-svn/http.mjs';

/** Khớp `normalizeCustomerCode` của Bán hàng: viết hoa, chữ không dấu, số, `.`, `-`, `_`, tối đa 50 ký tự. */
const CRM_CODE_PATTERN = /^[A-Z0-9._-]{1,50}$/;
const CRM_NAME_MAX = 300;
const CRM_NOTE_MAX = 2000;

export function crmCodeOf(workspaceCode) {
  const code = String(workspaceCode ?? '').trim().toUpperCase();
  return CRM_CODE_PATTERN.test(code) ? code : null;
}

async function findCrmByCode(session, crmApi, code) {
  const page = await session.get(`${crmApi}/v1/customers?q=${encodeURIComponent(code)}&limit=100`);
  return (page?.items ?? []).find((item) => item.code === code);
}

async function createCrmCustomer(session, crmApi, customer, code) {
  const body = {
    ...(code ? { code } : {}),
    name: customer.name.slice(0, CRM_NAME_MAX),
    note: [customer.note, code ? null : `Mã khách Workspace cũ: ${customer.code}`]
      .filter(Boolean)
      .join('\n')
      .slice(0, CRM_NOTE_MAX) || undefined,
  };
  const { status, data } = await session.call('POST', `${crmApi}/v1/customers`, { body, expect: [409] });
  if (status !== 409) return { customer: data, created: true };
  // Trùng mã (có người vừa tạo): dùng khách đã có.
  if (code && data?.code === 'CUSTOMER_CODE_EXISTS') {
    const existing = await findCrmByCode(session, crmApi, code);
    if (existing) return { customer: existing, created: false };
  }
  throw new HttpError('POST', `${crmApi}/v1/customers`, status, data);
}

export async function migrateWorkspaceCustomers(config, session, options, log) {
  const report = {
    total: 0,
    alreadyLinked: 0,
    matched: 0,
    created: 0,
    linked: 0,
    invalidCode: 0,
    failed: 0,
  };
  const status = await session.get(`${config.workspaceApi}/v1/status`);
  if (!status?.capabilities?.customersManagedByCrm) {
    const message =
      'Workspace báo tenant chưa bật CRM (capabilities.customersManagedByCrm = false), hoặc workspace-api là bản cũ.';
    if (!options.dryRun) throw new Error(`${message} Bật phân hệ crm cho tenant rồi chạy lại.`);
    log.warn(`${message} Chạy thử vẫn tiếp tục.`);
  }

  const customers = await session.get(`${config.workspaceApi}/v1/customers`);
  report.total = customers.length;
  for (const customer of customers) {
    const label = `${customer.code} "${customer.name}"`;
    if (customer.crmCustomerId) {
      report.alreadyLinked += 1;
      log.skip(`${label} đã gắn khách CRM ${customer.crmCustomerId}.`);
      continue;
    }
    const code = crmCodeOf(customer.code);
    if (!code && !options.generateCodes) {
      report.invalidCode += 1;
      log.warn(
        `${label}: mã không hợp lệ ở CRM (chỉ chữ không dấu, số, . - _; tối đa 50 ký tự). ` +
          'Sửa mã ở Workspace trước, hoặc chạy với --generate-codes để CRM cấp mã mới.',
      );
      continue;
    }
    try {
      const existing = code ? await findCrmByCode(session, config.crmApi, code) : undefined;
      if (options.dryRun) {
        if (existing) report.matched += 1;
        else report.created += 1;
        log.info(
          existing
            ? `(thử) ${label} sẽ gắn với khách CRM có sẵn ${existing.code}.`
            : `(thử) ${label} sẽ tạo ở CRM với mã ${code ?? '(CRM cấp)'} rồi gắn.`,
        );
        continue;
      }
      let target = existing;
      if (target) report.matched += 1;
      else {
        const outcome = await createCrmCustomer(session, config.crmApi, customer, code);
        target = outcome.customer;
        if (outcome.created) report.created += 1;
        else report.matched += 1;
      }
      // Gắn đích danh khách này: mã hai bên có thể khác hoa thường hoặc do Bán hàng cấp mới.
      await session.post(`${config.workspaceApi}/v1/crm-customers/${target.id}/link`, { customerId: customer.id });
      report.linked += 1;
      log.created(`${label} gắn với khách CRM ${target.code}.`);
    } catch (error) {
      report.failed += 1;
      log.warn(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}

function createLog() {
  return {
    info: (text) => console.log(`   ${text}`),
    created: (text) => console.log(` + ${text}`),
    skip: (text) => console.log(` = ${text}`),
    warn: (text) => console.warn(` ! ${text}`),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string', default: 'svn' },
      'dry-run': { type: 'boolean', default: false },
      'generate-codes': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Cách dùng: node tools/crm/migrate-workspace-customers.mjs [--tenant=svn] [--dry-run] [--generate-codes]');
    return;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.tenant)) throw new Error(`Tenant slug không hợp lệ: ${values.tenant}`);
  loadEnv();
  const config = buildConfig(values.tenant);
  const email = process.env.CRM_MIGRATE_ADMIN_EMAIL ?? adminEmail(config);
  const password = process.env.CRM_MIGRATE_ADMIN_PASSWORD ?? config.password;
  const session = await Session.login(config.platformApi, { email, password, portal: 'tenant' });
  const options = { dryRun: values['dry-run'], generateCodes: values['generate-codes'] };
  console.log(`== Chuyển khách hàng Workspace sang CRM (${values.tenant}${options.dryRun ? ', chạy thử' : ''})`);
  const report = await migrateWorkspaceCustomers(config, session, options, createLog());
  console.log(
    `\n${options.dryRun ? 'Chạy thử' : 'Hoàn tất'}: ${report.total} khách Workspace; ${report.alreadyLinked} đã gắn từ trước; ` +
      `${report.matched} khớp khách CRM có sẵn; ${report.created} ${options.dryRun ? 'sẽ tạo' : 'tạo mới'} ở CRM; ` +
      `${report.linked} vừa gắn; ${report.invalidCode} mã không hợp lệ (cần xử lý tay); ${report.failed} lỗi.`,
  );
  if (report.failed || (!options.dryRun && report.invalidCode)) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
