'use client';

import type { LetterDirection, LetterSummary } from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { FileSpreadsheet, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, loadLedger } from '../correspondence-api';
import { matchesSearch } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { downloadLedger, LEDGER_COLUMNS, ledgerDate } from '../ledger';

/** Cột STT (số dòng) như cột tiêu đề hàng của Excel; độ rộng cột theo số ký tự của cột (px). */
const STT_WIDTH = 48;
const columnWidth = (chars: number) => Math.round(chars * 7.2);

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
  // Thu phóng như Excel: mặc định vừa khung (mọi cột trong một màn hình), hay một mức cố định.
  const natural = STT_WIDTH + columns.reduce((sum, column) => sum + columnWidth(column.width), 0);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [frame, setFrame] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const measure = () => setFrame(element.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [letters]);
  const fit = frame > 0 ? Math.min(1, Math.max(0.5, (frame - 2) / natural)) : 1;
  const scale = zoom === 'fit' ? fit : zoom;
  const step = (delta: number) => setZoom(Math.round(Math.min(1.5, Math.max(0.5, scale + delta)) * 10) / 10);

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
        <div className={styles.zoomBar} role="group" aria-label="Thu phóng">
          <button type="button" className={styles.iconButton} aria-label="Thu nhỏ" disabled={scale <= 0.5} onClick={() => step(-0.1)}>
            <ZoomOut size={15} />
          </button>
          <span className={styles.zoomValue}>{Math.round(scale * 100)}%</span>
          <button type="button" className={styles.iconButton} aria-label="Phóng to" disabled={scale >= 1.5} onClick={() => step(0.1)}>
            <ZoomIn size={15} />
          </button>
          <button type="button" className={zoom === 'fit' ? `${styles.chip} ${styles.chipOn}` : styles.chip} aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>
            <Maximize2 size={13} /> Vừa khung
          </button>
          <button type="button" className={zoom === 1 ? `${styles.chip} ${styles.chipOn}` : styles.chip} aria-pressed={zoom === 1} onClick={() => setZoom(1)}>
            100%
          </button>
        </div>
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
      <div ref={wrapRef} className={styles.ledgerWrap}>
        {!letters ? (
          error ? null : <div className={styles.empty}>Đang tải…</div>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>{search || month ? 'Không có công văn nào khớp bộ lọc.' : `Chưa có công văn ${direction === 'incoming' ? 'đến' : 'đi'} nào trong năm ${year}.`}</div>
        ) : (
          <table className={styles.ledger} aria-label={title} style={{ width: natural, zoom: scale }}>
            <colgroup>
              <col style={{ width: STT_WIDTH }} />
              {columns.map((column) => (
                <col key={column.id} style={{ width: columnWidth(column.width) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={styles.ledgerIndex}>STT</th>
                {columns.map((column) => (
                  <th key={column.id}>{column.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((letter, index) => (
                <tr
                  key={letter.id}
                  tabIndex={0}
                  onClick={() => onOpen(letter.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onOpen(letter.id);
                  }}
                >
                  <td className={styles.ledgerIndex}>{index + 1}</td>
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
