import { CreateAccountInput, LocalDate, TrackingType, UpdateAccountInput } from '@budgetracker/shared';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min, NotEquals, ValidateNested } from 'class-validator';
import { IsLocalDate } from '../common/is-local-date';

const trim = ({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value);

export class OpeningBalanceDto {
  @IsInt()
  @NotEquals(0)
  @Min(-Number.MAX_SAFE_INTEGER)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents!: number;

  @IsLocalDate()
  date!: LocalDate;
}

// Pas de champ solde : il est calculé (forbidNonWhitelisted refuse `balance`).
export class CreateAccountDto implements CreateAccountInput {
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsEnum(TrackingType)
  trackingType!: TrackingType;

  @IsOptional()
  @ValidateNested()
  @Type(() => OpeningBalanceDto)
  openingBalance?: OpeningBalanceDto;
}

export class UpdateAccountDto implements UpdateAccountInput {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsEnum(TrackingType)
  trackingType?: TrackingType;
}
