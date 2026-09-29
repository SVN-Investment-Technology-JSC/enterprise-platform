/**
 * HRM Phase 1 Global Interaction Hub
 * Bao gồm:
 * 1. Toast Notification system
 * 2. Popconfirm (xác nhận nhanh tại chỗ)
 * 3. Popup Form Dialog (Thêm đối tượng mới - HRM Database schema)
 * 4. Drawer (Xem chi tiết đối tượng + nút Edit)
 * 5. Download / Export handler
 */

(function () {
  // Inject style cho UI components nếu chưa có
  const style = document.createElement('style');
  style.id = 'hrm-interactive-styles';
  style.innerHTML = `
    .hrm-toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }
    .hrm-toast {
      pointer-events: auto;
      min-width: 320px;
      max-width: 420px;
      background: #ffffff;
      border-radius: 10px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      padding: 14px 16px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      font-size: 13px;
      border-left: 4px solid #0460D9;
      transform: translateX(120%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
      opacity: 0;
    }
    .hrm-toast.show {
      transform: translateX(0);
      opacity: 1;
    }
    .hrm-toast.success { border-left-color: #16a34a; }
    .hrm-toast.error { border-left-color: #dc2626; }
    .hrm-toast.info { border-left-color: #0460D9; }

    /* Popconfirm overlay */
    .hrm-popconfirm-overlay {
      position: fixed;
      inset: 0;
      z-index: 99998;
      background: transparent;
    }
    .hrm-popconfirm {
      position: fixed;
      z-index: 99999;
      width: 270px;
      max-width: calc(100vw - 32px);
      background: #ffffff;
      border-radius: 8px;
      padding: 14px 16px;
      box-shadow: 0 10px 25px -3px rgba(0,0,0,0.2), 0 4px 6px -2px rgba(0,0,0,0.08);
      border: 1px solid #cbd5e1;
      font-family: inherit;
      animation: hrmPopFade 0.15s ease-out forwards;
    }
    .hrm-popconfirm-arrow {
      position: absolute;
      width: 10px;
      height: 10px;
      background: #ffffff;
      transform: rotate(45deg);
      border: 1px solid #cbd5e1;
      pointer-events: none;
    }
    .hrm-popconfirm.placement-bottom .hrm-popconfirm-arrow {
      top: -6px;
      border-right: none;
      border-bottom: none;
    }
    .hrm-popconfirm.placement-top .hrm-popconfirm-arrow {
      bottom: -6px;
      border-left: none;
      border-top: none;
    }
    @keyframes hrmPopFade {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
  `;
  if (!document.getElementById('hrm-interactive-styles')) {
    document.head.appendChild(style);
  }

  // Toast Container
  let toastContainer = document.querySelector('.hrm-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'hrm-toast-container';
    document.body.appendChild(toastContainer);
  }

  window.hrmToast = function (message, type = 'success', title = 'Thông báo') {
    const icon = type === 'success' ? 'check_circle' : (type === 'error' ? 'cancel' : 'info');
    const colorClass = type === 'success' ? 'text-green-600' : (type === 'error' ? 'text-red-600' : 'text-primary');

    const toast = document.createElement('div');
    toast.className = `hrm-toast ${type}`;
    toast.innerHTML = `
      <span class="material-symbols-outlined ${colorClass} text-[22px] shrink-0">${icon}</span>
      <div class="flex-1">
        <strong class="block text-on-surface font-semibold text-xs leading-tight mb-0.5">${title}</strong>
        <span class="text-on-surface-variant text-[12px] leading-relaxed block">${message}</span>
      </div>
      <button class="text-gray-400 hover:text-gray-600 text-[16px] leading-none shrink-0" onclick="this.parentElement.remove()">✕</button>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  };

  // Popconfirm Generator (Smart Viewport & Placement Aware)
  window.hrmPopconfirm = function (targetEl, options = {}) {
    const existing = document.querySelector('.hrm-popconfirm-overlay');
    if (existing) existing.remove();

    const title = options.title || 'Xác nhận thao tác?';
    const message = options.message || 'Bạn có chắc chắn muốn thực hiện thao tác này?';
    const okText = options.okText || 'Xác nhận';
    const cancelText = options.cancelText || 'Hủy';
    const okClass = options.isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0460D9] hover:bg-blue-700';

    const overlay = document.createElement('div');
    overlay.className = 'hrm-popconfirm-overlay';

    const pop = document.createElement('div');
    pop.className = 'hrm-popconfirm';

    // Measure button and viewport
    const rect = targetEl.getBoundingClientRect();
    const popWidth = 270;
    const estHeight = 125;
    const spacing = 8;
    const padding = 12;

    // Determine vertical placement: top or bottom
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placeTop = spaceBelow < (estHeight + spacing) && spaceAbove >= (estHeight + spacing);

    let top;
    if (placeTop) {
      pop.classList.add('placement-top');
      top = rect.top - estHeight - spacing;
    } else {
      pop.classList.add('placement-bottom');
      top = rect.bottom + spacing;
    }

    // Determine horizontal alignment: centered or clamped inside viewport
    const targetCenterX = rect.left + rect.width / 2;
    let left = targetCenterX - popWidth / 2;

    // Clamp horizontally to stay completely within viewport bounds
    if (left < padding) {
      left = padding;
    } else if (left + popWidth > window.innerWidth - padding) {
      left = window.innerWidth - popWidth - padding;
    }

    pop.style.top = `${Math.max(padding, top)}px`;
    pop.style.left = `${left}px`;

    // Calculate arrow position relative to popconfirm box so arrow points directly to button center
    const arrowLeft = Math.max(12, Math.min(popWidth - 22, targetCenterX - left - 5));

    pop.innerHTML = `
      <div class="hrm-popconfirm-arrow" style="left: ${arrowLeft}px;"></div>
      <div class="flex items-start gap-2 mb-2.5">
        <span class="material-symbols-outlined ${options.isDanger ? 'text-red-500' : 'text-amber-500'} text-[19px] shrink-0">help</span>
        <div class="flex-1 min-w-0">
          <h5 class="text-xs font-bold text-gray-800 leading-tight">${title}</h5>
          <p class="text-[11px] text-gray-600 mt-1 leading-relaxed">${message}</p>
        </div>
      </div>
      <div class="flex items-center justify-end gap-1.5 pt-2 border-t border-gray-100">
        <button class="px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100 rounded btn-cancel transition-colors">${cancelText}</button>
        <button class="px-2.5 py-1 text-[11px] font-semibold text-white rounded ${okClass} btn-ok shadow-xs transition-colors">${okText}</button>
      </div>
    `;

    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    pop.querySelector('.btn-cancel').onclick = () => overlay.remove();
    pop.querySelector('.btn-ok').onclick = () => {
      overlay.remove();
      if (typeof options.onConfirm === 'function') {
        options.onConfirm();
      }
    };
  };

  // Generic Download Handler
  window.hrmTriggerDownload = function (fileName) {
    hrmToast(`Hệ thống đang trích xuất dữ liệu và tải tệp <strong>${fileName}</strong> về máy...`, 'info', 'Đang tải tệp');
    setTimeout(() => {
      hrmToast(`Tải tệp <strong>${fileName}</strong> hoàn tất!`, 'success', 'Tải thành công');
    }, 1200);
  };

  // Popup Form Generator (ADD OBJECT - Modal Dialog)
  window.hrmOpenCreateModal = function (formType = 'leave') {
    const existing = document.getElementById('hrm-create-modal');
    if (existing) existing.remove();

    const forms = {
      quick: {
        title: 'Tạo đơn phát sinh nhanh (Fast e-Request)',
        code: 'HRM_QUICK_REQUEST',
        html: `
          <div class="space-y-3.5">
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Loại đơn muốn tạo <span class="text-red-500">*</span></label>
              <select id="hrm-modal-request-type" class="w-full text-xs font-medium border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="LEAVE">Đơn xin nghỉ phép (HRM_LEAVE_REQUESTS)</option>
                <option value="OT">Đơn làm thêm giờ (HRM_OT_REQUESTS)</option>
                <option value="TRIP">Đơn đi công tác (HRM_BUSINESS_TRIP_REQUESTS)</option>
                <option value="SHIFT">Đơn đổi ca làm việc (HRM_SHIFT_CHANGE_REQUESTS)</option>
                <option value="ATT">Giải trình / Quên chấm công (HRM_ATTENDANCE_CORRECTIONS)</option>
                <option value="ADVANCE">Đơn xin tạm ứng lương (HRM_SALARY_ADVANCE_REQUESTS)</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Ngày áp dụng <span class="text-red-500">*</span></label>
                <input id="hrm-modal-from-date" type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Thời lượng / Số giờ</label>
                <input id="hrm-modal-duration" type="text" placeholder="1.0 ngày hoặc 2.5 giờ" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary">
              </div>
            </div>
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Lý do phát sinh chi tiết <span class="text-red-500">*</span></label>
              <textarea id="hrm-modal-reason" rows="3" placeholder="Nhập chi tiết nội dung / lý do gửi cấp quản lý phê duyệt..." class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"></textarea>
            </div>
            <div class="p-2.5 bg-blue-50/70 rounded-lg border border-blue-200 text-[11px] text-gray-600 flex items-center justify-between">
              <span>Luồng duyệt tự động: <strong>shared_workflow_instances</strong></span>
              <span class="text-primary font-bold">Cấp 1: Lê Hoàng Nam</span>
            </div>
          </div>
        `
      },
      correction: {
        title: 'Tạo phiếu Giải trình / Bổ sung công',
        code: 'HRM_ATTENDANCE_CORRECTIONS',
        html: `
          <div class="space-y-3.5">
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Ngày phát sinh sự cố (request_date) <span class="text-red-500">*</span></label>
              <input id="hrm-modal-corr-date" type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono">
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Giờ vào đề xuất (new_check_in)</label>
                <input id="hrm-modal-corr-in" type="time" value="08:00" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Giờ ra đề xuất (new_check_out)</label>
                <input id="hrm-modal-corr-out" type="time" value="17:30" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono">
              </div>
            </div>
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Lý do giải trình (reason) <span class="text-red-500">*</span></label>
              <select class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 mb-2">
                <option>Quên quẹt thẻ lúc ra/vào ca</option>
                <option>Máy quẹt vân tay / nhận diện khuôn mặt lỗi kết nối</option>
                <option>Gặp khách hàng / Đi công tác ngoài phạm vi GPS</option>
                <option>Hỗ trợ phân xưởng đột xuất ngoài giờ</option>
              </select>
              <textarea id="hrm-modal-corr-reason" rows="2" placeholder="Ghi chú thêm diễn giải chi tiết cho Quản lý..." class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50"></textarea>
            </div>
          </div>
        `
      },
            employee: {
        title: 'Thêm hồ sơ nhân sự mới (hrm_employees)',
        code: 'HRM_EMPLOYEE_NEW',
        html: `
          <div class="space-y-3.5">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Mã nhân viên <span class="text-red-500">*</span></label>
                <input type="text" value="NV-${Math.floor(1000 + Math.random()*9000)}" class="w-full text-xs font-mono font-bold border border-gray-300 rounded-lg p-2 bg-gray-50">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Họ và tên <span class="text-red-500">*</span></label>
                <input type="text" placeholder="Ví dụ: Nguyễn Văn A" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white">
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Phòng ban <span class="text-red-500">*</span></label>
                <select class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50">
                  <option>Phòng Kỹ thuật phần mềm</option>
                  <option>Phòng Vận hành & Hệ thống</option>
                  <option>Phòng Kinh doanh & Marketing</option>
                  <option>Phòng Kế toán - Tài chính</option>
                  <option>Phòng Nhân sự</option>
                </select>
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Chức danh / Vị trí <span class="text-red-500">*</span></label>
                <input type="text" placeholder="Ví dụ: Kỹ sư Fullstack Senior" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white">
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Email công ty <span class="text-red-500">*</span></label>
                <input type="email" placeholder="name@enterprise.vn" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white font-mono">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Số điện thoại <span class="text-red-500">*</span></label>
                <input type="tel" placeholder="09xx xxx xxx" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white font-mono">
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Ngày gia nhập <span class="text-red-500">*</span></label>
                <input type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Loại hợp đồng</label>
                <select class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50">
                  <option>Thử việc (2 tháng)</option>
                  <option>Xác định thời hạn (12 tháng)</option>
                  <option>Không xác định thời hạn</option>
                </select>
              </div>
            </div>
          </div>
        `
      },
      shift: {
        title: 'Thiết lập ca làm việc mới (hrm_shift_definitions)',
        code: 'HRM_WORK_SHIFT_NEW',
        html: `
          <div class="space-y-3.5">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Mã ca làm việc <span class="text-red-500">*</span></label>
                <input id="hrm-modal-shift-code" type="text" value="CA-${Math.floor(10 + Math.random()*90)}" class="w-full text-xs font-mono font-bold border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white focus:ring-1 focus:ring-primary">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Tên ca <span class="text-red-500">*</span></label>
                <input id="hrm-modal-shift-name" type="text" placeholder="Ví dụ: Ca Kỹ thuật ca sáng" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white focus:ring-1 focus:ring-primary">
              </div>
            </div>
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Phòng ban / Bộ phận áp dụng</label>
              <select id="hrm-modal-shift-dept" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white">
                <option>Khối Văn phòng, HQ & R&D</option>
                <option>Nhà máy sản xuất Hà Nội</option>
                <option>Phòng Kỹ thuật & Bảo trì</option>
                <option>Khối Kinh doanh & Vận hành kho</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Giờ bắt đầu <span class="text-red-500">*</span></label>
                <input id="hrm-modal-shift-start" type="time" value="08:00" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono focus:bg-white">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Giờ kết thúc <span class="text-red-500">*</span></label>
                <input id="hrm-modal-shift-end" type="time" value="17:30" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono focus:bg-white">
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Số giờ chuẩn / ca (h)</label>
                <input id="hrm-modal-shift-hours" type="number" value="8.0" step="0.25" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono focus:bg-white">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Nghỉ giữa ca (phút)</label>
                <input id="hrm-modal-shift-break" type="number" value="90" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono focus:bg-white">
              </div>
            </div>
            <div class="p-2.5 bg-blue-50/70 rounded-lg border border-blue-200 text-[11px] text-gray-600 flex items-center justify-between">
              <span>Bảng cơ sở dữ liệu: <strong>hrm_shift_definitions</strong></span>
              <span class="text-primary font-bold">Dung sai: ±15 phút</span>
            </div>
          </div>
        `
      },
      job_title: {
        title: 'Thêm chức danh mới (hrm_job_titles)',
        code: 'HRM_JOB_TITLE_NEW',
        html: `
          <div class="space-y-3.5">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Mã chức danh <span class="text-red-500">*</span></label>
                <input type="text" value="JOB-${Math.floor(100 + Math.random()*900)}" class="w-full text-xs font-mono font-bold border border-gray-300 rounded-lg p-2 bg-gray-50">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Tên chức danh <span class="text-red-500">*</span></label>
                <input type="text" placeholder="Ví dụ: Trưởng nhóm phát triển" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white">
              </div>
            </div>
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Thuộc phòng ban</label>
              <select class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50">
                <option>Khối Kỹ thuật & Công nghệ</option>
                <option>Khối Sản phẩm</option>
                <option>Khối Kinh doanh</option>
                <option>Khối Quản trị Vận hành</option>
              </select>
            </div>
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Mô tả trách nhiệm chính</label>
              <textarea rows="2" placeholder="Ghi ngắn gọn trách nhiệm chính..." class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50"></textarea>
            </div>
          </div>
        `
      },
      salary_advance: {
        title: 'Tạo đơn tạm ứng lương (hrm_salary_advances)',
        code: 'HRM_SALARY_ADVANCE_NEW',
        html: `
          <div class="space-y-3.5">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Số tiền tạm ứng (VND) <span class="text-red-500">*</span></label>
                <input type="text" value="5,000,000" class="w-full text-xs font-mono font-bold text-primary border border-gray-300 rounded-lg p-2 bg-gray-50">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Kỳ hoàn ứng <span class="text-red-500">*</span></label>
                <select class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50">
                  <option>Kỳ lương tháng hiện tại</option>
                  <option>Khấu trừ dần trong 2 kỳ</option>
                  <option>Khấu trừ dần trong 3 kỳ</option>
                </select>
              </div>
            </div>
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Lý do tạm ứng <span class="text-red-500">*</span></label>
              <textarea rows="2" placeholder="Ghi rõ lý do tạm ứng đột xuất..." class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50"></textarea>
            </div>
          </div>
        `
      },
      policy_version: {
        title: 'Nâng cấp / Tạo phiên bản chính sách mới',
        code: 'HRM_POLICY_VERSION_NEW',
        html: `
          <div class="space-y-3.5">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Mã chính sách</label>
                <input type="text" value="POL-VER-2024.2" class="w-full text-xs font-mono font-bold border border-gray-300 rounded-lg p-2 bg-gray-50" readonly>
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Ngày hiệu lực <span class="text-red-500">*</span></label>
                <input type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono">
              </div>
            </div>
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Ghi chú thay đổi (Changelog)</label>
              <textarea rows="2" placeholder="Mô tả các điểm sửa đổi so với phiên bản trước..." class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50"></textarea>
            </div>
          </div>
        `
      },
      leave_adjustment: {
        title: 'Điều chỉnh hạn mức phép tồn (hrm_leave_entitlements)',
        code: 'HRM_LEAVE_ADJUSTMENT',
        html: `
          <div class="space-y-3.5">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Số ngày điều chỉnh <span class="text-red-500">*</span></label>
                <input type="number" step="0.5" value="1.0" class="w-full text-xs font-mono font-bold text-primary border border-gray-300 rounded-lg p-2 bg-gray-50">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Loại điều chỉnh</label>
                <select class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50">
                  <option value="ADD">+ Cộng bù phép thâm niên/thưởng</option>
                  <option value="SUB">- Giảm trừ do hết hạn</option>
                </select>
              </div>
            </div>
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Lý do điều chỉnh</label>
              <textarea rows="2" placeholder="Căn cứ quyết định nhân sự..." class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50"></textarea>
            </div>
          </div>
        `
      },
      shift_change: {
        title: 'Đăng ký đổi ca / Đăng ký phân ca làm việc',
        code: 'HRM_SHIFT_CHANGE_REQUESTS',
        html: `
          <div class="space-y-3.5">
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Hình thức áp dụng <span class="text-red-500">*</span></label>
              <select id="hrm-modal-shift-mode" class="w-full text-xs font-medium border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white">
                <option value="EXCHANGE">Đổi ca chéo với nhân sự khác (Peer Exchange)</option>
                <option value="REASSIGN">Đề xuất chuyển đổi ca cá nhân (Single Shift Change)</option>
                <option value="ROSTER">Đăng ký lịch trực / Ca kíp theo tuần mới</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Ngày đổi ca <span class="text-red-500">*</span></label>
                <input id="hrm-modal-shift-date" type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Ca chuyển sang <span class="text-red-500">*</span></label>
                <select id="hrm-modal-target-shift" class="w-full text-xs font-medium border border-gray-300 rounded-lg p-2 bg-gray-50">
                  <option>Ca Hành chính (08:00 - 17:30)</option>
                  <option>Ca Sáng (06:00 - 14:00)</option>
                  <option>Ca Chiều (14:00 - 22:00)</option>
                  <option>Ca Đêm (22:00 - 06:00)</option>
                </select>
              </div>
            </div>
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Nhân sự đổi ca cùng (nếu có)</label>
              <select class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50">
                <option value="">-- Chọn nhân sự cùng tổ / phân xưởng --</option>
                <option value="SX-108">Trần Văn Nam (SX-108) - Ca Đêm KD</option>
                <option value="OP-055">Vũ Quang Huy (OP-055) - Ca Chiều</option>
                <option value="CS-015">Lê Thị Hương Mai (CS-015) - Ca Hành chính</option>
              </select>
            </div>
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Lý do xin đổi ca <span class="text-red-500">*</span></label>
              <textarea id="hrm-modal-shift-reason" rows="2" placeholder="Ghi rõ lý do đổi ca gửi Quản lý phê duyệt..." class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50"></textarea>
            </div>
            <div class="p-2.5 bg-blue-50/70 rounded-lg border border-blue-200 text-[11px] text-gray-600 flex items-center justify-between">
              <span>Quy chuẩn: <strong>hrm_shift_schedules</strong></span>
              <span class="text-primary font-bold">Duyệt: Quản lý ca kíp</span>
            </div>
          </div>
        `
      },
      timesheet_period: {
        title: 'Mở kỳ bảng công mới (hrm_timesheet_periods)',
        code: 'HRM_TIMESHEET_PERIOD_NEW',
        html: `
          <div class="space-y-3.5">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Mã kỳ bảng công <span class="text-red-500">*</span></label>
                <input id="hrm-period-code" type="text" value="TS-2026-10" class="w-full text-xs font-mono font-bold text-primary border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Tên kỳ bảng công <span class="text-red-500">*</span></label>
                <input id="hrm-period-name" type="text" value="Tháng 10/2026 (Kỳ công tiêu chuẩn)" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary">
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Từ ngày (From Date) <span class="text-red-500">*</span></label>
                <input id="hrm-period-start" type="date" value="2026-10-01" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono focus:bg-white">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Đến ngày (To Date) <span class="text-red-500">*</span></label>
                <input id="hrm-period-end" type="date" value="2026-10-31" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono focus:bg-white">
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Số ngày công chuẩn (ca)</label>
                <input id="hrm-period-std-days" type="number" value="22" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono focus:bg-white">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-700 block mb-1">Hạn chốt gửi đơn bổ sung</label>
                <input id="hrm-period-deadline" type="date" value="2026-11-03" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 font-mono focus:bg-white">
              </div>
            </div>
            <div class="p-2.5 bg-blue-50/70 rounded-lg border border-blue-200 text-[11px] text-gray-600 flex items-center justify-between">
              <span>Bảng cơ sở dữ liệu: <strong>hrm_timesheet_periods</strong></span>
              <span class="text-primary font-bold">Trạng thái ban đầu: OPEN</span>
            </div>
          </div>
        `
      }
    };

    const cur = forms[formType] || forms.quick;

    const modal = document.createElement('div');
    modal.id = 'hrm-create-modal';
    modal.className = 'fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden transform transition-all border border-gray-200">
        <div class="px-5 py-4 bg-gradient-to-r from-blue-50 to-indigo-50/60 border-b border-gray-200 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-lg bg-[#0460D9] text-white flex items-center justify-center shadow-sm">
              <span class="material-symbols-outlined text-[20px]">add_circle</span>
            </div>
            <div>
              <h3 class="text-sm font-bold text-gray-800">${cur.title}</h3>
              <span class="text-[10px] font-mono text-primary bg-blue-100/80 px-1.5 py-0.2 rounded font-semibold">${cur.code}</span>
            </div>
          </div>
          <button onclick="document.getElementById('hrm-create-modal').remove()" class="text-gray-400 hover:text-gray-600 p-1 rounded-lg">
            <span class="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div class="p-5 text-xs text-gray-700">
          ${cur.html}
        </div>
        <div class="px-5 py-3.5 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <button onclick="document.getElementById('hrm-create-modal').remove()" class="px-3.5 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-semibold hover:bg-white transition-colors">
            Hủy bỏ
          </button>
          <div class="flex items-center gap-2">
            <button onclick="hrmSaveDraft()" class="px-3.5 py-1.5 border border-primary text-primary rounded-lg text-xs font-semibold hover:bg-blue-50 transition-colors">
              Lưu nháp
            </button>
            <button onclick="hrmSubmitNewRequest('${cur.code}')" class="px-4 py-1.5 bg-[#0460D9] hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1">
              <span class="material-symbols-outlined text-[15px]">send</span> Gửi duyệt
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  };

  window.hrmSaveDraft = function () {
    const modal = document.getElementById('hrm-create-modal');
    if (modal) modal.remove();
    hrmToast('Đã lưu bản ghi tạm với trạng thái <code class="font-mono font-bold text-primary">DRAFT</code>!', 'info', 'Lưu nháp thành công');
  };

  window.hrmSubmitNewRequest = function (schemaCode) {
    const modal = document.getElementById('hrm-create-modal');

    // 0. Phân nhánh thêm kỳ bảng công mới: hrm_timesheet_periods
    if (schemaCode === 'HRM_TIMESHEET_PERIOD_NEW') {
      const codeVal = document.getElementById('hrm-period-code')?.value?.trim() || ('TS-2026-' + Math.floor(10 + Math.random() * 2));
      const nameVal = document.getElementById('hrm-period-name')?.value?.trim() || 'Tháng mới/2026';
      const startVal = document.getElementById('hrm-period-start')?.value || '2026-10-01';
      const endVal = document.getElementById('hrm-period-end')?.value || '2026-10-31';
      const stdDays = document.getElementById('hrm-period-std-days')?.value || '22';

      // Format date to DD/MM/YYYY
      const fmtDate = (dStr) => {
        if (!dStr) return '';
        const parts = dStr.split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dStr;
      };

      const rangeStr = `${fmtDate(startVal)} - ${fmtDate(endVal)}`;

      if (modal) modal.remove();

      const tableBody = document.querySelector('table tbody');
      if (tableBody) {
        const tr = document.createElement('tr');
        tr.className = 'table-row-hover transition-colors bg-blue-50/40';
        tr.innerHTML = `
          <td class="py-3 px-3.5 border-r border-outline-variant/60">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-primary text-[18px]">event_upcoming</span>
              <div>
                <div class="font-bold text-on-surface font-mono text-[12px]">${codeVal}</div>
                <span class="text-[10px] text-gray-500">${nameVal}</span>
              </div>
            </div>
          </td>
          <td class="py-3 px-3.5 border-r border-outline-variant/60 font-mono">
            <div>${rangeStr}</div>
            <span class="text-[10px] text-gray-500 font-sans">31 ngày • ${stdDays} ca chuẩn</span>
          </td>
          <td class="py-3 px-3.5 border-r border-outline-variant/60">
            <div class="space-y-1">
              <div class="flex justify-between text-[11px]">
                <span class="text-gray-500">Khởi tạo phân ca:</span>
                <span class="font-bold text-on-surface font-mono">150/150 (100%)</span>
              </div>
              <div class="w-full bg-surface-container-high rounded-full h-1.5">
                <div class="bg-blue-500 h-1.5 rounded-full" style="width: 100%"></div>
              </div>
            </div>
          </td>
          <td class="py-3 px-3.5 border-r border-outline-variant/60 text-center">
            <span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-primary border border-blue-200 font-mono">OPEN</span>
          </td>
          <td class="py-3 px-3.5 border-r border-outline-variant/60 text-gray-400 text-[11px] font-mono">— Chưa khóa —</td>
          <td class="py-3 px-3.5 border-r border-outline-variant/60 text-gray-400 text-[11px] font-mono">—</td>
          <td class="py-3 px-3.5">
            <div class="flex items-center justify-center gap-1.5">
              <button onclick="hrmOpenTimesheetMatrix('${codeVal}')" class="p-1.5 border border-outline-variant rounded hover:bg-surface-container-high text-primary flex items-center gap-1 text-[11px] font-medium shadow-xs" title="Xem bảng công chi tiết">
                <span class="material-symbols-outlined text-[15px]">grid_view</span><span>Xem ma trận</span>
              </button>
              <button onclick="hrmPopconfirm(this, {title: 'Khóa kỳ dữ liệu?', message: 'Sau khi khóa, dữ liệu kỳ công/lương sẽ không thể chỉnh sửa trừ khi có quyền mở lại.', isDanger: true, okText: 'Khóa dữ liệu', onConfirm: () => hrmTogglePeriodLock(this, '${codeVal}', 'LOCK')})" class="p-1.5 border border-outline-variant rounded hover:bg-surface-container-low text-amber-800 flex items-center gap-1 text-[11px] font-medium shadow-xs cursor-pointer" title="Khóa kỳ công">
                <span class="material-symbols-outlined text-[15px]">lock</span><span>Khóa</span>
              </button>
              <button onclick="hrmOpenDetailDrawer('Lịch sử kiểm toán & Thay đổi', '#AUDIT-${codeVal}', 'INFO')" class="p-1.5 border border-outline-variant rounded hover:bg-surface-container-high text-gray-600 flex items-center text-[11px] shadow-xs" title="Xem lịch sử audit">
                <span class="material-symbols-outlined text-[15px]">history</span>
              </button>
            </div>
          </td>
        `;
        tableBody.insertBefore(tr, tableBody.firstChild);
      }
      hrmToast(`Kỳ bảng công <strong>${codeVal} (${nameVal})</strong> đã được mở thành công và sẵn sàng tổng hợp!`, 'success', 'Mở kỳ công thành công');
      return;
    }
    
    // 1. Phân nhánh thêm ca làm việc mới: hrm_shift_definitions
    if (schemaCode === 'HRM_WORK_SHIFT_NEW') {
      const codeVal = document.getElementById('hrm-modal-shift-code')?.value?.trim() || ('CA-' + Math.floor(10 + Math.random() * 90));
      const nameVal = document.getElementById('hrm-modal-shift-name')?.value?.trim() || 'Ca làm việc mới';
      const deptVal = document.getElementById('hrm-modal-shift-dept')?.value || 'Khối Văn phòng, HQ & R&D';
      const startVal = document.getElementById('hrm-modal-shift-start')?.value || '08:00';
      const endVal = document.getElementById('hrm-modal-shift-end')?.value || '17:30';
      const hoursVal = document.getElementById('hrm-modal-shift-hours')?.value || '8.0';
      const breakVal = document.getElementById('hrm-modal-shift-break')?.value || '90';

      if (modal) modal.remove();

      const tableBody = document.querySelector('table tbody');
      if (tableBody) {
        const tr = document.createElement('tr');
        tr.className = 'table-row-hover transition-colors bg-blue-50/30';
        tr.innerHTML = `
          <td class="py-3.5 px-3">
            <span class="inline-flex items-center px-2 py-0.5 rounded font-mono font-bold bg-blue-100 text-primary border border-blue-200 text-[11px]">${codeVal}</span>
          </td>
          <td class="py-3.5 px-3">
            <span class="font-bold text-on-surface text-[13px] block">${nameVal}</span>
            <span class="text-[11px] text-gray-500">${deptVal}</span>
          </td>
          <td class="py-3.5 px-3 font-mono font-semibold text-on-surface text-[12px]">
            <div class="flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px] text-primary">schedule</span>
              <span>${startVal} - ${endVal}</span>
            </div>
          </td>
          <td class="py-3.5 px-3 text-center">
            <span class="font-mono font-semibold text-gray-700">${breakVal} phút</span>
            <span class="block text-[10px] text-gray-400">Nghỉ giữa ca</span>
          </td>
          <td class="py-3.5 px-3 text-center">
            <span class="font-mono font-bold text-primary text-[12px] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">${parseFloat(hoursVal).toFixed(1)}h</span>
          </td>
          <td class="py-3.5 px-3 text-center">
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-surface-container-high text-gray-600 border border-outline-variant/60">Không</span>
          </td>
          <td class="py-3.5 px-3 text-center">
            <span class="inline-flex items-center gap-1 text-[11px] font-mono text-gray-700 bg-surface-container-high px-1.5 py-0.5 rounded border border-outline-variant/60">
              <span>15p</span>/<span>15p</span>
            </span>
          </td>
          <td class="py-3.5 px-3 text-center">
            <span class="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full">
              <span class="w-1.5 h-1.5 rounded-full bg-green-700"></span>ACTIVE
            </span>
          </td>
          <td class="py-3.5 px-3 text-center">
            <div class="flex items-center justify-center gap-1">
              <button onclick="hrmOpenDetailDrawer('Cấu hình ca làm việc', '#${codeVal}', 'ACTIVE')" class="p-1.5 rounded-lg border border-outline-variant/60 text-primary hover:bg-surface-container-high transition-colors" title="Sửa cấu hình ca">
                <span class="material-symbols-outlined text-[16px]">edit</span>
              </button>
              <button onclick="hrmPopconfirm(this, { title: 'Xóa ca làm việc?', message: 'Loại bỏ ca ${codeVal} khỏi danh mục?', isDanger: true, onConfirm: () => { this.closest('tr').remove(); hrmToast('Đã xóa ca làm việc!', 'info'); } })" class="p-1.5 rounded-lg border border-outline-variant/60 text-gray-500 hover:text-red-600 hover:bg-surface-container-low transition-colors" title="Xóa ca">
                <span class="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>
          </td>
        `;
        tableBody.insertBefore(tr, tableBody.firstChild);
      }
      hrmToast(`Ca làm việc mới <strong>${codeVal} (${nameVal})</strong> đã được thêm thành công vào <strong>hrm_shift_definitions</strong>!`, 'success', 'Thêm ca thành công');
      return;
    }

    // 2. Phân nhánh thêm chức danh mới: hrm_job_titles
    if (schemaCode === 'HRM_JOB_TITLE_NEW') {
      const inputs = modal ? modal.querySelectorAll('input, select, textarea') : [];
      const codeVal = inputs[0]?.value?.trim() || ('POS-' + Math.floor(100 + Math.random() * 900));
      const nameVal = inputs[1]?.value?.trim() || 'Chức danh mới';
      const deptVal = inputs[2]?.value || 'Khối Kỹ thuật & Công nghệ';

      if (modal) modal.remove();

      const tableBody = document.querySelector('table tbody');
      if (tableBody) {
        const tr = document.createElement('tr');
        tr.className = 'table-row-hover transition-colors bg-blue-50/30';
        tr.innerHTML = `
          <td class="py-3.5 px-3">
            <span class="font-mono font-bold text-primary px-2 py-0.5 rounded bg-blue-100/60 border border-blue-200 text-[11px]">${codeVal}</span>
          </td>
          <td class="py-3.5 px-3">
            <div>
              <span class="font-bold text-on-surface block text-[13px]">${nameVal}</span>
              <span class="text-[11px] text-gray-500 block">${deptVal} • 1 nhân sự</span>
            </div>
          </td>
          <td class="py-3.5 px-3">
            <span class="inline-flex items-center gap-1 font-mono text-[11px] font-semibold bg-surface-container-high text-on-surface px-2 py-0.5 rounded border border-outline-variant/60">
              <span class="material-symbols-outlined text-[13px] text-primary">payments</span>GR-ENG-SR
            </span>
          </td>
          <td class="py-3.5 px-3">
            <span class="text-[11px] text-gray-700 block font-medium">Ca hành chính tiêu chuẩn</span>
            <span class="text-[10px] text-gray-400">Chấm công GPS / Vân tay</span>
          </td>
          <td class="py-3.5 px-3">
            <div class="flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[16px] text-gray-400">pending</span>
              <span class="text-gray-500 font-medium text-[11px]">Dự thảo v1.0</span>
            </div>
          </td>
          <td class="py-3.5 px-3 text-center">
            <span class="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full">
              <span class="w-1.5 h-1.5 rounded-full bg-green-700"></span>ACTIVE
            </span>
          </td>
          <td class="py-3.5 px-3 text-center">
            <div class="flex items-center justify-center gap-1.5">
              <button onclick="hrmOpenDetailDrawer('Cấu hình chi tiết tiêu chuẩn JD', '#${codeVal}', 'ACTIVE')" class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0460D9] text-white hover:bg-opacity-90 transition-colors shadow-xs text-xs font-semibold">
                <span class="material-symbols-outlined text-[15px]">tune</span><span>Cấu hình JD</span>
              </button>
            </div>
          </td>
        `;
        tableBody.insertBefore(tr, tableBody.firstChild);
      }
      hrmToast(`Chức danh mới <strong>${codeVal} (${nameVal})</strong> đã được thêm vào <strong>hrm_job_titles</strong>!`, 'success', 'Thêm chức danh thành công');
      return;
    }

    // 3. Phân nhánh thêm nhân viên mới: hrm_employee_profiles
    if (schemaCode === 'HRM_EMPLOYEE_NEW') {
      const inputs = modal ? modal.querySelectorAll('input, select') : [];
      const codeVal = inputs[0]?.value?.trim() || ('KT-' + Math.floor(100 + Math.random() * 900));
      const nameVal = inputs[1]?.value?.trim() || 'Nhân viên mới';
      const emailVal = inputs[2]?.value?.trim() || 'nhanvien.moi@svndts.vn';
      const posVal = inputs[3]?.value || 'Kỹ thuật viên';
      const deptVal = inputs[4]?.value || 'Phòng Kỹ thuật & Bảo trì';

      if (modal) modal.remove();

      const tableBody = document.querySelector('table tbody');
      if (tableBody) {
        const tr = document.createElement('tr');
        tr.className = 'table-row-hover transition-colors bg-blue-50/30';
        tr.innerHTML = `
          <td class="py-3.5 px-3">
            <span class="font-mono font-bold text-primary">${codeVal}</span>
          </td>
          <td class="py-3.5 px-3">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-full bg-blue-100 text-primary font-bold text-xs flex items-center justify-center shrink-0 border border-blue-200">NV</div>
              <div>
                <span class="font-bold text-on-surface block text-[13px]">${nameVal}</span>
                <span class="text-[11px] text-gray-500 block font-mono">${emailVal}</span>
              </div>
            </div>
          </td>
          <td class="py-3.5 px-3">
            <span class="font-semibold text-on-surface block">${posVal}</span>
            <span class="text-[11px] text-gray-500 block">${deptVal}</span>
          </td>
          <td class="py-3.5 px-3">
            <span class="font-mono text-gray-700 block">${new Date().toLocaleDateString('vi-VN')}</span>
            <span class="text-[10px] text-blue-600 font-mono">Thử việc</span>
          </td>
          <td class="py-3.5 px-3 text-center">
            <span class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-100 border border-blue-200 px-2.5 py-0.5 rounded-full">
              <span class="w-1.5 h-1.5 rounded-full bg-blue-600"></span>PROBATION
            </span>
          </td>
          <td class="py-3.5 px-3 text-center">
            <span class="inline-flex items-center gap-1 text-[10px] font-bold text-primary bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
              <span class="material-symbols-outlined text-[13px]">pending</span>Đang cập nhật
            </span>
          </td>
          <td class="py-3.5 px-3 text-center">
            <div class="flex items-center justify-center gap-1.5">
              <button onclick="hrmOpenDetailDrawer('Hồ sơ nhân viên', '#${codeVal}', 'PROBATION')" class="p-1.5 rounded-lg bg-primary text-white hover:bg-opacity-90 transition-colors shadow-xs" title="Xem/Sửa hồ sơ">
                <span class="material-symbols-outlined text-[16px]">edit_document</span>
              </button>
            </div>
          </td>
        `;
        tableBody.insertBefore(tr, tableBody.firstChild);
      }
      hrmToast(`Hồ sơ nhân viên <strong>${nameVal} (${codeVal})</strong> đã được thêm thành công vào <strong>hrm_employee_profiles</strong>!`, 'success', 'Thêm nhân viên thành công');
      return;
    }

    // 4. Mặc định: Phân nhánh đơn từ (Leave, OT, Trip, Shift change, Correction, Advance...)
    if (modal) modal.remove();

    const randCode = 'REQ-' + Math.floor(1000 + Math.random() * 9000);
    hrmToast(`Đơn mới <strong>#${randCode}</strong> đã được gửi lên hệ thống phê duyệt (status: <span class="font-mono font-bold text-amber-600">SUBMITTED</span>)!`, 'success', 'Gửi duyệt thành công');

    const pendingTable = document.querySelector('table tbody');
    if (pendingTable) {
      const tr = document.createElement('tr');
      tr.className = 'table-row-hover transition-colors bg-blue-50/30';
      tr.innerHTML = `
        <td class="py-3 px-4">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-blue-100 text-primary flex items-center justify-center shrink-0 font-bold">
              <span class="material-symbols-outlined text-[18px]">assignment</span>
            </div>
            <div>
              <span class="font-bold text-primary font-mono block text-xs">#${randCode}</span>
              <span class="text-on-surface font-semibold text-[13px]">Đơn phát sinh mới</span>
            </div>
          </div>
        </td>
        <td class="py-3 px-4 whitespace-nowrap text-on-surface-variant font-mono">
          <span class="block text-on-surface font-semibold">Hôm nay</span>
          <span class="text-[11px] text-gray-400">Vừa xong</span>
        </td>
        <td class="py-3 px-4">
          <div class="space-y-0.5">
            <p class="text-on-surface font-semibold text-[13px]">Đơn phát sinh mới</p>
            <p class="text-gray-500 text-[11px]">Đã chuyển sang shared_workflow_instances</p>
          </div>
        </td>
        <td class="py-3 px-4">
          <div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-full bg-blue-100 text-primary flex items-center justify-center text-[10px] font-bold">LN</div>
            <div><span class="text-on-surface font-semibold block">Lê Hoàng Nam</span><span class="text-[10px] text-gray-500">Trưởng bộ phận</span></div>
          </div>
        </td>
        <td class="py-3 px-4 text-center whitespace-nowrap">
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-primary border border-blue-200">
            <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>SUBMITTED
          </span>
        </td>
        <td class="py-3 px-4 text-center whitespace-nowrap">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="hrmOpenDetailDrawer('Đơn vừa tạo', '#${randCode}', 'Đang chờ phê duyệt')" class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline-variant hover:bg-blue-50/70 text-primary font-semibold text-xs transition-colors">
              <span class="material-symbols-outlined text-[15px]">timeline</span>Xem luồng
            </button>
            <button onclick="hrmCancelRow(this, '#${randCode}')" class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 hover:bg-red-100/50 text-red-600 font-semibold text-xs transition-colors">
              <span class="material-symbols-outlined text-[15px]">cancel</span>Hủy đơn
            </button>
          </div>
        </td>
      `;
      pendingTable.insertBefore(tr, pendingTable.firstChild);
    }
  };

  // Drawer Generator (VIEW DETAIL + EDIT BUTTON)
  window.hrmOpenDetailDrawer = function (title = 'Chi tiết đơn từ', reqCode = '#REQ-2024-089', currentStatus = 'PENDING_APPROVAL') {
    let drawer = document.getElementById('hrm-global-drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'hrm-global-drawer';
      drawer.className = 'fixed inset-0 z-50 overflow-hidden hidden';
      drawer.innerHTML = `
        <div class="drawer-backdrop fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300 opacity-0" onclick="hrmCloseDetailDrawer()"></div>
        <div class="fixed inset-y-0 right-0 max-w-full flex pl-10">
          <div class="drawer-panel w-screen max-w-[620px] bg-white shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-full flex flex-col">
            <!-- Header -->
            <div class="px-6 py-4 bg-gradient-to-r from-blue-50 to-indigo-50/50 border-b border-gray-200 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                  <span class="material-symbols-outlined text-[24px]">visibility</span>
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <h3 id="drawer-title" class="font-bold text-gray-800 text-sm">Chi tiết đối tượng</h3>
                    <span id="drawer-code" class="font-mono font-bold text-primary text-xs">#REQ</span>
                  </div>
                  <span class="text-xs text-gray-500">Phân vùng CÁ NHÂN • Ghi nhận từ hệ thống</span>
                </div>
              </div>
              <button onclick="hrmCloseDetailDrawer()" class="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white/80 transition-colors">
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <!-- Body -->
            <div id="drawer-body" class="p-6 space-y-5 overflow-y-auto flex-1 custom-scrollbar text-xs">
              <!-- Content injected dynamically -->
            </div>
            <!-- Footer -->
            <div class="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <button id="drawer-btn-edit" onclick="hrmToggleEditMode()" class="px-4 py-2 border border-primary text-primary hover:bg-blue-50 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors">
                <span class="material-symbols-outlined text-[16px]">edit</span>
                <span>Chỉnh sửa thông tin (Edit)</span>
              </button>
              <button onclick="hrmCloseDetailDrawer()" class="px-5 py-2 bg-[#0460D9] text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors shadow-sm">
                Đóng
              </button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(drawer);
    }

    // Populate data
    document.getElementById('drawer-title').textContent = title;
    document.getElementById('drawer-code').textContent = reqCode;

    const body = document.getElementById('drawer-body');
    body.innerHTML = `
      <div class="p-3.5 bg-blue-50/40 rounded-xl border border-blue-200 flex items-center justify-between">
        <div>
          <span class="text-xs text-gray-500 block">Trạng thái hiện thời:</span>
          <span class="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 mt-0.5">
            <span class="w-2 h-2 rounded-full bg-amber-500"></span>
            ${currentStatus}
          </span>
        </div>
        <span class="font-mono text-xs font-bold text-gray-700 bg-white px-3 py-1 rounded-lg border border-gray-200">ISO-HRM</span>
      </div>

      <div id="drawer-view-section" class="p-4 bg-gray-50/70 rounded-xl border border-gray-200 space-y-3">
        <div class="flex justify-between items-center text-xs">
          <span class="text-gray-500">Người khởi tạo:</span>
          <span class="font-bold text-gray-800">Nguyễn Văn An (KT-042)</span>
        </div>
        <div class="flex justify-between items-center text-xs">
          <span class="text-gray-500">Bộ phận / Phòng ban:</span>
          <span class="font-semibold text-gray-700">Phòng Kỹ thuật & Bảo trì</span>
        </div>
        <div class="flex justify-between items-center text-xs">
          <span class="text-gray-500">Nội dung chi tiết:</span>
          <span class="font-medium text-gray-800">Nghỉ 1.0 ngày (Giải quyết việc riêng gia đình tại quê)</span>
        </div>
        <div class="pt-2 border-t border-gray-200">
          <span class="text-gray-500 block mb-1">Quy định xử lý (Flow Rules):</span>
          <p class="text-gray-600 bg-white p-2.5 rounded-lg border border-gray-200 leading-relaxed">
            Đơn được khởi tạo theo chuẩn Flow 10, tự động đối soát tồn phép và trừ trực tiếp khi được Quản lý cấp 1 và HR phê duyệt.
          </p>
        </div>
      </div>

      <div id="drawer-edit-section" class="hidden p-4 bg-amber-50/50 rounded-xl border border-amber-200 space-y-3">
        <h5 class="font-bold text-xs text-amber-800 flex items-center gap-1">
          <span class="material-symbols-outlined text-[16px]">edit_note</span> Chế độ chỉnh sửa nhanh (Inline Edit)
        </h5>
        <div>
          <label class="text-xs text-gray-600 block mb-1">Cập nhật lý do / Ghi chú mới:</label>
          <textarea id="drawer-edit-reason" rows="3" class="w-full text-xs p-2 border border-amber-300 rounded-lg bg-white">Giải quyết việc gia đình cá nhân tại quê (Đã có trao đổi trước với Trưởng ca)</textarea>
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <button onclick="hrmCancelEditMode()" class="px-3 py-1 bg-white border border-gray-300 rounded text-xs font-semibold">Hủy</button>
          <button onclick="hrmSaveEditMode()" class="px-3 py-1 bg-[#0460D9] text-white rounded text-xs font-semibold">Lưu thay đổi</button>
        </div>
      </div>

      <div class="space-y-2">
        <h4 class="font-bold text-xs text-primary flex items-center gap-1.5">
          <span class="material-symbols-outlined text-[18px]">account_tree</span>
          <span>Tiến trình phê duyệt (Workflow Trace):</span>
        </h4>
        <div class="space-y-2 text-xs">
          <div class="p-3 bg-white rounded-xl border border-gray-200 flex items-start justify-between shadow-xs">
            <div>
              <span class="font-bold text-gray-800 block">1. Khởi tạo bởi: Nguyễn Văn An</span>
              <span class="text-[11px] text-gray-500">24/10/2024 08:30 • Trạng thái: SUBMITTED</span>
            </div>
            <span class="material-symbols-outlined text-green-600 text-[18px]">check_circle</span>
          </div>
          <div class="p-3 bg-white rounded-xl border border-amber-200 flex items-start justify-between shadow-xs">
            <div>
              <span class="font-bold text-gray-800 block">2. Quản lý trực tiếp: Lê Hoàng Nam</span>
              <span class="text-[11px] text-amber-600 font-medium">Đang chờ xem xét phê duyệt (PENDING)</span>
            </div>
            <span class="material-symbols-outlined text-amber-500 text-[18px] animate-spin">progress_activity</span>
          </div>
        </div>
      </div>
    `;

    drawer.classList.remove('hidden');
    setTimeout(() => {
      drawer.querySelector('.drawer-backdrop').classList.remove('opacity-0');
      drawer.querySelector('.drawer-panel').classList.remove('translate-x-full');
    }, 10);
    document.body.style.overflow = 'hidden';
  };

  window.hrmCloseDetailDrawer = function () {
    const drawer = document.getElementById('hrm-global-drawer');
    if (!drawer) return;
    drawer.querySelector('.drawer-backdrop').classList.add('opacity-0');
    drawer.querySelector('.drawer-panel').classList.add('translate-x-full');
    setTimeout(() => {
      drawer.classList.add('hidden');
      document.body.style.overflow = '';
    }, 300);
  };

  window.hrmToggleEditMode = function () {
    const editSec = document.getElementById('drawer-edit-section');
    const viewSec = document.getElementById('drawer-view-section');
    if (editSec) editSec.classList.remove('hidden');
    if (viewSec) viewSec.classList.add('hidden');
  };

  window.hrmCancelEditMode = function () {
    const editSec = document.getElementById('drawer-edit-section');
    const viewSec = document.getElementById('drawer-view-section');
    if (editSec) editSec.classList.add('hidden');
    if (viewSec) viewSec.classList.remove('hidden');
  };

  window.hrmSaveEditMode = function () {
    hrmCancelEditMode();
    hrmToast('Đã lưu các thay đổi vào bản ghi thành công!', 'success', 'Cập nhật thành công');
  };

  // Duyệt nhanh / Từ chối tại dòng hoặc card
  window.hrmApproveCard = function (btnEl, title) {
    hrmPopconfirm(btnEl, {
      title: 'Phê duyệt nhanh',
      message: `Bạn có chắc chắn muốn duyệt ngay yêu cầu của <strong>${title}</strong>?`,
      okText: 'Duyệt ngay',
      onConfirm: () => {
        const card = btnEl.closest('.p-3, .bg-surface');
        if (card) {
          card.style.transition = 'all 0.3s ease';
          card.style.opacity = '0.4';
          card.style.pointerEvents = 'none';
        }
        btnEl.innerHTML = '<span class="material-symbols-outlined text-[15px]">check_circle</span> Đã duyệt';
        btnEl.className = 'px-3 py-1 bg-green-100 text-green-700 rounded text-xs font-bold border border-green-200';
        hrmToast(`Đã phê duyệt thành công yêu cầu của <strong>${title}</strong>!`, 'success', 'Duyệt thành công');
      }
    });
  };

  window.hrmRejectCard = function (btnEl, title) {
    hrmPopconfirm(btnEl, {
      title: 'Từ chối yêu cầu',
      message: `Bạn có chắc chắn muốn TỪ CHỐI yêu cầu của <strong>${title}</strong>?`,
      okText: 'Từ chối',
      isDanger: true,
      onConfirm: () => {
        const card = btnEl.closest('.p-3, .bg-surface');
        if (card) {
          card.style.transition = 'all 0.3s ease';
          card.style.opacity = '0.4';
          card.style.pointerEvents = 'none';
        }
        btnEl.innerHTML = '<span class="material-symbols-outlined text-[15px]">cancel</span> Đã từ chối';
        btnEl.className = 'px-3 py-1 bg-red-100 text-red-700 rounded text-xs font-bold border border-red-200';
        hrmToast(`Đã từ chối yêu cầu của <strong>${title}</strong> (status: REJECTED)!`, 'error', 'Đã từ chối');
      }
    });
  };

  // Yêu cầu bổ sung thông tin / giải trình
  window.hrmRequestInfoCard = function (btnEl, title) {
    hrmPopconfirm(btnEl, {
      title: 'Yêu cầu bổ sung giải trình?',
      message: `Gửi thông báo yêu cầu nhân sự bổ sung hồ sơ / lý do chi tiết cho <strong>${title}</strong>?`,
      okText: 'Gửi yêu cầu',
      onConfirm: () => {
        btnEl.innerHTML = '<span class="material-symbols-outlined text-[15px]">send</span> Đã gửi yêu cầu';
        btnEl.className = 'px-3 py-1 bg-amber-50 text-amber-800 rounded text-xs font-semibold border border-amber-200';
        hrmToast(`Đã gửi yêu cầu bổ sung thông tin đến nhân sự của <strong>${title}</strong>!`, 'info', 'Đã yêu cầu bổ sung');
      }
    });
  };

  // Đánh dấu đã đọc
  window.hrmMarkAllRead = function (btnEl) {
    hrmToast('Đã đánh dấu tất cả thông báo và việc cần xử lý là ĐÃ ĐỌC!', 'success', 'Đã đọc');
  };


  // Hủy đơn tại dòng (Pending Requests)
  window.hrmCancelRow = function (btnEl, reqCode) {
    hrmPopconfirm(btnEl, {
      title: 'Hủy yêu cầu đã gửi',
      message: `Bạn có chắc muốn hủy đơn <strong>${reqCode}</strong>? Trạng thái sẽ chuyển thành CANCELLED.`,
      okText: 'Hủy đơn',
      isDanger: true,
      onConfirm: () => {
        const tr = btnEl.closest('tr');
        if (tr) {
          const statusCol = tr.querySelector('td:nth-child(5)');
          if (statusCol) {
            statusCol.innerHTML = `
              <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-300">
                <span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span>CANCELLED
              </span>
            `;
          }
          btnEl.remove();
        }
        hrmToast(`Đã hủy đơn <strong>${reqCode}</strong> và thu hồi task khỏi workflow engine!`, 'info', 'Đã hủy đơn');
      }
    });
  };

  // Quick Check-out Action
  window.hrmCheckOutAction = function (btnEl) {
    const timeNow = new Date().toLocaleTimeString('vi-VN');
    hrmPopconfirm(btnEl, {
      title: 'Xác nhận Check-out ca làm việc',
      message: `Chốt giờ ra ca lúc <strong>${timeNow}</strong> tại vị trí IP/GPS hợp lệ?`,
      okText: 'Chốt ra ca',
      onConfirm: () => {
        btnEl.className = 'bg-gray-100 text-gray-600 text-xs font-semibold px-3.5 py-1.5 rounded-lg border border-gray-300 flex items-center gap-1';
        btnEl.innerHTML = `<span class="material-symbols-outlined text-[16px] text-green-600">verified</span> Đã Check-out ${timeNow}`;
        hrmToast(`Đã ghi nhận Check-out lúc <strong>${timeNow}</strong> thành công vào bảng <strong>HRM_ATTENDANCES</strong>!`, 'success', 'Hoàn tất ra ca');
      }
    });
  };

  // Modal Cập nhật thông tin liên hệ cá nhân (Hồ sơ của tôi)
  window.hrmOpenUpdateContactModal = function () {
    const existing = document.getElementById('hrm-contact-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'hrm-contact-modal';
    modal.className = 'fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden transform transition-all border border-gray-200">
        <div class="px-5 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-lg bg-[#0460D9] text-white flex items-center justify-center shadow-sm">
              <span class="material-symbols-outlined text-[20px]">contact_phone</span>
            </div>
            <div>
              <h3 class="text-sm font-bold text-gray-800">Cập nhật thông tin liên hệ</h3>
              <span class="text-[10px] font-mono text-primary bg-blue-100/80 px-1.5 py-0.2 rounded font-semibold">hrm_employee_profiles</span>
            </div>
          </div>
          <button onclick="document.getElementById('hrm-contact-modal').remove()" class="text-gray-400 hover:text-gray-600 p-1 rounded-lg">
            <span class="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div class="p-5 text-xs text-gray-700 space-y-4 max-h-[75vh] overflow-y-auto">
          <div class="p-3 bg-blue-50/60 border border-blue-200 rounded-lg text-primary text-[11px] flex items-center gap-2">
            <span class="material-symbols-outlined text-[16px]">info</span>
            <span>Thông tin liên hệ được đồng bộ về hồ sơ cá nhân của nhân sự <strong>Nguyễn Văn An (KT-042)</strong>.</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div>
              <label class="font-bold text-gray-700 block mb-1">Email cá nhân (personal_email) <span class="text-red-500">*</span></label>
              <input id="hrm-contact-email" type="email" value="an.nguyen.tech@gmail.com" class="w-full border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white text-xs focus:ring-1 focus:ring-primary">
            </div>
            <div>
              <label class="font-bold text-gray-700 block mb-1">Số điện thoại di động (phone) <span class="text-red-500">*</span></label>
              <input id="hrm-contact-phone" type="tel" value="0987 654 321" class="w-full border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white text-xs focus:ring-1 focus:ring-primary font-medium">
            </div>
            <div class="md:col-span-2">
              <label class="font-bold text-gray-700 block mb-1">Địa chỉ thường trú</label>
              <input id="hrm-contact-perm-addr" type="text" value="Số 45 ngõ 120 Hoàng Hoa Thám, P. Thụy Khuê, Q. Tây Hồ, Hà Nội" class="w-full border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white text-xs focus:ring-1 focus:ring-primary">
            </div>
            <div class="md:col-span-2">
              <label class="font-bold text-gray-700 block mb-1">Địa chỉ tạm trú / Nơi ở hiện tại</label>
              <input id="hrm-contact-temp-addr" type="text" value="Phòng 806 Tòa A, Chung cư Golden Park, P. Yên Hòa, Cầu Giấy, Hà Nội" class="w-full border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white text-xs focus:ring-1 focus:ring-primary">
            </div>
          </div>
          <div class="pt-2 border-t border-gray-200">
            <h4 class="font-bold text-orange-600 mb-2 uppercase text-[11px] flex items-center gap-1">
              <span class="material-symbols-outlined text-[16px]">contact_emergency</span> Người liên hệ khẩn cấp (Emergency Contact)
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div>
                <label class="font-bold text-gray-700 block mb-1">Họ tên người liên hệ *</label>
                <input id="hrm-contact-emerg-name" type="text" value="Trần Thu Hà" class="w-full border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white text-xs">
              </div>
              <div>
                <label class="font-bold text-gray-700 block mb-1">Mối quan hệ *</label>
                <select id="hrm-contact-emerg-rel" class="w-full border border-gray-300 rounded-lg p-2 bg-gray-50 text-xs">
                  <option selected>Vợ / Chồng</option>
                  <option>Bố / Mẹ</option>
                  <option>Anh / Chị / Em ruột</option>
                  <option>Khác</option>
                </select>
              </div>
              <div class="md:col-span-2">
                <label class="font-bold text-gray-700 block mb-1">Số điện thoại khẩn cấp *</label>
                <input id="hrm-contact-emerg-phone" type="tel" value="0978 112 233" class="w-full border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white text-xs font-medium">
              </div>
            </div>
          </div>
        </div>
        <div class="px-5 py-3.5 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <button onclick="document.getElementById('hrm-contact-modal').remove()" class="px-3.5 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-semibold hover:bg-white transition-colors">
            Hủy bỏ
          </button>
          <button onclick="hrmSaveContactProfile()" class="px-4 py-1.5 bg-[#0460D9] hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">save</span> Lưu thay đổi
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  };

  window.hrmSaveContactProfile = function () {
    const modal = document.getElementById('hrm-contact-modal');
    if (modal) modal.remove();
    hrmToast('Đã lưu và cập nhật thông tin liên hệ vào <strong>hrm_employee_profiles</strong> thành công!', 'success', 'Cập nhật thành công');
  };

  // JD Configuration Handlers (Chức danh & JD)
  window.hrmOpenAddResponsibilityModal = function (targetBtn, editItem = null) {
    const existing = document.getElementById('hrm-responsibility-modal');
    if (existing) existing.remove();

    const isEdit = !!editItem;
    const currentText = isEdit && editItem.querySelector('p') ? editItem.querySelector('p').textContent.trim() : '';
    const currentWeight = isEdit ? '35' : '20';

    const modal = document.createElement('div');
    modal.id = 'hrm-responsibility-modal';
    modal.className = 'fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden transform transition-all border border-gray-200">
        <div class="px-5 py-4 bg-gradient-to-r from-blue-50 to-indigo-50/60 border-b border-gray-200 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-lg bg-[#0460D9] text-white flex items-center justify-center shadow-sm">
              <span class="material-symbols-outlined text-[20px]">${isEdit ? 'edit_note' : 'add_task'}</span>
            </div>
            <div>
              <h3 class="text-sm font-bold text-gray-800">${isEdit ? 'Chỉnh sửa trách nhiệm công việc' : 'Thêm trách nhiệm công việc cốt lõi'}</h3>
              <span class="text-[10px] font-mono text-primary bg-blue-100/80 px-1.5 py-0.2 rounded font-semibold">JSONB Array • Core Responsibilities</span>
            </div>
          </div>
          <button onclick="document.getElementById('hrm-responsibility-modal').remove()" class="text-gray-400 hover:text-gray-600 p-1 rounded-lg">
            <span class="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div class="p-5 text-xs text-gray-700 space-y-3.5">
          <div>
            <label class="text-xs font-bold text-gray-700 block mb-1">Mô tả trách nhiệm công việc <span class="text-red-500">*</span></label>
            <textarea id="hrm-resp-desc" rows="3" placeholder="Nhập chi tiết trách nhiệm cốt lõi của chức danh..." class="w-full text-xs border border-gray-300 rounded-lg p-2.5 bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary">${currentText}</textarea>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Tần suất thực hiện</label>
              <select id="hrm-resp-freq" class="w-full text-xs border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white">
                <option selected>Hàng ngày / Hàng tuần</option>
                <option>Khi phát sinh</option>
                <option>Định kỳ hàng tháng</option>
                <option>Định kỳ hàng quý</option>
              </select>
            </div>
            <div>
              <label class="text-xs font-bold text-gray-700 block mb-1">Trọng số KPI (%)</label>
              <input id="hrm-resp-weight" type="number" min="5" max="100" step="5" value="${currentWeight}" class="w-full text-xs font-mono font-bold border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white">
            </div>
          </div>
        </div>
        <div class="px-5 py-3.5 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <button onclick="document.getElementById('hrm-responsibility-modal').remove()" class="px-3.5 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-semibold hover:bg-white transition-colors">
            Hủy bỏ
          </button>
          <button id="hrm-btn-save-resp" class="px-4 py-1.5 bg-[#0460D9] hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[15px]">check</span> ${isEdit ? 'Cập nhật trách nhiệm' : 'Thêm vào danh sách'}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('hrm-btn-save-resp').onclick = () => {
      const descVal = document.getElementById('hrm-resp-desc').value.trim();
      const freqVal = document.getElementById('hrm-resp-freq').value;
      const weightVal = document.getElementById('hrm-resp-weight').value;

      if (!descVal) {
        hrmToast('Vui lòng nhập mô tả trách nhiệm công việc!', 'error', 'Thiếu thông tin');
        return;
      }

      if (isEdit && editItem) {
        const pTag = editItem.querySelector('p');
        const spanTag = editItem.querySelector('span.text-\\[10px\\]');
        if (pTag) pTag.textContent = descVal;
        if (spanTag) spanTag.textContent = `Tần suất: ${freqVal} • Trọng số KPI: ${weightVal}%`;
        hrmToast('Đã cập nhật mục trách nhiệm thành công!', 'success', 'Cập nhật');
      } else {
        const listContainer = document.querySelector('#jd-responsibilities-list') || targetBtn?.closest('.space-y-2')?.querySelector('.space-y-2');
        if (listContainer) {
          const nextIdx = listContainer.children.length + 1;
          const newItem = document.createElement('div');
          newItem.className = 'flex items-start gap-2 p-2.5 rounded-lg border border-outline-variant/60 bg-surface-container-low transition-all';
          newItem.innerHTML = `
            <span class="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">${nextIdx}</span>
            <div class="flex-1">
              <p class="text-on-surface font-medium leading-relaxed">${descVal}</p>
              <span class="text-[10px] text-gray-500">Tần suất: ${freqVal} • Trọng số KPI: ${weightVal}%</span>
            </div>
            <div class="flex items-center gap-1">
              <button onclick="hrmEditResponsibility(this)" class="p-1 text-gray-400 hover:text-primary transition-colors"><span class="material-symbols-outlined text-[15px]">edit</span></button>
              <button onclick="hrmDeleteResponsibility(this)" class="p-1 text-gray-400 hover:text-error transition-colors"><span class="material-symbols-outlined text-[15px]">delete</span></button>
            </div>
          `;
          listContainer.appendChild(newItem);
        }
        hrmToast('Đã thêm trách nhiệm công việc mới vào JD!', 'success', 'Thêm mới');
      }
      modal.remove();
    };
  };

  window.hrmEditResponsibility = function (btn) {
    const item = btn.closest('.flex.items-start');
    if (item) {
      hrmOpenAddResponsibilityModal(btn, item);
    }
  };

  window.hrmDeleteResponsibility = function (btn) {
    hrmPopconfirm(btn, {
      title: 'Xóa trách nhiệm này?',
      message: 'Bạn có chắc muốn loại bỏ trách nhiệm công việc này khỏi bản mô tả JD?',
      okText: 'Xóa ngay',
      cancelText: 'Hủy',
      isDanger: true,
      onConfirm: () => {
        const item = btn.closest('.flex.items-start');
        if (item) {
          item.remove();
          hrmToast('Đã xóa trách nhiệm công việc khỏi bản JD!', 'info', 'Đã xóa');
        }
      }
    });
  };

  window.hrmPublishJD = function (btn) {
    hrmPopconfirm(btn, {
      title: 'Lưu & Ban hành JD?',
      message: 'Ban hành phiên bản JD v2.1 mới tới toàn bộ nhân sự đảm nhiệm chức danh POS-ENG-03?',
      okText: 'Ban hành ngay',
      cancelText: 'Xem lại',
      isDanger: false,
      onConfirm: () => {
        hrmToast('Bản mô tả công việc (JD v2.1) đã được lưu và ban hành chính thức thành công!', 'success', 'Ban hành thành công');
      }
    });
  };

  window.hrmCancelJDConfig = function (btn) {
    hrmPopconfirm(btn, {
      title: 'Hủy các thay đổi JD?',
      message: 'Các thay đổi chưa lưu trong bản mô tả JD sẽ bị hủy bỏ.',
      okText: 'Xác nhận hủy',
      cancelText: 'Tiếp tục soạn',
      isDanger: true,
      onConfirm: () => {
        hrmToast('Đã hủy bỏ các thay đổi của bản cấu hình JD.', 'info', 'Đã hủy');
      }
    });
  };

  window.hrmCloseJDCard = function (btn) {
    const card = btn.closest('.bg-surface.rounded-xl.border-2') || document.getElementById('jd-config-card');
    if (card) {
      card.style.display = 'none';
      hrmToast('Đã thu gọn khối Cấu hình Hồ sơ Chức danh & JD.', 'info', 'Thu gọn');
    }
  };

  // Salary Step Handlers (Thang bảng lương - Bậc lương)
  window.hrmOpenEditSalaryStepModal = function (btn) {
    const row = btn.closest('tr');
    if (!row) return;

    const existing = document.getElementById('hrm-salary-step-modal');
    if (existing) existing.remove();

    const stepName = row.children[0]?.textContent?.trim() || 'Bậc lương';
    const minSalary = row.children[1]?.textContent?.trim() || '18.000.000 đ';
    const baseSalary = row.children[2]?.textContent?.trim() || '20.000.000 đ';
    const midSalary = row.children[3]?.textContent?.trim() || '20.500.000 đ';
    const maxSalary = row.children[4]?.textContent?.trim() || '22.000.000 đ';
    const dateRange = row.children[5]?.querySelector('.block')?.textContent?.trim() || '01/01/2024 - Hiện hành';

    const modal = document.createElement('div');
    modal.id = 'hrm-salary-step-modal';
    modal.className = 'fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden transform transition-all border border-gray-200">
        <div class="px-5 py-4 bg-gradient-to-r from-blue-50 to-indigo-50/60 border-b border-gray-200 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-lg bg-[#0460D9] text-white flex items-center justify-center shadow-sm">
              <span class="material-symbols-outlined text-[20px]">payments</span>
            </div>
            <div>
              <h3 class="text-sm font-bold text-gray-800">Cấu hình Bậc lương: ${stepName}</h3>
              <span class="text-[10px] font-mono text-primary bg-blue-100/80 px-1.5 py-0.2 rounded font-semibold">hrm_salary_steps • Ngạch GR-ENG-SR</span>
            </div>
          </div>
          <button onclick="document.getElementById('hrm-salary-step-modal').remove()" class="text-gray-400 hover:text-gray-600 p-1 rounded-lg">
            <span class="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div class="p-5 text-xs text-gray-700 space-y-4">
          <div class="p-3 bg-blue-50/50 border border-blue-200 rounded-lg text-primary text-[11px] flex items-center gap-2">
            <span class="material-symbols-outlined text-[17px]">info</span>
            <span>Mức lương cơ bản chuẩn (Base) sẽ được dùng làm căn cứ tính lương cố định và đóng BHXH theo quy chế C&B.</span>
          </div>
          <div class="grid grid-cols-2 gap-3.5">
            <div>
              <label class="font-bold text-gray-700 block mb-1">Mức sàn (Min Salary) <span class="text-red-500">*</span></label>
              <input id="hrm-step-min" type="text" value="${minSalary}" class="w-full border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white text-xs font-mono font-bold focus:ring-1 focus:ring-primary">
            </div>
            <div>
              <label class="font-bold text-gray-700 block mb-1">Cơ bản chuẩn (Base Salary) <span class="text-red-500">*</span></label>
              <input id="hrm-step-base" type="text" value="${baseSalary}" class="w-full border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white text-xs font-mono font-bold text-primary focus:ring-1 focus:ring-primary">
            </div>
            <div>
              <label class="font-bold text-gray-700 block mb-1">Trung vị (Mid Salary) <span class="text-red-500">*</span></label>
              <input id="hrm-step-mid" type="text" value="${midSalary}" class="w-full border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white text-xs font-mono focus:ring-1 focus:ring-primary">
            </div>
            <div>
              <label class="font-bold text-gray-700 block mb-1">Mức trần (Max Salary) <span class="text-red-500">*</span></label>
              <input id="hrm-step-max" type="text" value="${maxSalary}" class="w-full border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white text-xs font-mono font-bold focus:ring-1 focus:ring-primary">
            </div>
            <div class="col-span-2">
              <label class="font-bold text-gray-700 block mb-1">Hiệu lực áp dụng</label>
              <input id="hrm-step-date" type="text" value="${dateRange}" class="w-full border border-gray-300 rounded-lg p-2 bg-gray-50 focus:bg-white text-xs focus:ring-1 focus:ring-primary">
            </div>
          </div>
        </div>
        <div class="px-5 py-3.5 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <button onclick="document.getElementById('hrm-salary-step-modal').remove()" class="px-3.5 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-semibold hover:bg-white transition-colors">
            Hủy bỏ
          </button>
          <button id="hrm-btn-save-salary-step" class="px-4 py-1.5 bg-[#0460D9] hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">save</span> Lưu thay đổi
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('hrm-btn-save-salary-step').onclick = () => {
      const newMin = document.getElementById('hrm-step-min').value.trim();
      const newBase = document.getElementById('hrm-step-base').value.trim();
      const newMid = document.getElementById('hrm-step-mid').value.trim();
      const newMax = document.getElementById('hrm-step-max').value.trim();
      const newDate = document.getElementById('hrm-step-date').value.trim();

      if (row.children[1]) row.children[1].textContent = newMin;
      if (row.children[2]) row.children[2].textContent = newBase;
      if (row.children[3]) row.children[3].textContent = newMid;
      if (row.children[4]) row.children[4].textContent = newMax;
      if (row.children[5] && row.children[5].querySelector('.block')) {
        row.children[5].querySelector('.block').textContent = newDate;
      }

      modal.remove();
      hrmToast(`Đã cập nhật mức dải lương cho <strong>${stepName}</strong> thành công!`, 'success', 'Cập nhật bậc lương');
    };
  };

  // 10. Chuyển đổi trạng thái Khóa / Mở lại kỳ công (Timesheet Period Locking & Reopening Lifecycle)
  window.hrmTogglePeriodLock = function (btn, periodCode, action) {
    const row = btn.closest('tr');
    if (!row) return;

    const statusCell = row.children[3];
    const lockedByCell = row.children[4];
    const reopenLogCell = row.children[5];
    const actionsCell = row.children[6];

    const nowStr = new Date().toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

    if (action === 'LOCK') {
      // Chuyển sang LOCKED
      row.className = 'table-row-hover transition-colors';
      if (statusCell) {
        statusCell.innerHTML = `
          <span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-green-100 text-green-700 border border-green-200 font-mono flex items-center justify-center gap-1">
            <span class="material-symbols-outlined text-[13px]">lock</span>
            <span>LOCKED</span>
          </span>
        `;
      }
      if (lockedByCell) {
        lockedByCell.innerHTML = `
          <div class="font-semibold text-on-surface">Mai Linh (C&B Lead)</div>
          <span class="text-[10px] text-gray-500 font-mono">${nowStr}</span>
        `;
      }
      if (actionsCell) {
        actionsCell.innerHTML = `
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="hrmOpenTimesheetMatrix('${periodCode}')" class="p-1.5 border border-outline-variant rounded hover:bg-surface-container-high text-primary flex items-center gap-1 text-[11px] font-medium shadow-xs" title="Xem bảng công chi tiết">
              <span class="material-symbols-outlined text-[15px]">grid_view</span><span>Xem công</span>
            </button>
            <button onclick="hrmPopconfirm(this, {title: 'Mở lại kỳ dữ liệu?', message: 'Hệ thống sẽ mở quyền cập nhật cho các phòng ban liên quan (Cần phê duyệt HR Head).', okText: 'Mở lại', onConfirm: () => hrmTogglePeriodLock(this, '${periodCode}', 'REOPEN')})" class="p-1.5 border border-outline-variant rounded hover:bg-surface-container-low text-on-surface-variant flex items-center gap-1 text-[11px] font-medium shadow-xs cursor-pointer" title="Yêu cầu mở lại kỳ công">
              <span class="material-symbols-outlined text-[15px] text-amber-800">lock_open</span><span>Mở lại</span>
            </button>
            <button onclick="hrmOpenDetailDrawer('Lịch sử kiểm toán & Thay đổi', '#AUDIT-${periodCode}', 'INFO')" class="p-1.5 border border-outline-variant rounded hover:bg-surface-container-high text-gray-600 flex items-center text-[11px] shadow-xs" title="Xem lịch sử audit">
              <span class="material-symbols-outlined text-[15px]">history</span>
            </button>
          </div>
        `;
      }
      hrmToast(`Kỳ bảng công <strong>${periodCode}</strong> đã được KHÓA SỔ thành công! Dữ liệu đã chuyển sang trạng thái bất biến (Immutable).`, 'success', 'Khóa kỳ công thành công');
    } else if (action === 'REOPEN') {
      // Chuyển sang REOPENED
      row.className = 'table-row-hover transition-colors bg-error-container/20';
      if (statusCell) {
        statusCell.innerHTML = `
          <span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 font-mono flex items-center justify-center gap-1">
            <span class="material-symbols-outlined text-[13px]">warning</span>
            <span>REOPENED</span>
          </span>
        `;
      }
      if (reopenLogCell) {
        reopenLogCell.innerHTML = `
          <div class="font-bold text-error">Trần Quốc Bảo (HR Head)</div>
          <div class="text-[10px] text-gray-500 font-mono">${nowStr}</div>
          <span class="text-[10px] text-amber-800 italic block mt-0.5">Mở bổ sung ngoại lệ</span>
        `;
      }
      if (actionsCell) {
        actionsCell.innerHTML = `
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="hrmOpenTimesheetMatrix('${periodCode}')" class="p-1.5 border border-outline-variant rounded hover:bg-surface-container-high text-primary flex items-center gap-1 text-[11px] font-medium shadow-xs" title="Xem bảng công chi tiết">
              <span class="material-symbols-outlined text-[15px]">grid_view</span><span>Xem công</span>
            </button>
            <button onclick="hrmPopconfirm(this, {title: 'Khóa kỳ dữ liệu?', message: 'Tái khóa sổ dữ liệu sau khi hoàn tất rà soát & điều chỉnh?', isDanger: true, okText: 'Khóa dữ liệu', onConfirm: () => hrmTogglePeriodLock(this, '${periodCode}', 'LOCK')})" class="p-1.5 border border-primary bg-[#0460D9] text-white rounded hover:bg-opacity-90 flex items-center gap-1 text-[11px] font-semibold shadow-xs cursor-pointer" title="Tái khóa bảng công sau khi điều chỉnh xong">
              <span class="material-symbols-outlined text-[15px]">lock_reset</span><span>Tái khóa</span>
            </button>
            <button onclick="hrmOpenDetailDrawer('Lịch sử kiểm toán & Thay đổi', '#AUDIT-${periodCode}', 'INFO')" class="p-1.5 border border-outline-variant rounded hover:bg-surface-container-high text-gray-600 flex items-center text-[11px] shadow-xs" title="Xem lịch sử audit">
              <span class="material-symbols-outlined text-[15px]">history</span>
            </button>
          </div>
        `;
      }
      hrmToast(`Kỳ bảng công <strong>${periodCode}</strong> đã được MỞ LẠI theo phê duyệt của Trưởng ban Nhân sự!`, 'info', 'Mở lại kỳ dữ liệu');
    }
  };

  // 11. Xem chi tiết / ma trận dữ liệu của kỳ công
  window.hrmOpenTimesheetMatrix = function (periodCode) {
    const detailHtml = `
      <div class="space-y-4 text-xs">
        <div class="p-3.5 bg-blue-50/60 border border-blue-200 rounded-xl flex items-center justify-between">
          <div>
            <span class="text-xs text-gray-500 font-mono">Mã kỳ đối soát</span>
            <div class="font-bold text-base text-primary font-mono">${periodCode}</div>
          </div>
          <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-[#0460D9] text-white">150 Nhân sự</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
            <span class="text-[11px] text-gray-500 block">Số ngày chuẩn</span>
            <span class="text-sm font-bold text-on-surface font-mono">22 công (176 giờ)</span>
          </div>
          <div class="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
            <span class="text-[11px] text-gray-500 block">Tổng giờ OT tích lũy</span>
            <span class="text-sm font-bold text-amber-800 font-mono">342.5 giờ OT</span>
          </div>
          <div class="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
            <span class="text-[11px] text-gray-500 block">Số ca quẹt thẻ hợp lệ</span>
            <span class="text-sm font-bold text-green-700 font-mono">3,120 / 3,150 (99%)</span>
          </div>
          <div class="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
            <span class="text-[11px] text-gray-500 block">Bất thường chờ duyệt</span>
            <span class="text-sm font-bold text-error font-mono">6 trường hợp</span>
          </div>
        </div>
        <div class="p-3 bg-amber-50/40 rounded-lg border border-amber-200 text-[11px] text-amber-900">
          <strong>Liên kết phân hệ Tiền lương & Chi trả:</strong> Số liệu kỳ này sẽ là căn cứ tính toán bảng lương tự động trên Payroll Engine sau khi chốt khóa sổ (LOCKED).
        </div>
        <div class="pt-2">
          <a href="../b_ng_c_ng_t_ng_h_p_sub_tab_b_ng_c_ng_chi_ti_t_svn_dts/code.html" class="w-full flex items-center justify-center gap-1.5 py-2.5 bg-[#0460D9] hover:bg-opacity-90 text-white rounded-lg font-semibold text-xs transition-colors shadow-sm no-underline">
            <span class="material-symbols-outlined text-[17px]">grid_on</span>
            <span>Mở toàn bộ Bảng công chi tiết kỳ này</span>
          </a>
        </div>
      </div>
    `;

    hrmOpenDetailDrawer(`Chi tiết ma trận kỳ công: ${periodCode}`, `#${periodCode}`, 'APPROVED');
    const drawerBody = document.querySelector('.hrm-drawer-body');
    if (drawerBody) {
      drawerBody.innerHTML = detailHtml;
    }
  };

})();


