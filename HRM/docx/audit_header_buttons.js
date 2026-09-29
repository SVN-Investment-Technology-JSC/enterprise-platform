const fs = require('fs');
const path = require('path');

const hrmDir = path.resolve(__dirname, '..');
const P1_SCREENS = [
  'b_n_l_m_vi_c_dashboard_ph_n_h_hrm_svn_dts',
  'vi_c_c_n_x_l_inbox_ph_n_h_hrm_svn_dts',
  'ch_m_c_ng_my_attendance_ph_n_h_hrm_svn_dts',
  'ch_m_c_ng_sub_tab_l_ch_s_qu_t_th_svn_dts',
  'n_t_y_u_c_u_my_requests_ph_n_h_hrm_svn_dts',
  'n_t_y_u_c_u_sub_tab_n_ang_ch_duy_t_svn_dts',
  'n_t_y_u_c_u_sub_tab_l_ch_s_n_t_svn_dts',
  'phi_u_l_ng_my_payslips_ph_n_h_hrm_svn_dts',
  'phi_u_l_ng_sub_tab_l_ch_s_phi_u_l_ng_svn_dts',
  'h_s_c_a_t_i_my_profile_ph_n_h_hrm_svn_dts',
  'h_s_c_a_t_i_sub_tab_ng_n_h_ng_thu_svn_dts',
  'h_s_c_a_t_i_sub_tab_qu_tr_nh_c_ng_t_c_svn_dts',
  'l_ch_l_m_vi_c_ca_k_p_ph_n_h_hrm_svn_dts'
];

console.log('=== FIXING HEADER BUTTONS ===');

for (const screen of P1_SCREENS) {
  const filePath = path.join(hrmDir, screen, 'code.html');
  if (!fs.existsSync(filePath)) continue;

  let content = fs.readFileSync(filePath, 'utf8');

  // Split into header area (before the first tab bar border-b or subtab line) and rest
  const borderBIdx = content.indexOf('<div class="border-b');
  if (borderBIdx === -1) {
    console.log(`[SKIP] No border-b found in ${screen}`);
    continue;
  }

  let headerPart = content.substring(0, borderBIdx);
  const restPart = content.substring(borderBIdx);

  // Replace buttons strictly within headerPart
  headerPart = headerPart.replace(/<button\b([^>]*)>((?:(?!<button)[\s\S])*?)<\/button>/gi, (match, attrs, innerText) => {
    const cleanText = innerText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // 1. Strip any existing onclick from attrs
    let cleanAttrs = attrs.replace(/\s*onclick=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').trim();

    let newOnclick = null;

    if (cleanText.includes('Hôm nay')) {
      newOnclick = null;
    } else if (cleanText.includes('Tạo đơn nhanh') || cleanText.includes('Tạo đơn mới')) {
      newOnclick = "hrmOpenCreateModal('quick')";
    } else if (cleanText.includes('Xuất báo cáo')) {
      newOnclick = "hrmTriggerDownload('Xuat_bao_cao.xlsx')";
    } else if (cleanText.includes('Tạo yêu cầu giải trình') || cleanText.includes('Bổ sung công')) {
      newOnclick = "hrmOpenCreateModal('correction')";
    } else if (cleanText.includes('Xuất dữ liệu công')) {
      newOnclick = "hrmTriggerDownload('Xuat_du_lieu_cong.xlsx')";
    } else if (cleanText.includes('Xuất lịch sử đơn')) {
      newOnclick = "hrmTriggerDownload('Xuat_lich_su_don.xlsx')";
    } else if (cleanText.includes('Khiếu nại lương')) {
      newOnclick = "hrmOpenCreateModal('correction')";
    } else if (cleanText.includes('Tải PDF phiếu lương')) {
      newOnclick = "hrmTriggerDownload('Phieu_luong_PDF.pdf')";
    } else if (cleanText.includes('Xuất hồ sơ PDF')) {
      newOnclick = "hrmTriggerDownload('Ho_so_nhan_su.pdf')";
    } else if (cleanText.includes('Cập nhật thông tin liên hệ')) {
      newOnclick = "hrmOpenUpdateContactModal()";
    }

    if (newOnclick) {
      return `<button ${cleanAttrs} onclick="${newOnclick}">${innerText}</button>`;
    } else {
      return `<button ${cleanAttrs}>${innerText}</button>`;
    }
  });

  const updatedContent = headerPart + restPart;
  fs.writeFileSync(filePath, updatedContent, 'utf8');
}

console.log('=== VERIFYING HEADER BUTTONS ===');

for (const screen of P1_SCREENS) {
  const p = path.join(hrmDir, screen, 'code.html');
  if (!fs.existsSync(p)) continue;
  const html = fs.readFileSync(p, 'utf8');

  const headerMatch = html.match(/<main[\s\S]*?<div class="border-b/i);
  if (!headerMatch) continue;
  const headerHtml = headerMatch[0];

  const btnRegex = /<button\b([^>]*)>((?:(?!<button)[\s\S])*?)<\/button>/gi;
  let m;
  console.log('=== ' + screen);
  while ((m = btnRegex.exec(headerHtml)) !== null) {
    const attrs = m[1];
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const onclickMatch = attrs.match(/onclick="([^"]*)"/i);
    const onclickVal = onclickMatch ? onclickMatch[1] : '(none)';
    console.log('   - [' + text + '] => ' + onclickVal);
  }
}

