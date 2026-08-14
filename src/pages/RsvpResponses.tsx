import { useEffect, useState } from 'react';
import { listRsvps, type RsvpRow } from '../net';

const comingLabel: Record<string, string> = { yes: 'Yes', no: 'No', maybe: 'Maybe' };
const durationLabel: Record<string, string> = { whole: 'Whole time', parts: 'Part', '': '—' };
const groupLabel: Record<string, string> = { know: 'Knows people', meet: 'Meet new', dontcare: "Don't care", '': '—' };

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

  const yes = rows?.filter((r) => r.coming === 'yes') ?? [];
  const maybe = rows?.filter((r) => r.coming === 'maybe') ?? [];
  const no = rows?.filter((r) => r.coming === 'no') ?? [];
  // Headcount = each "yes" guest + their plus-ones.
  const headcount = yes.reduce((n, r) => n + 1 + (r.plus_ones || 0), 0);
  const drinkers = yes.filter((r) => r.drinking).length;

  return (
    <div className="responses">
      <div className="responses-head">
        <h2>RSVP responses</h2>
        <button className="site-btn" onClick={load}>
          ↻ Refresh
        </button>
      </div>

      {err && <p className="site-error">Couldn't load: {err}</p>}
      {!rows && !err && <p className="hint">Loading…</p>}

      {rows && (
        <>
          <div className="responses-tiles">
            <div className="tile">
              <div className="tile-n">{yes.length}</div>
              <div className="tile-l">Yes</div>
            </div>
            <div className="tile">
              <div className="tile-n">{maybe.length}</div>
              <div className="tile-l">Maybe</div>
            </div>
            <div className="tile">
              <div className="tile-n">{no.length}</div>
              <div className="tile-l">No</div>
            </div>
            <div className="tile tile--accent">
              <div className="tile-n">{headcount}</div>
              <div className="tile-l">Headcount (yes + guests)</div>
            </div>
            <div className="tile">
              <div className="tile-n">{drinkers}</div>
              <div className="tile-l">Drinking</div>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="hint">No responses yet.</p>
          ) : (
            <div className="responses-tablewrap">
              <table className="responses-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Coming</th>
                    <th>+</th>
                    <th>Drinking</th>
                    <th>Duration</th>
                    <th>Group</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.coming === 'no' ? 'row--dim' : ''}>
                      <td>{r.name}</td>
                      <td>{comingLabel[r.coming] ?? r.coming}</td>
                      <td>{r.plus_ones || ''}</td>
                      <td>{r.coming !== 'no' ? (r.drinking ? '🍺' : '—') : ''}</td>
                      <td>{r.coming !== 'no' ? durationLabel[r.duration] : ''}</td>
                      <td>{r.coming !== 'no' ? groupLabel[r.group_pref] : ''}</td>
                      <td className="note-cell">{r.note}</td>
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
