# HRM_FIX_05 - Hướng dẫn quản trị: gắn Procedure Engine cho loại đơn HRM

## 1. Nguyên tắc

- Mỗi tenant HRM mặc định có 7 cấu hình DIRECT (duyệt trong HRM) cho 7 loại đơn: nghỉ phép, OT, công tác, đổi ca, giải trình công, tạm ứng, chỉnh sửa hồ sơ. Chưa gắn gì thì đơn luôn chạy DIRECT.
- Chế độ PROCEDURE chỉ dùng được khi tenant có Procedure Engine (PE) còn hiệu lực và PE đang trả lời. HRM và PE chỉ giao tiếp qua API nội bộ, HRM không đọc cơ sở dữ liệu của PE.
- Người nộp không bao giờ tự duyệt đơn của mình. Ở chế độ PROCEDURE điều này do quy trình bảo đảm (bước duyệt phân cấp theo quản lý trực tiếp của người khởi tạo).

## 2. Gắn quy trình PE cho loại đơn

1. Vào HRM, màn hình Vận hành, tab Quy tắc duyệt (cần quyền hrm.integration.manage).
2. Chọn loại đơn (và loại con nếu cần, ví dụ một loại phép riêng) và chế độ "Duyệt qua Procedure"; chọn quy trình đã công bố. Lựa chọn này bị ẩn nếu PE không khả dụng.
3. Bấm Lưu. Hệ thống đọc định nghĩa quy trình qua PE và lưu bản chụp. Nếu bước đầu của quy trình không chỉ có vai S, hệ thống hiện khung cảnh báo màu vàng: đơn sẽ dừng chờ người nộp thay vì tự đi tiếp. Nên sửa quy trình để bước đầu chỉ có vai S.
4. Sau khi lưu, hộp thoại Ánh xạ trường tự mở (có thể mở lại bằng nút "Ánh xạ trường" ở dòng quy tắc).
5. Đưa đơn thử qua đủ các nhánh (xem HRM_FIX_05_UAT.md) trước khi cho người dùng thật dùng.

Quay lại duyệt trực tiếp: chọn "Duyệt trực tiếp" cho loại đơn đó, hoặc dùng nút "Chuyển sang duyệt trực tiếp" khi PE không khả dụng (chuyển tất cả binding PROCEDURE sang DIRECT, có hỏi xác nhận). Đơn đã gửi trước đó vẫn tiếp tục theo quy trình của nó.

Độ ưu tiên chọn cấu hình khi gửi đơn: cấu hình theo loại con (nếu có và trùng) trước, rồi cấu hình mặc định của loại đơn.

## 3. Ánh xạ trường

Ánh xạ cho biết thuộc tính của quy trình PE (do quy trình định nghĩa, ví dụ so_ngay_nghi) lấy giá trị từ trường nào của đơn HRM, để người nộp không phải nhập lại và PE rẽ nhánh đúng.

| Thành phần | Ý nghĩa |
|---|---|
| Trường HRM | Trường của đơn (form.*, ví dụ số ngày, lý do, số tiền), thông tin nhân viên (employee.*: phòng ban, chức danh, cấp bậc, loại hợp đồng, người quản lý) hoặc số liệu nghiệp vụ (số phép còn, số giờ OT trong tháng) |
| Thuộc tính PE | Thuộc tính cấp quy trình hoặc thuộc tính của bước S |
| Chế độ OVERWRITE | Giá trị hệ thống luôn thắng; thuộc tính bị ẩn khỏi form |
| Chế độ PREFILL | Điền sẵn vào form, người nộp sửa được; hệ thống chỉ điền khi để trống |
| Chuyển đổi | Không, số, chuỗi, đúng/sai, ngày, chữ hoa, chữ thường |

Lưu ý:
- Thuộc tính bắt buộc của bước S chưa được ánh xạ sẽ hiện cảnh báo; không ánh xạ thì người nộp phải nhập, nếu không đơn bị FAILED.
- Điều kiện rẽ nhánh theo phòng ban phải dùng thuộc tính kiểu lựa chọn trong PE, mã lựa chọn trùng mã (hoặc id) phòng ban/chức danh.
- Thuộc tính kiểu text, file, user ở PE chỉ có điều kiện rỗng hoặc không rỗng.
- Chưa cấu hình ánh xạ thì dùng bảng mặc định (so_ngay_nghi, duration, so_gio_ot, so_tien, tu_ngay, den_ngay, ly_do...).
- Ánh xạ gắn theo binding; đổi quy trình của cùng binding thì dòng không khớp thuộc tính mới bị bỏ qua.

## 4. Trạng thái liên kết (link) giữa đơn và quy trình

| Trạng thái | Ý nghĩa | Xử lý |
|---|---|---|
| START_PENDING | Đơn đã tạo, chưa gọi hoặc đang chờ tạo hồ sơ bên PE | Chờ vài giây. Quá một phút vẫn đứng: kiểm tra worker và PE |
| RUNNING | Quy trình đang chạy bên PE; đơn hiển thị bước hiện tại và người chờ duyệt | Không cần làm gì |
| APPLY_PENDING | PE đã có kết quả cuối, HRM đang áp dụng vào đơn | Chờ; nếu đứng lâu xem log worker |
| APPLIED | Kết quả cuối đã áp dụng vào đơn (duyệt, từ chối hoặc hủy) | Hoàn tất |
| FAILED | Khởi tạo hoặc áp dụng thất bại (PE sập, thiếu thuộc tính bắt buộc, lỗi tạm); thông báo lỗi lưu ở lastError | Đọc lỗi. Lỗi thiếu thuộc tính: sửa ánh xạ hoặc quy trình. Rồi bấm Thử lại ở Vận hành, tab Quy trình đơn. Hệ thống cũng tự thử lại; cùng khóa nên không tạo hồ sơ trùng |
| CONFLICT | Dữ liệu liên kết mâu thuẫn (một đơn nhiều hồ sơ, cấu hình xung đột) | Khóa xử lý tự động để tránh sai. Kiểm tra trên PE; nếu chưa có hồ sơ thì bấm Gắn lại quy trình (chỉ khi chưa có instance); nếu đã có thì đối soát thủ công rồi mới xử lý |

## 5. Mã lỗi thường gặp

| Mã | HTTP | Ý nghĩa | Cách xử lý |
|---|---|---|---|
| SELF_APPROVAL_FORBIDDEN | 403 | Người thao tác chính là chủ đơn | Nhờ người có thẩm quyền khác duyệt. Chỉ khi tenant bật ngoại lệ allow_self_approval trong cơ sở dữ liệu (mặc định tắt, chưa có giao diện) |
| APPROVAL_OUT_OF_SCOPE | 403 | Đơn không thuộc phạm vi đơn vị mà người duyệt được duyệt (hoặc nhân viên chưa gắn tài khoản) | Gán đúng người quản lý/chức danh trong cơ cấu tổ chức, hoặc cấp quyền hrm.<loại>.approve.all cho người duyệt toàn tenant |
| PROCEDURE_IN_PROGRESS | 409 | Đơn đang có quy trình PE, không duyệt trực tiếp được | Xử lý bước duyệt tại quy trình (trong màn hình Duyệt đơn có nút Duyệt/Từ chối/Trả lại qua PE) |
| ORG_CONTEXT_UNAVAILABLE | 503 | Không lấy được sơ đồ tổ chức từ Platform để xác định phạm vi hoặc giá trị ánh xạ | Thử lại sau; nếu kéo dài kiểm tra dịch vụ Platform và INTERNAL_SERVICE_TOKEN |
| PROCEDURE_UNAVAILABLE | 409 | PE tắt entitlement hoặc không trả lời khi gắn quy trình hoặc gửi đơn PROCEDURE | Bật lại PE, hoặc chuyển binding sang DIRECT. Đơn không bị tạo khi gửi gặp lỗi này |
| SUBTYPE_REQUIRED | 200 (trong dữ liệu biểu mẫu) | Loại đơn chỉ có cấu hình PROCEDURE theo loại con mà chưa chọn loại con | Chọn loại con (ví dụ loại phép) để tải biểu mẫu |

## 6. Khi triển khai bản mới

1. Chạy migrator cho migration tenant HRM 0027 đến 0030 (người quản trị tự chạy).
2. Build và khởi động lại procedure-api, hrm-api, worker.
3. Tạo lại vai trò mẫu HRM để nhận quyền *.approve.all.
4. Đơn PROCEDURE đang chạy trước khi nâng cấp vẫn đứng ở bước S cũ; nếu cần, quản trị quyết định hoàn thành bước S của chúng thủ công (không có script tự động). Tiến độ bước của chúng được điền dần nhờ đối soát (tối đa 50 liên kết mỗi lượt).
