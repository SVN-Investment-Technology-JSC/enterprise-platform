'use client';

import { DEFAULT_PROCEDURE_LINK_SETTINGS, type ProcedureLinkSettings } from '@enterprise-platform/contracts-workspace';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import styles from '../workspace.module.scss';
import { Button } from '../ui/button';
import { Choice } from './choice';
import {
  LINK_SECTIONS,
  changedCount,
  resetSection,
  summarizeSection,
  visibleFields,
  type LinkField,
  type LinkSection,
} from './procedure-link-sections';

interface CardProps {
  /** Bản đang soạn. */
  readonly link: ProcedureLinkSettings;
  /** Bản đã lưu, để đánh dấu phần "Đã sửa". */
  readonly saved: ProcedureLinkSettings;
  readonly locked: boolean;
  readonly onChange: (next: ProcedureLinkSettings) => void;
}

const isDefault = (link: ProcedureLinkSettings, keys: readonly (keyof ProcedureLinkSettings)[]) =>
  keys.every((key) => link[key] === DEFAULT_PROCEDURE_LINK_SETTINGS[key]);

function FieldRow({
  field,
  link,
  locked,
  onPick,
}: {
  field: LinkField;
  link: ProcedureLinkSettings;
  locked: boolean;
  onPick: (value: string) => void;
}) {
  const value = String(link[field.key]);
  const current = field.options.find((option) => option.value === value);
  return (
    <div className={styles.plRow} data-link-field={field.key}>
      <div className={styles.plRowText}>
        <strong>
          {field.label}
          {field.engine ? <span className={styles.plChip}>Áp dụng cho hồ sơ Quy trình</span> : null}
        </strong>
        <span>{field.hint}</span>
      </div>
      <div className={`${styles.plRowControl} ${field.options.length === 2 ? '' : styles.plRowControlSelect}`}>
        {field.options.length === 2 ? (
          <div role="radiogroup" aria-label={field.label} className={styles.plSegmented}>
            {field.options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={option.value === value}
                disabled={locked}
                className={`${styles.plSegment} ${option.value === value ? styles.plSegmentOn : ''}`}
                onClick={() => onPick(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          <Choice
            label={field.label}
            value={value}
            options={field.options.map((option) => ({ value: option.value, label: option.label }))}
            onChange={onPick}
            disabled={locked}
            selectOnly
          />
        )}
        {current ? <span className={styles.plCurrentHint}>{current.description}</span> : null}
      </div>
    </div>
  );
}

function Section({
  section,
  link,
  saved,
  locked,
  open,
  onToggle,
  onChange,
}: {
  section: LinkSection;
  link: ProcedureLinkSettings;
  saved: ProcedureLinkSettings;
  locked: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (next: ProcedureLinkSettings) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fields = visibleFields(section, link);
  const basic = fields.filter((field) => !field.advanced);
  const advanced = fields.filter((field) => field.advanced);
  const keys = section.fields.map((field) => field.key);
  const edited = keys.some((key) => link[key] !== saved[key]);
  const nonDefault = changedCount(section, link);
  const pick = (key: keyof ProcedureLinkSettings, value: string) => onChange({ ...link, [key]: value });
  const row = (field: LinkField) => (
    <FieldRow key={field.key} field={field} link={link} locked={locked} onPick={(value) => pick(field.key, value)} />
  );

  return (
    <div className={styles.plSection} data-link-section={section.id}>
      <button type="button" className={styles.plSectionHead} aria-expanded={open} onClick={onToggle}>
        <span className={styles.plSectionText}>
          <span className={styles.plSectionTitle}>
            <strong>{section.title}</strong>
            {edited ? <span className={styles.plEdited}>Đã sửa</span> : null}
            {nonDefault > 0 ? <span className={styles.plCount}>{nonDefault} khác mặc định</span> : null}
          </span>
          <span className={styles.plSummary}>{summarizeSection(section, link)}</span>
        </span>
        <ChevronDown size={18} aria-hidden className={`${styles.plChevron} ${open ? styles.plChevronOpen : ''}`} />
      </button>
      {open ? (
        <div className={styles.plSectionBody}>
          {basic.map(row)}
          {advanced.length > 0 ? (
            <>
              <button
                type="button"
                className={styles.plAdvancedToggle}
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? 'Ẩn mục nâng cao' : `Nâng cao (${advanced.length})`}
              </button>
              {showAdvanced ? advanced.map(row) : null}
            </>
          ) : null}
          <div className={styles.plSectionFoot}>
            {fields.some((field) => field.engine) ? (
              <span>Thay đổi áp dụng sau tối đa khoảng 30 giây ở module Quy trình.</span>
            ) : (
              <span />
            )}
            <button
              type="button"
              className={styles.plTextButton}
              disabled={locked || isDefault(link, keys)}
              onClick={() => onChange(resetSection(section, link))}
            >
              Khôi phục mặc định phần này
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Thẻ "Công việc gắn quy trình": các phần gập được, mỗi phần có một dòng tóm tắt lựa chọn hiện tại.
 * Chỉ sửa bản nháp qua `onChange`; việc lưu vẫn do thanh lưu chung của trang đảm nhiệm.
 */
export function ProcedureLinkSettingsCard({ link, saved, locked, onChange }: CardProps) {
  const [openIds, setOpenIds] = useState<readonly string[]>([LINK_SECTIONS[0].id]);
  const toggle = (id: string) =>
    setOpenIds((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));
  const allKeys = Object.keys(DEFAULT_PROCEDURE_LINK_SETTINGS) as (keyof ProcedureLinkSettings)[];

  return (
    <section className={styles.gsCard} aria-label="Công việc gắn quy trình">
      <header className={`${styles.gsHead} ${styles.plHead}`}>
        <div>
          <h3>Công việc gắn quy trình</h3>
          <p>
            Công việc dự án và việc cá nhân có thể gắn hồ sơ Quy trình. Các lựa chọn dưới đây quyết định hai bên ảnh hưởng nhau
            thế nào.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={locked || isDefault(link, allKeys)}
          onClick={() => onChange({ ...DEFAULT_PROCEDURE_LINK_SETTINGS })}
        >
          Khôi phục mặc định
        </Button>
      </header>
      <div className={styles.gsBody}>
        {LINK_SECTIONS.map((section) => (
          <Section
            key={section.id}
            section={section}
            link={link}
            saved={saved}
            locked={locked}
            open={openIds.includes(section.id)}
            onToggle={() => toggle(section.id)}
            onChange={onChange}
          />
        ))}
      </div>
    </section>
  );
}
