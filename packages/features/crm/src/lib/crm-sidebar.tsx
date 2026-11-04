'use client';

import { ShoppingCart, Users, Warehouse } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  CRM_INVENTORY_DENIED_HINT,
  CRM_INVENTORY_HREF,
  CRM_INVENTORY_LABEL,
  type CrmInventoryButtonState,
  type CrmSection,
  type CrmSectionId,
} from './crm-nav.model';
import styles from './crm.module.scss';

const SECTION_ICONS: Record<CrmSectionId, ReactNode> = {
  care: <Users size={16} />,
  sales: <ShoppingCart size={16} />,
};

/** Bộ chuyển hai phần của module ở đầu thanh bên; chỉ hiện các phần còn trang được phép. */
export function CrmSectionSwitcher({
  sections,
  active,
  collapsed,
  onSelect,
}: {
  sections: readonly CrmSection[];
  active: CrmSectionId | undefined;
  collapsed: boolean;
  onSelect: (section: CrmSectionId) => void;
}) {
  if (sections.length === 0) return null;
  return (
    <div className={styles.sectionSwitcher} role="group" aria-label="Phần của CRM" data-collapsed={collapsed || undefined}>
      {sections.map((section) => {
        const selected = section.id === active;
        return (
          <button
            key={section.id}
            type="button"
            className={selected ? `${styles.sectionButton} ${styles.sectionButtonActive}` : styles.sectionButton}
            aria-pressed={selected}
            aria-label={section.label}
            title={section.label}
            onClick={() => onSelect(section.id)}
          >
            {SECTION_ICONS[section.id]}
            {collapsed ? null : <span>{section.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Nút "Kho hàng" khổ ngang ở cuối thanh bên. Ẩn khi tenant chưa mua Kho; mờ và `aria-disabled` khi
 * chưa có quyền (vẫn focus được để đọc chú giải nhưng không kích hoạt được); bấm được khi có quyền.
 */
export function CrmInventoryButton({ state, collapsed }: { state: CrmInventoryButtonState; collapsed: boolean }) {
  if (state === 'hidden') return null;
  const content = (
    <>
      <Warehouse size={16} aria-hidden />
      {collapsed ? null : <span>{CRM_INVENTORY_LABEL}</span>}
    </>
  );
  if (state === 'enabled') {
    return (
      <a className={styles.inventoryButton} href={CRM_INVENTORY_HREF} title={CRM_INVENTORY_LABEL} aria-label={CRM_INVENTORY_LABEL}>
        {content}
      </a>
    );
  }
  return (
    <>
      <button
        type="button"
        className={`${styles.inventoryButton} ${styles.inventoryButtonDisabled}`}
        aria-disabled="true"
        aria-label={CRM_INVENTORY_LABEL}
        aria-describedby="crm-inventory-denied"
        title={CRM_INVENTORY_DENIED_HINT}
        onClick={(event) => event.preventDefault()}
      >
        {content}
      </button>
      <span id="crm-inventory-denied" className={styles.srOnly}>
        {CRM_INVENTORY_DENIED_HINT}
      </span>
    </>
  );
}
