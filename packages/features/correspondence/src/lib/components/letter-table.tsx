'use client';

import { DELIVERY_STATUS_LABELS, type LetterSummary } from '@enterprise-platform/contracts-correspondence';
import { dueText, formatDay, stageTone, urgencyTone } from '../correspondence.model';
import styles from '../correspondence.module.scss';

export type LetterTableMode = 'incoming' | 'outgoing' | 'archive' | 'mixed';

/** Bảng công văn: bấm (hoặc Enter) một dòng để mở ngăn chi tiết. */
export function LetterTable({
  letters,
  mode,
  today,
  activeId,
  emptyText,
  onOpen,
}: {
  readonly letters: readonly LetterSummary[];
  readonly mode: LetterTableMode;
  readonly today: string;
  readonly activeId?: string;
  readonly emptyText: string;
  readonly onOpen: (letterId: string) => void;
}) {
  if (letters.length === 0) {
    return (
      <div className={styles.tableWrap}>
        <div className={styles.empty}>{emptyText}</div>
      </div>
    );
  }
  const rowProps = (letter: LetterSummary) => ({
    tabIndex: 0,
    className: letter.id === activeId ? styles.rowActive : undefined,
    onClick: () => onOpen(letter.id),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') onOpen(letter.id);
    },
  });
  const tag = (tone: string, label: string) => <span className={`${styles.tag} ${styles[`tone-${tone}`]}`}>{label}</span>;
  const number = (letter: LetterSummary) => (
    <>
      <span className={styles.code}>
        {letter.awaitingMe ? <span className={styles.mineDot} title="Đang chờ bạn xử lý" /> : null}
        {letter.displayNo}
      </span>
      <span className={styles.hint}>
        {mode === 'mixed' ? `${letter.direction === 'incoming' ? 'Đến' : 'Đi'} · ` : ''}
        {formatDay(letter.direction === 'outgoing' && letter.publishedOn ? letter.publishedOn : letter.receivedOn)}
      </span>
    </>
  );
  const stage = (letter: LetterSummary) => (
    <>
      {tag(stageTone(letter.stage), letter.stageLabel)}
      {letter.stage === 'processing' ? (
        <span className={styles.hint}>
          Đã gửi kết quả {letter.assignmentsDone}/{letter.assignmentsTotal}
        </span>
      ) : letter.stage === 'reviewing' && letter.currentAssigneeNames.length > 0 ? (
        <span className={styles.hint}>{letter.currentAssigneeNames.join(', ')}</span>
      ) : letter.stage === 'archived' && letter.deliveryStatus ? (
        <span className={styles.hint}>{DELIVERY_STATUS_LABELS[letter.deliveryStatus]}</span>
      ) : null}
    </>
  );
  const dueCell = (letter: LetterSummary) => {
    const due = dueText(letter, today);
    return (
      <>
        {formatDay(letter.dueOn) || <span className={styles.muted}>Không đặt</span>}
        {due ? <span className={`${styles.hint} ${styles[`hint-${due.tone}`] ?? ''}`}>{due.text}</span> : null}
      </>
    );
  };
  const party = (letter: LetterSummary) =>
    letter.direction === 'incoming'
      ? `${letter.senderOrg}${letter.senderRef ? ` · ${letter.senderRef}` : ''}`
      : `${letter.authorUnitName ?? letter.senderOrg} → ${letter.recipient ?? ''}`;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        {mode === 'archive' ? (
          <>
            <thead>
              <tr>
                <th>Số hồ sơ</th>
                <th>Trích yếu</th>
                <th>Số công văn</th>
                <th>Ngày lưu trữ</th>
              </tr>
            </thead>
            <tbody>
              {letters.map((letter) => (
                <tr key={letter.id} {...rowProps(letter)}>
                  <td>{tag('success', letter.archiveCode ?? '')}</td>
                  <td>
                    <div className={styles.subject}>{letter.subject}</div>
                    <span className={styles.hint}>{party(letter)}</span>
                  </td>
                  <td className={styles.code}>
                    {letter.direction === 'incoming' ? 'Đến' : 'Đi'} {letter.displayNo}
                  </td>
                  <td>{formatDay(letter.archivedOn)}</td>
                </tr>
              ))}
            </tbody>
          </>
        ) : (
          <>
            <thead>
              <tr>
                <th>{mode === 'incoming' ? 'Số đến' : mode === 'outgoing' ? 'Số' : 'Số'}</th>
                <th>Trích yếu</th>
                <th>Độ khẩn</th>
                <th>Bước xử lý</th>
                <th>{mode === 'outgoing' ? 'Hạn ban hành' : 'Hạn xử lý'}</th>
              </tr>
            </thead>
            <tbody>
              {letters.map((letter) => (
                <tr key={letter.id} {...rowProps(letter)}>
                  <td>{number(letter)}</td>
                  <td>
                    <div className={styles.subject}>{letter.subject}</div>
                    <span className={styles.hint}>{party(letter)}</span>
                  </td>
                  <td>
                    {tag(urgencyTone(letter), letter.urgencyName)}
                    {letter.restricted ? <span className={styles.hint}>{letter.confidentialityName}</span> : null}
                  </td>
                  <td>{stage(letter)}</td>
                  <td>{dueCell(letter)}</td>
                </tr>
              ))}
            </tbody>
          </>
        )}
      </table>
      <div className={styles.tableFoot}>Hiển thị {letters.length} công văn</div>
    </div>
  );
}
