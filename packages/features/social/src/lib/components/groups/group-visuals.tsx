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
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { errorMessage, searchPeople } from '../../social-api';
import { Button } from '../../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Avatar, userSubtitle } from '../ui';
import { UserAvatar } from '../user-avatar';
import { addSource, coverGradient, type GroupSourceDraft } from './groups.model';
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
      className="inline-flex flex-none items-center justify-center rounded-full text-white"
      style={{ width: size, height: size, background: coverGradient(color) }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.48)} />
    </span>
  );
}

export function PrivacyBadge({ privacy }: { readonly privacy: SocialGroupPrivacy }) {
  const Icon = privacy === 'private' ? Lock : Globe;
  return (
    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-slate-500">
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
      <div className="flex min-h-0 w-full flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span
            className={
              selected.length > 0
                ? 'rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700'
                : 'text-xs text-slate-500'
            }
          >
            {selected.length > 0 ? `Đã chọn ${selected.length} người` : 'Chọn ít nhất 1 người'}
          </span>
          {selected.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-slate-600 hover:bg-red-50 hover:text-red-600"
              onClick={() => onChange([])}
            >
              Bỏ chọn tất cả
            </Button>
          ) : null}
        </div>

        {selected.length > 0 ? (
          <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto" aria-label="Thành viên đã chọn">
            {selected.map((user) => (
              <span
                key={user.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-0.5 pr-1 pl-1 text-[13px]"
              >
                <Avatar user={user} size={18} />
                <span className="max-w-40 truncate">{user.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-5 rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                  aria-label={`Bỏ ${user.name}`}
                  onClick={() => onChange(selected.filter((item) => item.id !== user.id))}
                >
                  <X size={12} aria-hidden="true" />
                </Button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            className="h-[38px] rounded-md pr-9 pl-9 text-[13.5px]!"
            value={query}
            placeholder={loading ? 'Đang tải danh sách nhân viên…' : placeholder}
            aria-label="Tìm người theo tên hoặc chức vụ"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-500"
              onClick={() => setQuery('')}
              aria-label="Xoá tìm kiếm"
              title="Xoá tìm kiếm"
            >
              <X size={12} aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white" role="group" aria-label="Chọn người">
          {loading ? (
            <p className="m-0 p-3 text-center text-[13px] text-slate-500">Đang tải danh sách nhân viên…</p>
          ) : visible.length === 0 ? (
            <p className="m-0 p-3 text-center text-[13px] text-slate-500">Không có người phù hợp.</p>
          ) : (
            visible.map((user) => {
              const on = selectedMap.has(user.id);
              const subtitle = userSubtitle(user);
              return (
                <Label
                  key={user.id}
                  className="cursor-pointer gap-2.5 border-b border-slate-100 px-3 py-2 font-normal last:border-b-0 hover:bg-slate-50 data-[on=true]:bg-blue-50/60"
                  data-on={on}
                >
                  <Checkbox checked={on} onCheckedChange={() => toggle(user)} />
                  <Avatar user={user} size={30} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13.5px] font-semibold text-slate-900">{user.name}</span>
                    {subtitle ? <small className="truncate text-xs font-normal text-slate-500">{subtitle}</small> : null}
                  </span>
                </Label>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {selected.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {selected.map((user) => (
            <li
              key={user.id}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pr-1 pl-2.5 text-[13px]"
            >
              <span>{user.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-5 rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                aria-label={`Bỏ ${user.name}`}
                onClick={() => onChange(selected.filter((item) => item.id !== user.id))}
              >
                <X size={12} aria-hidden="true" />
              </Button>
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
            <div className="flex items-center gap-2.5">
              <Avatar user={user} size={26} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13.5px] font-semibold text-slate-900">{user.name}</span>
                {subtitle ? <span className="truncate text-xs text-slate-500">{subtitle}</span> : null}
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
    <span className="inline-flex items-center">
      {users.map((user) => (
        <span key={user.id} className="-ml-2 rounded-full ring-2 ring-white first:ml-0" title={user.name}>
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

// Giống PostMenu: nền trong suốt, chỉ xám nhẹ khi rê chuột.
const MENU_ITEM_CLASS =
  'h-[34px] w-full justify-start gap-2.5 rounded-md bg-transparent px-2.5 text-[13px] font-normal text-zinc-900 hover:bg-gray-100 hover:text-zinc-900 aria-expanded:bg-transparent aria-expanded:text-zinc-900';

function MenuRow({
  item,
  onSelect,
}: {
  readonly item: Omit<GroupMenuItem, 'children'>;
  readonly onSelect: (item: Omit<GroupMenuItem, 'children'>) => void;
}) {
  const Icon = item.icon;
  return (
    <Button
      type="button"
      variant="ghost"
      role="menuitem"
      className={`${MENU_ITEM_CLASS} ${item.danger ? 'text-red-600 hover:bg-red-50 hover:text-red-600 aria-expanded:text-red-600' : ''}`}
      onClick={() => onSelect(item)}
    >
      <Icon size={15} className={item.danger ? 'text-red-600' : 'text-gray-500'} aria-hidden="true" />
      <span>{item.label}</span>
    </Button>
  );
}

/**
 * Mục có mục con: rê chuột vào thì mở một popover riêng ngay bên dưới menu cha (không nằm trong menu cha, nên menu cha không đổi kích
 * thước). Popover con còn mở khi chuột đang ở mục cha hoặc ở chính nó; bấm vẫn bật/tắt cho bàn phím và cảm ứng.
 */
function SubMenuItem({
  item,
  menuRef,
  onSelect,
}: {
  readonly item: GroupMenuItem;
  /** Menu cha: popover con neo vào cả menu cha và mở ngay bên dưới nó. */
  readonly menuRef: RefObject<HTMLDivElement | null>;
  readonly onSelect: (item: Omit<GroupMenuItem, 'children'>) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const Icon = item.icon;

  const show = () => {
    window.clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 150);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        // Bấm vào chính mục cha do onClick xử lý; chỉ đóng khi bấm ra ngoài thật sự hoặc Esc.
        if (!next && details.reason === 'outside-press' && anchor.current?.contains(details.event.target as Node)) return;
        if (!next) setOpen(false);
      }}
    >
      <Button
        ref={anchor}
        type="button"
        variant="ghost"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${MENU_ITEM_CLASS} ${open ? 'bg-gray-100' : ''}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon size={15} className="text-gray-500" aria-hidden="true" />
        <span>{item.label}</span>
        <ChevronRight size={14} className="ml-auto text-gray-500" aria-hidden="true" />
      </Button>
      <PopoverContent
        anchor={menuRef}
        side="bottom"
        align="end"
        sideOffset={4}
        initialFocus={false}
        finalFocus={false}
        className="flex w-max min-w-52 flex-col rounded-lg border border-gray-200 bg-white p-1 text-zinc-900 shadow-lg"
        role="menu"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {item.children?.map((child) => <MenuRow key={child.key} item={child} onSelect={onSelect} />)}
      </PopoverContent>
    </Popover>
  );
}

/** Nút ⋮ mở menu thả (Popover); bấm ra ngoài hoặc Esc để đóng. */
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
  const menuRef = useRef<HTMLDivElement>(null);

  if (items.length === 0) return null;

  const select = (item: Omit<GroupMenuItem, 'children'>) => {
    setOpen(false);
    item.onSelect?.();
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full text-slate-600"
            aria-label={label}
            aria-haspopup="menu"
          />
        }
      >
        {trigger ?? <MoreVertical size={16} />}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={4}
        className="flex w-[220px] flex-col rounded-lg border border-gray-200 bg-white p-1 text-zinc-900 shadow-lg"
        role="menu"
        ref={menuRef}
      >
        {items.map((item) =>
          item.children ? (
            <SubMenuItem key={item.key} item={item} menuRef={menuRef} onSelect={select} />
          ) : (
            <MenuRow key={item.key} item={item} onSelect={select} />
          ),
        )}
      </PopoverContent>
    </Popover>
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
    <div className="flex flex-col gap-1.5">
      {sources.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {sources.map((source) => (
            <li
              key={`${source.type}:${source.id}`}
              className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 py-1 pr-1.5 pl-2.5 text-[13px]"
            >
              <span className="flex min-w-0 flex-1 flex-col font-semibold">
                <span className="truncate">{source.name}</span>
                <small className="text-[11.5px] font-normal text-slate-500">
                  {SOCIAL_ORG_NODE_KIND_LABELS[source.type]}
                </small>
              </span>
              <Label className="cursor-pointer gap-1.5 text-xs font-normal whitespace-nowrap text-slate-600">
                <Checkbox
                  checked={source.includeDescendants}
                  onCheckedChange={(checked) =>
                    onChange(sources.map((item) => (item === source ? { ...item, includeDescendants: checked } : item)))
                  }
                />
                Gồm cả đơn vị con
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                aria-label={`Bỏ ${source.name}`}
                onClick={() => onChange(sources.filter((item) => item !== source))}
              >
                <X size={13} aria-hidden="true" />
              </Button>
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
        <p role="alert" className="m-0 text-[12.5px] text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
