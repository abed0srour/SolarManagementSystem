import {
  BadRequestException, Body, Controller, Delete, Get, Param, Post, Query,
  UploadedFile, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { UploadsService } from './uploads.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

const ENTITIES = ['Product', 'Client', 'Supplier', 'WarrantyClaim', 'ServiceJob', 'Company', 'Invoice', 'Refund'];

class UploadMetaDto {
  @IsString()
  entity: string;

  @IsString()
  @MinLength(1)
  entityId: string;
}

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private service: UploadsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File, @Body() meta: UploadMetaDto) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ENTITIES.includes(meta.entity)) throw new BadRequestException(`entity must be one of: ${ENTITIES.join(', ')}`);
    return this.service.register(user.id, meta.entity, meta.entityId, file);
  }

  @Post('multiple')
  @UseInterceptors(FilesInterceptor('files', 10))
  uploadMany(@CurrentUser() user: AuthUser, @UploadedFiles() files: Express.Multer.File[], @Body() meta: UploadMetaDto) {
    if (!files?.length) throw new BadRequestException('No files uploaded');
    if (!ENTITIES.includes(meta.entity)) throw new BadRequestException(`entity must be one of: ${ENTITIES.join(', ')}`);
    return Promise.all(files.map((f) => this.service.register(user.id, meta.entity, meta.entityId, f)));
  }

  @Get()
  list(@Query('entity') entity: string, @Query('entityId') entityId: string) {
    return this.service.list(entity, entityId);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }
}
