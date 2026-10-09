'use client';

import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type { ProcedureRaciRole } from '@enterprise-platform/contracts-procedure-engine';
import { MinimalPopupForm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { useMemo, useState } from 'react';
import { foldVietnamese, type MatrixColumn } from './columns';
import { stopEscapeWhenListOpen } from './escape-guard';
import styles from './flow-editors.module.scss';
import bulk from './bulk-assign-dialog.module.scss';

/** Vai gán hàng loạt được. C (một người) và E (chỉ chức danh Quản lý) gán từng ô để kiểm soát. */
const BULK_ROLES: readonly { value: ProcedureRaciRole; label: string }[] = [
  { value: 'S', label: 'S — Khởi tạo' },
  { value: 'R', label: 'R — Xem xét' },
  { value: 'A', label: 'A — Phê duyệt' },
  { value: 'I', label: 'I — Nhận thông tin' },
];

/**
 * Gán một vai cho nhiều chức danh trong một lần (vd: 20-30 chức danh của một nhóm).
 *
 * Danh sách nhóm theo đơn vị: tích cả đơn vị hoặc từng chức danh, tìm theo tên không dấu.
 * Chức danh đã giữ vai ở bước này hiển thị vai hiện tại; gán lại sẽ thay bằng vai mới.
 */
export function BulkAssignDialog({
  stepName,
  columns,
  currentRoles,
  organization,
  onClose,
  onApply,
}: {
  stepName: string;
  /** Mọi cột chức danh (kể cả khi ma trận đang ở chế độ thu gọn). */
  columns: readonly MatrixColumn[];
  /** Vai hiện có của từng cột ở bước này, theo `column.key`. */
  currentRoles: ReadonlyMap<string, ProcedureRaciRole>;
  organization?: TenantOrganizationSnapshot;
  onClose: () => void;
  /** `role` rỗng nghĩa là xoá vai khỏi các cột đã chọn. */
  onApply: (role: ProcedureRaciRole | undefined, picked: MatrixColumn[]) => void;
}) {
  const [role, setRole] = useState<ProcedureRaciRole>('S');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());

  const unitName = useMemo(
    () => new Map((organization?.units ?? []).map((unit) => [unit.id, unit.name])),
    [organization],
  );

  const groups = useMemo(() => {
    const needle = foldVietnamese(query.trim());
    const byUnit = new Map<string, MatrixColumn[]>();
    for (const column of columns) {
      if (needle && !foldVietnamese(`${column.label} ${column.holderNames?.join(' ') ?? ''}`).includes(needle))
        continue;
      const unitId = column.unitId ?? '';
      const list = byUnit.get(unitId) ?? [];
      list.push(column);
      byUnit.set(unitId, list);
    }
    return [...byUnit.entries()].map(([unitId, items]) => ({
      unitId,
      title: unitName.get(unitId) ?? 'Chưa rõ đơn vị',
      items,
    }));
  }, [columns, query, unitName]);

  const visible = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const setMany = (items: readonly MatrixColumn[], on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      for (const item of items) {
        if (on) next.add(item.key);
        else next.delete(item.key);
      }
      return next;
    });

  const chosen = columns.filter((column) => picked.has(column.key));

  return (
    <MinimalPopupForm
      isOpen
      title="Gán vai cho nhiều chức danh"
      subtitle={`Bước “${stepName}”: chọn vai rồi tích các chức danh cần gán. Chức danh đã có vai khác ở bước này sẽ được đổi sang vai mới.`}
      maxWidth="640px"
      onClose={onClose}
    >
      <div className={styles.editor} onKeyDown={stopEscapeWhenListOpen}>
        <div className={styles.fieldRow}>
          <span>Vai trò</span>
          <SearchableSelect
            options={BULK_ROLES}
            value={role}
            clearable={false}
            onChange={(next) => setRole(next as ProcedureRaciRole)}
          />
        </div>

        <div className={bulk.toolbar}>
          <input
            className={styles.input}
            value={query}
            placeholder="Tìm chức danh hoặc người giữ chức danh…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className={styles.linkButton} onClick={() => setMany(visible, true)}>
            Chọn tất cả ({visible.length})
          </button>
          <button type="button" className={styles.linkButton} onClick={() => setPicked(new Set())}>
            Bỏ chọn
          </button>
        </div>

        <div className={bulk.list} role="group" aria-label="Danh sách chức danh">
          {groups.length === 0 ? <p className={styles.hint}>Không có chức danh phù hợp.</p> : null}
          {groups.map((group) => {
            const allOn = group.items.every((item) => picked.has(item.key));
            const someOn = group.items.some((item) => picked.has(item.key));
            return (
              <section key={group.unitId || 'none'} className={bulk.group}>
                <label className={bulk.groupHead}>
                  <input
                    type="checkbox"
                    checked={allOn}
                    ref={(node) => {
                      if (node) node.indeterminate = someOn && !allOn;
                    }}
                    onChange={(event) => setMany(group.items, event.target.checked)}
                  />
                  <strong>{group.title}</strong>
                  <small>{group.items.length} chức danh</small>
                </label>
                {group.items.map((item) => {
                  const existing = currentRoles.get(item.key);
                  return (
                    <label key={item.key} className={bulk.row}>
                      <input
                        type="checkbox"
                        checked={picked.has(item.key)}
                        onChange={(event) => setMany([item], event.target.checked)}
                      />
                      <span className={bulk.rowLabel}>
                        {item.label}
                        {item.isHead ? <em className={bulk.headTag}>Quản lý</em> : null}
                      </span>
                      <small>{item.caption}</small>
                      {existing ? <span className={bulk.currentRole}>{existing}</span> : null}
                    </label>
                  );
                })}
              </section>
            );
          })}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={chosen.length === 0}
            onClick={() => onApply(undefined, chosen)}
            title="Xoá vai ở bước này khỏi các chức danh đã chọn"
          >
            Xoá vai khỏi {chosen.length || ''} chức danh
          </button>
          <div className={styles.footerRight}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>
              Huỷ
            </button>
            <button
              type="button"
              className={styles.submitButton}
              disabled={chosen.length === 0}
              onClick={() => onApply(role, chosen)}
            >
              Gán {role} cho {chosen.length} chức danh
            </button>
          </div>
        </footer>
      </div>
    </MinimalPopupForm>
  );
}
