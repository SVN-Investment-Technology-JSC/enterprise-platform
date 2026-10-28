'use client';

import {
  DELIVERY_STATUS_LABELS,
  PRICE_SOURCE_LABELS,
  RESERVATION_STATUS_LABELS,
  SALES_ORDER_SOURCE_LABELS,
  SALES_ORDER_STATUS_LABELS,
  type CrmMaterialStock,
  type DeliveryLine,
  type DeliveryPlan,
  type SalesOrderDetail,
  type SalesOrderLine,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeft, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import { MaterialPickerDialog } from '../components/material-picker';
import {
  deliveryAction,
  errorMessage,
  getOrder,
  loadMaterialStock,
  orderAction,
  saveDelivery,
  updateOrder,
  type OrderAction,
} from '../crm-api';
import { useCrm } from '../crm-context';
import { OrderReceivablePanel } from '../receivables/order-receivable-panel';
import {
  DELIVERY_STATUS_TONE,
  FULFILLMENT_ACTION_LABELS,
  ORDER_STATUS_TONE,
  canRequestDelivery,
  formatDay,
  formatQuantity,
  orderActions,
  remainingToPlan,
} from '../fulfillment.model';
import { formatPercent, parseNumber } from '../pricing/pricing.model';
import { formatMoney, personName } from '../sales.model';
import styles from '../sales.module.scss';

const ACTION_DONE: Readonly<Record<OrderAction, string>> = {
  confirm: 'Đã xác nhận đơn và giữ hàng ở Kho.',
  cancel: 'Đã huỷ đơn; phần giữ còn lại được nhả.',
  close: 'Đã đóng đơn.',
};

/** Dòng đơn để gửi lại khi thay toàn bộ dòng (đơn Nháp). */
const lineRequest = (line: SalesOrderLine) => ({
  materialId: line.materialId,
  quantity: line.quantity,
  unit: line.unit,
  overrideUnitPrice: line.overrideUnitPrice,
  overrideDiscountPercent: line.overrideDiscountPercent,
});

/**
 * Chi tiết đơn bán (T4-16): dòng (đã giữ, đã lập đợt, đã giao, serial, giá vốn
 * thực tế), các đợt giao (yêu cầu xuất kho, cờ giao trễ), tồn khả dụng theo
 * kho; xác nhận (giữ hàng tất cả hoặc không), huỷ (nhả phần giữ còn lại), đóng.
 */
export function OrderDetail({
  orderId,
  onBack,
  onOpenCustomer,
  onOpenContract,
  onOpenQuote,
  onOpenReceivables,
}: {
  orderId: string;
  onBack: () => void;
  onOpenCustomer: (id: string) => void;
  onOpenContract: (id: string) => void;
  onOpenQuote: (id: string) => void;
  onOpenReceivables?: (customerId: string) => void;
}) {
  const { capabilities, people } = useCrm();
  const [detail, setDetail] = useState<SalesOrderDetail>();
  const [stock, setStock] = useState<readonly CrmMaterialStock[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [planning, setPlanning] = useState<DeliveryPlan | 'new'>();
  const [reasonFor, setReasonFor] = useState<'cancel' | 'close'>();

  const load = useCallback(
    () =>
      getOrder(orderId)
        .then((next) => {
          setDetail(next);
          setError(undefined);
        })
        .catch((cause) => setError(errorMessage(cause, 'Không tải được đơn bán.'))),
    [orderId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const materialKey = detail?.lines.map((line) => line.materialId).join(',') ?? '';
  useEffect(() => {
    if (!materialKey) return setStock([]);
    // Kho lỗi thì không hiện gợi ý tồn; thao tác khác vẫn chạy.
    loadMaterialStock(materialKey.split(','))
      .then(setStock)
      .catch(() => setStock([]));
  }, [materialKey]);

  async function run(work: () => Promise<SalesOrderDetail>, success?: string): Promise<boolean> {
    setBusy(true);
    try {
      setDetail(await work());
      if (success) toast.success(success);
      return true;
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thực hiện được thao tác.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <div className={styles.page}>
        <button type="button" className={styles.buttonGhost} onClick={onBack}>
          <ArrowLeft size={14} /> Danh sách đơn bán
        </button>
        <p className={styles.alert}>{error}</p>
      </div>
    );
  }
  if (!detail) return null;

  const actions = orderActions(detail, capabilities);
  const linesEditable = actions.includes('edit') && detail.source !== 'QUOTE';
  const act = (action: OrderAction, reason?: string) =>
    run(() => orderAction(detail.id, action, { revision: detail.revision, reason }), ACTION_DONE[action]);

  const lineColumns: ColumnsType<SalesOrderLine> = [
    { title: '#', dataIndex: 'lineNo', width: 44, align: 'right' },
    {
      title: 'Mặt hàng',
      key: 'material',
      width: 240,
      render: (_: unknown, row) => (
        <span>
          <span className={styles.mono}>{row.materialCode}</span> {row.materialName}
          {row.materialKind === 'SERVICE' ? (
            <>
              {' '}
              <StatusPill tone="neutral">Dịch vụ</StatusPill>
            </>
          ) : null}
        </span>
      ),
    },
    { title: 'SL', key: 'quantity', width: 100, align: 'right', render: (_: unknown, row) => `${formatQuantity(row.quantity)} ${row.unit}` },
    {
      title: 'Nguồn giá',
      key: 'source',
      width: 150,
      render: (_: unknown, row) => `${PRICE_SOURCE_LABELS[row.priceSource]}${row.priceReferenceCode ? ` ${row.priceReferenceCode}` : ''}`,
    },
    { title: 'Chiết khấu', dataIndex: 'discountPercent', width: 90, align: 'right', render: (value: number) => formatPercent(value) },
    { title: 'Đơn giá', dataIndex: 'unitPrice', width: 120, align: 'right', render: (value: number) => formatMoney(value) },
    { title: 'Thành tiền', dataIndex: 'lineAmount', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
    { title: 'VAT', dataIndex: 'vatRate', width: 70, align: 'right', render: (value: number) => formatPercent(value) },
    {
      title: 'Giữ hàng',
      key: 'reservation',
      width: 170,
      render: (_: unknown, row) =>
        row.materialKind === 'SERVICE' ? (
          <span className={styles.muted}>Không giữ</span>
        ) : row.reservationStatus ? (
          <span className={styles.cellWithPill}>
            {formatQuantity(row.reservedQuantity)}
            <StatusPill tone={row.reservationStatus === 'HELD' ? 'success' : row.reservationStatus === 'EXPIRED' ? 'danger' : 'neutral'}>
              {RESERVATION_STATUS_LABELS[row.reservationStatus]}
              {row.reservationSource === 'CONTRACT' ? ' (hợp đồng)' : ''}
            </StatusPill>
          </span>
        ) : (
          <span className={styles.muted}>Chưa giữ</span>
        ),
    },
    { title: 'Đã lập đợt', dataIndex: 'plannedQuantity', width: 100, align: 'right', render: (value: number) => formatQuantity(value) },
    {
      title: 'Đã giao',
      dataIndex: 'deliveredQuantity',
      width: 90,
      align: 'right',
      render: (value: number, row) => <span className={value >= row.quantity ? undefined : value > 0 ? styles.overdue : undefined}>{formatQuantity(value)}</span>,
    },
    { title: 'Giá vốn thực tế', dataIndex: 'actualCost', width: 130, align: 'right', render: (value: number, row) => (row.deliveredQuantity ? formatMoney(value) : '') },
    { title: 'Serial đã giao', key: 'serials', width: 200, render: (_: unknown, row) => row.serials.join(', ') },
    {
      title: '',
      key: 'actions',
      width: 60,
      fixed: 'right',
      render: (_: unknown, row) =>
        linesEditable ? (
          <Popconfirm
            title="Bỏ dòng này?"
            description="Thay dòng của đơn Nháp sẽ bỏ các đợt giao đã lập."
            okText="Bỏ"
            cancelText="Huỷ"
            okType="danger"
            onConfirm={() =>
              run(
                () => updateOrder(detail.id, { revision: detail.revision, lines: detail.lines.filter((line) => line.id !== row.id).map(lineRequest) }),
                'Đã bỏ dòng.',
              ).then(() => undefined)
            }
          >
            <button type="button" className={styles.rowActionDanger}>
              Bỏ
            </button>
          </Popconfirm>
        ) : null,
    },
  ];

  const warehouses = [...new Set(stock.flatMap((item) => item.byWarehouse.map((entry) => entry.warehouseCode)))].sort();

  return (
    <div className={styles.page}>
      <div className={styles.detailHead}>
        <button type="button" className={styles.buttonGhost} onClick={onBack}>
          <ArrowLeft size={14} /> Danh sách đơn bán
        </button>
        <h2 className={styles.detailTitle}>
          Đơn bán <span className={styles.mono}>{detail.code}</span>
        </h2>
        {detail.late ? <StatusPill tone="danger">Giao trễ</StatusPill> : null}
        <StatusPill tone={ORDER_STATUS_TONE[detail.status]}>{SALES_ORDER_STATUS_LABELS[detail.status]}</StatusPill>
      </div>

      <section className={styles.panel} aria-label="Thông tin đơn">
        <dl className={styles.facts}>
          <dt>Khách hàng</dt>
          <dd>
            <button type="button" className={styles.linkButton} onClick={() => onOpenCustomer(detail.customerId)}>
              {detail.customerCode} - {detail.customerName}
            </button>
          </dd>
          <dt>Nguồn</dt>
          <dd>
            {SALES_ORDER_SOURCE_LABELS[detail.source]}
            {detail.contractId ? (
              <>
                {' · '}
                <button type="button" className={styles.linkButton} onClick={() => onOpenContract(detail.contractId as string)}>
                  {detail.contractCode}
                </button>
              </>
            ) : null}
            {detail.quoteId ? (
              <>
                {' · '}
                <button type="button" className={styles.linkButton} onClick={() => onOpenQuote(detail.quoteId as string)}>
                  {detail.quoteCode}
                </button>
              </>
            ) : null}
          </dd>
          <dt>Ngày đơn</dt>
          <dd>{formatDay(detail.orderDate)}</dd>
          <dt>Giao dự kiến</dt>
          <dd>{formatDay(detail.expectedDeliveryDate) || <span className={styles.muted}>Chưa đặt</span>}</dd>
          <dt>Kho giữ hàng</dt>
          <dd>{detail.warehouseCode ?? <span className={styles.muted}>Chưa chọn</span>}</dd>
          {detail.reservationExpiresAt ? (
            <>
              <dt>Hạn giữ hàng</dt>
              <dd>{formatDateTime(detail.reservationExpiresAt)}</dd>
            </>
          ) : null}
          {detail.deliveryAddress ? (
            <>
              <dt>Địa chỉ giao</dt>
              <dd>{detail.deliveryAddress}</dd>
            </>
          ) : null}
          <dt>Người phụ trách</dt>
          <dd>{personName(people, detail.ownerUserId)}</dd>
          {detail.cancelReason ? (
            <>
              <dt>Lý do huỷ</dt>
              <dd>{detail.cancelReason}</dd>
            </>
          ) : null}
          {detail.closeReason ? (
            <>
              <dt>Lý do đóng</dt>
              <dd>{detail.closeReason}</dd>
            </>
          ) : null}
          {detail.note ? (
            <>
              <dt>Ghi chú</dt>
              <dd>{detail.note}</dd>
            </>
          ) : null}
        </dl>
        {detail.status === 'DELIVERED' ? (
          <p className={styles.muted}>Đơn tự hoàn tất khi còn phải thu bằng 0; quản lý kinh doanh có thể đóng tay kèm lý do (ví dụ đã xoá nợ bằng điều chỉnh).</p>
        ) : null}
        <OrderReceivablePanel detail={detail} busy={busy} run={run} onOpenReceivables={onOpenReceivables} />
        {actions.length ? (
          <div className={styles.toolbar}>
            {actions.includes('edit') ? (
              <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setEditing(true)}>
                Sửa thông tin giao
              </button>
            ) : null}
            {actions.includes('confirm') ? (
              <Popconfirm
                title="Xác nhận đơn?"
                description="Hàng tồn kho được giữ ở Kho cho mọi dòng; thiếu tồn thì không giữ dòng nào và báo dòng thiếu."
                okText="Xác nhận"
                cancelText="Huỷ"
                onConfirm={() => act('confirm').then(() => undefined)}
              >
                <button type="button" className={styles.buttonPrimary} disabled={busy}>
                  Xác nhận đơn
                </button>
              </Popconfirm>
            ) : null}
            {actions.includes('plan') ? (
              <button type="button" className={styles.buttonGhost} disabled={busy || !detail.lines.length} onClick={() => setPlanning('new')}>
                <Plus size={14} /> Thêm đợt giao
              </button>
            ) : null}
            {actions.includes('close') ? (
              <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setReasonFor('close')}>
                Đóng đơn
              </button>
            ) : null}
            {actions.includes('cancel') ? (
              <button type="button" className={styles.buttonDangerGhost} disabled={busy} onClick={() => setReasonFor('cancel')}>
                Huỷ đơn
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={styles.tableCard} aria-label="Dòng đơn">
        <div className={styles.toolbar}>
          <h3 className={styles.sectionTitle}>Dòng hàng</h3>
          {linesEditable ? (
            <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setPicking(true)}>
              <Plus size={14} /> Thêm dòng
            </button>
          ) : null}
        </div>
        <Table<SalesOrderLine>
          size="small"
          rowKey="id"
          columns={lineColumns}
          dataSource={[...detail.lines]}
          pagination={false}
          scroll={{ x: 1900 }}
          locale={{ emptyText: linesEditable ? 'Chưa có dòng nào. Bấm "Thêm dòng" để chọn mặt hàng.' : 'Không có dòng nào.' }}
        />
        <dl className={styles.facts}>
          <dt>Tiền hàng sau chiết khấu</dt>
          <dd>{formatMoney(detail.totals.netAmount)}</dd>
          {detail.totals.shippingAmount ? (
            <>
              <dt>Phí vận chuyển</dt>
              <dd>{formatMoney(detail.totals.shippingAmount)}</dd>
            </>
          ) : null}
          <dt>Thuế VAT</dt>
          <dd>{formatMoney(detail.totals.vatAmount)}</dd>
          <dt>Tổng cộng</dt>
          <dd>
            <strong>{formatMoney(detail.totals.totalAmount)}</strong>
          </dd>
        </dl>
        {stock.some((item) => item.byWarehouse.length) ? (
          <p className={styles.muted}>
            Tồn khả dụng theo kho:{' '}
            {stock
              .filter((item) => item.kind !== 'SERVICE')
              .map((item) => `${item.materialCode} (${item.byWarehouse.map((entry) => `${entry.warehouseCode}: ${formatQuantity(entry.available)}`).join(', ') || 'hết'})`)
              .join('; ')}
          </p>
        ) : null}
      </section>

      <section className={styles.tableCard} aria-label="Kế hoạch giao">
        <h3 className={styles.sectionTitle}>Kế hoạch giao</h3>
        {detail.deliveries.length ? (
          detail.deliveries.map((delivery) => (
            <DeliveryCard
              key={delivery.id}
              delivery={delivery}
              busy={busy}
              canWrite={actions.includes('plan') || canRequestDelivery(detail, delivery)}
              canRequest={canRequestDelivery(detail, delivery) && (capabilities.isTenantAdmin || capabilities.canWriteOrder)}
              onEdit={() => setPlanning(delivery)}
              onCancel={() => run(() => deliveryAction(detail.id, delivery.id, 'cancel', { revision: detail.revision }), 'Đã bỏ đợt giao.')}
              onRequest={() =>
                run(
                  () => deliveryAction(detail.id, delivery.id, 'request-issue', { revision: detail.revision }),
                  'Đã tạo yêu cầu xuất kho; thủ kho chọn lô, serial rồi ghi sổ trên màn Kho.',
                )
              }
            />
          ))
        ) : (
          <p className={styles.muted}>Chưa có đợt giao nào.</p>
        )}
      </section>

      <section className={styles.panel} aria-label="Nhật ký">
        <h3 className={styles.sectionTitle}>Nhật ký</h3>
        <ol className={styles.timeline}>
          {detail.history.map((entry) => (
            <li key={entry.id} className={styles.timelineItem}>
              <div>
                <div className={styles.timelineTitle}>
                  {FULFILLMENT_ACTION_LABELS[entry.action] ?? entry.action}
                  {entry.toStatus && entry.toStatus in SALES_ORDER_STATUS_LABELS
                    ? `: ${SALES_ORDER_STATUS_LABELS[entry.toStatus as keyof typeof SALES_ORDER_STATUS_LABELS]}`
                    : ''}
                </div>
                {entry.reason ? <div className={styles.muted}>{entry.reason}</div> : null}
                <div className={styles.timelineMeta}>
                  {formatDateTime(entry.at)} · {entry.actorId ? personName(people, entry.actorId) : 'Hệ thống'}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {editing ? (
        <OrderHeaderDialog
          order={detail}
          warehouses={warehouses}
          onClose={() => setEditing(false)}
          onSave={async (patch) => {
            if (await run(() => updateOrder(detail.id, { revision: detail.revision, ...patch }), 'Đã lưu.')) setEditing(false);
          }}
        />
      ) : null}
      {picking ? (
        <MaterialPickerDialog
          title="Thêm dòng đơn"
          onClose={() => setPicking(false)}
          onPick={async (picked) => {
            const done = await run(
              () =>
                updateOrder(detail.id, {
                  revision: detail.revision,
                  lines: [...detail.lines.map(lineRequest), { materialId: picked.material.id, quantity: picked.quantity ?? 1 }],
                }),
              'Đã thêm dòng; giá tính theo bảng giá, chính sách như báo giá.',
            );
            if (done) setPicking(false);
          }}
        />
      ) : null}
      {planning ? (
        <DeliveryDialog
          order={detail}
          delivery={planning === 'new' ? undefined : planning}
          onClose={() => setPlanning(undefined)}
          onSave={async (body) => {
            const done = await run(
              () => saveDelivery(detail.id, planning === 'new' ? null : planning.id, { revision: detail.revision, ...body }),
              'Đã lưu đợt giao.',
            );
            if (done) setPlanning(undefined);
          }}
        />
      ) : null}
      {reasonFor ? (
        <CrmReasonDialog
          title={reasonFor === 'cancel' ? 'Huỷ đơn bán' : 'Đóng đơn (Hoàn tất)'}
          label={reasonFor === 'cancel' ? 'Lý do huỷ' : 'Lý do đóng tay (ví dụ: xoá nợ bằng điều chỉnh)'}
          danger={reasonFor === 'cancel'}
          onClose={() => setReasonFor(undefined)}
          onConfirm={async (reason) => {
            if (await act(reasonFor, reason)) setReasonFor(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function DeliveryCard({
  delivery,
  busy,
  canWrite,
  canRequest,
  onEdit,
  onCancel,
  onRequest,
}: {
  delivery: DeliveryPlan;
  busy: boolean;
  canWrite: boolean;
  canRequest: boolean;
  onEdit: () => void;
  onCancel: () => Promise<boolean>;
  onRequest: () => Promise<boolean>;
}) {
  const columns: ColumnsType<DeliveryLine> = [
    { title: 'Dòng', dataIndex: 'lineNo', width: 60, align: 'right' },
    {
      title: 'Mặt hàng',
      key: 'material',
      render: (_: unknown, row) => (
        <span>
          <span className={styles.mono}>{row.materialCode}</span> {row.materialName}
          {row.materialKind === 'SERVICE' ? ' (dịch vụ, không xuất kho)' : ''}
        </span>
      ),
    },
    { title: 'Dự kiến', key: 'planned', width: 110, align: 'right', render: (_: unknown, row) => `${formatQuantity(row.plannedQuantity)} ${row.unit}` },
    { title: 'Đã giao', dataIndex: 'deliveredQuantity', width: 90, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: 'Giá vốn thực tế', dataIndex: 'actualCost', width: 130, align: 'right', render: (value: number, row) => (row.deliveredQuantity ? formatMoney(value) : '') },
    { title: 'Serial', key: 'serials', width: 220, render: (_: unknown, row) => row.serials.join(', ') },
  ];
  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <strong className={styles.mono}>{delivery.code}</strong>
        <StatusPill tone={DELIVERY_STATUS_TONE[delivery.status]}>{DELIVERY_STATUS_LABELS[delivery.status]}</StatusPill>
        {delivery.late ? <StatusPill tone="danger">Giao trễ</StatusPill> : null}
        <span className={styles.muted}>
          Ngày {formatDay(delivery.plannedDate)} · kho {delivery.warehouseCode ?? 'theo đơn'}
          {delivery.address ? ` · ${delivery.address}` : ''}
          {delivery.issueDocumentCode ? ` · chứng từ ${delivery.issueDocumentCode}` : ''}
        </span>
        {delivery.status === 'PLANNED' && canWrite ? (
          <>
            <button type="button" className={styles.rowAction} disabled={busy} onClick={onEdit}>
              Sửa
            </button>
            <Popconfirm title="Bỏ đợt giao này?" okText="Bỏ" cancelText="Huỷ" okType="danger" onConfirm={() => onCancel().then(() => undefined)}>
              <button type="button" className={styles.rowActionDanger} disabled={busy}>
                Bỏ đợt
              </button>
            </Popconfirm>
          </>
        ) : null}
        {canRequest ? (
          <Popconfirm
            title="Yêu cầu xuất kho?"
            description="Kho nhận chứng từ xuất nháp theo đơn bán cho các dòng hàng tồn kho của đợt; dòng dịch vụ không gửi Kho."
            okText="Yêu cầu xuất"
            cancelText="Huỷ"
            onConfirm={() => onRequest().then(() => undefined)}
          >
            <button type="button" className={styles.rowActionPrimary} disabled={busy}>
              Yêu cầu xuất kho
            </button>
          </Popconfirm>
        ) : null}
      </div>
      <Table<DeliveryLine> size="small" rowKey="id" columns={columns} dataSource={[...delivery.lines]} pagination={false} scroll={{ x: 900 }} />
    </div>
  );
}

/** Lập hoặc sửa một đợt giao: ngày, kho xuất, địa chỉ, số lượng từng dòng (tổng các đợt không vượt số lượng đơn). */
function DeliveryDialog({
  order,
  delivery,
  onClose,
  onSave,
}: {
  order: SalesOrderDetail;
  delivery?: DeliveryPlan;
  onClose: () => void;
  onSave: (body: { plannedDate: string; warehouseCode: string | null; address: string | null; note: string | null; lines: { orderLineId: string; quantity: number }[] }) => Promise<void>;
}) {
  const remaining = remainingToPlan(order, delivery);
  const [plannedDate, setPlannedDate] = useState(delivery?.plannedDate ?? order.expectedDeliveryDate ?? '');
  const [warehouseCode, setWarehouseCode] = useState(delivery?.warehouseCode ?? order.warehouseCode ?? '');
  const [address, setAddress] = useState(delivery?.address ?? order.deliveryAddress ?? '');
  const [note, setNote] = useState(delivery?.note ?? '');
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      order.lines.map((line) => {
        const own = delivery?.lines.find((entry) => entry.orderLineId === line.id)?.plannedQuantity;
        return [line.id, own !== undefined ? String(own) : delivery ? '' : String(remaining.get(line.id) ?? 0)];
      }),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    if (!plannedDate) return setError('Vui lòng nhập ngày giao dự kiến.');
    const lines = order.lines
      .map((line) => ({ orderLineId: line.id, quantity: parseNumber(quantities[line.id] ?? '') ?? 0 }))
      .filter((line) => line.quantity > 0);
    if (!lines.length) return setError('Đợt giao phải có ít nhất một dòng.');
    setSaving(true);
    try {
      await onSave({ plannedDate, warehouseCode: warehouseCode.trim() || null, address: address.trim() || null, note: note.trim() || null, lines });
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog open wide title={delivery ? `Sửa đợt ${delivery.code}` : 'Thêm đợt giao'} submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <div className={styles.fieldGrid}>
        <Field label="Ngày giao dự kiến" required>
          <DatePickerInput value={plannedDate || undefined} onChange={setPlannedDate} height={38} aria-label="Ngày giao dự kiến" />
        </Field>
        <Field label="Mã kho xuất" hint="Bỏ trống: kho của đơn; khác kho giữ hàng thì xuất từ tồn khả dụng">
          <input className={styles.input} maxLength={50} value={warehouseCode} onChange={(event) => setWarehouseCode(event.target.value.toUpperCase())} />
        </Field>
        <Field label="Địa chỉ giao" wide>
          <input className={styles.input} maxLength={500} value={address} onChange={(event) => setAddress(event.target.value)} />
        </Field>
        {order.lines.map((line) => (
          <Field
            key={line.id}
            label={`Dòng ${line.lineNo}: ${line.materialCode}`}
            hint={`Đơn ${formatQuantity(line.quantity)} ${line.unit}, còn lập được ${formatQuantity(remaining.get(line.id) ?? 0)}`}
          >
            <input
              className={styles.input}
              inputMode="decimal"
              value={quantities[line.id] ?? ''}
              onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
            />
          </Field>
        ))}
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

function OrderHeaderDialog({
  order,
  warehouses,
  onClose,
  onSave,
}: {
  order: SalesOrderDetail;
  warehouses: readonly string[];
  onClose: () => void;
  onSave: (patch: { expectedDeliveryDate: string | null; warehouseCode: string | null; deliveryAddress: string | null; note: string | null }) => Promise<void>;
}) {
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(order.expectedDeliveryDate ?? '');
  const [warehouseCode, setWarehouseCode] = useState(order.warehouseCode ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState(order.deliveryAddress ?? '');
  const [note, setNote] = useState(order.note ?? '');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await onSave({
        expectedDeliveryDate: expectedDeliveryDate || null,
        warehouseCode: warehouseCode.trim() || null,
        deliveryAddress: deliveryAddress.trim() || null,
        note: note.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <CrmDialog open title="Thông tin giao hàng" submitting={saving} onClose={onClose} onSubmit={() => void save()}>
      <div className={styles.fieldGrid}>
        <Field label="Ngày giao dự kiến" hint="Hạn giữ hàng = ngày giao dự kiến + 2 ngày">
          <DatePickerInput value={expectedDeliveryDate || undefined} onChange={setExpectedDeliveryDate} height={38} aria-label="Ngày giao dự kiến" />
        </Field>
        <Field label="Mã kho giữ hàng" hint={warehouses.length ? `Kho đang có hàng: ${warehouses.join(', ')}` : undefined}>
          <input className={styles.input} maxLength={50} value={warehouseCode} onChange={(event) => setWarehouseCode(event.target.value.toUpperCase())} />
        </Field>
        <Field label="Địa chỉ giao" wide>
          <input className={styles.input} maxLength={500} value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} />
        </Field>
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

function CrmReasonDialog({
  title,
  label,
  danger,
  onClose,
  onConfirm,
}: {
  title: string;
  label: string;
  danger: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function save() {
    if (!reason.trim()) return setError('Vui lòng ghi lý do.');
    setSaving(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setSaving(false);
    }
  }
  return (
    <CrmDialog open danger={danger} title={title} submitLabel="Xác nhận" submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <Field label={label} required wide>
        <textarea className={styles.textarea} rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}
