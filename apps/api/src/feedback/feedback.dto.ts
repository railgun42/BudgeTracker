import { AdminFeedbackSort, CreateFeedbackInput, FEEDBACK_LIMITS, FeedbackStatus, FeedbackType } from '@budgetracker/shared';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, Length } from 'class-validator';

const trim = ({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value);

export class CreateFeedbackDto implements CreateFeedbackInput {
  @IsEnum(FeedbackType)
  type!: FeedbackType;

  // Vide (espaces seuls) ou trop long ⇒ 400.
  @Transform(trim)
  @IsString()
  @Length(1, FEEDBACK_LIMITS.maxMessageLength)
  message!: string;
}

export class AdminFeedbackQueryDto {
  @IsOptional()
  @IsEnum(FeedbackType)
  type?: FeedbackType;

  @IsOptional()
  @IsIn(['NEW', 'TREATED'])
  status?: FeedbackStatus;

  @IsOptional()
  @IsIn(['date', 'type', 'status'])
  sort: AdminFeedbackSort = 'date';
}
