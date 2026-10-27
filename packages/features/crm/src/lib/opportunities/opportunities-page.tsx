'use client';

import {
  OPPORTUNITY_STAGE_LABELS,
  type OpportunityBoard,
  type OpportunityStage,
  type OpportunitySummary,
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
import { labelOptions, peopleOptions, useCanWrite, useCrm } from '../crm-context';
import { canDropStage, formatMoney, moveCard, personName, replaceCard } from '../sales.model';
import styles from '../sales.module.scss';
import { LostReasonDialog, OpportunityDrawer, OpportunityFormDialog } from './opportunity-dialogs';

type Mode = 'board' | 'table';

/**
 * Cơ hội dạng kanban (kéo thả đổi giai đoạn) và dạng bảng (lọc giai đoạn,
 * người phụ trách). Kéo thả gọi API chuyển giai đoạn; lỗi thì thẻ về chỗ cũ.
 * Thả vào cột Thua mở hộp nhập lý do trước khi gọi API.
 */
export function OpportunitiesPage({
  focusId,
  onFocus,
  onOpenCustomer,
}: {
  focusId?: string;
  onFocus: (id: string | undefined) => void;
  onOpenCustomer: (id: string) => void;
}) {
  const { people } = useCrm();
  const canWrite = useCanWrite();
  const [mode, setMode] = useState<Mode>('board');
  const [search, setSearch] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [stage, setStage] = useState('');
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const q = useDebounced(search.trim(), 350);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.segmented} role="tablist" aria-label="Cách xem">
          <button type="button" role="tab" aria-selected={mode === 'board'} className={mode === 'board' ? styles.segmentActive : styles.segment} onClick={() => setMode('board')}>
            Kanban
          </button>
          <button type="button" role="tab" aria-selected={mode === 'table'} className={mode === 'table' ? styles.segmentActive : styles.segment} onClick={() => setMode('table')}>
            Dạng bảng
          </button>
        </div>
        {canWrite ? (
          <button type="button" className={styles.buttonPrimary} onClick={() => setCreating(true)}>
            <Plus size={14} /> Thêm cơ hội
          </button>
        ) : null}
        <input className={`${styles.input} ${styles.search}`} type="search" placeholder="Tìm theo tên cơ hội…" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} />
        <SearchableSelect className={styles.filter} options={peopleOptions(people)} value={ownerUserId} placeholder="Mọi người phụ trách" clearable onChange={setOwnerUserId} />
        {mode === 'table' ? (
          <SearchableSelect className={styles.filter} options={labelOptions(OPPORTUNITY_STAGE_LABELS)} value={stage} placeholder="Mọi giai đoạn" clearable onChange={setStage} />
        ) : null}
      </div>
      {mode === 'board' ? (
        <OpportunityKanban q={q} ownerUserId={ownerUserId} refresh={refresh} onOpen={onFocus} />
      ) : (
        <OpportunityTable q={q} ownerUserId={ownerUserId} stage={stage} refresh={refresh} onOpen={onFocus} />
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
        />
      ) : null}
    </div>
  );
}

function OpportunityTable({
  q,
  ownerUserId,
  stage,
  refresh,
  onOpen,
}: {
  q: string;
  ownerUserId: string;
  stage: string;
  refresh: number;
  onOpen: (id: string) => void;
}) {
  const { people } = useCrm();
  const list = useKeysetPage(JSON.stringify({ q, ownerUserId, stage, refresh }), (cursor) =>
    listOpportunities({ q, ownerUserId, stage: (stage || undefined) as OpportunityStage | undefined, cursor, limit: 30 }),
  );
  const columns = useMemo<ColumnsType<OpportunitySummary>>(
    () => [
      { title: 'Cơ hội', dataIndex: 'name', ellipsis: true },
      { title: 'Khách hàng', key: 'customer', width: 220, ellipsis: true, render: (_: unknown, row) => `${row.customerCode} - ${row.customerName}` },
      {
        title: 'Giai đoạn',
        dataIndex: 'stage',
        width: 150,
        render: (value: OpportunityStage) => (
          <StatusPill tone={value === 'WON' ? 'success' : value === 'LOST' ? 'danger' : 'info'}>{OPPORTUNITY_STAGE_LABELS[value]}</StatusPill>
        ),
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
        locale={{ emptyText: list.loading ? 'Đang tải…' : 'Không có cơ hội nào.' }}
      />
      <KeysetPager page={list.page} count={list.items.length} hasNext={list.hasNext} loading={list.loading} noun="cơ hội" onPrevious={list.previous} onNext={list.next} />
    </section>
  );
}

function OpportunityKanban({
  q,
  ownerUserId,
  refresh,
  onOpen,
}: {
  q: string;
  ownerUserId: string;
  refresh: number;
  onOpen: (id: string) => void;
}) {
  const { people } = useCrm();
  const canWrite = useCanWrite();
  const [board, setBoard] = useState<OpportunityBoard>();
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState<{ id: string; from: OpportunityStage }>();
  const [over, setOver] = useState<OpportunityStage>();
  const [pendingLost, setPendingLost] = useState<OpportunitySummary>();

  const load = useCallback(() => {
    loadBoard({ q: q || undefined, ownerUserId: ownerUserId || undefined })
      .then((next) => {
        setBoard(next);
        setError(undefined);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được kanban cơ hội.')));
  }, [q, ownerUserId]);

  useEffect(() => load(), [load, refresh]);

  /** Chuyển lạc quan rồi gọi API; lỗi thì trả bảng cũ (thẻ về cột cũ). */
  async function move(card: OpportunitySummary, to: OpportunityStage, reason?: string) {
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

  function onDrop(event: DragEvent, to: OpportunityStage) {
    event.preventDefault();
    setOver(undefined);
    const current = dragging;
    setDragging(undefined);
    if (!board || !current || !canDropStage(current.from, to)) return;
    const card = board.columns.find((column) => column.stage === current.from)?.items.find((item) => item.id === current.id);
    if (!card) return;
    if (to === 'LOST') return setPendingLost(card);
    move(card, to).catch((cause) => toast.error(errorMessage(cause, 'Không chuyển được giai đoạn.')));
  }

  if (error) return <p className={styles.alert}>{error}</p>;
  if (!board) return <p className={styles.muted}>Đang tải…</p>;

  return (
    <div className={styles.kanban}>
      {board.columns.map((column) => {
        const droppable = dragging ? canDropStage(dragging.from, column.stage) : false;
        const className = [
          styles.kanbanColumn,
          dragging && droppable ? styles.kanbanDroppable : '',
          dragging && !droppable && dragging.from !== column.stage ? styles.kanbanBlocked : '',
          over === column.stage && droppable ? styles.kanbanOver : '',
        ].join(' ');
        return (
          <section
            key={column.stage}
            className={className}
            aria-label={OPPORTUNITY_STAGE_LABELS[column.stage]}
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
              <strong>{OPPORTUNITY_STAGE_LABELS[column.stage]}</strong>
              <span className={styles.muted}>
                {column.total} · {formatMoney(column.totalValue)}
              </span>
            </header>
            <div className={styles.kanbanCards}>
              {column.items.map((card) => (
                <article
                  key={card.id}
                  className={styles.kanbanCard}
                  draggable={canWrite && column.stage !== 'WON' && column.stage !== 'LOST'}
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
                <p className={styles.muted}>Còn {column.total - column.items.length} cơ hội, xem ở dạng bảng.</p>
              ) : null}
            </div>
          </section>
        );
      })}
      {pendingLost ? (
        <LostReasonDialog
          name={pendingLost.name}
          onClose={() => setPendingLost(undefined)}
          onConfirm={async (reason) => {
            await move(pendingLost, 'LOST', reason);
            setPendingLost(undefined);
          }}
        />
      ) : null}
    </div>
  );
}
