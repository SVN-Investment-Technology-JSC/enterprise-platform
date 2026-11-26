import type { MaintenanceOccurrence } from '@enterprise-platform/contracts-maintenance';
import { MaintenanceError } from '../domain/maintenance.error.js';
import type { MaintenanceApplication } from '../application/maintenance.application.js';
import type { MaintenanceActor } from '../application/maintenance-store.port.js';
import { MaintenanceLinkableController } from './linkable.controller.js';
import {
  MAINTENANCE_LINKABLE_KIND_LIST,
  isMaintenanceLinkableKind,
  occurrenceCandidate,
  occurrenceLaunchUrl,
  occurrenceObject,
  searchOccurrences,
} from './linkable.mapper.js';

const incident: MaintenanceOccurrence = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'incident',
  code: 'INC-2026-0042',
  title: 'Bơm nước không lên áp',
  description: 'Rò rỉ ở khớp nối',
  assetCode: 'BOM-01',
  assetName: 'Bơm tăng áp tầng hầm',
  dueAt: '2026-05-01T08:00:00.000Z',
  priority: 'High',
  status: 'in_progress',
  procedureInstanceCode: 'QT-0007',
  assigneeName: 'Trần Kỹ Thuật',
  createdByName: 'Lê Vận Hành',
  createdAt: '2026-05-01T01:00:00.000Z',
};

const preventive: MaintenanceOccurrence = {
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'preventive',
  scheduleId: 's-1',
  scheduleTitle: 'Bảo dưỡng máy nén tháng',
  title: 'Bảo dưỡng máy nén tháng',
  assetCode: 'MN-02',
  // 00:00 ngày 1/6 giờ Việt Nam là 17:00 ngày 31/5 theo UTC.
  dueAt: '2026-05-31T17:00:00.000Z',
  priority: 'Normal',
  status: 'planned',
  createdAt: '2026-04-20T00:00:00.000Z',
};

const actor: MaintenanceActor = { tenantId: 't-1', userId: 'u-1', displayName: 'Người xem', canManage: false };

describe('Bảo trì công bố đối tượng liên kết', () => {
  it('một loại phiếu bảo trì, thuộc module maintenance, không điền sẵn', () => {
    expect(MAINTENANCE_LINKABLE_KIND_LIST).toEqual([
      { key: 'maintenance.occurrence', moduleLabel: 'Bảo trì', label: 'Phiếu bảo trì', prefill: false },
    ]);
    expect(isMaintenanceLinkableKind('maintenance.occurrence')).toBe(true);
    expect(isMaintenanceLinkableKind('crm.contract')).toBe(false);
  });

  it('đường dẫn mở chi tiết phiếu ở trang Lịch sử', () => {
    expect(occurrenceLaunchUrl('a b')).toBe('/modules/maintenance#history/a%20b');
    expect(occurrenceObject(incident).launchUrl).toMatch(/^\/modules\/[A-Za-z0-9._~\-/#?=&%]*$/);
  });

  it('sự cố: nhãn là mã và tiêu đề; trạng thái, ưu tiên ra nhãn tiếng Việt', () => {
    const object = occurrenceObject(incident);
    expect(object.label).toBe('INC-2026-0042 — Bơm nước không lên áp');
    expect(object.status).toBe('Đang xử lý');
    expect(object.hint).toBe('Sự cố đột xuất — BOM-01 — Bơm tăng áp tầng hầm');
    expect(object.fields.find((field) => field.key === 'priority')?.value).toBe('Cao');
    expect(object.fields.find((field) => field.key === 'procedure')?.value).toBe('QT-0007');
    expect(object.prefill).toBeUndefined();
    expect(object.upstream).toEqual([]);
  });

  it('phiếu định kỳ không có mã: nhãn kèm ngày đến hạn theo giờ Việt Nam', () => {
    expect(occurrenceCandidate(preventive).label).toBe('Bảo dưỡng máy nén tháng (2026-06-01)');
    expect(occurrenceObject(preventive).fields.find((field) => field.key === 'dueAt')).toEqual({
      key: 'dueAt',
      label: 'Đến hạn',
      type: 'date',
      value: '2026-06-01',
    });
  });

  it('tìm: không chữ thì mới tạo trước; có chữ thì khớp không dấu theo mã, thiết bị, lịch', () => {
    expect(searchOccurrences([preventive, incident], undefined, 20).map((row) => row.id)).toEqual([
      incident.id,
      preventive.id,
    ]);
    expect(searchOccurrences([preventive, incident], 'may nen', 20).map((row) => row.id)).toEqual([preventive.id]);
    expect(searchOccurrences([preventive, incident], 'inc-2026', 20).map((row) => row.id)).toEqual([incident.id]);
    expect(searchOccurrences([preventive, incident], undefined, 1)).toHaveLength(1);
  });

  it('resolve bỏ qua phiếu không thấy hay id sai định dạng, nhưng ném tiếp lỗi thật', async () => {
    const application = {
      getOccurrence: jest.fn(async (_actor: MaintenanceActor, id: string) => {
        if (id === incident.id) return incident;
        if (id === 'bad') throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
        throw new MaintenanceError('not_found', 'Không tìm thấy phiếu bảo trì.');
      }),
    } as unknown as MaintenanceApplication;
    const controller = new MaintenanceLinkableController(application);
    const request = { maintenanceActor: actor };
    const result = await controller.resolve(request, 'maintenance.occurrence', `${incident.id},bad,${preventive.id}`);
    expect(result.items.map((item) => item.id)).toEqual([incident.id]);

    const broken = {
      getOccurrence: jest.fn(async () => {
        throw new Error('pool closed');
      }),
    } as unknown as MaintenanceApplication;
    await expect(new MaintenanceLinkableController(broken).resolve(request, 'maintenance.occurrence', 'x')).rejects.toThrow(
      'pool closed',
    );
  });

  it('search dùng danh sách phiếu của workspace và từ chối loại lạ', async () => {
    const application = {
      workspace: jest.fn(async () => ({ occurrences: [preventive, incident] })),
    } as unknown as MaintenanceApplication;
    const controller = new MaintenanceLinkableController(application);
    const request = { maintenanceActor: actor };
    const list = await controller.search(request, 'maintenance.occurrence', '', '1');
    expect(list.items.map((item) => item.id)).toEqual([incident.id]);
    await expect(controller.search(request, 'maintenance.schedule')).rejects.toMatchObject({ status: 400 });
  });
});
