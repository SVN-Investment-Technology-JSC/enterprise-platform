'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HrmAttendance } from '@enterprise-platform/contracts-hrm';
import { Table } from 'antd';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

type TimeContext = {
  employeeId: string;
  workDate: string;
  timezone: string;
  requireGps: boolean;
  shift: {
    window: {
      start: string;
      end: string;
      graceLateMinutes: number;
      graceEarlyMinutes: number;
    };
  } | null;
};
export default function AttendancePage() {
  const [rows, setRows] = useState<HrmAttendance[]>([]);
  const [context, setContext] = useState<TimeContext | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'correction' | 'device' | null>(null);
  const [date, setDate] = useState('');
  const [sessions, setSessions] = useState([{ start: '', end: '' }]);
  const eventKey = useRef<string | null>(null);
  const load = useCallback(async () => {
    const [attendance, current] = await Promise.all([
      hrmFetch<{ data: HrmAttendance[] }>('/my-attendance'),
      hrmFetch<{ data: TimeContext }>('/my-attendance-context'),
    ]);
    setRows(attendance.data);
    setContext(current.data);
  }, []);
  useEffect(() => {
    let active = true;
    void load().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [load]);
  const current = rows.find((row) => row.workDate === context?.workDate);
  const open = current?.calculationSnapshot?.openSession === true;
  const format = (value: string | null | undefined) =>
    value
      ? new Date(value).toLocaleString('vi-VN', {
          timeZone: context?.timezone || 'Asia/Ho_Chi_Minh',
        })
      : '—';
  async function punch(kind: 'check-in' | 'check-out') {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let position: Record<string, number> = {};
      if (context?.requireGps) {
        if (!navigator.geolocation)
          throw new Error('Trình duyệt không hỗ trợ định vị');
        const gps = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            resolve,
            () =>
              reject(
                new Error(
                  'Không lấy được GPS. Hãy cấp quyền vị trí và thử lại.',
                ),
              ),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
          ),
        );
        position = {
          latitude: gps.coords.latitude,
          longitude: gps.coords.longitude,
          accuracy: gps.coords.accuracy,
        };
      }
      eventKey.current ||= crypto.randomUUID();
      await hrmFetch(`/attendance/${kind}`, {
        method: 'POST',
        body: JSON.stringify({
          ...position,
          externalEventId: eventKey.current,
        }),
      });
      eventKey.current = null;
      await load();
      setMessage(
        kind === 'check-in' ? 'Đã ghi nhận lượt vào.' : 'Đã ghi nhận lượt ra.',
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Không ghi nhận được chấm công',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Chấm công cá nhân</h1>
        <p className="text-sm text-slate-500">
          Theo dõi từng lượt vào/ra, công thực tế và gửi giải trình khi có sai
          lệch.
        </p>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-red-700"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="rounded border border-green-200 bg-green-50 p-3 text-green-800"
        >
          {message}
        </p>
      )}
      <section className="grid gap-4 rounded-xl border bg-white p-5 md:grid-cols-2">
        <div>
          <h2 className="font-semibold">
            Ngày công {context?.workDate || '—'}
          </h2>
          <p className="text-sm text-slate-500">{context?.timezone}</p>
          <p className="my-2">
            {context?.shift
              ? `${format(context.shift.window.start)} → ${format(context.shift.window.end)}`
              : 'Chưa có ca tại thời điểm hiện tại'}
          </p>
          <p className="text-sm">
            Đã ghi nhận: {current?.workedMinutes || 0} phút · Trễ:{' '}
            {current?.lateMinutes || 0} phút · Về sớm:{' '}
            {current?.earlyMinutes || 0} phút
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            permission="hrm.self.attendance"
            disabled={busy || !context?.shift || open}
            onClick={() => void punch('check-in')}
          >
            Ghi nhận vào
          </Button>
          <Button
            permission="hrm.self.attendance"
            disabled={busy || !context?.shift || !open}
            onClick={() => void punch('check-out')}
          >
            Ghi nhận ra
          </Button>
          <Button
            permission="hrm.self.attendance"
            variant="outline"
            disabled={busy}
            onClick={() => setDialog('device')}
          >
            Đăng ký trình duyệt
          </Button>
          <Button
            permission="hrm.self.request"
            variant="outline"
            onClick={() => {
              setDate(context?.workDate || '');
              setSessions([{ start: '', end: '' }]);
              setDialog('correction');
            }}
          >
            Gửi giải trình
          </Button>
        </div>
      </section>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-4 font-semibold">Lịch sử công cá nhân</h2>
        <Table<HrmAttendance>
          rowKey="id"
          dataSource={rows}
          pagination={{ pageSize: 15 }}
          scroll={{ x: 1000 }}
          columns={[
            { title: 'Ngày công', dataIndex: 'workDate' },
            { title: 'Vào đầu', render: (_, r) => format(r.checkInAt) },
            { title: 'Ra cuối', render: (_, r) => format(r.checkOutAt) },
            { title: 'Phút công', dataIndex: 'workedMinutes' },
            { title: 'Phút ca', dataIndex: 'scheduledMinutes' },
            {
              title: 'Trễ / sớm',
              render: (_, r) =>
                `${r.lateMinutes || 0} / ${r.earlyMinutes || 0}`,
            },
            { title: 'Trạng thái', dataIndex: 'status' },
          ]}
          expandable={{
            expandedRowRender: (r) => (
              <div className="space-y-2">
                <p>
                  Bất thường:{' '}
                  {(
                    r.calculationSnapshot?.anomalies as string[] | undefined
                  )?.join(', ') || 'Không'}
                </p>
                {(
                  r.calculationSnapshot?.sessions as
                    | { start: string; end: string }[]
                    | undefined
                )?.map((s, i) => (
                  <p key={`${s.start}-${i}`}>
                    Lượt {i + 1}: {format(s.start)} → {format(s.end)}
                  </p>
                ))}
              </div>
            ),
          }}
        />
      </section>
      <Dialog
        open={!!dialog}
        onOpenChange={(value) => {
          if (!value && !busy) setDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>
              {dialog === 'device'
                ? 'Đăng ký trình duyệt chấm công'
                : 'Giải trình công'}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const form = new FormData(e.currentTarget);
              setBusy(true);
              setError('');
              try {
                if (dialog === 'device')
                  await hrmFetch('/time-settings/devices/register', {
                    method: 'POST',
                    body: JSON.stringify({ name: form.get('name') }),
                  });
                else {
                  await hrmFetch('/attendance-corrections', {
                    method: 'POST',
                    body: JSON.stringify({
                      employeeId: context?.employeeId,
                      requestDate: date,
                      reason: form.get('reason'),
                      sessions: sessions.map((s) => ({
                        start: new Date(s.start).toISOString(),
                        end: new Date(s.end).toISOString(),
                      })),
                    }),
                  });
                }
                setMessage(
                  dialog === 'device'
                    ? 'Đã đăng ký; chờ quản lý duyệt thiết bị.'
                    : 'Đã gửi giải trình; chờ phê duyệt.',
                );
                setDialog(null);
                await load();
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : 'Không gửi được yêu cầu',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {dialog === 'device' ? (
              <label className="block text-sm">
                Tên thiết bị / trình duyệt
                <Input name="name" required maxLength={180} />
              </label>
            ) : (
              <>
                <label className="block text-sm">
                  Ngày công
                  <Input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <p className="text-sm text-slate-500">
                  Khai báo đầy đủ các cặp giờ thực tế của ngày công. Giờ nhập
                  theo múi giờ thiết bị của bạn.
                </p>
                <div className="max-h-64 space-y-3 overflow-auto">
                  {sessions.map((s, i) => (
                    <div className="grid grid-cols-2 gap-3" key={i}>
                      <label className="text-sm">
                        Lượt vào {i + 1}
                        <Input
                          type="datetime-local"
                          required
                          value={s.start}
                          onChange={(e) =>
                            setSessions(
                              sessions.map((v, j) =>
                                j === i ? { ...v, start: e.target.value } : v,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="text-sm">
                        Lượt ra {i + 1}
                        <Input
                          type="datetime-local"
                          required
                          value={s.end}
                          onChange={(e) =>
                            setSessions(
                              sessions.map((v, j) =>
                                j === i ? { ...v, end: e.target.value } : v,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={sessions.length >= 12}
                  onClick={() =>
                    setSessions([...sessions, { start: '', end: '' }])
                  }
                >
                  Thêm lượt
                </Button>
                <label className="block text-sm">
                  Lý do
                  <Input name="reason" required maxLength={2000} />
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Đang gửi…' : 'Gửi yêu cầu'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
