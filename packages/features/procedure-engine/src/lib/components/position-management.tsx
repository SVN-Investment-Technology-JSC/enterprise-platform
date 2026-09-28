'use client';

import type {
  OrganizationPosition,
  OrganizationUnit,
  TenantOrganizationContext,
} from '@enterprise-platform/contracts-organization';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useMemo, useState } from 'react';
import styles from './position-management.module.scss';

/**
 * Gợi ý "Báo cáo cho" từ cây đơn vị.
 *
 * - Chức danh thường báo cáo cho chức danh trưởng của chính đơn vị mình.
 * - Chức danh trưởng báo cáo cho chức danh trưởng của đơn vị cha gần nhất có trưởng.
 *
 * Chỉ là gợi ý: admin xác nhận thì mới lưu, vì cơ cấu báo cáo thật thường lệch
 * khỏi cây (phó phòng báo cáo thẳng lên giám đốc khối...).
 */
export function suggestReportsTo(
  position: OrganizationPosition,
  unitById: ReadonlyMap<string, OrganizationUnit>,
): string | undefined {
  const own = unitById.get(position.unitId);
  if (own?.headPositionId && own.headPositionId !== position.id) return own.headPositionId;
  const seen = new Set<string>();
  let cursor = own?.parentId ? unitById.get(own.parentId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (cursor.typeCategory === 'unit' && cursor.headPositionId && cursor.headPositionId !== position.id) {
      return cursor.headPositionId;
    }
    cursor = cursor.parentId ? unitById.get(cursor.parentId) : undefined;
  }
  return undefined;
}

export function PositionManagement({
  organization,
  canEdit,
  onSave,
}: {
  organization: TenantOrganizationContext;
  /** Chỉ quản trị tenant mới sửa được — đây là dữ liệu tổ chức dùng chung. */
  canEdit: boolean;
  onSave: (positionId: string, reportsToPositionId: string | null) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string>();
  const [error, setError] = useState<string>();

  const unitById = useMemo(
    () => new Map(organization.units.map((unit) => [unit.id, unit])),
    [organization.units],
  );
  const positionById = useMemo(
    () => new Map(organization.positions.map((position) => [position.id, position])),
    [organization.positions],
  );
  const holdersOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const member of organization.members) {
      if (!member.positionId) continue;
      map.set(member.positionId, [...(map.get(member.positionId) ?? []), member.displayName]);
    }
    return map;
  }, [organization.members]);

  const label = (positionId: string | undefined) => {
    if (!positionId) return '';
    const position = positionById.get(positionId);
    if (!position) return 'Chức danh đã xoá';
    return `${position.name} · ${unitById.get(position.unitId)?.name ?? ''}`;
  };

  const rows = useMemo(() => {
    const keyword = search
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .toLowerCase()
      .trim();
    return [...organization.positions]
      .map((position) => ({
        position,
        unit: unitById.get(position.unitId),
        holders: holdersOf.get(position.id) ?? [],
        suggestion: suggestReportsTo(position, unitById),
      }))
      .filter(({ position, unit }) => {
        if (!keyword) return true;
        const text = `${position.name} ${unit?.name ?? ''}`
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/đ/g, 'd')
          .toLowerCase();
        return text.includes(keyword);
      })
      .sort(
        (left, right) =>
          (left.unit?.name ?? '').localeCompare(right.unit?.name ?? '', 'vi') ||
          left.position.name.localeCompare(right.position.name, 'vi'),
      );
  }, [organization.positions, unitById, holdersOf, search]);

  const save = async (positionId: string, next: string | null) => {
    setSaving(positionId);
    setError(undefined);
    try {
      await onSave(positionId, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được "Báo cáo cho".');
    } finally {
      setSaving(undefined);
    }
  };

  const pendingSuggestions = rows.filter(
    (row) => !row.position.reportsToPositionId && row.suggestion,
  );
  const applySuggestions = async () => {
    for (const row of pendingSuggestions) {
      // Tuần tự chứ không song song: mỗi lần ghi Core kiểm vòng lặp trên dữ liệu
      // đã ghi trước đó; ghi song song thì hai gợi ý có thể cùng lọt qua kiểm tra.
      await save(row.position.id, row.suggestion ?? null);
    }
  };

  return (
    <section className={styles.panel} aria-label="Quản lý chức danh">
      <header className={styles.header}>
        <div>
          <h2>Quản lý chức danh</h2>
          <p>
            Khai báo mỗi chức danh <strong>báo cáo cho</strong> chức danh nào. Quy trình dùng quan hệ này
            để tìm “Quản lý trực tiếp của người khởi tạo”; chức danh trống thì hệ thống tự leo lên cấp trên.
          </p>
        </div>
        <div className={styles.tools}>
          <input
            className={styles.search}
            value={search}
            placeholder="Tìm chức danh hoặc đơn vị…"
            aria-label="Tìm chức danh"
            onChange={(event) => setSearch(event.target.value)}
          />
          {canEdit ? (
            <button
              type="button"
              className={styles.primary}
              disabled={!pendingSuggestions.length || Boolean(saving)}
              onClick={() => void applySuggestions()}
            >
              Áp dụng gợi ý cho {pendingSuggestions.length} ô trống
            </button>
          ) : null}
        </div>
      </header>

      {!canEdit ? (
        <p className={styles.readonly}>Chỉ quản trị tenant mới sửa được quan hệ báo cáo.</p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Chức danh</th>
              <th>Đơn vị</th>
              <th>Người giữ</th>
              <th>Báo cáo cho</th>
              <th>Gợi ý từ cây</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ position, unit, holders, suggestion }) => {
              const options = organization.positions
                .filter(
                  (candidate) =>
                    candidate.id !== position.id &&
                    (!position.treeId || !candidate.treeId || candidate.treeId === position.treeId),
                )
                .map((candidate) => ({
                  value: candidate.id,
                  label: candidate.name,
                  description: unitById.get(candidate.unitId)?.name,
                }));
              const current = position.reportsToPositionId ?? '';
              return (
                <tr key={position.id}>
                  <td className={styles.name}>{position.name}</td>
                  <td>{unit?.name ?? '—'}</td>
                  <td>
                    {holders.length ? (
                      holders.join(', ')
                    ) : (
                      <span className={styles.vacant}>Đang trống</span>
                    )}
                  </td>
                  <td className={styles.selectCell}>
                    <SearchableSelect
                      options={options}
                      value={current}
                      placeholder="Chưa khai báo"
                      disabled={!canEdit || saving === position.id}
                      onChange={(value) => {
                        if (value === current) return;
                        void save(position.id, value || null);
                      }}
                    />
                  </td>
                  <td>
                    {suggestion && suggestion !== current ? (
                      <button
                        type="button"
                        className={styles.suggestion}
                        disabled={!canEdit || Boolean(saving)}
                        title="Dùng gợi ý này"
                        onClick={() => void save(position.id, suggestion)}
                      >
                        {label(suggestion)}
                      </button>
                    ) : suggestion ? (
                      <span className={styles.matched}>Khớp gợi ý</span>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td className={styles.empty} colSpan={5}>
                  Không có chức danh nào{search ? ' khớp từ khoá' : ''}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
