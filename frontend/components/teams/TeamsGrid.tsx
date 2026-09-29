'use client';

import { useState } from 'react';
import { Users, Plus, Check, X } from 'lucide-react';
import type { Team } from '@/lib/data';

export function TeamsGrid({
  initialTeams,
  currentUserId,
}: {
  initialTeams: Team[];
  currentUserId: string;
}) {
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  function create(event: React.FormEvent) {
    event.preventDefault();
    const label = name.trim();
    if (!label) return;

    setTeams((current) => [
      {
        id: `local-${Date.now()}`,
        name: label,
        description: description.trim() || 'New team',
        memberIds: [currentUserId],
        memberCount: 1,
        channelCount: 1,
        mine: true,
        myRole: 'OWNER',
      },
      ...current,
    ]);

    setName('');
    setDescription('');
    setCreating(false);
  }

  function toggleJoin(teamId: string) {
    setTeams((current) =>
      current.map((team) => {
        if (team.id !== teamId) return team;
        const joined = team.memberIds.includes(currentUserId);
        return {
          ...team,
          mine: !joined,
          memberCount: team.memberCount + (joined ? -1 : 1),
          memberIds: joined
            ? team.memberIds.filter((id) => id !== currentUserId)
            : [...team.memberIds, currentUserId],
        };
      }),
    );
  }

  return (
    <div>
      <div className="cards-grid">
        {teams.map((team) => (
          <div className="team-card" key={team.id}>
            <div className="team-icon">
              <Users size={20} />
            </div>

            <h3>{team.name}</h3>
            <p>{team.description}</p>

            <div className="members-line">
              {team.mine ? (
                <span className="chip active">
                  <Check size={11} /> {team.myRole.toLowerCase()}
                </span>
              ) : (
                <button className="join" type="button" onClick={() => toggleJoin(team.id)}>
                  Join
                </button>
              )}
            </div>

            <div className="members-line" style={{ color: 'var(--muted)' }}>
              {team.memberCount} members &bull; {team.channelCount} channels
            </div>
          </div>
        ))}

        <button className="team-card add-team" type="button" onClick={() => setCreating(true)}>
          <div className="team-icon">
            <Plus size={20} />
          </div>
          <h3>Create a team</h3>
          <p>Start a new space for a group of people.</p>
        </button>
      </div>

      {creating && (
        <form className="calendar" onSubmit={create} style={{ marginTop: 16 }}>
          <div className="calendar-toolbar">
            <strong>New team</strong>
            <button className="icon-btn" type="button" onClick={() => setCreating(false)} aria-label="Cancel">
              <X size={16} />
            </button>
          </div>

          <div style={{ padding: 16 }}>
            <div className="form-field">
              <label htmlFor="team-name">Team name</label>
              <input
                id="team-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Customer Success"
                required
              />
            </div>

            <div className="form-field">
              <label htmlFor="team-description">Description</label>
              <input
                id="team-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What is this team for?"
              />
            </div>

            <button className="primary" type="submit" disabled={!name.trim()}>
              Create team
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
