# Kịch bản test UI — SAVINA

**Ngày dựng:** 20/08/2026 · **Kiểm chứng:** toàn bộ chuỗi 5 quy trình đã chạy thông bằng đúng các tài khoản dưới đây trước khi viết tài liệu này.

---

## 0. Chuẩn bị

| | |
|---|---|
| Địa chỉ | **http://192.168.88.39:8080** |
| Mật khẩu chung | xem `SEED_TENANT_ADMIN_PASSWORD` trong `.env` |
| Số máy cần | ≥ 3 (mỗi người một máy hoặc một cửa sổ ẩn danh riêng) |

> ⚠️ **IP có thể đổi.** Máy chủ dùng DHCP, trong 2 ngày qua địa chỉ đã đổi 3 lần. Nếu không vào được, hỏi lại người quản trị địa chỉ mới.

> ⚠️ **Không dùng chung một trình duyệt cho hai tài khoản.** Phiên đăng nhập lưu trong cookie; mở tab thứ hai sẽ ghi đè tài khoản đang đăng nhập. Dùng máy khác nhau, hoặc cửa sổ **ẩn danh** riêng cho từng người.

### Người tham gia

| Vai | Họ tên | Email đăng nhập | Đơn vị |
|---|---|---|---|
| **KT** | Trương Quang Bảo Vương | `truong.quang.bao.vuong@savina.local` | Phòng Kỹ thuật |
| **TN** | Nguyễn Tấn Thịnh | `nguyen.tan.thinh@savina.local` | Phòng Thí nghiệm (trưởng phòng) |
| **KT-TC** | Trần Thúy Uyên | `tran.thuy.uyen@savina.local` | Phòng Tài chính - Kế toán |
| **TV** | Nguyễn Vũ Bảo Cường | `nguyen.vu.bao.cuong@savina.local` | Trung tâm Tư vấn |
| **HC** | Nguyễn Trần Như Quỳnh | `nguyen.tran.nhu.quynh@savina.local` | Phòng Hành chính - Tổng hợp |
| **TGĐ** | Hà Nguyên Hoàng | `ha.nguyen.hoang@savina.local` | Ban Tổng Giám đốc |
| **HĐQT** | Nguyễn Hồng Sang | `nguyen.hong.sang@savina.local` | Hội đồng Quản trị |
| **QTV** | Quản trị SAVINA | `admin@savina.local` | toàn quyền |

### Nhân viên Phòng Thí nghiệm — dùng ở Màn 6 (phân rã công việc)

| Họ tên | Email đăng nhập |
|---|---|
| Bùi Công Quyền | `bui.cong.quyen@savina.local` |
| Phan Đức Thắng | `phan.duc.thang@savina.local` |
| Đậu Bá Kiên | `dau.ba.kien@savina.local` |

Ba người còn lại của phòng, dùng khi cần thêm: Bùi Long Quốc Huy (`bui.long.quoc.huy@savina.local`), Trần Quốc Vương (`tran.quoc.vuong@savina.local`).

### Hai điều dễ gây hiểu nhầm, đọc trước khi bắt đầu

**1. Một bước có thể cần nhiều người nối tiếp nhau.** Bước "Cân đối nguồn vốn" đi qua pha **R** rồi mới sang pha **C** — hai người khác nhau, cùng một bước. Thẻ bước hiện *"Đang ở pha R"* / *"Đang ở pha C"* để biết đang chờ ai. Đừng tưởng bước đã xong khi người đầu bấm xong.

**2. Nút hành động khác nhau theo pha.** Pha S, R, E dùng nút **Hoàn thành**; pha C, A dùng nút **Phê duyệt**. Ai không có phần việc ở pha hiện tại sẽ không thấy nút nào — đó là đúng, không phải lỗi.

---

## Câu chuyện xuyên suốt

> Máy biến áp **MBA-T1** tới kỳ bảo trì và cần thay dầu cách điện. Công ty phải: xin **chủ trương đầu tư** → **mua vật tư** → **thanh toán nhà cung cấp** → **mượn dụng cụ đo** → cuối cùng là **bảo trì tại hiện trường**.

Năm màn chạy nối tiếp, mỗi màn là một quy trình thuộc một nhóm khác nhau. Màn cuối là bảo trì.

---

## Màn 1 — Phê duyệt chủ trương đầu tư `QT-CHU-TRUONG-DT`
*Nhóm: Quản trị & Điều hành*

| # | Ai | Làm gì trên giao diện | Kết quả mong đợi |
|---|---|---|---|
| 1.1 | **QTV** · Quản trị SAVINA | Vào **Quy trình → 02 Ma trận RCSI**. Gõ `Phê duyệt chủ trương` vào ô tìm kiếm | Bảng còn 1 dòng. Đếm hiện `1/18 quy trình` |
| 1.2 | **QTV** · Quản trị SAVINA | Bấm vào **tên quy trình** (không cần bấm đúng dấu `+`) | Sổ ra 3 bước, dấu đổi thành `−`. Bấm lại thì thu gọn |
| 1.3 | **QTV** · Quản trị SAVINA | Vào **01 Workspace** → nút **Tạo hồ sơ** → chọn quy trình này, tiêu đề `Chủ trương thay dầu MBA-T1` | Hồ sơ mới hiện đầu danh sách, mã `PR-2026…` |
| 1.4 | **KT** · Trương Quang Bảo Vương | Đăng nhập, mở hồ sơ vừa tạo | Thấy hồ sơ. Bước 1 nền **xanh một nửa** (đang chạy), badge SLA `48h` |
| 1.5 | **KT** · Trương Quang Bảo Vương | Tab **Trao đổi** → gõ `@` rồi chọn Trần Thúy Uyên → gửi | Tên được tô đậm trong dòng vừa gửi |
| 1.6 | **KT** · Trương Quang Bảo Vương | Bấm **Hoàn thành** ở bước 1 | Bước 1 nền xanh **toàn phần** + dấu ✓. Chuyển sang bước 2 |
| 1.7 | **KT-TC** · Trần Thúy Uyên | Đăng nhập, mở hồ sơ, bấm **Hoàn thành** | Bước 2 vẫn ở đó nhưng đổi sang **"Đang ở pha C"** — chưa xong bước |
| 1.8 | **TV** · Nguyễn Vũ Bảo Cường | Đăng nhập, mở hồ sơ, bấm **Phê duyệt** | Bước 2 xanh toàn phần, sang bước 3 |
| 1.9 | **HĐQT** · Nguyễn Hồng Sang | Đăng nhập, bấm **Phê duyệt** | Hồ sơ chuyển **Hoàn thành**, cả 3 bước xanh toàn phần |
| 1.10 | **TGĐ** · Hà Nguyên Hoàng | Mở hồ sơ | Xem được (vai trò I) nhưng **không có nút hành động** — đúng |

---

## Màn 2 — Mua sắm vật tư kỹ thuật `QT-MUA-VT`
*Nhóm: Kho & Cung ứng*

| # | Ai | Làm gì | Kết quả mong đợi |
|---|---|---|---|
| 2.1 | **QTV** · Quản trị SAVINA | Workspace → Tạo hồ sơ `QT-MUA-VT`, tiêu đề `Mua dầu cách điện cho MBA-T1` | |
| 2.2 | **TN** · Nguyễn Tấn Thịnh | Bấm **Hoàn thành** bước 1 | Sang bước 2 |
| 2.3 | **KT** · Trương Quang Bảo Vương | Tab **Tệp đính kèm** → tải lên một ảnh hoặc PDF báo giá | File hiện trong danh sách kèm tên giai đoạn và thời gian |
| 2.4 | **KT** · Trương Quang Bảo Vương | Thử tải một file `.exe` hoặc `.zip` | **Bị chặn**, báo định dạng không được phép |
| 2.5 | **KT** · Trương Quang Bảo Vương | Bấm **Hoàn thành** | Sang bước 3 |
| 2.6 | **KT-TC** · Trần Thúy Uyên | Bấm **Phê duyệt** | Sang bước 4 |
| 2.7 | **TGĐ** · Hà Nguyên Hoàng | Bấm **Phê duyệt** | Hồ sơ **Hoàn thành** |
| 2.8 | **TN** · Nguyễn Tấn Thịnh | Mở lại hồ sơ đã đóng, vào tab Tệp đính kèm | **Vẫn tải file về được** sau khi hồ sơ đóng |

---

## Màn 3 — Nhập kho vật tư vừa mua *(module Kho)*

| # | Ai | Làm gì | Kết quả mong đợi |
|---|---|---|---|
| 3.1 | **TN** · Nguyễn Tấn Thịnh | Vào **Kho & Vật tư** → tab **Tồn kho** | Thấy dải chỉ số và bảng tồn |
| 3.2 | **TN** · Nguyễn Tấn Thịnh | Bấm **Nhập / xuất kho** → chọn `KHO-VT`, vật tư `VT-DAU-MBA`, số lượng `200`, ghi chú `Nhập theo hợp đồng dầu cách điện` → **Nhập kho** | Báo `Đã nhập kho — chứng từ TXN-…`, tồn khả dụng tăng 200 |
| 3.3 | **TN** · Nguyễn Tấn Thịnh | Chuyển chế độ **Xuất kho**, nhập số lượng lớn hơn tồn (VD `999999`) | Cảnh báo **"Vượt tồn khả dụng…"**, nút bị khoá |
| 3.4 | **TN** · Nguyễn Tấn Thịnh | Sang tab **Nhật ký** | Dòng vừa nhập hiện đầu bảng, loại **Nhập kho**, ghi chú đúng |
| 3.5 | **TN** · Nguyễn Tấn Thịnh | Ở tab Tồn kho, bấm vào một dòng | Mở ra nhóm vật tư, ĐVT, tồn tối thiểu/tối đa |
| 3.6 | **TN** · Nguyễn Tấn Thịnh | Bấm **+ Vật tư**, để trống mã rồi lưu | **Bị chặn** với thông báo rõ ràng |

---

## Màn 4 — Thanh toán nhà cung cấp `QT-TT-NCC`
*Nhóm: Tài chính - Kế toán*

| # | Ai | Làm gì | Kết quả mong đợi |
|---|---|---|---|
| 4.1 | **QTV** · Quản trị SAVINA | Tạo hồ sơ `QT-TT-NCC`, tiêu đề `Thanh toán NCC dầu cách điện` | |
| 4.2 | **TN** · Nguyễn Tấn Thịnh | Bấm **Hoàn thành** bước 1 | Sang bước 2 |
| 4.3 | **KT-TC** · Trần Thúy Uyên | Bấm **Hoàn thành** bước 2 | Sang bước 3 |
| 4.4 | **TGĐ** · Hà Nguyên Hoàng | **Trước khi duyệt**, bấm **Trả lại** và chọn quay về **bước 1** | Hồ sơ quay về bước 1, không phải bước 2 — vai trò A được **chọn** bước trả về |
| 4.5 | **TN** · Nguyễn Tấn Thịnh | Bấm **Hoàn thành** lại | Đi tiếp bình thường |
| 4.6 | **KT-TC** · Trần Thúy Uyên → **TGĐ** · Hà Nguyên Hoàng | Hoàn thành → **Phê duyệt** | Hồ sơ **Hoàn thành** |

---

## Màn 5 — Mượn dụng cụ đo `QT-MUON-DC`
*Nhóm: Kho & Cung ứng — quy trình có **kiểm tồn và giữ chỗ vật tư***

Bước 1 cần **2 đôi Găng tay cách điện 24kV** và **1 Sứ cách điện 24kV**.

| # | Ai | Làm gì | Kết quả mong đợi |
|---|---|---|---|
| 5.1 | **QTV** · Quản trị SAVINA | Tạo hồ sơ `QT-MUON-DC`, tiêu đề `Mượn dụng cụ đo cho MBA-T1` | |
| 5.2 | **TN** · Nguyễn Tấn Thịnh | Mở hồ sơ, xem khối **"Vật tư cần cho bước này"** | Hiện *"Đã giữ hàng trong kho cho bước này — RES-…"*, mỗi dòng ghi cần bao nhiêu / còn bao nhiêu |
| 5.3 | **TN** · Nguyễn Tấn Thịnh | Mở module **Kho** ở tab khác, xem tồn `VT-GANG-CD` | Tồn khả dụng **đã giảm 2** so với trước — hàng đang bị giữ |
| 5.4 | **TN** · Nguyễn Tấn Thịnh | Quay lại, bấm **Hoàn thành** bước 1 | Sang bước 2. Kiểm lại Kho: tồn **trả về như cũ** |
| 5.5 | **HC** · Nguyễn Trần Như Quỳnh | Bấm **Hoàn thành** bước 2 | Sang bước 3 |
| 5.6 | **KT** · Trương Quang Bảo Vương | Bấm **Phê duyệt** | Hồ sơ **Hoàn thành** |

### 5b. Thử tình huống thiếu hàng *(tuỳ chọn, nên làm)*

| # | Ai | Làm gì | Kết quả mong đợi |
|---|---|---|---|
| 5b.1 | **TN** · Nguyễn Tấn Thịnh | Vào Kho, **xuất** hết `VT-GANG-CD` ở `KHO-TB` (24 đôi), ghi chú `Tạo tình huống thiếu hàng` | Tồn còn 0 |
| 5b.2 | **QTV** · Quản trị SAVINA | Tạo hồ sơ `QT-MUON-DC` mới | |
| 5b.3 | **TN** · Nguyễn Tấn Thịnh | Mở hồ sơ | Khối vật tư **nền đỏ**: *"Bước bị chặn hoàn tất cho tới khi bổ sung đủ hàng"*, ghi rõ thiếu mấy đôi |
| 5b.4 | **TN** · Nguyễn Tấn Thịnh | Bấm **Hoàn thành** | **Bị chặn**, thông báo nêu đúng tên vật tư và số lượng thiếu |
| 5b.5 | **TN** · Nguyễn Tấn Thịnh | Vào Kho **nhập lại** 24 đôi → quay lại bấm **Kiểm lại tồn kho** | Chuyển sang *"Đã giữ hàng…"*, giờ bấm Hoàn thành được |

---

## Màn 6 — Bảo trì định kỳ MBA-T1 `QT-BT-MBA` *(màn cuối)*
*Nhóm: Kỹ thuật - Chuyên môn*

| # | Ai | Làm gì | Kết quả mong đợi |
|---|---|---|---|
| 6.1 | **QTV** · Quản trị SAVINA | Tạo hồ sơ `QT-BT-MBA`, tiêu đề `Bảo trì định kỳ MBA-T1` | Bước 1 SLA **4h** |
| 6.2 | **TN** · Nguyễn Tấn Thịnh | Bấm **Hoàn thành** bước 1 | Sang bước 2, SLA **1h** |
| 6.3 | **KT** · Trương Quang Bảo Vương | Chờ hơn 1 giờ **hoặc** xem hồ sơ cũ đã quá hạn | Badge SLA chuyển **đỏ "Quá …"** |
| 6.4 | **KT** · Trương Quang Bảo Vương | Bấm **Hoàn thành** bước 2 | Sang bước 3 — pha **E**, phân rã công việc |
| 6.5 | **TN** · Nguyễn Tấn Thịnh | Tab **Phân rã việc** → chọn **Tuần tự** → tạo 3 đầu việc, trọng số `40/30/30`, giao lần lượt cho **Bùi Công Quyền**, **Phan Đức Thắng**, **Đậu Bá Kiên** → Lưu | Ba đầu việc hiện kèm số thứ tự 1·2·3 |
| 6.6 | **Bùi Công Quyền** | Đăng nhập, mở hồ sơ, tìm việc của mình, bấm **Xong** ngay | **Bị chặn**: phải đính kèm tài liệu trước |
| 6.7 | **Phan Đức Thắng** | Thử làm **việc số 2** trước | **Bị chặn**: *"phải xong việc 1 trước"* — đúng nghĩa tuần tự |
| 6.8 | **Bùi Công Quyền** | Tải lên một ảnh làm bằng chứng → bấm **Xong** | Việc 1 chuyển Xong. Thẻ bước 3 **tăng phần nền xanh** |
| 6.9 | **Phan Đức Thắng**, **Đậu Bá Kiên** | Lần lượt đính kèm và báo xong | Nền xanh của bước 3 tăng dần theo trọng số |
| 6.10 | **TN** · Nguyễn Tấn Thịnh | Bấm **Hoàn thành** bước 3 | Bước chuyển sang **pha C** — vẫn bước 3 |
| 6.11 | **KT** · Trương Quang Bảo Vương | Bấm **Phê duyệt** | Sang bước 4 |
| 6.12 | **TGĐ** · Hà Nguyên Hoàng | Bấm **Phê duyệt** | Hồ sơ **Hoàn thành**, cả 4 bước xanh toàn phần |

---

## Màn 7 — Module Bảo trì

| # | Ai | Làm gì | Kết quả mong đợi |
|---|---|---|---|
| 7.1 | **QTV** · Quản trị SAVINA | Vào **Bảo trì → Ma trận bảo trì** | Bảng thiết bị × tần suất |
| 7.2 | **QTV** · Quản trị SAVINA | Bấm nút **"N đầu việc (Kho)"** ở dòng `MBA-T1` | Panel mở **ngay tại trang Bảo trì**, liệt kê 5 đầu việc kèm số phút. **URL không đổi sang module Kho** |
| 7.3 | **QTV** · Quản trị SAVINA | Bấm **+ Lịch bảo trì** → ô thiết bị gõ `MBA` | Gợi ý từ danh mục Kho, hiện tên thiết bị bên dưới |
| 7.4 | **QTV** · Quản trị SAVINA | Gõ mã không có thật rồi bấm Lưu | **Bị chặn**: *"Không có thiết bị nào mã … trong Kho"* |
| 7.5 | **QTV** · Quản trị SAVINA | Bấm **Tạo sự cố** → thiết bị `MBA-T1`, tiêu đề tuỳ ý, chọn quy trình xử lý `QT-SC-DOTXUAT` | Sinh phiếu sự cố **và** một workorder mới bên Quy trình |
| 7.6 | **QTV** · Quản trị SAVINA | Chạy hết workorder đó (hoặc **Huỷ** nó) | Sau vài giây, phiếu bảo trì tự chuyển **Hoàn thành** (nếu chạy hết) hoặc **Thất bại** (nếu huỷ) |
| 7.7 | **QTV** · Quản trị SAVINA | Vào tab **Lịch sử**, lọc theo thiết bị `MBA-T1` | Thấy cả bảo trì định kỳ và sự cố trong cùng một danh sách |

---

## Màn 8 — Phân quyền *(cần đúng 2 máy)*

Tài khoản **TN** đã được cấp thêm vai trò *Vận hành kho & bảo trì*; các tài khoản còn lại thì không.

| # | Ai | Làm gì | Kết quả mong đợi |
|---|---|---|---|
| 8.1 | **TN** · Nguyễn Tấn Thịnh | Kho → **Nhập / xuất kho** | **Làm được** |
| 8.2 | **TN** · Nguyễn Tấn Thịnh | Kho → **+ Vật tư** | **Bị chặn** — không có quyền sửa danh mục |
| 8.3 | **TN** · Nguyễn Tấn Thịnh | Bảo trì → **Tạo sự cố** | **Làm được** |
| 8.4 | **TN** · Nguyễn Tấn Thịnh | Bảo trì → **+ Lịch bảo trì** | **Bị chặn** — không có quyền sửa cấu hình |
| 8.5 | **KT** · Trương Quang Bảo Vương | Mở module **Kho** | **Không vào được** — chưa được cấp quyền kho |
| 8.6 | **QTV** · Quản trị SAVINA | Làm lại 8.1–8.4 | **Làm được tất cả** |

---

## Màn 9 — Danh sách và bộ lọc

| # | Ai | Làm gì | Kết quả mong đợi |
|---|---|---|---|
| 9.1 | **QTV** · Quản trị SAVINA | Ma trận → ô chọn nhóm, lần lượt qua cả 6 nhóm | Mỗi nhóm **3 quy trình**, tổng 18 |
| 9.2 | **QTV** · Quản trị SAVINA | Ma trận → tìm `Phòng Tài chính` | Chỉ còn các quy trình có Tài chính tham gia — **tìm được theo đơn vị**, không chỉ theo tên |
| 9.3 | **QTV** · Quản trị SAVINA | Workspace → đổi **Sắp xếp** sang *cũ nhất trước* | Thứ tự đảo lại |
| 9.4 | **QTV** · Quản trị SAVINA | Workspace, khi có hơn 20 hồ sơ | Thanh phân trang hiện `1–20 trên N`, bấm **Sau →** ra trang 2 |
| 9.5 | **QTV** · Quản trị SAVINA | Workspace → lọc trạng thái **Đã huỷ** | Chỉ hiện hồ sơ đã huỷ |
| 9.6 | **QTV** · Quản trị SAVINA | Ma trận → bấm **Xoá** ở một quy trình **đang có hồ sơ** | Hỏi xác nhận kèm tên; sau khi đồng ý thì **bị chặn**, báo còn bao nhiêu hồ sơ dùng nó |

---

## Ghi lại lỗi

Khi gặp lỗi, ghi giúp: **màn/bước số mấy · tài khoản nào · thấy gì · mong đợi gì**, kèm ảnh chụp màn hình. Nếu trang trắng hoặc treo, mở **F12 → Console** và chụp cả phần báo đỏ.

## Đã biết trước, không cần báo

- **Bí mật hệ thống vẫn là giá trị mẫu** — chỉ dùng trong mạng nội bộ, đang chờ đổi.
- Một số đơn vị trong sơ đồ tổ chức **chưa có nhân sự** (Phòng Vận hành - Bảo trì, Ban Cố vấn, Khối Thí nghiệm). Vai trò gán vào đó sẽ không có ai thao tác được; các quy trình trong kịch bản này đã tránh những đơn vị đó.
- Nhắc tên bằng `@` chỉ tô đậm để dễ đọc, **không gửi thông báo** cho người được nhắc.
