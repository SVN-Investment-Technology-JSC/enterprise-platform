/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import type { ProcedureDefinition } from '@enterprise-platform/contracts-procedure-engine';
import { ProcedureEngineScreen } from './procedure-engine-screen';
import { WorkspaceBoard } from './workspace-board';

jest.mock('@enterprise-platform/shared-ui/date-picker', () => ({ DatePickerInput: () => null }));

const published = {
  id: 'def-1',
  code: 'PR',
  name: 'Đề nghị mua',
  version: 1,
  status: 'published',
  steps: [],
} as unknown as ProcedureDefinition;

const boardProps = {
  definitions: [published],
  instances: [],
  onAction: jest.fn(async () => undefined),
  onOpenDefinitions: jest.fn(),
  onStart: jest.fn(async () => undefined),
};

describe('ISS-UI-022: nút ghi của Quy trình theo quyền', () => {
  it('có quyền tạo hồ sơ thì thấy nút "Tạo đơn / yêu cầu"', () => {
    render(<WorkspaceBoard {...boardProps} canCreateInstances />);
    expect(screen.getByRole('button', { name: /Tạo đơn \/ yêu cầu/ })).toBeTruthy();
  });

  it('chỉ có quyền đọc thì không thấy nút tạo hồ sơ', () => {
    render(<WorkspaceBoard {...boardProps} canCreateInstances={false} />);
    expect(screen.queryByRole('button', { name: /Tạo đơn \/ yêu cầu/ })).toBeNull();
  });
});

describe('ISS-UI-022: người không có quyền phân hệ Quy trình', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Mọi API đều từ chối như guard Quy trình khi người dùng không có `procedure.read`.
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      headers: new Headers(),
      json: async () => ({ statusCode: 403, code: 'ACCESS_DENIED', message: 'Không được phép truy cập Procedure Engine.' }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('hiện thông báo tiếng Việt thay cho lỗi kỹ thuật và màn đang tải', async () => {
    render(<ProcedureEngineScreen />);
    expect(await screen.findByText('Bạn chưa được cấp quyền dùng phân hệ Quy trình. Liên hệ quản trị để được cấp quyền.')).toBeTruthy();
    expect(screen.queryByText('Đang nạp module Quy trình…')).toBeNull();
    expect(screen.queryByText('Không được phép truy cập Procedure Engine.')).toBeNull();
  });
});
