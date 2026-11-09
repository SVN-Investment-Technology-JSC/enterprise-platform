import type { CrmTaskList } from '@enterprise-platform/contracts-crm';
import { Controller, Get, Inject, Req } from '@nestjs/common';
import { CrmTaskService } from '../application/crm-task.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

/**
 * Việc cần xử lý của người đang đăng nhập (plan mục 17.4, D3-32). Guard của phân hệ bảo đảm `crm.read`; ai duyệt được
 * việc nào (quyền duyệt, phạm vi dữ liệu, không tự duyệt, người được Quy trình giao) tính ở `CrmTaskService`.
 */
@Controller('v1')
export class TasksController {
  constructor(@Inject(CrmTaskService) private readonly tasks: CrmTaskService) {}

  @Get('my-tasks')
  myTasks(@Req() request: CrmRequest): Promise<CrmTaskList> {
    return runCrm(() => this.tasks.myTasks(crmActor(request)));
  }
}
