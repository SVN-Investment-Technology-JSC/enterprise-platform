# Procedure Engine — vertical slice 01

## Kết luận sau khi đối chiếu DakRoSa

Mã nguồn tham chiếu gồm một Next.js app độc lập ở cổng 3001 và một NestJS module
trong backend Platform. Phiên đăng nhập được refresh bằng cookie HttpOnly của
Platform; Procedure giữ access token trong bộ nhớ và không có trang đăng nhập
riêng. Các màn hình đã đối chiếu trực tiếp gồm:

| Màn hình           | Trách nhiệm đúng trong hệ thống mới                                            |
| ------------------ | ------------------------------------------------------------------------------ |
| Workspace          | Danh sách instance, trạng thái, bước hiện hành và hành động do server cho phép |
| Ma trận RCSI       | Definition, version, step, RCSI và publish thuộc Procedure Engine              |
| Sơ đồ tổ chức      | Master data thuộc Platform Organization; Procedure chỉ đọc qua contract        |
| Sơ đồ thiết bị     | Master data thuộc module Asset/Equipment; Procedure chỉ giữ reference          |
| Ma trận bảo trì    | Projection kết hợp Asset + Maintenance + Procedure contract                    |
| Bảo trì & cảnh báo | Dashboard thuộc Maintenance; instance Procedure chỉ là execution link          |

Platform còn có “Việc cần xử lý” làm inbox tổng hợp. Procedure không nên ghi vào
bảng công việc của E-Office; nó phát `ProcedureWorkItemOpened/Closed` qua outbox để
Platform dựng projection chung. Entitlement `procedure-engine` quyết định tenant
có được dùng module, còn permission/RCSI quyết định người dùng được xem và làm gì.

DakRoSa có các component khoảng 1.000–1.600 dòng và `ProcedureService` gần 3.000
dòng. Hành vi nghiệp vụ được giữ lại, nhưng không sao chép cấu trúc file đó.

## Quyết định kiến trúc

```text
apps/procedure-web (Next App Router, basePath /modules/procedure)
  -> packages/features/procedure-engine
      -> packages/contracts/procedure-engine

apps/procedure-api (Nest composition root)
  -> packages/modules/procedure-engine
      presentation -> application -> domain
                         ^
                         |
                    infrastructure
```

- Procedure có Next.js và NestJS deployment riêng; `apps/web`/`apps/api` không
  phụ thuộc package Procedure.
- `app` chỉ giữ route/metadata. UI theo bounded context nằm ngoài route tree.
- Chỉ component tương tác mang `use client`; page/layout vẫn là Server Component
  mặc định của App Router.
- Business module không import module Organization, Equipment hay Maintenance.
  Tích hợp sau này đi qua contract/query/event.
- Published definition là bất biến. Instance chụp snapshot version, step và RCSI.
- Server tính `availableActions`; client không tự suy luận quyền.
- Start/action bắt buộc idempotency key.

## Dedicated database per tenant

Migration `0001-procedure-engine.sql` tạo schema `procedure_schema` trong **database của
một tenant đã được resolver chọn trước**. Do đó bảng nghiệp vụ không có
`tenant_id`. Tenant identity vẫn phải xuất hiện trong request context, audit và
outbox envelope, nhưng không dùng để chọn hàng trong một shared business table.

```text
authenticated request
  -> TenantContext
  -> entitlement + permission
  -> Procedure application
  -> TenantDataSourceResolver
  -> tenant_<id> database / procedure_schema
```

`PostgresProcedureStore` chỉ nhận database reference sau khi Procedure API xác
minh RS256 JWT và nhận access decision từ Platform Core. Store ghi runtime state
và outbox event trong cùng transaction. Pool tenant có giới hạn, idle TTL và
không fallback sang database khác.

## Phạm vi đã triển khai

1. Tạo definition đầy đủ step + direct-user RCSI.
2. Kiểm tra invariant và công bố version 1.
3. Khởi tạo instance từ bản đã công bố.
4. Chạy role stage theo `S -> R -> E -> C -> A`.
5. Complete, approve, return, reject, cancel và comment ở application/API.
6. Idempotency cho start/action.
7. Workspace và Definition board trong Next.js.
8. PostgreSQL migration nền cho definition/version/step/RCSI/instance/action/activity.

API:

| Method | Path                                        | Use case                     |
| ------ | ------------------------------------------- | ---------------------------- |
| GET    | `/api/procedure/v1/workspace`               | Snapshot màn hình theo actor |
| POST   | `/api/procedure/v1/definitions`             | Tạo aggregate draft          |
| POST   | `/api/procedure/v1/definitions/:id/publish` | Validate và publish          |
| POST   | `/api/procedure/v1/instances`               | Start idempotent instance    |
| POST   | `/api/procedure/v1/instances/:id/actions`   | Apply action idempotently    |

## Giới hạn có chủ đích

- Không chấp nhận `x-dev-*`. Cookie/Bearer JWT phải được Platform Core ký; access
  decision xác nhận session, membership, entitlement và permission.
- RCSI hiện resolve direct user. Organization unit/position cần Platform
  Organization contract và membership query.
- Chưa có delegate, E-subtask, attachment/object storage, notification, linked
  sub-flow và maintenance scheduler. Outbox/RabbitMQ đã có walking skeleton.

## Thứ tự lát cắt tiếp theo

1. Organization subject resolver và matrix editor đầy đủ.
2. Delegate, E-subtask, attachment, audit/notification.
3. Contract với Asset/Maintenance và linked execution flow.
