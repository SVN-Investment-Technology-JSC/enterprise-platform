---
name: erp-events
description: Dùng khi một phân hệ cần báo cho phân hệ khác, cho thông báo hay cho nhật ký hoạt động rằng có việc vừa xảy ra; khi phát sự kiện qua outbox, thêm consumer trong worker, thêm loại thông báo, hoặc đặt tên loại sự kiện mới.
---

# Sự kiện giữa các phân hệ

## Luồng

1. Phân hệ ghi một dòng vào `integration_schema.outbox_events` **trong cùng transaction** với thay đổi dữ liệu.
2. `apps/worker` đọc outbox mỗi giây (`TransactionalOutboxRelay`) rồi phát lên RabbitMQ exchange `enterprise.events`
   (kiểu topic, routing key là loại sự kiện).
3. Bên nghe nhận qua hàng đợi riêng: worker (`<phân hệ>.integrations.v1`), notification-worker (`notifications.domain.v1`),
   realtime-api. Lỗi tạm thời được thử lại sau 5 giây, 30 giây, 300 giây; hết lượt thì vào `enterprise.events.dead`.

Phát thẳng lên RabbitMQ sau khi commit sẽ mất sự kiện nếu tiến trình chết giữa chừng; phát trước khi commit thì dữ
liệu có thể rollback nhưng sự kiện đã đi. Vì vậy chỉ phát qua outbox.

## Envelope

Tạo bằng `createIntegrationEvent` của `@enterprise-platform/contracts-integration`:

| Trường | Quy ước |
|---|---|
| `id` | `randomUUID()`; cũng là id dòng outbox và `messageId` trên RabbitMQ |
| `type` | `<tiền tố phân hệ>.<đối tượng>.<động từ đã xảy ra>`, xem mục đặt tên |
| `version` | `1`; tăng khi payload đổi không tương thích |
| `occurredAt` | ISO UTC, mặc định là lúc tạo |
| `tenantId` | luôn có |
| `source` | mã phân hệ: `workspace`, `hrm`, `procedure-engine`... |
| `correlationId` | id đối tượng chính, hoặc id của cả luồng khi đi qua nhiều phân hệ |
| `causationId` | id sự kiện gây ra sự kiện này, khi đây là sự kiện trả lời |
| `payload` | xem mục payload |

Dòng outbox: `aggregate_type` là `<phân hệ>-<đối tượng>` (ví dụ `workspace-work-item`), `aggregate_id` là id đối
tượng, `payload` là cả envelope dạng JSON. Mẫu ghi: hàm `writeOutbox` trong
`packages/modules/workspace/src/lib/infrastructure/postgres-workspace-store.ts`.

## Đặt tên loại sự kiện mới

- Ba phần, chữ thường, các từ trong một phần nối bằng gạch ngang: `workspace.fleet-booking.requested`,
  `hrm.payslip.published`.
- Phần đầu là tiền tố quyền của phân hệ (`procedure`, không phải `procedure-engine`).
- Phần cuối là động từ đã xảy ra: `created`, `assigned`, `completed`, `status-changed`. Không đặt theo kiểu ra lệnh.
- Khai hằng số và kiểu payload trong `packages/contracts/...` như `packages/contracts/integration/src/lib/fleet-booking-events.ts`;
  bên phát và bên nghe cùng import, không gõ lại chuỗi.

**Không đổi tên loại sự kiện đã phát**, kể cả khi lệch quy ước, vì hàng đợi bind theo tên. Repo đang có cả
`work-item` lẫn `work_item`; giữ nguyên chúng. Muốn đổi thì phát song song tên mới, chuyển bên nghe, rồi mới bỏ tên cũ.

## Payload

- Chứa id và vài trường tóm tắt đủ để bên nghe quyết định; cần thêm thì bên nghe gọi API của bên phát.
- Có `actorUserId` (null khi hệ thống tự làm), để nhật ký hoạt động và báo cáo hiệu quả công việc dùng được.
- Sự kiện dẫn tới thông báo thêm `recipientUserIds`, `summary`, `deepLink`, và phải có trong
  `packages/modules/notifications/src/lib/notification-catalog.ts`.
- Không đưa mật khẩu, token, số tài khoản hay chi tiết lương vào payload.

## Nghe sự kiện

- Thêm loại sự kiện vào `bindings` của hàng đợi phân hệ mình trong `apps/worker/src/main.ts` và xử lý trong handler của
  phân hệ.
- Handler phải chịu được nhận trùng (giao ít nhất một lần): kiểm theo `event.id` hoặc trạng thái đích trước khi ghi.
- Handler chỉ ghi dữ liệu của phân hệ mình; muốn phân hệ khác làm gì thì phát sự kiện trả lời.
- Dữ liệu sai vĩnh viễn thì ném `PermanentMessageError` (vào dead letter ngay); lỗi tạm thời thì ném
  `TransientConsumerError` (`packages/adapters/events`).

## Những chỗ đặc biệt đang có

- Trigger SQL của core và HRM tự ghi outbox mà không có `occurredAt`/`tenantId`; relay bù hai trường này
  (`normalizeOutboxEnvelope`). Code TypeScript mới thì dùng `createIntegrationEvent` với đủ trường.
- `hrm.employee.offboarded` và `core.org.*` do org-hrm-bridge đọc thẳng từ outbox (`OUTBOX_INTERNALLY_CONSUMED_TYPES`),
  relay không phát lên RabbitMQ.
