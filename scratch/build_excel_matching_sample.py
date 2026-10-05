import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
import re

def build_excel():
    # Khởi tạo workbook mới
    wb = openpyxl.Workbook()
    # Sheet mặc định đổi tên thành 'Tổng quan & Tài khoản'
    ws_overview = wb.active
    ws_overview.title = 'Tổng quan & Tài khoản'
    
    # Tạo sheet thứ hai 'Kịch bản kiểm thử (Test Cases)'
    ws_cases = wb.create_sheet('Kịch bản kiểm thử (Test Cases)')
    
    # Đặt độ rộng cột giống 100% bản mẫu
    # Cột A: 3, B: 31.71, C: 32, D: 38, E: 30, F: 32, G: 45, H: 8.71
    ws_overview.column_dimensions['A'].width = 3.0
    ws_overview.column_dimensions['B'].width = 32.0
    ws_overview.column_dimensions['C'].width = 35.0
    ws_overview.column_dimensions['D'].width = 38.0
    ws_overview.column_dimensions['E'].width = 30.0
    ws_overview.column_dimensions['F'].width = 35.0
    ws_overview.column_dimensions['G'].width = 50.0
    ws_overview.column_dimensions['H'].width = 8.71

    # Col widths for Test Cases: A: 3, B: 16, C: 10, D: 24, E: 46, F: 54, G: 24
    ws_cases.column_dimensions['A'].width = 3.0
    ws_cases.column_dimensions['B'].width = 16.0
    ws_cases.column_dimensions['C'].width = 10.0
    ws_cases.column_dimensions['D'].width = 24.0
    ws_cases.column_dimensions['E'].width = 46.0
    ws_cases.column_dimensions['F'].width = 54.0
    ws_cases.column_dimensions['G'].width = 24.0
    ws_cases.column_dimensions['H'].width = 8.71

    # Định nghĩa Styles chuẩn theo mẫu
    font_main_title = Font(name='Calibri', size=16, bold=True, color='1F2937')
    font_sub_title = Font(name='Calibri', size=11, bold=False, color='4B5563')
    font_section_header = Font(name='Calibri', size=11, bold=True, color='1E3A8A')
    font_bold_10 = Font(name='Calibri', size=10, bold=True, color='111827')
    font_bold_11 = Font(name='Calibri', size=11, bold=True, color='111827')
    font_regular_10 = Font(name='Calibri', size=10, bold=False, color='1F2937')
    
    font_chapter = Font(name='Calibri', size=12, bold=True, color='FFFFFF')
    font_subchapter = Font(name='Calibri', size=11, bold=True, color='1E40AF')

    fill_chapter = PatternFill(start_color='1E3A8A', end_color='1E3A8A', fill_type='solid')
    fill_subchapter = PatternFill(start_color='DBEAFE', end_color='DBEAFE', fill_type='solid')
    fill_table_header = PatternFill(start_color='E5E7EB', end_color='E5E7EB', fill_type='solid')
    fill_data_row = PatternFill(start_color='F9FAFB', end_color='F9FAFB', fill_type='solid')
    fill_kpi_value = PatternFill(start_color='F3F4F6', end_color='F3F4F6', fill_type='solid')

    align_center = Alignment(horizontal='center', vertical='center')
    align_left_center = Alignment(horizontal='left', vertical='center')
    align_left_wrap = Alignment(horizontal='left', vertical='center', wrap_text=True)
    align_center_wrap = Alignment(horizontal='center', vertical='center', wrap_text=True)

    thin_border_side = Side(style='thin', color='D1D5DB')
    cell_border = Border(top=thin_border_side, bottom=thin_border_side, left=thin_border_side, right=thin_border_side)

    # ==========================================
    # 1. ĐỌC DỮ LIỆU TỪ TEST_2026_29_09.md
    # ==========================================
    with open('D:/CRM/enterprise-platform/TEST_2026_29_09.md', 'r', encoding='utf-8') as f:
        md_text = f.read()
    lines = md_text.split('\n')

    actor_map = {
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
    }

    # ==========================================
    # 2. XÂY DỰNG SHEET: Kịch bản kiểm thử (Test Cases)
    # ==========================================
    ws_cases['B2'] = 'BẢNG THEO DÕI KỊCH BẢN KIỂM THỬ CHI TIẾT (CHECKLIST & TEST CASES)'
    ws_cases['B2'].font = font_main_title
    
    ws_cases['B3'] = 'Hướng dẫn: Chọn trạng thái Chưa test / Đạt (Pass) / Lỗi (Fail) / Bỏ qua tại cột B. Tiến độ sẽ tự động tính toán sang Dashboard.'
    ws_cases['B3'].font = font_sub_title

    # Header dòng 4
    headers = [
        ('B4', 'Trạng thái', align_center),
        ('C4', '#', align_center),
        ('D4', 'Ai thực hiện', align_left_center),
        ('E4', 'Thao tác trên giao diện', align_left_center),
        ('F4', 'Kết quả mong đợi', align_left_center),
        ('G4', 'Ghi chú / Bug ID', align_left_center)
    ]
    for pos, text, alignment in headers:
        c = ws_cases[pos]
        c.value = text
        c.font = font_bold_11
        c.fill = fill_table_header
        c.alignment = alignment
        c.border = cell_border

    current_row = 5
    first_tc_row = None
    last_tc_row = None

    for line in lines:
        line_str = line.strip()
        
        # Bắt PHẦN A, PHẦN B (# PHẦN A...)
        if line_str.startswith('# PHẦN'):
            part_title = line_str.replace('#', '').strip()
            ws_cases[f'B{current_row}'].fill = fill_chapter
            ws_cases[f'B{current_row}'].border = cell_border
            c = ws_cases[f'C{current_row}']
            c.value = part_title
            c.font = font_chapter
            c.fill = fill_chapter
            c.alignment = align_left_center
            c.border = cell_border
            for col in ['D', 'E', 'F', 'G']:
                ws_cases[f'{col}{current_row}'].border = cell_border
            ws_cases.merge_cells(f'C{current_row}:G{current_row}')
            ws_cases.row_dimensions[current_row].height = 24.0
            current_row += 1
            continue

        # Bắt Phân hệ (## 1., ## 2., ..., ## 14.) -> Dòng Chương (Xanh đậm 1E3A8A)
        sec_match = re.match(r'^##\s+(\d+)\.\s+(.*)$', line_str)
        if sec_match:
            sec_num = int(sec_match.group(1))
            if sec_num < 1 or sec_num > 14:
                continue
            sec_name = sec_match.group(2).strip()
            chapter_text = f'{sec_num}. {sec_name}'
            ws_cases[f'B{current_row}'].fill = fill_chapter
            ws_cases[f'B{current_row}'].border = cell_border
            c = ws_cases[f'C{current_row}']
            c.value = chapter_text
            c.font = font_chapter
            c.fill = fill_chapter
            c.alignment = align_left_center
            c.border = cell_border
            for col in ['D', 'E', 'F', 'G']:
                ws_cases[f'{col}{current_row}'].border = cell_border
            ws_cases.merge_cells(f'C{current_row}:G{current_row}')
            ws_cases.row_dimensions[current_row].height = 22.0
            current_row += 1
            continue

        # Bắt Mục con (### 1.1, ### 2.1, ..., ### 10.1) -> Dòng Mục (Xanh nhạt DBEAFE)
        subsec_match = re.match(r'^###\s+(\d+\.\d+)\s+[—-]\s+(.*)$', line_str)
        if subsec_match:
            sub_id = subsec_match.group(1)
            sub_name = subsec_match.group(2).strip()
            sub_text = f'MỤC {sub_id} — {sub_name}'
            
            b_cell = ws_cases[f'B{current_row}']
            b_cell.value = 'Chưa test'
            b_cell.font = font_bold_10
            b_cell.fill = fill_subchapter
            b_cell.alignment = align_center
            b_cell.border = cell_border

            c = ws_cases[f'C{current_row}']
            c.value = sub_text
            c.font = font_subchapter
            c.fill = fill_subchapter
            c.alignment = align_left_center
            c.border = cell_border
            for col in ['D', 'E', 'F', 'G']:
                ws_cases[f'{col}{current_row}'].border = cell_border
            ws_cases.merge_cells(f'C{current_row}:G{current_row}')
            ws_cases.row_dimensions[current_row].height = 20.0
            current_row += 1
            continue

        # Bắt Test Case Table Row (| 1.1.1 | **NV-1** | ... | ... |)
        if line_str.startswith('|') and '**' in line_str:
            parts = [p.strip() for p in line_str.split('|')[1:-1]]
            if len(parts) >= 4:
                tc_id = parts[0].replace('**', '').strip()
                raw_actor = parts[1].replace('**', '').strip()
                action = parts[2].replace('<br>', '\n').replace('`', '').strip()
                expected = parts[3].replace('<br>', '\n').replace('`', '').strip()

                if re.match(r'^\d+(\.\d+)+$', tc_id):
                    actor = actor_map.get(raw_actor, raw_actor)

                    if first_tc_row is None:
                        first_tc_row = current_row
                    last_tc_row = current_row

                    # B: Trạng thái
                    b_cell = ws_cases[f'B{current_row}']
                    b_cell.value = 'Chưa test'
                    b_cell.font = font_bold_10
                    b_cell.fill = fill_data_row
                    b_cell.alignment = align_center
                    b_cell.border = cell_border

                    # C: Mã TC
                    c_cell = ws_cases[f'C{current_row}']
                    c_cell.value = tc_id
                    c_cell.font = font_bold_10
                    c_cell.fill = fill_data_row
                    c_cell.alignment = align_center
                    c_cell.border = cell_border

                    # D: Ai thực hiện
                    d_cell = ws_cases[f'D{current_row}']
                    d_cell.value = actor
                    d_cell.font = font_bold_10
                    d_cell.fill = fill_data_row
                    d_cell.alignment = align_left_wrap
                    d_cell.border = cell_border

                    # E: Thao tác trên giao diện
                    e_cell = ws_cases[f'E{current_row}']
                    e_cell.value = action
                    e_cell.font = font_regular_10
                    e_cell.fill = fill_data_row
                    e_cell.alignment = align_left_wrap
                    e_cell.border = cell_border

                    # F: Kết quả mong đợi
                    f_cell = ws_cases[f'F{current_row}']
                    f_cell.value = expected
                    f_cell.font = font_regular_10
                    f_cell.fill = fill_data_row
                    f_cell.alignment = align_left_wrap
                    f_cell.border = cell_border

                    # G: Ghi chú / Bug ID
                    g_cell = ws_cases[f'G{current_row}']
                    g_cell.value = ''
                    g_cell.font = font_regular_10
                    g_cell.fill = fill_data_row
                    g_cell.alignment = align_left_wrap
                    g_cell.border = cell_border

                    ws_cases.row_dimensions[current_row].height = 28.0
                    current_row += 1

    # Thêm Data Validation Dropdown cho toàn bộ cột B trong sheet Test Cases
    dv = DataValidation(type="list", formula1='"Chưa test,Đạt (Pass),Lỗi (Fail),Bỏ qua,Cần làm rõ"', allow_blank=True)
    ws_cases.add_data_validation(dv)
    dv.add(f'B5:B{current_row}')

    print(f'Test cases rows: {first_tc_row} to {last_tc_row}. Total rows: {current_row - 1}')

    # ==========================================
    # 3. XÂY DỰNG SHEET: Tổng quan & Tài khoản
    # ==========================================
    ws_overview['B2'] = 'KỊCH BẢN KIỂM THỬ UI & CHỨC NĂNG HỆ THỐNG'
    ws_overview['B2'].font = font_main_title
    
    ws_overview['B3'] = 'Doanh nghiệp: SAVINA Testing Hub · Phiên bản: 2026-09-29 · Môi trường: Live Production'
    ws_overview['B3'].font = font_sub_title

    ws_overview['B5'] = 'DASHBOARD THEO DÕI TIẾN ĐỘ KIỂM THỬ (TỰ ĐỘNG TÍNH TOÁN)'
    ws_overview['B5'].font = font_section_header

    # Định nghĩa Dashboard KPI với Công thức Động trỏ chuẩn xác sang Sheet 2
    ws_cases_title = "'Kịch bản kiểm thử (Test Cases)'"
    
    kpis = [
        (6, 'Tổng số bước test', f"=COUNTA({ws_cases_title}!C{first_tc_row}:C{last_tc_row})", 'Bước', None),
        (7, 'Đã hoàn thành (Pass)', f'=COUNTIF({ws_cases_title}!B{first_tc_row}:B{last_tc_row}, "Đạt (Pass)")', 'Bước', None),
        (8, 'Gặp lỗi (Fail / Bug)', f'=COUNTIF({ws_cases_title}!B{first_tc_row}:B{last_tc_row}, "Lỗi (Fail)")', 'Bước', None),
        (9, 'Chưa kiểm thử', f'=COUNTIF({ws_cases_title}!B{first_tc_row}:B{last_tc_row}, "Chưa test") + COUNTIF({ws_cases_title}!B{first_tc_row}:B{last_tc_row}, "")', 'Bước', None),
        (10, 'Tỷ lệ hoàn thành', '=IFERROR(C7/C6, 0)', '%', '0.0%')
    ]

    for row_idx, label, formula_val, unit, num_fmt in kpis:
        b = ws_overview[f'B{row_idx}']
        b.value = label
        b.font = font_bold_10
        b.border = cell_border
        
        c = ws_overview[f'C{row_idx}']
        c.value = formula_val
        c.font = font_bold_10
        c.fill = fill_kpi_value
        c.alignment = align_center
        c.border = cell_border
        if num_fmt:
            c.number_format = num_fmt

        d = ws_overview[f'D{row_idx}']
        d.value = unit
        d.font = font_regular_10
        d.alignment = align_center
        d.border = cell_border

    ws_overview['B12'] = 'THÔNG TIN MÔI TRƯỜNG & ĐƯỜNG DẪN'
    ws_overview['B12'].font = font_section_header

    env_rows = [
        (13, 'Domain triển khai thực tế', 'https://enterprise-platform.savinatestinghub.com/ (hoặc http://localhost:3000)'),
        (14, 'Cổng Platform Superadmin', 'https://enterprise-platform.savinatestinghub.com/platform/login'),
        (15, 'Cổng Đăng nhập SAVINA Tenant', 'https://enterprise-platform.savinatestinghub.com/tenant/login'),
        (16, 'Module Quản trị Nhân sự (HRM)', 'https://enterprise-platform.savinatestinghub.com/modules/hrm'),
        (17, 'Module Không gian làm việc (Workspace)', 'https://enterprise-platform.savinatestinghub.com/modules/workspace'),
        (18, 'Module Động cơ Quy trình (Procedure)', 'https://enterprise-platform.savinatestinghub.com/modules/procedure'),
        (19, 'Tài khoản Tenant Admin SAVINA', 'Email: nguyen.tran.nhu.quynh@savina.local  |  Pass: Savina-Member-Demo-2026'),
        (20, 'Mật khẩu chung thành viên SAVINA', 'Savina-Member-Demo-2026 (theo file seed SAVINA_DATA_IMPORT_SAMPLE.xlsx)')
    ]

    for r_idx, label, val in env_rows:
        b = ws_overview[f'B{r_idx}']
        b.value = label
        b.font = font_bold_10
        b.border = cell_border

        c = ws_overview[f'C{r_idx}']
        c.value = val
        c.font = font_regular_10
        c.border = cell_border
        
        # Merge C:F giống hệt mẫu
        for col in ['D', 'E', 'F']:
            ws_overview[f'{col}{r_idx}'].border = cell_border
        ws_overview.merge_cells(f'C{r_idx}:F{r_idx}')

    ws_overview['B22'] = 'DANH SÁCH TÀI KHOẢN THỬ NGHIỆM CHI TIẾT'
    ws_overview['B22'].font = font_section_header

    acc_headers = [
        ('B23', 'Ký hiệu', align_center),
        ('C23', 'Họ và tên', align_left_center),
        ('D23', 'Email đăng nhập', align_left_center),
        ('E23', 'Mật khẩu', align_left_center),
        ('F23', 'Vai trò / Chức danh', align_left_center),
        ('G23', 'Nhiệm vụ kiểm thử chính', align_left_center)
    ]
    for pos, text, alignment in acc_headers:
        c = ws_overview[pos]
        c.value = text
        c.font = font_bold_11
        c.fill = fill_table_header
        c.alignment = alignment
        c.border = cell_border

    accounts_data = [
        ('NV-1', 'Bùi Công Quyền', 'bui.cong.quyen@savina.local', 'Savina-Member-Demo-2026', 'Phòng Thí nghiệm / Member', 'Nhân viên gửi đơn HRM, quẹt thẻ, nhận & làm task Workspace, kéo thả Kanban, chat trao đổi'),
        ('NV-2', 'Phan Đức Thắng', 'phan.duc.thang@savina.local', 'Savina-Member-Demo-2026', 'Phòng Thí nghiệm / Member', 'Đồng nghiệp đối ứng xác nhận đổi ca chéo (PENDING_PEER), cộng tác viên dự án'),
        ('TN', 'Nguyễn Tấn Thịnh', 'nguyen.tan.thinh@savina.local', 'Savina-Member-Demo-2026', 'Trưởng phòng Thí nghiệm / Manager', 'Quản lý cấp 1 duyệt đơn, duyệt giải trình công, phân công & gán phụ thuộc WBS'),
        ('HCTH', 'Nguyễn Trần Như Quỳnh', 'nguyen.tran.nhu.quynh@savina.local', 'Savina-Member-Demo-2026', 'Trưởng phòng HCTH / Tenant Admin / Owner', 'Quản trị nhân sự, danh mục ca, JD, tạo dự án WBS, quản lý ngân sách & kho tài liệu')
    ]

    for idx, (code, name, email, pwd, role, duty) in enumerate(accounts_data, start=24):
        ws_overview[f'B{idx}'] = code
        ws_overview[f'B{idx}'].font = font_bold_10
        ws_overview[f'B{idx}'].alignment = align_center
        ws_overview[f'B{idx}'].border = cell_border

        ws_overview[f'C{idx}'] = name
        ws_overview[f'C{idx}'].font = font_bold_10
        ws_overview[f'C{idx}'].alignment = align_left_center
        ws_overview[f'C{idx}'].border = cell_border

        ws_overview[f'D{idx}'] = email
        ws_overview[f'D{idx}'].font = font_regular_10
        ws_overview[f'D{idx}'].alignment = align_left_center
        ws_overview[f'D{idx}'].border = cell_border

        ws_overview[f'E{idx}'] = pwd
        ws_overview[f'E{idx}'].font = font_regular_10
        ws_overview[f'E{idx}'].alignment = align_left_center
        ws_overview[f'E{idx}'].border = cell_border

        ws_overview[f'F{idx}'] = role
        ws_overview[f'F{idx}'].font = font_regular_10
        ws_overview[f'F{idx}'].alignment = align_left_center
        ws_overview[f'F{idx}'].border = cell_border

        ws_overview[f'G{idx}'] = duty
        ws_overview[f'G{idx}'].font = font_regular_10
        ws_overview[f'G{idx}'].alignment = align_left_wrap
        ws_overview[f'G{idx}'].border = cell_border

        ws_overview.row_dimensions[idx].height = 24.0

    output_path = 'D:/CRM/enterprise-platform/TEST_2026_29_09.xlsx'
    wb.save(output_path)
    print(f'Đã ghi thành công file chuẩn giao diện sang {output_path}')

if __name__ == '__main__':
    build_excel()
