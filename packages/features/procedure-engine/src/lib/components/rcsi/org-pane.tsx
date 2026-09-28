'use client';

import type {
  OrganizationPosition,
  OrganizationUnit,
  TenantOrganizationSnapshot,
} from '@enterprise-platform/contracts-organization';
import { Building2, ChevronDown, ChevronRight, Search, Star, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { foldVietnamese } from './columns';
import styles from './org-pane.module.scss';

interface UnitNode {
  readonly unit: OrganizationUnit;
  readonly children: UnitNode[];
  readonly positions: OrganizationPosition[];
}

/**
 * Sơ đồ tổ chức dạng cây, đặt bên phải ma trận để admin gán việc: bấm một chức
 * danh thì ma trận lọc về đúng cột đó, gán vai ngay tại hàng bước.
 */
export function OrgPane({
  organization,
  activePositionName,
  onPickPosition,
  onClose,
}: {
  organization?: TenantOrganizationSnapshot;
  activePositionName?: string;
  onPickPosition: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

  const holders = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const member of organization?.members ?? []) {
      // Cùng cách tra với cột ma trận: rơi về node được bổ nhiệm khi thiếu positionId.
      const positionId = member.positionId ?? member.unitId;
      if (!positionId) continue;
      const names = map.get(positionId) ?? [];
      if (!names.includes(member.displayName)) names.push(member.displayName);
      map.set(positionId, names);
    }
    return map;
  }, [organization]);

  const roots = useMemo(() => {
    const units = (organization?.units ?? []).filter((unit) => unit.typeCategory !== 'position');
    const ids = new Set(units.map((unit) => unit.id));
    const positions = organization?.positions ?? [];
    const build = (unit: OrganizationUnit): UnitNode => ({
      unit,
      children: units.filter((child) => child.parentId === unit.id).map(build),
      positions: positions
        .filter((position) => position.unitId === unit.id)
        .sort((left, right) =>
          // Chức danh trưởng lên đầu: người gán việc thường tìm người chịu trách nhiệm trước.
          left.id === unit.headPositionId ? -1 : right.id === unit.headPositionId ? 1 : left.name.localeCompare(right.name, 'vi'),
        ),
    });
    return units.filter((unit) => !unit.parentId || !ids.has(unit.parentId)).map(build);
  }, [organization]);

  const needle = foldVietnamese(query);
  const matches = (node: UnitNode): boolean =>
    !needle ||
    foldVietnamese(node.unit.name).includes(needle) ||
    node.positions.some((position) => foldVietnamese(position.name).includes(needle)) ||
    node.children.some(matches);

  const toggle = (id: string) =>
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderUnit = (node: UnitNode, depth: number) => {
    if (!matches(node)) return null;
    const collapsed = !needle && collapsedIds.has(node.unit.id);
    return (
      <li key={node.unit.id}>
        <button
          type="button"
          className={styles.unit}
          style={{ paddingLeft: `${0.4 + depth * 0.9}rem` }}
          onClick={() => toggle(node.unit.id)}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
          <Building2 size={13} aria-hidden="true" />
          <span>{node.unit.name}</span>
        </button>
        {collapsed ? null : (
          <ul className={styles.list}>
            {node.positions
              .filter((position) => !needle || foldVietnamese(`${position.name} ${node.unit.name}`).includes(needle))
              .map((position) => {
                const people = holders.get(position.id) ?? [];
                const active = activePositionName === position.name;
                return (
                  <li key={position.id}>
                    <button
                      type="button"
                      className={active ? styles.positionOn : styles.position}
                      style={{ paddingLeft: `${1.6 + depth * 0.9}rem` }}
                      title={`Lọc ma trận về chức danh này để gán vai${people.length ? `\nNgười giữ: ${people.join(', ')}` : ''}`}
                      onClick={() => onPickPosition(position.name)}
                    >
                      <span className={styles.positionName}>
                        {position.id === node.unit.headPositionId ? (
                          <Star size={11} aria-label="Chức danh quản lý" className={styles.headStar} />
                        ) : null}
                        {position.name}
                      </span>
                      <span className={people.length ? styles.people : styles.vacant}>
                        {people.length ? `${people.length} nhân sự` : 'Đang trống'}
                      </span>
                    </button>
                  </li>
                );
              })}
            {node.children.map((child) => renderUnit(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside className={styles.pane} aria-label="Sơ đồ tổ chức">
      <header className={styles.header}>
        <div>
          <strong>Sơ đồ tổ chức</strong>
          <small>Bấm chức danh để lọc ma trận và gán vai</small>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Ẩn sơ đồ tổ chức">
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <label className={styles.search}>
        <Search size={13} aria-hidden="true" />
        <input value={query} placeholder="Tìm đơn vị, chức danh…" onChange={(event) => setQuery(event.target.value)} />
      </label>
      {roots.length ? (
        <ul className={`${styles.list} ${styles.tree}`}>{roots.map((root) => renderUnit(root, 0))}</ul>
      ) : (
        <p className={styles.empty}>Chưa có sơ đồ tổ chức.</p>
      )}
    </aside>
  );
}
