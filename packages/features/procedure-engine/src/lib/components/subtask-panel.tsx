'use client';

import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type {
  ProcedureAttachment,
  ProcedureDefinition,
  ProcedureInstance,
  ProcedureSubtask,
  ProcedureStepMaterial,
  ProcedureSubtaskExecutionMode,
  ProcedureSubtaskInput,
  RequestProcedureMaterialsRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import { Download, ExternalLink, FileText, PanelRightOpen, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { AssetCatalogItem, MaterialCatalogItem } from '../procedure-api';
import styles from './workspace-board.module.scss';

const STATUS_LABEL: Record<ProcedureSubtask['status'], string> = {
  open: 'Chưa làm',
  in_progress: 'Đang làm',
  completed: 'Xong',
  cancelled: 'Bỏ',
};

/**
 * Dòng chọn vật tư cho MỘT đầu việc.
 *
 * Chỉ giữ `materialCode` và `quantity` trong bản nháp: tên và đơn vị do server
 * tra lại từ Kho lúc lưu, nên gửi kèm từ client chỉ tạo thêm một nguồn sự thật
 * thứ hai có thể lỗi thời.
 */
function MaterialRows({
  rows,
  catalog,
  onChange,
}: {
  rows: readonly ProcedureStepMaterial[];
  catalog: readonly MaterialCatalogItem[];
  onChange: (rows: ProcedureStepMaterial[]) => void;
}) {
  const patch = (index: number, change: Partial<ProcedureStepMaterial>) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));

  if (catalog.length === 0 && rows.length === 0) {
    return (
      <p className={styles.panelHint}>
        Chưa đọc được danh mục vật tư từ Kho, nên đầu việc này chưa khai vật tư được.
      </p>
    );
  }

  return (
    <div className={styles.materialRows}>
      {rows.map((row, index) => {
        const known = catalog.find((candidate) => candidate.code === row.materialCode);
        const short = known?.available !== undefined && known.available < row.quantity;
        return (
          <div key={index} className={styles.materialRow}>
            <select
              aria-label="Vật tư"
              value={row.materialCode}
              onChange={(event) => patch(index, { materialCode: event.target.value })}
            >
              <option value="">— Chọn vật tư —</option>
              {catalog.map((candidate) => (
                <option key={candidate.code} value={candidate.code}>
                  {candidate.name} ({candidate.code})
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={known?.available !== undefined ? Math.max(0, known.available) : undefined}
              step={1}
              aria-label="Số lượng"
              style={{
                borderColor: short ? '#ef4444' : undefined,
                background: short ? '#fef2f2' : undefined,
              }}
              value={row.quantity}
              onChange={(event) => {
                let val = Number(event.target.value);
                if (Number.isNaN(val)) val = 0;
                if (known?.available !== undefined && val > known.available) {
                  val = Math.max(0, known.available);
                }
                patch(index, { quantity: val });
              }}
            />
            <span
              className={short ? styles.materialShort : styles.materialStock}
              style={{
                color: short ? '#dc2626' : undefined,
                fontWeight: short ? 600 : undefined,
              }}
            >
              {known?.available !== undefined
                ? `tồn ${known.available} ${known.unit ?? ''}`
                : row.materialCode
                  ? 'chưa đọc được tồn'
                  : ''}
            </span>
            <button
              type="button"
              className={styles.subtaskRemove}
              aria-label="Xoá dòng vật tư"
              onClick={() => onChange(rows.filter((_, position) => position !== index))}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className={styles.ghost}
        onClick={() => {
          const firstAvailable = catalog.find((c) => c.available !== undefined && c.available > 0);
          onChange([
            ...rows,
            {
              materialCode: firstAvailable?.code ?? '',
              quantity: firstAvailable ? Math.min(1, firstAvailable.available ?? 1) : 0,
            },
          ]);
        }}
      >
        + Vật tư
      </button>
    </div>
  );
}

/** Nhãn của một đầu việc trong template lấy từ Kho — template không có kiểu chặt. */
function templateLabel(entry: Record<string, unknown>, index: number): string {
  for (const key of ['name', 'title', 'step', 'label']) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return `Đầu việc ${index + 1}`;
}

function templateKey(entry: Record<string, unknown>): string | undefined {
  const value = entry['key'];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Chia đều 100 rồi dồn phần dư vào phần tử cuối, tránh tổng lệch 99.99. */
function evenWeights(count: number): number[] {
  if (count === 0) return [];
  const base = Math.floor(10_000 / count);
  const shares = new Array(count).fill(base);
  shares[count - 1] += 10_000 - base * count;
  return shares.map((share) => share / 100);
}

/**
 * Phân rã công việc của vai trò E — E(x) trong mô hình RACI+E.
 *
 * Danh sách đầu việc đã đóng băng vào phân công E lúc công bố, lấy từ hồ sơ thiết
 * bị bên Kho. Người phụ trách đơn vị (giữ E) chia trọng số và giao từng đầu việc
 * cho thành viên đơn vị mình; mỗi người phải đính kèm bằng chứng trước khi đánh
 * dấu xong, và bước chỉ kết thúc khi mọi đầu việc đã được xử lý.
 */
export function SubtaskPanel({
  instance,
  materialCatalog = [],
  assetCatalog = [],
  onPickAsset,
  definitions = [],
  onRequestMaterials,
  organization,
  actorId,
  busy,
  attachments,
  onSeed,
  onSetItems,
  onComplete,
  onCancel,
  onUpload,
}: {
  instance: ProcedureInstance;
  /** Danh mục vật tư của Kho kèm tồn khả dụng; rỗng khi Kho không đọc được. */
  materialCatalog?: readonly MaterialCatalogItem[];
  /** Danh mục thiết bị để vai E chọn lúc chạy. */
  assetCatalog?: readonly AssetCatalogItem[];
  /** Chọn thiết bị cho hồ sơ; server nạp luôn đầu việc của thiết bị đó. */
  onPickAsset?: (assetCode: string) => void;
  /** Để người bấm tự chọn quy trình khi tenant chưa cấu hình mặc định. */
  definitions?: readonly ProcedureDefinition[];
  onRequestMaterials?: (input: RequestProcedureMaterialsRequest) => void;
  organization?: TenantOrganizationSnapshot;
  actorId?: string;
  busy?: string;
  attachments: readonly ProcedureAttachment[];
  onSeed: () => void;
  onSetItems: (items: ProcedureSubtaskInput[], executionMode: ProcedureSubtaskExecutionMode) => void;
  onComplete: (subtaskId: string) => void;
  onCancel: (subtaskId: string) => void;
  onUpload: (subtaskId: string, file: File) => void;
}) {
  const step = instance.steps.find((item) => item.id === instance.currentStepId);
  const eAssignment = step?.assignments.find((item) => item.role === 'E');
  const template = (eAssignment?.eTaskConfig?.taskTemplate ?? []) as Record<string, unknown>[];

  const subtasks = useMemo(
    () => (instance.subtasks ?? []).filter((item) => item.stepInstanceId === step?.id),
    [instance.subtasks, step?.id],
  );

  /**
   * Người có thể nhận đầu việc: thành viên của đơn vị mà vai trò E đại diện, cộng
   * thành viên của mọi đơn vị mà chính người đang xem đang phụ trách.
   *
   * Vế thứ hai là cần thiết: một trưởng đơn vị giữ E vẫn phải giao được việc cho
   * cấp dưới của mình, kể cả khi E được gán đích danh họ thay vì gán ở cấp đơn vị.
   */
  const candidates = useMemo(() => {
    const members = organization?.members ?? [];
    if (members.length === 0) return [];

    const unitIds = new Set<string>();
    if (eAssignment?.subjectType === 'organization_unit') unitIds.add(eAssignment.subjectId);
    for (const member of members) {
      if (member.isHead && member.userId === actorId && member.unitId) unitIds.add(member.unitId);
    }
    if (unitIds.size === 0) return [];

    const seen = new Set<string>();
    return members
      .filter((member) => {
        if (!member.unitId || !unitIds.has(member.unitId)) return false;
        if (seen.has(member.userId)) return false;
        seen.add(member.userId);
        return true;
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'vi'));
  }, [organization, eAssignment, actorId]);

  const evidenceOf = (subtaskId: string) =>
    attachments.filter((item) => item.subtaskId === subtaskId);

  const publishedDefinitions = useMemo(
    () => definitions.filter((item) => item.status === 'published'),
    [definitions],
  );

  /**
   * Gộp vật tư của MỌI đầu việc trong bước thành một bảng kê duy nhất.
   *
   * E(1) cần 2 cái A, E(2) cần 4 cái B thì thủ kho nhận đúng một phiếu "2 A và
   * 4 B", chứ không phải hai phiếu rời. Cùng một mã xuất hiện ở nhiều đầu việc
   * thì cộng dồn — hai đầu việc mỗi cái cần 3 mét cáp nghĩa là cần 6 mét.
   */
  const pooled = useMemo(() => {
    const byCode = new Map<
      string,
      { materialCode: string; quantity: number; name?: string; unit?: string; from: string[] }
    >();
    for (const subtask of subtasks) {
      if (subtask.status === 'cancelled') continue;
      for (const line of subtask.materials ?? []) {
        const current = byCode.get(line.materialCode);
        if (current) {
          current.quantity += line.quantity;
          current.from.push(subtask.title);
        } else {
          byCode.set(line.materialCode, {
            materialCode: line.materialCode,
            quantity: line.quantity,
            name: line.materialName,
            unit: line.unit,
            from: [subtask.title],
          });
        }
      }
    }
    return [...byCode.values()].map((line) => {
      const stock = materialCatalog.find((item) => item.code === line.materialCode);
      // Kho không đọc được thì KHÔNG kết luận thiếu: `available` vắng mặt khác
      // hẳn `available === 0`.
      const available = stock?.available;
      const short = available === undefined ? 0 : Math.max(0, line.quantity - available);
      return { ...line, available, short };
    });
  }, [subtasks, materialCatalog]);

  /**
   * Phần CÒN LẠI phải đặt = nhu cầu gộp trừ đi những gì đã đặt.
   *
   * Không trừ thì mỗi lần bấm là một đơn trùng toàn bộ, thủ kho nhận ba phiếu
   * cho cùng một lô hàng. Khai thêm vật tư rồi bấm tiếp thì chỉ phần thêm mới
   * thành đơn — đúng nghĩa "đặt bổ sung".
   */
  const remaining = useMemo(() => {
    const ordered = new Map<string, number>();
    for (const order of instance.materialOrders ?? []) {
      for (const line of order.lines) {
        ordered.set(line.materialCode, (ordered.get(line.materialCode) ?? 0) + line.quantity);
      }
    }
    return pooled
      .map((line) => ({ ...line, quantity: line.quantity - (ordered.get(line.materialCode) ?? 0) }))
      .filter((line) => line.quantity > 0)
      .map((line) => ({
        ...line,
        short: line.available === undefined ? 0 : Math.max(0, line.quantity - line.available),
      }));
  }, [pooled, instance.materialOrders]);

  const shortLines = remaining.filter((line) => line.short > 0);
  const enoughLines = remaining.filter((line) => line.short <= 0);

  /** Số lượng người dùng sửa tay trước khi tạo đơn; mặc định lấy phần còn lại. */
  const [orderDraft, setOrderDraft] = useState<Record<string, number>>({});
  const draftQty = (code: string, fallback: number) => orderDraft[code] ?? fallback;


  /** Đầu việc đang mở khung chọn quy trình xin vật tư. */
  /** Đang mở khung xác nhận tạo đơn vật tư cho cả bước. */
  const [ordering, setOrdering] = useState(false);
  const [requestChoice, setRequestChoice] = useState<{
    issueDefinitionId?: string;
    purchaseDefinitionId?: string;
  }>({});
  const [draft, setDraft] = useState<ProcedureSubtaskInput[]>();
  const [draftMode, setDraftMode] = useState<ProcedureSubtaskExecutionMode>('parallel');
  const [isDrawer, setIsDrawer] = useState(false);
  const fileInputs = useRef(new Map<string, HTMLInputElement | null>());

  const canManage = instance.authorization?.canManageSubtasks ?? false;
  const mine = new Set(instance.authorization?.mySubtaskIds ?? []);

  if (!step || !eAssignment) return null;

  const total = (draft ?? []).reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  const resolved = subtasks.filter(
    (item) => item.status === 'completed' || item.status === 'cancelled',
  ).length;
  const doneWeight = subtasks
    .filter((item) => item.status === 'completed')
    .reduce((sum, item) => sum + item.weight, 0);

  const openEditor = (asDrawer = false) => {
    setIsDrawer(asDrawer);
    setDraftMode(step.subtaskExecutionMode ?? 'parallel');
    if (subtasks.length > 0) {
      setDraft(
        subtasks.map((item) => ({
          title: item.title,
          weight: item.weight,
          assigneeId: item.assigneeId,
          assigneeName: item.assigneeName,
          // Giữ lại vật tư đã chọn: mở trình sửa để đổi mỗi người phụ trách mà
          // mất sạch vật tư thì lần lưu sau xoá im lặng thứ người ta đã khai.
          materials: item.materials,
        })),
      );
      return;
    }
    const weights = evenWeights(template.length);
    const base: ProcedureSubtaskInput[] = template.map((entry, index) => ({
      title: templateLabel(entry, index),
      weight: weights[index],
    }));
    setDraft(base.length > 0 ? base : [{ title: '', weight: 100 }]);
  };

  const sequential = step.subtaskExecutionMode === 'sequential';

  /** Đầu việc đứng trước còn dang dở — cùng luật với server, chỉ để hiển thị. */
  const blockerOf = (subtask: ProcedureSubtask) =>
    subtasks
      .filter(
        (candidate) =>
          candidate.order < subtask.order &&
          candidate.status !== 'completed' &&
          candidate.status !== 'cancelled',
      )
      .sort((a, b) => a.order - b.order)[0];

  const moveDraft = (index: number, delta: number) =>
    setDraft((rows) => {
      const list = [...(rows ?? [])];
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      [list[index], list[target]] = [list[target], list[index]];
      return list;
    });

  const patchDraft = (index: number, change: Partial<ProcedureSubtaskInput>) =>
    setDraft((rows) =>
      (rows ?? []).map((row, position) => (position === index ? { ...row, ...change } : row)),
    );

  return (
    <article className={styles.panel}>
      <header className={styles.actionHead}>
        <h3 className={styles.panelTitle}>
          <i className={`${styles.role} ${styles.roleE}`}>E</i> Phân rã công việc
        </h3>
        {subtasks.length > 0 ? (
          <span className={styles.stepBadge}>
            {sequential ? 'Tuần tự · ' : ''}
            {resolved}/{subtasks.length} xử lý · {Math.round(doneWeight * 100) / 100}% khối lượng
          </span>
        ) : null}
      </header>

      <p className={styles.panelHint}>
        {template.length > 0 ? (
          <>
            Thiết bị <strong>{eAssignment.eTaskConfig?.assetCode}</strong> có {template.length} đầu
            việc, nạp từ hồ sơ thiết bị bên Kho. Giao từng đầu việc cho thành viên đơn vị bạn
            phụ trách; đính kèm tài liệu là tuỳ chọn.
          </>
        ) : (
          <>
            Chưa có danh sách đầu việc. Chọn thiết bị ở trên để nạp từ Kho, hoặc tự nhập các
            đầu việc và trọng số.
          </>
        )}
      </p>

      {onPickAsset && canManage ? (
        <div className={styles.assetPicker}>
          <label className={styles.assetPickerLabel}>
            <span>Thiết bị đang làm</span>
            <select
              className={styles.assetPickerSelect}
              value={instance.assetCode ?? ''}
              disabled={busy === 'asset'}
              onChange={(event) => {
                if (event.target.value) onPickAsset(event.target.value);
              }}
            >
              <option value="">— Chọn thiết bị —</option>
              {assetCatalog.map((asset) => (
                <option key={asset.code} value={asset.code}>
                  {asset.name} ({asset.code})
                  {asset.taskCount ? ` · ${asset.taskCount} đầu việc` : ''}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.panelHint}>
            {instance.assetCode
              ? 'Đổi thiết bị sẽ nạp lại danh sách đầu việc theo thiết bị mới. Đầu việc đã phân rã không bị xoá — bấm “Sửa phân rã” nếu muốn làm lại.'
              : 'Chọn thiết bị để nạp đầu việc từ hồ sơ thiết bị bên Kho. Phiếu do Bảo trì sinh ra đã có sẵn thiết bị.'}
          </p>
        </div>
      ) : null}

      {template.length > 0 && subtasks.length === 0 && draft === undefined ? (
        <ol className={styles.templateList}>
          {template.map((entry, index) => (
            <li key={index}>
              {templateKey(entry) ? (
                <span className={styles.taskKey}>{templateKey(entry)}</span>
              ) : null}
              {templateLabel(entry, index)}
            </li>
          ))}
        </ol>
      ) : null}

      {subtasks.length > 0 ? (
        <ul className={styles.subtaskList}>
          {subtasks.map((subtask) => {
            const evidence = evidenceOf(subtask.id);
            const isMine = mine.has(subtask.id);
            const pending = subtask.status !== 'completed' && subtask.status !== 'cancelled';
            // Bước tuần tự: chưa xong việc đứng trước thì việc này chưa mở. Server
            // cũng chặn, đây chỉ là để người dùng thấy lý do thay vì bấm rồi lỗi.
            const blocker = sequential ? blockerOf(subtask) : undefined;
            const canFinish = (canManage || isMine) && pending && !blocker;

            return (
              <li key={subtask.id} className={`${styles.subtaskItem} ${styles[`sub_${subtask.status}`]}`}>
                <div className={styles.subtaskHead}>
                  {sequential ? (
                    <span className={styles.subtaskOrder}>#{subtask.order}</span>
                  ) : null}
                  <span className={styles.subtaskWeight}>{subtask.weight}%</span>
                  <span className={styles.subtaskTitle}>
                    {subtask.title}
                    {isMine ? <em className={styles.mineTag}>việc của bạn</em> : null}
                  </span>
                  <span className={`${styles.subtaskStatus} ${styles[`status_${subtask.status}`]}`}>
                    {STATUS_LABEL[subtask.status]}
                  </span>
                </div>

                <div className={styles.subtaskMeta}>
                  <span className={styles.subtaskAssignee}>
                    {subtask.assigneeName ?? (subtask.assigneeId ? 'Đã giao' : 'Chưa giao cho ai')}
                  </span>
                  {blocker ? (
                    <span className={styles.subtaskBlocker}>⏳ chờ “{blocker.title}”</span>
                  ) : evidence.length > 0 ? (
                    <span className={styles.subtaskEvidenceBadge}>{evidence.length} tài liệu</span>
                  ) : null}
                </div>

                {subtask.materials?.length ? (
                  <ul className={styles.subtaskMaterials}>
                    {subtask.materials.map((line) => {
                      const stock = materialCatalog.find(
                        (candidate) => candidate.code === line.materialCode,
                      );
                      // Kho không đọc được thì KHÔNG kết luận thiếu: `available`
                      // vắng mặt khác hẳn `available === 0`.
                      const short =
                        stock?.available !== undefined && stock.available < line.quantity;
                      return (
                        <li
                          key={line.materialCode}
                          className={short ? styles.materialShort : undefined}
                        >
                          <span>{line.materialName ?? line.materialCode}</span>
                          <small>
                            cần {line.quantity} {line.unit ?? ''}
                            {stock?.available !== undefined
                              ? ` · tồn ${stock.available}`
                              : ' · chưa đọc được tồn'}
                          </small>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {evidence.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: '8px 0' }}>
                    {evidence.map((file) => (
                      <div key={file.id} className={styles.fileCardItem} style={{ padding: '8px 12px', margin: 0 }}>
                        <div className={styles.fileCardInfo}>
                          <div className={styles.fileCardIconWrap} style={{ width: '28px', height: '28px' }}>
                            <FileText size={15} strokeWidth={2} />
                          </div>
                          <div className={styles.fileCardDetails}>
                            <span className={styles.fileCardName} title={file.fileName} style={{ fontSize: '12px' }}>
                              {file.fileName}
                            </span>
                          </div>
                        </div>

                        <div className={styles.fileCardActions}>
                          {file.downloadUrl ? (
                            <>
                              <a
                                href={file.downloadUrl}
                                target="_blank"
                                rel="noreferrer"
                                className={`${styles.fileActionBtn} ${styles.fileActionBtnPrimary}`}
                                style={{ padding: '4px 8px', fontSize: '11px' }}
                                title="Xem trực tiếp trong tab mới"
                              >
                                <ExternalLink size={12} strokeWidth={2} />
                                <span>Xem trực tiếp</span>
                              </a>
                              <a
                                href={file.downloadUrl}
                                download={file.fileName}
                                className={styles.fileActionBtn}
                                style={{ padding: '4px 8px', fontSize: '11px' }}
                                title="Tải tệp về máy"
                              >
                                <Download size={12} strokeWidth={2} />
                                <span>Tải về</span>
                              </a>
                            </>
                          ) : (
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Đang nạp link...</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {canFinish ? (
                  <div className={styles.subtaskActions}>
                    <input
                      type="file"
                      hidden
                      ref={(element) => {
                        fileInputs.current.set(subtask.id, element);
                      }}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) onUpload(subtask.id, file);
                        event.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      className={styles.subtaskAttachBtn}
                      disabled={busy === `upload:${subtask.id}`}
                      onClick={() => fileInputs.current.get(subtask.id)?.click()}
                    >
                      {busy === `upload:${subtask.id}` ? 'Đang tải…' : 'Đính kèm'}
                    </button>
                    <button
                      type="button"
                      className={styles.subtaskDoneBtn}
                      disabled={busy === `subtask-done:${subtask.id}`}
                      title="Đánh dấu đầu việc đã xong. Đính kèm tài liệu là tuỳ chọn."
                      onClick={() => onComplete(subtask.id)}
                    >
                      Xong
                    </button>
                    {canManage ? (
                      <button
                        type="button"
                        className={styles.subtaskCancelBtn}
                        disabled={busy === `subtask-cancel:${subtask.id}`}
                        onClick={() => onCancel(subtask.id)}
                      >
                        Bỏ
                      </button>
                    ) : null}
                  </div>
                ) : null}

              </li>
            );
          })}
        </ul>
      ) : null}

      {canManage && onRequestMaterials && pooled.length > 0 ? (
        <section className={styles.orderBox}>
          <header className={styles.orderHead}>
            <h4>Bảng kê vật tư của bước</h4>
            <span className={styles.stepBadge}>
              {pooled.length} mã · gộp từ {subtasks.length} đầu việc
              {remaining.length < pooled.length ? ` · còn ${remaining.length} chưa đặt` : ''}
            </span>
          </header>

          <ul className={styles.orderLines}>
            {pooled.map((line) => (
              <li key={line.materialCode} className={line.short > 0 ? styles.materialShort : undefined}>
                <span className={styles.orderName}>{line.name ?? line.materialCode}</span>
                <span className={styles.orderQty}>
                  {line.quantity} {line.unit ?? ''}
                </span>
                <small className={styles.orderStock}>
                  {line.available === undefined
                    ? 'chưa đọc được tồn'
                    : line.short > 0
                      ? `tồn ${line.available} · thiếu ${line.short}`
                      : `tồn ${line.available}`}
                </small>
                <small className={styles.orderFrom}>{line.from.join(', ')}</small>
              </li>
            ))}
          </ul>

          {remaining.length === 0 ? (
            /* Đã đặt hết. Muốn đặt thêm thì phải khai thêm vật tư cho đầu việc
               trước — nút hiện lại ngay khi có phần chưa đặt. */
            <p className={styles.panelHint}>
              Đã tạo đơn cho toàn bộ vật tư của bước. Khai thêm vật tư cho đầu việc thì nút tạo
              đơn bổ sung sẽ hiện lại.
            </p>
          ) : !ordering ? (
            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.primary}
                disabled={busy === 'materials'}
                onClick={() => {
                  setOrderDraft({});
                  setOrdering(true);
                }}
              >
                {(instance.materialOrders ?? []).length > 0 ? 'Tạo đơn bổ sung' : null}
                {(instance.materialOrders ?? []).length === 0 && shortLines.length > 0
                  ? `Tạo đơn (${enoughLines.length} đủ · ${shortLines.length} thiếu)`
                  : null}
                {(instance.materialOrders ?? []).length === 0 && shortLines.length === 0
                  ? 'Tạo đơn xuất/mượn kho'
                  : null}
              </button>
            </div>
          ) : (
            <div className={styles.dispatchPicker}>
              <p className={styles.panelHint}>
                Kiểm lại số lượng rồi chọn quy trình. Sửa được trước khi tạo — số mặc định là phần
                chưa đặt.
              </p>

              <ul className={styles.orderLines}>
                {remaining.map((line) => (
                  <li key={line.materialCode}>
                    <span className={styles.orderName}>{line.name ?? line.materialCode}</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className={styles.orderInput}
                      aria-label={`Số lượng ${line.name ?? line.materialCode}`}
                      value={draftQty(line.materialCode, line.quantity)}
                      onChange={(event) =>
                        setOrderDraft((current) => ({
                          ...current,
                          [line.materialCode]: Number(event.target.value),
                        }))
                      }
                    />
                    <small className={styles.orderStock}>{line.unit ?? ''}</small>
                  </li>
                ))}
              </ul>

              <p className={styles.panelHint}>
                {shortLines.length > 0
                  ? 'Có mã thiếu hàng nên sẽ mở HAI hồ sơ: một xuất/mượn cho phần đủ, một mua sắm cho phần thiếu.'
                  : 'Đủ hàng cho mọi mã — chỉ mở một hồ sơ xuất/mượn kho.'}
              </p>
              <label>
                <span>Phần đủ hàng — mượn/xuất kho</span>
                <select
                  value={requestChoice.issueDefinitionId ?? ''}
                  onChange={(event) =>
                    setRequestChoice((current) => ({
                      ...current,
                      issueDefinitionId: event.target.value || undefined,
                    }))
                  }
                >
                  <option value="">— Chọn quy trình —</option>
                  {publishedDefinitions.map((definition) => (
                    <option key={definition.id} value={definition.id}>
                      {definition.name}
                    </option>
                  ))}
                </select>
              </label>
              {shortLines.length > 0 ? (
                <label>
                  <span>Phần thiếu hàng — mua sắm</span>
                  <select
                    value={requestChoice.purchaseDefinitionId ?? ''}
                    onChange={(event) =>
                      setRequestChoice((current) => ({
                        ...current,
                        purchaseDefinitionId: event.target.value || undefined,
                      }))
                    }
                  >
                    <option value="">— Chọn quy trình —</option>
                    {publishedDefinitions.map((definition) => (
                      <option key={definition.id} value={definition.id}>
                        {definition.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy === 'materials'}
                  onClick={() => {
                    onRequestMaterials({
                      materials: remaining
                        .map((line) => ({
                          materialCode: line.materialCode,
                          quantity: draftQty(line.materialCode, line.quantity),
                        }))
                        .filter((line) => line.quantity > 0),
                      ...requestChoice,
                    });
                    setOrdering(false);
                  }}
                >
                  Xác nhận tạo đơn
                </button>
                <button type="button" className={styles.ghost} onClick={() => setOrdering(false)}>
                  Huỷ
                </button>
              </div>
            </div>
          )}

          <p className={styles.panelHint}>
            Đơn mở ra là để người thật đi làm thủ tục. Hệ thống không tự trừ kho — số lượng chỉ
            đổi khi thủ kho thao tác trong module Kho.
          </p>
        </section>
      ) : null}

      {!canManage ? (
        mine.size === 0 ? (
          <p className={styles.panelHint}>
            Chỉ người phụ trách đơn vị (giữ vai trò E) mới phân rã được công việc.
          </p>
        ) : null
      ) : draft !== undefined ? (
        isDrawer ? (
          <div
            className={styles.subtaskEditorDrawerBackdrop}
            onClick={(e) => {
              if (e.target === e.currentTarget) setDraft(undefined);
            }}
          >
            <div className={styles.subtaskEditorDrawerPanel} onClick={(e) => e.stopPropagation()}>
              <header className={styles.subtaskEditorDrawerHead}>
                <div>
                  <h3>Phân rã &amp; Giao việc</h3>
                  <p>
                    {step.name} (Bước {step.order}) · Phân công cho các thành viên đơn vị
                  </p>
                </div>
                <div className={styles.subtaskEditorHeaderActions}>
                  <button
                    type="button"
                    className={styles.subtaskEditorDrawerCloseBtn}
                    onClick={() => setDraft(undefined)}
                    aria-label="Đóng ngăn kéo"
                  >
                    <X size={18} />
                  </button>
                </div>
              </header>

              <div className={styles.subtaskEditorDrawerBody}>
                <div className={styles.modeRow}>
                  <span>Cách chạy</span>
                  {(['parallel', 'sequential'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`${styles.modeChip} ${draftMode === mode ? styles.modeChipOn : ''}`}
                      onClick={() => setDraftMode(mode)}
                    >
                      {mode === 'parallel' ? 'Song song' : 'Tuần tự'}
                    </button>
                  ))}
                  <em>
                    {draftMode === 'parallel'
                      ? 'Ai làm trước cũng được.'
                      : 'Làm theo đúng thứ tự dưới đây; việc sau chỉ mở khi việc trước đã xong.'}
                  </em>
                </div>

                {draft.map((item, index) => (
                  <div key={index} className={styles.subtaskDraft}>
                    <div className={styles.subtaskRow}>
                      {draftMode === 'sequential' ? (
                        <span className={styles.orderControls}>
                          <button
                            type="button"
                            aria-label={`Đưa “${item.title || 'đầu việc'}” lên trên`}
                            disabled={index === 0}
                            onClick={() => moveDraft(index, -1)}
                          >
                            ▲
                          </button>
                          <b>{index + 1}</b>
                          <button
                            type="button"
                            aria-label={`Đưa “${item.title || 'đầu việc'}” xuống dưới`}
                            disabled={index === draft.length - 1}
                            onClick={() => moveDraft(index, 1)}
                          >
                            ▼
                          </button>
                        </span>
                      ) : null}
                      <input
                        placeholder="Tên đầu việc"
                        value={item.title}
                        onChange={(event) => patchDraft(index, { title: event.target.value })}
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label="Trọng số phần trăm"
                        value={item.weight}
                        onChange={(event) => patchDraft(index, { weight: Number(event.target.value) })}
                      />
                      <button
                        type="button"
                        className={styles.subtaskRemove}
                        aria-label="Xoá đầu việc"
                        onClick={() => setDraft((rows) => (rows ?? []).filter((_, p) => p !== index))}
                      >
                        ×
                      </button>
                    </div>
                    <select
                      className={styles.assigneeSelect}
                      value={item.assigneeId ?? ''}
                      onChange={(event) => {
                        const member = candidates.find((c) => c.userId === event.target.value);
                        patchDraft(index, {
                          assigneeId: member?.userId,
                          assigneeName: member?.displayName,
                        });
                      }}
                    >
                      <option value="">— Chưa giao cho ai —</option>
                      {candidates.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.displayName}
                          {member.positionName ? ` · ${member.positionName}` : ''}
                        </option>
                      ))}
                    </select>

                    <MaterialRows
                      rows={item.materials ?? []}
                      catalog={materialCatalog}
                      onChange={(materials) => patchDraft(index, { materials })}
                    />
                  </div>
                ))}

                {candidates.length === 0 ? (
                  <p className={styles.panelHint}>
                    Không tìm thấy nhân sự nào để giao việc: bạn chưa được đặt làm người phụ trách đơn vị
                    nào, và vai trò E ở bước này cũng không gán ở cấp đơn vị. Vẫn lưu được phân rã, nhưng
                    bạn phải tự thực hiện.
                  </p>
                ) : null}

                <div className={styles.subtaskFoot}>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => setDraft((rows) => [...(rows ?? []), { title: '', weight: 0 }])}
                  >
                    + Đầu việc
                  </button>
                  <span className={total === 100 ? styles.totalOk : styles.totalBad}>
                    Tổng {Math.round(total * 100) / 100}/100
                  </span>
                </div>
              </div>

              <footer className={styles.subtaskEditorDrawerFoot}>
                <span className={total === 100 ? styles.totalOk : styles.totalBad}>
                  Tổng {Math.round(total * 100) / 100}/100
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={busy === 'subtasks' || Math.round(total * 100) !== 10_000}
                    onClick={() => {
                      onSetItems(
                        (draft ?? [])
                          .filter((item) => item.title.trim() && item.weight > 0)
                          .map((item) => ({
                            ...item,
                            // Dòng chưa chọn mã là dòng người dùng vừa thêm rồi bỏ dở;
                            // gửi lên sẽ bị server từ chối cả lượt lưu.
                            materials: item.materials?.filter(
                              (line) => line.materialCode.trim() && line.quantity > 0,
                            ),
                          })),
                        draftMode,
                      );
                      setDraft(undefined);
                    }}
                  >
                    Lưu phân rã
                  </button>
                  <button type="button" className={styles.ghost} onClick={() => setDraft(undefined)}>
                    Huỷ
                  </button>
                </div>
              </footer>
            </div>
          </div>
        ) : (
          <div className={styles.subtaskEditor}>
            <div className={styles.modeRow}>
              <span>Cách chạy</span>
              {(['parallel', 'sequential'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${styles.modeChip} ${draftMode === mode ? styles.modeChipOn : ''}`}
                  onClick={() => setDraftMode(mode)}
                >
                  {mode === 'parallel' ? 'Song song' : 'Tuần tự'}
                </button>
              ))}
              <em>
                {draftMode === 'parallel'
                  ? 'Ai làm trước cũng được.'
                  : 'Làm theo đúng thứ tự dưới đây; việc sau chỉ mở khi việc trước đã xong.'}
              </em>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => setIsDrawer(true)}
                title="Mở rộng sang ngăn kéo Drawer tiện chỉnh sửa"
                style={{
                  marginLeft: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  padding: '3px 8px',
                }}
              >
                <PanelRightOpen size={13} />
                Mở Drawer
              </button>
            </div>

            {draft.map((item, index) => (
              <div key={index} className={styles.subtaskDraft}>
                <div className={styles.subtaskRow}>
                  {draftMode === 'sequential' ? (
                    <span className={styles.orderControls}>
                      <button
                        type="button"
                        aria-label={`Đưa “${item.title || 'đầu việc'}” lên trên`}
                        disabled={index === 0}
                        onClick={() => moveDraft(index, -1)}
                      >
                        ▲
                      </button>
                      <b>{index + 1}</b>
                      <button
                        type="button"
                        aria-label={`Đưa “${item.title || 'đầu việc'}” xuống dưới`}
                        disabled={index === draft.length - 1}
                        onClick={() => moveDraft(index, 1)}
                      >
                        ▼
                      </button>
                    </span>
                  ) : null}
                  <input
                    placeholder="Tên đầu việc"
                    value={item.title}
                    onChange={(event) => patchDraft(index, { title: event.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label="Trọng số phần trăm"
                    value={item.weight}
                    onChange={(event) => patchDraft(index, { weight: Number(event.target.value) })}
                  />
                  <button
                    type="button"
                    className={styles.subtaskRemove}
                    aria-label="Xoá đầu việc"
                    onClick={() => setDraft((rows) => (rows ?? []).filter((_, p) => p !== index))}
                  >
                    ×
                  </button>
                </div>
                <select
                  className={styles.assigneeSelect}
                  value={item.assigneeId ?? ''}
                  onChange={(event) => {
                    const member = candidates.find((c) => c.userId === event.target.value);
                    patchDraft(index, {
                      assigneeId: member?.userId,
                      assigneeName: member?.displayName,
                    });
                  }}
                >
                  <option value="">— Chưa giao cho ai —</option>
                  {candidates.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.displayName}
                      {member.positionName ? ` · ${member.positionName}` : ''}
                    </option>
                  ))}
                </select>

                <MaterialRows
                  rows={item.materials ?? []}
                  catalog={materialCatalog}
                  onChange={(materials) => patchDraft(index, { materials })}
                />
              </div>
            ))}

            {candidates.length === 0 ? (
              <p className={styles.panelHint}>
                Không tìm thấy nhân sự nào để giao việc: bạn chưa được đặt làm người phụ trách đơn vị
                nào, và vai trò E ở bước này cũng không gán ở cấp đơn vị. Vẫn lưu được phân rã, nhưng
                bạn phải tự thực hiện.
              </p>
            ) : null}

            <div className={styles.subtaskFoot}>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => setDraft((rows) => [...(rows ?? []), { title: '', weight: 0 }])}
              >
                + Đầu việc
              </button>
              <span className={total === 100 ? styles.totalOk : styles.totalBad}>
                Tổng {Math.round(total * 100) / 100}/100
              </span>
            </div>

            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.primary}
                disabled={busy === 'subtasks' || Math.round(total * 100) !== 10_000}
                onClick={() => {
                  onSetItems(
                    (draft ?? [])
                      .filter((item) => item.title.trim() && item.weight > 0)
                      .map((item) => ({
                        ...item,
                        // Dòng chưa chọn mã là dòng người dùng vừa thêm rồi bỏ dở;
                        // gửi lên sẽ bị server từ chối cả lượt lưu.
                        materials: item.materials?.filter(
                          (line) => line.materialCode.trim() && line.quantity > 0,
                        ),
                      })),
                    draftMode,
                  );
                  setDraft(undefined);
                }}
              >
                Lưu phân rã
              </button>
              <button type="button" className={styles.ghost} onClick={() => setDraft(undefined)}>
                Huỷ
              </button>
            </div>
          </div>
        )
      ) : (
        <div className={styles.actionRow}>
          {subtasks.length === 0 && template.length > 0 ? (
            <button
              type="button"
              className={styles.primary}
              disabled={busy === 'subtasks'}
              onClick={onSeed}
              title="Tạo đầu việc theo danh sách của thiết bị, trọng số theo thời lượng."
            >
              Nạp {template.length} đầu việc từ thiết bị
            </button>
          ) : null}
          <button
            type="button"
            className={styles.primary}
            onClick={() => openEditor(true)}
            title="Mở khung phân rã & giao việc trong ngăn kéo Drawer riêng biệt"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <PanelRightOpen size={14} />
            {subtasks.length === 0 ? 'Tự nhập đầu việc (Drawer)' : 'Chỉnh sửa công việc phân rã'}
          </button>
        </div>
      )}
    </article>
  );
}
