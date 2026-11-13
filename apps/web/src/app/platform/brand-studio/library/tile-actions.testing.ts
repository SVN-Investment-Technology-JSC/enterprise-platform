import { fireEvent, screen, within } from '@testing-library/react';

/** Mở menu "⋯" của một ô icon (menu mở khi nhấn chuột xuống, nên gửi đủ chuỗi sự kiện của một lần bấm). */
export function openTileMenu(tile: HTMLElement): void {
  const trigger = within(tile).getByRole('button', { name: /^Thao tác với / });
  fireEvent.pointerDown(trigger);
  fireEvent.mouseDown(trigger);
  fireEvent.pointerUp(trigger);
  fireEvent.mouseUp(trigger);
  fireEvent.click(trigger);
}

/** Mở menu của ô rồi chọn một mục theo tên. */
export async function chooseTileAction(tile: HTMLElement, name: string): Promise<void> {
  openTileMenu(tile);
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

/** Bấm nút trong hộp thoại xác nhận (Xoá hoặc Đặt lại) vừa hiện ra. */
export async function confirmDialog(name: string): Promise<void> {
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name }));
}
