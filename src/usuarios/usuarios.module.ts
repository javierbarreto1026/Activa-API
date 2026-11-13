import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
import { Usuario } from './usuario.entity';
import { JwtStrategy } from './jwt.strategy';
import { MailerModule } from '@nestjs-modules/mailer';
import { AuditModule } from '../audit/audit.module';
import { UsersController } from './users.controller';
import { GestionUsuariosService } from './gestion-usuarios.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario]),
    MailerModule,
    AuditModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: 'MI_CLAVE_SECRETA_SENA',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [UsuariosController, UsersController],
  providers: [UsuariosService, GestionUsuariosService, JwtStrategy],
})
export class UsuariosModule {}
