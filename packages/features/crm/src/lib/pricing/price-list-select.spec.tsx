/**
 * @jest-environment jsdom
 */
import type { PriceListSummary } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NO_PRICE_LISTS_TEXT, PriceListSelect, priceListOptions, todayInVietnam } from './price-list-select';

jest.mock('../crm-api', () => ({ listPriceLists: jest.fn().mockResolvedValue([]) }));

// jsdom không có `scrollIntoView` (ô chọn cuộn tới mục đang chọn khi gõ tìm).
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

const list = (id: string, patch: Partial<PriceListSummary> = {}): PriceListSummary => ({
  id,
  code: id.toUpperCase(),
  name: `Bảng ${id}`,
  listType: 'DERIVED',
  ratioPercent: 100,
  isStandard: false,
  currency: 'VND',
  validFrom: '2026-01-01',
  validTo: null,
  status: 'ACTIVE',
  note: null,
  itemCount: 1,
  usageCount: 0,
  updatedAt: '2026-01-01T00:00:00Z',
  ...patch,
});

const LISTS = [
  list('md', { code: 'BG-MAC-DINH', name: 'Bảng giá mặc định', listType: 'DEFAULT', ratioPercent: null }),
  list('105', { code: 'BG-105', name: 'Bảng giá 105', ratioPercent: 105 }),
  list('dl', { code: 'BG-DL', name: 'Bảng giá đại lý', ratioPercent: 90 }),
  list('tat', { code: 'BG-TAT', name: 'Bảng giá đã tắt', status: 'INACTIVE' }),
  list('het', { code: 'BG-HET', name: 'Bảng giá hết hạn', validTo: '2026-06-30' }),
  list('sau', { code: 'BG-SAU', name: 'Bảng giá năm sau', validFrom: '2027-01-01' }),
];

const shownOptions = () => within(screen.getByRole('listbox')).queryAllByRole('option').map((item) => item.textContent ?? '');

function open(text = '') {
  render(<PriceListSelect lists={LISTS} date="2026-11-01" value="" onChange={jest.fn()} />);
  const input = screen.getByRole('textbox');
  fireEvent.click(input);
  if (text) fireEvent.change(input, { target: { value: text } });
}

describe('Ô chọn bảng giá (C4.3, C4.4)', () => {
  it('C4.4: chỉ có bảng đang bật, còn hiệu lực tại ngày tính giá', () => {
    open();
    const shown = shownOptions().join(' | ');
    expect(shown).toContain('Bảng giá mặc định');
    expect(shown).toContain('Bảng giá 105');
    expect(shown).not.toContain('đã tắt');
    expect(shown).not.toContain('hết hạn');
    expect(shown).not.toContain('năm sau');
  });

  it('C4.3: gõ không dấu "bang gia 105" ra BG-105', () => {
    open('bang gia 105');
    const shown = shownOptions();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('BG-105');
  });

  it('C4.3: tìm theo mã', () => {
    open('bg-dl');
    const shown = shownOptions();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('Bảng giá đại lý');
  });

  it('C4.5: không có bảng nào thì ô nhắc liên hệ quản trị CRM', () => {
    render(<PriceListSelect lists={[]} date="2026-11-01" value="" onChange={jest.fn()} />);
    expect(screen.getByPlaceholderText(NO_PRICE_LISTS_TEXT)).toBeTruthy();
  });

  it('bảng đang gắn mà đã tắt vẫn có mặt, kèm "(Ngừng áp dụng)"', () => {
    const options = priceListOptions(LISTS, '2026-11-01', { id: 'tat', code: 'BG-TAT', name: 'Bảng giá đã tắt', status: 'INACTIVE' });
    expect(options.at(-1)).toEqual({ value: 'tat', label: 'Bảng giá đã tắt (Ngừng áp dụng)', description: 'BG-TAT' });
  });

  it('ngày tính giá mặc định theo giờ Việt Nam', () => {
    expect(todayInVietnam(new Date('2026-11-17T18:30:00Z'))).toBe('2026-11-18');
  });
});
