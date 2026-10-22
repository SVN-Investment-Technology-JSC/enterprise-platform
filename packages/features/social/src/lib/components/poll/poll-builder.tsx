'use client';

import {
  SOCIAL_POLL_OPTION_MAX,
  SOCIAL_POLL_OPTIONS_MAX,
  SOCIAL_POLL_OPTIONS_MIN,
  SOCIAL_POLL_QUESTION_MAX,
} from '@enterprise-platform/contracts-social';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Plus, Trash2 } from 'lucide-react';
import {
  addPollOption,
  removePollOption,
  setPollOption,
  vnToday,
  type PollDraft,
} from '../../post-extras.model';
import styles from '../../post-extras.module.scss';
import base from '../../social.module.scss';
import { TimeSelect } from '../time-select';

export interface PollBuilderProps {
  readonly draft: PollDraft;
  readonly onChange: (draft: PollDraft) => void;
  /** Đang sửa bài đã có bình chọn: chỉ đổi được hạn đóng. */
  readonly lockedOptions?: boolean;
}

/** Trình dựng bình chọn: câu hỏi, 2–10 lựa chọn, một/nhiều, ẩn danh, hạn đóng. */
export function PollBuilder({
  draft,
  onChange,
  lockedOptions = false,
}: PollBuilderProps) {
  return (
    <div className={styles.section}>
      {!lockedOptions ? (
        <>
          <label className={base.field}>
            <span className={base.fieldLabel}>
              Câu hỏi<span className={base.fieldRequired}> *</span>
            </span>
            <input
              className={base.input}
              value={draft.question}
              maxLength={SOCIAL_POLL_QUESTION_MAX}
              placeholder="Bạn muốn hỏi điều gì?"
              onChange={(event) =>
                onChange({ ...draft, question: event.target.value })
              }
            />
          </label>

          <div className={base.field} role="group" aria-label="Các lựa chọn">
            <span className={base.fieldLabel}>
              Lựa chọn{' '}
              <span className={base.muted}>
                ({SOCIAL_POLL_OPTIONS_MIN}–{SOCIAL_POLL_OPTIONS_MAX})
              </span>
            </span>
            {draft.options.map((text, index) => (
              <div key={index} className={styles.optionRow}>
                <span className={styles.optionIndex}>{index + 1}</span>
                <input
                  className={base.input}
                  value={text}
                  maxLength={SOCIAL_POLL_OPTION_MAX}
                  placeholder={`Lựa chọn ${index + 1}`}
                  aria-label={`Lựa chọn ${index + 1}`}
                  onChange={(event) =>
                    onChange(setPollOption(draft, index, event.target.value))
                  }
                />
                <button
                  type="button"
                  className={base.iconButton}
                  aria-label={`Bỏ lựa chọn ${index + 1}`}
                  disabled={draft.options.length <= SOCIAL_POLL_OPTIONS_MIN}
                  onClick={() => onChange(removePollOption(draft, index))}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={`${base.buttonGhost} ${styles.loadMore}`}
              style={{ alignSelf: 'flex-start' }}
              disabled={draft.options.length >= SOCIAL_POLL_OPTIONS_MAX}
              onClick={() => onChange(addPollOption(draft))}
            >
              <Plus size={14} /> Thêm lựa chọn
            </button>
          </div>

          <div className={base.checkRow}>
            <label className={base.check}>
              <input
                type="checkbox"
                checked={draft.allowMultiple}
                onChange={(event) =>
                  onChange({ ...draft, allowMultiple: event.target.checked })
                }
              />
              <span>Cho chọn nhiều đáp án</span>
            </label>
            <label className={base.check}>
              <input
                type="checkbox"
                checked={draft.anonymous}
                onChange={(event) =>
                  onChange({ ...draft, anonymous: event.target.checked })
                }
              />
              <span>Ẩn danh (không ai xem được ai chọn gì)</span>
            </label>
          </div>
        </>
      ) : (
        <p className={base.muted}>
          Bình chọn đã có phiếu nên không đổi được câu hỏi và lựa chọn. Bạn chỉ
          chỉnh được hạn đóng.
        </p>
      )}

      <div className={styles.dateTimeRow}>
        <div
          className={base.field}
          role="group"
          aria-label="Ngày đóng bình chọn"
        >
          <span className={base.fieldLabel}>Hạn đóng (giờ Việt Nam)</span>
          <DatePickerInput
            value={draft.closeDate}
            min={vnToday()}
            height={38}
            placeholder="Không giới hạn"
            aria-label="Ngày đóng bình chọn"
            onChange={(closeDate) =>
              onChange({
                ...draft,
                closeDate,
                closeTime: closeDate ? draft.closeTime || '17:00' : '',
              })
            }
          />
        </div>
        <TimeSelect
          value={draft.closeTime}
          label="Giờ đóng bình chọn"
          disabled={!draft.closeDate}
          onChange={(closeTime) => onChange({ ...draft, closeTime })}
        />
      </div>
    </div>
  );
}
