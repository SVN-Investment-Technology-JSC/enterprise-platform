'use client';

import { ChevronDown, ExternalLink, Loader2, RefreshCw, Workflow } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ProcedureOption } from '../procedure-api';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';
import { Tooltip } from './tooltip';

export interface ProcedureLink {
  readonly code: string;
  readonly launchUrl: string;
  readonly status?: string;
  readonly progressPercent?: number;
  readonly doneSteps?: number;
  readonly totalSteps?: number;
}

export interface ProcedureActionsProps {
  /** Quy trình người dùng được phép khởi tạo; rỗng thì mục Tạo bị mờ. */
  readonly options: readonly ProcedureOption[];
  /** Hồ sơ đã gắn vào công việc này; vắng thì mục Xem bị mờ. */
  readonly link?: ProcedureLink;
  /** Quyền ghi trong dự án. */
  readonly canWrite: boolean;
  /** Yêu cầu mở hồ sơ đã gửi, đang chờ module Quy trình: nút hiện vòng xoay và không cho gửi thêm. */
  readonly pending?: boolean;
  readonly onStart: (definitionId: string) => Promise<void>;
  /** Quy trình của hồ sơ hiện tại; loại khỏi danh sách khi đổi. */
  readonly currentDefinitionId?: string;
  /** Lý do chưa cho tạo hồ sơ (công việc đã đóng theo cài đặt của tenant...); vắng là cho tạo. */
  readonly startBlockReason?: string;
  /** Lý do chưa cho đổi quy trình (hồ sơ đã được xử lý...); vắng là cho đổi. */
  readonly changeBlockReason?: string;
  /** Vắng thì không có mục Đổi quy trình. Ném lỗi để Dialog hiện thông báo của server. */
  readonly onChange?: (definitionId: string) => Promise<void>;
}

/**
 * Nút "Quy trình" của một công việc.
 *
 * Một công việc có thể là **một hồ sơ (work order) bên module Quy trình**: mở
 * hồ sơ ở đây, còn việc chạy hồ sơ thì sang module đó. Hai lựa chọn:
 *
 * - **Tạo quy trình** — chỉ liệt kê quy trình mà chính người bấm được phân vai
 *   S, vì module Quy trình chỉ cho người có vai đó khởi tạo. Hồ sơ được mở
 *   **dưới danh nghĩa người bấm**, bằng chính phiên của họ, đúng như khi họ tự
 *   vào module Quy trình bấm mở. Workspace không bao giờ ghi hộ.
 * - **Xem quy trình** — mờ cho tới khi công việc đã gắn hồ sơ. Thấy được hay
 *   không là do module Quy trình quyết: ở đó chỉ người có liên quan tới hồ sơ
 *   mới đọc được.
 */
export function ProcedureActions({
  options,
  link,
  canWrite,
  pending = false,
  onStart,
  currentDefinitionId,
  startBlockReason,
  changeBlockReason,
  onChange,
}: ProcedureActionsProps) {
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeDefinitionId, setChangeDefinitionId] = useState('');
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState<string>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [definitionId, setDefinitionId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setMenuOpen(false);
    };
    // Pha capture: hộp chi tiết công việc chặn mousedown lan lên (stopPropagation) nên pha nổi bọt không tới document.
    document.addEventListener('mousedown', closeOutside, true);
    return () => document.removeEventListener('mousedown', closeOutside, true);
  }, [menuOpen]);

  const canStart = canWrite && options.length > 0 && !link && !pending && !startBlockReason;
  const startHint = link
    ? 'Công việc này đã gắn một hồ sơ quy trình.'
    : pending
      ? 'Đang mở hồ sơ cho công việc này; chờ vài giây.'
      : !canWrite
      ? 'Bạn không có quyền ghi trong dự án này.'
      : options.length === 0
        ? 'Bạn chưa được phân vai S ở quy trình nào đã công bố.'
        : startBlockReason;

  const submit = async () => {
    if (!definitionId) {
      setError('Hãy chọn một quy trình.');
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      await onStart(definitionId);
      setFormOpen(false);
      setDefinitionId('');
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không mở được hồ sơ quy trình.');
    } finally {
      setSubmitting(false);
    }
  };

  const changeOptions = options.filter((option) => option.id !== currentDefinitionId);
  const canChange = canWrite && Boolean(link) && !pending && !changeBlockReason && changeOptions.length > 0;
  const changeHint = !link
    ? 'Công việc chưa gắn hồ sơ quy trình nào.'
    : !canWrite
      ? 'Bạn không có quyền ghi trong dự án này.'
      : pending
        ? 'Đang mở hồ sơ cho công việc này; chờ vài giây.'
        : (changeBlockReason ??
          (changeOptions.length === 0 ? 'Không có quy trình khác để đổi sang.' : undefined));

  const submitChange = async () => {
    if (!changeDefinitionId) {
      setChangeError('Hãy chọn quy trình mới.');
      return;
    }
    if (!onChange) return;
    setChangeError(undefined);
    setChanging(true);
    try {
      await onChange(changeDefinitionId);
      setChangeOpen(false);
      setChangeDefinitionId('');
    } catch (cause) {
      setChangeError((cause as { message?: string })?.message ?? 'Không đổi được quy trình.');
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className={styles.procedureMenu} ref={box}>
      <button
        type="button"
        className={styles.buttonGhost}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-busy={pending}
        onClick={() => setMenuOpen((current) => !current)}
      >
        {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Workflow size={14} />}{' '}
        {pending ? 'Đang mở quy trình…' : 'Quy trình'}
        <ChevronDown size={13} />
      </button>

      {menuOpen ? (
        <div className={styles.procedureMenuList} role="menu">
          <Tooltip content={startHint}>
            <span className={styles.tooltipAnchor}>
              <button
                type="button"
                role="menuitem"
                disabled={!canStart}
                onClick={() => {
                  setMenuOpen(false);
                  setDefinitionId('');
                  setError(undefined);
                  setFormOpen(true);
                }}
              >
                Tạo quy trình
              </button>
            </span>
          </Tooltip>
          <Tooltip content={link ? undefined : 'Công việc chưa gắn hồ sơ quy trình nào.'}>
            <span className={styles.tooltipAnchor}>
              <button
                type="button"
                role="menuitem"
                disabled={!link}
                onClick={() => {
                  setMenuOpen(false);
                  if (link) window.open(link.launchUrl, '_blank', 'noopener');
                }}
              >
                <ExternalLink size={13} /> Xem quy trình
                {link ? <span className={styles.muted}>{link.code}</span> : null}
              </button>
            </span>
          </Tooltip>
          {onChange ? (
            <Tooltip content={changeHint}>
              <span className={styles.tooltipAnchor}>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canChange}
                  onClick={() => {
                    setMenuOpen(false);
                    setChangeDefinitionId('');
                    setChangeError(undefined);
                    setChangeOpen(true);
                  }}
                >
                  <RefreshCw size={13} /> Đổi quy trình
                </button>
              </span>
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={changeOpen}
        title="Đổi quy trình"
        submitLabel="Đổi quy trình"
        submitting={changing}
        submittingLabel="Đang đổi quy trình…"
        error={changeError}
        onClose={() => setChangeOpen(false)}
        onSubmit={() => void submitChange()}
      >
        <p>
          Hồ sơ {link?.code} sẽ bị xoá và thay bằng hồ sơ mới theo quy trình bạn chọn. Công việc giữ nguyên.
        </p>
        <Field label="Quy trình mới">
          <Choice
            label="Quy trình mới"
            value={changeDefinitionId}
            placeholder="Chọn quy trình…"
            options={changeOptions.map((option) => ({
              value: option.id,
              label: `${option.code} · ${option.name}`,
            }))}
            onChange={setChangeDefinitionId}
          />
        </Field>
      </Dialog>

      <Dialog
        open={formOpen}
        title="Tạo quy trình cho công việc"
        submitLabel="Mở hồ sơ"
        submitting={submitting}
        submittingLabel="Đang mở hồ sơ…"
        error={error}
        onClose={() => setFormOpen(false)}
        onSubmit={() => void submit()}
      >
        <Field label="Quy trình">
          <Choice
            label="Quy trình"
            value={definitionId}
            placeholder="Chọn quy trình…"
            options={options.map((option) => ({
              value: option.id,
              label: `${option.code} · ${option.name}`,
            }))}
            onChange={setDefinitionId}
          />
        </Field>
      </Dialog>
    </div>
  );
}
