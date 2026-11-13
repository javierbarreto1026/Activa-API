import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../usuarios/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES_ADMIN } from '../auth/usuario-sesion';
import { validarDto } from '../common/validacion';
import { AuditService } from './audit.service';
import { FiltrosAuditoriaDto } from './dto/filtros-auditoria.dto';

@Controller('logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_ADMIN)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // GET /logs?pagina=1&limite=20&departamento=SST&accion=UPLOAD_DOCUMENT
  @Get()
  listar(@Query(validarDto) filtros: FiltrosAuditoriaDto) {
    return this.auditService.listar(filtros);
  }
}
