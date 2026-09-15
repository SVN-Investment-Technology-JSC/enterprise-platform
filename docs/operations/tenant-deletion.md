# Vận hành chức năng xóa tenant

## Hành vi

Superadmin có quyền `platform.tenants.delete` mở **Quản trị tenant → Xóa vĩnh viễn**, kiểm tra tenant/database và nhập đúng mã tenant. API thu hồi phiên đăng nhập, khóa tenant và trả về job. Worker xử lý từng bước: dừng công việc, xóa database, xóa tệp, dọn hàng đợi, kiểm chứng rồi xóa metadata Platform. Có thể theo dõi trong **Lịch sử xóa tenant** và thử lại bước lỗi.

Backup tiếp tục hết hạn theo chính sách lưu trữ hiện có. Không tạo backup mới khi xóa. Giữ biên nhận tối thiểu trong `integration_schema.tenant_deletion_jobs` và audit hoàn tất; snapshot tài nguyên được xóa khi job hoàn tất. Khi phục hồi backup, phải đối chiếu biên nhận để tenant đã xóa không được mở lại ngoài ý muốn.

## Cấu hình và phát hành

1. Chạy migrator của bản phát hành để áp dụng `0006-tenant-deletion.sql`. Migration cấp quyền cho role `platform-admin` hiện hữu; seed hỗ trợ cài đặt mới. Tenant-admin không nhận quyền Platform.
2. Phát hành đồng bộ API, worker, ba module API và web. Worker/migrator cũ không có khóa lifecycle nên không được chạy cùng khi bật chức năng.
3. API và worker phải dùng cùng Platform DB, cụm Tenant DB, bucket/endpoint S3 và broker. Hai file Compose đã truyền cấu hình cần thiết cho cả hai dịch vụ. Tài khoản PostgreSQL phải đọc được `pg_control_system()`, khóa kết nối và DROP database tenant. Tài khoản S3 phải list/xóa object, phiên bản, delete marker và abort multipart. RabbitMQ cần quyền đọc Management API và đọc/ghi các queue cấu hình.
4. Đối chiếu điều kiện upload bên dưới, sau đó đặt `TENANT_DELETION_ENABLED=true` cho API và worker. Mặc định chức năng tắt để chưa thể chấp nhận xóa khi điều kiện này chưa được xác nhận.

| Biến | Ý nghĩa |
|---|---|
| `TENANT_DATABASE_ADMIN_URL` | Kết nối quản trị cụm database tenant, database kết nối thường là `postgres` |
| `TENANT_DATABASE_URL_TEMPLATE` | Template hiện có dùng để phân giải database tenant |
| `TENANT_DATABASE_ENDPOINT_ALIASES` | Danh sách `host:port` cách nhau bằng dấu phẩy, chỉ khai báo alias đã xác minh cùng cụm với admin URL |
| `TENANT_DATABASE_PROTECTED_NAMES` | Tên database bổ sung phải bảo vệ; Platform DB, database quản trị và template đã được chặn sẵn |
| `S3_INTERNAL_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Cùng vị trí lưu trữ mà các module đang ghi dữ liệu |
| `RABBITMQ_URL`, `RABBITMQ_MANAGEMENT_URL` | AMQP và Management API của cùng broker/vhost |
| `TENANT_DELETION_QUEUES` | Mặc định `maintenance.integrations.v1,enterprise.events.dead`; bổ sung khi thêm consumer/queue mới |
| `TENANT_UPLOAD_DEADLINE_ENFORCED` | Chỉ đặt `true` sau khi xác minh mọi đường upload có giới hạn tổng thời gian |
| `TENANT_UPLOAD_MAX_DURATION_SECONDS` | Thời gian upload tối đa được hạ tầng cưỡng chế, số nguyên 1–3600 |

### Điều kiện upload trước khi bật

URL upload có TTL tối đa 300 giây, dùng chung hằng số ở adapter và ba module. Server-side upload có timeout 120 giây. Job chờ `300 + TENANT_UPLOAD_MAX_DURATION_SECONDS + 60` giây sau khi khóa tenant rồi mới bắt đầu xóa.

**Hai biến deadline là xác nhận điều kiện hạ tầng, không tự cài đặt ingress hay cưỡng chế thời gian upload.** Compose hiện tại không cung cấp giới hạn tổng thời gian này. Cần cấu hình tại đường vào S3/MinIO, chặn đường truy cập trực tiếp bỏ qua ingress, và xác minh cả request bắt đầu sát lúc URL hết hạn. Timeout do không có dữ liệu truyền không thay thế giới hạn tổng thời gian. Nếu chưa bảo đảm được, giữ `TENANT_UPLOAD_DEADLINE_ENFORCED=false`; API từ chối preview/yêu cầu xóa trước khi thay đổi tenant.

Đợt này hỗ trợ một cụm PostgreSQL được quản lý và một vị trí storage chung. Tenant có cấu hình không khớp hoặc chia sẻ database bị từ chối để đối soát. Nếu chuyển bucket/cụm DB khi có job chưa hoàn tất, cần khôi phục đúng cấu hình của snapshot trước khi thử lại.

## Xử lý lỗi

- Job lỗi giữ tenant ở `deletion_failed`, tiếp tục chặn truy cập và bật lại tenant. Sửa quyền/kết nối/tài nguyên rồi dùng **Thử lại** bằng tài khoản superadmin.
- `error_code` trong bảng job cho biết nhóm nguyên nhân; API chỉ trả thông báo đã loại bỏ URL kết nối và bí mật.
- `DATABASE_IDENTITY_CHANGED` / `DATABASE_CLUSTER_CHANGED`: database/cụm đã được thay thế sau khi xác nhận. Không chỉnh snapshot để ép chạy; cần đối soát tài nguyên.
- `RESOURCE_BUSY`: kiểm tra prepared transaction, replication slot hoặc kết nối/quyền quản trị PostgreSQL. Không xử lý bằng cách xóa database khác hay toàn cụm.
- `STORAGE_DELETE_INCOMPLETE`: kiểm tra quyền object/version/multipart hoặc retention; không tự bypass retention.
- Bước `purge_integration` có thể chờ message đang được consumer xử lý. Cleanup giữ message của tenant khác, nhưng có thể thay đổi thứ tự và phát lại khi crash; consumer phải tiếp tục dùng inbox chống xử lý lặp.
- Kiểm chứng dùng queue totals trực tiếp qua `disable_stats=true&enable_queue_totals=true`, không coi chỉ số cache hoặc trường bị thiếu là số 0. Tham khảo [RabbitMQ HTTP API](https://www.rabbitmq.com/docs/http-api-reference).
- Tắt feature flag ngăn yêu cầu mới; worker vẫn hoàn tất các job đã chấp nhận. Không rollback migration hoặc chạy binary worker cũ trong lúc còn job.

## Kiểm thử

Kiểm thử tích hợp chỉ chạy khi đặt `TENANT_DELETION_TEST_DATABASE_URL`, và từ chối database không phải `ep_deletion_platform` trên localhost. Dùng PostgreSQL 17, MinIO `RELEASE.2023-10-25T06-33-25Z` và RabbitMQ 4 Management trong container tạm riêng. Test xóa schema và database fixture nên không trỏ vào dữ liệu phát triển/sản xuất.

```powershell
$env:TENANT_DELETION_TEST_DATABASE_URL='postgresql://postgres:ep_delete_test_only@127.0.0.1:<PG_PORT>/ep_deletion_platform'
$env:TENANT_DELETION_TEST_S3_ENDPOINT='http://127.0.0.1:<S3_PORT>'
$env:TENANT_DELETION_TEST_AMQP_URL='amqp://epdeletetest:ep_delete_test_only@127.0.0.1:<AMQP_PORT>'
$env:TENANT_DELETION_TEST_BROKER_HTTP='http://127.0.0.1:<MANAGEMENT_PORT>'
pnpm nx run platform-tenancy:test --skipNxCache
```

MinIO và RabbitMQ test dùng username `epdeletetest`, password `ep_delete_test_only`. Mỗi lần chạy tạo bucket/queue riêng. Không chạy nhiều lượt trên cùng Platform test DB đồng thời. Các test controller và Popconfirm chạy bằng `pnpm nx run-many -t test --projects 'platform-identity,shared-ui'`.
