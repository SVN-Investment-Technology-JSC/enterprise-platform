'use client';

import {
  daysUntil,
  REMIND_REASONS,
  REMIND_REASON_LABELS,
  type LetterDetail,
  type LetterSummary,
  type RemindReason,
} from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { BellRing } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage, listLetters, remindLetter } from '../correspondence-api';
import { dueText, formatDay, matchesSearch } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { CheckGroup, Field, FormDialog, SelectField } from './form-dialog';

type TrackingFilter = 'all' | 'overdue' | 'soon';

const FILTERS: readonly { readonly id: TrackingFilter; readonly label: string }[] = [
  { id: 'overdue', label: 'Quá hạn' },
  { id: 'soon', label: 'Sắp đến hạn (3 ngày)' },
  { id: 'all', label: 'Tất cả có hạn' },
];

/**
 * Theo dõi, đôn đốc việc giải quyết công văn: công văn còn mở có hạn, quá hạn lên đầu; ai đang
 * phải làm ở bước nào; văn thư / bộ phận tổng hợp gửi lời nhắc cho người đang xử lý.
 */
export function TrackingView({
  today,
  refreshKey,
  canRemind,
  onOpen,
  onChanged,
}: {
  readonly today: string;
  readonly refreshKey: number;
  readonly canRemind: boolean;
  readonly onOpen: (letterId: string) => void;
  readonly onChanged: () => void;
}) {
  const [letters, setLetters] = useState<LetterSummary[]>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<TrackingFilter>('overdue');
  const [search, setSearch] = useState('');
  const [reminding, setReminding] = useState<LetterSummary>();

  useEffect(() => {
    let active = true;
    listLetters({ box: 'tracking' })
      .then((items) => {
        if (!active) return;
        setLetters(items);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được danh sách theo dõi.')));
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const counts = useMemo(() => {
    const all = letters ?? [];
    return {
      overdue: all.filter((letter) => daysUntil(letter.dueOn ?? today, today) < 0).length,
      soon: all.filter((letter) => {
        const days = daysUntil(letter.dueOn ?? today, today);
        return days >= 0 && days <= 3;
      }).length,
      all: all.length,
    };
  }, [letters, today]);
  const visible = useMemo(
    () =>
      (letters ?? [])
        .filter((letter) => {
          const days = daysUntil(letter.dueOn ?? today, today);
          return filter === 'all' || (filter === 'overdue' ? days < 0 : days >= 0 && days <= 3);
        })
        .filter((letter) => matchesSearch(letter, search)),
    [letters, filter, search, today],
  );

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? `${styles.chip} ${styles.chipOn}` : styles.chip}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label} · {counts[item.id]}
          </button>
        ))}
        <input
          className={styles.search}
          type="search"
          value={search}
          placeholder="Tìm theo số, trích yếu, cơ quan"
          aria-label="Tìm công văn cần đôn đốc"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      <div className={styles.tableWrap}>
        {!letters ? (
          <div className={styles.empty}>Đang tải…</div>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>{filter === 'overdue' ? 'Không có công văn nào quá hạn.' : 'Không có công văn nào ở mục này.'}</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Số</th>
                <th>Trích yếu</th>
                <th>Đang ở bước</th>
                <th>Hạn</th>
                {canRemind ? <th aria-label="Đôn đốc" /> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((letter) => {
                const due = dueText(letter, today);
                const who = letter.currentAssigneeNames.join(', ') || letter.unitNames.join(', ');
                return (
                  <tr
                    key={letter.id}
                    tabIndex={0}
                    onClick={() => onOpen(letter.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onOpen(letter.id);
                    }}
                  >
                    <td className={styles.code}>{letter.displayNo}</td>
                    <td>
                      <div className={styles.subject}>{letter.subject}</div>
                      <span className={styles.hint}>{letter.direction === 'incoming' ? letter.senderOrg : `→ ${letter.recipient ?? ''}`}</span>
                    </td>
                    <td>
                      <div>{letter.stageLabel}</div>
                      {who ? <span className={styles.hint}>{who}</span> : null}
                    </td>
                    <td>
                      <div>{formatDay(letter.dueOn)}</div>
                      {due ? <span className={`${styles.hint} ${styles[`hint-${due.tone}`] ?? ''}`}>{due.text}</span> : null}
                    </td>
                    {canRemind ? (
                      <td>
                        <button
                          type="button"
                          className={styles.buttonSmall}
                          onClick={(event) => {
                            event.stopPropagation();
                            setReminding(letter);
                          }}
                        >
                          <BellRing size={13} /> Đôn đốc
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {letters ? <div className={styles.tableFoot}>Hiển thị {visible.length} công văn</div> : null}
      </div>
      <RemindDialog
        letter={reminding}
        onClose={() => setReminding(undefined)}
        onDone={() => {
          setReminding(undefined);
          onChanged();
        }}
      />
    </div>
  );
}

/**
 * Đôn đốc người đang xử lý bước hiện tại: chọn lý do (chậm trễ, cần làm gấp, khác) và ghi lời nhắn rõ ràng;
 * ở bước phòng ban chọn được phòng cần nhắc (mặc định mọi phòng chưa gửi kết quả).
 */
export function RemindDialog({
  letter,
  onClose,
  onDone,
}: {
  readonly letter?: Pick<LetterSummary, 'id' | 'displayNo' | 'subject' | 'stageLabel'> & Partial<Pick<LetterDetail, 'stage' | 'assignments'>>;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const [reason, setReason] = useState<RemindReason | ''>('');
  const [note, setNote] = useState('');
  const [units, setUnits] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Phòng còn phải gửi kết quả; phòng chủ trì đang chờ phối hợp thì chưa nhắc.
  const pending =
    letter?.stage === 'processing'
      ? (letter.assignments ?? []).filter((item) => item.status === 'pending' && item.role !== 'info' && !item.waitingFor?.length)
      : [];
  useEffect(() => {
    setReason('');
    setNote('');
    setUnits([]);
    setError(undefined);
  }, [letter]);
  const submit = async () => {
    if (!letter || !reason) return;
    setBusy(true);
    setError(undefined);
    try {
      await remindLetter(letter.id, { reason, note: note.trim(), assignmentIds: units.length > 0 ? units : undefined });
      toast.success(`Đã đôn đốc công văn ${letter.displayNo}.`);
      onDone();
    } catch (cause) {
      setError(errorMessage(cause, 'Không gửi được lời nhắc.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog
      open={Boolean(letter)}
      title="Đôn đốc xử lý"
      subtitle={letter ? `Công văn ${letter.displayNo} · bước "${letter.stageLabel}"` : ''}
      submitLabel="Gửi lời nhắc"
      submitting={busy}
      submitDisabled={!reason || !note.trim()}
      dirty={reason !== '' || note.trim() !== ''}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <SelectField label="Lý do" required>
        <SearchableSelect
          options={REMIND_REASONS.map((value) => ({ value, label: REMIND_REASON_LABELS[value] }))}
          value={reason}
          placeholder="Chọn lý do đôn đốc"
          searchInDropdown
          hideDropdownSearch
          onChange={(value) => setReason((value ?? '') as RemindReason | '')}
        />
      </SelectField>
      {pending.length > 1 ? (
        <CheckGroup label="Nhắc phòng (bỏ trống là mọi phòng chưa gửi kết quả)">
          {pending.map((item) => (
            <label key={item.id} className={styles.checkRow}>
              <input
                type="checkbox"
                checked={units.includes(item.id)}
                onChange={(event) => setUnits((current) => (event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)))}
              />
              {item.unitName}
            </label>
          ))}
        </CheckGroup>
      ) : null}
      <Field label="Lời nhắn" required>
        <textarea
          value={note}
          maxLength={1000}
          rows={3}
          autoFocus
          placeholder={reason === 'urgent' ? 'Ví dụ: Sở yêu cầu trả lời trước 15h hôm nay' : 'Ví dụ: Đã quá hạn 2 ngày, đề nghị gửi kết quả trong hôm nay'}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </FormDialog>
  );
}
