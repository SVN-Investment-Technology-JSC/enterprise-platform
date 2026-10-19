/** @jest-environment jsdom */
import {
  deliverAssistantAction,
  setAssistantResultSink,
} from '@enterprise-platform/feature-module-shell';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { loadProcedureWorkspace, startProcedureInstance } from '../procedure-api';
import { ProcedureAssistantFormPage } from './procedure-assistant-form';
import { StartInstanceForm } from './start-instance-form';

// Lịch Ant Design không chạy trong jsdom: thay bằng ô ngày thường, cùng props giá trị YYYY-MM-DD.
jest.mock('@enterprise-platform/shared-ui/date-picker', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    DatePickerInput: ({
      value,
      onChange,
    }: {
      value?: string;
      onChange?: (value: string) => void;
    }) =>
      createElement('input', {
        type: 'date',
        value: value ?? '',
        onChange: (event: { target: { value: string } }) => onChange?.(event.target.value),
      }),
  };
});

jest.mock('../procedure-api', () => ({
  ...jest.requireActual('../procedure-api'),
  loadProcedureWorkspace: jest.fn(),
  startProcedureInstance: jest.fn(),
}));

jest.mock('../workspace-api', () => ({
  ...jest.requireActual('../workspace-api'),
  loadRelatedProjects: jest.fn(async () => []),
  loadProjectPeople: jest.fn(async () => []),
  loadProjectWorkItems: jest.fn(async () => []),
}));

const KEY = 'procedure.instance.create';

const definition = (id: string, code: string, name: string, status = 'published') => ({
  id,
  code,
  name,
  status,
  kind: 'process',
  versionNumber: 1,
  steps: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
});

const WORKSPACE = {
  tenantId: 'tenant',
  actor: { id: 'u-1', name: 'Nguyễn Văn Bình' },
  permissions: {
    canManageDefinitions: false,
    canPublishDefinitions: false,
    canCreateInstances: true,
    canOverrideActions: false,
  },
  definitions: [
    definition('def-1', 'MVT', 'Mua vật tư'),
    definition('def-2', 'NP', 'Nghỉ phép'),
    definition('def-3', 'NHAP', 'Bản nháp', 'draft'),
  ],
  instances: [],
};

// Giờ địa phương để không phụ thuộc múi giờ của máy chạy test.
const START = new Date(2026, 9, 20, 8, 0).toISOString();
const END = new Date(2026, 9, 20, 17, 0).toISOString();

type Result = Parameters<NonNullable<Parameters<typeof setAssistantResultSink>[0]>>[0];

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock;

let results: Result[];
let sequence = 0;

/** Card gửi bản nháp cho trang form nhúng (lần đầu, hoặc sửa tiếp cùng `requestId`). */
function deliver(
  draft: Record<string, unknown>,
  variant?: string,
  requestId = `start-${++sequence}`,
): string {
  act(() =>
    deliverAssistantAction({ key: KEY, requestId, draft, ...(variant ? { variant } : {}) }),
  );
  return requestId;
}

beforeEach(() => {
  jest.clearAllMocks();
  results = [];
  setAssistantResultSink((result) => results.push(result));
  mocked(loadProcedureWorkspace).mockResolvedValue(WORKSPACE);
});

afterEach(() => setAssistantResultSink(undefined));

describe('ProcedureAssistantFormPage', () => {
  it('shows the start form inline in the card, with the procedure from the variant', async () => {
    render(<ProcedureAssistantFormPage />);
    deliver({ title: 'Mua 20 bulong M16', startDueAt: START, endDueAt: END }, 'def-1');

    expect(await screen.findByRole('heading', { name: 'Tạo Đơn / Yêu cầu Mới' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Bản nháp điền vào form ngay sau lần render đầu (effect), nên chờ thay vì đọc ngay.
    expect(await screen.findByDisplayValue('Mua 20 bulong M16')).toBeTruthy();
    expect(await screen.findByDisplayValue('Mua vật tư (MVT)')).toBeTruthy();
    expect(screen.getByDisplayValue('08:00')).toBeTruthy();
    expect(screen.getByDisplayValue('17:00')).toBeTruthy();
    expect(screen.getAllByDisplayValue('2026-10-20')).toHaveLength(2);
    expect(results).toEqual([]);
  });

  it('opens the instance with the Procedure API and reports it to the card', async () => {
    mocked(startProcedureInstance).mockResolvedValue({
      id: 'ins-9',
      code: 'HS-0009',
      title: 'Mua 20 bulong M16',
    });
    render(<ProcedureAssistantFormPage />);
    const requestId = deliver(
      { title: ' Mua 20 bulong M16 ', startDueAt: START, endDueAt: END },
      'def-1',
    );
    await screen.findByDisplayValue('Mua vật tư (MVT)');

    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn' }));

    await waitFor(() => expect(results).toHaveLength(1));
    expect(startProcedureInstance).toHaveBeenCalledWith('def-1', {
      title: 'Mua 20 bulong M16',
      startDueAt: START,
      endDueAt: END,
      isHourlyScheduling: true,
    });
    expect(results[0]).toEqual({
      requestId,
      key: KEY,
      outcome: 'saved',
      id: 'ins-9',
      label: 'HS-0009 · Mua 20 bulong M16',
      href: '/modules/procedure#workspace/ins-9',
    });
  });

  it('applies a follow-up draft without undoing what the user changed', async () => {
    render(<ProcedureAssistantFormPage />);
    const requestId = deliver({ title: 'Mua bulong', startDueAt: START, endDueAt: END }, 'def-1');
    fireEvent.change(await screen.findByDisplayValue('Mua bulong'), {
      target: { value: 'Mua bulong M16' },
    });
    // Người dùng tự đổi quy trình.
    fireEvent.click(await screen.findByDisplayValue('Mua vật tư (MVT)'));
    fireEvent.click(await screen.findByRole('option', { name: /Nghỉ phép/ }));
    expect(await screen.findByDisplayValue('Nghỉ phép (NP)')).toBeTruthy();

    // Card gửi lại mã quy trình ban đầu cùng lần sửa tiếp: chỉ ô ngày kết thúc đổi.
    deliver({ endDueAt: new Date(2026, 9, 21, 10, 0).toISOString() }, 'def-1', requestId);

    expect(await screen.findByDisplayValue('10:00')).toBeTruthy();
    expect(screen.getByDisplayValue('2026-10-21')).toBeTruthy();
    expect(screen.getByDisplayValue('Mua bulong M16')).toBeTruthy();
    expect(screen.getByDisplayValue('Nghỉ phép (NP)')).toBeTruthy();
  });

  it('moves the end date along when the draft only gives a later start', async () => {
    render(<ProcedureAssistantFormPage />);
    deliver({ title: 'Mua bulong', startDueAt: new Date(2099, 0, 5, 8, 0).toISOString() }, 'def-1');

    await screen.findByDisplayValue('Mua bulong');
    expect(screen.getAllByDisplayValue('2099-01-05')).toHaveLength(2);
    expect(screen.queryByText('Thời gian kết thúc phải sau thời gian bắt đầu.')).toBeNull();
  });

  it('keeps the form open with the API error so the user can retry', async () => {
    mocked(startProcedureInstance)
      .mockRejectedValueOnce(new Error('Quy trình đã ngừng nhận hồ sơ mới.'))
      .mockResolvedValueOnce({ id: 'ins-10', code: 'HS-0010', title: 'Mua bulong' });
    render(<ProcedureAssistantFormPage />);
    deliver({ title: 'Mua bulong', startDueAt: START, endDueAt: END }, 'def-1');
    await screen.findByDisplayValue('Mua vật tư (MVT)');

    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn' }));
    expect(await screen.findByText('Quy trình đã ngừng nhận hồ sơ mới.')).toBeTruthy();
    expect(results).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn' }));
    await waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toMatchObject({ outcome: 'saved', id: 'ins-10' });
  });

  it('reports cancelled when the user closes the form', async () => {
    render(<ProcedureAssistantFormPage />);
    const requestId = deliver({ title: 'Mua bulong' }, 'def-1');
    await screen.findByDisplayValue('Mua bulong');

    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));

    expect(results).toEqual([{ requestId, key: KEY, outcome: 'cancelled' }]);
    expect(screen.queryByRole('heading', { name: 'Tạo Đơn / Yêu cầu Mới' })).toBeNull();
  });

  it.each([
    [
      'without the permission',
      { ...WORKSPACE, permissions: { ...WORKSPACE.permissions, canCreateInstances: false } },
      'Bạn không có quyền tạo đơn theo quy trình.',
    ],
    [
      'when nothing is published',
      { ...WORKSPACE, definitions: [definition('def-3', 'NHAP', 'Bản nháp', 'draft')] },
      'Chưa có quy trình nào được công bố.',
    ],
  ])('reports unavailable %s', async (_case, workspace, message) => {
    mocked(loadProcedureWorkspace).mockResolvedValue(workspace);
    render(<ProcedureAssistantFormPage />);
    const requestId = deliver({ title: 'Mua bulong' }, 'def-1');

    await waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toEqual({ requestId, key: KEY, outcome: 'unavailable', message });
    expect(screen.queryByRole('heading', { name: 'Tạo Đơn / Yêu cầu Mới' })).toBeNull();
  });
});

describe('StartInstanceForm on the Hồ sơ xử lý screen', () => {
  it('stays a popup and fills in what another module handed over', async () => {
    const onStart = jest.fn();
    render(
      <StartInstanceForm
        open
        onClose={jest.fn()}
        definitions={WORKSPACE.definitions.slice(0, 2) as never}
        onStart={onStart}
        handoffTitle="Điều chỉnh HS-0001: Mua bulong"
        handoff={{
          definitionId: 'def-2',
          startDueAt: START,
          endDueAt: END,
          note: 'Hồ sơ điều chỉnh',
        }}
      />,
    );

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Hồ sơ điều chỉnh')).toBeTruthy();
    expect(screen.getByDisplayValue('Điều chỉnh HS-0001: Mua bulong')).toBeTruthy();
    expect(await screen.findByDisplayValue('Nghỉ phép (NP)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn' }));

    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'def-2' }), {
      title: 'Điều chỉnh HS-0001: Mua bulong',
      startDueAt: START,
      endDueAt: END,
      isHourlyScheduling: true,
      workItem: undefined,
    });
  });
});
