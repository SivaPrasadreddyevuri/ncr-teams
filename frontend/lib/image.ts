/**
 * Client-side image handling for the profile photo.
 *
 * The avatar renders at 44px at its largest, so keeping the original file would
 * be wasteful twice over: `localStorage` caps out around 5MB, which a single
 * modern phone photo exceeds, and the extra bytes buy no visible detail. Every
 * upload is therefore re-encoded to a 256px WebP data URL, which lands around
 * 15KB.
 */

/** Longest edge, in pixels, of the stored avatar. */
const MAX_EDGE = 256;

/** Quality passed to `toDataURL`. 0.85 is visually lossless at this size. */
const QUALITY = 0.85;

/**
 * Rejects absurd input before it is decoded. A phone photo is 3-8MB; a
 * decompression bomb or a raw scan can be far larger, and decoding happens on
 * the main thread.
 */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Upper bound on decoded pixels. A 50MP image decodes to roughly 200MB of
 * bitmap, which can lock up the tab, so this is checked once the real
 * dimensions are known rather than trusting the byte count alone.
 */
const MAX_PIXELS = 40_000_000;

const HEIC_HINT =
  'That image format cannot be read by this browser. Most phones save photos as HEIC, ' +
  'which Chrome and Windows cannot display -- export it as JPEG or PNG and try again.';

export class ImageError extends Error {}

function fail(reason: string): never {
  throw new ImageError(reason);
}

/** A decoded image plus the size it will be drawn at, and how to release it. */
type Decoded = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

/**
 * Decodes via `createImageBitmap` where possible, falling back to an `Image`
 * element for sources the bitmap decoder rejects.
 *
 * The fallback earns its keep on SVG, which `createImageBitmap` handles
 * inconsistently between browsers, and it is the safety net that turns an
 * undecodable file into a clear message rather than a blank avatar.
 */
async function decode(file: File): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  } catch {
    // Fall through to the <img> path below.
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new ImageError(HEIC_HINT));
      element.src = url;
    });

    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => {},
    };
  } finally {
    // The decoded image holds its own copy of the pixels once `onload` has
    // fired, so releasing the object URL here does not break the draw below.
    URL.revokeObjectURL(url);
  }
}

/**
 * Turns a picked file into a small WebP data URL.
 *
 * Accepts anything the browser can decode: JPEG, PNG, GIF, WebP, AVIF, BMP,
 * SVG and ICO. It cannot accept HEIC/HEIF or TIFF -- no browser decodes those,
 * and shipping a decoder would cost more than the feature is worth -- so those
 * get an explicit error rather than a silent failure.
 */
export async function imageToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    fail('That file is not an image. Pick a photo from your device.');
  }

  if (file.size > MAX_BYTES) {
    fail('That image is larger than 20MB. Try a smaller photo.');
  }

  const { source, width: sourceWidth, height: sourceHeight, dispose } = await decode(file);

  if (!sourceWidth || !sourceHeight) {
    fail('That image has no readable dimensions.');
  }

  if (sourceWidth * sourceHeight > MAX_PIXELS) {
    fail('That image is too large to process. Try a smaller photo.');
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) fail('This browser blocked image processing.');

  try {
    context.drawImage(source, 0, 0, width, height);
  } finally {
    dispose();
  }

  // `toDataURL` silently falls back to PNG where WebP is unsupported, which is
  // an acceptable outcome: both are valid image data URLs.
  return canvas.toDataURL('image/webp', QUALITY);
}
