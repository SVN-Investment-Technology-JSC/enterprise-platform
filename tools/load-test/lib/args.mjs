// Bộ đọc tham số dòng lệnh tối giản: --key value, --flag, --key=value.
export function parseArgs(argv = process.argv.slice(2), booleans = []) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    let key = a.slice(2);
    let val;
    const eq = key.indexOf('=');
    if (eq >= 0) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (booleans.includes(key) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
      val = true;
    } else {
      val = argv[++i];
    }
    out[key] = val;
  }
  return out;
}

export const num = (v, d) => (v === undefined || v === true || Number.isNaN(Number(v)) ? d : Number(v));

export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
