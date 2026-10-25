# video-worker

Container nền chuyển mã video của Mạng nội bộ (social) sang MP4 H.264 + AAC (`faststart`) kèm poster JPEG. Nhận việc từ
hai hàng RabbitMQ (`social.video.comment.v1`, `social.video.post.v1`), mỗi hàng prefetch 1; tải bản gốc xuống đĩa, chạy
`ffprobe` rồi `ffmpeg`, tải kết quả lên MinIO, cập nhật `social_schema.attachments` và xoá bản gốc.
Kiến trúc: `docs/social-video.md`. Vận hành: `docs/social-video-runbook.md`.

## Yêu cầu

- Node và pnpm theo workspace.
- `ffmpeg` và `ffprobe` trong `PATH`, hoặc đặt `VIDEO_WORKER_FFMPEG_PATH` và `VIDEO_WORKER_FFPROBE_PATH`.
- PostgreSQL (DB tenant), MinIO/S3, RabbitMQ; biến kết nối dùng lại tên của `apps/worker` và `apps/social-api`.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `VIDEO_WORKER_TMP_DIR` | `<tmpdir>/video-work` | Thư mục tạm chứa bản gốc và kết quả (trong container: `/var/tmp/video-work`, volume `video-work`) |
| `VIDEO_WORKER_FFMPEG_THREADS` | `2` | Số luồng ffmpeg mỗi việc |
| `VIDEO_WORKER_FFMPEG_PATH` | `ffmpeg` | Đường dẫn ffmpeg |
| `VIDEO_WORKER_FFPROBE_PATH` | `ffprobe` | Đường dẫn ffprobe |
| `VIDEO_WORKER_MIN_FREE_DISK_GB` | `5` | Đĩa trống tối thiểu để nhận việc |
| `VIDEO_WORKER_MAX_ATTEMPTS` | `3` | Số lần thử tối đa mỗi video |
| `VIDEO_WORKER_LEASE_SECONDS` | `120` | Thời gian thuê việc; hết hạn thì việc được nhận lại |
| `VIDEO_WORKER_COMMENT_CONCURRENCY` | `1` | Số việc song song của hàng bình luận |
| `VIDEO_WORKER_POST_CONCURRENCY` | `1` | Số việc song song của hàng bài đăng |
| `VIDEO_WORKER_HEARTBEAT_FILE` | `<tmpdir>/video-worker.alive` | Tệp heartbeat cho HEALTHCHECK (trong container: `/tmp/video-worker.alive`) |

Biến kết nối (cùng tên với `apps/worker` và `apps/social-api`, xem `infrastructure/docker/compose.coolify.yml`):

| Biến | Ý nghĩa |
|---|---|
| `RABBITMQ_URL` | Địa chỉ RabbitMQ |
| `S3_INTERNAL_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Kho MinIO/S3 (kết nối nội bộ, không phải URL ký cho trình duyệt) |
| Biến cơ sở dữ liệu nền tảng | Giống `apps/worker` (khối `database-environment` trong compose) |

Không commit giá trị bí mật.

## Chạy local

```bash
pnpm nx run video-worker:build
```

Bật hạ tầng docker local (Postgres, MinIO, RabbitMQ), áp migration (`pnpm db:provision`) và chạy `apps/worker`
(relay outbox, có sẵn trong `pnpm dev`) để tin nhắn đi từ outbox sang RabbitMQ. Rồi, từ gốc repo (worker tự nạp `.env`):

```bash
node apps/video-worker/dist/main.js
```

Nếu cần đổi thư mục tạm, đặt `VIDEO_WORKER_TMP_DIR` trước lệnh.

Khi phát triển, `pnpm dev` đã chạy sẵn `video-worker` cùng các dịch vụ khác (tự build lại khi đổi mã); chạy riêng bằng
`pnpm dev:video-worker`.

## Thư mục tạm

Mỗi việc dùng một thư mục con trong `VIDEO_WORKER_TMP_DIR` và xoá khi xong. Bản gốc nằm trên đĩa, không đưa vào RAM.
Chỉ dọn tay khi worker đã dừng.

## Kiểm tra sức khoẻ

Worker chạm tệp heartbeat mỗi 15 giây, nhưng chỉ khi cả hai consumer RabbitMQ đang kết nối và worker chưa tắt máy; khi nhận SIGTERM/SIGINT tệp bị xoá. `HEALTHCHECK` của Dockerfile (mỗi 30 giây, thời gian khởi động 60 giây, 3 lần lỗi thì unhealthy) chạy lệnh Node kiểm tệp tồn tại và `mtime` cách hiện tại dưới 60 giây. Treo hoặc mất kết nối RabbitMQ kéo dài thì container chuyển `unhealthy`.

```bash
docker inspect --format '{{.State.Health.Status}}' <container>
```

## Tắt máy gọn

Khi nhận SIGTERM hoặc SIGINT, worker ngừng nhận việc mới (log `social.video_worker.stopping`) và kết thúc gọn. Việc chưa
ack quay lại hàng và được nhận lại, chạy lại từ đầu (lượt thử được hoàn lại, nên deploy hoặc khởi động lại liên tiếp không làm video `failed` oan). Container dùng `init: true` để tín hiệu và tiến trình con ffmpeg
được xử lý đúng.

## Nhật ký

Một dòng JSON, không ghi tên tệp: `social.video.started|ready|failed|retry|discarded|skipped` và
`social.video_worker.started|stopping`; trường `tenantId`, `attachmentId`, `purpose`, `attempt`, `outcome`,
`durationMs`, `inputBytes`, `outputBytes`, `outputHeight`, `reason`.
