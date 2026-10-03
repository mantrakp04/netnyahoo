# Score samples

Every recorded sample `score.py` plays, and where it comes from. All three libraries are released under
**CC0 1.0** (a public domain dedication): no attribution or royalty is required, commercial use included.
`fetch-samples.sh` downloads exactly these files, pinned to the commits below, into `public/music/samples/`
(gitignored) and checks each against its git blob hash. A local path is the library prefix plus the upstream path.

| Library | Author | Repository @ commit | Licence | Used for |
| --- | --- | --- | --- | --- |
| VSCO 2 Community Edition (`vsco/`) | Versilian Studios | [sgossner/VSCO-2-CE](https://github.com/sgossner/VSCO-2-CE) @ `440300901dfe` | [CC0 1.0](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/LICENSE) | Brass (trumpet, F horn, tenor trombone, tuba: staccato in two dynamic layers with round robins, and sustains), timpani, concert bass drum, orchestral snare, clash and suspended cymbals, gong |
| Versilian Community Sample Library (VCSL) (`vcsl/`) | Versilian Studios | [sgossner/VCSL](https://github.com/sgossner/VCSL) @ `c1ea7bcc3c73` | [CC0 1.0](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/LICENSE) | Rope-tension march snare, hand claps, tom, slapstick, woodblock |
| MckSamplePacks (TR-8 recordings) (`mck/`) | MckAudio | [MckAudio/MckSamplePacks](https://github.com/MckAudio/MckSamplePacks) @ `5db40e8fe267` | [CC0 1.0](https://github.com/MckAudio/MckSamplePacks/blob/5db40e8fe26785c256845a5bb38921b2654a887f/LICENSE) | 909 kick, clap, closed and open hats recorded from a Roland TR-8 by the repository's author |

MckSamplePacks holds recordings of the author's own TR-8 (a drum machine that models the 808 and 909 circuits),
which the author released as CC0. Only the 909 kick, clap and hats are used, under the orchestral layers.

A few VSCO files measure off their named pitch and are never played (`EXCLUDE` in `score.py`); none of them
are fetched.

Synthesized in `score.py`, not sampled: the sine sub under the kick and the bass, the filtered-noise riser, the
noise layer of the whoosh and swipe effects, and the reverb impulse responses.

## VSCO 2 Community Edition

Commit [`440300901dfe9275fd84e0b7763af1f8443ae62e`](https://github.com/sgossner/VSCO-2-CE/tree/440300901dfe9275fd84e0b7763af1f8443ae62e), [LICENSE](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/LICENSE) (CC0 1.0 Universal).

| File (local path `vsco/` + this) | Git blob |
| --- | --- |
| [Brass/F Horn/stac/MOHorn_stac_A2_v2_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_A2_v2_rr1.wav) | `6a8e9210be` |
| [Brass/F Horn/stac/MOHorn_stac_A2_v2_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_A2_v2_rr2.wav) | `b23c4741a1` |
| [Brass/F Horn/stac/MOHorn_stac_A2_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_A2_v3_rr1.wav) | `81272129a1` |
| [Brass/F Horn/stac/MOHorn_stac_A2_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_A2_v3_rr2.wav) | `8dc8428dc7` |
| [Brass/F Horn/stac/MOHorn_stac_C3_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_C3_v3_rr2.wav) | `f7c9a73161` |
| [Brass/F Horn/stac/MOHorn_stac_D2_v2_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_D2_v2_rr1.wav) | `d6a5165f41` |
| [Brass/F Horn/stac/MOHorn_stac_D2_v2_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_D2_v2_rr2.wav) | `ebb78e98ca` |
| [Brass/F Horn/stac/MOHorn_stac_D2_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_D2_v3_rr1.wav) | `f86313efe1` |
| [Brass/F Horn/stac/MOHorn_stac_D2_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_D2_v3_rr2.wav) | `c713805a6c` |
| [Brass/F Horn/stac/MOHorn_stac_F2_v2_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_F2_v2_rr1.wav) | `6d312fa649` |
| [Brass/F Horn/stac/MOHorn_stac_F2_v2_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_F2_v2_rr2.wav) | `0cbed0b3f7` |
| [Brass/F Horn/stac/MOHorn_stac_F2_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_F2_v3_rr1.wav) | `be315404c5` |
| [Brass/F Horn/stac/MOHorn_stac_F2_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/stac/MOHorn_stac_F2_v3_rr2.wav) | `1fe4faa584` |
| [Brass/F Horn/sus/MOHorn_sus_A2_v3_1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/sus/MOHorn_sus_A2_v3_1.wav) | `d4088d2990` |
| [Brass/F Horn/sus/MOHorn_sus_C3_v4_1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/sus/MOHorn_sus_C3_v4_1.wav) | `98bc7d3d47` |
| [Brass/F Horn/sus/MOHorn_sus_D2_v4_1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/sus/MOHorn_sus_D2_v4_1.wav) | `e61e2d8284` |
| [Brass/F Horn/sus/MOHorn_sus_F2_v3_1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/F%20Horn/sus/MOHorn_sus_F2_v3_1.wav) | `af9345753c` |
| [Brass/Tenor Trombone/stac/tenortbn_stac_A#1_v4_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/stac/tenortbn_stac_A%231_v4_rr1.wav) | `9947fab681` |
| [Brass/Tenor Trombone/stac/tenortbn_stac_A#1_v4_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/stac/tenortbn_stac_A%231_v4_rr2.wav) | `d323f7ba3d` |
| [Brass/Tenor Trombone/stac/tenortbn_stac_A#2_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/stac/tenortbn_stac_A%232_v3_rr1.wav) | `ce149164e8` |
| [Brass/Tenor Trombone/stac/tenortbn_stac_A#2_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/stac/tenortbn_stac_A%232_v3_rr2.wav) | `56fd039619` |
| [Brass/Tenor Trombone/stac/tenortbn_stac_A#2_v4_r2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/stac/tenortbn_stac_A%232_v4_r2.wav) | `df7df76b2d` |
| [Brass/Tenor Trombone/stac/tenortbn_stac_A#2_v4_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/stac/tenortbn_stac_A%232_v4_rr1.wav) | `8d68825cf7` |
| [Brass/Tenor Trombone/stac/tenortbn_stac_F2_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/stac/tenortbn_stac_F2_v3_rr1.wav) | `15d871a428` |
| [Brass/Tenor Trombone/stac/tenortbn_stac_F2_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/stac/tenortbn_stac_F2_v3_rr2.wav) | `00a9f62332` |
| [Brass/Tenor Trombone/stac/tenortbn_stac_F2_v4_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/stac/tenortbn_stac_F2_v4_rr1.wav) | `1ccb564b75` |
| [Brass/Tenor Trombone/stac/tenortbn_stac_F2_v4_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/stac/tenortbn_stac_F2_v4_rr2.wav) | `86b845ae3d` |
| [Brass/Tenor Trombone/sus/tenortbn_sus_C#3_v3_1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/sus/tenortbn_sus_C%233_v3_1.wav) | `dfb869ad2e` |
| [Brass/Tenor Trombone/sus/tenortbn_sus_C3_v3_1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/sus/tenortbn_sus_C3_v3_1.wav) | `a91b32be15` |
| [Brass/Tenor Trombone/sus/tenortbn_sus_D#3_v3_1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/sus/tenortbn_sus_D%233_v3_1.wav) | `cb97ac4136` |
| [Brass/Tenor Trombone/sus/tenortbn_sus_D2_v3_1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/sus/tenortbn_sus_D2_v3_1.wav) | `eef36ce79c` |
| [Brass/Tenor Trombone/sus/tenortbn_sus_F2_v3_1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/sus/tenortbn_sus_F2_v3_1.wav) | `f6c1025383` |
| [Brass/Tenor Trombone/sus/tenortbn_sus_F3_v3_1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tenor%20Trombone/sus/tenortbn_sus_F3_v3_1.wav) | `c6164474ba` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_A#3_v2_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A%233_v2_rr1.wav) | `2da16b369e` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_A#3_v2_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A%233_v2_rr2.wav) | `eed06e0833` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_A#3_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A%233_v3_rr1.wav) | `b7f7665255` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_A#3_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A%233_v3_rr2.wav) | `df3b1287a8` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_A4_v2_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A4_v2_rr1.wav) | `e756e2573b` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_A4_v2_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A4_v2_rr2.wav) | `c0822dbc84` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_A4_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A4_v3_rr1.wav) | `756e786aea` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_A4_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A4_v3_rr2.wav) | `816cb43dc8` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_C5_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_C5_v3_rr1.wav) | `059a10515d` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_C5_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_C5_v3_rr2.wav) | `371b3c89b5` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_D#3_v2_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D%233_v2_rr1.wav) | `a88c16c3a4` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_D#3_v2_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D%233_v2_rr2.wav) | `2087047717` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_D#3_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D%233_v3_rr1.wav) | `77d17d832a` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_D#3_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D%233_v3_rr2.wav) | `427677a8e7` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_D4_v2_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D4_v2_rr1.wav) | `80d482935d` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_D4_v2_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D4_v2_rr2.wav) | `282b1bf9c7` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_D4_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D4_v3_rr1.wav) | `f1fe807445` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_D4_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D4_v3_rr2.wav) | `87e437363c` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_F3_v2_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F3_v2_rr1.wav) | `403be9ea23` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_F3_v2_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F3_v2_rr2.wav) | `48a91912f8` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_F3_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F3_v3_rr1.wav) | `5b5082d93e` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_F3_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F3_v3_rr2.wav) | `3e1d8c464a` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_F4_v2_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F4_v2_rr1.wav) | `2cde793a0c` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_F4_v2_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F4_v2_rr2.wav) | `01719dfe7b` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_F4_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F4_v3_rr1.wav) | `0c64406f6c` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_F4_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F4_v3_rr2.wav) | `e8363c0ab1` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_G3_v2_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_G3_v2_rr1.wav) | `0b6142ebe6` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_G3_v2_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_G3_v2_rr2.wav) | `6ff7612abe` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_G3_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_G3_v3_rr1.wav) | `53ef5d48ac` |
| [Brass/Trumpet/stac/Sum_SHTrumpet_stac_G3_v3_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/stac/Sum_SHTrumpet_stac_G3_v3_rr2.wav) | `3e581ffda8` |
| [Brass/Trumpet/sus/Sum_SHTrumpet_sus_A#3_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/sus/Sum_SHTrumpet_sus_A%233_v3_rr1.wav) | `f6b2753da2` |
| [Brass/Trumpet/sus/Sum_SHTrumpet_sus_A4_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/sus/Sum_SHTrumpet_sus_A4_v3_rr1.wav) | `bbdc0773c6` |
| [Brass/Trumpet/sus/Sum_SHTrumpet_sus_D4_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/sus/Sum_SHTrumpet_sus_D4_v3_rr1.wav) | `815560ece9` |
| [Brass/Trumpet/sus/Sum_SHTrumpet_sus_F4_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/sus/Sum_SHTrumpet_sus_F4_v3_rr1.wav) | `cb508c5bf2` |
| [Brass/Trumpet/sus/Sum_SHTrumpet_sus_G3_v3_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Trumpet/sus/Sum_SHTrumpet_sus_G3_v3_rr1.wav) | `a301819024` |
| [Brass/Tuba/stac/Tuba3_stac_A#1_v2_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_A%231_v2_rr1_Sum.wav) | `6f9f8d7fdb` |
| [Brass/Tuba/stac/Tuba3_stac_A#1_v2_rr2_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_A%231_v2_rr2_Sum.wav) | `f9cd9ddaf2` |
| [Brass/Tuba/stac/Tuba3_stac_A#1_v2_rr3_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_A%231_v2_rr3_Sum.wav) | `ccd37e6e92` |
| [Brass/Tuba/stac/Tuba3_stac_A#1_v2_rr4_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_A%231_v2_rr4_Sum.wav) | `677194bbc2` |
| [Brass/Tuba/stac/Tuba3_stac_A#2_v1_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_A%232_v1_rr1_Sum.wav) | `cb59b84d99` |
| [Brass/Tuba/stac/Tuba3_stac_A#2_v1_rr2_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_A%232_v1_rr2_Sum.wav) | `cebcdb351a` |
| [Brass/Tuba/stac/Tuba3_stac_A#2_v1_rr3_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_A%232_v1_rr3_Sum.wav) | `f15c6feae5` |
| [Brass/Tuba/stac/Tuba3_stac_A#2_v1_rr4_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_A%232_v1_rr4_Sum.wav) | `595c830ba9` |
| [Brass/Tuba/stac/Tuba3_stac_D#1_v2_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_D%231_v2_rr1_Sum.wav) | `950438ecb7` |
| [Brass/Tuba/stac/Tuba3_stac_D#1_v2_rr2_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_D%231_v2_rr2_Sum.wav) | `5a2c37217f` |
| [Brass/Tuba/stac/Tuba3_stac_D#1_v2_rr3_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_D%231_v2_rr3_Sum.wav) | `aa54df144b` |
| [Brass/Tuba/stac/Tuba3_stac_D#1_v2_rr4_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_D%231_v2_rr4_Sum.wav) | `a3d2dce8d8` |
| [Brass/Tuba/stac/Tuba3_stac_D2_v1_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_D2_v1_rr1_Sum.wav) | `acb7dfa38c` |
| [Brass/Tuba/stac/Tuba3_stac_D2_v1_rr2_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_D2_v1_rr2_Sum.wav) | `35ba93540d` |
| [Brass/Tuba/stac/Tuba3_stac_D2_v1_rr3_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_D2_v1_rr3_Sum.wav) | `3910accd1d` |
| [Brass/Tuba/stac/Tuba3_stac_D2_v1_rr4_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_D2_v1_rr4_Sum.wav) | `d40b01368c` |
| [Brass/Tuba/stac/Tuba3_stac_F1_v2_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_F1_v2_rr1_Sum.wav) | `ee1eace963` |
| [Brass/Tuba/stac/Tuba3_stac_F1_v2_rr2_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_F1_v2_rr2_Sum.wav) | `3e2525a304` |
| [Brass/Tuba/stac/Tuba3_stac_F1_v2_rr3_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_F1_v2_rr3_Sum.wav) | `30ccff6f19` |
| [Brass/Tuba/stac/Tuba3_stac_F1_v2_rr4_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_F1_v2_rr4_Sum.wav) | `5e3664e122` |
| [Brass/Tuba/stac/Tuba3_stac_F2_v1_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_F2_v1_rr1_Sum.wav) | `26caa2ef60` |
| [Brass/Tuba/stac/Tuba3_stac_F2_v1_rr2_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_F2_v1_rr2_Sum.wav) | `62aa72ff55` |
| [Brass/Tuba/stac/Tuba3_stac_F2_v1_rr3_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_F2_v1_rr3_Sum.wav) | `183c9dbfbe` |
| [Brass/Tuba/stac/Tuba3_stac_F2_v1_rr4_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/stac/Tuba3_stac_F2_v1_rr4_Sum.wav) | `84acd34a0f` |
| [Brass/Tuba/sus/Tuba3_sus_D#1_v3_rr1_Mid.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/sus/Tuba3_sus_D%231_v3_rr1_Mid.wav) | `d46fa53c16` |
| [Brass/Tuba/sus/Tuba3_sus_F0_v1_rr1_Mid.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/sus/Tuba3_sus_F0_v1_rr1_Mid.wav) | `37e4efffdb` |
| [Brass/Tuba/sus/Tuba3_sus_F1_v3_rr1_Mid.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Brass/Tuba/sus/Tuba3_sus_F1_v3_rr1_Mid.wav) | `73a0b9f07a` |
| [Percussion/BDrumNewhit_v7_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/BDrumNewhit_v7_rr1_Sum.wav) | `93ebf3571c` |
| [Percussion/BDrumNewhit_v7_rr2_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/BDrumNewhit_v7_rr2_Sum.wav) | `b76f283f9f` |
| [Percussion/Snare2-HitSN_v5_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/Snare2-HitSN_v5_rr1_Sum.wav) | `102f740d54` |
| [Percussion/Snare2-HitSN_v5_rr2_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/Snare2-HitSN_v5_rr2_Sum.wav) | `b449ea581c` |
| [Percussion/Snare2-HitSN_v7_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/Snare2-HitSN_v7_rr1_Sum.wav) | `2d1c392104` |
| [Percussion/Snare2-HitSN_v7_rr2_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/Snare2-HitSN_v7_rr2_Sum.wav) | `87d4aee035` |
| [Percussion/Snare2-HitSN_v9_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/Snare2-HitSN_v9_rr1_Sum.wav) | `c39c5e8c2a` |
| [Percussion/Snare2-HitSN_v9_rr2_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/Snare2-HitSN_v9_rr2_Sum.wav) | `f6564fe9bd` |
| [Percussion/Timpani/Rolls/Timpani1_Roll_v5_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/Timpani/Rolls/Timpani1_Roll_v5_rr1_Sum.wav) | `63efbcb554` |
| [Percussion/Timpani/Timpani1_Hit_v3_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/Timpani/Timpani1_Hit_v3_rr1_Sum.wav) | `86d8e078c8` |
| [Percussion/Timpani/Timpani3_Hit_v4_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/Timpani/Timpani3_Hit_v4_rr1_Sum.wav) | `020341b6f2` |
| [Percussion/Timpani/Timpani4_Hit_v4_rr1_Sum.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/Timpani/Timpani4_Hit_v4_rr1_Sum.wav) | `e677f48530` |
| [Percussion/cymbal-crash1_ff_rr1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/cymbal-crash1_ff_rr1.wav) | `2c25cd11c6` |
| [Percussion/cymbal-crash1_ff_rr2.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/cymbal-crash1_ff_rr2.wav) | `00eecfab16` |
| [Percussion/gongHit_fff.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/gongHit_fff.wav) | `2c188f2018` |
| [Percussion/susCymb1-cresc-Short_v1.wav](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/Percussion/susCymb1-cresc-Short_v1.wav) | `02778411d2` |

## Versilian Community Sample Library (VCSL)

Commit [`c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`](https://github.com/sgossner/VCSL/tree/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e), [LICENSE](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/LICENSE) (CC0 1.0 Universal).

| File (local path `vcsl/` + this) | Git blob |
| --- | --- |
| [Idiophones/Struck Idiophones/Claps/Clap_rr1.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Claps/Clap_rr1.wav) | `e033dc2c58` |
| [Idiophones/Struck Idiophones/Claps/Clap_rr2.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Claps/Clap_rr2.wav) | `74d14ae563` |
| [Idiophones/Struck Idiophones/Claps/Clap_rr3.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Claps/Clap_rr3.wav) | `045be34ec0` |
| [Idiophones/Struck Idiophones/Claps/Clap_rr4.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Claps/Clap_rr4.wav) | `438317aa27` |
| [Idiophones/Struck Idiophones/Claps/Clap_rr5.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Claps/Clap_rr5.wav) | `bf422133f0` |
| [Idiophones/Struck Idiophones/Claps/Clap_rr6.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Claps/Clap_rr6.wav) | `41d7027fa1` |
| [Idiophones/Struck Idiophones/Slapstick/slapstick_rr1.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Slapstick/slapstick_rr1.wav) | `bf2e9183f3` |
| [Idiophones/Struck Idiophones/Slapstick/slapstick_rr2.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Slapstick/slapstick_rr2.wav) | `062bd5ceb8` |
| [Idiophones/Struck Idiophones/Slapstick/slapstick_rr3.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Slapstick/slapstick_rr3.wav) | `115831a85b` |
| [Idiophones/Struck Idiophones/Woodblock/wood_click3_vl2.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Woodblock/wood_click3_vl2.wav) | `79a388f22d` |
| [Idiophones/Struck Idiophones/Woodblock/wood_click_f_rr1.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Woodblock/wood_click_f_rr1.wav) | `ee846604e1` |
| [Idiophones/Struck Idiophones/Woodblock/wood_click_f_rr2.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Woodblock/wood_click_f_rr2.wav) | `25739527f5` |
| [Membranophones/Struck Membranophones/Snare Drum, Rope Tension/Hi/RopeSnare_hi_sn_Main_vl2_rr1.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Membranophones/Struck%20Membranophones/Snare%20Drum%2C%20Rope%20Tension/Hi/RopeSnare_hi_sn_Main_vl2_rr1.wav) | `85b5ca4aa4` |
| [Membranophones/Struck Membranophones/Snare Drum, Rope Tension/Hi/RopeSnare_hi_sn_Main_vl3_rr1.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Membranophones/Struck%20Membranophones/Snare%20Drum%2C%20Rope%20Tension/Hi/RopeSnare_hi_sn_Main_vl3_rr1.wav) | `fd83d80d30` |
| [Membranophones/Struck Membranophones/Snare Drum, Rope Tension/Hi/RopeSnare_hi_sn_Main_vl4_rr1.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Membranophones/Struck%20Membranophones/Snare%20Drum%2C%20Rope%20Tension/Hi/RopeSnare_hi_sn_Main_vl4_rr1.wav) | `636face9d1` |
| [Membranophones/Struck Membranophones/Snare Drum, Rope Tension/RopeSnare_stick_Main_vl1_rr1.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Membranophones/Struck%20Membranophones/Snare%20Drum%2C%20Rope%20Tension/RopeSnare_stick_Main_vl1_rr1.wav) | `2f986209e0` |
| [Membranophones/Struck Membranophones/Tom 1/Stick/TomH_HitS_v4_rr1_Mid.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Membranophones/Struck%20Membranophones/Tom%201/Stick/TomH_HitS_v4_rr1_Mid.wav) | `08332f4a52` |
| [Membranophones/Struck Membranophones/Tom 1/Stick/TomH_HitS_v4_rr2_Mid.wav](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Membranophones/Struck%20Membranophones/Tom%201/Stick/TomH_HitS_v4_rr2_Mid.wav) | `a5a1cfbe2d` |

## MckSamplePacks (TR-8 recordings)

Commit [`5db40e8fe26785c256845a5bb38921b2654a887f`](https://github.com/MckAudio/MckSamplePacks/tree/5db40e8fe26785c256845a5bb38921b2654a887f), [LICENSE](https://github.com/MckAudio/MckSamplePacks/blob/5db40e8fe26785c256845a5bb38921b2654a887f/LICENSE) (CC0 1.0 Universal).

| File (local path `mck/` + this) | Git blob |
| --- | --- |
| [TR8/BD/004_909_Bass_Drum_1.wav](https://github.com/MckAudio/MckSamplePacks/blob/5db40e8fe26785c256845a5bb38921b2654a887f/TR8/BD/004_909_Bass_Drum_1.wav) | `514ef9e3ed` |
| [TR8/HATS/007_909_Open_HiHat.wav](https://github.com/MckAudio/MckSamplePacks/blob/5db40e8fe26785c256845a5bb38921b2654a887f/TR8/HATS/007_909_Open_HiHat.wav) | `8fc2e2576a` |
| [TR8/HATS/008_909_Closed_HiHat.wav](https://github.com/MckAudio/MckSamplePacks/blob/5db40e8fe26785c256845a5bb38921b2654a887f/TR8/HATS/008_909_Closed_HiHat.wav) | `cbf6e82c28` |
| [TR8/HATS/009_909_Open_HiHat_Short.wav](https://github.com/MckAudio/MckSamplePacks/blob/5db40e8fe26785c256845a5bb38921b2654a887f/TR8/HATS/009_909_Open_HiHat_Short.wav) | `62314550a3` |
| [TR8/HATS/010_909_Closed_HiHat_Short.wav](https://github.com/MckAudio/MckSamplePacks/blob/5db40e8fe26785c256845a5bb38921b2654a887f/TR8/HATS/010_909_Closed_HiHat_Short.wav) | `bf84f488ef` |
| [TR8/PERC/019_909_Hand_Clap.wav](https://github.com/MckAudio/MckSamplePacks/blob/5db40e8fe26785c256845a5bb38921b2654a887f/TR8/PERC/019_909_Hand_Clap.wav) | `851ec71255` |
