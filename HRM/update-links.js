const fs = require('fs');
const path = require('path');

// Định nghĩa từ khóa Tab Text -> Thư mục đích tương đối
const SUBTAB_ROUTING = [
  // Bàn làm việc & Inbox & Lịch
  { match: ['tổng quan hôm nay', 'tổng quan'], folder: 'b_n_l_m_vi_c_dashboard_ph_n_h_hrm_svn_dts' },
  { match: ['việc cần xử lý', 'inbox'], folder: 'vi_c_c_n_x_l_inbox_ph_n_h_hrm_svn_dts' },
  { match: ['lịch làm việc & ca kíp', 'lịch trực ca tuần', 'lịch làm việc ca kíp'], folder: 'l_ch_l_m_vi_c_ca_k_p_ph_n_h_hrm_svn_dts' },

  // Hồ sơ cá nhân
  { match: ['thông tin chung & hợp đồng', 'thông tin chung', 'hồ sơ nhân sự'], folder: 'h_s_c_a_t_i_my_profile_ph_n_h_hrm_svn_dts' },
  { match: ['ngân hàng & thuế', 'ngân hàng'], folder: 'h_s_c_a_t_i_sub_tab_ng_n_h_ng_thu_svn_dts' },
  { match: ['quá trình công tác', 'công tác'], folder: 'h_s_c_a_t_i_sub_tab_qu_tr_nh_c_ng_t_c_svn_dts' },

  // Chấm công cá nhân
  { match: ['chấm công của tôi', 'bảng chấm công cá nhân', 'bảng chấm công'], folder: 'ch_m_c_ng_my_attendance_ph_n_h_hrm_svn_dts' },
  { match: ['lịch sử quét thẻ', 'quét thẻ'], folder: 'ch_m_c_ng_sub_tab_l_ch_s_qu_t_th_svn_dts' },

  // Đơn từ cá nhân
  { match: ['tất cả đơn của tôi', 'đơn từ & yêu cầu'], folder: 'n_t_y_u_c_u_my_requests_ph_n_h_hrm_svn_dts' },
  { match: ['đơn đang chờ duyệt', 'chờ duyệt'], folder: 'n_t_y_u_c_u_sub_tab_n_ang_ch_duy_t_svn_dts' },
  { match: ['lịch sử đơn từ', 'lịch sử đơn'], folder: 'n_t_y_u_c_u_sub_tab_l_ch_s_n_t_svn_dts' },

  // Phiếu lương cá nhân
  { match: ['phiếu lương kỳ này', 'phiếu lương của tôi'], folder: 'phi_u_l_ng_my_payslips_ph_n_h_hrm_svn_dts' },
  { match: ['lịch sử phiếu lương'], folder: 'phi_u_l_ng_sub_tab_l_ch_s_phi_u_l_ng_svn_dts' },

  // Quản lý ca & Chấm công
  { match: ['tổng quan quản lý ca', 'quản lý ca'], folder: 'qu_n_l_ca_ch_m_c_ng_shift_management_roster_ph_n_h_hrm_svn_dts' },
  { match: ['bảng phân ca (roster)', 'bảng phân ca', 'roster'], folder: 'qu_n_l_ca_ch_m_c_ng_sub_tab_b_ng_ph_n_ca_roster_svn_dts' },
  { match: ['bổ sung / sửa công', 'sửa công'], folder: 'qu_n_l_ca_ch_m_c_ng_sub_tab_b_sung_s_a_c_ng_svn_dts' },
  { match: ['log chấm công thô', 'chấm công thô'], folder: 'qu_n_l_ca_ch_m_c_ng_sub_tab_log_ch_m_c_ng_th_svn_dts' },

  // Bảng công tổng hợp
  { match: ['bảng công chi tiết', 'bảng công tổng hợp'], folder: 'b_ng_c_ng_t_ng_h_p_sub_tab_b_ng_c_ng_chi_ti_t_svn_dts' },
  { match: ['quản lý kỳ công', 'khóa sổ'], folder: 'b_ng_c_ng_t_ng_h_p_sub_tab_qu_n_l_k_c_ng_kh_a_s_svn_dts' },

  // Xử lý đơn từ (HR)
  { match: ['đơn chờ hr duyệt', 'chờ hr duyệt', 'xử lý đơn từ'], folder: 'x_l_n_t_sub_tab_n_ch_hr_duy_t_svn_dts' },
  { match: ['quỹ phép sử dụng', 'quỹ phép'], folder: 'x_l_n_t_sub_tab_qu_ph_p_s_d_svn_dts' },
  { match: ['sổ cái biến động phép', 'biến động phép'], folder: 'x_l_n_t_sub_tab_s_c_i_bi_n_ng_ph_p_svn_dts' },

  // Nhân sự & Chức danh
  { match: ['danh sách nhân viên', 'nhân sự & chức danh'], folder: 'nh_n_s_ch_c_danh_hr_operations_ph_n_h_hrm_svn_dts' },
  { match: ['chức danh & jd', 'chức danh'], folder: 'nh_n_s_ch_c_danh_sub_tab_ch_c_danh_jd_svn_dts' },
  { match: ['thang bảng lương'], folder: 'nh_n_s_ch_c_danh_sub_tab_thang_b_ng_l_ng_svn_dts' },
  { match: ['cấu hình lương nhân sự', 'cấu hình lương'], folder: 'nh_n_s_ch_c_danh_sub_tab_c_u_h_nh_l_ng_nh_n_s_svn_dts' },

  // Tiền lương & Chi trả
  { match: ['tính lương tổng hợp', 'tiền lương & chi trả'], folder: 'ti_n_l_ng_chi_tr_payroll_engine_payout_ph_n_h_hrm_svn_dts' },
  { match: ['chốt lương & phiếu lương', 'chốt lương'], folder: 'ti_n_l_ng_chi_tr_sub_tab_ch_t_l_ng_phi_u_l_ng_svn_dts' },
  { match: ['xuất file ngân hàng', 'ngân hàng'], folder: 'ti_n_l_ng_chi_tr_sub_tab_xu_t_file_ng_n_h_ng_svn_dts' },

  // Chính sách nhân sự
  { match: ['quy tắc ca & đi muộn', 'quy tắc ca', 'đi muộn'], folder: 'ch_nh_s_ch_nh_n_s_sub_tab_quy_t_c_ca_i_mu_n_svn_dts' },
  { match: ['quy tắc nghỉ phép', 'nghỉ phép'], folder: 'ch_nh_s_ch_nh_n_s_sub_tab_quy_t_c_ngh_ph_p_svn_dts' },
  { match: ['quy tắc làm thêm', 'làm thêm giờ', 'ot'], folder: 'ch_nh_s_ch_nh_n_s_sub_tab_quy_t_c_l_m_th_m_gi_ot_svn_dts' },
  { match: ['lịch sử phiên bản', 'audit'], folder: 'ch_nh_s_ch_nh_n_s_sub_tab_l_ch_s_phi_n_b_n_audit_svn_dts' }
];

// Định nghĩa điều hướng Sidebar chính
const SIDEBAR_ROUTING = [
  { match: 'bàn làm việc (dashboard)', folder: 'b_n_l_m_vi_c_dashboard_ph_n_h_hrm_svn_dts' },
  { match: 'hồ sơ của tôi', folder: 'h_s_c_a_t_i_my_profile_ph_n_h_hrm_svn_dts' },
  { match: 'chấm công', folder: 'ch_m_c_ng_my_attendance_ph_n_h_hrm_svn_dts' },
  { match: 'đơn từ & yêu cầu', folder: 'n_t_y_u_c_u_my_requests_ph_n_h_hrm_svn_dts' },
  { match: 'phiếu lương', folder: 'phi_u_l_ng_my_payslips_ph_n_h_hrm_svn_dts' },
  { match: 'nhân sự & chức danh', folder: 'nh_n_s_ch_c_danh_hr_operations_ph_n_h_hrm_svn_dts' },
  { match: 'quản lý ca & chấm công', folder: 'qu_n_l_ca_ch_m_c_ng_shift_management_roster_ph_n_h_hrm_svn_dts' },
  { match: 'xử lý đơn từ', folder: 'x_l_n_t_sub_tab_n_ch_hr_duy_t_svn_dts' },
  { match: 'bảng công tổng hợp', folder: 'b_ng_c_ng_t_ng_h_p_sub_tab_b_ng_c_ng_chi_ti_t_svn_dts' },
  { match: 'tiền lương & chi trả', folder: 'ti_n_l_ng_chi_tr_payroll_engine_payout_ph_n_h_hrm_svn_dts' },
  { match: 'chính sách nhân sự', folder: 'ch_nh_s_ch_nh_n_s_sub_tab_quy_t_c_ca_i_mu_n_svn_dts' }
];

function processHtmlFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const currentFolder = path.basename(path.dirname(filePath));

  const injectionScript = `
<script>
// Auto-linked navigation script for HRM Sub-tabs & Sidebar
document.addEventListener("DOMContentLoaded", () => {
  const subtabMap = ${JSON.stringify(SUBTAB_ROUTING)};
  const sidebarMap = ${JSON.stringify(SIDEBAR_ROUTING)};

  // 1. Gắn link cho các Sub-tabs (thẻ button nằm trong thanh tab .border-b)
  document.querySelectorAll('.border-b button, .space-x-8 button').forEach(btn => {
    const text = btn.textContent.toLowerCase().trim();
    for (const item of subtabMap) {
      if (item.match.some(m => text.includes(m))) {
        btn.style.cursor = 'pointer';
        btn.onclick = (e) => {
          e.preventDefault();
          window.location.href = '../' + item.folder + '/code.html';
        };
        break;
      }
    }
  });

  // 2. Gắn link cho các Menu trên Sidebar
  document.querySelectorAll('aside nav a').forEach(a => {
    const text = a.textContent.toLowerCase().trim();
    for (const item of sidebarMap) {
      if (text.includes(item.match)) {
        a.href = '../' + item.folder + '/code.html';
        break;
      }
    }
  });
});
</script>
`;

  if (!content.includes('Auto-linked navigation script for HRM')) {
    content = content.replace('</body>', injectionScript + '\n</body>');
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log('Updated: ' + currentFolder);
  } else {
    content = content.replace(/<script>[\s\S]*?Auto-linked navigation script[\s\S]*?<\/script>/, injectionScript.trim());
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log('Refreshed: ' + currentFolder);
  }
}

function run(baseDir) {
  const items = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory() && item.name !== '.git') {
      const codeHtml = path.join(baseDir, item.name, 'code.html');
      if (fs.existsSync(codeHtml)) {
        processHtmlFile(codeHtml);
      }
    }
  }
}

const targetDir = path.resolve(__dirname);
console.log('Scanning directories in: ' + targetDir);
run(targetDir);
console.log('Done updating links for all screens!');
