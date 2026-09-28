# ERP-114 — Mã nguồn công, phép và lương; bàn giao kiểm tra

Ngày 27/09/2026. Nhánh `ngtantai/tenant-dynamic-rbac`, thư mục chính `D:/data/savina/enterprise-platform`. Thay đổi chưa commit/push. Không cập nhật Jira trong đợt triển khai này.

## Trạng thái

> Bản ghi giai đoạn đầu ngày 27/09. Đợt bổ sung RBAC và tích hợp sau đó được ghi tại [Chức năng, đầu ra và hướng dẫn HRM](HRM-ERP114-chuc-nang-va-huong-dan.md). Các kết quả kiểm tra và khoảng trống dưới đây là mốc trước đợt bổ sung, không phải trạng thái mới nhất.

Đã triển khai các luồng nghiệp vụ dưới đây vào HRM của ERP, giữ gateway `/modules/hrm` và `/api/hrm`, phiên đăng nhập chung và database theo tenant. Có kiểm thử tự động và build thành công. **Chưa được coi ERP-114 hoặc ERP-119 đã nghiệm thu**; trạng thái mới nhất và những phần cần nghiệm thu được ghi trong tài liệu liên kết ở trên.

Đối chiếu với 4 tài liệu HRM người dùng cung cấp và báo cáo `outputs/erp114-audit-20260926/HRM-current-state.md`. Các mức thuế, bảo hiểm, giới hạn OT trong fixture kiểm thử là dữ liệu thử, không phải cấu hình pháp lý sẵn để sử dụng cho doanh nghiệp.

## Đầu ra theo thứ tự triển khai

| Hạng mục | Mã nguồn/API và giao diện đã bổ sung | Đầu ra nghiệp vụ |
|---|---|---|
| ERP-115: nền tích hợp | Core Employee tách khỏi User; chuyển dữ liệu cũ giữ ID; tạo nhân viên chưa có tài khoản, liên kết tài khoản có kiểm tra trùng; đăng ký migration tenant; bảo vệ phiên/CSRF | Một hồ sơ nhân viên làm nguồn cho công, phép, lương; tài khoản dùng để đăng nhập được liên kết riêng. Không tự tạo hồ sơ giả khi xem hồ sơ cá nhân |
| ERP-116: ca và công | Cấu hình hiệu lực, ca qua đêm, giờ nghỉ, lịch WORK/OFF/HOLIDAY, phân ca/đổi ca; nhiều sự kiện vào-ra; giải trình nhiều phiên; IP, GPS/bán kính, đăng ký/duyệt/thu hồi thiết bị; dashboard dữ liệu thật | Tính phút công, đi trễ/về sớm, bất thường theo nguồn dữ liệu có truy vết; đổi ca được duyệt thực sự cập nhật lịch của hai bên |
| ERP-117: phép và đơn | Loại nghỉ theo ngày/giờ; giữ quỹ cho đơn chờ, sử dụng khi duyệt, hoàn khi hủy; hạn mức âm; tích phép/thâm niên/prorata; chuyển năm và hết hạn; điều chỉnh có sổ giao dịch; công tác tham chiếu đầu việc Procedure; OT theo loại ngày/giờ đêm và giới hạn; sửa hồ sơ qua phê duyệt; tạm ứng; chứng từ | Kiểm tra trùng và quỹ phép trong transaction; duyệt/hủy lặp không trừ/hoàn hai lần; OT được trả dựa trên giao giữa thời gian được duyệt và công thực tế; thay đổi hồ sơ chỉ áp dụng trường được duyệt |
| ERP-118: công tháng | Kỳ công, tính lại, ma trận nhân viên × ngày, chi tiết nguồn, tìm kiếm/phân trang, CSV, điều chỉnh, khóa/mở kỳ | Tổng hợp công, phép, OFF/lễ, công tác, OT, trễ/sớm và bất thường. Chặn khóa kỳ chưa kết thúc, nguồn chưa xử lý hoặc bảng công cần tính lại |
| ERP-118: lương | Phiên bản công thức, tham số cá nhân, mức lương có hiệu lực; engine công thức an toàn; định mức toàn kỳ; điều chỉnh thu nhập/khấu trừ; tính lại/chốt, thu hồi tạm ứng, phiếu lương cá nhân, in/lưu PDF bằng trình duyệt; ghi nhận tham chiếu chi trả | Tính từ bảng công đã khóa; lưu snapshot nguồn/công thức; chặn chốt khi công hoặc cấu hình đã đổi; thu hồi tạm ứng một lần, số dư hết chuyển REPAID; phiếu lương đã phát hành không bị ghi đè |
| ERP-119: kiểm thử | Unit và PostgreSQL integration trên database thử riêng; migration registry; build FE/BE, lint, React Doctor; smoke khởi động backend | Có bằng chứng kiểm tra kỹ thuật; chưa thay thế nghiệm thu giao diện, đối soát lương thực tế và xác nhận HR/kế toán |

### Ràng buộc đã thực thi

- Sự kiện chấm công có khóa chống ghi trùng theo nguồn và mã sự kiện; sửa công giữ lại lịch sử sự kiện cũ.
- Quỹ phép giữ chỗ cho đơn chờ duyệt; hoàn phép chuyển năm sau hạn sử dụng không làm sống lại quỹ đã hết hạn.
- Thay đổi ca/policy/công tác/OT bị chặn với kỳ công đã khóa; mở công làm lần lương chưa chốt cần tính lại. Kỳ có lương chốt không mở lại tùy ý.
- Công thức chỉ hỗ trợ toán tử và hàm đã cho phép; không thực thi JavaScript. Kiểm tra tham chiếu thiếu/vòng kể cả nhánh IF không chạy. IF chỉ tính nhánh được chọn.
- Người vào giữa kỳ cần khai báo định mức phút của toàn kỳ để không nhận đủ lương tháng chỉ vì mẫu số còn các ngày sau khi vào làm.
- Gửi lại điều chỉnh phép/lương bằng cùng `operationId` trả giao dịch trước; cùng mã nhưng khác nội dung bị từ chối. API giữ tương thích với client cũ chưa gửi mã; bảo đảm chống lặp cho điều chỉnh yêu cầu client gửi mã này, giao diện mới đã gửi.
- Đợt đầu hoãn danh mục quyền; đợt bổ sung theo yêu cầu mới đã có 51 hành động HRM trong RBAC động, kiểm tra tại API và giao diện. Xem [danh mục hiện tại](HRM-RBAC-actions.md); còn cần nghiệm thu bằng nhiều vai trò thực tế.

## Migration và chạy local

Đã chạy thành công `pnpm nx run migrator:hrm-migrate` trên local: Core `0006-employees`, HRM `0002`–`0011` cho các tenant có entitlement HRM active. `0001-hrm` hiện hữu được giữ. Lệnh chuyên biệt không chạy seed, không reset mật khẩu, không thực hiện dọn dữ liệu CRM của luồng provision toàn bộ.

Các migration đã áp dụng không được sửa nội dung; thay đổi schema tiếp theo cần migration mới.

Tiến trình HRM API đang chạy trước đợt này chưa nạp các controller mới: `/api/hrm/v1/time-settings` và `/api/hrm/v1/payroll-configuration` trả 404 qua gateway. Bản vừa build được chạy tạm để kiểm tra khởi động, các route trả 401 với request chưa đăng nhập; tiến trình tạm đã dừng. Chưa thay thế tiến trình dev do người dùng đang chạy.

Tại thư mục chính, dừng lệnh `pnpm dev` cũ bằng Ctrl+C, sau đó:

```powershell
pnpm infra:up
pnpm nx run migrator:hrm-migrate
pnpm dev
```

Migration HRM đã được chạy trong đợt này nên bước thứ hai có thể bỏ qua trên đúng local hiện tại. Dùng lại khi đồng bộ môi trường khác. Không cần chạy lại `pnpm db:provision` để cập nhật riêng HRM trên môi trường đã provision.

Truy cập bằng gateway ERP, ví dụ `http://localhost:8080/modules/hrm`. Cổng nội bộ FE/BE vẫn thuộc kiến trúc gateway chung.

## Thứ tự cấu hình và nghiệm thu

1. **Nền nhân sự:** tạo hồ sơ chưa có tài khoản; liên kết tài khoản đang hoạt động; xác nhận đúng hồ sơ cá nhân. Thử tài khoản khác tenant và thao tác thiếu quyền phải bị chặn.
2. **Ca và quy định:** `/shifts`, `/policies`. Khai báo ca ngày/đêm, giờ nghỉ, ngày OFF/lễ, dung sai, timezone, IP/site và thiết bị. Thử ca đêm qua ngày, hai lượt vào-ra, thiếu OUT, đổi ca có xác nhận của người đổi cùng.
3. **Phép/đơn:** `/leave-settings`, `/requests`, `/approvals`. Khai báo loại phép, lịch tích phép và hạn mức âm; chạy tích phép/chuyển năm/hết hạn; gửi đơn chờ/duyệt/hủy và đối chiếu quỹ/sổ phép. Thử chứng từ, công tác gắn đầu việc, OT ngày thường/OFF/lễ/đêm và vượt giới hạn. Thử sửa hồ sơ được duyệt và hồ sơ đã thay đổi sau lúc nộp đơn.
4. **Bảng công:** `/timesheets`. Tạo kỳ đã kết thúc, tính lại, đối chiếu ma trận/CSV với log và đơn; xử lý bất thường bằng nguồn hoặc điều chỉnh có lý do; khóa kỳ. Thử sửa nguồn sau khóa phải bị từ chối.
5. **Lương:** `/payroll/settings`. Nhập mức lương và các tham số cá nhân có hiệu lực. Khai báo công thức thu nhập, OT, bảo hiểm, thuế/giảm trừ, thưởng/khấu trừ và thực lĩnh theo chính sách doanh nghiệp. Ví dụ công thức mặc định chỉ minh họa lương theo công và thu hồi ứng, chưa tự cấu hình các khoản pháp định.
6. **Tính và chốt:** `/payroll`. Tạo kỳ liên kết bảng công đã khóa; tính, kiểm tra snapshot, điều chỉnh và tính lại; đối chiếu một nhân viên đủ kỳ, một nhân viên giữa kỳ, một nhân viên có OT/phép/ứng lương. Chốt lần lương, phát hành phiếu.
7. **Cá nhân/chi trả:** `/payslips` xem đúng phiếu của mình, in/lưu PDF; kế toán ghi nhận tham chiếu chi trả. Thử gửi lại thao tác không tạo thêm phiếu, không thu hồi ứng hai lần. Ghi nhận người kiểm tra, kết quả và chênh lệch trước khi chốt ERP-119.

Các đường dẫn trên nằm dưới `/modules/hrm`.

## Bằng chứng kiểm tra ngày 27/09

| Kiểm tra | Kết quả và giới hạn |
|---|---|
| `pnpm nx run module-hrm:test` | 5 suites, **37 tests đạt**, có PostgreSQL integration thực; database test ngẫu nhiên được dọn sau khi chạy |
| `pnpm nx run platform-entitlement:test` | **5 tests đạt**, kiểm tra registry/đường dẫn migration |
| `pnpm nx run-many -t build -p hrm-api hrm-web` | Đạt, gồm kiểm tra TypeScript theo dependency; Next tạo các trang HRM mới |
| `pnpm nx run-many -t lint -p module-hrm feature-hrm` | Không có error; còn warning về typing/non-null trong phần mã được kiểm tra |
| React Doctor phạm vi feature HRM | **0 errors, 128 warnings**, báo cáo `outputs/erp114-react-doctor.json`; chưa tuyên bố hết nợ chất lượng giao diện |
| Khởi động bản backend mới | Đạt; route cấu hình trả 401 với request ẩn danh. Đây không phải kiểm thử SSO đầy đủ |
| GET trang `/modules/hrm/timesheets` qua gateway | HTTP 200; chưa phải xác nhận thao tác có phiên trên giao diện |
| Browser UI có xác thực | Chưa thực hiện được: Edge báo một extension UI đang chặn automation; cần đóng UI extension đó trước lượt kiểm tra tiếp theo |

Test bao phủ chuỗi công → OT → công đã khóa → ứng lương → công thức → mở lại công buộc tính lại → chốt/thu hồi ứng → phiếu bất biến → chi trả; có biến thể nhân viên vào giữa kỳ. Có test cô lập tenant, CSRF, mapping nhân viên, ca đêm, sửa công, âm/quỹ phép, chuyển phép hết hạn, thâm niên, IP/GPS/thiết bị, giới hạn OT và chống ghi trùng. File storage được mock ở integration test; chưa xác nhận upload/download MinIO qua trình duyệt. Chưa kiểm thử tải hoặc mọi trường hợp đồng thời.

## Khoảng trống ghi nhận ở đợt đầu (đã có cập nhật)

Đợt bổ sung đã xử lý scheduler phép, liên kết Procedure cho nghỉ/OT/đổi ca, lịch/thông báo cá nhân, bộ chọn subtask, hồ sơ người phụ thuộc, xuất chi trả/đối soát CSV và RBAC chi tiết. Danh sách lịch sử dưới đây giải thích cơ sở triển khai; dùng mục **Phần chưa thể coi là hoàn tất** trong tài liệu hướng dẫn mới để theo dõi công việc còn lại.

1. **Shared Workflow/Notification/Calendar:** vẫn là các transition phê duyệt trong HRM. Chưa có tích hợp workflow đa cấp, callback/outbox/thông báo/lịch dùng chung theo tài liệu kiến trúc. Không dựng workflow engine thứ hai để giả lập đã tích hợp.
2. **Tự động tích phép:** đã có nghiệp vụ và thao tác chạy an toàn khi lặp từ UI/API; chưa có scheduler vận hành định kỳ. Hiện HR phải chạy tác vụ tích phép/chuyển năm/hết hạn.
3. **Công tác liên module:** đã xác minh đầu việc/subtask qua Procedure; UI chọn đầu việc. Chưa có module Project riêng hay bộ chọn subtask đầy đủ trên UI.
4. **Ca nâng cao:** có một ca và một khoảng nghỉ theo ngày hiệu lực; chưa có bộ tạo lịch xoay kíp hàng loạt, nhiều ca rời/nhiều khoảng nghỉ trong ngày hoặc lịch riêng theo từng pháp nhân/đơn vị.
5. **Lương và kế toán:** engine nhận cấu hình và tham số thuế/BHXH/người phụ thuộc; chưa có bộ chính sách pháp định được HR/kế toán xác nhận, hồ sơ người phụ thuộc đầy đủ, gross-up tự động, tệp chuyển khoản theo mẫu ngân hàng hay hạch toán/đối soát qua module kế toán. Ghi nhận chi trả hiện tại là thao tác có tham chiếu, không thực hiện chuyển tiền. PDF hiện dùng chức năng in của trình duyệt, chưa sinh/lưu PDF qua File service.
6. **Thiết bị và chứng từ:** thiết bị là đăng ký trình duyệt bằng cookie, không phải định danh phần cứng tuyệt đối. Cần UAT chính sách proxy/IP/GPS trên môi trường thực và kiểm tra storage; chưa có quét mã độc chứng từ.
7. **UI/vòng đời đầy đủ:** cần nghiệm thu thao tác thực các màn cũ/mới, xử lý các nút xuất/báo cáo còn sơ bộ, kiểm tra amend/cancel và hiển thị đơn vị ngày/giờ thống nhất. Không suy ra mọi endpoint đã có đủ thao tác UI.
8. **Quyền và nghiệm thu:** bổ sung/kiểm tra RBAC động chi tiết ở cuối nghiệp vụ theo thứ tự đã thống nhất; kiểm tra người xem lương/đơn/nhân sự theo vai trò và phạm vi; HR/kế toán ký xác nhận dữ liệu đối soát. Chưa đề xuất triển khai giai đoạn sau khi các điều kiện này chưa đạt.

Những mục này là công việc còn lại của giai đoạn hiện tại hoặc phụ thuộc nền tảng cần giải quyết trước nghiệm thu; không dùng kết quả build/test để đóng thay. Jira giữ nguyên trong đợt này.
