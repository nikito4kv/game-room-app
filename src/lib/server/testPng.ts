// PNG для тестов рисунка Румика (vitest) — в приложение не импортируется.
// Собирает файл руками: подпись, чанки с настоящими CRC, сжатые строки пикселей.
import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { AVATAR_HEIGHT, AVATAR_WIDTH } from "@/lib/api/contract";

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Чанк PNG: длина, тип, данные, CRC (crc — подменить контрольную сумму). */
export function pngChunk(type: string, data: Buffer = Buffer.alloc(0), crc?: number): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc ?? crc32(body));
  return Buffer.concat([len, body, sum]);
}

export type TestPngOptions = {
  width?: number;
  height?: number;
  /** Тип цвета PNG: 6 — RGBA (как у канвы), 2 — RGB. */
  color?: 2 | 6;
  interlace?: 0 | 1;
  /** Цвет квадрата посередине [r, g, b] — разные цвета дают разные файлы. */
  fill?: [number, number, number];
  /** Чанки до IDAT (после IHDR) и после IDAT (до IEND). */
  before?: Buffer[];
  after?: Buffer[];
  /** Подменить сжатые данные IDAT. */
  idat?: Buffer;
  /** Хвост после IEND. */
  trailing?: Buffer;
};

/** RGBA PNG AVATAR_WIDTH×AVATAR_HEIGHT: прозрачный, с цветным квадратом посередине. */
export function testPng(o: TestPngOptions = {}): Buffer {
  const width = o.width ?? AVATAR_WIDTH;
  const height = o.height ?? AVATAR_HEIGHT;
  const color = o.color ?? 6;
  const channels = color === 6 ? 4 : 3;
  const [r, g, b] = o.fill ?? [220, 60, 90];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = color;
  ihdr[12] = o.interlace ?? 0;
  const row = 1 + width * channels;
  const raw = Buffer.alloc(row * height);
  for (let y = Math.floor(height / 4); y < Math.floor((height * 3) / 4); y++) {
    for (let x = Math.floor(width / 4); x < Math.floor((width * 3) / 4); x++) {
      const at = y * row + 1 + x * channels;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      if (channels === 4) raw[at + 3] = 255;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    ...(o.before ?? []),
    pngChunk("IDAT", o.idat ?? deflateSync(raw)),
    ...(o.after ?? []),
    pngChunk("IEND"),
    o.trailing ?? Buffer.alloc(0),
  ]);
}

/** PNG, которому не хватает размера: случайный шум не сжимается. */
export function noisyPng(): Buffer {
  const row = 1 + AVATAR_WIDTH * 4;
  const raw = randomBytes(row * AVATAR_HEIGHT);
  for (let y = 0; y < AVATAR_HEIGHT; y++) raw[y * row] = 0; // фильтр строки
  return testPng({ idat: deflateSync(raw) });
}
