const fs = require('fs');
const path = require('path');

const hrmDir = path.resolve(__dirname, '..');
const dirs = fs.readdirSync(hrmDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && fs.existsSync(path.join(hrmDir, d.name, 'code.html')));

const screens = [];

for (const dir of dirs) {
  const filePath = path.join(hrmDir, dir.name, 'code.html');
  const html = fs.readFileSync(filePath, 'utf8');

  // Let's identify the active module / tab and screen title
  let screenTitle = dir.name;
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (titleMatch) {
    screenTitle = titleMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  // 1. Subtabs bar: find links or buttons within horizontal sub-tab containers
  // Typical patterns: class="...space-x-8..." or class="...border-b..." near top of main
  const subtabs = [];
  // find container with space-x-8 or border-b that contains tab items
  const tabContainerMatch = html.match(/<div[^>]*class="[^"]*(?:space-x-8|space-x-6|border-b)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (tabContainerMatch) {
    const tabInner = tabContainerMatch[1];
    // extract both <a> and <button>
    const itemRegex = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = itemRegex.exec(tabInner)) !== null) {
      const tag = m[1];
      const attrs = m[2];
      const text = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const href = (attrs.match(/href="([^"]*)"/) || [])[1] || '';
      const onclick = (attrs.match(/onclick="([^"]*)"/) || [])[1] || '';
      const isActive = /border-b-2|border-primary|text-primary|active/i.test(attrs);
      
      const hasAction = (tag === 'a' && href && href !== '#' && !href.startsWith('javascript:void')) || !!onclick;
      subtabs.push({
        tag,
        text,
        href,
        onclick,
        isActive,
        hasAction
      });
    }
  }

  // 2. All buttons on the screen and their context
  const btnRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let m;
  const buttons = [];
  while ((m = btnRegex.exec(html)) !== null) {
    const attrs = m[1];
    const innerHtml = m[2];
    const text = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '(Nút biểu tượng / icon)';
    const onclick = (attrs.match(/onclick="([^"]*)"/) || [])[1] || '';
    const hasOnclick = !!onclick;

    // Detect type/role: header action, filter/search, table action, pagination, modal trigger, submit
    let category = 'Hành động khác';
    if (/tạo|thêm|mới|xuất|export|nhập|import|áp dụng/i.test(text)) {
      category = 'Tác vụ chính (Thêm/Tạo/Xuất/Áp dụng)';
    } else if (/lọc|filter|tìm|search|hôm nay|tháng|tuần|chọn/i.test(text)) {
      category = 'Bộ lọc / Thời gian / Tìm kiếm';
    } else if (/duyệt|từ chối|xóa|sửa|chi tiết|kiểm tra|giải trình|chúc mừng|xem|check-out|check-in/i.test(text)) {
      category = 'Thao tác dòng / Thẻ (Row & Card Actions)';
    } else if (/trang|tiếp|lùi|<|>|prev|next|\b\d+\b/i.test(text)) {
      category = 'Phân trang';
    }

    buttons.push({
      text,
      hasOnclick,
      onclick,
      category
    });
  }

  screens.push({
    folder: dir.name,
    title: screenTitle,
    subtabs,
    buttons,
    missingButtons: buttons.filter(b => !b.hasOnclick),
    totalButtons: buttons.length
  });
}

console.log('Total screens:', screens.length);
console.log('Screens with subtabs detected:', screens.filter(s => s.subtabs.length > 0).length);

// Check subtab buttons/links specifically
let subtabsMissingAction = 0;
screens.forEach(s => {
  s.subtabs.forEach(st => {
    if (!st.hasAction && !st.isActive) {
      subtabsMissingAction++;
    }
  });
});
console.log('Subtabs missing link or onclick (inactive):', subtabsMissingAction);

// Write full analysis to a report JSON
fs.writeFileSync(path.join(__dirname, 'detailed_report.json'), JSON.stringify(screens, null, 2), 'utf8');
console.log('Saved detailed_report.json');
