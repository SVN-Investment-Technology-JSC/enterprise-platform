# HRM_FIX_05 - Kịch bản nghiệm thu người dùng (UAT)

Đối tượng: nhân sự (HR), quản lý trực tiếp, nhân viên, quản trị tenant.
Phạm vi: 7 loại đơn HRM chạy ở hai chế độ duyệt, DIRECT (duyệt trong HRM) và PROCEDURE (duyệt qua Procedure Engine, gọi tắt PE).

## 1. Điều kiện tiên quyết

Quản trị kỹ thuật hoàn tất trước khi nghiệm thu; người nghiệm thu chỉ xác nhận.

| # | Điều kiện | Cách xác nhận | Đã xong |
|---|---|---|---|
| 1 | Migration tenant HRM 0021 đến 0030 đã chạy (0027 binding DIRECT mặc định, 0028 chính sách duyệt, 0029 tiến độ bước, 0030 ánh xạ trường) | Quản trị chạy migrator và xác nhận không báo lỗi | |
| 2 | Procedure Engine (procedure-api), hrm-api và worker đã build và khởi động lại bằng bản mới | Màn hình Cấu hình quy trình HRM không báo "Procedure Engine không khả dụng" | |
| 3 | Biến môi trường INTERNAL_SERVICE_TOKEN và PROCEDURE_API_URL có ở hrm-api và worker | Quản trị kỹ thuật xác nhận | |
| 4 | Vai trò mẫu HRM đã được tạo lại để nhận quyền duyệt mới (hrm.*.approve.all cho Chấm công viên, Nhân sự hồ sơ; Trưởng phòng chỉ duyệt cấp dưới) | Xem màn hình Phân quyền | |
| 5 | Có ít nhất 3 tài khoản: Nhân viên A (người nộp), Trưởng phòng của A, Nhân sự HR (có quyền duyệt toàn tenant) và 1 Trưởng phòng ở đơn vị khác | Danh sách người dùng | |
| 6 | Có quy trình mẫu đã công bố trên PE cho từng loại đơn: bước đầu chỉ có vai S (người nộp), có thuộc tính rẽ nhánh theo số ngày nghỉ (ví dụ nhỏ hơn hoặc bằng 2 ngày: Trưởng phòng; lớn hơn 2 ngày: Trưởng phòng và Giám đốc) và theo phòng ban (ví dụ phòng Kế toán qua thêm bước Kế toán trưởng) | Quản trị Procedure xác nhận | |
| 7 | Binding (cấu hình gắn quy trình) và ánh xạ trường cho từng loại đơn đã thiết lập, xem HRM_FIX_05_ADMIN_GUIDE.md | Màn hình Cấu hình quy trình, mỗi loại đơn có dòng chế độ rõ ràng | |

## 2. Quy ước ghi kết quả

- Mỗi dòng kịch bản ghi một trong hai: Đạt hoặc Không đạt. Không đạt phải ghi rõ hiện tượng vào cột Ghi chú kèm ảnh chụp màn hình.
- Chế độ DIRECT: loại đơn đang để chế độ "Duyệt trực tiếp". Chế độ PROCEDURE: loại đơn đang gắn quy trình PE.
- Đơn kiểm thử dùng dữ liệu thử, không dùng dữ liệu thật.

## 3. Kịch bản chính (7 loại đơn x 2 chế độ)

Các bước chung cho mọi dòng trong bảng:

1. Đăng nhập Nhân viên A, mở màn hình Đơn từ, chọn đúng loại đơn, nhập dữ liệu như cột "Dữ liệu nhập" và bấm Gửi.
2. Kiểm tra đơn xuất hiện ngay trong Lịch sử đơn (không cần tải lại nhiều lần).
3. Chế độ PROCEDURE: mở Procedure Engine, kiểm tra có hồ sơ quy trình mới; bước S của người nộp đã tự hoàn thành, bước hiện tại là bước duyệt đầu tiên. Chế độ DIRECT: không có hồ sơ bên PE.
4. Mở chi tiết đơn: hiển thị "Đang chờ [người] duyệt - [bước]" (PROCEDURE) hoặc trạng thái Chờ duyệt (DIRECT). Tiến độ tự cập nhật sau khi có người duyệt (tối đa 15 giây, không cần tải lại).
5. Đăng nhập người duyệt, mở màn hình Duyệt đơn, duyệt hoặc từ chối đơn trong HRM.
6. Kiểm tra kết quả nghiệp vụ được áp dụng đúng và đơn chuyển trạng thái cuối.

| Mã | Loại đơn | Chế độ | Dữ liệu nhập | Kết quả mong đợi riêng của dòng | Đạt | Không đạt | Ghi chú |
|---|---|---|---|---|---|---|---|
| L-D | Nghỉ phép | DIRECT | Nghỉ 1 ngày phép năm | Không có hồ sơ PE. Trưởng phòng của A thấy đơn trong Duyệt đơn; sau khi duyệt, số dư phép năm của A giảm 1 ngày | | | |
| L-P1 | Nghỉ phép | PROCEDURE | Nghỉ 2 ngày | Đơn đi nhánh ngắn ngày: chỉ chờ Trưởng phòng. Duyệt xong, trừ phép 2 ngày | | | |
| L-P2 | Nghỉ phép | PROCEDURE | Nghỉ 5 ngày | Đơn đi nhánh dài ngày: sau Trưởng phòng chuyển sang Giám đốc; tiến độ hiển thị đổi người chờ duyệt. Duyệt cả hai, trừ phép 5 ngày | | | |
| L-P3 | Nghỉ phép | PROCEDURE | A thuộc phòng Kế toán, nghỉ 2 ngày | Đơn rẽ nhánh theo phòng ban, có thêm bước Kế toán trưởng | | | |
| OT-D | Làm thêm giờ (OT) | DIRECT | OT 2 giờ ngày thường | Duyệt xong, số giờ OT duyệt hiện ở bảng công | | | |
| OT-P | Làm thêm giờ (OT) | PROCEDURE | OT 2 giờ ngày thường | Bước S tự hoàn thành, chờ Trưởng phòng; duyệt xong số giờ OT duyệt hiện ở bảng công | | | |
| CT-D | Công tác | DIRECT | Công tác 2 ngày | Duyệt xong, các ngày công tác hiện trong bảng công | | | |
| CT-P | Công tác | PROCEDURE | Công tác 2 ngày, nơi đến bắt buộc | Thuộc tính nơi đến lấy từ đơn (không phải nhập lại ở bước S); duyệt xong như DIRECT | | | |
| DC-D | Đổi ca | DIRECT | Đổi ca với đồng nghiệp B | B xác nhận trước; sau đó mới chờ duyệt. Duyệt xong lịch ca đổi | | | |
| DC-P | Đổi ca | PROCEDURE | Đổi ca với đồng nghiệp B | Quy trình chỉ được tạo sau khi B đồng ý. Từ chối của B thì không tạo hồ sơ PE | | | |
| GT-D | Giải trình công | DIRECT | Bổ sung giờ ra | Duyệt xong, công ngày đó được cập nhật | | | |
| GT-P | Giải trình công | PROCEDURE | Bổ sung giờ ra | Như DIRECT, kèm tiến độ bước từ PE | | | |
| TU-D | Tạm ứng | DIRECT | Tạm ứng 5.000.000 | Duyệt xong, trạng thái Đã duyệt và có thể chuyển giải ngân | | | |
| TU-P | Tạm ứng | PROCEDURE | Tạm ứng 5.000.000 | Số tiền được truyền sang PE (rẽ nhánh theo số tiền nếu quy trình có); duyệt xong như DIRECT | | | |
| HS-D | Chỉnh sửa hồ sơ | DIRECT | Sửa số điện thoại | Nhân sự hồ sơ duyệt xong, thông tin hồ sơ được cập nhật | | | |
| HS-P | Chỉnh sửa hồ sơ | PROCEDURE | Sửa số điện thoại | Như DIRECT, kèm tiến độ bước từ PE | | | |

Điểm kiểm tra bắt buộc thêm cho mọi dòng PROCEDURE:

| # | Nội dung kiểm tra | Đạt | Không đạt | Ghi chú |
|---|---|---|---|---|
| K1 | Đơn hiện trong lịch sử của nhân viên ngay sau khi gửi (trạng thái liên kết là RUNNING hoặc START_PENDING rồi chuyển RUNNING) | | | |
| K2 | Quy trình hiện bên PE với đúng tiêu đề đơn | | | |
| K3 | Bước S tự hoàn thành, người nộp không phải thao tác thêm ở PE | | | |
| K4 | Khi người duyệt xử lý ngay bên PE hoặc trong HRM, tiến độ trong chi tiết đơn cập nhật theo | | | |
| K5 | Khi kết thúc, trạng thái nghiệp vụ của đơn đổi một lần duy nhất (không áp hai lần, số dư phép không trừ đôi) | | | |
| K6 | Bấm Gửi hai lần liên tiếp (nhấp đúp) chỉ tạo một đơn và một hồ sơ quy trình | | | |

## 4. Kịch bản lỗi và kiểm soát

| Mã | Tình huống | Các bước | Kết quả mong đợi | Đạt | Không đạt | Ghi chú |
|---|---|---|---|---|---|---|
| E1 | PE sập khi gửi đơn (chế độ PROCEDURE) | Quản trị tạm dừng procedure-api, A gửi đơn | Đơn vẫn được tạo và hiện trong lịch sử; trạng thái đồng bộ là "Đồng bộ lỗi - đang thử lại". Bật lại PE, hệ thống tự thử lại hoặc quản trị bấm Thử lại ở màn hình Cấu hình; quy trình xuất hiện, không tạo hai hồ sơ | | | |
| E2 | Thiếu thuộc tính bắt buộc của bước S | Dùng quy trình có thuộc tính bắt buộc không có ánh xạ; A gửi đơn | Đơn có nhưng trạng thái FAILED và thông báo nêu rõ tên trường thiếu (ví dụ "Cần nhập ..."). Sau khi quản trị bổ sung ánh xạ hoặc sửa quy trình, bấm Thử lại thì chạy được | | | |
| E3 | Tự duyệt | Trưởng phòng gửi đơn của chính mình rồi tự duyệt (DIRECT) | Bị chặn, thông báo "Không được tự duyệt đơn của chính mình" (mã SELF_APPROVAL_FORBIDDEN), kể cả tài khoản quản trị tenant | | | |
| E4 | Duyệt ngoài phạm vi | Trưởng phòng ở đơn vị khác mở và duyệt đơn của A (DIRECT) | Đơn không nằm trong danh sách chờ duyệt của người này; gọi duyệt trực tiếp bị từ chối với thông báo ngoài phạm vi (mã APPROVAL_OUT_OF_SCOPE) | | | |
| E5 | Duyệt trong phạm vi | Trưởng phòng của A duyệt đơn (DIRECT) | Duyệt thành công | | | |
| E6 | Duyệt thủ công đơn đang chạy PE | Dùng thao tác duyệt DIRECT cho đơn đang có quy trình | Thông báo "Đơn đang được xử lý qua Procedure Engine" (mã PROCEDURE_IN_PROGRESS); xử lý tại quy trình | | | |
| E7 | Tắt PE | Quản trị tắt Procedure Engine của tenant (gói/entitlement), hoặc dừng dịch vụ; sau đó mở màn hình Cấu hình quy trình và thử gắn PROCEDURE, thử gửi đơn loại đang PROCEDURE | Màn hình ẩn lựa chọn "Duyệt qua Procedure" và hiện cảnh báo. Gắn mới bị từ chối; gửi đơn trả lỗi PROCEDURE_UNAVAILABLE (409) và không tạo đơn. Nút "Chuyển sang duyệt trực tiếp" chuyển được mọi binding sang DIRECT, sau đó gửi đơn bình thường | | | |
| E8 | Chọn loại đơn con | Binding theo loại con (loại phép), A chưa chọn loại phép | Biểu mẫu báo "Chọn loại đơn con để tải biểu mẫu" (mã SUBTYPE_REQUIRED) thay vì trống | | | |
| E9 | Mất kết nối tổ chức | Platform tổ chức tạm lỗi, Trưởng phòng duyệt đơn DIRECT | Thông báo tạm thời không xác định được phạm vi (mã ORG_CONTEXT_UNAVAILABLE), thử lại sau là duyệt được | | | |

## 5. Tổng hợp và ký xác nhận

| Hạng mục | Tổng số | Đạt | Không đạt |
|---|---|---|---|
| Kịch bản chính (17 dòng) | 17 | | |
| Điểm kiểm tra PROCEDURE (K1-K6) | 6 | | |
| Kịch bản lỗi (E1-E9) | 9 | | |

Kết luận: [ ] Chấp nhận   [ ] Chấp nhận có điều kiện   [ ] Không chấp nhận

Ghi chú chung: ........................................................................

| Vai trò | Họ tên | Chữ ký | Ngày |
|---|---|---|---|
| Đại diện Nhân sự (HR) | | | |
| Đại diện nghiệp vụ (quản lý) | | | |
| Quản trị hệ thống | | | |
| Chủ sản phẩm | | | |
