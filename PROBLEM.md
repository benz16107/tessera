# The problem Tessera solves

Research of Sat Nov 7, 2026, from 1,900 Reddit posts in 30 searches (Arctic Shift archive) and web sources. The raw pulls are in `~/Code/scratch/shotmatch-problem/` on linuxbox.

## Problem

A photo shows you a place but not where to stand. Google Lens names the landmark in a second. The standing spot, the direction and the zoom are still guesswork, so people ask strangers online, message photographers who often won't say, or walk around until the shot lines up. Even at the right corner, a phone on 1x gets a different picture when the original was shot from farther back with a longer lens.

Pitch line: **Google Lens tells you what's in the photo. Tessera tells you where to stand.**

## Who has it

**People recreating a family or trip photo.** r/PastAndPresentPics and r/OldPhotosInRealLife are full of "same spot, years later" posts with thousands of upvotes.
- "It took a lot of searching, but my fiancé and I finally found the same spot in Central Park where my grandparents took this photo" (874 upvotes): https://reddit.com/r/PastAndPresentPics/comments/bqhglp/
- A widower, 2026: "I really want to find this spot so I can return to it, sit exactly there, and remember my soulmate" (843 upvotes): https://reddit.com/r/whereisthis/comments/1wx1wae/
- A student recreating her late grandmother's FIT graduation photo "can't nail the cross streets": https://reddit.com/r/AskNYC/comments/18mo1uc/
- "Me in Times Square today vs my grandpa in the exact same spot in the 70s" (3,125 upvotes): https://reddit.com/r/OldPhotosInRealLife/comments/16sw5vu/

**Travelers chasing a photo they saw.**
- Guides to our demo shot, the Manhattan Bridge from Washington St in DUMBO, disagree on the block: Water to Front, or Water to Plymouth, depending on how big you want the bridge. https://triptins.com/manhattan-bridge-view-spot-dumbo/ and https://www.yelp.com/biz/dumbo-manhattan-bridge-view-brooklyn
- A parent on r/AskNYC asking how to recreate a Rockefeller Center photo for her daughter's wall, and whether the public can even reach that level: https://reddit.com/r/AskNYC/comments/qdh8gc/
- r/AskNYC alone has dozens of "where exactly was this photo taken" posts.

**Photographers delivering a reference shot.**
- A wedding photographer with 10+ years can't find the spot in her sister's elopement photos and can't scout first, so she asks whether it's rude to ask the original photographer (2025, 45 comments). Replies say photographers often keep spots private: https://reddit.com/r/WeddingPhotography/comments/1hr7i2c/
- A couple asked for a specific shot and the photographer "just couldn't get the focal length/settings right" (2026, 1,215 upvotes, 198 comments): https://reddit.com/r/AskPhotography/comments/1wpvtk0/

**The lens part is real too.** A beginner asks how to get the "lens compression" look on an iPhone: https://reddit.com/r/AskPhotography/comments/1t41oux/. A gallery hears "that view doesn't look like that!" often, because phones default to a wide lens: https://www.verdunhouse.co.uk/blog-1/that-doesnt-look-right

## What exists, and the gap

| Tool | What it does | Why it doesn't solve this |
|---|---|---|
| Google Lens, GeoSpy, whereisthis.place and similar | Names the landmark or city | A geolocation vendor's own blog: the landmark's position is not where the photographer stood; it says to match angles in Street View by hand. https://geospys.com/blog/can-google-lens-find-location |
| Locationscout (233k spots), PhotoHound | Directory of photo spots | Only works if someone posted that exact spot |
| PhotoPills | Plans sun and moon | Assumes you already know where you'll stand (its Find tool: "you know from where you wish to take the photo") https://www.photopills.com/user-guide |
| Vantage Point, GhostViewer, rePhoto | Ghost overlay of the old photo on your camera | Helps only once you're already at the spot https://ghostviewer.co.uk/all-posts/features/rephotography-alignment-guide/ |

Tessera does the step between them: photo to standing spot, heading and lens. Then the scout page's ghost overlay covers the last meters and the sun planner picks the light.

## Questions judges may ask

- **Won't this crowd fragile spots?** Photographers keep spots private because shared spots get trashed and closed (the wedding thread, https://www.responsiblephoto.com/blog/thinking-twice-before-sharing-locations). Tessera maps only public spots that are already famous. The DUMBO view is a city street with its own visitor website.
- **Stalking?** GeoSpy closed public access in January 2025 after users asked it to find specific women (404 Media, via https://www.malwarebytes.com/blog/news/2025/01/ai-tool-geospy-analyzes-images-and-identifies-locations-in-seconds). Tessera can't place a photo anywhere we haven't mapped, and Nemotron safety screens every upload.

## Where the evidence is weak

- **"A group chat full of screenshots."** The closest Reddit thread (saved travel reels) got replies of "No" and "Is this market research". Keep group planning as a feature, not the problem.
- **Old prints.** The family-photo stories are the strongest emotion, but the solver is tested only on modern color photos of DUMBO. A 1940s print shows a different city. Say "a photo from your parents' trip", not "your grandparents' 1940s photo", unless it is tested.
- **Survey numbers are old or vendor-run.** The newest named one: Bitkom (Germany, 2025), 53% of holidaymakers who use social media were inspired to take a trip by it in the past year, and 49% said the place didn't live up to the photos.
