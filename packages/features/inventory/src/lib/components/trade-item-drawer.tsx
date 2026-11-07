'use client';

import type {
  InventoryTradeCatalog,
  Material,
  UpdateMaterialRequest,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { CloseGuard, Popconfirm, SearchableSelect, VnNumberInput } from '@enterprise-platform/shared-ui';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { formatDateTime } from '../inventory-labels';
import styles from '../inventory.module.scss';
import { useUserLabel } from '../user-names';
import {
  TRADE_GROUP_LABEL,
  categoriesOf,
  formatSalePrice,
  tradeGroupOf,
  usageLabel,
  withCurrent,
} from '../trade-items.model';
import {
  DrawerField,
  DrawerSection,
  MaterialHistorySection,
  MaterialStockSection,
  type StockRow,
} from './material-drawer-sections';
import { FormError, submitErrorMessage, useFormSubmit } from './form-error';
import { TradeStatusBadge } from './trade-status-badge';

const inputStyle: CSSProperties = {
  width: '100%',
  height: '36px',
  padding: '0 10px',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  fontSize: '14px',
  color: '#0f172a',
  background: '#ffffff',
  boxSizing: 'border-box',
};

/** Một trường ở chế độ sửa, cùng dáng nhãn với `DrawerField`. */
function EditField({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
      <label htmlFor={htmlFor} style={{ fontSize: '12px', fontWeight: 700, color: '#64748b' }}>
        {label}
        {required ? <span style={{ color: '#dc2626' }}> *</span> : null}
      </label>
      {children}
    </div>
  );
}

interface Draft {
  name: string;
  barcode: string;
  category: string;
  unit: string;
  usage: string;
  price: string;
  description: string;
}

function draftOf(item: Material): Draft {
  return {
    name: item.name,
    barcode: item.barcode ?? '',
    category: item.tradeCategory ?? '',
    unit: item.unit,
    usage: usageLabel(item.tradeMode),
    price: item.salePrice === undefined ? '' : String(item.salePrice),
    description: item.description ?? '',
  };
}

/**
 * Chi tiết một mặt hàng: các trường của bảng, thêm người khai báo, thời gian khai báo, barcode,
 * rồi nhóm lịch sử xuất nhập và nhóm tồn kho. Dịch vụ không quản lý tồn nên hai nhóm sau chỉ báo lý do.
 * Nút Sửa biến nhóm Thông tin chung thành ô nhập ngay trên drawer; mã, nhóm, trạng thái và dấu vết
 * khai báo không sửa được (đổi nhóm bị Kho chặn khi mã đã có tồn hoặc bút toán).
 */
export function TradeItemDrawer({
  item,
  warehouses,
  stock,
  canManage,
  busy,
  catalog,
  units = [],
  onSave,
  onRetire,
  onReactivate,
  onDelete,
  onClose,
}: {
  item: Material;
  warehouses: readonly Warehouse[];
  stock: readonly StockRow[];
  canManage: boolean;
  busy?: boolean;
  catalog?: InventoryTradeCatalog;
  /** Danh mục đơn vị tính khai ở Cài đặt; rỗng thì cho gõ tự do. */
  units?: readonly string[];
  /** Lưu phần sửa; từ chối (reject) khi Kho báo lỗi để drawer hiện lý do và giữ dữ liệu đã nhập. */
  onSave: (patch: UpdateMaterialRequest) => Promise<void> | void;
  /** Ngừng dùng mã; không có đường xoá vì sổ cái trỏ vào mã. Từ chối (reject) khi Kho báo lỗi. */
  onRetire: () => Promise<void> | void;
  /** Dùng lại mã đã ngừng dùng. Từ chối (reject) khi Kho báo lỗi. */
  onReactivate: () => Promise<void> | void;
  /**
   * Xoá hẳn mã chưa có liên kết nào (dữ liệu rác, tạo nhầm). Kho từ chối và nêu từng liên kết khi mã đã được dùng;
   * lúc đó lỗi hiện trong drawer.
   */
  onDelete: () => Promise<void> | void;
  onClose: () => void;
}) {
  const userName = useUserLabel();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(item));
  const { error: saveError, submit, clear: clearSaveError } = useFormSubmit('Không lưu được hàng hóa.');

  const retire = async () => {
    setError(undefined);
    try {
      await onRetire();
    } catch (cause) {
      setError(submitErrorMessage(cause, 'Không ngừng dùng được mặt hàng.'));
    }
  };

  const reactivate = async () => {
    setError(undefined);
    try {
      await onReactivate();
    } catch (cause) {
      setError(submitErrorMessage(cause, 'Không dùng lại được mặt hàng.'));
    }
  };

  const remove = async () => {
    setError(undefined);
    try {
      await onDelete();
    } catch (cause) {
      setError(submitErrorMessage(cause, 'Không xóa được mặt hàng.'));
    }
  };

  const group = tradeGroupOf(item);
  const change = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const priceValue = draft.price.trim() === '' ? undefined : Number(draft.price);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(draftOf(item));
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const priceInvalid = priceValue !== undefined && (!Number.isFinite(priceValue) || priceValue < 0);
  const ready = draft.name.trim() !== '' && draft.unit.trim() !== '' && !priceInvalid;

  const startEdit = () => {
    setDraft(draftOf(item));
    clearSaveError();
    setError(undefined);
    setEditing(true);
  };
  const cancelEdit = () => {
    clearSaveError();
    setEditing(false);
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    void submit(async () => {
      await onSave({
        name: draft.name.trim(),
        unit: draft.unit.trim(),
        barcode: draft.barcode.trim() || undefined,
        tradeCategory: draft.category || undefined,
        tradeMode: draft.usage || undefined,
        salePrice: priceValue,
        currency: priceValue === undefined ? undefined : 'VND',
        // Chuỗi rỗng là xoá mô tả.
        description: draft.description.trim(),
      });
      setEditing(false);
    });
  };

  // ESC: ở chế độ xem đóng drawer; ở chế độ sửa thì hủy sửa về xem (chưa đổi gì), hoặc hỏi xác nhận (đã đổi).
  const escapeRef = useRef<() => void>(() => undefined);
  escapeRef.current = () => {
    if (busy) return;
    if (!editing) onClose();
    else if (dirty) cancelButtonRef.current?.click();
    else cancelEdit();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Popconfirm hoặc danh sách chọn đang mở tự xử lý ESC của nó.
      if (document.querySelector('[class*="popconfirmPopup"], [role="listbox"]')) return;
      escapeRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const categoryOptions = withCurrent(categoriesOf(group, catalog), draft.category);
  const usageOptions = withCurrent(catalog?.usageModes ?? [], draft.usage);
  const unitOptions = withCurrent(units, draft.unit);

  return (
    <>
      {/* Backdrop thông minh: chế độ xem click ngoài là đóng; chế độ sửa không đóng để khỏi mất dữ liệu đang nhập. */}
      <div className={styles.drawerBackdrop} onClick={editing ? undefined : onClose} />
      <aside className={styles.drawerPanel} role="dialog" aria-modal="true" aria-label={`Chi tiết ${item.code}`}>
        <div className={styles.drawerHead}>
          <div className={styles.drawerHeadInfo}>
            <span className={styles.drawerEyebrow}>{TRADE_GROUP_LABEL[group]}</span>
            <h2 className={styles.drawerTitle}>{item.name}</h2>
            <p className={styles.drawerSubtitle}>
              <code>{item.code}</code>
              <TradeStatusBadge active={item.isActive} />
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canManage && item.isActive ? (
              <Popconfirm
                title="Ngừng sử dụng mặt hàng?"
                description={`"${item.name}" (${item.code}) chuyển sang ngừng dùng. Lịch sử giao dịch và dữ liệu kho vẫn được giữ.`}
                okText="Ngừng dùng"
                cancelText="Huỷ"
                okType="danger"
                disabled={busy || editing}
                onConfirm={() => void retire()}
              >
                <button type="button" className={styles.btnSecondary} disabled={busy || editing}>
                  Ngừng dùng
                </button>
              </Popconfirm>
            ) : null}
            {canManage && !item.isActive ? (
              <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void reactivate()}>
                Dùng lại
              </button>
            ) : null}
            {canManage && !editing ? (
              <Popconfirm
                title="Xóa mặt hàng?"
                description={`Xóa hẳn "${item.name}" (${item.code}). Chỉ xóa được khi mã chưa có tồn, bút toán, chứng từ hay liên kết nào; nếu đã dùng, hãy chọn Ngừng dùng.`}
                okText="Xóa"
                cancelText="Huỷ"
                okType="danger"
                disabled={busy}
                onConfirm={() => void remove()}
              >
                <button type="button" className={styles.btnSecondary} disabled={busy}>
                  Xóa
                </button>
              </Popconfirm>
            ) : null}
            {canManage && item.isActive && !editing ? (
              <button type="button" className={styles.btnSecondary} onClick={startEdit}>
                Sửa
              </button>
            ) : null}
            <CloseGuard dirty={dirty} busy={busy} onClose={onClose}>
              <button type="button" className={styles.drawerCloseBtn} aria-label="Đóng" title="Đóng">
                <X size={16} />
              </button>
            </CloseGuard>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.6rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: '#f8fafc' }}>
          <FormError error={error} />
          {!item.isActive ? (
            <p
              role="status"
              style={{
                margin: 0,
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #fda4af',
                background: '#fff1f2',
                color: '#9f1239',
                fontSize: '13px',
                lineHeight: 1.5,
              }}
            >
              Mặt hàng đã ngừng dùng: không hiện ở các ô chọn và không sửa được. Lịch sử giao dịch và tồn kho vẫn
              được giữ. Bấm Dùng lại để sửa hoặc dùng tiếp.
            </p>
          ) : null}
          <DrawerSection title="Thông tin chung">
            <form onSubmit={save} aria-label="Sửa thông tin hàng hóa" style={{ display: 'contents' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px 20px' }}>
                <DrawerField label="Mã">{item.code}</DrawerField>
                {editing ? (
                  <EditField label="Tên" htmlFor="trade-edit-name" required>
                    <input
                      id="trade-edit-name"
                      style={inputStyle}
                      autoFocus
                      value={draft.name}
                      onChange={(event) => change({ name: event.target.value })}
                    />
                  </EditField>
                ) : (
                  <DrawerField label="Tên">{item.name}</DrawerField>
                )}
                <DrawerField label="Nhóm">{TRADE_GROUP_LABEL[group]}</DrawerField>
                {editing ? (
                  <EditField label="Phân loại">
                    <SearchableSelect
                      options={categoryOptions}
                      value={draft.category}
                      placeholder={
                        categoryOptions.length === 0 ? '— Chưa khai báo trong Cài đặt —' : '— Chọn phân loại —'
                      }
                      onChange={(value) => change({ category: value || '' })}
                      clearable
                      height={36}
                      style={{ width: '100%' }}
                    />
                  </EditField>
                ) : (
                  <DrawerField label="Phân loại">{item.tradeCategory}</DrawerField>
                )}
                {editing ? (
                  <EditField label="Đơn vị" htmlFor="trade-edit-unit" required>
                    {units.length > 0 ? (
                      <SearchableSelect
                        options={unitOptions}
                        value={draft.unit}
                        placeholder="— Chọn đơn vị —"
                        emptyText="Không tìm thấy đơn vị tính"
                        onChange={(value) => change({ unit: value || '' })}
                        clearable={false}
                        height={36}
                        style={{ width: '100%' }}
                      />
                    ) : (
                      <input
                        id="trade-edit-unit"
                        style={inputStyle}
                        value={draft.unit}
                        onChange={(event) => change({ unit: event.target.value })}
                      />
                    )}
                  </EditField>
                ) : (
                  <DrawerField label="Đơn vị">{item.unit}</DrawerField>
                )}
                {editing ? (
                  <EditField label="Sử dụng">
                    <SearchableSelect
                      options={usageOptions}
                      value={draft.usage}
                      placeholder="— Chọn cách sử dụng —"
                      onChange={(value) => change({ usage: value || '' })}
                      clearable
                      height={36}
                      style={{ width: '100%' }}
                    />
                  </EditField>
                ) : (
                  <DrawerField label="Sử dụng">{usageLabel(item.tradeMode)}</DrawerField>
                )}
                {editing ? (
                  <EditField label="Giá bán (VND)" htmlFor="trade-edit-price">
                    <VnNumberInput
                      id="trade-edit-price"
                      style={inputStyle}
                      placeholder="Bỏ trống nếu chưa khai báo"
                      value={draft.price}
                      aria-invalid={priceInvalid}
                      onChange={(price) => change({ price })}
                    />
                    {priceInvalid ? (
                      <span role="alert" style={{ fontSize: '13px', color: '#dc2626' }}>
                        Giá bán phải là số không âm.
                      </span>
                    ) : null}
                  </EditField>
                ) : (
                  <DrawerField label="Giá bán">{formatSalePrice(item.salePrice)}</DrawerField>
                )}
                <DrawerField label="Trạng thái">
                  <TradeStatusBadge active={item.isActive} />
                </DrawerField>
                {editing ? (
                  <EditField label="Mô tả" htmlFor="trade-edit-description">
                    <textarea
                      id="trade-edit-description"
                      style={inputStyle}
                      rows={3}
                      maxLength={2000}
                      placeholder="Thông tin thêm"
                      value={draft.description}
                      onChange={(event) => change({ description: event.target.value })}
                    />
                  </EditField>
                ) : (
                  <DrawerField label="Mô tả">{item.description}</DrawerField>
                )}
                {editing ? (
                  <EditField label="Barcode" htmlFor="trade-edit-barcode">
                    <input
                      id="trade-edit-barcode"
                      style={inputStyle}
                      placeholder="Mã vạch"
                      value={draft.barcode}
                      onChange={(event) => change({ barcode: event.target.value })}
                    />
                  </EditField>
                ) : (
                  <DrawerField label="Barcode">{item.barcode}</DrawerField>
                )}
                <DrawerField label="Người khai báo">{item.createdBy ? userName(item.createdBy) : undefined}</DrawerField>
                <DrawerField label="Thời gian khai báo">{formatDateTime(item.createdAt)}</DrawerField>
              </div>

              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
                  <FormError error={saveError} />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <CloseGuard dirty={dirty} busy={busy} onClose={cancelEdit}>
                      <button ref={cancelButtonRef} type="button" className={styles.btnSecondary}>
                        Huỷ
                      </button>
                    </CloseGuard>
                    <button type="submit" className={styles.btnPrimary} disabled={busy || !ready}>
                      {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
                    </button>
                  </div>
                </div>
              ) : null}
            </form>
          </DrawerSection>

          <DrawerSection title="Lịch sử xuất nhập">
            <MaterialHistorySection material={item} warehouses={warehouses} />
          </DrawerSection>

          <DrawerSection title="Tồn kho">
            <MaterialStockSection material={item} stock={stock} warehouses={warehouses} />
          </DrawerSection>
        </div>
      </aside>
    </>
  );
}
