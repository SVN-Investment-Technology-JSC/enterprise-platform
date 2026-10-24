# Runbook: video Mạng nội bộ

Kiến trúc: `docs/social-video.md`. Chỉ dùng lệnh đọc (SELECT, logs, stats) trừ khi ghi rõ. Không tự deploy; người phụ
trách deploy làm trên Coolify.

## 1. Kiểm tra worker còn sống

```bash
docker ps --filter name=video-worker
docker logs --tail 100 <container-video-worker>
docker logs -f <container-video-worker> | grep social.video
docker stats --no-stream <container-video-worker>
```

- Log đầu có `social.video_worker.started`; việc đang chạy có `social.video.started` rồi `ready` hoặc `failed`.
- `docker stats`: CPU không vượt khoảng 400% (4 CPU), MEM LIMIT khoảng 3 GiB. Nếu MEM LIMIT bằng toàn bộ RAM máy thì
  trần chưa được áp dụng (mục 8).
- Lúc rảnh: khoảng 100-200 MB RAM, ~0% CPU.

## 2. Hàng đợi (RabbitMQ management, cổng 15672)

Xem hai hàng `social.video.comment.v1` và `social.video.post.v1`:

| Chỉ số | Ý nghĩa |
|---|---|
| `messages_ready` | đang chờ worker; tăng liên tục nghĩa là worker chậm hoặc chết |
| `messages_unacknowledged` | đang xử lý; tối đa 1 mỗi hàng mỗi bản worker |
| `consumers` | phải từ 1 trở lên mỗi hàng |
| DLQ | hàng `enterprise.events.dead` (gắn vào exchange `enterprise.events.dlx`, topic, khoá `#`): tin bị loại sau khi hết lỗi tạm thời được thử lại (mặc định 5 lần trong tiến trình, chờ 10 giây rồi tăng dần) hoặc tin hỏng (thiếu trường). Video tương ứng vẫn `queued` và được job dọn xếp lại sau 30 phút |

`messages_ready` bằng 0 mà video vẫn `queued`: relay outbox ở `apps/worker` có thể đã dừng.

## 3. Video kẹt

SQL chẩn đoán, chỉ SELECT, chạy trên DB của tenant:

```sql
-- Đếm theo trạng thái
SELECT processing_status, count(*) FROM social_schema.attachments
 WHERE processing_status <> 'none' GROUP BY 1;

-- Đang chờ hoặc đang xử lý, lâu nhất trước
SELECT id, purpose, processing_status, processing_attempts, processing_lease_until,
       created_at, now() - created_at AS age
  FROM social_schema.attachments
 WHERE processing_status IN ('queued', 'processing')
 ORDER BY created_at LIMIT 50;

-- Lỗi gần đây
SELECT id, purpose, processing_attempts, processing_error, created_at
  FROM social_schema.attachments
 WHERE processing_status = 'failed' ORDER BY created_at DESC LIMIT 50;

-- Bản gốc còn sót
SELECT id, created_at FROM social_schema.attachments WHERE source_key IS NOT NULL ORDER BY created_at LIMIT 50;
```

- `processing` quá `processing_lease_until` (thuê mặc định 120 giây): tự được nhận lại, không cần can thiệp.
- `queued` lâu mà hàng rỗng: kiểm relay outbox của `apps/worker` còn chạy và tin chưa phát trong outbox (skill `erp-events`).
- `queued` lâu và hàng đầy: hàng dồn (mục 5).
- `queued` quá 30 phút: job dọn (15 phút một lần, ở `apps/worker`) tự xếp lại hàng; chỉ cần can thiệp nếu `apps/worker` đã dừng.

## 4. `failed` hàng loạt

Đọc `processing_error` và log `social.video.failed` (trường `reason`). Nguyên nhân thường gặp (đối chiếu thông báo thật):

| Dấu hiệu | Hướng xử lý |
|---|---|
| Thiếu ffmpeg hoặc ffprobe | Kiểm image và `VIDEO_WORKER_FFMPEG_PATH`, `VIDEO_WORKER_FFPROBE_PATH` |
| Hết đĩa tạm | Mục 6 |
| Vượt thời lượng, hoặc cạnh dài trên 4096 | Do tệp; người dùng tải video khác |
| Tệp hỏng hoặc không đọc được | Do tệp; tải lại |
| Quá 20 phút (timeout) | CPU quá tải hoặc video quá nặng; kiểm `docker stats` |
| Lỗi MinIO, DB, mạng | Kiểm kết nối và biến môi trường; lỗi tạm thời được thử lại tới `VIDEO_WORKER_MAX_ATTEMPTS` (3) |
| "Máy xử lý video thiếu dung lượng đĩa" | Không phải lỗi của tệp: lượt thử được hoàn lại, video về `queued` và được xếp lại (mục 6) |

Video `failed` không chạy lại được (không giữ bản gốc): người dùng tải lại.

## 5. Hàng dồn

1. Xác nhận worker sống và có consumer (mục 1, 2).
2. Xem video nào đang chạy và độ dài (mục 3).
3. Nếu dồn do tải cao thật: tăng công suất (mục 7). Không xoá tin trong hàng khi chưa hiểu: video tương ứng sẽ kẹt `queued`.

## 6. Đĩa gần đầy

```bash
df -h /var/lib/docker
docker system df
docker exec <container-video-worker> du -sh /var/tmp/video-work
```

- Worker cần đĩa trống tối thiểu `VIDEO_WORKER_MIN_FREE_DISK_GB` (5) mới nhận việc.
- `/var/tmp/video-work` (volume `video-work`) chỉ chứa tệp tạm. Chỉ dọn tay khi worker đã dừng.
- MinIO là nơi tốn đĩa lâu dài: theo dõi dung lượng bucket và quota tenant. Lúc khảo sát đĩa VPS đã dùng 72%, còn ~100 GB.
- Nhẩm dung lượng: ~19 MB/phút (bình luận), ~30 MB/phút (bài đăng), cộng tiếng.

## 7. Tăng công suất và tạm dừng

- Thêm bản: chạy thêm container `video-worker` (RabbitMQ tự chia việc), mỗi bản có trần CPU/RAM riêng.
- Tăng `VIDEO_WORKER_COMMENT_CONCURRENCY` hoặc `VIDEO_WORKER_POST_CONCURRENCY` (mặc định 1): chỉ sau khi nâng trần CPU
  tương ứng; VPS dùng chung nên đo `docker stats` trước và sau. Nếu VPS không đủ, đặt worker trên máy khác.
- Tạm dừng: dừng container `video-worker`. Tin nằm lại hàng, không mất; việc đang chạy làm lại từ đầu khi chạy lại.

## 8. Triển khai lần đầu trên Coolify

1. Người phụ trách deploy tạo resource `video-worker`. Không tự deploy.
2. Đặt biến môi trường: DB, S3/MinIO, RabbitMQ (cùng tên với `apps/worker`) và các biến `VIDEO_WORKER_*`
   (xem `apps/video-worker/README.md`).
3. Sau khi chạy, kiểm trần bằng `docker stats`: MEM LIMIT khoảng 3 GiB, CPU không quá khoảng 400%. Nếu không, Coolify
   không áp dụng giới hạn từ compose và phải đặt trong cấu hình resource.
4. Kiểm volume `video-work` đã gắn và ghi được vào `/var/tmp/video-work`.
5. Migration `0007-social-video-processing.sql` phải chạy trước (migrator).
6. Mỗi lần deploy cả hệ thống dừng khoảng 2 phút (AGENTS.md): chọn lúc ít người dùng.
7. Kiểm nhanh: tải một video ngắn vào bình luận, thấy `queued`, `processing`, `ready`.

## 9. Giám sát đĩa và băng thông

- Đĩa: cảnh báo khi `/var/lib/docker` trên 85%.
- Băng thông ra: người xem phát từ MinIO, ~2,5 Mbps (720p) và ~4 Mbps (1080p) mỗi luồng; đường ra ~160 Mbps dùng chung
  với ứng dụng khác. Theo dõi bằng thống kê mạng của host hoặc nhà cung cấp VPS.
- Hàng: cảnh báo khi `messages_ready` tăng liên tục hoặc `consumers` bằng 0.

## 10. Rate limiter

Rate limiter của social-api nằm trong bộ nhớ từng tiến trình; chạy nhiều bản thì hạn mức thực tế nhân lên theo số bản.
