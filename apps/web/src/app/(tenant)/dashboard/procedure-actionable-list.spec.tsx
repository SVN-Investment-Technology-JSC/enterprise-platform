/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProcedureActionableList, type ActionableProcedure } from './procedure-actionable-list';

const refresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
// `dynamic` nạp drawer thật ở trình duyệt; ở đây dùng bản giả để biết drawer mở với hồ sơ nào.
jest.mock('next/dynamic', () => () =>
  function DrawerStub(props: { instanceId: string; onClose: () => void; onChanged: () => void }) {
    return (
      <div role="dialog" aria-label={`drawer ${props.instanceId}`}>
        <button onClick={props.onChanged}>báo đổi</button>
        <button onClick={props.onClose}>đóng drawer</button>
      </div>
    );
  },
);
const applyProcedureAction = jest.fn();
jest.mock('@enterprise-platform/feature-procedure-engine', () => ({
  applyProcedureAction: (...args: unknown[]) => applyProcedureAction(...args),
  ProcedureInstanceDrawer: () => null,
}));

const item = (extra: Partial<ActionableProcedure>): ActionableProcedure => ({
  id: 'p1',
  code: 'PROC-1',
  title: 'Mua vật tư',
  definitionName: 'Đề nghị mua',
  stepName: 'Giám đốc duyệt',
  quickActions: [],
  ...extra,
});
const actor = { id: 'u1', name: 'Quyền' };

beforeEach(() => {
  jest.clearAllMocks();
  applyProcedureAction.mockResolvedValue({});
});

describe('ProcedureActionableList', () => {
  it('bấm tên hồ sơ hoặc nút Mở thì mở drawer đúng hồ sơ, đóng thì đóng và báo đổi thì tải lại dữ liệu', () => {
    render(<ProcedureActionableList items={[item({}), item({ id: 'p2', code: 'PROC-2', title: 'Sửa máy' })]} actor={actor} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mở hồ sơ PROC-2' }));
    expect(screen.getByRole('dialog', { name: 'drawer p2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'báo đổi' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'đóng drawer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Mở' })[0]);
    expect(screen.getByRole('dialog', { name: 'drawer p1' })).toBeTruthy();
  });

  it('chỉ hiện nút nhanh theo quickActions của từng dòng; không có từ chối nhanh', () => {
    render(
      <ProcedureActionableList
        items={[
          item({ id: 'a', code: 'A', quickActions: ['approve'] }),
          item({ id: 'b', code: 'B', quickActions: ['complete'] }),
          item({ id: 'c', code: 'C', quickActions: [] }),
        ]}
        actor={actor}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Duyệt' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Hoàn thành' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Từ chối' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Mở' })).toHaveLength(3);
  });

  it('Duyệt nhanh phải xác nhận trước; xác nhận xong mới gọi API, ẩn dòng và tải lại dữ liệu', async () => {
    render(<ProcedureActionableList items={[item({ quickActions: ['approve'] })]} actor={actor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    expect(applyProcedureAction).not.toHaveBeenCalled();
    expect(await screen.findByText(/Hồ sơ PROC-1 sẽ được duyệt ở bước "Giám đốc duyệt"/)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Duyệt' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(applyProcedureAction).toHaveBeenCalledWith('p1', 'approve'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Mở hồ sơ PROC-1' })).toBeNull();
  });

  it('Hoàn thành nhanh cũng phải xác nhận', async () => {
    render(<ProcedureActionableList items={[item({ quickActions: ['complete'] })]} actor={actor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));
    expect(applyProcedureAction).not.toHaveBeenCalled();
    expect(await screen.findByText(/sẽ được đánh dấu hoàn thành/)).toBeTruthy();
  });

  it('thao tác lỗi thì hiện lỗi, giữ dòng và tải lại để khớp dữ liệu server', async () => {
    applyProcedureAction.mockRejectedValue(new Error('Hồ sơ đã được người khác xử lý.'));
    render(<ProcedureActionableList items={[item({ quickActions: ['approve'] })]} actor={actor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    const buttons = await screen.findAllByRole('button', { name: 'Duyệt' });
    fireEvent.click(buttons[buttons.length - 1]);
    expect((await screen.findByRole('alert')).textContent).toContain('đã được người khác xử lý');
    expect(screen.getByRole('button', { name: 'Mở hồ sơ PROC-1' })).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });
});
