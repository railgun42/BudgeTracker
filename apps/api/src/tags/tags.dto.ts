import { TagInput } from '@budgetracker/shared';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsString, Length } from 'class-validator';

const trim = ({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value);

export class TagBodyDto implements TagInput {
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  name!: string;
}
