'use client';

import { useMemo, useState } from 'react';
import {
  Folder,
  FileText,
  Image,
  Presentation,
  FileCode2,
  Star,
  Trash2,
  Search,
  Upload,
  ChevronRight,
  HardDrive,
} from 'lucide-react';
import { formatBytes, relativeTime } from '@/lib/format';
import { STORAGE_QUOTA_BYTES, type FileRow } from '@/lib/data';

type IconComponent = typeof Folder;

function iconFor(type: string): IconComponent {
  if (type === 'folder') return Folder;
  if (type === 'image') return Image;
  if (type === 'slides') return Presentation;
  if (type === 'doc') return FileCode2;
  return FileText;
}

export function FilesTable({ initialFiles }: { initialFiles: FileRow[] }) {
  const [rows, setRows] = useState<FileRow[]>(initialFiles);
  const [term, setTerm] = useState('');
  const [team, setTeam] = useState('All');
  const [starredOnly, setStarredOnly] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);

  const teams = useMemo(
    () => ['All', ...Array.from(new Set(rows.map((row) => row.team)))],
    [rows],
  );

  const visible = useMemo(() => {
    const query = term.trim().toLowerCase();
    return rows.filter((row) => {
      if (team !== 'All' && row.team !== team) return false;
      if (starredOnly && !row.starred) return false;
      if (query && !row.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [rows, team, term, starredOnly]);

  const used = rows.filter((row) => !row.folder).reduce((total, row) => total + row.size, 0);

  function remove(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function toggleStar(id: string) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, starred: !row.starred } : row)),
    );
  }

  return (
    <div>
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
            className="table-input"
            value={team}
            onChange={(event) => setTeam(event.target.value)}
            aria-label="Filter by team"
            style={{ width: 170, height: 38 }}
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

          <button className="join" type="button" disabled title="Uploads need a backend">
            <Upload size={14} /> Upload
          </button>
        </div>
      </div>

      <div className="table-wrap" style={{ borderRadius: '0 0 16px 16px' }}>
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
                const Icon = iconFor(row.type);
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
                          <span className="file-link">{row.name}</span>
                        )}
                      </div>
                    </td>
                    <td>{row.team}</td>
                    <td>{row.folder ? '\u2014' : formatBytes(row.size)}</td>
                    <td>{relativeTime(row.createdAt)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          className="icon-btn"
                          type="button"
                          onClick={() => toggleStar(row.id)}
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
                          title="Remove from this demo"
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

      <div className="storage-meter">
        <div className="profile-facts" style={{ marginBottom: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <HardDrive size={14} /> Storage used
          </span>
          <strong>
            {formatBytes(used)} of {formatBytes(STORAGE_QUOTA_BYTES)}
          </strong>
        </div>
        <div className="storage-track">
          <i style={{ width: `${Math.min(100, (used / STORAGE_QUOTA_BYTES) * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}
