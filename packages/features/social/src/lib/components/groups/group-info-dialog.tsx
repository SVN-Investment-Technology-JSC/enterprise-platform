'use client';

import {
  SOCIAL_GROUP_POST_PERMISSION_LABELS,
  SOCIAL_ORG_NODE_KIND_LABELS,
  type SocialGroupDetail,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import { formatFullTime } from '../../social.model';
import { Dialog } from '../ui';
import { PrivacyBadge } from './group-visuals';
import { EMPTY_LINE } from './group-ui';

/** Hộp "Thông tin nhóm" (biểu tượng i): người quản trị, ngày tạo, quyền đăng bài, nguồn thành viên, mô tả. */
export function GroupInfoDialog({
  open,
  group,
  admins,
  onClose,
}: {
  readonly open: boolean;
  readonly group: SocialGroupDetail;
  readonly admins: readonly SocialUserRef[];
  readonly onClose: () => void;
}) {
  const sources = group.memberSources ?? [];
  const permitted = group.postPermittedUsers ?? [];
  return (
    <Dialog open={open} title="Thông tin nhóm" onClose={onClose}>
      <dl className="m-0 flex flex-col gap-1.5 text-[13px] [&>div]:grid [&>div]:grid-cols-[150px_minmax(0,1fr)] [&>div]:gap-2.5 [&_dd]:m-0 [&_dd]:[overflow-wrap:anywhere] [&_dt]:text-slate-500">
        <div>
          <dt>Quyền riêng tư</dt>
          <dd>
            <PrivacyBadge privacy={group.privacy} />
          </dd>
        </div>
        <div>
          <dt>Quản trị bởi</dt>
          <dd>{admins.length > 0 ? admins.map((user) => user.name).join(', ') : `${group.adminCount} quản trị viên`}</dd>
        </div>
        {group.createdBy ? (
          <div>
            <dt>Người tạo</dt>
            <dd>{group.createdBy.name}</dd>
          </div>
        ) : null}
        <div>
          <dt>Khởi tạo nhóm</dt>
          <dd>{formatFullTime(group.createdAt)}</dd>
        </div>
        <div>
          <dt>Thành viên</dt>
          <dd>{group.memberCount}</dd>
        </div>
        <div>
          <dt>Được phép đăng bài</dt>
          <dd>
            {SOCIAL_GROUP_POST_PERMISSION_LABELS[group.postPermission ?? 'all']}
            {permitted.length > 0 ? `: ${permitted.map((user) => user.name).join(', ')}` : ''}
          </dd>
        </div>
        {sources.length > 0 ? (
          <div>
            <dt>Thành viên theo</dt>
            <dd>
              {sources
                .map((source) => `${source.name} (${SOCIAL_ORG_NODE_KIND_LABELS[source.type]})`)
                .join(', ')}
            </dd>
          </div>
        ) : null}
        {group.lastSyncedAt ? (
          <div>
            <dt>Đồng bộ gần nhất</dt>
            <dd>{formatFullTime(group.lastSyncedAt)}</dd>
          </div>
        ) : null}
      </dl>
      <h4 className="m-0 mt-1 text-[13px] font-bold text-slate-900">Mô tả</h4>
      {group.descriptionHtml ? (
        // HTML đã được server làm sạch.
        <div className="text-[13px] leading-[1.55] [overflow-wrap:anywhere] [&_a]:text-blue-700 [&_ol]:m-0 [&_ol]:mb-1.5 [&_ol]:pl-5 [&_p]:m-0 [&_p]:mb-1.5 [&_ul]:m-0 [&_ul]:mb-1.5 [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: group.descriptionHtml }} />
      ) : (
        <p className={EMPTY_LINE}>{group.description || 'Nhóm chưa có mô tả.'}</p>
      )}
    </Dialog>
  );
}
