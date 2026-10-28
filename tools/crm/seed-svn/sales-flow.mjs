// Luồng bán hàng dùng chung cho bước `finance` và `warranty`: hợp đồng, đơn bán, đợt giao, yêu cầu xuất kho, thủ kho
// chọn serial và ghi sổ ở Kho, chờ Bán hàng nhận sự kiện `inventory.stock.issued`. Mọi thao tác qua API; chạy lại được
// nhờ đánh dấu đơn và hợp đồng bằng ghi chú cố định.
import { allPages, materialsByCode, waitFor } from './common.mjs';

export const SEED_WAREHOUSE = 'QA-KHO-HN';

/** Hợp đồng theo tiêu đề (đọc bằng QTV); chưa có thì tạo và xác nhận. */
export async function ensureContract(config, sessions, log, definition) {
  const admin = await sessions.as('QTV');
  const found = (await allPages(admin, `${config.crmApi}/v1/contracts?q=${encodeURIComponent(definition.title)}`)).find(
    (item) => item.title === definition.title,
  );
  const url = (id) => `${config.crmApi}/v1/contracts/${id}`;
  let contract = found ? await admin.get(url(found.id)) : null;
  if (!contract) {
    contract = await admin.post(`${config.crmApi}/v1/contracts`, {
      type: definition.type,
      customerId: definition.customerId,
      title: definition.title,
      signedDate: definition.signedDate,
      validFrom: definition.validFrom,
      validTo: definition.validTo ?? null,
      value: definition.value ?? null,
      warrantyMonths: definition.warrantyMonths ?? null,
      warehouseCode: definition.warehouseCode ?? SEED_WAREHOUSE,
      ownerUserId: definition.ownerUserId,
      note: definition.note,
      lines: definition.lines ?? [],
    });
    log.created(`Hợp đồng ${contract.code} "${definition.title}".`);
  }
  if (contract.status === 'DRAFT' && definition.paymentTerms?.length && !contract.paymentTerms.length) {
    contract = await admin.put(`${url(contract.id)}/payment-terms`, { revision: contract.revision, terms: definition.paymentTerms });
    log.created(`Hợp đồng ${contract.code}: ${definition.paymentTerms.length} đợt thanh toán.`);
  }
  if (contract.status === 'DRAFT') {
    contract = await admin.post(`${url(contract.id)}/confirm`, { revision: contract.revision });
    log.created(`Hợp đồng ${contract.code}: xác nhận (${contract.status}).`);
  } else if (found) log.skip(`Hợp đồng ${contract.code} "${definition.title}" đã có (${contract.status}).`);
  return contract;
}

async function findOrder(config, session, customerId, marker) {
  const orders = await allPages(session, `${config.crmApi}/v1/orders?customerId=${customerId}`);
  for (const summary of orders) {
    if (summary.status === 'CANCELLED') continue;
    const detail = await session.get(`${config.crmApi}/v1/orders/${summary.id}`);
    if (detail.note === marker) return detail;
  }
  return null;
}

/** Thủ kho chọn serial (nếu có), đặt ngày chứng từ rồi ghi sổ chứng từ xuất nháp do Bán hàng yêu cầu. */
async function postIssueDocument(config, sessions, log, delivery, { serials, documentDate }) {
  const keeper = await sessions.as('TK');
  const url = `${config.inventoryApi}/v1/stock-documents/${delivery.issueDocumentId}`;
  let document = await keeper.get(url);
  if (document.status === 'POSTED') return document;
  if (document.status !== 'DRAFT') {
    throw new Error(`Chứng từ xuất ${document.code} đang ${document.status}, cần xử lý tay.`);
  }
  const lines = document.lines.map((line) => ({
    materialCode: line.materialCode,
    quantity: Number(line.quantity),
    ...(line.reservationId ? { reservationId: line.reservationId } : {}),
    ...(serials?.[line.materialCode] ? { serials: serials[line.materialCode] } : line.serials?.length ? { serials: line.serials } : {}),
    ...(line.lotNo ? { lot: { lotNo: line.lotNo } } : {}),
  }));
  document = await keeper.patch(url, { documentDate, lines });
  const posted = await keeper.post(`${url}/post`);
  log.created(`Thủ kho ghi sổ chứng từ xuất ${posted.document?.code ?? document.code} (ngày chứng từ ${documentDate}).`);
  return posted.document ?? document;
}

/**
 * Đơn bán đã giao: tạo đơn (đánh dấu bằng `marker` ở ghi chú), xác nhận, lập một đợt giao ngày `plannedDate`, yêu
 * cầu xuất kho, thủ kho ghi sổ, chờ Bán hàng cập nhật đợt giao Đã xuất kho. Trả đơn sau khi giao, hoặc `null` khi
 * đơn dừng ở bước cần người duyệt (ví dụ Chờ duyệt hạn mức).
 */
export async function ensureDeliveredOrder(config, sessions, log, definition) {
  const { owner, customerId, contractId, marker, label, plannedDate, lines, serials } = definition;
  const session = await sessions.as(owner);
  const admin = await sessions.as('QTV');
  const materials = await materialsByCode(config, admin);
  const orderUrl = (id) => `${config.crmApi}/v1/orders/${id}`;
  let order = await findOrder(config, session, customerId, marker);
  if (!order) {
    order = await session.post(`${config.crmApi}/v1/orders`, {
      ...(contractId ? { contractId } : { customerId }),
      warehouseCode: SEED_WAREHOUSE,
      expectedDeliveryDate: plannedDate,
      note: marker,
      lines: lines.map((line) => {
        const material = materials.get(line.materialCode);
        if (!material) throw new Error(`Chưa có mặt hàng ${line.materialCode}.`);
        return { materialId: material.id, quantity: line.quantity };
      }),
    });
    log.created(`${label}: đơn ${order.code} (${owner}).`);
  }
  if (order.status === 'DRAFT') {
    order = await session.post(`${orderUrl(order.id)}/confirm`, { revision: order.revision });
    log.created(`${label}: xác nhận đơn ${order.code} (${order.status}).`);
  }
  if (order.status === 'CREDIT_PENDING') {
    log.warn(`${label}: đơn ${order.code} chờ duyệt vượt hạn mức; duyệt xong rồi chạy lại.`);
    return null;
  }
  if (['DELIVERED', 'DONE'].includes(order.status)) {
    log.skip(`${label}: đơn ${order.code} đã giao (${order.status}).`);
    return order;
  }
  let delivery = order.deliveries.find((item) => !['CANCELLED', 'REVERSED'].includes(item.status));
  if (!delivery) {
    order = await session.post(`${orderUrl(order.id)}/deliveries`, {
      revision: order.revision,
      plannedDate,
      warehouseCode: SEED_WAREHOUSE,
      note: `Seed: giao ngày ${plannedDate}`,
      lines: order.lines.map((line) => ({ orderLineId: line.id, quantity: Number(line.quantity) })),
    });
    delivery = order.deliveries.find((item) => item.status === 'PLANNED');
    log.created(`${label}: đợt giao ${delivery.code} ngày ${plannedDate}.`);
  }
  if (delivery.status === 'PLANNED') {
    order = await session.post(`${orderUrl(order.id)}/deliveries/${delivery.id}/request-issue`, { revision: order.revision });
    delivery = order.deliveries.find((item) => item.id === delivery.id);
    log.created(`${label}: yêu cầu xuất kho ${delivery.issueDocumentCode ?? '(chỉ dịch vụ)'}.`);
  }
  if (delivery.status === 'REQUESTED' && delivery.issueDocumentId) {
    await postIssueDocument(config, sessions, log, delivery, { serials, documentDate: plannedDate });
  }
  order = await waitFor(`${label}: Bán hàng nhận kết quả xuất kho của đơn ${order.code}`, async () => {
    const current = await session.get(orderUrl(order.id));
    const issued = current.deliveries.find((item) => item.id === delivery.id)?.status === 'ISSUED';
    return issued ? current : null;
  });
  log.info(`${label}: đơn ${order.code} ${order.status}, đợt ${delivery.code} xuất kho lúc ${order.deliveries.find((item) => item.id === delivery.id).issuedAt}.`);
  return order;
}
