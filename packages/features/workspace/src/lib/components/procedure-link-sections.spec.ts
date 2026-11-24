import { DEFAULT_PROCEDURE_LINK_SETTINGS, PROCEDURE_LINK_OPTIONS } from '@enterprise-platform/contracts-workspace';
import { LINK_SECTIONS, changedCount, resetSection, summarizeSection, visibleFields } from './procedure-link-sections';

const allFields = LINK_SECTIONS.flatMap((section) => section.fields);

describe('procedure-link-sections', () => {
  it('phủ đúng mọi khoá cài đặt, mỗi khoá một lần', () => {
    expect(allFields.map((field) => field.key).sort()).toEqual(Object.keys(DEFAULT_PROCEDURE_LINK_SETTINGS).sort());
  });

  it('lựa chọn của từng trường khớp bảng giá trị hợp lệ trong contracts', () => {
    for (const field of allFields) {
      const valid = [...(PROCEDURE_LINK_OPTIONS as Record<string, readonly string[]>)[field.key]].sort();
      expect(field.options.map((option) => option.value).sort()).toEqual(valid);
    }
  });

  it('tóm tắt chỉ gồm cài đặt thường dùng', () => {
    const section = LINK_SECTIONS.find((item) => item.id === 'progress') as (typeof LINK_SECTIONS)[number];
    expect(summarizeSection(section, DEFAULT_PROCEDURE_LINK_SETTINGS)).not.toContain('Tăng và giảm');
  });

  it('ẩn trường vô nghĩa theo lựa chọn hiện tại', () => {
    const progress = LINK_SECTIONS.find((item) => item.id === 'progress') as (typeof LINK_SECTIONS)[number];
    const off = { ...DEFAULT_PROCEDURE_LINK_SETTINGS, progressPull: 'off' as const };
    expect(visibleFields(progress, off).map((field) => field.key)).not.toContain('progressPullClosedItems');
  });

  it('ẩn lựa chọn chờ hồ sơ khi việc cha không tự đóng, hiện lại khi tự đóng', () => {
    const progress = LINK_SECTIONS.find((item) => item.id === 'progress') as (typeof LINK_SECTIONS)[number];
    const none = { ...DEFAULT_PROCEDURE_LINK_SETTINGS, onAllChildrenDone: 'none' as const };
    expect(visibleFields(progress, none).map((field) => field.key)).not.toContain('parentWaitsForProcedure');
    expect(visibleFields(progress, DEFAULT_PROCEDURE_LINK_SETTINGS).map((field) => field.key)).toContain(
      'parentWaitsForProcedure',
    );
  });

  it('tóm tắt phần Tiến độ nêu cách đóng việc cha', () => {
    const progress = LINK_SECTIONS.find((item) => item.id === 'progress') as (typeof LINK_SECTIONS)[number];
    const wait = { ...DEFAULT_PROCEDURE_LINK_SETTINGS, parentWaitsForProcedure: 'wait' as const };
    expect(summarizeSection(progress, wait)).toContain('Chờ hồ sơ quy trình của công việc cha hoàn tất mới đóng');
    expect(changedCount(progress, wait)).toBe(1);
  });

  it('lựa chọn khi hồ sơ cha bị từ chối / hủy chỉ hiện khi cha chờ hồ sơ và tự đóng; ẩn thì không tính khác mặc định', () => {
    const progress = LINK_SECTIONS.find((item) => item.id === 'progress') as (typeof LINK_SECTIONS)[number];
    const keys = (link: typeof DEFAULT_PROCEDURE_LINK_SETTINGS) => visibleFields(progress, link).map((field) => field.key);
    expect(keys(DEFAULT_PROCEDURE_LINK_SETTINGS)).not.toContain('parentProcedureEnded');
    const wait = { ...DEFAULT_PROCEDURE_LINK_SETTINGS, parentWaitsForProcedure: 'wait' as const };
    expect(keys(wait)).toContain('parentProcedureEnded');
    expect(keys({ ...wait, onAllChildrenDone: 'none' as const })).not.toContain('parentProcedureEnded');
    const stored = { ...DEFAULT_PROCEDURE_LINK_SETTINGS, parentProcedureEnded: 'stop_waiting' as const };
    expect(changedCount(progress, stored)).toBe(0);
    expect(summarizeSection(progress, stored)).not.toContain('Thôi chờ');
    expect(changedCount(progress, { ...wait, parentProcedureEnded: 'stop_waiting' as const })).toBe(2);
    expect(summarizeSection(progress, { ...wait, parentProcedureEnded: 'stop_waiting' as const })).toContain('Thôi chờ');
  });

  it('khôi phục phần về mặc định', () => {
    const section = LINK_SECTIONS.find((item) => item.id === 'start') as (typeof LINK_SECTIONS)[number];
    const edited = { ...DEFAULT_PROCEDURE_LINK_SETTINGS, onStarted: 'in_progress' as const };
    expect(changedCount(section, edited)).toBe(1);
    expect(resetSection(section, edited)).toEqual(DEFAULT_PROCEDURE_LINK_SETTINGS);
  });
});
