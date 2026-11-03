'use client';

import {
  PROMOTION_KIND_LABELS,
  type OpportunityPromotion,
  type PromotionCatalogItem,
} from '@enterprise-platform/contracts-crm';
import {
  Popconfirm,
  SearchableSelect,
  toast,
} from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Field } from '../components/crm-ui';
import {
  addOpportunityPromotion,
  errorMessage,
  listOpportunityPromotions,
  listPromotionCatalog,
  removeOpportunityPromotion,
} from '../crm-api';
import {
  PROMOTION_NOT_DEDUCTED_NOTE,
  promotionOption,
  promotionStateLabel,
  promotionValueLabel,
  selectableCatalog,
  todayIso,
} from '../promotions.model';
import styles from '../sales.module.scss';

/**
 * Khuyến mãi của dự án: các lựa chọn lấy từ danh mục Cài đặt, báo giá của dự án chọn lại từ tập này.
 * Nút thêm, bỏ chỉ hiện khi `canEdit`; server vẫn kiểm quyền.
 */
export function OpportunityPromotionsPanel({
  opportunityId,
  canEdit,
}: {
  opportunityId: string;
  canEdit: boolean;
}) {
  const [items, setItems] = useState<readonly OpportunityPromotion[]>([]);
  const [catalog, setCatalog] = useState<readonly PromotionCatalogItem[]>([]);
  const [catalogId, setCatalogId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    () =>
      listOpportunityPromotions(opportunityId)
        .then((rows) => {
          setItems(rows);
          setError(undefined);
        })
        .catch((cause) =>
          setError(errorMessage(cause, 'Không tải được khuyến mãi của dự án.')),
        ),
    [opportunityId],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!canEdit) return;
    // Lỗi tải danh mục chỉ làm trống ô chọn; người dùng vẫn xem được danh sách đã chọn.
    listPromotionCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [canEdit]);

  const options = useMemo(
    () =>
      selectableCatalog(
        catalog,
        new Set(items.map((item) => item.catalog.id)),
      ).map(promotionOption),
    [catalog, items],
  );

  async function add() {
    if (!catalogId) return;
    setBusy(true);
    try {
      setItems(
        await addOpportunityPromotion(opportunityId, {
          catalogId,
          note: note.trim() || null,
        }),
      );
      setCatalogId('');
      setNote('');
      toast.success('Đã thêm khuyến mãi vào dự án.');
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thêm được khuyến mãi.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(linkId: string) {
    try {
      setItems(await removeOpportunityPromotion(opportunityId, linkId));
      toast.success('Đã bỏ khuyến mãi khỏi dự án.');
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không bỏ được khuyến mãi.'));
    }
  }

  const today = todayIso();
  return (
    <section className={styles.panel} aria-label="Khuyến mãi của dự án">
      <h4 className={styles.sectionTitle}>Khuyến mãi của dự án</h4>
      <p className={styles.muted}>{PROMOTION_NOT_DEDUCTED_NOTE}</p>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.catalog.name}</strong> ({item.catalog.code}) ·{' '}
              {PROMOTION_KIND_LABELS[item.catalog.kind]} ·{' '}
              {promotionValueLabel(item.catalog)} ·{' '}
              {promotionStateLabel(item.catalog, today)}
              {item.note ? (
                <span className={styles.muted}> · {item.note}</span>
              ) : null}{' '}
              {canEdit ? (
                <Popconfirm
                  title="Bỏ khuyến mãi này khỏi dự án?"
                  okText="Bỏ"
                  cancelText="Huỷ"
                  okType="danger"
                  onConfirm={() => remove(item.id)}
                >
                  <button type="button" className={styles.rowActionDanger}>
                    Bỏ khuyến mãi
                  </button>
                </Popconfirm>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>Dự án chưa có khuyến mãi nào.</p>
      )}
      {canEdit ? (
        <div className={styles.fieldGrid}>
          <Field label="Khuyến mãi hoặc chính sách chiết khấu">
            <SearchableSelect
              options={options}
              value={catalogId}
              placeholder="Chọn từ danh mục còn hiệu lực"
              emptyText="Không còn mục nào để thêm. Cấu hình danh mục ở Cài đặt."
              onChange={setCatalogId}
            />
          </Field>
          <Field label="Ghi chú">
            <input
              aria-label="Ghi chú khuyến mãi"
              className={styles.input}
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <button
            type="button"
            className={styles.buttonGhost}
            disabled={!catalogId || busy}
            onClick={() => void add()}
          >
            Thêm khuyến mãi
          </button>
        </div>
      ) : null}
    </section>
  );
}
