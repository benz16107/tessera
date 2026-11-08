// Every Commons photo used in a spot model, read from spots/*/CREDITS.tsv at build time.
import GeoCredits from './layers/Credits.tsx';
const files = import.meta.glob('../../spots/*/CREDITS.tsv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

interface Row { spot: string; file: string; role: string; title: string; author: string; license: string; page: string }

const rows: Row[] = Object.entries(files).flatMap(([path, text]) => {
  const spot = path.split('/').at(-2) ?? '';
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0]?.split('\t') ?? [];
  const col = (name: string) => head.indexOf(name);
  return lines.slice(1).map(l => {
    const c = l.split('\t');
    const get = (n: string) => (col(n) >= 0 ? c[col(n)] ?? '' : '');
    return { spot, file: get('file'), role: get('role'), title: get('title').replace(/^File:/, ''), author: get('author'), license: get('license'), page: get('page') };
  });
});

const safeUrl = (u: string) => (/^https:\/\//.test(u) ? u : undefined);

export default function Credits() {
  const spots = [...new Set(rows.map(r => r.spot))];
  const authors = new Set(rows.map(r => r.author)).size;
  return (
    <div className="credits">
      <header className="home-head"><a className="wordmark" href="/">Tessera</a></header>
      <main>
        <h1>Credits and licenses</h1>
        <section className="sheet">
          <h2>Map data</h2>
          <p>The 3D view uses Google Photorealistic 3D Tiles through the Map Tiles API. Google's logo and the data providers for the tiles in view are shown on the map at all times. Tessera only displays the tiles. It does not analyse them: the solver places photos against open structure-from-motion models built from the photos below.</p>
          <p>Street View panoramas come from Google Street View through the Map Tiles API. Each panorama is credited to its owner in the view, with Google's logo and the capture date. They are shown only, never rendered or sent to a model.</p>
          <p>The Top of the Rock example photo: <a href="https://commons.wikimedia.org/wiki/File:NYC_Empire_State_Building.jpg">NYC Empire State Building</a> by Daniel Schwen, CC BY-SA 4.0.</p>
          <h2>AI interpretation</h2>
          <p>Previews are generated edits of the photo you uploaded, made by an image model from your lens, people and light settings. Every preview carries the label "AI interpretation". They show an idea of the shot, not a real photograph of the place.</p>
        </section>
        <GeoCredits />
        <section className="sheet" id="spot-photos">
          <h2>Spot model photos</h2>
          {rows.length === 0 ? (
            <p className="muted">No spot credits were bundled with this build yet.</p>
          ) : (
            <>
              <p>{rows.length} photos from {authors} authors on Wikimedia Commons, across {spots.length} {spots.length === 1 ? 'spot' : 'spots'}. Each is used under the license named, with no endorsement implied.</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th scope="col">Spot</th><th scope="col">Photo</th><th scope="col">Author</th><th scope="col">License</th><th scope="col">Use</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="mono">{r.spot}</td>
                        <td>{safeUrl(r.page) ? <a href={safeUrl(r.page)} target="_blank" rel="noreferrer">{r.title || r.file}</a> : r.title || r.file}</td>
                        <td>{r.author}</td>
                        <td className="nowrap">{r.license}</td>
                        <td className="muted">{r.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
