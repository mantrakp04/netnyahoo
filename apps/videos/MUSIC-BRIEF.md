# Music brief: Netnyahoo launch film

A one-page brief for a composer replacing or re-producing the score. The edit is locked to the beat grid below; `src/lib/nn-launch/cuts.json` is the source of truth for every beat (this page was generated from it).

## Tempo, key, feel

- **Tempo: 128.57143 BPM, 4/4.** One beat = 14 frames at 30 fps = 0.466667 s = 22,400 samples at 48 kHz. One bar = 56 frames. The tempo never changes.
- **Key: F minor.** Progression used so far: Fm, Db, Ab, Eb (one chord a bar).
- **Feel: a campaign-rally anthem.** Big brass stabs as the hook, a marching snare, drum-machine drops, a hard stop before the second drop, a huge end hit. It accompanies a satirical product film, so it should feel triumphant and a little over the top, never menacing.

## Launch: 96 beats (24 bars, 0:44.80, 1344 frames)

| Bars | Beats | Time | Section | What happens |
| --- | --- | --- | --- | --- |
| 1–2 | 0–7 | 0:00.00–0:03.73 | Hook | Bar 1: four brass stabs on the beats with a kick, nothing else. Bar 2: march-snare roll, timpani roll, cymbal swell and riser building to the drop; no kick. |
| 3–10 | 8–39 | 0:03.73–0:18.67 | Drop A | Four-on-the-floor. Its first two bars are half-time and filtered open; from bar 3 the full groove: riff, bass, hats. A fill every fourth bar. Clearly smaller than drop B. |
| 11–12 | 40–47 | 0:18.67–0:22.40 | Break | The fill lands on its downbeat, then it falls away: a held, dark chord, a muted heartbeat kick, echoing plucks, then a roll and swell building to the silence. |
| 13–20 | 48–79 | 0:22.40–0:37.33 | Drop B | The biggest section: a big hit exactly on its downbeat, the full groove plus a lead line, open hats, octave brass. |
| 21–24 | 80–95 | 0:37.33–0:44.80 | End | A huge hit on the downbeat (stab, kick, crash, low drums), the chord rings; march-snare taps, a final button, then everything rings out to silence. |

Fixed points (beat, time, frame):

- beat 0 · 0:00.00 · frame 0: Hook downbeat
- beat 8 · 0:03.73 · frame 112: Drop A downbeat
- beat 40 · 0:18.67 · frame 560: Break downbeat
- beat 47 · 0:21.93 · frame 658: **digital silence until beat 48** (every bus, reverb tails included)
- beat 48 · 0:22.40 · frame 672: Drop B downbeat
- beat 68 · 0:31.73 · frame 952: NO run starts: kick-and-hit on every beat, no bass or hats, until beat 71
- beat 71 · 0:33.13 · frame 994: slam back (crash, everything returns): the "OPEN SOURCE" card
- beat 80 · 0:37.33 · frame 1120: End downbeat
- beat 88 · 0:41.07 · frame 1232: march-snare tap
- beat 89 · 0:41.53 · frame 1246: march-snare tap
- beat 90 · 0:42.00 · frame 1260: march-snare tap
- beat 91 · 0:42.47 · frame 1274: final button (short tutti stab, kick, timpani)
- beat 96 · 0:44.80 · frame 1344: file ends; the music must have rung down to silence (below -60 dBFS) by here

Sound effects (mixed into the score; each lands on its beat; a swipe peaks 0.16 s after its cue):

| Beat | Time | Frame | Kind |
| --- | --- | --- | --- |
| 4 | 0:01.87 | 56.0 | stamp |
| 5 | 0:02.33 | 70.0 | stamp |
| 6 | 0:02.80 | 84.0 | stamp |
| 6.5 | 0:03.03 | 91.0 | stamp |
| 7.1 | 0:03.31 | 99.4 | pop |
| 7.85 | 0:03.66 | 109.9 | whoosh |
| 10 | 0:04.67 | 140.0 | stamp |
| 12.5 | 0:05.83 | 175.0 | click |
| 13.5 | 0:06.30 | 189.0 | click |
| 14.5 | 0:06.77 | 203.0 | click |
| 15.5 | 0:07.23 | 217.0 | click |
| 18.41 | 0:08.59 | 257.7 | swipe |
| 19.91 | 0:09.29 | 278.7 | swipe |
| 21.41 | 0:09.99 | 299.7 | swipe |
| 31 | 0:14.47 | 434.0 | pop |
| 36 | 0:16.80 | 504.0 | click |
| 36.5 | 0:17.03 | 511.0 | click |
| 49.16 | 0:22.94 | 688.2 | swipe |
| 50.66 | 0:23.64 | 709.2 | swipe |
| 52.16 | 0:24.34 | 730.2 | swipe |
| 53.66 | 0:25.04 | 751.2 | swipe |
| 60 | 0:28.00 | 840.0 | click |
| 61.5 | 0:28.70 | 861.0 | stamp |
| 72.6714–75.9286 | 0:33.91–0:35.43 | 1017.4–1063.0 | key ×13, every 0.2715 beat (typing) |
| 76.2 | 0:35.56 | 1066.8 | click |
| 78.3 | 0:36.54 | 1096.2 | whoosh |

## Teaser: 32 beats (8 bars, 0:14.93, 448 frames)

| Bars | Beats | Time | Section | What happens |
| --- | --- | --- | --- | --- |
| 1–2 | 0–7 | 0:00.00–0:03.73 | Hook | Bar 1: four brass stabs on the beats with a kick, nothing else. Bar 2: march-snare roll, timpani roll, cymbal swell and riser building to the drop; no kick. |
| 3–6 | 8–23 | 0:03.73–0:11.20 | Drop B | The biggest section: a big hit exactly on its downbeat, the full groove plus a lead line, open hats, octave brass. |
| 7–8 | 24–31 | 0:11.20–0:14.93 | End | A huge hit on the downbeat (stab, kick, crash, low drums), the chord rings; march-snare taps, a final button, then everything rings out to silence. |

Fixed points (beat, time, frame):

- beat 0 · 0:00.00 · frame 0: Hook downbeat
- beat 7 · 0:03.27 · frame 98: **digital silence until beat 8** (every bus, reverb tails included)
- beat 8 · 0:03.73 · frame 112: Drop B downbeat
- beat 20 · 0:09.33 · frame 280: NO run starts: kick-and-hit on every beat, no bass or hats, until beat 23
- beat 23 · 0:10.73 · frame 322: slam back (crash, everything returns): the "OPEN SOURCE" card
- beat 24 · 0:11.20 · frame 336: End downbeat
- beat 28 · 0:13.07 · frame 392: final button (short tutti stab, kick, timpani)
- beat 32 · 0:14.93 · frame 448: file ends; the music must have rung down to silence (below -60 dBFS) by here

Sound effects (mixed into the score; each lands on its beat; a swipe peaks 0.16 s after its cue):

| Beat | Time | Frame | Kind |
| --- | --- | --- | --- |
| 4 | 0:01.87 | 56.0 | stamp |
| 5 | 0:02.33 | 70.0 | stamp |
| 6 | 0:02.80 | 84.0 | stamp |
| 6.5 | 0:03.03 | 91.0 | stamp |
| 7.1 | 0:03.31 | 99.4 | pop (inside the silent window: muted) |
| 7.85 | 0:03.66 | 109.9 | whoosh (inside the silent window: muted) |
| 10.66 | 0:04.97 | 149.2 | swipe |
| 12.16 | 0:05.67 | 170.2 | swipe |
| 13.66 | 0:06.37 | 191.2 | swipe |
| 15.16 | 0:07.07 | 212.2 | swipe |
| 16.66 | 0:07.77 | 233.2 | swipe |

## Delivery

- 48 kHz, 24-bit WAV, stereo; one file per cut, exactly the cut's length (launch 0:44.80, teaser 0:14.93), starting on beat 0.
- Stems as 48 kHz WAVs of the same length: drums, bass, brass/hits, everything else, sound effects.
- Master: -11 LUFS integrated, true peak at or below -1 dBTP on delivery (we master the WAV to -1.6 dBTP so the AAC encode stays under -1).
- Top end: roughly 1–2% of the energy above 8 kHz; low end: no more than about 20% below 60 Hz.

## Exact vs free

**Must stay exact (the picture cuts on them):** the tempo and beat grid; every section downbeat; the drop-B hit and the end hit; the taps and the final button; the silent window (true digital zero, no tails); the NO-run hits and the slam back; every sound-effect beat; the file length and the ring-out to silence.

**Free:** melody, harmony within F minor, instrumentation and sound design, the fills, anything between the fixed points, and timing feel on inner notes (players may sit a few ms off the grid between the fixed points).
