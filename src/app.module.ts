import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
    }),
  ],
  // ¡Aquí estaba el problema! Volvemos a registrar el controlador
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
