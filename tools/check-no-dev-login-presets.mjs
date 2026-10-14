#!/usr/bin/env node
// Chặn đưa chức năng "chọn tài khoản nhanh" (dùng cho tester ở máy cá nhân) vào mã nguồn được theo dõi bởi git.
// Chức năng này kèm mật khẩu dạng chữ thường nên chỉ được tồn tại cục bộ (file *.local.*, gitignore), không bao giờ lên repo.
// Chạy: node tools/check-no-dev-login-presets.mjs   (CI chạy ở job "Detect CI scope" cho mọi pull request và push)
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** Dấu hiệu của chức năng chọn tài khoản nhanh ở form đăng nhập. */
const FORBIDDEN = [
  { pattern: /Chọn tài khoản để điền nhanh/, why: 'ô chọn tài khoản nhanh ở form đăng nhập' },
  { pattern: /\bPRESET_ACCOUNTS\b/, why: 'danh sách tài khoản kèm mật khẩu viết cứng' },
  { pattern: /\bloadPresetAccounts\b/, why: 'bộ nạp tài khoản chọn nhanh' },
  { pattern: /\bpresetAccounts\b/, why: 'prop tài khoản chọn nhanh của LoginForm' },
  { pattern: /login-local-accounts/, why: 'tham chiếu tới file tài khoản cục bộ' },
];

const SCANNED_DIRS = ['apps', 'packages'];
const SELF = relative(root, import.meta.filename).replaceAll('\\', '/');

// Đọc nội dung trong INDEX của git (đúng thứ sẽ được commit/CI checkout), không đọc working tree: bản dùng cục bộ
// (patch + skip-worktree) nằm ở working tree nên không bị báo nhầm.
const hits = [];
for (const { pattern, why } of FORBIDDEN) {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '--cached', '-n', '-I', '-E', pattern.source, '--', ...SCANNED_DIRS, `:(exclude)${SELF}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
  } catch (error) {
    if (error.status !== 1) throw error; // 1 = không có kết quả
  }
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [file, lineNo] = line.split(':');
    hits.push(`${file}:${lineNo}  ${why}`);
  }
}

if (hits.length) {
  console.error('Phát hiện chức năng chọn tài khoản nhanh (chỉ dùng cục bộ) trong mã nguồn được commit:\n');
  for (const hit of hits) console.error(`  ${hit}`);
  console.error(
    '\nChức năng này kèm mật khẩu nên không được commit. Gỡ khỏi các file trên; bản dùng cục bộ giữ ở file *.local.* (gitignore)\n' +
      'hoặc patch ngoài repo. Xem tools/check-no-dev-login-presets.mjs.',
  );
  process.exit(1);
}
console.log('OK: không có chức năng chọn tài khoản nhanh trong mã nguồn được theo dõi (apps, packages).');
