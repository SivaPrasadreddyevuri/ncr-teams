/**
 * Writes real bytes into the seeded File rows.
 *
 * The seed creates nine `File` rows with metadata but no `content`, which is
 * correct for a seed -- it describes rows, not objects. But it means clicking
 * "download" in the demo returns 410, and a showcase full of broken download
 * buttons defeats the point of having them.
 *
 * So this attaches a small, genuinely valid file to each seeded row. The two
 * extensions that would mean hand-authoring a ZIP container (`.fig`, `.pptx`)
 * get a short plain-text stub instead: a valid download that opens in a text
 * editor, which is honest and still not a broken button.
 *
 * Bytes are reproducible, so nothing about this needs to be committed. Re-run
 * after a re-seed.
 *
 * Usage:
 *   npm run demo:files --workspace backend
 */

import '../src/load-env.js';
import { prisma } from '../src/db.js';

/**
 * A minimal but genuinely valid PDF.
 *
 * Written by hand because a PDF is a small text format with a cross-reference
 * table, and emitting one here is clearer than shipping a binary fixture for
 * five hundred bytes. The byte offsets in the xref table are real, which is why
 * the offsets are computed rather than typed.
 */
function minimalPdf(title: string, lines: string[]): Uint8Array<ArrayBuffer> {
  const escape = (value: string) => value.replace(/([\\()])/g, '\\$1');

  const content = [
    'BT',
    '/F1 18 Tf',
    '72 720 Td',
    `(${escape(title)}) Tj`,
    '/F1 11 Tf',
    ...lines.flatMap((line) => ['0 -22 Td', `(${escape(line)}) Tj`]),
    '0 -40 Td',
    '(Generated for the NCR Teams showcase. Real bytes, placeholder content.) Tj',
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  // Assembled as an array of chunks so the offsets are byte positions, not
  // character counts. A PDF with wrong offsets still opens in most readers, but
  // it is not a valid PDF and strict tools reject it.
  const chunks: Buffer[] = [];
  let position = 0;
  const push = (text: string) => {
    const buffer = Buffer.from(text, 'latin1');
    chunks.push(buffer);
    position += buffer.length;
  };

  push('%PDF-1.4\n');
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(position);
    push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefStart = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  );

  return Buffer.concat(chunks);
}

/** A 1x1 PNG. Real, decodable, and small enough to inline as bytes. */
function minimalPng(): Uint8Array<ArrayBuffer> {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

/** A tiny but valid JPEG: SOI, APP0/JFIF, a 1x1 luminance block, EOI. */
function minimalJpeg(): Uint8Array<ArrayBuffer> {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  );
}

function markdown(name: string): string {
  return `# ${name}

This is a real file served from the API's storage layer.

The row in the database and the bytes on disk were created separately: the seed
writes metadata, and \`npm run demo:files --workspace backend\` materialises the
content. That split is why a row can exist whose bytes are gone -- on Render's
free tier the filesystem is wiped on every deploy, and the API reports that as
**410 Gone** rather than pretending the file never existed.

- Uploads stream to storage with a size cap.
- Storage keys are server-generated, never built from a client filename.
- Downloads set \`content-disposition\` with a sanitised name.
`;
}

function textStub(name: string, kind: string): string {
  return `${name}

This is a placeholder for a ${kind} file.

A real .${kind} is a ZIP container, and hand-authoring one to ship in a repository
would be a poor trade. What matters for the demo is that the download works, the
bytes are real, and the UI is honest about what it is showing.

Everything else in the app is genuine.
`;
}

/**
 * UTF-8 bytes for a string.
 *
 * `TextEncoder` rather than `Buffer.from`, because Prisma types a `Bytes` column
 * as `Uint8Array<ArrayBuffer>` and Node's `Buffer` is declared over the wider
 * `ArrayBufferLike` -- so a `Buffer` is not assignable without a copy. The
 * encoder allocates exactly the array Prisma asked for.
 */
const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

/** Which generator to use for a given row. */
function contentFor(name: string, mimeType: string): Uint8Array<ArrayBuffer> {
  if (mimeType === 'application/pdf') {
    return minimalPdf(name.replace(/\.pdf$/i, ''), [
      'Quarterly roadmap summary.',
      '',
      'This document is generated at run time by',
      'backend/scripts/materialise-demo-files.ts.',
    ]);
  }
  if (mimeType === 'image/jpeg') return minimalJpeg();
  if (mimeType === 'image/png') return minimalPng();
  if (mimeType === 'text/markdown') return utf8(markdown(name));

  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'fig') return utf8(textStub(name, 'Figma'));
  return utf8(textStub(name, 'slides'));
}

async function main() {
  const rows = await prisma.file.findMany({
    select: { id: true, name: true, mimeType: true, sizeBytes: true, isFolder: true },
  });

  if (rows.length === 0) {
    console.log('No File rows. Run `npm run db:seed` first.');
    return;
  }

  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.isFolder) {
      skipped += 1;
      continue;
    }

    const content = contentFor(row.name, row.mimeType);

    // `sizeBytes` is written alongside the content rather than left as the
    // metadata-only value, so a row whose content is attached is self-consistent
    // with no second pass to reconcile the two.
    await prisma.file.update({
      where: { id: row.id },
      data: { content, sizeBytes: BigInt(content.length) },
    });

    written += 1;
    console.log(`  ${row.name.padEnd(24)} ${String(content.length).padStart(7)} bytes  ${row.mimeType}`);
  }

  console.log(
    `\nAttached content to ${written} file${written === 1 ? '' : 's'}` +
      (skipped > 0 ? ` (${skipped} folders have no content of their own).` : '.'),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
