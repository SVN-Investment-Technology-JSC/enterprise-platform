/**
 * Phần không phụ thuộc Nest hay thư viện ngoài: kiểm biến môi trường lúc khởi động và nhịp tim tệp.
 * Migrator và worker import từ `@enterprise-platform/platform-module-access/runtime`.
 */
export * from './lib/required-environment';
export * from './lib/heartbeat';
