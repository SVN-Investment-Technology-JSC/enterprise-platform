import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LoginPortal } from '@enterprise-platform/contracts-identity';

export interface PresetAccount {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  password: string;
}

interface PresetAccountFile {
  defaultPassword?: string;
  tenant?: PresetAccountEntry[];
  platform?: PresetAccountEntry[];
}

interface PresetAccountEntry {
  email: string;
  label?: string;
  description?: string;
  badge?: string;
  password?: string;
}

const FILE_NAME = 'login-local-accounts.local.json';
const CANDIDATES = [
  join(process.cwd(), 'src/app/_components', FILE_NAME),
  join(process.cwd(), 'apps/web/src/app/_components', FILE_NAME),
];

/**
 * Danh sách tài khoản chọn nhanh ở form đăng nhập, đọc từ `login-local-accounts.local.json`
 * (đã gitignore, mẫu ở `login-local-accounts.example.json`). Chỉ dùng ngoài production;
 * thiếu file hoặc file lỗi thì trả về danh sách rỗng và form ẩn ô chọn.
 */
export function loadPresetAccounts(portal: LoginPortal): PresetAccount[] {
  if (process.env.NODE_ENV === 'production') return [];
  const path = CANDIDATES.find((candidate) => existsSync(candidate));
  if (!path) return [];
  try {
    const file = JSON.parse(readFileSync(path, 'utf8')) as PresetAccountFile;
    return (file[portal] ?? []).flatMap((entry) => {
      const password = entry.password ?? file.defaultPassword;
      if (!entry.email || !password) return [];
      return [
        {
          value: entry.email,
          label: entry.label ?? entry.email,
          description: entry.description ?? entry.email,
          badge: entry.badge,
          password,
        },
      ];
    });
  } catch {
    return [];
  }
}
