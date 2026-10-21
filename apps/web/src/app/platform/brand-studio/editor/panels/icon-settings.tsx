'use client';

import {
  CATEGORIES,
  CATEGORY_LABELS,
  ICON_SIZES,
  LIMITS,
  type IconCategory,
  type IconStatus,
  type MetaPatch,
} from '@enterprise-platform/shared-brand-icon';
import { BadgeCheck, CircleDashed, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Section, ToggleGroup, type ToggleOption } from '../../components/controls';
import { NumberField } from '../../components/number-field';
import { LiveTextField } from '../../components/text-field';
import { useGesture } from '../../components/use-gesture';
import { addTags, MAX_TAG_LENGTH, removeTag } from './properties-model';
import type { EditorPanelProps } from './types';

const CATEGORY_OPTIONS: readonly ToggleOption<IconCategory>[] = CATEGORIES.map((category) => ({
  value: category,
  label: CATEGORY_LABELS[category],
  text: CATEGORY_LABELS[category],
}));

const SIZE_OPTIONS: readonly ToggleOption<number>[] = ICON_SIZES.map((size) => ({
  value: size,
  label: `Lưới ${size} x ${size}`,
  text: String(size),
}));

const STATUS_OPTIONS: readonly ToggleOption<IconStatus>[] = [
  { value: 'draft', label: 'Nháp: chưa dùng chính thức', icon: <CircleDashed />, text: 'Nháp' },
  { value: 'published', label: 'Phát hành: đã duyệt để dùng', icon: <BadgeCheck />, text: 'Phát hành' },
];

/** Cài đặt chung của icon, hiện khi chưa chọn lớp nào: tên, mô tả, danh mục, nhãn, cỡ lưới, trạng thái. */
export function IconSettings({ state, dispatch }: EditorPanelProps) {
  const { doc } = state;
  const gesture = useGesture(dispatch);
  const [scale, setScale] = useState(true);
  const [tagDraft, setTagDraft] = useState('');

  const setMeta = (patch: MetaPatch) => dispatch({ type: 'setMeta', patch });
  const tagsFull = doc.tags.length >= LIMITS.maxTags;

  const commitTag = () => {
    const next = addTags(doc.tags, tagDraft);
    setTagDraft('');
    if (next !== doc.tags) setMeta({ tags: next });
  };

  const onTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitTag();
    } else if (event.key === 'Backspace' && tagDraft === '' && doc.tags.length > 0) {
      setMeta({ tags: doc.tags.slice(0, -1) });
    }
  };

  return (
    <div className="text-xs text-slate-700">
      <Section title="Icon">
        <LiveTextField
          label="Tên icon"
          placeholder="Tên icon"
          value={doc.name}
          maxLength={80}
          gesture={gesture}
          onChange={(name) => setMeta({ name })}
        />
        <LiveTextField
          label="Mô tả"
          placeholder="Mô tả ngắn"
          value={doc.description}
          maxLength={300}
          multiline
          gesture={gesture}
          onChange={(description) => setMeta({ description })}
        />
      </Section>

      <Section title="Phân loại">
        <ToggleGroup
          ariaLabel="Danh mục"
          wrap
          value={doc.category}
          options={CATEGORY_OPTIONS}
          onChange={(category) => setMeta({ category })}
        />
        <div className="flex flex-wrap items-center gap-1">
          {doc.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-6 items-center gap-1 rounded bg-slate-100 pl-2 pr-1 text-[11px] text-slate-700"
            >
              {tag}
              <button
                type="button"
                title={`Xoá nhãn ${tag}`}
                aria-label={`Xoá nhãn ${tag}`}
                onClick={() => setMeta({ tags: removeTag(doc.tags, tag) })}
                className="inline-flex size-4 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            type="text"
            aria-label="Thêm nhãn"
            title="Gõ nhãn rồi nhấn Enter"
            placeholder={tagsFull ? 'Đã đủ nhãn' : 'Thêm nhãn'}
            maxLength={MAX_TAG_LENGTH}
            disabled={tagsFull}
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={onTagKeyDown}
            onBlur={commitTag}
            className="h-6 min-w-20 flex-1 rounded border border-transparent bg-transparent px-1 text-[11px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-200 focus:bg-white disabled:opacity-50"
          />
        </div>
      </Section>

      <Section title="Lưới">
        <ToggleGroup
          ariaLabel="Cỡ lưới"
          wrap
          value={doc.size}
          options={SIZE_OPTIONS}
          onChange={(size) => dispatch({ type: 'setSize', size, scale })}
        />
        <div className="flex items-center gap-2">
          <NumberField
            label="Cỡ lưới tuỳ chọn"
            value={doc.size}
            min={8}
            max={128}
            step={1}
            digits={0}
            className="w-[72px] shrink-0"
            onCommit={(size) => dispatch({ type: 'setSize', size, scale })}
          />
          <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-600" title="Phóng hình theo tỷ lệ khi đổi cỡ lưới">
            <input
              type="checkbox"
              checked={scale}
              onChange={(event) => setScale(event.target.checked)}
              className="size-3.5 shrink-0 accent-blue-600"
            />
            <span className="truncate">Co hình theo lưới</span>
          </label>
        </div>
      </Section>

      <Section title="Trạng thái">
        <ToggleGroup
          ariaLabel="Trạng thái"
          value={doc.status}
          options={STATUS_OPTIONS}
          onChange={(status) => setMeta({ status })}
        />
      </Section>
    </div>
  );
}
