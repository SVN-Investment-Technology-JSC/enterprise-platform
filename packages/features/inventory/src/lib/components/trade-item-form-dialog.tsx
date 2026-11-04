'use client';

import type {
  CreateMaterialRequest,
  InventoryTradeCatalog,
  Material,
  UpdateMaterialRequest,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import styles from '../inventory.module.scss';
import { TRADE_GROUP_LABEL, categoriesOf, tradeGroupOf, usageLabel, type TradeGroup } from '../trade-items.model';

const labelStyle = { display: 'block' } as const;

/** Danh mục kèm giá trị đang dùng, để một lần sửa không làm mất giá trị admin đã bỏ khỏi danh mục. */
function withCurrent(options: readonly string[], current: string): { value: string; label: string }[] {
  const all = current && !options.includes(current) ? [...options, current] : options;
  return all.map((value) => ({ value, label: value }));
}

/**
 * Tạo mới hoặc sửa một mặt hàng kinh doanh. Khi sửa, mã và nhóm bị khoá:
 * đổi giữa hàng hóa và dịch vụ bị Kho chặn khi mã đã có tồn hoặc bút toán.
 * Phân loại và sử dụng chọn từ danh mục khai trong Cài đặt.
 */
export function TradeItemFormDialog({
  item,
  catalog,
  busy,
  onCancel,
  onCreate,
  onUpdate,
}: {
  item?: Material;
  catalog?: InventoryTradeCatalog;
  busy?: boolean;
  onCancel: () => void;
  onCreate: (input: CreateMaterialRequest) => void;
  onUpdate: (code: string, patch: UpdateMaterialRequest) => void;
}) {
  const editing = Boolean(item);
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [barcode, setBarcode] = useState(item?.barcode ?? '');
  const [group, setGroup] = useState<TradeGroup>(item ? tradeGroupOf(item) : 'GOODS');
  const [category, setCategory] = useState(item?.tradeCategory ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [usage, setUsage] = useState(usageLabel(item?.tradeMode));
  const [price, setPrice] = useState(item?.salePrice === undefined ? '' : String(item.salePrice));

  const groupOptions = useMemo(
    () => (Object.keys(TRADE_GROUP_LABEL) as TradeGroup[]).map((value) => ({ value, label: TRADE_GROUP_LABEL[value] })),
    [],
  );
  // Mỗi nhóm một danh sách phân loại riêng; đổi nhóm thì đổi danh sách.
  const categoryOptions = useMemo(
    () => withCurrent(categoriesOf(group, catalog), category),
    [group, catalog, category],
  );
  const usageOptions = useMemo(
    () => withCurrent(catalog?.usageModes ?? [], usage),
    [catalog, usage],
  );

  const priceValue = price.trim() === '' ? undefined : Number(price);
  const priceInvalid = priceValue !== undefined && (!Number.isFinite(priceValue) || priceValue < 0);
  const ready = code.trim() !== '' && name.trim() !== '' && unit.trim() !== '' && !priceInvalid;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    if (item) {
      onUpdate(item.code, {
        name: name.trim(),
        unit: unit.trim(),
        barcode: barcode.trim() || undefined,
        tradeCategory: category || undefined,
        tradeMode: usage || undefined,
        salePrice: priceValue,
        currency: priceValue === undefined ? undefined : 'VND',
      });
      return;
    }
    onCreate({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      unit: unit.trim(),
      category: 'CONSUMABLE',
      kind: group === 'SERVICE' ? 'SERVICE' : 'STOCK',
      barcode: barcode.trim() || undefined,
      tradeCategory: category || undefined,
      tradeMode: usage || undefined,
      salePrice: priceValue,
      currency: priceValue === undefined ? undefined : 'VND',
    });
  };

  const title = editing ? 'Sửa hàng hóa' : 'Tạo hàng hóa';

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        className={styles.modalDialog}
        style={{ maxWidth: '620px' }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className={styles.modalHead}>
            <h2>{title}</h2>
            <button type="button" className={styles.closeButton} onClick={onCancel} title="Đóng" aria-label="Đóng">
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          <div className={styles.modalBody} style={{ maxHeight: '75vh', overflowY: 'auto' }}>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label style={labelStyle} htmlFor="trade-code">
                  Mã <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  id="trade-code"
                  required
                  autoFocus={!editing}
                  readOnly={editing}
                  placeholder="VD: VT-001"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label style={labelStyle} htmlFor="trade-name">
                  Tên <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  id="trade-name"
                  required
                  autoFocus={editing}
                  placeholder="Tên hàng hóa hoặc dịch vụ"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label style={labelStyle} htmlFor="trade-barcode">
                  Barcode
                </label>
                <input
                  id="trade-barcode"
                  placeholder="Mã vạch"
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label style={labelStyle}>Nhóm</label>
                {editing ? (
                  <input value={TRADE_GROUP_LABEL[group]} readOnly aria-label="Nhóm" />
                ) : (
                  <SearchableSelect
                    options={groupOptions}
                    value={group}
                    placeholder="— Chọn nhóm —"
                    onChange={(value) => {
                      setGroup((value || 'GOODS') as TradeGroup);
                      // Phân loại thuộc danh sách của nhóm cũ, không còn hợp lệ ở nhóm mới.
                      setCategory('');
                    }}
                    clearable={false}
                    height={42}
                    style={{ width: '100%' }}
                  />
                )}
              </div>
              <div className={styles.formGroup}>
                <label style={labelStyle}>Phân loại</label>
                <SearchableSelect
                  options={categoryOptions}
                  value={category}
                  placeholder={
                    categoryOptions.length === 0 ? '— Chưa khai báo trong Cài đặt —' : '— Chọn phân loại —'
                  }
                  onChange={(value) => setCategory(value || '')}
                  clearable
                  height={42}
                  style={{ width: '100%' }}
                />
              </div>
              <div className={styles.formGroup}>
                <label style={labelStyle} htmlFor="trade-unit">
                  Đơn vị <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  id="trade-unit"
                  required
                  placeholder="Cái, Mét, Giờ…"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label style={labelStyle}>Sử dụng</label>
                <SearchableSelect
                  options={usageOptions}
                  value={usage}
                  placeholder="— Chọn cách sử dụng —"
                  onChange={(value) => setUsage(value || '')}
                  clearable
                  height={42}
                  style={{ width: '100%' }}
                />
              </div>
              <div className={styles.formGroup}>
                <label style={labelStyle} htmlFor="trade-price">
                  Giá bán (VND)
                </label>
                <input
                  id="trade-price"
                  inputMode="decimal"
                  placeholder="Bỏ trống nếu chưa khai báo"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  aria-invalid={priceInvalid}
                />
                {priceInvalid ? (
                  <span role="alert" style={{ fontSize: '13px', color: '#dc2626' }}>
                    Giá bán phải là số không âm.
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className={styles.modalFoot}>
            <button type="button" className={`${styles.action} ${styles.actionGhost}`} onClick={onCancel} disabled={busy}>
              Huỷ
            </button>
            <button type="submit" className={`${styles.action} ${styles.actionPrimary}`} disabled={busy || !ready}>
              {busy ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Tạo mới'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
