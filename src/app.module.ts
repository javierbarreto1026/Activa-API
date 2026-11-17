import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailerModule } from '@nestjs-modules/mailer';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Usuario } from './usuarios/usuario.entity';
import { UsuariosModule } from './usuarios/usuarios.module';
import { DocumentsModule } from './documents/documents.module';
import { FoldersModule } from './folders/folders.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    // Debe ir primero: carga el .env y deja ConfigService disponible en toda la app.
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // El servidor local es MariaDB 10.4. Con type 'mysql', TypeORM interpreta mal los
        // valores por defecto de las columnas nullable, cree que cambiaron en cada arranque y
        // vuelve a alterarlas (borrando y recreando sus índices y claves foráneas).
        // Si en la nube usas MySQL 8, define DB_TYPE=mysql en el .env de ese entorno.
        type: config.get<string>('DB_TYPE') === 'mysql' ? 'mysql' : 'mariadb',
        host: config.get<string>('DB_HOST'),
        // Las variables de entorno siempre llegan como texto: se convierten a número.
        port: Number(config.get<string>('DB_PORT', '3306')),
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        autoLoadEntities: true,
        // Crea/ajusta tablas en desarrollo; apagado en producción por seguridad.
        synchronize: config.get<string>('NODE_ENV') !== 'production',
      }),
    }),

    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const puerto = Number(config.get<string>('MAIL_PORT', '587'));
        const usuario = config.get<string>('MAIL_USER');
        return {
          transport: {
            host: config.get<string>('MAIL_HOST'),
            port: puerto,
            // 465 = SSL directo; 587 = STARTTLS (secure: false y se negocia TLS después).
            secure: puerto === 465,
            auth: {
              user: usuario,
              pass: config.get<string>('MAIL_PASS'),
            },
          },
          defaults: {
            from: config.get<string>('MAIL_FROM') ?? `"Activa Uniformes" <${usuario}>`,
          },
        };
      },
    }),

    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
    }),
    // Se eliminó un segundo TypeOrmModule.forRoot fijo a 127.0.0.1:3307: apuntaba a la misma
    // base de datos que la conexión de arriba y las dos ejecutaban `synchronize` a la vez,
    // de modo que una intentaba borrar índices que la otra ya había borrado.

    TypeOrmModule.forFeature([Usuario]),
    UsuariosModule,
    DocumentsModule,
    FoldersModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
