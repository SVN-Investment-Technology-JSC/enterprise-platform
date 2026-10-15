'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import type { HrmMentionCandidate, HrmRequestComment } from '@enterprise-platform/contracts-hrm';
import { useRealtimeNotificationsOptional } from '@enterprise-platform/shared-ui';
import { HrmApiError, hrmFetch } from '../../hrm-api';
import { Button } from '../button';

const DECISION_LABEL: Record<string, { label: string; className: string }> = {
  APPROVE: { label: 'Đã phê duyệt', className: 'bg-emerald-50 text-emerald-700' },
  REJECT: { label: 'Đã từ chối', className: 'bg-rose-50 text-rose-700' },
  RETURN: { label: 'Đã trả lại', className: 'bg-amber-50 text-amber-700' },
  COMPLETE: { label: 'Đã hoàn thành bước', className: 'bg-sky-50 text-sky-700' },
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function timeText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

/** Nội dung bình luận: các đoạn @Tên của người được nhắc được tô đậm. */
export function CommentBody({ comment }: { comment: Pick<HrmRequestComment, 'body' | 'mentions'> }) {
  const names = comment.mentions.map((m) => m.name).filter(Boolean);
  if (!names.length) return <>{comment.body}</>;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  const parts = comment.body.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'));
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('@') && names.includes(part.slice(1)) ? (
          <span key={i} className="rounded bg-blue-50 px-1 font-semibold text-[#1d4ed8]" data-testid="mention">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** Đang gõ `@abc` ở cuối con trỏ: trả từ khoá `abc` và vị trí bắt đầu của `@`. */
export function activeMention(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,30})$/.exec(before);
  if (!match) return null;
  return { query: match[2], start: before.length - match[2].length - 1 };
}

/**
 * Trao đổi trên một đơn: người gửi, người duyệt và những người được nhắc tên (@) cùng thấy một luồng. Ý kiến kèm quyết định
 * phê duyệt cũng hiện ở đây. Tự làm mới khi có thông báo realtime mới về đơn này, khi quay lại cửa sổ và mỗi 30 giây.
 */
export function RequestThread({ kind, requestId, refreshKey = 0 }: { kind: string; requestId: string; refreshKey?: number }) {
  const [comments, setComments] = useState<HrmRequestComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<HrmMentionCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<{ query: string; start: number } | null>(null);
  const [candidates, setCandidates] = useState<HrmMentionCandidate[]>([]);
  const [highlight, setHighlight] = useState(0);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const center = useRealtimeNotificationsOptional();
  const latestNotificationId = center?.notifications[0]?.id;

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const res = await hrmFetch<{ data: HrmRequestComment[] }>(
          `/request-comments?${new URLSearchParams({ kind, requestId })}`,
        );
        setComments(res.data);
        setError('');
      } catch (e) {
        setError(e instanceof HrmApiError && e.status === 403 ? 'Bạn không có quyền xem trao đổi của đơn này.' : e instanceof Error ? e.message : 'Không tải được trao đổi.');
      } finally {
        setLoading(false);
      }
    },
    [kind, requestId],
  );

  useEffect(() => {
    setComments([]);
    setText('');
    setMentions([]);
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const timer = setInterval(() => void load(true), 30_000);
    const focus = () => void load(true);
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [load]);

  // Thông báo realtime mới (người khác vừa trao đổi): tải lại luồng ngay.
  useEffect(() => {
    if (latestNotificationId) void load(true);
  }, [latestNotificationId, load]);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'nearest' });
  }, [comments.length]);

  // Gợi ý người được nhắc khi đang gõ @...
  useEffect(() => {
    if (!picker) {
      setCandidates([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      hrmFetch<{ data: HrmMentionCandidate[] }>(`/request-comments/mention-candidates?${new URLSearchParams({ q: picker.query })}`)
        .then((r) => {
          if (live) {
            setCandidates(r.data);
            setHighlight(0);
          }
        })
        .catch(() => {
          if (live) setCandidates([]);
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [picker]);

  function onChange(value: string, caret: number) {
    setText(value);
    setPicker(activeMention(value, caret));
  }

  function choose(person: HrmMentionCandidate) {
    if (!picker) return;
    const caret = area.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, picker.start)}@${person.name} ${text.slice(caret)}`;
    setText(next);
    setMentions((prev) => (prev.some((m) => m.userId === person.userId) ? prev : [...prev, person]));
    setPicker(null);
    requestAnimationFrame(() => {
      const pos = picker.start + person.name.length + 2;
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
    });
  }

  // Chỉ gửi người còn nằm trong nội dung (đã xoá @Tên thì không nhắc nữa).
  const activeMentions = useMemo(() => mentions.filter((m) => text.includes(`@${m.name}`)), [mentions, text]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError('');
    try {
      await hrmFetch('/request-comments', {
        method: 'POST',
        body: JSON.stringify({ kind, requestId, body, mentionUserIds: activeMentions.map((m) => m.userId) }),
      });
      setText('');
      setMentions([]);
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không gửi được.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Trao đổi về đơn" className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-[14px] font-bold text-slate-900">
        <MessageSquare className="size-4 text-[#2563eb]" />
        Trao đổi và ý kiến ({comments.length})
      </h3>
      {loading ? (
        <p role="status" className="flex items-center gap-1.5 py-2 text-xs text-slate-500">
          <Loader2 className="size-3.5 animate-spin" /> Đang tải…
        </p>
      ) : comments.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-xs text-slate-500">Chưa có trao đổi nào. Gõ @ để nhắc tên người cần xem đơn này.</p>
      ) : (
        <ul className="max-h-[260px] space-y-2.5 overflow-y-auto pr-1" data-testid="thread-list">
          {comments.map((c) => {
            const decision = c.decision ? DECISION_LABEL[c.decision] : undefined;
            return (
              <li key={c.id} className="flex gap-2">
                <span
                  aria-hidden="true"
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${c.mine ? 'bg-[#ffc90a] text-[#1a1a1a]' : 'bg-slate-200 text-slate-600'}`}
                >
                  {initials(c.authorName)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-[12px]">
                    <span className="font-semibold text-slate-900">{c.authorName}</span>
                    {decision ? <span className={`rounded-full px-1.5 py-0.5 text-[12px] font-semibold ${decision.className}`}>{decision.label}</span> : null}
                    <span className="text-slate-400">{timeText(c.createdAt)}</span>
                  </p>
                  <p className={`mt-0.5 whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-[13px] ${c.kind === 'DECISION' ? 'border border-slate-200 bg-white' : 'bg-slate-50'}`}>
                    <CommentBody comment={c} />
                  </p>
                </div>
              </li>
            );
          })}
          <div ref={bottom} />
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      <div className="relative">
        <textarea
          ref={area}
          aria-label="Nội dung trao đổi"
          rows={2}
          maxLength={4000}
          value={text}
          placeholder="Viết trao đổi... gõ @ để nhắc tên"
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (picker && candidates.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight((h) => (h + 1) % candidates.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((h) => (h - 1 + candidates.length) % candidates.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                choose(candidates[highlight]);
                return;
              }
            }
            if (e.key === 'Escape') setPicker(null);
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
          }}
          className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 pr-11 text-[13px] outline-none focus:border-[#d9ab00] focus:ring-2 focus:ring-[#d9ab00]/30"
        />
        <Button
          type="button"
          size="icon-sm"
          aria-label="Gửi trao đổi"
          disabled={busy || !text.trim()}
          onClick={() => void send()}
          className="absolute bottom-2 right-2"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        </Button>
        {picker && candidates.length > 0 ? (
          <ul role="listbox" aria-label="Người có thể nhắc tên" className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {candidates.map((p, i) => (
              <li key={p.userId} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(p);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${i === highlight ? 'bg-slate-100' : ''}`}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[12px] font-bold text-slate-600">{initials(p.name)}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">{p.name}</span>
                    <span className="block truncate text-[12px] text-slate-500">
                      {[p.employeeCode, p.department].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {activeMentions.length > 0 ? (
        <p className="text-[12px] text-slate-500">Sẽ thông báo cho: {activeMentions.map((m) => m.name).join(', ')}</p>
      ) : null}
    </section>
  );
}
