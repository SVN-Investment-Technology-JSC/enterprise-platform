'use client';

import {
  CHECKLIST_TITLE_MAX_LENGTH,
  MAX_CHECKLIST_ITEMS,
} from '@enterprise-platform/contracts-workspace';
import { Info, ListPlus, Plus, Trash2 } from 'lucide-react';
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

/** Một dòng trong bản nháp của hộp quản lý; `id` rỗng là dòng mới chưa lưu. */
interface DraftRow {
  key: string;
  id?: string;
  title: string;
  done: boolean;
}

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
  /** Người đang đăng nhập, để dòng vừa tích hiện ngay "Hoàn thành bởi" trước khi server trả về. */
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
  /** Bản nháp trong hộp quản lý. */
  const [rows, setRows] = useState<DraftRow[]>([]);
  /** Server đã tự chuyển việc sang tính theo checklist (sau lần thêm đầu tiên) nhưng `item` chưa kịp nạp lại. */
  const [switched, setSwitched] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const draftSeqRef = useRef(0);
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
    setRows([]);
    setManageOpen(false);
    setConfirmApply(false);
    setFailed(false);
    setSwitched(false);
    loadedRef.current = false;
    pendingRef.current = 0;
    dirtyRef.current = false;
    generationRef.current += 1;
    queueRef.current = createSerialQueue();
  }, [item.id]);

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

  /** Mở hộp quản lý với bản nháp chép từ danh sách hiện tại; chỉ khi bấm "Cập nhật" mới gửi server. */
  const openManage = () => {
    setRows(
      (items ?? []).map((entry) => ({
        key: entry.id,
        id: entry.id,
        title: entry.title,
        done: entry.done,
      })),
    );
    setTitle('');
    setManageOpen(true);
  };

  const addDraft = (titles: string[]) => {
    const list = titles
      .map((entry) => entry.trim().slice(0, CHECKLIST_TITLE_MAX_LENGTH))
      .filter(Boolean);
    if (list.length === 0) return;
    const room = MAX_CHECKLIST_ITEMS - rows.length;
    if (room <= 0) {
      toast.error(`Một công việc có tối đa ${MAX_CHECKLIST_ITEMS} đầu việc.`);
      return;
    }
    if (list.length > room)
      toast.error(
        `Chỉ thêm được tối đa ${MAX_CHECKLIST_ITEMS} đầu việc; đã bỏ bớt phần dư.`,
      );
    setRows((current) => [
      ...current,
      ...list.slice(0, room).map((text) => ({
        key: `new-${++draftSeqRef.current}`,
        title: text,
        done: false,
      })),
    ]);
    setTitle('');
  };

  /** Khác biệt giữa bản nháp và danh sách đang lưu. */
  const current = items ?? [];
  const removedRows = current.filter(
    (entry) => !rows.some((row) => row.id === entry.id),
  );
  const renamedRows = rows.filter((row) => {
    if (!row.id) return false;
    const text = row.title.trim().slice(0, CHECKLIST_TITLE_MAX_LENGTH);
    return (
      text !== '' &&
      text !== current.find((entry) => entry.id === row.id)?.title
    );
  });
  const addedRows = rows.filter((row) => !row.id && row.title.trim() !== '');
  /** Có đầu việc đã hoàn thành bị xoá hoặc đổi tên: hỏi lại vì mất dấu vết người hoàn thành. */
  const touchesDone =
    removedRows.some((entry) => entry.done) ||
    renamedRows.some(
      (row) => current.find((entry) => entry.id === row.id)?.done,
    );
  const hasChanges =
    removedRows.length > 0 || renamedRows.length > 0 || addedRows.length > 0;

  /** Áp bản nháp: xoá, đổi tên rồi thêm; hiện ngay trên card và gửi server lần lượt qua hàng đợi. */
  const applyDraft = () => {
    setConfirmApply(false);
    setManageOpen(false);
    for (const entry of removedRows) {
      const index = itemsRef.current.findIndex(
        (other) => other.id === entry.id,
      );
      if (index < 0) continue;
      commit(applyRemove(itemsRef.current, entry.id));
      void write(
        () => apiRef.current.remove(item.id, entry.id),
        'Không xoá được đầu việc.',
        () => commit(applyRestore(itemsRef.current, entry, index)),
      );
    }
    for (const row of renamedRows) {
      const before = itemsRef.current.find((other) => other.id === row.id);
      if (!before || !row.id) continue;
      const text = row.title.trim().slice(0, CHECKLIST_TITLE_MAX_LENGTH);
      const id = row.id;
      commit(applyTitle(itemsRef.current, id, text));
      void write(
        () => apiRef.current.update(item.id, id, { title: text }),
        'Không đổi được tên đầu việc.',
        () => commit(applyTitle(itemsRef.current, id, before.title)),
      );
    }
    if (addedRows.length > 0)
      addTitles(
        addedRows.map((row) => row.title),
        '',
      );
  };

  const submitDraft = () => {
    if (!hasChanges) return;
    if (touchesDone) setConfirmApply(true);
    else applyDraft();
  };

  const done = (items ?? []).filter((entry) => entry.done).length;
  const percent = checklistPercent(done, total);
  const switchNotice = state.canAdd && method === 'manual' && total === 0;

  if (!state.visible && !failed) return null;

  /** Một dòng đầu việc trên card: tích và đọc; thêm, sửa, xoá nằm trong hộp quản lý. */
  const renderRow = (entry: ChecklistEntry) => {
    const pending = isTempChecklistId(entry.id);
    const doneNote =
      entry.done && (entry.doneBy || entry.doneAt)
        ? `Hoàn thành bởi ${entry.doneBy ? directory.nameOf(entry.doneBy) : '—'}${entry.doneAt ? ` · ${formatShortDate(entry.doneAt)}` : ''}`
        : '';
    return (
      <li
        key={entry.id}
        className={cn('flex min-w-0 items-center', pending && 'opacity-60')}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-accent focus-within:bg-accent">
          <Checkbox
            checked={entry.done}
            disabled={!editable || pending}
            aria-label={`${entry.done ? 'Bỏ tích' : 'Tích'} đầu việc ${entry.title}`}
            onCheckedChange={(checked) => toggle(entry, checked)}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className={cn(
                'min-w-0 text-[13px] leading-snug [overflow-wrap:anywhere]',
                entry.done && 'text-muted-foreground line-through',
              )}
            >
              {entry.title}
            </span>
            {doneNote ? (
              <small className="text-[11.5px] text-muted-foreground">
                {doneNote}
              </small>
            ) : null}
          </div>
        </div>
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
            onClick={openManage}
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
              {items.map((entry) => renderRow(entry))}
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
        subtitle="Thêm, sửa tên hoặc xoá đầu việc. Bấm Cập nhật để áp dụng cho công việc."
        submitLabel="Cập nhật"
        cancelLabel="Huỷ"
        submitDisabled={!hasChanges}
        centered
        onClose={() => setManageOpen(false)}
        onSubmit={submitDraft}
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
                addDraft([
                  ...splitChecklistLines(title.slice(0, start)),
                  ...lines,
                  ...splitChecklistLines(title.slice(end)),
                ]);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  addDraft([title]);
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!title.trim()}
              onClick={() => addDraft([title])}
            >
              <Plus aria-hidden />
              Thêm
            </Button>
          </div>
          {rows.length > 0 ? (
            <ul
              className="flex max-h-[50vh] list-none flex-col gap-1 overflow-y-auto"
              // Chừa 4px quanh danh sách để vòng sáng khi focus ô nhập không bị khung cuộn cắt.
              style={{ margin: '-4px', padding: '4px' }}
            >
              {rows.map((row) => (
                <li key={row.key} className="flex min-w-0 items-center gap-2">
                  <Input
                    className="h-8"
                    value={row.title}
                    maxLength={CHECKLIST_TITLE_MAX_LENGTH}
                    aria-label={`Tên đầu việc ${row.title}`}
                    onChange={(event) =>
                      setRows((list) =>
                        list.map((other) =>
                          other.key === row.key
                            ? { ...other, title: event.target.value }
                            : other,
                        ),
                      )
                    }
                  />
                  <Tip content="Xoá đầu việc">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="border-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Xoá đầu việc ${row.title}`}
                      onClick={() =>
                        setRows((list) =>
                          list.filter((other) => other.key !== row.key),
                        )
                      }
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </Tip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[12.5px] text-muted-foreground">
              Chưa có đầu việc nào.
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmBox
        open={confirmApply}
        title="Bạn có chắc chắn muốn thay đổi đầu việc đã hoàn thành?"
        message={
          removedRows.some((entry) => entry.done)
            ? 'Đầu việc đã hoàn thành bị xoá hoặc đổi tên sẽ không còn khớp với phần việc đã làm; tiến độ được tính lại.'
            : 'Đầu việc đã hoàn thành được đổi tên sẽ không còn khớp với phần việc đã làm.'
        }
        confirmLabel="Cập nhật"
        tone="warning"
        onConfirm={applyDraft}
        onCancel={() => setConfirmApply(false)}
      />
    </section>
  );
}
