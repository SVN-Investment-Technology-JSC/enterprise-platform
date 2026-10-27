'use client';

import type { SocialGroupDetail } from '@enterprise-platform/contracts-social';
import { Check, Clock, Info, UserPlus } from 'lucide-react';
import { Button } from '../../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { CARD } from './group-ui';
import { GroupGlyph, GroupMenu, PrivacyBadge, type GroupMenuItem } from './group-visuals';
import { groupCover, memberCountLabel } from './groups.model';

/** Ảnh bìa, ảnh đại diện, tên nhóm và dòng nút (Đã tham gia, thông tin, menu ⋮) của trang nhóm. */
export function GroupHeader({
  group,
  busy,
  menu,
  onJoin,
  onRequest,
  onCancelRequest,
  onInfo,
}: {
  readonly group: SocialGroupDetail;
  readonly busy: boolean;
  readonly menu: readonly GroupMenuItem[];
  readonly onJoin: () => void;
  readonly onRequest: () => void;
  readonly onCancelRequest: () => void;
  readonly onInfo: () => void;
}) {
  const caps = group.capabilities;
  const preview = group.access === 'preview';
  const joinedTag =
    'inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-[11px] text-[12.5px] font-semibold whitespace-nowrap text-slate-600';
  return (
    <header className={`${CARD} overflow-visible`}>
      <div className="h-28 rounded-t-[var(--ep-radius-xl)]" style={{ background: groupCover(group) }} />
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1 px-3.5 pb-2.5">
        <span className="-mt-7 inline-flex rounded-full border-4 border-white bg-white">
          <GroupGlyph icon={group.icon} color={group.color} size={64} />
        </span>
        <div className="flex min-w-[180px] flex-1 flex-col gap-0.5 pt-2">
          <h2 className="m-0 text-lg leading-tight font-bold text-slate-900 [overflow-wrap:anywhere]">{group.name}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
            <PrivacyBadge privacy={group.privacy} />
            {preview ? null : <span>{memberCountLabel(group.memberCount)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {group.myMembership ? (
            <span className={joinedTag}>
              <Check size={13} aria-hidden="true" />
              Đã tham gia
            </span>
          ) : null}
          {caps.canJoin ? (
            <Button type="button" className="h-8 gap-1.5 px-3 text-[13px] font-semibold" disabled={busy} onClick={onJoin}>
              <UserPlus size={14} aria-hidden="true" />
              Tham gia
            </Button>
          ) : null}
          {caps.canRequestJoin ? (
            <Button type="button" className="h-8 gap-1.5 px-3 text-[13px] font-semibold" disabled={busy} onClick={onRequest}>
              <UserPlus size={14} aria-hidden="true" />
              Gửi yêu cầu tham gia
            </Button>
          ) : null}
          {group.myJoinRequestId ? (
            <>
              <span className={joinedTag}>
                <Clock size={13} aria-hidden="true" />
                Đang chờ duyệt
              </span>
              <Button type="button" variant="outline" className="h-8 px-3 text-[13px]" disabled={busy} onClick={onCancelRequest}>
                Huỷ yêu cầu
              </Button>
            </>
          ) : null}
          {preview ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-full text-slate-600"
                    aria-label="Thông tin nhóm"
                    onClick={onInfo}
                  />
                }
              >
                <Info size={16} aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent side="top">Thông tin nhóm</TooltipContent>
            </Tooltip>
          )}
          <GroupMenu items={menu} label="Tuỳ chọn nhóm" />
        </div>
      </div>
    </header>
  );
}
