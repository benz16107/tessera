# Research: what people ask about a photo of a place

Sources for the problem section on the Devpost and the site's research page (https://tesseraphoto.com/docs/research/). Every count below comes from the files named here. Every quote is copied from the post or reply it cites, with only curly quote marks changed to straight ones.

## Method

- **Source.** The Arctic Shift archive of Reddit (https://arctic-shift.photon-reddit.com), searched on Sat Nov 7, 2026. reddit.com blocks scripted reads from our machines, so the searches used the archive's API with a 5 s pause between calls.
- **Searches.** 43 phrase searches in 18 subreddits, such as "exact spot" in r/whereisthis, "what focal length" in r/AskPhotography and "manhattan bridge photo" in r/AskNYC. 32 searches returned posts; 11 returned an error or nothing. Each search returns at most 100 posts, newest first, so the sample leans recent. The scripts and their logs are `reddit.py`, `reddit.log`, `reddit2.py` and `reddit2.log` in `~/Code/scratch/shotmatch-problem/` on linuxbox.
- **Posts.** 2,037 results, **1,949 unique posts** from **15 subreddits**, dated Mar 20, 2011 to Nov 8, 2026. Bodies were saved up to 600 characters.
- **Reading.** Four AI reading passes (Claude Sonnet, one per quarter of the posts) read the title and body of every post and tagged it against the three questions below, quoting the poster's words. The tags were then re-checked post by post against a stricter rule, and same-author reposts were merged. The tagged lists and the checking script are in `~/Code/scratch/shotmatch-agents/research-work/` (`classify1.json` to `classify4.json`, `final.py`, `final.json`).
- **Rule.** A post counts only if the poster asks, about a specific photo or shot:
  1. **Spot:** where the photographer stood, or how to find a photo's exact spot so they can stand there. "What city is this?" does not count; Google Lens already answers that.
  2. **Lens:** what lens, focal length or zoom made a shot, or why their own attempt looks different.
  3. **Recreate:** how to recreate a specific shot at a place, or how to time it for the light. Studio, editing and "this style" questions do not count.
- **Re-check.** Every picked post was fetched again from Arctic Shift on Nov 8, 2026 (`recheck1.json`, `recheck2.json`), then opened on old.reddit.com in Ben's browser for the screenshots. Points and comment counts below are what old.reddit.com showed at about 4 AM CT on Nov 8, 2026; they move by a few points between page loads. One candidate, r/photography 1ugdwub ("Recreating a shot from the exact same spot?"), has since been deleted by its author, so it is counted but not quoted.

## Counts

| | Posts |
|---|---|
| Unique posts read | 1,949 |
| Asked at least one of the three questions | **103** (8 same-author reposts merged) |
| Asked for the exact spot | **79** |
| Asked about the lens, or why their attempt looks different | **22** |
| Asked how to recreate a specific shot | **28**, of which 2 asked about the light |
| Asked for the spot or the lens | **101** |
| Subreddits the 103 came from | 7: r/whereisthis 68, r/AskPhotography 18, r/photography 6, r/AskNYC 6, r/OldPhotosInRealLife 2, r/photocritique 2, r/WeddingPhotography 1 |
| Dates of the 103 | Feb 1, 2016 to Nov 6, 2026; 86 from 2026 |

A post can ask more than one question, so the three rows add up to more than 103.

The reading passes also tagged 155 posts that asked only which place a photo shows and 171 that showed a photo already recreated at the same spot (r/PastAndPresentPics, r/OldPhotosInRealLife). Neither group asks one of the three questions, so neither is in the 103, and these two counts were not re-checked post by post.

## The picked posts

Screenshots are in `site/public/research/`, served at https://tesseraphoto.com/research/. Usernames are blurred, and post photos and thumbnails are hidden, because some show people's faces.

| # | Question | Subreddit, date | Points, comments | Quote | Link | Screenshot |
|---|---|---|---|---|---|---|
| 1 | Spot | r/whereisthis, Oct 4, 2026 | 858, 37 | "I really want to find this spot so I can return to it, sit exactly there, and remember my soulmate." | https://www.reddit.com/r/whereisthis/comments/1wx1wae/ | `1-whereisthis.png` |
| 2 | Spot, recreate | r/whereisthis, Sep 9, 2026 | 590, 39 | "Could anybody please help locate where this photo was taken in the early 90s in Manhattan. We would like to re-create it as adults." | https://www.reddit.com/r/whereisthis/comments/1wbtjkw/ | `2-whereisthis.png` |
| 3 | Spot, recreate | r/AskNYC, Dec 20, 2023 | 37, 21 | "I want to recreate the photo since I am graduating in Spring, but I can't nail the cross streets since its been ~50 years." | https://www.reddit.com/r/AskNYC/comments/18mo1uc/ | `3-asknyc.png` |
| 4 | Spot | r/WeddingPhotography, Jan 1, 2025 | 21, 45 | "I really want to deliver for my sister and find that location for her." and "*I have a good idea of what section of the park it is in thanks to Google earth research" | https://www.reddit.com/r/WeddingPhotography/comments/1hr7i2c/ | `4-weddingphotography.png` |
| 5 | Spot, recreate | r/photography, Oct 9, 2018 | 6, 32 | "GPS isnt accurate enough is it, and even so that only gives me location, not the exact angle" | https://www.reddit.com/r/photography/comments/9mrjxk/ | `5-photography.png` |
| 6 | Lens, recreate | r/AskNYC, Oct 22, 2021 | 6, 9 | "Can a single wide angle image create this? I don't think so because the compression won't be the same." | https://www.reddit.com/r/AskNYC/comments/qdh8gc/ | `6-asknyc.png` |
| 7 | Lens | r/AskPhotography, May 5, 2026 | 2, 10 | "the photos on my iPhone make the distant buildings seem 4x father away than what my eyes see." | https://www.reddit.com/r/AskPhotography/comments/1t41oux/ | `7-askphotography.png` |
| 8 | Recreate, light | r/AskPhotography, Jun 11, 2026 | 4, 13 | "Golden hour is ideal but will the sun even hit this spot at that time? Is there a world where the sun will set or rise behind the bridge from this angle?" | https://www.reddit.com/r/AskPhotography/comments/1u386p6/ | `8-askphotography.png` |

Notes on the picks:

- **#1** was solved in the replies (Powers Lookout, Victoria). The poster went and wrote back: "I ended up sitting on the rock that was off the path through a short bit of bush. It looked very close to the angle in the original photo." The place had a name; the spot was found on foot.
- **#3**: a stranger recognized Carnegie Hall (57th St and 7th Ave). The poster replied "ive been searching for a year".
- **#6** asks the same question Tessera answers with the 35 mm equivalent: the poster is unsure whether 12 mm, 70 mm or 200 mm made the shot.
- **#8** is at Jay St and Prospect St in DUMBO, a few blocks from our demo spot, and asks "If there is anyone into sun stuff and familiar with DUMBO".
- **Not picked:** r/AskPhotography 1wpvtk0 ("I just couldn't get the focal length/settings right", 1,215 points, the most upvoted match) is counted under lens and recreate, but the shot is a portrait framed through a ring, not a place, so we don't lead with it. The site's Why Tessera page still cites it.

## Why the tools people already use don't solve it

From the replies in these threads, plus one guide to our demo spot:

1. **Maps name the area, not the spot.** The wedding photographer in #4 already knew "what section of the park it is in thanks to Google earth research" and still had to ask strangers. In #2 a reply that found the corner said "Hard to get exactly angle from Google Maps". In #3 the solver wrote "it took a while to figure out how to get Google Street view to show the same or a very similar perspective."
2. **AI place-finders and strangers guess.** In r/whereisthis 1w7ubaw ("I know where this is, but where was I?"), the poster wrote: "Google AI identifies this as a view of the Victoria St. bridge (long gone), taken from the roof of the old Health & Welfare building on George St. In my opinion this doesn't fit". Replies proposed other buildings, and the poster settled on "the most probable location". https://www.reddit.com/r/whereisthis/comments/1w7ubaw/
3. **Spot guides list blocks, not standing spots or lenses.** The triptins guide to the Manhattan Bridge view on Washington St splits the street into three blocks (Plymouth to Water, Water to Front, Front to York), each framing the bridge differently, and names no focal length. https://triptins.com/manhattan-bridge-view-spot-dumbo/ (read Nov 8, 2026)
4. **Sun apps work once you stand there.** Replies to #8 suggested Sun Seeker ("as long as the phone is aimed at the building you can see where the sun will sit") and PhotoPills. The poster asked back: "Does it register which buildings will be blocking the sun at current times?" and added "I have not actually visited the location yet".

Tessera works from the photo itself: it solves the standing spot, the heading and the lens against a 3D model of the place, then plans the light and the people on that spot.

## Limits

- Keyword searches, newest first, at most 100 posts each: this is a sample of who asks, not a measure of how many people have the problem.
- The reading passes were done by an AI model, and the match rule was applied once more post by post; borderline posts were left out rather than counted.
- Bodies longer than 600 characters were read only up to that point in the counts. The screenshots show the live text.
