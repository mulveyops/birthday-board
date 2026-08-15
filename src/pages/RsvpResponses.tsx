import { useEffect, useState } from 'react';
import { listRsvps, deleteRsvp, type RsvpRow } from '../net';

const comingLabel: Record<string, string> = { yes: 'Yes', no: 'No', maybe: 'Maybe' };
const durationLabel: Record<string, string> = { whole: 'Whole game', mid: 'Midgame', post: 'Post-game', '': '—' };
const groupLabel: Record<string, string> = { know: 'Knows people', meet: 'Meet new', dontcare: "Don't care", '': '—' };

const guestNames = (r: RsvpRow) => (r.guests ?? []).map((g) => `${g.first} ${g.last}`.trim()).filter(Boolean);

/** One person in the table — a host, or a +1 that carries over the host's answers. */
interface Person {
  key: string;
  name: string;
  coming: string;
  duration: string;
  group_pref: string;
  note: string;
  hostName: string | null; // set on a +1 row
  row: RsvpRow | null; // set on a host row (enables delete)
}

export default function RsvpResponses() {
  const [rows, setRows] = useState<RsvpRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      setRows(await listRsvps());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function del(r: RsvpRow) {
    const extra = guestNames(r).length;
    if (!confirm(`Delete ${r.name}'s RSVP${extra ? ` and their ${extra} +1${extra > 1 ? 's' : ''}` : ''}? This can't be undone.`)) return;
    try {
      await deleteRsvp(r.id);
      setRows((rs) => (rs ? rs.filter((x) => x.id !== r.id) : rs));
    } catch (e) {
      alert('Delete failed: ' + (e as Error).message);
    }
  }

  // Each submission becomes the host row + one row per +1 (guests inherit the host's answers).
  const people: Person[] = (rows ?? []).flatMap((r) => {
    const host: Person = {
      key: r.id,
      name: r.name,
      coming: r.coming,
      duration: r.duration,
      group_pref: r.group_pref,
      note: r.note,
      hostName: null,
      row: r,
    };
    const guests: Person[] = guestNames(r).map((gn, i) => ({
      key: `${r.id}-g${i}`,
      name: gn,
      coming: r.coming,
      duration: r.duration,
      group_pref: r.group_pref,
      note: '',
      hostName: r.name,
      row: null,
    }));
    return [host, ...guests];
  });
  const yes = people.filter((p) => p.coming === 'yes').length;
  const maybe = people.filter((p) => p.coming === 'maybe').length;
  const no = people.filter((p) => p.coming === 'no').length;

  return (
    <div className="responses">
      <div className="responses-head">
        <h2>RSVP responses</h2>
        <button className="site-btn" onClick={load}>
          Refresh
        </button>
      </div>

      {err && <p className="site-error">Couldn't load: {err}</p>}
      {!rows && !err && <p className="hint">Loading…</p>}

      {rows && (
        <>
          <div className="responses-tiles">
            <div className="tile tile--accent">
              <div className="tile-n">{yes}</div>
              <div className="tile-l">Yes (people)</div>
            </div>
            <div className="tile">
              <div className="tile-n">{maybe}</div>
              <div className="tile-l">Maybe</div>
            </div>
            <div className="tile">
              <div className="tile-n">{no}</div>
              <div className="tile-l">No</div>
            </div>
          </div>

          {people.length === 0 ? (
            <p className="hint">No responses yet.</p>
          ) : (
            <div className="responses-tablewrap">
              <table className="responses-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Coming</th>
                    <th>Timing</th>
                    <th>Group</th>
                    <th>Note</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.key} className={p.coming === 'no' ? 'row--dim' : ''}>
                      <td>{p.hostName ? <span className="guest-name">↳ {p.name}</span> : p.name}</td>
                      <td>{comingLabel[p.coming] ?? p.coming}</td>
                      <td>{p.coming !== 'no' ? durationLabel[p.duration] : ''}</td>
                      <td>{p.coming !== 'no' ? groupLabel[p.group_pref] : ''}</td>
                      <td className="note-cell">
                        {p.hostName ? <span className="guest-of">+1 of {p.hostName}</span> : p.note}
                      </td>
                      <td>
                        {p.row ? (
                          <button className="del-btn" onClick={() => del(p.row!)} title="Delete this RSVP (and its +1s)">
                            Delete
                          </button>
                        ) : (
                          ''
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
