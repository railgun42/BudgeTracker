import { Controller, Delete, Get, HttpCode, Query, Res, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { Response } from 'express';
import { clearSession } from '../auth/auth.controller';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { ExportData, GdprService, toCsv } from './gdpr.service';

export class ExportQueryDto {
  @IsOptional()
  @IsIn(['json', 'csv'])
  format: 'json' | 'csv' = 'json';
}

@Controller('v1/me')
@UseGuards(JwtAuthGuard)
export class GdprController {
  constructor(private readonly gdpr: GdprService) {}

  // Téléchargement : Content-Disposition + type déduit de l'extension.
  @Get('export')
  async export(@CurrentUser() { id }: AuthUser, @Query() { format }: ExportQueryDto, @Res({ passthrough: true }) res: Response): Promise<ExportData | string> {
    const data = await this.gdpr.export(id);
    res.attachment(`budgetracker-export.${format}`);
    return format === 'csv' ? toCsv(data) : data;
  }

  // Irréversible : la confirmation se fait dans l'UI ; CSRF exigé comme pour toute requête non GET.
  @Delete()
  @HttpCode(204)
  async remove(@CurrentUser() { id }: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.gdpr.deleteAccount(id);
    clearSession(res);
  }
}
