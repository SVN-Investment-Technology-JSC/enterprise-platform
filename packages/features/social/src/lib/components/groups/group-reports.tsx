'use client';

import {
  SOCIAL_REPORT_NOTE_MAX,
  SOCIAL_REPORT_REASON_MAX,
  SOCIAL_REPORT_STATUSES,
  SOCIAL_REPORT_STATUS_LABELS,
  SOCIAL_REPORT_SUGGESTED_REASONS,
  SOCIAL_REPORT_TARGET_LABELS,
  type ResolveSocialReportRequest,
  type SocialReport,
  type SocialReportStatus,
} from '@enterprise-platform/contracts-social';
import { Check, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../social-api';
import { formatRelativeTime } from '../../social.model';
import { SocialLink } from '../../social-navigation';
import base from '../../social.module.scss';
import { Avatar, Dialog, Field, userSubtitle } from '../ui';
import { appendUnique, reportReasonError } from './groups.model';
import s from './groups.module.scss';
import { createReport, listGroupReports, resolveGroupReport } from './social-groups-api';

/** Hộp báo cáo vi phạm một nhóm: chọn lý do gợi ý hoặc tự viết. */
export function GroupReportDialog({
  open,
  groupId,
  groupName,
  onClose,
  onDone,
}: {
  readonly open: boolean;
  readonly groupId: string;
  readonly groupName: string;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setReason('');
      setError(undefined);
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    const problem = reportReasonError(reason);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await createReport({ targetType: 'group', targetId: groupId, reason: reason.trim() });
      onDone();
    } catch (cause) {
      setError(errorMessage(cause, 'Không gửi được báo cáo.'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Báo cáo nhóm"
      submitLabel="Gửi báo cáo"
      submittingLabel="Đang gửi…"
      submitting={busy}
      submitDisabled={reason.trim().length === 0}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <p className={base.confirmText}>Gửi báo cáo về nhóm "{groupName}" tới người quản trị xem xét.</p>
      <div className={s.reasonChips} role="group" aria-label="Lý do gợi ý">
        {SOCIAL_REPORT_SUGGESTED_REASONS.map((item) => (
          <button
            key={item}
            type="button"
            className={s.reasonChip}
            data-active={reason === item}
            onClick={() => setReason(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <Field label="Lý do" required hint={`${reason.length}/${SOCIAL_REPORT_REASON_MAX}`}>
        <textarea
          className={base.textarea}
          rows={3}
          value={reason}
          maxLength={SOCIAL_REPORT_REASON_MAX}
          placeholder="Mô tả vấn đề của nhóm này"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}

function ResolveDialog({
  report,
  decision,
  groupId,
  onClose,
  onResolved,
}: {
  readonly report?: SocialReport;
  readonly decision: ResolveSocialReportRequest['status'];
  readonly groupId: string;
  readonly onClose: () => void;
  readonly onResolved: (report: SocialReport) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setNote('');
    setError(undefined);
    setBusy(false);
  }, [report]);

  const submit = async () => {
    if (!report) return;
    setBusy(true);
    setError(undefined);
    try {
      onResolved(await resolveGroupReport(groupId, report.id, { status: decision, note: note.trim() || undefined }));
    } catch (cause) {
      setError(errorMessage(cause, 'Không xử lý được báo cáo.'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={Boolean(report)}
      title={decision === 'resolved' ? 'Đánh dấu đã xử lý' : 'Bỏ qua báo cáo'}
      submitLabel={decision === 'resolved' ? 'Đã xử lý' : 'Bỏ qua'}
      submittingLabel="Đang lưu…"
      submitting={busy}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field label="Ghi chú" hint={`${note.length}/${SOCIAL_REPORT_NOTE_MAX}`}>
        <textarea
          className={base.textarea}
          rows={3}
          value={note}
          maxLength={SOCIAL_REPORT_NOTE_MAX}
          placeholder="Ghi chú cách xử lý (không bắt buộc)"
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}

/** Mục "Báo cáo" của nhóm (quản trị nhóm): hàng đợi báo cáo theo trạng thái. */
export function GroupReports({
  groupId,
  onChanged,
}: {
  readonly groupId: string;
  readonly onChanged: () => void;
}) {
  const [status, setStatus] = useState<SocialReportStatus>('open');
  const [items, setItems] = useState<readonly SocialReport[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [target, setTarget] = useState<{ readonly report: SocialReport; readonly decision: 'resolved' | 'dismissed' }>();
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    setError(undefined);
    try {
      const page = await listGroupReports(groupId, { status });
      if (mine !== generation.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      setOpenCount(page.openCount);
    } catch (cause) {
      if (mine === generation.current) setError(errorMessage(cause, 'Không tải được báo cáo.'));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [groupId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listGroupReports(groupId, { status, cursor });
      setItems((current) => appendUnique(current, page.items));
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(errorMessage(cause, 'Không tải thêm được báo cáo.'));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className={s.panel} aria-label="Báo cáo của nhóm">
      <div className={s.chipRow} role="tablist" aria-label="Trạng thái báo cáo">
        {SOCIAL_REPORT_STATUSES.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={status === key}
            className={s.filterChip}
            data-active={status === key}
            onClick={() => setStatus(key)}
          >
            {SOCIAL_REPORT_STATUS_LABELS[key]}
            {key === 'open' && openCount > 0 ? <span className={s.tabBadge}>{openCount}</span> : null}
          </button>
        ))}
      </div>

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
          {[0, 1, 2].map((key) => (
            <li key={key} className={s.rowSkeleton} />
          ))}
        </ul>
      ) : items.length === 0 && !error ? (
        <p className={s.emptyLine}>
          {status === 'open' ? 'Không có báo cáo nào đang chờ xử lý.' : 'Chưa có báo cáo nào ở trạng thái này.'}
        </p>
      ) : (
        <ul className={s.rowList}>
          {items.map((report) => (
            <li key={report.id} className={s.reportRow}>
              <Avatar user={report.reporter} size={32} />
              <div className={s.reportText}>
                <span className={s.rowTitle}>
                  <b>{report.reporter.name}</b> báo cáo {SOCIAL_REPORT_TARGET_LABELS[report.targetType].toLowerCase()}
                  {report.target ? (
                    <>
                      :{' '}
                      {report.target.postId ? (
                        <SocialLink
                          to={{
                            name: 'post',
                            postId: report.target.postId,
                            commentId: report.target.commentId,
                          }}
                        >
                          {report.target.label}
                        </SocialLink>
                      ) : (
                        report.target.label
                      )}
                    </>
                  ) : null}
                </span>
                <span className={s.rowMeta}>
                  {[userSubtitle(report.reporter), formatRelativeTime(report.createdAt)].filter(Boolean).join(' · ')}
                </span>
                <p className={s.reportReason}>{report.reason}</p>
                {report.status !== 'open' ? (
                  <span className={s.rowMeta}>
                    {SOCIAL_REPORT_STATUS_LABELS[report.status]}
                    {report.handledBy ? ` bởi ${report.handledBy.name}` : ''}
                    {report.handleNote ? `: ${report.handleNote}` : ''}
                  </span>
                ) : null}
              </div>
              {report.status === 'open' ? (
                <div className={s.rowActions}>
                  <button
                    type="button"
                    className={base.buttonSmallPrimary + ' ' + base.buttonSmall}
                    onClick={() => setTarget({ report, decision: 'resolved' })}
                  >
                    <Check size={13} />
                    Đã xử lý
                  </button>
                  <button
                    type="button"
                    className={base.buttonSmall}
                    onClick={() => setTarget({ report, decision: 'dismissed' })}
                  >
                    <X size={13} />
                    Bỏ qua
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <div className={s.more}>
          <button type="button" className={base.buttonGhost} disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Đang tải…' : 'Xem thêm'}
          </button>
        </div>
      ) : null}

      <ResolveDialog
        report={target?.report}
        decision={target?.decision ?? 'resolved'}
        groupId={groupId}
        onClose={() => setTarget(undefined)}
        onResolved={(report) => {
          setTarget(undefined);
          setItems((current) => current.filter((item) => item.id !== report.id));
          setOpenCount((count) => Math.max(0, count - 1));
          onChanged();
        }}
      />
    </section>
  );
}
