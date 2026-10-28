# Kế hoạch Tổng thể: Universal Task Drawer & Cải thiện Phân hệ Nhà kho (Giai đoạn 1, 2 & 3)

> **Dự án:** Enterprise Platform (SaaS ERP)  
> **Mục tiêu:** Xây dựng kế hoạch thiết kế chuẩn hóa nền tảng phê duyệt đa phân hệ (Multi-module Approval Platform) với Universal Task Drawer tại Dashboard và cải thiện toàn diện phân hệ Nhà kho & Quản lý Tài sản.  
> **Trạng thái:** Kế hoạch thiết kế hoàn chỉnh (Design Plan — Ready for Review)  
> **Phân công thực hiện:**  
> - **Giai đoạn 1 & 2:** Thiết kế chi tiết Hợp đồng phê duyệt (Approval Contract) và Thiết kế Component Universal Task Drawer.  
> - **Giai đoạn 3:** Kế hoạch Cải thiện Toàn diện Phân hệ Nhà kho & Quản lý Tài sản (Xem [03_INVENTORY_MODULE_IMPROVEMENT_PLAN.md](file:///d:/CRM/enterprise-platform/docs/plan_core_drawler/03_INVENTORY_MODULE_IMPROVEMENT_PLAN.md)).

---

## 1. Bối cảnh & Mục tiêu nền tảng

### 1.1. Vấn đề cần giải quyết
Trước đây, hệ thống gặp phải mâu thuẫn giữa **Kỷ luật kiến trúc** và **Trải nghiệm người dùng (UX)**:
1. **Quá khứ:** Nút duyệt nhanh inline ngoài Dashboard vi phạm ranh giới phân hệ, đục lỗ hổng logic backend bằng cờ `quick: true` (bỏ qua lý do từ chối) và hack đồng bộ timer 20 giây giữa Procedure Engine (PE) và HRM.
2. **Hiện tại:** Gỡ bỏ nút duyệt nhanh, thay bằng link điều hướng `ModuleLinkCard` tuy chuẩn kiến trúc nhưng khiến người dùng bị chuyển trang (`/dashboard` $\rightarrow$ `/modules/hrm/approvals`), làm mất ngữ cảnh công việc và tốn thao tác điều hướng lòng vòng.
3. **Tương lai:** Hệ thống không chỉ có HRM mà sắp tới có **Nhà kho (Warehouse/Inventory)**, **Bảo trì (Maintenance/AMM)**, **Quy trình (Procedure Engine)** và **Tài chính (Finance)**. Nếu mỗi phân hệ lại tự xây một cách duyệt riêng hoặc tự nhồi code vào Dashboard, hệ thống sẽ rơi vào tình trạng vỡ ranh giới (architectural degradation).

### 1.2. Giải pháp chiến lược: Universal Task Drawer
* Xây dựng một **Approval Contract** duy nhất dùng chung cho toàn bộ SaaS Platform.
* Xây dựng một **Universal Task Drawer** duy nhất đặt tại Core Dashboard: render giao diện động dựa trên các khối dữ liệu (Schema-driven Blocks) do từng module cung cấp.
* Hỗ trợ hai chế độ thực thi:
  * **`LOCAL`**: Module tự phê duyệt nội bộ (đơn giản, 1 cấp duyệt, ví dụ: Trưởng bộ phận duyệt nghỉ phép hoặc duyệt xuất kho nhỏ).
  * **`WORKFLOW`**: Chuyển quyền phê duyệt sang Procedure Engine (PE) (quy trình phức tạp, đa cấp, ma trận RACI, điều kiện rẽ nhánh).
* **Nguyên tắc cốt tử:** *"Một bước duyệt chỉ có duy nhất một Approval Owner tại một thời điểm"*.

---

## 2. Cấu trúc Tài liệu Kế hoạch

Tài liệu trong thư mục `docs/plan_core_drawler/` được phân tách thành các phần chuyên biệt:

| Tệp tài liệu | Nội dung trọng tâm | Trạng thái |
|---|---|---|
| [README.md](./README.md) | Tài liệu chủ: Mục tiêu, kiến trúc tổng thể, lộ trình và hướng dẫn bàn giao | Hiện tại |
| [01_APPROVAL_CONTRACT_SPEC.md](./01_APPROVAL_CONTRACT_SPEC.md) | **Giai đoạn 1**: Đặc tả kỹ thuật Approval Contract, DTOs, Rendering Blocks Schema, Concurrency & Idempotency | Hoàn tất |
| [02_UNIVERSAL_TASK_DRAWER_SPEC.md](./02_UNIVERSAL_TASK_DRAWER_SPEC.md) | **Giai đoạn 2**: Đặc tả Component UI, State Machine, Dynamic Import, Validation lý do, Xử lý lỗi | Hoàn tất |
| [03_INVENTORY_MODULE_IMPROVEMENT_PLAN.md](./03_INVENTORY_MODULE_IMPROVEMENT_PLAN.md) | **Giai đoạn 3**: Kế hoạch cải thiện phân hệ Nhà kho, Master-Detail Voucher, Quản lý Lô/Sê-ri, Cây tài sản HRM, Log thí nghiệm | Hoàn tất |
| [04_QUICK_APPROVAL_AUDIT_TRAIL_AND_ENTITLEMENT_PLAN.md](./04_QUICK_APPROVAL_AUDIT_TRAIL_AND_ENTITLEMENT_PLAN.md) | **Giai đoạn 3B & 4**: Đặc tả duyệt nhanh ngoài Dashboard (Inline & Batch Guardrails), Bảo tồn dấu vết kiểm toán (Audit Trail & Snapshot), Ranh giới Schema & Quản trị thuê bao Tenant động | Dự thảo kỹ thuật (Đã cập nhật) |
| [05_MODULE_APPROVAL_NEEDS_ANALYSIS.md](./05_MODULE_APPROVAL_NEEDS_ANALYSIS.md) | **Giai đoạn 5**: Khảo sát Nhu cầu Phê duyệt Toàn bộ Phân hệ, Giải bài toán PE & Thiết kế Hợp đồng Mở rộng (DECISION vs EXECUTION) | Dự thảo kiến trúc (Mới) |

---

## 3. Kiến trúc Tổng thể & Dòng chảy Dữ liệu

```mermaid
flowchart TB
    subgraph UI ["Tầng Giao diện (Client-side)"]
        DASH["Core Dashboard (apps/web)"]
        DRAWER["Universal Task Drawer (@shared-ui)<br/>[Schema-driven Rendering Blocks]"]
        DASH -->|Mở đơn| DRAWER
    end

    subgraph CONTRACT ["Hợp đồng Phê duyệt (Approval Contract)"]
        SPEC["UniversalTaskDto<br/>• Summary Block<br/>• Notice Block (Mới)<br/>• Attributes Block<br/>• Table Block<br/>• Attachments Block<br/>• Timeline Block"]
    end

    subgraph BACKEND ["Tầng Dịch vụ & Nghiệp vụ (Server-side)"]
        GATEWAY["Nginx API Gateway / Task Router"]
        HRM["Module HRM API<br/>(/api/hrm/v1/...)"]
        INV["Module Kho - Inventory API<br/>(/api/inventory/v1/...)"]
        PE["Procedure Engine API<br/>(/api/procedure/v1/...)"]
        FIN["Module Tài chính - Finance API<br/>(/api/finance/v1/...)"]
        MQ["RabbitMQ (enterprise.events)<br/>Transactional Outbox"]
    end

    DRAWER -.->|Đọc / Thực thi theo| SPEC
    DRAWER -->|Gửi Action: APPROVE / REJECT / RETURN / COMPLETE| GATEWAY
    
    GATEWAY -->|Approval Owner = LOCAL (HRM)| HRM
    GATEWAY -->|Approval Owner = LOCAL (Kho)| INV
    GATEWAY -->|Approval Owner = LOCAL (Finance DIRECT)| FIN
    GATEWAY -->|Approval Owner = WORKFLOW| PE

    PE -.->|Sự kiện Outbox khi chuyển bước| MQ
    MQ -.->|Cập nhật dữ liệu nghiệp vụ| INV
    MQ -.->|Cập nhật dữ liệu nghiệp vụ| HRM
    MQ -.->|Cập nhật dữ liệu nghiệp vụ| FIN
```

---

## 4. Ranh giới Kiến trúc & Nguyên tắc Thực tế Bắt buộc

1. **Ranh giới Database**: Không có bảng "Universal Approvals" chung ở tầng DB để ghi đè dữ liệu nghiệp vụ. Bảng nghiệp vụ của HRM nằm ở `hrm_schema`, của Kho nằm ở `inventory_schema`, của PE nằm ở `procedure_schema`, của Tài chính nằm ở `finance_schema`.
2. **Phạm vi Duyệt thuộc về Module (Module-Owned Scope)**: Task Router / Gateway **tuyệt đối không tự ý lọc lại quyền hay phạm vi duyệt**. Mỗi module (như HRM qua `hrm-approval-policy.ts` hay Kho qua quyền quản lý kho) tự chịu trách nhiệm truy vấn và trả về chính xác danh sách đơn mà người dùng hiện tại có thẩm quyền duyệt (theo chuỗi báo cáo, chức danh chỉ định, kiêm nhiệm hay dự phòng). Tránh lỗi người dùng thấy task nhưng bấm vào lại bị `403`.
3. **Không khôi phục lối đi tắt**: Mọi hành động Từ chối (`REJECT`) hoặc Yêu cầu bổ sung (`RETURN`) bắt buộc phải có nội dung văn bản lý do. Nếu thiếu lý do, API của Owner phải lập tức từ chối với mã lỗi `400 Bad Request`.
4. **Quyền sở hữu duy nhất & Chặn xung đột PE**: Khi đơn đã vào Procedure Engine (`workflowInstanceId` tồn tại), chế độ `LOCAL` bị khóa, mọi lệnh gọi qua API cục bộ bị chặn với mã `409 PROCEDURE_IN_PROGRESS`.
5. **Kiểm soát Tranh chấp Thực tế (Atomic Concurrency)**: Không ép buộc cột `version` hay bảng `idempotency` khi schema DB chưa có. Tận dụng cơ chế atomic update theo trạng thái `WHERE id=$1 AND status='PENDING' RETURNING *`, nếu không có dòng nào được cập nhật thì ném lỗi `409 TASK_NOT_PENDING`.
6. **Server-side Formatting**: Mọi giá trị tiền tệ, ngày tháng, định lượng hiển thị trên Drawer phải được **Server định dạng sẵn thành chuỗi (String)** theo locale/tiền tệ của tenant (ví dụ `"15.000.000 ₫"`), tránh để Client tự format.
7. **Bảo vệ Hiệu năng (Safe Table Limit)**: Khối bảng kê (`TaskTableBlock`) giới hạn tối đa 20 dòng trong response Drawer để tránh phình to payload đối với các phiếu kho hàng trăm dòng. Nếu còn dòng, hiển thị link xem toàn bộ trong phân hệ.
8. **Đồng bộ Deep Link từ Thông báo**: Drawer hỗ trợ query param `?task=<id>` hoặc `?request=<id>&module=<mod>` để tự động mở đúng đơn khi người dùng nhấp vào quả chuông thông báo (NotificationBell) hoặc liên kết chat.
9. **Kế thừa Hạ tầng Sẵn có**: File đính kèm dùng trực tiếp Presigned URL của `@enterprise-platform/adapter-storage` (MinIO/S3), không tự xây cơ chế ký mới.
10. **Không phụ thuộc gói mã (Decoupled Bundle Size)**: `apps/web` không được phép import các package tính năng `packages/features/hrm` hay `packages/features/inventory`. Drawer chỉ nạp hợp đồng dữ liệu thuần và render các khối giao diện chuẩn qua `next/dynamic`.

---

## 5. Kế hoạch Triển khai Phân hệ Nhà kho (Giai đoạn 3)

Chi tiết kế hoạch kiến trúc, schema database, các sprint phân kỳ và lộ trình triển khai toàn diện được đặc tả đầy đủ trong tài liệu chuyên biệt:

👉 **[03_INVENTORY_MODULE_IMPROVEMENT_PLAN.md](file:///d:/CRM/enterprise-platform/docs/plan_core_drawler/03_INVENTORY_MODULE_IMPROVEMENT_PLAN.md)**

Các nguyên tắc phân định cốt lõi đã được chuẩn hóa:
1. **Đưa Universal Task Drawer trên HRM lên Ưu tiên số 1 (Reference Implementation):** HRM đã có sẵn dữ liệu và bộ quy tắc duyệt hoàn chỉnh ([hrm-approval-policy.ts](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/infrastructure/hrm-approval-policy.ts)), mang lại giá trị tức thời và kiểm chứng toàn diện Drawer.
2. **Kho chỉ tích hợp 2 tác vụ vào Drawer:** Phiếu xuất kho cấp phát (`STOCK_EXPORT_REQUEST`) và Biên bản kiểm kê kho chênh lệch (`STOCKTAKE_DISCREPANCY`).
3. **Cô lập rủi ro cao đối với Sổ cái (Ledger):** Master-Detail Voucher đa kho chạy trong **Single Postgres Transaction ("All-or-Nothing")**, lỗi 1 dòng thì rollback toàn bộ phiếu.
4. **Kiểm thử FEFO & Import Excel với dữ liệu thật:** Chuẩn bị bộ test fixtures trước khi áp dụng trên môi trường sản xuất.
5. **Tuân thủ ranh giới Schema với HRM (Single Source of Truth):**
   * Kho chỉ lưu `assigned_employee_id UUID` (tuyệt đối không chép trường `name`).
   * HRM giao tiếp với Kho qua Outbox Event (`hrm.employee.onboarded`) và API nội bộ `/v1/internal/` (kiểm tra thu hồi tài sản khi nghỉ việc).
6. **Xử lý Backlog nhanh của Kho:** Sửa lỗi gán nhóm vật tư trong [material-form.tsx](file:///d:/CRM/enterprise-platform/packages/features/inventory/src/lib/components/material-form.tsx) và thêm nút Xuất Excel trên các bảng.

---

## 6. Tổng kết Mở rộng Đa Phân hệ & Lời giải cho Bài toán PE (Giai đoạn 5)

Chi tiết khảo sát và thiết kế hợp đồng mở rộng được đặc tả đầy đủ trong:

👉 **[05_MODULE_APPROVAL_NEEDS_ANALYSIS.md](file:///d:/CRM/enterprise-platform/docs/plan_core_drawler/05_MODULE_APPROVAL_NEEDS_ANALYSIS.md)**

### 6.1. Vấn đề thực tế phát hiện tại Module PE
- Khi kết nối PE vào Dashboard Task Drawer: dữ liệu hiển thị còn chung chung (chỉ có tên instance và bước), không hiển thị các trường dữ liệu tùy chỉnh (`attributeValues`).
- Bước Khởi tạo (**S**) hoặc Thực thi (**E**) trong quy trình thực tế là **bước nhập liệu / tác nghiệp**, nhưng Drawer lại cung cấp nút "Phê duyệt" (do map nhầm sang `APPROVE`), dẫn đến hiểu sai nghiệp vụ và người dùng không biết phải làm gì.

### 6.2. Phân loại 3 nhóm bản chất tác vụ (Task Nature)
Để không phải "vá víu" theo từng module và đảm bảo Core Drawer mở rộng bền vững cho mọi module tương lai:
1. **`DECISION` (Phê duyệt Ra quyết định):** Dữ liệu đã đóng băng, người dùng chỉ đọc và ra quyết định (`APPROVE`, `REJECT`, `RETURN`). Áp dụng cho: HRM, PE vai A/C, Kho (phiếu xuất/kiểm kê), Tài chính DIRECT.
2. **`EXECUTION` (Thực thi / Nhập liệu):** Người dùng cần điền thông tin, checklist, tải chứng từ. Áp dụng cho: PE vai S/E/R. Drawer hiển thị khối `blocks.notice` kèm hướng dẫn và nút điều hướng "Mở biểu mẫu thực thi" (deep link vào module); không hiển thị nút "Phê duyệt". Action hỗ trợ là `COMPLETE`.
3. **`RECORDING` (Ghi nhận Chuyên ngành):** Cần nhập hạch toán, tài khoản ngân hàng phức tạp (Tài chính). Dẫn vào màn hình chuyên dụng.

### 6.3. Nguyên tắc mở rộng cho module mới
- Module mới chỉ cần xây dựng Adapter (triển khai 3 hàm: `getPendingTasks`, `getTaskDetail`, `executeAction`), khai báo tường minh `taskNature` và map vào các Block chuẩn.
- **Tuyệt đối không sửa Core Drawer hay thêm logic điều kiện theo tên module tại Core.**

---

## 7. Các Giải pháp Kỹ thuật Thực chiến đã Triển khai (Lessons Learned & Fixes)

Trong quá trình triển khai và kiểm thử thực tế, hệ thống đã giải quyết triệt để 3 bài toán trải nghiệm người dùng (UX):

1. **Deep Link & Định tuyến đúng Tab Phân hệ:**
   - Liên kết *"Xem đủ X đơn trong Nhân sự"* được chuẩn hóa đường dẫn `/modules/hrm/approvals?tab=MINE`.
   - Các màn hình phân hệ đọc query param `?tab=...`, `?type=...`, `?request=...` để tự động kích hoạt đúng tab và mở sẵn panel chi tiết của đơn được chỉ định.
2. **Khắc phục lỗi Cache cũ khi dùng nút Quay lại trình duyệt (BFCache Navigation):**
   - Khi người dùng duyệt đơn trong HRM rồi bấm nút Quay lại (Back) của trình duyệt về Dashboard, trang không còn bị giữ trạng thái cũ nhờ cơ chế lắng nghe sự kiện `pageshow` kết hợp với `fetch(..., { headers: { 'Cache-Control': 'no-cache' } })` và `router.refresh()`.
3. **Đồng bộ Tức thì Số lượng Đơn trên Badge (Optimistic Realtime Badge Sync):**
   - Khi người dùng hoàn thành một hành động duyệt/từ chối ngay tại Drawer, Dashboard nhận sự kiện `ep:task-action-completed`, lập tức trừ số lượng badge (ví dụ từ 16 xuống 14) và loại bỏ dòng tác vụ tương ứng khỏi danh sách mà không cần đợi người dùng phải tải lại trang (F5).

