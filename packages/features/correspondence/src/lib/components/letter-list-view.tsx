'use client';

import type { LetterBox, LetterStage, LetterSummary } from '@enterprise-platform/contracts-correspondence';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage, listLetters } from '../correspondence-api';
import { matchesSearch } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { LetterTable, type LetterTableMode } from './letter-table';

const STAGE_FILTERS: readonly { readonly value: LetterStage | 'all'; readonly label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'received', label: 'Tiếp nhận' },
  { value: 'registered', label: 'Chờ trình' },
  { value: 'reviewing', label: 'Đang duyệt' },
  { value: 'directing', label: 'Chờ chỉ đạo' },
  { value: 'processing', label: 'Phòng ban xử lý' },
  { value: 'publishing', label: 'Chờ phát hành' },
  { value: 'closing', label: 'Chờ lưu trữ' },
  { value: 'archived', label: 'Đã lưu trữ' },
  { value: 'cancelled', label: 'Đã huỷ' },
];

const EMPTY: Readonly<Record<LetterBox, string>> = {
  all: 'Chưa có công văn nào ở mục này. Chọn bộ lọc khác hoặc tiếp nhận công văn mới.',
  mine: 'Không có công văn nào đang chờ bạn xử lý.',
  outgoing: 'Chưa có công văn đi nào được phát hành.',
  archive: 'Chưa có hồ sơ nào được lưu trữ.',
};

/**
 * Danh sách công văn của một hộp: công văn đến (lọc theo bước), việc của tôi, công
 * văn đi, kho lưu trữ. Tìm kiếm lọc ngay trên danh sách đã tải (gõ không dấu được).
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

  useEffect(() => {
    let active = true;
    listLetters({ box, stage: box === 'all' ? stage : undefined })
      .then((items) => {
        if (!active) return;
        setLetters(items);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được danh sách công văn.')));
    return () => {
      active = false;
    };
  }, [box, stage, refreshKey]);

  const visible = useMemo(() => (letters ?? []).filter((letter) => matchesSearch(letter, search)), [letters, search]);
  const mode: LetterTableMode = box === 'outgoing' ? 'outgoing' : box === 'archive' ? 'archive' : 'incoming';

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        {box === 'all'
          ? STAGE_FILTERS.map((filter) => {
              const on = (stage ?? 'all') === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                  aria-pressed={on}
                  onClick={() => onStageChange?.(filter.value === 'all' ? undefined : filter.value)}
                >
                  {filter.label}
                </button>
              );
            })
          : null}
        <input
          className={styles.search}
          type="search"
          value={search}
          placeholder="Tìm theo số đến, số đi, trích yếu, cơ quan gửi"
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
