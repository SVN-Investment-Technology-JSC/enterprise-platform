'use client';

import type { Reservation } from '@enterprise-platform/contracts-inventory';
import { X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import type { InventoryWorkspace, ProcedureOption, ProcedureWorkOrder } from '../inventory-api';
import { MaterialDemandPanel } from './material-demand-panel';
import { formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

export type MovementKind = 'receipt' | 'issue' | 'transfer' | 'adjust';

const KIND_LABEL: Record<MovementKind, string> = {
  receipt: 'Nhập kho',
  issue: 'Xuất kho',
  transfer: 'Chuyển kho',
  adjust: 'Điều chỉnh / Từ chối',
};

export interface MovementInput {
  readonly kind: MovementKind;
  readonly warehouseCode: string;
  readonly toWarehouseCode?: string;
  readonly materialCode: string;
  readonly quantity: number;
  readonly unitCost?: number;
  readonly note: string;
  /** Quy trình sẽ mở work order cho lệnh này. Bỏ trống thì không mở. */
  readonly procedureDefinitionId?: string;
  /**
   * Số sê-ri khai kèm phiếu nhập. Bỏ trống là không khai — hoàn toàn tuỳ chọn.
   *
   * Đây là thời điểm duy nhất người ta cầm hiện vật trong tay và đọc được sê-ri.
   * Bỏ qua lúc này thì sau phải ra tận hiện trường mới điền được.
   */
  readonly serialNumbers?: readonly string[];
  /** Mã cần tạo trước khi ghi phiếu, khi người dùng chọn "+ Vật tư mới…". */
  readonly newMaterial?: {
    readonly code: string;
    readonly name: string;
    readonly unit: string;
    readonly minStock: number;
  };
}

/**
 * Nhập / xuất / chuyển kho.
 *
 * Ba lệnh này đã có endpoint từ lâu nhưng chưa nút nào gọi, nên tới giờ mọi phát
 * sinh tồn kho đều phải làm ngoài hệ thống. Ghi chú để bắt buộc: một dòng sổ cái
 * không có lý do thì sáu tháng sau không ai đối chiếu được.
 */
/** Nhận cả xuống dòng, dấu phẩy và chấm phẩy: người dùng hay dán một cột Excel. */
function parseSerials(draft: string): string[] {
  return [
    ...new Set(
      draft
        .split(/[\n,;]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

/** Giá trị canh chừng cho lựa chọn "tạo mã mới" trong ô chọn vật tư. */
const NEW_MATERIAL = '__new__';

export function MovementForm({
  workspace,
  initialKind = 'receipt',
  title,
  description,
  procedures = [],
  units = [],
  reservations = [],
  workOrders = [],
  busy,
  isDialog = false,
  onCancel,
  onSubmit,
}: {
  workspace: InventoryWorkspace;
  initialKind?: MovementKind;
  title?: string;
  description?: string;
  /** Quy trình đã công bố, để mở work order kèm lệnh kho. */
  procedures?: readonly ProcedureOption[];
  /** Danh mục đơn vị tính, cho ô tạo mã mới. */
  units?: readonly string[];
  /** Phiếu giữ chỗ, để hiện mã nào đang có người chờ. */
  reservations?: readonly Reservation[];
  /** Hồ sơ bên Quy trình, để gọi tên work order thay vì hiện id. */
  workOrders?: readonly ProcedureWorkOrder[];
  busy: boolean;
  isDialog?: boolean;
  onCancel: () => void;
  onSubmit: (input: MovementInput) => void;
}) {
  const [kind, setKind] = useState<MovementKind>(initialKind);
  const [procedureDefinitionId, setProcedureDefinitionId] = useState('');
  const [warehouseCode, setWarehouseCode] = useState(workspace.warehouses[0]?.code ?? '');
  const [toWarehouseCode, setToWarehouseCode] = useState('');
  const [materialCode, setMaterialCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [note, setNote] = useState('');
  const [withSerials, setWithSerials] = useState(false);
  /** Bản nháp mã mới, chỉ dùng khi người dùng chọn "+ Vật tư mới…". */
  const [draft, setDraft] = useState({ code: '', name: '', unit: '', minStock: '0' });
  const creating = materialCode === NEW_MATERIAL;
  const [serialDraft, setSerialDraft] = useState('');

  const material = workspace.materials.find((item) => item.code === materialCode);
  const row = workspace.stock.find(
    (item) => item.materialCode === materialCode && item.warehouseCode === warehouseCode,
  );
  /** Đã trừ phần giữ chỗ — cột `available` của database là `quantity - reserved`. */
  const available = row?.available ?? 0;
  /** Hàng thật đang nằm trong kho, kể cả phần đã hứa cho work order khác. */
  const onHand = row?.quantity ?? 0;
  const amount = Number(quantity) || 0;
  const outbound = kind === 'issue' || kind === 'transfer';

  // Lọc và sắp xếp danh sách nhà kho:
  // - Khi Nhập kho (receipt): hiện tất cả kho
  // - Khi Xuất kho (issue) hoặc Chuyển kho (transfer):
  //   + Chưa chọn vật tư: rỗng (không có option nào)
  //   + Đã chọn vật tư: CHỈ hiện các kho thực tế đang có tồn kho > 0 của vật tư đó. Nếu không kho nào có tồn kho thì mảng rỗng []
  const filteredSourceWarehouses = useMemo(() => {
    if (kind === 'receipt') {
      return workspace.warehouses;
    }
    if (!materialCode || materialCode === NEW_MATERIAL) {
      return [];
    }
    return workspace.warehouses.filter((w) => {
      const stockItem = workspace.stock.find(
        (s) => s.materialCode === materialCode && s.warehouseCode === w.code,
      );
      return (stockItem?.quantity ?? 0) > 0;
    });
  }, [workspace.warehouses, workspace.stock, materialCode, kind]);

  const overdraw = outbound && (filteredSourceWarehouses.length === 0 || amount > onHand);
  const eatsReserved = outbound && !overdraw && amount > available;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (overdraw || (outbound && filteredSourceWarehouses.length === 0) || !warehouseCode) return;
    onSubmit({
      kind,
      warehouseCode,
      toWarehouseCode: kind === 'transfer' ? toWarehouseCode : undefined,
      materialCode,
      quantity: amount,
      unitCost: kind === 'receipt' && unitCost ? Number(unitCost) : undefined,
      note: note.trim(),
      procedureDefinitionId: procedureDefinitionId || undefined,
      serialNumbers: withSerials ? parseSerials(serialDraft) : undefined,
      newMaterial: creating
        ? {
          code: draft.code.trim().toUpperCase(),
          name: draft.name.trim(),
          unit: draft.unit,
          minStock: Number(draft.minStock) || 0,
        }
        : undefined,
    });
  };

  // Tiêu đề và mô tả phù hợp cho từng loại nghiệp vụ
  const resolvedTitle =
    title ??
    (kind === 'receipt'
      ? 'Phiếu Nhập Kho Vật Tư'
      : kind === 'transfer'
        ? 'Lệnh Điều Chuyển Kho Nội Bộ'
        : 'Phiếu Xuất Kho Sử Dụng');

  const resolvedDescription =
    description ??
    (kind === 'receipt'
      ? 'Ghi nhận lô hàng mới, thiết bị mua sắm hoặc hoàn kho kèm đơn giá và danh sách sê-ri.'
      : kind === 'transfer'
        ? 'Điều chuyển vật tư, thiết bị dự phòng giữa các kho trực thuộc trong hệ thống.'
        : 'Xuất kho vật tư phục vụ công tác sửa chữa, bảo dưỡng hoặc thay thế theo kế hoạch.');

  const formContent = (
    <>
      {/* Header Form/Dialog */}
      <div className={isDialog ? styles.modalHead : styles.cardHead}>
        <div>
          <h2 style={{ margin: 0, fontSize: isDialog ? '18px' : '18px', fontWeight: 700, color: '#0f172a' }}>
            {resolvedTitle}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>{resolvedDescription}</p>
        </div>
        {isDialog ? (
          <button
            type="button"
            className={styles.closeButton}
            onClick={onCancel}
            title="Đóng (ESC)"
            aria-label="Đóng"
          >
            <X size={18} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      <div className={isDialog ? styles.modalBody : ''} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Bộ chọn chuyển đổi nhanh loại tác vụ khi mở từ Popup chung */}
        {isDialog ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px', background: '#f1f5f9', borderRadius: '8px', width: 'fit-content' }}>
            <button
              type="button"
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                background: kind === 'receipt' ? '#ffffff' : 'transparent',
                color: kind === 'receipt' ? '#166534' : '#64748b',
                boxShadow: kind === 'receipt' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
              onClick={() => setKind('receipt')}
            >
              Nhập kho
            </button>
            <button
              type="button"
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                background: kind === 'issue' ? '#ffffff' : 'transparent',
                color: kind === 'issue' ? '#1d4ed8' : '#64748b',
                boxShadow: kind === 'issue' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
              onClick={() => {
                setKind('issue');
                if (materialCode === NEW_MATERIAL) setMaterialCode('');
              }}
            >
              Xuất kho
            </button>
            <button
              type="button"
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                background: kind === 'transfer' ? '#ffffff' : 'transparent',
                color: kind === 'transfer' ? '#b45309' : '#64748b',
                boxShadow: kind === 'transfer' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
              onClick={() => {
                setKind('transfer');
                if (materialCode === NEW_MATERIAL) setMaterialCode('');
              }}
            >
              Chuyển kho
            </button>
          </div>
        ) : null}

        {/* Hàng 1: Vật tư cần tác nghiệp (đưa lên đầu tiên) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              Vật tư<span style={{ color: '#dc2626' }}>*</span>
            </label>
            {materialCode && warehouseCode ? (
              <span style={{ fontSize: '12px', color: overdraw ? '#dc2626' : '#64748b', fontWeight: 500 }}>
                Tại {warehouseCode}: <strong>{formatNumber(onHand)} {material?.unit ?? ''}</strong> trong kho
                {onHand !== available
                  ? ` · (Khả dụng: ${formatNumber(available)})`
                  : ''}
              </span>
            ) : null}
          </div>
          <select
            required
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '13.5px',
              background: '#ffffff',
              outline: 'none',
            }}
            value={materialCode}
            onChange={(event) => {
              const newMatCode = event.target.value;
              setMaterialCode(newMatCode);
              if (kind === 'receipt') {
                if (!warehouseCode) {
                  setWarehouseCode(workspace.warehouses[0]?.code ?? '');
                }
              } else {
                // Với Xuất kho hoặc Chuyển kho:
                if (newMatCode && newMatCode !== NEW_MATERIAL) {
                  const stockEntries = workspace.stock.filter(
                    (s) => s.materialCode === newMatCode && s.quantity > 0,
                  );
                  if (stockEntries.length > 0) {
                    // Nếu kho hiện tại cũng có hàng thì giữ nguyên, ngược lại chuyển sang kho có hàng đầu tiên
                    if (!stockEntries.some((s) => s.warehouseCode === warehouseCode)) {
                      setWarehouseCode(stockEntries[0].warehouseCode ?? '');
                    }
                  } else {
                    // Không có kho nào có tồn kho
                    setWarehouseCode('');
                  }
                } else {
                  setWarehouseCode('');
                }
              }
            }}
          >
            <option value="">— Chọn vật tư —</option>
            {/* Chỉ cho phép khai báo vật tư mới khi là nghiệp vụ Nhập kho (receipt) */}
            {kind === 'receipt' ? (
              <option value={NEW_MATERIAL}>+ Khai báo vật tư mới…</option>
            ) : null}
            {workspace.materials.map((item) => (
              <option key={item.id} value={item.code}>
                {item.code} — {item.name} {item.unit ? `(${item.unit})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Hàng 2: Kho nguồn & Kho đích (đã lọc danh sách kho theo vật tư liên quan) */}
        <div style={{ display: 'grid', gridTemplateColumns: kind === 'transfer' ? '1fr 1fr' : '1fr', gap: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                {kind === 'transfer' ? 'Kho nguồn xuất đi' : 'Kho'} <span style={{ color: '#dc2626' }}>*</span>
              </label>
              {materialCode && outbound ? (
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  {filteredSourceWarehouses.length} kho có tồn kho
                </span>
              ) : null}
            </div>
            <select
              required
              disabled={outbound && filteredSourceWarehouses.length === 0}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: outbound && materialCode && filteredSourceWarehouses.length === 0 ? '1px solid #fca5a5' : '1px solid #cbd5e1',
                fontSize: '13.5px',
                background: outbound && filteredSourceWarehouses.length === 0 ? '#fef2f2' : '#ffffff',
                color: outbound && filteredSourceWarehouses.length === 0 ? '#991b1b' : 'inherit',
                outline: 'none',
                cursor: outbound && filteredSourceWarehouses.length === 0 ? 'not-allowed' : 'default',
              }}
              value={warehouseCode}
              onChange={(event) => setWarehouseCode(event.target.value)}
            >
              {outbound && !materialCode ? (
                <option value="">— Vui lòng chọn vật tư trước —</option>
              ) : outbound && filteredSourceWarehouses.length === 0 ? (
                <option value="">— Hết hàng trong tất cả kho —</option>
              ) : null}
              {filteredSourceWarehouses.map((warehouse) => {
                const stockItem = materialCode
                  ? workspace.stock.find(
                    (s) => s.materialCode === materialCode && s.warehouseCode === warehouse.code,
                  )
                  : undefined;
                const qtyText = stockItem ? ` (Tồn: ${formatNumber(stockItem.quantity)})` : '';
                return (
                  <option key={warehouse.id} value={warehouse.code}>
                    {warehouse.code} — {warehouse.name}{qtyText}
                  </option>
                );
              })}
            </select>
            {outbound && materialCode && filteredSourceWarehouses.length === 0 ? (
              <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 500, marginTop: '2px' }}>
                Vật tư này hiện không còn tồn kho ở bất kỳ kho nào để xuất.
              </span>
            ) : null}
          </div>

          {kind === 'transfer' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                Kho đích tiếp nhận <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <select
                required
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13.5px',
                  background: '#ffffff',
                  outline: 'none',
                }}
                value={toWarehouseCode}
                onChange={(event) => setToWarehouseCode(event.target.value)}
              >
                <option value="">— Chọn kho đích —</option>
                {workspace.warehouses
                  .filter((warehouse) => warehouse.code !== warehouseCode)
                  .map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.code}>
                      {warehouse.code} — {warehouse.name}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
        </div>

        {/* Form khai báo vật tư mới (nếu chọn + Khai báo vật tư mới) */}
        {creating ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.2fr 1.8fr 1fr 1fr',
              gap: '12px',
              padding: '14px',
              borderRadius: '8px',
              background: '#f8fafc',
              border: '1px dashed #93c5fd',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                Mã SKU <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                required
                style={{ padding: '6px 10px', fontSize: '13px', borderRadius: '5px', border: '1px solid #cbd5e1', outline: 'none' }}
                value={draft.code}
                placeholder="VD: VT-DAU-MBA"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, code: event.target.value }))
                }
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                Tên vật tư <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                required
                style={{ padding: '6px 10px', fontSize: '13px', borderRadius: '5px', border: '1px solid #cbd5e1', outline: 'none' }}
                value={draft.name}
                placeholder="VD: Dầu cách điện máy biến áp"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                Đơn vị tính <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <select
                required
                style={{ padding: '6px 10px', fontSize: '13px', borderRadius: '5px', border: '1px solid #cbd5e1', outline: 'none', background: '#ffffff' }}
                value={draft.unit}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, unit: event.target.value }))
                }
              >
                <option value="">— Chọn ĐVT —</option>
                {units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                Tồn an toàn tối thiểu
              </label>
              <input
                type="number"
                min={0}
                style={{ padding: '6px 10px', fontSize: '13px', borderRadius: '5px', border: '1px solid #cbd5e1', outline: 'none' }}
                value={draft.minStock}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, minStock: event.target.value }))
                }
              />
            </div>
          </div>
        ) : null}

        <MaterialDemandPanel
          materialCode={materialCode}
          materials={workspace.materials}
          warehouses={workspace.warehouses}
          reservations={reservations}
          workOrders={workOrders}
        />

        {/* Hàng 3: Số lượng & Đơn giá (Nhập kho) */}
        <div style={{ display: 'grid', gridTemplateColumns: kind === 'receipt' ? '1fr 1fr' : '1fr', gap: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              Số lượng {material?.unit ? `(${material.unit})` : ''} <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              required
              type="number"
              min={0.0001}
              step="any"
              placeholder="Nhập số lượng phát sinh…"
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: overdraw ? '1px solid #ef4444' : '1px solid #cbd5e1',
                fontSize: '13.5px',
                outline: 'none',
              }}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
            {overdraw ? (
              <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>
                Không thể xuất/chuyển quá tồn thực tế trong kho ({formatNumber(onHand)} {material?.unit ?? ''}).
              </span>
            ) : null}
            {eatsReserved ? (
              <span style={{ fontSize: '12px', color: '#d97706', fontWeight: 500 }}>
                ℹ Lấn {formatNumber(amount - available)} {material?.unit ?? ''} vào phần đang giữ chỗ cho Lệnh công tác (WO).
              </span>
            ) : null}
          </div>

          {kind === 'receipt' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                Đơn giá nhập kho (VNĐ)
              </label>
              <input
                type="number"
                min={0}
                step="any"
                placeholder="VD: 250000"
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13.5px',
                  outline: 'none',
                }}
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
              />
            </div>
          ) : null}
        </div>

        {/* Tùy chọn khai báo số sê-ri khi Nhập kho */}
        {kind === 'receipt' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: '#1e293b', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={withSerials}
                onChange={(event) => setWithSerials(event.target.checked)}
              />
              Khai báo danh sách số Sê-ri / Barcode cho lô này
            </label>
            {withSerials ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '4px' }}>
                <textarea
                  rows={3}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    outline: 'none',
                    fontFamily: 'monospace',
                  }}
                  value={serialDraft}
                  aria-label="Số sê-ri"
                  placeholder="Dán hoặc nhập danh sách sê-ri (mỗi dòng một mã, hoặc ngăn cách bằng dấu phẩy)..."
                  onChange={(event) => setSerialDraft(event.target.value)}
                />
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Đã nhận diện: <strong>{parseSerials(serialDraft).length}</strong> sê-ri
                  {amount > 0 ? ` / ${formatNumber(amount)} ${material?.unit ?? ''}` : ''}. Có thể cập nhật bổ sung sau tại hồ sơ thiết bị.
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Hàng 4: Lý do chứng từ & Quy trình work order */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              Lý do / Chứng từ đính kèm <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              required
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13.5px',
                outline: 'none',
              }}
              placeholder="VD: Hóa đơn HD-2026-118, hoặc xuất cho Lệnh PR-082…"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              Quy trình liên kết mở Work Order
            </label>
            <select
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13.5px',
                background: '#ffffff',
                outline: 'none',
              }}
              value={procedureDefinitionId}
              onChange={(event) => setProcedureDefinitionId(event.target.value)}
            >
              <option value="">
                {procedures.length === 0 ? '— Không có quy trình —' : '— Không mở Work Order —'}
              </option>
              {procedures.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className={isDialog ? styles.modalFoot : styles.editActions} style={isDialog ? {} : { marginTop: '8px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
        <button
          type="button"
          className={`${styles.action} ${styles.actionGhost}`}
          onClick={onCancel}
        >
          Huỷ
        </button>
        <button
          type="submit"
          className={`${styles.action} ${styles.actionPrimary}`}
          disabled={busy || overdraw || !materialCode || amount <= 0}
        >
          {busy ? 'Đang ghi sổ…' : `Xác nhận ${KIND_LABEL[kind]}`}
        </button>
      </div>
    </>
  );

  if (isDialog) {
    return (
      <div className={styles.modalOverlay} onClick={onCancel}>
        <div
          className={styles.modalDialog}
          style={{
            maxWidth: '680px',
            background: '#ffffff',
            borderRadius: '12px',
            boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {formContent}
          </form>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.card} onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {formContent}
    </form>
  );
}
