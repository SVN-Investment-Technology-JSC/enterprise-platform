# Chấm công theo địa điểm GPS (gộp "Quy định chấm công" và "Địa điểm GPS")

Mục "Địa điểm GPS" trong Trung tâm cấu hình HRM (Chấm công) là nơi duy nhất khai báo kiểm tra vị trí khi chấm công. Mục
"Quy định chấm công" (phiên bản chính sách theo ngày hiệu lực) không còn trên giao diện.

## Mô hình

- **Địa điểm** (`hrm_schema.attendance_sites`): tên, tọa độ, bán kính, và `allowed_ips` (IP hoặc CIDR, tùy chọn).
- **Phòng ban được chấm công tại địa điểm** (`attendance_site_assignments`, migration 0070): toàn công ty, đơn vị (kế thừa xuống
  mọi đơn vị con), chức danh, hoặc nhân viên. Giao diện quản lý toàn công ty và đơn vị; phân công chức danh/nhân viên có sẵn
  được giữ nguyên khi lưu.
- **Cài đặt chung** (`attendance_settings`, migration 0071): bật/tắt kiểm tra vị trí và sai số GPS tối đa (1 đến 1000 m).

## Luật kiểm khi chấm công (web)

Khi kiểm tra vị trí đang bật, lượt chấm công hợp lệ khi nhân viên **nằm trong bán kính của một địa điểm được gán cho họ** và,
nếu địa điểm đó khai báo IP, **đúng một IP của chính địa điểm đó** (đạt cả hai). Địa điểm không khai báo IP thì chỉ cần đúng vị
trí. Sai số GPS phải không vượt giá trị trong cài đặt chung.

- Tenant chưa gán địa điểm nào cho ai: mọi nhân viên dùng được mọi địa điểm đang dùng.
- Tắt kiểm tra vị trí: không cần GPS và không kiểm IP.

## Chuyển từ cấu hình cũ

Migration 0071 chuyển chính sách chấm công đang hiệu lực cho toàn công ty:

| Chính sách cũ | Sau khi chuyển |
|---|---|
| Bắt GPS (có hoặc không IP) | Bật kiểm tra vị trí, giữ sai số; nếu bắt cả IP thì danh sách IP chung thành IP của mọi địa điểm đang dùng |
| Chỉ bắt IP (không GPS) | Giữ cấu hình cũ (`legacy_policy`) cho tới khi khai báo GPS và lưu cài đặt mới |
| Không bắt gì | Tắt kiểm tra vị trí |

Tenant chưa có dòng trong `attendance_settings` vẫn theo cờ `requireGps`/`requireIp` trong chính sách như trước.
Phiên bản chính sách theo phạm vi riêng một số nhân viên không còn tác dụng với vị trí khi tenant đã chuyển sang cài đặt mới;
dùng phân công địa điểm theo phòng ban hoặc nhân viên thay thế. Múi giờ vẫn đọc từ chính sách chấm công hiện có.

## API (`/api/hrm/v1/time-settings`, quyền `hrm.time.configure`)

- `GET /` thêm `units` (đơn vị để gán), `location` (cài đặt chung) và `allowed_ips` trong từng địa điểm.
- `POST /sites`, `PATCH /sites/:id`: nhận thêm `allowedIps` (tối đa 50 mục, hợp lệ theo `validIpRule`).
- `PUT /location`: `{ locationCheck, maxGpsAccuracyMeters, reason? }`; bật khi chưa có địa điểm nào đang dùng bị từ chối; ghi
  nhật ký `LOCATION_SETTINGS_UPDATED`.
- `PUT /sites/:id/assignments`: gán phòng ban (đã có từ migration 0070).
