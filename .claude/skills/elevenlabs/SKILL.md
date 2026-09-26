---
name: elevenlabs
description: ElevenLabs APIs for audio generation — text-to-speech (voices, models, voice settings, eleven_v3 audio tags), voice design, sound effects, music (Eleven Music, composition plans), speech-to-text, voice changer, voice isolator, dubbing and conversational agents. Use when generating a voiceover, designing a narrator voice, generating music or sound effects, or calling any ElevenLabs endpoint.
license: MIT (see LICENSE, © 2024 ElevenLabs)
---

# ElevenLabs skills (vendored)

These are ElevenLabs' official agent skills, vendored unchanged from
[github.com/elevenlabs/skills](https://github.com/elevenlabs/skills) at commit
`a310b94d1f266038430d693694b947d3f937ad2a` (2026-09-25), MIT-licensed (see `LICENSE`, `README.md`).
Only this index file is ours; it routes to the upstream skills. The upstream `evals/` folder and logo
were left out.

Read the sub-skill for the task:

| Task | Skill |
|---|---|
| Voiceover, narration, voices, models, voice settings | [text-to-speech/SKILL.md](text-to-speech/SKILL.md), [voice settings](text-to-speech/references/voice-settings.md) |
| Sound effects, foley, ambiences, UI sounds | [sound-effects/SKILL.md](sound-effects/SKILL.md) |
| Music, scores, jingles, composition plans | [music/SKILL.md](music/SKILL.md), [API reference](music/references/api_reference.md) |
| Transcription with timestamps (e.g. aligning VO to picture) | [speech-to-text/SKILL.md](speech-to-text/SKILL.md) |
| Speech-to-speech voice conversion | [voice-changer/SKILL.md](voice-changer/SKILL.md) |
| Cleaning up a recording | [voice-isolator/SKILL.md](voice-isolator/SKILL.md) |
| Dubbing | [dubbing/SKILL.md](dubbing/SKILL.md) |
| Conversational agents, real-time voice | [agents/SKILL.md](agents/SKILL.md), [speech-engine/SKILL.md](speech-engine/SKILL.md) |
| Getting an API key | [setup-api-key/SKILL.md](setup-api-key/SKILL.md) |

## Not covered upstream (from the API docs, 2026-09)

- **Voice design**: `POST /v1/text-to-voice/design` with `voice_description` (required), `model_id`
  (`eleven_ttv_v3` or `eleven_multilingual_ttv_v2`), `text` (100–1000 chars) or
  `auto_generate_text`, `loudness` (−1…1), `guidance_scale`, `seed`. Returns `previews[]` with
  `generated_voice_id` and `audio_base_64`. Save one with `POST /v1/text-to-voice`
  (`voice_name`, `voice_description`, `generated_voice_id`) to get a `voice_id`.
- **eleven_v3 delivery**: no SSML `<break>`; pace with punctuation and ellipses, emphasis with
  capitals, and audio tags in square brackets. Stability works in three bands (Creative ≈ 0,
  Natural ≈ 0.5, Robust ≈ 1); Robust follows tags least.
- **Rights**: the free plan has no commercial license (attribution required; for Eleven Music,
  credit "Eleven Music"). Paid plans include a commercial license, except output from Beta
  services. See elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform.

Keep the API key in the environment (`ELEVENLABS_API_KEY`) or a gitignored `.env`; never print or
commit it.
