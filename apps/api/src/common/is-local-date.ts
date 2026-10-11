import { isLocalDate } from '@budgetracker/shared';
import { ValidateBy, ValidationOptions } from 'class-validator';

// Jour 'YYYY-MM-DD' existant (rejette 2023-02-29).
export const IsLocalDate = (options?: ValidationOptions) =>
  ValidateBy({ name: 'isLocalDate', validator: { validate: isLocalDate, defaultMessage: () => '$property : date YYYY-MM-DD attendue' } }, options);
