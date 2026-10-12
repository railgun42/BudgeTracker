import { detectMime } from './file-signature';

const bytes = (...parts: (number[] | string)[]) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));

describe('detectMime', () => {
  it('reconnaît JPEG, PNG, WebP et PDF par leur signature', () => {
    expect(detectMime(bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'))).toBe('image/jpeg');
    expect(detectMime(bytes([0x89], 'PNG\r\n\x1a\n', 'IHDR'))).toBe('image/png');
    expect(detectMime(bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '))).toBe('image/webp');
    expect(detectMime(bytes('%PDF-1.7\n'))).toBe('application/pdf');
  });

  it('rejette le reste, quelle que soit l’extension annoncée', () => {
    expect(detectMime(bytes('MZ', [0x90, 0, 3, 0]))).toBeNull(); // exécutable Windows
    expect(detectMime(bytes([0x7f], 'ELF'))).toBeNull();
    expect(detectMime(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBeNull(); // RIFF mais pas WebP
    expect(detectMime(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectMime(bytes([0xff, 0xd8]))).toBeNull(); // tronqué
    expect(detectMime(Buffer.alloc(0))).toBeNull();
  });
});
