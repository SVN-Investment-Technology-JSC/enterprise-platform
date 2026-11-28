import { FINANCE_KIND_CONFIG } from './finance-kinds';
import {
  loadVoucherCellMode,
  loadVoucherColumnOrder,
  loadVoucherColumnWidths,
  moveVoucherColumn,
  orderVoucherColumns,
  saveVoucherCellMode,
  saveVoucherColumnOrder,
  saveVoucherColumnWidths,
  visibleVoucherColumns,
  voucherColumnCatalog,
  voucherColumnSelection,
  voucherColumnWidths,
} from './voucher-list-columns';

describe('cột hiển thị danh sách phiếu', () => {
  const payment = voucherColumnCatalog('PAYMENT', FINANCE_KIND_CONFIG.PAYMENT);

  it('chưa chọn thì dùng bộ mặc định (số tiền, trạng thái đứng sớm; Người tạo cuối); người nhận tiền và dự án là cột thêm', () => {
    const keys = visibleVoucherColumns(payment, null).map((c) => c.key);
    expect(keys).toEqual(['code', 'date', 'content', 'reason', 'amount', 'status', 'account', 'counterparty', 'allocation', 'created-by']);
    expect(payment.find((c) => c.key === 'person')?.label).toBe('Người nhận tiền');
    expect(payment.find((c) => c.key === 'created-by')?.label).toBe('Người tạo');
  });

  it('cột "creator" cũ (chỉ avatar) không còn: mã đã lưu bị bỏ qua', () => {
    expect(payment.map((c) => c.key)).not.toContain('creator');
    expect(visibleVoucherColumns(payment, ['creator', 'code', 'amount']).map((c) => c.key)).toEqual(['code', 'amount', 'created-by']);
  });

  it('chỉ chọn dự án và số tiền: vẫn giữ mã phiếu, theo thứ tự của bảng, bỏ mã lạ; cột thêm sau vẫn hiện', () => {
    const keys = visibleVoucherColumns(payment, ['amount', 'project', 'khong-co']).map((c) => c.key);
    expect(keys).toEqual(['code', 'amount', 'project', 'created-by']);
  });

  it('cột thêm sau: bỏ chọn thì lưu dấu ẩn no-<mã> để không tự hiện lại; chọn lại thì bỏ dấu ẩn', () => {
    const visible = new Set(['code', 'project', 'amount']);
    const saved = voucherColumnSelection(payment, visible);
    expect(saved).toEqual(['code', 'amount', 'project', 'no-created-by']);
    expect(saved.every((key) => /^[a-z][a-z0-9-]{0,39}$/.test(key))).toBe(true); // đúng dạng mã máy chủ nhận
    expect(visibleVoucherColumns(payment, saved).map((c) => c.key)).toEqual(['code', 'amount', 'project']);
    const again = voucherColumnSelection(payment, new Set([...visible, 'created-by']));
    expect(again).toEqual(['code', 'amount', 'project', 'created-by']);
    expect(visibleVoucherColumns(payment, again).map((c) => c.key)).toContain('created-by');
  });

  it('mọi cột đều sắp xếp được, theo mã máy chủ nhận', () => {
    expect(payment.every((c) => Boolean(c.sortKey))).toBe(true);
    expect(payment.find((c) => c.key === 'date')?.sortKey).toBe('voucher-date');
    expect(payment.find((c) => c.key === 'project')?.sortKey).toBe('allocation');
  });

  it('bề ngang theo px: mặc định của cột, bề ngang đã kéo thì dùng (không nhỏ hơn mức tối thiểu), giá trị hỏng bị bỏ', () => {
    const shown = visibleVoucherColumns(payment, ['project', 'amount']);
    expect(voucherColumnWidths(shown)).toEqual({ code: 168, amount: 124, project: 220, 'created-by': 170 });
    // Đủ rộng để mã nháp dài nhất nằm trên một dòng.
    expect(payment.find((c) => c.key === 'code')?.width ?? 0).toBeGreaterThanOrEqual(160);
    expect(voucherColumnWidths(shown, { amount: 200, project: 10, code: Number.NaN })).toMatchObject({ code: 168, amount: 200, project: 100 });
  });

  it('lệnh chuyển tiền không có cột lý do, đối tượng, dự án', () => {
    const keys = voucherColumnCatalog('TRANSFER', FINANCE_KIND_CONFIG.TRANSFER).map((c) => c.key);
    expect(keys).toContain('accounts');
    expect(keys).toContain('created-by');
    for (const key of ['reason', 'counterparty', 'project', 'person']) expect(keys).not.toContain(key);
  });
});

describe('bề ngang cột đã kéo (nhớ trên trình duyệt theo loại phiếu)', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('lưu, đọc lại theo từng loại phiếu, xoá thì về mặc định; dữ liệu hỏng hoặc chặn lưu trữ thì không lỗi', () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fake });
    saveVoucherColumnWidths('PAYMENT', { amount: 200 });
    expect(loadVoucherColumnWidths('PAYMENT')).toEqual({ amount: 200 });
    expect(loadVoucherColumnWidths('RECEIPT')).toEqual({});
    saveVoucherColumnWidths('PAYMENT', null);
    expect(loadVoucherColumnWidths('PAYMENT')).toEqual({});
    store.set('finance.voucher-list.widths.PAYMENT', '{hỏng');
    expect(loadVoucherColumnWidths('PAYMENT')).toEqual({});
    store.set('finance.voucher-list.widths.PAYMENT', JSON.stringify({ amount: 'rộng', code: 150 }));
    expect(loadVoucherColumnWidths('PAYMENT')).toEqual({ code: 150 });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('chặn');
        },
        setItem: () => {
          throw new Error('chặn');
        },
      },
    });
    expect(loadVoucherColumnWidths('PAYMENT')).toEqual({});
    expect(() => saveVoucherColumnWidths('PAYMENT', { amount: 1 })).not.toThrow();
  });
});

describe('cách hiện chữ trong ô (nhớ trên trình duyệt)', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('mặc định xuống dòng; lưu và đọc lại lựa chọn gọn một dòng', () => {
    const store = new Map<string, string>();
    const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fake });
    expect(loadVoucherCellMode()).toBe('wrap');
    saveVoucherCellMode('compact');
    expect(loadVoucherCellMode()).toBe('compact');
  });

  it('trình duyệt chặn lưu trữ thì không lỗi, dùng mặc định', () => {
    const broken = {
      getItem: () => {
        throw new Error('chặn');
      },
      setItem: () => {
        throw new Error('chặn');
      },
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: broken });
    expect(loadVoucherCellMode()).toBe('wrap');
    expect(() => saveVoucherCellMode('compact')).not.toThrow();
  });
});

describe('thứ tự cột kéo thả (nhớ trên trình duyệt theo loại phiếu)', () => {
  const cols = ['code', 'date', 'content', 'amount', 'status'].map((key) => ({ key }));
  const keys = (list: readonly { key: string }[]) => list.map((column) => column.key);

  afterEach(() => localStorage.clear());

  it('chưa kéo thì giữ thứ tự mặc định; kéo rồi thì theo đúng thứ tự đã lưu', () => {
    expect(keys(orderVoucherColumns(cols, []))).toEqual(['code', 'date', 'content', 'amount', 'status']);
    expect(keys(orderVoucherColumns(cols, ['amount', 'code', 'date', 'content', 'status']))).toEqual([
      'amount',
      'code',
      'date',
      'content',
      'status',
    ]);
  });

  it('cột mới bật (chưa có trong thứ tự đã lưu) đứng ngay sau cột trước nó ở thứ tự mặc định; mã lạ bị bỏ', () => {
    expect(keys(orderVoucherColumns(cols, ['status', 'code', 'content', 'gone']))).toEqual([
      'status',
      'code',
      'date',
      'content',
      'amount',
    ]);
  });

  it('thả cột lên cột khác thì cột kéo đứng vào chỗ cột được thả', () => {
    expect(moveVoucherColumn(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveVoucherColumn(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveVoucherColumn(['a', 'b'], 'a', 'x')).toEqual(['a', 'b']);
  });

  it('lưu và đọc lại theo loại phiếu; null thì xoá', () => {
    saveVoucherColumnOrder('PAYMENT', ['amount', 'code']);
    expect(loadVoucherColumnOrder('PAYMENT')).toEqual(['amount', 'code']);
    expect(loadVoucherColumnOrder('RECEIPT')).toEqual([]);
    saveVoucherColumnOrder('PAYMENT', null);
    expect(loadVoucherColumnOrder('PAYMENT')).toEqual([]);
  });
});
