import openpyxl

wb = openpyxl.load_workbook(r'C:\Users\This PC\Downloads\TEST_2026_09_07.xlsx')
ws1 = wb['Tổng quan & Tài khoản']
ws2 = wb['Kịch bản kiểm thử (Test Cases)']

print('=== WS1 (Tổng quan) ===')
for r in [2, 3, 5, 6, 12, 13, 22, 23, 24]:
    c = ws1[f'B{r}']
    font_color = getattr(getattr(c.font, 'color', None), 'rgb', None)
    fill_color = getattr(getattr(c.fill, 'fgColor', None), 'rgb', None)
    print(f'B{r}: val={c.value!r}, font={c.font.name}, size={c.font.size}, bold={c.font.bold}, color={font_color}, fill={fill_color}')

print('\n=== WS2 (Test cases) ===')
for r in [2, 3, 4, 5, 6, 7, 8]:
    cb = ws2[f'B{r}']
    cc = ws2[f'C{r}']
    fb = getattr(getattr(cb.fill, 'fgColor', None), 'rgb', None)
    fc = getattr(getattr(cc.fill, 'fgColor', None), 'rgb', None)
    font_color_c = getattr(getattr(cc.font, 'color', None), 'rgb', None)
    print(f'Row {r} B: val={cb.value!r}, fill={fb}')
    print(f'Row {r} C: val={cc.value!r}, font={cc.font.name}, size={cc.font.size}, bold={cc.font.bold}, color={font_color_c}, fill={fc}')

print('\n=== WS2 Column Widths ===')
for col_letter in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']:
    print(f'Col {col_letter}: {ws2.column_dimensions[col_letter].width}')

print('\n=== WS1 Column Widths ===')
for col_letter in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']:
    print(f'Col {col_letter}: {ws1.column_dimensions[col_letter].width}')
