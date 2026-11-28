/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProcedureInstanceStep } from '@enterprise-platform/contracts-procedure-engine';
import { MODULE_EMBED_MESSAGE } from '@enterprise-platform/feature-module-shell';
import { FinanceVoucherCard, FinanceWaitingNote } from './finance-voucher-card';
import type { FinanceAccess } from './use-finance-access';

let mockAccess: FinanceAccess = 'allowed';
jest.mock('./use-finance-access', () => ({ useFinanceAccess: () => mockAccess }));

const step = (voucher?: Record<string, unknown>) =>
  ({
    id: 's3',
    order: 3,
    name: 'Kế toán chi tiền',
    integration: { module: 'finance', action: 'voucher', voucherKind: 'PAYMENT' },
    financeVoucher: voucher,
  }) as unknown as ProcedureInstanceStep;

const posted = { state: 'posted', voucherId: 'v/1', code: 'PC-2611-0006', amount: 111_111_111, postedByName: 'Tài Búa' };

beforeEach(() => {
  mockAccess = 'allowed';
});
afterEach(cleanup);

function post(source: Window | null | undefined, data: unknown, origin = window.location.origin) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: (source ?? null) as MessageEventSource | null }));
  });
}

describe('FinanceVoucherCard — người không dùng được Tài chính', () => {
  it('chưa biết quyền (đang hỏi) hoặc bị từ chối: vẫn hiện dòng tiến trình nhưng không có nút nào, không mở được popup', () => {
    for (const access of ['checking', 'denied'] as const) {
      mockAccess = access;
      const { unmount } = render(<FinanceVoucherCard step={step(posted)} />);
      expect(screen.getByText(/PC-2611-0006 · Đã ghi sổ/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Mở nhanh/ })).toBeNull();
      expect(screen.queryByRole('link', { name: /Mở phiếu/ })).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
      unmount();
    }
  });

  it('được phép thì hiện đủ hai nút', () => {
    mockAccess = 'allowed';
    render(<FinanceVoucherCard step={step(posted)} />);
    expect(screen.getByRole('button', { name: /Mở nhanh/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Mở phiếu/ })).toBeTruthy();
  });
});

describe('FinanceWaitingNote', () => {
  it('chỉ ghi một dòng: bước đóng khi kế toán ghi sổ phiếu', () => {
    render(<FinanceWaitingNote />);
    const note = screen.getByText(/Bước này đóng khi kế toán ghi sổ phiếu ở phân hệ Tài chính/);
    expect(note.textContent).not.toContain('Mở nhanh');
  });
});

describe('FinanceVoucherCard — Mở nhanh', () => {
  it('có phiếu thì hiện cả "Mở nhanh" (popup) lẫn "Mở phiếu" (trang đầy đủ); chưa có phiếu thì không có nút nào', () => {
    const { unmount } = render(<FinanceVoucherCard step={step(posted)} />);
    expect(screen.getByRole('button', { name: /Mở nhanh/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Mở phiếu/ }).getAttribute('href')).toBe('/modules/finance/payments/v%2F1');
    unmount();
    render(<FinanceVoucherCard step={step({ state: 'requested' })} />);
    expect(screen.queryByRole('button', { name: /Mở nhanh/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Mở phiếu/ })).toBeNull();
  });

  it('bấm "Mở nhanh" mở popup có iframe vào trang phiếu nhúng của Tài chính, tên theo loại và mã phiếu', () => {
    render(<FinanceVoucherCard step={step(posted)} />);
    fireEvent.click(screen.getByRole('button', { name: /Mở nhanh/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Phiếu chi PC-2611-0006');
    expect(dialog.textContent).toContain('Bước 3 · Kế toán chi tiền');
    const frame = dialog.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('/modules/finance/embed/payments/v%2F1');
    expect(frame.getAttribute('referrerpolicy')).toBe('same-origin');
  });

  it('mã và trạng thái do trang phiếu báo về hiện ở tiêu đề popup, thay mã ban đầu; tin sai hình dạng bị bỏ qua', () => {
    render(<FinanceVoucherCard step={step({ ...posted, code: 'NHAP_PC_2611_0021', state: 'linked' })} />);
    fireEvent.click(screen.getByRole('button', { name: /Mở nhanh/ }));
    const dialog = screen.getByRole('dialog');
    const frame = dialog.querySelector('iframe') as HTMLIFrameElement;
    expect(dialog.textContent).toContain('Phiếu chi NHAP_PC_2611_0021');

    post(frame.contentWindow, { type: MODULE_EMBED_MESSAGE.summary, code: 'x'.repeat(500) });
    expect(dialog.textContent).toContain('Phiếu chi NHAP_PC_2611_0021');

    post(frame.contentWindow, {
      type: MODULE_EMBED_MESSAGE.summary,
      code: 'PC-2611-0007',
      note: 'Mã nháp: NHAP_PC_2611_0021',
      badges: [
        { label: 'Đã duyệt', tone: 'success' },
        { label: 'Đã ghi sổ tài khoản', tone: 'success' },
      ],
    });
    expect(dialog.textContent).toContain('Phiếu chi PC-2611-0007 · Mã nháp: NHAP_PC_2611_0021');
    expect(dialog.textContent).toContain('Đã duyệt');
    expect(dialog.textContent).toContain('Đã ghi sổ tài khoản');
  });

  it('bấm nền hay nút đóng của popup không nổi bọt lên dòng bước (không mở thêm hộp "Bước N" sau khi đóng)', () => {
    const rowClick = jest.fn();
    const rowKey = jest.fn();
    render(
      <div onClick={rowClick} onKeyDown={rowKey}>
        <FinanceVoucherCard step={step(posted)} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Mở nhanh/ }));
    rowClick.mockClear();

    fireEvent.click(screen.getByRole('dialog')); // nền mờ: bấm ra ngoài để đóng
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rowClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Mở nhanh/ }));
    rowClick.mockClear();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(rowClick).not.toHaveBeenCalled();
    expect(rowKey).not.toHaveBeenCalled();
  });

  it('tin "đã đổi" từ đúng iframe chỉ được ghi nhận (chưa tải lại khi popup còn mở); tin từ nơi khác, khác tên miền hay sai hình dạng thì bỏ qua', () => {
    const onRefresh = jest.fn();
    render(<FinanceVoucherCard step={step(posted)} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: /Mở nhanh/ }));
    const frame = screen.getByRole('dialog').querySelector('iframe') as HTMLIFrameElement;

    post(window, { type: MODULE_EMBED_MESSAGE.changed }); // không phải cửa sổ con
    post(frame.contentWindow, { type: MODULE_EMBED_MESSAGE.changed }, 'https://evil.example');
    post(frame.contentWindow, { type: 'khong-hop-le' });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onRefresh).not.toHaveBeenCalled(); // không có tin hợp lệ nào: đóng popup không cần tải lại

    fireEvent.click(screen.getByRole('button', { name: /Mở nhanh/ }));
    const reopened = screen.getByRole('dialog').querySelector('iframe') as HTMLIFrameElement;
    post(reopened.contentWindow, { type: MODULE_EMBED_MESSAGE.changed });
    expect(onRefresh).not.toHaveBeenCalled(); // hồ sơ vừa xong sẽ rời danh sách và gỡ thẻ giữ popup: đợi đóng popup
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('tin "đóng" từ iframe (phiếu bị xoá) đóng popup; nếu phiếu đã đổi thì tải lại hồ sơ một lần', () => {
    const onRefresh = jest.fn();
    render(<FinanceVoucherCard step={step(posted)} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: /Mở nhanh/ }));
    const frame = screen.getByRole('dialog').querySelector('iframe') as HTMLIFrameElement;
    post(frame.contentWindow, { type: MODULE_EMBED_MESSAGE.close });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onRefresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Mở nhanh/ }));
    const reopened = screen.getByRole('dialog').querySelector('iframe') as HTMLIFrameElement;
    post(reopened.contentWindow, { type: MODULE_EMBED_MESSAGE.changed });
    post(reopened.contentWindow, { type: MODULE_EMBED_MESSAGE.close }); // xoá phiếu: báo đã đổi rồi xin đóng
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('khi đóng popup sau thay đổi: tải lại ngay rồi thêm hai lần ngắn để thấy trạng thái cuối khi Tài chính báo về chậm', () => {
    jest.useFakeTimers();
    try {
      const onRefresh = jest.fn();
      render(<FinanceVoucherCard step={step(posted)} onRefresh={onRefresh} />);
      fireEvent.click(screen.getByRole('button', { name: /Mở nhanh/ }));
      const frame = screen.getByRole('dialog').querySelector('iframe') as HTMLIFrameElement;
      post(frame.contentWindow, { type: MODULE_EMBED_MESSAGE.changed });
      fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
      expect(onRefresh).toHaveBeenCalledTimes(1);
      act(() => {
        jest.advanceTimersByTime(2_000);
      });
      expect(onRefresh).toHaveBeenCalledTimes(2);
      act(() => {
        jest.advanceTimersByTime(3_000);
      });
      expect(onRefresh).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
