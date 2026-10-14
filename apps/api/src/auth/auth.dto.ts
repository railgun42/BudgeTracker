import { Transform, TransformFnParams } from 'class-transformer';
import { Equals, IsEmail, IsString, Length, MaxLength } from 'class-validator';

// Même normalisation que le CHECK User_email_lowercase.
const normalizeEmail = ({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class SignupDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  name!: string;

  // Borne haute : limite le coût d'un hash Argon2 sur une entrée géante.
  @IsString()
  @Length(10, 128)
  password!: string;

  // Consentement aux CGU : exactement `true` (ni absent, ni false, ni "true").
  @Equals(true, { message: 'acceptTerms doit valoir true' })
  acceptTerms!: true;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}

export class VerifyEmailDto {
  @IsString()
  @Length(1, 128)
  token!: string;
}

export class ForgotPasswordDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(1, 128)
  token!: string;

  // Mêmes règles qu'à l'inscription.
  @IsString()
  @Length(10, 128)
  password!: string;
}
