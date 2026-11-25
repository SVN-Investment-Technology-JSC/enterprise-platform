# ĐỀ XUẤT CHUẨN HÓA MÔ HÌNH PHÂN LOẠI VẬT TƯ

**Dự án:** DakRoSa -- SaaS Multi-Tenant, Multi-Module\
**Cơ sở:** `DANH_GIA_RUI_RO_PHAN_LOAI_VAT_TU.md` và phần phân tích, đề
xuất kiến trúc\
**Ngày:** 23/11/2026\
**Trạng thái:** Đề xuất -- cần xác nhận các quyết định nghiệp vụ trước
khi triển khai

------------------------------------------------------------------------

## 1. Mục tiêu

Chuẩn hóa cách phân loại và quản lý vật tư để:

-   Loại bỏ việc một trường dữ liệu phục vụ nhiều mục đích nghiệp vụ
    khác nhau.
-   Bảo đảm dữ liệu nhất quán giữa Kho, CRM/Sales, AMM và các module
    liên quan.
-   Tách biệt phân loại kỹ thuật, phương thức theo dõi vòng đời và phân
    loại thương mại.
-   Bảo vệ tính toàn vẹn dữ liệu trong môi trường SaaS Multi-Tenant,
    schema riêng cho từng Tenant.
-   Hạn chế việc thêm module hoặc ngành nghề mới buộc phải sửa nhiều
    enum, migration và logic rải rác.

## 2. Hiện trạng và vấn đề cốt lõi

Bốn trường đang được sử dụng trên `inventory_schema.materials`:

  -----------------------------------------------------------------------
  Trường                  Ý nghĩa hiện tại        Vấn đề chính
  ----------------------- ----------------------- -----------------------
  `kind`                  Loại đối tượng:         Định nghĩa bị khai báo
                          `STOCK`, `SERVICE`,     ở nhiều nơi; logic kiểm
                          `ASSET`                 tra trực tiếp chuỗi bị
                                                  phân tán

  `category`              Nhóm kỹ thuật: phụ      Bị dùng đồng thời cho
                          tùng, vật tư tiêu hao,  gợi ý theo dõi và chính
                          dụng cụ, vật tư luân    sách giá/chiết khấu CRM
                          chuyển                  

  `trade_category`        Phân loại thương mại do Lưu bằng chữ, không có
                          Tenant thiết lập        FK; kiểm tra và chặn
                                                  xóa chủ yếu ở giao diện

  `trade_mode`            Cách sử dụng: chỉ bán,  Có mã cũ và nhãn tự do
                          chỉ tặng, nội bộ,       song song; chưa rõ có
                          combo...                thực sự kiểm soát giao
                                                  dịch hay chỉ để mô tả
  -----------------------------------------------------------------------

### 2.1. Rủi ro nổi bật

**`category` -- rủi ro cao nhất**

-   Một trường đang mang hai nghĩa: phân loại kỹ thuật và nhóm hàng phục
    vụ chính sách chiết khấu CRM.
-   CRM so khớp theo giá trị `material.category`, khiến luật giá bị phụ
    thuộc vào nhóm kỹ thuật.
-   Form hàng hóa thương mại gán cứng `CONSUMABLE`, có thể khiến mặt
    hàng được phân loại sai và kéo theo gợi ý theo dõi sai.
-   Thay đổi phân loại có thể ảnh hưởng khả năng so sánh báo cáo và dữ
    liệu giao dịch lịch sử.

**`trade_category` -- rủi ro toàn vẹn dữ liệu**

-   Lưu tên danh mục thay vì định danh ổn định.
-   Đổi tên hoặc xóa danh mục có thể tạo dữ liệu không còn khớp danh
    mục.
-   Kiểm tra xóa ở frontend không đủ; API/import có thể ghi hoặc xóa dữ
    liệu không hợp lệ.
-   Cần kiểm tra danh mục thuộc đúng Tenant và đúng loại đối tượng.

**`trade_mode` -- rủi ro về ý nghĩa nghiệp vụ**

-   Tồn tại mã cũ như `SALE_ONLY`, `GIFT_ONLY`, `INTERNAL_ONLY`, `MULTI`
    cùng nhãn tự do.
-   Chưa thấy hành vi backend tương ứng với các giá trị; người dùng có
    thể hiểu nhầm rằng lựa chọn này đã chặn giao dịch.
-   Cần quyết định đây là thuộc tính mô tả hay chính sách có hiệu lực
    thực thi.

**`kind` -- rủi ro mở rộng**

-   Danh sách được khai báo ở nhiều nơi; kiểu dữ liệu giữa các module
    chưa hoàn toàn thống nhất.
-   Logic so sánh trực tiếp `'SERVICE'` phân tán, làm tăng nguy cơ loại
    mới bị xử lý sai.
-   Đây chủ yếu là rủi ro chi phí mở rộng và không đồng nhất định nghĩa,
    chưa phải rủi ro sai dữ liệu lớn nhất.

## 3. Nguyên tắc kiến trúc đích

Mô hình mới cần phân biệt rõ năm câu hỏi:

1.  **Đối tượng là gì?** -- loại đối tượng hệ thống.
2.  **Đối tượng thuộc nhóm chuyên môn nào?** -- phân loại kỹ thuật.
3.  **Đối tượng được theo dõi ra sao?** -- phương thức theo dõi tồn
    kho/vòng đời.
4.  **Đối tượng thuộc nhóm kinh doanh nào?** -- phân loại thương mại.
5.  **Đối tượng được phép sử dụng trong giao dịch nào?** -- chính sách
    sử dụng/capability.

Không sử dụng một trường để đồng thời trả lời nhiều câu hỏi trên.

## 4. Mô hình dữ liệu đề xuất

  -------------------------------------------------------------------------------
  Chiều thông tin   Trường đề xuất            Mục đích          Cách quản lý
  ----------------- ------------------------- ----------------- -----------------
  Loại đối tượng    `kind`                    Phân biệt hàng    Enum/định nghĩa
                                              hóa, dịch vụ,     hệ thống
                                              thiết bị          

  Phân loại kỹ      `technical_category_id`   Phân nhóm theo    Danh mục hệ
  thuật             hoặc `technical_category` chuyên môn, đặc   thống; cân nhắc
                                              tính vật tư       cho Tenant bổ
                                                                sung

  Phương thức theo  `tracking_method`         Theo số lượng,    Enum hệ thống ở
  dõi                                         lô, serial hoặc   giai đoạn đầu
                                              không theo dõi    
                                              tồn               

  Phân loại thương  `trade_category_id`       Nhóm hàng phục vụ Danh mục theo
  mại                                         CRM, Sales, báo   Tenant
                                              cáo, chiết khấu   

  Chính sách sử     `commercial_usage` hoặc   Bán, tặng, sử     Thuộc tính hoặc
  dụng              capabilities              dụng nội bộ,      quy tắc có kiểm
                                              combo...          soát
  -------------------------------------------------------------------------------

### 4.1. `kind`

-   Giữ là định nghĩa hệ thống, không mặc định cho Tenant tự tạo loại
    đối tượng.
-   Có một nguồn định nghĩa dùng chung cho Kho, CRM và các module.
-   Tránh rải điều kiện kiểm tra chuỗi như `kind === 'SERVICE'`.
-   Cân nhắc lớp capability dùng chung để module truy vấn hành vi, ví dụ
    có quản lý tồn, có thể mua, có thể bán.
-   Cần xác nhận lại ranh giới nghiệp vụ của `ASSET`: thiết bị có thể có
    giai đoạn tồn kho trước khi ghi nhận vào quản lý tài sản hay không.

### 4.2. Phân loại kỹ thuật

-   Tách khỏi tiêu chí nhóm hàng trong CRM.
-   Không dùng nhóm kỹ thuật để tự động quyết định phương thức theo dõi
    duy nhất.
-   Có thể giữ danh mục chuẩn do hệ thống cung cấp; cho Tenant bổ sung
    nếu nhu cầu thực tế yêu cầu.
-   Nếu danh mục cần tùy biến và quản trị theo Tenant, nên dùng bảng
    danh mục thay vì enum cứng.

### 4.3. Phương thức theo dõi

Đề xuất các giá trị khái niệm:

-   `NONE`: không theo dõi tồn kho.
-   `QUANTITY`: theo dõi số lượng.
-   `LOT`: theo dõi theo lô.
-   `SERIAL`: theo dõi từng serial.

Đây là các phương thức cần được kiểm chứng với nghiệp vụ thực tế. Không
mặc định một nhóm kỹ thuật chỉ có một phương thức theo dõi.

Ví dụ: hai mặt hàng cùng nhóm `SPARE_PART` có thể một loại theo số
lượng, loại còn lại theo serial.

Không cho phép thay đổi phương thức theo dõi một cách tùy ý sau khi đã
phát sinh tồn kho, lô hoặc serial. Nếu cần thay đổi, phải có quy trình
chuyển đổi dữ liệu và kiểm tra số dư/lịch sử.

### 4.4. Phân loại thương mại

-   Chuẩn hóa `trade_category` thành `trade_category_id`.
-   Danh mục có định danh ổn định, mã, tên và trạng thái.
-   Đổi tên danh mục không làm mất liên kết với mặt hàng.
-   Không xóa danh mục đang được sử dụng; chuyển sang inactive khi cần
    ngừng áp dụng.
-   Backend phải kiểm tra danh mục tồn tại, đang hợp lệ, thuộc đúng
    Tenant và đúng loại đối tượng.
-   Import Excel/API phải ánh xạ bằng mã hoặc ID ổn định, không chỉ dựa
    vào tên hiển thị.

### 4.5. Chính sách sử dụng thương mại

Cần chốt một trong hai hướng:

**Hướng A -- Chỉ mô tả và lọc**

Giữ trường dạng phân loại, đặt tên rõ như `commercial_usage`. Không
tuyên bố rằng trường này ngăn được giao dịch.

**Hướng B -- Có tác động đến giao dịch**

Chuyển thành các quyền/capability như `allow_sale`, `allow_gift`,
`allow_internal_issue`. Backend phải kiểm tra tại thời điểm tạo và xác
nhận giao dịch.

Nếu có nhiều quy tắc, điều kiện hoặc ngoại lệ theo Tenant, cân nhắc mô
hình chính sách riêng. Không nên xây dựng bảng policy phức tạp trước khi
nghiệp vụ thực sự cần.

## 5. Nguyên tắc Multi-Tenant và dùng chung giữa module

### System Catalog

Các khái niệm có ý nghĩa hệ thống ổn định, ví dụ `kind`,
`tracking_method` và capability nền tảng, cần được định nghĩa tập trung
và dùng chung.

### Tenant Catalog

Các danh mục có thể khác nhau theo doanh nghiệp, ví dụ
`trade_categories` và có thể cả `technical_categories`, được quản lý
trong schema riêng của Tenant.

### Quy tắc bắt buộc

-   Không cho phép tham chiếu danh mục của Tenant khác.
-   Kiểm tra quyền sở hữu và tính hợp lệ ở backend; không chỉ dựa vào
    frontend.
-   Kho, CRM/Sales và AMM sử dụng cùng định nghĩa đối tượng vật tư.
-   Module được phép có quy tắc nghiệp vụ riêng nhưng không tự diễn giải
    lại ý nghĩa của các trường dữ liệu gốc.
-   Các thay đổi danh mục và phân loại quan trọng cần có lịch sử người
    thay đổi, thời điểm và giá trị trước/sau.

## 6. Snapshot và dữ liệu lịch sử giao dịch

Phải phân biệt:

-   **Dữ liệu hiện tại của vật tư:** phản ánh phân loại hiện tại.
-   **Dữ liệu tại thời điểm giao dịch:** phản ánh thông tin đã được chốt
    khi báo giá, hợp đồng hoặc đơn bán phát sinh.

Đổi nhóm thương mại của vật tư không nên tự động sửa lịch sử giao dịch
đã phát hành/chốt. Cần rà soát các snapshot hiện tại của CRM đối với
`material_kind` và `category`, xác định rõ trường nào là dữ liệu lịch sử
có chủ đích và trường nào cần được chuyển đổi.

Không nằm trong phạm vi tự động sửa toàn bộ snapshot cũ nếu chưa có
quyết định riêng từ phụ trách CRM.

## 7. Kế hoạch triển khai theo giai đoạn

### Giai đoạn 1 -- Chặn sai lệch hiện tại (P0)

1.  Bỏ việc dùng `category` làm tiêu chí nhóm hàng trong chính sách giá
    CRM.
2.  Bỏ gán cứng `CONSUMABLE` ở form hàng hóa thương mại.
3.  Bổ sung kiểm tra server cho `trade_category` và `trade_mode`.
4.  Chặn xóa danh mục đang được sử dụng ở backend.
5.  Kiểm tra import Excel/API để ngăn dữ liệu sai loại hoặc sai danh
    mục.
6.  Giữ nguyên snapshot giao dịch cũ cho đến khi có phương án xử lý được
    phê duyệt.

### Giai đoạn 2 -- Chuẩn hóa mô hình dữ liệu (P1)

1.  Chốt định nghĩa `kind`.
2.  Tách phân loại kỹ thuật khỏi phân loại thương mại.
3.  Chuẩn hóa `trade_category` thành ID và bảng danh mục.
4.  Chốt `tracking_method`; bắt đầu bằng enum nếu mỗi vật tư chỉ cần một
    phương thức.
5.  Quyết định `trade_mode` là thuộc tính mô tả hay capability thực thi.
6.  Chỉ tạo bảng cấu hình/chính sách riêng khi có nhu cầu nghiệp vụ đủ
    rõ.

### Giai đoạn 3 -- Đồng bộ logic module (P1)

1.  Tập trung định nghĩa dùng chung cho `kind`, tracking method và
    capabilities.
2.  Chuyển Kho, CRM/Sales và AMM sang sử dụng cùng định nghĩa.
3.  Loại bỏ các enum/type trùng lặp và điều kiện so sánh chuỗi phân tán.
4.  Chuẩn hóa validation tại API và các luồng import.
5.  Bổ sung kiểm tra quyền sở hữu Tenant cho mọi tham chiếu danh mục.

### Giai đoạn 4 -- Migration và làm sạch dữ liệu (P2)

1.  Tạo danh mục chuẩn mới.
2.  Ánh xạ dữ liệu `trade_category` dạng chữ sang ID.
3.  Chuẩn hóa mã cũ của `trade_mode`.
4.  Thống kê và xử lý bản ghi chưa có phân loại.
5.  Rà soát snapshot CRM và báo cáo liên quan.
6.  Chuyển đổi API, truy vấn và import/export.
7.  Đối chiếu số lượng, giá trị và tính toàn vẹn trước/sau migration.
8.  Chỉ loại bỏ trường cũ khi toàn bộ module đã chuyển đổi và được kiểm
    thử.

Không tự động gán nhóm mặc định cho các mặt hàng chưa phân loại nếu
không có quy tắc ánh xạ được xác nhận. Cần giữ trạng thái chưa phân loại
để người có thẩm quyền xử lý.

## 8. Các kiểm thử bắt buộc

  -----------------------------------------------------------------------
  Nhóm kiểm thử                       Kịch bản cần kiểm tra
  ----------------------------------- -----------------------------------
  Danh mục Tenant                     Tenant A không thể gán danh mục của
                                      Tenant B

  Danh mục đang sử dụng               API không cho xóa danh mục đang
                                      được mặt hàng tham chiếu

  Đổi tên danh mục                    Mặt hàng vẫn liên kết đúng sau khi
                                      đổi tên

  Ngừng sử dụng                       Danh mục inactive không được chọn
                                      cho bản ghi mới, nhưng dữ liệu lịch
                                      sử vẫn đọc được

  Import/Export                       Dữ liệu sai mã, sai loại đối tượng
                                      hoặc sai Tenant bị từ chối rõ ràng

  Tracking                            Không đổi từ LOT/SERIAL sang
                                      QUANTITY nếu chưa xử lý tồn và lịch
                                      sử

  CRM snapshot                        Thay đổi phân loại hiện tại không
                                      làm sai dữ liệu giao dịch đã chốt

  Đồng bộ module                      Kho, CRM và AMM diễn giải nhất quán
                                      cùng một vật tư

  Quyền giao dịch                     Nếu usage policy có hiệu lực,
                                      backend thực sự chặn giao dịch
                                      không được phép

  Migration                           Đối chiếu số bản ghi, bản ghi mồ
                                      côi và dữ liệu chưa ánh xạ
  -----------------------------------------------------------------------

## 9. Các quyết định nghiệp vụ cần xác nhận

Trước khi triển khai, cần chốt:

1.  **Nhóm kỹ thuật:** cố định theo hệ thống, Tenant tự tạo, hay hệ
    thống cung cấp mặc định và Tenant được bổ sung?
2.  **Phương thức theo dõi:** có cho phép thay đổi sau khi đã phát sinh
    tồn kho không? Nếu có, điều kiện chuyển đổi là gì?
3.  **Chính sách sử dụng:** chỉ dùng để phân loại/lọc, có chặn
    bán/tặng/xuất nội bộ, hay Tenant tự cấu hình?
4.  **Ranh giới ASSET và STOCK:** thiết bị có được quản lý tồn kho trước
    khi đưa vào sử dụng không?
5.  **CRM snapshot:** những trường phân loại nào cần giữ nguyên lịch sử
    và trường nào cần chuyển đổi?

## 10. Kết luận và kiến nghị

Đề xuất chốt hướng kiến trúc:

-   Giữ `kind` là định nghĩa hệ thống.
-   Tách phân loại kỹ thuật khỏi phân loại thương mại.
-   Chuẩn hóa `trade_category` thành danh mục có ID và ràng buộc toàn
    vẹn.
-   Xác định rõ `trade_mode` là mô tả hay chính sách thực thi.
-   Bổ sung `tracking_method` để độc lập hóa cách quản lý số lượng, lô
    và serial.
-   Xây dựng nguyên tắc System Catalog và Tenant Catalog rõ ràng.
-   Đồng bộ định nghĩa vật tư giữa Kho, CRM/Sales, AMM và các module
    liên quan.

**Không nên biến tất cả trường phân loại thành danh mục động, cũng không
nên tiếp tục mở rộng enum cho mọi nhu cầu.** Nên kết hợp enum hệ thống
cho khái niệm ổn định, danh mục Tenant cho khái niệm tùy biến và
capability/policy cho quy tắc điều khiển nghiệp vụ.

Đích đến là một **Material Domain thống nhất**: một đối tượng vật tư
dùng chung trong toàn hệ thống, nhưng mỗi module khai thác các chiều
thông tin phù hợp với nghiệp vụ của mình.

------------------------------------------------------------------------

## Phụ lục -- Phạm vi và giới hạn đánh giá

Tài liệu rủi ro ban đầu ghi nhận đánh giá dựa trên code, migration và dữ
liệu của một Tenant dev; chưa chạy thử từng kịch bản và chưa đọc hết
CRM. Vì vậy, các nội dung kiến trúc mở rộng trong đề xuất này là khuyến
nghị cần được xác minh bằng rà soát code, kiểm thử và quyết định nghiệp
vụ trước khi triển khai.
