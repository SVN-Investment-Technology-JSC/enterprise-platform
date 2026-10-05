const fs = require('fs');
const xlsx = require('xlsx');

// 1. Đọc file Markdown hợp nhất TEST_2026_29_09.md
const mdContent = fs.readFileSync('D:/CRM/enterprise-platform/TEST_2026_29_09.md', 'utf-8');
const lines = mdContent.split('\n');

// Danh sách tài khoản
const accounts = [
  ['#', 'Ký hiệu', 'Họ và tên', 'Email đăng nhập', 'Mật khẩu seed', 'Đơn vị / Vai trò', 'Trách nhiệm kiểm thử'],
  [1, 'NV-1', 'Bùi Công Quyền', 'bui.cong.quyen@savina.local', 'Savina-Member-Demo-2026', 'Phòng Thí nghiệm / Member', 'Nhân viên gửi đơn HRM, quẹt thẻ, thực hiện task Workspace, kéo thả Kanban, chat trao đổi'],
  [2, 'NV-2', 'Phan Đức Thắng', 'phan.duc.thang@savina.local', 'Savina-Member-Demo-2026', 'Phòng Thí nghiệm', 'Đồng nghiệp đối ứng nhận xác nhận đổi ca chéo (PENDING_PEER)'],
  [3, 'TN', 'Nguyễn Tấn Thịnh', 'nguyen.tan.thinh@savina.local', 'Savina-Member-Demo-2026', 'Trưởng phòng Thí nghiệm / Manager', 'Quản lý cấp 1 phê duyệt đơn, duyệt giải trình công, thiết lập phụ thuộc task Workspace'],
  [4, 'HCTH', 'Nguyễn Trần Như Quỳnh', 'nguyen.tran.nhu.quynh@savina.local', 'Savina-Member-Demo-2026', 'Trưởng phòng HCTH / Tenant Admin / Project Owner', 'Quản trị nhân sự, danh mục ca, JD, tạo dự án WBS, quản lý ngân sách tài chính & kho tài liệu']
];

const actorMap = {
  'NV-1': 'NV-1 · Bùi Công Quyền',
  'NV-2': 'NV-2 · Phan Đức Thắng',
  'TN': 'TN · Nguyễn Tấn Thịnh',
  'HCTH': 'HCTH · Như Quỳnh',
  'PM': 'HCTH · Như Quỳnh',
  'LEAD': 'TN · Nguyễn Tấn Thịnh',
  'MEMBER': 'NV-1 · Bùi Công Quyền',
  'HCTH / NV-1': 'HCTH / NV-1',
  'PM / NV-1': 'HCTH / NV-1',
  'NV-1 / HCTH': 'NV-1 / HCTH'
};

const testCases = [
  ['Trạng thái', 'Mã TC', 'Phân hệ', 'Ai thực hiện', 'Thao tác trên giao diện', 'Kết quả mong đợi', 'Ghi chú / Bug ID']
];

let currentSection = '';

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();

  // Bắt tiêu đề Phân hệ (## 1., ## 2., ..., ## 14.)
  const sectionMatch = line.match(/^##\s+(\d+)\.\s+(.*)$/);
  if (sectionMatch) {
    const rawTitle = sectionMatch[2];
    // Rút gọn tên phân hệ để đưa vào cột 'Phân hệ'
    currentSection = rawTitle.replace(/\s*\(`.*`\)/, '').trim();
    continue;
  }

  // Bắt dòng bảng test case: | 1.1.1 | **NV-1** | ... | ... |
  // hoặc | 8.1 | **HCTH** | ... | ... |
  if (line.startsWith('|') && line.includes('**')) {
    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 4) {
      const tcId = parts[0].replace(/\*\*/g, '').trim();
      const rawActor = parts[1].replace(/\*\*/g, '').trim();
      const action = parts[2].replace(/<br>/g, '\n').trim();
      const expected = parts[3].replace(/<br>/g, '\n').trim();

      // Kiểm tra xem tcId có dạng số.số hoặc số.số.số không
      if (/^\d+(\.\d+)+$/.test(tcId)) {
        const actorName = actorMap[rawActor] || rawActor;
        testCases.push([
          'Chưa test',
          tcId,
          currentSection,
          actorName,
          action,
          expected,
          ''
        ]);
      }
    }
  }
}

console.log('Tổng số Test Cases trích xuất được:', testCases.length - 1);

// Tạo workbook mới
const wb = xlsx.utils.book_new();

const wsAccounts = xlsx.utils.aoa_to_sheet(accounts);
const wsTestCases = xlsx.utils.aoa_to_sheet(testCases);

// Căn chỉnh độ rộng cột
wsAccounts['!cols'] = [
  { wch: 5 },
  { wch: 10 },
  { wch: 25 },
  { wch: 32 },
  { wch: 28 },
  { wch: 35 },
  { wch: 70 }
];

wsTestCases['!cols'] = [
  { wch: 12 },
  { wch: 10 },
  { wch: 35 },
  { wch: 24 },
  { wch: 60 },
  { wch: 70 },
  { wch: 20 }
];

xlsx.utils.book_append_sheet(wb, wsAccounts, 'Tai_khoan_kiem_thu');
xlsx.utils.book_append_sheet(wb, wsTestCases, 'Kich_ban_kiem_thu');

xlsx.writeFile(wb, 'D:/CRM/enterprise-platform/TEST_2026_29_09.xlsx');
console.log('Đã cập nhật thành công file TEST_2026_29_09.xlsx');
