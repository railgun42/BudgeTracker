import { CreateTransferInput, LocalDate, UpdateTransferInput } from '@budgetracker/shared';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsLocalDate } from '../common/is-local-date';

const trim = ({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value);
// PATCH : champ absent ⇒ inchangé ; `null` refusé (sauf details, effaçable).
const Present = () => ValidateIf((_, value) => value !== undefined);

export class CreateTransferDto implements CreateTransferInput {
  @IsUUID()
  fromAccountId!: string;

  @IsUUID()
  toAccountId!: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents!: number;

  @IsLocalDate()
  date!: LocalDate;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string | null;
}

export class UpdateTransferDto implements UpdateTransferInput {
  @IsInt()
  @Min(1)
  version!: number;

  @Present()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents?: number;

  @Present()
  @IsLocalDate()
  date?: LocalDate;

  @Present()
  @Transform(trim)
  @IsString()
  @Length(0, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string | null;
}
