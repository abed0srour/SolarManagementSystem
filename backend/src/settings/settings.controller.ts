import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { SettingsService } from './settings.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class SequenceDto {
  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  nextNumber?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  padding?: number;
}

@Controller('settings')
export class SettingsController {
  constructor(private service: SettingsService) {}

  @Get()
  getAll() {
    return this.service.getAll();
  }

  @Get('sequences')
  sequences() {
    return this.service.sequences();
  }

  @Patch('sequences/:id')
  updateSequence(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SequenceDto) {
    return this.service.updateSequence(user.id, id, dto);
  }

  @Put(':key')
  set(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() value: any) {
    return this.service.set(user.id, key, value);
  }
}
