import {
  CompareScenariosQuery,
  CreateScenarioInput,
  SCENARIO_LIMITS,
  ScenarioChangeKind,
  ScenarioParams,
  SIMULATION_LIMITS,
  UpdateScenarioInput,
} from '@budgetracker/shared';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import { ProjectionQueryDto } from '../simulations/simulations.controller';

const { maxAmountCents, maxMonthlyCents, maxRateBp, maxMonths } = SIMULATION_LIMITS;
const { maxNameLength, maxChanges, maxCompared } = SCENARIO_LIMITS;
const trim = ({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value);
const KINDS: ScenarioChangeKind[] = ['CATEGORY', 'SUBSCRIPTION', 'LOAN'];

// Union discriminée par `kind` : un `kind` inconnu retombe sur la classe de base et échoue sur @IsIn,
// et forbidNonWhitelisted refuse tout champ étranger au type choisi.
class ChangeDto {
  @IsIn(KINDS)
  kind!: ScenarioChangeKind;
}

class CategoryChangeDto extends ChangeDto {
  declare kind: 'CATEGORY';

  @IsUUID()
  categoryId!: string;

  @IsInt()
  @NotEquals(0)
  @Min(-maxMonthlyCents)
  @Max(maxMonthlyCents)
  monthlyDeltaCents!: number;
}

class SubscriptionChangeDto extends ChangeDto {
  declare kind: 'SUBSCRIPTION';

  @IsInt()
  @Min(1)
  @Max(maxMonthlyCents)
  monthlyCents!: number;
}

class LoanChangeDto extends ChangeDto {
  declare kind: 'LOAN';

  @IsInt()
  @Min(1)
  @Max(maxAmountCents)
  principalCents!: number;

  @IsInt()
  @Min(0)
  @Max(maxRateBp)
  annualRateBp!: number;

  @IsInt()
  @Min(1)
  @Max(maxMonths)
  months!: number;
}

export class ScenarioParamsDto implements ScenarioParams {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(maxChanges)
  @ValidateNested({ each: true })
  @Type(() => ChangeDto, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: 'kind',
      subTypes: [
        { name: 'CATEGORY', value: CategoryChangeDto },
        { name: 'SUBSCRIPTION', value: SubscriptionChangeDto },
        { name: 'LOAN', value: LoanChangeDto },
      ],
    },
  })
  changes!: (CategoryChangeDto | SubscriptionChangeDto | LoanChangeDto)[];
}

export class CreateScenarioDto implements CreateScenarioInput {
  @Transform(trim)
  @IsString()
  @Length(1, maxNameLength)
  name!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => ScenarioParamsDto)
  params!: ScenarioParamsDto;
}

export class UpdateScenarioDto implements UpdateScenarioInput {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, maxNameLength)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScenarioParamsDto)
  params?: ScenarioParamsDto;
}

// ?ids=id1,id2 ; mêmes paramètres que la projection pour le reste.
export class CompareScenariosQueryDto extends ProjectionQueryDto implements CompareScenariosQuery {
  @Transform(({ value }: TransformFnParams) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(maxCompared)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids!: string[];
}
