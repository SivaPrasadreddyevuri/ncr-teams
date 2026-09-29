'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Folder,
  Star,
  Trash2,
  Search,
  Upload,
  ChevronRight,
  Download,
} from 'lucide-react';
import { StorageMeter } from '@/components/files/StorageMeter';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { fileKind, iconForKind, kindForUpload } from '@/lib/fileTypes';
import { deleteBlob, getBlob, putBlob, StorageError } from '@/lib/idb';
import { formatBytes, relativeTime } from '@/lib/format';
import type { FileRow } from '@/lib/data';

export function FilesTable() {
  // Read from the store so an upload survives navigation and a reload. This was
  // a local useState seeded from a prop, which made uploads vanish immediately.
  const { files, addFiles, removeFile, toggleFileStar, activeUser } = useWorkspace();

  const [term, setTerm] = useState('');
  const [team, setTeam] = useState('All');
  const [starredOnly, setStarredOnly] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const teams = useMemo(
    () => ['All', ...Array.from(new Set(files.map((row) => row.team)))],
    [files],
  );

  const visible = useMemo(() => {
    const query = term.trim().toLowerCase();
    return files.filter((row) => {
      if (team !== 'All' && row.team !== team) return false;
      if (starredOnly && !row.starred) return false;
      if (query && !row.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [files, team, term, starredOnly]);

  const uploaded = useMemo(() => files.filter((row) => row.uploaded), [files]);
  const uploadedBytes = useMemo(
    () => uploaded.reduce((total, row) => total + row.size, 0),
    [uploaded],
  );

  async function accept(list: FileList | File[]) {
    const picked = Array.from(list);
    if (picked.length === 0) return;

    setError(null);
    setNotice(null);
    setBusy(true);

    const stored: FileRow[] = [];
    const failures: string[] = [];

    for (const file of picked) {
      // A file with no name is what a directory drop produces; nothing to store.
      if (!file.name || file.size === 0) {
        failures.push(`${file.name || 'A file'} was empty and was skipped.`);
        continue;
      }

      const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      try {
        await putBlob(id, file);
        stored.push({
          id,
          name: file.name,
          size: file.size,
          createdAt: new Date().toISOString(),
          // Filed under the uploader's own department so the team filter has
          // something meaningful to group by.
          team: activeUser.department ?? 'General',
          type: kindForUpload(file),
          uploaded: true,
        });
      } catch (caught) {
        failures.push(
          caught instanceof StorageError
            ? caught.message
            : `${file.name} could not be stored.`,
        );
      }
    }

    if (stored.length > 0) {
      addFiles(stored);
      setNotice(
        `Uploaded ${stored.length} file${stored.length === 1 ? '' : 's'} to this browser.`,
      );
    }
    if (failures.length > 0) setError(failures.join(' '));

    setBusy(false);
  }

  async function open(row: FileRow) {
    setError(null);

    // The seeded fixtures are display rows with no bytes behind them. Saying so
    // is better than a click that silently does nothing.
    if (!row.uploaded) {
      setError(`${row.name} is a demo row, so there is no file behind it to open.`);
      return;
    }

    try {
      const blob = await getBlob(row.id);
      if (!blob) {
        setError(`${row.name} is listed but its contents are no longer in this browser.`);
        return;
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = row.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoked on the next tick: revoking synchronously can cancel the
      // download in some browsers before it has read the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(`${row.name} could not be read back from this browser.`);
    }
  }

  function remove(id: string) {
    // Best effort: the row disappears from the list either way, but leaving an
    // orphan blob behind would quietly consume the quota.
    void deleteBlob(id).catch(() => {});
    removeFile(id);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length > 0) void accept(event.dataTransfer.files);
      }}
      className={dragging ? 'files-zone is-dragging' : 'files-zone'}
    >
      <div className="files-toolbar" style={{ borderRadius: '16px 16px 0 0', background: '#fff', border: '1px solid var(--line)', borderBottom: 0, padding: '14px 16px' }}>
        <label className="files-search">
          <Search size={15} />
          <input
            placeholder="Search files"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            aria-label="Search files"
          />
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <select
            className="table-input files-filter"
            value={team}
            onChange={(event) => setTeam(event.target.value)}
            aria-label="Filter by team"
          >
            {teams.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <button
            className="btn-secondary"
            type="button"
            onClick={() => setStarredOnly((c) => !c)}
            aria-pressed={starredOnly}
          >
            <Star size={14} /> Starred
          </button>

          <button
            className="join"
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={14} /> {busy ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>

      {/* No `accept`: the point of a shared drive is that any file type can live
          there. Nothing needs decoding to store a blob, so type is not a limit --
          only the browser's quota is. */}
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        multiple
        disabled={busy}
        onChange={(event) => {
          if (event.target.files) void accept(event.target.files);
          // Clearing lets the same file be picked again in a row, which
          // `onchange` alone will not fire for.
          event.target.value = '';
        }}
      />

      <div className="table-wrap files-table-wrap" style={{ borderRadius: '0 0 16px 16px' }}>
        <table className="file-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Team</th>
              <th>Size</th>
              <th>Updated</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="empty-state">
                    <span className="empty-icon">
                      <Folder size={22} />
                    </span>
                    <p>No files found</p>
                    <span className="empty-meta">Try a different search or team</span>
                  </div>
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const Icon = iconForKind(fileKind(row));
                return (
                  <tr key={row.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="file-icon">
                          <Icon size={15} />
                        </span>
                        {row.folder ? (
                          <button
                            className="file-link"
                            type="button"
                            onClick={() => setBreadcrumb((c) => [...c, row.name])}
                          >
                            {row.name}
                          </button>
                        ) : (
                          <button
                            className="file-link"
                            type="button"
                            onClick={() => void open(row)}
                            title={
                              row.uploaded
                                ? 'Download this file'
                                : 'Demo row — no file contents stored'
                            }
                          >
                            {row.name}
                          </button>
                        )}
                        {row.uploaded && <span className="chip tiny">yours</span>}
                      </div>
                    </td>
                    <td>{row.team}</td>
                    <td>{row.folder ? '—' : formatBytes(row.size)}</td>
                    <td>{relativeTime(row.createdAt)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {!row.folder && (
                          <button
                            className="icon-btn"
                            type="button"
                            onClick={() => void open(row)}
                            aria-label={`Download ${row.name}`}
                            title={row.uploaded ? 'Download' : 'Demo row — nothing to download'}
                          >
                            <Download size={15} />
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          type="button"
                          onClick={() => toggleFileStar(row.id)}
                          aria-label={row.starred ? `Unstar ${row.name}` : `Star ${row.name}`}
                          aria-pressed={Boolean(row.starred)}
                          style={row.starred ? { color: '#f0a20b' } : undefined}
                        >
                          <Star size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          type="button"
                          onClick={() => remove(row.id)}
                          aria-label={`Delete ${row.name}`}
                          title="Remove"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/*
        Phone layout. The table has a deliberate 560px floor so its columns stay
        readable, which means a 375px screen has to pan sideways. This is the
        same data as stacked cards with labelled fields, so nothing scrolls
        horizontally. The table above is hidden at this width by CSS.
      */}
      <ul className="file-cards">
        {visible.length === 0 ? (
          <li className="file-card">
            <div className="empty-state">
              <span className="empty-icon">
                <Folder size={22} />
              </span>
              <p>No files found</p>
              <span className="empty-meta">Try a different search or team</span>
            </div>
          </li>
        ) : (
          visible.map((row) => {
            const Icon = iconForKind(fileKind(row));
            return (
              <li className="file-card" key={row.id}>
                <div className="file-card-head">
                  <span className="file-icon">
                    <Icon size={15} />
                  </span>
                  {row.folder ? (
                    <button
                      className="file-link"
                      type="button"
                      onClick={() => setBreadcrumb((c) => [...c, row.name])}
                    >
                      {row.name}
                    </button>
                  ) : (
                    <button
                      className="file-link"
                      type="button"
                      onClick={() => void open(row)}
                      title={row.uploaded ? 'Download' : 'Demo row — nothing to download'}
                    >
                      {row.name}
                    </button>
                  )}

                  <div className="file-card-actions">
                    {!row.folder && (
                      <button
                        className="icon-btn"
                        type="button"
                        onClick={() => void open(row)}
                        aria-label={`Download ${row.name}`}
                      >
                        <Download size={15} />
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      type="button"
                      onClick={() => toggleFileStar(row.id)}
                      aria-label={row.starred ? `Unstar ${row.name}` : `Star ${row.name}`}
                      aria-pressed={Boolean(row.starred)}
                      style={row.starred ? { color: '#f0a20b' } : undefined}
                    >
                      <Star size={15} />
                    </button>
                    <button
                      className="icon-btn"
                      type="button"
                      onClick={() => remove(row.id)}
                      aria-label={`Delete ${row.name}`}
                      title="Remove"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <dl className="file-card-meta">
                  <div>
                    <dt>Team</dt>
                    <dd>{row.team}</dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{row.folder ? '—' : formatBytes(row.size)}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{relativeTime(row.createdAt)}</dd>
                  </div>
                </dl>
              </li>
            );
          })
        )}
      </ul>

      {breadcrumb.length > 0 && (
        <div className="calendar-legend" style={{ borderTop: 0 }}>
          <span>Viewing:</span>
          <button className="file-link" type="button" onClick={() => setBreadcrumb([])}>
            Files
          </button>
          {breadcrumb.map((crumb, index) => (
            <span key={`${crumb}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <ChevronRight size={12} />
              <button
                className="file-link"
                type="button"
                onClick={() => setBreadcrumb((c) => c.slice(0, index + 1))}
              >
                {crumb}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="files-feedback" role="status" aria-live="polite">
        {error && <span className="files-error">{error}</span>}
        {notice && !error && <span className="files-notice">{notice}</span>}
      </div>

      <StorageMeter uploadedBytes={uploadedBytes} uploadedCount={uploaded.length} />
    </div>
  );
}
