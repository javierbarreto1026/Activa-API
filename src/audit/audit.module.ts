import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [
    // JwtAuthGuard (AuthGuard('jwt')) necesita AuthModuleOptions, que lo provee PassportModule.
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([AuditLog]),
  ],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
