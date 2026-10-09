'use client';

import {
  DEPENDENCY_TYPES,
  type DependencyType,
  type ExternalReference,
  type ProjectMember,
  type ProjectSummary,
  type WorkItem,
  type WorkItemDependency,
} from '@enterprise-platform/contracts-workspace';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { useState } from 'react';
import {
  DEPENDENCY_TYPE_LABELS,
  ITEM_TYPE_LABELS,
  ROLE_LABELS,
  WORK_ITEM_STATUS_LABELS,
  formatDate,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { useDirectory } from './use-directory';

export interface TabOverviewProps {
  readonly project: ProjectSummary;
  readonly items: readonly WorkItem[];
  readonly members: readonly ProjectMember[];
  /** Rỗng nghĩa là đang xem chính dự án. */
  readonly selected?: WorkItem;
  /** Con trỏ sang module khác của cả dự án; tab tự lọc theo node đang chọn. */
  readonly externalRefs?: readonly ExternalReference[];
  /** Không đọc được module gốc; nhãn đang hiện là bản cache có thể cũ. */
  readonly externalDegraded?: boolean;
  /** Công việc đang chọn chạy theo quy trình mà chưa mở được hồ sơ. */
  readonly procedurePending?: boolean;
  /** Chủ nhiệm, quản lý, quản trị tenant: hiện nút Quản lý thành viên. */
  readonly canManageMembers?: boolean;
  readonly onManageMembers?: () => void;
  /** Mọi cạnh phụ thuộc của dự án; tab tự lọc theo công việc đang chọn. */
  readonly dependencies?: readonly WorkItemDependency[];
  /** Chủ nhiệm, quản lý: được thêm, gỡ phụ thuộc. */
  readonly canEditDependencies?: boolean;
  readonly onAddDependency?: (
    successorId: string,
    input: { predecessorId: string; dependencyType: DependencyType; lagDays: number },
  ) => Promise<void>;
  readonly onRemoveDependency?: (successorId: string, dependencyId: string) => Promise<void>;
  /** Thành viên trở lên: gỡ con trỏ sang hồ sơ module khác (không đụng hồ sơ gốc). */
  readonly canUnlinkRefs?: boolean;
  readonly onUnlinkRef?: (workItemId: string, referenceId: string) => Promise<void>;
}

/**
 * Tab Tổng quan: phần chi tiết của node đang chọn.
 *
 * Trạng thái, độ ưu tiên, người phụ trách, kế hoạch và tiến độ đã nằm ở khối
 * đầu node (`NodeHeader`) phía trên hàng tab, nên ở đây chỉ còn những gì khối
 * đó không có — không hiện lại cùng một thông tin hai lần.
 */
export function TabOverview({
  project,
  items,
  members,
  selected,
  externalRefs = [],
  externalDegraded = false,
  procedurePending = false,
  canManageMembers = false,
  onManageMembers,
  dependencies = [],
  canEditDependencies = false,
  onAddDependency,
  onRemoveDependency,
  canUnlinkRefs = false,
  onUnlinkRef,
}: TabOverviewProps) {
  const directory = useDirectory();
  const links = selected
    ? externalRefs.filter((ref) => ref.entityType === 'work_item' && ref.entityId === selected.id)
    : [];

  return (
    <div className={styles.tabBody}>
      <section className={styles.panel}>
        <h3>Chi tiết</h3>
        <dl className={styles.definitionList}>
          {selected ? (
            <>
              <Definition label="Loại" value={ITEM_TYPE_LABELS[selected.itemType]} />
              <Definition
                label="Cách thực hiện"
                value={selected.executionType === 'procedure' ? 'Theo quy trình' : 'Thủ công'}
              />
              <Definition
                label="Giờ ước lượng"
                value={selected.estimateHours == null ? '—' : `${selected.estimateHours} giờ`}
              />
              <Definition
                label="Thực tế"
                value={dateRange(selected.actualStart, selected.actualEnd)}
              />
            </>
          ) : (
            <>
              <Definition label="Khách hàng" value={project.customerRef ?? '—'} />
            </>
          )}
        </dl>
        {selected?.description || project.description ? (
          <p className={styles.description}>{selected?.description ?? project.description}</p>
        ) : null}
      </section>

      {selected ? (
        <DependencyPanel
          selected={selected}
          items={items}
          dependencies={dependencies}
          canEdit={canEditDependencies}
          onAdd={onAddDependency}
          onRemove={onRemoveDependency}
        />
      ) : null}

      {selected && (links.length > 0 || procedurePending) ? (
        <section className={styles.panel}>
          <h3>Hồ sơ ở module khác</h3>
          {/* Chỉ đọc. Muốn thay đổi hồ sơ thì mở thẳng module gốc — Workspace
              không bao giờ ghi ngược sang module khác. */}
          {procedurePending ? (
            <p className={styles.pendingNote}>
              Công việc đã tạo nhưng chưa mở được hồ sơ bên Quy trình. Bấm chuột phải vào công
              việc trên cây và chọn "Thử mở lại quy trình".
            </p>
          ) : null}
          {externalDegraded ? (
            <p className={styles.muted}>
              Không đọc được module gốc lúc này; trạng thái bên dưới là bản lưu gần nhất và có
              thể đã cũ.
            </p>
          ) : null}
          <ul className={styles.memberList}>
            {links.map((ref) => (
              <li key={ref.id}>
                <span className={styles.memberName}>
                  <a href={ref.launchUrl} target="_blank" rel="noopener noreferrer">
                    {ref.externalCode ?? ref.cachedLabel ?? ref.externalId}
                  </a>{' '}
                  {ref.cachedLabel && ref.externalCode ? `— ${ref.cachedLabel}` : ''}
                </span>
                <span className={styles.memberRole}>
                  {ref.cachedStatus ?? '—'}
                  {ref.syncedAt ? ` · cập nhật ${formatDate(ref.syncedAt.slice(0, 10))}` : ''}
                  {canUnlinkRefs && onUnlinkRef ? (
                    <>
                      {' · '}
                      <Popconfirm
                        title="Gỡ liên kết hồ sơ này?"
                        description="Chỉ bỏ con trỏ ở Workspace. Hồ sơ bên module gốc vẫn giữ nguyên."
                        okText="Gỡ liên kết"
                        okType="danger"
                        onConfirm={() => onUnlinkRef(selected.id, ref.id)}
                      >
                        <button type="button" className={styles.linkButton}>
                          Gỡ liên kết
                        </button>
                      </Popconfirm>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Trong hộp chi tiết công việc thì bỏ: thành viên đã có ở khối đầu dự án. */}
      {selected ? null : (
      <section className={styles.panel}>
        <h3 className={styles.panelHeadRow}>
          Thành viên dự án
          {canManageMembers && onManageMembers ? (
            <button type="button" className={styles.linkButton} onClick={onManageMembers}>
              Quản lý thành viên
            </button>
          ) : null}
        </h3>
        {members.length === 0 ? (
          <p className={styles.muted}>Chưa có thành viên nào ngoài chủ nhiệm.</p>
        ) : (
          <ul className={styles.memberList}>
            {members.map((member) => {
              const name = directory.nameOf(member.userId);
              const units = directory.find(member.userId)?.unitNames ?? [];
              return (
                <li key={member.id}>
                  {/* Chữ cái đầu thay ảnh: danh bạ không có ảnh đại diện. */}
                  <span className={styles.avatar} aria-hidden>
                    {initialsOf(name)}
                  </span>
                  <span className={styles.memberName}>
                    {name}
                    {units.length > 0 ? (
                      <span className={styles.muted}> · {units.join(', ')}</span>
                    ) : null}
                  </span>
                  <span className={styles.memberRole}>{ROLE_LABELS[member.role]}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      )}
    </div>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function dateRange(start?: string | null, end?: string | null): string {
  const from = formatDate(start);
  const to = formatDate(end);
  if (!from && !to) return '—';
  return `${from || '…'} → ${to || '…'}`;
}

/**
 * Các việc phải đi trước công việc đang chọn.
 *
 * Chỉ hiện cạnh mà công việc đang chọn là việc sau — khớp với
 * `GET /work-items/:id/dependencies`. Server còn kiểm vòng lặp và trùng cạnh;
 * lỗi đó hiện ngay dưới hàng nhập.
 */
function DependencyPanel({
  selected,
  items,
  dependencies,
  canEdit,
  onAdd,
  onRemove,
}: {
  selected: WorkItem;
  items: readonly WorkItem[];
  dependencies: readonly WorkItemDependency[];
  canEdit: boolean;
  onAdd?: TabOverviewProps['onAddDependency'];
  onRemove?: TabOverviewProps['onRemoveDependency'];
}) {
  const [predecessorId, setPredecessorId] = useState('');
  const [dependencyType, setDependencyType] = useState<DependencyType>('FS');
  const [lag, setLag] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const byId = new Map(items.map((item) => [item.id, item]));
  const incoming = dependencies.filter((edge) => edge.successorId === selected.id);
  const taken = new Set(incoming.map((edge) => edge.predecessorId));
  const candidates = items.filter(
    (item) => item.id !== selected.id && !taken.has(item.id),
  );
  const editable = canEdit;

  const guard = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await operation();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được phụ thuộc.');
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!onAdd || !predecessorId) return;
    const lagDays = Number(lag || '0');
    if (!Number.isInteger(lagDays)) {
      setError('Độ trễ phải là số ngày nguyên (được âm).');
      return;
    }
    void guard(async () => {
      await onAdd(selected.id, { predecessorId, dependencyType, lagDays });
      setPredecessorId('');
      setLag('0');
    });
  };

  if (!editable && incoming.length === 0) return null;

  return (
    <section className={styles.panel}>
      <h3>Phụ thuộc — việc phải đi trước</h3>
      {incoming.length === 0 ? (
        <p className={styles.muted}>Công việc này chưa phụ thuộc việc nào.</p>
      ) : (
        <ul className={styles.memberList}>
          {incoming.map((edge) => {
            const predecessor = byId.get(edge.predecessorId);
            return (
              <li key={edge.id}>
                <span className={styles.memberName}>
                  {predecessor ? `${predecessor.code} · ${predecessor.title}` : edge.predecessorId}
                  {predecessor ? ` — ${WORK_ITEM_STATUS_LABELS[predecessor.status]}` : ''}
                </span>
                <span className={styles.memberRole}>
                  {DEPENDENCY_TYPE_LABELS[edge.dependencyType]}
                  {edge.lagDays ? ` · trễ ${edge.lagDays} ngày` : ''}
                  {editable && onRemove ? (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className={styles.linkButton}
                        disabled={busy}
                        onClick={() => void guard(() => onRemove(selected.id, edge.id))}
                      >
                        Gỡ
                      </button>
                    </>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {editable && onAdd ? (
        <div className={styles.inlineForm}>
          <Choice
            label="Việc phải đi trước"
            value={predecessorId}
            emptyOption="— Chọn việc đi trước —"
            options={candidates.map((item) => ({
              value: item.id,
              label: `${item.code} · ${item.title}`,
            }))}
            onChange={setPredecessorId}
          />
          <Choice
            label="Loại phụ thuộc"
            value={dependencyType}
            options={DEPENDENCY_TYPES.map((type) => ({
              value: type,
              label: DEPENDENCY_TYPE_LABELS[type],
            }))}
            onChange={(value) => setDependencyType(value as DependencyType)}
          />
          <input
            aria-label="Độ trễ (ngày)"
            inputMode="numeric"
            value={lag}
            title="Độ trễ (ngày), được âm"
            onChange={(event) => setLag(event.target.value)}
          />
          <button
            type="button"
            className={styles.buttonGhost}
            disabled={busy || !predecessorId}
            onClick={add}
          >
            Thêm
          </button>
        </div>
      ) : null}
      {error ? <p className={styles.alert}>{error}</p> : null}
      <p className={styles.muted}>
        Chỉ loại FS chặn đóng công việc khi việc đi trước chưa xong; các loại khác chỉ cảnh báo
        lịch.
      </p>
    </section>
  );
}

/** Chữ cái đầu của họ và tên, ví dụ "Nguyễn Quản Lý" → "NL". */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}
