'use client';

import {
  SOCIAL_GROUP_PRIVACY_LABELS,
  SOCIAL_ORG_NODE_KIND_LABELS,
  SOCIAL_ORG_NODE_MAX_PAGE_SIZE,
  SOCIAL_ORG_NODE_KINDS,
  type SocialGroupColor,
  type SocialGroupIcon,
  type SocialGroupPrivacy,
  type SocialOrgNode,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  Book,
  Briefcase,
  CalendarDays,
  Check,
  ChevronRight,
  Globe,
  Heart,
  Lightbulb,
  Lock,
  Megaphone,
  MessageSquare,
  MoreVertical,
  Rocket,
  Search,
  Star,
  Trophy,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { errorMessage, searchPeople } from '../../social-api';
import base from '../../social.module.scss';
import { Avatar, userSubtitle } from '../ui';
import { UserAvatar } from '../user-avatar';
import { addSource, coverGradient, type GroupSourceDraft } from './groups.model';
import s from './groups.module.scss';
import { searchOrgNodes } from './social-groups-api';

export const GROUP_ICON_COMPONENTS: Readonly<Record<SocialGroupIcon, LucideIcon>> = {
  users: Users,
  briefcase: Briefcase,
  megaphone: Megaphone,
  lightbulb: Lightbulb,
  book: Book,
  heart: Heart,
  rocket: Rocket,
  star: Star,
  calendar: CalendarDays,
  message: MessageSquare,
  trophy: Trophy,
  globe: Globe,
};

/** Ảnh đại diện tròn của nhóm: biểu tượng trên nền màu của nhóm. */
export function GroupGlyph({
  icon,
  color,
  size = 44,
}: {
  readonly icon: SocialGroupIcon;
  readonly color: SocialGroupColor;
  readonly size?: number;
}) {
  const Icon = GROUP_ICON_COMPONENTS[icon] ?? Users;
  return (
    <span
      className={s.glyph}
      style={{ width: size, height: size, background: coverGradient(color) }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}

export function PrivacyBadge({ privacy }: { readonly privacy: SocialGroupPrivacy }) {
  const Icon = privacy === 'private' ? Lock : Globe;
  return (
    <span className={s.privacyBadge}>
      <Icon size={12} />
      {SOCIAL_GROUP_PRIVACY_LABELS[privacy]}
    </span>
  );
}

let cachedAllPeople: readonly SocialUserRef[] | undefined;
let pendingAllPeople: Promise<readonly SocialUserRef[]> | undefined;

/** Tải danh sách toàn bộ nhân viên (tối đa 200 người) cho bộ chọn thành viên/quản lý. */
export function loadAllEmployees(): Promise<readonly SocialUserRef[]> {
  if (cachedAllPeople) return Promise.resolve(cachedAllPeople);
  if (!pendingAllPeople) {
    pendingAllPeople = searchPeople('', 200)
      .then((items) => {
        cachedAllPeople = items;
        pendingAllPeople = undefined;
        return items;
      })
      .catch((error) => {
        pendingAllPeople = undefined;
        throw error;
      });
  }
  return pendingAllPeople;
}

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

function matchesUser(user: SocialUserRef, query: string): boolean {
  if (!query.trim()) return true;
  const q = normalizeText(query.trim());
  const name = normalizeText(user.name);
  const pos = normalizeText(user.position ?? '');
  const unit = normalizeText(user.unitName ?? '');
  return name.includes(q) || pos.includes(q) || unit.includes(q);
}

/** Chọn nhiều người: chọn từ danh sách hoặc gõ để lọc, thêm thành thẻ. `exclude` là người đã có sẵn. */
export function MemberPicker({
  selected,
  onChange,
  exclude = [],
  placeholder = 'Tìm người theo tên…',
  variant = 'combobox',
}: {
  readonly selected: readonly SocialUserRef[];
  readonly onChange: (next: readonly SocialUserRef[]) => void;
  readonly exclude?: readonly string[];
  readonly placeholder?: string;
  readonly variant?: 'list' | 'combobox';
}) {
  const [people, setPeople] = useState<readonly SocialUserRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAllEmployees()
      .then((items) => {
        if (!cancelled) setPeople(items);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const excludeSet = useMemo(() => new Set(exclude), [exclude]);
  const selectedMap = useMemo(() => new Map(selected.map((user) => [user.id, user])), [selected]);
  const taken = useMemo(() => new Set([...selected.map((user) => user.id), ...exclude]), [selected, exclude]);

  const options = useMemo(
    () =>
      variant === 'list'
        ? []
        : people
            .filter((user) => !taken.has(user.id))
            .map((user) => ({
              value: user.id,
              label: user.name,
              description: [user.position, user.unitName].filter(Boolean).join(' · '),
            })),
    [people, taken, variant],
  );

  const toggle = (user: SocialUserRef) => {
    if (selectedMap.has(user.id)) {
      onChange(selected.filter((item) => item.id !== user.id));
    } else {
      onChange([...selected, user]);
    }
  };

  const pick = (value: string) => {
    const user = people.find((u) => u.id === value);
    if (user) onChange([...selected, user]);
  };

  if (variant === 'list') {
    const visible = people.filter((user) => !excludeSet.has(user.id) && matchesUser(user, query));

    return (
      <div className={s.memberListPicker}>
        <div className={s.pickerHeader}>
          <span className={selected.length > 0 ? s.pickerBadge : s.pickerHint}>
            {selected.length > 0 ? `Đã chọn ${selected.length} người` : 'Chọn ít nhất 1 người'}
          </span>
          {selected.length > 0 ? (
            <button
              type="button"
              className={s.pickerClearBtn}
              onClick={() => onChange([])}
            >
              Bỏ chọn tất cả
            </button>
          ) : null}
        </div>

        {selected.length > 0 ? (
          <div className={s.pickerChips} aria-label="Thành viên đã chọn">
            {selected.map((user) => (
              <span key={user.id} className={s.pickerChip}>
                <Avatar user={user} size={18} />
                <span className={s.pickerChipName}>{user.name}</span>
                <button
                  type="button"
                  className={s.pickerChipRemove}
                  aria-label={`Bỏ ${user.name}`}
                  onClick={() => onChange(selected.filter((item) => item.id !== user.id))}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className={s.pickerSearch}>
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            placeholder={loading ? 'Đang tải danh sách nhân viên…' : placeholder}
            aria-label="Tìm người theo tên hoặc chức vụ"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className={s.pickerSearchClear}
              onClick={() => setQuery('')}
              aria-label="Xoá tìm kiếm"
              title="Xoá tìm kiếm"
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className={s.pickList} role="listbox" aria-multiselectable="true" aria-label="Chọn người">
          {loading ? (
            <p className={s.pickerEmpty}>Đang tải danh sách nhân viên…</p>
          ) : visible.length === 0 ? (
            <p className={s.pickerEmpty}>Không có người phù hợp.</p>
          ) : (
            visible.map((user) => {
              const on = selectedMap.has(user.id);
              const subtitle = userSubtitle(user);
              return (
                <button
                  key={user.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={s.pickRow}
                  onClick={() => toggle(user)}
                >
                  <span className={on ? `${s.check} ${s.checkOn}` : s.check} aria-hidden="true">
                    {on ? <Check size={12} strokeWidth={2.5} /> : null}
                  </span>
                  <Avatar user={user} size={30} />
                  <div className={s.pickInfo}>
                    <span className={s.pickName}>{user.name}</span>
                    {subtitle ? <small className={s.pickMeta}>{subtitle}</small> : null}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={base.peoplePicker}>
      {selected.length > 0 ? (
        <ul className={base.chips}>
          {selected.map((user) => (
            <li key={user.id} className={base.chip}>
              <span>{user.name}</span>
              <button
                type="button"
                className={base.chipRemove}
                aria-label={`Bỏ ${user.name}`}
                onClick={() => onChange(selected.filter((item) => item.id !== user.id))}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <SearchableSelect
        options={options}
        value=""
        height={36}
        placeholder={loading ? 'Đang tải danh sách nhân viên…' : placeholder}
        searchPlaceholder="Tìm người theo tên hoặc chức vụ…"
        emptyText="Không có nhân viên phù hợp."
        disabled={loading}
        onChange={pick}
        renderOption={(option) => {
          const user = people.find((u) => u.id === option.value);
          if (!user) return <span>{option.label}</span>;
          const subtitle = userSubtitle(user);
          return (
            <div className={s.pickerOption}>
              <Avatar user={user} size={26} />
              <div className={s.pickerOptionMeta}>
                <span className={s.pickerOptionName}>{user.name}</span>
                {subtitle ? <span className={s.pickerOptionSub}>{subtitle}</span> : null}
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}

/** Hàng ngang vài ảnh đại diện chồng nhẹ lên nhau. */
export function AvatarStack({ users, size = 28 }: { readonly users: readonly SocialUserRef[]; readonly size?: number }) {
  if (users.length === 0) return null;
  return (
    <span className={s.avatarStack}>
      {users.map((user) => (
        <span key={user.id} className={s.avatarStackItem} title={user.name}>
          <UserAvatar user={user} size={size} />
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------------------- menu ⋮ */

export interface GroupMenuItem {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly danger?: boolean;
  readonly onSelect?: () => void;
  /** Có mục con: bấm để mở rộng ngay dưới (không đóng menu). */
  readonly children?: readonly Omit<GroupMenuItem, 'children'>[];
}

/** Nút ⋮ mở menu thả; bấm ra ngoài hoặc Esc để đóng. */
export function GroupMenu({
  items,
  label = 'Thêm hành động',
  trigger,
}: {
  readonly items: readonly GroupMenuItem[];
  readonly label?: string;
  readonly trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  const select = (item: Omit<GroupMenuItem, 'children'>) => {
    setOpen(false);
    setExpanded(undefined);
    item.onSelect?.();
  };

  const row = (item: Omit<GroupMenuItem, 'children'>, nested: boolean) => {
    const Icon = item.icon;
    return (
      <button
        key={item.key}
        type="button"
        role="menuitem"
        className={s.menuItem}
        data-danger={item.danger ? 'true' : undefined}
        data-nested={nested ? 'true' : undefined}
        onClick={() => select(item)}
      >
        <Icon size={15} aria-hidden="true" />
        <span>{item.label}</span>
      </button>
    );
  };

  return (
    <span className={s.menuWrap} ref={ref}>
      <button
        type="button"
        className={s.iconBtn}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger ?? <MoreVertical size={16} />}
      </button>
      {open ? (
        <div className={s.menu} role="menu">
          {items.map((item) => {
            if (!item.children) return row(item, false);
            const Icon = item.icon;
            const isOpen = expanded === item.key;
            return (
              <div key={item.key}>
                <button
                  type="button"
                  role="menuitem"
                  aria-expanded={isOpen}
                  className={s.menuItem}
                  onClick={() => setExpanded(isOpen ? undefined : item.key)}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{item.label}</span>
                  <ChevronRight size={14} className={s.menuCaret} data-open={isOpen} aria-hidden="true" />
                </button>
                {isOpen ? item.children.map((child) => row(child, true)) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

/* ----------------------------------------------------------------- chọn phòng ban, vị trí */

/**
 * Chọn nguồn thành viên theo phòng ban/vị trí: danh sách nút nạp một lần (tối đa 200 mỗi loại), lọc tại chỗ
 * bằng `SearchableSelect`. Mỗi nguồn đã chọn có ô "gồm cả đơn vị con".
 */
export function OrgSourcePicker({
  sources,
  onChange,
}: {
  readonly sources: readonly GroupSourceDraft[];
  readonly onChange: (next: readonly GroupSourceDraft[]) => void;
}) {
  const [nodes, setNodes] = useState<readonly SocialOrgNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      SOCIAL_ORG_NODE_KINDS.map((kind) => searchOrgNodes({ kind, limit: SOCIAL_ORG_NODE_MAX_PAGE_SIZE })),
    )
      .then((pages) => {
        if (!cancelled) setNodes(pages.flatMap((page) => page.items));
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause, 'Không tải được sơ đồ tổ chức.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(
    () =>
      nodes
        .filter((node) => !sources.some((item) => item.type === node.kind && item.id === node.id))
        .map((node) => ({
          value: `${node.kind}:${node.id}`,
          label: node.name,
          description: [SOCIAL_ORG_NODE_KIND_LABELS[node.kind], node.parentName].filter(Boolean).join(' · '),
          badge: String(node.memberCount),
        })),
    [nodes, sources],
  );

  const pick = (value: string) => {
    const node = nodes.find((item) => `${item.kind}:${item.id}` === value);
    if (node) onChange(addSource(sources, { id: node.id, type: node.kind, name: node.name }));
  };

  return (
    <div className={s.sourcePicker}>
      {sources.length > 0 ? (
        <ul className={s.sourceList}>
          {sources.map((source) => (
            <li key={`${source.type}:${source.id}`} className={s.sourceRow}>
              <span className={s.sourceName}>
                {source.name}
                <small>{SOCIAL_ORG_NODE_KIND_LABELS[source.type]}</small>
              </span>
              <label className={s.sourceCheck}>
                <input
                  type="checkbox"
                  checked={source.includeDescendants}
                  onChange={(event) =>
                    onChange(
                      sources.map((item) =>
                        item === source ? { ...item, includeDescendants: event.target.checked } : item,
                      ),
                    )
                  }
                />
                Gồm cả đơn vị con
              </label>
              <button
                type="button"
                className={base.chipRemove}
                aria-label={`Bỏ ${source.name}`}
                onClick={() => onChange(sources.filter((item) => item !== source))}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <SearchableSelect
        options={options}
        value=""
        height={36}
        placeholder={loading ? 'Đang tải sơ đồ tổ chức…' : 'Chọn phòng ban, vị trí…'}
        searchPlaceholder="Tìm phòng ban, vị trí…"
        emptyText="Không có phòng ban hoặc vị trí phù hợp."
        disabled={loading}
        onChange={pick}
      />
      {error ? (
        <p role="alert" className={s.inlineError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
