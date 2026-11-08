---
title: Plan a shoot day
description: Pick the light on the timeline, check the conditions, have Nemotron write a call sheet, route the walk with cuOpt and get alerted before golden hour.
---

The set has a clock. Every client's sun follows it, so moving the time moves the light for everyone at once. A shoot day is that clock plus the conditions at the spot, a call sheet, a walking route and a reminder.

## 1. Pick the light on the timeline

Studio's timeline runs along the bottom of the screen.

1. Drag the playhead, or press play. The time shows at the left ("4:28 PM, Saturday, Nov 7" in the demo set).
2. Read the bands: **Golden hour** (for example 4:06 to 5:02 PM at DUMBO on November 7) and **Blue**. They are computed with suncalc for the mark's position and the camera's heading.
3. **Light** jumps to **Dawn**, **Dusk** or **Day**.
4. The sun line shows its altitude through the day, sunset, and where the sun sits relative to the camera: "Sun 2.4° up, 246°, from the left of Cam A".
5. **Live sun** sets the shared clock: **Off**, **Live** (follows the real time), **60x** or **600x** (a time-lapse). A schedule inside SpacetimeDB moves the clock every second, so the light moves on every screen together. 600x moved the set 30.0 minutes in 3.2 s.

In Simple, **Golden hour** and **Blue hour** on Make it yours set the clock to the middle of the next window. "Next good light" on Found it names it.

## 2. Check the conditions

Press **Conditions** in Studio's top bar. The drawer gives one paragraph for the set's time, then chips for the colour chance, the next tide, street shadow, wind, haze, the moon and alerts, a 2D map and the layer switches. The timeline gains cloud and rain per hour, a hatched "street in building shadow" band and tide marks.

What the numbers mean and where they come from: [Live geodata](/docs/how-it-works/geodata/).

## 3. Write the call sheet

1. Select Cam A and open **Call sheet and models** in the inspector, then press **Write the call sheet**. From People, **Send call sheet to everyone** writes it and sends it to every person's channel. Over text, send "call sheet".
2. Nemotron 3.5 Super, with reasoning on, writes the shots, lenses, apertures, and the call and wrap times, with every time inside the real golden and blue hour windows at the spot. It reads the live conditions too.
3. Email gets the sheet in full; every channel gets a link to its page at `/sheet/<code>`.

On the test session for Sunday morning it wrote 5 shots from 6:20 to 7:10 AM, call at 5:45 AM, inside Sunday's 6:06 to 7:15 AM windows. Its shot notes planned around the poor sunrise colour chance (20 of 100), the 7:32 AM high tide, the street in shadow until 11:10 AM and the sidewalk shed at 30 Washington St.

## 4. Route the walk

NVIDIA cuOpt orders the walk between viewpoints with each shot's light window as a time window. Ask the set agent ("plan the route for the shoot day") or call `GET /api/route?session=<id>`. The first cuOpt call took 58 s.

## 5. Get the golden-hour alert

When a set has a mark and at least one person on a channel, the crew schedules a reminder in the database for 20 minutes before the next golden hour (within the next 20 hours). When it fires, each person gets their own message with their live distance from the scout page:

> Golden hour starts in 20 min. You're 300 m away, about 4 min on foot.

It also carries the colour chance and up to two permits near the mark. If the shared iMessage line refuses a late message, the alert goes to the person's next channel: Telegram, SMS, email, then WhatsApp. See [Messaging](/docs/how-it-works/messaging/#5-messages-at-the-moment-of-the-shot).

Messages go out through Photon. The lines other than Telegram wait on setup in Photon's dashboard; see [Get started](/docs/get-started/#5-reach-the-set-by-text).

## 6. Ask the art director

After a render, the art director (Nemotron 3.5 Super VL, reasoning on) critiques the composition: thirds, leading lines, subject placement and separation, the horizon. It returns two or three fixes, each a list of set edits you apply with one click. It took 21.6 s.
