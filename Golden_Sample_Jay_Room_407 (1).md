# Golden Sample — Jay Room 407 (MiniMax H3)

## Purpose
Canonical **input example** for the MiniMax H3 Cinematic Prompt Optimizer. Preserve the original wording, dialogue, character details, and picture references when using this example. The original is intentionally *not* a validated optimized output: it contains timing and retention issues used to test the optimizer.

## Reference types and mapping
| Subject | Type | Identity / scope | Picture | Priority |
|---|---|---|---|---|
| `<Subject 1>` | Environment | Jay's bedroom, Room 407, Sukjai Dormitory | `<Picture 1>` | Environment/layout |
| `<Subject 2>` | Character | Jay, male early 20s, techwear | `<Picture 3>` | Character identity |
| `<Subject 2>` starting pose | Continuity | Side-profile drinking posture from clip 9 | `<Picture 4>` | Starting-frame pose and continuity, not identity |

**Image availability:** The images themselves were not supplied with this example. Their contents cannot be independently verified. `<Picture 2>` is not referenced and must not be invented.

## Original prompt (verbatim)

```text
Subject_definitions:
<Subject 1> is Jay's Bedroom Room 407 at Sukjai Dormitory — Compact indoor dorm room with beige walls, soft morning daylight streaming through thin curtains, a single bed with a patchwork quilt, a cluttered computer desk setup with dual black monitors and yellow sticky notes on the wall, a wooden wardrobe, a wire snack rack, and a mini-fridge topped with an old microwave. Completely barrier-free photorealistic real-world environment. Linked to <Picture 1>.
<Subject 2> is the character Jay — A real-life Asian male actor in his early 20s with short messy black hair, tired dark eyes with slight dark circles, pale skin, slim build, wearing a distressed black hooded jacket with red straps and white paint splatters over a white t-shirt, loose black cargo pants with red accent straps and chain details, dark sandals, and red-accented over-ear headphones around his neck. Photorealistic skin texture and natural facial features. Linked to <Picture 3>.

Roles:
- <Subject 2> (Jay): Real-life male protagonist wearing his signature techwear jacket and headphones, starting from the side-profile drinking posture in <Picture 4>, setting down his drink to reopen the design file with heavy resignation.
- <Subject 1> (Environment): Photorealistic live-action indoor bedroom setting (Room 407, Sukjai Dormitory).

summary:
[reference generation] The target is a 12-second photorealistic live-action cinematic movie scene set inside Room 407 at Sukjai Dormitory during late morning. This clip continues directly from clip 9 starting from the side-profile posture in <Picture 4>. Features real human actor, 35mm lens, soft natural lighting filtering through curtains, shallow depth of field, and 4K photorealistic footage across 3 connected shots referencing Jay's character sheet (<Picture 3>), bedroom layout (<Picture 1>), and last-frame alignment (<Picture 4>). Strictly live-action, no animation or 3D art style.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - 100% photorealistic indoor dorm room matching <Picture 1> and <Picture 4> (dual black monitors, sticky notes on wall, cluttered desk).
<Subject 2> (appears in [Shot 1], [Shot 3]): fully_preserved - real Asian male actor matching Jay's full character reference sheet (<Picture 3>) and position (<Picture 4>), wearing the black hooded jacket with red straps, white t-shirt, and headphones around his neck.

detailed_description:
A tired, muted late-morning atmosphere inside Room 407 of Sukjai Dormitory, capturing Jay's quiet acceptance and mundane routine as he restarts work under distant municipal announcements.

[Shot 1] At 00:00.000, Medium Side-Profile Shot on real actor. Continuing directly from <Picture 4>, <Subject 2> finishes his sip from the clear plastic drink cup (equipped with a strawless sip-lid, strictly no straw), sets it back on the desk, and grabs the mouse. The dual computer monitors illuminate his pale, exhausted face as he reopens the design software interface and slowly opens the color adjustment menu. <Subject 2> speaks exhausted: <d>[English] Monday really is Monday...</d>

[Shot 2] At 00:04.000, Close-up Shot on window and desk. As daylight filters through thin curtains, the garbled loudspeaker sound of a municipal truck drifts in from the street below. <Subject 2>'s hand on the mouse pauses briefly, listening to the echoing broadcast while the quiet room amplifies the surreal isolation. Announcer speaks announcement: <d>[English] Attention citizens, please do not feed supernatural monsters in public areas...</d>

[Shot 3] At 00:08.000, Close-up Shot on real actor. <Subject 2> picks up the final grilled pork skewer from the plastic bag and takes a bite. No magic energy or aura activates—just a mundane, quiet bite. He chews slowly with a look of calm acceptance, staring at the screen design layers as the pork skewer offers a tiny comfort before the grind.

overall_soundscape:
The low hum of the mini-fridge, a muffled municipal vehicle announcement echoing outside, soft mouse clicking, the rustle of a plastic bag, and natural room ambience. No subtitles or visible text.

non_diegetic_music:
No BGM
```

## Expected optimization findings (not a fixed canonical output)
1. The 12-second original allocates four seconds per shot. Shot 2's 12-word English announcement plus loudspeaker pacing and listening pause may exceed four seconds; measure against selected voice audio. Shot 1 contains several actions plus a spoken line; shot 3 needs time for bite and chew.
2. Suggested **illustrative** expanded pacing: Shot 1 00:00–00:06; Shot 2 00:06–00:13; Shot 3 00:13–00:18. This is **not** an assertion that an 18-second MiniMax H3 clip is supported. Apply the actual user-specified or verified generation limit; split into connected clips if needed.
3. Include `<Subject 2>` in Shot 2 retention because Jay's hand is visible. Off-screen municipal announcer is a voice role; do not fabricate a visible actor or image reference.
4. Keep the cup **strawless**, the character's techwear and headphones, the pork skewer as mundane food with **no aura**, and the live-action photorealistic style.
5. Remove the entire `non_diegetic_music` heading; retain only `overall_soundscape` with SFX and environmental sound. Do not add music.
6. Preserve both English dialogue lines exactly, without audio tags inside `<d>` tags. Prepare a separate ElevenLabs script with cautiously selected supported audio tags.
7. If splitting, each clip must have its own local timestamps beginning at 00:00.000, starting and ending frame descriptions, and carryover of props, poses, room layout, lighting, and sound.

## Example ElevenLabs dialogue (illustrative; verify tags with selected model)

Jay (tired, resigned):
```text
[sighs] [weary] Monday really is Monday...
```

Off-screen municipal announcer (formal, projected):
```text
[projecting] Attention citizens, please do not feed supernatural monsters in public areas...
```

The words of the spoken dialogue are unchanged; bracketed tags are delivery cues and may require model-specific substitution. Apply radio/loudspeaker filtering in audio post-production when needed.

## Expected output sections
1. Prompt Analysis Report
2. Subject & Picture Mapping Table
3. Dialogue Timing Calibration Report
4. Optimized MiniMax H3 Prompt (one or more clips)
5. ElevenLabs Dialogue Prompt (when dialogue exists)
6. Validation Report
