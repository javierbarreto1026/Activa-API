import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      // Usamos process.cwd() (Current Working Directory)
      // que apunta a la raíz de tu proyecto donde ejecutaste 'npm run start'
      rootPath: join(process.cwd(), 'public'),
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
