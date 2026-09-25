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
  'h_s_c_a_t_i_sub_tab_qu_tr_nh_c_ng_t_c_svn_dts'
];

for (const screen of P1_SCREENS) {
  const p = path.join(hrmDir, screen, 'code.html');
  if (!fs.existsSync(p)) continue;
  let html = fs.readFileSync(p, 'utf8');

  const headerIdx = html.indexOf('<div class="border-b');
  if (headerIdx === -1) continue;

  let headerPart = html.substring(0, headerIdx);
  const restPart = html.substring(headerIdx);

  // 1. Tạo đơn nhanh / Tạo đơn mới
  headerPart = headerPart.replace(/<button\b([^>]*)>([\s\S]*?(?:Tạo đơn nhanh|Tạo đơn mới)[\s\S]*?)<\/button>/gi, (m, attrs, inner) => {
    const cleanAttrs = attrs.replace(/\s*onclick="[^"]*"/gi, '');
    return '<button ' + cleanAttrs + ' onclick="hrmOpenCreateModal(\'quick\')">' + inner + '</button>';
  });

  // 2. Tạo yêu cầu giải trình / Bổ sung công
  headerPart = headerPart.replace(/<button\b([^>]*)>([\s\S]*?(?:Tạo yêu cầu giải trình|Bổ sung công)[\s\S]*?)<\/button>/gi, (m, attrs, inner) => {
    const cleanAttrs = attrs.replace(/\s*onclick="[^"]*"/gi, '');
    return '<button ' + cleanAttrs + ' onclick="hrmOpenCreateModal(\'correction\')">' + inner + '</button>';
  });

  // 3. Khiếu nại lương
  headerPart = headerPart.replace(/<button\b([^>]*)>([\s\S]*?Khiếu nại lương[\s\S]*?)<\/button>/gi, (m, attrs, inner) => {
    const cleanAttrs = attrs.replace(/\s*onclick="[^"]*"/gi, '');
    return '<button ' + cleanAttrs + ' onclick="hrmOpenCreateModal(\'correction\')">' + inner + '</button>';
  });

  // 4. Cập nhật thông tin liên hệ
  headerPart = headerPart.replace(/<button\b([^>]*)>([\s\S]*?Cập nhật thông tin liên hệ[\s\S]*?)<\/button>/gi, (m, attrs, inner) => {
    const cleanAttrs = attrs.replace(/\s*onclick="[^"]*"/gi, '');
    return '<button ' + cleanAttrs + ' onclick="hrmOpenUpdateContactModal()">' + inner + '</button>';
  });

  // 5. Xuất báo cáo / Xuất lịch sử đơn / Xuất dữ liệu công / Tải PDF phiếu lương / Xuất hồ sơ PDF
  headerPart = headerPart.replace(/<button\b([^>]*)>([\s\S]*?(?:Xuất báo cáo|Xuất lịch sử đơn|Xuất dữ liệu công|Tải PDF phiếu lương|Xuất hồ sơ PDF)[\s\S]*?)<\/button>/gi, (m, attrs, inner) => {
    const cleanAttrs = attrs.replace(/\s*onclick="[^"]*"/gi, '');
    const plainName = inner.replace(/<[^>]+>/g, '').trim().replace(/\s+/g, '_');
    return '<button ' + cleanAttrs + ' onclick="hrmTriggerDownload(\'' + plainName + '.xlsx\')">' + inner + '</button>';
  });

  fs.writeFileSync(p, headerPart + restPart, 'utf8');
}
console.log('Successfully synchronized all header buttons across subtabs!');
