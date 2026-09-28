'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table, Tabs } from 'antd';
import {
  Calendar as CalendarIcon,
  Bell,
  GitBranch,
  RefreshCw,
  AlertTriangle,
  Check,
} from 'lucide-react';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';

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
type Workflow = {
  id: string;
  request_kind: string;
  request_id: string;
  instance_code: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
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

function getStatusBadge(status: string) {
  switch (status) {
    case 'APPROVED':
    case 'DISBURSED':
    case 'REPAID':
      return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">{states[status] || status}</Badge>;
    case 'PENDING':
    case 'PEER_CONFIRMED':
      return <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-xs">{states[status] || status}</Badge>;
    case 'REJECTED':
    case 'CANCELLED':
      return <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-xs">{states[status] || status}</Badge>;
    default:
      return <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-xs">{states[status] || status}</Badge>;
  }
}

export default function HrmCalendarScreen() {
  const today = new Date().toLocaleDateString('en-CA');
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Event[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, n, w] = await Promise.all([
        hrmFetch<{ data: Event[] }>(`/my-calendar?from=${from}&to=${to}`),
        hrmFetch<{ data: Notice[] }>('/my-notifications'),
        hrmFetch<{ data: Workflow[] }>('/request-workflows'),
      ]);
      setRows(c.data);
      setNotices(n.data);
      setWorkflows(w.data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu lịch');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
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

  const unreadNoticesCount = notices.filter((n) => !n.read_at).length;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <CalendarIcon className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Lịch làm việc & Thông báo cá nhân
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Xem chi tiết lịch ca phân bổ, lịch nghỉ lễ, cập nhật thông báo và tiến độ xử lý hồ sơ tự động.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
            className="text-xs h-9 flex items-center gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Đang tải...' : 'Làm mới'}</span>
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs flex items-center gap-2"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Main Tabs Card */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs p-5">
        <Tabs
          items={[
            {
              key: 'calendar',
              label: (
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <CalendarIcon className="size-3.5" />
                  <span>Lịch làm việc</span>
                </span>
              ),
              children: (
                <div className="space-y-4 pt-2">
                  <div className="flex flex-wrap items-center gap-3 bg-slate-50/70 p-3 rounded-lg border border-slate-200">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                        Từ ngày
                      </label>
                      <Input
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        className="text-xs h-8"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                        Đến ngày
                      </label>
                      <Input
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="text-xs h-8"
                      />
                    </div>
                  </div>

                  <Table<Event>
                    size="small"
                    rowKey={(r) => `${r.kind}:${r.reference_id}:${r.date}`}
                    dataSource={rows}
                    pagination={{
                      pageSize: 20,
                      showSizeChanger: true,
                      showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} sự kiện`,
                    }}
                    scroll={{ x: 800, y: 500 }}
                    columns={[
                      {
                        title: 'Ngày',
                        dataIndex: 'date',
                        width: 130,
                        sorter: (a, b) => a.date.localeCompare(b.date),
                        render: (v) => <span className="font-semibold text-slate-900">{v}</span>,
                      },
                      {
                        title: 'Loại sự kiện',
                        dataIndex: 'kind',
                        width: 170,
                        render: (v) => (
                          <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                            {labels[v] || v}
                          </Badge>
                        ),
                      },
                      {
                        title: 'Nội dung',
                        dataIndex: 'label',
                        render: (v) => <span className="font-medium text-slate-800">{v}</span>,
                      },
                      {
                        title: 'Chi tiết',
                        dataIndex: 'detail',
                        render: (v) => <span className="text-xs text-slate-500">{v || '—'}</span>,
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'notifications',
              label: (
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Bell className="size-3.5" />
                  <span>Thông báo</span>
                  {unreadNoticesCount > 0 && (
                    <span className="size-4 rounded-full bg-rose-600 text-white text-[10px] flex items-center justify-center font-bold">
                      {unreadNoticesCount}
                    </span>
                  )}
                </span>
              ),
              children: (
                <div className="pt-2">
                  <Table<Notice>
                    size="small"
                    rowKey="id"
                    dataSource={notices}
                    scroll={{ x: 900, y: 520 }}
                    pagination={{
                      pageSize: 20,
                      showSizeChanger: true,
                      showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} thông báo`,
                    }}
                    columns={[
                      {
                        title: 'Thời điểm',
                        dataIndex: 'created_at',
                        width: 180,
                        render: (v) => (
                          <span className="text-xs text-slate-600 font-mono">
                            {new Date(v).toLocaleString('vi-VN')}
                          </span>
                        ),
                      },
                      {
                        title: 'Loại đơn từ',
                        dataIndex: 'request_kind',
                        width: 170,
                        render: (v) => (
                          <span className="font-medium text-slate-800 text-xs">
                            {labels[v] || v}
                          </span>
                        ),
                      },
                      {
                        title: 'Trạng thái',
                        dataIndex: 'status',
                        width: 140,
                        render: (v) => getStatusBadge(v),
                      },
                      {
                        title: 'Mã đơn',
                        dataIndex: 'request_id',
                        render: (v) => <span className="font-mono text-xs text-slate-500">{v}</span>,
                      },
                      {
                        title: 'Thao tác',
                        width: 150,
                        render: (_, r) =>
                          r.read_at ? (
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <Check className="size-3 text-emerald-600" />
                              <span>Đã đọc</span>
                            </span>
                          ) : (
                            <Button
                              variant="outline"
                              onClick={() => void mark(r.id)}
                              className="h-7 text-xs px-2.5"
                            >
                              Đánh dấu đã đọc
                            </Button>
                          ),
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'workflow-progress',
              label: (
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <GitBranch className="size-3.5" />
                  <span>Tiến độ luồng phê duyệt</span>
                </span>
              ),
              children: (
                <div className="pt-2">
                  <Table<Workflow>
                    size="small"
                    rowKey="id"
                    dataSource={workflows}
                    scroll={{ x: 1000, y: 520 }}
                    pagination={{
                      pageSize: 20,
                      showSizeChanger: true,
                      showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} quy trình`,
                    }}
                    columns={[
                      {
                        title: 'Loại đơn',
                        dataIndex: 'request_kind',
                        width: 160,
                        render: (value) => (
                          <span className="font-medium text-slate-800 text-xs">
                            {labels[value] || value}
                          </span>
                        ),
                      },
                      {
                        title: 'Mã đơn',
                        dataIndex: 'request_id',
                        render: (value) => <span className="font-mono text-xs text-slate-500">{value}</span>,
                      },
                      {
                        title: 'Hồ sơ quy trình',
                        dataIndex: 'instance_code',
                        render: (value) => (
                          <span className="font-mono text-xs text-blue-700">
                            {value || 'Đang khởi tạo'}
                          </span>
                        ),
                      },
                      {
                        title: 'Trạng thái đồng bộ',
                        dataIndex: 'status',
                        width: 150,
                        render: (value) =>
                          value === 'FAILED' ? (
                            <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-xs">Lỗi đồng bộ</Badge>
                          ) : (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">{value}</Badge>
                          ),
                      },
                      {
                        title: 'Lần thử',
                        dataIndex: 'attempts',
                        width: 90,
                        render: (v) => <span className="text-xs text-slate-700 font-mono">{v}</span>,
                      },
                      {
                        title: 'Thông tin lỗi / xử lý',
                        dataIndex: 'last_error',
                        render: (value) => (
                          <span className="text-xs text-slate-500 truncate block max-w-xs">
                            {value || '—'}
                          </span>
                        ),
                      },
                      {
                        title: 'Cập nhật',
                        dataIndex: 'updated_at',
                        width: 160,
                        render: (value) => (
                          <span className="text-xs text-slate-500 font-mono">
                            {value ? new Date(value).toLocaleString('vi-VN') : '—'}
                          </span>
                        ),
                      },
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
