'use client';

import type { CreateMaterialRequest, InventoryTradeCatalog } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { FormError, submitErrorMessage } from './form-error';
import styles from '../inventory.module.scss';
import { TRADE_GROUP_LABEL, categoriesOf, withCurrent, type TradeGroup } from '../trade-items.model';

const labelStyle = { display: 'block' } as const;

/**
 * Tạo mới một mặt hàng kinh doanh. Việc sửa làm ngay trên drawer chi tiết (`TradeItemDrawer`).
 * Phân loại, đơn vị và sử dụng chọn từ danh mục khai trong Cài đặt.
 */
export function TradeItemFormDialog({
  catalog,
  units = [],
  busy,
  onCancel,
  onCreate,
}: {
  catalog?: InventoryTradeCatalog;
  /** Danh mục đơn vị tính khai ở Cài đặt; rỗng thì cho gõ tự do để không chặn việc tạo mã. */
  units?: readonly string[];
  busy?: boolean;
  onCancel: () => void;
  /** Gửi lên Kho; từ chối (reject) khi thất bại để form giữ lại dữ liệu và hiện lý do. */
  onCreate: (input: CreateMaterialRequest) => Promise<void> | void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [group, setGroup] = useState<TradeGroup>('GOODS');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [usage, setUsage] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();

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

  const unitOptions = useMemo(() => withCurrent(units, unit), [units, unit]);

  const priceValue = price.trim() === '' ? undefined : Number(price);
  const priceInvalid = priceValue !== undefined && (!Number.isFinite(priceValue) || priceValue < 0);
  const ready = code.trim() !== '' && name.trim() !== '' && unit.trim() !== '' && !priceInvalid;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    setError(undefined);
    try {
      await onCreate({
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
        description: description.trim() || undefined,
      });
    } catch (cause) {
      setError(submitErrorMessage(cause, 'Không lưu được hàng hóa.'));
    }
  };

  const title = 'Tạo hàng hóa';

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
                  autoFocus
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
                {units.length > 0 ? (
                  <SearchableSelect
                    options={unitOptions}
                    value={unit}
                    placeholder="— Chọn đơn vị —"
                    emptyText="Không tìm thấy đơn vị tính"
                    onChange={(value) => setUnit(value || '')}
                    clearable={false}
                    height={42}
                    style={{ width: '100%' }}
                  />
                ) : (
                  <input
                    id="trade-unit"
                    required
                    placeholder="Cái, Mét, Giờ…"
                    value={unit}
                    onChange={(event) => setUnit(event.target.value)}
                  />
                )}
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
            <div className={styles.formGroup}>
              <label style={labelStyle} htmlFor="trade-description">
                Mô tả
              </label>
              <textarea
                id="trade-description"
                rows={3}
                maxLength={2000}
                placeholder="Thông tin thêm về hàng hóa hoặc dịch vụ"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <FormError error={error} />
          </div>

          <div className={styles.modalFoot}>
            <button type="button" className={`${styles.action} ${styles.actionGhost}`} onClick={onCancel} disabled={busy}>
              Huỷ
            </button>
            <button type="submit" className={`${styles.action} ${styles.actionPrimary}`} disabled={busy || !ready}>
              {busy ? 'Đang lưu…' : 'Tạo mới'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
