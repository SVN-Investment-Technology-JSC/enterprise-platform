import { ACTION_DENIED_MESSAGE, isAccessDeniedError } from '@enterprise-platform/shared-ui';
import { loadWorkspaceStatus } from '@enterprise-platform/feature-workspace';

/** ISS-UI-022: lỗi 403 từ API Workspace giữ câu tiếng Việt của server, không lộ "Forbidden" hay lỗi phân tích JSON. */
function respond(status: number, body?: unknown) {
  globalThis.fetch = jest.fn(async () => ({
    ok: status < 400,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError('Unexpected token <');
      return body;
    },
  })) as unknown as typeof fetch;
}

describe('workspace-api: lỗi trả cho giao diện', () => {
  it('403 kèm câu tiếng Việt: giữ nguyên câu và mã', async () => {
    respond(403, { statusCode: 403, code: 'ACCESS_DENIED', message: 'Bạn không có quyền ghi dự án và công việc.' });
    const cause = await loadWorkspaceStatus().catch((error: unknown) => error);
    expect(cause).toMatchObject({ code: 'ACCESS_DENIED', message: 'Bạn không có quyền ghi dự án và công việc.' });
    expect(isAccessDeniedError(cause)).toBe(true);
  });

  it('403 kiểu "Forbidden" hoặc không phải JSON: câu tiếng Việt chung', async () => {
    respond(403, { statusCode: 403, message: 'Forbidden resource' });
    let cause = await loadWorkspaceStatus().catch((error: unknown) => error);
    expect((cause as Error).message).toBe(ACTION_DENIED_MESSAGE);
    expect(isAccessDeniedError(cause)).toBe(true);

    respond(403);
    cause = await loadWorkspaceStatus().catch((error: unknown) => error);
    expect((cause as Error).message).toBe(ACTION_DENIED_MESSAGE);
  });

  it('lỗi máy chủ không có thân JSON: câu tiếng Việt, không lộ lỗi phân tích', async () => {
    respond(502);
    const cause = await loadWorkspaceStatus().catch((error: unknown) => error);
    expect((cause as Error).message).toBe('Không thể hoàn tất yêu cầu Workspace.');
  });
});
