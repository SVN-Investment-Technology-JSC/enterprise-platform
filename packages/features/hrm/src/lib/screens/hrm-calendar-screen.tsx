'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table, Tabs, Tag } from 'antd';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
type Event = {
  kind: string;
  date: string;
  label: string;
  detail: string;
  reference_id: string;
};
type Notice = {
  id: string;
  request_kind: string;
  request_id: string;
  status: string;
  created_at: string;
  read_at: string | null;
};
const labels: Record<string, string> = {
  SHIFT: 'Ca làm việc',
  WORK: 'Ngày làm',
  OFF: 'Nghỉ tuần',
  HOLIDAY: 'Lễ / Tết',
  LEAVE: 'Nghỉ phép',
  OT: 'Tăng ca',
  BUSINESS_TRIP: 'Công tác',
  ATTENDANCE: 'Giải trình công',
  PROFILE: 'Điều chỉnh hồ sơ',
  ADVANCE: 'Tạm ứng',
  SHIFT_CHANGE: 'Đổi ca',
};
const states: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã rút / hủy',
  PEER_CONFIRMED: 'Đồng nghiệp đã xác nhận',
  DISBURSED: 'Đã giải ngân',
  REPAID: 'Đã thu hồi hết',
};
export default function HrmCalendarScreen() {
  const today = new Date().toLocaleDateString('en-CA');
  const [from, setFrom] = useState(today.slice(0, 7) + '-01'),
    [to, setTo] = useState(today),
    [rows, setRows] = useState<Event[]>([]),
    [notices, setNotices] = useState<Notice[]>([]),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    const [c, n] = await Promise.all([
      hrmFetch<{ data: Event[] }>(`/my-calendar?from=${from}&to=${to}`),
      hrmFetch<{ data: Notice[] }>('/my-notifications'),
    ]);
    setRows(c.data);
    setNotices(n.data);
  }, [from, to]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  async function mark(id: string) {
    try {
      await hrmFetch(`/my-notifications/${id}/read`, {
        method: 'POST',
        body: '{}',
      });
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Không cập nhật được thông báo',
      );
    }
  }
  return (
    <main className="space-y-3">
      <h1 className="text-lg font-semibold">
        Lịch làm việc và thông báo cá nhân
      </h1>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <Tabs
        items={[
          {
            key: 'calendar',
            label: 'Lịch làm việc',
            children: (
              <>
                <div className="mb-3 flex items-end gap-2">
                  <label className="text-xs">
                    Từ ngày
                    <Input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label className="text-xs">
                    Đến ngày
                    <Input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void load().catch((e) => setError(e.message))
                    }
                  >
                    Làm mới
                  </Button>
                </div>
                <Table<Event>
                  rowKey={(r) => `${r.kind}:${r.reference_id}:${r.date}`}
                  dataSource={rows}
                  pagination={{ pageSize: 30, showSizeChanger: true }}
                  scroll={{ x: 800, y: 500 }}
                  columns={[
                    {
                      title: 'Ngày',
                      dataIndex: 'date',
                      width: 125,
                      sorter: (a, b) => a.date.localeCompare(b.date),
                    },
                    {
                      title: 'Loại',
                      dataIndex: 'kind',
                      width: 160,
                      render: (v) => labels[v] || v,
                    },
                    { title: 'Nội dung', dataIndex: 'label' },
                    { title: 'Chi tiết', dataIndex: 'detail' },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'notifications',
            label: `Thông báo (${notices.filter((n) => !n.read_at).length} chưa đọc)`,
            children: (
              <Table<Notice>
                rowKey="id"
                dataSource={notices}
                scroll={{ x: 900, y: 540 }}
                pagination={{ pageSize: 30, showSizeChanger: true }}
                columns={[
                  {
                    title: 'Thời điểm',
                    dataIndex: 'created_at',
                    render: (v) => new Date(v).toLocaleString('vi-VN'),
                  },
                  {
                    title: 'Loại đơn',
                    dataIndex: 'request_kind',
                    render: (v) => labels[v] || v,
                  },
                  {
                    title: 'Trạng thái',
                    dataIndex: 'status',
                    render: (v) => <Tag>{states[v] || v}</Tag>,
                  },
                  { title: 'Mã đơn', dataIndex: 'request_id', ellipsis: true },
                  {
                    title: 'Thao tác',
                    render: (_, r) =>
                      r.read_at ? (
                        'Đã đọc'
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => void mark(r.id)}
                        >
                          Đánh dấu đã đọc
                        </Button>
                      ),
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </main>
  );
}
