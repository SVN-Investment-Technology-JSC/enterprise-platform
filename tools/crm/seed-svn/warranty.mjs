// Bước `warranty` (T6-10): đơn đã giao serial ở các mốc quá khứ để test hạn bảo hành và đổi serial (TEST.md mục 1.3).
// SN031 (3 tháng trước), SN032 (11 tháng), SN033 (13 tháng) bảo hành theo mặt hàng 12 tháng; SN034 theo hợp đồng bảo
// hành 24 tháng, SN035 theo hợp đồng 6 tháng (cùng 8 tháng trước). Đơn của NV1, thủ kho (TK) chọn serial và ghi sổ.
//
// Giới hạn của API: ngày giao mà Bán hàng dùng làm mốc bảo hành là `delivery_plans.issued_at`, lấy từ `postedAt` của
// sự kiện `inventory.stock.issued`, mà Kho đặt bằng `now()` lúc ghi sổ (postgres-stock-document.store.ts), không theo
// `documentDate`. Script vẫn đặt ngày giao dự kiến và ngày chứng từ xuất bằng mốc quá khứ, nhưng hạn bảo hành tính từ
// hôm nay. Cuối bước in hạn thực tế và cảnh báo mốc nào lệch.
import { addMonths, createSessions, daysBetween, materialsByCode, requireCustomers, vnToday } from './common.mjs';
import { ensureContract, ensureDeliveredOrder } from './sales-flow.mjs';

const MATERIAL = 'QA-KHO-LAP';

function cases(today) {
  return [
    { serial: 'SN031', customer: 'QA-CRM-KH08', monthsAgo: 3, expect: 'còn khoảng 9 tháng (bảo hành mặt hàng 12 tháng)' },
    { serial: 'SN032', customer: 'QA-CRM-KH09', monthsAgo: 11, expect: 'còn khoảng 1 tháng' },
    { serial: 'SN033', customer: 'QA-CRM-KH10', monthsAgo: 13, expect: 'đã hết hạn' },
    { serial: 'SN034', customer: 'QA-CRM-KH08', monthsAgo: 8, contractMonths: 24, expect: 'còn khoảng 16 tháng (hợp đồng 24 tháng)' },
    { serial: 'SN035', customer: 'QA-CRM-KH09', monthsAgo: 8, contractMonths: 6, expect: 'đã hết hạn (hợp đồng 6 tháng)' },
  ].map((item) => ({ ...item, deliveredOn: addMonths(today, -item.monthsAgo) }));
}

export async function runWarrantyStep(config, log) {
  log.section(`Bước warranty cho ${config.tenantSlug}`);
  const sessions = createSessions(config);
  const admin = await sessions.as('QTV');
  const today = vnToday();
  const list = cases(today);
  const customers = await requireCustomers(config, admin, [...new Set(list.map((item) => item.customer))]);
  const lap = (await materialsByCode(config, admin)).get(MATERIAL);
  if (!lap) throw new Error(`Chưa có mặt hàng ${MATERIAL}. Chạy --step=legacy trước.`);
  const nv1 = await sessions.userId('NV1');

  for (const item of list) {
    log.section(`${item.serial}: giao ${item.deliveredOn} (${item.monthsAgo} tháng trước)`);
    const customer = customers.get(item.customer);
    let contractId = null;
    if (item.contractMonths) {
      const contract = await ensureContract(config, sessions, log, {
        type: 'PRINCIPLE',
        customerId: customer.id,
        title: `QA-CRM Hợp đồng bảo hành ${item.contractMonths} tháng (${item.serial})`,
        signedDate: item.deliveredOn,
        validFrom: item.deliveredOn,
        warrantyMonths: item.contractMonths,
        ownerUserId: nv1,
        note: `Seed T6-10: hợp đồng bảo hành ${item.contractMonths} tháng cho ${item.serial}`,
        lines: [{ materialId: lap.id, unitPrice: 19_500_000, vatRate: 10 }],
      });
      contractId = contract.id;
    }
    await ensureDeliveredOrder(config, sessions, log, {
      owner: 'NV1',
      customerId: customer.id,
      contractId,
      marker: `seed-svn:warranty:${item.serial}`,
      label: `${item.serial} (${item.customer})`,
      plannedDate: item.deliveredOn,
      lines: [{ materialCode: MATERIAL, quantity: 1 }],
      serials: { [MATERIAL]: [item.serial] },
    });
  }

  log.section('Tra cứu bảo hành (KTV)');
  const ktv = await sessions.as('KTV');
  let mismatched = 0;
  for (const item of list) {
    const [found] = await ktv.get(`${config.crmApi}/v1/warranty/lookup?serial=${encodeURIComponent(item.serial)}`);
    const coverage = found?.coverage;
    if (!coverage) {
      log.warn(`${item.serial}: tra cứu không thấy đơn đã giao.`);
      mismatched += 1;
      continue;
    }
    log.info(
      `${item.serial}: giao ${coverage.deliveredOn}, ${coverage.months ?? '?'} tháng (${coverage.source}), hạn ${coverage.warrantyUntil}, ` +
        `${coverage.expired ? 'đã hết hạn' : `còn ${coverage.remainingDays} ngày`}; mong đợi ${item.expect}.`,
    );
    if (coverage.deliveredOn !== item.deliveredOn) {
      mismatched += 1;
      log.warn(
        `${item.serial}: ngày giao thực tế ${coverage.deliveredOn} khác mốc ${item.deliveredOn} ` +
          `(lệch ${daysBetween(item.deliveredOn, coverage.deliveredOn)} ngày) vì Kho ghi nhận ngày ghi sổ, không theo ngày chứng từ.`,
      );
    }
  }
  if (mismatched) {
    log.warn(
      `${mismatched}/${list.length} serial chưa có ngày giao trong quá khứ. API hiện không cho lùi ngày giao; ` +
        'test hạn bảo hành theo mốc thời gian cần Kho phát `postedAt` theo ngày chứng từ, hoặc chỉnh dữ liệu ở DB thử.',
    );
  }
}
