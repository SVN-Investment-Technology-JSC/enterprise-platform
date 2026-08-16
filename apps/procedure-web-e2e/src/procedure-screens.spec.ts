import { expect, test } from '@playwright/test';

const now = '2026-08-17T08:00:00.000Z';
const unit = { id:'52000000-0000-4000-8000-000000000001',code:'LAB',name:'Phòng Thí Nghiệm',typeId:'51000000-0000-4000-8000-000000000001',typeName:'Phòng ban',memberCount:1,headMembershipId:'c3333333-3333-4333-8333-333333333333',headName:'Admin Minh Long',createdAt:now,updatedAt:now };
const assignment = { id:'41200000-0000-4000-8000-000000000001',role:'R',subjectType:'organization_unit',subjectId:unit.id,subjectLabel:unit.name };
const definition = { id:'41000000-0000-4000-8000-000000000001',code:'QT_MSTB',name:'Quy trình Mua sắm Vật tư thiết bị',description:'Từ đề nghị mua sắm đến phê duyệt và đặt hàng.',kind:'process',status:'published',versionNumber:1,createdAt:now,updatedAt:now,publishedAt:now,steps:[
  {id:'41100000-0000-4000-8000-000000000001',key:'DE_XUAT',order:1,name:'Lập đề xuất mua sắm',assignments:[assignment,{...assignment,id:'41200000-0000-4000-8000-000000000002',role:'S'}]},
  {id:'41100000-0000-4000-8000-000000000002',key:'KIEM_TRA',order:2,name:'Kiểm tra nhu cầu và ngân sách',assignments:[{...assignment,id:'41200000-0000-4000-8000-000000000003',role:'C'}]},
  {id:'41100000-0000-4000-8000-000000000003',key:'PHE_DUYET',order:3,name:'Phê duyệt đề nghị',assignments:[{...assignment,id:'41200000-0000-4000-8000-000000000004',role:'A'}]},
]};
const instance = { id:'42000000-0000-4000-8000-000000000001',code:'PROC-2026-0001',title:'Mua sắm máy biến áp T1',definitionId:definition.id,definitionCode:definition.code,definitionName:definition.name,definitionVersion:1,status:'running',currentStepId:'42100000-0000-4000-8000-000000000002',initiatedBy:'b3333333-3333-4333-8333-333333333333',startedAt:now,steps:definition.steps.map((step,index)=>({id:`42100000-0000-4000-8000-00000000000${index+1}`,definitionStepId:step.id,key:step.key,order:step.order,name:step.name,status:index===0?'completed':index===1?'active':'pending',currentRoleStage:index===1?'C':'R',assignments:step.assignments,startedAt:now})),activity:[{id:'42200000-0000-4000-8000-000000000001',action:'start',actorId:'b3333333-3333-4333-8333-333333333333',actorName:'Admin Minh Long',summary:'Khởi tạo quy trình.',createdAt:now}],authorization:{myRoles:['C'],currentRoleStage:'C',availableActions:['comment','approve','return'],canManageSubtasks:false,isOverride:true} };
const workspace = { tenantId:'33333333-3333-4333-8333-333333333333',actor:{id:'b3333333-3333-4333-8333-333333333333',name:'Admin Minh Long'},permissions:{canManageDefinitions:true,canPublishDefinitions:true,canCreateInstances:true,canOverrideActions:true},definitions:[definition,{...definition,id:'41000000-0000-4000-8000-000000000002',code:'EXEC_QT_MSTB',name:'Luồng Mua sắm, Lắp đặt và Bàn giao Thiết bị Thí nghiệm'}],instances:[instance,{...instance,id:'42000000-0000-4000-8000-000000000002',code:'PROC-2026-0002',title:'Lắp đặt máy nén khí - 01'}] };
const organization = { tenantId:workspace.tenantId,generatedAt:now,unitTypes:[{id:unit.typeId,key:'DEPARTMENT',name:'Phòng ban',usageCount:2,createdAt:now}],units:[unit,{...unit,id:'52000000-0000-4000-8000-000000000002',code:'TECH',name:'Phòng Kỹ thuật',parentId:unit.id,headName:undefined}],positions:[],members:[{membershipId:'c3333333-3333-4333-8333-333333333333',userId:workspace.actor.id,displayName:workspace.actor.name,email:'admin@minhlong.local',unitId:unit.id,isHead:true}],membershipSubjects:{} };

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name !== 'Mobile Chrome') {
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.route('**/api/procedure/v1/workspace', (route) => route.fulfill({ contentType:'application/json',body:JSON.stringify(workspace) }));
  await page.route('**/api/platform/v1/tenant-organization/snapshot', (route) => route.fulfill({ contentType:'application/json',body:JSON.stringify(organization) }));
});

for (const screen of [
  { hash:'workspace', heading:'Workspace xử lý', image:'procedure-workspace.png' },
  { hash:'raci', heading:'Ma trận RCSI', image:'procedure-rcsi.png' },
  { hash:'org-chart', heading:'Sơ đồ tổ chức', image:'procedure-organization.png' },
]) {
  test(`visual baseline: ${screen.hash}`, async ({ page }) => {
    await page.goto(`/modules/procedure#${screen.hash}`);
    await expect(page.getByRole('heading',{level:1})).toHaveText(screen.heading);
    await expect(page).toHaveScreenshot(screen.image,{ fullPage:true,animations:'disabled' });
  });
}
