'use client';

import {
  SOCIAL_GROUP_ROLES,
  SOCIAL_GROUP_ROLE_LABELS,
  type SocialGroupDetail,
  type SocialGroupMember,
  type SocialGroupRole,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { RefreshCw, Search, UserMinus, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../social-api';
import base from '../../social.module.scss';
import { Button } from '../../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { ConfirmDialog, Dialog, Field, SelectField, userSubtitle } from '../ui';
import { UserAvatar } from '../user-avatar';
import { MemberPicker } from './group-visuals';
import { appendUnique } from './groups.model';
import s from './groups.module.scss';
import {
  addGroupMembers,
  listGroupMembers,
  removeGroupMember,
  setGroupMemberRole,
  syncGroupMembers,
} from './social-groups-api';

const ROLE_OPTIONS = SOCIAL_GROUP_ROLES.map((value) => ({ value, label: SOCIAL_GROUP_ROLE_LABELS[value] }));
const ROLE_FILTER_OPTIONS = [{ value: '', label: 'Mọi vai trò' }, ...ROLE_OPTIONS];

const memberKey = (member: SocialGroupMember) => ({ ...member, id: member.user.id });

/** Hộp "Thêm thành viên": tên nhóm (chỉ đọc) và danh sách người cần thêm. */
export function AddMembersDialog({
  open,
  groupId,
  groupName,
  onClose,
  onAdded,
}: {
  readonly open: boolean;
  readonly groupId: string;
  readonly groupName: string;
  readonly onClose: () => void;
  readonly onAdded: (count: number) => void;
}) {
  const [picked, setPicked] = useState<readonly SocialUserRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setPicked([]);
      setError(undefined);
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await addGroupMembers(groupId, { userIds: picked.map((user) => user.id) });
      onAdded(result.added.length);
    } catch (cause) {
      setError(errorMessage(cause, 'Không thêm được thành viên.'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Thêm thành viên"
      submitLabel={picked.length > 1 ? `Thêm ${picked.length} người` : 'Cập nhật'}
      submittingLabel="Đang thêm…"
      submitting={busy}
      submitDisabled={picked.length === 0}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field label="Tên nhóm">
        <input className={base.input} value={groupName} readOnly disabled />
      </Field>
      <SelectField label="Thành viên">
        <MemberPicker variant="list" selected={picked} onChange={setPicked} />
      </SelectField>
    </Dialog>
  );
}

function SyncDialog({
  open,
  groupId,
  onClose,
  onDone,
}: {
  readonly open: boolean;
  readonly groupId: string;
  readonly onClose: () => void;
  readonly onDone: (message: string) => void;
}) {
  const [prune, setPrune] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setPrune(false);
      setError(undefined);
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await syncGroupMembers(groupId, { prune });
      onDone(`Đã đồng bộ: thêm ${result.added.length} người, gỡ ${result.removedCount} người. Nhóm có ${result.memberCount} thành viên.`);
    } catch (cause) {
      setError(errorMessage(cause, 'Không đồng bộ được thành viên.'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Đồng bộ thành viên"
      submitLabel="Đồng bộ"
      submittingLabel="Đang đồng bộ…"
      submitting={busy}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <p className={base.confirmText}>Thêm những người mới thuộc phòng ban, vị trí của nhóm vào danh sách thành viên.</p>
      <label className={s.publicCheck}>
        <input type="checkbox" checked={prune} onChange={(event) => setPrune(event.target.checked)} />
        <span className={s.publicText}>Gỡ người không còn thuộc nguồn nào</span>
        <small>Chỉ gỡ người do đồng bộ thêm vào; không gỡ quản trị viên hay người được thêm tay.</small>
      </label>
    </Dialog>
  );
}

/**
 * Mục "Thành viên": tìm kiếm, lọc vai trò, đổi vai trò, gỡ người, thêm người và đồng bộ lại theo phòng ban.
 * Thêm, đổi vai trò, gỡ chỉ hiện khi `group.capabilities.canManage`.
 */
export function GroupMembersPanel({
  group,
  refreshKey,
  onChanged,
}: {
  readonly group: SocialGroupDetail;
  /** Đổi giá trị này để nạp lại danh sách (ví dụ sau khi duyệt yêu cầu). */
  readonly refreshKey?: number;
  /** Sau thay đổi làm đổi số thành viên: cha nạp lại chi tiết nhóm. */
  readonly onChanged: () => void;
}) {
  const canManage = group.capabilities.canManage;
  const canSync = Boolean(group.capabilities.canSyncMembers);
  const [members, setMembers] = useState<readonly (SocialGroupMember & { readonly id: string })[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [removing, setRemoving] = useState<SocialGroupMember>();
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string>();
  const [changingId, setChangingId] = useState<string>();
  const generation = useRef(0);
  const limit = 30;

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [text]);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    setError(undefined);
    try {
      const page = await listGroupMembers(group.id, {
        query: query || undefined,
        role: role ? (role as SocialGroupRole) : undefined,
        limit,
      });
      if (mine !== generation.current) return;
      setMembers(page.items.map(memberKey));
      setCursor(page.nextCursor);
    } catch (cause) {
      if (mine === generation.current) setError(errorMessage(cause, 'Không tải được danh sách thành viên.'));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [group.id, query, role]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const page = await listGroupMembers(group.id, {
        query: query || undefined,
        role: role ? (role as SocialGroupRole) : undefined,
        cursor,
        limit,
      });
      if (mine !== generation.current) return;
      setMembers((current) => appendUnique(current, page.items.map(memberKey)));
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(errorMessage(cause, 'Không tải thêm được thành viên.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const changeRole = async (member: SocialGroupMember, next: SocialGroupRole) => {
    if (next === member.role) return;
    setChangingId(member.user.id);
    setError(undefined);
    try {
      await setGroupMemberRole(group.id, member.user.id, next);
      setMembers((current) =>
        current.map((item) => (item.user.id === member.user.id ? { ...item, role: next } : item)),
      );
      onChanged();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không đổi được vai trò.'));
    } finally {
      setChangingId(undefined);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError(undefined);
    try {
      await removeGroupMember(group.id, removing.user.id);
      setMembers((current) => current.filter((item) => item.user.id !== removing.user.id));
      setRemoving(undefined);
      onChanged();
    } catch (cause) {
      setRemoveError(errorMessage(cause, 'Không xoá được thành viên.'));
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <section className={s.panel} aria-label="Thành viên">
      <header className={s.panelHead}>
        <h3>
          Thành viên <span className={s.count}>{group.memberCount}</span>
        </h3>
        <div className={s.panelTools}>
          <label className={s.filter}>
            <Search size={14} />
            <input
              value={text}
              placeholder="Tìm thành viên…"
              aria-label="Tìm thành viên"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className={s.roleFilter}>
            <SearchableSelect options={ROLE_FILTER_OPTIONS} value={role} height={32} onChange={setRole} />
          </div>
          {canSync ? (
            <button type="button" className={base.buttonSmall} onClick={() => setSyncing(true)}>
              <RefreshCw size={13} />
              Đồng bộ lại
            </button>
          ) : null}
          {canManage ? (
            <button type="button" className={base.buttonSmall} onClick={() => setAdding(true)}>
              <UserPlus size={13} />
              Thêm thành viên
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p role="alert" className={base.alert}>
          <span>{error}</span>
          <button type="button" className={base.buttonSmall} onClick={() => void load()}>
            Thử lại
          </button>
        </p>
      ) : null}

      {loading ? (
        <ul className={s.rowList} aria-busy="true">
          {[0, 1, 2, 3].map((key) => (
            <li key={key} className={s.rowSkeleton} />
          ))}
        </ul>
      ) : members.length === 0 && !error ? (
        <p className={s.emptyLine}>{query || role ? 'Không có thành viên phù hợp.' : 'Nhóm chưa có thành viên.'}</p>
      ) : (
        <ul className={s.rowList}>
          {members.map((member) => {
            // Quản trị viên duy nhất không gỡ được (server cũng chặn): nút vẫn hiện nhưng khoá, rê vào có giải thích.
            const lastAdmin = member.role === 'admin' && group.adminCount <= 1;
            return (
            <li key={member.user.id} className={s.memberRow}>
              <UserAvatar user={member.user} size={32} />
              <span className={s.rowText}>
                <span className={s.rowTitle}>{member.user.name}</span>
                {userSubtitle(member.user) ? <span className={s.rowMeta}>{userSubtitle(member.user)}</span> : null}
              </span>
              {canManage ? (
                <span className={s.rowActions}>
                  <span className={s.rolePick}>
                    <SearchableSelect
                      options={ROLE_OPTIONS}
                      value={member.role}
                      height={32}
                      disabled={changingId === member.user.id}
                      onChange={(value) => void changeRole(member, value as SocialGroupRole)}
                    />
                  </span>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className={`text-slate-500 ${lastAdmin ? 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-slate-500' : 'hover:text-red-600'}`}
                          aria-label={`Xoá ${member.user.name} khỏi nhóm`}
                          aria-disabled={lastAdmin || undefined}
                          onClick={() => {
                            if (lastAdmin) return;
                            setRemoveError(undefined);
                            setRemoving(member);
                          }}
                        />
                      }
                    >
                      <UserMinus size={14} aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64 text-center">
                      {lastAdmin
                        ? 'Đây là quản trị viên duy nhất. Hãy chỉ định quản trị viên khác trước khi gỡ.'
                        : 'Xoá khỏi nhóm'}
                    </TooltipContent>
                  </Tooltip>
                </span>
              ) : (
                <span className={member.role === 'admin' ? s.roleAdmin : s.roleMember}>
                  {member.role === 'admin' ? 'Admin' : SOCIAL_GROUP_ROLE_LABELS[member.role]}
                </span>
              )}
            </li>
            );
          })}
        </ul>
      )}

      {cursor ? (
        <div className={s.more}>
          <button type="button" className={base.buttonGhost} disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Đang tải…' : 'Xem thêm'}
          </button>
        </div>
      ) : null}

      <AddMembersDialog
        open={adding}
        groupId={group.id}
        groupName={group.name}
        onClose={() => setAdding(false)}
        onAdded={(count) => {
          setAdding(false);
          toast.success(count > 0 ? `Đã thêm ${count} thành viên.` : 'Những người này đã ở trong nhóm.');
          void load();
          onChanged();
        }}
      />
      <SyncDialog
        open={syncing}
        groupId={group.id}
        onClose={() => setSyncing(false)}
        onDone={(message) => {
          setSyncing(false);
          toast.success(message);
          void load();
          onChanged();
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Xoá thành viên"
        message={`Xoá ${removing?.user.name ?? ''} khỏi nhóm? Người này sẽ không còn xem được nội dung nếu nhóm riêng tư.`}
        confirmLabel="Xoá khỏi nhóm"
        busy={removeBusy}
        error={removeError}
        onConfirm={() => void remove()}
        onClose={() => setRemoving(undefined)}
      />
    </section>
  );
}
