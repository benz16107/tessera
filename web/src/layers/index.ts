// Live geodata layers for the studio (docs/GEODATA.md). Mount points (GeoScene takes overlays={view !== "shot"}: nothing of ours over the photo):
//   const geo = useGeoLayers(session.id, session.spotId, planTime)
//   <GeoScene geo={geo} origin={origin} groundAt={gz} labels={view !== 'shot'} />   inside the ENU group
//   <GeoButton .../> + <GeoPanel .../>                                              top bar and drawer
//   <GeoBands geo={geo} x={x} a={a} b={b} w={w} top={...} zone={zone} />           inside the timeline track
//   <GeoOverview .../>                                                              over the viewport when zoomed out
export { useGeoLayers, LAYERS, type GeoLayers, type LayerId, type LayersData } from './useGeoLayers.ts';
export { default as GeoScene } from './Scene3D.tsx';
export { default as GeoPanel, GeoButton } from './Panel.tsx';
export { default as GeoBands } from './Bands.tsx';
export { default as GeoOverview } from './Overview.tsx';
export type { CameraCone } from './Map2D.tsx';
