import { CreateRecurrenceInput, IntervalUnit, LocalDate, TransactionTemplateInput, TransactionType, UpdateRecurrenceInput } from '@budgetracker/shared';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsLocalDate } from '../common/is-local-date';

const trim = ({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value);
// PATCH : champ absent ⇒ inchangé ; `null` refusé (sauf details et endDate, effaçables).
const Present = () => ValidateIf((_, value) => value !== undefined);

export class TemplateDto implements TransactionTemplateInput {
  @IsUUID()
  categoryId!: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents!: number;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  tagIds?: string[];
}

export class UpdateTemplateDto implements Partial<TransactionTemplateInput> {
  @Present()
  @IsUUID()
  categoryId?: string;

  @Present()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents?: number;

  @Present()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @Present()
  @Transform(trim)
  @IsString()
  @Length(0, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string | null;

  @Present()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  tagIds?: string[];
}

export class CreateRecurrenceDto implements CreateRecurrenceInput {
  @IsUUID()
  accountId!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  interval!: number;

  @IsEnum(IntervalUnit)
  unit!: IntervalUnit;

  @IsLocalDate()
  startDate!: LocalDate;

  @IsOptional()
  @IsLocalDate()
  endDate?: LocalDate | null;

  @ValidateNested()
  @Type(() => TemplateDto)
  template!: TemplateDto;
}

export class UpdateRecurrenceDto implements UpdateRecurrenceInput {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsLocalDate()
  endDate?: LocalDate | null;

  @Present()
  @ValidateNested()
  @Type(() => UpdateTemplateDto)
  template?: UpdateTemplateDto;
}
