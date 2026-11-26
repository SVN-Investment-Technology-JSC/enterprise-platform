'use client';

import type {
  RelatedObject,
  RelatedObjectKind,
  RelatedObjectList,
  WorkItem,
} from '@enterprise-platform/contracts-workspace';
import { Popconfirm, toast } from '@enterprise-platform/shared-ui';
import { ExternalLink, Plus, Unlink } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { linkRelatedObjects, type RelatedTarget } from '../related-objects-link';
import {
  attachedToLabel,
  completedRelated,
  filterRelatedObjects,
  formatRelatedFieldValue,
  groupRelatedObjects,
  NO_RELATED_FILTER,
  pendingRelatedRow,
  relatedAttachedOptions,
  relatedDisplayLabel,
  relatedKindOptions,
  relatedLaunchHref,
  relatedLinkWarning,
  RELATED_FILTER_ALL,
  RELATED_UNAVAILABLE_NOTES,
  type PendingRelatedObject,
  type RelatedFilter,
} from '../related-objects.model';
import * as api from '../workspace-api';
import { formatDateTime } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog } from './dialog';
import { RelatedObjectsEditor } from './related-objects-editor';
import { useDirectory } from './use-directory';

export interface RelatedObjectsPanelProps {
  /** Dự án (liệt kê cả liên kết gắn ở công việc) hoặc một công việc; nút "Thêm liên kết" gắn vào đúng đối tượng này. */
  readonly target: RelatedTarget;
  /** Công việc của dự án, để ghi tên việc khi server chưa kèm `entityLabel`. */
  readonly items: readonly WorkItem[];
  /** Loại hồ sơ gắn được; rỗng thì không có nút thêm (vẫn xem được liên kết cũ). */
  readonly kinds: readonly RelatedObjectKind[];
  /** Báo số liên kết sau mỗi lần tải, cho con số cạnh tên tab. */
  readonly onCount?: (count: number) => void;
  /** Tăng lên khi nơi khác (form sửa) vừa gắn hay gỡ liên kết: tải lại danh sách. */
  readonly reloadToken?: number;
}

export interface TabRelatedProps extends Omit<RelatedObjectsPanelProps, 'target'> {
  readonly projectId: string;
}

/**
 * Tab "Liên quan" của dự án: hồ sơ ở module khác (báo giá, hợp đồng...) gắn vào dự án hoặc vào từng công việc.
 * Thông tin đầy đủ đọc từ module gốc mỗi lần mở tab, dưới quyền người xem; module không trả lời hay người xem
 * không có quyền thì chỉ còn nhãn đã lưu kèm một dòng giải thích.
 */
export function TabRelated({ projectId, ...props }: TabRelatedProps) {
  return <RelatedObjectsPanel target={{ type: 'project', id: projectId }} {...props} />;
}

/**
 * Danh sách liên kết dùng chung cho tab Liên quan của dự án và tab Liên quan trong chi tiết công việc: bộ lọc, nhóm
 * theo loại, thẻ từng liên kết, gỡ và thêm liên kết.
 */
export function RelatedObjectsPanel({
  target,
  items,
  kinds,
  onCount,
  reloadToken: outsideToken = 0,
}: RelatedObjectsPanelProps) {
  const directory = useDirectory();
  const [data, setData] = useState<RelatedObjectList>();
  const [error, setError] = useState<string>();
  const [reloadToken, setReloadToken] = useState(0);
  const [filter, setFilter] = useState<RelatedFilter>(NO_RELATED_FILTER);
  const [adding, setAdding] = useState(false);
  const countRef = useRef(onCount);
  countRef.current = onCount;

  useEffect(() => {
    let alive = true;
    setError(undefined);
    (target.type === 'project'
      ? api.listProjectRelatedObjects(target.id)
      : api.listWorkItemRelatedObjects(target.id)
    )
      .then((result) => {
        if (!alive) return;
        setData(result);
        countRef.current?.(result.items.length);
      })
      .catch((cause) => {
        if (alive) setError((cause as { message?: string })?.message ?? 'Không tải được đối tượng liên quan.');
      });
    return () => {
      alive = false;
    };
  }, [target.type, target.id, reloadToken, outsideToken]);

  const workItemLabel = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, `${item.code} · ${item.title}`]));
    return (id: string) => byId.get(id);
  }, [items]);

  const all = data?.items ?? [];
  const kindOptions = useMemo(() => relatedKindOptions(all), [all]);
  const attachedOptions = useMemo(() => relatedAttachedOptions(all, workItemLabel), [all, workItemLabel]);
  const groups = useMemo(() => groupRelatedObjects(filterRelatedObjects(all, filter)), [all, filter]);
  const filtering = filter.kind !== RELATED_FILTER_ALL || filter.attached !== RELATED_FILTER_ALL;
  const canAdd = Boolean(data?.canAdd) && kinds.length > 0;
  /** Liên kết của chính đối tượng này: không chọn lại được trong hộp thêm, và tính vào giới hạn của nó. */
  const ownLinks = all.filter(
    (item) => (target.type === 'project' ? item.entityType === 'project' : item.entityId === target.id),
  );
  const forWorkItem = target.type === 'work_item';

  const remove = async (item: RelatedObject) => {
    try {
      await api.removeRelatedObject(item.id);
      toast.success(`Đã gỡ liên kết ${relatedDisplayLabel(item.code, item.label)}.`);
      setReloadToken((token) => token + 1);
    } catch (cause) {
      toast.error((cause as { message?: string })?.message ?? 'Không gỡ được liên kết.');
    }
  };

  const addButton = canAdd ? (
    <button type="button" className={styles.buttonPrimary} onClick={() => setAdding(true)}>
      <Plus size={14} aria-hidden /> Thêm liên kết
    </button>
  ) : null;
  // Ô lọc chỉ hiện khi có gì để lọc: từ hai loại trở lên, hoặc có liên kết gắn ở công việc.
  const showKindFilter = kindOptions.length > 1;
  const showAttachedFilter = !forWorkItem && attachedOptions.length > 1;

  return (
    <div className={styles.tabBody}>
      {all.length > 0 ? (
        <div className={styles.relatedToolbar}>
          {showKindFilter ? (
            <div className={`${styles.filterField} ${styles.filterFieldWide}`}>
              <Choice
                label="Lọc theo loại hồ sơ"
                value={filter.kind}
                selectOnly
                options={[{ value: RELATED_FILTER_ALL, label: 'Tất cả loại' }, ...kindOptions]}
                onChange={(kind) => setFilter((current) => ({ ...current, kind: kind || RELATED_FILTER_ALL }))}
              />
            </div>
          ) : null}
          {showAttachedFilter ? (
            <div className={`${styles.filterField} ${styles.filterFieldWide}`}>
              <Choice
                label="Lọc theo nơi gắn"
                value={filter.attached}
                options={[{ value: RELATED_FILTER_ALL, label: 'Tất cả nơi gắn' }, ...attachedOptions]}
                onChange={(attached) =>
                  setFilter((current) => ({ ...current, attached: attached || RELATED_FILTER_ALL }))
                }
              />
            </div>
          ) : null}
          {filtering ? (
            <button type="button" className={styles.buttonSmall} onClick={() => setFilter(NO_RELATED_FILTER)}>
              Xoá bộ lọc
            </button>
          ) : null}
          <span className={styles.filterSpacer} />
          {addButton}
        </div>
      ) : null}

      {data?.degraded ? (
        <p className={styles.notice} role="status">
          Một số thông tin tạm thời chưa tải được, đang hiện thông tin đã lưu.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {!data && !error ? <p className={styles.muted}>Đang tải…</p> : null}

      {data && all.length === 0 ? (
        <div className={styles.relatedEmpty}>
          <p>Chưa có đối tượng liên quan.</p>
          {addButton}
        </div>
      ) : null}

      {data && all.length > 0 && groups.length === 0 ? (
        <p className={styles.muted}>Không có đối tượng nào khớp bộ lọc.</p>
      ) : null}

      {groups.map((group) => (
        <section key={group.key} className={styles.relatedGroup} aria-label={group.label}>
          <h3 className={styles.relatedGroupHead}>
            {group.label}
            <span className={styles.countPill}>{group.items.length}</span>
          </h3>
          <ul className={styles.relatedList}>
            {group.items.map((item) => (
              <RelatedCard
                key={item.id}
                item={item}
                attachedTo={forWorkItem ? undefined : attachedToLabel(item, workItemLabel)}
                createdByName={item.createdByName || directory.nameOf(item.createdBy)}
                onRemove={() => remove(item)}
              />
            ))}
          </ul>
        </section>
      ))}

      <AddRelatedDialog
        open={adding}
        target={target}
        kinds={kinds}
        existing={ownLinks}
        onClose={() => setAdding(false)}
        onSaved={() => setReloadToken((token) => token + 1)}
      />
    </div>
  );
}

/**
 * Một liên kết: cả dòng tiêu đề (mã và tên, trạng thái) là một vùng bấm lớn mở hồ sơ ở tab mới; thông tin chi tiết
 * xếp lưới bên dưới; "Gỡ" là thao tác phụ, nhẹ màu ở góc.
 */
function RelatedCard({
  item,
  attachedTo,
  createdByName,
  onRemove,
}: {
  readonly item: RelatedObject;
  /** Vắng khi danh sách chỉ của một công việc: mọi liên kết đều gắn vào chính nó. */
  readonly attachedTo?: string;
  readonly createdByName: string;
  readonly onRemove: () => Promise<void>;
}) {
  const href = relatedLaunchHref(item);
  const title = relatedDisplayLabel(item.code, item.label);
  const head = (
    <>
      <span className={styles.relatedTitle}>
        {title}
        {href ? <ExternalLink size={14} aria-hidden className={styles.relatedOpenIcon} /> : null}
      </span>
      {item.status ? <span className={styles.relatedStatus}>{item.status}</span> : null}
    </>
  );
  return (
    <li className={item.unavailableReason ? `${styles.relatedCard} ${styles.relatedCardMuted}` : styles.relatedCard}>
      <div className={styles.relatedCardHead}>
        {href ? (
          <a className={styles.relatedCardLink} href={href} target="_blank" rel="noopener noreferrer" title="Mở hồ sơ">
            {head}
          </a>
        ) : (
          <span className={styles.relatedCardStatic}>{head}</span>
        )}
        {item.canRemove ? (
          <Popconfirm
            title="Gỡ liên kết?"
            description="Hồ sơ gốc không bị ảnh hưởng."
            okText="Gỡ"
            cancelText="Huỷ"
            okType="danger"
            placement="left"
            onConfirm={onRemove}
          >
            <button type="button" className={styles.relatedRemove} aria-label={`Gỡ liên kết ${title}`}>
              <Unlink size={13} aria-hidden /> Gỡ
            </button>
          </Popconfirm>
        ) : null}
      </div>
      {item.unavailableReason ? (
        <p className={styles.relatedNote}>{RELATED_UNAVAILABLE_NOTES[item.unavailableReason]}</p>
      ) : null}
      {item.fields.length > 0 ? (
        <dl className={styles.relatedFields}>
          {item.fields.map((field) => (
            <div key={field.key} className={styles.relatedField}>
              <dt>{field.label}</dt>
              <dd>{formatRelatedFieldValue(field)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className={styles.relatedMeta}>
        {[attachedTo ? `Gắn vào ${attachedTo}` : undefined, `${createdByName} · ${formatDateTime(item.createdAt)}`]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </li>
  );
}

/** Hộp "Thêm liên kết" cho chính dự án: chọn nhiều hồ sơ rồi gắn một lượt; hồ sơ nào lỗi thì ở lại để thử lại. */
function AddRelatedDialog({
  open,
  target,
  kinds,
  existing,
  onClose,
  onSaved,
}: {
  readonly open: boolean;
  readonly target: RelatedTarget;
  readonly kinds: readonly RelatedObjectKind[];
  readonly existing: readonly RelatedObject[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const where = target.type === 'project' ? 'dự án' : 'công việc';
  const [rows, setRows] = useState<PendingRelatedObject[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setRows([pendingRelatedRow({ kind: kinds.length === 1 ? kinds[0].key : '' })]);
    setSaving(false);
    setError(undefined);
  }, [open, kinds]);

  const submit = async () => {
    const chosen = completedRelated(rows);
    if (chosen.length === 0) {
      setError('Chọn ít nhất một hồ sơ để gắn.');
      return;
    }
    setError(undefined);
    setSaving(true);
    const failures = await linkRelatedObjects(target, chosen);
    const saved = chosen.length - failures.length;
    if (saved > 0) onSaved();
    if (failures.length === 0) {
      toast.success(`Đã gắn ${saved} đối tượng liên quan vào ${where}.`);
      onClose();
      return;
    }
    // Giữ lại đúng các dòng lỗi để người dùng sửa hoặc thử lại; dòng đã gắn được thì rút khỏi hộp.
    setRows(failures.map((failure) => failure.item));
    setError(
      (saved > 0 ? `Đã gắn ${saved}/${chosen.length}. ` : '') + relatedLinkWarning(failures, undefined, false),
    );
    setSaving(false);
  };

  return (
    <Dialog
      open={open}
      title="Thêm liên kết"
      size="large"
      submitLabel="Lưu"
      submitting={saving}
      submittingLabel="Đang gắn…"
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <RelatedObjectsEditor
        kinds={kinds}
        value={rows}
        onChange={setRows}
        ariaPrefix="Đối tượng liên quan"
        existing={existing}
        collapsible={false}
        disabled={saving}
      />
    </Dialog>
  );
}
