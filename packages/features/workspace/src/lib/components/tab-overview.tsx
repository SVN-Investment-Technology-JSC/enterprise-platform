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
import { CalendarClock, MapPin, UserRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import {
  DEPENDENCY_TYPE_LABELS,
  ITEM_TYPE_LABELS,
  formatDate,
  workItemStatusLabel,
  externalStatusLabel,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { ErrorToast } from './error-toast';
import { Choice } from './choice';
import { Tooltip } from './tooltip';
import { useDirectory } from './use-directory';
import { useProjectRoles } from './use-project-roles';
import { useTransportSummary, type TransportSummary } from './use-transport-summary';
import type { PendingProcedure } from '../procedure-pending';
import { Confirm } from './confirm-box';
import { ProgressHistoryPanel } from './progress-history-panel';
import { WORK_ITEM_PROGRESS_METHOD_INFO } from '../project-progress-methods';
import { DEFAULT_OVERVIEW_TAB, parseStoredTab, type OverviewTab } from '../overview-tabs';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

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
  /** Công việc "Theo quy trình" chưa có hồ sơ: đang mở, bị từ chối, hoặc chưa gửi. */
  readonly procedurePending?: PendingProcedure;
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
  /** Được sửa tiến độ của việc đang chọn (đầu việc, khối lượng): người làm hoặc quản lý, dự án chưa lưu trữ. */
  readonly canEditProgress?: boolean;
  /** Mở hộp báo khối lượng (việc tính tiến độ theo khối lượng). */
  readonly onReportQuantity?: (item: WorkItem) => void;
  /**
   * Chỉ dùng khi có `selected`: khung tài liệu của việc, đặt thành một tab. Nhận hàm báo số tài liệu để tab hiện số đếm.
   * Khung vẫn được dựng khi tab khác đang mở để số đếm có ngay.
   */
  readonly renderDocuments?: (onCount: (count: number) => void) => ReactNode;
  /** Đối tượng liên quan của công việc, đặt thành tab "Liên quan" cạnh Tài liệu; vắng thì không có tab đó. */
  readonly renderRelated?: (onCount: (count: number) => void) => ReactNode;
  /**
   * Trao đổi của công việc, đặt thành tab "Trao đổi". Chỉ dựng khi tab đang mở, nên tin chỉ được đánh dấu đã đọc lúc
   * người dùng thật sự mở tab.
   */
  readonly renderChat?: () => ReactNode;
  /** Số tin chưa đọc của công việc, hiện trên tab Trao đổi. */
  readonly chatUnread?: number;
  /** Nơi gọi muốn mở thẳng một tab (vd thông báo tin nhắn mở tab Trao đổi); xong thì báo `onTabRequestHandled`. */
  readonly tabRequest?: OverviewTab;
  readonly onTabRequestHandled?: () => void;
  /** Các bước của hồ sơ quy trình, đặt dưới danh sách hồ sơ liên kết trong tab Chi tiết. */
  readonly procedureSteps?: ReactNode;
}

const TAB_STORAGE_KEY = 'ep.workspace.itemTab';

/** Tab đang mở của đúng công việc này (nạp lại trang không mất); việc khác thì về tab mặc định. */
function restoreTab(itemId: string): OverviewTab {
  try {
    return parseStoredTab(window.sessionStorage.getItem(TAB_STORAGE_KEY), itemId);
  } catch {
    // Trình duyệt chặn bộ nhớ phiên: dùng tab mặc định.
  }
  return DEFAULT_OVERVIEW_TAB;
}

function rememberTab(itemId: string, tab: OverviewTab) {
  try {
    window.sessionStorage.setItem(TAB_STORAGE_KEY, `${itemId}|${tab}`);
  } catch {
    // Không lưu được thì thôi, chỉ mất tiện ích nhớ tab.
  }
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
  procedurePending,
  canManageMembers = false,
  onManageMembers,
  dependencies = [],
  canEditDependencies = false,
  onAddDependency,
  onRemoveDependency,
  canUnlinkRefs = false,
  onUnlinkRef,
  canEditProgress = false,
  onReportQuantity,
  renderDocuments,
  renderRelated,
  renderChat,
  chatUnread = 0,
  tabRequest,
  onTabRequestHandled,
  procedureSteps,
}: TabOverviewProps) {
  const directory = useDirectory();
  const projectRoles = useProjectRoles();
  const links = selected
    ? externalRefs.filter((ref) => ref.entityType === 'work_item' && ref.entityId === selected.id)
    : [];
  const transport = useTransportSummary('WORK_ITEM', selected?.id, selected?.updatedAt);
  const [tab, setTab] = useState<OverviewTab>(() => (selected ? restoreTab(selected.id) : DEFAULT_OVERVIEW_TAB));
  const [progressCount, setProgressCount] = useState<number>();
  const [documentCount, setDocumentCount] = useState<number>();
  const [relatedCount, setRelatedCount] = useState<number>();

  // Mở thẳng tab nơi gọi yêu cầu (bấm "Mở trao đổi", link thông báo), rồi báo đã xong để lần sau không áp lại.
  useEffect(() => {
    if (!tabRequest || !selected) return;
    setTab(tabRequest);
    rememberTab(selected.id, tabRequest);
    onTabRequestHandled?.();
  }, [tabRequest, selected, onTabRequestHandled]);

  const detailBody = (
    <>
      <div className={transport ? styles.detailColumns : undefined}>
        <dl className={selected ? `${styles.definitionList} ${styles.definitionGrid}` : styles.definitionList}>
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
                label="Cách tính tiến độ"
                value={WORK_ITEM_PROGRESS_METHOD_INFO[selected.progressMethod ?? 'manual'].label}
              />
              {selected.progressMethod === 'quantity' ? (
                <Definition
                  label="Khối lượng"
                  value={`${selected.quantityDone ?? 0} / ${selected.quantityTarget ?? 0} ${selected.quantityUnit ?? ''}`.trim()}
                />
              ) : null}
              {selected.weight != null ? <Definition label="Tỷ trọng" value={String(selected.weight)} /> : null}
              <Definition label="Thực tế" value={dateRange(selected.actualStart, selected.actualEnd)} />
            </>
          ) : (
            <Definition label="Khách hàng" value={project.customerRef ?? '—'} />
          )}
        </dl>
        {selected ? <TransportCard summary={transport} /> : null}
      </div>
      {selected?.description || project.description ? (
        <p className={styles.description}>{selected?.description ?? project.description}</p>
      ) : null}
    </>
  );

  const quantityBlock =
    selected?.progressMethod === 'quantity' &&
    canEditProgress &&
    onReportQuantity &&
    selected.status !== 'done' &&
    selected.status !== 'cancelled' ? (
      <div className={styles.quantityNote}>
        <p>
          Đã hoàn thành <b>{selected.quantityDone ?? 0}</b> / {selected.quantityTarget ?? 0} {selected.quantityUnit}.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => onReportQuantity(selected)}>
          Báo khối lượng
        </Button>
      </div>
    ) : null;

  // Hồ sơ liên kết và các bước quy trình nằm ngay trong tab Chi tiết, dưới phần thông tin của việc.
  const hasLinks = Boolean(selected && (links.length > 0 || procedurePending));
  const linksBody = selected && hasLinks ? (
    <section className={styles.detailLinks} aria-label="Hồ sơ liên kết">
      {/* Chỉ đọc. Muốn thay đổi hồ sơ thì mở thẳng module gốc — Workspace
          không bao giờ ghi ngược sang module khác. */}
      <h3>Hồ sơ liên kết</h3>
      {procedurePending ? <p className={styles.pendingNote}>{procedurePending.hint}</p> : null}
      {externalDegraded ? (
        <p className={styles.muted}>
          Không đọc được module gốc lúc này; trạng thái bên dưới là bản lưu gần nhất và có thể đã cũ.
        </p>
      ) : null}
      <ul className={styles.linkRecordList}>
        {links.map((ref) => (
          <li key={ref.id} className={styles.linkRecord}>
            <div className={styles.linkRecordMain}>
              <a href={ref.launchUrl} target="_blank" rel="noopener noreferrer">
                {ref.externalCode ?? ref.cachedLabel ?? ref.externalId}
              </a>
              {ref.cachedLabel && ref.externalCode ? (
                <span className={styles.linkRecordName} title={ref.cachedLabel}>
                  {ref.cachedLabel}
                </span>
              ) : null}
            </div>
            <div className={styles.linkRecordMeta}>
              <span className={`${styles.linkRecordStatus} ${linkStatusTone(ref.cachedStatus)}`}>
                {externalStatusLabel(ref.cachedStatus) ?? '—'}
              </span>
              {ref.syncedAt ? <span>Cập nhật {formatDate(ref.syncedAt.slice(0, 10))}</span> : null}
            </div>
            {canUnlinkRefs && onUnlinkRef ? (
              <Confirm
                title="Bạn có chắc chắn muốn gỡ liên kết hồ sơ này?"
                description="Chỉ bỏ con trỏ ở Workspace. Hồ sơ bên module gốc vẫn giữ nguyên."
                okText="Gỡ liên kết"
                okType="danger"
                onConfirm={() => onUnlinkRef(selected.id, ref.id)}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className={`${styles.linkRecordAction} text-destructive hover:bg-destructive/10 hover:text-destructive`}
                >
                  Gỡ liên kết
                </Button>
              </Confirm>
            ) : null}
          </li>
        ))}
      </ul>
      {procedureSteps}
    </section>
  ) : null;

  if (selected) {
    const dependencyCount = dependencies.filter((edge) => edge.successorId === selected.id).length;
    const countBadge = (count: number | undefined) =>
      count === undefined ? null : (
        <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[11px]">
          {count}
        </Badge>
      );
    return (
      <Tabs
        className={styles.itemTabs}
        // Tab đã lưu mà nơi gọi không có (vd Liên quan khi công ty không có loại hồ sơ nào): về Trao đổi nếu có, không
        // thì Chi tiết.
        value={
          tab === 'chat' && !renderChat
            ? 'detail'
            : tab === 'related' && !renderRelated
              ? renderChat
                ? 'chat'
                : 'detail'
              : tab
        }
        onValueChange={(value) => {
          setTab(value as OverviewTab);
          rememberTab(selected.id, value as OverviewTab);
        }}
      >
        <TabsList aria-label="Thông tin phụ của công việc">
          {/* Trao đổi đứng đầu và mở sẵn: đó là việc làm hằng ngày trên một công việc, các tab sau là tra cứu. */}
          {renderChat ? (
            <TabsTrigger value="chat">Trao đổi {chatUnread > 0 ? countBadge(chatUnread) : null}</TabsTrigger>
          ) : null}
          <TabsTrigger value="detail">Chi tiết</TabsTrigger>
          <TabsTrigger value="progress">Lịch sử tiến độ {countBadge(progressCount)}</TabsTrigger>
          <TabsTrigger value="dependencies">Phụ thuộc {countBadge(dependencyCount)}</TabsTrigger>
          <TabsTrigger value="documents">Tài liệu {countBadge(documentCount)}</TabsTrigger>
          {renderRelated ? (
            <TabsTrigger value="related">Liên quan {countBadge(relatedCount)}</TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="detail" className={styles.itemTabBody}>
          {quantityBlock}
          {detailBody}
          {linksBody}
        </TabsContent>
        {renderChat ? (
          <TabsContent value="chat" className={styles.itemTabBody}>
            {renderChat()}
          </TabsContent>
        ) : null}
        {/* Giữ dựng khi ẩn để số đếm trên tab có ngay mà không phải mở từng tab. */}
        <TabsContent value="progress" keepMounted className={styles.itemTabBody}>
          <ProgressHistoryPanel item={selected} bare onCount={setProgressCount} />
        </TabsContent>
        <TabsContent value="dependencies" className={styles.itemTabBody}>
          <DependencyPanel
            selected={selected}
            items={items}
            dependencies={dependencies}
            canEdit={canEditDependencies}
            onAdd={onAddDependency}
            onRemove={onRemoveDependency}
            bare
          />
        </TabsContent>
        <TabsContent value="documents" keepMounted className={styles.itemTabBody}>
          {renderDocuments?.(setDocumentCount)}
        </TabsContent>
        {/* Không dựng sẵn khi ẩn: danh sách đọc thông tin từ nơi khác, chỉ tải khi người dùng mở tab. */}
        {renderRelated ? (
          <TabsContent value="related" className={styles.itemTabBody}>
            {renderRelated(setRelatedCount)}
          </TabsContent>
        ) : null}
      </Tabs>
    );
  }

  return (
    <div className={styles.tabBody}>
      <section className={styles.panel}>
        <h3>Chi tiết</h3>
        {detailBody}
      </section>

      <section className={styles.panel}>
        <h3 className={styles.panelHeadRow}>
          Thành viên dự án
          {canManageMembers && onManageMembers ? (
            <Button type="button" variant="ghost" size="xs" onClick={onManageMembers}>
              Quản lý thành viên
            </Button>
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
                  <span className={styles.memberRole}>{projectRoles.labelOf(member.role)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Phương tiện di chuyển của công việc (cột phải của phần Chi tiết); không có thì không hiện gì. */
function TransportCard({ summary }: { summary: TransportSummary | null }) {
  if (!summary) return null;
  const { transport } = summary;
  if (transport.mode === 'EXTERNAL') {
    return (
      <div className={`${styles.transportCard} ${styles.transportExternal}`}>
        <div className={styles.transportHead}>
          <div className={styles.transportTitle}>
            <small>Phương tiện</small>
            <strong>Tự sắp xếp{transport.detail ? ` · ${transport.detail}` : ''}</strong>
          </div>
        </div>
      </div>
    );
  }
  const tone =
    transport.status === 'CONFIRMED' ? styles.toneOk : transport.status === 'CONFLICT' ? styles.toneBad : styles.toneWait;
  const statusText =
    transport.status === 'CONFIRMED' ? 'Đã giữ xe' : transport.status === 'CONFLICT' ? 'Bị trùng lịch' : 'Chờ HRM giữ xe';
  return (
    <div className={styles.transportCard}>
      <div className={styles.transportHead}>
        <div className={styles.transportTitle}>
          <small>Xe công ty</small>
          <strong>{summary.vehicleLabel ?? 'Chưa rõ xe'}</strong>
        </div>
        <span className={`${styles.transportStatus} ${tone}`}>{statusText}</span>
      </div>
      <div className={styles.transportChips}>
        <span className={styles.transportChip}>
          <UserRound size={14} aria-hidden />
          {summary.driverLabel ?? 'Chưa rõ tài xế'}
        </span>
        <span className={styles.transportChip}>
          <CalendarClock size={14} aria-hidden />
          {timeRange(transport.startAt, transport.endAt)}
        </span>
        {transport.destination ? (
          <span className={styles.transportChip}>
            <MapPin size={14} aria-hidden />
            {transport.destination}
          </span>
        ) : null}
      </div>
      {transport.status === 'CONFLICT' ? (
        <p className={styles.transportWarn}>
          {transport.statusReason ?? 'Xe đã có người đặt trước.'} Hãy sửa công việc để chọn xe hoặc giờ khác.
        </p>
      ) : null}
    </div>
  );
}

function timeRange(start?: string | null, end?: string | null): string {
  if (!start || !end) return '—';
  const text = (iso: string) =>
    new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${text(start)} → ${text(end)}`;
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Màu chip trạng thái của hồ sơ liên kết: xong là xanh lá, hỏng/huỷ là đỏ, còn lại (đang chạy, đang mở) là xanh dương. */
function linkStatusTone(status: string | undefined | null): string {
  if (status === 'completed') return styles.linkStatusOk;
  if (status === 'rejected' || status === 'cancelled' || status === 'reversed' || status === 'start_rejected') {
    return styles.linkStatusBad;
  }
  return styles.linkStatusRun;
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
  bare = false,
}: {
  selected: WorkItem;
  items: readonly WorkItem[];
  dependencies: readonly WorkItemDependency[];
  canEdit: boolean;
  onAdd?: TabOverviewProps['onAddDependency'];
  onRemove?: TabOverviewProps['onRemoveDependency'];
  /** Không vẽ thẻ và tiêu đề: nằm trong tab đã có tên, và luôn hiện (kể cả khi trống) để tab không rỗng. */
  bare?: boolean;
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

  if (!bare && !editable && incoming.length === 0) return null;

  const Wrapper = bare ? 'div' : 'section';
  return (
    <Wrapper className={bare ? undefined : styles.panel}>
      {bare ? null : <h3>Phụ thuộc — việc phải đi trước</h3>}
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
                  {predecessor ? ` — ${workItemStatusLabel(predecessor)}` : ''}
                </span>
                <span className={styles.memberRole}>
                  {DEPENDENCY_TYPE_LABELS[edge.dependencyType]}
                  {edge.lagDays ? ` · trễ ${edge.lagDays} ngày` : ''}
                  {editable && onRemove ? (
                    <>
                      {' · '}
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={busy}
                        onClick={() => void guard(() => onRemove(selected.id, edge.id))}
                      >
                        Gỡ
                      </Button>
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
          <Tooltip content="Độ trễ (ngày), được âm">
            <Input
              aria-label="Độ trễ (ngày)"
              inputMode="numeric"
              value={lag}
              onChange={(event) => setLag(event.target.value)}
            />
          </Tooltip>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !predecessorId}
            onClick={add}
          >
            Thêm
          </Button>
        </div>
      ) : null}
      <ErrorToast message={error} />
    </Wrapper>
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
