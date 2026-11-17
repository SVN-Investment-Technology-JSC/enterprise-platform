'use client';

import type { LetterDirection, LetterSummary } from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { FileSpreadsheet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage, loadLedger } from '../correspondence-api';
import { matchesSearch } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { downloadLedger, LEDGER_COLUMNS, ledgerDate } from '../ledger';

const MONTHS = Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1).padStart(2, '0'), label: `Tháng ${index + 1}` }));

/**
 * Sổ theo dõi công văn đến / đi của một năm, dạng bảng như văn thư vẫn ghi tay: mọi công văn tự vào sổ
 * theo số; lọc theo tháng, tìm nhanh, xuất Excel đúng các cột đang xem. Bấm một dòng để mở công văn.
 */
export function LedgerView({
  direction,
  year,
  refreshKey,
  onOpen,
}: {
  readonly direction: LetterDirection;
  readonly year: number;
  readonly refreshKey: number;
  readonly onOpen: (letterId: string) => void;
}) {
  const [letters, setLetters] = useState<LetterSummary[]>();
  const [error, setError] = useState<string>();
  const [month, setMonth] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    setLetters(undefined);
    loadLedger(direction, year)
      .then((items) => {
        if (!active) return;
        setLetters(items);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được sổ theo dõi công văn.')));
    return () => {
      active = false;
    };
  }, [direction, year, refreshKey]);

  const visible = useMemo(
    () =>
      (letters ?? [])
        .filter((letter) => !month || ledgerDate(letter).slice(5, 7) === month)
        .filter((letter) => matchesSearch(letter, search)),
    [letters, month, search],
  );
  const columns = LEDGER_COLUMNS[direction];
  const title = `Sổ công văn ${direction === 'incoming' ? 'đến' : 'đi'} năm ${year}`;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>{title}</h2>
        <span className={styles.muted}>{letters ? `${visible.length} công văn` : ''}</span>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.filterSelect}>
          <SearchableSelect options={MONTHS} value={month} placeholder="Cả năm" clearable searchInDropdown hideDropdownSearch onChange={(value) => setMonth(value ?? '')} />
        </div>
        <input
          className={styles.search}
          type="search"
          value={search}
          placeholder={direction === 'incoming' ? 'Tìm theo số, nội dung, đơn vị gửi' : 'Tìm theo số, nội dung, nơi nhận'}
          aria-label="Tìm trong sổ"
          onChange={(event) => setSearch(event.target.value)}
        />
        <button
          type="button"
          className={styles.buttonGhost}
          disabled={!letters || visible.length === 0}
          onClick={() =>
            void downloadLedger(direction, year, visible)
              .then((count) => toast.success(`Đã xuất ${count} công văn ra Excel.`))
              .catch((cause) => toast.error(errorMessage(cause, 'Không xuất được Excel.')))
          }
        >
          <FileSpreadsheet size={14} /> Xuất Excel
        </button>
      </div>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      <div className={styles.ledgerWrap}>
        {!letters ? (
          error ? null : <div className={styles.empty}>Đang tải…</div>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>{search || month ? 'Không có công văn nào khớp bộ lọc.' : `Chưa có công văn ${direction === 'incoming' ? 'đến' : 'đi'} nào trong năm ${year}.`}</div>
        ) : (
          <table className={styles.ledger} aria-label={title}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.id} style={{ minWidth: column.width * 7 }}>
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((letter) => (
                <tr
                  key={letter.id}
                  tabIndex={0}
                  onClick={() => onOpen(letter.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onOpen(letter.id);
                  }}
                >
                  {columns.map((column) =>
                    column.id === 'content' ? (
                      <td key={column.id}>
                        <span className={styles.ledgerKind}>{letter.kindName}</span>
                        <span className={letter.urgencyHighlight ? styles.ledgerUrgent : undefined}>{letter.subject}</span>
                      </td>
                    ) : (
                      <td key={column.id} className={column.center ? styles.ledgerCenter : undefined}>
                        {column.value(letter)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
