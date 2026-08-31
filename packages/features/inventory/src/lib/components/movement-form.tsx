'use client';

import type { Reservation } from '@enterprise-platform/contracts-inventory';
import { useState, type FormEvent } from 'react';
import type { InventoryWorkspace, ProcedureOption, ProcedureWorkOrder } from '../inventory-api';
import { MaterialDemandPanel } from './material-demand-panel';
import { formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

export type MovementKind = 'receipt' | 'issue' | 'transfer';

const KIND_LABEL: Record<MovementKind, string> = {
  receipt: 'Nhập kho',
  issue: 'Xuất kho',
  transfer: 'Chuyển kho',
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

  const overdraw = outbound && amount > onHand;
  const eatsReserved = outbound && !overdraw && amount > available;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (overdraw) return;
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

  return (
    <form className={styles.card} onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className={styles.cardHead}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>{resolvedTitle}</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>{resolvedDescription}</p>
        </div>
      </div>

      {/* Hàng 1: Kho nguồn & Kho đích (nếu chuyển kho) */}
      <div style={{ display: 'grid', gridTemplateColumns: kind === 'transfer' ? '1fr 1fr' : '1fr', gap: '14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            {kind === 'transfer' ? 'Kho nguồn xuất đi' : 'Kho tiếp nhận / thao tác'} <span style={{ color: '#dc2626' }}>*</span>
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
            value={warehouseCode}
            onChange={(event) => setWarehouseCode(event.target.value)}
          >
            {workspace.warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.code}>
                {warehouse.code} — {warehouse.name}
              </option>
            ))}
          </select>
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

      {/* Hàng 2: Vật tư cần tác nghiệp */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            Vật tư tác nghiệp <span style={{ color: '#dc2626' }}>*</span>
          </label>
          {materialCode ? (
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
          onChange={(event) => setMaterialCode(event.target.value)}
        >
          <option value="">— Chọn vật tư —</option>
          <option value={NEW_MATERIAL}>+ Khai báo vật tư mới…</option>
          {workspace.materials.map((item) => (
            <option key={item.id} value={item.code}>
              {item.code} — {item.name} {item.unit ? `(${item.unit})` : ''}
            </option>
          ))}
        </select>
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
              ⚠️ Không thể xuất/chuyển quá tồn thực tế trong kho ({formatNumber(onHand)} {material?.unit ?? ''}).
            </span>
          ) : null}
          {eatsReserved ? (
            <span style={{ fontSize: '12px', color: '#d97706', fontWeight: 500 }}>
              ℹ️ Lấn {formatNumber(amount - available)} {material?.unit ?? ''} vào phần đang giữ chỗ cho Lệnh công tác (WO).
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

      {/* Footer Actions */}
      <div className={styles.editActions} style={{ marginTop: '8px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
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
    </form>
  );
}
