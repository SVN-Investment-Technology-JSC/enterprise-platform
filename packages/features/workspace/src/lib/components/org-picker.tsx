'use client';

import type { DirectoryOrgNode, DirectoryPerson } from '@enterprise-platform/contracts-workspace';
import { Briefcase, Building2, ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { fold } from './people-picker';

export interface OrgPickerProps {
  readonly nodes: readonly DirectoryOrgNode[];
  readonly people: readonly DirectoryPerson[];
  /** Người đã có trong danh sách: không tính vào số sẽ thêm. */
  readonly exclude: readonly string[];
  readonly roleOptions: readonly { value: string; label: string }[];
  readonly defaultRole: string;
  readonly onAdd: (userIds: readonly string[], role: string) => void;
}

interface TreeRow {
  readonly node: DirectoryOrgNode;
  readonly depth: number;
  readonly hasChildren: boolean;
}

/**
 * Thêm nhiều người một lần theo cây cơ cấu tổ chức.
 *
 * Tích một đơn vị là lấy mọi người được bổ nhiệm vào đơn vị đó và các đơn vị,
 * chức danh bên dưới; tích một chức danh là lấy những người giữ chức danh đó.
 * `orgNodeIds` của mỗi người đã gồm cả chuỗi node cha, nên chỉ cần đối chiếu.
 * Node không có ai thì ẩn, để cây chỉ còn chỗ chọn được.
 */
export function OrgPicker({
  nodes,
  people,
  exclude,
  roleOptions,
  defaultRole,
  onAdd,
}: OrgPickerProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [term, setTerm] = useState('');
  const [role, setRole] = useState(defaultRole);

  /** Số người dưới mỗi node, đếm một lần. */
  const headcount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of people) {
      for (const nodeId of new Set(person.orgNodeIds ?? [])) {
        counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
      }
    }
    return counts;
  }, [people]);

  const { roots, children } = useMemo(() => {
    const present = nodes.filter((node) => (headcount.get(node.id) ?? 0) > 0);
    const ids = new Set(present.map((node) => node.id));
    const byParent = new Map<string, DirectoryOrgNode[]>();
    const top: DirectoryOrgNode[] = [];
    for (const node of present) {
      if (node.parentId && ids.has(node.parentId)) {
        const list = byParent.get(node.parentId) ?? [];
        list.push(node);
        byParent.set(node.parentId, list);
      } else {
        top.push(node);
      }
    }
    return { roots: top, children: byParent };
  }, [nodes, headcount]);

  /** Khi đang tìm: node khớp và mọi node cha của nó, tự bung ra. */
  const matching = useMemo(() => {
    const needle = fold(term.trim());
    if (!needle) return undefined;
    const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
    const keep = new Set<string>();
    for (const node of nodes) {
      if (!fold(node.name).includes(needle)) continue;
      let current: string | undefined = node.id;
      while (current && !keep.has(current)) {
        keep.add(current);
        current = parentOf.get(current);
      }
    }
    return keep;
  }, [nodes, term]);

  const rows = useMemo(() => {
    const out: TreeRow[] = [];
    const walk = (list: readonly DirectoryOrgNode[], depth: number) => {
      for (const node of list) {
        if (matching && !matching.has(node.id)) continue;
        const kids = children.get(node.id) ?? [];
        out.push({ node, depth, hasChildren: kids.length > 0 });
        if (kids.length > 0 && (matching || expanded.has(node.id))) walk(kids, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }, [roots, children, expanded, matching]);

  const excluded = useMemo(() => new Set(exclude), [exclude]);
  const picked = useMemo(() => {
    if (checked.size === 0) return [];
    return people
      .filter((person) => (person.orgNodeIds ?? []).some((nodeId) => checked.has(nodeId)))
      .map((person) => person.userId);
  }, [people, checked]);
  const toAdd = picked.filter((userId) => !excluded.has(userId));

  const toggle = (set: ReadonlySet<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  if (nodes.length === 0) {
    return (
      <p className={styles.muted} role="status">
        Chưa đọc được cây cơ cấu tổ chức. Hãy thêm người theo tên ở thẻ bên cạnh.
      </p>
    );
  }

  return (
    <div className={styles.orgPicker}>
      <input
        value={term}
        placeholder="Tìm đơn vị hoặc chức danh"
        aria-label="Tìm đơn vị hoặc chức danh"
        onChange={(event) => setTerm(event.target.value)}
      />
      <ul className={styles.orgTree} role="tree" aria-label="Cơ cấu tổ chức">
        {rows.length === 0 ? (
          <li className={styles.muted}>Không có đơn vị hay chức danh nào khớp.</li>
        ) : (
          rows.map(({ node, depth, hasChildren }) => {
            const open = Boolean(matching) || expanded.has(node.id);
            return (
              <li
                key={node.id}
                role="treeitem"
                aria-expanded={hasChildren ? open : undefined}
                aria-selected={checked.has(node.id)}
                style={{ paddingLeft: depth * 18 }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className={styles.orgToggle}
                    aria-label={open ? `Thu gọn ${node.name}` : `Mở ${node.name}`}
                    onClick={() => setExpanded((current) => toggle(current, node.id))}
                  >
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                ) : (
                  <span className={styles.orgToggle} aria-hidden />
                )}
                <input
                  type="checkbox"
                  id={`org-node-${node.id}`}
                  checked={checked.has(node.id)}
                  onChange={() => setChecked((current) => toggle(current, node.id))}
                />
                <label htmlFor={`org-node-${node.id}`} className={styles.orgLabel}>
                  {node.kind === 'position' ? (
                    <Briefcase size={14} className={styles.orgIcon} aria-hidden />
                  ) : (
                    <Building2 size={14} className={styles.orgIcon} aria-hidden />
                  )}
                  <span>{node.name}</span>
                  <span className={styles.muted}>{headcount.get(node.id) ?? 0}</span>
                </label>
              </li>
            );
          })
        )}
      </ul>

      <div className={styles.orgPickerFoot}>
        <span className={styles.muted}>
          {checked.size === 0
            ? 'Tích đơn vị hoặc chức danh để chọn người.'
            : `${toAdd.length} người sẽ được thêm` +
              (picked.length > toAdd.length
                ? ` (${picked.length - toAdd.length} người đã có trong dự án)`
                : '')}
        </span>
        <span className={styles.orgPickerActions}>
          <Choice
            label="Vai trò cho người được thêm"
            value={role}
            options={roleOptions}
            onChange={setRole}
          />
          <button
            type="button"
            className={styles.buttonGhost}
            disabled={toAdd.length === 0}
            onClick={() => {
              onAdd(toAdd, role);
              setChecked(new Set());
            }}
          >
            Thêm {toAdd.length > 0 ? `${toAdd.length} người` : ''}
          </button>
        </span>
      </div>
    </div>
  );
}
