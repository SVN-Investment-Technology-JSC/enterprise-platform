import { DEFAULT_PALETTE, DEFAULT_RULES } from '@enterprise-platform/shared-brand-icon';
import { SETTINGS_VERSION, parseSettings, serializeSettings, settingsFileName } from './settings-io';

describe('serializeSettings và parseSettings', () => {
  it('xuất rồi nhập lại cho ra đúng bảng màu và quy chuẩn', () => {
    const palette = { tokens: [{ key: 'xanh', label: 'Xanh', hex: '#112233' }, { key: 'do', label: 'Đỏ', hex: '#aa0000' }] };
    const rules = { ...DEFAULT_RULES, snapStep: 1, maxShapes: 9, requirePaletteColors: false, allowedStrokeWidths: [2] };

    const text = serializeSettings(palette, rules);
    expect(JSON.parse(text).version).toBe(SETTINGS_VERSION);

    const parsed = parseSettings(text);
    expect(parsed.palette).toEqual(palette);
    expect(parsed.rules).toEqual(rules);
    expect(parsed.skippedColors).toBe(0);
  });

  it('xuất bảng màu và quy chuẩn mặc định rồi nhập lại không bị coi là lỗi', () => {
    const parsed = parseSettings(serializeSettings(DEFAULT_PALETTE, DEFAULT_RULES));
    expect(parsed.palette?.tokens).toEqual(DEFAULT_PALETTE.tokens);
    expect(parsed.rules).toEqual(DEFAULT_RULES);
  });

  it('nhận tệp chỉ có bảng màu (kể cả dạng { tokens }) hoặc chỉ có quy chuẩn', () => {
    const onlyPalette = parseSettings(JSON.stringify({ palette: { tokens: [{ key: 'a', label: 'A', hex: '#000' }] } }));
    expect(onlyPalette.palette?.tokens[0].hex).toBe('#000000');
    expect(onlyPalette.rules).toBeUndefined();

    const bare = parseSettings(JSON.stringify({ tokens: [{ key: 'b', label: 'B', hex: '#fff' }] }));
    expect(bare.palette?.tokens[0].key).toBe('b');

    const onlyRules = parseSettings(JSON.stringify({ rules: { snapStep: 2 } }));
    expect(onlyRules.palette).toBeUndefined();
    expect(onlyRules.rules?.snapStep).toBe(2);
    expect(onlyRules.rules?.maxShapes).toBe(DEFAULT_RULES.maxShapes);
  });

  it('chuẩn hoá giá trị: kẹp số, bỏ màu sai mã hoặc trùng khoá và đếm số màu bị bỏ', () => {
    const parsed = parseSettings(
      JSON.stringify({
        palette: {
          tokens: [
            { key: 'a', label: 'A', hex: '#abc' },
            { key: 'a', label: 'Trùng khoá', hex: '#111111' },
            { key: 'b', label: 'Sai mã', hex: 'xanh' },
            'không phải đối tượng',
          ],
        },
        rules: { snapStep: 99, allowedStrokeWidths: [100, 2] },
      }),
    );
    expect(parsed.palette?.tokens).toEqual([{ key: 'a', label: 'A', hex: '#aabbcc' }]);
    expect(parsed.skippedColors).toBe(3);
    expect(parsed.rules?.snapStep).toBe(4);
    expect(parsed.rules?.allowedStrokeWidths).toEqual([2]);
  });

  it('báo lỗi tiếng Việt khi tệp không dùng được', () => {
    expect(() => parseSettings('{ hỏng')).toThrow('Tệp không phải JSON hợp lệ.');
    expect(() => parseSettings('[1, 2]')).toThrow('Tệp không phải cài đặt Brand Studio.');
    expect(() => parseSettings('"chuoi"')).toThrow('Tệp không phải cài đặt Brand Studio.');
    expect(() => parseSettings('{}')).toThrow('Tệp không có bảng màu hay quy chuẩn.');
    expect(() => parseSettings(JSON.stringify({ palette: { tokens: [] } }))).toThrow('Bảng màu trong tệp không hợp lệ.');
    expect(() => parseSettings(JSON.stringify({ palette: 'xanh' }))).toThrow('Bảng màu trong tệp không hợp lệ.');
    expect(() => parseSettings(JSON.stringify({ rules: 5 }))).toThrow('Quy chuẩn trong tệp không hợp lệ.');
  });

  it('tên tệp xuất cố định', () => {
    expect(settingsFileName()).toBe('svndts-brand-settings.json');
  });
});
