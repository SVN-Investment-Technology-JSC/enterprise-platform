'use client';

import type {
  MaintenanceHistoryFilter,
  MaintenanceHistoryPage,
  MaintenanceOccurrence,
  MaintenanceOccurrenceKind,
  MaintenanceOccurrenceStatus,
} from '@enterprise-platform/contracts-maintenance';
import { useState } from 'react';
import styles from './maintenance-history.module.scss';

const KIND_LABEL: Record<MaintenanceOccurrenceKind, string> = {
  preventive: 'Định kỳ',
  incident: 'Sự cố',
};

const STATUS_LABEL: Record<MaintenanceOccurrenceStatus, string> = {
  planned: 'Đã lên lịch',
  in_progress: 'Đang xử lý',
  dispatch_pending: 'Chờ tạo phiếu',
  generated: 'Đã tạo phiếu',
  completed: 'Hoàn thành',
  failed: 'Thất bại',
  blocked: 'Bị chặn',
};

const dateOnly = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
});

/** Gom theo ngày đến hạn để đọc như một dòng thời gian (AC-HST-01). */
function groupByDay(items: readonly MaintenanceOccurrence[]) {
  const groups: { day: string; items: MaintenanceOccurrence[] }[] = [];
  for (const item of items) {
    const day = dateOnly.format(new Date(item.dueAt));
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

export function MaintenanceHistory({
  page,
  filter,
  busy,
  canManage,
  selected,
  onFilter,
  onLoadMore,
  onSelect,
  onComplete,
}: {
  page?: MaintenanceHistoryPage;
  filter: MaintenanceHistoryFilter;
  busy: boolean;
  canManage: boolean;
  selected?: MaintenanceOccurrence;
  onFilter: (next: MaintenanceHistoryFilter) => void;
  onLoadMore: () => void;
  onSelect: (occurrence?: MaintenanceOccurrence) => void;
  onComplete: (id: string, note: string) => void;
}) {
  const [note, setNote] = useState('');
  const items = page?.items ?? [];

  return (
    <section className={styles.history}>
      <header className={styles.head}>
        <div>
          <h2>Lịch sử bảo trì</h2>
          <p>
            Toàn bộ lần bảo trì đã thực hiện, gồm cả định kỳ theo lịch và sự cố đột xuất, sắp theo
            ngày giảm dần.
          </p>
        </div>
        {page ? (
          <div className={styles.stats}>
            <span>
              <strong>{page.stats.total}</strong> lần
            </span>
            <span>
              <strong>{page.stats.completed}</strong> hoàn thành
            </span>
            <span>
              <strong>{page.stats.onTimeRate}%</strong> đúng hạn
            </span>
          </div>
        ) : null}
      </header>

      <div className={styles.filters}>
        <label>
          Thiết bị
          <input
            placeholder="Mã thiết bị…"
            defaultValue={filter.assetCode ?? ''}
            onBlur={(event) => onFilter({ ...filter, assetCode: event.target.value, cursor: undefined })}
          />
        </label>
        <label>
          Loại
          <select
            value={filter.kind ?? ''}
            onChange={(event) =>
              onFilter({
                ...filter,
                kind: (event.target.value || undefined) as MaintenanceOccurrenceKind | undefined,
                cursor: undefined,
              })
            }
          >
            <option value="">Tất cả</option>
            <option value="preventive">Định kỳ</option>
            <option value="incident">Sự cố</option>
          </select>
        </label>
        <label>
          Trạng thái
          <select
            value={filter.status ?? ''}
            onChange={(event) =>
              onFilter({
                ...filter,
                status: (event.target.value || undefined) as MaintenanceOccurrenceStatus | undefined,
                cursor: undefined,
              })
            }
          >
            <option value="">Tất cả</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Từ ngày
          <input
            type="date"
            value={filter.from?.slice(0, 10) ?? ''}
            onChange={(event) =>
              onFilter({ ...filter, from: event.target.value || undefined, cursor: undefined })
            }
          />
        </label>
        <label>
          Đến ngày
          <input
            type="date"
            value={filter.to?.slice(0, 10) ?? ''}
            onChange={(event) =>
              onFilter({ ...filter, to: event.target.value || undefined, cursor: undefined })
            }
          />
        </label>
        <button type="button" className={styles.reset} onClick={() => onFilter({})}>
          Xoá lọc
        </button>
      </div>

      <div className={styles.layout}>
        <div className={styles.list}>
          {items.length === 0 ? (
            <p className={styles.empty}>
              {busy ? 'Đang tải…' : 'Không có lần bảo trì nào khớp bộ lọc.'}
            </p>
          ) : (
            groupByDay(items).map((group) => (
              <div key={group.day}>
                <div className={styles.day}>{group.day}</div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.row} ${item.id === selected?.id ? styles.rowOn : ''}`}
                    onClick={() => {
                      setNote('');
                      onSelect(item);
                    }}
                  >
                    <span className={`${styles.kind} ${styles[item.kind]}`}>
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span className={styles.rowMain}>
                      <strong>{item.title}</strong>
                      <small>{item.assetCode || '—'}</small>
                    </span>
                    <span className={`${styles.status} ${styles[`st_${item.status}`]}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                    <span className={styles.rowCode}>{item.procedureInstanceCode ?? '—'}</span>
                  </button>
                ))}
              </div>
            ))
          )}

          {page?.nextCursor ? (
            <button type="button" className={styles.more} disabled={busy} onClick={onLoadMore}>
              Xem thêm
            </button>
          ) : null}
        </div>

        {selected ? (
          <aside className={styles.detail}>
            <header>
              <span className={`${styles.kind} ${styles[selected.kind]}`}>
                {KIND_LABEL[selected.kind]}
              </span>
              <button type="button" className={styles.close} onClick={() => onSelect(undefined)}>
                ✕
              </button>
            </header>
            <h3>{selected.title}</h3>

            <dl className={styles.facts}>
              <div>
                <dt>Mã</dt>
                <dd>{selected.code ?? '—'}</dd>
              </div>
              <div>
                <dt>Thiết bị</dt>
                <dd>{selected.assetCode || '—'}</dd>
              </div>
              <div>
                <dt>Lịch</dt>
                <dd>{selected.scheduleTitle ?? 'Không theo lịch'}</dd>
              </div>
              <div>
                <dt>Ngày thực hiện</dt>
                <dd>{dateTime.format(new Date(selected.dueAt))}</dd>
              </div>
              <div>
                <dt>Ưu tiên</dt>
                <dd>{selected.priority}</dd>
              </div>
              <div>
                <dt>Trạng thái</dt>
                <dd>{STATUS_LABEL[selected.status]}</dd>
              </div>
              {selected.assigneeName ? (
                <div>
                  <dt>Người phụ trách</dt>
                  <dd>{selected.assigneeName}</dd>
                </div>
              ) : null}
            </dl>

            {selected.description ? (
              <p className={styles.description}>{selected.description}</p>
            ) : null}

            {selected.procedureInstanceCode ? (
              <a className={styles.link} href="/modules/procedure#workspace">
                Mở workorder {selected.procedureInstanceCode} →
              </a>
            ) : null}

            {selected.completedAt ? (
              <div className={styles.closeOut}>
                <h4>Kết quả</h4>
                <p>{selected.completionNote ?? 'Không có ghi chú.'}</p>
                <small>
                  Hoàn thành {dateTime.format(new Date(selected.completedAt))}
                  {selected.completedByName ? ` · ${selected.completedByName}` : ''}
                </small>
              </div>
            ) : canManage ? (
              <div className={styles.closeOut}>
                <h4>Ghi nhận kết quả</h4>
                <textarea
                  rows={3}
                  placeholder="Đã làm gì, kết quả đo đạc ra sao…"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => onComplete(selected.id, note)}
                >
                  Đánh dấu hoàn thành
                </button>
                <small>Đã đánh dấu hoàn thành thì không mở lại được.</small>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
