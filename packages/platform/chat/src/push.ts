/**
 * Phần gửi thông báo đẩy (Web Push và Firebase Cloud Messaging) cho worker. Tách khỏi entry chính để core API không
 * phải nạp thư viện `web-push` hay `firebase-admin` (API chỉ lưu đăng ký thiết bị, không gửi).
 */
export * from './lib/push-dispatcher.js';
export * from './lib/fcm-config.js';
export * from './lib/fcm-dispatcher.js';
export { CORE_CHAT_MESSAGE_EVENT } from '@enterprise-platform/contracts-chat';
