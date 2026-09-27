# Phân tích quản lý phiếu kho và thiết bị vận hành

## 1. Mô hình quản lý phiếu kho

Nhập kho, Xuất kho, Luân chuyển và Kiểm kê đều là nghiệp vụ có chứng từ, danh sách nhiều vật tư, người tạo, trạng thái, tệp đính kèm, lịch sử và bút toán kho. Vì vậy nên được quản lý tập trung thay vì chỉ là các button mở form rời rạc.

| Nghiệp vụ | Bản chất chứng từ | Tác động tồn |
|---|---|---|
| Nhập kho | Phiếu tăng tồn | Tăng |
| Xuất kho | Phiếu giảm tồn | Giảm |
| Luân chuyển | Phiếu chuyển giữa kho | Giảm kho nguồn, tăng kho đích |
| Kiểm kê | Phiếu đối soát/điều chỉnh | Tăng hoặc giảm sau duyệt |

### 1.1. Vị trí điều hướng

Đổi khu vực `Giao dịch & Nhập xuất` thành `Quản lý phiếu kho`, gồm các tab con:

```text
Quản lý phiếu kho
├─ Danh sách phiếu
│  ├─ Tất cả
│  ├─ Nhập kho
│  ├─ Xuất kho
│  ├─ Luân chuyển
│  └─ Kiểm kê
├─ Tạo phiếu
│  ├─ Nhập kho
│  ├─ Xuất kho
│  ├─ Luân chuyển
│  └─ Tạo đợt kiểm kê
└─ Sổ kho / Nhật ký giao dịch
```

Màn danh sách là nơi tra cứu và xử lý chính: lọc theo loại phiếu, kho, trạng thái, thời gian, người tạo; hiển thị mã phiếu, số dòng, giá trị/chênh lệch và trạng thái. Click vào một dòng mở Drawer chi tiết hoặc workspace xử lý phiếu.

Nút nhanh từ Dashboard, Tồn kho hoặc Drawer vật tư chỉ là entry point; chúng điều hướng vào `Quản lý phiếu kho` với dữ liệu được điền sẵn.

### 1.2. Khung phiếu dùng chung

Không dùng một form chi tiết giống hệt cho mọi loại phiếu. Dùng một khung dùng chung gồm header, kho, danh sách dòng, tệp đính kèm, timeline, người tạo và trạng thái; sau đó gắn section đặc thù.

| Loại phiếu | Section đặc thù |
|---|---|
| Nhập kho | Nhà cung cấp, hóa đơn, VAT, đơn giá, lô/sê-ri mới |
| Xuất kho | Đối tượng nhận, tài sản đích, kiểm tra tồn khả dụng, lô xuất |
| Luân chuyển | Kho nguồn, kho đích, trạng thái vận chuyển nếu cần |
| Kiểm kê | Snapshot, số thực đếm, chênh lệch, lý do, phê duyệt |

Kiểm kê có vòng đời và lịch sử riêng nên cần workspace riêng trong nhóm phiếu kho, không phải popup hoặc một section nhỏ trong form Nhập/Xuất.

## 2. Vật tư / hàng hóa và thiết bị vận hành

Hai khái niệm có thể dùng chung kho và danh mục liên quan, nhưng mục tiêu quản lý khác nhau.

| Khái niệm | Vật tư / hàng hóa | Thiết bị vận hành |
|---|---|---|
| Bản chất | Hàng tồn để mua, bán, cấp phát, tiêu hao hoặc thay thế | Tài sản/đối tượng vận hành cần theo dõi vòng đời |
| Đơn vị quản lý | Mã vật tư, lô, sê-ri, số lượng | Từng thiết bị hoặc cấu trúc cây cha-con |
| Trạng thái | Tồn, khả dụng, giữ chỗ, hết hàng, hỏng, hết hạn | Đang vận hành, dừng máy, bảo trì, thanh lý, lắp đặt |
| Giao dịch | Nhập, xuất, chuyển, kiểm kê, điều chỉnh | Bàn giao, lắp đặt, tháo dỡ, sửa chữa, bảo trì, thay thế |
| Mục tiêu | Bảo đảm số lượng và giá trị tồn | Bảo đảm khả dụng, an toàn và lịch sử vận hành |

Ví dụ, vòng bi 6205 là vật tư: có thể nhập 100 cái, xuất 2 cái, kiểm kê còn 98 cái. Bơm P-101 là thiết bị vận hành: được lắp tại vị trí cụ thể, có tình trạng vận hành và lịch sử bảo trì; nó có thể sử dụng vòng bi 6205.

### 2.1. Ranh giới module

```text
Kho & Danh mục
├─ Danh mục vật tư / hàng hóa
├─ Tồn kho, lô, sê-ri, vị trí
└─ Quản lý phiếu kho
   ├─ Nhập / Xuất / Luân chuyển / Kiểm kê

Quản lý thiết bị vận hành
├─ Cây thiết bị
├─ Hồ sơ thiết bị
├─ Vận hành / tình trạng
├─ Bảo trì / sự cố
└─ Vật tư đã lắp hoặc đã cấp cho thiết bị
```

### 2.2. Điểm giao giữa kho và vận hành

Nghiệp vụ cấp vật tư cho thiết bị là liên kết chính:

```text
Phiếu xuất kho
→ giảm tồn vật tư
→ tạo lịch sử cấp phát
→ nếu là linh kiện lắp đặt: cập nhật vật tư đang gắn/BOM thiết bị
→ ghi nhận vào work order hoặc hồ sơ bảo trì liên quan
```

Không biến mọi vật tư thành thiết bị. Chỉ mã có giá trị cần định danh từng cá thể, theo dõi vòng đời hoặc lịch sử vận hành mới cần quản lý như thiết bị. Hàng tiêu hao như bulông, dầu mỡ hoặc cáp vẫn là vật tư tồn kho; có thể quản lý theo số lượng hoặc theo lô.

## 3. Nguyên tắc triển khai

1. Sổ kho là append-only: mọi biến động tồn đi qua phiếu/bút toán, không cập nhật trực tiếp số dư.
2. Kiểm kê chỉ tạo bút toán điều chỉnh sau snapshot, đối chiếu, lý do chênh lệch và phê duyệt.
3. Phiếu kho tham chiếu thiết bị/work order khi cấp phát hoặc lắp đặt, nhưng thiết bị không trở thành dòng tồn kho thông thường.
4. Lịch sử phiếu, kiểm kê và vận hành được lưu độc lập nhưng liên kết qua mã tham chiếu để truy vết hai chiều.
