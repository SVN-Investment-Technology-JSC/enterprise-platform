'use client';

import {
  CHECKLIST_TITLE_MAX_LENGTH,
  MAX_CHECKLIST_ITEMS,
} from '@enterprise-platform/contracts-workspace';
import { Info, ListPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from '@enterprise-platform/shared-ui';
import {
  checklistPanelState,
  checklistPercent,
  splitChecklistLines,
} from '../checklist-access';
import {
  type ChecklistEntry,
  applyAppend,
  applyDone,
  applyRemove,
  applyRestore,
  applyTitle,
  createSerialQueue,
  focusIdAfterRemove,
  isTempChecklistId,
  makeTempChecklistItem,
  removeTempItems,
  shouldAcceptServerList,
  shouldReloadAfterWrite,
} from '../checklist-writes';
import { cn } from '../utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Progress } from '../ui/progress';
import { Tip } from '../ui/tooltip';
import * as api from '../workspace-api';
import { formatShortDate } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { ConfirmBox } from './confirm-box';
import { Dialog } from './dialog';
import { useDirectory } from './use-directory';

const messageOf = (cause: unknown, fallback: string) =>
  (cause as { message?: string })?.message || fallback;

type ChecklistResult = { items: ChecklistEntry[] };

/** Bốn lời gọi server của một loại công việc có checklist. */
export interface ChecklistApi {
  list: (id: string) => Promise<ChecklistResult>;
  add: (id: string, titles: readonly string[]) => Promise<ChecklistResult>;
  update: (
    id: string,
    itemId: string,
    body: { title?: string; done?: boolean },
  ) => Promise<ChecklistResult>;
  remove: (id: string, itemId: string) => Promise<ChecklistResult>;
}

/** Việc trong dự án (mặc định). */
export const WORK_ITEM_CHECKLIST_API: ChecklistApi = {
  list: api.listWorkItemChecklist,
  add: api.addWorkItemChecklist,
  update: api.updateWorkItemChecklistItem,
  remove: api.removeWorkItemChecklistItem,
};

/** Công việc khác (ngoài dự án). */
export const STANDALONE_TASK_CHECKLIST_API: ChecklistApi = {
  list: api.listStandaloneTaskChecklist,
  add: api.addStandaloneTaskChecklist,
  update: api.updateStandaloneTaskChecklistItem,
  remove: api.removeStandaloneTaskChecklistItem,
};

/** Phần của công việc mà panel cần; cả `WorkItem` và `StandaloneTask` đều thoả. */
export interface ChecklistSubject {
  id: string;
  status: string;
  updatedAt: string;
  progressMethod?: string;
}

/**
 * Checklist tiến độ của công việc: tích để hoàn thành, thêm nhanh (Enter), dán nhiều dòng, sửa tên tại chỗ, xoá.
 * Thêm đầu việc đầu tiên vào việc đang tính tiến độ thủ công thì server tự chuyển sang tính theo checklist.
 *
 * Mọi thao tác hiện ngay trên màn (lạc quan) rồi mới gửi server. Các yêu cầu ghi của cùng một công việc chạy lần lượt
 * theo hàng đợi để server không tính tiến độ song song; thao tác lỗi được khôi phục kèm thông báo. Sau mỗi lần ghi,
 * `onChanged` để màn nạp lại công việc (tiến độ, cách tính, trạng thái).
 */
export function ChecklistPanel({
  item,
  canEdit,
  userId,
  onChanged,
  checklistApi = WORK_ITEM_CHECKLIST_API,
  alwaysTracked = false,
  cannotEditReason,
  onCountChange,
}: {
  item: ChecklistSubject;
  canEdit: boolean;
  /** Người đang đăng nhập, để dòng vừa tích hiện ngay "Tích bởi" trước khi server trả về. */
  userId?: string;
  onChanged?: () => void | Promise<void>;
  /** Lời gọi server; mặc định là của việc trong dự án. */
  checklistApi?: ChecklistApi;
  /** Công việc không có cách tính tiến độ (Công việc khác): luôn tính theo checklist, không có bước tự chuyển. */
  alwaysTracked?: boolean;
  cannotEditReason?: string;
  /** Báo số đầu việc mỗi khi danh sách đổi (`undefined` khi chưa nạp), để màn quanh nó khoá ô báo tiến độ tay. */
  onCountChange?: (count: number | undefined) => void;
}) {
  const directory = useDirectory();
  const [items, setItems] = useState<readonly ChecklistEntry[]>();
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState('');
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState('');
  /** Server đã tự chuyển việc sang tính theo checklist (sau lần thêm đầu tiên) nhưng `item` chưa kịp nạp lại. */
  const [switched, setSwitched] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [confirmEntry, setConfirmEntry] = useState<ChecklistEntry>();
  const addRef = useRef<HTMLInputElement>(null);
  /** Nút tên của từng dòng, và dòng sẽ nhận focus sau lần vẽ tới (`'add'` là ô thêm đầu việc). */
  const nameRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusTargetRef = useRef<string | undefined>(undefined);
  const cancelRef = useRef(false);
  const editingRef = useRef<string | undefined>(undefined);
  /** Bản sao đồng bộ của `items` để các thao tác nối tiếp nhau đọc đúng trạng thái mới nhất. */
  const itemsRef = useRef<readonly ChecklistEntry[]>([]);
  const loadedRef = useRef(false);
  /** Số yêu cầu ghi đang chờ server; thế hệ tăng mỗi lần sang việc khác để bỏ qua kết quả muộn của việc cũ. */
  const pendingRef = useRef(0);
  const generationRef = useRef(0);
  const writeSeqRef = useRef(0);
  /** Có thao tác đã lưu mà chưa báo `onChanged` (còn yêu cầu khác đang chờ, hoặc yêu cầu cuối bị lỗi). */
  const dirtyRef = useRef(false);
  const tempSeqRef = useRef(0);
  const queueRef = useRef(createSerialQueue());
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const itemIdRef = useRef(item.id);
  itemIdRef.current = item.id;
  const apiRef = useRef(checklistApi);
  apiRef.current = checklistApi;
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  const commit = (next: readonly ChecklistEntry[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  useEffect(() => {
    onCountChangeRef.current?.(items?.length);
  }, [items]);

  // Sang công việc khác: bỏ ngay danh sách, chữ đang gõ và hàng đợi của việc trước, kẻo thao tác nhầm lên việc cũ.
  useEffect(() => {
    itemsRef.current = [];
    setItems(undefined);
    setTitle('');
    setEditingId(undefined);
    editingRef.current = undefined;
    setConfirmEntry(undefined);
    focusTargetRef.current = undefined;
    setFailed(false);
    setSwitched(false);
    loadedRef.current = false;
    pendingRef.current = 0;
    dirtyRef.current = false;
    generationRef.current += 1;
    queueRef.current = createSerialQueue();
  }, [item.id]);

  // Trả focus về nút tên của dòng (hoặc ô thêm) sau khi lưu, huỷ sửa hoặc xoá, kẻo focus rơi về body.
  useEffect(() => {
    const target = focusTargetRef.current;
    if (!target) return;
    focusTargetRef.current = undefined;
    (target === 'add' ? addRef.current : nameRefs.current.get(target))?.focus();
  });

  // Server đã báo việc là `checklist` thì bỏ cờ tạm.
  useEffect(() => {
    if (item.progressMethod === 'checklist') setSwitched(false);
  }, [item.progressMethod]);

  /** Nạp danh sách từ server; bỏ kết quả nếu trong lúc chờ đã có thao tác ghi (kẻo đè mất thao tác lạc quan). */
  const loadRef = useRef<(opts?: { force?: boolean }) => () => void>(
    () => () => undefined,
  );
  loadRef.current = (opts) => {
    let alive = true;
    const seq = writeSeqRef.current;
    const wid = item.id;
    apiRef.current
      .list(wid)
      .then((result) => {
        if (!alive || itemIdRef.current !== wid) return;
        if (
          pendingRef.current > 0 ||
          (!opts?.force && seq !== writeSeqRef.current)
        )
          return;
        loadedRef.current = true;
        setFailed(false);
        commit(result.items);
      })
      .catch(() => alive && !loadedRef.current && setFailed(true));
    return () => {
      alive = false;
    };
  };

  // `updatedAt` đổi chỉ nạp lại ngầm: giữ danh sách cũ, chữ đang gõ và ô đang sửa tên.
  useEffect(() => loadRef.current(), [item.id, item.updatedAt]);

  const method =
    alwaysTracked || switched ? 'checklist' : (item.progressMethod ?? 'manual');
  const closed = item.status === 'done' || item.status === 'cancelled';
  const total = items?.length ?? 0;
  const state = checklistPanelState({
    method,
    closed,
    canEdit,
    total,
    max: MAX_CHECKLIST_ITEMS,
    cannotEditReason,
  });
  const { editable } = state;

  const notifyChanged = async () => {
    dirtyRef.current = false;
    try {
      await onChangedRef.current?.();
    } catch {
      // Nạp lại màn lỗi không làm hỏng thao tác đã lưu; lần nạp sau sẽ khớp.
    }
  };

  /**
   * Gửi một thao tác ghi (đã áp lạc quan lên màn) qua hàng đợi của công việc. Thành công: nhận danh sách server nếu đây là
   * yêu cầu cuối đang chờ, rồi nạp lại công việc. Lỗi: `rollback` khôi phục phần đã áp, báo toast, nạp lại danh sách thật
   * khi không còn yêu cầu nào chờ.
   */
  const write = async (
    operation: () => Promise<ChecklistResult>,
    fallback: string,
    rollback: () => void,
  ): Promise<boolean> => {
    const generation = generationRef.current;
    pendingRef.current += 1;
    writeSeqRef.current += 1;
    let result: ChecklistResult;
    try {
      result = await queueRef.current(operation);
    } catch (cause) {
      if (generation !== generationRef.current) return false;
      pendingRef.current -= 1;
      rollback();
      toast.error(messageOf(cause, fallback));
      if (pendingRef.current === 0) {
        loadRef.current({ force: true });
        // Các thao tác trước đó đã lưu (có thể làm đổi tiến độ, trạng thái) mà chưa báo màn: báo bù.
        if (dirtyRef.current) await notifyChanged();
      }
      return false;
    }
    // Đã sang việc khác: danh sách của việc cũ bỏ đi, nhưng vẫn báo nạp lại để dự án/WBS không hiện số cũ.
    const stale = generation !== generationRef.current;
    let reload = true;
    if (stale) {
      dirtyRef.current = false;
    } else {
      const accept = shouldAcceptServerList(pendingRef.current);
      pendingRef.current -= 1;
      if (accept) commit(result.items);
      dirtyRef.current = true;
      reload = shouldReloadAfterWrite(pendingRef.current);
    }
    if (reload) await notifyChanged();
    return true;
  };

  /** `sent`: chữ trong ô lúc gửi, để trả lại ô nếu lưu lỗi. */
  const addTitles = (titles: string[], sent: string) => {
    const list = titles
      .map((entry) => entry.trim().slice(0, CHECKLIST_TITLE_MAX_LENGTH))
      .filter(Boolean);
    if (list.length === 0) return;
    const room = MAX_CHECKLIST_ITEMS - itemsRef.current.length;
    if (room <= 0) {
      toast.error(`Một công việc có tối đa ${MAX_CHECKLIST_ITEMS} đầu việc.`);
      return;
    }
    if (list.length > room)
      toast.error(
        `Chỉ thêm được tối đa ${MAX_CHECKLIST_ITEMS} đầu việc; đã bỏ bớt phần dư.`,
      );
    const batch = list.slice(0, room);
    const temps = batch.map((text) =>
      makeTempChecklistItem(item.id, text, ++tempSeqRef.current),
    );
    const switchesMethod = method === 'manual' && itemsRef.current.length === 0;
    // Xoá ô ngay để gõ tiếp được: chữ vừa gửi đã nằm trong danh sách. Server tự chuyển việc thủ công sang tính theo
    // checklist ngay khi nhận đầu việc đầu tiên, nên màn cũng coi là `checklist` ngay (ô thêm không biến mất giữa chừng).
    setTitle('');
    if (switchesMethod) setSwitched(true);
    commit(applyAppend(itemsRef.current, temps));
    addRef.current?.focus();
    void write(
      () => apiRef.current.add(item.id, batch),
      'Không thêm được đầu việc.',
      () => {
        commit(
          removeTempItems(
            itemsRef.current,
            temps.map((entry) => entry.id),
          ),
        );
        if (switchesMethod && itemsRef.current.length === 0) setSwitched(false);
        // Trả chữ về ô nếu ô còn trống; ô đã có chữ mới thì để nguyên chữ mới (tên đầu việc lỗi đã nêu ở thông báo).
        setTitle((current) => current || sent);
      },
    );
  };

  const toggle = (entry: ChecklistEntry, done: boolean) => {
    if (isTempChecklistId(entry.id)) return;
    const before = itemsRef.current.find((other) => other.id === entry.id);
    if (!before) return;
    commit(
      applyDone(
        itemsRef.current,
        entry.id,
        done,
        userId,
        new Date().toISOString(),
      ),
    );
    void write(
      () => apiRef.current.update(item.id, entry.id, { done }),
      'Không cập nhật được đầu việc.',
      () =>
        commit(
          applyDone(
            itemsRef.current,
            entry.id,
            before.done,
            before.doneBy,
            before.doneAt,
          ),
        ),
    );
  };

  /** Dòng đã tích thì hỏi xác nhận (mất cả dấu vết người tích); dòng chưa tích xoá ngay. */
  const requestRemove = (entry: ChecklistEntry) => {
    if (isTempChecklistId(entry.id)) return;
    if (entry.done) setConfirmEntry(entry);
    else remove(entry);
  };

  const remove = (entry: ChecklistEntry) => {
    if (isTempChecklistId(entry.id)) return;
    const index = itemsRef.current.findIndex((other) => other.id === entry.id);
    if (index < 0) return;
    if (editingRef.current === entry.id) finishEdit();
    focusTargetRef.current =
      focusIdAfterRemove(itemsRef.current, entry.id) ?? 'add';
    commit(applyRemove(itemsRef.current, entry.id));
    void write(
      () => apiRef.current.remove(item.id, entry.id),
      'Không xoá được đầu việc.',
      () => commit(applyRestore(itemsRef.current, entry, index)),
    );
  };

  const startEdit = (entry: ChecklistEntry) => {
    if (isTempChecklistId(entry.id)) return;
    cancelRef.current = false;
    editingRef.current = entry.id;
    setEditingId(entry.id);
    setDraft(entry.title);
  };

  const finishEdit = () => {
    editingRef.current = undefined;
    setEditingId(undefined);
  };

  const saveEdit = (entry: ChecklistEntry, refocus = false) => {
    // Esc huỷ: ô nhập bị gỡ có thể kéo theo blur, đừng lưu lúc đó. Enter rồi blur: chỉ lưu một lần.
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    if (editingRef.current !== entry.id) return;
    const text = draft.trim().slice(0, CHECKLIST_TITLE_MAX_LENGTH);
    if (refocus) focusTargetRef.current = entry.id;
    finishEdit();
    if (!text || text === entry.title) return;
    commit(applyTitle(itemsRef.current, entry.id, text));
    void write(
      () => apiRef.current.update(item.id, entry.id, { title: text }),
      'Không đổi được tên đầu việc.',
      () => commit(applyTitle(itemsRef.current, entry.id, entry.title)),
    );
  };

  const done = (items ?? []).filter((entry) => entry.done).length;
  const percent = checklistPercent(done, total);
  const switchNotice = state.canAdd && method === 'manual' && total === 0;

  if (!state.visible && !failed) return null;

  /** Một dòng đầu việc. `manage`: trong hộp quản lý (sửa tên, xoá); ngoài card chỉ tích và đọc. */
  const renderRow = (entry: ChecklistEntry, manage: boolean) => {
    const editing = manage && editingId === entry.id;
    const pending = isTempChecklistId(entry.id);
    const doneNote =
      entry.done && (entry.doneBy || entry.doneAt)
        ? `Tích bởi ${entry.doneBy ? directory.nameOf(entry.doneBy) : '—'}${entry.doneAt ? ` · ${formatShortDate(entry.doneAt)}` : ''}`
        : '';
    const nameClass = cn(
      'min-w-0 text-[13px] leading-snug [overflow-wrap:anywhere]',
      entry.done && 'text-muted-foreground line-through',
    );
    return (
      <li
        key={entry.id}
        className={cn(
          'group flex min-w-0 items-center gap-1.5',
          pending && 'opacity-60',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1 group-hover:bg-accent focus-within:bg-accent">
          <Checkbox
            checked={entry.done}
            disabled={!editable || pending}
            aria-label={`${entry.done ? 'Bỏ tích' : 'Tích'} đầu việc ${entry.title}`}
            onCheckedChange={(checked) => toggle(entry, checked)}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            {editing ? (
              <Input
                className="h-7 px-2 text-[13px]"
                autoFocus
                value={draft}
                maxLength={CHECKLIST_TITLE_MAX_LENGTH}
                aria-label={`Sửa tên đầu việc ${entry.title}`}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => saveEdit(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing)
                    saveEdit(entry, true);
                  if (event.key === 'Escape') {
                    // Esc chỉ huỷ sửa tên, không để lan lên đóng hộp quản lý hay hộp chi tiết.
                    event.preventDefault();
                    event.stopPropagation();
                    cancelRef.current = true;
                    focusTargetRef.current = entry.id;
                    finishEdit();
                  }
                }}
              />
            ) : manage && editable && !pending ? (
              <Button
                type="button"
                variant="ghost"
                ref={(node: HTMLButtonElement | null) => {
                  if (node) nameRefs.current.set(entry.id, node);
                  else nameRefs.current.delete(entry.id);
                }}
                className={cn(
                  nameClass,
                  'h-auto w-full cursor-text justify-start whitespace-normal rounded px-0 py-0 text-left font-normal hover:bg-transparent',
                )}
                aria-label={`Sửa tên đầu việc ${entry.title}`}
                onClick={() => startEdit(entry)}
              >
                {entry.title}
              </Button>
            ) : (
              <span className={nameClass}>{entry.title}</span>
            )}
            {doneNote ? (
              <small className="text-[11.5px] text-muted-foreground">
                {doneNote}
              </small>
            ) : null}
          </div>
        </div>
        {manage && editable && !editing && !pending ? (
          <div className="flex flex-none gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <Tip content="Sửa tên">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-hidden
                tabIndex={-1}
                onClick={() => startEdit(entry)}
              >
                <Pencil aria-hidden />
              </Button>
            </Tip>
            <Tip content="Xoá đầu việc">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Xoá đầu việc ${entry.title}`}
                onClick={() => requestRemove(entry)}
              >
                <Trash2 aria-hidden />
              </Button>
            </Tip>
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <section className={styles.panel} aria-label="Checklist tiến độ">
      <div className="mb-2.5 flex items-center gap-2.5">
        <h3 className="m-0 font-semibold" style={{ margin: 0 }}>
          Checklist tiến độ
        </h3>
        {total > 0 ? (
          <Badge
            variant="secondary"
            className="h-5 border-border px-2 tabular-nums"
            role="img"
            aria-label={`${done} trên ${total} đầu việc đã xong`}
          >
            {done}/{total}
          </Badge>
        ) : null}
        {state.canAdd && items ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setManageOpen(true)}
          >
            <ListPlus aria-hidden />
            {total > 0 ? 'Quản lý' : 'Thêm đầu việc'}
          </Button>
        ) : null}
      </div>

      {failed ? (
        <p className="m-0 text-[12.5px] text-muted-foreground">
          Không tải được checklist lúc này.
        </p>
      ) : !items ? (
        <p className="m-0 text-[12.5px] text-muted-foreground">Đang tải…</p>
      ) : (
        <>
          {total > 0 ? (
            <div className="mb-2 flex items-center gap-2.5">
              <Progress
                value={percent}
                aria-label="Tiến độ theo checklist"
                indicatorClassName="bg-success"
              />
              <b className="min-w-9 text-right text-xs tabular-nums">
                {percent}%
              </b>
            </div>
          ) : null}

          {total > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {items.map((entry) => renderRow(entry, false))}
            </ul>
          ) : (
            <p className="m-0 flex items-start gap-1.5 text-[12.5px] leading-snug text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {switchNotice
                ? 'Thêm đầu việc đầu tiên để chuyển sang tính tiến độ theo checklist: làm tới đâu tích tới đó.'
                : state.canAdd
                  ? 'Chưa có đầu việc nào. Tiến độ sẽ tự tính theo số đầu việc đã tích.'
                  : 'Chưa có đầu việc nào.'}
            </p>
          )}
          {state.reason ? (
            <p className="m-0 flex items-start gap-1.5 pt-2.5 text-[12.5px] leading-snug text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {state.reason}
            </p>
          ) : null}
        </>
      )}

      <Dialog
        open={manageOpen && state.canAdd}
        title="Quản lý checklist"
        subtitle="Thêm, sửa tên hoặc xoá đầu việc. Thay đổi được lưu ngay."
        cancelLabel="Đóng"
        guardDiscard={false}
        centered
        hideFooter
        onClose={() => {
          if (editingRef.current) finishEdit();
          setManageOpen(false);
        }}
        onSubmit={() => setManageOpen(false)}
      >
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              ref={addRef}
              autoFocus
              value={title}
              maxLength={CHECKLIST_TITLE_MAX_LENGTH}
              placeholder="Thêm đầu việc, Enter để thêm tiếp…"
              aria-label="Tên đầu việc mới"
              onChange={(event) => setTitle(event.target.value)}
              onPaste={(event) => {
                const lines = splitChecklistLines(
                  event.clipboardData.getData('text'),
                );
                if (lines.length < 2) return;
                event.preventDefault();
                // Chèn tại vị trí con trỏ: chữ trước con trỏ, các dòng dán, rồi chữ sau con trỏ.
                const start =
                  event.currentTarget.selectionStart ?? title.length;
                const end = event.currentTarget.selectionEnd ?? start;
                addTitles(
                  [
                    ...splitChecklistLines(title.slice(0, start)),
                    ...lines,
                    ...splitChecklistLines(title.slice(end)),
                  ],
                  title,
                );
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  addTitles([title], title);
                }
                // Có chữ nháp thì Esc chỉ xoá nháp; ô trống thì Esc đóng hộp như thường.
                if (event.key === 'Escape' && title) {
                  event.preventDefault();
                  event.stopPropagation();
                  setTitle('');
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!title.trim()}
              onClick={() => addTitles([title], title)}
            >
              <Plus aria-hidden />
              Thêm
            </Button>
          </div>
          {total > 0 && items ? (
            <ul className="m-0 flex max-h-[50vh] list-none flex-col gap-0.5 overflow-y-auto p-0">
              {items.map((entry) => renderRow(entry, true))}
            </ul>
          ) : (
            <p className="m-0 text-[12.5px] text-muted-foreground">
              Chưa có đầu việc nào.
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmBox
        open={confirmEntry !== undefined}
        title="Bạn có chắc chắn muốn xoá đầu việc đã tích này?"
        message="Đầu việc bị xoá khỏi checklist và tiến độ được tính lại."
        confirmLabel="Xoá"
        onConfirm={() => {
          const entry = confirmEntry;
          setConfirmEntry(undefined);
          if (entry) remove(entry);
        }}
        onCancel={() => setConfirmEntry(undefined)}
      />
    </section>
  );
}
