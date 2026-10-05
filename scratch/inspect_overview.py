import openpyxl

wb = openpyxl.load_workbook(r'C:\Users\This PC\Downloads\TEST_2026_09_07.xlsx', data_only=False)
ws1 = wb['Tổng quan & Tài khoản']

print('--- Formulas in WS1 ---')
for r in range(5, 11):
    c = ws1[f'C{r}']
    print(f'C{r}: value={c.value}, num_format={c.number_format}')

for r in range(1, 35):
    items = []
    for col in ['B', 'C', 'D', 'E', 'F', 'G']:
        val = ws1[f'{col}{r}'].value
        if val is not None:
            items.append(f'{col}{r}: {val!r}')
    if items:
        print(f'Row {r}: ' + ' | '.join(items))
