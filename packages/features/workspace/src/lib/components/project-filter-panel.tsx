'use client';

import {
  PROJECT_STATUSES,
  type CustomerSummary,
  type ProjectGroup,
  type Tag,
} from '@enterprise-platform/contracts-workspace';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Filter, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { orgUnitOptions } from '../org-units';
import {
  EMPTY_PROJECT_FILTER,
  PROJECT_FILTER_FIELDS,
  activeConditionCount,
  fieldOf,
  fold,
  operatorsOf,
  type FilterCondition,
  type ProjectFilter,
  type ProjectFilterFieldKey,
} from '../project-filter.model';
import * as api from '../workspace-api';
import { PROJECT_STATUS_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { useDirectory } from './use-directory';

interface Option {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

/** Danh mục cho các trường chọn (nhóm, nhãn, khách hàng, người, phòng ban); tải khi mở bảng lọc. */
function useFilterSources(open: boolean) {
  const directory = useDirectory();
  const [groups, setGroups] = useState<readonly ProjectGroup[]>([]);
  const [tags, setTags] = useState<readonly Tag[]>([]);
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    api.listProjectGroups().then((list) => setGroups(list.items)).catch(() => setGroups([]));
    api.listTags().then((list) => setTags(list.items)).catch(() => setTags([]));
    api.listCustomers().then(setCustomers).catch(() => setCustomers([]));
  }, [open]);

  return useMemo(() => {
    const options: Partial<Record<ProjectFilterFieldKey, readonly Option[]>> = {
      projectType: groups.map((group) => ({ value: group.name, label: group.name })),
      orgUnitId: orgUnitOptions(directory.orgNodes),
      status: PROJECT_STATUSES.map((status) => ({ value: status, label: PROJECT_STATUS_LABELS[status] })),
      tagIds: tags.map((tag) => ({ value: tag.id, label: tag.name })),
      customerId: customers.map((customer) => ({ value: customer.id, label: `${customer.code} · ${customer.name}` })),
      ownerUserId: directory.people.map((person) => ({
        value: person.userId,
        label: person.displayName,
        description: [person.positionName, person.unitNames.join(', ')].filter(Boolean).join(' · '),
      })),
    };
    return options;
  }, [groups, tags, customers, directory]);
}

let seq = 0;
const newCondition = (field: ProjectFilterFieldKey): FilterCondition => ({
  id: `c${Date.now()}-${(seq += 1)}`,
  field,
  operator: operatorsOf(field)[0]?.key ?? '',
});

/**
 * Nút "Lọc sâu" của trang (kèm số điều kiện đang lọc và nút xoá lọc) và bảng lọc dự án mở ra từ nó.
 */
export function ProjectFilterButton({
  filter,
  onChange,
}: {
  readonly filter: ProjectFilter;
  readonly onChange: (filter: ProjectFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = activeConditionCount(filter);
  return (
    <>
      <button
        type="button"
        className={count > 0 ? styles.buttonPrimary : styles.buttonGhost}
        onClick={() => setOpen(true)}
      >
        <Filter size={14} /> Lọc sâu
        {count > 0 ? <span className={styles.countBadge}>{count}</span> : null}
      </button>
      {count > 0 ? (
        <button type="button" className={styles.buttonSmall} onClick={() => onChange(EMPTY_PROJECT_FILTER)}>
          Bỏ lọc sâu
        </button>
      ) : null}
      <ProjectFilterPanel
        open={open}
        filter={filter}
        onClose={() => setOpen(false)}
        onApply={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </>
  );
}

/**
 * Bảng "Lọc sâu" dự án: từ khoá, rồi các điều kiện (trường, phép so sánh, giá trị). "+ Điều kiện" thêm vào nhóm
 * đang có (VÀ); "Hoặc" mở một nhóm mới. Chỉ áp dụng khi bấm "Lọc".
 */
export function ProjectFilterPanel({
  open,
  filter,
  onClose,
  onApply,
}: {
  readonly open: boolean;
  readonly filter: ProjectFilter;
  readonly onClose: () => void;
  readonly onApply: (filter: ProjectFilter) => void;
}) {
  const sources = useFilterSources(open);
  const [keyword, setKeyword] = useState('');
  const [groups, setGroups] = useState<FilterCondition[][]>([]);
  /** Đang chọn trường cho điều kiện mới: thêm vào nhóm cuối (`and`) hay mở nhóm mới (`or`). */
  const [picking, setPicking] = useState<'and' | 'or'>();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setKeyword(filter.keyword);
    setGroups(filter.groups.map((group) => [...group]));
    setPicking(undefined);
  }, [open, filter]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const update = (groupIndex: number, id: string, patch: Partial<FilterCondition>) =>
    setGroups((current) =>
      current.map((group, index) =>
        index === groupIndex ? group.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)) : group,
      ),
    );
  const remove = (groupIndex: number, id: string) =>
    setGroups((current) =>
      current
        .map((group, index) => (index === groupIndex ? group.filter((condition) => condition.id !== id) : group))
        .filter((group) => group.length > 0),
    );
  const add = (field: ProjectFilterFieldKey) => {
    const condition = newCondition(field);
    setGroups((current) =>
      picking === 'or' || current.length === 0
        ? [...current, [condition]]
        : current.map((group, index) => (index === current.length - 1 ? [...group, condition] : group)),
    );
    setPicking(undefined);
  };

  return createPortal(
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <div
        className={`${styles.dialog} ${styles.filterPanel}`}
        role="dialog"
        aria-modal="true"
        aria-label="Lọc sâu dự án"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHead}>
          <div>
            <h3>Lọc sâu</h3>
            <p>Điều kiện cạnh nhau là VÀ; "Hoặc" mở một nhóm điều kiện mới.</p>
          </div>
          <button type="button" aria-label="Đóng" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className={styles.filterPanelBody}>
          <label className={styles.filterKeyword}>
            <span>Từ khoá</span>
            <input
              value={keyword}
              autoFocus
              placeholder="Nhập từ khoá (mã, tên, mô tả, nhóm dự án)"
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onApply({ keyword, groups });
              }}
            />
          </label>

          {groups.map((group, groupIndex) => (
            <div key={group[0]?.id ?? groupIndex} className={styles.filterGroup}>
              {groupIndex > 0 ? <div className={styles.filterOr}>Hoặc</div> : null}
              {group.map((condition) => (
                <ConditionRow
                  key={condition.id}
                  condition={condition}
                  options={sources[condition.field] ?? []}
                  onChange={(patch) => update(groupIndex, condition.id, patch)}
                  onRemove={() => remove(groupIndex, condition.id)}
                />
              ))}
            </div>
          ))}

          <div className={styles.filterAdd}>
            <button type="button" className={styles.buttonSmall} onClick={() => setPicking(picking === 'and' ? undefined : 'and')}>
              <Plus size={13} /> Điều kiện
            </button>
            <button
              type="button"
              className={styles.buttonSmall}
              disabled={groups.length === 0}
              title={groups.length === 0 ? 'Thêm một điều kiện trước' : 'Mở một nhóm điều kiện mới'}
              onClick={() => setPicking(picking === 'or' ? undefined : 'or')}
            >
              Hoặc
            </button>
            {picking ? <FieldPicker onPick={add} onClose={() => setPicking(undefined)} /> : null}
          </div>
        </div>

        <footer className={styles.dialogFoot}>
          <button
            type="button"
            className={styles.buttonGhost}
            onClick={() => {
              setKeyword('');
              setGroups([]);
            }}
          >
            Xoá hết
          </button>
          <button type="button" className={styles.buttonPrimary} onClick={() => onApply({ keyword, groups })}>
            <Filter size={14} /> Lọc
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Danh sách trường để thêm điều kiện, có ô tìm. */
function FieldPicker({
  onPick,
  onClose,
}: {
  readonly onPick: (field: ProjectFilterFieldKey) => void;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useOutsideClose(box, onClose);
  const fields = PROJECT_FILTER_FIELDS.filter((field) => fold(field.label).includes(fold(query.trim())));
  return (
    <div ref={box} className={styles.filterMenu} role="listbox" aria-label="Chọn trường">
      <div className={styles.filterMenuSearch}>
        <input
          value={query}
          autoFocus
          placeholder="Tìm kiếm"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
            if (event.key === 'Enter' && fields[0]) onPick(fields[0].key);
          }}
        />
        <Search size={15} />
      </div>
      {fields.map((field) => (
        <button key={field.key} type="button" role="option" aria-selected={false} onClick={() => onPick(field.key)}>
          {field.label}
        </button>
      ))}
      {fields.length === 0 ? <p className={styles.muted}>Không có trường nào khớp.</p> : null}
    </div>
  );
}

/** Một điều kiện: "Tên trường [phép so sánh]" và ô giá trị theo kiểu trường. */
function ConditionRow({
  condition,
  options,
  onChange,
  onRemove,
}: {
  readonly condition: FilterCondition;
  readonly options: readonly Option[];
  readonly onChange: (patch: Partial<FilterCondition>) => void;
  readonly onRemove: () => void;
}) {
  const field = fieldOf(condition.field);
  const operators = operatorsOf(condition.field);
  const operator = operators.find((entry) => entry.key === condition.operator) ?? operators[0];
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useOutsideClose(box, () => setMenu(false), menu);

  return (
    <div ref={box} className={styles.filterCondition}>
      <div className={styles.filterConditionHead}>
        <span className={styles.filterConditionField}>{field.label}</span>
        <div className={styles.filterOperator}>
          <button type="button" aria-haspopup="listbox" aria-expanded={menu} onClick={() => setMenu((value) => !value)}>
            {operator?.label}
          </button>
        </div>
        <button type="button" className={styles.filterRemove} aria-label={`Bỏ điều kiện ${field.label}`} onClick={onRemove}>
          <X size={15} />
        </button>
      </div>
      {/* Danh sách phép so sánh mở ngay dưới tên trường, trong luồng của bảng (không nổi lên để khỏi bị khung cuộn cắt). */}
      {menu ? (
            <div className={styles.filterMenu} role="listbox" aria-label="Phép so sánh">
              {operators.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  role="option"
                  aria-selected={entry.key === condition.operator}
                  className={entry.key === condition.operator ? styles.filterMenuActive : undefined}
                  onClick={() => {
                    onChange({ operator: entry.key });
                    setMenu(false);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
      ) : null}
      {operator && operator.needs > 0 ? (
        <ConditionValue condition={condition} type={field.type} two={operator.needs === 2} options={options} onChange={onChange} />
      ) : null}
    </div>
  );
}

function ConditionValue({
  condition,
  type,
  two,
  options,
  onChange,
}: {
  readonly condition: FilterCondition;
  readonly type: 'text' | 'date' | 'select' | 'number';
  readonly two: boolean;
  readonly options: readonly Option[];
  readonly onChange: (patch: Partial<FilterCondition>) => void;
}) {
  if (type === 'select') {
    const chosen = condition.values ?? [];
    const labelOf = (value: string) => options.find((option) => option.value === value)?.label ?? value;
    return (
      <div className={styles.filterChips}>
        {chosen.map((value) => (
          <span key={value} className={styles.filterChip}>
            {labelOf(value)}
            <button
              type="button"
              aria-label={`Bỏ ${labelOf(value)}`}
              onClick={() => onChange({ values: chosen.filter((entry) => entry !== value) })}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <SearchableSelect
          options={options.filter((option) => !chosen.includes(option.value))}
          value=""
          placeholder={chosen.length > 0 ? 'Thêm…' : 'Chọn…'}
          emptyText="Không có lựa chọn nào khớp."
          clearable={false}
          onChange={(value) => value && onChange({ values: [...chosen, value] })}
        />
      </div>
    );
  }
  if (type === 'date') {
    return (
      <div className={styles.filterValues}>
        <DatePickerInput height={36} value={condition.value ?? ''} onChange={(value) => onChange({ value })} />
        {two ? (
          <>
            <span className={styles.muted}>đến</span>
            <DatePickerInput height={36} value={condition.value2 ?? ''} onChange={(value2) => onChange({ value2 })} />
          </>
        ) : null}
      </div>
    );
  }
  const inputType = type === 'number' ? 'number' : 'text';
  return (
    <div className={styles.filterValues}>
      <input
        type={inputType}
        value={condition.value ?? ''}
        placeholder={type === 'number' ? 'Giá trị' : 'Nhập giá trị'}
        onChange={(event) => onChange({ value: event.target.value })}
      />
      {two ? (
        <>
          <span className={styles.muted}>đến</span>
          <input
            type={inputType}
            value={condition.value2 ?? ''}
            placeholder="Giá trị"
            onChange={(event) => onChange({ value2: event.target.value })}
          />
        </>
      ) : null}
    </div>
  );
}

/** Bấm ra ngoài khung thì đóng (danh sách trường, danh sách phép so sánh). */
function useOutsideClose(box: React.RefObject<HTMLElement | null>, onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [box, onClose, active]);
}
