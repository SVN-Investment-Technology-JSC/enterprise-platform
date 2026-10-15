import type { ReactNode } from 'react';

/** Số công kèm chữ (1P, 1L, 1CT): phần chữ là số mũ để số công đọc rõ; chuỗi khác giữ nguyên. */
export function UnitText({ text }: { text: string }): ReactNode {
  const m = /^(\d+(?:[.,]\d+)?)([A-Za-z]+)$/.exec(text);
  if (!m) return text;
  return (
    <>
      {m[1]}
      <sup className="ml-px text-[0.65em] font-bold leading-none">{m[2]}</sup>
    </>
  );
}
