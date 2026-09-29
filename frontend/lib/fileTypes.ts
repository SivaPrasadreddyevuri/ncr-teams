import {
  Archive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Presentation,
  type LucideIcon,
} from 'lucide-react';

/**
 * File kind detection.
 *
 * Unlike images, an uploaded file needs no decoding, so *type* is not a limit
 * here -- any extension the browser reports can be stored and handed back byte
 * for byte. Only the size of the quota matters. The buckets below exist purely
 * to pick an icon and a label.
 */
export type FileKind =
  | 'folder'
  | 'image'
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'code'
  | 'archive'
  | 'audio'
  | 'video'
  | 'design'
  | 'file';

const EXTENSION_KIND: Record<string, FileKind> = {
  // images
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  avif: 'image', bmp: 'image', svg: 'image', ico: 'image', tiff: 'image', tif: 'image',
  // documents
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc', md: 'doc', pages: 'doc',
  // spreadsheets
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ods: 'sheet', tsv: 'sheet', numbers: 'sheet',
  // presentations
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  // source
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', json: 'code', yaml: 'code', yml: 'code',
  toml: 'code', html: 'code', htm: 'code', css: 'code', scss: 'code', py: 'code', rb: 'code',
  go: 'code', rs: 'code', java: 'code', kt: 'code', swift: 'code', php: 'code', sql: 'code',
  sh: 'code', ps1: 'code', xml: 'code', lock: 'code', gradle: 'code', prisma: 'code',
  // design
  fig: 'design', sketch: 'design', xd: 'design', psd: 'design', ai: 'design',
  // archives
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', rar: 'archive',
  '7z': 'archive', bz2: 'archive', xz: 'archive',
  // media
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video', m4v: 'video',
};

/** MIME types worth trusting when the extension is missing or unhelpful. */
const MIME_KIND: Array<[RegExp, FileKind]> = [
  [/^image\//i, 'image'],
  [/^audio\//i, 'audio'],
  [/^video\//i, 'video'],
  [/pdf$/i, 'pdf'],
  [/zip|compressed|tar|rar|7z/i, 'archive'],
  [/word|document|opendocument\.text/i, 'doc'],
  [/sheet|excel|csv/i, 'sheet'],
  [/presentation|powerpoint/i, 'slides'],
  [/javascript|typescript|json|xml/i, 'code'],
];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  // A leading dot means a dotfile, not an extension.
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

const ICONS: Record<FileKind, LucideIcon> = {
  folder: Folder,
  image: FileImage,
  pdf: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  code: FileCode2,
  archive: Archive,
  audio: FileAudio,
  video: FileVideo,
  design: FileImage,
  file: FileText,
};

// Only the six tones the stylesheet actually defines, rather than inventing
// names that would render as unstyled spans.
const TONES: Record<FileKind, string> = {
  folder: 'tone-blue',
  image: 'tone-purple',
  pdf: 'tone-red',
  doc: 'tone-blue',
  sheet: 'tone-green',
  slides: 'tone-orange',
  code: 'tone-purple',
  archive: 'tone-orange',
  audio: 'tone-pink',
  video: 'tone-pink',
  design: 'tone-purple',
  file: 'tone-blue',
};

const KIND_NAMES = new Set<string>(Object.keys(ICONS));

/**
 * The kind to display for a row.
 *
 * Both the seeded fixtures and newly uploaded rows store a kind in `type`, so
 * that is trusted first. The name's extension is the fallback for a row whose
 * type is missing or unrecognised.
 */
export function fileKind(row: { name: string; type?: string; folder?: boolean }): FileKind {
  if (row.folder || row.type === 'folder') return 'folder';
  if (row.type && KIND_NAMES.has(row.type)) return row.type as FileKind;
  return EXTENSION_KIND[extensionOf(row.name)] ?? 'file';
}

/**
 * The kind to store for a freshly picked file.
 *
 * The extension wins over the MIME type because browsers report inconsistent
 * types -- an `.md` file arrives as `text/markdown` on some systems and
 * `application/octet-stream` on others, and a `.csv` as `application/vnd.ms-excel`
 * often enough that trusting the MIME type would file a spreadsheet as a
 * document.
 */
export function kindForUpload(file: { name: string; type: string }): FileKind {
  const byExtension = EXTENSION_KIND[extensionOf(file.name)];
  if (byExtension) return byExtension;

  for (const [pattern, kind] of MIME_KIND) {
    if (file.type && pattern.test(file.type)) return kind;
  }

  return 'file';
}

export function iconForKind(kind: FileKind): LucideIcon {
  return ICONS[kind] ?? FileText;
}

export function toneForKind(kind: FileKind): string {
  return TONES[kind] ?? TONES.file;
}
