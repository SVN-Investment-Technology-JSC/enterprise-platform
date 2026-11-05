'use client';

import type { DirectoryOrgNode, DirectoryPerson } from '@enterprise-platform/contracts-workspace';
import { Briefcase, Building2, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildOrgTree,
  checkStateOf,
  toggleGroup,
  type CheckState,
} from '../org-tree.model';
import styles from '../workspace.module.scss';
import { fold } from './people-picker';

export interface MemberAddPanelProps {
  /** Nhân sự đang làm việc (danh bạ lấy từ cơ cấu tổ chức). */
  readonly people: readonly DirectoryPerson[];
  readonly orgNodes: readonly DirectoryOrgNode[];
  /** Người đã là thành viên: hiện đã tích và khoá. */
  readonly exclude: readonly string[];
  readonly degraded: boolean;
  readonly loaded: boolean;
  readonly onAdd: (userIds: readonly string[]) => void;
}

type Mode = 'name' | 'org';

/** Ô tích có trạng thái nửa vời ("-"), thuộc tính `indeterminate` chỉ đặt được bằng script. */
function TriCheckbox({
  state,
  disabled,
  label,
  onToggle,
}: {
  state: CheckState;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'indeterminate';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === 'checked'}
      disabled={disabled}
      aria-label={label}
      aria-checked={state === 'indeterminate' ? 'mixed' : state === 'checked'}
      onChange={onToggle}
    />
  );
}

function personMatches(person: DirectoryPerson, needle: string): boolean {
  if (!needle) return true;
  const haystack = [person.displayName, person.email ?? '', person.positionName ?? '', ...person.unitNames];
  return fold(haystack.join(' ')).includes(needle);
}

function personLine(person: DirectoryPerson): string {
  return [person.positionName, person.unitNames.join(', ')].filter(Boolean).join(' · ');
}

/**
 * Thêm thành viên: chọn nhiều người một lần, theo tên hoặc theo đơn vị.
 *
 * Trạng thái chọn là tập `userId`, ô tích của đơn vị chỉ là kết quả suy ra từ
 * tập đó. Nhờ vậy tích đơn vị cha tự tích mọi đơn vị con lồng bên trong, và
 * chọn lẻ một người thì đơn vị cha hiện "-" mà không phải đồng bộ tay.
 */
export function MemberAddPanel({
  people,
  orgNodes,
  exclude,
  degraded,
  loaded,
  onAdd,
}: MemberAddPanelProps) {
  const [mode, setMode] = useState<Mode>('name');
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const locked = useMemo(() => new Set(exclude), [exclude]);
  const needle = fold(term.trim());

  const filteredPeople = useMemo(
    () => people.filter((person) => personMatches(person, needle)),
    [people, needle],
  );

  const tree = useMemo(() => buildOrgTree(orgNodes, people), [orgNodes, people]);

  /** Khi đang tìm: node khớp tên, hoặc có người khớp, cùng mọi node cha — tự bung. */
  const visible = useMemo(() => {
    if (!needle) return undefined;
    const parentOf = new Map(orgNodes.map((node) => [node.id, node.parentId]));
    const keep = new Set<string>();
    const mark = (nodeId: string | undefined) => {
      let current = nodeId;
      while (current && !keep.has(current)) {
        keep.add(current);
        current = parentOf.get(current);
      }
    };
    for (const node of orgNodes) if (fold(node.name).includes(needle)) mark(node.id);
    for (const [nodeId, list] of tree.direct) {
      if (list.some((person) => personMatches(person, needle))) mark(nodeId);
    }
    return keep;
  }, [needle, orgNodes, tree]);

  const toggleExpanded = (nodeId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });

  const togglePerson = (userId: string) =>
    setPicked((current) => toggleGroup([userId], current, locked));

  const toggleNode = (nodeId: string) =>
    setPicked((current) => toggleGroup(tree.under.get(nodeId) ?? [], current, locked));

  const renderNode = (node: DirectoryOrgNode, depth: number) => {
    if (visible && !visible.has(node.id)) return null;
    const kids = tree.children.get(node.id) ?? [];
    const own = tree.direct.get(node.id) ?? [];
    const expandable = kids.length > 0 || own.length > 0;
    const open = Boolean(visible) || expanded.has(node.id);
    const members = tree.under.get(node.id) ?? [];
    const state = checkStateOf(members, picked, locked);
    const shown = visible ? own.filter((person) => personMatches(person, needle)) : own;
    // Đơn vị khớp tên thì hiện đủ người của nó, không chỉ người khớp từ khoá.
    const peopleHere = visible && fold(node.name).includes(needle) ? own : shown;
    return (
      <li key={node.id} role="none">
        <div
          className={styles.treeRow}
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={expandable ? open : undefined}
          aria-selected={state === 'checked'}
          style={{ paddingLeft: depth * 18 + 4 }}
        >
          {expandable ? (
            <button
              type="button"
              className={styles.treeToggle}
              aria-label={open ? `Thu gọn ${node.name}` : `Mở ${node.name}`}
              onClick={() => toggleExpanded(node.id)}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className={styles.treeToggle} aria-hidden />
          )}
          <TriCheckbox
            state={state}
            disabled={members.every((userId) => locked.has(userId))}
            label={`Chọn tất cả nhân sự của ${node.name}`}
            onToggle={() => toggleNode(node.id)}
          />
          <span className={styles.treeLabel} onClick={() => toggleExpanded(node.id)}>
            {node.kind === 'position' ? (
              <Briefcase size={14} className={styles.treeIcon} aria-hidden />
            ) : (
              <Building2 size={14} className={styles.treeIcon} aria-hidden />
            )}
            <span className={styles.treeName}>{node.name}</span>
            <span className={styles.treeCount}>{members.length}</span>
          </span>
        </div>
        {open ? (
          <ul role="group" className={styles.treeChildren}>
            {kids.map((child) => renderNode(child, depth + 1))}
            {peopleHere.map((person) => (
              <li key={person.userId} role="none">
                <label className={styles.treeRow} style={{ paddingLeft: (depth + 1) * 18 + 4 }}>
                  <span className={styles.treeToggle} aria-hidden />
                  <TriCheckbox
                    state={checkStateOf([person.userId], picked, locked)}
                    disabled={locked.has(person.userId)}
                    label={person.displayName}
                    onToggle={() => togglePerson(person.userId)}
                  />
                  <span className={styles.treeLabel}>
                    <span className={styles.treeName}>{person.displayName}</span>
                    {locked.has(person.userId) ? <span className={styles.treeCount}>Đã thêm</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  };

  const count = picked.size;
  const unavailable = degraded
    ? 'Không đọc được danh bạ tổ chức lúc này. Thử lại sau ít phút.'
    : loaded && people.length === 0
      ? 'Danh bạ tổ chức đang trống. Cần dựng cơ cấu tổ chức và bổ nhiệm nhân sự ở Tenant Portal trước.'
      : undefined;

  return (
    <section className={styles.addPanel} aria-label="Thêm thành viên">
      <div className={styles.addPanelHead}>
        <span className={styles.fieldLabel}>Thêm thành viên</span>
        <div className={styles.segmented} role="tablist" aria-label="Cách thêm thành viên">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'name'}
            className={mode === 'name' ? styles.segmentActive : styles.segment}
            onClick={() => setMode('name')}
          >
            Theo tên
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'org'}
            className={mode === 'org' ? styles.segmentActive : styles.segment}
            onClick={() => setMode('org')}
          >
            Theo đơn vị / chức danh
          </button>
        </div>
      </div>

      {unavailable ? (
        <p className={styles.muted} role="status">
          {unavailable}
        </p>
      ) : (
        <>
          <div className={styles.searchBox}>
            <Search size={14} aria-hidden />
            <input
              value={term}
              placeholder={mode === 'name' ? 'Tìm theo tên, email hoặc đơn vị' : 'Tìm đơn vị, chức danh hoặc nhân sự'}
              aria-label="Tìm kiếm"
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
              }}
            />
          </div>

          {mode === 'name' ? (
            <ul className={styles.addScroll} aria-label="Nhân sự đang làm việc">
              {filteredPeople.length === 0 ? (
                <li className={styles.muted}>Không tìm thấy ai khớp.</li>
              ) : (
                filteredPeople.map((person) => (
                  <li key={person.userId}>
                    <label className={styles.personRow}>
                      <TriCheckbox
                        state={checkStateOf([person.userId], picked, locked)}
                        disabled={locked.has(person.userId)}
                        label={person.displayName}
                        onToggle={() => togglePerson(person.userId)}
                      />
                      <span className={styles.personText}>
                        <strong>{person.displayName}</strong>
                        <span className={styles.muted}>{personLine(person)}</span>
                      </span>
                      {locked.has(person.userId) ? <span className={styles.treeCount}>Đã thêm</span> : null}
                    </label>
                  </li>
                ))
              )}
            </ul>
          ) : orgNodes.length === 0 ? (
            <p className={styles.muted} role="status">
              Chưa đọc được cây cơ cấu tổ chức. Hãy thêm theo tên.
            </p>
          ) : (
            <ul className={styles.addScroll} role="tree" aria-label="Cơ cấu tổ chức">
              {tree.roots.length === 0 || (visible && visible.size === 0) ? (
                <li className={styles.muted}>Không có đơn vị hay nhân sự nào khớp.</li>
              ) : (
                tree.roots.map((node) => renderNode(node, 0))
              )}
            </ul>
          )}

          <div className={styles.addFoot}>
            <span className={styles.muted}>
              {count === 0 ? 'Tích để chọn nhân sự.' : `Đã chọn ${count} người`}
            </span>
            <button
              type="button"
              className={styles.buttonGhost}
              disabled={count === 0}
              onClick={() => {
                onAdd([...picked]);
                setPicked(new Set());
              }}
            >
              Thêm {count > 0 ? `${count} người` : ''}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
