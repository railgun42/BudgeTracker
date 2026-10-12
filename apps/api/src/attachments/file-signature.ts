// Type réel d'un fichier d'après ses premiers octets (SPEC §4) ; extension et Content-Type client ignorés.
// null ⇒ type non accepté.
export function detectMime(buf: Buffer): string | null {
  const ascii = (start: number, end: number) => buf.subarray(start, end).toString('latin1');
  if (buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
