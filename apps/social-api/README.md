# social-api

API của phân hệ **Mạng nội bộ** (`/api/social`, cổng 3343; giao diện `social-web` ở `/modules/social`,
cổng 3011). Pha đầu là bảng tin công ty: bài viết, chuyên mục, ghim, phản ứng, bình luận, tệp đính kèm.

- Bảng: `social_schema` trong DB tenant (`migrations/tenant/social`).
- Tệp: presigned URL qua MinIO/S3.
- Quyền phân hệ: `social.read`, `social.post.write` (đăng bài, bình luận, phản ứng; sửa/xoá nội dung của mình),
  `social.post.moderate` (sửa/xoá nội dung người khác, ghim, @all), `social.manage` (quản lý chuyên mục).
- Guard: `src/app/social-access.guard.ts` dựa trên `ModuleAccess`; chỉ dựng actor, quyết định từng thao tác nằm
  ở tầng application của `packages/modules/social`.

## Chạy local

```bash
pnpm dev:social
```
