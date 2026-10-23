/**
 * Phần gửi thông báo đẩy (Web Push) của chat, cho worker. Tách khỏi entry chính để core API không phải nạp thư viện
 * `web-push` (API chỉ lưu đăng ký, không gửi).
 */
export * from './lib/push-dispatcher.js';
export { CORE_CHAT_MESSAGE_EVENT } from '@enterprise-platform/contracts-chat';
