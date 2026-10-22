import type { SocialPost } from '@enterprise-platform/contracts-social';
import type { SocialActor } from '../social-actor.js';
import type { ExtendedPostRow } from './post-read-model.js';

/**
 * Dựng `SocialPost` đầy đủ (tác giả, chuyên mục, nhóm, tệp, phản ứng, bình chọn, xác nhận đã đọc,
 * đã lưu, `capabilities`) từ các dòng bài. BE-1 hiện thực (sở hữu `social-views.ts`); BE-2 và BE-3
 * chỉ truyền dòng bài vào, không tự dựng `SocialPost`.
 *
 * Giữ nguyên thứ tự `rows`. Không kiểm quyền nhìn thấy: người gọi đã lọc `rows` theo
 * `post-visibility.port.ts`.
 */
export const POST_VIEW_ASSEMBLER = Symbol('SOCIAL_POST_VIEW_ASSEMBLER');

export interface PostViewAssembler {
  assemble(actor: SocialActor, rows: readonly ExtendedPostRow[]): Promise<SocialPost[]>;
}
