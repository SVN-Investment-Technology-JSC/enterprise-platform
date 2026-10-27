'use client';

import { SOCIAL_BIRTHDAY_PAGE_QUERY_MAX, type SocialBirthdayEntry, type SocialBirthdaysUpcoming } from '@enterprise-platform/contracts-social';
import { Cake, CalendarDays, PartyPopper, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../social-api';
import { sliceSafe } from '../../safe-text';
import { loadBirthdaysUpcoming } from '../../social-discovery-api';
import { SocialLink } from '../../social-navigation';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { UserAvatar } from '../user-avatar';
import { ageLabel, entryDayMonth, monthGroupLabel, whenLabel } from './birthday.model';

const DEBOUNCE_MS = 300;
/** Trang đầy đủ xem rộng hơn mặc định để không thiếu người (tối đa của hợp đồng là 12). */
const PAGE_MONTHS = 6;

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3 m-0 list-none p-0';

function BirthdayCard({ entry }: { readonly entry: SocialBirthdayEntry }) {
  const age = ageLabel(entry);
  return (
    <li>
      <SocialLink
        to={{ name: 'profile', userId: entry.user.id }}
        data-today={entry.isToday}
        className="group relative flex h-full flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 pt-5 pb-4 text-center text-slate-900 no-underline shadow-xs transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:ring-3 focus-visible:ring-blue-500/30 focus-visible:outline-none data-[today=true]:border-amber-300 data-[today=true]:bg-amber-50/70"
      >
        {entry.isToday ? (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-950">
            <PartyPopper size={11} aria-hidden="true" />
            Hôm nay
          </span>
        ) : null}
        <span className="rounded-full p-0.5 ring-2 ring-slate-100 transition group-data-[today=true]:ring-amber-300">
          <UserAvatar user={entry.user} size={56} link={false} hover={false} />
        </span>
        <span className="mt-1.5 w-full text-[14.5px] leading-snug font-semibold break-words">{entry.user.name}</span>
        <span className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1 font-medium text-rose-600">
            <Cake size={12} aria-hidden="true" />
            {entryDayMonth(entry)}
          </span>
          {age ? (
            <>
              <span className="size-0.5 rounded-full bg-slate-300" aria-hidden="true" />
              <span>{age}</span>
            </>
          ) : null}
        </span>
        {entry.isToday ? null : (
          <span className="mt-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {whenLabel(entry)}
          </span>
        )}
      </SocialLink>
    </li>
  );
}

/** Trang `/birthday`: sinh nhật sắp tới nhóm theo tháng, tìm theo tên hoặc đơn vị. */
export function BirthdayView() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SocialBirthdaysUpcoming>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(sliceSafe(text.trim(), SOCIAL_BIRTHDAY_PAGE_QUERY_MAX)), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    loadBirthdaysUpcoming({ months: PAGE_MONTHS, q: query || undefined })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause, 'Không tải được danh sách sinh nhật.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query]);

  const todayCount = data ? data.groups.flatMap((group) => group.items).filter((entry) => entry.isToday).length : 0;

  return (
    <section
      className="overflow-hidden rounded-[var(--ep-radius-xl)] border border-slate-200 bg-white shadow-xs"
      aria-label="Sinh nhật sắp tới"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-slate-200 bg-gradient-to-r from-amber-50 via-white to-white px-5 py-3.5">
        <span className="grid size-9 flex-none place-items-center rounded-xl bg-amber-100 text-amber-700">
          <Cake size={19} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[17px] leading-tight font-bold text-slate-900">Sinh nhật sắp tới</h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">
            {data
              ? todayCount > 0
                ? `Hôm nay có ${todayCount} người sinh nhật · ${data.total} người trong ${PAGE_MONTHS} tháng tới`
                : `${data.total} người trong ${PAGE_MONTHS} tháng tới`
              : 'Đồng nghiệp có sinh nhật trong thời gian tới'}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            className="h-[38px] rounded-md pr-9 pl-9 text-[13.5px]!"
            placeholder="Tìm theo tên hoặc đơn vị"
            aria-label="Tìm sinh nhật theo tên hoặc đơn vị"
            maxLength={SOCIAL_BIRTHDAY_PAGE_QUERY_MAX}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {text ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-500"
              aria-label="Xoá tìm kiếm"
              onClick={() => setText('')}
            >
              <X size={12} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-6 px-5 py-5">
        {error ? (
          <p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">
            {error}
          </p>
        ) : loading && !data ? (
          <ul className={GRID} aria-busy="true">
            {Array.from({ length: 8 }, (_, index) => (
              <li key={index} className="h-40 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </ul>
        ) : data && data.groups.length > 0 ? (
          data.groups.map((group) => (
            <div key={`${group.year}-${group.month}`} className="flex flex-col gap-3">
              <h2 className="m-0 flex items-center gap-2.5 text-xs font-bold tracking-wide text-slate-500 uppercase">
                <CalendarDays size={14} aria-hidden="true" />
                {monthGroupLabel(group, data.today)}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 normal-case">
                  {group.items.length}
                </span>
                <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
              </h2>
              <ul className={GRID}>
                {group.items.map((entry) => (
                  <BirthdayCard key={`${entry.user.id}-${entry.date}`} entry={entry} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center gap-2 py-14 text-center text-slate-500">
            <span className="grid size-12 place-items-center rounded-full bg-slate-100 text-slate-400">
              <Cake size={22} aria-hidden="true" />
            </span>
            <p className="m-0 text-[13.5px]">
              {query ? 'Không có sinh nhật nào khớp với từ khoá.' : 'Chưa có sinh nhật nào sắp tới.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
