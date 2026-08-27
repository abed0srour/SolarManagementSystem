import { BadRequestException, Body, Controller, Get, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { IsBoolean, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { BackupService } from './backup.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class ScheduleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** null means every day. @IsOptional() lets it through, @IsInt guards a value. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(59)
  minute?: number;
}

@Controller('backup')
export class BackupController {
  constructor(private service: BackupService) {}

  @Get('status')
  status() {
    return this.service.status();
  }

  @Put('schedule')
  setSchedule(@CurrentUser() user: AuthUser, @Body() dto: ScheduleDto) {
    return this.service.setSchedule(user.id, dto);
  }

  @Post('run')
  run(@CurrentUser() user: AuthUser) {
    return this.service.run(user.id);
  }

  @Get('download')
  async download(@Res() res: Response) {
    const body = await this.service.downloadBody();
    const companyName = await this.service.getCompanyName();
    const safeName = (companyName || 'SolarStore').trim().replace(/[\s/\\?%*:|"<>]+/g, '-').replace(/-+/g, '-');
    const dateStr = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${safeName}-backup-${dateStr}.json.gz"`,
      'Content-Length': String(body.length),
    });
    res.end(body);
  }

  /** Every table as CSV in one zip */
  @Get('csv')
  async csv(@Res() res: Response) {
    const body = await this.service.csvExport();
    const companyName = await this.service.getCompanyName();
    const safeName = (companyName || 'SolarStore').trim().replace(/[\s/\\?%*:|"<>]+/g, '-').replace(/-+/g, '-');
    const dateStr = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeName}-backup-${dateStr}.zip"`,
      'Content-Length': String(body.length),
    });
    res.end(body);
  }

  @Post('restore/local')
  restoreLocal(@CurrentUser() user: AuthUser) {
    return this.service.restoreFromLocal(user.id);
  }

  @Post('restore/upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }))
  restoreUpload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.service.restoreFromBuffer(user.id, file.buffer);
  }
}
