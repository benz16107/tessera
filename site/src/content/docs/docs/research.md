---
title: Research
description: We read 1,949 Reddit posts. 103 asked where a photo was taken from, which lens made it, or how to recreate it. Their words, with screenshots.
---

## What we did

We searched Reddit for people asking about a photo of a place: 43 searches in 18 subreddits, such as "exact spot" in r/whereisthis and "what focal length" in r/AskPhotography. We read **1,949 posts** from **15 subreddits**, dated 2011 to November 2026, and kept a post only if the poster asked one of three questions about a specific photo:

1. Where did the photographer stand, or where exactly is this spot?
2. What lens or zoom made this shot, or why does my attempt look different?
3. How do I recreate this shot here, or time it for the light?

"What city is this?" did not count, because Google Lens already answers it.

## What we found

| Question | Posts |
|---|---|
| Asked at least one of the three | **103** |
| Asked for the exact spot | **79** |
| Asked about the lens, or why their attempt looks different | **22** |
| Asked how to recreate a specific shot | **28** (2 about the light) |

The 103 came from 7 subreddits, 68 of them from r/whereisthis, and 86 were posted in 2026. A post can ask more than one question.

## In their own words

Points and comments as shown on Reddit on Nov 8, 2026. Usernames are blurred and post photos are hidden.

- **"I really want to find this spot so I can return to it, sit exactly there, and remember my soulmate."** A grieving husband with a 1998 photo. [r/whereisthis](https://www.reddit.com/r/whereisthis/comments/1wx1wae/), 858 points, 37 comments.

  ![r/whereisthis post: Pleaee help a grieving husband find this location, 858 points](/research/1-whereisthis.png)

- **"We would like to re-create it as adults."** A family photo from early-90s Manhattan. [r/whereisthis](https://www.reddit.com/r/whereisthis/comments/1wbtjkw/), 590 points, 39 comments.

  ![r/whereisthis post asking where an early-90s Manhattan photo was taken, 590 points](/research/2-whereisthis.png)

- **"I can't nail the cross streets since its been ~50 years."** Recreating a late grandmother's graduation photo in New York. A stranger found the corner; the poster had been "searching for a year". [r/AskNYC](https://www.reddit.com/r/AskNYC/comments/18mo1uc/), 37 points, 21 comments.

  ![r/AskNYC post: help me find where this photo was taken, 37 points](/research/3-asknyc.png)

- **"I really want to deliver for my sister and find that location for her."** A wedding photographer of 10+ years who already knew the section of the park from Google Earth. [r/WeddingPhotography](https://www.reddit.com/r/WeddingPhotography/comments/1hr7i2c/), 21 points, 45 comments.

  ![r/WeddingPhotography post: Would it be offensive to ask a photographer for an exact photo location?](/research/4-weddingphotography.png)

- **"GPS isnt accurate enough is it, and even so that only gives me location, not the exact angle"** [r/photography](https://www.reddit.com/r/photography/comments/9mrjxk/), 6 points, 32 comments.

  ![r/photography post: Taking photos from the exact same spot/angle years apart?](/research/5-photography.png)

- **"Can a single wide angle image create this? I don't think so because the compression won't be the same."** A parent planning a Rockefeller Center shot, unsure between 12, 70 and 200 mm. [r/AskNYC](https://www.reddit.com/r/AskNYC/comments/qdh8gc/), 6 points, 9 comments.

  ![r/AskNYC post: Any photographers willing to give advice on a specific photo?](/research/6-asknyc.png)

- **"the photos on my iPhone make the distant buildings seem 4x father away than what my eyes see."** [r/AskPhotography](https://www.reddit.com/r/AskPhotography/comments/1t41oux/), 2 points, 10 comments.

  ![r/AskPhotography post about getting a lens compression look on an iPhone](/research/7-askphotography.png)

- **"Golden hour is ideal but will the sun even hit this spot at that time?"** A product photographer at Jay St in DUMBO, a few blocks from our demo spot. [r/AskPhotography](https://www.reddit.com/r/AskPhotography/comments/1u386p6/), 4 points, 13 comments.

  ![r/AskPhotography post: What time of day should I shoot this at?, about the sun at Jay St in DUMBO](/research/8-askphotography.png)

## Why the usual tools fall short

- **Maps name the area, not the spot.** The wedding photographer knew "what section of the park it is in thanks to Google earth research" and still asked strangers. A reply on the Manhattan post: "Hard to get exactly angle from Google Maps".
- **AI place-finders and strangers guess.** "Google AI identifies this as a view of the Victoria St. bridge (long gone), taken from the roof of the old Health & Welfare building on George St. In my opinion this doesn't fit" ([r/whereisthis](https://www.reddit.com/r/whereisthis/comments/1w7ubaw/)).
- **Spot guides list blocks.** The [triptins guide](https://triptins.com/manhattan-bridge-view-spot-dumbo/) to the Manhattan Bridge view splits Washington St into three blocks that each frame the bridge differently, and names no lens.
- **Sun apps work once you stand there.** Replies to the DUMBO post suggested Sun Seeker and PhotoPills. The poster: "Does it register which buildings will be blocking the sun at current times?"

Tessera works from the photo itself. It solves the standing spot, the heading and the lens against a 3D model of the place, then plans the light and the people on that spot. See [Why Tessera](/docs/why-tessera/) and [how the solve works](/docs/how-it-works/solve/).

## Limits

These were keyword searches that return the newest 100 posts each, so the counts show who asks, not how many people have the problem. An AI model did the first reading pass, and every match was checked again against the rule above; borderline posts were left out. The full method, every count and every source are in `docs/RESEARCH.md` in the repo.
