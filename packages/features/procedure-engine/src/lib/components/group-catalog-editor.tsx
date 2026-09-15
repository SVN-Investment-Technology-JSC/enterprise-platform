'use client';

import type { ProcedureGroupOption } from '@enterprise-platform/contracts-procedure-engine';
import { MinimalPopupForm, Popconfirm } from '@enterprise-platform/shared-ui';
import { useState } from 'react';
import styles from './group-catalog-editor.module.scss';

function toCode(label: string): string {
  return label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export interface GroupCatalogValue { readonly options: readonly ProcedureGroupOption[]; readonly autoAssignEnabled: boolean; }

/** Danh mục nhóm; mã không đổi để các phiên bản đã công bố vẫn truy vết được. */
export function GroupCatalogEditor({ value, usedCodes, disabled, onChange }: {
  value: GroupCatalogValue; usedCodes: ReadonlySet<string>; disabled?: boolean; onChange: (next: GroupCatalogValue) => void;
}) {
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newGroupError, setNewGroupError] = useState<string>();
  const setOptions = (options: readonly ProcedureGroupOption[]) => onChange({ ...value, options: options.map((option, index) => ({ ...option, sortOrder: index + 1 })) });
  const createGroup = () => {
    const label = newLabel.trim();
    if (!label) { setNewGroupError('Nhập tên nhóm quy trình.'); return; }
    if (value.options.some((option) => option.label.localeCompare(label, 'vi', { sensitivity: 'accent' }) === 0)) { setNewGroupError('Tên nhóm đã tồn tại.'); return; }
    const stem = toCode(label) || 'nhom'; const taken = new Set(value.options.map((option) => option.code)); let code = stem; let suffix = 2;
    while (taken.has(code)) code = `${stem}-${suffix++}`;
    setOptions([...value.options, { code, label, sortOrder: 0, isActive: true }]); setNewLabel(''); setNewGroupError(undefined); setCreateOpen(false);
  };
  return (
    <section className={styles.catalog} aria-label="Danh mục nhóm quy trình">
      <div className={styles.toolbar}>
        <label className={styles.autoAssign}><input type="checkbox" checked={value.autoAssignEnabled} disabled={disabled} onChange={(event) => onChange({ ...value, autoAssignEnabled: event.target.checked })} /><span><strong>Tự gán nhóm cho quy trình mới</strong><small>Gợi ý nhóm phù hợp khi khởi tạo quy trình.</small></span></label>
        <button type="button" className={styles.addButton} disabled={disabled} onClick={() => setCreateOpen(true)}>+ Thêm nhóm</button>
      </div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Nhóm quy trình</th><th>Mã</th><th>Trạng thái</th><th aria-label="Thao tác" /></tr></thead><tbody>
        {value.options.map((option, index) => {
          const inUse = usedCodes.has(option.code);
          return <tr key={option.code}><td><input className={styles.labelInput} value={option.label} disabled={disabled} aria-label={`Tên nhóm ${option.label}`} onChange={(event) => { const next = [...value.options]; next[index] = { ...option, label: event.target.value }; setOptions(next); }} /></td><td><code className={styles.code}>{option.code}</code></td><td><label className={styles.statusControl}><input type="checkbox" checked={option.isActive} disabled={disabled} onChange={(event) => { const next = [...value.options]; next[index] = { ...option, isActive: event.target.checked }; setOptions(next); }} /><span>{option.isActive ? 'Đang dùng' : 'Đã tắt'}</span></label></td><td className={styles.actions}>{inUse ? <span className={styles.usedBadge}>Đang được dùng</span> : <Popconfirm title={`Xóa nhóm “${option.label}”?`} description="Nhóm này sẽ bị loại khỏi danh mục sau khi lưu cấu hình." okText="Xóa" cancelText="Hủy" okType="danger" placement="top-end" onConfirm={() => setOptions(value.options.filter((_, position) => position !== index))}><button type="button" className={styles.removeButton} disabled={disabled}>Xóa</button></Popconfirm>}</td></tr>;
        })}
        {value.options.length === 0 ? <tr><td className={styles.empty} colSpan={4}>Chưa có nhóm nào. Thêm nhóm để phân loại quy trình.</td></tr> : null}
      </tbody></table></div>
      <p className={styles.hint}>Nhóm đang được quy trình sử dụng chỉ có thể tắt để giữ nguyên khả năng tra cứu lịch sử.</p>
      <MinimalPopupForm isOpen={isCreateOpen} title="Thêm nhóm quy trình" subtitle="Tên hiển thị có thể chỉnh sửa sau; mã được tạo ổn định để dùng cho lịch sử quy trình." onClose={() => { setCreateOpen(false); setNewGroupError(undefined); }}>
        <form className={styles.createForm} onSubmit={(event) => { event.preventDefault(); createGroup(); }}><label htmlFor="procedure-group-label">Tên nhóm <span>*</span></label><input id="procedure-group-label" value={newLabel} autoFocus placeholder="Ví dụ: Bảo trì định kỳ" onChange={(event) => { setNewLabel(event.target.value); setNewGroupError(undefined); }} />{newGroupError ? <p className={styles.error}>{newGroupError}</p> : null}<div className={styles.formActions}><button type="button" className={styles.cancelButton} onClick={() => setCreateOpen(false)}>Hủy</button><button type="submit" className={styles.submitButton}>Thêm nhóm</button></div></form>
      </MinimalPopupForm>
    </section>
  );
}
