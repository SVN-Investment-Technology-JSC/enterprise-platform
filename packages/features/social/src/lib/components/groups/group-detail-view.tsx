'use client';

import {
  SOCIAL_GROUP_JOIN_MESSAGE_MAX,
  type SocialGroupDetail,
  type SocialGroupTopic,
} from '@enterprise-platform/contracts-social';
import { ArrowLeft, Flag, Link2, ListChecks, LogOut, Pencil, Star, Tag, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@enterprise-platform/shared-ui';
import { errorMessage } from '../../social-api';
import { onGroupTopicsChanged } from '../../group-topic-events';
import { navigateSocial, SocialLink, useSocialRoute } from '../../social-navigation';
import { useSocialGroupRoom } from '../../social-realtime';
import { socialHref } from '../../social.model';
import { Button } from '../../ui/button';
import { Tabs, TabsList, TabsTrigger } from '../../ui/tabs';
import { Textarea } from '../../ui/textarea';
import { ConfirmDialog, Dialog, Field } from '../ui';
import { GroupFeedSection } from './group-feed-section';
import { GroupFormDialog } from './group-form-dialog';
import { GroupHeader } from './group-header';
import { GroupInfoDialog } from './group-info-dialog';
import { GroupJoinRequests } from './group-join-requests';
import { AddMembersDialog, GroupMembersPanel } from './group-members-panel';
import { GroupReportDialog, GroupReports } from './group-reports';
import { GroupSide, useGroupAdmins } from './group-side';
import { GroupTopicsDialog } from './group-topics-dialog';
import { ALERT, BADGE, CARD, CONFIRM_TEXT, SKELETON } from './group-ui';
import { GroupGlyph, type GroupMenuItem } from './group-visuals';
import { parseGroupSection, type GroupSection } from './groups.model';
import {
  cancelJoinRequest,
  deleteGroup,
  joinGroup,
  leaveGroup,
  listGroupTopics,
  loadGroup,
  setGroupPriority,
} from './social-groups-api';

const backToList = () => navigateSocial({ name: 'groups' });

export function GroupDetailView({ groupId }: { readonly groupId: string }) {
  const route = useSocialRoute();
  const requested = parseGroupSection(route.name === 'group' ? route.section : undefined);

  const [group, setGroup] = useState<SocialGroupDetail>();
  const [topics, setTopics] = useState<readonly SocialGroupTopic[]>([]);
  const [topicId, setTopicId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [info, setInfo] = useState(false);
  const [adding, setAdding] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [membersKey, setMembersKey] = useState(0);
  const generation = useRef(0);

  useSocialGroupRoom(groupId);

  const load = useCallback(
    async (quiet = false) => {
      const mine = ++generation.current;
      if (!quiet) setLoading(true);
      setError(undefined);
      try {
        const next = await loadGroup(groupId);
        if (mine !== generation.current) return;
        setGroup(next);
      } catch (cause) {
        if (mine === generation.current) {
          setError(errorMessage(cause, 'Không mở được nhóm này. Có thể nhóm đã bị xoá.'));
        }
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    },
    [groupId],
  );

  const loadTopicList = useCallback(async () => {
    try {
      setTopics((await listGroupTopics(groupId)).items);
    } catch {
      setTopics([]);
    }
  }, [groupId]);

  useEffect(() => {
    setGroup(undefined);
    setTopics([]);
    setTopicId(undefined);
    void load();
  }, [load]);

  const full = group?.access === 'full';
  useEffect(() => {
    if (full) void loadTopicList();
  }, [full, loadTopicList]);

  // Tạo nhanh chủ đề trong hộp soạn bài: nạp lại các chip lọc chủ đề.
  useEffect(
    () => onGroupTopicsChanged((changed) => {
      if (changed === groupId) void loadTopicList();
    }),
    [groupId, loadTopicList],
  );

  const admins = useGroupAdmins(groupId, Boolean(full), membersKey);

  // Nạp lại chi tiết sau thay đổi mà không nhấp nháy màn hình tải.
  const refresh = useCallback(() => {
    setMembersKey((key) => key + 1);
    void load(true);
  }, [load]);

  const apply = (next: SocialGroupDetail) => {
    setGroup(next);
    setMembersKey((key) => key + 1);
  };

  const join = async (message?: string) => {
    if (!group) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const response = await joinGroup(group.id, message ? { message } : {});
      apply(response.group);
      setRequesting(false);
      setRequestMessage('');
      toast.success(
        response.result === 'joined'
          ? 'Bạn đã tham gia nhóm.'
          : 'Đã gửi yêu cầu tham gia. Quản trị viên sẽ xem và duyệt.',
      );
    } catch (cause) {
      const text = errorMessage(cause, 'Không gửi được yêu cầu tham gia.');
      if (requesting) setDialogError(text);
      else toast.error(text);
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async () => {
    if (!group) return;
    setBusy(true);
    try {
      await cancelJoinRequest(group.id);
      toast.success('Đã huỷ yêu cầu tham gia.');
      await load(true);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không huỷ được yêu cầu.'));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!group) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await leaveGroup(group.id);
      setLeaving(false);
      toast.success('Bạn đã rời nhóm.');
      await load(true);
      setMembersKey((key) => key + 1);
    } catch (cause) {
      setDialogError(errorMessage(cause, 'Không rời được nhóm.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!group) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await deleteGroup(group.id);
      backToList();
    } catch (cause) {
      setDialogError(errorMessage(cause, 'Không xoá được nhóm.'));
      setBusy(false);
    }
  };

  const togglePriority = async () => {
    if (!group) return;
    try {
      const state = await setGroupPriority(group.id, !group.myPriorityAt);
      setGroup((current) => (current ? { ...current, myPriorityAt: state.pinned ? (state.pinnedAt ?? new Date().toISOString()) : undefined } : current));
      toast.success(state.pinned ? 'Đã đưa nhóm lên trên danh sách của bạn.' : 'Đã bỏ ưu tiên nhóm.');
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không đổi được ưu tiên của nhóm.'));
    }
  };

  const copyLink = async () => {
    if (!group) return;
    try {
      const url = `${window.location.origin}${socialHref({ name: 'group', groupId: group.id })}`;
      await navigator.clipboard.writeText(url);
      toast.success('Đã sao chép liên kết nhóm.');
    } catch {
      toast.error('Không sao chép được liên kết. Hãy sao chép từ thanh địa chỉ.');
    }
  };

  const buildMenu = (): readonly GroupMenuItem[] => {
    if (!group) return [];
    const caps = group.capabilities;
    const items: GroupMenuItem[] = [];
    if (group.access === 'full') {
      if (caps.canPrioritize) {
        items.push({
          key: 'priority',
          label: group.myPriorityAt ? 'Bỏ ưu tiên' : 'Ưu tiên lên trên',
          icon: Star,
          onSelect: () => void togglePriority(),
        });
      }
      items.push({ key: 'copy', label: 'Copy link nhóm', icon: Link2, onSelect: () => void copyLink() });
      if (caps.canManage) {
        items.push({
          key: 'topics',
          label: 'Quản lý chủ đề',
          icon: Tag,
          onSelect: () => navigateSocial({ name: 'group', groupId: group.id, section: 'topics' }),
        });
      }
    }
    if (caps.canLeave) {
      items.push({
        key: 'leave',
        label: 'Rời khỏi nhóm',
        icon: LogOut,
        onSelect: () => {
          setDialogError(undefined);
          setLeaving(true);
        },
      });
    }
    if (caps.canManage) {
      items.push({ key: 'edit', label: 'Sửa nhóm', icon: Pencil, onSelect: () => setEditing(true) });
    }
    if (caps.canDelete) {
      items.push({
        key: 'delete',
        label: 'Xóa nhóm',
        icon: Trash2,
        danger: true,
        onSelect: () => {
          setDialogError(undefined);
          setDeleting(true);
        },
      });
    }
    const reportItems: Array<Omit<GroupMenuItem, 'children'>> = [];
    if (caps.canReport) {
      reportItems.push({ key: 'report', label: 'Báo cáo vi phạm nhóm', icon: Flag, onSelect: () => setReporting(true) });
    }
    if (caps.canManage && group.access === 'full') {
      reportItems.push({
        key: 'report-queue',
        label: 'Báo cáo gửi tới nhóm',
        icon: ListChecks,
        onSelect: () => navigateSocial({ name: 'group', groupId: group.id, section: 'reports' }),
      });
    }
    if (reportItems.length > 0) items.push({ key: 'reports', label: 'Báo cáo', icon: Flag, children: reportItems });
    return items;
  };
  const menu = buildMenu();

  if (loading && !group) {
    return (
      <section className="flex min-w-0 flex-col gap-2.5" aria-busy="true" aria-label="Đang tải nhóm">
        <div className={`${SKELETON} h-[150px]`} />
        <div className={`${SKELETON} h-[90px]`} />
      </section>
    );
  }

  if (!group) {
    return (
      <section className="flex min-w-0 flex-col gap-2.5">
        <SocialLink to={{ name: 'groups' }} className="inline-flex items-center gap-1 self-start text-[12.5px] font-semibold text-slate-500 no-underline hover:text-slate-900">
          <ArrowLeft size={14} aria-hidden="true" />
          Tất cả nhóm
        </SocialLink>
        <div className={`${CARD} flex flex-col items-center gap-1.5 px-4 py-7 text-center text-[13px] text-slate-500`}>
          <strong className="text-sm text-slate-900">{error ?? 'Không tìm thấy nhóm.'}</strong>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" onClick={() => void load()}>
              Thử lại
            </Button>
            <Button type="button" onClick={backToList}>
              Về danh sách nhóm
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const caps = group.capabilities;
  const preview = group.access === 'preview';
  const pendingCount = group.pendingJoinRequestCount ?? 0;
  const canManage = caps.canManage;

  // Mục không có quyền hoặc "topics" (hộp thoại phủ lên bảng tin) quay về bảng tin.
  const section: GroupSection =
    (requested === 'requests' || requested === 'reports') && !canManage
      ? 'feed'
      : requested === 'topics'
        ? 'feed'
        : requested;
  const topicsOpen = requested === 'topics' && canManage && !preview;

  const tabs: ReadonlyArray<{ readonly key: GroupSection; readonly label: string; readonly badge?: number }> = [
    { key: 'feed', label: 'Bảng tin' },
    { key: 'members', label: 'Thành viên' },
    ...(canManage
      ? [
          { key: 'requests' as const, label: 'Yêu cầu tham gia', badge: pendingCount },
          { key: 'reports' as const, label: 'Báo cáo' },
        ]
      : []),
  ];
  const activeTab: GroupSection = section === 'announcements' ? 'feed' : section;

  return (
    <section className="flex min-w-0 flex-col gap-2.5" aria-label={group.name}>
      <SocialLink to={{ name: 'groups' }} className="inline-flex items-center gap-1 self-start text-[12.5px] font-semibold text-slate-500 no-underline hover:text-slate-900">
        <ArrowLeft size={14} aria-hidden="true" />
        Tất cả nhóm
      </SocialLink>

      <GroupHeader
        group={group}
        busy={busy}
        menu={menu}
        onJoin={() => void join()}
        onRequest={() => {
          setDialogError(undefined);
          setRequesting(true);
        }}
        onCancelRequest={() => void cancelRequest()}
        onInfo={() => setInfo(true)}
      />

      {error ? (
        <p role="alert" className={ALERT}>
          <span>{error}</span>
        </p>
      ) : null}

      {preview ? (
        <div className={`${CARD} flex flex-col items-center gap-1.5 px-4 py-[22px] text-center text-[13px] text-slate-500`}>
          <GroupGlyph icon={group.icon} color={group.color} size={36} />
          <strong className="text-sm text-slate-900">Đây là nhóm riêng tư.</strong>
          <span>
            {group.myJoinRequestId
              ? 'Yêu cầu của bạn đang chờ quản trị viên duyệt. Sau khi được duyệt, bạn sẽ xem được bài viết và thành viên.'
              : 'Chỉ thành viên mới xem được bài viết và danh sách thành viên. Hãy gửi yêu cầu để quản trị viên xét duyệt.'}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_280px] items-start gap-2.5 max-[980px]:grid-cols-[minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-2">
            <Tabs
              value={activeTab}
              onValueChange={(value) =>
                navigateSocial({
                  name: 'group',
                  groupId: group.id,
                  section: value === 'feed' ? undefined : (value as GroupSection),
                })
              }
            >
              <TabsList aria-label="Nội dung nhóm" className="max-w-full overflow-x-auto">
                {tabs.map((item) => (
                  <TabsTrigger key={item.key} value={item.key}>
                    {item.label}
                    {item.badge ? <span className={BADGE}>{item.badge}</span> : null}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {activeTab === 'feed' ? (
              <GroupFeedSection
                group={group}
                announcementsOnly={section === 'announcements'}
                topics={topics}
                topicId={topicId}
                onTopicChange={setTopicId}
              />
            ) : null}
            {activeTab === 'members' ? (
              <GroupMembersPanel group={group} refreshKey={membersKey} onChanged={refresh} />
            ) : null}
            {activeTab === 'requests' && canManage ? <GroupJoinRequests groupId={group.id} onDecided={refresh} /> : null}
            {activeTab === 'reports' && canManage ? <GroupReports groupId={group.id} onChanged={refresh} /> : null}
          </div>

          <GroupSide group={group} admins={admins} onAddMembers={() => setAdding(true)} />
        </div>
      )}

      <GroupFormDialog
        open={editing}
        group={group}
        onClose={() => setEditing(false)}
        onSaved={(next) => {
          setEditing(false);
          apply(next);
          toast.success('Đã cập nhật nhóm.');
        }}
      />

      <GroupInfoDialog open={info} group={group} admins={admins.map((member) => member.user)} onClose={() => setInfo(false)} />

      <AddMembersDialog
        open={adding}
        groupId={group.id}
        groupName={group.name}
        onClose={() => setAdding(false)}
        onAdded={(count) => {
          setAdding(false);
          toast.success(count > 0 ? `Đã thêm ${count} thành viên.` : 'Những người này đã ở trong nhóm.');
          refresh();
        }}
      />

      <GroupTopicsDialog
        open={topicsOpen}
        groupId={group.id}
        onClose={() => navigateSocial({ name: 'group', groupId: group.id }, { replace: true })}
        onChanged={() => {
          setTopicId(undefined);
          void loadTopicList();
        }}
      />

      <GroupReportDialog
        open={reporting}
        groupId={group.id}
        groupName={group.name}
        onClose={() => setReporting(false)}
        onDone={() => {
          setReporting(false);
          toast.success('Đã gửi báo cáo tới quản trị nhóm.');
        }}
      />

      <Dialog
        open={requesting}
        title="Gửi yêu cầu tham gia"
        submitLabel="Gửi yêu cầu"
        submittingLabel="Đang gửi…"
        submitting={busy}
        error={dialogError}
        onSubmit={() => void join(requestMessage.trim() || undefined)}
        onClose={() => setRequesting(false)}
      >
        <p className={CONFIRM_TEXT}>
          Quản trị viên của "{group.name}" sẽ nhận được yêu cầu của bạn. Bạn có thể kèm lời nhắn.
        </p>
        <Field label="Lời nhắn" hint={`${requestMessage.length}/${SOCIAL_GROUP_JOIN_MESSAGE_MAX}`}>
          <Textarea
            rows={3}
            value={requestMessage}
            maxLength={SOCIAL_GROUP_JOIN_MESSAGE_MAX}
            placeholder="Vì sao bạn muốn tham gia nhóm này?"
            onChange={(event) => setRequestMessage(event.target.value)}
          />
        </Field>
      </Dialog>

      <Dialog
        open={leaving}
        title="Rời nhóm"
        danger
        submitLabel="Rời nhóm"
        submittingLabel="Đang xử lý…"
        submitting={busy}
        error={dialogError}
        onSubmit={() => void leave()}
        onClose={() => setLeaving(false)}
      >
        <p className={CONFIRM_TEXT}>
          {group.privacy === 'private'
            ? `Rời nhóm "${group.name}"? Nhóm riêng tư nên bạn sẽ phải gửi yêu cầu và chờ duyệt để quay lại.`
            : `Rời nhóm "${group.name}"? Bạn có thể tham gia lại bất cứ lúc nào.`}
        </p>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        title="Xoá nhóm"
        message={`Xoá nhóm "${group.name}"? Mọi bài viết trong nhóm sẽ không còn hiển thị. Thao tác này không thể hoàn tác.`}
        confirmLabel="Xoá nhóm"
        busy={busy}
        error={dialogError}
        onConfirm={() => void remove()}
        onClose={() => setDeleting(false)}
      />
    </section>
  );
}
