// shotmatch-library: the second database on Maincloud. It holds what is shared across every ShotMatch session:
// generated props (a TRELLIS prop made in one session is reusable in all of them) and finished shots people chose
// to publish. Session databases call these reducers through outbox tables (inter-database communication); the
// caller's identity is the calling database, checked against `trusted_db`.
import { schema, table, t, SenderError } from 'spacetimedb/server';

const trustedDb = table({ name: 'trusted_db' }, {
  identity: t.identity().primaryKey(),
  label: t.string(),
});

const config = table({ name: 'config' }, {
  id: t.u32().primaryKey(),
  owner: t.identity(),
});

const prop = table({ name: 'prop', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  assetUrl: t.string().unique(),  // absolute GLB URL; the same URL published twice counts as one prop
  name: t.string(),
  prompt: t.string(),
  sourceDb: t.identity(),
  sessions: t.u32(),              // how many sessions have published or reused it
  createdAt: t.timestamp(),
});

const shot = table({ name: 'shot', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  shareCode: t.string().unique(),
  title: t.string(),
  spotId: t.string().index('btree'),
  imageUrl: t.string(),
  lat: t.f64(), lon: t.f64(), heading: t.f64(), pitch: t.f64(), f35: t.f64(),
  sourceDb: t.identity(),
  createdAt: t.timestamp(),
});

const spacetimedb = schema({ trustedDb, config, prop, shot });
export default spacetimedb;

export const init = spacetimedb.init(ctx => {
  ctx.db.config.insert({ id: 0, owner: ctx.sender });
});

const requireTrusted = (ctx: { db: any; sender: any }) => {
  if (!ctx.db.trustedDb.identity.find(ctx.sender)) throw new SenderError('only a trusted ShotMatch database can publish');
};
const text = (s: string, max: number) => {
  if (s.length > max) throw new SenderError(`text longer than ${max}`);
  return s;
};

// The owner allow-lists a session database by its identity (spacetime call shotmatch-library trust_database ...).
export const trustDatabase = spacetimedb.reducer({ identity: t.identity(), label: t.string() }, (ctx, { identity, label }) => {
  const c = ctx.db.config.id.find(0);
  if (!c || !c.owner.equals(ctx.sender)) throw new SenderError('owner only');
  if (ctx.db.trustedDb.identity.find(identity)) ctx.db.trustedDb.identity.update({ identity, label });
  else ctx.db.trustedDb.insert({ identity, label });
});

export const publishProp = spacetimedb.reducer(
  { assetUrl: t.string(), name: t.string(), prompt: t.string() },
  (ctx, a) => {
    requireTrusted(ctx);
    if (!/^https:\/\/\S+$/.test(a.assetUrl)) throw new SenderError('assetUrl must be an absolute https URL');
    const old = ctx.db.prop.assetUrl.find(a.assetUrl);
    if (old) { ctx.db.prop.id.update({ ...old, sessions: old.sessions + 1 }); return; }
    ctx.db.prop.insert({
      id: 0n, assetUrl: text(a.assetUrl, 300), name: text(a.name, 80), prompt: text(a.prompt, 500),
      sourceDb: ctx.sender, sessions: 1, createdAt: ctx.timestamp,
    });
  }
);

export const publishShot = spacetimedb.reducer(
  { shareCode: t.string(), title: t.string(), spotId: t.string(), imageUrl: t.string(), lat: t.f64(), lon: t.f64(), heading: t.f64(), pitch: t.f64(), f35: t.f64() },
  (ctx, a) => {
    requireTrusted(ctx);
    if (ctx.db.shot.shareCode.find(a.shareCode)) throw new SenderError('share code already published');
    if (![a.lat, a.lon, a.heading, a.pitch, a.f35].every(Number.isFinite)) throw new SenderError('non-finite number');
    ctx.db.shot.insert({
      ...a, id: 0n, shareCode: text(a.shareCode, 16), title: text(a.title, 120), spotId: text(a.spotId, 64), imageUrl: text(a.imageUrl, 500),
      sourceDb: ctx.sender, createdAt: ctx.timestamp,
    });
  }
);

// The owner removes everything a scratch database published (proof runs), keeping the public library clean.
export const purgeSource = spacetimedb.reducer({ sourceDb: t.identity() }, (ctx, { sourceDb }) => {
  const c = ctx.db.config.id.find(0);
  if (!c || !c.owner.equals(ctx.sender)) throw new SenderError('owner only');
  for (const p of [...ctx.db.prop.iter()]) if (p.sourceDb.equals(sourceDb)) ctx.db.prop.id.delete(p.id);
  for (const s of [...ctx.db.shot.iter()]) if (s.sourceDb.equals(sourceDb)) ctx.db.shot.id.delete(s.id);
});
