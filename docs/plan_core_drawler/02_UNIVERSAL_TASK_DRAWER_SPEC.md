# Đặc tả Kỹ thuật Giai đoạn 2: Universal Task Drawer Component

> **Mã đặc tả:** SPEC-TASK-DRAWER-02 (Đã tinh chỉnh theo phản biện thực tế)  
> **Thuộc kế hoạch:** [README.md](file:///d:/CRM/enterprise-platform/docs/plan_core_drawler/README.md)  
> **Kế thừa hợp đồng:** [01_APPROVAL_CONTRACT_SPEC.md](file:///d:/CRM/enterprise-platform/docs/plan_core_drawler/01_APPROVAL_CONTRACT_SPEC.md)  
> **Vị trí component dự kiến:** `packages/shared/ui/src/lib/task-drawer/`  
> **Trạng thái:** Bản thiết kế hoàn thiện (Refined Specification)

---

## 1. Mục tiêu Thiết kế & Các Điểm Cải tiến Thực tế

Component giao diện **Universal Task Drawer** duy nhất giải quyết bài toán phê duyệt đa phân hệ với các yêu cầu thực tế:
1. **Hỗ trợ Deep Link từ Quả chuông Thông báo**: Đọc URL query params (`?task=<id>` hoặc `?request=<id>&module=<mod>`) để tự động mở Drawer ngay khi người dùng bấm vào thông báo hoặc liên kết trong tin nhắn chat.
2. **Hiển thị Bảng an toàn (Safe Table Display)**: Với các phiếu kho hàng trăm dòng, Drawer chỉ render tối đa 20 dòng kèm thanh điều hướng dẫn sang phân hệ xem toàn bộ danh mục, tránh làm đơ trình duyệt.
3. **Tuân thủ Hành động Động (`availableActions`)**:
   * Chỉ hiển thị những nút mà module công bố hỗ trợ.
   * Với HRM: Chỉ hiện `Phê duyệt` và `Từ chối`.
   * Với Kho / PE: Có thể có thêm `Trả lại / Yêu cầu bổ sung` (`RETURN`).
4. **Bắt buộc nhập lý do đối với cả `REJECT` lẫn `RETURN`**: Không có lối đi tắt hay bypass.
5. **Xử lý lỗi bất đồng bộ & Xung đột trạng thái (409 Conflict)**: Bắt các mã lỗi thực tế như `HRM_REQUEST_NOT_PENDING` hay `PROCEDURE_IN_PROGRESS` để đưa ra thông báo rõ ràng cho người dùng.

---

## 2. Đặc tả Giao diện Chi tiết (UI Components)

### 2.1. Bố cục Tổng thể Drawer (Slide-Over Sheet)

* **Vị trí & Kích thước:** Trượt từ mép phải màn hình, độ rộng `w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl` (tối ưu tỷ lệ 16:9).
* **3 Phân vùng chính:**
  * **Header:** Logo phân hệ, Mã đơn (`code`), Tên người nộp đơn, Badge trạng thái và nút Đóng `✕`.
  * **Body (Cuộn độc lập):**
    * *Khối 1: Tóm tắt thông tin (`task-summary-view`)*: Hiển thị các giá trị dạng chuỗi đã format từ server (`value: string`).
    * *Khối 2: Thuộc tính chi tiết (`task-attributes-view`)*: Các trường đặc thù của đơn.
    * *Khối 3: Bảng kê danh mục (`task-table-view`)*: Bảng vật tư xuất kho, tài sản.
    * *Khối 4: Tài liệu chứng từ (`task-attachments-view`)*: File đính kèm tải qua Presigned URL của hệ thống.
    * *Khối 5: Stepper tiến trình (`task-timeline-view`)*: Các bước duyệt và ý kiến trao đổi.
  * **Footer (Cố định ở đáy):**
    * Link: `Mở toàn màn hình trong module ↗`.
    * Nút hành động dựa trên `availableActions`: `Từ chối...`, `Trả lại...`, `Phê duyệt`.

---

### 2.2. Chi tiết Khối Bảng kê Danh mục an toàn (`task-table-view.tsx`)

Xử lý triệt để bài toán phiếu kho có thể chứa hàng trăm dòng hàng:

```tsx
export function TaskTableView({ block, detailUrl }: { block: TaskTableBlock; detailUrl: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">{block.title}</h4>
        {block.totalRowsCount && (
          <span className="text-xs text-slate-500">
            Tổng cộng: {block.totalRowsCount} mục
          </span>
        )}
      </div>

      {/* Bảng dữ liệu giới hạn tối đa 20 dòng */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-100 bg-slate-50 text-slate-600">
            <tr>
              {block.columns.map((col) => (
                <th key={col.key} className="p-2" style={{ width: col.width }}>
                  {col.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {block.rows.map((row, idx) => (
              <tr key={idx} className="hover:bg-slate-50/50">
                {block.columns.map((col) => (
                  <td key={col.key} className="p-2">
                    {String(row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cảnh báo khi danh mục bị cắt bớt do vượt quá giới hạn hiển thị trong Drawer */}
      {block.hasMoreRows && (
        <div className="flex items-center justify-between rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
          <span>
            Đang hiển thị <b>{block.rows.length}</b> / <b>{block.totalRowsCount}</b> dòng danh mục.
          </span>
          <a
            href={detailUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-blue-700 hover:underline"
          >
            Xem toàn bộ {block.totalRowsCount} dòng trong phân hệ ↗
          </a>
        </div>
      )}

      {/* Dòng tổng tiền / tổng số lượng đã format sẵn */}
      {block.totalSummary && (
        <div className="mt-2 flex justify-end border-t border-slate-100 pt-2 text-xs font-semibold text-slate-900">
          <span>{block.totalSummary.label}: </span>
          <span className="ml-2 text-sm text-emerald-700">{block.totalSummary.value}</span>
        </div>
      )}
    </div>
  );
}
```

---

### 2.3. Cơ chế Form Bắt buộc Lý do tại Footer (`task-action-footer.tsx`)

Xử lý thống nhất cho cả hai hành động `REJECT` (Từ chối) và `RETURN` (Yêu cầu bổ sung):

```tsx
export function TaskActionFooter({
  task,
  onSubmit,
  isSubmitting,
}: {
  task: UniversalTaskDto;
  onSubmit: (action: TaskActionType, reason?: string) => Promise<void>;
  isSubmitting: boolean;
}) {
  // Trạng thái mở form nhập lý do: null | 'REJECT' | 'RETURN'
  const [activeAction, setActiveAction] = useState<TaskActionType | null>(null);
  const [reason, setReason] = useState('');

  const canConfirm = reason.trim().length > 0;

  const isReject = activeAction === 'REJECT';
  const isReturn = activeAction === 'RETURN';

  return (
    <footer className="border-t border-slate-200 bg-slate-50/90 p-4 backdrop-blur">
      {activeAction ? (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-800">
            {isReject ? 'Lý do từ chối (Bắt buộc):' : 'Lý do yêu cầu bổ sung / chỉnh sửa (Bắt buộc):'}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isReject
                ? 'Ghi rõ căn cứ từ chối yêu cầu này...'
                : 'Mô tả thông tin hoặc chứng từ cần bổ sung...'
            }
            maxLength={2000}
            rows={3}
            autoFocus
            className={`w-full rounded-md border p-2 text-sm focus:outline-none ${
              isReject
                ? 'border-rose-300 focus:border-rose-500 focus:ring-1 focus:ring-rose-500'
                : 'border-amber-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
            }`}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">{reason.trim().length} / 2000 ký tự</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmitting}
                onClick={() => {
                  setActiveAction(null);
                  setReason('');
                }}
              >
                Hủy
              </Button>
              <Button
                size="sm"
                variant={isReject ? 'destructive' : 'default'}
                className={isReturn ? 'bg-amber-600 text-white hover:bg-amber-700' : ''}
                disabled={!canConfirm || isSubmitting}
                onClick={() => onSubmit(activeAction, reason.trim())}
              >
                {isSubmitting ? 'Đang gửi...' : isReject ? 'Xác nhận Từ chối' : 'Xác nhận Yêu cầu sửa'}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a
            href={task.detailUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-blue-700 hover:underline"
          >
            Mở toàn màn hình trong module ↗
          </a>

          <div className="flex items-center gap-2">
            {/* Chỉ render các nút có trong task.availableActions */}
            {task.availableActions.includes('RETURN') && (
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmitting}
                className="text-amber-700 hover:bg-amber-50"
                onClick={() => setActiveAction('RETURN')}
              >
                Yêu cầu bổ sung...
              </Button>
            )}

            {task.availableActions.includes('REJECT') && (
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmitting}
                className="text-rose-700 hover:bg-rose-50"
                onClick={() => setActiveAction('REJECT')}
              >
                Từ chối...
              </Button>
            )}

            {task.availableActions.includes('APPROVE') && (
              <Button
                size="sm"
                disabled={isSubmitting}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => onSubmit('APPROVE')}
              >
                Phê duyệt
              </Button>
            )}
          </div>
        </div>
      )}
    </footer>
  );
}
```

---

## 3. Đồng bộ Deep Link & Quả chuông Thông báo

Để bảo đảm trải nghiệm không bị đứt đoạn khi người dùng nhấp vào thông báo từ chuông (NotificationBell) hoặc đường link chia sẻ:

```tsx
// Hook đồng bộ URL params trên Dashboard
export function useDashboardTaskDeepLink() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Đọc ?task=<id> hoặc ?request=<id>
  const deepLinkTaskId = searchParams.get('task') || searchParams.get('request');

  const clearDeepLink = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete('task');
    params.delete('request');
    const newQuery = params.toString() ? `?${params.toString()}` : '';
    router.replace(`${window.location.pathname}${newQuery}`, { scroll: false });
  }, [router]);

  return { deepLinkTaskId, clearDeepLink };
}
```

---

## 4. Xử lý Lỗi & Xung đột Tranh chấp Thực tế (Error Handling)

Khi gọi API action, Drawer phải phân loại các lỗi 409 thực tế trong hệ thống:

```typescript
function handleActionError(error: unknown, reloadTask: () => void) {
  const errCode = (error as any)?.response?.data?.error || (error as any)?.code;

  if (errCode === 'PROCEDURE_IN_PROGRESS') {
    toast.error('Đơn này đã được chuyển sang Quy trình phê duyệt (PE). Vui lòng xử lý qua luồng Quy trình.');
    reloadTask();
    return;
  }

  if (errCode === 'HRM_REQUEST_NOT_PENDING' || errCode === 'TASK_NOT_PENDING') {
    toast.warning('Đơn này đã được xử lý bởi người khác hoặc đã bị hủy.');
    reloadTask();
    return;
  }

  if (errCode === 'SELF_APPROVAL_FORBIDDEN') {
    toast.error('Quy định không cho phép bạn tự duyệt đơn của chính mình.');
    return;
  }

  if (errCode === 'APPROVAL_OUT_OF_SCOPE') {
    toast.error('Đơn này không nằm trong phạm vi phê duyệt của bạn.');
    return;
  }

  toast.error((error as any)?.message || 'Có lỗi xảy ra khi thực hiện hành động.');
}
```
