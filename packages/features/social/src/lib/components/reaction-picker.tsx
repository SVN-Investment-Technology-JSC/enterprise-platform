'use client';

import {
  SOCIAL_REACTION_LABELS,
  SOCIAL_REACTION_TYPES,
  type SocialReactionType,
} from '@enterprise-platform/contracts-social';
import { useState } from 'react';
import styles from '../social.module.scss';
import { ReactionIcon } from './reaction-icon';

/**
 * Bảng chọn phản ứng kiểu 1Office: rê chuột hoặc focus bàn phím vào một biểu tượng thì nó phóng to,
 * nhấc lên, hiện tên phản ứng và chạy hoạt hình; các biểu tượng còn lại đứng yên.
 * Bảng chỉ hiện khi vùng bọc (`reactWrap`, `commentReactWrap`) đang hover hoặc có focus.
 */
export function ReactionPicker({
  value,
  onSelect,
}: {
  /** Phản ứng hiện tại của người dùng (nếu có). */
  readonly value?: SocialReactionType | null;
  /** Chọn một loại; chọn lại đúng loại đang có thì bên gọi tự quyết định bỏ phản ứng. */
  readonly onSelect: (type: SocialReactionType) => void;
}) {
  const [active, setActive] = useState<SocialReactionType | null>(null);

  return (
    <span className={styles.reactPicker} role="group" aria-label="Chọn phản ứng">
      {SOCIAL_REACTION_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          className={styles.reactOption}
          data-type={type}
          data-selected={value === type}
          aria-label={SOCIAL_REACTION_LABELS[type]}
          aria-pressed={value === type}
          onMouseEnter={() => setActive(type)}
          onMouseLeave={() => setActive((current) => (current === type ? null : current))}
          onFocus={(event) => {
            if (event.currentTarget.matches(':focus-visible')) setActive(type);
          }}
          onBlur={() => setActive((current) => (current === type ? null : current))}
          onClick={(event) => {
            // Bỏ focus để bảng chọn đóng lại (nó mở theo :hover và :focus-within).
            event.currentTarget.blur();
            onSelect(type);
          }}
        >
          <span className={styles.reactTip} aria-hidden="true">
            {SOCIAL_REACTION_LABELS[type]}
          </span>
          <ReactionIcon type={type} size={32} playing={active === type} />
        </button>
      ))}
    </span>
  );
}
