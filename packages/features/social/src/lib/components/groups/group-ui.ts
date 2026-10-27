/**
 * Lớp Tailwind dùng chung cho các màn của nhóm. Màu, bo góc, cỡ chữ giữ đúng bộ
 * mà các màn khác của Mạng nội bộ đang dùng: thẻ bo `--ep-radius-xl`, viền slate-200, chữ phụ slate-500.
 */

/** Khung thẻ trắng có viền và bóng nhẹ. */
export const CARD = 'rounded-[var(--ep-radius-xl)] border border-slate-200 bg-white shadow-xs';
/** Một khối nội dung (thành viên, yêu cầu, báo cáo): thẻ + đệm + khoảng cách dọc. */
export const PANEL = `${CARD} flex flex-col gap-2 px-3 py-2.5`;
export const ROW_LIST = 'm-0 flex list-none flex-col p-0';
/** Dòng trong danh sách; đường kẻ giữa các dòng. */
export const ROW = 'flex gap-2.5 py-1.5 not-first:border-t not-first:border-slate-100';
export const ROW_TITLE = 'text-[13px] leading-snug font-semibold text-slate-900 [overflow-wrap:anywhere]';
export const ROW_META = 'text-xs leading-snug text-slate-500';
export const ROW_TEXT = 'flex min-w-0 flex-1 flex-col';
export const EMPTY_LINE = 'm-0 py-2 text-[12.5px] text-slate-500';
export const SKELETON = 'animate-pulse rounded-lg bg-slate-100';
export const ALERT =
  'm-0 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700';
export const CONFIRM_TEXT = 'm-0 text-[13.5px] leading-relaxed text-slate-700';
/** Đoạn lý do / lời nhắn dưới tên người trong danh sách. */
export const REASON = 'm-0 mt-0.5 text-[12.5px] leading-snug text-slate-600 [overflow-wrap:anywhere]';
/** Tiêu đề nhỏ của thẻ bên phải. */
export const SIDE_TITLE = 'm-0 text-[13.5px] font-bold text-slate-900';
/** Cùng cỡ với các ô trong hộp thoại. */
export const CONTROL = 'h-[38px] rounded-md px-3 text-[13.5px]!';
/** Chip lọc dạng viên thuốc, dùng cho cả liên kết và nút (`data-active`). */
export const FILTER_CHIP =
  'inline-flex h-[26px] cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white px-[11px] text-[12.5px] font-semibold text-slate-600 no-underline transition-colors hover:border-amber-400 data-[active=true]:border-amber-400 data-[active=true]:bg-amber-300 data-[active=true]:text-zinc-900';
/** Huy hiệu số nhỏ (số yêu cầu chờ duyệt…). */
export const BADGE = 'rounded-full bg-amber-300 px-1.5 text-[10.5px] leading-4 font-bold text-zinc-900';
export const ROLE_ADMIN = 'inline-flex items-center rounded-full bg-amber-100 px-[7px] py-px text-[11px] font-bold whitespace-nowrap text-amber-800';
export const ROLE_MEMBER = 'inline-flex items-center rounded-full bg-gray-100 px-[7px] py-px text-[11px] font-bold whitespace-nowrap text-slate-600';
