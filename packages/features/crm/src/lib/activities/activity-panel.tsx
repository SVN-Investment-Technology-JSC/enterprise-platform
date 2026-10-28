'use client';

import {
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_TYPE_LABELS,
  type Activity,
  type ActivityStatus,
  type ActivityType,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, formatDateTime, toast } from '@enterprise-platform/shared-ui';
import { DateTimePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field, KeysetPager, StatusPill } from '../components/crm-ui';
import { useKeysetPage } from '../components/use-keyset-page';
import { createActivity, errorMessage, getActivity, listActivities, updateActivity } from '../crm-api';
import { labelOptions, peopleOptions, useCanWrite, useCrm } from '../crm-context';
import { isOverdue, personName } from '../sales.model';
import styles from '../sales.module.scss';

const STATUS_TONE: Record<ActivityStatus, 'info' | 'success' | 'neutral'> = {
  OPEN: 'info',
  DONE: 'success',
  CANCELLED: 'neutral',
};

/** Phạm vi hiện danh sách: theo khách, theo cơ hội, hoặc việc được giao cho một người. */
export interface ActivityScope {
  readonly customerId?: string;
  readonly opportunityId?: string;
  readonly assigneeUserId?: string;
}

/**
 * Hoạt động gắn khách hàng hoặc cơ hội: thêm, sửa, ghi kết quả, hoàn tất.
 * Dùng ở tab Hoạt động của khách, ngăn chi tiết cơ hội và trang "Hoạt động".
 */
export function ActivityPanel({
  scope,
  focusId,
  showTarget = false,
  defaultStatus = '',
}: {
  scope: ActivityScope;
  /** Mở sẵn hoạt động này (từ thông báo nhắc hạn). */
  focusId?: string;
  /** Hiện cột khách hàng, cơ hội (trang Hoạt động). */
  showTarget?: boolean;
  /** Lọc trạng thái lúc mở, ví dụ `OPEN` ở trang Hoạt động. */
  defaultStatus?: ActivityStatus | '';
}) {
  const { people } = useCrm();
  const canWrite = useCanWrite();
  const [status, setStatus] = useState<string>(defaultStatus);
  const [editing, setEditing] = useState<Activity | 'new' | null>(null);
  const [completing, setCompleting] = useState<Activity | null>(null);
  const [handledFocus, setHandledFocus] = useState<string>();

  const key = JSON.stringify({ ...scope, status });
  const list = useKeysetPage(key, (cursor) =>
    listActivities({ ...scope, status: (status || undefined) as ActivityStatus | undefined, cursor, limit: 20 }),
  );

  // Mở hoạt động được trỏ tới từ thông báo (một lần cho mỗi id).
  useEffect(() => {
    if (!focusId || handledFocus === focusId) return;
    setHandledFocus(focusId);
    getActivity(focusId)
      .then(setEditing)
      .catch((cause) => toast.error(errorMessage(cause, 'Không mở được hoạt động.')));
  }, [focusId, handledFocus]);

  const columns = useMemo<ColumnsType<Activity>>(
    () => [
      { title: 'Loại', dataIndex: 'type', width: 110, render: (value: ActivityType) => ACTIVITY_TYPE_LABELS[value] },
      { title: 'Tiêu đề', dataIndex: 'subject', ellipsis: true },
      ...(showTarget
        ? [
            {
              title: 'Khách hàng / cơ hội',
              key: 'target',
              width: 220,
              ellipsis: true,
              render: (_: unknown, row: Activity) => [row.customerName, row.opportunityName].filter(Boolean).join(' · '),
            },
          ]
        : []),
      { title: 'Người được giao', dataIndex: 'assigneeUserId', width: 160, ellipsis: true, render: (value: string) => personName(people, value) },
      {
        title: 'Hạn',
        dataIndex: 'dueAt',
        width: 150,
        render: (value: string | null, row) =>
          value ? <span className={isOverdue(row) ? styles.overdue : undefined}>{formatDateTime(value)}</span> : '',
      },
      {
        title: 'Trạng thái',
        dataIndex: 'status',
        width: 120,
        render: (value: ActivityStatus, row) =>
          isOverdue(row) ? <StatusPill tone="danger">Quá hạn</StatusPill> : <StatusPill tone={STATUS_TONE[value]}>{ACTIVITY_STATUS_LABELS[value]}</StatusPill>,
      },
      { title: 'Kết quả', dataIndex: 'result', ellipsis: true },
      {
        title: '',
        key: 'actions',
        width: 150,
        render: (_: unknown, row) =>
          canWrite ? (
            <span className={styles.rowActions}>
              {row.status === 'OPEN' ? (
                <button type="button" className={styles.rowAction} onClick={() => setCompleting(row)}>
                  Hoàn tất
                </button>
              ) : null}
              <button type="button" className={styles.rowAction} onClick={() => setEditing(row)}>
                Sửa
              </button>
            </span>
          ) : null,
      },
    ],
    [people, canWrite, showTarget],
  );

  return (
    <section className={styles.tableCard} aria-label="Hoạt động">
      <div className={styles.toolbar}>
        {canWrite && (scope.customerId || scope.opportunityId) ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setEditing('new')}>
            <Plus size={14} /> Thêm hoạt động
          </button>
        ) : null}
        <SearchableSelect
          className={styles.filter}
          options={labelOptions(ACTIVITY_STATUS_LABELS)}
          value={status}
          placeholder="Mọi trạng thái"
          clearable
          onChange={setStatus}
        />
      </div>
      {list.error ? <p className={styles.alert}>{list.error}</p> : null}
      <Table<Activity>
        size="small"
        rowKey="id"
        loading={list.loading}
        columns={columns}
        dataSource={[...list.items]}
        pagination={false}
        scroll={{ x: 1000 }}
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Chưa có hoạt động nào.' }}
      />
      <KeysetPager page={list.page} count={list.items.length} hasNext={list.hasNext} loading={list.loading} noun="hoạt động" onPrevious={list.previous} onNext={list.next} />
      {editing ? (
        <ActivityFormDialog
          activity={editing === 'new' ? undefined : editing}
          scope={scope}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}
      {completing ? (
        <CompleteActivityDialog
          activity={completing}
          onClose={() => setCompleting(null)}
          onSaved={() => {
            setCompleting(null);
            list.reload();
          }}
        />
      ) : null}
    </section>
  );
}

function ActivityFormDialog({
  activity,
  scope,
  onClose,
  onSaved,
}: {
  activity?: Activity;
  scope: ActivityScope;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { people } = useCrm();
  const [type, setType] = useState<ActivityType>(activity?.type ?? 'CALL');
  const [subject, setSubject] = useState(activity?.subject ?? '');
  const [description, setDescription] = useState(activity?.description ?? '');
  const [assigneeUserId, setAssigneeUserId] = useState(activity?.assigneeUserId ?? '');
  const [dueAt, setDueAt] = useState(activity?.dueAt ?? '');
  const [status, setStatus] = useState<ActivityStatus>(activity?.status ?? 'OPEN');
  const [result, setResult] = useState(activity?.result ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    if (!subject.trim()) return setError('Vui lòng nhập tiêu đề hoạt động.');
    setSubmitting(true);
    setError(undefined);
    try {
      if (activity) {
        await updateActivity(activity.id, {
          version: activity.version,
          type,
          subject: subject.trim(),
          description: description.trim() || null,
          assigneeUserId: assigneeUserId || activity.assigneeUserId,
          dueAt: dueAt || null,
          status,
          result: result.trim() || null,
        });
      } else {
        await createActivity({
          type,
          subject: subject.trim(),
          description: description.trim() || null,
          customerId: scope.opportunityId ? null : (scope.customerId ?? null),
          opportunityId: scope.opportunityId ?? null,
          assigneeUserId: assigneeUserId || null,
          dueAt: dueAt || null,
        });
      }
      toast.success('Đã lưu hoạt động.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được hoạt động.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      title={activity ? 'Sửa hoạt động' : 'Thêm hoạt động'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Loại" required>
          <SearchableSelect options={labelOptions(ACTIVITY_TYPE_LABELS)} value={type} onChange={(value) => setType((value || 'CALL') as ActivityType)} />
        </Field>
        <Field label="Người được giao" hint={activity ? undefined : 'Mặc định là bạn'}>
          <SearchableSelect options={peopleOptions(people)} value={assigneeUserId} placeholder="Chọn người" clearable onChange={setAssigneeUserId} />
        </Field>
        <Field label="Tiêu đề" required wide>
          <input className={styles.input} value={subject} maxLength={300} autoFocus onChange={(event) => setSubject(event.target.value)} />
        </Field>
        <Field label="Hạn">
          <DateTimePickerInput value={dueAt || undefined} onChange={setDueAt} height={38} aria-label="Hạn" />
        </Field>
        {activity ? (
          <Field label="Trạng thái">
            <SearchableSelect options={labelOptions(ACTIVITY_STATUS_LABELS)} value={status} onChange={(value) => setStatus((value || 'OPEN') as ActivityStatus)} />
          </Field>
        ) : null}
        <Field label="Mô tả" wide>
          <textarea className={styles.textarea} rows={3} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        {activity ? (
          <Field label="Kết quả" wide>
            <textarea className={styles.textarea} rows={3} value={result} maxLength={4000} onChange={(event) => setResult(event.target.value)} />
          </Field>
        ) : null}
      </div>
    </CrmDialog>
  );
}

function CompleteActivityDialog({ activity, onClose, onSaved }: { activity: Activity; onClose: () => void; onSaved: () => void }) {
  const [result, setResult] = useState(activity.result ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  async function submit() {
    setSubmitting(true);
    try {
      await updateActivity(activity.id, { version: activity.version, status: 'DONE', result: result.trim() || null });
      toast.success('Đã hoàn tất hoạt động.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được kết quả.'));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <CrmDialog
      open
      title="Hoàn tất hoạt động"
      subtitle={activity.subject}
      submitLabel="Hoàn tất"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Kết quả">
        <textarea className={styles.textarea} rows={4} value={result} maxLength={4000} autoFocus onChange={(event) => setResult(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}
