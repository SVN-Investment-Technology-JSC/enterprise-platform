import { PROCEDURE_SOURCE_SUMMARY_LIMITS, isInternalPath, validateProcedureSourceSummary } from './procedure-source-summary.js';

describe('validateProcedureSourceSummary (TC-TSK-01)', () => {
  it('rỗng là không có thông tin nguồn', () => {
    expect(validateProcedureSourceSummary(null)).toEqual({ ok: true, summary: null });
    expect(validateProcedureSourceSummary(undefined)).toEqual({ ok: true, summary: null });
    expect(validateProcedureSourceSummary({ items: [{ label: ' ', value: '' }] })).toEqual({ ok: true, summary: null });
  });

  it('chuẩn hoá: cắt khoảng trắng, bỏ dòng rỗng, giữ đường dẫn nội bộ và nhãn nút', () => {
    const result = validateProcedureSourceSummary({
      title: ' Báo giá BG2600401 v2 ',
      items: [{ label: 'Khách hàng', value: ' Công ty A ' }, { label: '', value: '' }, { label: 'Lý do', value: '<b>Vượt ngưỡng</b>' }],
      url: '/modules/crm#quotes/1',
      urlLabel: 'Mở báo giá trong Bán hàng',
    });
    expect(result).toEqual({
      ok: true,
      summary: {
        title: 'Báo giá BG2600401 v2',
        items: [{ label: 'Khách hàng', value: 'Công ty A' }, { label: 'Lý do', value: '<b>Vượt ngưỡng</b>' }],
        url: '/modules/crm#quotes/1',
        urlLabel: 'Mở báo giá trong Bán hàng',
      },
    });
  });

  it('quá giới hạn: 31 dòng, nhãn 101 ký tự, giá trị 1.001 ký tự, thiếu nhãn', () => {
    const many = Array.from({ length: PROCEDURE_SOURCE_SUMMARY_LIMITS.items + 1 }, (_, index) => ({ label: `Dòng ${index}`, value: 'x' }));
    const result = validateProcedureSourceSummary({ items: [...many, { label: 'x'.repeat(101), value: 'y'.repeat(1001) }, { label: '', value: 'z' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.path)).toEqual(
        expect.arrayContaining(['items', 'items[31].label', 'items[31].value', 'items[32].label']),
      );
      expect(result.errors.find((error) => error.path === 'items')?.message).toBe('Thông tin nguồn tối đa 30 dòng.');
    }
  });

  it('link ngoài, giao thức lạ, `//` bị từ chối; đường dẫn nội bộ nhận', () => {
    for (const url of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/http://evil.example', '/a\\b', `/${'x'.repeat(500)}`]) {
      const result = validateProcedureSourceSummary({ items: [], url });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toMatchObject({ path: 'url' });
    }
    expect(isInternalPath('/modules/crm#quotes/1')).toBe(true);
    expect(isInternalPath('/modules/procedure?returnTo=%2Fmodules%2Fcrm#workspace/1')).toBe(true);
  });

  it('không phải object là lỗi định dạng', () => {
    expect(validateProcedureSourceSummary('x')).toEqual({ ok: false, errors: [{ path: '', message: 'Thông tin nguồn không đúng định dạng.' }] });
    expect(validateProcedureSourceSummary({ items: 'x' }).ok).toBe(false);
  });
});
