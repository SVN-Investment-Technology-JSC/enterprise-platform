import {
  brandKeyOf,
  normalizeHex,
  slugify,
  type BrandPalette,
  type IconDocument,
  type PaletteToken,
} from '@enterprise-platform/shared-brand-icon';

/** Khớp giới hạn của normalizePalette: quá mức này phần dư bị bỏ khi nạp lại. */
export const MAX_TOKENS = 64;
export const KEY_MAX = 32;
export const LABEL_MAX = 40;

export type PaletteEdit = { readonly ok: true; readonly palette: BrandPalette } | { readonly ok: false; readonly error: string };

const fail = (error: string): PaletteEdit => ({ ok: false, error });
const done = (tokens: readonly PaletteToken[]): PaletteEdit => ({ ok: true, palette: { tokens } });

/** Khoá slug từ tên màu: "Xanh Sapphire" thành "xanh-sapphire". Tên không có chữ hay số thì dùng "mau". */
export function keyFromLabel(label: string): string {
  const slug = slugify(label).slice(0, KEY_MAX).replace(/-+$/g, '');
  const meaningful = slug !== 'icon' || /icon/i.test(label);
  return slug && meaningful && /^[a-z0-9]/.test(slug) ? slug : 'mau';
}

/** Thêm hậu tố -2, -3... cho tới khi không trùng khoá đã có. */
export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, KEY_MAX - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Số icon đang dùng mỗi màu thương hiệu (đếm icon, không đếm lớp; một icon dùng nhiều lần vẫn tính một). */
export function tokenUsage(docs: readonly IconDocument[]): ReadonlyMap<string, number> {
  const usage = new Map<string, number>();
  for (const doc of docs) {
    const keys = new Set<string>();
    for (const shape of doc.shapes) {
      for (const paint of [shape.fill, shape.stroke]) {
        const key = brandKeyOf(paint);
        if (key !== null) keys.add(key);
      }
    }
    for (const key of keys) usage.set(key, (usage.get(key) ?? 0) + 1);
  }
  return usage;
}

const cleanLabel = (label: string) => label.trim().slice(0, LABEL_MAX);

export function addToken(palette: BrandPalette, input: { label: string; hex: string }): PaletteEdit {
  const hex = normalizeHex(input.hex);
  if (!hex) return fail('Mã màu không hợp lệ (ví dụ #2563eb).');
  if (palette.tokens.length >= MAX_TOKENS) return fail(`Tối đa ${MAX_TOKENS} màu.`);
  const typed = cleanLabel(input.label);
  const key = uniqueKey(keyFromLabel(typed), new Set(palette.tokens.map((token) => token.key)));
  return done([...palette.tokens, { key, label: typed || hex, hex }]);
}

export function updateHex(palette: BrandPalette, key: string, value: string): PaletteEdit {
  const hex = normalizeHex(value);
  if (!hex) return fail('Mã màu không hợp lệ (ví dụ #2563eb).');
  return done(palette.tokens.map((token) => (token.key === key ? { ...token, hex } : token)));
}

/**
 * Đổi tên màu. Khoá chỉ đổi theo tên khi chưa icon nào dùng; màu đang được dùng giữ nguyên khoá
 * để icon không bị mất màu.
 */
export function renameToken(palette: BrandPalette, key: string, value: string, docs: readonly IconDocument[]): PaletteEdit {
  const label = cleanLabel(value);
  if (!label) return fail('Tên màu không được để trống.');
  const locked = (tokenUsage(docs).get(key) ?? 0) > 0;
  const others = new Set(palette.tokens.filter((token) => token.key !== key).map((token) => token.key));
  const nextKey = locked ? key : uniqueKey(keyFromLabel(label), others);
  return done(palette.tokens.map((token) => (token.key === key ? { ...token, key: nextKey, label } : token)));
}

export function removeToken(palette: BrandPalette, key: string): PaletteEdit {
  if (palette.tokens.length <= 1) return fail('Phải giữ ít nhất một màu.');
  return done(palette.tokens.filter((token) => token.key !== key));
}

/** Chuyển màu ở vị trí `from` tới vị trí `to` (kéo thả); vị trí ngoài khoảng thì giữ nguyên bảng màu. */
export function reorderTokens(palette: BrandPalette, from: number, to: number): BrandPalette {
  const size = palette.tokens.length;
  if (from === to || from < 0 || to < 0 || from >= size || to >= size) return palette;
  const tokens = [...palette.tokens];
  const [moved] = tokens.splice(from, 1);
  tokens.splice(to, 0, moved);
  return { tokens };
}

export function moveToken(palette: BrandPalette, key: string, delta: -1 | 1): BrandPalette {
  const index = palette.tokens.findIndex((token) => token.key === key);
  return index < 0 ? palette : reorderTokens(palette, index, index + delta);
}
