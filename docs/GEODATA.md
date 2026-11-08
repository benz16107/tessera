# Live geodata layers

ShotMatch pulls live open data about the spot and the shot time: weather, haze, danger and disruption zones, tides,
real building shadows, useful places and where photographers stand. It shows them in the 3D set, on a 2D map and on the
timeline, and hands them to the AI as one paragraph. Everything works for any lat/lon in the US. NYC spots also get
permits, closures, scaffolding and the city's own building heights.

Code: `crew/src/layers/` (server), `web/src/layers/` (3D, map, panel, timeline strip), tests in `crew/test/layers.test.ts`.

## The API

`GET /api/layers?session=<id>` (or `?spot=<id>`, or `?lat=&lon=`), with optional `&layers=weather,tides` and
`&at=<ISO time>`. A session defaults to the set's shared clock (`session.planTime`). The response:

```json
{ "place": { "id", "name", "lat", "lon", "radiusM", "zone" }, "at", "nyc": true,
  "layers": { "<layer>": { "type": "FeatureCollection", "features": [] } },
  "summary": { "<layer>": {} }, "sources": [{ "layer", "name", "url", "license", "fetchedAt", "stale", "error" }],
  "errors": { "<layer>": "still loading; ask again in a minute" }, "conditions": { "text": "..." }, "ms": 348 }
```

Features are GeoJSON in WGS84 `[lon, lat]`. Their properties hold `layer`, `kind`, `label`, `detail`, and where they apply
`start`, `end`, `active`, `severity`, `height_m`, `heading`, `m` (metres from the mark) and `url`. A source that takes
longer than 14 s answers "still loading" while its fetch carries on and fills the cache, so one slow server never holds up
the rest. A failed refresh serves the last good copy with `stale: true`.

`GET /api/layers/conditions?session=<id>[&at=]` returns the conditions summary alone. In the crew:
`import { conditions } from './layers/index.ts'; await conditions({ sessionId, at })`. A real answer for DUMBO:

> Sunday Nov 8, 4:20 PM: 2% mid cloud; sunset 4:46 PM: fair colour chance (37; 11% mid and high cloud to catch the
> light, no low cloud in the way); high tide 7:54 PM (4.5 ft), then low 1:49 AM; sidewalk shed and supported scaffold at
> 30 Washington Street, 41 m away (DOB permit until Apr 1); ...; the middle of the street at the mark is in shadow until
> 11:00 AM, then sunlit; in building shadow from 12:00 PM to sunset; wind 10 mph gusting 18, 58°F; clear air (PM2.5 6).

## Layers

| Layer | Source | License | Refresh | Why a photographer cares |
|---|---|---|---|---|
| weather | Open-Meteo hourly forecast (no key) | CC BY 4.0 | 15 min | Cloud by layer decides sunset colour and how soft the light is. Visibility and humidity decide how far you can see. Wind decides hair, flags and long exposures. |
| weather (haze) | Open-Meteo air quality, CAMS model | CC BY 4.0, Copernicus | 15 min | PM2.5 and aerosol optical depth tell you whether the far skyline will be crisp or washed out on a long lens. |
| alerts | National Weather Service, `api.weather.gov/alerts/active?point=` | Public domain | 5 min | Wind, flood, heat and storm warnings with their areas. Zone-based alerts get their zone outlines. |
| quakes | USGS earthquake catalog, 300 km, 30 days, M1.5+ | Public domain | 15 min | Context and the rare real hazard. Drawn on the 2D map only. |
| film (NYC) | Film permits (Mayor's Office of Media and Entertainment) and permitted events (Street Activity Permit Office) | NYC Open Data | 24 h | A film crew or a parade holding the block takes it out of your shot. Blocks are mapped by matching "X between A and B" to the city's street centrelines. |
| closures (NYC) | DOT street closures for construction, by block and by intersection | NYC Open Data | 24 h | A closed street means barriers, plates and trucks in frame. |
| construction (NYC) | DOB NOW approved permits: sidewalk sheds, scaffolds, construction fences | NYC Open Data | 24 h | Scaffolding is the most common thing that ruins a facade shot. Drawn on the permit's building, matched by BIN. |
| tides | NOAA CO-OPS predictions, nearest station within 30 km | Public domain | 6 h | At DUMBO the rocks and Pebble Beach under the Manhattan Bridge only show at low tide. |
| buildings, shadow | NYC building footprints with roof heights; OpenStreetMap elsewhere (`building:height`, or levels x 3 m) | NYC Open Data; ODbL | 24 h | The street goes into building shadow hours before sunset. The 3D set extrudes the footprints as invisible shadow casters, and the server times the shadow on the street. |
| pois | OpenStreetMap via Overpass: viewpoints, transit, parking, restrooms, cafes | ODbL | 24 h | Where to stand, how to get there, where to park and where to wait. |
| photographers | Our own geotagged Wikimedia Commons photos (spot model and lens dataset) | Each photo's own CC license | at start | Where people actually stand for this shot, and which way they face. |
| moon | suncalc | BSD 2-Clause | computed | Moonrise and phase for night and blue-hour shots. |

## The rules behind the numbers

**Colour chance** (`colorChance` in `crew/src/layers/score.ts`). The physics comes from Corfidi (NOAA Storm Prediction
Center, "The Colors of Sunset and Twilight"). The colour is sunlight reddened along a long path through clean air, and it
shows best on mid and high cloud that the low sun still lights from below. Low cloud near the horizon blocks that light,
and haze mutes it. The thresholds are ours. The canvas is the mid or high cover, `1 - (1 - mid)(1 - high)`. Under 5% it
scores 20. It rises to 90 at 30%, holds 100 from 30% to 70%, and falls to 45 at full cover. Low cloud over 15% scales the
score down, to a tenth at 80% and above. A rain chance over 50% multiplies it by 0.7, and aerosol optical depth over 0.35
takes off up to 30%. Good is 65 or more, fair is 35 to 64, poor is below 35. The score uses the forecast hour nearest
each sunrise and sunset.

**Haze.** The worse of two readings names it. PM2.5 uses EPA's 2024 AQI breakpoints (good to 9.0, moderate to 35.4,
sensitive groups to 55.4 ug/m3). Aerosol optical depth: under 0.15 is clean, 0.3 visibly hazy, 0.6 thick.

**Building shadow** (`shadowAt`, `shadowBands`). From a street point, the sun's ray runs toward the solar azimuth and
rises at the sun's altitude. The point is in shadow when the ray enters a footprint below that building's roof. The probe
points are the middle of the street at the mark (from `spots/<id>/geometry.json`, built from our own SfM model) and 10 m
in front of the shot camera. Sampled every 5 minutes from sunrise to sunset. Within 15 minutes of either counts as "from
sunrise" or "to sunset", because the casters only reach 350 m. The 2D map draws each building's shadow at the set time
as the hull of the footprint and its shifted copy. That is exact for convex footprints and slightly too full for L-shaped
ones.

**Projection.** The server uses a local equirectangular projection around the spot. Over 500 m it is within 0.5 m of the
haversine distance (tested). The 3D set converts with `llhToEnu` on the WGS84 ellipsoid (`web/src/studio/frame.ts`) and
drapes every vertex on the street plane.

## Where it shows

- **3D set** (`GeoScene`). Building shadow casters, permit and closure zones draped on the street, 3 m volumes for sheds
  and scaffolds, POI pins, a plain dot per geotagged photo with its heading arrow and the three busiest spots, an alert drum when
  the spot is inside an NWS alert area, and the shadow probe ring. The root is tagged `helper`, so render layers and AI
  renders never include it, and none of it comes from Google's tiles.
- **2D map** (`Map2D`). Photographers show as plain dots, named in the overview legend. MapLibre GL 6.16 with OpenFreeMap's keyless "dark" style. OpenFreeMap is free with no
  registration. Its attribution, "OpenFreeMap © OpenMapTiles, data from OpenStreetMap", stays on the map. The map shows
  the same layers plus building extrusions, shadows at the set time, quakes, the tide station and the shot camera's view
  cone. Past 300 m of camera height it also serves as the overview (`GeoOverview`).
- **Timeline** (`GeoBands`). Cloud low, mid and high plus rain per hour, a hatched "street in building shadow" band, and
  high and low tide marks.
- **Conditions drawer** (`GeoPanel`). The paragraph, chips (colour chance, next tide, street shadow, wind, haze, moon,
  alerts), the map, the layer switches and the sources.
- **AI.** The `conditions` summary for the NVIDIA agents (shot list, art director) and Photon's golden-hour texts.

## SpacetimeDB

The geo thread asked the spacetime thread for a `layer_snapshot` table (spotId, layer, fetchedAt, summary JSON,
GeoJSON URL) and a scheduled procedure that refreshes weather and alerts for active spots every 15 minutes, straight from
the database with outbound HTTP. It also asked for a per-session `layer_toggle`, so everyone on a set sees the same
layers. The web reads both tables when the bindings have them: shared switches, and an immediate refetch whenever the
procedure writes a new snapshot. Without them it falls back to per-browser switches.

## Known limits

- NYC's film permit dataset stops at Aug 9, 2026, so live film shoots show only when the city publishes them. The layer
  shows the past year per block ("16 film permits in the last year on Prospect Street") and live permitted events, such
  as the Roebling Rink load-in on Water Street.
- The public Overpass servers were at capacity on Nov 7 and 8. The crew tries three mirrors and keeps a 24 h cache. NYC
  buildings and streets come from NYC Open Data, so NYC does not depend on Overpass.
- Crime data is left out on purpose. It stigmatises neighbourhoods and adds nothing to a photo.
