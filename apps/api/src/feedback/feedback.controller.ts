import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { FeedbackDto } from '@budgetracker/shared';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { CreateFeedbackDto } from './feedback.dto';
import { FeedbackService, toFeedbackDto } from './feedback.service';

@Controller('v1/feedback')
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  async list(@CurrentUser() { id }: AuthUser): Promise<FeedbackDto[]> {
    return (await this.feedback.list(id)).map(toFeedbackDto);
  }

  @Post()
  async create(@CurrentUser() { id }: AuthUser, @Body() dto: CreateFeedbackDto): Promise<FeedbackDto> {
    return toFeedbackDto(await this.feedback.create(id, dto));
  }
}
