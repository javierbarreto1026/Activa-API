import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AlmacenamientoService } from './almacenamiento.service';

@Module({
  imports: [ConfigModule],
  providers: [AlmacenamientoService],
  exports: [AlmacenamientoService],
})
export class StorageModule {}
