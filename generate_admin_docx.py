# -*- coding: utf-8 -*-
import os
import re
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, fill_hex):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(f'<w:tcMar {nsdecls("w")}><w:top w:w="{top}" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/><w:left w:w="{left}" w:type="dxa"/><w:right w:w="{right}" w:type="dxa"/></w:tcMar>')
    tcPr.append(tcMar)

def set_table_borders(table, color="D1D5DB", sz="4", val="single"):
    tblPr = table._tbl.tblPr
    borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        f'  <w:top w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'  <w:bottom w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'  <w:insideH w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'  <w:insideV w:val="none"/>'
        f'  <w:left w:val="none"/>'
        f'  <w:right w:val="none"/>'
        f'</w:tblBorders>'
    )
    tblPr.append(borders)

def add_callout(doc, text, title="LƯU Ý / QUAN TRỌNG"):
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = False
    tbl.columns[0].width = Inches(6.5)
    
    cell = tbl.cell(0, 0)
    set_cell_background(cell, "F0F7FF")
    set_cell_margins(cell, top=140, bottom=140, left=200, right=200)
    
    # Left border only
    tcPr = cell._tc.get_or_add_tcPr()
    borders = parse_xml(
        f'<w:tcBorders {nsdecls("w")}>'
        f'  <w:left w:val="single" w:sz="24" w:space="0" w:color="0284C7"/>'
        f'  <w:top w:val="none"/>'
        f'  <w:right w:val="none"/>'
        f'  <w:bottom w:val="none"/>'
        f'</w:tcBorders>'
    )
    tcPr.append(borders)
    
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.15
    run_t = p.add_run(f"📌 {title}: ")
    run_t.bold = True
    run_t.font.name = "Calibri"
    run_t.font.size = Pt(10)
    run_t.font.color.rgb = RGBColor(2, 132, 199)
    
    run_b = p.add_run(text)
    run_b.font.name = "Calibri"
    run_b.font.size = Pt(10)
    run_b.font.color.rgb = RGBColor(30, 41, 59)
    
    doc.add_paragraph().paragraph_format.space_after = Pt(4)

def parse_markdown_to_docx(doc, md_content):
    lines = md_content.splitlines()
    in_table = False
    table_lines = []
    in_code = False
    code_lines = []
    
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Check code block
        if line.strip().startswith("```"):
            if in_code:
                # Flush code block
                in_code = False
                code_text = "\n".join(code_lines)
                code_lines = []
                
                tbl = doc.add_table(rows=1, cols=1)
                tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
                tbl.autofit = False
                tbl.columns[0].width = Inches(6.5)
                c = tbl.cell(0, 0)
                set_cell_background(c, "F8FAFC")
                set_cell_margins(c, top=100, bottom=100, left=150, right=150)
                tcPr = c._tc.get_or_add_tcPr()
                borders = parse_xml(
                    f'<w:tcBorders {nsdecls("w")}>'
                    f'  <w:left w:val="single" w:sz="12" w:space="0" w:color="94A3B8"/>'
                    f'  <w:top w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
                    f'  <w:right w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
                    f'  <w:bottom w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
                    f'</w:tcBorders>'
                )
                tcPr.append(borders)
                cp = c.paragraphs[0]
                cp.paragraph_format.space_before = Pt(2)
                cp.paragraph_format.space_after = Pt(2)
                cp.paragraph_format.line_spacing = 1.05
                crun = cp.add_run(code_text)
                crun.font.name = "Consolas"
                crun.font.size = Pt(8.5)
                crun.font.color.rgb = RGBColor(30, 41, 59)
                p_spacer = doc.add_paragraph()
                p_spacer.paragraph_format.space_before = Pt(0)
                p_spacer.paragraph_format.space_after = Pt(4)
            else:
                in_code = True
                code_lines = []
            i += 1
            continue
            
        if in_code:
            code_lines.append(line)
            i += 1
            continue
            
        # Check markdown table
        if line.strip().startswith("|") and line.strip().endswith("|"):
            in_table = True
            table_lines.append(line)
            i += 1
            continue
        else:
            if in_table:
                # Process table
                render_table(doc, table_lines)
                in_table = False
                table_lines = []
        
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
            
        # Horizontal rule
        if stripped in ["---", "***", "___"]:
            # Small line separator
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(6)
            p.paragraph_format.space_after = Pt(6)
            pBdr = parse_xml(f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="6" w:space="1" w:color="E2E8F0"/></w:pBdr>')
            p._p.get_or_add_pPr().append(pBdr)
            i += 1
            continue
            
        # Blockquote / Notice
        if stripped.startswith(">"):
            text = stripped.lstrip("> ").strip()
            add_callout(doc, text, title="LƯU Ý QUẢN TRỊ")
            i += 1
            continue
            
        # Headings
        if stripped.startswith("# "):
            p = doc.add_heading(level=1)
            p.paragraph_format.space_before = Pt(16)
            p.paragraph_format.space_after = Pt(6)
            p.paragraph_format.keep_with_next = True
            format_runs(p, stripped[2:].strip(), is_title=True, color=RGBColor(15, 23, 42), size=Pt(16))
            i += 1
            continue
        elif stripped.startswith("## "):
            p = doc.add_heading(level=2)
            p.paragraph_format.space_before = Pt(14)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.keep_with_next = True
            format_runs(p, stripped[3:].strip(), is_title=True, color=RGBColor(30, 58, 138), size=Pt(13.5))
            i += 1
            continue
        elif stripped.startswith("### "):
            p = doc.add_heading(level=3)
            p.paragraph_format.space_before = Pt(10)
            p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.keep_with_next = True
            format_runs(p, stripped[4:].strip(), is_title=True, color=RGBColor(14, 116, 144), size=Pt(11.5))
            i += 1
            continue
        elif stripped.startswith("#### "):
            p = doc.add_heading(level=4)
            p.paragraph_format.space_before = Pt(8)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.keep_with_next = True
            format_runs(p, stripped[5:].strip(), is_title=True, color=RGBColor(51, 65, 85), size=Pt(10.5))
            i += 1
            continue
            
        # Lists
        if stripped.startswith("- [ ] ") or stripped.startswith("- [x] "):
            p = doc.add_paragraph(style='List Bullet')
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.line_spacing = 1.15
            is_checked = stripped.startswith("- [x] ")
            box = "☑ " if is_checked else "☐ "
            run_box = p.add_run(box)
            run_box.bold = True
            run_box.font.name = "Segoe UI Symbol"
            format_runs(p, stripped[6:].strip())
            i += 1
            continue
            
        if stripped.startswith("- ") or stripped.startswith("* "):
            p = doc.add_paragraph(style='List Bullet')
            p.paragraph_format.space_before = Pt(1.5)
            p.paragraph_format.space_after = Pt(1.5)
            p.paragraph_format.line_spacing = 1.15
            format_runs(p, stripped[2:].strip())
            i += 1
            continue
            
        # Numbered list
        match_num = re.match(r'^(\d+)\.\s+(.*)', stripped)
        if match_num:
            num = match_num.group(1)
            text = match_num.group(2)
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Inches(0.25)
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.15
            run_num = p.add_run(f"{num}. ")
            run_num.bold = True
            run_num.font.name = "Calibri"
            run_num.font.size = Pt(10)
            run_num.font.color.rgb = RGBColor(30, 58, 138)
            format_runs(p, text)
            i += 1
            continue
            
        # Normal paragraph
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.15
        format_runs(p, stripped)
        i += 1
        
    if in_table:
        render_table(doc, table_lines)

def format_runs(paragraph, text, is_title=False, color=RGBColor(30, 41, 59), size=Pt(10)):
    # Simple regex parser for **bold**, *italic*, `code`
    # Replace markdown links [text](url) -> text
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    
    tokens = re.split(r'(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)', text)
    for token in tokens:
        if not token:
            continue
        if token.startswith("**") and token.endswith("**"):
            run = paragraph.add_run(token[2:-2])
            run.bold = True
            run.font.name = "Calibri"
            run.font.size = size
            run.font.color.rgb = color if is_title else RGBColor(15, 23, 42)
        elif token.startswith("*") and token.endswith("*"):
            run = paragraph.add_run(token[1:-1])
            run.italic = True
            run.font.name = "Calibri"
            run.font.size = size
            run.font.color.rgb = color
        elif token.startswith("`") and token.endswith("`"):
            run = paragraph.add_run(token[1:-1])
            run.font.name = "Consolas"
            run.font.size = Pt(size.pt * 0.9)
            run.font.color.rgb = RGBColor(194, 65, 12)
        else:
            run = paragraph.add_run(token)
            run.font.name = "Calibri"
            run.font.size = size
            run.font.color.rgb = color

def render_table(doc, table_lines):
    rows_data = []
    for line in table_lines:
        line_clean = line.strip()
        if not line_clean.startswith("|"):
            continue
        # Split by |
        parts = [p.strip() for p in line_clean.split("|")[1:-1]]
        # Ignore separator row |---|---|
        if parts and all(re.match(r'^:?-+:?$', p) for p in parts):
            continue
        rows_data.append(parts)
        
    if not rows_data:
        return
        
    num_cols = max(len(r) for r in rows_data)
    table = doc.add_table(rows=len(rows_data), cols=num_cols)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    
    # Calculate column widths to fit ~6.5 inches
    col_width = Inches(6.5 / num_cols)
    for col in table.columns:
        col.width = col_width
        
    for r_idx, r_data in enumerate(rows_data):
        is_header = (r_idx == 0)
        row = table.rows[r_idx]
        # Prevent row split across pages
        trPr = row._tr.get_or_add_trPr()
        trPr.append(parse_xml(f'<w:cantSplit {nsdecls("w")}/>'))
        if is_header:
            trPr.append(parse_xml(f'<w:tblHeader {nsdecls("w")}/>'))
            
        for c_idx in range(num_cols):
            cell = row.cells[c_idx]
            cell.width = col_width
            val = r_data[c_idx] if c_idx < len(r_data) else ""
            
            if is_header:
                set_cell_background(cell, "0F172A")
                set_cell_margins(cell, top=120, bottom=120, left=140, right=140)
            else:
                bg = "FFFFFF" if r_idx % 2 == 1 else "F8FAFC"
                set_cell_background(cell, bg)
                set_cell_margins(cell, top=90, bottom=90, left=140, right=140)
                
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.line_spacing = 1.1
            
            if is_header:
                format_runs(p, val, is_title=True, color=RGBColor(255, 255, 255), size=Pt(9.5))
            else:
                format_runs(p, val, is_title=False, color=RGBColor(30, 41, 59), size=Pt(9))
                
    p_spacer = doc.add_paragraph()
    p_spacer.paragraph_format.space_before = Pt(0)
    p_spacer.paragraph_format.space_after = Pt(6)

def main():
    doc = Document()
    
    # Page setup: Standard A4
    for section in doc.sections:
        section.top_margin = Inches(0.8)
        section.bottom_margin = Inches(0.8)
        section.left_margin = Inches(0.85)
        section.right_margin = Inches(0.85)
        
        # Add footer page number
        footer = section.footer
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        frun = fp.add_run("Enterprise Platform — Cẩm nang Quản trị viên Toàn diện")
        frun.font.name = "Calibri"
        frun.font.size = Pt(8.5)
        frun.font.color.rgb = RGBColor(148, 163, 184)
        
    # Title Cover Header
    title_p = doc.add_paragraph()
    title_p.paragraph_format.space_before = Pt(10)
    title_p.paragraph_format.space_after = Pt(2)
    run_t1 = title_p.add_run("ENTERPRISE PLATFORM\n")
    run_t1.bold = True
    run_t1.font.name = "Calibri"
    run_t1.font.size = Pt(24)
    run_t1.font.color.rgb = RGBColor(15, 23, 42)
    
    run_t2 = title_p.add_run("CẨM NANG HƯỚNG DẪN QUẢN TRỊ VIÊN TOÀN DIỆN")
    run_t2.bold = True
    run_t2.font.name = "Calibri"
    run_t2.font.size = Pt(16)
    run_t2.font.color.rgb = RGBColor(37, 99, 235)
    
    sub_p = doc.add_paragraph()
    sub_p.paragraph_format.space_before = Pt(2)
    sub_p.paragraph_format.space_after = Pt(14)
    srun = sub_p.add_run("Tài liệu bàn giao & Hướng dẫn vận hành chi tiết từ A-Z dành cho Platform Super Admin & Tenant Admin\nKiến trúc: SaaS Modular Monolith | Dedicated Tenant Database | 5 Phân hệ Nghiệp vụ Cốt lõi")
    srun.font.name = "Calibri"
    srun.font.size = Pt(10)
    srun.font.italic = True
    srun.font.color.rgb = RGBColor(71, 85, 105)
    
    # Separator
    p_bdr = doc.add_paragraph()
    p_bdr.paragraph_format.space_before = Pt(0)
    p_bdr.paragraph_format.space_after = Pt(12)
    bdr_xml = parse_xml(f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="12" w:space="1" w:color="2563EB"/></w:pBdr>')
    p_bdr._p.get_or_add_pPr().append(bdr_xml)

    # List of files in required order:
    # 1. Tổng quan (ADMIN_GUIDE.md)
    # 2. Quy trình (PROCEDURE_ENGINE_GUIDE.md)
    # 3. Bảo trì (MAINTENANCE_GUIDE.md)
    # 4. Nhà kho (INVENTORY_GUIDE.md)
    # 5. HRM (HRM_GUIDE.md)
    # 6. Workspace (WORKSPACE_GUIDE.md)
    
    files_order = [
        ("PHẦN I: TỔNG QUAN NỀN TẢNG & QUY MÔ DỰ ÁN", "d:/CRM/enterprise-platform/ADMIN_GUIDE.md"),
        ("PHẦN II: MÔ-ĐUN QUY TRÌNH PHÊ DUYỆT (PROCEDURE ENGINE - PE)", "d:/CRM/enterprise-platform/PROCEDURE_ENGINE_GUIDE.md"),
        ("PHẦN III: MÔ-ĐUN BẢO TRÌ & THIẾT BỊ MÁY MÓC (MAINTENANCE)", "d:/CRM/enterprise-platform/MAINTENANCE_GUIDE.md"),
        ("PHẦN IV: MÔ-ĐUN NHÀ KHO & TÀI SẢN VẬT TƯ (INVENTORY)", "d:/CRM/enterprise-platform/INVENTORY_GUIDE.md"),
        ("PHẦN V: MÔ-ĐUN NHÂN SỰ & TIỀN LƯƠNG (HRM)", "d:/CRM/enterprise-platform/HRM_GUIDE.md"),
        ("PHẦN VI: MÔ-ĐUN KHÔNG GIAN LÀM VIỆC & DỰ ÁN (WORKSPACE)", "d:/CRM/enterprise-platform/WORKSPACE_GUIDE.md"),
    ]
    
    for section_title, file_path in files_order:
        if not os.path.exists(file_path):
            continue
            
        # Section Header Banner
        p_sec = doc.add_paragraph()
        p_sec.paragraph_format.space_before = Pt(20)
        p_sec.paragraph_format.space_after = Pt(8)
        p_sec.paragraph_format.keep_with_next = True
        
        run_sec = p_sec.add_run(section_title.upper())
        run_sec.bold = True
        run_sec.font.name = "Calibri"
        run_sec.font.size = Pt(14)
        run_sec.font.color.rgb = RGBColor(30, 58, 138)
        
        # Border under section header
        sec_bdr = parse_xml(f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="8" w:space="2" w:color="3B82F6"/></w:pBdr>')
        p_sec._p.get_or_add_pPr().append(sec_bdr)
        
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        parse_markdown_to_docx(doc, content)
        
    output_docx = "d:/CRM/enterprise-platform/HUONG_DAN_SU_DUNG_ADMIN_ENTERPRISE_PLATFORM.docx"
    doc.save(output_docx)
    print(f"Successfully generated: {output_docx}")

if __name__ == "__main__":
    main()
