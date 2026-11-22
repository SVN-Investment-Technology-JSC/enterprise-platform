import { healthController } from '@enterprise-platform/platform-module-access';

/**
 * Probed by Docker and the gateway; the access guard lets these through unauthenticated.
 * `live` chỉ báo tiến trình còn sống; `ready` kiểm DB platform thật, lỗi thì 503 (ISS-OPS-014).
 */
export const HealthController = healthController('shared-api');
