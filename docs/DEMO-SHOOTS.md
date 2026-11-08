# Demo shoots

Shoots kept on production for demos. Leave them alone except to demo them.

## A9TVAN: Manhattan Bridge from Washington St, DUMBO

The street-level demo, solved against the DUMBO model.

- Photo: "Manhattan Bridge -1.jpg" by Shah Ronak S, CC BY-SA 4.0, https://commons.wikimedia.org/wiki/File:Manhattan_Bridge_-1.jpg

## 7PL6L6: Empire State Building from Top of the Rock

The far city shot: Google's 3D tiles are sharp from height, while they melt at street level. Made on Sunday, Nov 8, 2026 at about 12:25 PM CT.

- Open: https://app.tesseraphoto.com/studio/7PL6L6 (Studio) or https://app.tesseraphoto.com/p/7PL6L6 (Simple).
- Photo: "NYC Empire State Building.jpg" by Daniel Schwen, CC BY-SA 4.0, https://commons.wikimedia.org/wiki/File:NYC_Empire_State_Building.jpg. Downloaded with the Commons API (original, 4368 x 2912). EXIF: Canon EOS 5D, 65 mm. The 5D is full frame, so the drop's copy has `FocalLengthIn35mmFormat=65` written in, and the shoot starts at 65 mm. There is no photo credit field yet, so the credit is also a message in the shoot (its People panel).
- How it was made: dropped in Simple (Nemotron guessed "Empire State Building, Midtown Manhattan"). Change place, Search "Rockefeller Plaza", then Exact spot at that point, so it reads "Placed by you". The pin is the Rockefeller Plaza street at 40.758764, -73.978650, not the tower. Studio sets Earth's ground from the lowest surface under the pin, and on the tower that would be its roof.
- Cam A: on the 70th-floor deck at 40.75904, -73.97939, which is 62.5 m west and 30.6 m north of the pin, and 259 m up (850 ft, the top deck's height). Heading 205.3°: the bearing to the Empire State Building (40.74844, -73.98566, 1.29 km away) is 204.1°, plus 1.2° because the building sits just left of centre in the photo. Pitch -0.5°. The UI can't raise Cam A that high, so I wrote this through the module's `updateSceneObject` call, as the shoot's owner (scene_object 410: x -62.49, y 30.65, z 259, params `placed=pin;approx=1;alt=259`).
- Check: Through Cam A on Earth puts the Empire State Building at 47% of the frame width (46% in the photo), at the same size, and the far horizon within about 10 px. The tiles cut the mast short. Screenshots: web/screenshots/tor-photo-beside-earth.png, tor-photo-over-earth-50.png, tor-world-1512.png, and tor-golden-dusk-night.png (4:20 PM, 5:10 PM, 6:45 PM).
- Plan time is left at 4:20 PM, in golden hour (4:06 to 5:00 PM).
