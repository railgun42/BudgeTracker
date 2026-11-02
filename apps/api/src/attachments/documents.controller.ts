import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ATTACHMENT_MAX_BYTES, AttachmentDto, AttachmentUrlDto, DocumentDto, DocumentTagsInput } from '@budgetracker/shared';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { AttachmentsService, UploadedFileLike } from './attachments.service';

class DocumentTagsDto implements DocumentTagsInput {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  tagIds!: string[];
}

// Coffre-fort (SPEC §4) : documents de l'utilisateur, avec ou sans transaction.
@Controller('v1/documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<DocumentDto[]> {
    return this.attachments.listDocuments(user.id);
  }

  // Dépôt direct : mêmes limites que la pièce d'une transaction.
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 0 }, defParamCharset: 'utf8' }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: UploadedFileLike): Promise<AttachmentDto> {
    return this.attachments.upload(user.id, null, file);
  }

  @Get(':id/url')
  url(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('download') download?: string): Promise<AttachmentUrlDto> {
    return this.attachments.documentUrl(user.id, id, download === '1');
  }

  @Put(':id/tags')
  setTags(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() { tagIds }: DocumentTagsDto): Promise<DocumentDto> {
    return this.attachments.setTags(user.id, id, tagIds);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.attachments.removeDocument(user.id, id);
  }
}
