'use client';

import { useEffect, useRef } from 'react';
import { keyToCommand, type EditorCommand } from './interactions';
import type { EditorTool } from './tool';

export interface EditorKeyboardOptions {
  /** Tắt khi có hộp thoại mở hoặc khi trình thiết kế không ở trạng thái làm việc. */
  readonly enabled: boolean;
  readonly tool: EditorTool;
  readonly onCommand: (command: EditorCommand, event: KeyboardEvent) => void;
  /** Giữ Space để kéo nền (như công cụ bàn tay). */
  readonly onSpace: (pressed: boolean) => void;
}

const TEXT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const BUTTON_SELECTOR = 'button,[role="button"]';
const WIDGET_SELECTOR =
  '[role="dialog"],[role="alertdialog"],[role="listbox"],[role="menu"],[role="combobox"],[role="slider"],[role="spinbutton"],[role="textbox"]';
const OWN_KEYS_SELECTOR = `${WIDGET_SELECTOR},${BUTTON_SELECTOR}`;

/**
 * Đang gõ chữ hoặc đang thao tác trong một thành phần tự xử lý phím (hộp thoại, danh sách chọn, nút...).
 * Nút tự xử lý Space và Enter (bấm nút), nên phím Space không được bắt để kéo nền khi nút đang có tiêu điểm.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TEXT_TAGS.has(target.tagName) || target.isContentEditable) return true;
  return target.closest(OWN_KEYS_SELECTOR) !== null;
}

/** Nút (hoặc phần tử đóng vai nút) không nằm trong thành phần nào khác tự xử lý phím. */
function isPlainButtonTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(BUTTON_SELECTOR) !== null &&
    target.closest(WIDGET_SELECTOR) === null
  );
}

/**
 * Nút chỉ giữ riêng Space và Enter; mọi phím khác (Ctrl+Z, V, R, Delete...) vẫn là phím tắt của trình thiết kế,
 * để bấm một nút trên thanh công cụ xong không làm mất phím tắt.
 */
function ownsKey(target: EventTarget | null, key: string): boolean {
  if (!isTypingTarget(target)) return false;
  return !isPlainButtonTarget(target) || key === ' ' || key === 'Enter';
}

/**
 * Bắt phím tắt của trình thiết kế trên cả cửa sổ và đổi thành lệnh (`keyToCommand`).
 * Không bắt phím khi đang gõ trong ô nhập; riêng Ctrl+S vẫn lưu được từ ô nhập (ô nhập được rời focus trước để chốt giá trị).
 */
export function useEditorKeyboard(options: EditorKeyboardOptions): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = latest.current;
      if (!current.enabled || event.isComposing || event.defaultPrevented) return;
      const ctrl = event.ctrlKey || event.metaKey;

      if (ownsKey(event.target, event.key)) {
        if (ctrl && !event.altKey && event.key.toLowerCase() === 's' && event.target instanceof HTMLElement && !event.target.closest('[role="dialog"],[role="alertdialog"]')) {
          event.preventDefault();
          event.target.blur();
          window.setTimeout(() => latest.current.onCommand({ type: 'save' }, event), 0);
        }
        return;
      }

      if (event.key === ' ' && !ctrl && !event.altKey) {
        event.preventDefault();
        if (!event.repeat) current.onSpace(true);
        return;
      }

      const command = keyToCommand({ key: event.key, ctrl, shift: event.shiftKey, alt: event.altKey }, { tool: current.tool });
      if (!command) return;
      event.preventDefault();
      current.onCommand(command, event);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') latest.current.onSpace(false);
    };
    const onBlur = () => latest.current.onSpace(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
