# Công cụ thử tải video (Mạng nội bộ)

Bộ công cụ Node ESM (Node 24, không cần cài gói; ký URL bằng `node:crypto`) để kiểm tra phần video của module Mạng nội bộ:
tải thẳng lên MinIO, xem thẳng từ MinIO bằng URL ký (Range), và chuyển mã ở nền bằng ffmpeg.
Các công cụ đo tầng kho object và ffmpeg, **không đo API** (API không nằm trên đường truyền byte).

Kết nối MinIO đọc theo thứ tự: biến môi trường, `.env` ở gốc repo, rồi mặc định dev
(`S3_PUBLIC_ENDPOINT` hoặc `S3_ENDPOINT` hoặc `S3_INTERNAL_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`), giống `s3-attachment-storage.ts`. Mọi khoá thử nằm dưới tiền tố `tmp-test/`
(các script từ chối tiền tố khác) và được dọn sau khi chạy.

Tệp sinh ra mặc định để ở `tools/load-test/.fixtures/` và `urls*.json` (đã `.gitignore` cục bộ). Không commit chúng.

## 1. Fixtures: `fixtures/generate.mjs`

```bash
node tools/load-test/fixtures/generate.mjs --out tools/load-test/.fixtures          # ~20 tệp, ~75 MB, ~45 giây
node tools/load-test/fixtures/generate.mjs --out tools/load-test/.fixtures --big    # thêm big-320mb.mp4 và big-1100mb.mp4
node tools/load-test/fixtures/generate.mjs --out <thư mục> --only 4k                # chỉ tệp có tên chứa "4k" (manifest được gộp)
```

Mỗi tệp được ghi vào `manifest.json` cùng kết quả mong đợi: `accepted` (true, false hoặc `depends` khi hai ngữ cảnh
khác nhau), `reason`, và riêng cho `comment` / `post`: `accepted`, `outputShortSide` (cạnh ngắn đầu ra mong đợi, không
phóng to; bình luận <= 720, bài đăng <= 1080) cùng `probed` (ffprobe thật của tệp sinh ra). Các `reason` dùng: `no-video-stream`,
`empty-file`, `corrupt-or-truncated`, `invalid-signature`, `input-resolution-too-high`, `duration-exceeds-limit`, `file-too-large`.
Đây là kỳ vọng theo luật nghiệp vụ; tên mã lý do thật của miền chuyển mã có thể khác, so theo `accepted` và ngữ cảnh.

| Tệp | Mong đợi |
|---|---|
| good-720p-10s.mp4 | nhận; 720p cho cả hai ngữ cảnh |
| good-1080p-30s.mp4 | nhận; bình luận 720p, bài đăng 1080p |
| good-4k-5s.mp4 | nhận; bình luận 720p, bài đăng 1080p |
| small-360p-5s.mp4 | nhận; vẫn 360p (không phóng to) |
| portrait-1080x1920-rotated.mp4 | nhận; lưu 1920x1080 + xoay 90 độ, hiển thị dọc; tính kích thước sau khi xoay |
| odd-853x479.mp4 | nhận; H.264 4:4:4 cạnh lẻ, đầu ra phải chẵn |
| vfr-60fps.mp4 | nhận; tốc độ khung thay đổi |
| no-audio.mp4 | nhận; không có tiếng |
| hevc-iphone-like.mov | nhận; HEVC `hvc1` trong .mov |
| webm-vp9.webm | nhận; VP9 + Opus |
| hdr-10bit.mp4 | nhận; HEVC 10-bit bt2020/PQ (đầu ra 8-bit, nên tone-map) |
| audio-only.mp4 | từ chối: không có luồng hình |
| zero-byte.mp4 | từ chối: tệp rỗng |
| truncated.mp4 | từ chối: mất moov |
| zip-renamed.mp4 | từ chối: chữ ký sai |
| 8k-1s.mp4 | từ chối: cạnh dài 7680 > 4096 |
| too-long-comment-200s.mp4 | bình luận từ chối (200 s > 180 s), bài đăng nhận |
| too-long-post-650s.mp4 | từ chối cả hai (650 s > 600 s) |
| exactly-at-limit-comment-180s.mp4 | nhận (đúng 180,000 s, không tiếng) |
| exactly-at-limit-post-600s.mp4 | bài đăng nhận (đúng 600,000 s), bình luận từ chối |
| big-320mb.mp4 (`--big`) | bình luận từ chối (320 MiB > 300 MiB), bài đăng nhận |
| big-1100mb.mp4 (`--big`) | từ chối cả hai (> 1 GiB) |

Điều gì làm tệp tốn thời gian hoặc dung lượng:

- Tệp có độ phân giải cao tốn thời gian sinh: `8k-1s` (khoảng 8 giây, 4-5 MB dù chỉ 1 giây), `hdr-10bit` (x265, ~7 giây),
  `good-4k-5s` (15 MB). Mọi tệp dùng `testsrc2` và `ultrafast`, nên nhiễu hình lớn và dung lượng cao hơn video thật cùng chất lượng.
- Tệp dài (180/200/600/650 s) dùng 320x180, 5 hoặc 25 fps, bitrate 20 kbps nên chỉ 0,5 đến 1,6 MB; thời gian sinh
  chủ yếu là ghi khung hình.
- `--big` ghi 320 MiB và 1100 MiB xuống đĩa. Tệp là mp4 hợp lệ (moov ở đầu) cộng một hộp `free` toàn số 0 làm đệm,
  nên ffprobe vẫn đọc được. Sinh nhanh (~1 giây, phụ thuộc đĩa) nhưng **tải lên rất tốn**: 1,1 GB qua đường vào/ra
  của VPS (160/336 Mbps) mất khoảng 1 đến 1,5 phút mỗi tệp khi chỉ một luồng, và 3 tệp song song dùng hết đường ra/vào.
  Nhớ xoá sau khi thử (`rm tools/load-test/.fixtures/big-*.mp4`).

## 2. Ký URL: `presign.mjs`

```bash
# Tải fixtures chọn lọc lên tmp-test/viewers/ rồi xuất urls.json (URL GET sống 1 giờ)
node tools/load-test/presign.mjs --upload tools/load-test/.fixtures --prefix tmp-test/viewers/ \
  --include good-720p,good-1080p,small --out tools/load-test/urls.json
# Ký lại các khoá sẵn có, kèm URL PUT, TTL ngắn (giả lập hết hạn)
node tools/load-test/presign.mjs --prefix tmp-test/viewers/ --ttl 5 --put --out tools/load-test/urls-short.json
# Dọn
node tools/load-test/presign.mjs --prefix tmp-test/viewers/ --cleanup
```

Tham số: `--prefix` (bắt buộc bắt đầu bằng `tmp-test/`), `--upload <thư mục>`, `--include a,b` (lọc theo tên), `--ttl <giây>`
(mặc định 3600), `--put`, `--out`, `--cleanup`, `--bucket`. `urls.json` gồm `items[]`: `key`, `name`, `bytes`, `durationSeconds`, `get`, `put?`.

## 3. Người xem: `viewers.mjs`

```bash
node tools/load-test/viewers.mjs --urls tools/load-test/urls.json --mode same --clients 10 --seconds 30
node tools/load-test/viewers.mjs --urls tools/load-test/urls.json --mode different --clients 20 --seconds 30 --pattern seek
```

| Tham số | Ý nghĩa |
|---|---|
| `--mode same\|different` | mọi client xem cùng một video (`--index N` chọn video) hoặc mỗi client một video (xoay vòng) |
| `--clients N`, `--seconds S` | số người xem và thời gian chạy |
| `--pattern start\|seek\|tail` | đọc từ đầu theo đoạn; nhảy 25/50/75% rồi đọc 3 đoạn; đọc cuối tệp (moov) lặp lại |
| `--chunk-kb` | kích thước mỗi Range (mặc định 1024) |
| `--bitrate-mbps` | tốc độ phát giả lập (mặc định 2,5); `--prebuffer-seconds` (mặc định 5) cho phép đọc nhanh phần đệm đầu như trình phát thật; `--unthrottled` bỏ điều tiết |
| `--uplink-mbps` | đường ra dùng cho dòng tóm tắt (mặc định 160) |
| `--max-ttfb-ms` | ngưỡng p95 thời gian tới byte đầu (mặc định 2000) |
| `--max-error-rate` | ngưỡng tỉ lệ yêu cầu lỗi, 0 đến 1 (mặc định 0) |
| `--expect-status 403` | ca URL hết hạn: coi mã đó là đúng, mỗi client thử một lần |

Kết quả: p50/p95/max thời gian tới byte đầu (và riêng sau khi tua), tổng và mỗi luồng MiB/s, Mbit/s, số yêu cầu Range, số lỗi
theo mã, và dòng tóm tắt số luồng 720p (2,5 Mbps) / 1080p (4 Mbps) mà đường ra chịu được (có thêm số liệu chừa 20% dự phòng).
Thoát mã khác 0 khi có mã khác 206 (kể cả 200: máy chủ bỏ qua Range) hoặc vượt ngưỡng. Vì có phần đệm đầu, 10 đến 30 giây đo
đầu cao hơn tốc độ phát; chạy từ 60 giây trở lên để số đo tiệm cận bitrate thật.

## 4. Tải lên: `uploads.mjs`

```bash
node tools/load-test/uploads.mjs --size-mb 20 --clients 3
node tools/load-test/uploads.mjs --size-mb 300 --clients 10 --multipart      # 8 MiB x 3 song song mỗi client
```

Tham số: `--size-mb`, `--clients`, `--multipart`, `--part-parallel` (3), `--max-error-rate` (0), `--keep` (không dọn).
In thời gian mỗi tệp p50/p95/max, MiB/s và Mbit/s, số lỗi, RSS đỉnh của tiến trình Node. Dữ liệu stream (PUT) hoặc đệm 8 MiB
(multipart); ghi `tmp-test/uploads-<id>/` rồi xoá. Máy chạy cần đủ RAM cho `clients x 3 x 8 MiB` ở chế độ multipart.

## 5. Chuyển mã mẫu: `benchmark-ffmpeg.mjs`

```bash
node tools/load-test/benchmark-ffmpeg.mjs --input tools/load-test/.fixtures/good-1080p-30s.mp4 --height 1080 --threads 2 --runs 2
```

Chạy `libx264 -preset veryfast -crf 23 -maxrate 2500k|4000k -pix_fmt yuv420p -c:a aac -movflags +faststart -threads N`
(`--preset` đổi preset). In theo từng lần và trung bình: hệ số thời gian thực (thời lượng / thời gian chạy), MiB/phút đầu ra,
CPU tiêu tốn và số nhân trung bình (từ `-benchmark`), RSS đỉnh (Linux đọc `VmHWM` trong `/proc`; Windows in "không đo được").
Lưu ý hình `testsrc2` nhiều chi tiết nên thường chậm và nặng hơn video quay thật; đo trên video thật của người dùng để có số sát hơn.

## 6. Bảng ca thử

Đường ra tham khảo 160 Mbps (speedtest), vào 336 Mbps. 720p = 2,5 Mbps, 1080p = 4 Mbps nên lý thuyết ~64 luồng 720p
hoặc ~40 luồng 1080p; chừa 20% dự phòng còn ~51 / ~32.

| Ca | Cách chạy | Đạt | Không đạt |
|---|---|---|---|
| 10 người xem cùng 1 video | `viewers.mjs --mode same --clients 10 --seconds 60` với video 1080p | exit 0; p95 byte đầu <= 2000 ms; 100% mã 206; mỗi luồng >= 4 Mbit/s | có mã khác 206, p95 > 2 s, luồng đo thấp hơn bitrate |
| 20 người xem 20 video khác nhau | tải 20 fixtures khác nhau (hoặc lặp `good-*`) rồi `--mode different --clients 20` | như trên; tổng Mbit/s <= đường ra thực tế | lỗi, hoặc tổng vượt đường ra |
| Tua giữa video | `--pattern seek --clients 10` | p95 "sau khi tua" <= 1500 ms, 100% 206 | tua > 3 s hoặc 200 thay vì 206 |
| Lấy moov (tail) | `--pattern tail --clients 10` | p95 byte đầu <= 1000 ms | > 2 s |
| Xem khi đang chuyển mã | chạy `benchmark-ffmpeg.mjs --threads <số nhân> --runs 3` trong cửa sổ khác rồi `viewers.mjs --clients 20 --seconds 60` | p95 byte đầu <= 2000 ms, không lỗi (xem CPU/đĩa dùng chung ảnh hưởng thế nào) | p95 tăng gấp nhiều lần so với lúc rảnh |
| Tải 10 tệp 300 MB đồng thời | `uploads.mjs --size-mb 300 --clients 10 --multipart` (và không `--multipart` để so sánh) | 10/10 thành công; thời gian ~ (3000 MB / đường vào); RSS Node trong tầm kiểm soát | lỗi, treo, kho đầy |
| 3 video 1 GB cho một bài đăng | sinh `--big`, `uploads.mjs --size-mb 1024 --clients 3 --multipart` | 3/3 thành công; thời gian ~ (3 GB / đường vào) | lỗi giữa chừng, không dọn được phần dở |
| Vượt trần dung lượng | tải `big-320mb.mp4` vào bình luận và `big-1100mb.mp4` vào bài đăng qua giao diện/API | bị chặn trước hoặc sau khi tải với thông báo tiếng Việt rõ ràng | cho qua |
| URL hết hạn | `presign.mjs --ttl 5`, chờ 6 giây, `viewers.mjs --urls urls-short.json --expect-status 403`; ngoài ra thử mở trang xem lâu hơn TTL trên giao diện: trình phát phải xin URL mới | exit 0 (đều 403); giao diện tự làm mới URL | 200/206 sau hạn, hoặc video lỗi không tự phục hồi |
| Các ca chuyển mã | tải từng tệp trong `manifest.json` lên bình luận/bài đăng, so trạng thái và `outputShortSide` thật với manifest | mọi tệp khớp `accepted`/`reason`/chiều cao; tệp bị từ chối có thông báo tiếng Việt | nhận nhầm tệp hỏng, từ chối nhầm tệp hợp lệ, phóng to 360p |

Hạn chế quan trọng: **thử trên máy dev không đo được băng thông thật của VPS**. MinIO local chạy trên loopback nên thông lượng
hàng trăm MiB/s (đã đo ~880 Mbit/s với 10 client không điều tiết), không phản ánh đường ra 160 Mbps. Số đo trên máy dev chỉ
kiểm tra tính đúng (Range, mã trả về, tua, hết hạn) và độ trễ xử lý của MinIO. Muốn biết sức chịu tải thật, chạy từ một máy
khác mạng với địa chỉ công khai của MinIO, hoặc dùng `iperf3`/speedtest để lấy đường truyền, rồi suy ra từ dòng tóm tắt.

## 7. Chạy trên VPS

```bash
# Máy VPS (hoặc container có Node 24 và ffmpeg), mã nguồn tools/load-test được sao chép sang
export S3_PUBLIC_ENDPOINT=https://<địa chỉ công khai của MinIO>   # URL ký phải khớp host mà client dùng
export S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...   # không ghi vào repo hay lịch sử shell chung

# 1. Đo ffmpeg (đại diện cho tải worker; để các ứng dụng khác chạy bình thường để thấy ảnh hưởng thật)
docker exec <container-video-worker> node tools/load-test/benchmark-ffmpeg.mjs --input /tmp/good-1080p-30s.mp4 --height 1080 --threads 2 --runs 2
# 2. Đo kho object và người xem, ưu tiên chạy từ máy ngoài VPS để đường ra là đường thật
node tools/load-test/presign.mjs --upload ./fixtures --prefix tmp-test/viewers/ --include good-
node tools/load-test/viewers.mjs --urls urls.json --mode same --clients 10 --seconds 60 --uplink-mbps 160
node tools/load-test/presign.mjs --prefix tmp-test/viewers/ --cleanup
```

Quy tắc khi chạy trên VPS dùng chung (10 CPU/18 GB với hơn 12 ứng dụng khác): thử ngoài giờ cao điểm, tăng tải dần
(5, 10, 20 client), theo dõi CPU/RAM bằng Coolify hoặc `docker stats`, dừng ngay nếu các ứng dụng khác chậm, không chạy
`--big` nhiều tệp song song khi chưa báo người phụ trách hạ tầng, và luôn dọn `tmp-test/` sau khi chạy.
