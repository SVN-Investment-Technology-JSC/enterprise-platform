# Tài khoản nhân sự — tenant SAVINA

> Dữ liệu demo cục bộ, xuất trực tiếp từ database `platform` ngày 18/08/2026.
> Tổng **42 tài khoản**: 1 quản trị · 10 người phụ trách đơn vị · 31 nhân viên.

## Cách đăng nhập

| | |
|---|---|
| Cổng | `http://localhost:8080/tenant/login` (test qua LAN thì thay `localhost` bằng IP máy chủ) |
| Mật khẩu | Mọi tài khoản dùng chung giá trị `SEED_TENANT_ADMIN_PASSWORD` trong `.env` — hiện là `replace-with-a-local-secret` |
| Sau đăng nhập | Trang chủ doanh nghiệp `/t/savina`, từ đó vào Sơ đồ tổ chức và các phân hệ đã mua |

Muốn đổi mật khẩu chung: sửa `SEED_TENANT_ADMIN_PASSWORD` trong `.env` rồi chạy lại `pnpm db:provision`.

## Quản trị tenant

| Họ tên | Email đăng nhập | Đơn vị — Chức danh |
|---|---|---|
| Quản trị SAVINA | `admin@savina.local` | (chưa gán đơn vị) |

Tài khoản này giữ `procedure.manage`: thấy toàn bộ đơn của doanh nghiệp, thiết kế được ma trận RCSI, và hành động bằng **quyền override** kể cả khi không giữ vai trò RACI nào.

## Người phụ trách đơn vị — 10 người

Phân công RACI ở **cấp đơn vị** định tuyến tới đúng những người này, nên đây là các tài khoản dùng để demo luồng phê duyệt.

| Họ tên | Email đăng nhập | Đơn vị — Chức danh |
|---|---|---|
| Bùi Hữu Vân | `bui.huu.van@savina.local` | Phòng Kinh doanh — Phó Trưởng phòng Kinh doanh **(phụ trách)** ; Văn phòng Đại diện Miền Nam — Phó Trưởng phòng Kinh doanh |
| Đậu Xuân Thanh | `dau.xuan.thanh@savina.local` | Văn phòng Đại diện Miền Nam — Trưởng Văn phòng Đại diện **(phụ trách)** ; Ban Tổng Giám đốc — Phó Tổng Giám đốc |
| Hà Nguyên Hoàng | `ha.nguyen.hoang@savina.local` | Ban Tổng Giám đốc — Tổng Giám đốc **(phụ trách)** |
| Nguyễn Duy Thuận | `nguyen.duy.thuan@savina.local` | Văn phòng Đại diện Tây Nguyên — Trưởng Văn phòng Đại diện **(phụ trách)** ; Ban Tổng Giám đốc — Phó Tổng Giám đốc |
| Nguyễn Hồng Sang | `nguyen.hong.sang@savina.local` | Hội đồng Quản trị — Chủ tịch Hội đồng Quản trị **(phụ trách)** ; Công ty CP Đầu tư Năng lượng Tiền Phong — Tổng Giám đốc **(phụ trách)** ; Công ty Cổ phần Đầu tư Năng lượng Tiền Phong — Tổng Giám đốc **(phụ trách)** |
| Nguyễn Tấn Thịnh | `nguyen.tan.thinh@savina.local` | Phòng Thí nghiệm — Trưởng phòng Thí nghiệm **(phụ trách)** |
| Nguyễn Trần Như Quỳnh | `nguyen.tran.nhu.quynh@savina.local` | Phòng Hành chính - Tổng hợp — Trưởng phòng Hành chính - Tổng hợp **(phụ trách)** |
| Nguyễn Vũ Bảo Cường | `nguyen.vu.bao.cuong@savina.local` | Trung tâm Tư vấn — Phó Giám đốc Trung tâm **(phụ trách)** |
| Trần Thúy Uyên | `tran.thuy.uyen@savina.local` | Phòng Tài chính - Kế toán — Kế toán trưởng **(phụ trách)** ; Công ty CP Đầu tư Năng lượng Tiền Phong — Kế toán trưởng ; Công ty Cổ phần Đầu tư Năng lượng Tiền Phong — Kế toán trưởng |
| Trương Quang Bảo Vương | `truong.quang.bao.vuong@savina.local` | Phòng Kỹ thuật — Phó phòng Kỹ thuật - Dịch vụ **(phụ trách)** ; Văn phòng Đại diện Miền Nam — Phó phòng Kỹ thuật - Dịch vụ |

## Nhân viên — 31 người

Chưa giữ vai trò RACI nào trong 4 quy trình demo, nên Workspace của họ đang trống. Dùng để demo việc **gán vai trò cho cá nhân**: trong ma trận RCSI, sổ cột xuống tới cấp chức danh rồi cấp cá nhân.

| Họ tên | Email đăng nhập | Đơn vị — Chức danh |
|---|---|---|
| Bùi Công Quyền | `bui.cong.quyen@savina.local` | Phòng Thí nghiệm — Nhân viên thí nghiệm |
| Bùi Duy Khánh | `bui.duy.khanh@savina.local` | Văn phòng Đại diện Miền Nam — Nhân viên kỹ thuật |
| Bùi Long Quốc Huy | `bui.long.quoc.huy@savina.local` | Phòng Thí nghiệm — Nhân viên kỹ thuật |
| Cao Khánh Ngọc | `cao.khanh.ngoc@savina.local` | Phòng Hành chính - Tổng hợp — Nhân viên marketing |
| Đậu Bá Kiên | `dau.ba.kien@savina.local` | Phòng Thí nghiệm — Chuyên viên thí nghiệm |
| Đồng Trịnh Bảo | `dong.trinh.bao@savina.local` | Trung tâm Tư vấn — Nhân viên tư vấn thiết kế |
| Huỳnh Kim Việt | `huynh.kim.viet@savina.local` | Phòng Kinh doanh — Chuyên viên kinh doanh |
| Huỳnh Thị Đông | `huynh.thi.dong@savina.local` | Phòng Hành chính - Tổng hợp — Tạp vụ |
| Huỳnh Thị Hồng Nhung | `huynh.thi.hong.nhung@savina.local` | Văn phòng Đại diện Tây Nguyên — Nhân viên hành chính - văn thư |
| Huỳnh Văn Trọng | `huynh.van.trong@savina.local` | Văn phòng Đại diện Tây Nguyên — Nhân viên thí nghiệm |
| Lê Thị Tố Nga | `le.thi.to.nga@savina.local` | Phòng Tài chính - Kế toán — Chuyên viên tài chính |
| Ngô Tấn Trinh | `ngo.tan.trinh@savina.local` | Công ty CP Đầu tư Năng lượng Tiền Phong — Phó Tổng Giám đốc |
| Nguyễn Hữu Hưng | `nguyen.huu.hung@savina.local` | Phòng Kinh doanh — Nhân viên kinh doanh |
| Nguyễn Minh Ý | `nguyen.minh.y@savina.local` | Văn phòng Đại diện Miền Nam — Nhân viên hành chính - văn thư |
| Nguyễn Thị Diễm My | `nguyen.thi.diem.my@savina.local` | Phòng Kinh doanh — Nhân viên kinh doanh |
| Nguyễn Thị Thủy | `nguyen.thi.thuy@savina.local` | Phòng Hành chính - Tổng hợp — Nhân viên hành chính - văn thư |
| Nguyễn Vũ Hậu | `nguyen.vu.hau@savina.local` | Văn phòng Đại diện Miền Nam — Nhân viên kỹ thuật |
| Phạm Việt Quân | `pham.viet.quan@savina.local` | Phòng Hành chính - Tổng hợp — Lái xe cơ quan |
| Phan Đức Thắng | `phan.duc.thang@savina.local` | Phòng Thí nghiệm — Nhân viên thí nghiệm |
| Phan Thị Diệu Thúy | `phan.thi.dieu.thuy@savina.local` | Phòng Tài chính - Kế toán — Nhân viên |
| Phan Trung Kiên | `phan.trung.kien@savina.local` | Văn phòng Đại diện Miền Nam — Nhân viên kỹ thuật |
| Quách Văn Quý | `quach.van.quy@savina.local` | Trung tâm Tư vấn — Chuyên gia kỹ thuật |
| Tạ Quang Hoàng | `ta.quang.hoang@savina.local` | Trung tâm Tư vấn — Nhân viên tư vấn thiết kế |
| Trần Cao Vũ | `tran.cao.vu@savina.local` | Văn phòng Đại diện Tây Nguyên — Lễ tân VPĐD Đắk Lắk |
| Trần Quang Bình | `tran.quang.binh@savina.local` | Văn phòng Đại diện Tây Nguyên — Phó Trưởng phòng Thí nghiệm |
| Trần Quốc Vương | `tran.quoc.vuong@savina.local` | Phòng Thí nghiệm — Nhân viên thí nghiệm |
| Trần Thị Tố Uyên | `tran.thi.to.uyen@savina.local` | Phòng Tài chính - Kế toán — Chuyên viên kế toán |
| Trần Văn Cường | `tran.van.cuong@savina.local` | Phòng Hành chính - Tổng hợp — Bảo vệ |
| Trần Văn Quốc | `tran.van.quoc@savina.local` | Trung tâm Tư vấn — Nhân viên tư vấn thiết kế |
| Trần Văn Thìn | `tran.van.thin@savina.local` | Văn phòng Đại diện Tây Nguyên — Chuyên viên thí nghiệm |
| Võ Tuấn Kiệt | `vo.tuan.kiet@savina.local` | Văn phòng Đại diện Miền Nam — Nhân viên kỹ thuật |

## Ai xử lý được quy trình demo nào

4 quy trình demo đều gán vai trò ở cấp đơn vị. Bảng dưới là người thực nhận việc:

| Đơn vị được gán | Người nhận việc | Xuất hiện trong |
|---|---|---|
| Ban Tổng Giám đốc | Hà Nguyên Hoàng | `QT-BT-MBA` (A) · `QT-MUA-VT` (A) · `QT-TN-DINHKY` (A, I) |
| Phòng Kỹ thuật | Trương Quang Bảo Vương | `QT-BT-MBA` (R) · `QT-MUA-VT` (R) · `QT-TN-DINHKY` (S) |
| Phòng Thí nghiệm | Nguyễn Tấn Thịnh | `QT-TN-DINHKY` (R) |
| Phòng Tài chính - Kế toán | Trần Thúy Uyên | `QT-MUA-VT` (C) |
| Phòng Kinh doanh | Bùi Hữu Vân | `QT-MUA-VT` (I) |
| Trung tâm Tư vấn | Nguyễn Vũ Bảo Cường | `QT-TN-DINHKY` (C) |
| **Phòng Vận hành - Bảo trì** | **không có ai** | `QT-BT-MBA` (S, E) |

Kịch bản demo đã chạy thật được: Trương Quang Bảo Vương (giữ S) hoàn tất bước 1 của `QT-TN-DINHKY` → quyền chuyển sang Nguyễn Tấn Thịnh (giữ R ở bước 2). Người chưa tới lượt bị chặn với thông báo *"Vai trò RCSI hiện tại không cho phép thực hiện thao tác này"*.

### ⚠️ Phòng Vận hành - Bảo trì chưa có nhân sự

Đơn vị này **không có thành viên nào**, và escalation cũng không cứu được: hai cấp trên nó (`Khối Kỹ thuật - Dịch vụ` và `Công ty Cổ phần Năng lượng SAVINA`) cũng chưa có người phụ trách. Hệ quả:

- Đơn của `QT-BT-MBA` (bảo trì máy biến áp) **không có ai ở bước 1 (S) và bước 3 (E)** — chỉ tài khoản quản trị đẩy được bằng quyền override.
- Mọi lịch bảo trì sinh phiếu qua quy trình này sẽ mắc ở bước đầu.

Cách sửa: thêm nhân sự và chỉ định người phụ trách cho `SAVINA-P-VHBT`, hoặc tối thiểu cho `SAVINA-KHOI-KTDV` để escalation có đích.

## Kiêm nhiệm

Một người có thể thuộc nhiều đơn vị — cột *Đơn vị — Chức danh* liệt kê tất cả, cách nhau bằng ` ; `. Đáng chú ý:

- **Nguyễn Hồng Sang** — Chủ tịch HĐQT SAVINA, đồng thời Tổng Giám đốc hai pháp nhân Tiền Phong
- **Đậu Xuân Thanh** — Phó Tổng Giám đốc, kiêm Trưởng VPĐD Miền Nam
- **Nguyễn Duy Thuận** — Phó Tổng Giám đốc, kiêm Trưởng VPĐD Tây Nguyên
- **Trần Thúy Uyên** — Kế toán trưởng của SAVINA và cả hai pháp nhân Tiền Phong
- **Trương Quang Bảo Vương** — Phó phòng Kỹ thuật, kiêm nhiệm tại VPĐD Miền Nam
- **Bùi Hữu Vân** — Phó Trưởng phòng Kinh doanh, kiêm nhiệm tại VPĐD Miền Nam

Khi tính quyền RACI, hệ thống lấy **hợp** của mọi đơn vị và chức danh người đó đang giữ.

## Nguồn dữ liệu

- Cơ cấu tổ chức và nhân sự: `apps/migrator/src/seed-savina.ts`
- Dữ liệu demo kho / quy trình / lịch bảo trì: `scripts/seed-savina-demo.mjs`
