// The live-data section of /credits: every source the geodata layers call, its license, and what we use it for.
export const GEO_SOURCES = [
  { name: 'Open-Meteo forecast', url: 'https://open-meteo.com/', license: 'CC BY 4.0', use: 'Hourly cloud cover by layer, visibility, rain chance, wind, temperature and humidity; the sunrise and sunset colour chance' },
  { name: 'Open-Meteo air quality (CAMS, Copernicus)', url: 'https://open-meteo.com/en/docs/air-quality-api', license: 'CC BY 4.0; contains modified Copernicus Atmosphere Monitoring Service information', use: 'PM2.5 and aerosol optical depth for the haze reading' },
  { name: 'National Weather Service API', url: 'https://www.weather.gov/documentation/services-web-api', license: 'US government work, public domain', use: 'Active watches, warnings and advisories with their areas' },
  { name: 'USGS earthquake catalog', url: 'https://earthquake.usgs.gov/fdsnws/event/1/', license: 'US government work, public domain', use: 'Earthquakes within 300 km in the last 30 days' },
  { name: 'NOAA CO-OPS tide predictions', url: 'https://tidesandcurrents.noaa.gov/', license: 'US government work, public domain', use: 'High and low tides and hourly heights at the nearest station' },
  { name: "NYC film permits (Mayor's Office of Media and Entertainment)", url: 'https://data.cityofnewyork.us/d/tg4x-b46p', license: 'NYC Open Data terms of use', use: 'Blocks held for film shoots' },
  { name: 'NYC permitted events (Street Activity Permit Office)', url: 'https://data.cityofnewyork.us/d/tvpp-9vvx', license: 'NYC Open Data terms of use', use: 'Parades, street events and production load-ins in the next week' },
  { name: 'NYC DOT street closures for construction', url: 'https://data.cityofnewyork.us/d/i6b5-j7bu', license: 'NYC Open Data terms of use', use: 'Closed blocks and intersections' },
  { name: 'NYC DOB NOW approved permits', url: 'https://data.cityofnewyork.us/d/rbx6-tga4', license: 'NYC Open Data terms of use', use: 'Sidewalk sheds, scaffolds and construction fences' },
  { name: 'NYC building footprints and centreline (DoITT)', url: 'https://data.cityofnewyork.us/d/5zhs-2jue', license: 'NYC Open Data terms of use', use: 'Roof heights for building shadows; street centrelines to map permits' },
  { name: 'OpenStreetMap via the Overpass API', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0, © OpenStreetMap contributors', use: 'Building footprints and heights outside NYC, viewpoints, transit stops, parking, restrooms, cafes, streets' },
  { name: 'OpenFreeMap vector tiles (dark style)', url: 'https://openfreemap.org/', license: '© OpenMapTiles, data from OpenStreetMap (ODbL)', use: 'The 2D map' },
  { name: 'MapLibre GL JS', url: 'https://maplibre.org/', license: 'BSD 3-Clause', use: 'Draws the 2D map' },
  { name: 'suncalc', url: 'https://github.com/mourner/suncalc', license: 'BSD 2-Clause', use: 'Sun and moon positions, moonrise, moonset and phase' },
  { name: 'Geotagged Wikimedia Commons photos', url: '#spot-photos', license: 'Each photo under its own license, listed above', use: 'Where photographers stand and which way they face' },
];

const safe = (u: string) => (/^(https:\/\/|#)/.test(u) ? u : undefined);

export default function GeoCredits() {
  return (
    <section className="sheet" id="geodata">
      <h2>Live data layers</h2>
      <p>The conditions, the danger and disruption zones, the building shadows and the 2D map come from these open sources. Tessera caches each response (weather 15 minutes, alerts 5 minutes, permits and map data 24 hours) and never derives any of them from Google's tiles.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Source</th><th scope="col">License</th><th scope="col">Used for</th></tr></thead>
          <tbody>
            {GEO_SOURCES.map(s => (
              <tr key={s.name}>
                <td>{safe(s.url) ? <a href={safe(s.url)} target={s.url.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{s.name}</a> : s.name}</td>
                <td>{s.license}</td>
                <td className="muted">{s.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
