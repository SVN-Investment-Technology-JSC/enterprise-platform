'use client';

import type { CatalogItem, CatalogKind } from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { Plus } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { errorMessage, quickAddCatalogItem } from '../correspondence-api';
import { catalogOptions } from '../correspondence.model';
import styles from '../correspondence.module.scss';

const NOUNS: Readonly<Record<CatalogKind, string>> = {
  letter_type: 'loại văn bản',
  urgency: 'độ khẩn',
  confidentiality: 'độ mật',
};

/**
 * Ô chọn một mục danh mục (loại văn bản, độ khẩn, độ mật) kèm nút "+" thêm nhanh mục mới ngay
 * lúc nhập, không phải vào Cấu hình. Thêm xong thì ô chọn luôn mục vừa thêm. Nút chỉ hiện với
 * người được thêm (người cấu hình, văn thư); API kiểm lại quyền.
 */
export function CatalogField({
  label,
  kind,
  catalog,
  value,
  keep,
  required = false,
  emptyText,
  canAdd = false,
  onChange,
  onAdded,
}: {
  readonly label: string;
  readonly kind: CatalogKind;
  readonly catalog: readonly CatalogItem[];
  readonly value: string;
  /** Mã đang dùng của công văn, vẫn hiện dù mục đã ngừng dùng. */
  readonly keep?: string;
  readonly required?: boolean;
  readonly emptyText?: string;
  readonly canAdd?: boolean;
  readonly onChange: (code: string) => void;
  readonly onAdded?: (item: CatalogItem) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const noun = NOUNS[kind];
  const options = catalogOptions(catalog, kind, keep);

  const close = () => {
    setAdding(false);
    setName('');
    setError(undefined);
  };
  const add = async () => {
    if (!name.trim()) {
      setError(`Nhập tên ${noun}.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const item = await quickAddCatalogItem(kind, name);
      onAdded?.(item);
      onChange(item.code);
      toast.success(`Đã thêm ${noun} "${item.name}".`);
      close();
    } catch (cause) {
      setError(errorMessage(cause, `Không thêm được ${noun}.`));
    } finally {
      setBusy(false);
    }
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void add();
    } else if (event.key === 'Escape') {
      // Chỉ đóng ô thêm, không đóng hộp thoại đang nhập.
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <div className={styles.field} role="group" aria-label={label}>
      <span className={styles.fieldLabel}>
        {label}
        {required ? <span className={styles.required}> *</span> : null}
      </span>
      <div className={canAdd ? styles.selectAdd : undefined}>
        <SearchableSelect
          options={options}
          value={value}
          emptyText={emptyText ?? (canAdd ? `Chưa có ${noun}. Bấm + để thêm.` : `Chưa có ${noun}. Nhờ người quản trị thêm trong Cấu hình.`)}
          searchInDropdown={kind !== 'letter_type'}
          hideDropdownSearch={kind !== 'letter_type'}
          onChange={onChange}
        />
        {canAdd ? (
          <button
            type="button"
            className={styles.addButton}
            aria-label={`Thêm ${noun}`}
            title={`Thêm ${noun} mới`}
            aria-expanded={adding}
            onClick={() => (adding ? close() : setAdding(true))}
          >
            <Plus size={16} />
          </button>
        ) : null}
      </div>
      {adding ? (
        <div className={styles.quickAdd}>
          <input
            value={name}
            maxLength={120}
            autoFocus
            placeholder={`Tên ${noun} mới`}
            aria-label={`Tên ${noun} mới`}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={onKey}
          />
          <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void add()}>
            Thêm
          </button>
          <button type="button" className={styles.buttonGhost} disabled={busy} onClick={close}>
            Huỷ
          </button>
        </div>
      ) : null}
      {error ? (
        <span role="alert" className={`${styles.hint} ${styles['hint-danger']}`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
