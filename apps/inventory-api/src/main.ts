import { NestFactory } from '@nestjs/core';
import { InventoryApiModule } from './app/inventory-api.module';

async function bootstrap() {
  const app = await NestFactory.create(InventoryApiModule, { cors: true });
  app.setGlobalPrefix('api/inventory');

  const port = process.env.INVENTORY_API_PORT || 3336;
  await app.listen(port, '0.0.0.0');
  console.log(`✅ Inventory API listening on port ${port}`);
}

bootstrap();
