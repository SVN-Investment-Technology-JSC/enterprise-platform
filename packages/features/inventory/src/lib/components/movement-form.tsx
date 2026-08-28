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
  procedures = [],
  units = [],
  reservations = [],
  workOrders = [],
  busy,
  onCancel,
  onSubmit,
}: {
  workspace: InventoryWorkspace;
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
  const [kind, setKind] = useState<MovementKind>('receipt');
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

  /**
   * Hai mức khác hẳn nhau, và trước đây bị gộp làm một.
   *
   * `overdraw` là xuất nhiều hơn số hàng CÓ THẬT trong kho — chuyện đó không xảy
   * ra được, server cũng từ chối, nên chặn luôn ở đây cho đỡ mất công gõ lại.
   *
   * `eatsReserved` là hàng vẫn còn nhưng phần đó đã hứa cho một work order khác.
   * Đây là chuyện thường ngày và thủ kho mới là người biết nên ưu tiên ai, nên
   * chỉ BÁO chứ không chặn. Bản trước chặn cứng cả trường hợp này, tức khoá luôn
   * cả lệnh xuất để giao hàng cho chính work order đã giữ chỗ.
   */
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

  return (
    <form className={styles.card} onSubmit={submit}>
      <div className={styles.cardHead}>
        <h2>Phát sinh tồn kho</h2>
      </div>

      <div className={styles.chipRow}>
        {(Object.keys(KIND_LABEL) as MovementKind[]).map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.chip} ${kind === value ? styles.chipOn : ''}`}
            onClick={() => setKind(value)}
          >
            {KIND_LABEL[value]}
          </button>
        ))}
      </div>

      <div className={styles.formGrid}>
        <label>
          {kind === 'transfer' ? 'Kho nguồn *' : 'Kho *'}
          <select
            required
            value={warehouseCode}
            onChange={(event) => setWarehouseCode(event.target.value)}
          >
            {workspace.warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.code}>
                {warehouse.code} — {warehouse.name}
              </option>
            ))}
          </select>
        </label>

        {kind === 'transfer' ? (
          <label>
            Kho đích *
            <select
              required
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
          </label>
        ) : null}

        <label>
          Vật tư *
          <select
            required
            value={materialCode}
            onChange={(event) => setMaterialCode(event.target.value)}
          >
            <option value="">— Chọn vật tư —</option>
            {/* Mã chưa có trong danh mục là chuyện thường ngày lúc nhập hàng
                mới về. Bắt người dùng thoát ra, tạo mã, rồi quay lại gõ lại cả
                phiếu là ba nhịp thừa cho một việc. */}
            <option value={NEW_MATERIAL}>+ Vật tư mới…</option>
            {workspace.materials.map((item) => (
              <option key={item.id} value={item.code}>
                {item.code} — {item.name}
              </option>
            ))}
          </select>
          {materialCode ? (
            <small className={overdraw ? styles.overdraw : undefined}>
              Tại {warehouseCode}: {formatNumber(onHand)} {material?.unit ?? ''} trong kho
              {onHand !== available
                ? `, khả dụng ${formatNumber(available)} (đã trừ phần giữ chỗ)`
                : ''}
            </small>
          ) : null}
        </label>

        {/* Nhu cầu đang chờ đứng ngay dưới ô chọn vật tư, trước ô số lượng: đó
            đúng là thứ tự thủ kho cần đọc — chọn mã, xem ai đang chờ, rồi mới
            quyết ghi bao nhiêu. */}
        {creating ? (
          <div className={styles.newMaterial}>
            <label>
              Mã SKU *
              <input
                required
                value={draft.code}
                placeholder="VD: VT-DAU-MBA"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, code: event.target.value }))
                }
              />
            </label>
            <label>
              Tên vật tư *
              <input
                required
                value={draft.name}
                placeholder="VD: Dầu cách điện máy biến áp"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label>
              Đơn vị tính *
              <select
                required
                value={draft.unit}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, unit: event.target.value }))
                }
              >
                <option value="">— Chọn đơn vị —</option>
                {units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tồn tối thiểu
              <input
                type="number"
                min={0}
                value={draft.minStock}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, minStock: event.target.value }))
                }
              />
            </label>
          </div>
        ) : null}

        <MaterialDemandPanel
          materialCode={materialCode}
          materials={workspace.materials}
          warehouses={workspace.warehouses}
          reservations={reservations}
          workOrders={workOrders}
        />

        <label>
          Số lượng *
          <input
            required
            type="number"
            min={0}
            step="any"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          {overdraw ? (
            <small className={styles.overdraw}>
              Kho chỉ có {formatNumber(onHand)} {material?.unit ?? ''}.
            </small>
          ) : null}
          {eatsReserved ? (
            <small className={styles.encroach}>
              Lấn {formatNumber(amount - available)} {material?.unit ?? ''} vào phần đang giữ cho
              work order bên dưới. Vẫn xuất được — chỉ cần biết là phần giữ chỗ đó sẽ thiếu.
            </small>
          ) : null}
        </label>

        {/* Khai sê-ri chỉ có nghĩa ở chiều NHẬP: xuất hay chuyển là thao tác trên
            hàng đã có sê-ri từ trước. Và luôn là tuỳ chọn — nhiều mã không theo
            dõi theo cá thể, bắt nhập sẽ chặn mọi phiếu của chúng. */}
        {kind === 'receipt' ? (
          <div className={styles.serialOptIn}>
            <label>
              <input
                type="checkbox"
                checked={withSerials}
                onChange={(event) => setWithSerials(event.target.checked)}
              />
              Khai số sê-ri cho lô này
            </label>
            {withSerials ? (
              <>
                <textarea
                  rows={3}
                  value={serialDraft}
                  aria-label="Số sê-ri"
                  placeholder="Mỗi sê-ri một dòng, hoặc ngăn bằng dấu phẩy"
                  onChange={(event) => setSerialDraft(event.target.value)}
                />
                <small>
                  Đã nhập {parseSerials(serialDraft).length} sê-ri
                  {amount > 0 ? ` / ${formatNumber(amount)} ${material?.unit ?? ''}` : ''}. Không
                  cần đủ — khai được bao nhiêu ghi bấy nhiêu, số còn lại bổ sung sau trong hồ sơ
                  vật tư.
                </small>
              </>
            ) : null}
          </div>
        ) : null}

        {kind === 'receipt' ? (
          <label>
            Đơn giá
            <input
              type="number"
              min={0}
              step="any"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      <label>
        Lý do / chứng từ *
        <input
          required
          placeholder="VD: Nhập theo hoá đơn HD-2026-118, hoặc xuất cho workorder PR-..."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <label>
        Quy trình mở work order
        {/* Mỗi lệnh kho đều phải có quy trình đứng sau. Thủ kho chọn thủ tục
            nào áp cho lệnh này; hệ thống không đoán hộ vì mỗi tenant có bộ thủ
            tục riêng. Quy trình không đọc được thì danh sách rỗng và lệnh vẫn
            thực hiện được — thà thiếu work order còn hơn khoá cứng kho. */}
        <select
          value={procedureDefinitionId}
          onChange={(event) => setProcedureDefinitionId(event.target.value)}
        >
          <option value="">
            {procedures.length === 0 ? '— Chưa đọc được danh sách quy trình —' : '— Không mở work order —'}
          </option>
          {procedures.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} · {item.name}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.editActions}>
        <button
          type="submit"
          className={`${styles.action} ${styles.actionPrimary}`}
          disabled={busy || overdraw}
        >
          {busy ? 'Đang ghi sổ…' : KIND_LABEL[kind]}
        </button>
        <button type="button" className={`${styles.action} ${styles.actionGhost}`} onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </form>
  );
}
