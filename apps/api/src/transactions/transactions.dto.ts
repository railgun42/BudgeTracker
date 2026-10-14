import { CreateTransactionInput, LocalDate, TransactionListQuery, TransactionType, UpdateTransactionInput } from '@budgetracker/shared';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsLocalDate } from '../common/is-local-date';

const trim = ({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value);
// PATCH : champ absent ⇒ inchangé ; `null` refusé (sauf details, effaçable).
const Present = () => ValidateIf((_, value) => value !== undefined);

export class CreateTransactionDto implements CreateTransactionInput {
  @IsUUID()
  accountId!: string;

  @IsUUID()
  categoryId!: string;

  // Centimes : entier strictement positif, le sens est porté par `type`.
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents!: number;

  @IsLocalDate()
  date!: LocalDate;

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
  @IsOptional()
  @IsBoolean()
  countInBalance?: boolean;
}

export class UpdateTransactionDto implements UpdateTransactionInput {
  @IsInt()
  @Min(1)
  version!: number;

  @Present()
  @IsUUID()
  accountId?: string;

  @Present()
  @IsUUID()
  categoryId?: string;

  @Present()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents?: number;

  @Present()
  @IsLocalDate()
  date?: LocalDate;

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
  @Present()
  @IsBoolean()
  countInBalance?: boolean;
}

export class TransactionListQueryDto implements TransactionListQuery {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsLocalDate()
  from?: LocalDate;

  @IsOptional()
  @IsLocalDate()
  to?: LocalDate;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  tagId?: string;
}
