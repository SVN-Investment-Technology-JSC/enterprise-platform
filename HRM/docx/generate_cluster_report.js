const fs = require('fs');
const path = require('path');

const hrmDir = path.resolve(__dirname, '..');
const dirs = fs.readdirSync(hrmDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && fs.existsSync(path.join(hrmDir, d.name, 'code.html')));

const screens = [];

for (const dir of dirs) {
  const filePath = path.join(hrmDir, dir.name, 'code.html');
  const html = fs.readFileSync(filePath, 'utf8');

  // Title
  let screenTitle = dir.name;
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (titleMatch) {
    screenTitle = titleMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  // Find sub-tab navigation containers
  // Sub-tabs usually are inside <div class="...border-b..."> with <a> or <button>
  // Let's identify the specific sub-tab header area
  const tabAreaRegex = /<div\s+class="border-b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i;
  const tabAreaMatch = html.match(tabAreaRegex);

  const subtabButtons = [];
  const subtabLinks = [];

  if (tabAreaMatch) {
    const tabAreaHtml = tabAreaMatch[0];
    
    // buttons inside tab area
    const btnTabRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
    let btm;
    while ((btm = btnTabRegex.exec(tabAreaHtml)) !== null) {
      const attrs = btm[1];
      const text = btm[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const hasOnclick = /onclick\s*=/i.test(attrs);
      const isActive = /border-b-2|border-primary|text-primary/i.test(attrs);
      subtabButtons.push({
        text,
        hasOnclick,
        isActive,
        raw: btm[0]
      });
    }

    // links inside tab area
    const linkTabRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let ltm;
    while ((ltm = linkTabRegex.exec(tabAreaHtml)) !== null) {
      const attrs = ltm[1];
      const text = ltm[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const hrefMatch = attrs.match(/href="([^"]*)"/i);
      const href = hrefMatch ? hrefMatch[1] : '';
      const hasOnclick = /onclick\s*=/i.test(attrs);
      const isActive = /border-b-2|border-primary|text-primary/i.test(attrs);
      const isDeadLink = href === '#' || href === '' || href.startsWith('javascript:void');
      subtabLinks.push({
        text,
        href,
        hasOnclick,
        isActive,
        isDeadLink
      });
    }
  }

  // All buttons in page
  const btnRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let bm;
  const allButtons = [];
  while ((bm = btnRegex.exec(html)) !== null) {
    const attrs = bm[1];
    const text = bm[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '(Biểu tượng / Icon)';
    const hasOnclick = /onclick\s*=/i.test(attrs);
    const onclickVal = (attrs.match(/onclick="([^"]*)"/i) || [])[1] || '';

    // Classify button
    let group = 'Nội dung màn hình (Thao tác / Bảng / Form)';
    if (tabAreaMatch && tabAreaMatch[0].includes(bm[0])) {
      group = 'Thanh Subtab (Điều hướng Tab ngang)';
    } else if (/<header|<div[^>]*class="[^"]*(?:flex-row|items-center|justify-between)[^"]*"[^>]*>\s*<div>\s*<h1/i.test(html) && html.indexOf(bm[0]) < html.indexOf('<main') + 500) {
      // Near top header
      if (/tạo|thêm|xuất|export|lọc|hôm nay/i.test(text)) {
        group = 'Header / Thao tác cấp cao (Top Actions)';
      }
    }

    allButtons.push({
      text,
      hasOnclick,
      onclickVal,
      group
    });
  }

  screens.push({
    dir: dir.name,
    title: screenTitle,
    subtabButtons,
    subtabLinks,
    totalButtons: allButtons.length,
    missingOnclickButtons: allButtons.filter(b => !b.hasOnclick),
    buttons: allButtons
  });
}

// Generate statistical summary
console.log('=== KẾT QUẢ THỐNG KÊ CHI TIẾT ===');
console.log('Tổng số màn hình:', screens.length);

let totalButtons = 0;
let totalMissing = 0;
let tabButtonsCount = 0;
let tabButtonsMissing = 0;
let deadTabLinksCount = 0;

screens.forEach(s => {
  totalButtons += s.totalButtons;
  totalMissing += s.missingOnclickButtons.length;
  tabButtonsCount += s.subtabButtons.length;
  tabButtonsMissing += s.subtabButtons.filter(b => !b.hasOnclick).length;
  deadTabLinksCount += s.subtabLinks.filter(l => !l.isActive && l.isDeadLink && !l.hasOnclick).length;
});

console.log('Tổng số <button>: ' + totalButtons);
console.log('Số <button> THIẾU onclick: ' + totalMissing);
console.log('Số <button> nằm trực tiếp trong thanh Tab / Subtab: ' + tabButtonsCount);
console.log('Số <button> trong thanh Tab/Subtab THIẾU onclick: ' + tabButtonsMissing);
console.log('Số thẻ <a tab> (Subtab) là deadlink (href="#" và không có onclick): ' + deadTabLinksCount);

// Group screens by functional cluster according to DANH_MUC_VA_LIEN_KET_GIAO_DIEN.md
const clusters = {
  '1. Tổng quan & Hộp thư (Dashboard & Inbox)': [
    'b_n_l_m_vi_c_dashboard_ph_n_h_hrm_svn_dts',
    'vi_c_c_n_x_l_inbox_ph_n_h_hrm_svn_dts',
    'l_ch_l_m_vi_c_ca_k_p_ph_n_h_hrm_svn_dts'
  ],
  '2. Cá nhân (Employee Self-Service - ESS)': [
    'h_s_c_a_t_i_my_profile_ph_n_h_hrm_svn_dts',
    'h_s_c_a_t_i_sub_tab_ng_n_h_ng_thu_svn_dts',
    'h_s_c_a_t_i_sub_tab_qu_tr_nh_c_ng_t_c_svn_dts',
    'ch_m_c_ng_my_attendance_ph_n_h_hrm_svn_dts',
    'ch_m_c_ng_sub_tab_l_ch_s_qu_t_th_svn_dts',
    'n_t_y_u_c_u_my_requests_ph_n_h_hrm_svn_dts',
    'n_t_y_u_c_u_sub_tab_n_ang_ch_duy_t_svn_dts',
    'n_t_y_u_c_u_sub_tab_l_ch_s_n_t_svn_dts',
    'phi_u_l_ng_my_payslips_ph_n_h_hrm_svn_dts',
    'phi_u_l_ng_sub_tab_l_ch_s_phi_u_l_ng_svn_dts'
  ],
  '3. Vận hành nhân sự (HR Operations)': [
    'nh_n_s_ch_c_danh_hr_operations_ph_n_h_hrm_svn_dts',
    'nh_n_s_ch_c_danh_sub_tab_ch_c_danh_jd_svn_dts',
    'nh_n_s_ch_c_danh_sub_tab_thang_b_ng_l_ng_svn_dts',
    'nh_n_s_ch_c_danh_sub_tab_c_u_h_nh_l_ng_nh_n_s_svn_dts',
    'qu_n_l_ca_ch_m_c_ng_shift_management_roster_ph_n_h_hrm_svn_dts',
    'qu_n_l_ca_ch_m_c_ng_sub_tab_b_ng_ph_n_ca_roster_svn_dts',
    'qu_n_l_ca_ch_m_c_ng_sub_tab_b_sung_s_a_c_ng_svn_dts',
    'qu_n_l_ca_ch_m_c_ng_sub_tab_log_ch_m_c_ng_th_svn_dts',
    'x_l_n_t_sub_tab_n_ch_hr_duy_t_svn_dts',
    'x_l_n_t_sub_tab_qu_ph_p_s_d_svn_dts',
    'x_l_n_t_sub_tab_s_c_i_bi_n_ng_ph_p_svn_dts',
    'b_ng_c_ng_t_ng_h_p_sub_tab_b_ng_c_ng_chi_ti_t_svn_dts',
    'b_ng_c_ng_t_ng_h_p_sub_tab_qu_n_l_k_c_ng_kh_a_s_svn_dts',
    'ti_n_l_ng_chi_tr_payroll_engine_payout_ph_n_h_hrm_svn_dts',
    'ti_n_l_ng_chi_tr_sub_tab_ch_t_l_ng_phi_u_l_ng_svn_dts',
    'ti_n_l_ng_chi_tr_sub_tab_t_m_ng_l_ng_svn_dts',
    'ti_n_l_ng_chi_tr_sub_tab_xu_t_file_ng_n_h_ng_svn_dts'
  ],
  '4. Quản trị & Chính sách nhân sự': [
    'ch_nh_s_ch_nh_n_s_sub_tab_quy_t_c_ca_i_mu_n_svn_dts',
    'ch_nh_s_ch_nh_n_s_sub_tab_quy_t_c_ngh_ph_p_svn_dts',
    'ch_nh_s_ch_nh_n_s_sub_tab_quy_t_c_l_m_th_m_gi_ot_svn_dts',
    'ch_nh_s_ch_nh_n_s_sub_tab_l_ch_s_phi_n_b_n_audit_svn_dts'
  ]
};

const report = {
  summary: {
    totalScreens: screens.length,
    totalButtons,
    totalMissing,
    tabButtonsCount,
    tabButtonsMissing,
    deadTabLinksCount
  },
  clusters: {}
};

for (const [cName, dirList] of Object.entries(clusters)) {
  report.clusters[cName] = dirList.map(d => {
    const sc = screens.find(s => s.dir === d);
    if (!sc) return { dir: d, notFound: true };
    return {
      dir: sc.dir,
      title: sc.title,
      totalButtons: sc.totalButtons,
      missingCount: sc.missingOnclickButtons.length,
      subtabButtons: sc.subtabButtons,
      deadTabLinks: sc.subtabLinks.filter(l => !l.isActive && l.isDeadLink && !l.hasOnclick),
      sampleMissingButtons: sc.missingOnclickButtons.map(b => b.text)
    };
  });
}

fs.writeFileSync(path.join(__dirname, 'cluster_report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log('Exported cluster_report.json successfully');
