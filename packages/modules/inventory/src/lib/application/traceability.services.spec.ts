import type { LotDetail, SerialHistory } from '@enterprise-platform/contracts-inventory';
import type { LotCandidate } from '../domain/traceability-policy.js';
import type { InventoryActor } from './inventory.application.js';
import { LotService } from './lot.service.js';
import { QualityService } from './quality.service.js';
import { SerialService } from './serial.service.js';
import type { DecideQuality, TraceabilityStore } from './traceability-store.port.js';

const LOT_ID = '11111111-1111-4111-8111-111111111111';

/** Store giả: ghi lại lời gọi và chạy `decide` trên trạng thái hiện tại như store thật sau khi khoá. */
class FakeTraceabilityStore implements TraceabilityStore {
  candidates: LotCandidate[] = [];
  decisions: unknown[] = [];
  quality: LotDetail['qualityStatus'] = 'PASSED';

  async listLots() {
    return [];
  }
  async getLot(_tenantId: string, lotId: string) {
    return lotId === LOT_ID ? ({ id: LOT_ID } as LotDetail) : null;
  }
  async lotCandidates() {
    return this.candidates;
  }
  async serialHistory(_tenantId: string, serial: string) {
    return serial === 'SN001' ? ({ serialNumber: 'SN001' } as SerialHistory) : null;
  }
  async changeSerialQuality(
    _tenantId: string,
    _serial: string,
    _materialCode: string | undefined,
    _actorId: string,
    decide: DecideQuality,
  ) {
    this.decisions.push(decide(this.quality, 'Serial SN001'));
    return { serialNumber: 'SN001' } as SerialHistory;
  }
  async changeLotQuality(_tenantId: string, _lotId: string, _actorId: string, decide: DecideQuality) {
    this.decisions.push(decide(this.quality, 'Lô L01'));
    return { id: LOT_ID } as LotDetail;
  }
}

const actor = (rights: Partial<InventoryActor> = {}): InventoryActor => ({
  tenantId: 'tenant',
  userId: 'user',
  displayName: 'User',
  canManage: false,
  canWriteTransactions: true,
  ...rights,
});

describe('LotService, SerialService, QualityService', () => {
  let store: FakeTraceabilityStore;
  beforeEach(() => {
    store = new FakeTraceabilityStore();
  });

  it('gợi ý FEFO dùng ngày hôm nay của service và kiểm tham số', async () => {
    store.candidates = [
      { lotId: 'a', lotNo: 'L01', expiresOn: '2026-12-31', qualityStatus: 'PASSED', available: 30 },
      { lotId: 'b', lotNo: 'L03', expiresOn: '2026-10-01', qualityStatus: 'PASSED', available: 30 },
    ];
    const lots = new LotService(store, () => '2026-10-27');
    const suggestion = await lots.suggest(actor(), { materialCode: 'MUC', warehouseCode: 'HN', quantity: '10' });
    expect(suggestion).toMatchObject({ requested: 10, allocated: 10, shortage: 0 });
    expect(suggestion.lines.map((line) => line.lotNo)).toEqual(['L01']);
    await expect(lots.suggest(actor(), { materialCode: 'MUC', warehouseCode: 'HN', quantity: 'x' })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(lots.suggest(actor(), { warehouseCode: 'HN', quantity: 1 })).rejects.toMatchObject({
      message: 'Thiếu mã vật tư.',
    });
    await expect(lots.list(actor(), ' ')).rejects.toMatchObject({ statusCode: 400 });
    await expect(lots.get(actor(), 'not-a-uuid')).rejects.toMatchObject({ statusCode: 404 });
    await expect(lots.get(actor(), LOT_ID)).resolves.toMatchObject({ id: LOT_ID });
  });

  it('tra serial: không có thì 404', async () => {
    const serials = new SerialService(store);
    await expect(serials.history(actor(), ' SN001 ')).resolves.toMatchObject({ serialNumber: 'SN001' });
    await expect(serials.history(actor(), 'SN999')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Serial SN999 không tồn tại.',
    });
  });

  it('T1-19: đổi chất lượng cần inventory.quality.write và lý do', async () => {
    const quality = new QualityService(store);
    const clerk = actor({ canWriteQuality: false });
    await expect(
      quality.changeLot(clerk, LOT_ID, { qualityStatus: 'QUARANTINE', reason: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const inspector = actor({ canWriteQuality: true });
    await expect(
      quality.changeLot(inspector, LOT_ID, { qualityStatus: 'QUARANTINE', reason: ' ' }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Phải ghi lý do đổi trạng thái chất lượng.' });
    await quality.changeLot(inspector, LOT_ID, { qualityStatus: 'QUARANTINE', reason: 'Nghi ẩm' });
    await quality.changeSerial(inspector, 'SN001', { qualityStatus: 'DEFECTIVE', reason: 'Vỡ màn hình' });
    expect(store.decisions).toEqual([
      { to: 'QUARANTINE', reason: 'Nghi ẩm' },
      { to: 'DEFECTIVE', reason: 'Vỡ màn hình' },
    ]);
    await expect(
      quality.changeLot(inspector, 'abc', { qualityStatus: 'PASSED', reason: 'x' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    // Quản trị kho (manage) có quyền khi cờ chưa được dựng riêng.
    await expect(
      quality.changeSerial(actor({ canManage: true }), 'SN001', { qualityStatus: 'QUARANTINE', reason: 'x' }),
    ).resolves.toBeDefined();
  });
});
