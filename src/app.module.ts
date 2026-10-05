import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { AppController } from './app.controller';
import { Usuario } from './usuarios/usuario.entity';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
    }),

    TypeOrmModule.forRoot({
      type: 'mysql',
      host: '127.0.0.1',
      port: 3307, // aqui 3306
      username: 'root',
      password: '', //RocketLeague2005
      database: 'activauniformes',
      entities: [Usuario],
      synchronize: true,
      logging: false,
    }),

    TypeOrmModule.forFeature([Usuario]),
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
