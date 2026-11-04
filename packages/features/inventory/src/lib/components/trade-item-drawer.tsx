'use client';

import type { Material, Warehouse } from '@enterprise-platform/contracts-inventory';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { X } from 'lucide-react';
import { formatDateTime } from '../inventory-labels';
import styles from '../inventory.module.scss';
import { TRADE_GROUP_LABEL, formatSalePrice, tradeGroupOf, usageLabel } from '../trade-items.model';
import {
  DrawerField,
  DrawerSection,
  MaterialHistorySection,
  MaterialStockSection,
  type StockRow,
} from './material-drawer-sections';

/**
 * Chi tiết một mặt hàng: các trường của bảng, thêm người khai báo, thời gian khai báo, barcode,
 * rồi nhóm lịch sử xuất nhập và nhóm tồn kho. Dịch vụ không quản lý tồn nên hai nhóm sau chỉ báo lý do.
 */
export function TradeItemDrawer({
  item,
  warehouses,
  stock,
  canManage,
  busy,
  onEdit,
  onRetire,
  onClose,
}: {
  item: Material;
  warehouses: readonly Warehouse[];
  stock: readonly StockRow[];
  canManage: boolean;
  busy?: boolean;
  onEdit: () => void;
  /** Ngừng dùng mã; không có đường xoá vì sổ cái trỏ vào mã. */
  onRetire: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className={styles.drawerBackdrop} onClick={onClose} />
      <aside className={styles.drawerPanel} role="dialog" aria-modal="true" aria-label={`Chi tiết ${item.code}`}>
        <div className={styles.drawerHead}>
          <div className={styles.drawerHeadInfo}>
            <span className={styles.drawerEyebrow}>{TRADE_GROUP_LABEL[tradeGroupOf(item)]}</span>
            <h2 className={styles.drawerTitle}>{item.name}</h2>
            <p className={styles.drawerSubtitle}>
              <code>{item.code}</code>
              {!item.isActive ? <span>Đã ngừng dùng</span> : null}
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
                disabled={busy}
                onConfirm={onRetire}
              >
                <button type="button" className={styles.btnSecondary} disabled={busy}>
                  Ngừng dùng
                </button>
              </Popconfirm>
            ) : null}
            {canManage ? (
              <button type="button" className={styles.btnSecondary} onClick={onEdit}>
                Sửa
              </button>
            ) : null}
            <button type="button" className={styles.drawerCloseBtn} onClick={onClose} aria-label="Đóng" title="Đóng">
              <X size={16} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.6rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <DrawerSection title="Thông tin chung">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px 20px' }}>
              <DrawerField label="Mã">{item.code}</DrawerField>
              <DrawerField label="Tên">{item.name}</DrawerField>
              <DrawerField label="Nhóm">{TRADE_GROUP_LABEL[tradeGroupOf(item)]}</DrawerField>
              <DrawerField label="Phân loại">{item.tradeCategory}</DrawerField>
              <DrawerField label="Đơn vị">{item.unit}</DrawerField>
              <DrawerField label="Sử dụng">{usageLabel(item.tradeMode)}</DrawerField>
              <DrawerField label="Giá bán">{formatSalePrice(item.salePrice)}</DrawerField>
              <DrawerField label="Trạng thái">{item.isActive ? 'Đang dùng' : 'Đã ngừng dùng'}</DrawerField>
              <DrawerField label="Barcode">{item.barcode}</DrawerField>
              <DrawerField label="Người khai báo">{item.createdBy}</DrawerField>
              <DrawerField label="Thời gian khai báo">{formatDateTime(item.createdAt)}</DrawerField>
            </div>
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
