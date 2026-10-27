#!/usr/bin/env node
// Seed tenant thí điểm của phân hệ Bán hàng (docs/crm/TEST.md mục 1.3) qua API thật, không ghi thẳng DB.
// Chạy lại được nhiều lần: bản ghi đã có (theo mã hoặc email) được bỏ qua.
//
//   node tools/crm/seed-svn.mjs --step=tenant [--tenant=svn]
//   node tools/crm/seed-svn.mjs --step=legacy [--tenant=svn]
//
// Biến môi trường và thứ tự chạy: tools/crm/README.md.
import { parseArgs } from 'node:util';
import { buildConfig, loadEnv } from './seed-svn/config.mjs';

const STEPS = {
  tenant: async () => (await import('./seed-svn/tenant.mjs')).runTenantStep,
  legacy: async () => (await import('./seed-svn/legacy.mjs')).runLegacyStep,
};

const log = {
  counts: { created: 0, skipped: 0 },
  section(text) {
    console.log(`\n== ${text}`);
  },
  info(text) {
    console.log(`   ${text}`);
  },
  created(text) {
    this.counts.created += 1;
    console.log(` + ${text}`);
  },
  skip(text) {
    this.counts.skipped += 1;
    console.log(` = ${text}`);
  },
  warn(text) {
    console.warn(` ! ${text}`);
  },
};

async function main() {
  const { values } = parseArgs({
    options: {
      step: { type: 'string' },
      tenant: { type: 'string', default: 'svn' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || !values.step) {
    console.log(`Cách dùng: node tools/crm/seed-svn.mjs --step=<${Object.keys(STEPS).join('|')}> [--tenant=svn]`);
    process.exit(values.help ? 0 : 1);
  }
  const loader = STEPS[values.step];
  if (!loader) throw new Error(`Bước không hợp lệ: ${values.step}. Các bước: ${Object.keys(STEPS).join(', ')}.`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.tenant)) throw new Error(`Tenant slug không hợp lệ: ${values.tenant}`);

  loadEnv();
  const config = buildConfig(values.tenant);
  const run = await loader();
  const started = Date.now();
  await run(config, log);
  console.log(
    `\nHoàn tất bước ${values.step} (${values.tenant}) trong ${((Date.now() - started) / 1000).toFixed(1)} giây: ` +
      `${log.counts.created} thay đổi, ${log.counts.skipped} bỏ qua vì đã có.`,
  );
}

main().catch((error) => {
  console.error(`\nLỖI: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
