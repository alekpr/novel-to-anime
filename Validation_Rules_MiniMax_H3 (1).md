# MiniMax H3 Cinematic Prompt Optimizer — Validation Rules

Version: 1.0
Scope: Any MiniMax H3 prompt submitted inside the project. Apply this document together with `Golden_Sample_Jay_Room_407.md` and the Project Instructions.

## 1. Intake and preservation
- Parse original `Subject_definitions`, `Roles`, `summary`, `retention_analysis`, `detailed_description` and shot boundaries, `overall_soundscape`, and `non_diegetic_music` if present.
- Extract every `<Subject N>`, `<Picture N>`, `<d>...</d>` dialogue span, speaker, language, action, prop, and continuity link.
- Preserve original narrative intent, exact spoken words and language, character identity, costumes, physical facts, and scene style. Do not silently rewrite dialogue or invent visual details.
- Flag unknown images or incomplete references as **UNVERIFIED**, not verified or incorrect.

## 2. Subject and picture mapping
- Build a table with subject ID, type (character/environment/prop), role, linked picture(s), reference type, image verification status, and conflicts.
- Never infer `<Subject N>` maps to `<Picture N>` solely from matching numbers.
- Reference precedence: (1) character image for identity, (2) environment image for scene layout, (3) last-frame image for start pose and continuity, (4) written description to supplement only. Report any contradiction rather than overriding evidence silently.
- Off-screen voices need an explicit role but not necessarily a numbered visual Subject. Do not invent reference images.
- All references used in shots must be defined or clearly marked unresolved.

## 3. Cinematic shot validation
- For each shot, record start, end, duration, framing, lens/angle/movement if stated, active subjects, visible props, dialogue, physical action, and sound.
- Check screen direction, eyelines, handedness, object locations, actor blocking, camera transition logic, focus, lighting, spatial continuity, and feasible action count.
- Avoid needless camera changes; prefer motivated edits and natural performance beats.
- Keep shots visually coherent and executable, without mutually incompatible simultaneous instructions.

## 4. Dialogue timing calibration
- Quote every dialogue line verbatim; identify language and speaker, whether on-screen/off-screen, tone, and timing.
- Estimate speech using language-aware word/syllable density, speaking rate, pauses, emotional delivery, and TTS behavior. Treat computed time as a provisional estimate, not measured audio.
- Account separately for overlapping action, non-overlapping physical beats, reaction holds, and transitions. Do not simply sum events that genuinely overlap.
- Show estimated speech time, action/hold time, required shot time, allocated shot time, and verdict: TOO SHORT / SUITABLE / TOO LONG.
- Recompute all shot start/end timestamps and summary duration when timing changes; timestamps must be continuous with no gaps or overlaps unless explicitly justified.
- Preserve exact dialogue. If shortening would be needed, present it as an optional user-approved alternative, not an automatic rewrite.
- If a rendered ElevenLabs audio file is provided, use its actual duration as higher-confidence timing evidence.

## 5. Automatic clip splitting
- Determine the maximum allowed duration from the user's configuration or current verified MiniMax H3 mode specification. Never invent a platform limit.
- If total required duration exceeds that limit, split automatically at natural action or dialogue boundaries; never cut a spoken phrase unnaturally.
- If the maximum duration is unknown, state that limitation and offer provisional segments rather than asserting compliance.
- Every clip must have: unique clip number; local timeline starting at `00:00.000`; summary duration matching final shot end; independent shot list; starting-frame description; ending-frame description; continuity handoff to next clip.
- Preserve props, wardrobe, poses, lighting, room geometry, screen direction, and audio continuity across clip boundaries. Avoid replaying or skipping actions.

## 6. Roles and retention analysis
- Define narrative/visual roles for all Subjects and explicitly identify off-screen speakers.
- Reconcile `retention_analysis` with actual subject visibility in every shot, including hands, silhouettes, reflections, or partial appearances.
- Keep Subject IDs consistent across split clips unless a documented remapping is unavoidable.

## 7. Sound design and ElevenLabs
- Remove the **entire** `non_diegetic_music` section, even if its value is `No BGM`.
- Keep only `overall_soundscape` for environmental ambience, Foley, and diegetic SFX; no background music.
- Preserve dialogue as normal speech within MiniMax `<d>[Language] ...</d>` tags; do not inject ElevenLabs audio tags there unless requested.
- If any dialogue exists, create a separate ElevenLabs-ready script grouped by speaker with voice direction and optional emotion/delivery tags. Use tags only when compatible with the chosen ElevenLabs model; otherwise use plain text and a voice-direction note.
- Never modify the original spoken words. Do not add new spoken dialogue or fake voices for unspecified background audio.

## 8. Mandatory output contract
Always output, in order:
1. **Prompt Analysis Report:** original duration, shot count, issues, change log, unresolved constraints.
2. **Subject & Picture Mapping Table:** identity, reference type, verified/unverified, conflicts.
3. **Dialogue Timing Calibration Report:** verbatim lines, time estimates, per-shot old/new timestamps, assumptions.
4. **Optimized MiniMax H3 Prompt:** complete usable prompt for each resulting clip, retaining original section style and dialogue.
5. **ElevenLabs Dialogue Prompt:** only if spoken dialogue exists; separate speakers, tags and voice directions.
6. **Validation Report:** PASS/WARNING/FAIL by rule, plus any remaining unresolved references and unsupported assumptions.

## 9. Hard checks before release
- [ ] Every used Subject defined; all Picture references mapped or marked unresolved.
- [ ] Picture mapping never assumes matching numeric IDs.
- [ ] Roles, visible Subjects, and retention analysis agree.
- [ ] Shot starts at zero per clip; timestamps are strictly ordered, continuous, and end at summary duration.
- [ ] Dialogue is verbatim and plausibly fits its allocated shot or is explicitly flagged.
- [ ] Clip lengths obey the **verified or user-specified** maximum; if unknown, compliance is UNVERIFIED.
- [ ] Continuity handoff is explicit between split clips.
- [ ] No `non_diegetic_music` section appears in optimized prompt.
- [ ] `overall_soundscape` contains SFX/ambience only, no BGM.
- [ ] ElevenLabs script is separate and tags are model-compatible or qualified.
- [ ] No invented appearance, missing pictures, model capabilities, or platform duration limits.

## 10. Status criteria
- **PASS**: Check satisfied by supplied evidence and output.
- **WARNING**: Unverified image, uncertain audio pace, or unknown platform duration; disclose assumption.
- **FAIL**: Contradiction, missing required section, altered dialogue, invalid timeline, unapproved rewrite, or BGM section retained.
- Never mark the entire output fully verified if any hard check remains FAIL or key external evidence remains unknown.

## 11. Golden Sample regression test
Given `Golden_Sample_Jay_Room_407.md`, the optimizer should:
- Retain `<Subject 1>` → `<Picture 1>` and `<Subject 2>` → `<Picture 3>`; classify `<Picture 4>` as last-frame continuity.
- Notice Jay's hand in Shot 2 and update retention.
- Flag 4-second Shot 2 announcement as potentially too short; assess Shot 1 action density and Shot 3 chew beat.
- Preserve the exact two English dialogue lines, strawless cup, and no magical activation.
- Remove `non_diegetic_music` entirely.
- Produce a separate ElevenLabs script for Jay and the off-screen announcer.
- Recalculate shot timestamps; split if and only if required by the configured maximum duration, otherwise label limit unknown.
