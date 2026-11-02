'use client';

import {
  type OpportunityBoard,
  type OpportunitySummary,
  type Pipeline,
  type StageRef,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, formatDate, toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { KeysetPager, StatusPill } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import { useKeysetPage } from '../components/use-keyset-page';
import { changeOpportunityStage, errorMessage, listOpportunities, loadBoard } from '../crm-api';
import { peopleOptions, useCanWrite, useCrm } from '../crm-context';
import {
  canDropStage,
  defaultPipeline,
  describeStageError,
  findStage,
  formatMoney,
  groupByCustomer,
  isClosedStage,
  moveCard,
  personName,
  replaceCard,
  stageFilterOptions,
  stageNeedsReason,
  stageTone,
} from '../sales.model';
import styles from '../sales.module.scss';
import { MyStageTasks } from './my-stage-tasks';
import { LostReasonDialog, OpportunityDrawer, OpportunityFormDialog } from './opportunity-dialogs';
import { usePipelines } from './use-pipelines';

type Mode = 'board' | 'table' | 'customers';

/**
 * Cơ hội dạng kanban (kéo thả đổi giai đoạn) và dạng bảng (lọc giai đoạn,
 * người phụ trách). Kéo thả gọi API chuyển giai đoạn; lỗi thì thẻ về chỗ cũ.
 * Cột kanban lấy từ giai đoạn của luồng đang chọn; chỉ thả được vào giai đoạn
 * là bước chuyển cấu hình của luồng. Thả vào giai đoạn cần lý do (Thua) mở hộp
 * nhập lý do trước khi gọi API. Lỗi thiếu điều kiện chuyển được liệt kê bằng tiếng Việt.
 */
export function OpportunitiesPage({
  focusId,
  onFocus,
  onOpenCustomer,
  onOpenQuote,
}: {
  focusId?: string;
  onFocus: (id: string | undefined) => void;
  onOpenCustomer: (id: string) => void;
  onOpenQuote: (id: string) => void;
}) {
  const { people } = useCrm();
  const canWrite = useCanWrite();
  const [mode, setMode] = useState<Mode>('board');
  const [search, setSearch] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [stage, setStage] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const { pipelines } = usePipelines();
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const q = useDebounced(search.trim(), 350);
  // Kanban luôn cần một luồng: chưa chọn thì dùng luồng mặc định.
  const boardPipeline: Pipeline | undefined = pipelines.find((item) => item.id === pipelineId) ?? defaultPipeline(pipelines);
  const pipelineOptions = pipelines.map((item) => ({ value: item.id, label: item.name }));

  return (
    <div className={styles.page}>
      <MyStageTasks refresh={refresh} onOpen={onFocus} />
      <div className={styles.toolbar}>
        <div className={styles.segmented} role="tablist" aria-label="Cách xem">
          <button type="button" role="tab" aria-selected={mode === 'board'} className={mode === 'board' ? styles.segmentActive : styles.segment} onClick={() => setMode('board')}>
            Kanban
          </button>
          <button type="button" role="tab" aria-selected={mode === 'table'} className={mode === 'table' ? styles.segmentActive : styles.segment} onClick={() => setMode('table')}>
            Dạng bảng
          </button>
          <button type="button" role="tab" aria-selected={mode === 'customers'} className={mode === 'customers' ? styles.segmentActive : styles.segment} onClick={() => setMode('customers')}>
            Theo khách hàng
          </button>
        </div>
        {canWrite ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setCreating(true)}>
            <Plus size={14} /> Thêm dự án bán hàng
          </button>
        ) : null}
        <input className={`${styles.input} ${styles.search}`} type="search" placeholder="Tìm theo tên dự án bán hàng…" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} />
        <SearchableSelect className={styles.filter} options={peopleOptions(people)} value={ownerUserId} placeholder="Mọi người phụ trách" clearable onChange={setOwnerUserId} />
        {pipelines.length > 1 ? (
          <SearchableSelect
            className={styles.filter}
            options={pipelineOptions}
            value={mode === 'board' ? (boardPipeline?.id ?? '') : pipelineId}
            placeholder="Mọi luồng"
            clearable={mode !== 'board'}
            onChange={(value) => {
              setPipelineId(value);
              setStage('');
            }}
          />
        ) : null}
        {mode !== 'board' ? (
          <SearchableSelect className={styles.filter} options={stageFilterOptions(pipelines, pipelineId)} value={stage} placeholder="Mọi giai đoạn" clearable onChange={setStage} />
        ) : null}
      </div>
      {mode === 'board' ? (
        <OpportunityKanban q={q} ownerUserId={ownerUserId} pipeline={boardPipeline} refresh={refresh} onOpen={onFocus} />
      ) : mode === 'customers' ? (
        <OpportunitiesByCustomer q={q} ownerUserId={ownerUserId} stage={stage} pipelineId={pipelineId} refresh={refresh} onOpen={onFocus} onOpenCustomer={onOpenCustomer} />
      ) : (
        <OpportunityTable q={q} ownerUserId={ownerUserId} stage={stage} pipelineId={pipelineId} refresh={refresh} onOpen={onFocus} />
      )}
      {creating ? (
        <OpportunityFormDialog
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            setRefresh((value) => value + 1);
            onFocus(saved.id);
          }}
        />
      ) : null}
      {focusId ? (
        <OpportunityDrawer
          opportunityId={focusId}
          onClose={() => onFocus(undefined)}
          onChanged={() => setRefresh((value) => value + 1)}
          onOpenCustomer={onOpenCustomer}
          onOpenQuote={onOpenQuote}
        />
      ) : null}
    </div>
  );
}

function OpportunityTable({
  q,
  ownerUserId,
  stage,
  pipelineId,
  refresh,
  onOpen,
}: {
  q: string;
  ownerUserId: string;
  stage: string;
  pipelineId: string;
  refresh: number;
  onOpen: (id: string) => void;
}) {
  const { people } = useCrm();
  const list = useKeysetPage(JSON.stringify({ q, ownerUserId, stage, pipelineId, refresh }), (cursor) =>
    listOpportunities({ q, ownerUserId, stage: stage || undefined, pipelineId: pipelineId || undefined, cursor, limit: 30 }),
  );
  const columns = useMemo<ColumnsType<OpportunitySummary>>(
    () => [
      { title: 'Dự án bán hàng', dataIndex: 'name', ellipsis: true },
      { title: 'Khách hàng', key: 'customer', width: 220, ellipsis: true, render: (_: unknown, row) => `${row.customerCode} - ${row.customerName}` },
      {
        title: 'Luồng',
        key: 'pipeline',
        width: 150,
        ellipsis: true,
        render: (_: unknown, row) => row.pipeline.name,
      },
      {
        title: 'Giai đoạn',
        key: 'stage',
        width: 150,
        render: (_: unknown, row) => <StatusPill tone={stageTone(row.stageInfo.semantic)}>{row.stageInfo.name}</StatusPill>,
      },
      { title: 'Xác suất', dataIndex: 'probability', width: 90, align: 'right', render: (value: number) => `${value}%` },
      { title: 'Giá trị dự kiến', dataIndex: 'expectedValue', width: 150, align: 'right', render: (value: number | null) => formatMoney(value) },
      { title: 'Ngày chốt', dataIndex: 'expectedCloseDate', width: 110, render: (value: string | null) => formatDate(value) },
      { title: 'Người phụ trách', dataIndex: 'ownerUserId', width: 160, ellipsis: true, render: (value: string) => personName(people, value) },
      {
        title: '',
        key: 'actions',
        width: 70,
        render: (_: unknown, row) => (
          <button type="button" className={styles.rowAction} onClick={() => onOpen(row.id)}>
            Xem
          </button>
        ),
      },
    ],
    [people, onOpen],
  );
  return (
    <section className={styles.tableCard}>
      {list.error ? <p className={styles.alert}>{list.error}</p> : null}
      <Table<OpportunitySummary>
        size="small"
        rowKey="id"
        loading={list.loading}
        columns={columns}
        dataSource={[...list.items]}
        pagination={false}
        scroll={{ x: 1100 }}
        onRow={(row) => ({ onDoubleClick: () => onOpen(row.id) })}
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Không có dự án bán hàng nào.' }}
      />
      <KeysetPager page={list.page} count={list.items.length} hasNext={list.hasNext} loading={list.loading} noun="dự án bán hàng" onPrevious={list.previous} onNext={list.next} />
    </section>
  );
}

/**
 * Dự án nhóm theo khách hàng: mỗi khách một dòng (số dự án, tổng giá trị dự kiến) mở rộng/thu gọn
 * ra danh sách dự án. Dữ liệu là trang hiện tại của danh sách (tối đa 100 dự án mỗi trang), nên số
 * và tổng là của các dự án đang tải; phạm vi dữ liệu do server quyết định.
 */
function OpportunitiesByCustomer({
  q,
  ownerUserId,
  stage,
  pipelineId,
  refresh,
  onOpen,
  onOpenCustomer,
}: {
  q: string;
  ownerUserId: string;
  stage: string;
  pipelineId: string;
  refresh: number;
  onOpen: (id: string) => void;
  onOpenCustomer: (id: string) => void;
}) {
  const { people } = useCrm();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const list = useKeysetPage(JSON.stringify({ q, ownerUserId, stage, pipelineId, refresh, grouped: true }), (cursor) =>
    listOpportunities({ q, ownerUserId, stage: stage || undefined, pipelineId: pipelineId || undefined, cursor, limit: 100 }),
  );
  const groups = useMemo(() => groupByCustomer(list.items), [list.items]);
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className={styles.tableCard}>
      {list.error ? <p className={styles.alert}>{list.error}</p> : null}
      {!groups.length ? <p className={styles.muted}>{list.loading ? 'Đang tải…' : 'Không có dự án bán hàng nào.'}</p> : null}
      {groups.map((group) => {
        const open = !collapsed.has(group.customerId);
        return (
          <div key={group.customerId}>
            <div className={styles.toolbar}>
              <button type="button" className={styles.buttonGhost} aria-expanded={open} onClick={() => toggle(group.customerId)}>
                {open ? '−' : '+'} {group.customerCode} - {group.customerName}
              </button>
              <span className={styles.muted}>
                {group.count} dự án · {formatMoney(group.totalValue) || formatMoney(0)}
              </span>
              <button type="button" className={styles.rowAction} onClick={() => onOpenCustomer(group.customerId)}>
                Hồ sơ khách
              </button>
            </div>
            {open ? (
              <Table<OpportunitySummary>
                size="small"
                rowKey="id"
                showHeader={false}
                pagination={false}
                dataSource={[...group.items]}
                columns={[
                  { title: 'Dự án bán hàng', dataIndex: 'name', ellipsis: true },
                  { title: 'Giai đoạn', key: 'stage', width: 150, render: (_: unknown, row) => <StatusPill tone={stageTone(row.stageInfo.semantic)}>{row.stageInfo.name}</StatusPill> },
                  { title: 'Giá trị dự kiến', dataIndex: 'expectedValue', width: 150, align: 'right', render: (value: number | null) => formatMoney(value) },
                  { title: 'Người phụ trách', dataIndex: 'ownerUserId', width: 160, ellipsis: true, render: (value: string) => personName(people, value) },
                  {
                    title: '',
                    key: 'actions',
                    width: 70,
                    render: (_: unknown, row) => (
                      <button type="button" className={styles.rowAction} onClick={() => onOpen(row.id)}>
                        Xem
                      </button>
                    ),
                  },
                ]}
              />
            ) : null}
          </div>
        );
      })}
      <KeysetPager page={list.page} count={list.items.length} hasNext={list.hasNext} loading={list.loading} noun="dự án bán hàng" onPrevious={list.previous} onNext={list.next} />
    </section>
  );
}

function stageRef(board: OpportunityBoard, code: string): StageRef | undefined {
  return board.columns.find((column) => column.stage === code)?.stageInfo;
}

function OpportunityKanban({
  q,
  ownerUserId,
  pipeline,
  refresh,
  onOpen,
}: {
  q: string;
  ownerUserId: string;
  pipeline: Pipeline | undefined;
  refresh: number;
  onOpen: (id: string) => void;
}) {
  const { people } = useCrm();
  const canWrite = useCanWrite();
  const [board, setBoard] = useState<OpportunityBoard>();
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState<{ id: string; from: string }>();
  const [over, setOver] = useState<string>();
  const [pendingLost, setPendingLost] = useState<{ card: OpportunitySummary; to: string }>();

  const pipelineId = pipeline?.id;
  const load = useCallback(() => {
    if (!pipelineId) return;
    loadBoard({ q: q || undefined, ownerUserId: ownerUserId || undefined, pipelineId })
      .then((next) => {
        setBoard(next);
        setError(undefined);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được kanban dự án bán hàng.')));
  }, [q, ownerUserId, pipelineId]);

  useEffect(() => load(), [load, refresh]);

  /** Chuyển lạc quan rồi gọi API; lỗi thì trả bảng cũ (thẻ về cột cũ). */
  async function move(card: OpportunitySummary, to: string, reason?: string) {
    if (!board) return;
    const moved = moveCard(board, card.id, to);
    if (!moved) return;
    const previous = board;
    setBoard(moved.board);
    try {
      const saved = await changeOpportunityStage(card.id, { stage: to, reason, version: card.version });
      setBoard((current) => (current ? replaceCard(current, saved) : current));
    } catch (cause) {
      setBoard(previous);
      throw cause;
    }
  }

  function onDrop(event: DragEvent, to: string) {
    event.preventDefault();
    setOver(undefined);
    const current = dragging;
    setDragging(undefined);
    if (!board || !current || !canDropStage(pipeline, current.from, to)) return;
    const card = board.columns.find((column) => column.stage === current.from)?.items.find((item) => item.id === current.id);
    if (!card) return;
    if (stageNeedsReason(findStage(pipeline, to))) return setPendingLost({ card, to });
    move(card, to).catch((cause) => toast.error(describeStageError(cause, 'Không chuyển được giai đoạn.')));
  }

  if (error) return <p className={styles.alert}>{error}</p>;
  if (!pipeline) return <p className={styles.muted}>Chưa có luồng bán hàng nào.</p>;
  if (!board || board.pipeline.id !== pipeline.id) return <p className={styles.muted}>Đang tải…</p>;

  return (
    <div className={styles.kanban}>
      {board.columns.map((column) => {
        const droppable = dragging ? canDropStage(pipeline, dragging.from, column.stage) : false;
        const className = [
          styles.kanbanColumn,
          dragging && droppable ? styles.kanbanDroppable : '',
          dragging && !droppable && dragging.from !== column.stage ? styles.kanbanBlocked : '',
          over === column.stage && droppable ? styles.kanbanOver : '',
        ].join(' ');
        return (
          <section
            key={column.stageInfo.id}
            className={className}
            aria-label={column.stageInfo.name}
            onDragOver={(event) => {
              if (!droppable) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setOver(column.stage);
            }}
            onDragLeave={() => setOver((current) => (current === column.stage ? undefined : current))}
            onDrop={(event) => onDrop(event, column.stage)}
          >
            <header className={styles.kanbanHead}>
              <strong>{column.stageInfo.name}</strong>
              <span className={styles.muted}>
                {column.total} · {formatMoney(column.totalValue)}
              </span>
            </header>
            <div className={styles.kanbanCards}>
              {column.items.map((card) => (
                <article
                  key={card.id}
                  className={styles.kanbanCard}
                  draggable={canWrite && !isClosedStage(column.stageInfo)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', card.id);
                    setDragging({ id: card.id, from: column.stage });
                  }}
                  onDragEnd={() => {
                    setDragging(undefined);
                    setOver(undefined);
                  }}
                  onClick={() => onOpen(card.id)}
                  onKeyDown={(event) => event.key === 'Enter' && onOpen(card.id)}
                  tabIndex={0}
                >
                  <strong>{card.name}</strong>
                  <span className={styles.muted}>{card.customerName}</span>
                  <span className={styles.kanbanMeta}>
                    <span>{formatMoney(card.expectedValue)}</span>
                    <span>{card.probability}%</span>
                  </span>
                  <span className={styles.kanbanOwner}>{personName(people, card.ownerUserId)}</span>
                </article>
              ))}
              {column.total > column.items.length ? (
                <p className={styles.muted}>Còn {column.total - column.items.length} dự án bán hàng, xem ở dạng bảng.</p>
              ) : null}
            </div>
          </section>
        );
      })}
      {pendingLost ? (
        <LostReasonDialog
          name={pendingLost.card.name}
          stage={stageRef(board, pendingLost.to)}
          onClose={() => setPendingLost(undefined)}
          onConfirm={async (reason) => {
            await move(pendingLost.card, pendingLost.to, reason);
            setPendingLost(undefined);
          }}
        />
      ) : null}
    </div>
  );
}
