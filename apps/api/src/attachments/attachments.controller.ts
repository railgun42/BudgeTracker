import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ATTACHMENT_MAX_BYTES, AttachmentDto, AttachmentUrlDto } from '@budgetracker/shared';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { AttachmentsService, UploadedFileLike } from './attachments.service';

@Controller('v1/transactions/:id/attachment')
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  // Multipart, un seul fichier « file » en mémoire ; au-delà de 5 Mo multer coupe ⇒ 413.
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 0 }, defParamCharset: 'utf8' }))
  upload(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: UploadedFileLike): Promise<AttachmentDto> {
    return this.attachments.upload(user.id, id, file);
  }

  @Get()
  url(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<AttachmentUrlDto> {
    return this.attachments.url(user.id, id);
  }

  @Delete()
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.attachments.remove(user.id, id);
  }
}
