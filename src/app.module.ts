import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Usuario } from './usuarios/usuario.entity';
import { UsuariosModule } from './usuarios/usuarios.module';
import { DocumentsModule } from './documents/documents.module';
import { FoldersModule } from './folders/folders.module';
import { AuditModule } from './audit/audit.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario]),
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // El servidor local es MariaDB 10.4. Con type 'mysql', TypeORM interpreta mal los
        // valores por defecto de las columnas nullable, cree que cambiaron en cada arranque y
        // vuelve a alterarlas (borrando y recreando sus índices y claves foráneas).
        // Si en la nube usas MySQL 8, define DB_TYPE=mysql en el .env de ese entorno.
        type: config.get<string>('DB_TYPE') === 'mysql' ? 'mysql' : 'mariadb',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),

    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get<string>('MAIL_HOST'),
          port: config.get<number>('MAIL_PORT'),
          secure: false,
          auth: {
            user: config.get<string>('MAIL_USER'),
            pass: config.get<string>('MAIL_PASS'),
          },
        },
        defaults: {
          from: `"Activa Uniformes" <${config.get<string>('MAIL_USER')}>`,
        },
      }),
    }),

    MailerModule.forRoot({
      transport: {
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: 'soporte.uniformesactiva@gmail.com',
          pass: 'rdaa fsar waju kfax',
        },
      },
      defaults: {
        from: '"Activa Uniformes" <soporte.uniformesactiva@gmail.com>',
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
