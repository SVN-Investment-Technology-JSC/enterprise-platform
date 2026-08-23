'use client';

import type {
  OrganizationMember,
  OrganizationUnit,
  TenantOrganizationSnapshot,
} from '@enterprise-platform/contracts-organization';
import { useMemo, useState } from 'react';
import styles from './org-chart.module.css';

export function OrgChart({ snapshot }: { snapshot: TenantOrganizationSnapshot }) {
  // Chuẩn hoá một lần: snapshot đến từ Core qua HTTP, một phản hồi thiếu trường
  // không được phép làm trắng cả trang sơ đồ tổ chức.
  const units = snapshot.units ?? [];
  const members = snapshot.members ?? [];
  const unitTypes = snapshot.unitTypes ?? [];

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | undefined>(
    units.find((unit) => !unit.parentId)?.id,
  );

  const typeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of unitTypes) map.set(type.id, type.name);
    return map;
  }, [unitTypes]);

  const childrenOf = useMemo(() => {
    const map = new Map<string | undefined, OrganizationUnit[]>();
    for (const unit of units) {
      // API trả parentId = null cho đơn vị gốc; ép về undefined để gốc chỉ có
      // một khoá, nếu không `childrenOf.get(undefined)` sẽ không thấy gốc nào.
      const parentId = unit.parentId ?? undefined;
      const list = map.get(parentId) ?? [];
      list.push(unit);
      map.set(parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    return map;
  }, [units]);

  const membersOf = useMemo(() => {
    const map = new Map<string, OrganizationMember[]>();
    for (const member of members) {
      if (!member.unitId) continue;
      const list = map.get(member.unitId) ?? [];
      list.push(member);
      map.set(member.unitId, list);
    }
    // Trưởng đơn vị lên đầu, còn lại theo tên.
    for (const list of map.values()) {
      list.sort((a, b) =>
        a.isHead === b.isHead ? a.displayName.localeCompare(b.displayName, 'vi') : a.isHead ? -1 : 1,
      );
    }
    return map;
  }, [members]);

  /** Số người tính cả các đơn vị con, để cấp cha phản ánh đúng quy mô. */
  const totalOf = useMemo(() => {
    const map = new Map<string, number>();
    const walk = (unit: OrganizationUnit): number => {
      const own = membersOf.get(unit.id)?.length ?? 0;
      const sub = (childrenOf.get(unit.id) ?? []).reduce((sum, child) => sum + walk(child), 0);
      const total = own + sub;
      map.set(unit.id, total);
      return total;
    };
    for (const root of childrenOf.get(undefined) ?? []) walk(root);
    return map;
  }, [childrenOf, membersOf]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return undefined;
    const keep = new Set<string>();
    const parentOf = new Map<string, string | undefined>(
      units.map((unit) => [unit.id, unit.parentId ?? undefined]),
    );
    const markUp = (unitId: string) => {
      let current: string | undefined = unitId;
      while (current) {
        keep.add(current);
        current = parentOf.get(current);
      }
    };
    for (const unit of units) {
      if (unit.name.toLowerCase().includes(needle) || unit.code.toLowerCase().includes(needle)) {
        markUp(unit.id);
      }
    }
    for (const member of members) {
      if (member.unitId && member.displayName.toLowerCase().includes(needle)) markUp(member.unitId);
    }
    return keep;
  }, [query, units, members]);

  const selected = units.find((unit) => unit.id === selectedId);
  const selectedMembers = selectedId ? membersOf.get(selectedId) ?? [] : [];

  const renderUnit = (unit: OrganizationUnit, depth: number) => {
    if (matches && !matches.has(unit.id)) return null;
    const kids = childrenOf.get(unit.id) ?? [];
    const count = totalOf.get(unit.id) ?? 0;
    return (
      <li key={unit.id}>
        <button
          type="button"
          className={`${styles.node} ${unit.id === selectedId ? styles.nodeActive : ''}`}
          style={{ paddingLeft: `${0.6 + depth * 1.1}rem` }}
          onClick={() => setSelectedId(unit.id)}
        >
          <span className={styles.nodeName}>{unit.name}</span>
          <span className={styles.nodeMeta}>
            {typeName.get(unit.typeId) ?? '—'}
            {count > 0 ? ` · ${count}` : ''}
          </span>
        </button>
        {kids.length > 0 ? <ul className={styles.branch}>{kids.map((kid) => renderUnit(kid, depth + 1))}</ul> : null}
      </li>
    );
  };

  return (
    <div className={styles.layout}>
      <aside className={styles.tree}>
        <input
          className={styles.search}
          placeholder="Tìm đơn vị hoặc người…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className={styles.branch}>
          {(childrenOf.get(undefined) ?? []).map((root) => renderUnit(root, 0))}
        </ul>
      </aside>

      <section className={styles.detail}>
        {selected ? (
          <>
            <header className={styles.detailHead}>
              <span>{typeName.get(selected.typeId) ?? '—'}</span>
              <h2>{selected.name}</h2>
              <p>
                {selected.code}
                {selected.headName ? ` · Phụ trách: ${selected.headName}` : ' · Chưa có người phụ trách'}
              </p>
            </header>

            {selectedMembers.length === 0 ? (
              <p className={styles.empty}>Đơn vị này chưa có nhân sự.</p>
            ) : (
              <ul className={styles.people}>
                {selectedMembers.map((member) => (
                  <li key={member.membershipId} className={styles.person}>
                    <span className={styles.avatar} aria-hidden="true">
                      {member.displayName.trim().slice(-1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{member.displayName}</strong>
                      <small>{member.positionName ?? 'Chưa có chức danh'}</small>
                    </span>
                    {member.isHead ? <span className={styles.headTag}>Phụ trách</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className={styles.empty}>Chọn một đơn vị để xem chi tiết.</p>
        )}
      </section>
    </div>
  );
}
