import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Documento } from '../documents/documento.entity';
import { StorageModule } from '../storage/storage.module';
import { Carpeta } from './carpeta.entity';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';

@Module({
  imports: [
    // JwtAuthGuard (AuthGuard('jwt')) necesita AuthModuleOptions, que lo provee PassportModule.
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([Carpeta, Documento]),
    StorageModule,
    AuditModule,
  ],
  controllers: [FoldersController],
  providers: [FoldersService],
  exports: [FoldersService],
})
export class FoldersModule {}
