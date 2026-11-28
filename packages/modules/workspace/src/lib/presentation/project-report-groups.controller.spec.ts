import { HttpException, RequestMethod } from '@nestjs/common';
import type { ProjectReportGroupService } from '../application/project-report-group.service.js';
import type { WorkspaceActor } from '../application/workspace.application.js';
import { ProjectForbiddenError } from '../domain/workspace.error.js';
import { ProjectReportGroupsController } from './project-report-groups.controller.js';

/** Khoá metadata Nest dùng cho `@Controller`/`@Get`/`@Put` (`PATH_METADATA`, `METHOD_METADATA` của `@nestjs/common`). */
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

const actor = { tenantId: 't-1', userId: 'u-1', displayName: 'Người A' } as WorkspaceActor;

function setup() {
  const service = {
    list: jest.fn().mockResolvedValue({ items: [], canEdit: false }),
    save: jest.fn().mockResolvedValue({ items: [], canEdit: true }),
    setForProject: jest.fn().mockResolvedValue({ id: 'p-1', reportGroupId: 'g-1' }),
  };
  return {
    service,
    controller: new ProjectReportGroupsController(service as unknown as ProjectReportGroupService),
  };
}

const route = (name: keyof ProjectReportGroupsController) => {
  const handler = ProjectReportGroupsController.prototype[name] as unknown as object;
  return {
    path: Reflect.getMetadata(PATH_METADATA, handler) as string,
    method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
  };
};

describe('ProjectReportGroupsController', () => {
  it('khai báo đúng đường dẫn mà workspace-api.ts của giao diện gọi', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ProjectReportGroupsController)).toBe('v1');
    expect(route('list')).toEqual({ path: 'project-report-groups', method: RequestMethod.GET });
    expect(route('save')).toEqual({ path: 'project-report-groups', method: RequestMethod.PUT });
    expect(route('setForProject')).toEqual({ path: 'projects/:id/report-group', method: RequestMethod.PUT });
  });

  it('chuyển người gọi, id và body sang service', async () => {
    const { controller, service } = setup();
    await controller.list({ workspaceActor: actor });
    expect(service.list).toHaveBeenCalledWith(actor);
    await controller.save({ workspaceActor: actor }, { items: [{ name: 'Dịch vụ' }] });
    expect(service.save).toHaveBeenCalledWith(actor, { items: [{ name: 'Dịch vụ' }] });
    await controller.setForProject({ workspaceActor: actor }, 'p-1', { reportGroupId: 'g-1' });
    expect(service.setForProject).toHaveBeenCalledWith(actor, 'p-1', { reportGroupId: 'g-1' });
  });

  it('lỗi nghiệp vụ thành mã HTTP; id không phải UUID thành 404; thiếu actor là 401', async () => {
    const { controller, service } = setup();
    service.setForProject.mockRejectedValueOnce(new ProjectForbiddenError());
    const forbidden = (await controller
      .setForProject({ workspaceActor: actor }, 'p-1', { reportGroupId: null })
      .catch((cause) => cause)) as HttpException;
    expect(forbidden.getStatus()).toBe(403);
    expect(forbidden.getResponse()).toMatchObject({ code: 'PROJECT_FORBIDDEN' });

    service.setForProject.mockRejectedValueOnce(Object.assign(new Error('bad uuid'), { code: '22P02' }));
    const notFound = (await controller
      .setForProject({ workspaceActor: actor }, 'khong-phai-uuid', { reportGroupId: null })
      .catch((cause) => cause)) as HttpException;
    expect(notFound.getStatus()).toBe(404);

    const anonymous = (await controller.list({}).catch((cause) => cause)) as HttpException;
    expect(anonymous.getStatus()).toBe(401);
  });
});
