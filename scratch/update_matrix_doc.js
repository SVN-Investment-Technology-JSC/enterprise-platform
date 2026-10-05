import fs from 'fs';

const content = `# HRM — Thiết kế Ma trận Quản lý Ca theo Tổ chức & Lớp phủ Đơn từ (HRM Matrix Architecture)

**Trạng thái:** Thiết kế chuẩn hoá theo Kế hoạch Chấm công & Phân ca  
**Phạm vi:** Kế thừa Node gốc Công ty mẹ → Phòng ban/Đơn vị con → Nhân viên cá nhân; Phân ca 1 Ca Hành chính chuẩn 8h tích hợp Nghỉ giữa giờ & Lớp phủ OFF Đơn từ (Leave/Trip Overlay)  
**Tài liệu đối chiếu:** \`shifts-screen.tsx\`, \`HRM_PLAN_1.md\`, \`HRM_Chấm công_PLAN.md\`, \`HRM_Đơn từ_PLAN(1).md\`

---

## 1. Mục tiêu và Quyết định Thiết kế Cốt lõi

| Vấn đề thực tế | Giải pháp & Thiết kế Kiến trúc |
| :--- | :--- |
| **Phân ca Node gốc Công ty mẹ** | Thiết lập tại Node gốc công ty mẹ 1 lần duy nhất; toàn bộ cây tổ chức Core (Khối/Phòng/Ban/Trung tâm) **tự động kế thừa 100%**. |
| **Đặc thù khối Hành chính: 2 buổi Sáng/Chiều nhưng chỉ quẹt thẻ 2 lần** | Áp dụng **1 Ca Hành chính duy nhất 8 tiếng** (\`CA-HC\` 08:00 – 17:30, 480 phút) có cấu hình \`break_minutes = 90\` (12:00 – 13:30). Nhân viên chỉ cần quẹt 2 lần: **Check-in đầu ca sáng** và **Check-out cuối ca chiều**. Bảng lương tự động khấu trừ 1.5h nghỉ trưa không tính lương. |
| **Nghỉ nửa ngày (Sáng hoặc Chiều)** | **TUYỆT ĐỐI KHÔNG xé nhỏ ca trên Roster** thành 2 ca riêng biệt. Roster vẫn giữ nguyên ca chuẩn \`CA-HC\`. Khi nhân viên tạo đơn nghỉ nửa ngày được duyệt qua Procedure Engine, hệ thống áp dụng cơ chế **"Lớp phủ Trạng thái (Leave Overlay)"**: tính là \`OFF trong ca có phép/không phép\` (0.5 công làm việc + 0.5 công phép). |
| **Quản lý > 1.000 Nhân sự không bị quá tải** | Tái cấu trúc ma trận: Tách riêng 2 View Mode: **(1) Ma trận cấp Tổ chức (ORG_LEVEL)** và **(2) Danh sách Ngoại lệ Cá nhân (INDIVIDUAL_EXCEPTIONS)**. Nút gán ngoại lệ đặt ngay tại từng hàng phòng ban, modal tự động lọc nhân sự theo đúng đơn vị mục tiêu. |
| **Tùy biến từng phòng ban** | Cho phép phòng ban ghi đè riêng từng thứ hoặc từng ngày cụ thể; có nhãn \`[Đã tùy biến]\` và nút \`[Khôi phục gốc]\` về lịch công ty mẹ bất kỳ lúc nào. |

---

## 2. Mô hình Ca Hành chính & Lớp phủ Đơn nghỉ (Shift Definition & Leave Overlay)

\`\`\`mermaid
flowchart LR
    subgraph S1["1. Lịch Phân ca Roster (Kế hoạch)"]
        HC["Ca Hành chính Chuẩn (CA-HC)<br>08:00 - 17:30 (8h làm việc + 1.5h nghỉ trưa)"]
        T7["Ca Thứ 7 (CA-T7)<br>08:00 - 12:00 (4h sáng, chiều OFF)"]
        CN["Chủ nhật: OFF cả ngày"]
    end

    subgraph S2["2. Giao dịch Thực tế & Đơn từ"]
        Punch["Chấm công Thực tế (2 mốc)<br>Check-in: 07:58 | Check-out: 12:05"]
        Leave["Đơn nghỉ phép Chiều (AFTERNOON_HALF)<br>13:30 - 17:30 | 0.5 ngày phép"]
    end

    subgraph S3["3. Động cơ Đối soát & Timesheet"]
        Overlay["Cơ chế Ghép Lớp phủ (Overlay Engine)<br>• Sáng: 4h làm việc thực tế (0.5 công)<br>• 12:00 - 13:30: Nghỉ trưa không lương<br>• Chiều: 4h OFF có phép (0.5 công AL)"]
        Final["Tổng hợp Ngày: 1.0 Công Hưởng Lương<br>Early_leave = 0 (Hợp lệ, không vi phạm)"]
    end

    S1 --> Overlay
    S2 --> Overlay
    Overlay --> Final
\`\`\`

### 2.1. Phân loại Trạng thái Hiển thị trên Ma trận (Value Types)

| Ký hiệu | Ý nghĩa nghiệp vụ | Cách hiển thị & Tương tác |
| :---: | :--- | :--- |
| \`CA-HC\` | Ca Hành chính trọn ngày (08:00 - 17:30, nghỉ trưa 12:00 - 13:30). | Badge xanh navy, hiển thị rõ khung giờ và thời lượng 8h. |
| \`CA-T7\` | Ca Thứ 7 (08:00 - 12:00, buổi chiều tự động OFF). | Badge vàng nhạt, ghi chú làm việc nửa ngày. |
| \`OFF\` | Ngày nghỉ tuần hoặc ngày nghỉ định kỳ theo quy chế. | Badge xám viền nét đứt. Click để đổi nhanh thành ngày làm việc khi có sự kiện gấp. |
| \`INHERIT\` | Kế thừa hoàn toàn từ node cha (Cấp Khối/Phòng thừa hưởng từ Công ty mẹ). | Badge mờ có biểu tượng mũi tên kế thừa (\`↳ Kế thừa\`). |
| \`OVERRIDE\` | Phòng ban hoặc Cá nhân có lịch đặc thù khác mẫu chung. | Badge cam hổ phách có nhãn \`● Tùy biến\`. |
| \`LEAVE_OVERLAY\` | Hiển thị lớp phủ đơn nghỉ phép (0.5 ngày Sáng/Chiều hoặc Cả ngày). | Nhãn phụ ghim trên ô ca: \`[Nghỉ chiều: Phép năm AL]\`. |

---

## 3. Cây Tổ chức & Cơ chế Kế thừa Động (Organization Hierarchy & Inheritance)

\`\`\`mermaid
flowchart TD
    A["Node Gốc Công ty Mẹ<br>(Lịch mẫu tuần chuẩn: T2-T6 CA-HC, T7 CA-T7, CN OFF)"] --> B["Khối Kinh doanh / Chi nhánh<br>(Kế thừa hoặc Tùy biến)"]
    A --> C["Khối Văn phòng / Hội sở<br>(Kế thừa 100% lịch mẹ)"]
    B --> D["Phòng Bán hàng Dự án<br>(Ghi đè: Đi làm cả ngày T7)"]
    C --> E["Phòng Kế toán<br>(Kế thừa: T2-T6 HC, T7 Sáng, CN OFF)"]
    D --> F["Nhân viên A<br>(Ngoại lệ: Trực ca đêm Thứ 4)"]
    E --> G["Nhân viên B<br>(Đơn nghỉ chiều: Áp dụng Lớp phủ OFF)"]
\`\`\`

### 3.1. Quy tắc Ưu tiên khi Phân giải Lịch Hiệu lực (Resolution Precedence)
Backend giải quyết lịch cho cặp \`(employee_id, work_date)\` theo thứ tự ưu tiên nghiêm ngặt từ cao xuống thấp:

1. **Ưu tiên 1 (Cao nhất): Ngoại lệ ngày của Nhân viên (\`employee_schedule_overrides\`)**: Đổi ca/trực đột xuất đúng ngày chỉ định.
2. **Ưu tiên 2: Quy tắc lặp của Nhân viên (\`employee_schedule_rules\`)**: Lịch cá nhân cố định dài hạn (ví dụ: Nhân viên nuôi con nhỏ được về sớm 1 tiếng mỗi ngày trong 6 tháng).
3. **Ưu tiên 3: Ngoại lệ ngày của Phòng ban (\`org_schedule_overrides\`)**: Phòng ban huy động làm việc đột xuất vào Chủ nhật.
4. **Ưu tiên 4: Mẫu tuần riêng của Phòng ban (\`org_schedule_patterns\`)**: Phòng ban có lịch làm việc đặc thù khác công ty mẹ.
5. **Ưu tiên 5 (Gốc nền tảng): Lịch chuẩn Công ty mẹ (\`company_root_schedule\`)**: Đảm bảo mọi nhân viên luôn có lịch xác định (\`WORK\` hoặc \`OFF\`).

---

## 4. Thiết kế Giao diện Ma trận Tối ưu cho Doanh nghiệp > 1.000 Nhân sự

### 4.1. Bố cục Chia tách 2 Chế độ Xem (Dual-View Architecture)

\`\`\`text
+-------------------------------------------------------------------------------------------------------+
| [Tháng 10/2026] [< Tuần này >] [Cấu hình Lịch chuẩn Công ty Mẹ] [Nghỉ Lễ Đột xuất] [Công chuẩn Tháng]  |
+-------------------------------------------------------------------------------------------------------+
| Tabs: [1. Ma trận Phòng ban (ORG_LEVEL)]          | [2. Danh sách Ngoại lệ Nhân sự (INDIVIDUAL)]     |
+---------------------------------------------------+---------------------------------------------------+
| CƠ CẤU PHÒNG BAN (CORE) | MA TRẬN PHÂN CA 7 NGÀY (CÔNG TY MẸ -> PHÒNG BAN)                            |
| • Toàn bộ công ty (1200)| T2 28/09   | T3 29/09   | T4 30/09   | T5 01/10   | T6 02/10   | T7 03/10 | CN 04/10 | Gán Ngoại Lệ |
| • Ban Giám đốc (8 NV)   | CA-HC      | CA-HC      | CA-HC      | CA-HC      | CA-HC      | CA-T7    | OFF      | [+ Ngoại lệ] |
| • Khối Kinh doanh (450) | CA-HC      | CA-HC      | CA-HC      | CA-HC      | CA-HC      | CA-HC*   | OFF      | [+ Ngoại lệ] |
| • Khối Kỹ thuật (320)   | CA-HC      | CA-HC      | CA-HC      | CA-HC      | CA-HC      | CA-T7    | OFF      | [+ Ngoại lệ] |
| • Nhà máy Sản xuất (400)| CA-1/CA-2  | CA-1/CA-2  | CA-1/CA-2  | CA-1/CA-2  | CA-1/CA-2  | CA-1     | OFF      | [+ Ngoại lệ] |
+-------------------------------------------------------------------------------------------------------+
\`\`\`

### 4.2. Khắc phục Triệt để Vấn đề Quá tải khi Chọn Nhân viên (> 1.000 người)
1. **Không mở Modal chọn nhân viên từ danh sách toàn công ty**: Nút \`[+ Gán ngoại lệ]\` được đặt ngay tại từng dòng của Phòng ban trong bảng ma trận.
2. **Pre-filter tự động**: Khi bấm gán ngoại lệ từ dòng "Khối Kinh doanh", Modal mở lên đã **chọn sẵn phòng ban**, dropdown nhân sự chỉ tải và tìm kiếm trong phạm vi nhân sự của đơn vị đó, không phải cuộn 1.000 người.
3. **Bộ lọc Phòng ban tích hợp**: Trong Modal có sẵn thanh chuyển đổi phòng ban nhanh nếu HR muốn gán chéo đơn vị mà không cần đóng modal.

### 4.3. Thao tác Trực tiếp Từng Hàng × Cột: Xuất hiện Popover Ngay tại Ô (In-Place Popover)
- **Tương tác trực quan 1-Click**: Khi click vào bất kỳ giao điểm **Phòng ban × Ngày** nào (dù ô đó đang là \`CA-HC\`, \`CA-T7\` hay \`OFF\`), một **Popover gắn liền ngay tại ô** sẽ xuất hiện, không điều hướng trang hay mở modal to che khuất tầm nhìn.
- **Nội dung hiển thị và hành động trên Popover tại chỗ:**
  1. **Định danh ô**: Tên phòng ban + Ngày cụ thể đang thao tác.
  2. **Nguồn kế thừa hiện tại**: Badge nhận diện rõ \`↳ Kế thừa Công ty mẹ\` hoặc \`Ghi đè tại phòng ban\`.
  3. **Đổi ca trực tiếp**: Select box chuyển nhanh sang ca khác (\`CA-HC\`, \`CA-T7\`, \`CA-SANG\`, \`OFF\`...). Thay đổi áp dụng tức thì cho toàn bộ nhân sự phòng ban trong ngày đó.
  4. **Nút "Khôi phục kế thừa Công ty Mẹ"**: Chỉ xuất hiện khi ô này đang có quy tắc tùy biến, 1-click để đưa ô trở lại theo chuẩn mẹ.
  5. **Nút "Gán ngoại lệ cho NV ngày này"**: Kích hoạt form gán ca ngoại lệ cho một nhân sự cụ thể của phòng ban đúng vào ngày đang click.

---

## 5. Thuật toán Xử lý Đơn Nghỉ Nửa ngày trong Ca Hành chính (Leave In Shift Calculation)

Khi nhân viên làm việc theo ca \`CA-HC\` (08:00 - 17:30, nghỉ trưa 12:00 - 13:30) và có đơn nghỉ nửa ngày:

### 5.1. Công thức Phân rã Giờ công & Đối soát Chấm công

$$\\text{Tổng giờ ca chuẩn } (H_{\\text{shift}}) = (17:30 - 08:00) - 1.5\\text{h (Nghỉ trưa)} = 8.0 \\text{ giờ}$$

$$\\text{Khung giờ Buổi Sáng: } 08:00 \\rightarrow 12:00 \\ (4.0\\text{h}) \\quad | \\quad \\text{Khung giờ Buổi Chiều: } 13:30 \\rightarrow 17:30 \\ (4.0\\text{h})$$

### 5.2. Các Kịch bản Đối soát Thực tế trên Bảng công & Lương

| Kịch bản | Đơn được duyệt qua PE | Dữ liệu quẹt thẻ thực tế | Thuật toán Chấm công xử lý | Kết quả trên Bảng công & Lương |
| :--- | :--- | :--- | :--- | :--- |
| **Nghỉ phép buổi Chiều** | Đơn phép năm chiều (\`AL\`): 13:30 – 17:30 | Vào: \`07:55\`<br>Ra: \`12:05\` | • Sáng: Đủ 4h công thực tế.<br>• Chiều: Khớp đơn phép, miễn trừ về sớm.<br>• Phạt về sớm: **0 phút**. | • Công đi làm: **0.5 công**<br>• Công phép năm (\`AL\`): **0.5 công**<br>• **Tổng: 1.0 công nguyên lương** |
| **Nghỉ phép buổi Sáng** | Đơn phép năm sáng (\`AL\`): 08:00 – 12:00 | Vào: \`13:25\`<br>Ra: \`17:32\` | • Sáng: Khớp đơn phép, miễn trừ đi muộn.<br>• Chiều: Đủ 4h công thực tế.<br>• Phạt đi muộn: **0 phút**. | • Công phép năm (\`AL\`): **0.5 công**<br>• Công đi làm: **0.5 công**<br>• **Tổng: 1.0 công nguyên lương** |
| **Nghỉ việc riêng Không lương buổi Chiều** | Đơn nghỉ không lương (\`UL\`): 13:30 – 17:30 | Vào: \`08:00\`<br>Ra: \`12:02\` | • Sáng: Đủ 4h công thực tế.<br>• Chiều: Khớp đơn nghỉ không lương. | • Công đi làm: **0.5 công**<br>• Nghỉ không lương: **0.5 công**<br>• **Tổng lương ngày: 50% lương** |
| **Về sớm tự ý (Không có đơn)** | *Không có đơn duyệt* | Vào: \`08:00\`<br>Ra: \`12:05\` | • Sáng: Đủ 4h công.<br>• Chiều: Vắng mặt không lý do.<br>• Bắt lỗi: **Về sớm 240 phút**. | • Công đi làm: **0.5 công**<br>• Cảnh báo vi phạm kỷ luật về sớm. |

---

## 6. Mô hình Dữ liệu và Schema Đề xuất

\`\`\`sql
-- 1. Bảng Mẫu ca chuẩn (Tuần)
CREATE TABLE hrm_schedule_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    cycle_weeks INT DEFAULT 1,
    is_company_root BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Chi tiết từng thứ trong mẫu ca tuần
CREATE TABLE hrm_schedule_pattern_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_id UUID REFERENCES hrm_schedule_patterns(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL, -- 1: T2, 2: T3, ..., 6: T7, 0: CN
    value_type VARCHAR(32) NOT NULL, -- 'WORK', 'OFF'
    shift_code VARCHAR(64), -- 'CA-HC', 'CA-T7'
    is_half_day BOOLEAN DEFAULT FALSE
);

-- 3. Ghi đè lịch cấp Phòng ban / Tổ chức
CREATE TABLE hrm_org_schedule_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    org_unit_id VARCHAR(64) NOT NULL,
    work_date DATE NOT NULL,
    value_type VARCHAR(32) NOT NULL, -- 'WORK', 'OFF'
    shift_code VARCHAR(64),
    reason TEXT,
    created_by VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(org_unit_id, work_date)
);

-- 4. Ngoại lệ cá nhân đúng ngày / Lặp lại dài hạn
CREATE TABLE hrm_employee_schedule_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    employee_id VARCHAR(64) NOT NULL,
    rule_type VARCHAR(32) NOT NULL, -- 'DATE_OVERRIDE', 'RECURRING_WEEKLY'
    work_date DATE, -- Dùng cho DATE_OVERRIDE
    day_of_week INT, -- Dùng cho RECURRING_WEEKLY
    shift_code VARCHAR(64) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    reason TEXT,
    status VARCHAR(32) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
\`\`\`

---

## 7. Tiêu chí Nghiệm thu Kiến trúc Ma trận

1. **Hiển thị Ma trận Chuẩn:** Node công ty mẹ áp dụng \`CA-HC\` (08:00 - 17:30) cho T2-T6, \`CA-T7\` (08:00 - 12:00) cho T7 và \`OFF\` cho CN. Toàn bộ phòng ban tự động hiển thị theo mẫu này.
2. **Kế thừa & Tùy biến:** Khi sửa Thứ 7 của Phòng Kinh doanh thành \`CA-HC\`, chỉ phòng này đổi thành \`[Đã tùy biến]\`, các phòng ban khác vẫn giữ nguyên; có nút \`[Khôi phục gốc]\` để hoàn trả.
3. **Thao tác Gán Ngoại lệ Mượt mà:** Bấm \`[+ Gán ngoại lệ]\` tại hàng phòng ban bất kỳ, Modal mở ra với bộ lọc đúng phòng ban đó, không bị lag/chậm dù hệ thống có trên 1.000 nhân viên.
4. **Lớp phủ Đơn từ Hoàn hảo:** Nhân viên có ca \`CA-HC\`, quẹt thẻ lúc 07:58 và 12:05, kèm đơn nghỉ chiều được duyệt: Timesheet tự động ghi nhận **0.5 công thực tế + 0.5 công phép**, không báo lỗi về sớm, không làm xé nhỏ cấu trúc ca trên Roster.
`;

fs.writeFileSync('D:\\HRM\\DOCX_md\\HRM_Quản lý ca_MATRIX.md', content, 'utf8');
console.log('Successfully updated D:\\HRM\\DOCX_md\\HRM_Quản lý ca_MATRIX.md');
