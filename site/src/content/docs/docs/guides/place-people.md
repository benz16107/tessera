---
title: Place people
description: Put your friends into the shot with one tap in Simple, by hand in Studio, or with a sentence to Nemotron.
---

People in the set are posed mannequins (Quaternius, CC0). They stand where the shot will have your friends, so the framing, the focus and the render all know where they are. Each one is a `scene_object` row everyone in the shoot sees.

## In Simple: one tap

1. Open your shoot and go to **Make it yours**.
2. Tap **Add a friend** or **Add two friends**.
3. Nemotron places them through the shot camera: one friend standing about 6 m in front of the camera, facing it, or two friends walking toward the camera side by side about 7 m away, in the middle of the frame. The status line says "Nemotron is placing a friend" while it works.
4. Tap **Make it** to render your version with them in it.

## In Studio: by hand

1. Click the street where they should stand. Skip this and they land in front of the shot camera at its focus distance (3 to 25 m), facing it.
2. Press **+** in the tool rail or **Shift+A** to open the asset library, on the **People** tab.
3. Pick a pose: **Stand**, **Walk**, **Sit**, **Lean**, **Point** or **Jump**. **More poses** adds talk, crouch and push. The mannequin lands on the sloped ground from the spot's street geometry.
4. With the person selected, press **G** to move, **R** to turn. The inspector sets **Pose**, **Height** and **Facing**, and **Gaze (for the AI render)**.
5. Press **0** to look through the shot camera and check the framing. The inspector's Through Cam A section shows the person's distance, whether they are in focus and how much of the frame height they fill.

While you drag, the person is locked to you. Anyone else sees a coloured tag and can't grab it until you let go.

## With a sentence

1. In Studio, press **Describe a change** at the top of the view (or **Ctrl+K**). In Simple, use **Describe a change** under the presets.
2. Type or hold **Hold to talk** and say what you want, for example: "two friends walking toward camera, a red vintage bike on the left wall, warm string lights".
3. Nemotron 3.5 Lightning routes the sentence. A composition goes to Nemotron 3.5 Super with reasoning on, which calls the set tools: `add_people` with a count, pose, position in the frame, distance and facing.
4. The tools turn "where in the frame, how far from the camera" into metres east, north and up through the shot camera, and turn people toward the camera.

That exact sentence placed 16 rows in 6.6 s and 13.1 s on two runs. A one-object edit ("move the bike a little closer") stays on Lightning and took 2.2 s. Each step appears in the set as it runs, because each one is an `agent_step` row.

The prompt includes where the ground enters the frame and the distance at which a person fills it, so people are not placed with their feet cut off.

## Rebuild the people in the photo

Say "rebuild the scene from the photo", or let it run on its own when the set is empty: Nemotron 3.5 Super VL finds the people, vehicles and props in your photo with boxes, and the crew back-projects each box's bottom edge through the solved camera onto the ground and places a stand-in there. On the DUMBO photo it placed 10 vehicles, a street lamp and a yellow umbrella in 5.8 s.

## Remove someone

Select the person and press **X** or **Delete**. **Ctrl+Z** brings them back. Anyone can also undo a change from the set's history in live data.
