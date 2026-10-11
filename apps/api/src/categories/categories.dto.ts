import { CreateCategoryInput, DeleteCategoryQuery, UpdateCategoryInput } from '@budgetracker/shared';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';

const trim = ({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value);
const COLOR = /^#[0-9a-fA-F]{6}$/;

export class CreateCategoryDto implements CreateCategoryInput {
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @Matches(COLOR)
  color?: string | null;
}

// `null` vaut effacement pour parentId (⇒ racine) et color ; jamais pour name.
export class UpdateCategoryDto implements UpdateCategoryInput {
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @Matches(COLOR)
  color?: string | null;
}

export class DeleteCategoryQueryDto implements DeleteCategoryQuery {
  @IsOptional()
  @IsUUID()
  reassignTo?: string;
}
