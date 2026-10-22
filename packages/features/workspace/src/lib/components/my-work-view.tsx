'use client';

import {
  MY_WORK_BUCKETS,
  type CreateProjectRequest,
  type CreateWorkItemRequest,
  type MyWorkEvent,
  type MyWorkItem,
  type MyWorkSummary,
  type ParticipantResponse,
  type ProjectMember,
  type ProjectRole,
  type ProjectSummary,
  type WorkItemPriority,
  type WorkItemStatus,
  WORKSPACE_ASSISTANT_ACTIONS,
} from '@enterprise-platform/contracts-workspace';
import { assistantActionKeys, useAssistantSaved } from '@enterprise-platform/feature-module-shell';
import { formatTime } from '@enterprise-platform/shared-ui';
import {
  AtSign,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Plus,
  RefreshCw,
} from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as api from '../workspace-api';
import { mergeNewProjectMembers } from '../project-tree.model';
import {
  PRIORITY_LABELS,
  PRIORITY_TONE,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUS_TONE,
  formatDate,
  formatDateTime,
  workItemStatusLabel,
  workItemStatusTone,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { ProjectForm } from './project-form';
import { WorkItemForm } from './work-item-form';
import { useDirectory } from './use-directory';

const INVITATION_RESPONSES: readonly {
  value: ParticipantResponse;
  label: string;
}[] = [
  { value: 'accepted', label: 'Tham gia' },
  { value: 'tentative', label: 'Có thể' },
  { value: 'declined', label: 'Từ chối' },
];

const WORKSPACE_ACTION_KEYS = assistantActionKeys(WORKSPACE_ASSISTANT_ACTIONS);

/**
 * Trang "Công việc của tôi".
 *
 * Chỉ hiển thị dữ liệu của chính người đang đăng nhập — kể cả quản trị viên
 * tenant. Có một dòng giải thích ngay đầu trang để người quản trị không tưởng
 * màn hình bị lọc sai.
 *
 * Bố cục: dải lịch hôm nay và lời mời ở trên cùng, rồi MỘT bảng chia nhóm theo
 * hạn — số việc của từng nhóm nằm ngay trên đầu nhóm, nên không cần thêm hàng
 * thẻ số nhắc lại cùng con số đó.
 */
export interface MyWorkViewProps {
  /** Mở một node trong trang Dự án: công việc, sự kiện hay luồng trao đổi. */
  readonly onOpen?: (projectId: string, target: string) => void;
  /** Mở một việc ở trang "Công việc ngoài dự án". */
  readonly onOpenTask?: (taskId: string) => void;
}

export function MyWorkView({ onOpen, onOpenTask }: MyWorkViewProps = {}) {
  const directory = useDirectory();
  const [summary, setSummary] = useState<MyWorkSummary>();
  const [isTenantAdmin, setIsTenantAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [responding, setResponding] = useState<string>();

  // Bộ lọc trang: trạng thái, ưu tiên và dự án. Rỗng nghĩa là không lọc.
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  /** Các nhóm dự án đang thu gọn trong bảng công việc. */
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(new Set());

  // Nút "Tạo mới" ở góc trên phải: hai hộp thoại tạo dự án / tạo công việc.
  const [me, setMe] = useState('');
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  /** Mọi dự án người dùng thấy, dùng cho ô chọn "Dự án" trong form Công việc mới. */
  const [projectList, setProjectList] = useState<readonly ProjectSummary[]>([]);
  /** Dự án đang chọn trong form Công việc mới (chưa có dự án nào mở ở trang này). */
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [members, setMembers] = useState<readonly ProjectMember[]>([]);
  const [parentOptions, setParentOptions] = useState<{ id: string; label: string }[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await api.loadMyWork());
      setError(undefined);
    } catch (cause) {
      setSummary(undefined);
      setError((cause as { message?: string })?.message ?? 'Không tải được dữ liệu.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    void api.loadIsTenantAdmin().then(setIsTenantAdmin);
    void api.loadCurrentUserId().then(setMe);
  }, [reload]);

  // Card Trợ lý vừa tạo cuộc họp, công việc hay việc ngoài dự án: cả ba đều hiện ở trang này.
  useAssistantSaved(WORKSPACE_ACTION_KEYS, () => void reload());

  /** Nạp danh sách dự án cho ô chọn "Dự án" khi mở form Công việc mới. */
  const openNewWorkItem = useCallback(() => {
    setSelectedProjectId('');
    setMembers([]);
    setParentOptions([]);
    setItemFormOpen(true);
    api
      .listAllProjects(20)
      .then(setProjectList)
      .catch(() => undefined);
  }, []);

  /**
   * Đổi dự án trong form Công việc mới: nạp thành viên và cây công việc của dự
   * án đó để ô "Người phụ trách" và "Công việc cha" có đúng nguồn dữ liệu.
   */
  const onProjectChange = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setMembers([]);
    setParentOptions([]);
    if (!projectId) return;
    api
      .listMembers(projectId)
      .then((result) => setMembers(result.items))
      .catch(() => undefined);
    api
      .listWorkItems(projectId)
      .then((tree) =>
        setParentOptions(
          tree.items
            .filter((item) => item.status !== 'cancelled')
            .map((item) => ({ id: item.id, label: `${item.code} · ${item.title}` })),
        ),
      )
      .catch(() => undefined);
  }, []);

  const respond = async (eventId: string, response: ParticipantResponse) => {
    setResponding(eventId);
    setError(undefined);
    try {
      await api.respondToEvent(eventId, { responseStatus: response });
      await reload();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không gửi được phản hồi.');
    } finally {
      setResponding(undefined);
    }
  };

  const advance = async (itemId: string, next: WorkItemStatus) => {
    setError(undefined);
    try {
      // Cùng endpoint với màn Dự án, nên mọi ràng buộc — việc con chưa đóng,
      // tiền nhiệm FS chưa xong — vẫn áp dụng nguyên vẹn ở đây.
      await api.changeWorkItemStatus(itemId, { status: next });
      await reload();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không đổi được trạng thái.');
    }
  };

  const allItems = summary?.items ?? [];
  const events = summary?.todayEvents ?? [];
  const invitations = summary?.pendingInvitations ?? [];

  // Các giá trị lọc rút ra từ chính danh sách việc, nên ô lọc chỉ hiện những
  // lựa chọn thật sự có việc.
  const statusOptions = useMemo(() => {
    const seen = new Set<WorkItemStatus>();
    for (const entry of allItems) seen.add(entry.item.status);
    return [...seen].map((status) => ({ value: status, label: WORK_ITEM_STATUS_LABELS[status] }));
  }, [allItems]);
  const priorityOptions = useMemo(() => {
    const seen = new Set<WorkItemPriority>();
    for (const entry of allItems) seen.add(entry.item.priority);
    return [...seen].map((priority) => ({ value: priority, label: PRIORITY_LABELS[priority] }));
  }, [allItems]);
  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of allItems) seen.set(entry.item.projectId, entry.projectCode);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [allItems]);

  const items = useMemo(
    () =>
      allItems.filter(
        (entry) =>
          (!statusFilter || entry.item.status === statusFilter) &&
          (!priorityFilter || entry.item.priority === priorityFilter) &&
          (!projectFilter || entry.item.projectId === projectFilter),
      ),
    [allItems, statusFilter, priorityFilter, projectFilter],
  );
  const hasFilter = Boolean(statusFilter || priorityFilter || projectFilter);

  // Gom việc theo dự án: mỗi dự án là một nhóm, việc chưa đặt hạn/quá hạn xếp
  // theo thứ tự "hạn" để việc gấp nổi lên đầu nhóm. Dự án có việc quá hạn đẩy
  // lên trước để người dùng thấy ngay.
  const projectGroups = useMemo(() => {
    const groups = new Map<
      string,
      { projectId: string; projectCode: string; projectName: string; rows: MyWorkItem[] }
    >();
    for (const entry of items) {
      const key = entry.item.projectId;
      const group = groups.get(key);
      if (group) group.rows.push(entry);
      else
        groups.set(key, {
          projectId: key,
          projectCode: entry.projectCode,
          projectName: entry.projectName,
          rows: [entry],
        });
    }
    const bucketRank = (entry: MyWorkItem) => MY_WORK_BUCKETS.indexOf(entry.bucket);
    const list = [...groups.values()];
    for (const group of list) group.rows.sort((a, b) => bucketRank(a) - bucketRank(b));
    list.sort((a, b) => {
      const aOverdue = a.rows.some((entry) => entry.bucket === 'overdue') ? 0 : 1;
      const bOverdue = b.rows.some((entry) => entry.bucket === 'overdue') ? 0 : 1;
      return aOverdue - bOverdue || a.projectCode.localeCompare(b.projectCode, 'vi');
    });
    return list;
  }, [items]);

  const toggleProject = (projectId: string) =>
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  return (
    <div className={styles.tabBody}>
      {isTenantAdmin ? (
        <p className={styles.notice}>
          Bạn là quản trị viên tenant, nhưng màn hình này{' '}
          <strong>luôn chỉ hiện việc của chính bạn</strong>. Muốn xem toàn bộ dự án, hãy dùng trang
          Dự án hoặc Báo cáo.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {events.length > 0 || invitations.length > 0 ? (
        <section className={styles.dayStrip} aria-label="Lịch hôm nay và lời mời">
          <CalendarClock size={16} aria-hidden className={styles.dayStripIcon} />
          <span className={styles.dayStripTitle}>
            {events.length > 0
              ? `Hôm nay bạn có ${events.length} lịch`
              : 'Hôm nay bạn không có lịch nào'}
          </span>
          {events.map((event) => (
            <span key={`event-${event.eventId}`} className={styles.dayChip}>
              <EventTitle event={event} onOpen={onOpen}>
                <b>{event.allDay ? 'Cả ngày' : formatTime(event.startAt)}</b> {event.title}
              </EventTitle>
              {event.location ? <span className={styles.muted}> · {event.location}</span> : null}
            </span>
          ))}
          {invitations.map((event) => (
            <InvitationChip
              key={`invite-${event.eventId}`}
              event={event}
              onOpen={onOpen}
              busy={responding === event.eventId}
              onRespond={(response) => void respond(event.eventId, response)}
            />
          ))}
        </section>
      ) : null}

      <div className={styles.summaryLine}>
        <span>
          <b>{summary?.counters.openItems ?? '—'}</b> việc đang mở
        </span>
        <span>
          Đã xong tuần này{' '}
          <b className={styles.textSuccess}>{summary?.counters.completedThisWeek ?? '—'}</b>
        </span>
        <span className={styles.summarySpacer} />
        {loading ? <span className={styles.muted}>Đang tải…</span> : null}
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Tải lại"
          title="Tải lại"
          onClick={() => void reload()}
        >
          <RefreshCw size={15} />
        </button>
        <CreateMenu
          onNewProject={() => setProjectFormOpen(true)}
          onNewWorkItem={openNewWorkItem}
        />
      </div>

      {statusOptions.length > 0 || projectOptions.length > 0 ? (
        <div className={styles.filterBar} role="group" aria-label="Bộ lọc công việc">
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Trạng thái</span>
            <Choice
              label="Trạng thái"
              value={statusFilter}
              emptyOption="Mọi trạng thái"
              options={statusOptions}
              onChange={setStatusFilter}
            />
          </div>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Ưu tiên</span>
            <Choice
              label="Ưu tiên"
              value={priorityFilter}
              emptyOption="Mọi mức ưu tiên"
              options={priorityOptions}
              onChange={setPriorityFilter}
            />
          </div>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Dự án</span>
            <Choice
              label="Dự án"
              value={projectFilter}
              emptyOption="Mọi dự án"
              options={projectOptions}
              onChange={setProjectFilter}
            />
          </div>
          {hasFilter ? (
            <button
              type="button"
              className={styles.buttonSmall}
              onClick={() => {
                setStatusFilter('');
                setPriorityFilter('');
                setProjectFilter('');
              }}
            >
              Xoá lọc
            </button>
          ) : null}
        </div>
      ) : null}

      <section className={styles.tableCard}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Công việc</th>
                <th>Dự án</th>
                <th>Ưu tiên</th>
                <th>Trạng thái</th>
                <th>Hạn</th>
                <th>Thao tác nhanh</th>
              </tr>
            </thead>
            <tbody>
              {projectGroups.map((group) => {
                const collapsed = collapsedProjects.has(group.projectId);
                const todoCount = group.rows.filter((entry) => entry.item.status === 'todo').length;
                return (
                  <Fragment key={group.projectId}>
                    <tr className={styles.groupRow}>
                      <th colSpan={6} scope="colgroup">
                        <button
                          type="button"
                          className={styles.groupToggle}
                          aria-expanded={!collapsed}
                          onClick={() => toggleProject(group.projectId)}
                        >
                          {collapsed ? (
                            <ChevronRight size={14} aria-hidden />
                          ) : (
                            <ChevronDown size={14} aria-hidden />
                          )}
                          <span className={styles.treeCode}>{group.projectCode}</span>
                          {group.projectName}
                        </button>
                        <span className={styles.countPill}>{group.rows.length}</span>
                        {todoCount > 0 ? (
                          <span className={styles.muted}> · {todoCount} chưa thực hiện</span>
                        ) : null}
                      </th>
                    </tr>
                    {collapsed
                      ? null
                      : group.rows.map((entry) => {
                          const status = workItemStatusTone(entry.item);
                          const priority = PRIORITY_TONE[entry.item.priority];
                          const isTodo = entry.item.status === 'todo';
                          return (
                            <tr key={entry.item.id} className={isTodo ? styles.rowPending : undefined}>
                              <td>
                                <button
                                  type="button"
                                  className={styles.cellTitleButton}
                                  onClick={() =>
                                    onOpen?.(entry.item.projectId, `work-item/${entry.item.id}`)
                                  }
                                >
                                  <span className={styles.treeCode}>{entry.item.code}</span>
                                  {entry.item.title}
                                </button>
                              </td>
                              <td className={styles.cellSub} title={entry.projectName}>
                                {entry.projectCode}
                              </td>
                              <td>
                                <span
                                  className={styles.pill}
                                  style={{
                                    background: priority.bg,
                                    color: priority.fg,
                                  }}
                                >
                                  {PRIORITY_LABELS[entry.item.priority]}
                                </span>
                              </td>
                              <td>
                                <span
                                  className={styles.pill}
                                  style={{
                                    background: status.bg,
                                    color: status.fg,
                                  }}
                                >
                                  {workItemStatusLabel(entry.item)}
                                </span>
                              </td>
                              <td
                                className={
                                  entry.bucket === 'overdue' ? styles.cellDanger : undefined
                                }
                              >
                                {formatDate(entry.item.plannedEnd) || '—'}
                              </td>
                              <td>
                                {entry.item.status === 'todo' ? (
                                  <button
                                    type="button"
                                    className={styles.buttonSmall}
                                    onClick={() => void advance(entry.item.id, 'in_progress')}
                                  >
                                    Bắt đầu làm
                                  </button>
                                ) : entry.item.status === 'in_progress' ||
                                  entry.item.status === 'review' ? (
                                  <button
                                    type="button"
                                    className={styles.buttonSmall}
                                    onClick={() => void advance(entry.item.id, 'done')}
                                  >
                                    Hoàn thành
                                  </button>
                                ) : (
                                  <span className={styles.muted}>—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {summary && items.length === 0 ? (
          <p className={styles.emptyRow}>
            {hasFilter
              ? 'Không có việc nào khớp bộ lọc.'
              : summary.standaloneTasks.length > 0
                ? 'Bạn không có việc dự án nào đang mở.'
                : 'Bạn không có việc nào đang mở.'}
          </p>
        ) : null}
      </section>

      {summary?.standaloneTasks.length ? (
        <section className={styles.tableCard} aria-label="Công việc khác">
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>
                    <ClipboardList size={14} aria-hidden /> Công việc khác
                  </th>
                  <th>Người giao</th>
                  <th>Ưu tiên</th>
                  <th>Trạng thái</th>
                  <th>Hạn</th>
                </tr>
              </thead>
              <tbody>
                {summary.standaloneTasks.map((entry) => {
                  const status = WORK_ITEM_STATUS_TONE[entry.task.status];
                  const priority = PRIORITY_TONE[entry.task.priority];
                  return (
                    <tr key={entry.task.id}>
                      <td>
                        <button
                          type="button"
                          className={styles.cellTitleButton}
                          onClick={() => onOpenTask?.(entry.task.id)}
                        >
                          <span className={styles.treeCode}>{entry.task.code}</span>
                          {entry.task.title}
                        </button>
                      </td>
                      <td className={styles.cellSub}>
                        {entry.awaitingMyApproval ? 'Chờ bạn duyệt' : directory.nameOf(entry.task.createdBy)}
                      </td>
                      <td>
                        <span
                          className={styles.pill}
                          style={{ background: priority.bg, color: priority.fg }}
                        >
                          {PRIORITY_LABELS[entry.task.priority]}
                        </span>
                      </td>
                      <td>
                        <span
                          className={styles.pill}
                          style={{ background: status.bg, color: status.fg }}
                        >
                          {WORK_ITEM_STATUS_LABELS[entry.task.status]}
                        </span>
                      </td>
                      <td className={entry.bucket === 'overdue' ? styles.cellDanger : undefined}>
                        {formatDate(entry.task.dueDate) || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className={styles.twoColumns}>
        <section className={styles.panel}>
          <h3>
            <AtSign size={14} /> Có người nhắc bạn
          </h3>
          {summary?.mentions.length ? (
            <ul className={`${styles.memberList} ${styles.stackedList}`}>
              {summary.mentions.map((mention) => (
                <li key={mention.messageId}>
                  <button
                    type="button"
                    className={styles.cellTitleButton}
                    title="Mở luồng trao đổi"
                    onClick={() =>
                      onOpen?.(mention.projectId, `chat/${mention.entityType}/${mention.entityId}`)
                    }
                  >
                    {mention.excerpt}
                  </button>
                  <span className={styles.memberRole}>
                    {directory.nameOf(mention.createdBy)} · {formatDateTime(mention.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Chưa ai nhắc tên bạn.</p>
          )}
        </section>

        <section className={styles.panel}>
          <h3>
            <ExternalLink size={14} /> Từ module khác
          </h3>
          {summary?.externalCards.length ? (
            <ul className={`${styles.memberList} ${styles.stackedList}`}>
              {summary.externalCards.map((card) => (
                <li key={card.id}>
                  <span className={styles.memberName}>
                    {/* Nhãn là bản sao để hiển thị nhanh, có thể cũ. Nguồn sự
                        thật luôn là module gốc. */}
                    <a href={card.launchUrl} target="_blank" rel="noopener noreferrer">
                      {card.externalCode ?? card.cachedLabel ?? card.moduleKey}
                    </a>{' '}
                    — {card.workItemTitle}
                  </span>
                  <span className={styles.memberRole}>{card.cachedStatus ?? '—'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Không có hồ sơ nào từ module khác.</p>
          )}
        </section>
      </div>

      {/* Dự án mới — người tạo tự thành chủ nhiệm nên luôn được nhập tài chính. */}
      <ProjectForm
        open={projectFormOpen}
        financeEnabled
        onClose={() => setProjectFormOpen(false)}
        onCreate={async (
          input: CreateProjectRequest,
          contractValue,
          members?: ReadonlyArray<{ userId: string; role: ProjectRole }>,
        ) => {
          const created = await api.createProject(input);
          if (contractValue !== undefined) {
            await api.updateProjectFinance(created.id, { contractValue });
          }
          // Lưu thành viên chọn lúc tạo (đi đường PUT .../members, cần đúng một chủ nhiệm).
          if (members && members.length > 0) {
            const existing = await api.listMembers(created.id);
            await api.setMembers(created.id, {
              members: mergeNewProjectMembers(existing.items, members),
            });
          }
          await reload();
          onOpen?.(created.id, `project/${created.id}`);
        }}
        // Tạo từ trang này không sửa dự án; onUpdate chỉ để thoả kiểu dữ liệu.
        onUpdate={async () => undefined}
      />

      {/* Công việc mới — trang này chưa mở dự án nào nên form có thêm ô chọn Dự án. */}
      <WorkItemForm
        open={itemFormOpen}
        members={members}
        currentUserId={me}
        canAssignOthers
        projectOptions={projectList.map((project) => ({
          id: project.id,
          label: `${project.code}-${project.name}`,
        }))}
        onProjectChange={onProjectChange}
        parentOptions={parentOptions}
        onClose={() => setItemFormOpen(false)}
        onCreate={async (
          input: Omit<CreateWorkItemRequest, 'projectId'>,
          procedureDefinitionId?: string,
          addMemberUserIds?: string[],
        ) => {
          if (!selectedProjectId) throw new Error('Hãy chọn dự án cho công việc.');
          // Thêm người ngoài dự án vào dự án trước, để server chấp nhận họ làm
          // người phụ trách / cùng làm khi tạo công việc.
          if (addMemberUserIds && addMemberUserIds.length > 0) {
            const existing = await api.listMembers(selectedProjectId);
            await api.setMembers(selectedProjectId, {
              members: mergeNewProjectMembers(
                existing.items,
                addMemberUserIds.map((userId) => ({ userId, role: 'member' })),
              ),
            });
            await api
              .listMembers(selectedProjectId)
              .then((result) => setMembers(result.items))
              .catch(() => undefined);
          }
          await api.createWorkItem({
            ...input,
            projectId: selectedProjectId,
            procedureDefinitionId,
          });
          await reload();
        }}
        // Tạo từ trang này không sửa việc; onUpdate chỉ để thoả kiểu dữ liệu.
        onUpdate={async () => undefined}
      />
    </div>
  );
}

/**
 * Nút "Tạo mới" ở góc trên phải: rê chuột (hoặc bấm/điểm focus) để xổ hai mục
 * "Dự án mới" và "Công việc mới". Đóng lại khi con trỏ rời khỏi cả nút lẫn menu.
 */
function CreateMenu({
  onNewProject,
  onNewWorkItem,
}: {
  onNewProject: () => void;
  onNewWorkItem: () => void;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  };
  // Đóng trễ một nhịp để con trỏ kịp đi từ nút xuống menu mà không bị cụp.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  useEffect(() => cancelClose, []);

  return (
    <div
      className={styles.createMenu}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={styles.buttonPrimary}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onFocus={() => setOpen(true)}
      >
        <Plus size={15} /> Tạo mới
      </button>
      {open ? (
        <div className={styles.createMenuList} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.createMenuItem}
            onClick={() => {
              setOpen(false);
              onNewProject();
            }}
          >
            Dự án mới
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.createMenuItem}
            onClick={() => {
              setOpen(false);
              onNewWorkItem();
            }}
          >
            Công việc mới
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Lời mời chờ phản hồi: giờ, tên buổi và ba nút trả lời ngay tại chỗ. */
function InvitationChip({
  event,
  busy,
  onOpen,
  onRespond,
}: {
  event: MyWorkEvent;
  busy: boolean;
  onOpen?: MyWorkViewProps['onOpen'];
  onRespond: (response: ParticipantResponse) => void;
}) {
  return (
    <span className={styles.dayChip}>
      <EventTitle event={event} onOpen={onOpen}>
        <b>{formatDateTime(event.startAt)}</b> {event.title}
      </EventTitle>
      {/* Trả lời xong thì lời mời rời dải này ở lần tải lại. */}
      <span className={styles.responseGroup} role="group" aria-label="Phản hồi lời mời">
        {INVITATION_RESPONSES.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={busy}
            onClick={() => onRespond(option.value)}
          >
            {option.label}
          </button>
        ))}
      </span>
    </span>
  );
}

/**
 * Tên sự kiện: bấm để mở sự kiện trong lịch của dự án. Sự kiện không thuộc
 * dự án nào thì chỉ là chữ — trang Dự án không có chỗ để mở nó.
 */
function EventTitle({
  event,
  onOpen,
  children,
}: {
  event: MyWorkEvent;
  onOpen?: MyWorkViewProps['onOpen'];
  children: ReactNode;
}) {
  if (!event.projectId || !onOpen) return <span>{children}</span>;
  const projectId = event.projectId;
  return (
    <button
      type="button"
      className={styles.chipLink}
      onClick={() => onOpen(projectId, `calendar/${event.eventId}`)}
    >
      {children}
    </button>
  );
}
