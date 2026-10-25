'use client';

import {
  SOCIAL_AUDIENCE_MAX_UNITS,
  SOCIAL_AUDIENCE_MAX_USERS,
  type SocialOrgNode,
  type SocialOrgNodeKind,
  type SocialPostVisibility,
  type SocialUnitRef,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import { Search, X } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';
import extras from '../../post-extras.module.scss';
import {
  VISIBILITY_OPTIONS,
  toggleById,
  validateVisibility,
} from '../../post-visibility.model';
import { loadOrgNodes } from '../../social-posts-api';
import styles from '../../social.module.scss';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group';
import { Tabs, TabsList, TabsTrigger } from '../../ui/tabs';
import { usePeopleSearch } from '../people-picker';
import { Avatar, Dialog, userSubtitle } from '../ui';

type PickerTab = 'people' | SocialOrgNodeKind;

const TABS: readonly { readonly id: PickerTab; readonly label: string }[] = [
  { id: 'people', label: 'Người' },
  { id: 'unit', label: 'Phòng ban' },
  { id: 'position', label: 'Vị trí' },
];

const SEARCH_PLACEHOLDER: Readonly<Record<PickerTab, string>> = {
  people: 'Tìm người…',
  unit: 'Tìm phòng ban…',
  position: 'Tìm vị trí…',
};

export interface AudienceValue {
  readonly visibility: SocialPostVisibility;
  readonly users: readonly SocialUserRef[];
  readonly units: readonly SocialUnitRef[];
}

export interface AudienceDialogProps {
  readonly value: AudienceValue;
  /** Có lý do thì chỉ cho chọn Công khai (bài đang là thông báo, ghim, xác nhận đã đọc...). */
  readonly lockedReason?: string;
  readonly onApply: (value: AudienceValue) => void;
  readonly onClose: () => void;
}

/** Hộp "Tùy chỉnh quyền xem": 4 lựa chọn; "Tùy chỉnh" mở bộ chọn người, phòng ban, vị trí. */
export function AudienceDialog({
  value,
  lockedReason,
  onApply,
  onClose,
}: AudienceDialogProps) {
  const [visibility, setVisibility] = useState(value.visibility);
  const [users, setUsers] = useState(value.users);
  const [units, setUnits] = useState(value.units);
  const [tab, setTab] = useState<PickerTab>('people');
  const [query, setQuery] = useState('');
  const [nodes, setNodes] = useState<readonly SocialOrgNode[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [error, setError] = useState<string>();

  const custom = visibility === 'custom';
  const { people, loading: peopleLoading } = usePeopleSearch(
    query,
    custom && tab === 'people',
  );

  useEffect(() => {
    if (!custom || tab === 'people') return;
    let cancelled = false;
    setNodesLoading(true);
    const timer = window.setTimeout(() => {
      loadOrgNodes({ kind: tab, query, limit: 50 })
        .then((page) => {
          if (!cancelled) setNodes(page.items);
        })
        .catch(() => {
          if (!cancelled) setNodes([]);
        })
        .finally(() => {
          if (!cancelled) setNodesLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [custom, tab, query]);

  const selectedCount = users.length + units.length;
  const userIds = new Set(users.map((user) => user.id));
  const unitIds = new Set(units.map((unit) => unit.id));

  const apply = () => {
    const problem = validateVisibility(visibility, users, units);
    if (problem) {
      setError(problem);
      return;
    }
    onApply({
      visibility,
      users: custom ? users : [],
      units: custom ? units : [],
    });
  };

  // Enter trong ô tìm kiếm không được gửi biểu mẫu (đóng hộp).
  const noEnter = (event: KeyboardEvent) => {
    if (event.key === 'Enter') event.preventDefault();
  };

  const listEmpty = tab === 'people' ? people.length === 0 : nodes.length === 0;
  const listLoading = tab === 'people' ? peopleLoading : nodesLoading;

  return (
    <Dialog
      open
      title="Tùy chỉnh quyền xem"
      submitLabel="Xong"
      error={error}
      onSubmit={apply}
      onClose={onClose}
    >
      <RadioGroup
        aria-label="Quyền xem bài viết"
        value={visibility}
        onValueChange={(next) => {
          setVisibility(next as SocialPostVisibility);
          setError(undefined);
        }}
      >
        {VISIBILITY_OPTIONS.map((option) => {
          const disabled = Boolean(lockedReason) && option.value !== 'company';
          return (
            <Label
              key={option.value}
              className="cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 has-data-checked:border-amber-400 has-data-checked:bg-amber-50 has-disabled:opacity-50"
            >
              <RadioGroupItem value={option.value} disabled={disabled} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="text-[13.5px] font-semibold text-slate-900">{option.label}</span>
                <span className="text-xs font-normal text-slate-500">{option.hint}</span>
              </span>
            </Label>
          );
        })}
      </RadioGroup>
      {lockedReason ? (
        <p className={extras.notice} role="note">
          {lockedReason}
        </p>
      ) : null}

      {custom ? (
        <div className={extras.audiencePicker}>
          {selectedCount > 0 ? (
            <ul className={styles.chips} aria-label="Đã chọn">
              {users.map((user) => (
                <li key={`u-${user.id}`} className={styles.chip}>
                  <span>{user.name}</span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`Bỏ ${user.name}`}
                    onClick={() =>
                      setUsers((list) =>
                        list.filter((item) => item.id !== user.id),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
              {units.map((unit) => (
                <li key={`n-${unit.id}`} className={styles.chip}>
                  <span>{unit.name}</span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`Bỏ ${unit.name}`}
                    onClick={() =>
                      setUnits((list) =>
                        list.filter((item) => item.id !== unit.id),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <Tabs
            value={tab}
            onValueChange={(next) => {
              setTab(next as PickerTab);
              setQuery('');
              setNodes([]);
            }}
          >
            <TabsList aria-label="Loại đối tượng">
              {TABS.map((item) => (
                <TabsTrigger key={item.id} value={item.id}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              className="h-[38px] rounded-md pl-9 text-[13.5px]!"
              value={query}
              placeholder={SEARCH_PLACEHOLDER[tab]}
              aria-label="Tìm đối tượng được xem bài"
              onKeyDown={noEnter}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <ul className={extras.pickList}>
            {tab === 'people'
              ? people.map((user) => (
                  <li key={user.id}>
                    <Label className={extras.pickRow}>
                      <Checkbox
                        checked={userIds.has(user.id)}
                        disabled={
                          !userIds.has(user.id) &&
                          users.length >= SOCIAL_AUDIENCE_MAX_USERS
                        }
                        onCheckedChange={() => setUsers((list) => toggleById(list, user))}
                      />
                      <Avatar user={user} size={24} />
                      <span className={extras.pickText}>
                        <span className={extras.pickName}>{user.name}</span>
                        {userSubtitle(user) ? (
                          <span className={extras.pickMeta}>
                            {userSubtitle(user)}
                          </span>
                        ) : null}
                      </span>
                    </Label>
                  </li>
                ))
              : nodes.map((node) => (
                  <li key={node.id}>
                    <Label className={extras.pickRow}>
                      <Checkbox
                        checked={unitIds.has(node.id)}
                        disabled={
                          !unitIds.has(node.id) &&
                          units.length >= SOCIAL_AUDIENCE_MAX_UNITS
                        }
                        onCheckedChange={() =>
                          setUnits((list) =>
                            toggleById(list, {
                              id: node.id,
                              name: node.name,
                              kind: node.kind,
                              parentName: node.parentName,
                            }),
                          )
                        }
                      />
                      <span className={extras.pickText}>
                        <span className={extras.pickName}>{node.name}</span>
                        <span className={extras.pickMeta}>
                          {[
                            node.parentName,
                            `${node.memberCount.toLocaleString('vi-VN')} người`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </Label>
                  </li>
                ))}
            {listEmpty ? (
              <li className={extras.pickEmpty}>
                {listLoading ? 'Đang tìm…' : 'Không có kết quả phù hợp.'}
              </li>
            ) : null}
          </ul>
          <span className={styles.fieldHint}>
            Phòng ban gồm cả các phòng ban con. Đã chọn {users.length}/
            {SOCIAL_AUDIENCE_MAX_USERS} người, {units.length}/
            {SOCIAL_AUDIENCE_MAX_UNITS} phòng ban hoặc vị trí.
          </span>
        </div>
      ) : null}
    </Dialog>
  );
}
