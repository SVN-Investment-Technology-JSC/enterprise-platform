import type { CreateAssetDto,CreateItemDto,CreateWarehouseDto,ExportStockDto,ImportStockDto,UpdateAssetSpecsDto,UploadAssetDocumentDto } from '@enterprise-platform/contract-inventory';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import { Body,Controller,ForbiddenException,Get,HttpException,Param,Post,Req,UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { InventoryApplication } from '../application/inventory.application.js';
import type { InventoryActor } from '../application/inventory-store.port.js';
import { InventoryError } from '../domain/inventory.error.js';
@Controller('inventory/v1')
export class InventoryController {
 constructor(private readonly app:InventoryApplication,private readonly identity:PlatformIdentityService,private readonly databases:TenantDatabaseRegistry){}
 @Get('workspace') async workspace(@Req() req:Request){const a=await this.actor(req,'inventory:stock:view');return this.run(()=>this.app.workspace(a));}
 @Get('items') async items(@Req() req:Request){const a=await this.actor(req,'inventory:item:read');return (await this.run(()=>this.app.workspace(a))).items;}
 @Get('stocks/balance') async balances(@Req() req:Request){const a=await this.actor(req,'inventory:stock:view');return (await this.run(()=>this.app.workspace(a))).balances;}
 @Post('warehouses') async createWarehouse(@Req() req:Request,@Body() input:CreateWarehouseDto){const a=await this.actor(req,'inventory:warehouse:manage');return this.run(()=>this.app.createWarehouse(a,input));}
 @Post('items') async createItem(@Req() req:Request,@Body() input:CreateItemDto){const a=await this.actor(req,'inventory:item:manage');return this.run(()=>this.app.createItem(a,input));}
 @Post('assets') async createAsset(@Req() req:Request,@Body() input:CreateAssetDto){const a=await this.actor(req,'inventory:item:manage');return this.run(()=>this.app.createAsset(a,input));}
 @Post('assets/:id/specs') async updateAssetSpecs(@Req() req:Request,@Param('id') assetId:string,@Body() input:UpdateAssetSpecsDto){const a=await this.actor(req,'inventory:item:manage');return this.run(()=>this.app.updateAssetSpecs(a,assetId,input));}
 @Post('assets/:id/documents') async uploadDocument(@Req() req:Request,@Param('id') assetId:string,@Body() input:UploadAssetDocumentDto){const a=await this.actor(req,'inventory:item:manage');return this.run(()=>this.app.uploadAssetDocument(a,assetId,input));}
 @Post('receipts') async receipt(@Req() req:Request,@Body() input:ImportStockDto){const a=await this.actor(req,'inventory:receipt:create');return this.run(()=>this.app.importStock(a,input));}
 @Post('issues') async issue(@Req() req:Request,@Body() input:ExportStockDto){const a=await this.actor(req,'inventory:issue:create');return this.run(()=>this.app.exportStock(a,input));}
 private async actor(req:Request,permission:string):Promise<InventoryActor>{const p=await this.principal(req);if(p.kind!=='tenant-user')throw new ForbiddenException();const d=await this.identity.decide({sessionId:p.sessionId,userId:p.userId,tenantId:p.tenantId,moduleKey:'inventory',permission});if(!d.allowed||!d.database||!d.principal)throw new ForbiddenException({code:d.code??'ACCESS_DENIED'});this.databases.register(d.database);const perms=d.principal.permissions;return{tenantId:p.tenantId,userId:p.userId,displayName:p.displayName,canRead:perms.includes('inventory:stock:view')||perms.includes('inventory:item:read'),canManage:perms.some(x=>['inventory:warehouse:manage','inventory:item:manage'].includes(x)),canAdjust:perms.some(x=>['inventory:stock:adjust','inventory:receipt:create','inventory:issue:create'].includes(x))};}
 private async principal(req:Request):Promise<AuthenticatedPrincipal>{const bearer=req.headers.authorization;const token=bearer?.startsWith('Bearer ')?bearer.slice(7):req.cookies?.ep_access as string|undefined;if(!token)throw new UnauthorizedException();try{return await this.identity.verifyAccessToken(token);}catch{throw new UnauthorizedException();}}
 private async run<T>(op:()=>Promise<T>):Promise<T>{try{return await op();}catch(e){if(!(e instanceof InventoryError))throw e;const status={validation:400,forbidden:403,not_found:404,conflict:409,insufficient_stock:409}[e.code];throw new HttpException({statusCode:status,code:e.code.toUpperCase(),message:e.message},status);}}
}
