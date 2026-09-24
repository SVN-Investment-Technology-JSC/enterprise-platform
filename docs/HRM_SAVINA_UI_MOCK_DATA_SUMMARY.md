# HRM SAVINA UI Mock Data - Summary

Dữ liệu được sinh từ 45 user SAVINA trong file seed gốc; các trường ngoài seed là mock data để kiểm thử UI.

## Số lượng bản ghi
- employees: **45**
- roster_entries: **2745**
- attendance_summaries: **636**
- attendance_punches: **1220**
- attendance_exceptions: **274**
- attendance_corrections: **40**
- requests: **240**
- leave_balances: **111**
- leave_transactions: **530**
- pending_hr_requests: **37**

## Nhóm chức năng có dữ liệu
- Hồ sơ cá nhân / Hồ sơ nhân sự
- Quá trình công tác / Hợp đồng / Tài liệu
- Chấm công cá nhân
- Log chấm công / Exception / Correction
- Ca làm việc / Roster
- Đơn từ cá nhân
- Inbox HR xử lý đơn
- Quỹ phép & số dư
- Sổ cái biến động phép

## File
- `HRM_SAVINA_UI_MOCK_DATA.json`: dữ liệu dễ dùng cho mock API/frontend.
- `HRM_SAVINA_UI_MOCK_DATA.js`: ES module có thể import trực tiếp.