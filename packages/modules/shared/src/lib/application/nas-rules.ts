import type { SharedNasAccess, SharedNasLinkSource, SharedNasRule } from '@enterprise-platform/contracts-shared';
import { SharedValidationError } from '../domain/shared.error.js';

/** Tài khoản NAS đã đồng bộ về ERP. */
export interface NasAccountRecord {
  readonly name: string;
  readonly description: string;
  readonly email?: string;
  readonly disabled: boolean;
  readonly groups: readonly string[];
  readonly erpUserId?: string;
  readonly linkSource: SharedNasLinkSource;
}

/** Một dòng quyền của thư mục chia sẻ trên NAS. */
export interface NasRuleRecord {
  readonly share: string;
  readonly principalType: 'user' | 'group';
  readonly principalName: string;
  readonly rule: SharedNasRule;
}

const same = (left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;

/**
 * Quyền của một tài khoản NAS trên một thư mục chia sẻ, theo đúng luật của NAS:
 * gộp quyền đặt cho chính tài khoản và cho mọi nhóm nó thuộc về; có một dòng
 * Không truy cập là không vào được, kể cả khi nhóm khác cho Đọc/Ghi; không thì
 * Đọc/Ghi thắng Chỉ đọc. Tài khoản bị khoá trên NAS thì không vào được gì.
 * Tên tài khoản, tên nhóm không phân biệt hoa thường, như DSM.
 */
export function nasAccess(
  account: Pick<NasAccountRecord, 'name' | 'groups' | 'disabled'> | undefined,
  rules: readonly NasRuleRecord[],
  share: string,
): { readonly access: SharedNasAccess; readonly via: readonly string[] } {
  if (!account || account.disabled) return { access: 'none', via: [] };
  const matching = rules.filter(
    (rule) =>
      same(rule.share, share) &&
      (rule.principalType === 'user'
        ? same(rule.principalName, account.name)
        : account.groups.some((group) => same(group, rule.principalName))),
  );
  const label = (rule: NasRuleRecord) =>
    rule.principalType === 'user' ? `tài khoản ${rule.principalName}` : `nhóm ${rule.principalName}`;
  for (const level of ['deny', 'write', 'read'] as const) {
    const hits = matching.filter((rule) => rule.rule === level);
    if (hits.length > 0) return { access: level === 'deny' ? 'none' : level, via: hits.map(label) };
  }
  return { access: 'none', via: [] };
}

/** Bỏ dấu tiếng Việt, chữ thường: "Phạm Thị Diễm Thúy" → "pham thi diem thuy". */
export function foldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Các tên tài khoản NAS thường đặt theo họ tên: tên cộng chữ đầu của họ và tên đệm
 * ("Phạm Thị Diễm Thúy" → "thuyptd"), hoặc chỉ chữ đầu của họ ("thuyp").
 */
export function accountNameCandidates(fullName: string): string[] {
  const parts = foldName(fullName).replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
  if (parts.length < 2) return parts.length === 1 ? [parts[0]!] : [];
  const given = parts[parts.length - 1]!;
  const rest = parts.slice(0, -1);
  return [...new Set([`${given}${rest.map((part) => part[0]).join('')}`, `${given}${rest[0]![0]}`])];
}

/**
 * Gợi ý ghép tài khoản NAS với nhân sự ERP: trùng thư điện tử, trùng phần trước "@",
 * hoặc khớp quy tắc đặt tên theo họ tên. Chỉ ghép khi khớp đúng một người và người đó
 * chỉ khớp một tài khoản; còn lại để quản trị ghép tay.
 */
export function suggestLinks(
  accounts: readonly Pick<NasAccountRecord, 'name' | 'email'>[],
  people: readonly { readonly userId: string; readonly name: string; readonly email?: string }[],
): Map<string, string> {
  const byKey = new Map<string, Set<string>>();
  const add = (key: string | undefined, userId: string) => {
    if (!key) return;
    const set = byKey.get(key) ?? new Set<string>();
    set.add(userId);
    byKey.set(key, set);
  };
  for (const person of people) {
    const email = person.email?.trim().toLowerCase();
    add(email ? `email:${email}` : undefined, person.userId);
    add(email ? `name:${email.split('@')[0]}` : undefined, person.userId);
    for (const candidate of accountNameCandidates(person.name)) add(`name:${candidate}`, person.userId);
  }
  const proposals = new Map<string, string>();
  for (const account of accounts) {
    const keys = [account.email ? `email:${account.email.trim().toLowerCase()}` : undefined, `name:${account.name.toLowerCase()}`];
    for (const key of keys) {
      const hits = key ? byKey.get(key) : undefined;
      if (hits?.size === 1) {
        proposals.set(account.name, [...hits][0]!);
        break;
      }
    }
  }
  // Một nhân sự khớp nhiều tài khoản thì không tự ghép tài khoản nào.
  const counts = new Map<string, number>();
  for (const userId of proposals.values()) counts.set(userId, (counts.get(userId) ?? 0) + 1);
  for (const [name, userId] of proposals) if ((counts.get(userId) ?? 0) > 1) proposals.delete(name);
  return proposals;
}

/**
 * Đường dẫn trong một thư mục chia sẻ, dạng "a/b/c" (trống là gốc). Từ chối "..", ".",
 * "\" và ký tự rỗng để không thoát ra ngoài thư mục chia sẻ đã ánh xạ.
 */
export function normalizeNasPath(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 4000) throw new SharedValidationError('Đường dẫn không hợp lệ.');
  if (value.includes('\\') || value.includes('\0')) throw new SharedValidationError('Đường dẫn không hợp lệ.');
  const segments = value.split('/').filter((segment) => segment !== '');
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.length > 255) {
      throw new SharedValidationError('Đường dẫn không hợp lệ.');
    }
  }
  return segments.join('/');
}

/** Tên tệp hay thư mục mới: tránh ký tự mà NAS (SMB, Windows) không nhận. */
export function nasEntryName(value: unknown, label = 'Tên'): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new SharedValidationError(`${label} không được trống.`);
  if (name.length > 255) throw new SharedValidationError(`${label} dài quá 255 ký tự.`);
  if (name === '.' || name === '..' || /[\\/:*?"<>|\0]/.test(name) || /[. ]$/.test(name)) {
    throw new SharedValidationError(`${label} không được chứa \\ / : * ? " < > | và không kết thúc bằng dấu chấm hay khoảng trắng.`);
  }
  return name;
}

/** Đường dẫn đầy đủ trên NAS: "/SAVINA/a/b". */
export function nasFullPath(share: string, relative: string): string {
  return relative ? `/${share}/${relative}` : `/${share}`;
}

/** Mục hệ thống của NAS không hiện cho người dùng (thư mục chỉ mục, ảnh chụp nhanh). */
export function hiddenNasEntry(name: string): boolean {
  return name.startsWith('@') || name === '#snapshot';
}
