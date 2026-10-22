/**
 * Phần danh tính mà luật nghiệp vụ cần. `SocialActor` của tầng application
 * mở rộng kiểu này.
 */
export interface SocialPrincipal {
  readonly userId: string;
  /** Quản trị viên tenant: có mọi quyền của phân hệ. */
  readonly isTenantAdmin: boolean;
  /** `social.read` */
  readonly canRead: boolean;
  /** `social.post.write` */
  readonly canWrite: boolean;
  /** `social.post.moderate` */
  readonly canModerate: boolean;
  /** `social.manage` */
  readonly canManage: boolean;
}

export function mayRead(actor: SocialPrincipal): boolean {
  return actor.isTenantAdmin || actor.canRead || actor.canWrite || actor.canModerate || actor.canManage;
}

/** Đăng bài, bình luận, phản ứng. */
export function mayWrite(actor: SocialPrincipal): boolean {
  return actor.isTenantAdmin || actor.canWrite || actor.canModerate;
}

/** Sửa/xoá nội dung người khác, ghim, @all. */
export function mayModerate(actor: SocialPrincipal): boolean {
  return actor.isTenantAdmin || actor.canModerate;
}

export function mayManage(actor: SocialPrincipal): boolean {
  return actor.isTenantAdmin || actor.canManage;
}

/** Sửa/xoá bài hoặc bình luận: của mình (cần quyền viết) hoặc có quyền kiểm duyệt. */
export function mayEditContent(actor: SocialPrincipal, authorId: string): boolean {
  if (mayModerate(actor)) return true;
  return authorId === actor.userId && mayWrite(actor);
}

export function mayPinPost(actor: SocialPrincipal): boolean {
  return mayModerate(actor);
}

export function mayCommentOnPost(actor: SocialPrincipal): boolean {
  return mayWrite(actor);
}
