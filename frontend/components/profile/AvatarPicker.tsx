'use client';

import { useId, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { ImageError, imageToAvatarDataUrl } from '@/lib/image';
import { initials } from '@/lib/format';
import { useActivePerson, useProfile } from './ProfileProvider';

/**
 * Profile photo picker.
 *
 * The file input is kept in the DOM and visually hidden rather than replaced by
 * a click handler on a div, so the control is reachable by keyboard and announced
 * as a file input by a screen reader.
 */
export function AvatarPicker() {
  const me = useActivePerson();
  const { setProfile, clearAvatar } = useProfile();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;

    setError(null);
    setBusy(true);

    try {
      setProfile({ avatarUrl: await imageToAvatarDataUrl(file) });
    } catch (caught) {
      setError(caught instanceof ImageError ? caught.message : 'That image could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="avatar-picker">
      <label
        className={`avatar-picker-drop${dragging ? ' is-dragging' : ''}`}
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleFile(event.dataTransfer.files[0]);
        }}
      >
        <span className="avatar-picker-preview">
          <Avatar initials={initials(me.name)} src={me.avatarUrl} size="lg" />
          <span className="avatar-picker-badge" aria-hidden="true">
            <ImagePlus size={13} />
          </span>
        </span>

        <span className="avatar-picker-text">
          <strong>{busy ? 'Processing…' : 'Change photo'}</strong>
          <small>
            {busy
              ? 'Resizing your image'
              : 'Drop an image here or browse. JPEG, PNG, GIF, WebP, AVIF, BMP and SVG.'}
          </small>
        </span>
      </label>

      <input
        ref={inputRef}
        id={inputId}
        className="sr-only"
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          // Clearing the value lets the same file be picked twice in a row,
          // which `onChange` alone will not fire for.
          event.target.value = '';
        }}
      />

      <div className="avatar-picker-actions">
        <button
          className="btn-secondary"
          type="button"
          disabled={!me.avatarUrl || busy}
          onClick={clearAvatar}
        >
          <Trash2 size={13} /> Remove photo
        </button>
      </div>

      {/* Announced without stealing focus. */}
      <p className="avatar-picker-status" role="status" aria-live="polite">
        {error ?? (me.avatarUrl ? 'Photo updated.' : '')}
      </p>
    </div>
  );
}
