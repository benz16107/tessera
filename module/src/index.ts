import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';

// One camera or person placement. f35 is the 35 mm-equivalent focal length (diagonal convention, see CONTRACTS.md).
const Pose = t.object('Pose', {
  lat: t.f64(), lon: t.f64(), alt: t.f64(),
  heading: t.f64(), pitch: t.f64(), roll: t.f64(),
  f35: t.f64(),
});

const config = table({ name: 'config' }, {
  id: t.u32().primaryKey(),
  owner: t.identity(),
  crew: t.option(t.identity()),
  crewCode: t.string(),
});

const spot = table({ name: 'spot', public: true }, {
  id: t.string().primaryKey(),
  name: t.string(),
  lat: t.f64(), lon: t.f64(), radiusM: t.f64(),
  cameras: t.u32(),
  modelVersion: t.string(),
});

const session = table({ name: 'session', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  code: t.string().unique(),
  spotId: t.string(),
  title: t.string(),
  owner: t.identity().index('btree'),
  planTime: t.option(t.timestamp()),
  createdAt: t.timestamp(),
});

const participant = table({ name: 'participant', public: true, indexes: [
  { accessor: 'by_session_identity', algorithm: 'btree', columns: ['sessionId', 'identity'] },
] }, {
  id: t.u64().primaryKey().autoInc(),
  sessionId: t.u64(),
  identity: t.identity().index('btree'),
  name: t.string(),
  role: t.string(), // planner | scout | crew
  online: t.bool(),
  lastSeen: t.timestamp(),
});

const photo = table({ name: 'photo', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  sessionId: t.u64().index('btree'),
  owner: t.identity(),
  url: t.string(),
  thumb: t.string(), // small JPEG data URL so every client can draw it without a second fetch
  width: t.u32(), height: t.u32(),
  pinLat: t.option(t.f64()), pinLon: t.option(t.f64()),
  exifF35: t.option(t.f64()),
  source: t.string(), // web | imessage | telegram
  createdAt: t.timestamp(),
});

const solveJob = table({ name: 'solve_job', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  photoId: t.u64().index('btree'),
  sessionId: t.u64().index('btree'),
  spotId: t.string(),
  state: t.string().index('btree'), // queued | running | done | failed
  progress: t.string(),
  worker: t.option(t.identity()),
  leaseUntil: t.option(t.timestamp()),
  attempts: t.u32(),
  error: t.string(),
  lensHintF35: t.option(t.f64()), // a user's "it was about 85 mm" on a re-run; the solver treats it as a range
  createdAt: t.timestamp(),
});

const solveResult = table({ name: 'solve_result', public: true }, {
  photoId: t.u64().primaryKey(),
  sessionId: t.u64().index('btree'),
  jobId: t.u64(),
  pose: Pose,
  inliers: t.u32(),
  confidence: t.string(), // solid | check | none
  reason: t.string(),
  lensReadF35: t.option(t.f64()),
  secs: t.f64(),
  createdAt: t.timestamp(),
});

const camera = table({ name: 'camera', public: true }, {
  sessionId: t.u64().primaryKey(),
  pose: Pose,
  updatedBy: t.identity(),
});

const person = table({ name: 'person', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  sessionId: t.u64().index('btree'),
  lat: t.f64(), lon: t.f64(), heading: t.f64(),
  label: t.string(),
});

const devicePose = table({ name: 'device_pose', public: true }, {
  participantId: t.u64().primaryKey(),
  sessionId: t.u64().index('btree'),
  lat: t.f64(), lon: t.f64(), accuracyM: t.f64(), heading: t.option(t.f64()),
  at: t.timestamp(),
});

const previewJob = table({ name: 'preview_job', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  sessionId: t.u64().index('btree'),
  photoId: t.u64(),
  instruction: t.string(),
  f35: t.option(t.f64()),
  people: t.u32(),
  sunAzimuth: t.option(t.f64()), sunAltitude: t.option(t.f64()),
  state: t.string().index('btree'),
  imageUrl: t.string(),
  error: t.string(),
  worker: t.option(t.identity()),
  leaseUntil: t.option(t.timestamp()),
  attempts: t.u32(),
  createdAt: t.timestamp(),
});

const message = table({ name: 'message', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  sessionId: t.u64().index('btree'),
  channel: t.string(), // imessage | telegram | voice | web
  threadId: t.string(),
  externalId: t.string(),
  parentExternalId: t.string(),
  direction: t.string(), // in | out
  author: t.string(),
  text: t.string(),
  imageUrl: t.string(),
  createdAt: t.timestamp(),
});

const agentStep = table({ name: 'agent_step', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  sessionId: t.u64().index('btree'),
  tool: t.string(),
  args: t.string(),
  result: t.string(),
  ms: t.u32(),
  at: t.timestamp(),
});

// Toasts every client in the session sees once: "solve finished", "scout reached the spot".
const toast = table({ name: 'toast', public: true, event: true }, {
  sessionId: t.u64(),
  kind: t.string(),
  text: t.string(),
});

// Golden-hour reminders: the schedule fires inside the database; the crew delivers the outbox row to the session's text thread.
const reminder = table({ name: 'reminder', public: true }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  sessionId: t.u64().index('btree'),
  text: t.string(),
});

const outbox = table({ name: 'outbox', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  sessionId: t.u64().index('btree'),
  text: t.string(),
  state: t.string().index('btree'), // pending | sent | failed
  createdAt: t.timestamp(),
});

const sweepTimer = table({ name: 'sweep_timer' }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

const spacetimedb = schema({
  config, spot, session, participant, photo, solveJob, solveResult, camera, person,
  devicePose, previewJob, message, agentStep, toast, sweepTimer, reminder, outbox,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const LEASE_US = 60_000_000n;
const MAX_ATTEMPTS = 3;
const ARRIVED_M = 8;

const cfg = (ctx: Ctx) => {
  const c = ctx.db.config.id.find(0);
  if (!c) throw new SenderError('module not initialised');
  return c;
};
const isCrew = (ctx: Ctx) => {
  const c = cfg(ctx);
  return c.crew !== undefined && c.crew.equals(ctx.sender);
};
const requireCrew = (ctx: Ctx) => { if (!isCrew(ctx)) throw new SenderError('crew only'); };
const isOwner = (ctx: Ctx) => cfg(ctx).owner.equals(ctx.sender);
const member = (ctx: Ctx, sessionId: bigint) =>
  [...ctx.db.participant.by_session_identity.filter([sessionId, ctx.sender])][0];
const requireMember = (ctx: Ctx, sessionId: bigint) => {
  if (!ctx.db.session.id.find(sessionId)) throw new SenderError('no such session');
  if (!member(ctx, sessionId) && !isCrew(ctx)) throw new SenderError('join the session first');
};
const later = (ctx: Ctx, us: bigint) => new Timestamp(ctx.timestamp.microsSinceUnixEpoch + us);
const meters = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const r = Math.PI / 180, x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r), y = (bLat - aLat) * r;
  return Math.hypot(x, y) * 6_371_000;
};
const text = (s: string, max: number) => {
  if (s.length > max) throw new SenderError(`text longer than ${max}`);
  return s;
};
const finite = (...xs: number[]) => { if (!xs.every(Number.isFinite)) throw new SenderError('non-finite number'); };

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = (ctx: Ctx) => {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[ctx.random.integerInRange(0, CODE_CHARS.length - 1)];
    if (!ctx.db.session.code.find(c)) return c;
  }
};

const addParticipant = (ctx: Ctx, sessionId: bigint, name: string, role: string) => {
  const existing = member(ctx, sessionId);
  if (existing) {
    ctx.db.participant.id.update({ ...existing, name, role, online: true, lastSeen: ctx.timestamp });
    return existing.id;
  }
  return ctx.db.participant.insert({ id: 0n, sessionId, identity: ctx.sender, name, role, online: true, lastSeen: ctx.timestamp }).id;
};

export const init = spacetimedb.init(ctx => {
  ctx.db.config.insert({ id: 0, owner: ctx.sender, crew: undefined, crewCode: '' });
  ctx.db.sweepTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(10_000_000n) });
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  for (const p of ctx.db.participant.identity.filter(ctx.sender))
    ctx.db.participant.id.update({ ...p, online: true, lastSeen: ctx.timestamp });
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  for (const p of ctx.db.participant.identity.filter(ctx.sender))
    ctx.db.participant.id.update({ ...p, online: false, lastSeen: ctx.timestamp });
});

// The owner sets a one-time code out of band; the crew process redeems it to become the worker identity.
export const setCrewCode = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  if (!isOwner(ctx)) throw new SenderError('owner only');
  if (code.length < 16) throw new SenderError('code too short');
  ctx.db.config.id.update({ ...cfg(ctx), crewCode: code });
});

export const registerCrew = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  const c = cfg(ctx);
  if (!c.crewCode || code !== c.crewCode) throw new SenderError('bad crew code');
  ctx.db.config.id.update({ ...c, crew: ctx.sender });
});

export const upsertSpot = spacetimedb.reducer(
  { id: t.string(), name: t.string(), lat: t.f64(), lon: t.f64(), radiusM: t.f64(), cameras: t.u32(), modelVersion: t.string() },
  (ctx, s) => {
    if (!isCrew(ctx) && !isOwner(ctx)) throw new SenderError('crew only');
    finite(s.lat, s.lon, s.radiusM);
    if (ctx.db.spot.id.find(s.id)) ctx.db.spot.id.update(s); else ctx.db.spot.insert(s);
  }
);

export const createSession = spacetimedb.reducer(
  { spotId: t.string(), title: t.string(), name: t.string() },
  (ctx, { spotId, title, name }) => {
    const s = ctx.db.session.insert({
      id: 0n, code: newCode(ctx), spotId: text(spotId, 64), title: text(title, 120), owner: ctx.sender,
      planTime: undefined, createdAt: ctx.timestamp,
    });
    addParticipant(ctx, s.id, text(name, 40), isCrew(ctx) ? 'crew' : 'planner');
  }
);

export const joinSession = spacetimedb.reducer(
  { code: t.string(), name: t.string(), role: t.string() },
  (ctx, { code, name, role }) => {
    const s = ctx.db.session.code.find(code.trim().toUpperCase());
    if (!s) throw new SenderError('no session with that code');
    if (role !== 'planner' && role !== 'scout') throw new SenderError('role must be planner or scout');
    addParticipant(ctx, s.id, text(name, 40), role);
  }
);

export const setSessionSpot = spacetimedb.reducer({ sessionId: t.u64(), spotId: t.string() }, (ctx, { sessionId, spotId }) => {
  requireMember(ctx, sessionId);
  const s = ctx.db.session.id.find(sessionId)!;
  ctx.db.session.id.update({ ...s, spotId: text(spotId, 64) });
});

export const addPhoto = spacetimedb.reducer(
  {
    sessionId: t.u64(), spotId: t.string(), url: t.string(), thumb: t.string(), width: t.u32(), height: t.u32(),
    pinLat: t.option(t.f64()), pinLon: t.option(t.f64()), exifF35: t.option(t.f64()), source: t.string(),
  },
  (ctx, a) => {
    requireMember(ctx, a.sessionId);
    text(a.url, 500); text(a.thumb, 200_000);
    const p = ctx.db.photo.insert({
      id: 0n, sessionId: a.sessionId, owner: ctx.sender, url: a.url, thumb: a.thumb, width: a.width, height: a.height,
      pinLat: a.pinLat, pinLon: a.pinLon, exifF35: a.exifF35, source: text(a.source, 16), createdAt: ctx.timestamp,
    });
    if (a.spotId) enqueue(ctx, p.id, a.sessionId, a.spotId);
  }
);

const enqueue = (ctx: Ctx, photoId: bigint, sessionId: bigint, spotId: string, lensHintF35?: number) =>
  ctx.db.solveJob.insert({
    id: 0n, photoId, sessionId, spotId: text(spotId, 64), state: 'queued', progress: 'waiting for a worker',
    worker: undefined, leaseUntil: undefined, attempts: 0, error: '', lensHintF35, createdAt: ctx.timestamp,
  });

export const enqueueSolve = spacetimedb.reducer(
  { photoId: t.u64(), spotId: t.string(), lensHintF35: t.option(t.f64()) },
  (ctx, { photoId, spotId, lensHintF35 }) => {
    const p = ctx.db.photo.id.find(photoId);
    if (!p) throw new SenderError('no such photo');
    requireMember(ctx, p.sessionId);
    if (lensHintF35 !== undefined && !(lensHintF35 >= 8 && lensHintF35 <= 1200)) throw new SenderError('lens hint out of range');
    enqueue(ctx, photoId, p.sessionId, spotId, lensHintF35);
  }
);

// Refused uploads keep no location (BUILD.md, Safety), and owners can withdraw a photo.
export const deletePhoto = spacetimedb.reducer({ photoId: t.u64() }, (ctx, { photoId }) => {
  const p = ctx.db.photo.id.find(photoId);
  if (!p) return;
  if (!p.owner.equals(ctx.sender) && !isCrew(ctx)) throw new SenderError('not your photo');
  for (const j of [...ctx.db.solveJob.photoId.filter(photoId)]) ctx.db.solveJob.id.delete(j.id);
  for (const j of [...ctx.db.previewJob.sessionId.filter(p.sessionId)]) if (j.photoId === photoId) ctx.db.previewJob.id.delete(j.id);
  ctx.db.solveResult.photoId.delete(photoId);
  ctx.db.photo.id.delete(photoId);
});

export const claimJob = spacetimedb.reducer({ jobId: t.u64() }, (ctx, { jobId }) => {
  requireCrew(ctx);
  const j = ctx.db.solveJob.id.find(jobId);
  if (!j || j.state !== 'queued') throw new SenderError('job not claimable');
  ctx.db.solveJob.id.update({ ...j, state: 'running', worker: ctx.sender, leaseUntil: later(ctx, LEASE_US), attempts: j.attempts + 1, progress: 'claimed' });
});

export const reportProgress = spacetimedb.reducer({ jobId: t.u64(), progress: t.string() }, (ctx, { jobId, progress }) => {
  requireCrew(ctx);
  const j = ctx.db.solveJob.id.find(jobId);
  if (!j || j.state !== 'running' || !j.worker?.equals(ctx.sender)) throw new SenderError('not your job');
  ctx.db.solveJob.id.update({ ...j, progress: text(progress, 200), leaseUntil: later(ctx, LEASE_US) });
});

export const finishJob = spacetimedb.reducer(
  {
    jobId: t.u64(), ok: t.bool(), error: t.string(), pose: Pose, inliers: t.u32(), confidence: t.string(),
    reason: t.string(), lensReadF35: t.option(t.f64()), secs: t.f64(),
  },
  (ctx, a) => {
    requireCrew(ctx);
    const j = ctx.db.solveJob.id.find(a.jobId);
    if (!j || j.state !== 'running' || !j.worker?.equals(ctx.sender)) throw new SenderError('not your job');
    ctx.db.solveJob.id.update({ ...j, state: a.ok ? 'done' : 'failed', error: text(a.error, 500), progress: a.ok ? 'done' : 'failed', leaseUntil: undefined });
    if (!a.ok) {
      ctx.db.toast.insert({ sessionId: j.sessionId, kind: 'solve_failed', text: a.error });
      return;
    }
    if (!['solid', 'check', 'none'].includes(a.confidence)) throw new SenderError('bad confidence');
    const row = {
      photoId: j.photoId, sessionId: j.sessionId, jobId: j.id, pose: a.pose, inliers: a.inliers, confidence: a.confidence,
      reason: text(a.reason, 300), lensReadF35: a.lensReadF35, secs: a.secs, createdAt: ctx.timestamp,
    };
    if (ctx.db.solveResult.photoId.find(j.photoId)) ctx.db.solveResult.photoId.update(row); else ctx.db.solveResult.insert(row);
    if (a.confidence !== 'none' && !ctx.db.camera.sessionId.find(j.sessionId))
      ctx.db.camera.insert({ sessionId: j.sessionId, pose: a.pose, updatedBy: ctx.sender });
    ctx.db.toast.insert({ sessionId: j.sessionId, kind: 'solve_done', text: a.confidence === 'none' ? "Couldn't place this photo" : 'Shot located' });
  }
);

export const moveCamera = spacetimedb.reducer({ sessionId: t.u64(), pose: Pose }, (ctx, { sessionId, pose }) => {
  requireMember(ctx, sessionId);
  finite(pose.lat, pose.lon, pose.alt, pose.heading, pose.pitch, pose.roll, pose.f35);
  const row = { sessionId, pose, updatedBy: ctx.sender };
  if (ctx.db.camera.sessionId.find(sessionId)) ctx.db.camera.sessionId.update(row); else ctx.db.camera.insert(row);
});

export const placePerson = spacetimedb.reducer(
  { sessionId: t.u64(), id: t.u64(), lat: t.f64(), lon: t.f64(), heading: t.f64(), label: t.string() },
  (ctx, a) => {
    requireMember(ctx, a.sessionId);
    finite(a.lat, a.lon, a.heading);
    const row = { id: a.id, sessionId: a.sessionId, lat: a.lat, lon: a.lon, heading: a.heading, label: text(a.label, 40) };
    const old = a.id ? ctx.db.person.id.find(a.id) : undefined;
    if (old) {
      if (old.sessionId !== a.sessionId) throw new SenderError('person is in another session');
      ctx.db.person.id.update(row);
    } else ctx.db.person.insert({ ...row, id: 0n });
  }
);

export const removePerson = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const p = ctx.db.person.id.find(id);
  if (!p) return;
  requireMember(ctx, p.sessionId);
  ctx.db.person.id.delete(id);
});

export const setPlanTime = spacetimedb.reducer({ sessionId: t.u64(), at: t.option(t.timestamp()) }, (ctx, { sessionId, at }) => {
  requireMember(ctx, sessionId);
  ctx.db.session.id.update({ ...ctx.db.session.id.find(sessionId)!, planTime: at });
});

export const pushDevicePose = spacetimedb.reducer(
  { sessionId: t.u64(), lat: t.f64(), lon: t.f64(), accuracyM: t.f64(), heading: t.option(t.f64()) },
  (ctx, a) => {
    const me = member(ctx, a.sessionId);
    if (!me) throw new SenderError('join the session first');
    finite(a.lat, a.lon, a.accuracyM);
    const prev = ctx.db.devicePose.participantId.find(me.id);
    const row = { participantId: me.id, sessionId: a.sessionId, lat: a.lat, lon: a.lon, accuracyM: a.accuracyM, heading: a.heading, at: ctx.timestamp };
    if (prev) ctx.db.devicePose.participantId.update(row); else ctx.db.devicePose.insert(row);
    const cam = ctx.db.camera.sessionId.find(a.sessionId);
    if (cam) {
      const d = meters(a.lat, a.lon, cam.pose.lat, cam.pose.lon);
      const before = prev ? meters(prev.lat, prev.lon, cam.pose.lat, cam.pose.lon) : Infinity;
      if (d <= ARRIVED_M && before > ARRIVED_M) ctx.db.toast.insert({ sessionId: a.sessionId, kind: 'scout_arrived', text: `${me.name} reached the spot` });
    }
  }
);

export const requestPreview = spacetimedb.reducer(
  {
    sessionId: t.u64(), photoId: t.u64(), instruction: t.string(), f35: t.option(t.f64()), people: t.u32(),
    sunAzimuth: t.option(t.f64()), sunAltitude: t.option(t.f64()),
  },
  (ctx, a) => {
    requireMember(ctx, a.sessionId);
    const p = ctx.db.photo.id.find(a.photoId);
    if (!p || p.sessionId !== a.sessionId) throw new SenderError('photo not in this session');
    ctx.db.previewJob.insert({
      id: 0n, sessionId: a.sessionId, photoId: a.photoId, instruction: text(a.instruction, 500), f35: a.f35, people: a.people,
      sunAzimuth: a.sunAzimuth, sunAltitude: a.sunAltitude, state: 'queued', imageUrl: '', error: '', worker: undefined,
      leaseUntil: undefined, attempts: 0, createdAt: ctx.timestamp,
    });
  }
);

export const claimPreview = spacetimedb.reducer({ jobId: t.u64() }, (ctx, { jobId }) => {
  requireCrew(ctx);
  const j = ctx.db.previewJob.id.find(jobId);
  if (!j || j.state !== 'queued') throw new SenderError('job not claimable');
  ctx.db.previewJob.id.update({ ...j, state: 'running', worker: ctx.sender, leaseUntil: later(ctx, LEASE_US * 3n), attempts: j.attempts + 1 });
});

export const renewPreview = spacetimedb.reducer({ jobId: t.u64() }, (ctx, { jobId }) => {
  requireCrew(ctx);
  const j = ctx.db.previewJob.id.find(jobId);
  if (!j || j.state !== 'running' || !j.worker?.equals(ctx.sender)) throw new SenderError('not your job');
  ctx.db.previewJob.id.update({ ...j, leaseUntil: later(ctx, LEASE_US * 3n) });
});

export const finishPreview = spacetimedb.reducer(
  { jobId: t.u64(), ok: t.bool(), imageUrl: t.string(), error: t.string() },
  (ctx, a) => {
    requireCrew(ctx);
    const j = ctx.db.previewJob.id.find(a.jobId);
    if (!j || j.state !== 'running' || !j.worker?.equals(ctx.sender)) throw new SenderError('not your job');
    ctx.db.previewJob.id.update({ ...j, state: a.ok ? 'done' : 'failed', imageUrl: text(a.imageUrl, 500), error: text(a.error, 500), leaseUntil: undefined });
    ctx.db.toast.insert({ sessionId: j.sessionId, kind: a.ok ? 'preview_done' : 'preview_failed', text: a.ok ? 'Preview ready' : a.error });
  }
);

export const postMessage = spacetimedb.reducer(
  {
    sessionId: t.u64(), channel: t.string(), threadId: t.string(), externalId: t.string(), parentExternalId: t.string(),
    direction: t.string(), author: t.string(), text: t.string(), imageUrl: t.string(),
  },
  (ctx, a) => {
    requireMember(ctx, a.sessionId);
    if (a.channel !== 'web' && !isCrew(ctx)) throw new SenderError('only the crew relays outside channels');
    if (a.direction !== 'in' && a.direction !== 'out') throw new SenderError('bad direction');
    if (a.direction === 'out' && !isCrew(ctx)) throw new SenderError('crew only');
    ctx.db.message.insert({
      id: 0n, sessionId: a.sessionId, channel: text(a.channel, 16), threadId: text(a.threadId, 200), externalId: text(a.externalId, 200),
      parentExternalId: text(a.parentExternalId, 200), direction: a.direction, author: text(a.author, 80), text: text(a.text, 4000),
      imageUrl: text(a.imageUrl, 500), createdAt: ctx.timestamp,
    });
  }
);

export const logAgentStep = spacetimedb.reducer(
  { sessionId: t.u64(), tool: t.string(), args: t.string(), result: t.string(), ms: t.u32() },
  (ctx, a) => {
    requireCrew(ctx);
    ctx.db.agentStep.insert({ id: 0n, sessionId: a.sessionId, tool: text(a.tool, 60), args: text(a.args, 2000), result: text(a.result, 4000), ms: a.ms, at: ctx.timestamp });
  }
);

export const scheduleReminder = spacetimedb.reducer(
  { sessionId: t.u64(), atMicros: t.i64(), text: t.string() },
  (ctx, a) => {
    requireMember(ctx, a.sessionId);
    if (a.atMicros <= ctx.timestamp.microsSinceUnixEpoch) throw new SenderError('reminder time is in the past');
    for (const r of [...ctx.db.reminder.sessionId.filter(a.sessionId)]) ctx.db.reminder.scheduledId.delete(r.scheduledId);
    ctx.db.reminder.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(a.atMicros), sessionId: a.sessionId, text: text(a.text, 300) });
  }
);

export const cancelReminder = spacetimedb.reducer({ sessionId: t.u64() }, (ctx, { sessionId }) => {
  requireMember(ctx, sessionId);
  for (const r of [...ctx.db.reminder.sessionId.filter(sessionId)]) ctx.db.reminder.scheduledId.delete(r.scheduledId);
});

export const fireReminder = spacetimedb.reducer({ onSchedule: reminder }, { r: reminder.rowType }, (ctx, { r }) => {
  ctx.db.toast.insert({ sessionId: r.sessionId, kind: 'reminder', text: r.text });
  ctx.db.outbox.insert({ id: 0n, sessionId: r.sessionId, text: r.text, state: 'pending', createdAt: ctx.timestamp });
});

export const markOutbox = spacetimedb.reducer({ id: t.u64(), state: t.string() }, (ctx, { id, state }) => {
  requireCrew(ctx);
  const o = ctx.db.outbox.id.find(id);
  if (!o) return;
  if (state !== 'sent' && state !== 'failed') throw new SenderError('bad state');
  ctx.db.outbox.id.update({ ...o, state });
});

// Session owner or crew removes a session and everything in it.
export const deleteSession = spacetimedb.reducer({ sessionId: t.u64() }, (ctx, { sessionId }) => {
  const s = ctx.db.session.id.find(sessionId);
  if (!s) return;
  if (!s.owner.equals(ctx.sender) && !isCrew(ctx) && !isOwner(ctx)) throw new SenderError('not your session');
  for (const x of [...ctx.db.photo.sessionId.filter(sessionId)]) ctx.db.photo.id.delete(x.id);
  for (const x of [...ctx.db.solveJob.sessionId.filter(sessionId)]) ctx.db.solveJob.id.delete(x.id);
  for (const x of [...ctx.db.solveResult.sessionId.filter(sessionId)]) ctx.db.solveResult.photoId.delete(x.photoId);
  for (const x of [...ctx.db.previewJob.sessionId.filter(sessionId)]) ctx.db.previewJob.id.delete(x.id);
  for (const x of [...ctx.db.person.sessionId.filter(sessionId)]) ctx.db.person.id.delete(x.id);
  for (const x of [...ctx.db.devicePose.sessionId.filter(sessionId)]) ctx.db.devicePose.participantId.delete(x.participantId);
  for (const x of [...ctx.db.message.sessionId.filter(sessionId)]) ctx.db.message.id.delete(x.id);
  for (const x of [...ctx.db.agentStep.sessionId.filter(sessionId)]) ctx.db.agentStep.id.delete(x.id);
  for (const x of [...ctx.db.reminder.sessionId.filter(sessionId)]) ctx.db.reminder.scheduledId.delete(x.scheduledId);
  for (const x of [...ctx.db.outbox.sessionId.filter(sessionId)]) ctx.db.outbox.id.delete(x.id);
  for (const x of [...ctx.db.participant.iter()]) if (x.sessionId === sessionId) ctx.db.participant.id.delete(x.id);
  ctx.db.camera.sessionId.delete(sessionId);
  ctx.db.session.id.delete(sessionId);
});

// Every 10 s: requeue jobs whose worker stopped renewing its lease (the kill-the-worker demo).
export const sweep = spacetimedb.reducer({ onSchedule: sweepTimer }, { timer: sweepTimer.rowType }, ctx => {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  for (const j of [...ctx.db.solveJob.state.filter('running')]) {
    if (!j.leaseUntil || j.leaseUntil.microsSinceUnixEpoch > now) continue;
    const dead = j.attempts >= MAX_ATTEMPTS;
    ctx.db.solveJob.id.update({ ...j, state: dead ? 'failed' : 'queued', worker: undefined, leaseUntil: undefined,
      progress: dead ? 'gave up after 3 workers stopped' : 'worker stopped; requeued', error: dead ? 'worker lease expired 3 times' : '' });
    ctx.db.toast.insert({ sessionId: j.sessionId, kind: 'job_reclaimed', text: dead ? 'Solve gave up' : 'Worker stopped; solve requeued' });
  }
  for (const j of [...ctx.db.previewJob.state.filter('running')]) {
    if (!j.leaseUntil || j.leaseUntil.microsSinceUnixEpoch > now) continue;
    const dead = j.attempts >= MAX_ATTEMPTS;
    ctx.db.previewJob.id.update({ ...j, state: dead ? 'failed' : 'queued', worker: undefined, leaseUntil: undefined, error: dead ? 'worker lease expired 3 times' : '' });
  }
});
