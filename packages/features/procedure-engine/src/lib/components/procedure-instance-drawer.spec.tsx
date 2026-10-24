/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import * as api from '../procedure-api';
import { ProcedureInstanceDrawer } from './procedure-instance-drawer';

jest.mock('../organization-api', () => ({ loadOrganization: jest.fn(async () => undefined) }));
jest.mock('../procedure-api', () => ({
  applyProcedureAction: jest.fn(),
  cancelProcedureSubtask: jest.fn(),
  completeProcedureSubtask: jest.fn(),
  deleteProcedureInstance: jest.fn(),
  loadAssetCatalog: jest.fn(async () => []),
  loadMaterialCatalog: jest.fn(async () => []),
  loadProcedureAttachments: jest.fn(),
  loadProcedureInstance: jest.fn(),
  loadProcedureWorkspace: jest.fn(),
  postProcedureComment: jest.fn(),
  recheckStepMaterials: jest.fn(),
  relinkProcedureWorkspace: jest.fn(),
  requestProcedureMaterials: jest.fn(),
  reverseProcedureInstance: jest.fn(),
  saveProcedureAttributeValues: jest.fn(),
  setProcedureInstanceAsset: jest.fn(),
  setProcedureSubtasks: jest.fn(),
  uploadProcedureAttachment: jest.fn(),
}));

// Bảng hồ sơ thật rất nặng; test này chỉ kiểm cách drawer nối dữ liệu và thao tác vào nó.
const boardProps: { current?: Record<string, any> } = {};
jest.mock('./workspace-board', () => ({
  WorkspaceBoard: (props: Record<string, any>) => {
    boardProps.current = props;
    return <div data-testid="board">{props.instances.map((item: ProcedureInstance) => item.code).join(',')}</div>;
  },
}));

const mocked = api as jest.Mocked<typeof api>;
const instance = (extra: Partial<ProcedureInstance> = {}) =>
  ({ id: 'i1', code: 'PROC-1', title: 'Mua vật tư', status: 'running', steps: [], activity: [], ...extra }) as unknown as ProcedureInstance;
const actor = { id: 'u1', name: 'Quyền' };

beforeEach(() => {
  jest.clearAllMocks();
  boardProps.current = undefined;
  mocked.loadProcedureInstance.mockResolvedValue(instance());
  mocked.loadProcedureAttachments.mockResolvedValue([]);
  mocked.loadProcedureWorkspace.mockResolvedValue({
    definitions: [
      { id: 'd1', status: 'published', name: 'Mua sắm' },
      { id: 'd2', status: 'draft', name: 'Nháp' },
    ],
  } as never);
  mocked.applyProcedureAction.mockResolvedValue(instance());
});

const open = async (props: Partial<Parameters<typeof ProcedureInstanceDrawer>[0]> = {}) => {
  const onClose = jest.fn();
  const onChanged = jest.fn();
  render(<ProcedureInstanceDrawer instanceId="i1" actor={actor} onClose={onClose} onChanged={onChanged} {...props} />);
  await screen.findByTestId('board');
  return { onClose, onChanged };
};

describe('ProcedureInstanceDrawer', () => {
  it('nạp đúng hồ sơ và đưa vào bảng ở chế độ nhúng, kèm người đang đăng nhập', async () => {
    await open();
    expect(mocked.loadProcedureInstance).toHaveBeenCalledWith('i1');
    expect(mocked.loadProcedureAttachments).toHaveBeenCalledWith('i1');
    expect(screen.getByTestId('board').textContent).toBe('PROC-1');
    expect(boardProps.current).toMatchObject({
      embedded: true,
      actorId: 'u1',
      actorName: 'Quyền',
      canCreateInstances: false,
      initialInstanceId: 'i1',
    });
    expect(screen.getByRole('dialog', { name: 'Xử lý hồ sơ PROC-1' })).toBeTruthy();
  });

  it('báo lỗi khi không tải được hồ sơ', async () => {
    mocked.loadProcedureInstance.mockRejectedValue(new Error('Bạn không còn là người tham gia hồ sơ.'));
    render(<ProcedureInstanceDrawer instanceId="i1" actor={actor} onClose={jest.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('không còn là người tham gia');
    expect(screen.getByText('Không mở được hồ sơ này.')).toBeTruthy();
    expect(screen.queryByTestId('board')).toBeNull();
  });

  it.each(['approve', 'complete', 'reject', 'return', 'cancel'] as const)(
    'thao tác "%s" xong thì báo màn gọi tải lại và đóng drawer',
    async (action) => {
      const { onClose, onChanged } = await open();
      await act(async () => {
        await boardProps.current?.onAction('i1', action, 'ok', 'step-1', { amount: 1 });
      });
      expect(mocked.applyProcedureAction).toHaveBeenCalledWith('i1', action, 'ok', 'step-1', { amount: 1 });
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it('trao đổi thì drawer ở lại và không coi là đổi hồ sơ', async () => {
    const { onClose, onChanged } = await open();
    await act(async () => {
      await boardProps.current?.onAction('i1', 'comment', 'Đã xem');
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('thao tác lỗi thì hiện lỗi, drawer ở lại và không báo đổi hồ sơ', async () => {
    mocked.applyProcedureAction.mockRejectedValue(new Error('Hồ sơ đã được người khác xử lý.'));
    const { onClose, onChanged } = await open();
    await act(async () => {
      await boardProps.current?.onAction('i1', 'approve');
    });
    expect((await screen.findByRole('alert')).textContent).toContain('đã được người khác xử lý');
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('trao đổi, tải tệp, lưu thuộc tính đi qua đúng API của Quy trình rồi nạp lại hồ sơ', async () => {
    await open();
    const file = new File(['x'], 'bao-gia.pdf', { type: 'application/pdf' });
    mocked.loadProcedureInstance.mockClear();
    await act(async () => {
      boardProps.current?.onSendComment('i1', 'Xin chào', ['u2'], 'c1');
      void boardProps.current?.onUploadFile('i1', file);
      boardProps.current?.onSupplementFile('i1', file);
      await boardProps.current?.onSaveAttributes('i1', { amount: 5 });
    });
    await waitFor(() => expect(mocked.loadProcedureInstance).toHaveBeenCalled());
    expect(mocked.postProcedureComment).toHaveBeenCalledWith('i1', 'Xin chào', ['u2'], 'c1');
    expect(mocked.uploadProcedureAttachment).toHaveBeenCalledWith('i1', file);
    expect(mocked.uploadProcedureAttachment).toHaveBeenCalledWith('i1', file, undefined, true);
    expect(mocked.saveProcedureAttributeValues).toHaveBeenCalledWith('i1', { amount: 5 });
  });

  it('xoá đơn thì đóng drawer và báo màn gọi', async () => {
    const { onClose, onChanged } = await open();
    await act(async () => {
      await boardProps.current?.onDeleteInstance('i1', 'Nhập nhầm');
    });
    expect(mocked.deleteProcedureInstance).toHaveBeenCalledWith('i1', 'Nhập nhầm');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('chỉ quản trị override mới thấy quyền huỷ hiệu lực', async () => {
    mocked.loadProcedureInstance.mockResolvedValue(
      instance({ authorization: { isOverride: true } as ProcedureInstance['authorization'] }),
    );
    await open();
    expect(boardProps.current?.canReverse).toBe(true);
  });

  it('bấm lớp phủ không đóng drawer (tránh mất dữ liệu đang điền); chỉ nút đóng mới đóng', async () => {
    const { onClose } = await open();
    const backdrop = document.querySelector('[aria-hidden="true"]');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('thao tác đã ghi thành công nhưng nạp lại hồ sơ lỗi thì vẫn tính là xong: báo đổi, đóng, không báo thất bại', async () => {
    const { onClose, onChanged } = await open();
    mocked.loadProcedureInstance.mockRejectedValue(new Error('Mất mạng'));
    await act(async () => {
      await boardProps.current?.onAction('i1', 'approve');
    });
    expect(mocked.applyProcedureAction).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('xin vật tư: có danh sách quy trình đã công bố, báo hồ sơ vừa mở và báo màn ngoài tải lại', async () => {
    mocked.loadProcedureInstance.mockResolvedValue(
      instance({ authorization: { currentRoleStage: 'E', isOverride: false } as ProcedureInstance['authorization'] }),
    );
    mocked.requestProcedureMaterials.mockResolvedValue({
      opened: [{ code: 'MUA-1', definitionName: 'Mua sắm' }],
      instance: instance(),
    } as never);
    const { onChanged } = await open();
    await waitFor(() => expect(boardProps.current?.definitions).toEqual([{ id: 'd1', status: 'published', name: 'Mua sắm' }]));
    await act(async () => {
      boardProps.current?.onRequestMaterials('i1', { subtaskId: 's1' });
    });
    expect((await screen.findByRole('status')).textContent).toContain('MUA-1 (Mua sắm)');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('tải tệp lỗi thì từ chối để bảng không chạy hành động khi chưa có tệp', async () => {
    mocked.uploadProcedureAttachment.mockRejectedValue(new Error('Hết dung lượng'));
    await open();
    const file = new File(['x'], 'a.pdf');
    let failure: unknown;
    await act(async () => {
      await boardProps.current?.onUploadFile('i1', file).catch((cause: unknown) => (failure = cause));
    });
    expect(failure).toBeInstanceOf(Error);
    expect((await screen.findByRole('alert')).textContent).toContain('Hết dung lượng');
  });

  it('nút đóng đóng drawer', async () => {
    const { onClose } = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
