import { healthController } from '@enterprise-platform/platform-module-access';

/** `GET health/live`, `GET health/ready`: `ready` kiểm DB platform thật, lỗi thì 503 (ISS-OPS-014). */
export const AppController = healthController('maintenance-api');
