# Mạng nội bộ P2 + P3: hợp đồng API và phân công

Tài liệu này là hợp đồng giữa 3 agent backend (BE-1, BE-2, BE-3) và 4 agent frontend (FE-A..D) làm song song.
Hợp đồng gồm: kiểu trong `packages/contracts/social`, migration `0002`/`0003`, cổng (port) trong
`packages/modules/social/src/lib/application/ports/`, và bảng route dưới đây. Cần đổi hợp đồng thì báo người điều phối,
đừng tự sửa.

Tiền tố mọi route: `/v1` (qua `/api/social/v1` ở trình duyệt). Lỗi dùng khung chung `{ statusCode, code, message }`,
`message` tiếng Việt có dấu.

## 1. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Quyền | Mọi thành viên tenant dùng Mạng nội bộ, không cần `social.read/write`. Chỉ `social.post.moderate` (kiểm duyệt) và `social.manage` (cài đặt, chuyên mục) là quyền, quản trị tenant có cả hai. Không thêm action vào `TENANT_PERMISSION_ACTIONS`. |
| Moderator | `social.post.moderate` hoặc quản trị tenant. |
| Quản trị nhóm | Vai trò `admin` của nhóm. Quản trị tenant và `social.manage` là "quản trị toàn hệ thống": thấy và quản lý mọi nhóm, kể cả riêng tư. `social.post.moderate` KHÔNG cho vào nhóm riêng tư. |
| Tường công ty | Bài `group_id IS NULL`. `GET /feed` mặc định `scope=wall`, nên P1 chạy y nguyên. |
| Nhóm riêng tư | Không xuất hiện trong danh sách của người ngoài. Người có đường dẫn trực tiếp nhận bản xem trước (`access=preview`: tên, biểu tượng, màu) để gửi yêu cầu tham gia. Nhóm không tồn tại hoặc đã xoá: 404. |
| Bài nhóm | Không có chuyên mục (`topicId`). Đăng vào nhóm: thành viên. Bài `announcement` trong nhóm: admin nhóm. Ghim bài nhóm: admin nhóm. Không cần duyệt (cài đặt duyệt chỉ áp cho Tường công ty). Xoá bài nhóm: tác giả, admin nhóm, moderator (nhóm công khai). |
| Bình luận, phản ứng | Mọi người thấy được bài đều bình luận/phản ứng được (nhóm công khai không đòi là thành viên). Nhóm riêng tư: chỉ người thấy bài. |
| Bình chọn | Một bình chọn mỗi bài, 2–10 lựa chọn, chọn một hoặc nhiều. Ẩn danh: không API nào trả người bỏ phiếu, kể cả cho tác giả. Công khai: ai thấy bài cũng xem được ai chọn gì. Số phiếu luôn xem được. Đổi/bỏ phiếu khi chưa đóng. Sau khi có phiếu đầu tiên, lựa chọn cố định (chỉ đổi được hạn đóng). Đóng sớm: tác giả hoặc moderator. |
| Xác nhận đã đọc | Đặt khi tạo bài (hoặc bật lúc sửa khi chưa ai xác nhận; không tắt được khi đã có người). Phạm vi: bài Tường công ty là toàn bộ người đang làm việc (`PeopleProfilePort.listActiveUserIds`), bài nhóm là thành viên (`GroupMembershipPort.listMemberIds`); trừ tác giả. Xem danh sách: tác giả, moderator, admin nhóm. |
| Duyệt bài | Cài đặt `wallRequireApproval` (mặc định tắt). Bật thì bài Tường công ty của người KHÔNG phải moderator vào `pending`. Moderator đăng thẳng. Duyệt/từ chối bởi moderator, từ chối phải có lý do. Tác giả sửa bài bị từ chối thì bài gửi duyệt lại (lại thành `pending`, hoặc `published` nếu cài đặt đã tắt). |
| Hẹn giờ | `scheduledAt` tương lai (cách ≥ 60 giây, ≤ 365 ngày). Job quét bài `scheduled` đến hạn: đăng (hoặc `pending` nếu Tường công ty cần duyệt và tác giả không phải moderator). Khi đăng, `published_at = now()`. "Huỷ hẹn" = xoá bài (`DELETE /posts/:id`). Sửa giờ: `PATCH` với `scheduledAt`. Đăng ngay: `POST /posts/:id/publish-now`. |
| Bài tự sinh | Cột `kind='activity'` trong DB, kèm `activity_type`, `activity_payload`. Trong API `SocialPost.kind` luôn là `post` và có thêm `activity` (giữ kiểu P1 không vỡ). Không sửa được, bình luận/phản ứng/xoá được. |
| Tìm kiếm | KHÔNG dùng extension `unaccent`/`pg_trgm` (không migration nào cài, cần quyền cài). Dùng hàm SQL `social_schema.fold_text()` (bỏ dấu tiếng Việt + chữ thường, cùng bảng ký tự với `contracts-realtime`) và cột sinh `posts.search_text`. Bài: `to_tsvector('simple', search_text) @@ to_tsquery('simple', 'từ1:* & từ2:*')` (có chỉ mục GIN). Nhóm: `groups.search_text LIKE`. Người: `OrganizationDirectory.search` có sẵn. Từ khoá phải gập bằng đúng hàm gập của contracts-realtime (`normalizeSearchText`) rồi chỉ giữ `[a-z0-9]` trước khi dựng tsquery. Sắp xếp mới nhất trước, không xếp hạng. |
| Sinh nhật | Lấy từ HRM/Core qua `PeopleProfilePort`, không lưu. Chỉ ngày/tháng, không năm. |
| Realtime | Một sự kiện socket `social.feed.changed` mang `SocialFeedSignal` (chỉ id). Sinh từ sự kiện outbox, không gọi trực tiếp. Bài Tường công ty: gửi mọi phiên của tenant. Bài nhóm: chỉ thành viên nhóm (không lộ nhóm riêng tư). |

## 2. Máy trạng thái bài

```
                      tạo (không hẹn giờ, không cần duyệt)
        ┌──────────────────────────────────────────────────► published ◄──────────────┐
        │                                                       │  ▲                   │
 (tạo) ─┤  tạo, Tường công ty cần duyệt, tác giả không phải     │  │ duyệt (moderator) │
        │  moderator                                            │  │                   │
        ├──────────────────────────────► pending ───────────────┼──┘                   │
        │                                   │ từ chối (lý do)   │                      │
        │                                   ▼                   │ xoá                  │
        │                               rejected ──sửa──► pending/published            │
        │  tạo có scheduledAt                                   ▼                      │
        └──────────────► scheduled ── đến giờ / publish-now ──► published | pending ───┘
                             │
                             └── xoá (huỷ hẹn) ──► deleted        mọi trạng thái ──xoá──► deleted
```

- `deleted` là xoá mềm (cột `deleted_at`); không có đường quay lại.
- Chuyển `scheduled`/`pending` → `published`: đặt `published_at = now()`, phát `social.post.published`
  (`origin: 'scheduled' | 'approved'`).
- Từ chối: đặt `moderated_by/at`, `reject_reason`; phát `social.post.moderated`.
- Bài `pending|scheduled|rejected` KHÔNG nằm trong bảng tin, tìm kiếm, đã lưu, trang cá nhân của người khác; chỉ ở `GET
  /me/posts` (tác giả), `GET /moderation/posts` (moderator) và `GET /posts/:id` (tác giả, moderator).
- Bài `pending/scheduled/rejected` không nhận phản ứng, bình luận, bình chọn, xác nhận đã đọc, không phát thông báo.

## 3. Luật nhìn thấy bài

Nguồn sự thật: `application/ports/post-visibility.port.ts` (hàm `canViewPostInScope`) và
`infrastructure/post-visibility-sql.ts` (`postVisibilitySql`, cùng luật dạng SQL). Có spec đối chiếu.

1. `deleted`: không ai thấy.
2. Bài thuộc nhóm: nhóm đã xoá thì không ai thấy; nhóm công khai ai cũng thấy; nhóm riêng tư chỉ thành viên và quản trị
   toàn hệ thống.
3. `published`: qua luật 2 là thấy.
4. `pending|scheduled|rejected`: tác giả và moderator, vẫn phải qua luật 2.

Mọi truy vấn trả bài, bình luận, phản ứng, bình chọn, xác nhận đã đọc, tìm kiếm cho người dùng phải áp luật này. Truy
vấn SQL nối `LEFT JOIN social_schema.groups g ON g.id = p.group_id` rồi AND mệnh đề của `postVisibilitySql`. Thao tác
trên bài không thấy được trả 404 `POST_NOT_FOUND` (không lộ sự tồn tại).

## 4. Bảng route

Quyền: **TV** = mọi thành viên tenant; **MOD** = moderator; **MNG** = `social.manage`/quản trị tenant;
**TG** = tác giả; **AG** = admin nhóm (hoặc quản trị toàn hệ thống). Mã lỗi chung: 400 `VALIDATION`, 403 `FORBIDDEN`,
404 `POST_NOT_FOUND`/`GROUP_NOT_FOUND`.

### BE-1: đường ghi bài (controller `social-publishing.controller.ts`)

| Method | Path | Request | Response | Quyền | Lỗi riêng |
|---|---|---|---|---|---|
| POST | `/posts` (mở rộng) | `CreateSocialPostRequest` (thêm `groupId`, `poll`, `requiresReadConfirmation`, `scheduledAt`) | `SocialPost` (`status` có thể `pending`/`scheduled`) | TV; `groupId`: thành viên nhóm; `kind=announcement`/`pinned`/`mentionsAll`: MOD (Tường công ty) hoặc AG (nhóm) | 400 poll sai, 400 `scheduledAt` ngoài khoảng, 403 `GROUP_NOT_MEMBER` |
| PATCH | `/posts/:id` (mở rộng) | `UpdateSocialPostRequest` | `SocialPost` | TG hoặc MOD | 409 `POLL_LOCKED` sửa lựa chọn khi có phiếu |
| DELETE | `/posts/:id` | không | 204 | TG, MOD, AG (bài nhóm) | |
| POST | `/posts/:id/publish-now` | không | `SocialPost` | TG, bài `scheduled` | 409 `POST_STATE` |
| POST | `/posts/:id/approve` | không | `SocialPost` | MOD, bài `pending` | 409 `POST_STATE` |
| POST | `/posts/:id/reject` | `RejectSocialPostRequest` | `SocialPost` | MOD, bài `pending` | 400 thiếu/quá dài lý do, 409 `POST_STATE` |
| GET | `/moderation/posts?cursor&limit` | | `SocialFeedPage` (bài `pending`, cũ nhất trước) | MOD | |
| GET | `/me/posts?status=pending\|scheduled\|rejected&cursor&limit` | `SocialMyPostsQuery` | `SocialFeedPage` | TV (bài của mình) | |
| GET | `/me/inbox` | | `SocialInboxCounts` | TV | |
| PUT | `/posts/:id/pin` (có sẵn) | `PinSocialPostRequest` | `SocialPost` | MOD, hoặc AG với bài nhóm | |
| PUT | `/posts/:id/bookmark` | `SetSocialBookmarkRequest` | `SocialBookmarkState` | TV (bài thấy được) | |
| GET | `/bookmarks?cursor&limit` | | `SocialFeedPage` (lưu gần nhất trước; bài không còn thấy được bị bỏ) | TV | |
| PUT | `/posts/:id/read-confirmation` | không (idempotent) | `SocialReadConfirmationSummary` | TV thuộc phạm vi, không phải tác giả | 400 `NOT_REQUIRED`, 403 ngoài phạm vi |
| GET | `/posts/:id/read-confirmations?filter=confirmed\|pending&cursor&limit` | | `SocialReadConfirmationPage` | TG, MOD, AG | 400 `NOT_REQUIRED` |
| PUT | `/posts/:id/poll/vote` | `SetSocialPollVoteRequest` | `SocialPoll` | TV thấy bài | 409 `POLL_CLOSED`, 400 lựa chọn lạ/nhiều hơn một |
| GET | `/posts/:id/poll/voters?optionId&cursor&limit` | | `SocialPollVoterPage` | TV thấy bài; ẩn danh: 403 `POLL_ANONYMOUS` | |
| POST | `/posts/:id/poll/close` | không | `SocialPoll` | TG, MOD | 409 `POLL_CLOSED` |
| GET | `/settings` | | `SocialSettings` | TV | |
| PATCH | `/settings` | `UpdateSocialSettingsRequest` | `SocialSettings` | MNG | |

BE-1 còn sở hữu phía service của phản ứng và bình luận (áp luật nhìn thấy, phát `reactionChanged`/`pollChanged`/
`postChanged`); route của chúng vẫn nằm ở `social.controller.ts`.

### BE-2: nhóm và đường đọc (controller `social-groups.controller.ts`, `social-feed.controller.ts`)

| Method | Path | Request | Response | Quyền | Lỗi riêng |
|---|---|---|---|---|---|
| GET | `/feed` (thay bản P1) | `SocialFeedQuery` (`topicId`, `kind`, `authorId`, `scope`, `groupId`) | `SocialFeedPage` | TV | |
| GET | `/posts` | như `/feed` | | TV | |
| GET | `/groups/:id/feed?cursor&limit&kind&authorId` | | `SocialFeedPage` | thành viên (nhóm riêng tư) / TV (công khai) | 404 nếu không thấy được |
| GET | `/groups?scope=mine\|all&query&cursor&limit` | `SocialGroupListQuery` | `SocialGroupPage` | TV (không liệt kê nhóm riêng tư cho người ngoài; quản trị toàn hệ thống thấy hết ở `all`) | |
| POST | `/groups` | `CreateSocialGroupRequest` | `SocialGroupDetail` | TV; người tạo thành `admin` | 409 `GROUP_NAME_TAKEN` |
| GET | `/groups/:id` | | `SocialGroupDetail` | TV (riêng tư, ngoài nhóm: `access=preview`) | |
| PATCH | `/groups/:id` | `UpdateSocialGroupRequest` | `SocialGroupDetail` | AG | 409 `GROUP_NAME_TAKEN` |
| DELETE | `/groups/:id` | | 204 (xoá mềm) | AG | |
| GET | `/groups/:id/members?role&query&cursor&limit` | `SocialGroupMemberQuery` | `SocialGroupMemberPage` | thành viên | |
| POST | `/groups/:id/members` | `AddSocialGroupMembersRequest` | `AddSocialGroupMembersResponse` | AG | |
| PATCH | `/groups/:id/members/:userId` | `UpdateSocialGroupMemberRequest` | `SocialGroupMember` | AG | 409 `GROUP_LAST_ADMIN` |
| DELETE | `/groups/:id/members/:userId` | | 204 | AG (gỡ người khác) | 409 `GROUP_LAST_ADMIN` |
| POST | `/groups/:id/join` | `JoinSocialGroupRequest` | `JoinSocialGroupResponse` | TV; công khai vào ngay, riêng tư tạo yêu cầu | 409 `GROUP_ALREADY_MEMBER`, `GROUP_JOIN_REQUEST_EXISTS` |
| POST | `/groups/:id/leave` | | 204 | thành viên | 409 `GROUP_LAST_ADMIN` |
| DELETE | `/groups/:id/join-request` | | 204 (huỷ yêu cầu của mình) | TV | 404 `GROUP_JOIN_REQUEST_NOT_FOUND` |
| GET | `/groups/:id/join-requests?cursor&limit` | | `SocialJoinRequestPage` | AG | |
| POST | `/groups/:id/join-requests/:requestId/approve` | | `SocialGroupMember` | AG | 404 `GROUP_JOIN_REQUEST_NOT_FOUND` |
| POST | `/groups/:id/join-requests/:requestId/reject` | | 204 | AG | |
| GET | `/groups/join-requests?cursor&limit` | | `SocialJoinRequestInboxPage` (mọi nhóm tôi là AG) | TV | |

Lưu ý định tuyến NestJS: khai `groups/join-requests` TRƯỚC `groups/:id`.

`scope` của `/feed`: `wall` (mặc định) = `group_id IS NULL`; `groups` = bài của nhóm tôi là thành viên; `all` = Tường công
ty + nhóm tôi thấy được (trang cá nhân dùng `scope=all&authorId=…`). `groupId` có thì bỏ qua `scope`. Bài ghim (`pinned`)
vẫn đứng đầu trang đầu trong phạm vi đang xem. Tab "Bài thông báo" = `kind=announcement`.

### BE-3: hồ sơ, tìm kiếm, sinh nhật, hoạt động, realtime (controller `social-discovery.controller.ts`)

| Method | Path | Request | Response | Quyền | Lỗi riêng |
|---|---|---|---|---|---|
| GET | `/people/:userId/profile` | | `SocialPersonProfile` | TV | 404 `PERSON_NOT_FOUND` |
| GET | `/birthdays?days` | `SocialBirthdaysQuery` | `SocialBirthdays` | TV | |
| GET | `/search?q` | | `SocialSearchOverview` (tối đa 5 mục mỗi loại) | TV | 400 `q` ngắn/dài quá |
| GET | `/search/posts?q&topicId&groupId&authorId&from&to&cursor&limit` | `SocialSearchPostsQuery` | `SocialFeedPage` | TV (áp luật nhìn thấy) | 400 khoảng thời gian sai |
| GET | `/search/people?q&limit` | `SocialSearchPeopleQuery` | `SocialSearchPeopleResponse` | TV | |
| GET | `/search/groups?q&cursor&limit` | `SocialSearchGroupsQuery` | `SocialGroupPage` | TV (không có nhóm riêng tư của người ngoài) | |

Bài của một người trên trang cá nhân: dùng `GET /feed?authorId=<id>&scope=all` (BE-2), gồm cả bài tự sinh.
`GET /people` (gợi ý mention) có sẵn, giữ nguyên.

## 5. Sự kiện và thông báo

Phát qua outbox cùng transaction (skill `erp-events`); không đổi tên sự kiện đã phát. Kiểu payload trong
`contracts-social.ts` / `contracts-social-groups.ts`.

| Sự kiện (`SOCIAL_EVENT_TYPES`) | Phát khi | Bên phát | Thông báo cho | Realtime |
|---|---|---|---|---|
| `social.post.published` (có từ P1; thêm `groupId`, `groupName`, `recipientUserIds`, `requiresReadConfirmation`, `origin`) | bài thành `published` (đăng ngay, duyệt, đến giờ) | BE-1 | P1: theo `kind`/`mentionsAll`. Mới: bài nhóm `announcement` → `recipientUserIds`; bài cần xác nhận đã đọc → người thuộc phạm vi | `post.created` |
| `social.post.pending` | bài vào `pending` | BE-1 | moderator (BE-3 tra người có `social.post.moderate` như các catalog khác) | không |
| `social.post.moderated` | duyệt/từ chối | BE-1 | tác giả (thông báo "bài được duyệt"/"bị từ chối: lý do") | không |
| `social.post.changed` | sửa, xoá, ghim bài | BE-1 | không | `post.updated`/`post.deleted` |
| `social.comment.created` (có từ P1) | bình luận mới | BE-1 | như P1 | `comment.changed` |
| `social.reaction.changed` | đặt/bỏ/đổi phản ứng | BE-1 | không | `reaction.changed` |
| `social.poll.changed` | bỏ/đổi phiếu, đóng | BE-1 | không | `poll.changed` |
| `social.group.member.added` | được thêm, hoặc yêu cầu được duyệt | BE-2 | người được thêm | không |
| `social.group.join.requested` | yêu cầu tham gia nhóm riêng tư | BE-2 | `adminUserIds` trong payload | không |
| `social.group.join.decided` | duyệt/từ chối yêu cầu | BE-2 | người xin | không |

Thông báo mới thêm vào catalog (`packages/modules/notifications`, BE-3): `postPending`, `postModerated`,
`groupMemberAdded`, `groupJoinRequested`, `groupJoinDecided`, mở rộng `postPublished`. Đường dẫn:
`/modules/social/posts/<id>`, `/modules/social/groups/<id>`, `/modules/social/pending`, `/modules/social/groups/<id>/requests` (dạng path, xem mục 11; liên kết cũ dạng hash vẫn được chuyển hướng).

Realtime: tên socket `social.feed.changed` (hằng `SOCIAL_REALTIME_EVENT`), payload `SocialFeedSignal`. BE-3 thêm tên này vào
`REALTIME_SERVER_EVENTS` của `contracts-realtime`, ánh xạ sự kiện outbox → tín hiệu, và quyết định cơ chế phòng (theo
mẫu `procedure.comment.changed`). Yêu cầu bắt buộc: bài nhóm riêng tư chỉ tới thành viên; tín hiệu chỉ mang id.

Bài tự sinh: BE-3 nghe sự kiện của phân hệ nguồn (ví dụ cập nhật ảnh đại diện), tạo bài `kind='activity'` với
`activity_type='avatar.updated'`, tác giả là chính người đó, `status='published'`, `body_html=''`, không `groupId`, không
phát thông báo; giới hạn một bài mỗi loại mỗi người mỗi ngày. Loại mới thêm vào `SOCIAL_ACTIVITY_TYPES`.

## 6. Phân chia sở hữu file

Mỗi agent chỉ tạo file mới trong vùng của mình và sửa file mình sở hữu. KHÔNG ai sửa: `social.module.ts`, `index.ts`,
`social.controller.ts`, `social-store.port.ts`, `postgres-social-store.ts`, `apps/social-api/**`, contracts, migration,
`application/ports/**`, `infrastructure/post-visibility-sql.ts` (người điều phối nối và sửa). Cần đổi thì ghi vào báo cáo
cuối dưới mục "Yêu cầu đổi hợp đồng". Mỗi agent kèm `*.spec.ts` cho logic mới.

Quy ước tên: mỗi mảng của một agent có store riêng, không dùng chung bảng truy vấn. BE-1/2/3 không gọi store của nhau;
chỉ dùng cổng trong `ports/`.

### BE-1: đường ghi bài
- Sửa: `application/social-post.service.ts`, `social-views.ts`, `social-reaction.service.ts`, `social-comment.service.ts`,
  `domain/social-rules.ts` (chỉ thêm hàm).
- Mới: `application/social-publishing.service.ts`, `social-moderation.service.ts`, `social-scheduler.service.ts`,
  `social-poll.service.ts`, `social-read-confirmation.service.ts`, `social-bookmark.service.ts`,
  `social-settings.service.ts`, `social-post-view.assembler.ts` (hiện thực `PostViewAssembler`),
  `social-publishing-store.port.ts`; `infrastructure/postgres-social-publishing.store.ts`,
  `postgres-social-settings.store.ts`; `presentation/social-publishing.controller.ts`; domain: `social-poll-rules.ts`.
- Hiện thực cổng: `SocialSettingsPort`, `PostViewAssembler`.
- Dùng cổng: `GroupMembershipPort`, `PostVisibilityPort`, `PeopleProfilePort.listActiveUserIds`.
- Store riêng của BE-1 đọc bài để ghi bằng `ExtendedPostRow` (mọi trạng thái trừ `deleted`), không dựa vào
  `store.posts.findById` (chỉ trả bài đã đăng). Bài có bình chọn mà không có chữ/tệp vẫn hợp lệ (bình chọn tính là nội dung).
- Job quét hẹn giờ: hàm `publishDueScheduledPosts(now, limit)` dùng `FOR UPDATE SKIP LOCKED` trên chỉ mục
  `idx_social_posts_due`; nơi gọi định kỳ (worker) do BE-1 chọn theo `erp-events`/`apps/worker`.

### BE-2: nhóm và đường đọc
- Mới: `application/social-group.service.ts`, `social-group-member.service.ts`, `social-feed.service.ts`,
  `post-visibility.service.ts` (hiện thực `PostVisibilityPort`), `group-membership.adapter.ts` (hiện thực
  `GroupMembershipPort`), `social-group-store.port.ts`; `infrastructure/postgres-social-group.store.ts`,
  `postgres-social-feed.store.ts`; `presentation/social-groups.controller.ts`, `social-feed.controller.ts`.
- Không sửa `postgres-social-store.ts`: truy vấn bảng tin P2 nằm ở `postgres-social-feed.store.ts` (dùng
  `postVisibilitySql`, trả `ExtendedPostRow`, dựng `SocialPost` qua `PostViewAssembler`). Người điều phối gỡ route
  `feed`/`posts` (GET) cũ khỏi `social.controller.ts` khi nối.
- Dùng cổng: `PostViewAssembler`, `OrganizationDirectory` (có sẵn).

### BE-3: hồ sơ, tìm kiếm, sinh nhật, hoạt động, realtime
- Mới: `application/social-profile.service.ts`, `social-search.service.ts`, `social-birthday.service.ts`,
  `social-activity.service.ts`; `infrastructure/http-people-profile.ts` (hiện thực `PeopleProfilePort`),
  `postgres-social-search.store.ts`, `postgres-social-activity.store.ts`; `presentation/social-discovery.controller.ts`.
- Sửa ngoài module: catalog thông báo ở `packages/modules/notifications` (và spec), `contracts-realtime` (thêm tên sự kiện),
  consumer/gateway realtime theo skill `erp-events`.
- Dùng cổng: `PostVisibilityPort`, `PostViewAssembler`, `GroupMembershipPort`, `OrganizationDirectory`.
- Phải khảo sát endpoint nội bộ HRM/Core cho hồ sơ và ngày sinh (skill `erp-permissions`, mục API nội bộ) và ghi giả định
  vào đầu `http-people-profile.ts`.

### FE (thư mục `packages/features/social/src/lib/`, file đã có stub ghi người sở hữu)
- FE-A: `social-screen.tsx`, `social.module.scss` phần bố cục, `components/feed/social-feed.tsx`, điều hướng, cột phải,
  định tuyến hash. Là nơi duy nhất gắn các view khác vào màn hình.
- FE-B: `components/groups/**`.
- FE-C: `components/post-card.tsx`, `composer-dialog.tsx`, `rich-editor.tsx`, `components/library/**` (Đã lưu),
  `components/moderation/**` (Chờ duyệt, Hẹn giờ, Bài của tôi), cài đặt duyệt bài, bình chọn, xác nhận đã đọc.
- FE-D: `components/profile/**`, `components/search/**`, `components/widgets/birthday-widget.tsx`.
- `social-api.ts` và `social.model.ts` là file chung: mỗi FE thêm hàm gọi API của mình vào file RIÊNG
  (`social-api-groups.ts`, `social-api-posts.ts`, `social-api-discovery.ts`, ...) và import `request`/`json` từ
  `social-api.ts`; không sửa hàm có sẵn. Người điều phối gom nếu cần.
- Hash gợi ý (FE-A chốt): `#feed`, `#groups`, `#groups/<id>`, `#people/<id>`, `#search/<từ khoá>`, `#saved`,
  `#my-posts/<status>`, `#moderation`, `#posts/<id>` (có sẵn cho liên kết thông báo).
- Giao diện: `SearchableSelect`, không `<select>`, không emoji; màu và biểu tượng nhóm ánh xạ từ khoá trong
  `SOCIAL_GROUP_COLORS`/`SOCIAL_GROUP_ICONS`.

## 7. Dữ liệu (migration)

Đã đăng ký trong `TENANT_MODULE_MIGRATIONS.social` (`packages/platform/entitlement/src/lib/tenant-migrations.ts`).

- `0002-social-groups.sql`: hàm `social_schema.fold_text`, bảng `groups`, `group_members`, `group_join_requests`.
- `0003-social-post-p2.sql`: cột mới của `posts` (`group_id`, `scheduled_at`, `moderated_by/at`, `reject_reason`,
  `requires_read_confirmation`, `activity_type/payload`, `search_text` cột sinh), mở rộng CHECK `status` (thêm `rejected`) và
  `kind` (thêm `activity`), chỉ mục (Tường công ty, bài nhóm, hẹn giờ, chờ duyệt, bài chưa đăng của tác giả, tìm kiếm
  GIN), bảng `polls`, `poll_options`, `poll_votes`, `read_confirmations`, `post_bookmarks`, `settings`.
- Đã chạy thử hai lần liên tiếp trên PostgreSQL 17 (DB tạm, đã xoá) để kiểm tính idempotent và cột sinh.
- Giả định: DB tenant là PostgreSQL 12 trở lên (cột sinh); môi trường dùng 17.
- Mọi ràng buộc mới tương thích ngược: bản app P1 vẫn chạy với schema mới.

---

# Đợt 2: quyền xem bài, nhóm mở rộng, bài viết mở rộng, sinh nhật, đường dẫn

Hợp đồng giữa 2 agent backend (BE-V, BE-G; BE-H làm riêng endpoint HRM nội bộ cho sinh nhật) và 2 agent frontend
(FE-G, FE-C2). Hợp đồng gồm: kiểu trong `packages/contracts/social` (`contracts-social-visibility.ts`,
`contracts-social-groups-v2.ts`, `contracts-social-routes.ts`, và các trường thêm vào 3 file có sẵn), migration
`0004-social-visibility-groups-v2.sql`, cổng mới trong `application/ports/` (`viewer-scope.port.ts`,
`group-posting.port.ts`, `report-target.port.ts`). Quy ước đợt 1 giữ nguyên (tiền tố `/v1`, khung lỗi, không ai sửa
file hợp đồng; cần đổi thì báo người điều phối). Mọi trường mới trong kiểu cũ là optional với mặc định ghi cạnh trường.

## 8. Quyết định đã chốt (đợt 2)

| Chủ đề | Quyết định |
|---|---|
| Quyền xem | Chỉ áp cho bài Tường công ty (`group_id IS NULL`). Bài nhóm luôn theo nhóm; CHECK ở DB ép `visibility='company'` cho bài nhóm. Mặc định `company`. Bài tự sinh (`activity`) luôn `company`. |
| `unit` (Phòng ban) | Thấy: tác giả, và mọi người thuộc phòng ban của tác giả **hoặc phòng ban con của nó** (người ở phòng con thấy bài của phòng cha; người ở phòng cha KHÔNG tự thấy bài của phòng con). "Phòng ban của tác giả" là nút gần nhất không phải vị trí, chốt vào `posts.author_unit_id` lúc đặt quyền (không đổi khi tác giả chuyển phòng; đổi lại quyền xem thì tính lại). Tác giả chưa thuộc phòng nào: 400 `VISIBILITY_UNIT_UNKNOWN`. |
| `custom` (Tùy chỉnh) | Thấy: tác giả, người trong `audience.userIds`, người thuộc nút trong `audience.unitIds` (nút gồm cả nút con, vì `ViewerScope.unitIds` có sẵn tổ tiên). Chọn được cả phòng ban lẫn vị trí. Tối đa 200 người, 50 nút; phải có ít nhất một. |
| `private` | Chỉ tác giả. Moderator và quản trị tenant KHÔNG thấy (kể cả khi hẹn giờ). |
| Moderator/quản trị | Không được ưu tiên ở quyền xem. Bài chưa đăng (`pending/scheduled/rejected`) chỉ moderator thấy khi bài là `company` (giữ hàng đợi duyệt). |
| Duyệt bài | Chỉ bài `company` mới vào `pending` khi bật `wallRequireApproval`; `unit/custom/private` đăng thẳng (không ai ngoài đối tượng thấy). |
| Ràng buộc đi kèm | `announcement`, `pinned`, `mentionsAll`, `requiresReadConfirmation` chỉ với `company` (400 `VISIBILITY_NOT_ALLOWED`). Bài có `groupId` mà `visibility` khác `company`: 400 `VISIBILITY_NOT_ALLOWED`. |
| Nhắc tên (@mention) | `company`: như cũ. `custom`: người được nhắc tự được thêm vào `audience`. `unit`/`private`: người được nhắc mà không thấy được bài bị bỏ khỏi `mentions`, không có thông báo. |
| Đổi quyền xem | Chỉ tác giả, qua `PATCH /posts/:id` (`visibility`, `audience`), khi bài `published` hoặc `scheduled`, không thuộc nhóm. Không tính là "đã sửa" (không tạo `post_edits`, không đặt `editedAt`). Phát `social.post.changed` (`updated`) để máy khác tải lại; không thu hồi thông báo đã gửi; đổi từ quyền hẹp sang `company` không gửi lại thông báo `postPublished`. |
| Thông báo và sự kiện | `social.post.published` vẫn phát cho mọi bài (realtime cần) nhưng mang `visibility`; catalog thông báo BỎ QUA khi `visibility` khác `company`. Thông báo mention/bình luận chỉ gửi cho người thấy được bài. |
| Realtime | Tín hiệu `social.feed.changed` của bài quyền hẹp vẫn tới mọi phiên của tenant (chỉ mang id; người nhận gọi API và nhận 404 nếu không thấy). Xem rủi ro. |
| Bình luận, phản ứng | Áp luật nhìn thấy như bài. `commentsDisabled`: tạo bình luận/trả lời 403 `COMMENTS_DISABLED`; bình luận cũ vẫn đọc, sửa, xoá được; phản ứng vẫn dùng được; `capabilities.canComment=false`. |
| Lịch sử sửa | `PATCH` đổi `title` hoặc `bodyHtml` (so với hiện tại, sau khi làm sạch): lưu bản TRƯỚC khi ghi đè vào `post_edits` cùng transaction, tăng `edit_count`, đặt `edited_at`. Đổi trường khác không tạo bản. `version` 1 là bản gốc. Xem: tác giả, moderator (bài `company`), admin nhóm (bài nhóm). Giữ tối đa 50 bản gần nhất (BE-V xoá bản cũ hơn trong cùng transaction). |
| Nhóm: `isPublic` | Tương đương `privacy === 'public'`; không thêm cột hay trường thứ hai. |
| Nhóm: mô tả | `descriptionHtml` (HTML đã làm sạch, tối đa 5000 ký tự) lưu `groups.description_html`; server tự suy `description` chữ thuần (tối đa 500, cắt có dấu "…") cho tìm kiếm và thẻ nhóm. |
| Nhóm: bìa | `coverPreset` (khoá trong `SOCIAL_GROUP_COVER_PRESETS`, mặc định `aurora` ở giao diện) cộng `color`. Không tải ảnh bìa riêng ở đợt này. |
| Nhóm: quản lý | `adminUserIds` thêm quản lý lúc tạo (tối đa 20 kể cả người tạo); đổi sau bằng `PATCH /groups/:id/members/:userId` như đợt 1. |
| Nhóm: người được đăng | `postPermission` = `all` (mọi thành viên) / `admins` / `selected` (admin và `postPermittedUserIds`, phải là thành viên). Bài thông báo/ghim vẫn chỉ admin. Người không được đăng: 403 `GROUP_POST_NOT_ALLOWED`; `SocialGroupCapabilities.canPost` phản ánh đúng. Gỡ thành viên thì gỡ luôn khỏi danh sách được chọn. |
| Nhóm theo phòng ban/vị trí | `membership: { mode: 'org', sources }`: nở thành viên (người đang làm việc ở nút, gồm nút con nếu `includeDescendants`, mặc định có) tại thời điểm tạo; lưu nguồn vào `group_member_sources`, `membership_mode='org'`, `added_via='sync'`. "Đồng bộ lại" (`POST /groups/:id/sync-members`, admin nhóm): mặc định chỉ THÊM người mới; `prune=true` còn gỡ thành viên `added_via='sync'` không còn thuộc nguồn nào (không bao giờ gỡ admin, người thêm tay, tự tham gia). Không đồng bộ nền tự động. Vai trò người mới: `member`. Thông báo `groupMemberAdded` với `via='synced'` (tối đa `SOCIAL_NOTIFY_RECIPIENT_MAX` người; vượt thì vẫn thêm nhưng không thông báo). |
| Chủ đề nhóm | Bảng `group_topics` (tối đa 30 mỗi nhóm, tên tối đa 60, không trùng không phân biệt hoa thường). Quản lý: admin nhóm. Bài chọn chủ đề khi đăng (`groupTopicId`), sửa sau (tác giả, admin). Xoá chủ đề: bài giữ nguyên, `group_topic_id` về NULL. Lọc bảng tin nhóm bằng `groupTopicId`. Không phải `topics` của Tường công ty. |
| Ưu tiên lên trên | Riêng từng người, tối đa 10 nhóm (409 `GROUP_PRIORITY_LIMIT`). `GET /groups?scope=mine` đưa nhóm ưu tiên lên đầu (ghim mới trước), rồi thứ tự đợt 1; `scope=all` giữ nguyên. Rời nhóm thì xoá ưu tiên. |
| Báo cáo | Bảng `reports` chung. Mỗi người một báo cáo mở cho mỗi đối tượng (409 `REPORT_EXISTS`); không báo cáo bài/bình luận của chính mình (400 `VALIDATION`). Định tuyến: bài/bình luận Tường công ty -> moderator; đối tượng thuộc nhóm công khai -> moderator và admin nhóm (ai xử lý trước thì xong); nhóm riêng tư -> chỉ admin nhóm (và quản trị toàn hệ thống). Báo cáo chính nhóm: công khai -> moderator và admin nhóm, riêng tư -> admin nhóm. Xử lý: `resolved` hoặc `dismissed` kèm ghi chú; không tự xoá nội dung (người xử lý xoá bằng route có sẵn). Sự kiện `social.report.created`. |
| Nhóm gợi ý | "Các nhóm khác": nhóm công khai chưa tham gia, nhiều thành viên trước, tối đa 10. Không có nhóm riêng tư. |
| Copy link nhóm | Chỉ giao diện: `origin + SOCIAL_ROUTES.group(id)`. |
| Sinh nhật | Trang riêng `/birthday` dùng `GET /birthdays/upcoming`. `turningAge` (tuổi sẽ tròn) chỉ có khi HRM có năm sinh; năm sinh không bao giờ ra khỏi HRM/cổng. |
| URL | Path thay hash (mục 11). `/modules/social` là Bảng tin hợp nhất (`scope=all`), `/wall` là Tường công ty (`scope=wall`). |

## 9. Luật nhìn thấy bài (cập nhật cho đợt 2)

Nguồn sự thật vẫn là `canViewPostInScope` (`application/ports/post-visibility.port.ts`, đã có luật 5 và spec) và SQL
tương ứng. `PostVisibilityScope` thêm `unitIds?`; `PostVisibilitySubject` thêm `visibility?`, `authorUnitId?`,
`audienceUserIds?`, `audienceUnitIds?`.

### SQL đã hiện thực (`infrastructure/post-visibility-sql.ts`)

Chữ ký (3 tham số; mọi chỗ gọi dùng `firstParam: values.length + 1` rồi nối `...params`):

```ts
// $firstParam = uuid[] nhóm của người xem; +1 = uuid người xem; +2 = uuid[] unitIds của người xem (gồm tổ tiên).
postVisibilitySql(scope: PostVisibilityScope, options): { sql, params: [memberGroupIds, viewerId, unitIds] }
```

Mệnh đề (đối chiếu từng nhánh với `canViewPostInScope`; `seesAllGroups`/`canModerate` nhúng thành `TRUE`/`FALSE`):

```sql
(p.status <> 'deleted'
 AND (p.group_id IS NULL OR (g.deleted_at IS NULL
        AND (g.privacy = 'public' OR <seesAll> OR p.group_id = ANY($groups::uuid[]))))
 AND (p.author_id = $viewer::uuid                                   -- tác giả luôn thấy bài của mình
   OR (p.group_id IS NOT NULL AND (p.status = 'published' OR <moderates>))   -- bài nhóm
   OR (p.group_id IS NULL AND (                                     -- bài Tường công ty
        (p.status = 'published' AND (
              p.visibility = 'company'
           OR (p.visibility = 'unit' AND p.author_unit_id = ANY($units::uuid[]))
           OR (p.visibility = 'custom' AND EXISTS (
                 SELECT 1 FROM social_schema.post_audience a
                 WHERE a.post_id = p.id AND (
                       (a.principal_type = 'user' AND a.principal_id = $viewer::uuid)
                    OR (a.principal_type = 'unit' AND a.principal_id = ANY($units::uuid[])))))))
        OR (p.status <> 'published' AND p.visibility = 'company' AND <moderates>)))))
```

`private` chỉ có nhánh tác giả. Bài chưa đăng ở Tường công ty: moderator chỉ thấy khi `visibility = 'company'`. Có spec
đối chiếu `canViewPostInScope` với SQL (`post-visibility-sql.spec.ts`) và spec tích hợp
(`social-visibility.integration.spec.ts`).

Chỗ phải áp, không được sót: bảng tin (`postgres-social-feed.store.ts`), `GET /posts/:id`, tìm kiếm bài, bài của tôi,
bookmark, trang cá nhân và `postCount`, bình luận, phản ứng, bình chọn, xác nhận đã đọc, `SocialSearchOverview.posts`,
quyền realtime, danh sách người nhận thông báo/mention, `ReportTargetResolverPort`.

### Dựng `ViewerScope`

`PostVisibilityPort.scopeFor` (BE-V sửa `post-visibility.service.ts`) gọi `ViewerScopePort.scopeOf(tenantId, userId)` rồi
đặt `unitIds`. `HttpOrgStructure` (BE-V, `infrastructure/http-org-structure.ts`) đọc cùng endpoint organization context
của Tenant Core mà `HttpOrganizationDirectory` đang dùng (`units[]` có `id`, `parentId`, `typeCategory`; `members[]` có
`userId`, `unitId`); cache 60 giây, dùng chung snapshot, không gọi mạng ở mỗi truy vấn. Lỗi Core: dùng bản cũ, không
thì `unitIds` rỗng (người xem chỉ thấy bài `company` và bài của mình; KHÔNG fail-open).

## 10. Bảng route (đợt 2)

Quyền như mục 4: **TV**, **MOD**, **MNG**, **TG**, **AG**; **TV\*** = thấy được đối tượng theo luật nhìn thấy.

### BE-V: bài viết, quyền xem, lịch sử, sơ đồ tổ chức

| Method | Path | Request | Response | Quyền | Lỗi riêng |
|---|---|---|---|---|---|
| POST | `/posts` (mở rộng) | `CreateSocialPostRequest` + `visibility`, `audience`, `commentsDisabled`, `groupTopicId` | `SocialPost` | như mục 4; `groupTopicId`: người được đăng và chủ đề thuộc nhóm | 400 `VISIBILITY_NOT_ALLOWED`, `VISIBILITY_AUDIENCE_INVALID`, `VISIBILITY_UNIT_UNKNOWN`; 403 `GROUP_POST_NOT_ALLOWED`; 404 `GROUP_TOPIC_NOT_FOUND` |
| PATCH | `/posts/:id` (mở rộng) | `UpdateSocialPostRequest` + `visibility`, `audience`, `commentsDisabled`, `groupTopicId` | `SocialPost` | nội dung: TG hoặc MOD; `visibility`/`audience`: chỉ TG; `commentsDisabled`: TG, MOD, AG (bài nhóm); `groupTopicId`: TG, AG | 403 `VISIBILITY_CHANGE_FORBIDDEN` |
| GET | `/posts/:id` (mở rộng) | | `SocialPost` (thêm `visibility`, `audience` cho TG, `commentsDisabled`, `editCount`, `groupTopic`, capabilities mới) | TV\* | 404 `POST_NOT_FOUND` |
| GET | `/posts/:id/edits` | | `SocialPostEditHistory` | TG, MOD (bài `company`), AG (bài nhóm) | 403 `FORBIDDEN`, 404 |
| POST | `/posts/:id/comments` (có sẵn) | | | | thêm 403 `COMMENTS_DISABLED` |
| GET | `/org/nodes?kind&query&limit` | `SocialOrgNodeQuery` | `SocialOrgNodePage` | TV | |
| GET | `/groups/:id/feed` (bảng tin do BE-V sở hữu) | thêm `groupTopicId` | `SocialFeedPage` | như đợt 1 | 400 `VALIDATION` khi chủ đề không thuộc nhóm |
| GET | `/feed`, `/search/*`, `/me/posts`, `/bookmarks` | không đổi | | | chỉ áp luật nhìn thấy mới |

`SocialPost.audience` chỉ trả cho tác giả (người khác không biết bài chia sẻ cho ai). `capabilities.canViewHistory` =
(`editCount > 0`) và người xem được phép xem lịch sử.

### BE-G: nhóm, chủ đề, ưu tiên, báo cáo

Khai báo route tĩnh (`groups/suggestions`, `groups/join-requests`) TRƯỚC `groups/:id`.

| Method | Path | Request | Response | Quyền | Lỗi riêng |
|---|---|---|---|---|---|
| POST | `/groups` (mở rộng) | `CreateSocialGroupRequest` + `descriptionHtml`, `coverPreset`, `adminUserIds`, `membership`, `postPermission`, `postPermittedUserIds` | `SocialGroupDetail` | TV | 409 `GROUP_NAME_TAKEN`; 400 `GROUP_SOURCE_UNKNOWN`; 400 `VALIDATION` (`selected` mà rỗng, quá 20 quản lý) |
| PATCH | `/groups/:id` (mở rộng) | `UpdateSocialGroupRequest` + `descriptionHtml`, `coverPreset`, `postPermission`, `postPermittedUserIds` | `SocialGroupDetail` | AG | 409 `GROUP_NAME_TAKEN` |
| GET | `/groups?scope&query&cursor&limit` | không đổi | `SocialGroupPage` (thêm `myPriorityAt`, `coverPreset`, `membershipMode`); `scope=mine` ưu tiên trước | TV | |
| GET | `/groups/suggestions?limit` | | `SocialGroupSuggestions` | TV | |
| PUT | `/groups/:id/priority` | `SetSocialGroupPriorityRequest` | `SocialGroupPriorityState` | thành viên | 409 `GROUP_PRIORITY_LIMIT`; 403 `GROUP_NOT_MEMBER` |
| GET | `/groups/:id/topics` | | `SocialGroupTopicList` | người thấy nhóm đầy đủ | 404 |
| POST | `/groups/:id/topics` | `CreateSocialGroupTopicRequest` | `SocialGroupTopic` | AG | 409 `GROUP_TOPIC_NAME_TAKEN`, `GROUP_TOPIC_LIMIT` |
| PATCH | `/groups/:id/topics/:topicId` | `UpdateSocialGroupTopicRequest` | `SocialGroupTopic` | AG | 404 `GROUP_TOPIC_NOT_FOUND`; 409 `GROUP_TOPIC_NAME_TAKEN` |
| DELETE | `/groups/:id/topics/:topicId` | | 204 | AG | 404 `GROUP_TOPIC_NOT_FOUND` |
| PUT | `/groups/:id/member-sources` | `SetSocialGroupMemberSourcesRequest` | `SocialGroupDetail` | AG | 400 `GROUP_SOURCE_UNKNOWN`; rỗng thì về `manual` |
| POST | `/groups/:id/sync-members` | `SyncSocialGroupMembersRequest` | `SyncSocialGroupMembersResponse` | AG | 400 `GROUP_NO_MEMBER_SOURCES` |
| POST | `/reports` | `CreateSocialReportRequest` | `SocialReport` (201) | TV\*, không phải tác giả | 409 `REPORT_EXISTS`; 404 |
| GET | `/moderation/reports?status&targetType&cursor&limit` | `SocialReportListQuery` | `SocialReportPage` | MOD | |
| POST | `/moderation/reports/:id/resolve` | `ResolveSocialReportRequest` | `SocialReport` | MOD (báo cáo thuộc hàng đợi moderator) | 404 `REPORT_NOT_FOUND`; 409 `REPORT_HANDLED` |
| GET | `/groups/:id/reports?status&targetType&cursor&limit` | `SocialReportListQuery` | `SocialReportPage` | AG | |
| POST | `/groups/:id/reports/:reportId/resolve` | `ResolveSocialReportRequest` | `SocialReport` | AG | 404; 409 `REPORT_HANDLED` |

Đăng bài vào nhóm: BE-V gọi `GroupPostingPort.canPost` (thay cho `isMember` của đợt 1) và `topicsOfGroup`. Chi tiết nhóm
trả `postPermittedUsers`, `memberSources` chỉ cho AG.

### BE-H: sinh nhật (làm riêng)

| Method | Path | Request | Response | Quyền |
|---|---|---|---|---|
| GET | `/birthdays/upcoming?q&months` | `SocialBirthdayListQuery` | `SocialBirthdayList` (nhóm theo tháng từ tháng hiện tại, tối đa 500 người) | TV |

Dựng trên `PeopleProfilePort`, nguồn là endpoint HRM nội bộ `GET /v1/internal/people/profile-facts?userIds&month` (đã hiện thực ở `HrmInternalController`, không còn là đề nghị); nếu có năm sinh thì tính `turningAge` ở server, không đưa năm sinh qua cổng.
Sinh 29/2 tính 28/2 ở năm không nhuận (như `birthdays`).

## 11. Đường dẫn URL (thay hash)

Hàm dựng: `SOCIAL_ROUTES` trong `contracts-social-routes.ts`; đọc ngược: `parseSocialPath(pathname, search)`; hash cũ:
`parseLegacySocialHash` và `legacyHashToPath`. `apps/social-web` cần một route bắt mọi đường con dưới `/modules/social`
(`app/[[...slug]]/page.tsx`): `SocialScreen` tự phân tích path, không tạo route Next riêng cho từng trang.

| Đường dẫn | Trang | Hàm dựng | Ghi chú |
|---|---|---|---|
| `/modules/social` | Bảng tin hợp nhất (Tường công ty + nhóm tôi thấy: `scope=all`) | `SOCIAL_ROUTES.feed()` | `?topic=<id>` lọc chuyên mục |
| `/modules/social/wall` | Tường công ty (`scope=wall`) | `wall()` | `?topic=<id>`; `?kind=announcement` (tab Bài thông báo) |
| `/modules/social/groups` | Danh sách nhóm (Nhóm của bạn, Các nhóm khác) | `groups()` | |
| `/modules/social/groups/:id` | Bảng tin nhóm | `group(id)` | `?topic=<groupTopicId>` |
| `/modules/social/groups/:id/members` | Thành viên | `group(id, 'members')` | |
| `/modules/social/groups/:id/requests` | Yêu cầu tham gia (AG) | `group(id, 'requests')` | |
| `/modules/social/groups/:id/announcements` | Bài thông báo của nhóm | `group(id, 'announcements')` | |
| `/modules/social/groups/:id/topics` | Quản lý chủ đề (AG) | `group(id, 'topics')` | |
| `/modules/social/groups/:id/reports` | Báo cáo của nhóm (AG) | `group(id, 'reports')` | |
| `/modules/social/saved` | Đã lưu | `saved()` | |
| `/modules/social/pending` | Bài của tôi chờ duyệt | `pending()` | `?tab=rejected`, `moderation`, `reports` (hai thẻ cuối chỉ moderator) |
| `/modules/social/scheduled` | Hẹn giờ | `scheduled()` | |
| `/modules/social/profile/:userId` | Trang cá nhân | `profile(id)` | |
| `/modules/social/search?q=` | Tìm kiếm | `search(q)` | |
| `/modules/social/posts/:id` | Chi tiết bài ("Xem chi tiết") | `post(id)` | |
| `/modules/social/posts/:id/comments/:commentId` | Chi tiết bài, cuộn tới bình luận | `post(id, commentId)` | |
| `/modules/social/birthday` | Danh sách sinh nhật | `birthday()` | |

Quy tắc tương thích:
- Liên kết thông báo đã phát (`/modules/social#posts/<id>`, `#groups/<id>/requests`, `#moderation`...) vẫn phải mở được.
  Khi khởi động, nếu `location.hash` không rỗng thì `SocialScreen` gọi `legacyHashToPath(hash)` rồi `router.replace`
  sang path mới (bỏ hash). Bảng ánh xạ nằm trong `contracts-social-routes.spec.ts`; hash lạ về Bảng tin.
- Mọi liên kết mới (catalog thông báo, copy link, chia sẻ) dùng path qua `SOCIAL_ROUTES`. Dữ liệu thông báo đã lưu giữ
  nguyên dạng hash, không viết lại.
- Điều hướng trong trang dùng `router.push` với path (không còn `location.hash`); `parseSocialPath` nhận cả path đầy đủ
  lẫn path tương đối so với `basePath` của Next.
- Gateway nginx không cần đổi vì `/modules/social/*` đã vào `social-web`; FE-G kiểm F5 trên đường con trả trang chứ không 404.

## 12. Sự kiện và thông báo (đợt 2)

| Sự kiện | Phát khi | Bên phát | Thông báo | Realtime |
|---|---|---|---|---|
| `social.post.published` (thêm `visibility`) | như đợt 1, kể cả bài quyền hẹp | BE-V | bỏ qua nếu `visibility` khác `company` | `post.created` |
| `social.post.changed` | sửa, xoá, ghim, đổi quyền xem, bật/tắt bình luận | BE-V | không | `post.updated` |
| `social.group.member.added` (`via='synced'`) | tạo nhóm theo phòng ban, đồng bộ lại | BE-G | người được thêm | không |
| `social.report.created` (`SocialReportCreatedPayload`) | báo cáo mới | BE-G | `recipientUserIds` (admin nhóm) hoặc mọi moderator | không |

Catalog thông báo: BE-G thêm `reportCreated` (người nhận theo `recipientUserIds`, hoặc moderator; nhóm riêng tư thì chỉ
`recipientUserIds`); BE-V thêm điều kiện bỏ qua `visibility` khác `company` cho `postPublished`. Liên kết thông báo mới
dùng `SOCIAL_ROUTES` (`post`, `group(id, 'requests')`, `pending('reports')`).

## 13. Phân chia sở hữu file (đợt 2)

Quy tắc mục 6 vẫn đúng: không ai sửa contracts, migration, `application/ports/**`, `social.module.ts`, `index.ts` (người
điều phối nối). Ngoại lệ đợt này: `infrastructure/post-visibility-sql.ts` giao BE-V (mục 9).

### BE-V: quyền xem, bài viết, lịch sử
- Sửa: `application/post-visibility.service.ts` (điền `unitIds`), `social-post.service.ts`, `social-publishing.service.ts`,
  `social-views.ts`, `social-post-view.assembler.ts` (dựng `visibility`, `audience`, `commentsDisabled`, `editCount`,
  `groupTopic`, capabilities mới), `social-comment.service.ts`, `social-reaction.service.ts`, `social-feed.service.ts`,
  `social-search.service.ts`, `social-profile.service.ts`, `social-bookmark.service.ts`;
  `infrastructure/post-visibility-sql.ts` (kèm spec), `postgres-social-feed.store.ts`, `postgres-social-publishing.store.ts`,
  `postgres-social-search.store.ts`, `postgres-social-store.ts` (bình luận); `presentation/social-publishing.controller.ts`,
  `social.controller.ts`, `social-feed.controller.ts`; catalog thông báo (điều kiện `visibility` của `postPublished`).
- Mới: `infrastructure/http-org-structure.ts` (hiện thực `ViewerScopePort` và `OrgStructurePort`),
  `postgres-social-post-history.store.ts`, `application/social-post-history.service.ts`, `social-org.service.ts`,
  `social-report-target.resolver.ts` (hiện thực `ReportTargetResolverPort`); `presentation/social-post-history.controller.ts`,
  `social-org.controller.ts`.
- Dùng cổng: `GroupPostingPort`, `GroupMembershipPort`, `OrganizationDirectory`.

### BE-G: nhóm, chủ đề, ưu tiên, báo cáo
- Sửa: `application/social-group.service.ts`, `social-group-member.service.ts`, `social-group-support.ts`,
  `group-membership.adapter.ts`, `social-group-store.port.ts`; `infrastructure/postgres-social-group.store.ts`,
  `group-sql-support.ts`; `presentation/social-groups.controller.ts`.
- Mới: `application/group-posting.adapter.ts` (hiện thực `GroupPostingPort`), `social-group-topic.service.ts`,
  `social-group-sync.service.ts`, `social-report.service.ts`, `social-group-v2-store.port.ts`;
  `infrastructure/postgres-social-group-v2.store.ts`, `postgres-social-report.store.ts`;
  `presentation/social-group-topics.controller.ts`, `social-reports.controller.ts`; catalog thông báo (`reportCreated`).
- Dùng cổng: `OrgStructurePort`, `ReportTargetResolverPort` (test bằng bản giả; BE-V cấp bản thật), `PostVisibilityPort`.
- Rời nhóm hoặc bị gỡ: xoá `group_priorities` và `group_post_permitted` của người đó. Người tạo nhóm ghi `added_via='creator'`,
  người tự tham gia `'join'`, người nở từ nguồn tổ chức `'sync'`, người thêm tay `'manual'`.

BE-V cần `GroupPostingPort` của BE-G, BE-G cần `OrgStructurePort` và `ReportTargetResolverPort` của BE-V; người điều phối
nối trong `social.module.ts`. Giữa chừng mỗi bên test bằng bản giả.

### FE (thư mục `packages/features/social/src/lib/`)
- FE-G: `components/groups/**` (tạo/sửa nhóm hai kiểu, quyền đăng bài, chủ đề, ưu tiên, nhóm khác, đồng bộ lại, copy
  link), `components/reports/**` (hộp thoại báo cáo dùng chung và hàng đợi báo cáo), `components/birthday/**` (trang
  `/birthday`), hàm gọi API trong `social-api-groups.ts` (file riêng, không sửa file chung).
- FE-C2: `components/post-card.tsx`, `composer-dialog.tsx` (hộp "Tùy chỉnh quyền xem": 4 lựa chọn, chọn người/phòng ban qua
  `SearchableSelect`, tắt bình luận, chọn chủ đề nhóm), lịch sử chỉnh sửa, "Xem chi tiết", điều hướng theo path
  (`SocialScreen`, `social.model.ts`: thay `parseSocialRoute`/`buildSocialHash` bằng `parseSocialPath`/`SOCIAL_ROUTES`,
  chuyển hướng hash cũ), `social-api-posts.ts`.
- Dùng chung: FE-C2 mở hộp thoại báo cáo của FE-G qua prop (`onReport(targetType, targetId)`), không nhập chéo thư mục.
- Giao diện: `SearchableSelect`, không `<select>`, không emoji; nhãn lấy từ các hằng `*_LABELS` trong contracts.

## 14. Dữ liệu (migration 0004)

`0004-social-visibility-groups-v2.sql`, đã đăng ký trong `TENANT_MODULE_MIGRATIONS.social`. Chỉ THÊM; chạy hai lần liên
tiếp trên PostgreSQL 17 (DB tạm, đã xoá) không lỗi.

- `groups`: `description_html`, `cover_preset`, `post_permission`, `membership_mode`, `last_synced_at/by`.
- `group_members.added_via` (`manual|join|sync|creator`; hàng cũ là `manual` nên "đồng bộ lại" không bao giờ gỡ chúng).
- Bảng mới: `group_post_permitted`, `group_member_sources`, `group_topics`, `group_priorities`, `post_audience`,
  `post_edits`, `reports`.
- `posts`: `visibility`, `author_unit_id`, `comments_disabled`, `edit_count`, `group_topic_id`; CHECK bài nhóm phải
  `company`, `unit` phải có `author_unit_id`, chủ đề nhóm chỉ đi với bài nhóm; chỉ mục cho chủ đề nhóm, bài quyền hẹp,
  bài `unit`.
- Bản app đợt 1 vẫn chạy với schema mới (mọi cột mới có mặc định).

## 15. Rủi ro cần theo dõi (đợt 2)

1. Quyền xem phải áp ở MỌI truy vấn trả bài; sót một chỗ là lộ bài riêng tư. Spec đối chiếu SQL với `canViewPostInScope`
   là rào chắn; rà theo danh sách ở mục 9 trước khi nối.
2. Sơ đồ tổ chức đọc từ Tenant Core: Core chậm hoặc lỗi thì `unitIds` rỗng, người dùng tạm không thấy bài `unit/custom`
   của phòng mình (an toàn nhưng khó hiểu); cache 60 giây nên đổi phòng ban trễ tối đa một phút.
3. `author_unit_id` là ảnh chụp lúc đặt quyền: tác giả chuyển phòng thì bài cũ vẫn thuộc phòng cũ.
4. Realtime vẫn tới mọi phiên cho bài quyền hẹp (chỉ id): lộ việc "có bài mới", không lộ nội dung. Kín hơn cần phòng
   theo người, ngoài phạm vi đợt này.
5. `turningAge` suy ra gần đúng năm sinh; bật hay tắt theo chính sách HRM (BE-H quyết, có thể bỏ qua trường này).
6. Hai backend chạm nhau ở catalog thông báo và hai cổng chéo (`GroupPostingPort`, `OrgStructurePort`).
7. `/modules/social` đổi từ hash sang path: cần route bắt mọi đường con ở `apps/social-web` và kiểm F5 qua gateway; liên
   kết thông báo cũ dựa vào chuyển hướng hash.
8. `/wall` hiểu là Tường công ty (không phải "tường cá nhân" như 1Office); tường cá nhân là `/profile/:userId`.
