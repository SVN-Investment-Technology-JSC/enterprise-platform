/**
 * Ép ô nhập bên trong `SearchableSelect` về cùng cỡ chữ (14px) và bo góc (6px) với `Input`. Component dùng chung cố định
 * 12.5px bằng `!important`, nên cần `!` của Tailwind (nằm trong layer, thắng `!important` không layer) thay vì sửa shared-ui.
 */
export const SELECT_CLASS = '[&_input]:text-sm! [&_input]:rounded-md!';
