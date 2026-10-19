'use client';

import type {
  AssistantActionOutcome,
  AssistantActionRequest,
  AssistantActionResult,
} from '@enterprise-platform/contracts-assistant';
import { useEffect, useRef } from 'react';

/**
 * Sổ đăng ký thao tác Trợ lý của trang form nhúng.
 *
 * Khung chat đặt trang form nhúng của phân hệ (`/modules/<phân hệ>/assistant/form`) trong một card. Trang dựng
 * `AssistantFormHost`; component form của phân hệ gọi `useAssistantAction(key, open)`, host giao bản nháp nhận từ card
 * cho đúng hàm `open` đó. Form hiện ngay trong card (xem `useAssistantEmbed`), trang ERP phía sau không chuyển trang.
 *
 * Bản nháp chỉ là giá trị ban đầu của form. Form kiểm dữ liệu và lưu bằng API của phân hệ như khi người dùng tự nhập.
 */

export interface AssistantActionContext {
  readonly requestId: string;
  readonly variant?: string;
  /** Báo kết quả về khung chat: `saved` kèm mã, tên, link bản ghi; `cancelled` khi đóng form. */
  report(outcome: AssistantActionOutcome, detail?: { id?: string; label?: string; href?: string; message?: string }): void;
}

export type AssistantActionOpen<TDraft = Record<string, unknown>> = (
  draft: Partial<TDraft>,
  context: AssistantActionContext,
) => void;

type Handler = (request: AssistantActionRequest) => void;

const handlers = new Map<string, Handler>();
/** Lệnh đến trước khi component form đăng ký (trang còn đang tải). */
let pending: AssistantActionRequest | undefined;
let sink: ((result: AssistantActionResult) => void) | undefined;
const queued: AssistantActionResult[] = [];

function report(request: AssistantActionRequest, outcome: AssistantActionOutcome, detail = {}): void {
  const result: AssistantActionResult = { requestId: request.requestId, key: request.key, outcome, ...detail };
  if (sink) sink(result);
  else queued.push(result);
}

/** Trạng thái báo cáo của một lần mở form (một requestId), dùng chung cho mọi bản nháp gửi tiếp. */
interface ReportState {
  done: boolean;
}

function contextFor(request: AssistantActionRequest, state: ReportState): AssistantActionContext {
  return {
    requestId: request.requestId,
    // Biến thể theo bản nháp mới nhất: Trợ lý có thể đổi loại đơn, quy trình ở lần sửa tiếp.
    ...(request.variant ? { variant: request.variant } : {}),
    report: (outcome, detail) => {
      // Mỗi lần mở form chỉ báo một kết quả; cập nhật bản nháp sau đó không mở lại báo cáo.
      if (state.done) return;
      state.done = true;
      report(request, outcome, detail);
    },
  };
}

/** Nơi nhận kết quả (card trong khung chat); kết quả báo trước đó được gửi bù. */
export function setAssistantResultSink(next: ((result: AssistantActionResult) => void) | undefined): void {
  sink = next;
  if (next) for (const result of queued.splice(0)) next(result);
}

/** Đã có component form đăng ký thao tác `key` chưa. */
export function hasAssistantAction(key: string): boolean {
  return handlers.has(key);
}

/**
 * Giao một lệnh từ card cho component form đã đăng ký thao tác đó; chưa đăng ký (trang còn tải) thì giữ lại, component
 * đăng ký xong sẽ nhận. Lệnh cùng `requestId` gửi lại sau là bản nháp sửa tiếp cho form đang mở.
 */
export function deliverAssistantAction(request: AssistantActionRequest): void {
  const handler = handlers.get(request.key);
  if (handler) handler(request);
  else pending = request;
}

/** Báo `unavailable` cho lệnh không có component nào nhận (thao tác không thuộc trang này). */
export function rejectAssistantAction(request: AssistantActionRequest, message?: string): void {
  if (pending?.requestId === request.requestId) pending = undefined;
  report(request, 'unavailable', message ? { message } : {});
}

/**
 * Đăng ký thao tác `key`. `open` nhận bản nháp (theo tên trường của request API) và mở form của phân hệ với giá trị ban
 * đầu đó. Gọi lại với cùng `context.requestId` khi người dùng sửa tiếp trong chat: form đang mở chỉ cập nhật các ô có
 * trong bản nháp.
 */
export function useAssistantAction<TDraft = Record<string, unknown>>(
  key: string,
  open: AssistantActionOpen<TDraft>,
): void {
  const ref = useRef(open);
  ref.current = open;
  useEffect(() => {
    const states = new Map<string, ReportState>();
    const handler: Handler = (request) => {
      let state = states.get(request.requestId);
      if (!state) {
        state = { done: false };
        states.set(request.requestId, state);
      }
      ref.current(request.draft as Partial<TDraft>, contextFor(request, state));
    };
    handlers.set(key, handler);
    if (pending?.key === key) {
      const request = pending;
      pending = undefined;
      handler(request);
    }
    return () => {
      if (handlers.get(key) === handler) handlers.delete(key);
    };
  }, [key]);
}
