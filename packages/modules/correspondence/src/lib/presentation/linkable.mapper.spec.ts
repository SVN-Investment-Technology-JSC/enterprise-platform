import type { LetterDetail, LetterSummary } from '@enterprise-platform/contracts-correspondence';
import type { CorrespondenceService } from '../application/correspondence.service.js';
import type { CorrespondenceActor } from '../application/ports.js';
import { CorrespondenceForbiddenError, CorrespondenceNotProvisionedError, LetterNotFoundError } from '../domain/correspondence.error.js';
import { CorrespondenceLinkableController } from './linkable.controller.js';
import {
  CORRESPONDENCE_LINKABLE_KIND_LIST,
  isCorrespondenceLinkableKind,
  letterCandidate,
  letterLaunchUrl,
  letterObject,
} from './linkable.mapper.js';

const summary = {
  id: '11111111-1111-4111-8111-111111111111',
  direction: 'incoming',
  displayNo: '125/ĐẾN',
  incomingNo: '125',
  receivedOn: '2026-03-02',
  senderOrg: 'Sở Công Thương',
  senderRef: '45/SCT-QLNL',
  subject: 'Về việc kiểm tra an toàn điện',
  kind: 'cv',
  kindName: 'Công văn',
  urgency: 'normal',
  urgencyName: 'Thường',
  urgencyHighlight: false,
  confidentiality: 'normal',
  confidentialityName: 'Thường',
  restricted: false,
  dueOn: '2026-03-12',
  stage: 'processing',
  stageLabel: 'Phòng ban xử lý',
  currentAssigneeNames: ['Nguyễn Văn A'],
  assignmentsDone: 0,
  assignmentsTotal: 1,
  receivedBy: 'u-1',
  updatedAt: '2026-03-02T00:00:00.000Z',
  awaitingMe: false,
  unitNames: ['Phòng Kỹ thuật (chủ trì)'],
} as LetterSummary;

const detail = (overrides: Partial<LetterDetail> = {}): LetterDetail =>
  ({
    ...summary,
    steps: [],
    flow: [],
    assignments: [],
    attachments: [],
    comments: [],
    history: [],
    actions: {},
    ...overrides,
  }) as LetterDetail;

const actor = { tenantId: 't-1', userId: 'u-1', displayName: 'Văn thư' } as CorrespondenceActor;

describe('Văn thư công bố đối tượng liên kết', () => {
  it('hai loại theo chiều công văn, đều thuộc module correspondence, không điền sẵn', () => {
    expect(CORRESPONDENCE_LINKABLE_KIND_LIST).toEqual([
      { key: 'correspondence.incoming', moduleLabel: 'Văn thư', label: 'Công văn đến', prefill: false },
      { key: 'correspondence.outgoing', moduleLabel: 'Văn thư', label: 'Công văn đi', prefill: false },
    ]);
    expect(isCorrespondenceLinkableKind('correspondence.outgoing')).toBe(true);
    expect(isCorrespondenceLinkableKind('crm.contract')).toBe(false);
  });

  it('đường dẫn mở ngăn chi tiết công văn của màn Văn thư', () => {
    expect(letterLaunchUrl('a b')).toBe('/modules/correspondence#letters/a%20b');
    expect(letterObject(detail()).launchUrl).toMatch(/^\/modules\/[A-Za-z0-9._~\-/#?=&%]*$/);
  });

  it('công văn đến: nhãn là số và trích yếu; gợi ý là cơ quan gửi và ngày đến', () => {
    const candidate = letterCandidate(summary);
    expect(candidate).toMatchObject({
      kind: 'correspondence.incoming',
      code: '125/ĐẾN',
      label: '125/ĐẾN — Về việc kiểm tra an toàn điện',
      status: 'Phòng ban xử lý',
      hint: 'Sở Công Thương — 2026-03-02',
    });
    const object = letterObject(detail());
    expect(object.fields.find((field) => field.key === 'dueOn')).toEqual({
      key: 'dueOn',
      label: 'Hạn xử lý',
      type: 'date',
      value: '2026-03-12',
    });
    expect(object.fields.find((field) => field.key === 'units')?.value).toBe('Phòng Kỹ thuật (chủ trì)');
    expect(object.upstream).toEqual([]);
    expect(object.prefill).toBeUndefined();
  });

  it('công văn mật và thư riêng: nhãn không lộ trích yếu', () => {
    expect(letterCandidate({ ...summary, restricted: true }).label).toBe('125/ĐẾN — Công văn (mật)');
    expect(letterObject(detail({ personal: true })).label).toBe('125/ĐẾN — Công văn (thư riêng)');
    // Trích yếu vẫn ở fields, chỉ đọc trực tiếp khi người xem được Văn thư cho xem.
    expect(letterObject(detail({ restricted: true })).fields[0]).toMatchObject({ key: 'subject', value: summary.subject });
  });

  it('công văn đi trả lời công văn đến: trỏ về công văn đến', () => {
    const object = letterObject(
      detail({
        direction: 'outgoing',
        displayNo: '12/CV-NA',
        outgoingNo: '12/CV-NA',
        recipient: 'Sở Công Thương',
        stage: 'archived',
        stageLabel: 'Đã lưu trữ',
        relatedLetterId: 'in-1',
        relatedLetterNo: '125/ĐẾN',
        deliveryStatus: 'sent',
      }),
    );
    expect(object.kind).toBe('correspondence.outgoing');
    expect(object.hint).toBe('Sở Công Thương — 2026-03-02');
    expect(object.upstream).toEqual([
      { kind: 'correspondence.incoming', id: 'in-1', code: '125/ĐẾN', label: 'Công văn đến 125/ĐẾN' },
    ]);
    expect(object.fields.find((field) => field.key === 'delivery')?.value).toBe('Đã gửi');
  });

  it('search dùng hộp thư đúng chiều, cắt theo limit', async () => {
    const list = jest.fn(async () => [summary, { ...summary, id: 'x' }]);
    const controller = new CorrespondenceLinkableController({ list } as unknown as CorrespondenceService);
    const request = { correspondenceActor: actor };
    const result = await controller.search(request, 'correspondence.incoming', '  điện ', '1');
    expect(list).toHaveBeenCalledWith(actor, { box: 'incoming', search: 'điện' });
    expect(result.items.map((item) => item.id)).toEqual([summary.id]);
    await controller.search(request, 'correspondence.outgoing', '');
    expect(list).toHaveBeenLastCalledWith(actor, { box: 'outgoing', search: undefined });
    await expect(controller.search(request, 'correspondence.internal')).rejects.toMatchObject({ status: 400 });
  });

  it('resolve bỏ qua công văn không thấy, không được xem, khác chiều; ném tiếp lỗi khác', async () => {
    const detailOf = jest.fn(async (_actor: CorrespondenceActor, id: string) => {
      if (id === 'ok') return detail({ id: 'ok' });
      if (id === 'out') return detail({ id: 'out', direction: 'outgoing' });
      if (id === 'denied') throw new CorrespondenceForbiddenError();
      if (id === 'bad') throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
      throw new LetterNotFoundError();
    });
    const controller = new CorrespondenceLinkableController({ detail: detailOf } as unknown as CorrespondenceService);
    const request = { correspondenceActor: actor };
    const result = await controller.resolve(request, 'correspondence.incoming', 'ok,out,denied,bad,missing');
    expect(result.items.map((item) => item.id)).toEqual(['ok']);

    const broken = new CorrespondenceLinkableController({
      detail: jest.fn(async () => {
        throw new CorrespondenceNotProvisionedError();
      }),
    } as unknown as CorrespondenceService);
    await expect(broken.resolve(request, 'correspondence.incoming', 'ok')).rejects.toMatchObject({ status: 503 });
  });
});
