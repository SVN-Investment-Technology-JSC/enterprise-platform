import type { SourceTransport } from '@enterprise-platform/contracts-workspace';
import { FleetTransportService, parseTransport } from './fleet-transport.service.js';
import type { FleetAvailabilityReader } from './fleet-availability.port.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { SaveSourceTransport, WorkspaceStore } from './workspace-store.port.js';

const VEHICLE = '11111111-1111-4111-8111-111111111111';
const DRIVER = '22222222-2222-4222-8222-222222222222';
const SOURCE = '33333333-3333-4333-8333-333333333333';
const actor = { tenantId: 't1', userId: 'u1', displayName: 'An' } as WorkspaceActor;
const company = {
  mode: 'COMPANY_VEHICLE' as const,
  vehicleId: VEHICLE,
  driverId: DRIVER,
  startAt: '2026-11-10T01:00:00Z',
  endAt: '2026-11-10T09:00:00Z',
  destination: ' Hà Nội ',
};

describe('parseTransport', () => {
  it('xe công ty cần xe, tài xế và khung giờ hợp lệ; chuẩn hoá giờ và điểm đến', () => {
    expect(parseTransport(company)).toEqual({
      mode: 'COMPANY_VEHICLE',
      vehicleId: VEHICLE,
      driverId: DRIVER,
      startAt: '2026-11-10T01:00:00.000Z',
      endAt: '2026-11-10T09:00:00.000Z',
      destination: 'Hà Nội',
    });
    expect(() => parseTransport({ ...company, vehicleId: 'x' })).toThrow(/xe công ty/i);
    expect(() => parseTransport({ ...company, driverId: undefined })).toThrow(/tài xế/i);
    expect(() => parseTransport({ ...company, endAt: company.startAt })).toThrow(/sau giờ đi/);
    expect(() => parseTransport({ ...company, startAt: 'hôm qua' })).toThrow(/thời gian không hợp lệ/);
  });

  it('không cho giữ xe quá 7 ngày', () => {
    expect(() => parseTransport({ ...company, endAt: '2026-11-20T09:00:00Z' })).toThrow(/7 ngày/);
  });

  it('phương tiện ngoài chỉ cần loại phương tiện', () => {
    expect(parseTransport({ mode: 'EXTERNAL', detail: ' Máy bay ' })).toEqual({ mode: 'EXTERNAL', detail: 'Máy bay' });
    expect(() => parseTransport({ mode: 'EXTERNAL', detail: '  ' })).toThrow(/loại phương tiện/);
    expect(() => parseTransport({ mode: 'BAY' as never })).toThrow(/không hợp lệ/);
  });
});

describe('FleetTransportService', () => {
  function setup() {
    const saved: SaveSourceTransport[] = [];
    const cleared: string[] = [];
    const store = {
      fleetTransport: {
        find: jest.fn(async () => undefined as SourceTransport | undefined),
        save: jest.fn(async (_tenant: string, input: SaveSourceTransport) => {
          saved.push(input);
          return {} as SourceTransport;
        }),
        clear: jest.fn(async (_tenant: string, type: string, id: string) => void cleared.push(`${type}:${id}`)),
      },
    } as unknown as WorkspaceStore;
    const reader: FleetAvailabilityReader = { read: jest.fn(async () => ({ vehicles: [], drivers: [] })) };
    return { service: new FleetTransportService(store, reader), saved, cleared, reader, store };
  }
  const source = { sourceType: 'WORK_ITEM' as const, sourceId: SOURCE, label: 'CV-001 Khảo sát' };

  it('undefined giữ nguyên, null trả xe, giá trị mới được ghi kèm người yêu cầu', async () => {
    const { service, saved, cleared, store } = setup();
    await service.apply(actor, source, undefined);
    expect(store.fleetTransport.save).not.toHaveBeenCalled();
    expect(cleared).toEqual([]);

    await service.apply(actor, source, null);
    expect(cleared).toEqual([`WORK_ITEM:${SOURCE}`]);

    await service.apply(actor, source, parseTransport(company));
    expect(saved[0]).toMatchObject({
      sourceType: 'WORK_ITEM',
      sourceId: SOURCE,
      sourceLabel: 'CV-001 Khảo sát',
      requesterUserId: 'u1',
      vehicleId: VEHICLE,
    });
  });

  it('hỏi lịch bận của HRM kèm nguồn được loại trừ; khung giờ sai bị từ chối trước khi gọi HRM', async () => {
    const { service, reader } = setup();
    await service.availability(actor, {
      from: '2026-11-10T01:00:00Z',
      to: '2026-11-10T09:00:00Z',
      excludeSourceType: 'CALENDAR_EVENT',
      excludeSourceId: SOURCE,
    });
    expect(reader.read).toHaveBeenCalledWith('t1', {
      from: '2026-11-10T01:00:00.000Z',
      to: '2026-11-10T09:00:00.000Z',
      exclude: { sourceType: 'CALENDAR_EVENT', sourceId: SOURCE },
    });
    await expect(
      service.availability(actor, { from: '2026-11-10T09:00:00Z', to: '2026-11-10T01:00:00Z' }),
    ).rejects.toThrow(/khung giờ/i);
    expect(reader.read).toHaveBeenCalledTimes(1);
    await expect(
      service.availability(actor, { from: company.startAt, to: company.endAt, excludeSourceType: 'INCIDENT', excludeSourceId: SOURCE }),
    ).rejects.toThrow(/nguồn/i);
  });
});
