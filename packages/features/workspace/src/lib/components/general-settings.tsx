'use client';

import {
  DEFAULT_PROJECT_TASK_TITLES,
  type ChatOnArchivedPolicy,
  type ProjectArchiveSettings as Settings,
  type ReopenProjectPolicy,
  type SaveProjectArchiveSettingsRequest,
} from '@enterprise-platform/contracts-workspace';
import { toast } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { TaskTitleListEditor } from './task-title-list-editor';

/*
 * Cấu hình chung của Workspace, dựng theo bộ khung shadcn/ui (Card, Switch, Radio Group, Button). Workspace không chạy
 * Tailwind nên các khối này viết bằng SCSS cùng ngôn ngữ thiết kế, như `form-controls.tsx`.
 */

/** Một thẻ cấu hình: đầu thẻ nền xám (tên và mô tả), thân trắng là các dòng ngăn bằng vạch mảnh. */
function SettingsCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className={styles.gsCard} aria-label={title}>
      <header className={styles.gsHead}>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      <div className={styles.gsBody}>{children}</div>
    </section>
  );
}

/** Dòng cấu hình: nhãn và mô tả bên trái, nút gạt bên phải. */
function SettingRow({ label, hint, control }: { label: string; hint: string; control: ReactNode }) {
  return (
    <div className={styles.gsRow}>
      <div className={styles.gsRowText}>
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <div className={styles.gsRowControl}>{control}</div>
    </div>
  );
}

/** Nút gạt Bật / Tắt cho cài đặt hai khả năng mang nghĩa "có hoặc không". */
function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className={styles.gsSwitchWrap}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`${styles.gsSwitch} ${checked ? styles.gsSwitchOn : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.gsSwitchThumb} />
      </button>
      <span className={styles.gsSwitchText}>{checked ? 'Bật' : 'Tắt'}</span>
    </span>
  );
}

interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description: string;
}

/** Chọn một trong nhiều khả năng; mỗi khả năng có tên và một dòng giải thích hệ quả. */
function RadioChoices<T extends string>({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className={styles.gsRadios} disabled={disabled}>
      {options.map((option) => (
        <label key={option.value} className={styles.gsRadio}>
          <input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} />
          <span className={styles.gsRadioText}>
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const REOPEN_PROJECT_OPTIONS: readonly ChoiceOption<ReopenProjectPolicy>[] = [
  {
    value: 'reactivate',
    label: 'Đưa dự án về Đang chạy',
    description: 'Dự án rời Lưu trữ và quay lại trạng thái Đang chạy để làm tiếp.',
  },
  {
    value: 'keep',
    label: 'Giữ nguyên trạng thái Hoàn thành',
    description: 'Chỉ bỏ dấu lưu trữ để chỉnh sửa; dự án vẫn ở trạng thái Hoàn thành.',
  },
];

const CHAT_ON_ARCHIVED_OPTIONS: readonly ChoiceOption<ChatOnArchivedPolicy>[] = [
  {
    value: 'block',
    label: 'Chặn nhắn tin',
    description: 'Không ai nhắn, sửa hay thu hồi tin được; chỉ đọc lại tin cũ.',
  },
  {
    value: 'allow',
    label: 'Vẫn cho nhắn tin',
    description: 'Thành viên tiếp tục trao đổi dù dự án đã lưu trữ.',
  },
];

/** Bản đang soạn của mọi cấu hình trên trang; so với bản đã lưu để biết có thay đổi hay không. */
interface Draft {
  readonly defaultTasksEnabled: boolean;
  readonly defaultTaskTitles: readonly string[];
  readonly autoArchive: boolean;
  readonly reopenProject: ReopenProjectPolicy;
  readonly chatOnArchived: ChatOnArchivedPolicy;
}

const draftOf = (settings: Settings): Draft => ({
  defaultTasksEnabled: settings.defaultTasksEnabled,
  defaultTaskTitles: [...settings.defaultTaskTitles],
  autoArchive: settings.autoArchive,
  reopenProject: settings.reopenProject,
  chatOnArchived: settings.chatOnArchived,
});

/** Danh sách tên đã làm sạch như server sẽ lưu: bỏ dòng trống, bỏ khoảng trắng thừa. */
const cleanTitles = (titles: readonly string[]): string[] =>
  titles.map((title) => title.replace(/\s+/g, ' ').trim()).filter(Boolean);

/**
 * Cấu hình chung: những lựa chọn có từ hai khả năng trở lên và áp cho cả tenant, chia thẻ theo chủ đề.
 *
 * Mọi điều khiển chỉ sửa bản nháp; thanh dưới cùng có một nút "Lưu cấu hình" cho cả trang, chỉ bật khi bản nháp khác bản
 * đã lưu, và chỉ gửi những trường đã đổi. Kết quả báo bằng toast nên bố cục không xê dịch. Dự án đã lưu trữ luôn chỉ
 * xem; các lựa chọn ở đây chỉ quyết định phần còn lại của vòng đời lưu trữ.
 */
export function GeneralSettings() {
  const [settings, setSettings] = useState<Settings>();
  const [draft, setDraft] = useState<Draft>();
  const [loadError, setLoadError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .loadProjectArchiveSettings()
      .then((loaded) => {
        setSettings(loaded);
        setDraft(draftOf(loaded));
      })
      .catch((cause: { message?: string }) => setLoadError(cause?.message ?? 'Không tải được cấu hình chung.'));
  }, []);

  /** Những trường bản nháp khác bản đã lưu; rỗng nghĩa là không có gì để lưu. */
  const patch = useMemo<SaveProjectArchiveSettingsRequest>(() => {
    if (!settings || !draft) return {};
    const changes: { -readonly [K in keyof SaveProjectArchiveSettingsRequest]: SaveProjectArchiveSettingsRequest[K] } = {};
    if (draft.defaultTasksEnabled !== settings.defaultTasksEnabled) changes.defaultTasksEnabled = draft.defaultTasksEnabled;
    if (JSON.stringify(cleanTitles(draft.defaultTaskTitles)) !== JSON.stringify(settings.defaultTaskTitles)) {
      changes.defaultTaskTitles = cleanTitles(draft.defaultTaskTitles);
    }
    if (draft.autoArchive !== settings.autoArchive) changes.autoArchive = draft.autoArchive;
    if (draft.reopenProject !== settings.reopenProject) changes.reopenProject = draft.reopenProject;
    if (draft.chatOnArchived !== settings.chatOnArchived) changes.chatOnArchived = draft.chatOnArchived;
    return changes;
  }, [settings, draft]);
  const dirty = Object.keys(patch).length > 0;

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const saved = await api.saveProjectArchiveSettings(patch);
      setSettings(saved);
      setDraft(draftOf(saved));
      toast.success('Đã lưu cấu hình chung.');
    } catch (cause) {
      // Giữ nguyên bản nháp để người dùng sửa tiếp hoặc thử lại.
      toast.error((cause as { message?: string })?.message ?? 'Không lưu được cấu hình chung.');
    } finally {
      setSaving(false);
    }
  };

  if (!settings || !draft) {
    return loadError ? (
      <p role="alert" className={styles.alert}>
        {loadError}
      </p>
    ) : (
      <p className={styles.muted}>Đang tải cấu hình…</p>
    );
  }

  const locked = !settings.canEdit || saving;
  const update = (changes: Partial<Draft>) => setDraft({ ...draft, ...changes });

  return (
    <div className={styles.gsStack}>
      <SettingsCard
        title="Tạo dự án"
        description="Công việc được tạo sẵn khi tạo dự án mới. Người tạo vẫn thêm hoặc bớt được cho từng dự án."
      >
        <SettingRow
          label="Tự tạo sẵn công việc khi tạo dự án"
          hint="Bật thì form tạo dự án điền sẵn danh sách mẫu bên dưới và tạo chúng cùng dự án. Tắt thì dự án mới trống."
          control={
            <Switch
              label="Tự tạo sẵn công việc"
              checked={draft.defaultTasksEnabled}
              disabled={locked}
              onChange={(defaultTasksEnabled) => update({ defaultTasksEnabled })}
            />
          }
        />
        <div className={`${styles.gsRow} ${styles.gsRowStack}`}>
          <div className={styles.gsRowText}>
            <strong>Danh sách công việc mẫu</strong>
            <span>Mỗi dòng là một công việc cấp gốc, tạo theo đúng thứ tự này, chưa giao ai. Tối đa 30 công việc.</span>
          </div>
          <TaskTitleListEditor
            idPrefix="Công việc mẫu"
            titles={draft.defaultTaskTitles}
            disabled={locked}
            emptyText="Danh sách đang trống: bật tự tạo sẵn cũng không tạo công việc nào."
            onChange={(defaultTaskTitles) => update({ defaultTaskTitles })}
            extraActions={
              <button
                type="button"
                className={styles.buttonSmall}
                onClick={() => update({ defaultTaskTitles: [...DEFAULT_PROJECT_TASK_TITLES] })}
              >
                Dùng mẫu gợi ý
              </button>
            }
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Lưu trữ dự án"
        description="Dự án đã lưu trữ chỉ xem; muốn chỉnh sửa phải mở lưu trữ trước. Các lựa chọn dưới đây quyết định phần còn lại của vòng đời lưu trữ."
      >
        <SettingRow
          label="Tự đóng hồ sơ khi mọi công việc đã xong"
          hint="Dự án có mọi công việc hoàn thành hoặc đã huỷ tự vào Lưu trữ. Đóng hồ sơ thủ công luôn dùng được, kể cả khi còn việc chưa xong."
          control={
            <Switch
              label="Tự đóng hồ sơ"
              checked={draft.autoArchive}
              disabled={locked}
              onChange={(autoArchive) => update({ autoArchive })}
            />
          }
        />
        <div className={`${styles.gsRow} ${styles.gsRowStack}`}>
          <div className={styles.gsRowText}>
            <strong>Khi mở lưu trữ dự án đã Hoàn thành</strong>
            <span>Dự án đã Hoàn thành luôn nằm trong Lưu trữ. Chọn điều gì xảy ra khi mở lại để chỉnh sửa.</span>
          </div>
          <RadioChoices
            name="reopen-project"
            value={draft.reopenProject}
            options={REOPEN_PROJECT_OPTIONS}
            disabled={locked}
            onChange={(reopenProject) => update({ reopenProject })}
          />
        </div>
        <div className={`${styles.gsRow} ${styles.gsRowStack}`}>
          <div className={styles.gsRowText}>
            <strong>Trao đổi trong dự án đã lưu trữ</strong>
            <span>Áp dụng cho trao đổi cấp dự án và cấp công việc.</span>
          </div>
          <RadioChoices
            name="chat-on-archived"
            value={draft.chatOnArchived}
            options={CHAT_ON_ARCHIVED_OPTIONS}
            disabled={locked}
            onChange={(chatOnArchived) => update({ chatOnArchived })}
          />
        </div>
      </SettingsCard>

      {/* Thanh lưu chung: luôn có mặt, chỉ đổi trạng thái bật tắt nên bố cục không xê dịch. */}
      <div className={styles.gsActionBar}>
        <span className={`${styles.gsActionHint} ${dirty ? styles.gsActionHintDirty : ''}`}>
          {!settings.canEdit
            ? 'Chỉ quản trị viên được đổi cấu hình này.'
            : dirty
              ? 'Có thay đổi chưa lưu.'
              : 'Chưa có thay đổi nào.'}
        </span>
        <button
          type="button"
          className={styles.buttonGhost}
          disabled={!dirty || locked}
          onClick={() => setDraft(draftOf(settings))}
        >
          Hoàn tác
        </button>
        <button type="button" className={styles.buttonPrimary} disabled={!dirty || locked} onClick={() => void save()}>
          {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
        </button>
      </div>
    </div>
  );
}
