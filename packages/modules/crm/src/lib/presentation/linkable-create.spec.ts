import { CRM_NO_CAPABILITIES, type Pipeline } from '@enterprise-platform/contracts-crm';
import { LINKABLE_CONFIRM_REQUIRED, sanitizeLinkableCreateForm, sanitizeLinkableCreatePreview } from '@enterprise-platform/contracts-integration';
import type { HttpException } from '@nestjs/common';
import type { CrmActor } from '../application/crm-actor.js';
import { CrmConflictError, CrmForbiddenError } from '../domain/crm.error.js';
import {
  contractCreateForm,
  contractQuotePreview,
  contractRequest,
  customerCreateForm,
  customerRequest,
  opportunityCreateForm,
  opportunityRequest,
  withCreateFlags,
} from './linkable-create.js';
import { LinkableController } from './linkable.controller.js';
import { CRM_LINKABLE_KIND_LIST } from './linkable.mapper.js';

const WRITER: CrmActor = {
  ...CRM_NO_CAPABILITIES,
  canWriteOpportunity: true,
  canWriteContract: true,
  tenantId: 't1',
  userId: 'u1',
  displayName: 'Lan',
};
const READER: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: 't1', userId: 'u2', displayName: 'Minh' };
const PEOPLE = [{ userId: 'u1', displayName: 'Lan' }];

const customerDetail = {
  id: 'k-9',
  code: 'KH009',
  name: 'Công ty B',
  taxCode: '0101234567',
  province: 'Hà Nội',
  kindName: 'Khách tiềm năng',
  groupName: null,
  address: null,
  primaryContactName: null,
};
const contractDetail = {
  id: 'c-9',
  code: 'HD-009',
  type: 'SALE',
  title: 'Hợp đồng giấy',
  customerId: 'k-9',
  customerCode: 'KH009',
  customerName: 'Công ty B',
  status: 'DRAFT',
  validFrom: '2026-11-01',
  validTo: null,
  value: 110_000_000,
  ownerUserId: 'u1',
  quoteId: null,
  quoteCode: null,
  signedDate: '2026-10-30',
  warrantyMonths: 12,
  updatedAt: '2026-11-27T00:00:00.000Z',
};

function setup() {
  const customers = { create: jest.fn().mockResolvedValue(customerDetail) };
  const contracts = { create: jest.fn().mockResolvedValue(contractDetail), quotePreview: jest.fn() };
  const quotes = {
    list: jest.fn().mockResolvedValue({ items: [] }),
    get: jest.fn().mockResolvedValue({ id: 'q-1', opportunityId: 'o-1', opportunityName: 'Tủ điện nhà máy B' }),
  };
  const opportunities = {
    create: jest.fn().mockResolvedValue({
      id: 'o-9',
      name: 'Tủ điện nhà máy B',
      customerId: 'k-9',
      customerCode: 'KH009',
      customerName: 'Công ty B',
      stage: 'NEW',
      stageInfo: { name: 'Mới' },
      pipeline: { name: 'Mặc định' },
      probability: 10,
      expectedValue: null,
      expectedCloseDate: null,
    }),
    listPipelines: jest.fn().mockResolvedValue([]),
  };
  const people = { list: jest.fn().mockResolvedValue(PEOPLE) };
  const groups = { list: jest.fn().mockResolvedValue([{ id: 'g1', code: 'VIP', name: 'Khách VIP' }]) };
  const kinds = { list: jest.fn().mockResolvedValue([{ code: 'LEAD_CUSTOMER', name: 'Khách tiềm năng' }]) };
  const unused = {} as never;
  const controller = new LinkableController(
    customers as never,
    opportunities as never,
    quotes as never,
    contracts as never,
    unused,
    unused,
    unused,
    unused,
    people as never,
    groups as never,
    kinds as never,
  );
  return { controller, customers, contracts, opportunities, quotes, people, groups, kinds };
}

describe('Tạo nhanh hồ sơ Bán hàng: form', () => {
  it('cờ create theo quyền ghi của người hỏi; loại khác giữ nguyên', () => {
    const flagged = withCreateFlags(CRM_LINKABLE_KIND_LIST, { canWriteOpportunity: true, canWriteContract: false });
    expect(flagged.filter((kind) => kind.create).map((kind) => kind.key)).toEqual(['crm.opportunity', 'crm.customer']);
    expect(withCreateFlags(CRM_LINKABLE_KIND_LIST, undefined).some((kind) => kind.create)).toBe(false);
    // Danh sách gốc không bị sửa.
    expect(CRM_LINKABLE_KIND_LIST.some((kind) => 'create' in kind)).toBe(false);
  });

  it('form khách hàng cùng ô với form "Thêm khách hàng", qua được bộ đọc chung', () => {
    const form = customerCreateForm({
      people: PEOPLE,
      groups: [{ id: 'g1', code: 'VIP', name: 'Khách VIP', description: null, customerCount: 0 }],
      kinds: [{ code: 'LEAD_CUSTOMER', name: 'Khách tiềm năng', description: null, isSystem: true, sortOrder: 1, customerCount: 0 }],
    });
    const parsed = sanitizeLinkableCreateForm(form, 'crm.customer');
    expect(parsed?.fields.map((field) => field.key)).toEqual([
      'code', 'name', 'taxCode', 'kind', 'groupId', 'ownerUserId', 'province', 'region', 'industry', 'phone', 'email',
      'creditLimit', 'paymentTermDays', 'address', 'note',
    ]);
    expect(parsed?.fields.find((field) => field.key === 'kind')?.defaultValue).toBe('LEAD_CUSTOMER');
    expect(parsed?.fields.filter((field) => field.required).map((field) => field.key)).toEqual(['name', 'kind']);
  });

  it('form hợp đồng: khách là ô tham chiếu crm.customer, giá trị ghi rõ gồm VAT', () => {
    const parsed = sanitizeLinkableCreateForm(contractCreateForm({ people: PEOPLE }), 'crm.contract');
    expect(parsed?.fields.find((field) => field.key === 'customerId')).toMatchObject({ type: 'reference', reference: 'crm.customer', requiredUnless: 'quoteId' });
    expect(parsed?.fields.find((field) => field.key === 'value')?.label).toContain('gồm VAT');
    expect(parsed?.fields.filter((field) => field.required).map((field) => field.key)).toEqual(['type', 'title', 'validFrom']);
  });

  it('form hợp đồng: ô "Báo giá" như form gốc (lọc gắn được theo khách, có xem trước); khách bắt buộc trừ khi chọn báo giá', () => {
    const parsed = sanitizeLinkableCreateForm(contractCreateForm({ people: PEOPLE }), 'crm.contract');
    expect(parsed?.fields.map((field) => field.key).slice(0, 4)).toEqual(['type', 'customerId', 'quoteId', 'title']);
    expect(parsed?.fields.find((field) => field.key === 'customerId')?.requiredUnless).toBe('quoteId');
    expect(parsed?.fields.find((field) => field.key === 'quoteId')).toMatchObject({
      type: 'reference',
      reference: 'crm.quote',
      preview: true,
      filters: [
        { param: 'contractLinkable', value: 'true' },
        { param: 'customerId', fromField: 'customerId' },
      ],
    });
    expect(parsed?.fields.find((field) => field.key === 'quoteId')?.required).toBeUndefined();
  });

  it('form cơ hội chỉ hỏi luồng khi có hơn một luồng đang bật', () => {
    const pipeline = (id: string, isDefault: boolean, active = true) => ({ id, name: id, isDefault, active }) as unknown as Pipeline;
    expect(opportunityCreateForm({ people: PEOPLE, pipelines: [pipeline('p1', true)] }).fields.some((field) => field.key === 'pipelineId')).toBe(false);
    const many = opportunityCreateForm({ people: PEOPLE, pipelines: [pipeline('p1', false), pipeline('p2', true), pipeline('p3', false, false)] });
    const field = many.fields.find((entry) => entry.key === 'pipelineId');
    expect(field?.options?.map((option) => option.value)).toEqual(['p1', 'p2']);
    expect(field?.defaultValue).toBe('p2');
  });
});

describe('Tạo nhanh hồ sơ Bán hàng: giá trị thành request của Bán hàng', () => {
  it('khách hàng: chuỗi rỗng thành null, số giữ nguyên, xác nhận MST đi kèm', () => {
    expect(customerRequest({ name: 'Công ty B', code: null, creditLimit: 5_000_000, paymentTermDays: '30', groupId: null }, true)).toMatchObject({
      name: 'Công ty B',
      code: null,
      kind: 'LEAD_CUSTOMER',
      creditLimit: 5_000_000,
      paymentTermDays: 30,
      groupId: null,
      confirmDuplicateTaxCode: true,
    });
  });

  it('hợp đồng: không có dòng hàng; giá trị trống để service tự tính như form gốc', () => {
    expect(contractRequest({ type: 'FRAMEWORK', customerId: 'k-9', title: 'HĐ', validFrom: '2026-11-01', value: null })).toEqual({
      type: 'FRAMEWORK',
      customerId: 'k-9',
      quoteId: null,
      title: 'HĐ',
      signedDate: null,
      validFrom: '2026-11-01',
      validTo: null,
      value: null,
      warrantyMonths: null,
      ownerUserId: null,
      note: null,
      lines: [],
    });
  });

  it('hợp đồng gắn báo giá: quoteId đi vào request, khách trống để service lấy khách của báo giá', () => {
    expect(contractRequest({ customerId: null, quoteId: 'q-1', title: 'HĐ', validFrom: '2026-11-01' })).toMatchObject({
      customerId: '',
      quoteId: 'q-1',
      lines: [],
    });
  });

  it('cơ hội: xác suất trống thì không gửi để service dùng mặc định', () => {
    expect(opportunityRequest({ customerId: 'k-9', name: 'CH' })).not.toHaveProperty('probability');
    expect(opportunityRequest({ customerId: 'k-9', name: 'CH', probability: 40 }).probability).toBe(40);
  });
});

describe('LinkableController tạo nhanh', () => {
  it('kinds gắn cờ create theo actor của request', () => {
    const { controller } = setup();
    expect(controller.kinds({ crmActor: READER }).kinds.some((kind) => kind.create)).toBe(false);
    expect(controller.kinds({ crmActor: WRITER }).kinds.filter((kind) => kind.create)).toHaveLength(3);
  });

  it('create-form: người không có quyền tạo nhận 403 trước khi đọc danh mục', async () => {
    const { controller, people } = setup();
    const error = (await controller.createForm({ crmActor: READER }, 'crm.contract').catch((cause) => cause)) as HttpException;
    expect(error.getStatus()).toBe(403);
    expect(people.list).not.toHaveBeenCalled();
  });

  it('create-form khách hàng đọc nhóm, phân loại, người phụ trách theo actor', async () => {
    const { controller, groups, kinds } = setup();
    const form = await controller.createForm({ crmActor: WRITER }, 'crm.customer');
    expect(form.kind).toBe('crm.customer');
    expect(groups.list).toHaveBeenCalledWith(WRITER);
    expect(kinds.list).toHaveBeenCalledWith(WRITER);
  });

  it('loại không tạo nhanh được thì 400', async () => {
    const { controller } = setup();
    await expect(controller.createForm({ crmActor: WRITER }, 'crm.quote')).rejects.toMatchObject({ status: 400 });
    await expect(controller.create({ crmActor: WRITER }, 'crm.receipt', { values: {} })).rejects.toMatchObject({ status: 400 });
  });

  it('tạo hợp đồng qua đúng ContractService.create dưới actor của người gọi, trả LinkableObject', async () => {
    const { controller, contracts } = setup();
    const result = await controller.create({ crmActor: WRITER }, 'crm.contract', {
      values: { type: 'SALE', customerId: 'k-9', title: ' Hợp đồng giấy ', validFrom: '2026-11-01', value: 110_000_000 },
    });
    expect(contracts.create).toHaveBeenCalledWith(WRITER, expect.objectContaining({ title: 'Hợp đồng giấy', value: 110_000_000, lines: [] }));
    expect(result).toMatchObject({ kind: 'crm.contract', id: 'c-9', code: 'HD-009', launchUrl: '/modules/crm#contracts/c-9', upstream: [] });
  });

  it('lỗi quyền của service đi thẳng ra (403, câu của Bán hàng)', async () => {
    const { controller, contracts } = setup();
    contracts.create.mockRejectedValueOnce(new CrmForbiddenError('Bạn không có quyền quản lý hợp đồng.'));
    const error = (await controller.create({ crmActor: WRITER }, 'crm.contract', { values: {} }).catch((cause) => cause)) as HttpException;
    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({ code: 'FORBIDDEN', message: 'Bạn không có quyền quản lý hợp đồng.' });
  });

  it('trùng MST thành 409 LINKABLE_CONFIRM_REQUIRED kèm danh sách; gửi lại confirm thì service nhận xác nhận', async () => {
    const { controller, customers } = setup();
    customers.create.mockRejectedValueOnce(
      new CrmConflictError('DUPLICATE_TAX_CODE', 'Mã số thuế 0101234567 đã có ở khách hàng KH001 - Công ty A.', {
        matches: [{ id: 'k-1', code: 'KH001', name: 'Công ty A' }],
      }),
    );
    const error = (await controller
      .create({ crmActor: WRITER }, 'crm.customer', { values: { name: 'Công ty B', taxCode: '0101234567' } })
      .catch((cause) => cause)) as HttpException;
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: LINKABLE_CONFIRM_REQUIRED,
      field: 'taxCode',
      warnings: ['KH001 - Công ty A'],
    });
    expect(customers.create).toHaveBeenLastCalledWith(WRITER, expect.objectContaining({ confirmDuplicateTaxCode: false }));

    const created = await controller.create({ crmActor: WRITER }, 'crm.customer', {
      values: { name: 'Công ty B', taxCode: '0101234567' },
      confirm: true,
    });
    expect(customers.create).toHaveBeenLastCalledWith(WRITER, expect.objectContaining({ confirmDuplicateTaxCode: true }));
    expect(created).toMatchObject({ kind: 'crm.customer', id: 'k-9', prefill: { crmCustomerId: 'k-9' } });
  });

  it('tạo cơ hội qua OpportunityService.create', async () => {
    const { controller, opportunities } = setup();
    const result = await controller.create({ crmActor: WRITER }, 'crm.opportunity', { values: { customerId: 'k-9', name: 'Tủ điện nhà máy B' } });
    expect(opportunities.create).toHaveBeenCalledWith(WRITER, expect.objectContaining({ customerId: 'k-9', name: 'Tủ điện nhà máy B' }));
    expect(result).toMatchObject({ kind: 'crm.opportunity', id: 'o-9' });
  });

  it('thiếu actor thì 401', async () => {
    const { controller } = setup();
    await expect(controller.create({}, 'crm.contract', { values: {} })).rejects.toMatchObject({ status: 401 });
  });
});

const QUOTE_PREVIEW = {
  quoteId: 'q-1',
  quoteCode: 'BG-001',
  quoteName: 'Tủ điện',
  customerId: 'k-9',
  customerCode: 'KH009',
  customerName: 'Công ty B',
  ownerUserId: 'u1',
  versionNo: 2,
  totalAmount: 108_000_000,
  lines: [
    {
      id: 'l1',
      lineNo: 1,
      materialId: 'm1',
      materialCode: 'VT01',
      materialName: 'Tủ điện 400A',
      unit: 'bộ',
      materialKind: 'STOCK',
      quantity: 2,
      unitPrice: 50_000_000,
      vatRate: 8,
      discountPercent: 0,
      lineAmount: 100_000_000,
      note: null,
    },
  ],
};

describe('Tạo nhanh hợp đồng gắn báo giá', () => {
  it('bản xem trước: đúng dòng, tổng của bộ dựng chung; điền khách và tên hợp đồng; qua được bộ đọc chung', () => {
    const preview = contractQuotePreview(QUOTE_PREVIEW);
    expect(preview.rows).toEqual([
      { lineNo: 1, material: 'VT01 Tủ điện 400A', quantity: 2, unit: 'bộ', unitPrice: 50_000_000, vat: '8%', lineAmount: 100_000_000 },
    ]);
    expect(preview.note).toContain('1 dòng của phiên bản 2');
    expect(preview.note).toContain('108.000.000');
    expect(preview.fill).toEqual({
      customerId: { value: 'k-9', label: 'KH009 — Công ty B' },
      title: { value: 'Hợp đồng theo báo giá BG-001' },
    });
    const parsed = sanitizeLinkableCreatePreview(preview, 'quoteId', 'q-1');
    expect(parsed?.columns.map((column) => column.key)).toEqual(['lineNo', 'material', 'quantity', 'unit', 'unitPrice', 'vat', 'lineAmount']);
    expect(parsed?.rows).toEqual(preview.rows);
    expect(parsed?.fill).toEqual(preview.fill);
  });

  it('create-preview: chỉ ô báo giá của form hợp đồng, qua ContractService.quotePreview dưới actor người gọi', async () => {
    const { controller, contracts } = setup();
    contracts.quotePreview.mockResolvedValue(QUOTE_PREVIEW);
    const preview = await controller.createPreview({ crmActor: WRITER }, 'crm.contract', 'quoteId', ' q-1 ');
    expect(contracts.quotePreview).toHaveBeenCalledWith(WRITER, 'q-1');
    expect(preview).toMatchObject({ field: 'quoteId', value: 'q-1', title: 'Dòng hàng từ báo giá BG-001' });
    await expect(controller.createPreview({ crmActor: WRITER }, 'crm.contract', 'customerId', 'k-9')).rejects.toMatchObject({ status: 400 });
    await expect(controller.createPreview({ crmActor: WRITER }, 'crm.customer', 'quoteId', 'q-1')).rejects.toMatchObject({ status: 400 });
    await expect(controller.createPreview({ crmActor: WRITER }, 'crm.contract', 'quoteId', ' ')).rejects.toMatchObject({ status: 400 });
  });

  it('create-preview: báo giá không gắn được thì 409 kèm mã, câu của Bán hàng', async () => {
    const { controller, contracts } = setup();
    contracts.quotePreview.mockRejectedValueOnce(new CrmConflictError('QUOTE_CONVERTED', 'Báo giá đã chuyển thành hợp đồng.'));
    const error = (await controller.createPreview({ crmActor: WRITER }, 'crm.contract', 'quoteId', 'q-1').catch((cause) => cause)) as HttpException;
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ code: 'QUOTE_CONVERTED', message: 'Báo giá đã chuyển thành hợp đồng.' });
  });

  it('tìm báo giá: lọc gắn được và theo khách khi có; không có thì như cũ; id khách sai bỏ qua', async () => {
    const { controller, quotes } = setup();
    const customer = '0b6a3c1e-5d2f-4a7b-9c8d-1e2f3a4b5c6d';
    await controller.search({ crmActor: WRITER }, 'crm.quote', 'BG', undefined, 'true', customer);
    expect(quotes.list).toHaveBeenLastCalledWith(WRITER, { q: 'BG', limit: 20, contractLinkable: true, customerId: customer });
    await controller.search({ crmActor: WRITER }, 'crm.quote', '', undefined);
    expect(quotes.list).toHaveBeenLastCalledWith(WRITER, { q: undefined, limit: 20 });
    await controller.search({ crmActor: WRITER }, 'crm.quote', '', undefined, 'yes', 'not-an-id');
    expect(quotes.list).toHaveBeenLastCalledWith(WRITER, { q: undefined, limit: 20 });
  });

  it('tạo hợp đồng có báo giá: service nhận quoteId; hồ sơ trả về có chuỗi báo giá, cơ hội', async () => {
    const { controller, contracts, quotes } = setup();
    contracts.create.mockResolvedValueOnce({ ...contractDetail, quoteId: 'q-1', quoteCode: 'BG-001' });
    const result = await controller.create({ crmActor: WRITER }, 'crm.contract', {
      values: { type: 'SALE', customerId: null, quoteId: 'q-1', title: 'HĐ theo báo giá', validFrom: '2026-11-01' },
    });
    expect(contracts.create).toHaveBeenCalledWith(WRITER, expect.objectContaining({ quoteId: 'q-1', customerId: '' }));
    expect(quotes.get).toHaveBeenCalledWith(WRITER, 'q-1');
    expect(result.upstream).toEqual([
      { kind: 'crm.quote', id: 'q-1', code: 'BG-001', label: 'BG-001' },
      { kind: 'crm.opportunity', id: 'o-1', label: 'Tủ điện nhà máy B' },
    ]);
  });

  it('lỗi gắn báo giá lúc tạo (khác khách, đã chuyển) đi thẳng ra với mã của Bán hàng', async () => {
    const { controller, contracts } = setup();
    contracts.create.mockRejectedValueOnce(new CrmConflictError('QUOTE_CUSTOMER_MISMATCH', 'Báo giá thuộc khách hàng khác.'));
    const error = (await controller
      .create({ crmActor: WRITER }, 'crm.contract', { values: { customerId: 'k-1', quoteId: 'q-1' } })
      .catch((cause) => cause)) as HttpException;
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ code: 'QUOTE_CUSTOMER_MISMATCH' });
  });
});
