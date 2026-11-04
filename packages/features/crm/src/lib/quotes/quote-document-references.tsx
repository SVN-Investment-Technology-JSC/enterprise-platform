'use client';

import {
  QUOTE_DOCUMENT_SOURCE_TYPES,
  type QuoteDocumentCandidate,
  type QuoteDocumentReference,
  type QuoteDocumentSourceType,
} from '@enterprise-platform/contracts-crm';
import {
  Popconfirm,
  SearchableSelect,
  toast,
} from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useState } from 'react';
import { CrmDialog, Field } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import {
  addQuoteDocumentReference,
  errorMessage,
  getQuoteDocumentReferenceDownload,
  listQuoteDocumentCandidates,
  listQuoteDocumentReferences,
  removeQuoteDocumentReference,
} from '../crm-api';
import { formatBytes } from '../documents/documents.model';
import styles from '../sales.module.scss';

export const SOURCE_TYPE_LABELS: Readonly<
  Record<QuoteDocumentSourceType, string>
> = {
  customer: 'Khách hàng',
  opportunity: 'Dự án',
  quote: 'Báo giá khác',
};

const ALL_SOURCES = '';
const sourceOptions = [
  { value: ALL_SOURCES, label: 'Tất cả nguồn' },
  ...QUOTE_DOCUMENT_SOURCE_TYPES.map((type) => ({
    value: type,
    label: SOURCE_TYPE_LABELS[type],
  })),
];

/**
 * Tài liệu tham chiếu của báo giá: danh sách (tải, gỡ) và nút "Chọn từ tài liệu có sẵn".
 * Ẩn nút chọn, gỡ khi không có `crm.document.write`; server vẫn kiểm quyền.
 */
export function QuoteDocumentReferences({
  quoteId,
  canWrite,
}: {
  quoteId: string;
  canWrite: boolean;
}) {
  const [references, setReferences] = useState<
    readonly QuoteDocumentReference[]
  >([]);
  const [error, setError] = useState<string>();
  const [picking, setPicking] = useState(false);

  const reload = useCallback(
    () =>
      listQuoteDocumentReferences(quoteId)
        .then((rows) => {
          setReferences(rows);
          setError(undefined);
        })
        .catch((cause) =>
          setError(errorMessage(cause, 'Không tải được tài liệu tham chiếu.')),
        ),
    [quoteId],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function download(reference: QuoteDocumentReference) {
    try {
      const ticket = await getQuoteDocumentReferenceDownload(
        quoteId,
        reference.id,
      );
      window.open(ticket.downloadUrl, '_blank', 'noopener');
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không tải xuống được tài liệu.'));
    }
  }

  async function remove(reference: QuoteDocumentReference) {
    try {
      setReferences(await removeQuoteDocumentReference(quoteId, reference.id));
      toast.success('Đã gỡ tài liệu khỏi báo giá.');
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không gỡ được tài liệu.'));
    }
  }

  return (
    <section className={styles.panel} aria-label="Tài liệu tham chiếu">
      <div className={styles.toolbar}>
        <h3 className={styles.sectionTitle}>Tài liệu có sẵn đính kèm</h3>
        {canWrite ? (
          <button
            type="button"
            className={styles.buttonGhost}
            onClick={() => setPicking(true)}
          >
            Chọn từ tài liệu có sẵn
          </button>
        ) : null}
      </div>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {references.length ? (
        <ul>
          {references.map((reference) => (
            <li key={reference.id}>
              <strong>{reference.document.name}</strong>
              {reference.document.sizeBytes
                ? ` (${formatBytes(reference.document.sizeBytes)})`
                : ''}
              <span className={styles.muted}>
                {' '}
                · Nguồn: {SOURCE_TYPE_LABELS[reference.source.entityType]}{' '}
                {reference.source.label}
              </span>{' '}
              <span className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.rowAction}
                  onClick={() => void download(reference)}
                >
                  Tải xuống
                </button>
                {canWrite ? (
                  <Popconfirm
                    title="Gỡ tài liệu này khỏi báo giá? Tài liệu gốc vẫn được giữ."
                    okText="Gỡ"
                    cancelText="Huỷ"
                    okType="danger"
                    onConfirm={() => remove(reference)}
                  >
                    <button type="button" className={styles.rowActionDanger}>
                      Gỡ
                    </button>
                  </Popconfirm>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>
          Chưa có tài liệu có sẵn nào được đính kèm.
        </p>
      )}
      {picking ? (
        <DocumentPickerDialog
          quoteId={quoteId}
          onClose={() => setPicking(false)}
          onChanged={(rows) => setReferences(rows)}
        />
      ) : null}
    </section>
  );
}

/** Hộp thoại chọn tài liệu có sẵn từ khách hàng, dự án hoặc báo giá khác cùng dự án. */
export function DocumentPickerDialog({
  quoteId,
  onClose,
  onChanged,
}: {
  quoteId: string;
  onClose: () => void;
  onChanged: (references: QuoteDocumentReference[]) => void;
}) {
  const [sourceType, setSourceType] = useState<string>(ALL_SOURCES);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [candidates, setCandidates] = useState<QuoteDocumentCandidate[]>();
  const [error, setError] = useState<string>();
  const [attachingId, setAttachingId] = useState<string>();

  const load = useCallback(() => {
    listQuoteDocumentCandidates(quoteId, {
      sourceType: (sourceType || undefined) as
        | QuoteDocumentSourceType
        | undefined,
      search: debounced.trim() || undefined,
    })
      .then((rows) => {
        setCandidates(rows);
        setError(undefined);
      })
      .catch((cause) => {
        setCandidates([]);
        setError(errorMessage(cause, 'Không tải được danh sách tài liệu.'));
      });
  }, [quoteId, sourceType, debounced]);
  useEffect(() => load(), [load]);

  async function attach(candidate: QuoteDocumentCandidate) {
    setAttachingId(candidate.document.id);
    try {
      onChanged(
        await addQuoteDocumentReference(quoteId, {
          documentId: candidate.document.id,
        }),
      );
      toast.success('Đã đính kèm tài liệu vào báo giá.');
      setCandidates((current) =>
        current?.map((item) =>
          item.document.id === candidate.document.id
            ? { ...item, attached: true }
            : item,
        ),
      );
    } catch (cause) {
      setError(errorMessage(cause, 'Không đính kèm được tài liệu.'));
    } finally {
      setAttachingId(undefined);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title="Chọn từ tài liệu có sẵn"
      submitLabel="Xong"
      cancelLabel="Đóng"
      error={error}
      onClose={onClose}
      onSubmit={onClose}
    >
      <div className={styles.fieldGrid}>
        <Field label="Nguồn tài liệu">
          <SearchableSelect
            options={sourceOptions}
            value={sourceType}
            onChange={setSourceType}
          />
        </Field>
        <Field label="Tìm tài liệu">
          <input
            aria-label="Tìm tài liệu"
            className={styles.input}
            value={search}
            placeholder="Tên tài liệu hoặc tên file"
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
      </div>
      {candidates === undefined ? (
        <p className={styles.muted}>Đang tải…</p>
      ) : candidates.length ? (
        <ul aria-label="Tài liệu ứng viên">
          {candidates.map((candidate) => (
            <li key={candidate.document.id}>
              <strong>{candidate.document.name}</strong>
              {candidate.document.sizeBytes
                ? ` (${formatBytes(candidate.document.sizeBytes)})`
                : ''}
              <span className={styles.muted}>
                {' '}
                · {SOURCE_TYPE_LABELS[candidate.source.entityType]}:{' '}
                {candidate.source.label}
              </span>{' '}
              {candidate.attached ? (
                <span className={`${styles.pill} ${styles.pill_success}`}>
                  Đã đính kèm
                </span>
              ) : (
                <button
                  type="button"
                  className={styles.rowAction}
                  disabled={attachingId === candidate.document.id}
                  onClick={() => void attach(candidate)}
                >
                  Đính kèm
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>Không có tài liệu nào phù hợp.</p>
      )}
    </CrmDialog>
  );
}
