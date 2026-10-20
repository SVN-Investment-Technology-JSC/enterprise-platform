import type { FillRule, LineCap, LineJoin } from '@enterprise-platform/shared-brand-icon';

/** Biểu tượng nhỏ minh hoạ đầu nét: hai vạch mảnh đánh dấu điểm đầu/cuối để thấy rõ phần nét nhô ra. */
export function CapIcon({ kind }: { kind: LineCap }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M5 2.5v11M11 2.5v11" strokeWidth="0.75" opacity="0.45" />
      <path d="M5 8h6" strokeWidth="5" strokeLinecap={kind} />
    </svg>
  );
}

/** Biểu tượng góc nối: một khúc gấp dày, đỉnh thay đổi theo kiểu nối. */
export function JoinIcon({ kind }: { kind: LineJoin }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M3 13 8 4l5 9" strokeWidth="3" strokeLinejoin={kind} strokeLinecap="butt" />
    </svg>
  );
}

/** Hai hình vuông chồng nhau: "nonzero" tô cả phần chồng, "evenodd" khoét lỗ ở phần chồng. */
export function FillRuleIcon({ kind }: { kind: FillRule }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 2h8v8H2zM6 6h8v8H6z" fill="currentColor" fillRule={kind} />
    </svg>
  );
}
