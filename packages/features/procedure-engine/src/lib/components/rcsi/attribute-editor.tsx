'use client';

import {
  PROCEDURE_ATTRIBUTE_TYPES,
  PROCEDURE_ATTRIBUTE_TYPE_LABELS,
  type ProcedureAttributeDefinition,
  type ProcedureAttributeType,
} from '@enterprise-platform/contracts-procedure-engine';
import { MinimalPopupForm, Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import styles from './flow-editors.module.scss';

/** "Giá trị báo giá" → "gia_tri_bao_gia": mã ổn định để điều kiện tham chiếu. */
export function attributeCodeFrom(name: string): string {
  const code = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return /^[a-z]/.test(code) ? code : `tt_${code}`.slice(0, 60);
}

interface Row {
  id: string;
  code: string;
  name: string;
  type: ProcedureAttributeType;
  required: boolean;
  /** Mỗi dòng một lựa chọn; chỉ dùng với kiểu danh sách. */
  optionsText: string;
  /** Mã đã tồn tại thì khoá: điều kiện rẽ nhánh đang tham chiếu bằng mã này. */
  locked: boolean;
}

function toRows(attributes: readonly ProcedureAttributeDefinition[] | undefined): Row[] {
  return (attributes ?? []).map((attribute) => ({
    id: attribute.id,
    code: attribute.code,
    name: attribute.name,
    type: attribute.type,
    required: attribute.required,
    optionsText: (attribute.options ?? []).map((option) => option.label).join('\n'),
    locked: true,
  }));
}

function fromRows(rows: readonly Row[]): ProcedureAttributeDefinition[] {
  return rows.map((row) => {
    const labels = row.optionsText.split('\n').map((line) => line.trim()).filter(Boolean);
    const seen = new Set<string>();
    const options = labels.map((label) => {
      let code = attributeCodeFrom(label) || 'lua_chon';
      let suffix = 2;
      while (seen.has(code)) code = `${attributeCodeFrom(label)}_${suffix++}`;
      seen.add(code);
      return { code, label };
    });
    return {
      id: row.id,
      code: row.code,
      name: row.name.trim(),
      type: row.type,
      required: row.required,
      options: row.type === 'select' ? options : undefined,
    };
  });
}

/**
 * Khai báo thuộc tính cho một bước hoặc cho cả quy trình.
 *
 * Người thực hiện bước nhập giá trị khi chạy hồ sơ; điểm rẽ nhánh phía sau dùng
 * các giá trị này làm điều kiện.
 */
export function AttributeEditor({
  title,
  subtitle,
  attributes,
  usedCodes,
  onClose,
  onSave,
}: {
  title: string;
  subtitle: string;
  attributes: readonly ProcedureAttributeDefinition[] | undefined;
  /** Mã đang được điều kiện rẽ nhánh dùng — cảnh báo trước khi xoá. */
  usedCodes: ReadonlySet<string>;
  onClose: () => void;
  onSave: (next: ProcedureAttributeDefinition[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(attributes));
  const [error, setError] = useState<string>();
  const update = (index: number, change: Partial<Row>) =>
    setRows(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));

  const save = () => {
    const codes = new Set<string>();
    for (const row of rows) {
      if (!row.name.trim()) return setError('Mỗi thuộc tính cần có tên.');
      if (!/^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(row.code)) {
        return setError(`Mã “${row.code}” phải bắt đầu bằng chữ và chỉ gồm chữ, số, gạch dưới.`);
      }
      if (codes.has(row.code.toLowerCase())) return setError(`Mã “${row.code}” bị trùng.`);
      codes.add(row.code.toLowerCase());
      if (row.type === 'select' && !row.optionsText.trim()) {
        return setError(`“${row.name}” là danh sách chọn nên cần ít nhất một lựa chọn.`);
      }
    }
    setError(undefined);
    onSave(fromRows(rows));
  };

  return (
    <MinimalPopupForm isOpen title={title} subtitle={subtitle} maxWidth="860px" onClose={onClose}>
      <div className={styles.editor}>
        <div className={styles.attributeTable}>
          <div className={styles.attributeHead}>
            <span>Tên thuộc tính</span>
            <span>Mã</span>
            <span>Kiểu dữ liệu</span>
            <span>Bắt buộc</span>
            <span />
          </div>
          {rows.map((row, index) => (
            <div key={row.id || index} className={styles.attributeRow}>
              <input
                className={styles.input}
                value={row.name}
                placeholder="Ví dụ: Giá trị báo giá"
                onChange={(event) =>
                  update(index, {
                    name: event.target.value,
                    ...(row.locked ? {} : { code: attributeCodeFrom(event.target.value) }),
                  })
                }
              />
              <input
                className={styles.input}
                value={row.code}
                disabled={row.locked}
                title={row.locked ? 'Mã đã lưu không đổi được: điều kiện rẽ nhánh tham chiếu bằng mã này.' : undefined}
                onChange={(event) => update(index, { code: event.target.value })}
              />
              <SearchableSelect
                options={PROCEDURE_ATTRIBUTE_TYPES.map((type) => ({ value: type, label: PROCEDURE_ATTRIBUTE_TYPE_LABELS[type] }))}
                value={row.type}
                clearable={false}
                onChange={(next) => update(index, { type: next as ProcedureAttributeType })}
              />
              <label className={styles.checkbox}>
                <input type="checkbox" checked={row.required} onChange={(event) => update(index, { required: event.target.checked })} />
                Bắt buộc
              </label>
              <Popconfirm
                title={`Xoá thuộc tính “${row.name || row.code}”?`}
                description={
                  usedCodes.has(row.code)
                    ? 'Thuộc tính đang được điều kiện rẽ nhánh dùng — quy trình sẽ không công bố được cho tới khi sửa điều kiện.'
                    : 'Giá trị đã nhập ở hồ sơ đang chạy vẫn được giữ.'
                }
                okText="Xoá"
                cancelText="Huỷ"
                okType="danger"
                placement="top-end"
                onConfirm={() => setRows(rows.filter((_, position) => position !== index))}
              >
                <button type="button" className={styles.iconButton} aria-label="Xoá thuộc tính">
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </Popconfirm>
              {row.type === 'select' ? (
                <textarea
                  className={styles.optionsInput}
                  value={row.optionsText}
                  placeholder={'Mỗi dòng một lựa chọn, ví dụ:\nKhách hàng mới\nKhách hàng cũ'}
                  onChange={(event) => update(index, { optionsText: event.target.value })}
                />
              ) : null}
            </div>
          ))}
          {rows.length === 0 ? <p className={styles.hint}>Chưa có thuộc tính nào.</p> : null}
        </div>

        <button
          type="button"
          className={styles.linkButton}
          onClick={() =>
            setRows([
              ...rows,
              { id: '', code: `tt_${rows.length + 1}`, name: '', type: 'text', required: false, optionsText: '', locked: false },
            ])
          }
        >
          <Plus size={13} aria-hidden="true" /> Thêm thuộc tính
        </button>

        {error ? <p className={styles.errorText}>{error}</p> : null}

        <footer className={styles.footer}>
          <span />
          <div className={styles.footerRight}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>
              Huỷ
            </button>
            <button type="button" className={styles.submitButton} onClick={save}>
              Lưu thuộc tính
            </button>
          </div>
        </footer>
      </div>
    </MinimalPopupForm>
  );
}
