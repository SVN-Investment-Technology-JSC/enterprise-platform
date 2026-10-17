'use client';

import type {
  AssistantActionOutcome,
  AssistantActionRequest,
  AssistantActionResult,
} from '@enterprise-platform/contracts-assistant';
import { useEffect, useRef } from 'react';

/**
 * Sổ đăng ký thao tác Trợ lý của trang đang mở.
 *
 * Màn hình có form gọi `useAssistantAction(key, open)`; khung ERP (AssistantLauncher) nhận lệnh từ khung chat và gọi
 * đúng hàm `open` đó với bản nháp. Màn hình chưa mở thì bản nháp được cất vào sessionStorage của tab (dùng một lần,
 * hết hạn sau 5 phút) rồi chuyển tới trang của thao tác; màn hình đăng ký xong sẽ nhận lại.
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

const HANDOFF_KEY = 'savina-assistant:handoff';
const HANDOFF_TTL_MS = 5 * 60_000;

const handlers = new Map<string, Handler>();
/** Lệnh đã kiểm (cùng người dùng, còn hạn) đang chờ màn hình đăng ký. */
let pending: AssistantActionRequest | undefined;
let sink: ((result: AssistantActionResult) => void) | undefined;
const queued: AssistantActionResult[] = [];

export interface AssistantHandoff {
  readonly request: AssistantActionRequest;
  readonly userId: string;
  readonly expiresAt: number;
}

function report(request: AssistantActionRequest, outcome: AssistantActionOutcome, detail = {}): void {
  const result: AssistantActionResult = { requestId: request.requestId, key: request.key, outcome, ...detail };
  if (sink) sink(result);
  else queued.push(result);
}

function contextFor(request: AssistantActionRequest): AssistantActionContext {
  let done = false;
  return {
    requestId: request.requestId,
    ...(request.variant ? { variant: request.variant } : {}),
    report: (outcome, detail) => {
      // Mỗi lần mở form chỉ báo một kết quả; cập nhật bản nháp sau đó không mở lại báo cáo.
      if (done) return;
      done = true;
      report(request, outcome, detail);
    },
  };
}

/** Khung ERP đặt nơi nhận kết quả (khung chat); kết quả báo trước đó được gửi bù. */
export function setAssistantResultSink(next: ((result: AssistantActionResult) => void) | undefined): void {
  sink = next;
  if (next) for (const result of queued.splice(0)) next(result);
}

export function readAssistantHandoff(): AssistantHandoff | undefined {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return undefined;
    sessionStorage.removeItem(HANDOFF_KEY);
    const handoff = JSON.parse(raw) as AssistantHandoff;
    return handoff.expiresAt > Date.now() ? handoff : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Chạy một lệnh từ khung chat.
 * - `handled`: màn hình đang mở có thao tác này, form đã mở (hoặc cập nhật).
 * - `navigating`: đã cất bản nháp và chuyển tới trang của thao tác.
 * - `unavailable`: không có màn hình nào nhận và lệnh không kèm trang.
 */
export function dispatchAssistantAction(
  request: AssistantActionRequest,
  userId: string | undefined,
): 'handled' | 'navigating' | 'unavailable' {
  const handler = handlers.get(request.key);
  if (handler) {
    handler(request);
    return 'handled';
  }
  if (!request.page || !userId) {
    report(request, 'unavailable');
    return 'unavailable';
  }
  try {
    const handoff: AssistantHandoff = { request, userId, expiresAt: Date.now() + HANDOFF_TTL_MS };
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    report(request, 'unavailable', { message: 'Trình duyệt không cho lưu tạm bản nháp.' });
    return 'unavailable';
  }
  const target = new URL(request.page, window.location.origin);
  const samePage = target.pathname === window.location.pathname && target.search === window.location.search;
  window.location.assign(target.pathname + target.search + target.hash);
  // Chỉ đổi hash thì trình duyệt không tải lại trang, màn hình không đăng ký lại: tải lại để nhận bản nháp.
  if (samePage) window.location.reload();
  return 'navigating';
}

/** Lệnh từ trang trước (đã kiểm cùng người dùng); giao cho màn hình đã đăng ký, hoặc giữ chờ màn hình đăng ký. */
export function resumeAssistantAction(request: AssistantActionRequest): void {
  const handler = handlers.get(request.key);
  if (handler) handler(request);
  else pending = request;
}

/**
 * Đăng ký thao tác `key` cho màn hình đang mở. `open` nhận bản nháp (theo tên trường của request API) và mở form của
 * phân hệ với giá trị ban đầu đó. Gọi lại với cùng `context.requestId` khi người dùng sửa tiếp trong chat: form đang
 * mở chỉ cập nhật các ô có trong bản nháp.
 */
export function useAssistantAction<TDraft = Record<string, unknown>>(
  key: string,
  open: AssistantActionOpen<TDraft>,
): void {
  const ref = useRef(open);
  ref.current = open;
  useEffect(() => {
    const contexts = new Map<string, AssistantActionContext>();
    const handler: Handler = (request) => {
      let context = contexts.get(request.requestId);
      if (!context) {
        context = contextFor(request);
        contexts.set(request.requestId, context);
      }
      ref.current(request.draft as Partial<TDraft>, context);
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
