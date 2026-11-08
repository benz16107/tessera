---
title: Scout to the mark
description: Walk to the exact spot with your phone, line the street up with a ghost of the original photo, and let the planners watch your dot move.
---

The scout is whoever stands at the real place: you on the day, or a friend checking the spot before. Their phone shows the camera with the original photo laid over it as a ghost, the distance and the direction to the mark, and it shares their position with the set so everyone sees them walk.

## Open the camera page

Pick one:

- **In Simple on your phone:** go to **Take me there** and press **Open camera and compass**.
- **From a laptop:** Take me there shows a QR code: "Scan this with your phone to open the camera there. Your walk shows up here live."
- **From a link:** open `/s/<code>` (for the demo, https://app.tesseraphoto.com/s/A9TVAN), type **Your name** and press **Join as scout**.

The scout page has its own identity in the browser, so one phone can plan and scout as two people.

## Allow the sensors

The browser asks for the camera, location and motion. On iPhone, motion and compass access needs a tap on the page first (Safari's permission prompt), and the page must be on HTTPS, which the app is. If you refuse motion, GPS still works and the page tells you which way to head instead: "No compass on this device. Head NNE (23°)."

If location is off: "Location is off for this page. Allow it in the browser settings." Before the first fix: "Waiting for a GPS fix."

## Walk to the mark

1. The card shows the distance to the mark and the GPS accuracy, in the form "33 m to the mark · GPS ±`n` m".
2. Follow the arrow until the card says you're there. **Directions** (or **Walking directions in Maps**) opens your maps app for the longer walk.
3. The phone sends its position and compass heading to SpacetimeDB at most 5 times a second (`pushDevicePose`). Every planner sees your dot move in the set and in Simple's walkers list, as "`name`, `distance` away, head `direction`" or "at the mark".
4. Within 8 m, the card says **You're there.** and everyone in the shoot gets the notice "`name` reached the spot".

## Line up the ghost

1. The original photo sits over the live camera as a ghost. Drag the **Ghost** slider to fade it, or hide it with **Hide the ghost**.
2. "Turn until the street lines up with the ghost, then take the photo." When the heading matches, the page says "Facing the right way. Take it."

Phone GPS is off by metres, so the last few steps are by eye. That is what the ghost is for.

## Check in by photo

Text a photo from where you stand to the shoot's thread. The crew solves it against the spot model and replies with the correction, for example "You're 3.2 m east of the mark and facing 14 degrees too far left. 4 paces to your left, then turn right 14 degrees." A marker for your check-in appears in the 3D set, and everyone else gets a one-line note.

Check-in by text runs through Photon; see [Messaging](/docs/how-it-works/messaging/#3-check-in-by-photo) for which lines are live.

## Privacy

Your position is shared only while the camera page is open. Closing the page stops it.
