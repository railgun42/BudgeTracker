import { CookieOptions } from 'express';

// Noms et options de tous les cookies de session (SPEC §5 : httpOnly, Secure, SameSite).
export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';

export const ACCESS_TTL_MS = 15 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 3600_000;

const base: CookieOptions = { httpOnly: true, secure: true, sameSite: 'strict' };
export const accessCookie: CookieOptions = { ...base, path: '/api', maxAge: ACCESS_TTL_MS };
// Envoyé uniquement aux routes d'auth.
export const refreshCookie: CookieOptions = { ...base, path: '/api/v1/auth', maxAge: REFRESH_TTL_MS };
// Lisible par le front (double-submit) : il le recopie dans l'en-tête X-CSRF-Token.
export const csrfCookie: CookieOptions = { ...base, httpOnly: false, path: '/' };
