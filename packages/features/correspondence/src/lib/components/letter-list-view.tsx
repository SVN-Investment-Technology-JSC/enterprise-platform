'use client';

import {
  DIRECTION_STAGES,
  LETTER_STAGE_LABELS,
  type LetterBox,
  type LetterStage,
  type LetterSummary,
} from '@enterprise-platform/contracts-correspondence';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage, listLetters } from '../correspondence-api';
import { matchesSearch } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { LetterTable, type LetterTableMode } from './letter-table';

const EMPTY: Readonly<Record<LetterBox, string>> = {
  incoming: 'Chưa có công văn đến nào ở mục này. Chọn bộ lọc khác hoặc tiếp nhận công văn mới.',
  outgoing: 'Chưa có công văn đi nào ở mục này. Chọn bộ lọc khác hoặc soạn công văn đi.',
  mine: 'Không có công văn nào đang chờ bạn xử lý.',
  archive: 'Chưa có hồ sơ nào được lưu trữ.',
};

/**
 * Danh sách công văn của một hộp: công văn đến, công văn đi (lọc theo bước của luồng), việc
 * của tôi. Tìm kiếm lọc ngay trên danh sách đã tải (gõ không dấu được).
 */
export function LetterListView({
  box,
  stage,
  today,
  refreshKey,
  activeId,
  onStageChange,
  onOpen,
}: {
  readonly box: LetterBox;
  readonly stage?: LetterStage;
  readonly today: string;
  /** Đổi giá trị để tải lại sau khi một công văn vừa đổi bước. */
  readonly refreshKey: number;
  readonly activeId?: string;
  readonly onStageChange?: (stage: LetterStage | undefined) => void;
  readonly onOpen: (letterId: string) => void;
}) {
  const [letters, setLetters] = useState<LetterSummary[]>();
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  const direction = box === 'incoming' || box === 'outgoing' ? box : undefined;
  const filters = direction ? [...DIRECTION_STAGES[direction], 'archived', 'cancelled'] as LetterStage[] : [];
  const activeStage = stage && filters.includes(stage) ? stage : undefined;

  useEffect(() => {
    let active = true;
    setLetters(undefined);
    listLetters({ box, stage: activeStage })
      .then((items) => {
        if (!active) return;
        setLetters(items);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được danh sách công văn.')));
    return () => {
      active = false;
    };
  }, [box, activeStage, refreshKey]);

  const visible = useMemo(() => (letters ?? []).filter((letter) => matchesSearch(letter, search)), [letters, search]);
  const mode: LetterTableMode = box === 'incoming' ? 'incoming' : box === 'outgoing' ? 'outgoing' : box === 'archive' ? 'archive' : 'mixed';

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        {direction
          ? [undefined, ...filters].map((value) => {
              const on = activeStage === value;
              return (
                <button
                  key={value ?? 'all'}
                  type="button"
                  className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                  aria-pressed={on}
                  onClick={() => onStageChange?.(value)}
                >
                  {value ? LETTER_STAGE_LABELS[value] : 'Tất cả'}
                </button>
              );
            })
          : null}
        <input
          className={styles.search}
          type="search"
          value={search}
          placeholder={box === 'outgoing' ? 'Tìm theo số, trích yếu, nơi nhận, phòng soạn' : 'Tìm theo số, trích yếu, cơ quan gửi'}
          aria-label="Tìm công văn"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {letters ? (
        <LetterTable
          letters={visible}
          mode={mode}
          today={today}
          activeId={activeId}
          emptyText={search ? 'Không có công văn nào khớp với từ tìm kiếm.' : EMPTY[box]}
          onOpen={onOpen}
        />
      ) : error ? null : (
        <div className={styles.tableWrap}>
          <div className={styles.empty}>Đang tải…</div>
        </div>
      )}
    </div>
  );
}
