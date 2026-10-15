import {
  AdminUpdateCategoryInput,
  CategoryPreferenceInput,
  CategorySuggestionDecision,
  CategorySuggestionStatus,
  CreateCategoryInput,
  DeleteCategoryQuery,
  NOTIFICATION_MAX_LENGTH,
  ResolveCategorySuggestionInput,
  UpdateCategoryInput,
} from '@budgetracker/shared';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';

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

// POST /categories : seul l'utilisateur peut proposer sa catégorie à tous (`suggest` refusé par /admin/categories).
export class CreateUserCategoryDto extends CreateCategoryDto {
  @IsOptional()
  @IsBoolean()
  suggest?: boolean;
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

export class CategoryPreferenceDto implements CategoryPreferenceInput {
  @IsBoolean()
  hidden!: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  customName?: string | null;
}

// PATCH /admin/categories/:id : pas de reparentage ; `name` jamais null.
export class AdminUpdateCategoryDto implements AdminUpdateCategoryInput {
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @Matches(COLOR)
  color?: string | null;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class AdminSuggestionQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'ACCEPTED', 'REJECTED', 'TREATED'])
  status?: CategorySuggestionStatus;
}

export class ResolveCategorySuggestionDto implements ResolveCategorySuggestionInput {
  @IsIn(['ACCEPTED', 'REJECTED', 'TREATED'])
  decision!: CategorySuggestionDecision;

  // Absente ⇒ pas de notification ; vide (espaces seuls) ou trop longue ⇒ 400.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, NOTIFICATION_MAX_LENGTH)
  reply?: string;
}
