'use client';

import type { ReactNode } from 'react';
import styles from './module-shell.module.scss';

export interface ModuleSettingsSection {
  /** Đoạn hash phụ: `#settings/<id>`. */
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly render: () => ReactNode;
}

export interface ModuleSettingsViewProps {
  readonly sections: readonly ModuleSettingsSection[];
  readonly activeSectionId?: string;
  readonly onSectionChange?: (id: string) => void;
  /**
   * Thiếu quyền quản trị thì **vô hiệu hoá ô nhập, không ẩn màn hình**. Ẩn đi
   * chỉ biến "sao tôi không thấy mục cài đặt" thành một ticket hỗ trợ.
   */
  readonly readOnly?: boolean;
  readonly dirty?: boolean;
  readonly saving?: boolean;
  readonly onSave?: () => void;
  readonly onReset?: () => void;
}

export function ModuleSettingsView(props: ModuleSettingsViewProps) {
  const active =
    props.sections.find((section) => section.id === props.activeSectionId) ?? props.sections[0];

  if (!active) return <p className={styles.empty}>Module này chưa có mục cài đặt nào.</p>;

  return (
    <div className={styles.settings}>
      <nav className={styles.sectionNav} aria-label="Mục cài đặt">
        {props.sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`${styles.navItem} ${section.id === active.id ? styles.navItemActive : ''}`}
            aria-current={section.id === active.id ? 'page' : undefined}
            onClick={() => props.onSectionChange?.(section.id)}
          >
            <span className={styles.navLabel}>{section.label}</span>
          </button>
        ))}
      </nav>

      <section className={styles.sectionPanel}>
        <div className={styles.sectionHead}>
          <h2>{active.label}</h2>
          {active.description ? <p>{active.description}</p> : null}
        </div>

        {active.render()}

        {props.onSave ? (
          <div className={styles.sectionFoot}>
            {props.readOnly ? (
              <span className={styles.dirtyHint}>Bạn không có quyền sửa cấu hình module này.</span>
            ) : props.dirty ? (
              <span className={styles.dirtyHint}>Có thay đổi chưa lưu.</span>
            ) : null}
            {props.onReset ? (
              <button
                type="button"
                className={`${styles.action} ${styles.actionGhost}`}
                disabled={props.readOnly || props.saving || !props.dirty}
                onClick={props.onReset}
              >
                Hoàn tác
              </button>
            ) : null}
            <button
              type="button"
              className={`${styles.action} ${styles.actionPrimary}`}
              disabled={props.readOnly || props.saving || !props.dirty}
              onClick={props.onSave}
            >
              {props.saving ? 'Đang lưu…' : 'Lưu cấu hình'}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
