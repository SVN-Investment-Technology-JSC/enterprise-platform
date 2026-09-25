'use client';

import { ChevronDown, ExternalLink, Workflow } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ProcedureOption } from '../procedure-api';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';

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
  readonly onStart: (definitionId: string) => Promise<void>;
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
export function ProcedureActions({ options, link, canWrite, onStart }: ProcedureActionsProps) {
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
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [menuOpen]);

  const canStart = canWrite && options.length > 0 && !link;
  const startHint = link
    ? 'Công việc này đã gắn một hồ sơ quy trình.'
    : !canWrite
      ? 'Bạn không có quyền ghi trong dự án này.'
      : options.length === 0
        ? 'Bạn chưa được phân vai S ở quy trình nào đã công bố.'
        : undefined;

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

  return (
    <div className={styles.procedureMenu} ref={box}>
      <button
        type="button"
        className={styles.buttonGhost}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((current) => !current)}
      >
        <Workflow size={14} /> Quy trình
        <ChevronDown size={13} />
      </button>

      {menuOpen ? (
        <div className={styles.procedureMenuList} role="menu">
          <button
            type="button"
            role="menuitem"
            disabled={!canStart}
            title={startHint}
            onClick={() => {
              setMenuOpen(false);
              setDefinitionId('');
              setError(undefined);
              setFormOpen(true);
            }}
          >
            Tạo quy trình
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!link}
            title={link ? undefined : 'Công việc chưa gắn hồ sơ quy trình nào.'}
            onClick={() => {
              setMenuOpen(false);
              if (link) window.open(link.launchUrl, '_blank', 'noopener');
            }}
          >
            <ExternalLink size={13} /> Xem quy trình
            {link ? <span className={styles.muted}>{link.code}</span> : null}
          </button>
        </div>
      ) : null}

      <Dialog
        open={formOpen}
        title="Tạo quy trình cho công việc"
        subtitle="Hồ sơ mở dưới danh nghĩa của bạn và hiện ngay bên module Quy trình."
        submitLabel="Mở hồ sơ"
        submitting={submitting}
        error={error}
        onClose={() => setFormOpen(false)}
        onSubmit={() => void submit()}
      >
        <Field
          label="Quy trình"
          hint="Chỉ hiện quy trình đã công bố mà bạn được phân vai S — vai được phép khởi tạo."
        >
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
