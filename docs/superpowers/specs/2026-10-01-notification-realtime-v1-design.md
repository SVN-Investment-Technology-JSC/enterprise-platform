# Notification Realtime v1 — ERP-98

Ngày: 01/10/2026. Trạng thái: **Đã duyệt qua thiết kế theo Superpowers brainstorming; người dùng yêu cầu “Implement the proposed plan”.**

## 1. Mục tiêu và phạm vi

Xây dựng trung tâm thông báo in-app bền vững và realtime cho toàn bộ tenant module của Enterprise Platform. Hệ thống phải hỗ trợ 5.000 kết nối đồng thời, không rò dữ liệu giữa tenant, không tạo unread trùng khi message được giao lại, và cho người dùng đồng bộ lại sau thời gian offline.

Phạm vi v1:

- Chỉ phục vụ principal `tenant-user`; không phục vụ Platform Admin.
- Chỉ có Notification Center, badge và toast; chưa có email, Web Push hoặc mobile push.
- Chưa triển khai chat realtime. Workspace chat hiện hữu tiếp tục hoạt động độc lập.
- Notification giữ 90 ngày; delivery event phục vụ catch-up giữ 7 ngày.
- Tất cả module được đóng gói trong một release, kích hoạt tuần tự bằng feature flag.

## 2. Kiến trúc

Luồng chính:

`domain transaction → integration outbox → RabbitMQ → notification-worker → tenant PostgreSQL → notification delivery outbox → RabbitMQ → realtime-api → Valkey/Socket.IO → browser`

### 2.1. Ranh giới tiến trình

- `notification-worker` là nơi duy nhất chuyển domain event thành notification. Nó resolve người nhận, áp dụng preference/aggregation, ghi inbox chống trùng, notification hiện tại, user state và delivery event trong cùng transaction.
- `realtime-api` phục vụ REST và WebSocket. Nó consume delivery queue nhẹ rồi emit vào server-owned room qua Socket.IO Redis Streams adapter.
- PostgreSQL là nguồn sự thật. Valkey chỉ cung cấp phối hợp realtime/recovery giữa các replica; Valkey lỗi không làm mất notification.
- RabbitMQ giữ domain event và delivery event. Publisher confirm và outbox retry đóng khoảng trống giữa commit DB và emit socket.

### 2.2. Kết nối và xác thực

- Endpoint Socket.IO: `/realtime/socket.io`, nội bộ port `3338`, transport WebSocket-only.
- Xác thực bằng cookie HttpOnly `ep_access`; không nhận access token qua query string hoặc local storage.
- Handshake gọi auth nội bộ `/api/auth/v1/me`, chỉ chấp nhận `tenant-user`, kiểm tra Origin theo allow-list.
- Room do server sở hữu: `tenant:{tenantId}:user:{userId}` và `session:{sessionId}`. Client không có API join room tùy ý.
- `identity.session.revoked` ngắt ngay toàn bộ socket của session; revalidation có jitter là lớp dự phòng.
- Socket.IO recovery xử lý ngắt tối đa 2 phút. App-level sync theo sequence xử lý ngắt dài hơn.

## 3. Mô hình dữ liệu và contract

Tenant-core migration tạo `notification_schema`:

- `notifications`: trạng thái hiện tại, source reference, nội dung đã render, priority, read state, aggregate count, deep link, created/updated/expiry.
- `user_state`: sequence kế tiếp, unread count và mốc đồng bộ của từng core user.
- `preferences`: lựa chọn feed/toast theo module và category.
- `notification_events`: append-only change log đồng thời là delivery outbox; unique `(user_id, sequence)`.
- `inbox_messages`: idempotency theo `(consumer, event_id)`.
- `schedule_emissions`: idempotency cho cảnh báo thời gian.

Mọi mutation notification phải khóa `user_state`, tăng sequence, cập nhật unread count và ghi `notification_events` trong cùng transaction. Read-all dùng một transaction và phát `notification.summary-updated`; client refetch page hiện tại thay vì nhận hàng nghìn event riêng.

```ts
export interface RealtimeEventEnvelope<T> {
  readonly id: string;
  readonly event: RealtimeServerEvent;
  readonly version: 1;
  readonly tenantId: string;
  readonly userId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly data: T;
}

export type RealtimeServerEvent =
  | 'session.ready'
  | 'session.expiring'
  | 'session.revoked'
  | 'notification.created'
  | 'notification.updated'
  | 'notification.read'
  | 'notification.summary-updated';
```

REST `/api/realtime/v1`:

- `GET /notifications?cursor=&limit=&unread=&module=`
- `GET /sync?afterSequence=`; trả `resetRequired=true` khi sequence nằm ngoài log 7 ngày.
- `GET /summary`
- `PATCH /notifications/:id` với `{ read: boolean }`
- `POST /notifications/read-all`
- `GET /preferences`
- `PUT /preferences`
- `GET /health/live`, `GET /health/ready`, `GET /metrics`

## 4. Policy và event catalog

Mỗi policy khai báo event type/version, mức ưu tiên, recipient resolver, template, deep-link allow-list, preference và aggregation key 15 phút.

- `required`: luôn lưu và toast.
- `actionable`: luôn lưu, người dùng được tắt toast.
- `informational`: người dùng được tắt cả feed lẫn toast cho event tương lai.

Catalog v1:

- Identity/entitlement: session revoked; module được bật/tắt cho tenant admin.
- Procedure: assignment, instance terminal result, SLA warning và breach.
- Workspace: giao việc, mention, task sắp đến hạn/quá hạn, calendar invitation/reminder, document published, project completed.
- HRM: trạng thái đơn, yêu cầu duyệt trực tiếp, payslip published.
- Inventory: low stock, stocktake pending/variance, reservation expiring.
- Maintenance: occurrence assigned, due/overdue, dispatch failed, completed.

Event thiếu recipient trực tiếp dùng resolver truy vấn tenant DB hoặc được nâng payload version. Không suy người nhận từ tên hiển thị. Recipient theo quyền được resolve từ RBAC hiện hữu.

## 5. Chuyển tiếp HRM và giao diện

- Backfill `hrm_schema.notifications` sang nguồn chung bằng source key ổn định và ánh xạ `employee_id → core_schema.employees.user_id`.
- Trigger HRM ngừng ghi bảng cũ, chỉ phát integration outbox.
- Route `my-notifications` cũ tạm đọc/ghi `notification_schema` trong một chu kỳ tương thích.
- Xóa notification mẫu khỏi `ModuleShell` và HRM header.
- Shared UI cung cấp provider, bell, badge, Drawer 620px, All/Unread, infinite scroll, preference panel và Sonner toast.
- Deep link chỉ là path cùng origin thuộc allow-list; authorization cuối cùng vẫn ở API đích.
- Tuân thủ UI project: shadcn/Tailwind cho UI cơ bản, Ant Design cho bảng phức tạp, không emoji, keyboard navigation và aria live phù hợp.

## 6. Failure modes, vận hành và rollout

- RabbitMQ retry theo 5 giây, 30 giây, 5 phút rồi DLQ. Payload sai schema vào DLQ với lý do, không ACK giả.
- Valkey lỗi làm readiness realtime fail; REST vẫn đọc được dữ liệu đã lưu. Delivery message chưa emit thành công không được ACK.
- Client cập nhật lạc quan thao tác read và resync khi focus/reconnect.
- Liveness chỉ kiểm tra process; readiness kiểm tra đúng dependency của từng app.
- Metric: active sockets, auth failures, reconnects, queue lag, notification latency, outbox pending, DLQ, sequence gaps và reset sync.
- Rollout: migration + Valkey → realtime-api → notification-worker dark verification → bật consumer → bật UI.
- Rollback bằng feature flag về REST read-only; không rollback schema phá dữ liệu.

## 7. Điều kiện nghiệm thu

- Không có cross-tenant/cross-user read, write hoặc emit.
- Duplicate, out-of-order và Rabbit redelivery không tăng unread hoặc tạo notification trùng.
- Offline client bắt kịp bằng sequence hoặc full reset.
- Multi-tab nhận cùng trạng thái read và summary.
- Logout/revoke session ngắt socket đang mở.
- HRM backfill không trùng và không còn hai unread counter.
- Scheduler đúng timezone/DST, không phát trùng giữa nhiều replica.
- Một realtime replica chết không làm mất event.
- p95 domain-event → socket dưới 2 giây ở tải danh nghĩa; REST p95 dưới 300 ms.
- 5.000 WebSocket ổn định và reconnect storm có jitter.

## 8. Công nghệ và ràng buộc

- Node.js 24.11, pnpm 10.33, Nx 23.1.
- NestJS giữ major 11; websocket packages phải cùng version với Nest workspace.
- Socket.IO 4.8.4, Redis Streams adapter 0.3.1, redis client 6.3.0, Valkey 9.1.2, RabbitMQ 4, PostgreSQL 17.
- Mọi task qua Nx; không chạy underlying tool trực tiếp khi Nx có target.
- TDD bắt buộc cho behavior; mỗi task commit riêng và có lệnh verification.

