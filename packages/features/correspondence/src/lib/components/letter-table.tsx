'use client';

import {
  LETTER_URGENCY_LABELS,
  type LetterSummary,
} from '@enterprise-platform/contracts-correspondence';
import { dueText, formatDay, stageLabel, stageTone, urgencyTone } from '../correspondence.model';
import styles from '../correspondence.module.scss';

export type LetterTableMode = 'incoming' | 'outgoing' | 'archive';

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

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        {mode === 'incoming' ? (
          <>
            <thead>
              <tr>
                <th>Số đến</th>
                <th>Trích yếu</th>
                <th>Độ khẩn</th>
                <th>Bước xử lý</th>
                <th>Hạn xử lý</th>
              </tr>
            </thead>
            <tbody>
              {letters.map((letter) => {
                const due = dueText(letter, today);
                return (
                  <tr key={letter.id} {...rowProps(letter)}>
                    <td>
                      <span className={styles.code}>
                        {letter.awaitingMe ? <span className={styles.mineDot} title="Đang chờ bạn xử lý" /> : null}
                        {letter.incomingNo}
                      </span>
                      <span className={styles.hint}>{formatDay(letter.receivedOn)}</span>
                    </td>
                    <td>
                      <div className={styles.subject}>{letter.subject}</div>
                      <span className={styles.hint}>
                        {letter.senderOrg}
                        {letter.senderRef ? ` · ${letter.senderRef}` : ''}
                      </span>
                    </td>
                    <td>{tag(urgencyTone(letter.urgency), LETTER_URGENCY_LABELS[letter.urgency])}</td>
                    <td>
                      {tag(stageTone(letter.stage), stageLabel(letter.stage))}
                      {letter.stage === 'processing' ? (
                        <span className={styles.hint}>
                          Phòng ban đã phản hồi: {letter.assignmentsDone}/{letter.assignmentsTotal}
                        </span>
                      ) : letter.leaderName && (letter.stage === 'directing' || letter.stage === 'reviewing') ? (
                        <span className={styles.hint}>{letter.leaderName}</span>
                      ) : null}
                    </td>
                    <td>
                      {formatDay(letter.dueOn) || <span className={styles.muted}>Không đặt</span>}
                      {due ? <span className={`${styles.hint} ${styles[`hint-${due.tone}`] ?? ''}`}>{due.text}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </>
        ) : mode === 'outgoing' ? (
          <>
            <thead>
              <tr>
                <th>Số đi</th>
                <th>Trích yếu</th>
                <th>Nơi nhận</th>
                <th>Ngày phát hành</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {letters.map((letter) => (
                <tr key={letter.id} {...rowProps(letter)}>
                  <td className={styles.code}>{letter.outgoingNo}</td>
                  <td>
                    <div className={styles.subject}>{letter.subject}</div>
                    <span className={styles.hint}>Trả lời công văn {letter.incomingNo}</span>
                  </td>
                  <td>{letter.recipient}</td>
                  <td>{formatDay(letter.publishedOn)}</td>
                  <td>{tag(stageTone(letter.stage), stageLabel(letter.stage))}</td>
                </tr>
              ))}
            </tbody>
          </>
        ) : (
          <>
            <thead>
              <tr>
                <th>Số hồ sơ</th>
                <th>Trích yếu</th>
                <th>Số đến · Số đi</th>
                <th>Cơ quan gửi</th>
                <th>Ngày lưu trữ</th>
              </tr>
            </thead>
            <tbody>
              {letters.map((letter) => (
                <tr key={letter.id} {...rowProps(letter)}>
                  <td>{tag('success', letter.archiveCode ?? '')}</td>
                  <td>
                    <div className={styles.subject}>{letter.subject}</div>
                  </td>
                  <td className={styles.code}>
                    {letter.incomingNo}
                    {letter.outgoingNo ? ` · ${letter.outgoingNo}` : ''}
                  </td>
                  <td>{letter.senderOrg}</td>
                  <td>{formatDay(letter.archivedOn)}</td>
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
