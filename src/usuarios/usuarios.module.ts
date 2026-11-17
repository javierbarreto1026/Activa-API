import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
import { Usuario } from './usuario.entity';
import { JwtStrategy } from './jwt.strategy';
import { MailerModule } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { UsersController } from './users.controller';
import { GestionUsuariosService } from './gestion-usuarios.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario]),
    MailerModule,
    AuditModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // getOrThrow: si falta JWT_SECRET la app no arranca, en vez de firmar tokens sin clave.
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
  ],
  controllers: [UsuariosController, UsersController],
  providers: [UsuariosService, GestionUsuariosService, JwtStrategy],
})
export class UsuariosModule {}
