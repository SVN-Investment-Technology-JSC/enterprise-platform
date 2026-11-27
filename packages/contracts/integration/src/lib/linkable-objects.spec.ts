import {
  LINKABLE_FILTER_MAX,
  LINKABLE_FORM_MAX_FIELDS,
  parseLinkableCreateRequest,
  sanitizeLinkableCreateForm,
  sanitizeLinkableCreatePreview,
  sanitizeLinkableSearchFilters,
} from './linkable-objects.js';

describe('sanitizeLinkableCreateForm', () => {
  const form = {
    kind: 'crm.contract',
    title: 'Tạo hợp đồng bán',
    subtitle: 'Dòng hàng nhập sau',
    fields: [
      { key: 'type', label: 'Loại', type: 'select', required: true, defaultValue: 'SALE', options: [{ value: 'SALE', label: 'Mua bán' }, { value: '', label: 'x' }] },
      { key: 'customerId', label: 'Khách hàng', type: 'reference', reference: 'crm.customer', required: true },
      { key: 'title', label: 'Tên', type: 'text', maxLength: 300, required: 'yes' },
      { key: 'value', label: 'Giá trị', type: 'money', min: 0, defaultValue: '12' },
      { key: 'validFrom', label: 'Hiệu lực từ', type: 'date', defaultValue: '2026-11-27' },
    ],
  };

  it('giữ ô hợp lệ đúng thứ tự, chỉ nhận cờ đúng kiểu', () => {
    const result = sanitizeLinkableCreateForm(form, 'crm.contract');
    expect(result?.title).toBe('Tạo hợp đồng bán');
    expect(result?.fields.map((field) => field.key)).toEqual(['type', 'customerId', 'title', 'value', 'validFrom']);
    // Lựa chọn rỗng bị bỏ; `required` phải đúng `true`; mặc định của ô tiền phải là số.
    expect(result?.fields[0].options).toEqual([{ value: 'SALE', label: 'Mua bán', hint: undefined }]);
    expect(result?.fields[2].required).toBeUndefined();
    expect(result?.fields[2].maxLength).toBe(300);
    expect(result?.fields[3].defaultValue).toBeUndefined();
    expect(result?.fields[4].defaultValue).toBe('2026-11-27');
  });

  it('ô tham chiếu chỉ trỏ được tới loại cùng module', () => {
    const result = sanitizeLinkableCreateForm(
      {
        ...form,
        fields: [
          { key: 'a', label: 'A', type: 'reference', reference: 'finance.voucher' },
          { key: 'b', label: 'B', type: 'reference' },
          { key: 'c', label: 'C', type: 'reference', reference: 'crm.customer' },
        ],
      },
      'crm.contract',
    );
    expect(result?.fields.map((field) => field.key)).toEqual(['c']);
  });

  it('bỏ kiểu lạ, khoá sai, khoá trùng; cắt ở số ô tối đa', () => {
    const many = Array.from({ length: LINKABLE_FORM_MAX_FIELDS + 5 }, (_, index) => ({
      key: `f${index}`,
      label: `Ô ${index}`,
      type: 'text',
    }));
    const result = sanitizeLinkableCreateForm(
      {
        ...form,
        fields: [
          { key: 'x', label: 'X', type: 'file' },
          { key: '1bad', label: 'Sai', type: 'text' },
          { key: 'name', label: 'Tên', type: 'text' },
          { key: 'name', label: 'Tên 2', type: 'textarea' },
          ...many,
        ],
      },
      'crm.contract',
    );
    expect(result?.fields[0]).toMatchObject({ key: 'name', label: 'Tên', type: 'text' });
    expect(result?.fields).toHaveLength(LINKABLE_FORM_MAX_FIELDS);
  });

  it('sai loại, thiếu tiêu đề hay không còn ô nào thì không nhận', () => {
    expect(sanitizeLinkableCreateForm(form, 'crm.customer')).toBeUndefined();
    expect(sanitizeLinkableCreateForm({ ...form, title: ' ' }, 'crm.contract')).toBeUndefined();
    expect(sanitizeLinkableCreateForm({ ...form, fields: [{ key: 'a', type: 'text' }] }, 'crm.contract')).toBeUndefined();
    expect(sanitizeLinkableCreateForm('x', 'crm.contract')).toBeUndefined();
  });
});

describe('parseLinkableCreateRequest', () => {
  it('chỉ nhận chuỗi, số hữu hạn và null; chuỗi rỗng thành null', () => {
    expect(
      parseLinkableCreateRequest({
        values: { name: '  Công ty A ', note: '   ', value: 1200, bad: Number.NaN, nested: { a: 1 }, flag: true, gone: null, '1x': 'a' },
        confirm: true,
      }),
    ).toEqual({ values: { name: 'Công ty A', note: null, value: 1200, gone: null }, confirm: true });
  });

  it('thân sai hình dạng là form trống, `confirm` phải đúng `true`', () => {
    expect(parseLinkableCreateRequest(undefined)).toEqual({ values: {} });
    expect(parseLinkableCreateRequest({ values: [1, 2], confirm: 'true' })).toEqual({ values: {} });
  });

  it('cắt chuỗi quá dài', () => {
    const parsed = parseLinkableCreateRequest({ values: { note: 'a'.repeat(5000) } });
    expect(String(parsed.values['note'])).toHaveLength(4000);
  });
});

describe('ô tham chiếu có lọc, bắt buộc có điều kiện, xem trước', () => {
  const base = { kind: 'crm.contract', title: 'Lập hợp đồng' };

  it('giữ bộ lọc hợp lệ; bỏ tham số chung, trùng, trỏ vào chính ô, trỏ tới ô không có, có cả hai nguồn', () => {
    const result = sanitizeLinkableCreateForm(
      {
        ...base,
        fields: [
          { key: 'customerId', label: 'Khách hàng', type: 'reference', reference: 'crm.customer', requiredUnless: 'quoteId', required: false },
          {
            key: 'quoteId',
            label: 'Báo giá',
            type: 'reference',
            reference: 'crm.quote',
            preview: true,
            filters: [
              { param: 'contractLinkable', value: 'true' },
              { param: 'customerId', fromField: 'customerId' },
              { param: 'customerId', value: 'x' },
              { param: 'kind', value: 'crm.contract' },
              { param: 'self', fromField: 'quoteId' },
              { param: 'ghost', fromField: 'missing' },
              { param: 'both', fromField: 'customerId', value: 'x' },
              { param: 'bad-name', value: 'x' },
              { param: 'empty' },
            ],
          },
          { key: 'title', label: 'Tên', type: 'text', preview: true, requiredUnless: 'missing', filters: [{ param: 'a', value: 'b' }] },
        ],
      },
      'crm.contract',
    );
    const [customer, quote, title] = result?.fields ?? [];
    expect(customer.requiredUnless).toBe('quoteId');
    expect(quote.preview).toBe(true);
    expect(quote.filters).toEqual([
      { param: 'contractLinkable', value: 'true' },
      { param: 'customerId', fromField: 'customerId' },
    ]);
    // Ô chữ không có xem trước hay bộ lọc; `requiredUnless` trỏ tới ô không có thì bỏ.
    expect(title.preview).toBeUndefined();
    expect(title.filters).toBeUndefined();
    expect(title.requiredUnless).toBeUndefined();
  });

  it('`requiredUnless` bị bỏ khi ô đã `required`', () => {
    const result = sanitizeLinkableCreateForm(
      { ...base, fields: [{ key: 'a', label: 'A', type: 'text', required: true, requiredUnless: 'b' }, { key: 'b', label: 'B', type: 'text' }] },
      'crm.contract',
    );
    expect(result?.fields[0]).toMatchObject({ required: true, requiredUnless: undefined });
  });

  it('tham số lọc từ bên gọi: chỉ tên hợp lệ, không tham số chung, giá trị chuỗi đã cắt, có trần', () => {
    expect(
      sanitizeLinkableSearchFilters({
        customerId: ' k-1 ',
        contractLinkable: true,
        page: 2,
        q: 'x',
        limit: '5',
        'a.b': 'x',
        empty: '  ',
        nested: { a: 1 },
        long: 'x'.repeat(500),
      }),
    ).toEqual({ customerId: 'k-1', contractLinkable: 'true', page: '2', long: 'x'.repeat(160) });
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`p${index}`, 'v']));
    expect(Object.keys(sanitizeLinkableSearchFilters(many))).toHaveLength(LINKABLE_FILTER_MAX);
    expect(sanitizeLinkableSearchFilters('x')).toEqual({});
  });

  it('bản xem trước: cột theo kiểu, ô theo kiểu cột, fill chỉ khoá hợp lệ và không phải chính ô', () => {
    const preview = sanitizeLinkableCreatePreview(
      {
        field: 'khác',
        title: 'Dòng hàng từ báo giá BG-1',
        note: 'Hợp đồng nhận 1 dòng.',
        columns: [
          { key: 'name', label: 'Mặt hàng', type: 'text' },
          { key: 'amount', label: 'Thành tiền', type: 'money' },
          { key: 'amount', label: 'Trùng', type: 'text' },
          { key: 'x', label: 'Lạ', type: 'html' },
        ],
        rows: [{ name: 'Tủ điện', amount: '12', extra: 'bỏ' }, { name: 5, amount: 1000 }, 'x'],
        fill: { customerId: { value: 'k-1', label: 'KH001 — Công ty A' }, quoteId: { value: 'q-2' }, '1x': { value: 'a' }, title: { value: ' ' } },
      },
      'quoteId',
      'q-1',
    );
    expect(preview).toEqual({
      field: 'quoteId',
      value: 'q-1',
      title: 'Dòng hàng từ báo giá BG-1',
      note: 'Hợp đồng nhận 1 dòng.',
      columns: [
        { key: 'name', label: 'Mặt hàng', type: 'text' },
        { key: 'amount', label: 'Thành tiền', type: 'money' },
      ],
      rows: [
        { name: 'Tủ điện', amount: null },
        { name: '5', amount: 1000 },
      ],
      fill: { customerId: { value: 'k-1', label: 'KH001 — Công ty A' } },
    });
    expect(sanitizeLinkableCreatePreview([], 'quoteId', 'q-1')).toBeUndefined();
  });
});
