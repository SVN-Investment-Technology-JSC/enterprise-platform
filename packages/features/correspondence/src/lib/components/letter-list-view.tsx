'use client';

import {
  DIRECTION_STAGES,
  LETTER_STAGE_LABELS,
  type LetterBox,
  type LetterStage,
  type CatalogItem,
  type LetterSummary,
  type Register,
} from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { FileSpreadsheet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage, listLetters } from '../correspondence-api';
import { downloadRegister } from '../register-export';
import { LIST_PERIODS, LIST_PERIOD_LABELS, matchesSearch, periodRange, type ListPeriod } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { LetterTable, type LetterTableMode } from './letter-table';

const EMPTY: Readonly<Record<LetterBox, string>> = {
  incoming: 'Chưa có công văn đến nào ở mục này. Chọn bộ lọc khác hoặc tiếp nhận công văn mới.',
  outgoing: 'Chưa có công văn đi nào ở mục này. Chọn bộ lọc khác hoặc soạn công văn đi.',
  mine: 'Không có công văn nào đang chờ bạn xử lý.',
  archive: 'Chưa có hồ sơ nào được lưu trữ.',
  tracking: 'Không có công văn nào có hạn cần theo dõi.',
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
  registers = [],
  catalog = [],
  onStageChange,
  onOpen,
}: {
  readonly box: LetterBox;
  /** Sổ đăng ký, để lọc danh sách theo sổ. */
  readonly registers?: readonly Register[];
  /** Danh mục, để lọc theo loại văn bản. */
  readonly catalog?: readonly CatalogItem[];
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
  const [registerId, setRegisterId] = useState('');
  // Mặc định công văn vào sổ trong tháng này; đổi kỳ, khoảng ngày hay loại văn bản thì lọc ở máy chủ.
  const [period, setPeriod] = useState<ListPeriod>('month');
  const [custom, setCustom] = useState(() => periodRange('month', today));
  const [kind, setKind] = useState('');
  const direction = box === 'incoming' || box === 'outgoing' ? box : undefined;
  const range = period === 'custom' ? custom : periodRange(period, today);
  const kinds = catalog.filter((item) => item.kind === 'letter_type');
  const fromDate = direction ? range.from : undefined;
  const toDate = direction ? range.to : undefined;
  const kindCode = direction && kind ? kind : undefined;
  const boxRegisters = direction ? registers.filter((item) => item.direction === direction) : [];
  const filters = direction ? ([...DIRECTION_STAGES[direction], 'archived', 'revoking', 'cancelled'] as LetterStage[]) : [];
  const activeStage = stage && filters.includes(stage) ? stage : undefined;

  useEffect(() => {
    let active = true;
    setLetters(undefined);
    listLetters({
      box,
      stage: activeStage,
      registerId: direction && registerId ? registerId : undefined,
      fromDate,
      toDate,
      kind: kindCode,
    })
      .then((items) => {
        if (!active) return;
        setLetters(items);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được danh sách công văn.')));
    return () => {
      active = false;
    };
  }, [box, activeStage, registerId, direction, fromDate, toDate, kindCode, refreshKey]);

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
        {direction ? (
          <div className={styles.listFilters}>
            <div className={styles.filterSelect}>
              <SearchableSelect
                options={LIST_PERIODS.map((value) => ({ value, label: LIST_PERIOD_LABELS[value] }))}
                value={period}
                searchInDropdown
                hideDropdownSearch
                onChange={(value) => value && setPeriod(value as ListPeriod)}
              />
            </div>
            {period === 'custom' ? (
              <>
                <input
                  type="date"
                  aria-label={direction === 'incoming' ? 'Ngày đến từ' : 'Ngày soạn từ'}
                  value={custom.from ?? ''}
                  max={custom.to}
                  onChange={(event) => setCustom((current) => ({ ...current, from: event.target.value || undefined }))}
                />
                <input
                  type="date"
                  aria-label={direction === 'incoming' ? 'Ngày đến đến' : 'Ngày soạn đến'}
                  value={custom.to ?? ''}
                  min={custom.from}
                  onChange={(event) => setCustom((current) => ({ ...current, to: event.target.value || undefined }))}
                />
              </>
            ) : null}
            <div className={styles.filterSelect}>
              <SearchableSelect
                options={kinds.map((item) => ({ value: item.code, label: item.name }))}
                value={kind}
                placeholder="Tất cả loại văn bản"
                clearable
                onChange={(value) => setKind(value ?? '')}
              />
            </div>
          </div>
        ) : null}
        {boxRegisters.length > 1 ? (
          <div className={styles.registerFilter}>
            <SearchableSelect
              options={boxRegisters.map((item) => ({ value: item.id, label: item.name }))}
              value={registerId}
              placeholder="Tất cả sổ"
              clearable
              onChange={(value) => setRegisterId(value ?? '')}
            />
          </div>
        ) : null}
        <input
          className={styles.search}
          type="search"
          value={search}
          placeholder={box === 'outgoing' ? 'Tìm theo số, trích yếu, nơi nhận, phòng soạn' : 'Tìm theo số, trích yếu, cơ quan gửi'}
          aria-label="Tìm công văn"
          onChange={(event) => setSearch(event.target.value)}
        />
        {direction && letters ? (
          <button
            type="button"
            className={styles.buttonGhost}
            title={direction === 'incoming' ? 'Sổ đăng ký văn bản đến của danh sách đang lọc' : 'Sổ đăng ký văn bản đi (công văn đã ban hành) của danh sách đang lọc'}
            onClick={() =>
              void downloadRegister(direction, visible, today)
                .then((count) => toast.success(`Đã xuất sổ đăng ký: ${count} văn bản.`))
                .catch((cause) => toast.error(errorMessage(cause, 'Không xuất được sổ đăng ký.')))
            }
          >
            <FileSpreadsheet size={14} /> Xuất sổ đăng ký
          </button>
        ) : null}
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
