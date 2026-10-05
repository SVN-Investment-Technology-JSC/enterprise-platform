# TIEN DO TRIEN KHAI HRM_FIX_05 (nhat ky de tiep tuc khi phien bi ngat)

Cach tiep tuc: doc file nay + muc 7 cua HRM_FIX_05_DONTU_PE_PLAN.md, xem `git status` de biet file nao da sua, roi lam tiep dot dang do.
Moi agent khi xong PHAI them mot muc "Bao cao FIX-E-xx" vao cuoi file nay (file, hanh vi, test, con dang do).

## Quyet dinh cua chu san pham (05/10/2026)
1. Quy trinh cu (dang dung o buoc S) KHONG can script dong bo.
2. Chan nguoi khoi tao tu duyet o che do PE do node S cua quy trinh (phan cap initiator_manager: quan ly truc tiep duyet don cap duoi). Khong sua PE cho viec nay.
3. Cac module KHONG duoc can thiep DB cua nhau, chi qua API. Moi truy van procedure_schema.* tu HRM phai thay bang API noi bo cua PE.
4. Khong khi nao viet/chay migration len DB that; chi tao file migration + dang ky trong tenant-migrations.ts. Nguoi dung tu chay migrator.

## Trang thai cac dot
| Dot | Task | Trang thai |
|---|---|---|
| 1 | FIX-E-07 duyet DIRECT dung pham vi | Mot phan (code + unit test xong; con viec dang do, xem Bao cao FIX-E-07) |
| 1 | FIX-E-06 mac dinh DIRECT, co PE kha dung, bo doc DB PE o links | Mot phan (code + unit test xong, chua chay migration; xem Bao cao FIX-E-06) |
| 2 | FIX-E-01 buoc S tu hoan thanh | Mot phan (code + unit test xong; chua build/restart PE, chua chay test tich hop; xem Bao cao FIX-E-01) |
| 2 | FIX-E-04 form dong bo thuoc tinh PE | Mot phan (code + test xong; con file/user chua xac nhan voi PE, xem Bao cao FIX-E-04) |
| 3 | FIX-E-02 tien do vao don (qua API/su kien) | Mot phan (code + unit test xong, migration 0029 chua chay, chua build/restart; xem Bao cao FIX-E-02) |
| 3 | FIX-E-03 giao dien tien do + duyet trong HRM | Mot phan (code + test xong; chua chay thu tren trinh duyet) |
| 4 | FIX-E-05 anh xa truong form -> dieu kien PE | Mot phan (phia HRM: code + unit test xong, migration 0030 chua chay; phia PE UI xem Bao cao FIX-E-05 (PE UI); xem Bao cao FIX-E-05 (HRM)) |
| 5 | FIX-E-08 kiem thu dau cuoi + UAT | Mot phan (spec tich hop da sua nhung chua chay duoc vi khong co DB; test mo phong + tai lieu UAT/quan tri xong; xem Bao cao FIX-E-08) |

## Bao cao cua tung task

### Bao cao FIX-E-07 (duyet DIRECT dung pham vi, chan tu duyet - ISS-BE-001)

Trang thai: Mot phan. Code, migration (chua chay) va unit test da xong; test tich hop (can DB) chua chay/chua cap nhat.

**File them moi**
- packages/modules/hrm/src/lib/infrastructure/hrm-approval-policy.ts: assertCanDecide(actor, request, kind, deps), resolveApprovalScope/approvalScopeSql (loc SQL), computeSubordinateUserIds (thuan), HttpHrmOrgScopeResolver (goi API noi bo Platform organization-contexts/:tenantId, cache 15 giay, loi mang -> 503 ORG_CONTEXT_UNAVAILABLE, dong), HrmApprovalPolicyService (Nest).
- packages/modules/hrm/src/lib/infrastructure/hrm-approval-policy.spec.ts: 17 test.
- migrations/tenant/hrm/0028-hrm-approval-policy.sql: bang hrm_schema.approval_policy_settings(tenant_id, allow_self_approval default false). CHUA CHAY. Dung so 0028 vi 0027 da bi FIX-E-06 (0027-hrm-default-direct-bindings) lay.

**File sua (Edit cuc bo)**
- packages/platform/entitlement/src/lib/tenant-migrations.ts: dang ky 0028.
- packages/contracts/identity/src/lib/tenant-authorization.ts: them 7 quyen hrm.{leave,ot,trip,shift,attendance,profile,advance}.approve.all (ke tung quyen approve), ham mo rong quyen: approve.all keo theo approve + quyen doc lien quan.
- packages/contracts/identity/src/lib/hrm-role-templates.ts: vai tro timekeeper them hrm.attendance.approve.all, hr-profile them hrm.profile.approve.all (hai vai tro nay duyet toan tenant nhu truoc). department-head khong co .all, chi duyet cap duoi.
- packages/modules/hrm/src/lib/module-hrm.module.ts: dang ky HrmApprovalPolicyService.
- Controller: hrm-leave (approve/reject/cancel + list), hrm-request (OT approve/reject, cong tac approve/reject/cancel, doi ca approve/reject + 3 list), hrm-attendance (approve/reject/cancel + list), hrm-salary (tam ung approve/reject + list), hrm-profile-correction (approve/reject + list), hrm-operations (reverse/Huy hieu luc). Tham so constructor moi la tham so thu 3 (hoac 2 voi operations) co gia tri mac dinh nen test cu van tao duoc controller.
- packages/features/hrm/src/lib/screens/approvals-screen.tsx: goi cac danh sach voi ?forApproval=1.

**Hanh vi**
1. Tu duyet (nhan vien cua don co user_id == nguoi thao tac): 403 SELF_APPROVAL_FORBIDDEN, ke ca quan tri tenant. Ngoai le theo tenant: dong allow_self_approval=true trong bang moi (mac dinh tat; chua co API/UI de bat). Chu don bam cancel (rut don) khong bi coi la tu duyet.
2. Pham vi: nguoi duyet phai la cap tren theo chuoi "Bao cao cho" cua chuc danh (ke ca ghi de tren phan cong), hoac thanh vien thuoc cay don vi ma minh la truong (headMembershipId), tinh tu snapshot Platform. Ngoai pham vi hoac nhan vien chua gan tai khoan: 403 APPROVAL_OUT_OF_SCOPE.
3. hrm.<x>.approve.all, hrm.manage, tenant.manage: duyet toan tenant (van bi quy tac 1).
4. Danh sach: them query forApproval=1 cho 7 endpoint danh sach; chi ap khi nguoi dung co quyen duyet loai don do; loc SQL theo pham vi va loai don cua chinh ho. Khong co forApproval thi hanh vi cu.
5. Don co ban ghi procedure_links (hrm_schema, bang cua HRM): 409 PROCEDURE_IN_PROGRESS truoc khi cham trigger DB; trigger giu nguyen. Thu tu kiem tra: 404, tu duyet/pham vi (403), roi 409. Che do PE khong doi.
6. Khong doc DB module khac cho viec phan pham vi (qua API Platform). Co doc core_schema.employees(user_id) nhu code HRM hien co.

**Test**
- module-hrm, contracts-identity, platform-entitlement: test + lint + typecheck deu dat. hrm-approval-policy.spec.ts: tu duyet 403, ngoai le tenant, chu don cancel, khac don vi 403, cung don vi OK, approve.all OK, approve.all loai khac 403, don co link 409, 404, tinh cap duoi (chuoi bao cao, ghi de, truong don vi), SQL loc.
- feature-hrm: lint dat (0 loi). test/typecheck dang loi o file khac khong thuoc FIX-E-07 (operations-screen.spec.ts, hrm-navigation.spec.ts, hrm-attendance-overview.spec.ts - do thay doi dang lam do cua nguoi dung/agent khac); approvals-screen.tsx khong gay loi.

**Con dang do**
- Chua chay migration 0028 (khong chay theo quy dinh): nguoi dung chay migrator. Chua co bang thi code coi nhu tat ngoai le (an toan).
- Chua co API/man hinh cau hinh allow_self_approval cho quan tri tenant.
- Test tich hop can DB (hrm-request-lifecycle, hrm-employee, hrm-operations integration spec...) chua chay va co the can sua: cac test duyet bang chinh nguoi tao se nhan 403, test dung nguoi duyet can quyen .all hoac nam trong pham vi; controller moi dung HttpHrmOrgScopeResolver mac dinh nen can mock cong org scope.
- Vai tro mau da seed vao tenant hien co khong tu nhan quyen .all moi: can chay lai seed vai tro mau hoac gan tay (vi du Cham cong vien/Nhan su ho so mat quyen duyet toan tenant neu khong cap them .all).
- Man hinh approvals chua hien thong bao rieng cho 403/409 (hien loi chung tu API); chua them cot "ngoai pham vi". Lenh bulk duyet cung di qua endpoint nen tu dong duoc kiem.
- Quyen hrm.*.approve.all chua co trong UI phan quyen ngoai danh muc quyen chung (da them vao TENANT_PERMISSION_ACTIONS nen tu hien).
- Chua xu ly: amend don nghi (leave-requests/:id/amend) va cac endpoint khac ngoai approve/reject/cancel/reverse.

### Bao cao FIX-E-06 (gan PE thu cong, mac dinh DIRECT, co PE kha dung)

Tinh trang: code + unit test xong; migration CHUA chay (nguoi dung tu chay migrator); chua restart, chua commit.

File moi:
- `migrations/tenant/hrm/0027-hrm-default-direct-bindings.sql` (dang ky trong `packages/platform/entitlement/src/lib/tenant-migrations.ts`): seed 7 binding DIRECT cho moi tenant HRM da co ma chua co binding mac dinh dang hieu luc. Idempotent, khong doi binding da co.
- `packages/modules/hrm/src/lib/infrastructure/hrm-procedure-api.ts`: client noi bo goi PE bang `x-service-token` + `x-tenant-id`: `fetchPublishedProcedureDefinition`, `isProcedureReachable`, `procedureUnavailable()` (409 ma `PROCEDURE_UNAVAILABLE`).
- `packages/modules/hrm/src/lib/infrastructure/hrm-subtype-catalog.ts`: danh muc ma loai con (loai phep tu `leave_types`, OT, cong tac).
- Test: `hrm-procedure-api.spec.ts`, `hrm-procedure-links.unit.spec.ts`, `hrm-context.procedure.spec.ts`, `hrm-subtype-catalog.spec.ts` (module-hrm); `hrm-default-bindings.spec.ts` (platform-entitlement); `operations-screen.spec.ts` (feature-hrm); them 1 test trong `procedure-engine.application.spec.ts`.

File sua:
- `hrm-procedure-links.ts`: khong con truy van `procedure_schema.*`. `saveHrmProcedureBinding` va `prepareHrmProcedureLink` doc dinh nghia da cong bo + ban chup qua API noi bo PE. Chua co binding -> mac dinh DIRECT (bo loi 409 "Chua cau hinh che do duyet"). `definition_version_id` luu NULL (PE khong lo version id qua API; cot nullable, khong noi nao dung ngoai hien thi).
- `hrm-procedure-bridge.service.ts`: chi `getBindingDefinitionWithAttributes` doi sang API (cung quy tac, khong binding -> null). KHONG dung `getProcedureProgress`/reconcile/`hrm-procedure-sync.ts` (dot 3 lam).
- PE: `procedure-engine.application.ts` them `getPublishedDefinitionForService`; `procedure-engine.controller.ts` them `GET /v1/internal/definitions/:definitionId` va `GET /v1/internal/status` (guard `ModuleAccess.authorizeService` kiem service token + entitlement `procedure-engine` cua tenant; route `/v1/internal/` da duoc guard nhan dien).
- `hrm-context.service.ts`: `procedureAvailable(tenantId)` = entitlement `procedure-engine` con hieu luc (`PlatformIdentityService.serviceDatabase`, dich vu cua Platform) VA PE API tra loi; cache 10 giay.
- `hrm-capabilities.controller.ts`: `GET /v1/capabilities` tra them `procedureAvailable`.
- `hrm-operations.controller.ts`: `GET /operations` tra them `procedureAvailable` (cho nguoi co `hrm.integration.manage`); `POST operations/workflow-rules` tu choi mode PROCEDURE khi false (409 `PROCEDURE_UNAVAILABLE`); them `GET operations/subtype-catalog`; `POST operations/workflows/:id/retry` nay cung "gan lai" duoc lien ket `CONFLICT` chua co instance (nap lai ban chup dinh nghia qua API PE, audit `PROCEDURE_RELINK_QUEUED`; FAILED giu audit `PROCEDURE_RETRY_QUEUED`).
- `tenant-provisioning.processor.ts`: sau migration module `hrm`, goi `seedHrmDirectBindings(tenantDb, tenantId)` (tenant moi cap module HRM co ngay 7 binding DIRECT; ham dat trong cung file vi worker chay `.ts` truc tiep).
- Gui don khi binding PROCEDURE ma PE tat/khong tra loi: `prepareHrmProcedureLink` nem 409 `PROCEDURE_UNAVAILABLE`, transaction rollback, khong tao don/lien ket.
- FE `operations-screen.tsx`: mac dinh che do DIRECT; an lua chon "Duyet qua Procedure" va khong tai danh sach quy trinh khi `procedureAvailable=false`; ma loai con dung `SearchableSelect` (qua `optionsFor` moi cua `hrm-action-dialog.tsx`, tu xoa ma khi doi loai don) lay tu `/operations/subtype-catalog`; banner canh bao + nut "Chuyen sang duyet truc tiep" co Popconfirm (chuyen moi binding PROCEDURE sang DIRECT); nut "Gan lai quy trinh" co Popconfirm cho FAILED/CONFLICT (chua instance).

Test: `pnpm nx test` module-hrm (110 pass, 96 skip la integration can DB), module-procedure-engine (89 pass), platform-entitlement (6 pass, 1 skip); feature-hrm: test moi pass, con 3 test cu fail o `hrm-attendance-overview.spec.ts` (file `hrm-attendance-overview.ts` la thay doi chua commit cua nguoi dung, khong lien quan FIX-E-06). `pnpm nx lint typecheck` module-hrm, feature-hrm, platform-entitlement, module-procedure-engine: 0 loi.

Con dang do / luu y:
- Chay migrator de seed binding cho tenant cu; PE can build/restart de co 2 endpoint noi bo moi (neu chua, HRM se bao PROCEDURE_UNAVAILABLE khi gan/gui don PROCEDURE).
- `INTERNAL_SERVICE_TOKEN` va `PROCEDURE_API_URL` phai co o HRM API (da dung boi `startHrmProcedure`).
- Cac integration spec dung DB that (`hrm-procedure-links.integration.spec.ts`, ca "rolls back the request when no approval mode has been configured") chua chay va co the can cap nhat vi hanh vi mac dinh DIRECT va viec doc PE qua HTTP (chua sua).
- FE doc `procedureAvailable` tu `GET /operations` (man cau hinh); `GET /capabilities` da co co nhung hook `useHrmPermissions` chua doc; form nop don chua an gi theo co nay (loi 409 hien qua thong bao loi API).
- Gan lai CONFLICT chi cho lien ket chua co instance/tuong quan; truong hop co instance van phai doi soat (dot 3).
- HTTP toi PE chay trong transaction giu advisory lock (timeout 8 giay) khi luu binding/gui don PROCEDURE.

## Ghi chu dieu phoi (cua agent chinh)
- Dot 1 xong (E-07, E-06: "Mot phan"; migration 0027, 0028 chua chay).
- Dot 2 XONG (E-01, E-04: "Mot phan"). Can build+restart procedure-api, hrm-api, worker thi co hieu luc.
- Dot 3 XONG (E-02, E-03: "Mot phan"; migration 0029 chua chay). Ton dong: request-workflows/danh sach don thieu instance_id/procedureInstanceId/revision; API tien do chua co canAct; chua co UI bo loc assignee/currentStep -> giao cho dot 4.
- Viec nguoi dung can lam khi dung lai: chay migrator cho 0027, 0028 (sau cac migration truoc); build + restart PE (endpoint noi bo moi) va hrm-api/worker; tao lai vai tro mau HRM de nhan quyen *.approve.all; sua integration spec hrm-procedure-links (mac dinh DIRECT).

### Bao cao FIX-E-04 (form tao don dong bo thuoc tinh PE)

Trang thai: Mot phan. Code + test xong, chua commit/restart.

**Backend (module-hrm)**
- `hrm-request.controller.ts`: `GET procedure-definitions/binding` nhan them `subTypeCode`.
- `hrm-procedure-bridge.service.ts` (chi `getBindingDefinitionWithAttributes`): cung quy tac chon binding nhu luc gui (loai con truoc, roi mac dinh). Khi chi co binding PROCEDURE theo loai con ma chua chon loai con, tra `data.code = 'SUBTYPE_REQUIRED'` + `message` 'Chon loai don con de tai bieu mau' (attributes rong). Khong co binding / DIRECT: `data: null`.
- Test moi: `hrm-procedure-bridge.binding.spec.ts` (uu tien loai con, SUBTYPE_REQUIRED, DIRECT).

**Frontend (feature-hrm)**
- `requests-screen.tsx` (Edit cuc bo): effect tai lai thuoc tinh moi khi doi loai don / loai phep / loai OT / loai cong tac (ma loai con = `leaveTypes[].code`, `otType`, `tripType`, khop backend); bo `catch` rong, hien khung loi + nut "Thu lai", thong bao 'Chon loai don con...'; doc `procedureAvailable` tu `GET /capabilities` va hien banner; 409 `PROCEDURE_UNAVAILABLE` khi gui hien thong bao rieng; ca 7 loai don gui `attributes` (them doi ca, giai trinh cong, chinh sua ho so); `attributes` luu trong payload ban nhap (da co san luc khoi phuc) va khi mo lai ban nhap, tai lai bieu mau theo binding hien hanh, bo thuoc tinh khong con ton tai va canh bao 'Bieu mau quy trinh da thay doi so voi luc luu nhap'.
- `request-form-attributes.ts` (moi): ham thuan (ma loai con, URL, dien giai phan hoi, prune) + hang `CORE_FIELD_ATTRIBUTE_CODES` (danh sach excludeCodes cu, co comment, E-05 se thay bang anh xa).
- `hrm-attachment-upload.ts` (moi): tai tep theo co che dinh kem HRM san co (POST /attachments -> PUT presigned -> complete), toi da 10 MB.
- `ui/dynamic-attribute-form.tsx`: ho tro `file` (tai ngay khi chon, luu id dinh kem, bao loi, go tep) va `user` (SearchableSelect danh sach nhan vien, gia tri la id nhan vien).
- Test: `request-form-attributes.spec.ts`, `ui/dynamic-attribute-form.spec.tsx`.

**Kiem tra**: module-hrm test 113 pass / 96 skip (integration), lint 0 loi, typecheck dat. feature-hrm: lint + typecheck dat; test 46 pass, 3 fail deu o `hrm-attendance-overview.spec.ts` (co san do thay doi chua commit cua nguoi dung, khong do FIX-E-04). operations-screen.spec.ts va hrm-navigation.spec.ts hien pass.

**Con dang do / luu y**
- Gia tri thuoc tinh `file` la id dinh kem HRM, `user` la id nhan vien (khong phai user id Platform); can xac nhan PE/dieu kien doc dung dinh dang nay, va chua co man tai xuong tep tu thuoc tinh trong chi tiet don.
- Chua chan gui khi thieu thuoc tinh bat buoc phia FE (PE/backend van la noi kiem).
- Banner `procedureAvailable` chi canh bao, khong chan gui (binding co the la DIRECT).
- Giai trinh cong chi gui attributes khi binding PROCEDURE co thuoc tinh; khong co UI rieng cho loai con cua doi ca/giai trinh/ho so (khong co loai con).
- Chua chay thu giao dien thuc te tren trinh duyet.

### Bao cao FIX-E-01 (buoc S tu hoan thanh khi gui don HRM)

Trang thai: Mot phan. Code + test don vi xong; chua commit, chua ghi DB, chua restart, chua chay migration (khong co migration moi).

**PE (module-procedure-engine, procedure-api)**
- Hop dong (contracts-procedure-engine): autoCompleteInitiatorStep? them vao CreateProcedureInstanceRequest va StartProcedureInstanceRequest; CreateProcedureInstanceResponse tra them status, currentStepId, currentStepName, currentRoleStage, currentAssigneeName, autoComplete {status completed|skipped, warning}, warnings.
- procedure-engine.application.ts: tach than applyAction thanh applyActionInState (chay trong giao dich cua ben goi, hanh vi cu giu nguyen); startInstance nay boc startInstanceDetailed. Khi co co: sau khi tao instance va nap attributeValues, trong CUNG giao dich goi applyActionInState('complete') voi actor = nguoi khoi tao (initiatedBy), nen dung lai requireAttributesFilled (thuoc tinh bat buoc cua buoc S + thuoc tinh cap quy trinh), moveToNextStep (cong dieu kien doc dung gia tri form), phan cong dong initiator_manager. Nhat ky: 'Hoan thanh buoc S khi gui don (tu dong)'. Khoa idempotency rieng .
- Dieu kien ap dung: chi nhan khi sourceType='hrm_request' va actor he thong (createInstance qua /v1/internal/instances do guard service token; endpoint nguoi dung /v1/instances gui co nay bi 400). Buoc dau phai chi co vai S va nguoi khoi tao phai khop phan cong S (deriveProcedureAuthorization cho phep 'complete'); neu khong -> bo qua, khong loi, tra autoComplete.status='skipped' + warnings. Tra cuu to chuc nguoi khoi tao loi -> cung bo qua + canh bao. Thieu thuoc tinh bat buoc -> loi validation 400 neu ro truong ('Can nhap ...'), giao dich rollback, khong tao instance.
- Goi lai cung khoa: tra instance cu, khong hoan thanh lan hai (autoComplete 'completed' neu da hoan thanh truoc do).
- Cong moi: application/initiator-actor.port.ts (InitiatorActorResolver), infrastructure/http-initiator-actor.resolver.ts (doc snapshot to chuc qua endpoint noi bo Core cung URL/token voi client to chuc cua procedure-api, dung userId -> membershipId -> don vi/chuc danh + orgUnits), dang ky trong procedure-engine.module.ts (tham so thu 7 cua ProcedureEngineApplication, tuy chon). Chuyen buildOrgUnits tu procedure-access.guard.ts sang domain/procedure-org-units.ts (buildProcedureOrgUnits, export tu index) de dung chung; guard chi doi import.
- Neu lo hang cua buoc moi sau S: kiem ton ngay sau commit nhu applyAction.

**HRM (module-hrm, contracts-hrm, feature-hrm)**
- hrm-procedure-bridge.service.ts (chi sua startHrmProcedure + ham moi procedureStartProgress): gui autoCompleteInitiatorStep=true; doc currentStepName/currentAssigneeName/warnings tu PE; khi loi PE (vd thieu thuoc tinh bat buoc) link FAILED nhu cu va tra them lastError (noi dung loi nguyen van tu PE, nen neu ro truong).
- contracts-hrm: HrmProcedureLink them currentStepName?, currentAssigneeName?, warnings?, lastError? (tuy chon).
- Controller tao don (leave x2, attendance, profile-correction, request x4, salary): them vao phan hoi currentStepName, currentAssigneeName, procedureWarnings, procedureError (ngay sau procedureSyncStatus). Khong co o cac phan hoi khac.
- hrm-procedure-api.ts: procedureStartStepWarnings(definition) kiem buoc dau theo luong: chi co vai S -> khong canh bao; nguoc lai canh bao 'Buoc dau khong phai buoc S ... don se dung cho nguoi nop'. saveHrmProcedureBinding (hrm-procedure-links.ts) dung ban dinh nghia da doc qua API PE (khong them lan goi), tra row kem warnings khi co; POST operations/workflow-rules tra data.warnings (khong chan luu). operations-screen.tsx: hien khung canh bao mau vang trong tab quy tac sau khi luu.

**Test**
- PE: procedure-auto-complete.application.spec.ts (10 test): tu hoan thanh S + nhat ky + buoc/nguoi xu ly; cong dieu kien theo gia tri form; thieu thuoc tinh bat buoc -> loi neu ro truong va khong con instance; nguoi khoi tao khong khop S -> skipped; buoc dau khong chi co S -> skipped; idempotent (1 instance, 1 lan hoan thanh); khong co co -> hanh vi cu; chi nhan co khi hrm_request (ca startInstance nguoi dung bi tu choi); khop S theo chuc danh qua resolver; resolver loi -> skipped co canh bao. 89 test cu van pass (tong 99).
- HRM: hrm-procedure-start.spec.ts (5 test): co truyen co + doc tien do; PE 400 thieu thuoc tinh -> FAILED + lastError; procedureStartProgress; procedureStartStepWarnings; saveHrmProcedureBinding tra warnings. module-hrm 118 pass.
- pnpm nx test/lint/typecheck: module-procedure-engine, module-hrm, procedure-api (+contracts-hrm typecheck) dat (lint chi warning cu). feature-hrm lint + typecheck dat; feature-hrm test van fail 3 test cu o hrm-attendance-overview.spec.ts (khong lien quan, da ghi o bao cao E-06).

**Con dang do / luu y**
- Can build + restart procedure-api (co moi o /v1/internal/instances) va hrm-api/worker; truoc khi PE moi chay, PE cu bo qua co (don dung o buoc S nhu cu, khong loi).
- Chua chay test tich hop can DB (hrm-procedure-links.integration.spec.ts...) va chua thu E2E tren moi truong that (gui don nghi -> buoc S hoan thanh -> buoc duyet dau).
- Neu loi thieu thuoc tinh: don HRM da duoc tao (link FAILED, lastError ro truong) va API tao don tra procedureError; chua chan tao don o HRM (hanh vi 'don khong gui duoc' day du can E-04 kiem tra truoc o form). Cho phep 'Thu lai' o man cau hinh nhu cu.
- Khop phan cong S theo don vi dung orgUnits tu Core nhu guard; nguoi khong co thanh vien to chuc chi khop phan cong S gan truc tiep theo user.
- Warnings khi luu binding chi kiem 'buoc dau chi co vai S'; khong kiem duoc tung nguoi nop cu the khop phan cong S hay khong (chi biet luc gui don).

### Bao cao FIX-E-03 (giao dien tien do duyet va duyet PE trong HRM)

Trang thai: Mot phan. Code + test xong; chua commit, chua chay thu tren trinh duyet that, khong sua backend.

**Thay doi (feature-hrm)**
- `procedure-progress-view.ts` (moi, logic thuan): kieu tien do; `shouldPollProcedureProgress` (chi poll khi drawer mo, don con chay, tab hien thi); `procedureSyncNotice` ('Dang khoi tao quy trinh' cho START_PENDING, 'Dong bo loi - dang thu lai' + lastError rut gon 160 ky tu cho FAILED); `waitingApproverLabel` ('Dang cho [nguoi] duyet - [buoc]'); `procedureFieldsOf`; `procedureActionBody`; `approvalErrorMessage` (thong bao tieng Viet cho SELF_APPROVAL_FORBIDDEN, APPROVAL_OUT_OF_SCOPE, PROCEDURE_IN_PROGRESS, ORG_CONTEXT_UNAVAILABLE; 403/409 tu PE khi thao tac PE).
- `ui/procedure-progress-panel.tsx` (moi): `ProcedureProgressPanel` (danh sach buoc, nguoi xu ly, SLA kem han, nhat ky, thong bao khoi tao/loi dong bo, nguoi dang cho) dung chung cho ca hai man; hook `useProcedureProgress` (tai + poll 15 giay, dung khi ket thuc/dong drawer, tam dung khi tab an va tai lai khi tab hien lai). Thay cho khoi buoc viet thang trong `requests-screen.tsx` (khong nhan doi ma).
- `ui/procedure-action-bar.tsx` (moi): o y kien + nut Duyet / Tu choi / Tra lai, moi nut co Popconfirm (shared-ui); Tu choi/Tra lai bat buoc co ly do.
- `requests-screen.tsx` (Edit cuc bo): dung hook + panel; khi trang thai quy trinh doi (hoac mo ra da ket thuc) tu nap lai don de lay trang thai nghiep vu that; cot/nhan nguoi duyet o danh sach cho va lich su hien 'Dang cho [nguoi] duyet - [buoc]' neu don co `currentAssigneeName`/`currentStepName` (E-02), neu khong giu nhu cu.
- `approvals-screen.tsx`: cot 'Quy trinh' hien ma instance + 'Dang cho ...' ; chi tiet don PE hien panel tien do (buoc, nguoi xu ly, SLA); don co lien ket trang thai RUNNING + nguoi dung co quyen duyet loai don hien thanh thao tac PE trong footer drawer, goi `POST /api/hrm/v1/requests/:KIND/:id/actions` (body `{action, comment?, revision?, idempotencyKey}`; `kind` chu hoa duoc backend alias), sau do lam moi tien do va danh sach; 403/409 hien thong bao than thien va lam moi tien do. Don DIRECT giu nut duyet cu. Duyet/Tu choi/Duyet hang loat don DIRECT map ma loi 403 sang thong bao tieng Viet rieng.
- `hrm-api.ts`: `HrmApiError` them `code?` (doc `code` trong body loi) de map thong bao theo ma.
- Test moi: `procedure-progress-view.spec.ts` (6), `ui/procedure-progress-panel.spec.tsx` (4, gom poll bang fake timers: 15 giay, dung khi tab an, dung khi ket thuc, khong tai khi dong), `ui/procedure-action-bar.spec.tsx` (2).

**Kiem tra**: `pnpm nx typecheck feature-hrm` dat; `pnpm nx lint feature-hrm` 0 loi (15 warning cu); `pnpm nx test feature-hrm` 58 pass, 3 fail cu o `hrm-attendance-overview.spec.ts` (thay doi chua commit cua nguoi dung).

**Con dang do / luu y**
- `GET /request-workflows` khong tra `instance_id`, va danh sach don OT/cong tac/doi ca/tam ung (hrm-request.controller) chua tra `procedureInstanceId` (chi leave, attendance co). Voi cac don do man Duyet don chua tai duoc buoc tien do (van co nut thao tac vi backend `actions` tim link theo don, khong can instance id). Can bo sung `instance_id` vao `request-workflows` hoac `procedureInstanceId` vao list (backend, ngoai pham vi task nay).
- Tien do chua cho biet nguoi dung hien tai co duoc giao buoc khong: FE doc truong tuy chon `canAct` (false thi an nut), khong co thi van hien nut va PE tu choi (403 -> thong bao 'khong phai nguoi duoc giao').
- `revision` mac dinh 1 neu danh sach khong tra `link.revision`; don gui lai nhieu lan co the can truong nay.
- Chua co nut 'Huy' o man Duyet (huy/rut don la thao tac cua nguoi nop o chi tiet don nhan vien); chi Tu choi/Tra lai/Duyet.
- 'Tra lai' khong chon buoc dich (PE tra ve buoc truoc mac dinh).
- Chua thu giao dien tren trinh duyet that; chua co test component cho toan bo approvals-screen/requests-screen.

### Bao cao FIX-E-02 (ghi tien do duyet cua PE vao don HRM, bo truy cap DB cheo module)

Trang thai: Mot phan. Code + test don vi xong; chua commit, chua ghi DB, chua restart, migration 0029 CHUA chay.

**PE (module-procedure-engine, contracts-procedure-engine)**
- Su kien moi `procedure.instance.step_changed` qua outbox trong cung giao dich (postgres-procedure-store.ts appendEvents). Payload: instanceId, instanceCode, sourceType, sourceId, stepId, stepName, assignees[nhan], status, sequence, occurredAt. Phat khi ho so dang chay va vi tri (buoc hoac pha RACI) khac truoc giao dich, hoac ho so moi tao.
- Quyet dinh: CHI phat khi sourceType='hrm_request' (hang STEP_CHANGED_SOURCE_TYPES). Ly do: Bao tri/thu cong khong co ben tieu thu, phat het chi lam outbox phinh; muon mo them chi can them vao hang so. Ho so roi khoi running khong phat step_changed vi da co su kien completed rieng.
- sequence = so dong nhat ky (activity.length) cua ho so: moi hanh dong them 1 dong nen khong giam va khac nhau giua cac giao dich. CreateProcedureInstanceResponse tra them `sequence`.
- Logic thuan trong domain/procedure-progress.ts (instancesWithStepChange, buildStepChangedPayload, buildInstanceProgress, buildInstanceStatusEntry), export tu index.
- API noi bo (service token + entitlement, guard nhan dien /v1/internal/): `GET /v1/internal/instances/:instanceId/progress` (status, currentStepId/Name, currentAssigneeName, steps[{id,name,status,order,currentRoleStage,slaHours,slaDueAt,completedAt,roleTitle}], activity[], completedAt; 404 neu khong co) va `POST /v1/internal/instances/status` body {ids} (1..100 ma, ma la bi bo qua) tra [{instanceId,instanceCode,status,currentStepId/Name,currentAssigneeName,completedAt,lastActorId,sequence}].
- Contracts: ProcedureInstanceProgress, ProcedureInstanceStatusEntry, ProcedureInstanceStepChangedPayload, CreateProcedureInstanceResponse.sequence.

**HRM (module-hrm, contracts-hrm)**
- Khong con truy van procedure_schema.* trong packages/modules/hrm (non-spec) va apps/worker: `getProcedureProgress` (bridge) goi `fetchProcedureProgress`; `reconcile` (hrm-procedure-sync.ts) goi `fetchProcedureStatuses` (hrm-procedure-api.ts). Hinh dang phan hoi GET v1/procedure-progress/:procedureInstanceId GIU NGUYEN (cac khoa: instanceId, instanceCode, status, currentStepId, currentStepName, completedAt, steps[], activity, syncStatus, lastError, hrmSynced; co test khoa danh sach khoa).
- Test kien truc moi packages/modules/hrm/src/lib/hrm-architecture-boundary.spec.ts: quet ma nguon non-spec cua HRM va apps/worker (bo comment), cam `procedure_schema.`, `FROM/JOIN procedure_`, `to_regclass('procedure_schema`.
- hrm-procedure-progress.ts (moi): writeProcedureStepProgress (chi ghi neu sequence moi hon current_step_seq cua link va link chua APPLIED/CONFLICT; cap nhat link roi bang don: current_step_name (cat 100), current_assignee_name, workflow_status='RUNNING'; chi voi revision moi nhat; KHONG dong cot status), clearProcedureStepProgress (khi ket qua cuoi duoc ap dung: xoa buoc/nguoi xu ly, workflow_status = COMPLETED/REJECTED/CANCELLED), receiveHrmProcedureStep (ghi hop thu idempotent khoa tenant+instance+sequence roi ap dung ngay; chua co link/correlation thi giu PENDING, tick dong bo ap dung lai qua processHrmProcedureStepInbox; qua 1 gio khong co link thi SKIPPED), procedureProgressSchemaReady (migration 0029 chua chay thi ghi tien do la no-op, nhan su kien se nem loi de consumer thu lai; khong lam hong luong ket qua/khoi tao).
- startHrmProcedure: ghi tien do ngay khi nhan phan hoi tao instance (currentStepName, currentAssigneeName, sequence) trong cung giao dich cap nhat link.
- Reconcile: moi tick xet toi da 50 link RUNNING/APPLY_PENDING/FAILED co instance chua doi soat trong 5 phut (step_reconciled_at), hoi PE theo lo; ho so da ket thuc dua vao hop thu ket qua nhu cu (id su kien bam theo tenant+instance+status+completedAt), ho so dang chay thi cap nhat buoc hien tai (bo qua neu sequence khong moi hon). PE khong tra loi thi bo qua, tick sau thu lai.
- Danh sach: 7 endpoint (leave-requests, attendance-corrections, ot-requests, business-trip-requests, shift-change-requests, salary advance, profile-corrections) va request-workflows nhan query `assignee` (khop mot phan ILIKE tren current_assignee_name) va `currentStep` (khop chinh xac khong phan biet hoa thuong); tra currentStepName, currentAssigneeName, workflowStatus tu cot that (mapLeave/Correction/Ot/Trip/Shift/Advance; profile-corrections tra them cac truong camelCase; request-workflows lay tu procedure_links). Khong truyen bo loc thi SQL them `TRUE`, khong dung cot moi (chua migrate van doc duoc). Bo loc o hrm-workflow-filter.ts (thoat %, _ va dau gach cheo nguoc).
- contracts-hrm: them currentAssigneeName? vao 6 kieu don.

**Worker (apps/worker/src/main.ts)**: hang hrm.integrations.v1 bind them `procedure.instance.step_changed`; handler phan nhanh theo event.type: step_changed -> receiveHrmProcedureStep, con lai -> receiveHrmProcedureResult nhu cu (van loc sourceType='hrm_request').

**Migration 0029** (migrations/tenant/hrm/0029-hrm-procedure-step-progress.sql, da dang ky trong tenant-migrations.ts, CHUA CHAY): kiem tra 7 bang don -> migration 0002 chi them 3 cot cho 6 bang va THIEU profile_corrections, chua co cot ten nguoi xu ly (current_assignee_id chi chua ma, PE chi tra nhan). Migration them (IF NOT EXISTS, ca 7 bang): procedure_instance_id, current_step_name varchar(100), current_assignee_id, current_assignee_name text, workflow_status, index (tenant_id,current_step_name); procedure_links them current_step_name, current_assignee_name, current_step_seq, current_step_updated_at, step_reconciled_at; bang hrm_schema.procedure_step_inbox (PK tenant_id,instance_id,sequence). current_assignee_id van de trong (PE khong tra id nguoi, chi nhan).

**Test**: pnpm nx test/lint/typecheck module-procedure-engine (103 pass), module-hrm (139 pass, 96 skip la integration can DB), worker, procedure-api, contracts-procedure-engine, contracts-hrm, contracts-identity, platform-entitlement: deu dat (lint chi warning cu); feature-hrm typecheck dat. Test moi: procedure-progress.application.spec.ts (PE: phat step_changed khi doi buoc, khong phat voi nguon khac/khong con chay, sequence, API tien do, doi soat gioi han 100), hrm-procedure-progress.spec.ts (HRM: inbox idempotent, bo qua su kien cu, giu PENDING khi chua co link, khong dong status, migration chua chay, client API, hinh dang getProcedureProgress, reconcile qua API, bo loc), hrm-architecture-boundary.spec.ts.

**Con dang do / luu y**
- Chay migrator cho 0029 (sau 0027, 0028); build + restart procedure-api (endpoint noi bo + su kien moi), hrm-api, worker. Truoc khi migrate/restart PE, HRM bo qua ghi tien do (khong loi). Don dang chay truoc khi PE moi chay se duoc dien buoc hien tai nho reconcile (toi da 50 link/tick).
- Cac integration spec (hrm-operations, hrm-procedure-links... *.integration.spec.ts) van INSERT truc tiep vao procedure_schema lam du lieu mau; test kien truc chi quet ma nguon khong phai spec. Nen chuyen sang mock PE API khi sua integration spec (chua chay/chua sua).
- Don DIRECT khong co workflow_status moi (cot de NULL, hoac 'DRAFT' mac dinh cu o 6 bang tu 0002); FE nen chi hien tien do khi co currentStepName.
- current_assignee_id chua duoc ghi (chi ghi ten); bo loc "dang cho ai duyet" theo ten/nhan (vi du chuc danh hoac don vi), khong theo user id.
- Chua co UI cho bo loc moi (E-03 lam FE doc currentStepName/currentAssigneeName/workflowStatus va query assignee/currentStep).
- request-workflows tra them ca khoa snake_case (current_step_name...) va camelCase.

## Bao cao FIX-E-05 (PE UI)

- Danh muc dung chung: packages/contracts/procedure-engine/src/lib/procedure-host-attributes.ts (xuat qua index): PROCEDURE_HOST_ATTRIBUTES (21 ma: so_ngay_nghi, duration, so_gio_ot, ot_hours, loai_ot, is_night_ot, so_ngay_cong_tac, days_count, loai_cong_tac, dia_diem, allow_ot, so_tien, amount, so_ky_tra, ly_do, tu_ngay, den_ngay, leave_type_id, is_negative_leave, ngay, loai_doi_ca), lookupHostAttribute, hostAttributeSourceLabel ("Lay tu don HRM: <ten truong>"), groupHostAttributesByKind. PE khong import HRM; HRM co the dung lai qua contracts.
- Giao dien (packages/features/procedure-engine, rcsi/): host-attribute-hint.tsx (HostAttributeBadge, HostAttributeReference); attribute-editor.tsx hien huy hieu canh thuoc tinh co ma trung va nut "Thuoc tinh do HRM cap" mo bang tham chieu ma -> y nghia theo loai don; gateway-editor.tsx them nhan nguon vao mo ta trong bo chon thuoc tinh cua dieu kien cong. Style them o flow-editors.module.scss.
- Test: host-attributes.spec.ts (5 test cho ham tra cuu, dat phan feature vi contracts khong co target test). pnpm nx test/lint feature-procedure-engine dat (24 test; lint chi warning cu). Typecheck: loi co san o columns.spec.ts (khong lien quan thay doi nay); file moi/sua khong con loi.
- Chua commit, khong ghi DB.

## Bao cao FIX-E-05 (HRM: anh xa truong form -> thuoc tinh PE, va ton dong dot 3)

Trang thai: Mot phan. Code + unit test xong; migration 0030 CHUA chay; chua build/restart; chua commit, khong ghi DB.

**A. Anh xa truong HRM -> thuoc tinh PE**
- Migration moi migrations/tenant/hrm/0030-hrm-procedure-field-mappings.sql (da dang ky trong tenant-migrations.ts, CHUA CHAY): bang hrm_schema.request_procedure_field_mappings(tenant_id, binding_id, hrm_field, attribute_code, scope any|process|step, step_id, transform, mode OVERWRITE|PREFILL); them cot request_procedure_bindings.field_mappings_configured; seed ban mac dinh (dung bang ma co dinh cu: so_ngay_nghi, duration, so_gio_ot, so_tien, tu_ngay, den_ngay, ly_do...) cho moi binding PROCEDURE dang hieu luc. Cot condition_rules KHONG xoa (khong dung nua, giu du lieu).
- packages/modules/hrm/src/lib/infrastructure/hrm-field-mappings.ts (moi): danh muc truong (form.*, employee.* gom phong ban/chuc danh id-ma-ten, cap bac = ngach luong, loai hop dong, nguoi quan ly; business.leave_remaining, business.ot_hours_month), ban mac dinh theo loai don, applyFieldMappings (OVERWRITE = he thong thang, PREFILL = nguoi nhap thang, dien khi trong; scope process/step ghi dung khoa process:<ma> / step:<stepId>:<ma>), transform (none, to_number, to_string, to_boolean, to_date, upper, lower), load/seed/save ban anh xa (audit PROCEDURE_FIELD_MAPPINGS_CONFIGURED), resolveFieldValues. Ngu canh to chuc lay qua API noi bo Platform (organization-contexts + manager-chain), chi goi khi co anh xa dung toi truong employee.*; Platform loi -> 503 ORG_CONTEXT_UNAVAILABLE, don khong tao (tranh re nhanh cong sai). Cap bac/loai hop dong/so phep/gio OT doc bang cua HRM.
- Chua migrate hoac binding chua cau hinh: dung ban mac dinh trong ma (hanh vi cu khong doi). PUT voi danh sach rong dat field_mappings_configured=true nghia la khong anh xa gi.
- submissionAttributes(input,row,mappings?,extraValues?) giu chu ky cu (test cu pass), nay dung anh xa; submitHrmRequest va luong xac nhan doi ca truyen fieldRow cho prepareHrmProcedureLink, noi tai binding da chon moi nap anh xa + ngu canh va tron vao attributes luu tren link (dung de gui PE). saveHrmProcedureBinding nap ban mac dinh khi chuyen sang PROCEDURE ma binding chua co dong nao.
- API (quyen hrm.integration.manage): GET/PUT /operations/workflow-rules/:bindingId/field-mappings (GET tra them catalog va isDefault), GET /operations/field-catalog?requestKind=, GET /operations/procedure-definitions/:definitionId/attributes (thuoc tinh cap quy trinh + buoc S, doc qua API PE). GET procedure-definitions/binding tra moi thuoc tinh kem mapping {hrmField, mode, group, label}.
- FE: ui/procedure-field-mappings-dialog.tsx + procedure-field-mappings-view.ts (moi); operations-screen.tsx them nut "Anh xa truong" tung quy tac PROCEDURE va tu mo hop thoai sau khi luu binding PROCEDURE. Moi thuoc tinh mot SearchableSelect chon truong HRM + SearchableSelect che do; canh bao thuoc tinh bat buoc chua anh xa, kieu khong khop, thuoc tinh danh sach chon phai trung ma lua chon. Da bo hang CORE_FIELD_ATTRIBUTE_CODES: thuoc tinh OVERWRITE an khoi form dong, PREFILL duoc dien san tu truong form (ly do, ngay, so ngay, so gio OT, so tien...), nguoi dung sua tay thi giu; ban nhap khoi phuc khong bi ghi de. PREFILL cho truong ngu canh (phong ban...) khong dien san tren form, he thong dien luc gui neu de trong.
- Luu y PE: thuoc tinh kieu text/file/user chi co toan tu empty/not_empty; dieu kien theo phong ban phai dung thuoc tinh kieu select, ma lua chon phai trung ma phong ban/chuc danh (employee.department_code) hoac id.

**B. Ton dong dot 3**
- hrm-procedure-link-info.ts (moi): attachProcedureLinkInfo them procedureInstanceId, procedureRevision, procedureLinkId, procedureSyncStatus (lien ket moi nhat, 1 truy van/danh sach) vao ca 7 danh sach don. GET /request-workflows tra them instance_id/instanceId/procedureInstanceId/revision/procedureRevision.
- canAct: PE GET /v1/internal/instances/:id/progress nhan query actorUserId, tra canAct (nguoi dung co thao tac complete/approve/reject/return o buoc hien tai; khong xac dinh duoc nguoi dung -> false; khong truyen -> khong co truong). Contract ProcedureInstanceProgress them canAct? (them tuy chon). HRM GET v1/procedure-progress/:id truyen userId hien tai va tra them canAct, currentAssigneeName (test khoa danh sach khoa da cap nhat). FE approvals-screen da doc canAct san.
- FE: approvals-screen dung procedureRevision that khi duyet qua PE; them o tim "Dang cho ai duyet" (server-side, debounce 300ms, query assignee) va SearchableSelect "Buoc hien tai" (query currentStep; tuy chon tich luy tu cac lan tai). requests-screen: bo loc cung hai tieu chi (client-side tren currentAssigneeName/currentStepName) o ca tab Dang cho duyet va Lich su.

**Test**: unit moi hrm-field-mappings.spec.ts (OVERWRITE/PREFILL, scope, transform, mac dinh tuong thich 7 loai don + khop migration 0030, ngu canh phong ban/cap bac/so phep, khoa gui PE cho don nghi 2 ngay va 5 ngay, validate, loadBindingMappings), hrm-procedure-links.unit.spec.ts (2 test), hrm-procedure-link-info.spec.ts, hrm-procedure-bridge.binding.spec.ts (+1); PE procedure-hrm-department-gate.application.spec.ts (cong theo phong ban: Ke toan / khac; canAct); cong so ngay nghi 2 ngay/5 ngay da co o procedure-auto-complete.application.spec.ts; FE procedure-field-mappings-view.spec.ts, request-form-attributes.spec.ts. pnpm nx test/lint/typecheck: module-hrm (162 pass, 96 skip), module-procedure-engine (106 pass), contracts-hrm, contracts-procedure-engine, platform-entitlement, procedure-api, worker: dat. feature-hrm: lint + typecheck dat, test 67 pass, 3 fail cu o hrm-attendance-overview.spec.ts (cua nguoi dung).

**Con dang do**
- Chay migrator cho 0030 (sau 0027-0029); build + restart PE (canAct), hrm-api.
- Chua chay thu giao dien tren trinh duyet; chua co test component cho dialog anh xa.
- Chua co nguon PE hien thi "lay tu don HRM" tu API: phan PE UI (bao cao rieng) dung bang tham chieu tinh.
- PREFILL ngu canh khong hien san tren form (can API tra gia tri ngu canh theo nhan vien dang nop).
- Anh xa gan theo binding_id; doi dinh nghia PE cua cung binding giu dong cu (dong khong khop thuoc tinh moi chi bi bo qua).
- Integration spec can DB (hrm-procedure-links.integration.spec.ts...) chua chay/chua cap nhat.

## Bao cao FIX-E-08 (kiem thu dau cuoi, tai lieu UAT)

Trang thai: Mot phan. Khong ghi DB, khong chay migration, khong restart, khong commit.

**Test moi / tien ich**
- packages/modules/hrm/src/lib/infrastructure/hrm-test-support.ts (khong import jest): fakeOrgScope/testApprovalPolicy (cong pham vi gia, controller khong goi Platform), createProcedureApiFake (PE gia qua fetch: definitions, status, instances theo idempotencyKey, progress, trang thai khong kha dung, mat phan hoi sau commit).
- hrm-procedure-e2e.sim.spec.ts (chay duoc khong can DB; DB gia co trang thai, mock applyHrmRequestResult): (a) START_PENDING -> startHrmProcedure -> RUNNING + tien do ghi vao don, don van PENDING; (b) PE loi -> FAILED, don con, retry RUNNING; mat phan hoi sau commit -> thu lai cung khoa, 1 instance; (c) gui trung/khoi tao song song -> 1 lien ket, 1 lan goi PE; (d) step_changed cu (seq thap) bi SKIPPED, trung seq bi bo qua, completed ap APPROVED dung 1 lan (audit co approverId), rejected ap REJECTED, step den muon sau khi ket thuc khong keo don ve RUNNING; (e) khong binding/DIRECT -> DIRECT khong goi PE, gan PROCEDURE khi PE tat -> PROCEDURE_UNAVAILABLE khong ghi, PE tat sau khi gan -> 409 khong tao lien ket; (f) duyet DIRECT: tu duyet 403 SELF_APPROVAL_FORBIDDEN, ngoai pham vi 403 APPROVAL_OUT_OF_SCOPE, trong pham vi OK.
- hrm-approval-policy.spec.ts: them 1 test cho reverse (xem muc loi da sua).

**Integration spec da viet lai (van skip khi khong co HRM_TEST_ADMIN_URL; tsc spec cua cac file nay sach loi)**
- hrm-procedure-links.integration.spec.ts: bo migration/INSERT procedure_schema, dung PE gia qua fetch; chua binding -> DIRECT (null) thay vi loi 409; ban chup lay qua API (definition_version_id = NULL); PE tat -> 409 PROCEDURE_UNAVAILABLE (prepare va controller tam ung, rollback khong tao don); doi ca: khong binding thi DIRECT (PEER_CONFIRMED, khong lien ket), co binding PROCEDURE moi co lien ket; retry timeout dung fake (1 instance), doi soat ket qua cuoi qua API status (can ep step_reconciled_at = NULL). Them migration 0029, 0030 vao danh sach.
- hrm-operations.integration.spec.ts: bo procedure_schema, doi soat bo thu bang fake PE; them 0029; controller dung testApprovalPolicy.
- hrm-request-lifecycle.integration.spec.ts: nguoi duyet rieng (hrm.manage) cho reverse/approve; tu duyet don nghi -> 403; duyet/huy don co lien ket -> 409 PROCEDURE_IN_PROGRESS (truoc la 400).
- hrm-employee.integration.spec.ts: duyet chinh sua cham cong va tam ung: chinh chu 403 SELF_APPROVAL_FORBIDDEN, nguoi duyet khac OK; cong pham vi gia; vai loi tsc co san (thieu reason, thieu tham so).
- Grep 'procedure_schema' trong spec cua HRM: chi con trong cac spec khang dinh khong dung (architecture-boundary, links.unit, progress) va binh luan o ma nguon.

**Loi hanh vi tim thay va da sua (nho)**
- assertCanDecide chan moi hanh dong khi don co procedure_links, ke ca reverse (huy hieu luc) don da duyet qua PE; trigger DB van cho phep reverse. Da bo qua kiem tra lien ket khi decision = 'reverse' (van kiem tu duyet/pham vi). Co test.

**Tai lieu**: docs/hrm-fix-plan/HRM_FIX_05_UAT.md (dieu kien, 17 kich ban chinh, K1-K6, loi E1-E9, bang ket qua, ky xac nhan); docs/hrm-fix-plan/HRM_FIX_05_ADMIN_GUIDE.md (gan PE, anh xa truong, trang thai link, ma loi).

**Kiem tra**: pnpm nx test/lint/typecheck module-hrm (175 pass, 97 skip), module-procedure-engine (106 pass), worker, procedure-api, platform-entitlement, contracts-hrm: dat (lint chi warning). feature-hrm: lint dat; typecheck loi 2 cho (timesheets-screen.tsx bien khong dung) va 3 test fail o hrm-attendance-overview.spec.ts: deu la thay doi dang lam do co san cua nguoi dung, khong thuoc FIX-E-08.

**Con dang do / danh sach kiem tra con lai cho nguoi dung**
1. Chay migrator 0021-0030, build + restart PE/hrm-api/worker, tao lai vai tro mau.
2. Chay integration spec voi HRM_TEST_ADMIN_URL (DB local dung roi): da viet lai nhung chua tung chay; co the lech nho (SQL that, thu tu migration, hanh vi controller tao don).
3. Chay UAT theo HRM_FIX_05_UAT.md tren moi truong that; chua co test E2E that voi PE that + RabbitMQ.
4. tsc -p tsconfig.spec.json (module-hrm) con loi co san o spec khac: hrm-procedure-bridge.spec, hrm-procedure-progress.spec, hrm-routes.spec, hrm-family-contract/time-lifecycle/payroll-lifecycle/timesheet-lifecycle integration spec; nx typecheck khong kiem cac spec nay.
5. Chua co API/UI bat allow_self_approval; chua co script hoan thanh buoc S cho don chay truoc E-01.

## Kiem tra thuc te tren localhost:8080 (05/10/2026, tenant savina, tai khoan bui.cong.quyen)
- Da chay migration 0021-0030, build + restart PE/hrm-api/worker, seed vai tro mau (theo HRM_FIX_05_TRIEN_KHAI_REPORT.md cua nguoi dung); 10/10 suite integration PASS (nguoi dung bao).
- Luong LEAVE qua PE (don thu: nghi phep nam 21/10/2026, 1 ngay, ma don ac5bd214-e3ec-4081-aeb1-8934b3759328):
  - Gui don -> 201, don PENDING, procedureSyncStatus=RUNNING ngay lap tuc, workflowStatus=RUNNING.
  - Buoc S tu hoan thanh (nhat ky "Hoan thanh buoc S khi gui don (tu dong)"), buoc hien tai "HR tham dinh va phe duyet", nguoi cho "Truong phong Hanh chinh - Tong hop"; canAct=false cho nguoi nop.
  - Danh sach don tra currentStepName/currentAssigneeName/workflowStatus; GET procedure-progress tra du buoc + SLA + nhat ky.
  - Rut don -> PE huy -> don CANCELLED, link APPLIED, workflowStatus=CANCELLED (khoang 10 giay).
  - Chua kiem: nguoi duoc giao buoc duyet bam Duyet trong HRM (canAct=true), re nhanh theo dieu kien, 6 loai don con lai, che do DIRECT, PE tat.
- Du lieu ton: bang request_procedure_bindings cua savina co 3 dong ACTIVE giong het nhau cho moi loai don (tao 25/09), tat ca PROCEDURE -> QT-HRM-DON-TU (10000000-...). Khong gay loi nhung nen don con 1 dong/loai.
- Don thu tren de lai 1 don nghi da CANCELLED (ly do "UAT-E2E-FIX05 ...").

## Kiem tra duyet bang tai khoan Truong phong (05/10/2026)
- Tai khoan giu vi tri "Truong phong Hanh chinh - Tong hop": nguyen.tran.nhu.quynh@savina.local (mat khau trung SEED_TENANT_ADMIN_PASSWORD). Don thu aabd0bd0-83a3-4335-be57-b7d9bf36426f (nghi phep nam 22/10/2026).
- Nguoi nop tu duyet qua endpoint truc tiep -> 403 SELF_APPROVAL_FORBIDDEN (dung). Nguoi nop duyet qua PE -> PE tu choi.
- Truong phong: procedure-progress canAct=true; don nam trong danh sach forApproval=1; POST requests/leave/:id/actions {action:'APPROVE'} (chu HOA - 'approve' thuong tra 400 "Thao tac khong hop le") -> 201; ~5 giay sau don APPROVED, workflow COMPLETED, link APPLIED, PE completed; quy phep tru 1 ngay.
- Hoan tac: Truong phong goi requests/leave/:id/reverse -> don CANCELLED, quy phep tra lai (used 1.5 -> 0.5).
- Phat hien: approvedBy cua don = 00000000-0000-4000-8000-000000000001 (actor he thong), khong phai nguoi duyet that. Thong bao loi 400 khi action sai chua noi ro. -> giao cho viec ton dong.
- Con 3 viec ton dong: (1) API/UI bat allow_self_approval; (2) tai tep tu thuoc tinh file + xac nhan dinh dang id file/user voi PE; (3) ghi dung nguoi duyet (approvedBy).

## Bao cao viec ton dong 3 (nguoi duyet that)

Trang thai: Xong phan ma + test. Khong commit, khong ghi DB, khong restart, khong chay migration (khong can migration moi).

**Nguyen nhan**: hrm-procedure-sync.ts applyInbox truyen HRM_PROCEDURE_SYSTEM_ACTOR_ID (00000000-0000-4000-8000-000000000001) vao applyHrmRequestResult -> transitionLeave/approveOvertime/approveShiftChange/approveBusinessTrip/approveAttendanceCorrection/approveSalaryAdvance/approveProfileCorrection va nhanh UPDATE chung (approved_by cho REJECTED/CANCELLED). Su kien procedure.instance.completed da co actorId va inbox luu nguyen ven su kien (cot event jsonb) nen khong can doi cot/migration. Rieng PE lay actorId = activity[0], co the la nhat ky he thong (re nhanh/tu hoan thanh) chu khong phai nguoi duyet.

**Da sua**
- PE: domain/procedure-progress.ts them resolveFinalActorId (hanh dong approve/reject/complete/cancel/return gan nhat cua nguoi that, bo qua actor he thong va binh luan; khong co thi roi ve activity[0]); postgres-procedure-store.ts dung ham nay khi phat procedure.instance.completed.
- HRM: hrm-procedure-sync.ts them resolveProcedureApproverId (actorId la UUID va khac actor he thong thi dung, nguoc lai giu actor he thong nhu cu) va truyen vao applyHrmRequestResult cho moi loai don (nghi, OT, cong tac, tam ung, giai trinh cong, chinh sua ho so, doi ca). approved_by la user id Platform, nhat quan voi luong DIRECT (principal.userId). Audit PROCEDURE_RESULT_APPLIED giu actor_id ky thuat, detail.approverId la nguoi duyet that (null neu he thong), technicalActorId giu nguyen. leave_transactions.actor_id cung ghi nguoi duyet that. Don da duyet truoc day khong sua.
- Bridge applyAction: resolveProcedureAction chuan hoa trim + toUpperCase (nhan chu thuong); sai thi 400 "Thao tac khong hop le; gia tri hop le: APPROVE | REJECT | RETURN | COMPLETE | CANCEL".

**Test**: moi hrm-procedure-approver.spec.ts (resolveProcedureApproverId, resolveProcedureAction), procedure-final-actor.spec.ts (PE); hrm-procedure-e2e.sim.spec.ts them kiem tra actor truyen vao applyHrmRequestResult = nguoi duyet. module-hrm test 193 pass; module-procedure-engine test 109 pass, lint/typecheck dat; worker test/lint dat.

**Con dang do**: typecheck module-hrm/worker con 4 loi cu o hrm-procedure-bridge.service.ts (dong ~245, 271) va hrm-procedure-links.ts (273, 278) ve kieu ProcedureAttributeSpec (do thay doi dang lam do san co, khong thuoc viec nay). Can build + restart PE va worker de ap dung; su kien completed da nam trong outbox/inbox truoc do van mang actorId cu nen don cu khong doi.

## Bao cao viec ton dong 1 (allow_self_approval)

Trang thai: Code + unit test xong. Chua commit, khong ghi DB, khong restart, khong chay migration (0028 da chay truoc do).

- API (quyen hrm.integration.manage, khong tao quyen moi): GET/PUT /api/hrm/v1/approval-policy-settings. Controller moi presentation/hrm-approval-policy-settings.controller.ts (dang ky trong module-hrm.module.ts); logic o infrastructure/hrm-approval-policy-settings.ts (load/parse/save). PUT body {allowSelfApproval: boolean, reason: string}; ly do bat buoc 10-500 ky tu; upsert bang hrm_schema.approval_policy_settings (updated_by, updated_at) va ghi audit APPROVAL_POLICY_CHANGED (detail: setting, previous, current, reason) trong cung giao dich. Chinh sach duyet (loadAllowSelfApproval) doc DB moi lan duyet, khong co cache nen khong can invalid; thay doi co hieu luc ngay.
- Giao dien: ui/approval-policy-card.tsx (the moi, nhung vao dau tab "Quy trinh lien module (Procedure)" trong operations-screen.tsx, chi hien khi co hrm.integration.manage): hien trang thai hien tai, o ly do, nut bat/tat boc Popconfirm co canh bao rui ro kiem soat noi bo; logic thuan trong ui/approval-policy-view.ts.
- Test: infrastructure/hrm-approval-policy-settings.spec.ts (parse, load mac dinh, save + audit, thieu ly do khong ghi), hrm-routes.spec.ts (+1 route), ui/approval-policy-view.spec.ts. module-hrm test: 193 pass, 101 skip; lint dat. feature-hrm: 3 test cu o hrm-attendance-overview.spec.ts van fail (cua nguoi dung), lint co 1 loi san co (rule @next/next/no-img-element o hrm-profile-documents-panel.tsx), typecheck khong co loi TS.
- Luu y: typecheck module-hrm hien bao 4 loi TS2345 (ProcedureAttributeSpec) o hrm-procedure-bridge.service.ts:245,271 va hrm-procedure-links.ts:273,278 - khong thuoc thay doi nay (file khac, do kieu thuoc tinh scope/valueKey chua khop contract).
- Con lai: build + restart hrm-api de co endpoint; chua thu giao dien tren trinh duyet; chua co test component cho the.

## Bao cao viec ton dong 2 (file/user)

Trang thai: Xong phan ma + test don vi. Khong commit, khong ghi DB, khong migration, khong restart.

**(A) Dinh dang PE mong doi (xac nhan bang doc ma)**
- PE `normalizeAttributeValue` (domain/procedure-attributes.ts): `file` yeu cau MANG chuoi (khu trung), PE KHONG kiem id tep (chuoi bat ky; luu `{type:'file', value:[...]}`); `user` yeu cau chuoi khong rong + `label` tuy chon, PE khong tra cuu nguoi dung (id Platform theo hop dong, label la ten hien thi).
- Form HRM (dynamic-attribute-form.tsx) gui `file` la MOT chuoi id dinh kem HRM (PE se bao "can danh sach tep dinh kem" -> loi khi nop) va `user` la id nhan vien HRM (khong phai id nguoi dung Platform).
- Quyet dinh: `file` = mang id dinh kem HRM (HRM giu kho tep, PE chi luu tham chieu); `user` = `core_schema.employees.user_id` kem `label` = ho ten (khong gia dinh employeeId == userId).
- Sua phia HRM: file moi `hrm-attribute-values.ts` (ham thuan `normalizeAttributesForProcedure`, `collectUserReferences`, `describeSubmittedAttributes`, `loadEmployeeUserMap`; `initialProcedureAttributes` chuyen vao day, bridge van re-export). `prepareHrmProcedureLink` (hrm-procedure-links.ts) chuan hoa sau khi ap anh xa truong: file -> `{type:'file',value:[id]}`; user -> `{type:'user',value:userId,label:ten}`; nhan vien chua co tai khoan -> 400 thong bao ro. `initialProcedureValues` boc id tep chuoi cu (lien ket START_PENDING truoc khi sua) thanh mang. Khong can sua PE.

**(B) Tai tep / hien thuoc tinh da nhap**
- `GET /v1/procedure-progress/:instanceId` (HRM) them `submittedAttributes[]` (key, ten, kieu, pham vi, `display`, `files[{id,name}]`), dung tu `procedure_links.attributes` + `definition_snapshot` (bang HRM) va `hrm_schema.attachments` (ten tep), ten nguoi tu `core_schema.employees` (cung cach hrm-approval-policy dang doc). Khong doc DB PE. Du lieu cu (id nhan vien tho, id tep chuoi) van hien dung. Quyen xem: dung kiem tra san co cua endpoint (hrm.request.read / hrm.self.read tren nhan vien chu don).
- FE: `SubmittedAttributesBlock` trong ui/procedure-progress-panel.tsx (dung chung chi tiet don nhan vien va man Duyet don): luoi nhan/gia tri, kieu user hien ten, kieu file hien ten tep + nut "Tai tep" goi `/attachments/:id/download` (presigned GET, kiem quyen nhu dinh kem khac).

**Test**: moi hrm-attribute-values.spec.ts (7 test); cap nhat hrm-procedure-progress.spec.ts (them khoa submittedAttributes). pnpm nx: module-hrm test 200 pass/101 skip, typecheck, lint dat; module-procedure-engine test 109 pass, lint dat (typecheck loi cu procedure-final-actor.spec.ts import thieu .js, khong thuoc viec nay); feature-hrm: khong loi moi (con loi cu cua nguoi dung: dashboard-screen, requests-screen bien khong dung, hrm-attendance-overview.spec, lint rule next/no-img-element).

**Con dang do**
- Chua chay thu tren trinh duyet; chua co test component cho SubmittedAttributesBlock.
- Neu tep tai len duoi nhan vien khac nguoi nop (vd HR tai ho), nguoi duyet can quyen xem nhan vien do; tep nhay cam van chi chinh chu/HR.
- Nguoi duyet khong co hrm.request.read van khong goi duoc progress (khong doi).

## Kiem tra lan 2 sau khi khoi dong lai (05/10/2026 12:1x) - PHAT HIEN LO HONG
- Khoi dong lai: cac tien trinh hrm-api/procedure-api/worker luc 11:00 van giu cong 3339/3334 voi ma cu (tokens INVALID_TOKEN, route approval-policy-settings 404); da tat 11:00-processes, dich vu moi tu len; sau do route moi hoat dong (GET approval-policy-settings -> 200).
- Phat hien: nguoi nop (tai khoan quan tri tenant bui.cong.quyen co quyen ghi de cua PE) TU DUYET don cua chinh minh qua POST requests/leave/:id/actions {action APPROVE} -> 201, don APPROVED, approved_by = chinh nguoi nop. approved_by da ghi dung nguoi thuc hien (viec ton dong 3 chay dung), nhung PE cho phep nguoi co quyen ghi de, nen chan tu duyet phai dat o HRM.
- Da sua (chua co hieu luc den khi restart hrm-api): hrm-approval-policy.ts them assertNotSelfDecision (chan APPROVE/REJECT/RETURN/COMPLETE khi chu don = nguoi thao tac, tru CANCEL; ton trong allow_self_approval) + HrmApprovalPolicyService.assertNotSelfDecision; hrm-request.controller.ts procedureAction goi kiem tra truoc bridge.applyAction. 4 test moi, module-hrm 204 test PASS, typecheck PASS.
- Can lam: restart hrm-api (ma duoc sua sau 12:14), chay lai tmp/live-test/uat_final.js (don 26/10): ky vong nguoi nop bi 403 SELF_APPROVAL_FORBIDDEN, Truong phong duyet duoc, approved_by = user id Truong phong.
- Cac don thu da CANCELLED (reverse): 22/10, 23/10 (2 don), 26/10; quy phep da tra lai.

## Kiem tra lan 3 sau khi restart hrm-api (05/10/2026 12:25) - DAT
- Don thu 27/10: nguoi nop (bui.cong.quyen) APPROVE qua PE -> 403 SELF_APPROVAL_FORBIDDEN (da chan).
- Truong phong (nguyen.tran.nhu.quynh) canAct=true, APPROVE chu thuong -> 201; don APPROVED, workflow COMPLETED, link APPLIED; approved_by = eed9c1c7-... = user id cua nguyen.tran.nhu.quynh (nguoi duyet that, khong con la actor he thong).
- Reverse -> CANCELLED, quy phep tra lai.
- Chua kiem: submittedAttributes/tai tep (quy trinh QT-HRM-DON-TU khong co thuoc tinh file/user), rẽ nhanh theo dieu kien, 6 loai don con lai, che do DIRECT, PE tat.

## Kiem tra lan 4: OT, cong tac, tam ung qua PE (05/10/2026)
- Moi loai: gui don -> 201, sync RUNNING, buoc S tu hoan thanh, buoc hien tai "HR tham dinh va phe duyet" cho "Truong phong Hanh chinh - Tong hop".
- Nguoi nop tu duyet: endpoint truc tiep -> 403 SELF_APPROVAL_FORBIDDEN; qua PE actions -> 403 SELF_APPROVAL_FORBIDDEN (ca 3 loai).
- Truong phong: canAct=true; APPROVE -> 201; don APPROVED, workflow COMPLETED, approved_by = user id Truong phong (eed9c1c7-...). Reverse -> CANCELLED.
- Don thu: OT 28/10, cong tac 29/10, tam ung 100.000 d (ly do bat dau "UAT-E2E-FIX05"); tat ca da CANCELLED sau khi reverse.
- Chua kiem tren he thong that: giai trinh cong, doi ca, chinh sua ho so (profile dang DIRECT; duyet co the sua ho so that nen khong thu), che do DIRECT/scope quan ly, re nhanh theo dieu kien, thuoc tinh file/user, PE tat. Che do DIRECT va scope da co test mo phong (hrm-procedure-e2e.sim.spec.ts).

## Kiem tra lan 5: che do DIRECT (OT) tren savina (05/10/2026)
- qa03 khong dung duoc (0 ho so HRM, khong co binding) nen thu tren savina: doi binding OT sang DIRECT -> thu -> tra ve PROCEDURE (definition QT-HRM-DON-TU). Ket qua cau hinh: OT con DUY NHAT 1 dong ACTIVE (PROCEDURE) - 3 dong trung truoc day bi gop (nhu mong muon). Cac loai don khac van con 3 dong trung.
- Nhan vien hanh chinh (huynh.thi.hong.nhung) khong co quyen HRM trong tenant (PERMISSION_DENIED) -> khong thu duoc kich ban "nhan vien gui, cap tren duyet".
- Don OT cua Quyen (DIRECT): nguoi nop tu duyet -> 403 SELF_APPROVAL_FORBIDDEN (dung); danh sach forApproval cua Truong phong HC co don; Truong phong HC duyet -> 201 (HOP LE: tai khoan nay co hrm.ot.approve.all + hrm.manage nen duoc duyet toan tenant). Don da hoan tac (reverse) -> CANCELLED.
- Chua kiem chung bang du lieu that: bi chan APPROVAL_OUT_OF_SCOPE cho nguoi duyet chi co hrm.*.approve (khong .all) - can mot tai khoan Truong bo phan khong co .all va mot nhan vien co quyen HRM. Da co unit test (hrm-approval-policy.spec.ts, hrm-procedure-e2e.sim.spec.ts).

## Kiem tra lan 6: giai trinh cong va doi ca qua PE (05/10/2026)
- Giai trinh cong (ngay 02/10): gui -> RUNNING, buoc S tu hoan thanh, cho Truong phong HC; nguoi nop tu duyet qua PE -> 403 SELF_APPROVAL_FORBIDDEN; Truong phong APPROVE -> 201, don APPROVED/COMPLETED, approved_by = Truong phong; reverse -> 201.
- Doi ca (30/10): gui -> RUNNING; rut don -> CANCELLED/CANCELLED (khong thu duyet vi loai nay khong co reverse). Gui voi changeType khong hop le ('TEMPORARY') tra 500 thay vi 400 (thieu validate enum, nen sua: hrm-request.controller.ts shift-change-requests).
- Chua thu: chinh sua ho so (profile_correction) - duyet co the sua ho so that.
- Tong ket loai don da thu qua PE tren he thong that: nghi phep, OT, cong tac, tam ung, giai trinh cong (tao + tu duyet bi chan + Truong phong duyet + reverse); doi ca (tao + rut). OT o che do DIRECT (tu duyet bi chan, Truong phong duyet duoc).
