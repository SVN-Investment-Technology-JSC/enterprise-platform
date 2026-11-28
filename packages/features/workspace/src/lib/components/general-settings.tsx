'use client';

import {
  DEFAULT_PROJECT_TASK_TITLES,
  DEFAULT_PROJECT_PROGRESS_METHOD,
  DEFAULT_PROCEDURE_LINK_SETTINGS,
  type ChatOnArchivedPolicy,
  type ProcedureLinkSettings,
  type ProgressReportCompleteStatus,
  type ProjectProgressMethod,
  type ProjectArchiveSettings as Settings,
  type ReopenProjectPolicy,
  type SaveProjectArchiveSettingsRequest,
} from '@enterprise-platform/contracts-workspace';
import { toast } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PROGRESS_METHOD_INFO, PROGRESS_METHOD_ORDER } from '../project-progress-methods';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { Button } from '../ui/button';
import { ProcedureLinkSettingsCard } from './procedure-link-settings-card';
import { TaskTitleListEditor } from './task-title-list-editor';

/*
 * Cấu hình chung của Workspace, dựng theo bộ khung shadcn/ui (Card, Switch, Radio Group, Button). Workspace không chạy
 * Tailwind nên các khối này viết bằng SCSS cùng ngôn ngữ thiết kế, như `form-controls.tsx`.
 */

/** Một thẻ cấu hình: đầu thẻ nền xám (tên và mô tả), thân trắng là các dòng ngăn bằng vạch mảnh. */
function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.gsCard} aria-label={title}>
      <header className={styles.gsHead}>
        <h3>{title}</h3>
      </header>
      <div className={styles.gsBody}>{children}</div>
    </section>
  );
}

/** Dòng cấu hình: nhãn và mô tả bên trái, nút gạt bên phải. */
function SettingRow({ label, hint, control }: { label: string; hint?: string; control: ReactNode }) {
  return (
    <div className={styles.gsRow}>
      <div className={styles.gsRowText}>
        <strong>{label}</strong>
        {hint ? <span>{hint}</span> : null}
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
  readonly description?: string;
}

/**
 * Chọn một trong nhiều khả năng, dạng ô chọn kiểu shadcn "radio card": mỗi khả năng là một ô có nút tròn, tên và (nếu có)
 * một dòng giải thích hệ quả. Các ô xếp lưới tự co: còn chỗ thì 2, 3 ô một hàng, màn hẹp thì xuống từng hàng.
 */
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
        <label key={option.value} className={`${styles.gsRadio} ${value === option.value ? styles.gsRadioOn : ''}`}>
          <input
            type="radio"
            className={styles.gsRadioInput}
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span className={styles.gsRadioDot} aria-hidden="true" />
          <span className={styles.gsRadioText}>
            <strong>{option.label}</strong>
            {option.description ? <span>{option.description}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const REOPEN_PROJECT_OPTIONS: readonly ChoiceOption<ReopenProjectPolicy>[] = [
  {
    value: 'reactivate',
    label: 'Đưa dự án về "Đang chạy"',
  },
  {
    value: 'keep',
    label: 'Giữ nguyên trạng thái "Hoàn thành"',
  },
];

const REPORT_COMPLETE_STATUS_OPTIONS: readonly ChoiceOption<ProgressReportCompleteStatus>[] = [
  {
    value: 'done',
    label: 'Hoàn thành',
  },
  {
    value: 'review',
    label: 'Chờ duyệt',
  },
];

const CHAT_ON_ARCHIVED_OPTIONS: readonly ChoiceOption<ChatOnArchivedPolicy>[] = [
  {
    value: 'block',
    label: 'Chặn nhắn tin',
  },
  {
    value: 'allow',
    label: 'Vẫn cho nhắn tin',
  },
];

/** Bản đang soạn của mọi cấu hình trên trang; so với bản đã lưu để biết có thay đổi hay không. */
interface Draft {
  readonly defaultTasksEnabled: boolean;
  readonly defaultTaskTitles: readonly string[];
  readonly defaultProgressMethod: ProjectProgressMethod;
  readonly progressReportCompleteStatus: ProgressReportCompleteStatus;
  readonly progressReportRequireDescription: boolean;
  readonly progressReportStartsWork: boolean;
  readonly autoArchive: boolean;
  readonly reopenProject: ReopenProjectPolicy;
  readonly chatOnArchived: ChatOnArchivedPolicy;
  readonly procedureLink: ProcedureLinkSettings;
}

const draftOf = (settings: Settings): Draft => ({
  defaultTasksEnabled: settings.defaultTasksEnabled,
  defaultTaskTitles: [...settings.defaultTaskTitles],
  defaultProgressMethod: settings.defaultProgressMethod ?? DEFAULT_PROJECT_PROGRESS_METHOD,
  progressReportCompleteStatus: settings.progressReportCompleteStatus ?? 'done',
  progressReportRequireDescription: settings.progressReportRequireDescription ?? false,
  progressReportStartsWork: settings.progressReportStartsWork ?? true,
  autoArchive: settings.autoArchive,
  reopenProject: settings.reopenProject,
  chatOnArchived: settings.chatOnArchived,
  procedureLink: { ...DEFAULT_PROCEDURE_LINK_SETTINGS, ...settings.procedureLink },
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
    if (draft.defaultProgressMethod !== (settings.defaultProgressMethod ?? DEFAULT_PROJECT_PROGRESS_METHOD)) {
      changes.defaultProgressMethod = draft.defaultProgressMethod;
    }
    const saved = draftOf(settings);
    if (draft.progressReportCompleteStatus !== saved.progressReportCompleteStatus) {
      changes.progressReportCompleteStatus = draft.progressReportCompleteStatus;
    }
    if (draft.progressReportRequireDescription !== saved.progressReportRequireDescription) {
      changes.progressReportRequireDescription = draft.progressReportRequireDescription;
    }
    if (draft.progressReportStartsWork !== saved.progressReportStartsWork) {
      changes.progressReportStartsWork = draft.progressReportStartsWork;
    }
    if (draft.autoArchive !== settings.autoArchive) changes.autoArchive = draft.autoArchive;
    if (draft.reopenProject !== settings.reopenProject) changes.reopenProject = draft.reopenProject;
    if (draft.chatOnArchived !== settings.chatOnArchived) changes.chatOnArchived = draft.chatOnArchived;
    const changedLink: { -readonly [K in keyof ProcedureLinkSettings]?: ProcedureLinkSettings[K] } = {};
    for (const key of Object.keys(draft.procedureLink) as (keyof ProcedureLinkSettings)[]) {
      if (draft.procedureLink[key] !== saved.procedureLink[key]) {
        (changedLink as Record<string, string>)[key] = draft.procedureLink[key];
      }
    }
    if (Object.keys(changedLink).length > 0) changes.procedureLink = changedLink;
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
  const link = draft.procedureLink;
  return (
    <div className={styles.gsStack}>
      <SettingsCard title="Tạo dự án">
        <div className={`${styles.gsRow} ${styles.gsRowStack}`}>
          <div className={styles.gsRowText}>
            <strong>Cách tính tiến độ dự án mặc định</strong>
          </div>
          <RadioChoices
            name="default-progress-method"
            value={draft.defaultProgressMethod}
            options={PROGRESS_METHOD_ORDER.map((method) => ({ value: method, ...PROGRESS_METHOD_INFO[method] }))}
            disabled={locked}
            onChange={(defaultProgressMethod) => update({ defaultProgressMethod })}
          />
        </div>
        <SettingRow
          label="Tự tạo sẵn công việc khi tạo dự án"
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
            <span>Tối đa 30 công việc cấp gốc, tạo theo thứ tự này.</span>
          </div>
          <TaskTitleListEditor
            idPrefix="Công việc mẫu"
            titles={draft.defaultTaskTitles}
            disabled={locked}
            emptyText="Danh sách đang trống."
            onChange={(defaultTaskTitles) => update({ defaultTaskTitles })}
            extraActions={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => update({ defaultTaskTitles: [...DEFAULT_PROJECT_TASK_TITLES] })}
              >
                Dùng mẫu gợi ý
              </Button>
            }
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Báo cáo tiến độ công việc">
        <div className={`${styles.gsRow} ${styles.gsRowStack}`}>
          <div className={styles.gsRowText}>
            <strong>Khi báo tiến độ 100%</strong>
            <span>Việc có điều kiện hoàn thành vẫn phải bấm Hoàn thành.</span>
          </div>
          <RadioChoices
            name="report-complete-status"
            value={draft.progressReportCompleteStatus}
            options={REPORT_COMPLETE_STATUS_OPTIONS}
            disabled={locked}
            onChange={(progressReportCompleteStatus) => update({ progressReportCompleteStatus })}
          />
        </div>
        <SettingRow
          label="Bắt buộc ghi mô tả khi báo hoàn thành"
          control={
            <Switch
              label="Bắt buộc mô tả khi báo hoàn thành"
              checked={draft.progressReportRequireDescription}
              disabled={locked}
              onChange={(progressReportRequireDescription) => update({ progressReportRequireDescription })}
            />
          }
        />
        <SettingRow
          label="Tự chuyển sang Đang làm khi báo tiến độ"
          control={
            <Switch
              label="Tự chuyển sang Đang làm khi báo tiến độ"
              checked={draft.progressReportStartsWork}
              disabled={locked}
              onChange={(progressReportStartsWork) => update({ progressReportStartsWork })}
            />
          }
        />
      </SettingsCard>

      <SettingsCard title="Lưu trữ dự án">
        <SettingRow
          label="Tự đóng hồ sơ khi mọi công việc đã xong"
          hint="Đóng hồ sơ thủ công vẫn dùng được khi còn việc chưa xong."
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
            <strong>{'Khi mở lưu trữ dự án đã "Hoàn thành"'}</strong>
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

      <ProcedureLinkSettingsCard
        link={link}
        saved={draftOf(settings).procedureLink}
        locked={locked}
        onChange={(next) => update({ procedureLink: next })}
      />

      {/* Thanh lưu chung: luôn có mặt, chỉ đổi trạng thái bật tắt nên bố cục không xê dịch. */}
      <div className={styles.gsActionBar}>
        <span className={`${styles.gsActionHint} ${dirty ? styles.gsActionHintDirty : ''}`}>
          {!settings.canEdit
            ? 'Chỉ quản trị viên được đổi cấu hình này.'
            : dirty
              ? 'Có thay đổi chưa lưu.'
              : 'Chưa có thay đổi nào.'}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={!dirty || locked}
          onClick={() => setDraft(draftOf(settings))}
        >
          Hoàn tác
        </Button>
        <Button type="button" disabled={!dirty || locked} onClick={() => void save()}>
          {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
        </Button>
      </div>
    </div>
  );
}
