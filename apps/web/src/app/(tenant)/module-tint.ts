/**
 * Màu ô viết tắt của từng phân hệ, dùng chung cho thanh bên và các trang của
 * Tenant Portal để một module luôn mang cùng một màu.
 */
const MODULE_TINTS: Record<string, string> = {
  'procedure-engine': 'bg-violet-100 text-violet-700',
  hrm: 'bg-cyan-100 text-cyan-700',
  inventory: 'bg-blue-100 text-blue-800',
  maintenance: 'bg-amber-100 text-amber-700',
  workspace: 'bg-slate-100 text-slate-700',
  assistant: 'bg-yellow-100 text-yellow-800',
};

export function moduleTint(key: string): string {
  return MODULE_TINTS[key] ?? 'bg-slate-100 text-slate-700';
}

/** Chữ viết tắt trong ô: mã ngắn của danh mục (như "PE"), thiếu thì lấy đầu key. */
export function moduleAbbr(module: { readonly key: string; readonly icon?: string | null }): string {
  return (module.icon || module.key.slice(0, 2)).toUpperCase();
}
