import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
import { Usuario } from './usuario.entity';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario]),

    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: 'MI_CLAVE_SECRETA_SENA',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [UsuariosController],

  providers: [UsuariosService, JwtStrategy],
})
export class UsuariosModule {}
