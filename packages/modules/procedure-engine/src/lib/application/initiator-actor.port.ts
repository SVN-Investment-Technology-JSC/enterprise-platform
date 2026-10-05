import type { ProcedureActor } from '../domain/procedure-authorization.js';

export const INITIATOR_ACTOR_RESOLVER = Symbol('INITIATOR_ACTOR_RESOLVER');

/**
 * Dựng ngữ cảnh phân quyền (đơn vị, chức danh) của người khởi tạo hồ sơ do dịch
 * vụ khác mở, để biết người đó có khớp phân công S của bước đầu hay không.
 *
 * Dữ liệu tổ chức thuộc Core; chỉ đọc qua API. Trả null khi không có thành viên
 * tương ứng với người dùng.
 */
export interface InitiatorActorResolver {
  resolve(
    tenantId: string,
    userId: string,
    displayName?: string,
  ): Promise<ProcedureActor | null>;
}
