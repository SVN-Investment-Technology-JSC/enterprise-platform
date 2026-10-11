'use client';

import type {
  MaintenanceFrequencyCatalog,
  MaintenanceFrequencyOption,
} from '@enterprise-platform/contracts-maintenance';
import { MinimalPopupForm, Popconfirm } from '@enterprise-platform/shared-ui';
import {
  AlertCircle,
  Calendar,
  Clock,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import styles from './frequency-catalog-editor.module.scss';

const UNIT_LABEL: Readonly<Record<MaintenanceFrequencyOption['intervalUnit'], string>> = {
  day: 'ngày',
  week: 'tuần',
  month: 'tháng',
  year: 'năm',
};

/** Bỏ dấu và chuẩn hoá nhãn thành mã. */
function toCode(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface FrequencyCatalogEditorProps {
  readonly value: MaintenanceFrequencyCatalog;
  /** Mã tần suất đang được ít nhất một lịch dùng. */
  readonly usedCodes: ReadonlySet<string>;
  readonly disabled?: boolean;
  readonly onChange: (next: MaintenanceFrequencyCatalog) => void;
}

export function FrequencyCatalogEditor({
  value,
  usedCodes,
  disabled,
  onChange,
}: FrequencyCatalogEditorProps) {
  const [filterText, setFilterText] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Trạng thái modal thêm mới
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCount, setNewCount] = useState(1);
  const [newUnit, setNewUnit] = useState<MaintenanceFrequencyOption['intervalUnit']>('month');
  const [newIsActive, setNewIsActive] = useState(true);
  const [addError, setAddError] = useState<string>();

  const setOptions = (options: MaintenanceFrequencyOption[]) =>
    onChange({ options: options.map((option, index) => ({ ...option, sortOrder: index + 1 })) });

  const patch = (index: number, change: Partial<MaintenanceFrequencyOption>) => {
    const next = [...value.options];
    next[index] = { ...next[index], ...change };
    setOptions(next);
  };

  const openAddModal = () => {
    setNewLabel('');
    setNewCount(1);
    setNewUnit('month');
    setNewIsActive(true);
    setAddError(undefined);
    setIsAddOpen(true);
  };

  const handleAddSubmit = () => {
    const trimmedLabel = newLabel.trim();
    if (!trimmedLabel) {
      setAddError('Vui lòng nhập tên tần suất bảo trì.');
      return;
    }

    if (value.options.some((o) => o.label.toLowerCase() === trimmedLabel.toLowerCase())) {
      setAddError('Tên tần suất này đã tồn tại.');
      return;
    }

    const taken = new Set(value.options.map((option) => option.code));
    const stem = toCode(trimmedLabel) || 'tan-suat';
    let code = stem;
    let suffix = 2;
    while (taken.has(code)) code = `${stem}-${suffix++}`;

    setOptions([
      ...value.options,
      {
        code,
        label: trimmedLabel,
        intervalUnit: newUnit,
        intervalCount: Math.max(1, newCount),
        sortOrder: value.options.length + 1,
        isActive: newIsActive,
      },
    ]);

    setIsAddOpen(false);
  };

  // Thống kê nhanh
  const totalCount = value.options.length;
  const activeCount = value.options.filter((o) => o.isActive).length;
  const inUseCount = value.options.filter((o) => usedCodes.has(o.code)).length;

  // Lọc dữ liệu
  const filteredOptions = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    return value.options.filter((option) => {
      const inUse = usedCodes.has(option.code);
      if (filterStatus === 'active' && !option.isActive) return false;
      if (filterStatus === 'inactive' && option.isActive) return false;
      if (filterStatus === 'in_use' && !inUse) return false;
      if (filterStatus === 'unused' && inUse) return false;

      if (!query) return true;
      return (
        option.label.toLowerCase().includes(query) ||
        option.code.toLowerCase().includes(query) ||
        UNIT_LABEL[option.intervalUnit].toLowerCase().includes(query)
      );
    });
  }, [value.options, filterText, filterStatus, usedCodes]);

  // Phân trang
  const totalRecords = filteredOptions.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRecords);
  const paginatedOptions = filteredOptions.slice(startIndex, endIndex);

  return (
    <div className={styles.freqContainer}>
      {/* Thẻ thống kê tổng quan */}
      <div className={styles.statsRow}>
        <div className={styles.statBadge}>
          <Clock size={14} />
          <span>Tổng số tần suất:</span>
          <strong>{totalCount}</strong>
        </div>
        <div className={`${styles.statBadge} ${styles.statBadgeActive}`}>
          <Calendar size={14} />
          <span>Đang kích hoạt:</span>
          <strong>{activeCount}</strong>
        </div>
        <div className={`${styles.statBadge} ${styles.statBadgeInUse}`}>
          <AlertCircle size={14} />
          <span>Đang có lịch dùng:</span>
          <strong>{inUseCount}</strong>
        </div>
      </div>

      {/* Khung Bảng Chuẩn 3 Vùng */}
      <div className={styles.tableCard}>
        {/* Vùng 1: Header Controls Bar */}
        <div className={styles.tableControlsBar}>
          <div className={styles.tableControlsLeft}>
            <div className={styles.tableSearchBox}>
              <span className={styles.tableSearchIcon}>
                <Search size={14} />
              </span>
              <input
                className={styles.tableSearchInput}
                value={filterText}
                placeholder="Tìm mã hoặc tên tần suất…"
                aria-label="Tìm kiếm tần suất"
                onChange={(e) => {
                  setFilterText(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>

            <select
              className={styles.tableSelectFilter}
              value={filterStatus}
              aria-label="Lọc theo trạng thái"
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang kích hoạt</option>
              <option value="inactive">Đang tắt</option>
              <option value="in_use">Đang có lịch gán</option>
              <option value="unused">Chưa có lịch gán</option>
            </select>

            {(filterText || filterStatus !== 'all') && (
              <button
                type="button"
                className={styles.tableResetBtn}
                onClick={() => {
                  setFilterText('');
                  setFilterStatus('all');
                  setCurrentPage(1);
                }}
              >
                <RotateCcw size={12} />
                <span>Đặt lại</span>
              </button>
            )}
          </div>

          <div className={styles.tableControlsRight}>
            <button
              type="button"
              className={styles.actionAddBtn}
              disabled={disabled}
              onClick={openAddModal}
            >
              <Plus size={15} strokeWidth={2.5} />
              <span>Thêm tần suất</span>
            </button>
          </div>
        </div>

        {/* Vùng 2: Thân Bảng Dữ Liệu */}
        <div className={styles.tableResponsiveWrap}>
          <table className={styles.standardTable}>
            <thead>
              <tr>
                <th className={styles.colOrder}>STT</th>
                <th className={styles.colStatus}>Bật/Tắt</th>
                <th>Mã tần suất</th>
                <th>Tên hiển thị</th>
                <th>Chu kỳ lặp lại</th>
                <th>Tình trạng sử dụng</th>
                <th className={styles.actionCell}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {paginatedOptions.map((option, pageIdx) => {
                const globalIndex = value.options.findIndex((o) => o.code === option.code);
                const inUse = usedCodes.has(option.code);
                const stt = startIndex + pageIdx + 1;

                return (
                  <tr
                    key={option.code}
                    className={!option.isActive ? styles.tableRowDisabled : undefined}
                  >
                    <td className={styles.colOrder}>{stt}</td>
                    <td className={styles.colStatus}>
                      <label className={styles.switchWrap} title={option.isActive ? 'Tắt tần suất này' : 'Bật tần suất này'}>
                        <input
                          type="checkbox"
                          className={styles.switchInput}
                          checked={option.isActive}
                          disabled={disabled}
                          aria-label={`Bật tắt ${option.label}`}
                          onChange={(e) => patch(globalIndex, { isActive: e.target.checked })}
                        />
                      </label>
                    </td>
                    <td>
                      <span className={styles.codeBadge} title="Mã định danh duy nhất tham chiếu trong lịch">
                        {option.code}
                      </span>
                    </td>
                    <td>
                      <input
                        className={styles.labelInput}
                        value={option.label}
                        disabled={disabled}
                        placeholder="Tên tần suất…"
                        aria-label={`Tên tần suất ${option.code}`}
                        onChange={(e) => patch(globalIndex, { label: e.target.value })}
                      />
                    </td>
                    <td>
                      <div className={styles.cycleEditor}>
                        <span className={styles.cyclePrefix}>Mỗi</span>
                        <input
                          type="number"
                          min={1}
                          className={styles.countInput}
                          value={option.intervalCount}
                          disabled={disabled}
                          aria-label={`Số kỳ của ${option.label}`}
                          onChange={(e) =>
                            patch(globalIndex, {
                              intervalCount: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                        />
                        <select
                          className={styles.unitSelect}
                          value={option.intervalUnit}
                          disabled={disabled}
                          aria-label={`Đơn vị chu kỳ của ${option.label}`}
                          onChange={(e) =>
                            patch(globalIndex, {
                              intervalUnit: e.target.value as MaintenanceFrequencyOption['intervalUnit'],
                            })
                          }
                        >
                          {(['day', 'week', 'month', 'year'] as const).map((unit) => (
                            <option key={unit} value={unit}>
                              {UNIT_LABEL[unit]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td>
                      {inUse ? (
                        <span
                          className={styles.inUseBadge}
                          title="Đang có lịch bảo trì sử dụng tần suất này"
                        >
                          <span className={styles.inUseDot} />
                          <span>Đang dùng</span>
                        </span>
                      ) : (
                        <span
                          className={styles.notInUseBadge}
                          title="Chưa có lịch bảo trì nào liên kết với tần suất này"
                        >
                          <span className={styles.notInUseDot} />
                          <span>Chưa gán</span>
                        </span>
                      )}
                    </td>
                    <td className={styles.actionCell}>
                      <Popconfirm
                        title={`Xoá tần suất "${option.label}"?`}
                        description={
                          inUse
                            ? 'Tần suất này đang có lịch sử dụng nên không thể xoá. Hãy chuyển trạng thái sang Tắt thay vì xoá.'
                            : 'Hành động này sẽ loại bỏ tần suất khỏi danh mục chu kỳ bảo trì.'
                        }
                        okText="Xoá"
                        cancelText="Huỷ"
                        okType="danger"
                        disabled={disabled || inUse}
                        placement="top-end"
                        onConfirm={() => {
                          setOptions(value.options.filter((o) => o.code !== option.code));
                        }}
                      >
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          disabled={disabled || inUse}
                          aria-label={`Xoá ${option.label}`}
                          title={
                            inUse
                              ? 'Đang có lịch dùng tần suất này — tắt thay vì xoá, nếu không lịch đó mất cách tính ngày đến hạn.'
                              : 'Xoá tần suất khỏi danh mục'
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </Popconfirm>
                    </td>
                  </tr>
                );
              })}
              {paginatedOptions.length === 0 && (
                <tr>
                  <td colSpan={7} className={styles.emptyRow}>
                    Không tìm thấy tần suất bảo trì nào phù hợp với bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Vùng 3: Footer Chân Bảng Đồng Bộ */}
        <div className={styles.tableFooterBar}>
          <div className={styles.tableFooterLeft}>
            <div className={styles.tableTotalRecords}>
              Hiển thị{' '}
              <strong>
                {totalRecords > 0 ? startIndex + 1 : 0}–{endIndex}
              </strong>{' '}
              / <strong>{totalRecords}</strong> tần suất
            </div>

            <label className={styles.tablePageSizeLabel}>
              Hiển thị:
              <select
                className={styles.tablePageSizeSelect}
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                <option value={5}>5 / trang</option>
                <option value={10}>10 / trang</option>
                <option value={15}>15 / trang</option>
                <option value={30}>30 / trang</option>
              </select>
            </label>
          </div>

          <div className={styles.tableFooterRight}>
            <div className={styles.tablePaginationGroup}>
              <button
                type="button"
                className={styles.tablePageBtn}
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                ← Trước
              </button>
              <span className={styles.tablePageIndicator}>
                {safeCurrentPage} / {totalPages}
              </span>
              <button
                type="button"
                className={styles.tablePageBtn}
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Sau →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Minimal Popup Form Thêm Tần Suất Mới */}
      <MinimalPopupForm
        isOpen={isAddOpen}
        title="Thêm tần suất bảo trì mới"
        subtitle="Định nghĩa chu kỳ và khoảng thời gian tính hạn lặp lại cho lịch bảo trì."
        onClose={() => setIsAddOpen(false)}
      >
        <div className={styles.popupFormContent}>
          {addError && (
            <p style={{ color: '#dc2626', fontSize: '13px', margin: 0 }}>{addError}</p>
          )}

          <div className={styles.formField}>
            <label htmlFor="freq-label">Tên tần suất hiển thị *</label>
            <input
              id="freq-label"
              value={newLabel}
              placeholder="VD: Định kỳ 2 tuần, Kiểm tra quý 3…"
              autoFocus
              onChange={(e) => {
                setNewLabel(e.target.value);
                if (addError) setAddError(undefined);
              }}
            />
            <p className={styles.formHint}>
              Mã hệ thống tự sinh: <code>{toCode(newLabel) || 'tan-suat-moi'}</code>
            </p>
          </div>

          <div className={styles.formFieldRow}>
            <div className={styles.formField}>
              <label htmlFor="freq-count">Số lượng kỳ *</label>
              <input
                id="freq-count"
                type="number"
                min={1}
                value={newCount}
                onChange={(e) => setNewCount(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>

            <div className={styles.formField}>
              <label htmlFor="freq-unit">Đơn vị chu kỳ *</label>
              <select
                id="freq-unit"
                value={newUnit}
                onChange={(e) =>
                  setNewUnit(e.target.value as MaintenanceFrequencyOption['intervalUnit'])
                }
              >
                {(['day', 'week', 'month', 'year'] as const).map((unit) => (
                  <option key={unit} value={unit}>
                    {UNIT_LABEL[unit]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className={styles.formCheckboxLabel}>
            <input
              type="checkbox"
              checked={newIsActive}
              onChange={(e) => setNewIsActive(e.target.checked)}
            />
            <span>Kích hoạt tần suất ngay sau khi tạo</span>
          </label>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.btnCancel}
              onClick={() => setIsAddOpen(false)}
            >
              Huỷ
            </button>
            <button
              type="button"
              className={styles.btnSubmit}
              onClick={handleAddSubmit}
            >
              Thêm tần suất
            </button>
          </div>
        </div>
      </MinimalPopupForm>
    </div>
  );
}

