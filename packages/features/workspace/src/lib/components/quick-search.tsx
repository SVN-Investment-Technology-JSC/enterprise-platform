'use client';

import type {
  DocumentSummary,
  MyWorkItem,
  ProjectSummary,
} from '@enterprise-platform/contracts-workspace';
import { Briefcase, FileText, LayoutList, ListChecks, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';

/** Nơi mà một kết quả tìm kiếm dẫn tới. */
export type QuickSearchTarget =
  | { readonly kind: 'page'; readonly view: 'my-work' | 'projects' | 'documents' | 'reports' }
  | { readonly kind: 'project'; readonly projectId: string }
  | { readonly kind: 'work-item'; readonly projectId: string; readonly workItemId: string }
  | { readonly kind: 'document'; readonly documentId: string };

export interface QuickSearchProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onPick: (target: QuickSearchTarget) => void;
}

interface ResultRow {
  readonly key: string;
  readonly group: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly hint?: string;
  readonly target: QuickSearchTarget;
}

const PAGES: readonly { view: 'my-work' | 'projects' | 'documents' | 'reports'; label: string }[] =
  [
    { view: 'my-work', label: 'Công việc của tôi' },
    { view: 'projects', label: 'Dự án' },
    { view: 'documents', label: 'Tài liệu' },
    { view: 'reports', label: 'Báo cáo' },
  ];

/** Số kết quả tối đa mỗi nhóm; muốn xem nhiều hơn thì mở trang tương ứng. */
const PER_GROUP = 6;

/** Bỏ dấu và chữ hoa, để gõ "cau hinh" vẫn ra "Cấu hình". */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Ô tìm nhanh toàn module, mở bằng Ctrl+K hoặc ô "Tìm nhanh" trên thanh bên.
 *
 * Tìm trong bốn nguồn người dùng thấy được: các trang của module, dự án (hỏi
 * server), việc của chính mình (từ trang Công việc của tôi) và tài liệu (hỏi
 * server). Không có endpoint tìm công việc trên mọi dự án, nên việc của người
 * khác thì vẫn tìm trong cây của dự án đó.
 */
export function QuickSearch({ open, onClose, onPick }: QuickSearchProps) {
  const [mounted, setMounted] = useState(false);
  const [term, setTerm] = useState('');
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [documents, setDocuments] = useState<readonly DocumentSummary[]>([]);
  const [myItems, setMyItems] = useState<readonly MyWorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setTerm('');
    setActive(0);
    // Việc của tôi đổi chậm, nạp một lần mỗi lần mở là đủ; hỏng thì bỏ nhóm.
    api
      .loadMyWork()
      .then((summary) => setMyItems(summary.items))
      .catch(() => setMyItems([]));
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Hỏi server sau một nhịp gõ, không phải mỗi phím.
  useEffect(() => {
    if (!open) return;
    const needle = term.trim();
    if (needle.length < 2) {
      setProjects([]);
      setDocuments([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      Promise.all([
        api.listProjects({ search: needle, pageSize: PER_GROUP }).catch(() => ({ items: [] })),
        api.listDocuments({ search: needle }).catch(() => ({ items: [] })),
      ])
        .then(([projectPage, documentPage]) => {
          if (!alive) return;
          setProjects(projectPage.items);
          setDocuments(documentPage.items.slice(0, PER_GROUP));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term, open]);

  const rows = useMemo<ResultRow[]>(() => {
    const needle = fold(term.trim());
    const pages = PAGES.filter((page) => !needle || fold(page.label).includes(needle)).map(
      (page): ResultRow => ({
        key: `page:${page.view}`,
        group: 'Trang',
        icon: <LayoutList size={15} />,
        label: page.label,
        target: { kind: 'page', view: page.view },
      }),
    );
    if (!needle) return pages;
    const mine = myItems
      .filter((entry) => fold(`${entry.item.code} ${entry.item.title}`).includes(needle))
      .slice(0, PER_GROUP)
      .map(
        (entry): ResultRow => ({
          key: `item:${entry.item.id}`,
          group: 'Việc của tôi',
          icon: <ListChecks size={15} />,
          label: `${entry.item.code} · ${entry.item.title}`,
          hint: entry.projectCode,
          target: { kind: 'work-item', projectId: entry.item.projectId, workItemId: entry.item.id },
        }),
      );
    const projectRows = projects.map(
      (project): ResultRow => ({
        key: `project:${project.id}`,
        group: 'Dự án',
        icon: <Briefcase size={15} />,
        label: `${project.code} · ${project.name}`,
        hint: `${project.progressPercent}%`,
        target: { kind: 'project', projectId: project.id },
      }),
    );
    const documentRows = documents.map(
      (document): ResultRow => ({
        key: `document:${document.id}`,
        group: 'Tài liệu',
        icon: <FileText size={15} />,
        label: document.name,
        hint: document.currentVersion ? `v${document.currentVersion.versionNo}` : undefined,
        target: { kind: 'document', documentId: document.id },
      }),
    );
    return [...pages, ...mine, ...projectRows, ...documentRows];
  }, [term, myItems, projects, documents]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (row: ResultRow | undefined) => {
    if (!row) return;
    onPick(row.target);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(rows[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  if (!open || !mounted) return null;

  return createPortal(
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.searchPanel}
        role="dialog"
        aria-modal="true"
        aria-label="Tìm nhanh"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className={styles.searchInput}>
          <Search size={18} aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={term}
            placeholder="Tìm dự án, việc của tôi, tài liệu…"
            aria-label="Từ khoá tìm nhanh"
            aria-controls="quick-search-results"
            aria-activedescendant={rows[active] ? `quick-search-${active}` : undefined}
            onChange={(event) => {
              setTerm(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          {loading ? <span className={styles.muted}>Đang tìm…</span> : null}
        </label>

        <ul id="quick-search-results" ref={listRef} className={styles.searchResults} role="listbox">
          {rows.map((row, index) => (
            <li key={row.key} role="presentation">
              {index === 0 || rows[index - 1].group !== row.group ? (
                <span className={styles.searchGroup}>{row.group}</span>
              ) : null}
              <button
                id={`quick-search-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                data-index={index}
                className={`${styles.searchRow} ${index === active ? styles.searchRowActive : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(row)}
              >
                <span className={styles.searchIcon}>{row.icon}</span>
                <span className={styles.searchLabel}>{row.label}</span>
                {row.hint ? <span className={styles.muted}>{row.hint}</span> : null}
              </button>
            </li>
          ))}
          {term.trim().length >= 2 &&
          rows.every((row) => row.target.kind === 'page') &&
          !loading ? (
            <li className={styles.searchEmpty}>
              Không tìm thấy dự án, việc hay tài liệu nào khớp.
            </li>
          ) : null}
        </ul>

        <p className={styles.searchHint}>
          <kbd>↑</kbd> <kbd>↓</kbd> để chọn · <kbd>Enter</kbd> để mở · <kbd>Esc</kbd> để đóng
        </p>
      </div>
    </div>,
    document.body,
  );
}
