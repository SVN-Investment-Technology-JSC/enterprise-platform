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

  // Match innermost button tags
  html = html.replace(/<button\b([^>]*)>((?:(?!<button)[\s\S])*?)<\/button>/gi, (match, attrs, inner) => {
    // If it's a subtab button, skip
    if (attrs.includes('border-b') || inner.includes('Lịch làm việc') || inner.includes('Việc cần xử lý') || inner.includes('Tổng quan hôm nay')) {
      return match;
    }

    // Check if previously wired incorrectly
    if (/onclick=/i.test(attrs)) {
      if (inner.includes('Duyệt nhanh') && attrs.includes('hrmOpenDetailDrawer')) {
        attrs = attrs.replace(/onclick="[^"]*"/i, 'onclick="hrmApproveCard(this, \'Đơn từ của nhân sự\')"');
        return '<button ' + attrs + '>' + inner + '</button>';
      }
      if (inner.includes('Xem chi tiết') && attrs.includes('hrmApproveCard')) {
        attrs = attrs.replace(/onclick="[^"]*"/i, 'onclick="hrmOpenDetailDrawer(\'Chi tiết đơn từ & yêu cầu\', \'#REQ-2024-089\', \'SUBMITTED\')"');
        return '<button ' + attrs + '>' + inner + '</button>';
      }
      return match;
    }

    // 1. Cập nhật / Lưu thông tin liên hệ (Hồ sơ của tôi)
    if (/(?:Cập nhật thông tin liên hệ|Lưu thông tin liên hệ)/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmOpenUpdateContactModal()">' + inner + '</button>';
    }

    // 2. Tạo đơn đổi STK
    if (/Tạo đơn đổi STK/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmOpenCreateModal(\'quick\')">' + inner + '</button>';
    }

    // 3. Tạo đơn nhanh / Tạo đơn mới
    if (/(?:Tạo đơn nhanh|Tạo đơn mới|\+\s*Tạo đơn mới)/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmOpenCreateModal(\'quick\')">' + inner + '</button>';
    }

    // 4. Tạo đơn nghỉ phép
    if (/Tạo đơn nghỉ phép/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmOpenCreateModal(\'quick\')">' + inner + '</button>';
    }

    // 5. Đăng ký làm OT
    if (/Đăng ký làm OT/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmOpenCreateModal(\'quick\')">' + inner + '</button>';
    }

    // 6. Tạo đơn công tác
    if (/Tạo đơn công tác/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmOpenCreateModal(\'quick\')">' + inner + '</button>';
    }

    // 7. Đăng ký đổi ca / Đổi ca
    if (/Đăng ký đổi ca/i.test(inner) || (inner.includes('Đổi ca') && !inner.includes('Tất cả'))) {
      return '<button ' + attrs + ' onclick="hrmOpenCreateModal(\'quick\')">' + inner + '</button>';
    }

    // 8. Xin tạm ứng lương
    if (/Xin tạm ứng lương/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmOpenCreateModal(\'quick\')">' + inner + '</button>';
    }

    // 9. Giải trình / Bổ sung công / Tạo giải trình / Khiếu nại / Phản hồi
    if (/(?:Tạo giải trình|Giải trình công|Tạo yêu cầu giải trình|Khiếu nại|Gửi phản hồi)/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmOpenCreateModal(\'correction\')">' + inner + '</button>';
    }

    // 10. Check-out nhanh
    if (/(?:Check-out nhanh|CHECK-OUT NGAY)/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmCheckOutAction(this)">' + inner + '</button>';
    }

    // 11. Duyệt nhanh
    if (/Duyệt nhanh/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmApproveCard(this, \'Đơn từ của nhân sự\')">' + inner + '</button>';
    }

    // 12. Từ chối
    if (/Từ chối/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmRejectCard(this, \'Yêu cầu của nhân sự\')">' + inner + '</button>';
    }

    // 13. Xem chi tiết / Xem luồng / Xem đơn / Chi tiết
    if (/(?:Xem chi tiết|Xem luồng|Xem đơn|Chi tiết(?!\s+bảng\s+công))/i.test(inner) && !inner.includes('Bảng công')) {
      return '<button ' + attrs + ' onclick="hrmOpenDetailDrawer(\'Chi tiết đơn từ & yêu cầu\', \'#REQ-2024-089\', \'PENDING_APPROVAL\')">' + inner + '</button>';
    }

    // 14. Hủy đơn
    if (/Hủy đơn/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmCancelRow(this, \'#REQ-2024-089\')">' + inner + '</button>';
    }

    // 15. Duyệt bổ sung / Xác nhận công / Hợp lệ vị trí / Ghi nhận OT / Kiểm tra
    if (/(?:Duyệt bổ sung|Xác nhận công|Hợp lệ vị trí|Ghi nhận OT|Kiểm tra &amp; Xử lý ngay|Kiểm tra & Xử lý ngay)/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmOpenDetailDrawer(\'Cảnh báo kỳ công & lương\', \'#ALERT-OCT-2024\', \'PENDING_APPROVAL\')">' + inner + '</button>';
    }
    if (/^Kiểm tra$/i.test(inner.trim())) {
      return '<button ' + attrs + ' onclick="hrmOpenDetailDrawer(\'Chi tiết cảnh báo ngoại lệ GPS\', \'#EXC-2024-002\', \'WARNING\')">' + inner + '</button>';
    }

    // 16. Bỏ qua cảnh báo
    if (/Bỏ qua cảnh báo/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmToast(\'Đã tạm ẩn cảnh báo kỳ công khỏi hàng đợi!\', \'info\', \'Đã bỏ qua\')">' + inner + '</button>';
    }

    // 16b. Bổ sung chữ ký
    if (/Bổ sung chữ ký/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmToast(\'Đã gửi yêu cầu nhân sự bổ sung chữ ký số thành công!\', \'success\', \'Gửi yêu cầu chữ ký\')">' + inner + '</button>';
    }

    // 16c. Chúc mừng sinh nhật
    if (/Chúc mừng/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmToast(\'Đã gửi thiệp chúc mừng sinh nhật đến đồng nghiệp!\', \'success\', \'Sinh nhật\')">' + inner + '</button>';
    }

    // 16d. Hỗ trợ kế toán lương
    if (/Hỗ trợ kế toán lương/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmOpenCreateModal(\'correction\')">' + inner + '</button>';
    }

    // 16e. Tạo đơn điều chỉnh Flow 10
    if (/Tạo đơn điều chỉnh/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmOpenCreateModal(\'quick\')">' + inner + '</button>';
    }

    // 17. Quẹt mã QR / Nhận diện FaceID
    if (/Quẹt mã QR/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmToast(\'Mở camera quét mã QR chấm công thành công!\', \'success\', \'Check-in QR\')">' + inner + '</button>';
    }
    if (/Nhận diện khuôn mặt/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmToast(\'Nhận diện khuôn mặt (FaceID) hợp lệ!\', \'success\', \'Check-in FaceID\')">' + inner + '</button>';
    }

    // 18. Lưu nháp / Gửi duyệt đơn (màn hình My Requests)
    if (/Lưu nháp/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmSaveDraft()">' + inner + '</button>';
    }
    if (/Gửi duyệt đơn/i.test(inner)) {
      return '<button ' + attrs + ' onclick="hrmSubmitNewRequest(\'HRM_LEAVE_REQUESTS\')">' + inner + '</button>';
    }

    // 19. Xuất file / Tải PDF
    if (/(?:Xuất báo cáo|Xuất lịch sử đơn|Xuất dữ liệu công|Xuất dữ liệu Excel|Xuất Excel|Tải PDF|Xuất hồ sơ PDF|download)/i.test(inner)) {
      const name = inner.replace(/<[^>]+>/g, '').trim().replace(/\s+/g, '_') || 'File_Bao_Cao';
      return '<button ' + attrs + ' onclick="hrmTriggerDownload(\'' + name + '.xlsx\')">' + inner + '</button>';
    }

    return match;
  });

  fs.writeFileSync(p, html, 'utf8');
  console.log('Successfully wired P1 buttons for:', screen);
}
