'use client';

import {
  formatBytes,
  SHARED_CONFIDENTIALITY_LABELS,
  SHARED_CONFIDENTIALITY_LEVELS,
  SHARED_DOCUMENT_MAX_BYTES,
  type SharedConfidentiality,
  type SharedFolder,
} from '@enterprise-platform/contracts-shared';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { planFolderUpload, type UploadJob, type UploadSkip } from '../folder-upload.model';
import { nameFromFile, parseTags } from '../library.model';
import * as api from '../shared-api';
import styles from '../shared.module.scss';
import { runUpload, type UploadFailure, type UploadRunnerApi } from '../upload-runner';
import { Dialog, Field, SelectField } from './dialog';
import { folderOptions, recordDraft, RecordFields, recordPayload, type RecordDraft } from './record-fields';

export const CONFIDENTIALITY_OPTIONS = SHARED_CONFIDENTIALITY_LEVELS.map((level) => ({
  value: level,
  label: SHARED_CONFIDENTIALITY_LABELS[level],
}));

/** Danh sách dài chỉ hiện chừng này dòng, phần còn lại gộp thành một con số. */
const LIST_LIMIT = 200;

export type UploadMode = 'files' | 'folder';

/** Kết quả một lượt tải, để màn hình làm mới và chọn đúng mục. */
export interface UploadSummary {
  readonly folderId: string;
  readonly uploaded: number;
  /** Tệp đã có trong thư mục nên không tải lại. */
  readonly skipped: number;
  /** Thư mục vừa tải lên, hoặc tài liệu cuối cùng khi tải tệp. */
  readonly select?: { readonly type: 'folder' | 'document'; readonly id: string };
}

export interface UploadDialogProps {
  readonly open: boolean;
  /** `folder` ("Tải thư mục lên"): mở là bật ngay hộp chọn thư mục của máy. */
  readonly mode?: UploadMode;
  readonly folders: readonly SharedFolder[];
  /** Thư mục người dùng tải lên được. */
  readonly writable: (folder: SharedFolder) => boolean;
  readonly defaultFolderId?: string;
  readonly onClose: () => void;
  /** Gọi sau mỗi lượt có tệp lên xong hoặc được bỏ qua vì đã có. */
  readonly onUploaded: (summary: UploadSummary) => void;
}

interface Progress {
  readonly done: number;
  readonly total: number;
  readonly current?: string;
}

interface LastRun {
  readonly skipped: readonly UploadSkip[];
  readonly failures: readonly UploadFailure[];
}

/**
 * Tải tệp, hoặc cả một thư mục, vào một thư mục của kho. Mọi định dạng đều nhận.
 *
 * Nhiều tệp thì mỗi tệp thành một tài liệu mang tên tệp; thông tin hồ sơ nhập ở
 * đây áp cho tất cả. Chọn thư mục thì dựng lại đủ cây thư mục con rồi tải từng
 * tệp vào đúng chỗ. Tệp lỗi không dừng cả lượt: hết lượt thì liệt kê để tải lại.
 */
export function UploadDialog({
  open,
  mode = 'files',
  folders,
  writable,
  defaultFolderId,
  onClose,
  onUploaded,
}: UploadDialogProps) {
  const [folderId, setFolderId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fromFolder, setFromFolder] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [confidentiality, setConfidentiality] = useState<SharedConfidentiality>('internal');
  const [tags, setTags] = useState('');
  const [record, setRecord] = useState<RecordDraft>(recordDraft());
  const [progress, setProgress] = useState<Progress>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [lastRun, setLastRun] = useState<LastRun>();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  // Thư mục đã dựng ở lượt trước, theo đường dẫn: "Tải lại" không dựng lại.
  const folderIds = useRef<ReadonlyMap<string, string>>(new Map());
  const stopped = useRef(false);

  const options = useMemo(() => folderOptions(folders, undefined, writable), [folders, writable]);
  const targetDepth = folders.find((folder) => folder.id === folderId)?.depth ?? 0;

  const bindFolderInput = useCallback((node: HTMLInputElement | null) => {
    folderInput.current = node;
    // `webkitdirectory` chưa có trong kiểu của React: đặt thẳng lên phần tử.
    node?.setAttribute('webkitdirectory', '');
  }, []);

  useEffect(() => {
    if (!open) return;
    // Thư mục đang mở mà không có quyền ghi thì để người dùng tự chọn.
    setFolderId(defaultFolderId && options.some((option) => option.value === defaultFolderId) ? defaultFolderId : '');
    setFiles([]);
    setFromFolder(false);
    setName('');
    setDescription('');
    setEffectiveFrom('');
    setConfidentiality('internal');
    setTags('');
    setRecord(recordDraft());
    setProgress(undefined);
    setSubmitting(false);
    setError(undefined);
    setLastRun(undefined);
    folderIds.current = new Map();
    // "Tải thư mục lên": mở hộp chọn của máy ngay, vẫn trong lượt bấm của người dùng.
    if (mode === 'folder') folderInput.current?.click();
    // Chỉ chạy khi mở hộp thoại; danh sách thư mục nạp lại giữa chừng không xoá những gì đã nhập.
  }, [open, defaultFolderId, mode]);

  const plan = useMemo(
    () => (fromFolder ? planFolderUpload(files, targetDepth) : undefined),
    [fromFolder, files, targetDepth],
  );
  const jobs: readonly UploadJob[] = plan?.jobs ?? files.map((file) => ({ file, path: file.name, folderPath: '' }));
  const single = !fromFolder && files.length === 1;
  const tooLarge = fromFolder ? undefined : files.find((file) => file.size > SHARED_DOCUMENT_MAX_BYTES);
  const retry = lastRun?.failures.length ? lastRun.failures.map((failure) => failure.job) : undefined;
  const total = retry?.length ?? jobs.length;

  const startOver = () => {
    setLastRun(undefined);
    setError(undefined);
    folderIds.current = new Map();
  };

  const pick = (list: FileList | null, folder: boolean) => {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    setFiles(picked);
    setFromFolder(folder);
    startOver();
    if (!folder && picked.length === 1 && !name.trim()) setName(nameFromFile(picked[0].name));
  };

  const runnerApi: UploadRunnerApi = {
    createFolder: (parentId, folderName) => api.createFolder({ parentId, name: folderName }),
    listFolders: () => api.listFolders(),
    listDocuments: (id) => api.listDocuments({ folderId: id }),
    uploadDocument: async (id, documentName, file) => {
      const created = await api.uploadDocument(
        {
          folderId: id,
          name: documentName,
          description: description.trim() || undefined,
          effectiveFrom: effectiveFrom || undefined,
          confidentiality,
          tags: parseTags(tags),
          ...recordPayload(record),
        },
        file,
      );
      return created.document.id;
    },
    resumeDocument: async (documentId, file) => {
      await api.uploadVersion(documentId, file, 'Tải lại tệp chưa lên xong');
      return documentId;
    },
  };

  const submit = async () => {
    stopped.current = false;
    setSubmitting(true);
    setError(undefined);
    try {
      const outcome = await runUpload(runnerApi, {
        targetFolderId: folderId,
        knownFolders: folders,
        folders: plan?.folders ?? [],
        jobs: retry ?? jobs,
        folderIds: folderIds.current,
        exactName: single ? name.trim() : undefined,
        shouldStop: () => stopped.current,
        onProgress: (done, count, current) => setProgress({ done, total: count, current }),
      });
      folderIds.current = outcome.folderIds;
      const rootId = plan?.folders[0] ? outcome.folderIds.get(plan.folders[0].path) : undefined;
      if (outcome.uploaded > 0 || outcome.skipped.length > 0) {
        onUploaded({
          folderId,
          uploaded: outcome.uploaded,
          skipped: outcome.skipped.length,
          select: rootId
            ? { type: 'folder', id: rootId }
            : outcome.lastDocumentId
              ? { type: 'document', id: outcome.lastDocumentId }
              : undefined,
        });
      }
      if (outcome.failures.length === 0) {
        onClose();
      } else if (single && !outcome.failures[0].job.pendingDocumentId) {
        // Một tệp với tên tự đặt, chưa tạo được tài liệu (vd. trùng tên): báo như lỗi của form để sửa rồi gửi lại.
        setError(outcome.failures[0].reason);
      } else {
        setLastRun({
          skipped: [...(lastRun?.skipped ?? plan?.skipped ?? []), ...outcome.skipped],
          failures: outcome.failures,
        });
      }
    } catch (cause) {
      // Lỗi khi dựng thư mục: chưa tệp nào được tải.
      setError(api.errorMessage(cause, 'Không tải lên được.'));
    } finally {
      setSubmitting(false);
      setProgress(undefined);
    }
  };

  const skippedRows = lastRun?.skipped ?? plan?.skipped ?? [];
  const title = fromFolder || (mode === 'folder' && files.length === 0) ? 'Tải thư mục lên' : 'Tải tài liệu lên';

  return (
    <Dialog
      open={open}
      title={title}
      submitLabel={retry ? `Tải lại ${total} tệp` : total > 1 ? `Tải lên ${total} tệp` : 'Tải lên'}
      submittingLabel={progress ? `Đang tải ${progress.done}/${progress.total}` : 'Đang tải…'}
      submitting={submitting}
      submitDisabled={!folderId || total === 0 || Boolean(tooLarge) || Boolean(plan?.problem) || (single && !name.trim())}
      error={
        error ??
        plan?.problem ??
        (tooLarge ? `${tooLarge.name} vượt quá ${formatBytes(SHARED_DOCUMENT_MAX_BYTES)}.` : undefined)
      }
      onClose={onClose}
      onStop={() => {
        stopped.current = true;
      }}
      onSubmit={() => void submit()}
    >
      <SelectField label="Thư mục" required>
        <SearchableSelect
          clearable={false}
          options={options}
          value={folderId}
          placeholder="Chọn thư mục"
          onChange={(value) => {
            setFolderId(value);
            startOver();
          }}
        />
      </SelectField>
      <SelectField label="Tệp" required>
        <div className={styles.pickRow}>
          <button
            type="button"
            className={styles.buttonGhost}
            disabled={submitting}
            onClick={() => fileInput.current?.click()}
          >
            Chọn tệp
          </button>
          <button
            type="button"
            className={styles.buttonGhost}
            disabled={submitting}
            onClick={() => folderInput.current?.click()}
          >
            Chọn thư mục
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label="Chọn tệp"
          onChange={(event) => {
            pick(event.target.files, false);
            event.target.value = '';
          }}
        />
        <input
          ref={bindFolderInput}
          type="file"
          multiple
          hidden
          aria-label="Chọn thư mục"
          onChange={(event) => {
            pick(event.target.files, true);
            event.target.value = '';
          }}
        />
      </SelectField>
      {plan?.folders[0] ? (
        <p className={styles.uploadSummary}>
          <strong>{plan.folders[0].name}</strong> · {plan.folders.length} thư mục · {plan.jobs.length} tệp ·{' '}
          {formatBytes(plan.totalBytes)}
        </p>
      ) : null}
      {single ? (
        <p className={styles.uploadSummary}>
          {files[0].name} · {formatBytes(files[0].size)}
        </p>
      ) : jobs.length > 1 && !lastRun ? (
        <PathList rows={jobs.map((job) => ({ path: job.path, note: formatBytes(job.file.size) }))} />
      ) : null}
      {lastRun ? (
        <PathList
          title={`Chưa tải được ${lastRun.failures.length} tệp`}
          rows={lastRun.failures.map((failure) => ({ path: failure.job.path, note: failure.reason }))}
        />
      ) : null}
      {skippedRows.length > 0 ? (
        <PathList
          title={`Bỏ qua ${skippedRows.length} tệp`}
          rows={skippedRows.map((skip) => ({ path: skip.path, note: skip.reason }))}
        />
      ) : null}
      {single ? (
        <Field label="Tên tài liệu" required>
          <input value={name} maxLength={255} onChange={(event) => setName(event.target.value)} />
        </Field>
      ) : null}
      <RecordFields draft={record} onChange={setRecord} />
      <div className={styles.fieldRow}>
        <Field label="Hiệu lực từ">
          <input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
        </Field>
        <SelectField label="Độ mật">
          <SearchableSelect
            options={CONFIDENTIALITY_OPTIONS}
            value={confidentiality}
            clearable={false}
            onChange={(value) => setConfidentiality((value || 'internal') as SharedConfidentiality)}
          />
        </SelectField>
      </div>
      <Field label="Thẻ">
        <input value={tags} onChange={(event) => setTags(event.target.value)} />
      </Field>
      <Field label="Mô tả">
        <textarea rows={2} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      {progress ? (
        <div className={styles.uploadProgress}>
          <progress max={progress.total} value={progress.done} />
          {progress.current ? <span>{progress.current}</span> : null}
        </div>
      ) : null}
    </Dialog>
  );
}

/** Danh sách đường dẫn kèm ghi chú (dung lượng, lý do), cắt bớt khi quá dài. */
function PathList({ title, rows }: { readonly title?: string; readonly rows: readonly { path: string; note: string }[] }) {
  return (
    <div className={styles.pathList}>
      {title ? <span className={styles.pathListTitle}>{title}</span> : null}
      <ul className={styles.fileList}>
        {rows.slice(0, LIST_LIMIT).map((row) => (
          <li key={row.path}>
            {row.path} · {row.note}
          </li>
        ))}
        {rows.length > LIST_LIMIT ? <li>+ {rows.length - LIST_LIMIT}</li> : null}
      </ul>
    </div>
  );
}
