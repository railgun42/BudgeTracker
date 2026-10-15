import { CreateAnnouncementInput, CreateNotificationInput, NOTIFICATION_MAX_LENGTH } from '@budgetracker/shared';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { normalizeEmail } from '../auth/auth.dto';

const trim = ({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value);

export class CreateAnnouncementDto implements CreateAnnouncementInput {
  // Vide (espaces seuls) ou trop long ⇒ 400.
  @Transform(trim)
  @IsString()
  @Length(1, NOTIFICATION_MAX_LENGTH)
  message!: string;
}

export class CreateNotificationDto extends CreateAnnouncementDto implements CreateNotificationInput {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
