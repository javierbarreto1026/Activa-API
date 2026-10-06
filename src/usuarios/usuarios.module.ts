import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
import { Usuario } from './usuario.entity';

@Module({
  // forFeature le dice a TypeORM qué tablas usaremos en este módulo específico
  imports: [TypeOrmModule.forFeature([Usuario])],
  controllers: [UsuariosController], // Aquí registramos tu nueva ruta
  providers: [UsuariosService], // Aquí registramos la lógica
})
export class UsuariosModule {}
