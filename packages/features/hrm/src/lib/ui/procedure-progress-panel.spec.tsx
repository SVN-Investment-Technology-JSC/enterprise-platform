/** @jest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import {
  ProcedureProgressPanel,
  useProcedureProgress,
} from './procedure-progress-panel';
import type { ProcedureProgressData } from '../procedure-progress-view';

const data = (status = 'running'): ProcedureProgressData => ({
  instanceId: 'abcdef12-0000',
  instanceCode: 'PE-001',
  status,
  currentStepName: 'Quản lý duyệt',
  currentAssigneeName: 'Trần B',
  activity: [],
  steps: [
    { id: 's1', name: 'Nộp đơn', status: 'completed', order: 1 },
    {
      id: 's2',
      name: 'Quản lý duyệt',
      status: 'active',
      order: 2,
      roleTitle: 'Trần B',
      slaHours: 8,
    },
  ],
});

describe('ProcedureProgressPanel', () => {
  it('hiển thị bước, người xử lý, SLA và người đang chờ', () => {
    render(<ProcedureProgressPanel progress={data()} loading={false} />);
    expect(screen.getByText('PE-001')).toBeTruthy();
    expect(
      screen.getByText('Đang chờ Trần B duyệt - Quản lý duyệt'),
    ).toBeTruthy();
    expect(screen.getByText(/SLA: 8h/)).toBeTruthy();
  });

  it('báo đang khởi tạo và đồng bộ lỗi', () => {
    const { rerender } = render(
      <ProcedureProgressPanel
        progress={null}
        loading={false}
        hasInstance={false}
        syncStatus="START_PENDING"
      />,
    );
    expect(screen.getByText('Đang khởi tạo quy trình')).toBeTruthy();
    rerender(
      <ProcedureProgressPanel
        progress={null}
        loading={false}
        hasInstance={false}
        syncStatus="FAILED"
        lastError="PE 503"
      />,
    );
    expect(screen.getByText('Đồng bộ lỗi - đang thử lại')).toBeTruthy();
    expect(screen.getByText('PE 503')).toBeTruthy();
  });
});

function Probe({ open }: { open: boolean }) {
  const { progress } = useProcedureProgress({
    instanceId: 'i1',
    kind: 'leave',
    requestId: 'r1',
    open,
  });
  return <span>{progress ? progress.status : 'none'}</span>;
}

describe('useProcedureProgress', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
  });

  it('làm mới mỗi 15 giây khi còn chạy, dừng khi kết thúc và khi tab ẩn', async () => {
    jest.useFakeTimers();
    const responses = ['running', 'running', 'completed'];
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: data(responses.shift() ?? 'completed') }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<Probe open />);
    await act(async () => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText('completed')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('không tải khi drawer đóng', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<Probe open={false} />);
    await act(async () => undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
