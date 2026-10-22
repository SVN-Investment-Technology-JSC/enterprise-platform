'use client';

import type { SocialGroupDetail } from '@enterprise-platform/contracts-social';
import { Check, Clock, Info, UserPlus } from 'lucide-react';
import base from '../../social.module.scss';
import { GroupGlyph, GroupMenu, PrivacyBadge, type GroupMenuItem } from './group-visuals';
import { groupCover, memberCountLabel } from './groups.model';
import s from './groups.module.scss';

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
  return (
    <header className={s.hero}>
      <div className={s.heroCover} style={{ background: groupCover(group) }} />
      <div className={s.heroBar}>
        <span className={s.heroGlyph}>
          <GroupGlyph icon={group.icon} color={group.color} size={64} />
        </span>
        <div className={s.heroInfo}>
          <h2 className={s.heroName}>{group.name}</h2>
          <div className={s.heroMeta}>
            <PrivacyBadge privacy={group.privacy} />
            {preview ? null : <span>{memberCountLabel(group.memberCount)}</span>}
          </div>
        </div>
        <div className={s.heroActions}>
          {group.myMembership ? (
            <span className={s.joinedTag}>
              <Check size={13} aria-hidden="true" />
              Đã tham gia
            </span>
          ) : null}
          {caps.canJoin ? (
            <button type="button" className={base.buttonPrimary + ' ' + s.compactBtn} disabled={busy} onClick={onJoin}>
              <UserPlus size={14} />
              Tham gia
            </button>
          ) : null}
          {caps.canRequestJoin ? (
            <button
              type="button"
              className={base.buttonPrimary + ' ' + s.compactBtn}
              disabled={busy}
              onClick={onRequest}
            >
              <UserPlus size={14} />
              Gửi yêu cầu tham gia
            </button>
          ) : null}
          {group.myJoinRequestId ? (
            <>
              <span className={s.joinedTag}>
                <Clock size={13} aria-hidden="true" />
                Đang chờ duyệt
              </span>
              <button
                type="button"
                className={base.buttonGhost + ' ' + s.compactBtn}
                disabled={busy}
                onClick={onCancelRequest}
              >
                Huỷ yêu cầu
              </button>
            </>
          ) : null}
          {preview ? null : (
            <button type="button" className={s.iconBtn} aria-label="Thông tin nhóm" title="Thông tin nhóm" onClick={onInfo}>
              <Info size={16} />
            </button>
          )}
          <GroupMenu items={menu} label="Tuỳ chọn nhóm" />
        </div>
      </div>
    </header>
  );
}
