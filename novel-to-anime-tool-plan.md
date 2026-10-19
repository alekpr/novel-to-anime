# แผนพัฒนา Tool แปลงนิยายเป็น Anime Production Pack

**Stack:** Node.js + MongoDB | **หน่วยทำงาน:** ทีละ EP | **LLM:** Claude API (แนะนำ)

---

## 1. เป้าหมายของระบบ

รับข้อความนิยาย (ที่เป็นคำบรรยายแบบเล่าเรื่อง) แล้วแปลงเป็นชุดข้อมูลสำหรับผลิตอนิเมะ ทีละ EP ประกอบด้วย

1. **Character Sheet**: ข้อมูลตัวละคร, รูปลักษณ์, ชุด, prompt สร้าง character sheet
2. **Voice Design**: ลักษณะเสียงและ prompt เสียงของแต่ละตัวละคร
3. **Location Sheet**: สถานที่ทั้งหมด พร้อม prompt และความเกี่ยวข้องกับตัวละคร
4. **Scenes**: แยกฉากตามสถานที่/เวลา/อารมณ์
5. **Shots**: shot list ในแต่ละ scene
6. **Dialogue**: บทสนทนาในแต่ละ shot (ใช้ของเดิมในนิยาย หรือให้ LLM แต่งเพิ่ม)
7. **Prompts**: prompt สำหรับสร้างภาพ/วิดีโอ/เสียง ต่อ shot

**หลักการสำคัญ:** Story Bible (ตัวละคร/สถานที่/เสียง) ใช้ร่วมกันทั้งเรื่อง และสะสมข้าม EP เพื่อให้หน้าตา เสียง และสถานที่คงที่ตลอด

---

## 2. Pipeline

```
นิยาย (EP)
   │
   ▼
[S0] Ingest & Clean
   ▼
[S1] Story Bible Extraction ──► ✅ Checkpoint 1 (ตรวจ/แก้/Approve)
   ▼
[S2] Scene Breakdown ─────────► ✅ Checkpoint 2
   ▼
[S3] Shot List + Dialogue ────► ✅ Checkpoint 3 (กรอง dialogue ที่ generated)
   ▼
[S6] Image Generation (ComfyUI @ RunningHub) ──► ✅ Checkpoint 4 (approve reference/keyframe)
   │   (character sheet → location master → keyframe/close-up ต่อ shot)
   ▼
[S4a] Scene Video Prompt (ทั้ง scene, shots กี่ช็อตก็ได้)
   ▼
[S4b] Clip Splitter (แบ่งเป็นชุด ≤ 20 วินาที) + ประกอบ DY prompt ต่อ clip
   ▼
[S5] QA Pass + Export
   ▼
[S7] Video Generation (ComfyUI @ RunningHub) ──► ✅ Checkpoint 5 (เลือก take ที่ใช้)
```

> รายละเอียด S6–S7 อยู่ในหัวข้อ **14. Generation Layer (ComfyUI + RunningHub)**

| Stage | Input | Output | LLM |
|---|---|---|---|
| S0 | ไฟล์/ข้อความนิยาย | paragraphs มี ID | ไม่ใช้ |
| S1 | ข้อความทั้ง EP + Bible เดิม | Characters, Locations, Voices (draft) | ใช้ |
| S2 | ข้อความ EP + Bible ที่ approve แล้ว | Scenes | ใช้ |
| S3 | Scene + Bible ที่เกี่ยวข้อง + สรุปเหตุการณ์ก่อนหน้า | Shots + Dialogue | ใช้ (ทีละ scene) |
| S4 | Shot + appearance/location blocks | Prompts | ใช้เฉพาะส่วน action; ส่วน block ประกอบด้วยโค้ด |
| S5 | ทุกอย่าง | รายงาน QA + ไฟล์ export | ใช้บางส่วน |

---

## 3. Tech Stack

| ส่วน | ตัวเลือก | หมายเหตุ |
|---|---|---|
| Runtime | Node.js 20+ (LTS) | ใช้ TypeScript แนะนำ |
| Web framework | Express หรือ Fastify | Fastify เร็วและมี schema validation ในตัว |
| Database | MongoDB 7 + Mongoose | เหมาะกับข้อมูลซ้อนชั้น (scene → shot → dialogue) |
| Validation | Zod | ใช้ validate output ของ LLM ทุก stage |
| LLM SDK | `@anthropic-ai/sdk` | ใช้ tool use / JSON output |
| Job queue | in-process queue (`p-queue`) + สถานะ job เก็บใน MongoDB | งานยาวรันเบื้องหลัง; ไม่ต้องใช้ Redis (ดูหัวข้อ 18); **ไม่ใช้ BullMQ** |
| Realtime | SSE หรือ Socket.IO | แจ้งความคืบหน้า job |
| Frontend | React + Vite (หรือ Next.js) | ทำ MVP เป็น CLI/REST ก่อนได้ |
| File storage | โฟลเดอร์ในเครื่อง (`data/`) | ใช้งานคนเดียวใน local จึงไม่ใช้ S3/MinIO |
| Test | Vitest/Jest + mongodb-memory-server | mock LLM ในเทสต์ |
| Logging | pino | เก็บ token usage ต่อ job |
| Image/Video generation | ComfyUI workflow บน RunningHub (เรียกผ่าน API) | ดูหัวข้อ 14 |
| HTTP client | `undici` / `axios` | เรียก RunningHub API |
| Task result | **polling** `/task/openapi/status` | รันใน local จึงไม่มี public URL ให้ webhook เรียกกลับ (ไม่ใช้ webhook) |
| รัน/Deploy | `npm start` ในเครื่อง (+ MongoDB local หรือผ่าน Docker เฉพาะ mongo) | ไม่ต้อง deploy ขึ้น server |

---

## 4. โครงสร้างโปรเจกต์

```
novel-to-anime/
├─ src/
│  ├─ server.ts
│  ├─ config/              # env, db (ไม่มี redis)
│  ├─ models/              # Mongoose schemas
│  │   ├─ Project.ts
│  │   ├─ Episode.ts
│  │   ├─ Character.ts
│  │   ├─ Location.ts
│  │   ├─ Scene.ts
│  │   ├─ Shot.ts
│  │   ├─ Job.ts
│  │   ├─ Asset.ts             # ไฟล์ภาพ/วิดีโอ/เสียงที่ได้จาก generation
│  │   ├─ GenerationTask.ts    # 1 รายการต่อ 1 การเรียก RunningHub
│  │   └─ Workflow.ts          # Workflow Registry
│  ├─ schemas/             # Zod schemas สำหรับ LLM output และ RunningHub API
│  ├─ services/
│  │   ├─ ingest.service.ts
│  │   ├─ bible.service.ts       # S1 + merge logic
│  │   ├─ scene.service.ts       # S2
│  │   ├─ shot.service.ts        # S3
│  │   ├─ imageGen.service.ts    # S6
│  │   ├─ prompt.service.ts      # S4a/S4b (template builder + clip splitter)
│  │   ├─ videoGen.service.ts    # S7
│  │   ├─ qa.service.ts          # S5
│  │   └─ export.service.ts
│  ├─ generation/
│  │   └─ runninghub.client.ts   # RunningHub API client
│  ├─ llm/
│  │   ├─ client.ts              # wrapper: retry, rate limit, token log
│  │   └─ prompts/               # system prompts แยกไฟล์ต่อ stage
│  ├─ queues/                    # p-queue workers (ไม่ใช้ BullMQ)
│  │   ├─ jobRunner.ts           # in-process queue + สถานะใน MongoDB
│  │   ├─ genImage.queue.ts      # gen-image queue
│  │   └─ genVideo.queue.ts      # gen-video queue
│  ├─ routes/
│  ├─ templates/                 # prompt template ต่อ video model
│  │   └─ dy.ts                  # DY format assembler
│  └─ utils/                     # ตัดข้อความ, นับคำไทย (thai-segmenter), alias matching
├─ tests/
│  └─ fixtures/
│      └─ dy-prompt.sample.txt   # golden test สำหรับ dy.ts
├─ docker-compose.yml
└─ README.md
```

---

## 5. Data Model (MongoDB / Mongoose)

> แนวทาง: **Bible entities แยก collection** (ใช้ร่วมกันหลาย EP) ส่วน **Scene แยก collection** และ **Shot ฝัง dialogue** ไว้ในตัว เพื่ออ่านครั้งเดียวได้ข้อมูลครบ

### 5.1 Project
```ts
{
  _id, title, language: "th",
  styleGuide: {                 // ใช้กับทุก prompt
    artStyle: "anime cel-shaded, ...",
    aspectRatio: "16:9",
    targetVideoModel: "veo3"    // veo3 | kling | runway | image
  },
  videoModel: {                // ข้อจำกัดของโมเดลวิดีโอ (ดูหัวข้อ 16)
    name: "minimax-h3",
    minDurationSec: 5, maxDurationSec: 15, fps: 24, resolution: "2K",
    maxRefImages: 9, maxRefVideos: 3, maxRefAudios: 3,
    promptMaxChars: 2000       // ต้องตรวจกับ node/API ที่ใช้จริง (null = ไม่จำกัด)
  },
  clipPolicy: {
    userMaxClipSec: 20,        // เพดานที่ผู้ใช้ต้องการ
    // maxClipSec ที่ใช้จริง = min(userMaxClipSec, videoModel.maxDurationSec) = 15 สำหรับ H3
    targetClipSec: 12,         // ความยาวเป้าหมาย
    minClipSec: 5,             // = videoModel.minDurationSec (H3 สร้างได้อย่างน้อย 5s)
    continuityMode: "scene_keyframe" // หรือ "last_frame"
  },
  dialoguePolicy: {
    generateMissingDialogue: true,
    innerMonologue: "narration" // narration | expression | insert-shot
  },
  createdAt, updatedAt
}
```

### 5.2 Episode
```ts
{
  _id, projectId, number, title,
  status: "ingested" | "bible_review" | "scenes_review" | "shots_review" | "done",
  paragraphs: [{ idx: 0, text: "..." }],   // ต้นฉบับแยกย่อหน้า
  summary: "",                              // สรุปเหตุการณ์ (ใช้เป็น context EP ถัดไป)
  bibleVersion: 3                           // Bible เวอร์ชันที่ใช้ตอน approve
}
```

### 5.3 Character
```ts
{
  _id, projectId,
  name, aliases: ["ชื่อเล่น", "พี่", "คุณ..."],
  role: "main" | "support" | "extra",
  age, personality, relationships: [{ characterId, type, note }],
  firstAppearanceEp: 1, episodes: [1, 2, 5],

  appearance: {
    hair, skin, eyes, build, distinguishing,
    defaultOutfit,
    inferredFields: ["hair", "eyes"]        // field ที่ LLM เดาเอง (ไม่มีในนิยาย)
  },
  outfits: [{ name, description, usedInScenes: [] }],
  appearanceBlock: "…",                     // ข้อความอังกฤษคงที่ copy ลงทุก prompt
  characterSheetPrompt: "…",                // turnaround + expressions + outfits
  referenceImages: [{ url, approved: true }],

  voice: {
    gender, ageRange, pitch, timbre, pace, accent, defaultEmotion,
    speechHabits: ["คำติดปาก ..."],
    sampleLines: ["..."],
    voicePrompt: "…"
  },

  locationIds: [ObjectId],                  // สถานที่ที่ตัวละครนี้เกี่ยวข้อง
  status: "draft" | "approved",
  version: 1
}
```

### 5.4 Location
```ts
{
  _id, projectId, name, aliases: [],
  type: "interior" | "exterior",
  description, timeOfDay, lighting, weather,
  materials, keyElements: [], mood,
  locationBlock: "…",                        // ข้อความอังกฤษคงที่
  masterPrompt: "…",
  extraAngles: [{ name: "wide", prompt: "…" }],
  characterIds: [ObjectId],                  // ตัวละครที่เกี่ยวข้องกับที่นี่
  episodes: [1, 3],
  status, version
}
```

### 5.5 Scene
```ts
{
  _id, projectId, episodeId, order, sceneCode: "EP01-S03",
  title, summary,
  locationId, timeOfDay, mood,
  characterIds: [],
  sourceRange: { fromParagraph: 12, toParagraph: 18 },
  estDurationSec: 45,
  shotCount: 9,                     // ไม่จำกัด ขึ้นกับเนื้อหา
  totalDurationSec: 47,
  videoPromptDraft: { },            // ผล S4a (JSON ตาม SceneVideoPromptDraft ก่อนประกอบข้อความ)
  clips: [{                         // ผล S4b: แต่ละ clip ≤ maxClipSec (20s)
    clipCode: "EP01-S03-C01",
    shotIds: [],                    // shot ต้นฉบับที่อยู่ใน clip นี้
    startOffsetSec: 0,              // ตำแหน่งเริ่มภายใน scene
    durationSec: 15,
    referencePictures: [            // <Picture 1>, <Picture 2> ...
      { index: 1, role: "scene_keyframe",   assetId },
      { index: 2, role: "character_closeup", assetId }
    ],
    videoPrompt: "DY,subject_definitions: ...",   // ผลจาก S4
    promptVersion: 1,
    clipAssetId: null, takes: []
  }],
  status: "draft" | "approved"
}
```

### 5.6 Shot (ฝัง dialogue)
```ts
{
  _id, sceneId, episodeId, order, shotCode: "EP01-S03-SH02",
  shotType: "close-up",           // wide, medium, close-up, OTS, insert, POV
  camera: "slow push-in",
  durationSec: 4,
  characterIds: [], locationId,
  action, emotion,
  dialogue: [{
    speakerId, lineTh, tone,
    source: "original" | "generated",
    reviewed: false
  }],
  narration: null,
  sfx, music,
  prompts: {
    video: "…", image: "…", voice: [{ speakerId, text }]
  },
  qa: { passed: true, issues: [] }
}
```

### 5.7 Job
```ts
{
  _id, projectId, episodeId, stage: "S1"|"S2"|"S3"|"S4"|"S5",
  status: "queued"|"running"|"succeeded"|"failed",
  progress: 0.4, error, tokens: { in, out }, createdAt, finishedAt
}
```

### Index ที่ควรมี
- `Character`: `{ projectId, name }` (unique), `{ projectId, aliases }`
- `Location`: `{ projectId, name }` (unique)
- `Scene`: `{ episodeId, order }`
- `Shot`: `{ sceneId, order }`, `{ episodeId, shotCode }`

---

## 6. รายละเอียดแต่ละ Stage

### S0 – Ingest & Clean
- รับ txt/docx/paste แล้วแยก EP
- ตัดหัวบท/คำโฆษณา แล้วแบ่งเป็นย่อหน้าพร้อมเลข index
- เก็บ index ไว้เพื่อให้ scene/shot ย้อนกลับไปหาต้นฉบับได้

### S1 – Story Bible Extraction
1. ส่งข้อความทั้ง EP + รายชื่อ Bible เดิม (ชื่อ + aliases + สรุปสั้น) ให้ LLM
2. LLM คืน JSON ของตัวละคร/สถานที่ ทั้งใหม่และที่ปรากฏซ้ำ
3. **Merge logic** (โค้ด ไม่ใช่ LLM):
   - จับคู่ด้วยชื่อ/aliases (normalize ตัดคำนำหน้า เช่น คุณ/พี่/น้อง)
   - ถ้าจับคู่ได้ → อัปเดต `episodes`, เพิ่ม outfit/ข้อมูลใหม่ **โดยไม่ทับ field ที่ approve แล้ว**
   - ถ้าไม่แน่ใจ → ใส่ `needsReview: true` ให้คนตัดสิน
4. สร้าง `appearanceBlock`, `locationBlock`, `characterSheetPrompt`, `voicePrompt`
5. field ที่นิยายไม่ระบุ ให้ LLM เสนอและ **ใส่ใน `inferredFields`**
6. สร้างความสัมพันธ์ตัวละคร ↔ สถานที่

✅ **Checkpoint 1:** คน approve ก่อนไป S2 (เมื่อ approve แล้ว `appearanceBlock` จะถูก lock)

### S2 – Scene Breakdown
- ตัดฉากตามการเปลี่ยน **สถานที่ / เวลา / ตัวละครหลักในฉาก / beat อารมณ์**
- ผูก `locationId` และ `characterIds` จาก Bible (LLM ต้องเลือกจากรายการ ID ที่ให้ ห้ามสร้างใหม่)
- เก็บ `sourceRange` ของย่อหน้าต้นฉบับ

✅ **Checkpoint 2:** ตรวจ/รวม/แยก scene

### S3 – Shot List + Dialogue
รันทีละ scene (parallel ได้ แต่ต้องมี rolling summary)

**ตารางการแปลงคำบรรยาย**

| ในนิยาย | แปลงเป็น |
|---|---|
| บรรยายการกระทำ | action shot |
| บรรยายความรู้สึก/ความคิดภายใน | สีหน้า/ท่าทาง, insert shot หรือ narration ตาม `innerMonologue` policy |
| บทสนทนาเดิม | `dialogue.source = "original"` (ห้ามแก้) |
| ไม่มีบทแต่ฉากต้องการ | LLM แต่งเพิ่ม → `source = "generated"` |

**กติกาบทสนทนา**
- ต้องตรงกับ `voice.speechHabits` และบุคลิกใน Bible
- ห้ามเปลี่ยนพล็อต ห้ามเปิดเผยข้อมูลที่ยังไม่ถึงจุดนั้นในเรื่อง
- ติดป้าย `generated` ทุกครั้ง

**Input ต่อ scene:** ข้อความต้นฉบับช่วง scene + Bible เฉพาะตัวละคร/สถานที่ในฉาก + summary ของ scene ก่อนหน้า

### S4 – Video Prompt Generation (ต่อ Scene/Clip ในฟอร์แมต `DY`)
- **S4a – Scene Video Prompt:** สร้าง prompt ของ **ทั้ง scene** โดย scene มี **shots ได้กี่ช็อตก็ได้ตามความเหมาะสม** (ไม่จำกัดจำนวน) พร้อมกล้อง, ความยาวต่อ shot และบทพูด
- **S4b – Clip Splitter:** แยก scene prompt เป็น **ชุด (clip) ชุดละไม่เกิน 20 วินาที** แต่ละชุดเป็น prompt ฟอร์แมต DY ที่สมบูรณ์ในตัวเอง ส่งไปสร้างวิดีโอได้ทันที (ดูหัวข้อ 15.9)
- prompt อ้างอิงภาพ reference เป็น `<Picture 1>`, `<Picture 2>` ดังนั้น **ต้องมีภาพ reference ก่อน** (ลำดับ: S6 สร้างภาพ → S4 ประกอบ prompt วิดีโอ)
- **ประกอบด้วยโค้ด (template)**: `subject_definitions`, `retention_analysis`, `<Picture N>` mapping ประกอบจาก Bible ด้วยโค้ด
- **LLM เขียนเฉพาะ**: summary, tone ใน `detailed_description`, เนื้อหาแต่ละ `[Shot]`, บทพูด, soundscape, music
- รายละเอียดฟอร์แมต กติกา และ schema ดูหัวข้อ **15. Video Prompt Format (DY)**
- prompt ภาพนิ่ง (keyframe/character sheet) และ prompt เสียง (TTS) ยังแยกเก็บต่อ shot/ตัวละครตามเดิม

### S5 – QA Pass + Export
**ตรวจอัตโนมัติ (โค้ด):**
- `characterIds` ใน shot ต้องอยู่ใน scene
- `appearanceBlock` ใน prompt ต้องตรงกับ Bible 100%
- ผลรวม `durationSec` ของ shot ใกล้เคียง `estDurationSec`
- dialogue ที่ `generated` และยังไม่ `reviewed` → รายงานให้ตรวจ
- ทุก speaker ต้องมี voice profile

**Export:** JSON, Markdown, CSV (shot list) → `exports/EP01/`

---

## 7. LLM Integration

### 7.1 หลักการ
- ทุก stage ใช้ **structured output** + validate ด้วย Zod; ถ้าไม่ผ่าน → retry พร้อมแนบ error (สูงสุด 2–3 ครั้ง)
- system prompt แยกไฟล์ต่อ stage เก็บใน `src/llm/prompts/`
- ใช้ **prompt caching** กับส่วนที่ซ้ำ (Bible, system prompt) เพื่อลดต้นทุน
- เก็บ token usage ใน Job ทุกครั้ง
- ใช้ temperature ต่ำใน S1/S2 (ความแม่นยำ) และสูงขึ้นเล็กน้อยใน S3 (การแต่งบท)

### 7.2 ตัวอย่าง wrapper
```ts
// src/llm/client.ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic();

export async function callStructured<T extends z.ZodTypeAny>(opts: {
  system: string;
  user: string;
  schema: T;
  model: string;          // ตั้งใน config; ตรวจ model ล่าสุดจากเอกสาร Anthropic
  maxRetries?: number;
}): Promise<z.infer<T>> {
  let lastError = "";
  for (let i = 0; i <= (opts.maxRetries ?? 2); i++) {
    const res = await client.messages.create({
      model: opts.model,
      max_tokens: 8000,
      system: opts.system,
      messages: [{
        role: "user",
        content: opts.user + (lastError ? `\n\nแก้ error ก่อนหน้า: ${lastError}` : ""),
      }],
    });
    const text = res.content.map(b => (b.type === "text" ? b.text : "")).join("");
    try {
      const json = JSON.parse(text.replace(/```json|```/g, "").trim());
      return opts.schema.parse(json);
    } catch (e: any) {
      lastError = String(e.message).slice(0, 500);
    }
  }
  throw new Error("LLM output validation failed: " + lastError);
}
```

### 7.3 จุดควบคุมความแม่นยำ
- ให้ LLM เลือก ID จากรายการที่ส่งไป (ไม่ให้สร้าง ID เอง)
- ข้อความต้นฉบับที่เป็นบทสนทนา ให้ดึงด้วยกฎ/regex ก่อน แล้วค่อยให้ LLM จับคู่ผู้พูด
- ชื่อไทย: ทำ alias normalization ใน `utils/` ไม่พึ่ง LLM อย่างเดียว

---

## 8. REST API

| Method | Path | หน้าที่ |
|---|---|---|
| POST | `/projects` | สร้างโปรเจกต์ |
| POST | `/projects/:id/episodes` | อัปโหลด/วางนิยายของ EP |
| POST | `/episodes/:id/run/:stage` | สั่งรัน S1–S5 (คืน jobId) |
| GET | `/jobs/:id` | สถานะ/ความคืบหน้า (หรือ SSE `/jobs/:id/stream`) |
| GET/PATCH | `/projects/:id/characters` | ดู/แก้ตัวละคร |
| POST | `/characters/:id/approve` | approve + lock block |
| POST | `/characters/:id/regenerate` | สร้างใหม่ (ระบุ field) |
| GET/PATCH | `/projects/:id/locations` | ดู/แก้สถานที่ |
| GET/PATCH | `/episodes/:id/scenes` | ดู/แก้/รวม/แยก scene |
| GET/PATCH | `/scenes/:id/shots` | ดู/แก้ shot และ dialogue |
| POST | `/shots/:id/regenerate` | สร้าง shot/บทพูดใหม่ |
| GET | `/episodes/:id/export?format=json\|md\|csv` | export |

---

## 9. Queue & Concurrency

- Queue แยกตาม stage: `bible`, `scenes`, `shots`, `prompts`, `qa`
- S3 รัน parallel ต่อ scene ได้ (concurrency 3–5) แต่ต้องรอ rolling summary ถ้าเนื้อหาต่อเนื่องกัน → ทางเลือก: สร้าง scene summary จาก S2 ไว้ล่วงหน้า เพื่อไม่ต้องรอ shot ของ scene ก่อนหน้า
- จัดการ rate limit ของ LLM ด้วย limiter + exponential backoff
- Job ต้อง **idempotent**: รันซ้ำแล้วไม่สร้างข้อมูลซ้ำ (ใช้ upsert ตาม `sceneCode`/`shotCode`)

---

## 10. Frontend (ภายหลัง MVP)

> แผน UI แบบละเอียด (Step-by-step Wizard) อยู่ในหัวข้อ **17. Web UI Plan** — หัวข้อนี้เป็นเพียงสรุปเบื้องต้น

1. **Projects / Episodes**: อัปโหลดนิยาย ดูสถานะแต่ละ EP
2. **Bible Editor**: การ์ดตัวละคร/สถานที่ ปุ่ม Regenerate / Approve, แสดง field ที่ `inferred`
3. **Scene Board**: ลาก-จัดเรียง รวม/แยก scene
4. **Shot Table**: แก้ shot + dialogue, แสดง prompt ข้างๆ, ปุ่ม copy
5. **QA Report**: รายการปัญหาที่ต้องแก้
6. **Export**

---

## 11. Roadmap

| Phase | ระยะเวลา (ประมาณ) | ผลลัพธ์ |
|---|---|---|
| **0 – Setup** | 2–3 วัน | repo, Docker Compose (mongo เท่านั้น), config, logging, LLM wrapper + Zod |
| **1 – MVP (CLI/REST)** | 1–2 สัปดาห์ | S0–S3: วางนิยาย 1 EP → Characters + Locations + Scenes + Shots (JSON/MD) |
| **2 – Bible ข้าม EP** | 1 สัปดาห์ | merge logic, alias matching, approve/lock, Voice Design |
| **3 – Dialogue & Prompts** | 1–2 สัปดาห์ | dialogue policy, S4 template ต่อ video model, S5 QA, export CSV |
| **4 – UI** | 2–3 สัปดาห์ | Bible editor, scene board, shot table |
| **5 – Image Gen (RunningHub)** | 1–2 สัปดาห์ | RunningHub client, Workflow Registry, สร้าง character sheet / location / keyframe, เก็บ Asset |
| **6 – Video Gen (RunningHub)** | 1–2 สัปดาห์ | image-to-video ต่อ shot, webhook + polling, เลือก take |
| **7 – Voice & Assembly** | ต่อเนื่อง | TTS ตาม voice profile, ตรวจ consistency, รวมคลิปเป็น EP (FFmpeg) |

### Definition of Done ของ MVP
- [ ] นิยาย 1 EP (~3,000–5,000 คำ) ผ่าน S0–S3 โดยไม่ต้องแก้โค้ด
- [ ] output ผ่าน Zod ทุก stage
- [ ] ตัวละครทุกตัวใน shot มีใน Bible
- [ ] export เป็น JSON + Markdown ได้
- [ ] มี unit test ของ merge logic และ validation

---

## 12. ความเสี่ยง & แนวทางรับมือ

| ความเสี่ยง | วิธีรับมือ |
|---|---|
| หน้าตัวละครไม่ตรงกันข้าม shot | `appearanceBlock` แบบ verbatim + lock หลัง approve + reference image |
| ชื่อ/สรรพนามไทยหลากหลาย | alias map + normalization ในโค้ด + `needsReview` |
| LLM แต่งบทเกินพล็อต | policy + ป้าย `generated` + checkpoint ตรวจ |
| นิยายมีแต่ความคิดภายใน | กำหนด `innerMonologue` policy ต่อโปรเจกต์ |
| Output JSON พัง | Zod validation + retry พร้อม error feedback |
| ต้นทุน LLM สูง | prompt caching, ส่ง Bible เฉพาะส่วนที่เกี่ยวข้อง, ใช้โมเดลเล็กกับงานง่าย (เช่น QA) |
| EP ยาวเกิน context | แบ่งเป็น chunk ตามบท + rolling summary |
| Bible ถูกทับตอนรัน EP ใหม่ | merge แบบไม่ทับ field ที่ approve + เก็บ `version` |
| Job ค้าง/ล้มเหลวกลางทาง | idempotent upsert + retry ใน p-queue + เก็บ error ใน Job + resync ตอน startup (ดูหัวข้อ 18.3) |

---

## 13. ตัวอย่าง `docker-compose.yml`

```yaml
services:
  mongo:
    image: mongo:7
    volumes: [mongo_data:/data/db]
    ports: ["27017:27017"]
  app:
    build: .
    env_file: .env
    depends_on: [mongo]
    ports: ["3000:3000"]
    volumes:
      - ./data:/app/data     # local file storage
volumes:
  mongo_data:
```

`.env`:
```
MONGO_URI=mongodb://mongo:27017/novel_anime
ANTHROPIC_API_KEY=...
LLM_MODEL=...            # ตั้งตามโมเดลที่ใช้
RH_BASE_URL=https://www.runninghub.ai
RH_API_KEY=...
```

---

## 14. Generation Layer (ComfyUI + RunningHub)

### 14.1 แนวคิด
- สร้าง workflow ใน ComfyUI (เช่น text-to-image, image-to-image พร้อม reference, image-to-video) แล้วนำขึ้น RunningHub
- ระบบของเราเรียก **RunningHub API** พร้อมส่งค่า parameter ไปทับ node ใน workflow (ผ่าน `nodeInfoList`)
- **แยก "ชนิดงาน" ออกจาก "workflow ID"** ด้วย Workflow Registry เพื่อสลับ workflow ได้โดยไม่แก้โค้ด

### 14.2 RunningHub API ที่ต้องใช้

> ข้อมูลด้านล่างอ้างอิงจากเอกสาร RunningHub API ณ ตอนวางแผน ให้ตรวจเอกสารล่าสุดอีกครั้งก่อนเขียนโค้ด (โดยเฉพาะ domain `.ai` / `.cn` และรูปแบบ response)

| หน้าที่ | Endpoint (POST) | ข้อมูลหลัก |
|---|---|---|
| เริ่ม task (Advanced) | `/task/openapi/create` | `apiKey`, `workflowId`, `nodeInfoList`, `webhookUrl` (ถ้ามี) |
| เช็คสถานะ | `/task/openapi/status` | `apiKey`, `taskId` |
| ดึงผลลัพธ์ | `/task/openapi/outputs` | `apiKey`, `taskId` |
| ยกเลิก task | `/task/openapi/cancel` | `apiKey`, `taskId` |
| อัปโหลดไฟล์ (ภาพ/วิดีโอ/เสียง) | Upload Resource API | ได้ชื่อไฟล์ภายใน RunningHub ไปใส่ใน `nodeInfoList` |
| อัปโหลด LoRA | Upload Lora API | ใช้กับ LoRA ตัวละครเฉพาะ |

**รูปแบบ `nodeInfoList`:**
```json
[
  { "nodeId": "6",  "fieldName": "text",  "fieldValue": "<prompt>" },
  { "nodeId": "3",  "fieldName": "seed",  "fieldValue": 123456789 },
  { "nodeId": "10", "fieldName": "image", "fieldValue": "api/<uploaded-file>.png" }
]
```

**ข้อควรระวังจากเอกสาร RunningHub:**
- `nodeId` และ `fieldName` ต้องมาจากไฟล์ **Export Workflow (API format)** ของ workflow นั้น
- API **ไม่สุ่ม seed ให้อัตโนมัติ** ต้องสุ่มเองแล้วส่งใน `nodeInfoList` (ถ้าไม่ส่ง ผลจะซ้ำเดิม) ควรเก็บ seed ไว้ใน DB เพื่อ reproduce
- field ที่เป็นของ front-end ล้วน (เช่น `control_after_generate`) ใช้ผ่าน API ไม่ได้
- ถ้า `nodeInfoList` ไม่ตรงกับ workflow จะ error (เช่น code 803), ถ้า workflow ไม่พบ (380), ถ้าชน concurrency (421 `TASK_QUEUE_MAXED`) ต้อง retry แบบ backoff
- ถ้าเกิด error ตอนสร้าง task แล้วไม่แน่ใจ อย่าสร้างซ้ำทันที ให้ตรวจสถานะ/รอ webhook ก่อน เพื่อไม่ให้เสียเครดิตซ้ำ
- ผู้ใช้ฟรีใช้ API Key ไม่ได้ (code 801) ต้องเป็นบัญชีที่รองรับ API

### 14.3 Workflow Registry (Collection `Workflow`)
```ts
{
  _id, projectId?,                  // null = ใช้ทั้งระบบ
  key: "char_sheet_v1",             // ชื่ออ้างอิงในโค้ด
  kind: "image" | "video",
  purpose: "character_sheet" | "location_master" | "keyframe" | "i2v" | "t2v",
  runninghubWorkflowId: "…",
  inputs: [                         // mapping: ตัวแปรของเรา → node ใน workflow
    { var: "prompt",     nodeId: "6",  fieldName: "text" },
    { var: "negative",   nodeId: "7",  fieldName: "text" },
    { var: "seed",       nodeId: "3",  fieldName: "seed" },
    { var: "width",      nodeId: "5",  fieldName: "width" },
    { var: "height",     nodeId: "5",  fieldName: "height" },
    { var: "refImage",   nodeId: "10", fieldName: "image" },
    { var: "frames",     nodeId: "20", fieldName: "length" }
  ],
  defaults: { width: 1344, height: 768 },
  version: 1, active: true
}
```
โค้ดฝั่งเราเรียกด้วยชื่อ `purpose` + ตัวแปร แล้ว service แปลงเป็น `nodeInfoList` เอง

### 14.4 Data Model เพิ่มเติม

**Asset** — ไฟล์ภาพ/วิดีโอ/เสียงที่ได้
```ts
{
  _id, projectId, type: "image" | "video" | "audio",
  purpose: "character_sheet" | "character_ref" | "location_master" | "keyframe" | "clip",
  ownerType: "character" | "location" | "shot",
  ownerId,
  url,                       // ลิงก์ผลลัพธ์จาก RunningHub (หมดอายุได้ ให้ดาวน์โหลดเก็บเอง)
  storageKey,                // ที่เก็บของเรา (local/S3/MinIO)
  generationId,              // อ้างอิง GenerationTask
  approved: false, isPrimary: false,
  createdAt
}
```

**GenerationTask** — 1 รายการต่อ 1 การเรียก RunningHub
```ts
{
  _id, projectId, episodeId,
  target: { type: "character" | "location" | "shot", id },
  workflowKey, runninghubWorkflowId,
  runninghubTaskId,
  params: { prompt, seed, width, height, refAssetIds: [] },   // ที่ส่งไปจริง
  nodeInfoList: [],                                            // เก็บไว้ debug
  status: "pending"|"queued"|"running"|"succeeded"|"failed"|"cancelled",
  attempts: 0, error,
  outputs: [{ url, type, assetId }],
  cost: { credits: null },
  createdAt, startedAt, finishedAt
}
```
ใน `Shot` เพิ่ม: `keyframeAssetId`, `clipAssetId`, `takes: [assetId]`

### 14.5 Flow การทำงาน

**S6 – Image Generation (ลำดับสำคัญ)**
1. **Character sheet**: ใช้ `characterSheetPrompt` → ได้ภาพ turnaround/expressions → คนเลือกและ **approve** ภาพหลัก (`isPrimary`)
2. **Location master**: ใช้ `masterPrompt` ของสถานที่ → approve
3. **Keyframe ต่อ shot**: ใช้ prompt ของ shot + **ภาพ reference ของตัวละครและสถานที่ใน shot นั้น** (ส่งเข้า node โหลดภาพ / IPAdapter / reference ตามที่ workflow รองรับ)
4. ผลทุกครั้งสร้าง `Asset` ให้คนเลือก/ปฏิเสธ/สร้างใหม่ (รันได้หลาย take โดยเปลี่ยน seed)

**S7 – Video Generation**
1. ใช้ keyframe ที่ approve แล้วเป็นภาพเริ่ม (image-to-video) + prompt การเคลื่อนไหว/กล้อง จาก shot
2. ใช้ prompt ฟอร์แมต DY ต่อ clip (หัวข้อ 15) พร้อมแนบ Picture 1/2; กำหนดความยาวตามข้อจำกัดของ workflow/โมเดลวิดีโอ (ยาวเกิน ให้แยกเป็นหลาย clip)
3. ได้หลาย take → คนเลือก `clipAssetId`
4. (Phase 7) รวมคลิป + เสียงด้วย FFmpeg ให้เป็น EP

**วงจรของ GenerationTask**
```
สร้าง GenerationTask (pending)
  → แปลง params เป็น nodeInfoList ตาม Workflow Registry
  → อัปโหลด reference image (ถ้ามี) ผ่าน Upload Resource API
  → เรียก /task/openapi/create (ส่ง webhookUrl)
  → เก็บ runninghubTaskId → status=queued
  → polling /task/openapi/status (เริ่ม ~5 วินาที ค่อยๆ เพิ่มช่วงห่าง; ไม่ใช้ webhook เพราะรันใน local)
  → สำเร็จ: เรียก /task/openapi/outputs → ดาวน์โหลดไฟล์ → บันทึก Asset → ผูกกับ Shot/Character/Location
  → ล้มเหลว: retry ตามประเภท error (queue maxed → backoff, nodeInfo ผิด → ไม่ retry)
```

### 14.6 Queue & Concurrency สำหรับ Generation
- Queue แยก: `gen-image`, `gen-video`
- **ตั้ง concurrency ให้ต่ำกว่าโควตา RunningHub** ของบัญชี (ชน limit จะได้ error 421) และทำ rate limiter ตามจำนวนงานพร้อมกันที่บัญชีรองรับ
- วิดีโอใช้เวลานานและกินเครดิตมาก: ให้มีปุ่ม "สร้างทีละ shot" และ "สร้างทั้ง scene" พร้อมประเมินจำนวน task ก่อนกดยืนยัน
- Idempotency: ใช้ `generationKey = hash(workflowKey + target + params)` ป้องกันกดซ้ำแล้วเสียเครดิตซ้ำ
- **ไม่ใช้ webhook** (เครื่อง local ไม่มี public URL) — ใช้ polling อย่างเดียว และเมื่อเปิดแอปใหม่ให้ resync task ที่ยังค้างด้วย `runninghubTaskId` (ดูหัวข้อ 18.3)

### 14.7 Consistency ของตัวละคร (ประเด็นสำคัญที่สุดของงานภาพ)
- ใช้ **reference image ที่ approve แล้ว** ของตัวละครเป็น input ทุก keyframe
- ใส่ `appearanceBlock` แบบ verbatim ใน prompt ทุกครั้ง
- ถ้าตัวละครหลักต้องการความคงที่สูง: เตรียม **LoRA ต่อตัวละคร** (ฝึกจากภาพ character sheet) แล้วอัปโหลดผ่าน Upload Lora API และเก็บ `loraName`/น้ำหนักไว้ใน Character
- เก็บ seed/params ของภาพที่ approve เพื่อ reproduce
- เพิ่ม `negativePrompt` กลางใน `Project.styleGuide`

### 14.8 API ภายในที่เพิ่ม
| Method | Path | หน้าที่ |
|---|---|---|
| GET/POST | `/workflows` | จัดการ Workflow Registry |
| POST | `/characters/:id/generate-sheet` | สร้าง character sheet |
| POST | `/locations/:id/generate-master` | สร้างภาพสถานที่ |
| POST | `/shots/:id/generate-keyframe` | สร้าง keyframe (ระบุจำนวน take) |
| POST | `/shots/:id/generate-video` | สร้างคลิปวิดีโอ |
| POST | `/assets/:id/approve` | approve / set primary |
| POST | `/webhooks/runninghub` | รับผลจาก RunningHub |
| GET | `/generation-tasks?status=` | ดูคิว/ประวัติ/error |
| POST | `/generation-tasks/:id/cancel` | ยกเลิก (เรียก cancel API) |

### 14.9 ตัวอย่างโค้ด RunningHub client
```ts
// src/generation/runninghub.client.ts
import { request } from "undici";

const BASE = process.env.RH_BASE_URL ?? "https://www.runninghub.ai";
const API_KEY = process.env.RH_API_KEY!;

async function post(path: string, body: Record<string, unknown>) {
  const res = await request(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", Host: new URL(BASE).host },
    body: JSON.stringify({ apiKey: API_KEY, ...body }),
  });
  return res.body.json() as Promise<any>;
}

export const rh = {
  create: (workflowId: string, nodeInfoList: any[], webhookUrl?: string) =>
    post("/task/openapi/create", { workflowId, nodeInfoList, webhookUrl }),
  status:  (taskId: string) => post("/task/openapi/status", { taskId }),
  outputs: (taskId: string) => post("/task/openapi/outputs", { taskId }),
  cancel:  (taskId: string) => post("/task/openapi/cancel", { taskId }),
};

// แปลงตัวแปรของเรา → nodeInfoList ตาม Workflow Registry
export function buildNodeInfoList(
  wf: { inputs: { var: string; nodeId: string; fieldName: string }[]; defaults?: any },
  vars: Record<string, unknown>
) {
  const merged = { ...wf.defaults, ...vars, seed: vars.seed ?? Math.floor(Math.random() * 2 ** 31) };
  return wf.inputs
    .filter(i => merged[i.var] !== undefined)
    .map(i => ({ nodeId: i.nodeId, fieldName: i.fieldName, fieldValue: merged[i.var] }));
}
```
> โครงสร้าง response (ชื่อ field ของ status/outputs) ให้ดูตัวอย่างในเอกสาร RunningHub แล้วทำ Zod schema ครอบ เพื่อให้จับการเปลี่ยนแปลงของ API ได้เร็ว

### 14.10 ความเสี่ยงเฉพาะส่วน Generation
| ความเสี่ยง | วิธีรับมือ |
|---|---|
| เครดิตหมดเร็ว (โดยเฉพาะวิดีโอ) | ประเมินจำนวน task ก่อนรัน, จำกัด take ต่อ shot, ทำ dry-run, แสดงยอดใช้จ่ายต่อ EP |
| ลิงก์ผลลัพธ์หมดอายุ | ดาวน์โหลดไฟล์ไปเก็บใน storage ของเราทันทีที่ task สำเร็จ |
| ชน concurrency limit | rate limiter + backoff เมื่อได้ error 421 |
| Workflow ถูกแก้บน RunningHub แล้ว `nodeId` เปลี่ยน | เก็บ `version` ใน Registry, มี health check ทดสอบ workflow ด้วย input ตัวอย่างเป็นระยะ |
| ปิดแอป/เครื่องหลับระหว่างสร้าง | task ยังรันบน cloud; ตอนเปิดแอปใหม่ resync ด้วย `runninghubTaskId` แล้วดาวน์โหลดผล (ตรวจอายุลิงก์ผลลัพธ์ของ RunningHub) |
| ตัวละครหน้าเพี้ยนใน keyframe | reference image + LoRA + approve ที่ checkpoint 4 ก่อนสร้างวิดีโอ |
| API Key รั่ว | เก็บใน env/secret manager, เรียกจาก backend เท่านั้น |

---

## 15. Video Prompt Format (DY)

### 15.1 โครงสร้างของ prompt (ตามตัวอย่างที่ใช้จริง)

```
DY,subject_definitions:
<Subject 1> is <สถานที่ + อ้างอิงภาพ เช่น "the restaurant environment in <Picture 1>" + รายละเอียด>.
<Subject 2> is <ตัวละคร + "shown in <Picture 1> and in the left close-up of <Picture 2>" + appearanceBlock>.
<Subject 3> is <ตัวละครที่สอง ...>.

summary:
[reference generation] The target is a {N}-second {style} {scene type} set inside <Subject 1>. <Picture 1> provides ... <Picture 2> provides ... The scene progresses through {k} connected shots ..., with all dialogue performed naturally in {language}.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - {สิ่งที่ต้องคงที่}.
<Subject 2> (appears in [Shot ...]): fully_preserved - {...}.
<Subject 3> (appears in [Shot ...]): fully_preserved - {...}.

detailed_description:
{สไตล์ภาพ แสง ความลึกสนาม film grain จังหวะอารมณ์ ภาษาและ lip-sync}

[Shot 1] {กล้อง + ภาพ + ท่าทาง ... <Subject 3> (S1) speaks {น้ำเสียง}: <d>[Language] {บทพูด}</d> ...}

[Shot 2] At 00:05.000, {...}

[Shot 3] At 00:10.000, {...}

overall_soundscape:
{เสียงบรรยากาศ + เสียงกายภาพ + ข้อห้าม เช่น No subtitles or visible text.}

non_diegetic_music:
{ดนตรีประกอบ}
```

### 15.2 กฎของฟอร์แมต (สรุปจากตัวอย่าง)

| หัวข้อ | กฎ |
|---|---|
| Prefix | ขึ้นต้นด้วย `DY,subject_definitions:` (ตั้งค่า prefix ใน `Project.styleGuide.promptPrefix` เผื่อเปลี่ยนโมเดล) |
| Subject | เรียงลำดับ: **Subject 1 = สถานที่**, ตามด้วยตัวละคร; ลำดับ reset ใหม่ทุก clip; ใส่เฉพาะที่ปรากฏใน clip นั้น |
| Picture | `<Picture 1>` = ภาพ scene/keyframe (สถานที่ + ตำแหน่งนั่ง + ชุด + แสง), `<Picture 2>` = ภาพ close-up ใบหน้าตัวละคร (ซ้าย/ขวา) ตามจำนวนตัวละคร |
| summary | ขึ้นต้น `[reference generation]` ระบุความยาวรวม **ของ clip นั้น**, บอกว่าแต่ละ Picture ให้อะไร, จำนวน shot **ใน clip นั้น**, ภาษาบทพูด (clip ที่ 2 เป็นต้นไปให้ระบุว่าต่อเนื่องจาก clip ก่อนหน้า) |
| retention_analysis | ทุก Subject ระบุ `appears in [Shot …]` และ `fully_preserved - …` |
| Shots | **จำนวน shot ต่อ scene ไม่จำกัด** (ตามความเหมาะสมของเนื้อหา); ใน **clip สุดท้ายที่ส่งไปสร้างวิดีโอ** timestamp เริ่มที่ 00:00 ใหม่ทุก clip และทุก clip รวม ≤ 20 วินาที; Shot แรกไม่ต้องมี timestamp (หรือ `At 00:00.000`) ที่เหลือใช้ `At 00:05.000`, `At 00:10.000` ฯลฯ ตามความยาวจริงของ shot |
| บทพูด | `<Subject N> (S#) speaks {tone}: <d>[Language] ข้อความ</d>` ; ใช้ `(S#)` เป็นรหัสผู้พูด (สันนิษฐาน: เรียงตามลำดับที่เริ่มพูดใน clip — **ยืนยันกับโมเดลวิดีโอที่ใช้**) |
| ปริมาณบทพูด | ประมาณ 1–2 ประโยคสั้นต่อ shot ~5 วินาที (ตัวอย่างมี 6 ประโยคใน 15 วินาที) ถ้าเกินเพดานของ shot ให้ตัดเป็น shot เพิ่ม (ซึ่ง Clip Splitter จะจัดเข้า clip ให้) |
| Soundscape | มีทั้ง ambient, เสียงกายภาพ และ `No subtitles or visible text.` |
| Music | สั้น เจาะจง เช่น instrument + อารมณ์ + ไม่ให้กลบบทพูด |

> **ภาษาของบทพูด:** ตัวอย่างใช้ `[English]` ส่วนนิยายเป็นภาษาไทย ให้ตั้ง `Project.dialogueLanguage` (`English` | `Thai`) แล้วใส่ tag ตามนั้น (เช่น `<d>[Thai] ...</d>`) — ต้องทดสอบว่า workflow/โมเดลที่ใช้ lip-sync ภาษาไทยได้ดีแค่ไหน ถ้าไม่ดีอาจใช้บทพูดอังกฤษในวิดีโอแล้วทำพากย์ไทยแยก (บทไทยยังเก็บใน `Shot.dialogue.lineTh`)

### 15.3 กระบวนการประกอบ prompt (Hybrid: โค้ด + LLM)

1. **S4a: ออกแบบ shots ของทั้ง scene** — LLM กำหนดจำนวน shot เองตามเนื้อหา (ไม่มีเพดานจำนวน) แต่ละ shot มี `durationSec` และ `beat` (ดูหัวข้อ 15.9) แล้วค่อย **S4b แบ่งเป็น clip ≤ 20 วินาที** ด้วยโค้ด
2. **เตรียม reference pictures** (ต้อง approve แล้ว):
   - Picture 1: keyframe ของ scene (สร้างใน S6 จาก location master + ตัวละคร + ชุด)
   - Picture 2: ภาพ close-up ตัวละครที่พูดใน clip (ประกอบจาก character sheet เป็นภาพเดียว ซ้าย/ขวา) — ทำด้วย workflow ใน ComfyUI หรือ crop/compose ด้วยโค้ด (sharp) ก็ได้
3. **โค้ดสร้างส่วนคงที่**: `subject_definitions` (ดึง `appearanceBlock`/`locationBlock` แบบ verbatim + ข้อความอ้างอิง Picture), `retention_analysis` (โครงประโยค + ให้ LLM เติมเฉพาะส่วนที่ต้องคงที่), mapping Subject ↔ character/location ↔ `(S#)`
4. **LLM สร้างส่วนเนื้อหา** เป็น JSON ตาม schema (ไม่ใช่ข้อความอิสระ):
   `summary`, `visualTone`, `shots[]` (กล้อง, action, dialogue[] พร้อม tone), `soundscape`, `music`
5. **โค้ดประกอบเป็นข้อความ DY** ด้วย template (`src/templates/dy.ts`) → เก็บใน `Scene.clips[].videoPrompt`
6. **Validator** ตรวจก่อนบันทึก (ดู 15.5)

### 15.4 Zod schema (ผลลัพธ์ที่ LLM ต้องคืน)

```ts
const DialogueLine = z.object({
  speakerCharacterId: z.string(),
  tone: z.string(),                    // "softly, with hesitation and regret"
  text: z.string().min(1),
});

const ShotDraft = z.object({
  durationSec: z.number().min(1).max(20),   // ต่อ shot ต้องไม่เกิน maxClipSec; แนะนำ 3–8s
  beat: z.object({                           // ใช้ตัดสินใจจุดตัด clip
    breakQuality: z.enum(["hard", "soft", "avoid"]),   // hard = ตัดได้ดี (เปลี่ยนสถานที่/เวลา/จบบทสนทนา), avoid = ห้ามตัดหลัง shot นี้ (กลางประโยค/กลางแอ็กชัน)
    note: z.string().optional(),
  }),
  camera: z.string(),
  description: z.string(),             // ภาพ + ท่าทาง + ปฏิกิริยา (บทพูดแทรกด้วยโค้ด)
  dialogue: z.array(DialogueLine).max(3),
  charactersInShot: z.array(z.string()),
});

export const SceneVideoPromptDraft = z.object({
  title: z.string(),
  sceneType: z.string(),               // "breakup scene"
  summary: z.string(),
  visualTone: z.string(),
  shots: z.array(ShotDraft).min(1),          // ไม่จำกัดจำนวน shot
  retentionNotes: z.record(z.string(), z.string()),  // key = characterId/locationId
  soundscape: z.string(),
  music: z.string(),
});
// หมายเหตุ: ในข้อความ description/บทพูดใช้ token แทนตัวละคร/สถานที่ เช่น {{char:ID}} {{loc:ID}}
// ให้โค้ดแทนเป็น <Subject N> ตามลำดับใน *แต่ละ clip* ตอนประกอบข้อความ (ดู 15.9)
```

### 15.5 Validator (ตรวจก่อนส่งไปสร้างวิดีโอ)

- ทุก `<Subject N>` ที่ใช้ใน shot ต้องถูกนิยามใน `subject_definitions`
- ทุก Subject ที่นิยามต้องปรากฏใน `retention_analysis` และอย่างน้อย 1 shot
- `(S#)` ของผู้พูดตรงกับ mapping และเรียงลำดับสม่ำเสมอ
- `appearanceBlock`/`locationBlock` ใน prompt ตรงกับ Bible 100% (เทียบสตริง)
- timestamp ขึ้นต้น 00:00 เรียงลำดับ และไม่เกินความยาว clip
- จำนวนคำบทพูดต่อ shot ไม่เกินเพดานตามความยาว shot (ตั้งค่าได้)
- ทุก `<d>…</d>` ปิดแท็กครบ และมี tag ภาษา
- จำนวน `<Picture N>` ที่อ้างถึง = จำนวน reference ที่แนบจริง
- มีข้อความ `No subtitles or visible text.` ใน soundscape
- ความยาวรวม prompt ไม่เกินข้อจำกัดของ workflow/โมเดล
- **ทุก clip ยาว ≤ `maxClipSec` (20s)** และ ≥ `minClipSec` (ยกเว้น clip เดียวของ scene สั้น)
- ผลรวม `durationSec` ของทุก clip = `totalDurationSec` ของ scene (ไม่ตกหล่น/ซ้ำ shot)
- shot ทุกตัวอยู่ใน clip เดียวเท่านั้น และลำดับเรียงตามต้นฉบับ
- ทุก clip: timestamp เริ่ม 00:00 ใหม่, เลข `[Shot N]` เริ่ม 1 ใหม่, `<Subject N>` นับใหม่เฉพาะที่ปรากฏใน clip

### 15.6 ผลต่อ Workflow Registry (RunningHub)

เนื่องจาก prompt อ้างอิง `<Picture 1>`, `<Picture 2>` workflow วิดีโอต้องรับภาพ reference หลายช่อง — เพิ่มใน `inputs`:

```ts
{ var: "prompt",        nodeId: "…", fieldName: "text"  },
{ var: "refPicture1",   nodeId: "…", fieldName: "image" },   // scene keyframe
{ var: "refPicture2",   nodeId: "…", fieldName: "image" },   // character close-ups
{ var: "durationSec",   nodeId: "…", fieldName: "…"     },
{ var: "seed",          nodeId: "…", fieldName: "seed"  }
```
ลำดับอัปโหลด: อัปโหลด Picture 1/2 ผ่าน Upload Resource API → ได้ชื่อไฟล์ → ใส่ใน `nodeInfoList` → ส่ง `videoPrompt` เป็น `prompt`
(ตรวจว่า workflow ที่ใช้ตีความ `<Picture N>` ตามลำดับ input จริง)

### 15.7 ตัวอย่างผลลัพธ์ (ย่อ)

```
DY,subject_definitions:
<Subject 1> is the nighttime restaurant environment in <Picture 1>, viewed through a large reflective window, with warm amber interior lighting ...
<Subject 2> is the young woman shown in <Picture 1> and in the left close-up of <Picture 2>, with short dark curly hair, hoop earrings, red lipstick ...
<Subject 3> is the young man shown in <Picture 1> and in the right close-up of <Picture 2>, with wavy dark hair, a black suit jacket ...

summary:
[reference generation] The target is a 15-second realistic cinematic breakup scene set inside <Subject 1>. ... with all dialogue performed naturally in English.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - ...
...
[Shot 1] ... <Subject 3> (S1) speaks softly, with hesitation and regret: <d>[English] I thought you were bluffing when you said you were leaving.</d> ...
[Shot 2] At 00:05.000, ...
[Shot 3] At 00:10.000, ...

overall_soundscape: ... No subtitles or visible text.
non_diegetic_music: A very restrained, melancholic score with sparse felt-piano notes ...
```

> เก็บตัวอย่างเต็มที่ใช้งานจริงไว้ใน `tests/fixtures/dy-prompt.sample.txt` เพื่อใช้เป็น golden test ของ template (`dy.ts` ต้องประกอบได้โครงเดียวกัน) และใช้เป็น few-shot ใน system prompt ของ S4

### 15.8 ลำดับการทำงานที่เปลี่ยนไป

```
S3 Shots/Dialogue → S6 สร้าง keyframe + close-up (Picture 1/2, approve)
                  → S4a ออกแบบ scene prompt (ทั้ง scene, shots ไม่จำกัด)
                  → S4b Clip Splitter (แบ่งเป็นชุด ≤ 20s) → ประกอบ DY prompt ต่อ clip → validator
                  → S7 สร้างวิดีโอ (ส่ง prompt + Picture 1/2)
```
S4 จึงรันหลัง S6 ของ clip นั้น (หรือรัน draft ก่อน แล้ว "finalize" เมื่อมี asset ครบ — เก็บ `promptVersion` ไว้)

### 15.9 Clip Splitter (S4b): แบ่ง scene prompt เป็นชุดละไม่เกิน 20 วินาที

**หลักการ:** scene ยาวได้ และมี shot กี่ช็อตก็ได้ แต่โมเดลวิดีโอสร้างได้ครั้งละจำกัด จึงต้องแบ่ง scene เป็น **ชุด (clip)** ที่ **รวมกันแล้วไม่เกิน 20 วินาทีต่อชุด** โดยแต่ละชุดเป็น prompt ฟอร์แมต DY ที่ครบในตัวเอง

**ค่าที่ตั้งได้ (`Project.clipPolicy`):** เพดานผู้ใช้ 20 วินาที แต่ **ค่าที่ใช้จริง = min(20, เพดานของโมเดล)** — เมื่อใช้ MiniMax H3 (สร้างได้ 5–15 วินาทีต่อครั้ง) จึงเท่ากับ **15 วินาที**; `targetClipSec = 12`, `minClipSec = 5`. อัลกอริทึมด้านล่างรับ `maxClipSec` เป็น parameter จึงเปลี่ยนโมเดลได้โดยไม่แก้โค้ด

**กฎการตัด**
1. ตัดได้เฉพาะ **ระหว่าง shot** — ห้ามตัดกลาง shot; ความยาว clip ต้องเป็นวินาทีเต็มและอยู่ในช่วงที่โมเดลรองรับ (H3: 5–15)
2. ไม่ตัดกลางประโยค/บทสนทนาที่ต่อเนื่อง และไม่ตัดกลางแอ็กชัน (ใช้ `beat.breakQuality`)
3. ชอบตัดที่จุด `hard` เช่น เปลี่ยนสถานที่/เวลา, จบ exchange ของบทสนทนา, เปลี่ยนอารมณ์
4. ไม่ให้เหลือ clip สั้นเกินไป (< `minClipSec`) — ปรับสมดุลกับ clip ข้างเคียง
5. ถ้า shot เดียวยาวเกิน 20s (ไม่ควรเกิด เพราะ schema จำกัดไว้แล้ว) → ส่งกลับให้ S4a ออกแบบใหม่ ไม่ตัดอัตโนมัติ

**อัลกอริทึม (โค้ด ไม่ใช้ LLM):** dynamic programming หาการแบ่งที่มี cost ต่ำสุด
- cost ของ 1 clip = `(durationSec − targetClipSec)²` (ยิ่งใกล้เป้า ยิ่งดี)
- บวก penalty ใหญ่ถ้าตัดตรงจุด `avoid`, penalty เล็กถ้า `soft`, ไม่มี penalty ถ้า `hard`
- ข้อจำกัดเด็ดขาด: clip ใดรวม > `maxClipSec` ไม่ถูกต้อง
- ผลลัพธ์: รายการ clip พร้อม shot ที่อยู่ในนั้น

```ts
// src/services/clipSplitter.ts  (maxClipSec = min(userMax, videoModel.maxDurationSec))
type Shot = { id: string; durationSec: number; breakQuality: "hard" | "soft" | "avoid" };
type Policy = { maxClipSec: number; targetClipSec: number; minClipSec: number };

export function splitIntoClips(shots: Shot[], pol: Policy): Shot[][] {
  if (shots.length === 0) return [];

  const n = shots.length;
  const prefix: number[] = [0];
  for (const sh of shots) prefix.push(prefix[prefix.length - 1] + sh.durationSec);
  const dur = (i: number, j: number) => prefix[j] - prefix[i];          // shots[i..j)
  const cutPenalty = (j: number) => {                                    // ตัดหลัง shot j-1
    if (j === n) return 0;
    return { hard: 0, soft: 6, avoid: 80 }[shots[j - 1].breakQuality];
  };

  const best = Array(n + 1).fill(Infinity), from = Array(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let i = j - 1; i >= 0; i--) {
      const d = dur(i, j);
      if (d > pol.maxClipSec) break;                                     // เกินเพดาน
      if (best[i] === Infinity) continue;                                // ไม่มีทางมาถึง i
      const short = d < pol.minClipSec && !(i === 0 && j === n) ? 50 : 0;
      const cost = best[i] + (d - pol.targetClipSec) ** 2 + short + cutPenalty(j);
      if (cost < best[j]) { best[j] = cost; from[j] = i; }
    }
  }
  if (!isFinite(best[n])) throw new Error("มี shot ยาวเกิน maxClipSec — ให้ S4a ออกแบบใหม่");

  const clips: Shot[][] = [];
  let j = n;
  while (j > 0) {
    const i = from[j];
    clips.unshift(shots.slice(i, j));
    j = i;
  }
  return clips;
}
```

**ตัวอย่าง:** scene ยาว 47 วินาที มี 9 shots (6, 5, 4, 7, 5, 6, 5, 4, 5 วินาที) ใช้เพดาน 15 วินาที (MiniMax H3) — ผลที่ทดสอบรันแล้ว

| Clip | Shots | ความยาว |
|---|---|---|
| C01 | 1–2 | 11s |
| C02 | 3–4 | 11s |
| C03 | 5–6 | 11s |
| C04 | 7–9 | 14s |

(ถ้าจุดตัดระหว่าง shot ใดเป็น `avoid` อัลกอริทึมจะเลื่อนจุดตัดไปตำแหน่งที่เหมาะกว่า ตราบที่ไม่เกินเพดาน; ถ้าตั้งเพดาน 20s จะได้ 3 clip)

**การประกอบ prompt ของแต่ละ clip (โค้ดทั้งหมด ยกเว้นส่วนที่ระบุว่า LLM)**
1. **Re-index:** สร้างรายการ Subject เฉพาะที่ปรากฏใน clip นี้ (สถานที่ = Subject 1) แล้วแทน token `{{char:ID}}`/`{{loc:ID}}` ด้วย `<Subject N>` ใหม่ → เลข Subject และ `(S#)` จึงนับใหม่ต่อ clip
2. **Re-time:** คำนวณ `At 00:SS.000` ใหม่จากความยาว shot โดยเริ่มที่ 00:00 และเรียง `[Shot 1..k]` ใหม่
3. **สร้างส่วนหัวใหม่:** `subject_definitions` และ `retention_analysis` (appears in [Shot …] ตาม clip) จาก Bible
4. **summary / soundscape / music (LLM เรียกเบาๆ ต่อ clip):** ส่ง context "clip k จาก n", สรุป clip ก่อนหน้า/ถัดไป และ visualTone ของ scene เพื่อให้ clip ที่ ≥ 2 ขึ้นต้นว่าต่อเนื่องจาก clip ก่อนหน้า และดนตรี/เสียงต่อเนื่องกัน (หรือใช้ตัวที่ตัดมาจาก scene-level ถ้าต้องการประหยัด)
5. **Reference pictures:** กำหนดตาม `continuityMode`
   - `scene_keyframe`: ทุก clip ใช้ keyframe ของ scene เป็น Picture 1 → **สร้างวิดีโอแบบขนานได้** แต่ความต่อเนื่องระหว่าง clip พึ่งพา prompt/reference เป็นหลัก
   - `last_frame`: clip k ใช้ **เฟรมสุดท้ายของ clip k−1** (ดึงด้วย FFmpeg) เป็น Picture 1 → ต่อเนื่องกว่า แต่ **ต้องสร้างทีละ clip ตามลำดับ** (เสียเวลา/เครดิตมากขึ้น ถ้า clip ก่อนหน้าไม่ผ่านต้องสร้างใหม่ทั้งสายต่อจากนั้น)
   - ทั้งสองโหมดใช้ Picture 2 (close-up ตัวละครที่ปรากฏใน clip) เหมือนเดิม
6. **Validator** (หัวข้อ 15.5) ก่อนบันทึกลง `Scene.clips[]`

**ผลต่อส่วนอื่น**
- `GenerationTask` ผูกกับ `clipCode` (1 task ต่อ 1 clip) และ `Shot.clipAssetId` ชี้ไปยังคลิปของ clip ที่ shot นั้นอยู่
- การรวมคลิปเป็น EP (FFmpeg) เรียงตาม `scene.order` → `clip.startOffsetSec`
- แก้ shot หรือบทพูดแล้ว ให้ **รัน S4b ใหม่เฉพาะ scene นั้น** (clip ที่เปลี่ยนเนื้อหาถูกมาร์คว่า `stale`; clip ที่ shot ชุดเดิมไม่เปลี่ยนใช้ผลเดิมต่อได้ — เทียบด้วย hash ของ shot ที่อยู่ใน clip)
- Endpoint เพิ่ม: `POST /scenes/:id/split-clips` (รัน/รันใหม่ S4b), `PATCH /scenes/:id/clips` (ปรับจุดตัดเอง แล้ว validator ตรวจเพดาน 20s)

---

## 16. Video Model: MiniMax H3 (ผ่าน ComfyUI workflow)

> ข้อมูลในหัวข้อนี้สรุปจากเอกสารสาธารณะ (ComfyUI docs, เว็บ/ผู้ให้บริการที่ลงข้อมูลโมเดล) ณ ตอนวางแผน โมเดลออกใหม่ (ปลาย ก.ค. 2026) รายละเอียดอาจเปลี่ยนเร็ว และบางตัวเลขต่างกันตามผู้ให้บริการ — **ทดสอบกับ workflow จริงบน RunningHub ก่อนล็อกค่า**

### 16.1 ความสามารถ/ข้อจำกัดที่ส่งผลต่อระบบ

| รายการ | ค่า | ผลต่อแผน |
|---|---|---|
| ความยาวต่อการสร้าง | **5–15 วินาที** (ไม่มีต่ำกว่า 5) | Clip Splitter ใช้ `maxClipSec = 15`, `minClipSec = 5` (แทน 20) |
| ความละเอียด / fps | ระดับ 2K (บางผู้ให้บริการมี 768p), ~24 fps | เก็บใน `videoModel`; ใช้ draft ความละเอียดต่ำเพื่อประหยัด |
| เสียง | **native stereo audio + lip sync** (บทพูดสร้างพร้อมวิดีโอ) | บทพูดอยู่ใน prompt ได้เลย |
| โหมด | T2V, I2V (first + optional last frame), **R2V (reference-to-video)** | ใช้ R2V เป็นหลัก, I2V/FLF2V สำหรับต่อเนื่อง |
| Reference | รวม ≤ 12 ไฟล์: ภาพ ≤ 9, วิดีโอ ≤ 3, เสียง ≤ 3 (วิดีโอ/เสียงยาว 2–15s) | จำกัดตัวละครที่มี audio reference ต่อ clip ได้ ≤ 3 |
| Audio reference | **ต้องมีภาพหรือวิดีโอ reference อย่างน้อย 1 ไฟล์ประกอบ** | ส่งเสียงอย่างเดียวไม่ได้ |
| Prompt | แหล่งข้อมูลหนึ่งระบุ **2–2,000 ตัวอักษร** ต่อ request | ⚠️ prompt DY ตัวอย่างยาวกว่านี้มาก ต้องตรวจ (16.4) |
| Weights/การรัน | มีทั้ง **API nodes (cloud)** และ **open weights native** (H3-Base: FL2VA, Ref2VA; มี turbo mode ~8 steps) | ต้องรู้ว่า workflow บน RunningHub ใช้แบบไหน (16.2) |
| โมเดลเสริม | H3 Max (ออก ก.ย. 2026): เร็ว/ถูกกว่า, ความละเอียดต่ำกว่า, รองรับ first/last frame | ใช้เป็น **draft/preview** ได้ ถ้ามี workflow รองรับ |

### 16.2 คำถามที่ต้องยืนยัน: รัน H3 แบบไหนบน RunningHub

| วิธี | ลักษณะ | ข้อควรตรวจ |
|---|---|---|
| **A. ComfyUI Partner/API nodes** (MiniMax H3 API) | node ส่งงานไปยัง MiniMax API | node แบบ API ต้องใช้ API key/เครดิตของผู้ให้บริการ — ตรวจว่า RunningHub รองรับ node กลุ่มนี้และคิดเครดิตอย่างไร |
| **B. Open-weights native** (H3-Base) | รันบน GPU ของ RunningHub ตรงๆ | ตรวจ VRAM/เวลา/ค่าบริการต่อวินาที, ใช้ `turbo_mode` ลดเวลาได้ |
| **C. Custom node pack ภายนอก** (เช่นที่ส่งผ่าน Muapi) | ต้องมี API key ของตัวกลาง | ระวังความเสถียรและต้นทุน |

> Workflow ที่ขึ้น RunningHub ต้อง Export แบบ API format และเปิดให้ปรับ input ผ่าน `nodeInfoList` ได้ (ดูหัวข้อ 14) — ทดสอบ 1 รอบว่า field ของ prompt, reference images, เสียง และ duration ถูกเปลี่ยนค่าได้จริงทาง API

### 16.3 ผลต่อ pipeline

1. **เพดาน clip = 15 วินาที** (ลดจากที่ตั้งไว้ 20): scene ยาวขึ้นจะมีจำนวน clip มากขึ้นและต้นทุนเพิ่มตามวินาที — ตั้ง `videoModel.maxDurationSec` แล้วระบบคำนวณเอง
2. **ความยาว clip ต้องเป็นวินาทีเต็ม ช่วง 5–15**: ถ้า scene/shot รวมกันได้ < 5 วินาที ต้องรวมกับ clip ข้างเคียง หรือเติม shot (เช่น reaction shot) — validator ตรวจ
3. **ใช้ R2V เป็นโหมดหลัก** โดยแมป reference ดังนี้

| Slot | เนื้อหา | หมายเหตุ |
|---|---|---|
| Image 1 | keyframe ของฉาก = `<Picture 1>` | สถานที่ ตำแหน่งนั่ง ชุด แสง |
| Image 2 | close-up ตัวละคร = `<Picture 2>` | ใบหน้า/ชุด ซ้าย-ขวา |
| Image 3–9 | ตัวละครเพิ่ม, prop สำคัญ, สไตล์ | ใช้เมื่อจำเป็น |
| Audio 1–3 | **ตัวอย่างเสียงของตัวละครที่พูดใน clip** (≤ 3 คน) | ล็อก timbre เสียง ให้เชื่อม Voice Design — สร้างตัวอย่างเสียงจาก `voicePrompt`/TTS ของแต่ละตัวละคร แล้วเก็บเป็น Asset `voice_sample` (ต้องมีภาพ reference คู่กัน) |
| Video 1–3 | (ไม่บังคับ) clip ก่อนหน้า = continuation, หรืออ้างอิงท่าทาง/การเคลื่อนไหว | ใช้กับโหมด `continuity` |

4. **ความต่อเนื่องระหว่าง clip** (เพิ่มตัวเลือกจาก 15.9)
   - `scene_keyframe`: ทุก clip ใช้ keyframe + reference เดิม (ขนานได้)
   - `last_frame`: ใช้เฟรมสุดท้ายของ clip ก่อนหน้าเป็น `first_frame` (I2V/FLF2V) — ต้องทำตามลำดับ
   - `continuation`: ส่ง clip ก่อนหน้าเป็น **video reference** (R2V ใช้ต่อเนื้อหาได้) — ความยาวของ video reference 2–15s และนับรวมใน limit 12 ไฟล์
   - **first + last frame**: ถ้ามี keyframe เป้าหมายของ clip (เช่นภาพจบ) ใส่เป็น `last_frame` เพื่อคุมปลายทางของ clip
5. **Draft → Final:** ทำ 2 ชั้น เพื่อประหยัดเครดิต — draft (turbo mode / ความละเอียดต่ำ / H3 Max ถ้ามี) เพื่อตรวจบล็อกกิ้งและบทพูด แล้ว approve ก่อน render final 2K; เก็บ `seed` ของ draft ที่ผ่านไว้ (seed ต้องส่งเองตามที่ RunningHub กำหนด)

### 16.4 Prompt: DY ↔ ที่ H3 เข้าใจ (ประเด็นสำคัญ)

ฟอร์แมต DY ที่ใช้เป็น **ฟอร์แมตกลางของระบบ** (เก็บ, ตรวจ, ติดตาม retention) แต่ H3 มีแนวทางเขียน prompt ของตัวเอง (เช่น ระบุหน้าที่ของ reference แต่ละตัวไว้ตอนต้น และใส่บทพูดในเครื่องหมายคำพูด) จึงมี 2 ทางเลือก — **ควรทดสอบทางที่ 1 ก่อน**:

| ทาง | วิธี | ข้อดี/ข้อเสีย |
|---|---|---|
| **1. ส่ง DY ตรงๆ** | ส่ง `videoPrompt` ทั้งก้อนเป็น prompt | ง่ายสุด แต่อาจ (ก) ยาวเกินลิมิต (ข) tag `<d>…</d>`, `<Picture N>` ไม่ถูกตีความตามที่ตั้งใจ |
| **2. H3 Prompt Adapter (S4c)** | โค้ดแปลง DY → ข้อความที่ H3 ถนัด ต่อ clip | ควบคุมความยาวและรูปแบบได้ แต่เพิ่มขั้นตอนที่ต้องดูแล |

**S4c – H3 Prompt Adapter (ถ้าเลือกทาง 2)** — โค้ดทั้งหมด ไม่ใช้ LLM ยกเว้นขั้นย่อความ:
1. ขึ้นต้นด้วย **ประโยคแจกหน้าที่ reference** เช่น `Image 1 is the restaurant scene and seating layout; Image 2 shows the woman (left) and the man (right) close-ups; Audio 1 is the woman's voice; Audio 2 is the man's voice.`
2. แปลง `<Subject N>` เป็นชื่อบทบาทที่อ่านง่าย (`the woman`, `the man`) และ `<Picture N>` เป็น `Image N`
3. แปลง `<Subject N> (S#) speaks {tone}: <d>[Lang] text</d>` เป็นรูปแบบบทพูดในเครื่องหมายคำพูดพร้อมผู้พูด เช่น `The man says softly, with regret: "…"`
4. คงลำดับเวลาของ shot (`At 00:05` …) เพราะ clip หนึ่งมีหลาย shot
5. **ตัดความยาวตาม `promptMaxChars`:** ตัดส่วนที่ซ้ำก่อน (`retention_analysis`, คำอธิบาย subject ที่อยู่ใน reference image แล้ว) → ย่อ soundscape/music → ย่อคำบรรยาย shot; บทพูดและท่าทางสำคัญห้ามตัด
6. เก็บผลใน `clips[].promptH3` และบันทึกตัวเลือก `promptTarget` ที่ใช้ (`dy` | `h3`) ใน GenerationTask

> มีโอเพนซอร์ส node pack ที่ช่วยประกอบ prompt แบบ H3 จาก reference/subject/shot (เช่น "ComfyUI-MiniMax-H3-Guide") — อ้างอิงแนวคิดหรือใช้ใน workflow ได้ ส่วนคู่มือ prompt ทางการของ MiniMax (base guide / reference guide) ให้ใช้เป็นแหล่งตรวจ template ของ adapter

### 16.5 ภาษาของบทพูด
H3 มี lip sync ในตัว แต่คุณภาพกับภาษาไทยต้องทดสอบจริง: ลองบทพูดไทย 2–3 ประโยคใน R2V พร้อม audio reference — ถ้าไม่เสถียร ให้ใช้ `dialogueLanguage = "English"` ในวิดีโอ แล้วทำพากย์ไทยแยกด้วย TTS ตาม `voice profile` (บทไทยยังเก็บใน `Shot.dialogue.lineTh`)

### 16.6 Workflow Registry สำหรับ H3 (เพิ่มจาก 14.3 / 15.6)

```ts
// purpose: "i2v_flf" | "r2v" | "t2v" | "r2v_draft"
{
  key: "h3_r2v_v1", kind: "video", purpose: "r2v",
  runninghubWorkflowId: "…",
  inputs: [
    { var: "prompt",       nodeId: "…", fieldName: "text" },
    { var: "refImage1",    nodeId: "…", fieldName: "image" },   // scene keyframe
    { var: "refImage2",    nodeId: "…", fieldName: "image" },   // close-ups
    { var: "refImage3",    nodeId: "…", fieldName: "image" },   // (optional)
    { var: "refAudio1",    nodeId: "…", fieldName: "audio" },   // voice sample ตัวละคร A
    { var: "refAudio2",    nodeId: "…", fieldName: "audio" },
    { var: "firstFrame",   nodeId: "…", fieldName: "image" },   // สำหรับ I2V/FLF2V
    { var: "lastFrame",    nodeId: "…", fieldName: "image" },
    { var: "durationSec",  nodeId: "…", fieldName: "duration" }, // 5–15 (หรือ frames ที่ 24fps ถ้า native)
    { var: "resolution",   nodeId: "…", fieldName: "…" },
    { var: "seed",         nodeId: "…", fieldName: "seed" },
    { var: "turbo",        nodeId: "…", fieldName: "turbo_mode" } // ถ้าเป็น native
  ],
  limits: { minSec: 5, maxSec: 15, maxRefImages: 9, maxRefVideos: 3, maxRefAudios: 3 },
  version: 1
}
```
- `limits` ใช้ใน validator ตอนสร้าง `GenerationTask` (เช่น มี audio ref โดยไม่มี image ref → ปฏิเสธ)
- ชื่อ field จริงของ node ต้องดูจากไฟล์ Export Workflow (API format) ของ workflow ที่ใช้

### 16.7 ต้นทุนและเวลา
- คิดเป็น **ต่อวินาทีของวิดีโอ** (ราคาจริงขึ้นกับผู้ให้บริการ/วิธีรัน — เอกสารที่เจอแสดงตั้งแต่หลักสิบเซนต์ต่อวินาทีที่ 2K) จึงให้ระบบประมาณ `estimatedCost = Σ clip.durationSec × rate` ก่อนกดสร้าง และเก็บ `cost` ใน GenerationTask
- ตัวอย่าง: EP ที่มี 30 scene เฉลี่ย 40 วินาที ≈ 1,200 วินาที ≈ 100 clip (เฉลี่ย 12s) × (draft + final) — ควรกำหนดงบต่อ EP และจำกัดจำนวน take ต่อ clip
- ใช้ draft ก่อน final เสมอ และ `last_frame` mode ทำให้ต้อง re-render ต่อเนื่องถ้า clip ต้นสายไม่ผ่าน → ตรวจ clip ต้นสายให้ผ่านก่อนสร้างถัดไป

### 16.8 แผนทดสอบ (Spike) ก่อนเขียนระบบเต็ม — 1–2 วัน
1. รัน H3 R2V บน RunningHub ด้วยมือ: Image 1–2 + prompt DY ตัวอย่าง (ทางที่ 1) → ดูว่า tag/ความยาวใช้ได้ไหม
2. ทดสอบทาง S4c (prompt แบบ H3) กับ scene เดียวกัน เทียบคุณภาพและบทพูด
3. ทดสอบ audio reference: เสียงตัวอย่าง 2 ตัวละคร → เสียงตรง/lip sync ดีไหม (ไทยและอังกฤษ)
4. ทดสอบต่อเนื่อง 2 clip: `scene_keyframe` vs `last_frame` vs `continuation`
5. ทดสอบเรียกผ่าน `/task/openapi/create` ว่า `nodeInfoList` ควบคุม prompt/ภาพ/เสียง/duration/seed ได้ครบ
6. วัดเวลา + เครดิตต่อ clip (draft/final) → ใส่ในตัวประเมินต้นทุน

---

## 17. Web UI Plan (Step-by-step Wizard)

### 17.1 หลักการออกแบบ (ให้ใช้งานง่าย)

1. **ทำทีละขั้น (Wizard ต่อ EP):** หน้าจอหลักเป็น Stepper ตามลำดับ pipeline ผู้ใช้เห็นเสมอว่า "ตอนนี้อยู่ขั้นไหน / ขั้นต่อไปคืออะไร"
2. **หนึ่งหน้า หนึ่งงานหลัก:** แต่ละขั้นมีปุ่มหลักปุ่มเดียว (Run / Approve & ไปต่อ) ตัวเลือกขั้นสูงซ่อนไว้ใน "ตั้งค่าเพิ่มเติม"
3. **AI เสนอ คนตัดสินใจ:** ทุก checkpoint ต้อง Approve; สิ่งที่ AI เดา (`inferred`) และบทพูดที่แต่งเพิ่ม (`generated`) ติดป้ายสีให้เห็นชัด
4. **ย้อนกลับไปต้นฉบับได้เสมอ:** คลิก scene/shot แล้วไฮไลต์ย่อหน้านิยายที่เป็นต้นทาง (`sourceRange`)
5. **ไม่ทำให้ผลงานหาย:** autosave, version history, undo; ถ้าแก้ขั้นก่อนหน้า ขั้นถัดไปที่ได้รับผลกระทบจะขึ้น **"ล้าสมัย (stale)"** แต่ยังไม่ถูกลบ
6. **เห็นต้นทุนก่อนกด:** ขั้นที่เสียเครดิต (ภาพ/วิดีโอ) แสดงจำนวนงานและประมาณการค่าใช้จ่ายก่อนยืนยัน
7. **ภาษาไทยเป็นหลัก:** UI และข้อความ error เป็นไทย (เตรียม i18n), ใช้ฟอนต์ที่อ่านไทยดี (เช่น Noto Sans Thai)

### 17.2 เทคโนโลยี Frontend

| ส่วน | ตัวเลือก |
|---|---|
| Framework | React + Vite + TypeScript |
| UI kit | Tailwind CSS + shadcn/ui |
| Routing | React Router |
| Data fetching/cache | TanStack Query |
| Form + validation | React Hook Form + Zod (ใช้ schema ร่วมกับ backend ผ่าน package `shared/`) |
| State เบา ๆ | Zustand (เช่น สถานะ panel, ตัวกรอง) |
| Realtime | SSE (`/jobs/:id/stream`, `/episodes/:id/events`) |
| Drag & drop | dnd-kit (จัดเรียง/รวม scene, ลากจุดตัด clip) |
| Video/audio player | HTML5 + wavesurfer.js (ดู waveform เสียงตัวอย่าง) |
| Mock ตอนพัฒนา | MSW |
| Test | Vitest, Testing Library, Playwright (e2e), Storybook |

### 17.3 โครงสร้างหน้า (Information Architecture)

```
/                         Dashboard: รายการโปรเจกต์
/projects/new             ตัวช่วยสร้างโปรเจกต์ (Onboarding 3 ขั้น)
/projects/:pid            ภาพรวมโปรเจกต์: EP ทั้งหมด + Story Bible
  /bible                  Story Bible (ตัวละคร/สถานที่/เสียง) ใช้ร่วมทุก EP
  /settings               Style guide, video model, clip policy, คีย์ API
/projects/:pid/ep/:eid    ★ Episode Workspace (Wizard)
  /import                 ขั้น 1  นำเข้านิยาย
  /bible                  ขั้น 2  ตรวจ Story Bible ของ EP
  /scenes                 ขั้น 3  Scenes
  /shots                  ขั้น 4  Shots & บทสนทนา
  /images                 ขั้น 5  ภาพ reference & keyframe
  /clips                  ขั้น 6  Video prompts & ชุด clip (≤ 15/20s)
  /render                 ขั้น 7  สร้างวิดีโอ & เลือก take
  /export                 ขั้น 8  Export / ส่งออก
/queue                    คิวงานทั้งหมด + ต้นทุน + error
```

### 17.4 Layout หลักของ Episode Workspace

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ◀ โปรเจกต์ X › EP 01            [งานที่รัน: 2]  [เครดิตประมาณ: ฿…]  [⚙ ตั้งค่า]   │
├───────────────────────────────────────────────────────────────────────────┤
│ ①นำเข้า ─ ②Bible ─ ③Scenes ─ ④Shots ─ ⑤ภาพ ─ ⑥Clips ─ ⑦สร้างวิดีโอ ─ ⑧Export │
│  ✔        ✔        ● ตรวจ     ○        ○      ○        ○          ○        │
├──────────────────────────────┬────────────────────────────────────────────┤
│  (ซ้าย) ต้นฉบับนิยาย         │  (ขวา) พื้นที่ทำงานของขั้นปัจจุบัน          │
│  ย่อหน้า 1…n                 │                                            │
│  ไฮไลต์เมื่อเลือก scene/shot │                                            │
│  [พับเก็บได้]                │                                            │
├──────────────────────────────┴────────────────────────────────────────────┤
│ 💡 ขั้นต่อไป: ตรวจ 12 scenes แล้วกด "อนุมัติและไปขั้น Shots"   [ย้อนกลับ] [▶ ไปต่อ] │
└───────────────────────────────────────────────────────────────────────────┘
```

**สถานะของแต่ละขั้นใน Stepper**

| สถานะ | ความหมาย | การแสดงผล |
|---|---|---|
| 🔒 locked | ขั้นก่อนหน้ายังไม่ approve | เทา กดไม่ได้ (เอาเมาส์ชี้เห็นเหตุผล) |
| ○ ready | พร้อมรัน | วงกลมว่าง + ปุ่ม Run |
| ⏳ running | กำลังประมวลผล | progress bar + จำนวนที่เสร็จ/ทั้งหมด |
| ● needs review | AI ทำเสร็จ รอตรวจ | จุดสีส้ม + จำนวนรายการที่ต้องตรวจ |
| ✔ approved | ตรวจแล้ว | เครื่องหมายถูกสีเขียว |
| ⚠ stale | ขั้นก่อนหน้าถูกแก้ภายหลัง | เหลือง + ปุ่ม "อัปเดตใหม่" / "คงของเดิม" |
| ✖ failed | งานล้มเหลว | แดง + ข้อความและปุ่ม Retry |

**แถบ "ขั้นต่อไป" (Next-action banner)** ด้านล่างบอกสิ่งที่ต้องทำเป็นประโยคเดียว และปุ่ม **"รันอัตโนมัติจนถึง checkpoint ถัดไป"** (เช่น ขั้น 2–4 รันต่อเนื่องแล้วหยุดรอตรวจ) สำหรับผู้ใช้ที่ไม่อยากกดทีละขั้น

### 17.5 รายละเอียดแต่ละขั้น

**ขั้น 1 – นำเข้านิยาย (S0)**
- วาง/อัปโหลด txt, docx; เลือกหมายเลข EP และชื่อตอน
- แสดงตัวอย่างการแบ่งย่อหน้า + จำนวนคำ/ประมาณการจำนวน scene; ปุ่ม "ตัดหัวบท/ข้อความที่ไม่ต้องการ"
- ปุ่มหลัก: **บันทึกและไปขั้น Bible**

**ขั้น 2 – Story Bible (S1) ★ checkpoint**
- ปุ่ม "ให้ AI วิเคราะห์" → progress → แสดงเป็น 3 แท็บ: **ตัวละคร | สถานที่ | เสียง**
- **การ์ดตัวละคร:** รูป/placeholder, ชื่อ + alias, บทบาท, รูปลักษณ์, ชุด, ป้าย `เดาโดย AI` ที่ field ซึ่งไม่ได้มาจากนิยาย, ปุ่ม แก้/สร้างใหม่ (ใส่คำสั่งเพิ่มเติมได้), Approve ทีละใบหรือทั้งหมด
- **คิว "ต้องตัดสินใจ" (`needsReview`)**: เช่น "คุณปลา" กับ "พี่ปลา" เป็นคนเดียวกันไหม → ปุ่ม รวม / แยก
- ตัวละครที่ approve แล้วถูก lock (มีไอคอนกุญแจ) แก้ได้เมื่อกด "ปลดล็อก" พร้อมคำเตือนว่ากระทบ shot ที่มีอยู่
- แท็บเสียง: ตัวอย่างประโยค + ปุ่ม "ฟังเสียงตัวอย่าง" (ภายหลังเชื่อม TTS)
- ปุ่มหลัก: **อนุมัติ Bible และไปขั้น Scenes** (ปุ่มจะ active เมื่อไม่มี `needsReview` ค้าง)

**ขั้น 3 – Scenes (S2) ★ checkpoint**
- มุมมอง "บอร์ด": แถว scene เรียงตามเรื่อง แต่ละการ์ดแสดง ชื่อ, สถานที่, ตัวละครในฉาก (avatar), mood, ความยาวประมาณ
- คลิกการ์ด → ซ้ายไฮไลต์ย่อหน้าต้นฉบับ; **ลากเพื่อสลับลำดับ, ปุ่ม รวม/แยก scene** (แยกโดยคลิกที่จุดในข้อความต้นฉบับ)
- เปลี่ยนสถานที่/ตัวละครของ scene ผ่าน dropdown ที่เลือกจาก Bible (ไม่พิมพ์ชื่อเอง)

**ขั้น 4 – Shots & บทสนทนา (S3) ★ checkpoint**
- รายการ scene ซ้าย, ตาราง shot ของ scene ที่เลือกขวา: ลำดับ, ประเภท shot, กล้อง, ความยาว (วินาที), การกระทำ, บทพูด
- **ป้ายบทพูด:** `ต้นฉบับ` (เทา) / `AI แต่งเพิ่ม` (ม่วง) พร้อมช่องติ๊ก "ตรวจแล้ว"; ตัวกรอง "แสดงเฉพาะบทที่ AI แต่ง และยังไม่ตรวจ"
- แก้บทพูดในช่อง inline; ปุ่ม "แต่งใหม่" ต่อบรรทัด (ใส่น้ำเสียง/คำสั่งเพิ่มเติม); เตือนถ้าบทยาวเกินความยาว shot
- ตั้งค่าต่อ shot: `breakQuality` (ตัดต่อตรงนี้ได้ไหม) ในเมนูขั้นสูง
- แถบสรุปบนสุด: จำนวน shot, ความยาวรวมของ scene, จำนวนบทที่ยังไม่ตรวจ

**ขั้น 5 – ภาพ Reference & Keyframe (S6) ★ checkpoint**
- แบ่ง 3 แท็บ: **Character sheet | สถานที่ | Keyframe ของ scene**
- ก่อนกดสร้าง มีกล่องยืนยัน: "จะสร้าง N ภาพ ประมาณ ฿X" (เลือกจำนวน take ต่อรายการ)
- แกลเลอรี take: คลิกเลือก ⭐ ภาพหลัก (`isPrimary`), ✔ approve, ✖ ปฏิเสธ, ↻ สร้างใหม่ด้วย seed ใหม่; เปรียบเทียบ 2 ภาพแบบเคียงกัน
- **ตัวตรวจ consistency เบื้องต้น:** แสดง reference ตัวละครข้าง keyframe เพื่อให้ตาเปล่าเทียบได้เร็ว
- ปุ่มหลัก: **ใช้ภาพเหล่านี้และไปขั้น Clips** (ต้องมี keyframe ที่ approve ครบทุก scene หรือเลือก "ข้ามบาง scene")

**ขั้น 6 – Video Prompts & ชุด Clip (S4a/S4b/S4c)**
- ปุ่ม "สร้าง prompt ของ scene" → แล้ว "แบ่งเป็นชุด" อัตโนมัติ
- **Timeline Editor:** แท่งเวลาของ scene แบ่งสีตาม clip; แต่ละ shot เป็นบล็อกเรียงต่อกัน; **ลากจุดตัดระหว่าง clip** ได้ โดยระบบกันไม่ให้เกินเพดาน (15s เมื่อใช้ H3) หรือสั้นกว่า 5s; สีจุดตัด = เขียว (hard), เหลือง (soft), แดง (avoid)
- คลิก clip → แผงขวาแสดง **Prompt (DY / H3)** แบบแท็บ, reference ที่แนบ (Picture 1/2, เสียง), ผล validator (✔/⚠ พร้อมคลิกไปแก้)
- แก้ prompt ด้วยมือได้ แต่ส่วนที่ล็อก (appearance/location block) ขึ้นแถบเทา และถ้าแก้จะมีคำเตือน
- ปุ่มหลัก: **ยืนยัน clip ทั้งหมดและไปขั้นสร้างวิดีโอ**

**ขั้น 7 – สร้างวิดีโอ & เลือก Take (S7)**
- ตารางสถานะ clip: รอ / กำลังสร้าง / เสร็จ / ล้มเหลว + เวลาที่ใช้ + เครดิต
- เลือกโหมด **Draft** (เร็ว/ถูก) หรือ **Final**; ปุ่ม "สร้างทีละ clip" / "สร้างทั้ง scene" / "สร้างทั้งตอน" พร้อมกล่องประมาณการต้นทุนและตัวเลือกจำนวน take
- เมื่อใช้โหมดความต่อเนื่อง `last_frame` ระบบแสดงว่าต้องสร้างตามลำดับ และหยุดรอ clip ก่อนหน้าให้ผ่านก่อน
- Player แบบ scene: เล่น clip ต่อกันตามลำดับ, เลือก take ที่ใช้, ปุ่ม "สร้างใหม่เฉพาะ clip นี้" (ระบุสิ่งที่อยากแก้เป็นข้อความ → ระบบเติมใน prompt)

**ขั้น 8 – Export**
- เลือกรูปแบบ: JSON, Markdown, CSV (shot list), ชุดไฟล์วิดีโอ/เสียง, (ภายหลัง) วิดีโอรวมทั้ง EP ด้วย FFmpeg
- แสดง **QA Report** ก่อน export: รายการปัญหา (บทพูดยังไม่ตรวจ, clip ที่ยังไม่ approve, ตัวละครขาด reference) คลิกแล้วกระโดดไปหน้าที่ต้องแก้

### 17.6 องค์ประกอบ UI ที่ใช้ซ้ำ

| Component | หน้าที่ |
|---|---|
| `EpisodeStepper` | แสดงสถานะ 8 ขั้น + กฎ gating |
| `NextActionBar` | ข้อความขั้นต่อไป + ปุ่มไปต่อ/ย้อนกลับ/รันอัตโนมัติ |
| `JobProgressPanel` | ลิ้นชักแสดงงานที่รันอยู่ (SSE), ยกเลิก/ลองใหม่ได้ |
| `SourceTextPane` | ข้อความนิยายพร้อมไฮไลต์ย่อหน้า, เลื่อนซิงก์ตามรายการที่เลือก |
| `EntityCard` | การ์ดตัวละคร/สถานที่ (ป้าย inferred, lock, approve) |
| `AIEditField` | ช่องแก้ข้อความ + ปุ่ม "ให้ AI แก้ตามคำสั่ง" |
| `BadgeSource` | ป้าย `ต้นฉบับ` / `AI แต่งเพิ่ม` / `เดาโดย AI` |
| `CostConfirmDialog` | สรุปจำนวนงาน/ค่าใช้จ่ายก่อนสั่งสร้าง |
| `AssetGallery` | grid take, เปรียบเทียบ, approve/primary |
| `ClipTimeline` | แท่งเวลา + ลากจุดตัด + สีคุณภาพจุดตัด |
| `ValidatorList` | รายการปัญหาที่คลิกแล้วโฟกัสจุดที่ต้องแก้ |
| `StaleBanner` | แจ้งว่าข้อมูลต้นทางเปลี่ยน พร้อมปุ่มอัปเดต/คงเดิม |
| `VersionHistoryDrawer` | ดูเวอร์ชันย้อนหลัง/คืนค่า |

### 17.7 สถานะ/ความล้าสมัย (Stale) และ Gating

- **Gating:** ขั้น N เปิดได้เมื่อขั้น N−1 เป็น approved (หรือผู้ใช้เลือก "ข้าม" สำหรับขั้นที่ไม่บังคับ เช่น ภาพบางรายการ)
- **Stale propagation (ฝั่ง backend คำนวณ ส่งมาให้ UI):**
  - แก้ Bible → scene/shot/prompt ที่อ้างถึงตัวละครนั้นเป็น `stale`
  - แก้ shot/บทพูด → clip ที่มี shot นั้นเป็น `stale` (ใช้ hash ของ shot ที่อยู่ใน clip)
  - แก้ keyframe ที่ approve → clip ที่ใช้ภาพนั้นเป็น `stale`
- UI แสดงจำนวนรายการ stale ต่อขั้น และมีปุ่ม **"อัปเดตเฉพาะที่ได้รับผลกระทบ"** เพื่อไม่ต้องรันใหม่ทั้งตอน

### 17.8 Realtime & การจัดการ Error

- ทุกงาน (job) ส่งความคืบหน้าผ่าน SSE: `queued → running(progress) → succeeded/failed`
- ปิดหน้าแล้วกลับมา งานยังรันต่อ (สถานะอยู่ที่ backend) — UI โหลดสถานะล่าสุดตอนเปิด
- Error แสดงเป็นภาษาคน พร้อมปุ่มทำต่อ เช่น "เครดิตไม่พอ → ไปเติม", "โดนจำกัดจำนวนงานพร้อมกัน → ระบบจะลองใหม่อัตโนมัติ", "ผลจาก AI ไม่ตรงรูปแบบ → ลองใหม่ (ใช้ครั้งที่ 2/3)"
- มีหน้า `/queue` รวมงานล้มเหลวทั้งหมดและปุ่ม retry แบบกลุ่ม

### 17.9 ฟีเจอร์ที่ช่วยให้ใช้งานง่ายขึ้น

1. **Onboarding สร้างโปรเจกต์ 3 ขั้น:** (1) ชื่อ/ภาษา (2) สไตล์ภาพ (พรีเซ็ต: anime cel-shaded, semi-real ฯลฯ) + อัตราส่วน (3) โมเดลวิดีโอ + นโยบาย (ความคิดภายใน, ภาษาบทพูด) → ได้ค่าเริ่มต้นที่ใช้ได้ทันที
2. **โหมดรันอัตโนมัติถึง checkpoint** และ **โหมดละเอียด** (ทีละขั้น)
3. **คำสั่ง AI ต่อ field:** ผู้ใช้พิมพ์สั้นๆ เช่น "ทำให้เสียงนุ่มกว่านี้" แล้วระบบสร้างเฉพาะ field นั้นใหม่
4. **แท็กสถานะและตัวกรอง** ทุกรายการ: ต้องตรวจ / stale / ล้มเหลว / approved
5. **ค้นหาทั่วโปรเจกต์** (ชื่อตัวละคร, ข้อความบทพูด) และ **คีย์ลัด** (J/K เลื่อนรายการ, A อนุมัติ, R สร้างใหม่, ⌘/Ctrl+Enter ไปต่อ)
6. **Autosave + ประวัติเวอร์ชัน + Undo** ในทุกช่องแก้ไข
7. **กล่องช่วยเหลือในบริบท:** อธิบายสั้นๆ ว่าแต่ละขั้นทำอะไรและต้องตรวจอะไร
8. **ตัวอย่างข้อมูล (demo project)** ให้ลองกดทั้ง pipeline ก่อนใช้งานจริง

### 17.10 API ที่ UI ต้องการเพิ่ม (นอกเหนือจากหัวข้อ 8, 14, 15)

| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/episodes/:id/status` | สถานะ 8 ขั้น (locked/ready/running/needs_review/approved/stale/failed) + จำนวนรายการที่ต้องตรวจ |
| GET | `/episodes/:id/events` (SSE) | event realtime ของ job/สถานะ |
| POST | `/episodes/:id/steps/:n/approve` | อนุมัติขั้น (ตรวจเงื่อนไข เช่น ไม่มี needsReview) |
| POST | `/episodes/:id/run-until-checkpoint` | รันอัตโนมัติถึง checkpoint ถัดไป |
| POST | `/estimate` | ประมาณจำนวนงานและต้นทุนก่อนสั่งสร้างภาพ/วิดีโอ |
| GET | `/episodes/:id/qa` | รายการปัญหาสำหรับ QA Report |
| GET | `/entities/:id/versions` / POST `/restore` | ประวัติเวอร์ชันและการคืนค่า |
| POST | `/entities/:id/ai-edit` | แก้ field ด้วยคำสั่งภาษาธรรมชาติ |

### 17.11 โครงสร้างโปรเจกต์ Frontend

```
web/
├─ src/
│  ├─ app/                 # router, providers, layout
│  ├─ features/
│  │   ├─ projects/        # dashboard, onboarding
│  │   ├─ episode/         # workspace, stepper, next-action bar
│  │   ├─ import/          # ขั้น 1
│  │   ├─ bible/           # ขั้น 2 (cards, review queue)
│  │   ├─ scenes/          # ขั้น 3 (board, split/merge)
│  │   ├─ shots/           # ขั้น 4 (table, dialogue editor)
│  │   ├─ images/          # ขั้น 5 (gallery, compare)
│  │   ├─ clips/           # ขั้น 6 (timeline, prompt viewer)
│  │   ├─ render/          # ขั้น 7 (queue, player, takes)
│  │   ├─ export/          # ขั้น 8
│  │   └─ queue/           # /queue
│  ├─ components/          # ui ใช้ซ้ำ (BadgeSource, CostConfirmDialog, ...)
│  ├─ hooks/               # useJobStream, useEpisodeStatus
│  ├─ lib/                 # api client, i18n, format
│  └─ mocks/               # MSW handlers
├─ e2e/                    # Playwright
└─ .storybook/
```
ใช้ `shared/` (Zod schema + types) ร่วมกับ backend เพื่อให้ฟอร์ม validate ตรงกับ API

### 17.12 Roadmap ของ UI (ขนานกับ backend phase)

| Phase UI | ผลลัพธ์ | คู่กับ backend |
|---|---|---|
| **UI-0** | โครง app, router, API client, Stepper + NextActionBar (ข้อมูลจำลองด้วย MSW) | Phase 0 |
| **UI-1 (MVP)** | ขั้น 1–4: นำเข้า, Bible review, Scenes, Shots/บทสนทนา + แสดงต้นฉบับข้าง ๆ + export JSON/MD | Phase 1–2 |
| **UI-2** | Job panel + SSE, stale handling, version history, ป้าย inferred/generated, onboarding | Phase 2–3 |
| **UI-3** | ขั้น 5–6: แกลเลอรีภาพ/approve, Clip Timeline, prompt viewer + validator | Phase 5 (Image Gen) + 15.9 |
| **UI-4** | ขั้น 7–8: คิวสร้างวิดีโอ, player, เลือก take, cost estimator, QA Report, export | Phase 6–7 |
| **UI-5** | ขัดเกลา: คีย์ลัด, ค้นหา, demo project, หน้า Settings/Health check/Backup (ไม่มีระบบหลายผู้ใช้) | ต่อเนื่อง |

**Definition of Done ของ UI-1 (MVP):**
- [ ] ผู้ใช้ใหม่สร้างโปรเจกต์และรันถึงขั้น Shots ได้โดยไม่ต้องอ่านคู่มือ
- [ ] ทุกขั้นแสดงสถานะ/ความคืบหน้า/ข้อผิดพลาดที่เข้าใจง่าย
- [ ] แก้ไขข้อมูลทุกจุดแล้ว autosave และไม่ทำให้ข้อมูลขั้นอื่นหาย
- [ ] คลิก scene/shot แล้วเห็นต้นฉบับที่เกี่ยวข้อง
- [ ] มี e2e test ของเส้นทางหลัก: นำเข้า → Bible → Scenes → Shots

### 17.13 ความเสี่ยงด้าน UX

| ความเสี่ยง | วิธีรับมือ |
|---|---|
| ข้อมูลเยอะ ผู้ใช้หลง | Stepper + Next-action bar + ตัวกรอง "ต้องตรวจ" ให้เห็นเฉพาะสิ่งที่ต้องทำ |
| กดสร้างภาพ/วิดีโอแล้วเสียเครดิตเกินคาด | Cost dialog บังคับก่อนทุกครั้ง + เพดานงบต่อ EP |
| แก้ขั้นต้นทางแล้วงานปลายทางพัง | stale + อัปเดตเฉพาะส่วนที่กระทบ + ไม่ลบอัตโนมัติ |
| ลาก timeline ผิดจนเกินลิมิตโมเดล | UI กันค่านอกช่วง (5–15s) และแสดงเหตุผลทันที |
| งานนาน ผู้ใช้ไม่รู้ว่าค้างหรือไม่ | progress + เวลาที่ใช้ + แจ้งเตือนเมื่อเสร็จ (เสียง/notification ของเบราว์เซอร์) |
| จอเล็ก | ออกแบบ desktop-first; tablet พับต้นฉบับเป็น drawer; มือถือเปิดดู/อนุมัติได้ แต่แก้ละเอียดบนจอใหญ่ |

---

## 18. โหมด Local ผู้ใช้เดียว (Single-User, Local-only)

> **การตัดสินใจ:** ระบบใช้งานโดยคนเดียวบนเครื่องตัวเองเท่านั้น หัวข้อนี้สรุปสิ่งที่ตัดออก/ทำให้ง่ายลง และ **ถ้าขัดกับหัวข้อก่อนหน้า ให้ยึดหัวข้อนี้**

### 18.1 สรุปการเปลี่ยนแปลง

| เรื่อง | แผนเดิม | แบบ Local ผู้ใช้เดียว |
|---|---|---|
| ผู้ใช้/สิทธิ์ | (เผื่อไว้) | **ไม่มี login / role / userId** ใน schema; ยังคงมีหลาย *project* ได้ |
| Job queue | BullMQ + Redis | **in-process queue** (`p-queue`) + สถานะใน Mongo; ไม่ต้องติดตั้ง Redis |
| รับผลจาก RunningHub | webhook + polling | **polling อย่างเดียว** (ไม่มี public URL) |
| เก็บไฟล์ | Local → S3/MinIO | **โฟลเดอร์ `data/` ในเครื่อง** อย่างเดียว |
| Deploy | Docker Compose หลาย service | **คำสั่งเดียว** `npm start` (เสิร์ฟ UI + API ที่พอร์ตเดียว) |
| Database | MongoDB | MongoDB เหมือนเดิม (ติดตั้งในเครื่อง หรือรันด้วย Docker เฉพาะ mongo) |
| Secrets | secret manager | ไฟล์ `.env` / หน้า Settings ในแอป เก็บในเครื่อง |
| Realtime | SSE | SSE เหมือนเดิม (ใช้ `EventEmitter` ใน process เดียวกัน) |
| ต้นทุน/เครดิต | ต้องควบคุม | **ยังต้องควบคุม** — เครดิต RunningHub/LLM ยังเป็นเงินจริง |

### 18.2 สถาปัตยกรรมแบบ Local

```
เบราว์เซอร์ (localhost:3000)
        │  HTTP + SSE
        ▼
┌───────────────────────────── Node.js (1 process) ─────────────────────────┐
│  Fastify: API + เสิร์ฟไฟล์ web (build) + เสิร์ฟ assets จาก data/            │
│  Services (S0–S7)     In-process Queue (p-queue)     Job Runner/Poller     │
└────────┬──────────────────────┬──────────────────────────┬───────────────┘
         ▼                      ▼                          ▼
     MongoDB (local)      data/ (ไฟล์ภาพ/วิดีโอ/เสียง)   Claude API · RunningHub API
```

### 18.3 Job queue แบบไม่มี Redis (ต้องทนต่อการปิดแอป)

- **ตาราง `Job` / `GenerationTask` ใน Mongo คือแหล่งความจริง** — queue ในหน่วยความจำเป็นแค่ตัวจ่ายงาน
- แยก queue ตามประเภทและตั้ง concurrency: `llm` (3), `gen-image` (ตามโควตา), `gen-video` (ตามโควตา) — ตัวเลขต้องไม่เกินโควตาพร้อมกันของบัญชี RunningHub
- **เมื่อเปิดแอป (startup recovery):**
  1. job ที่ค้างสถานะ `running` และเป็นงาน LLM → ตั้งเป็น `interrupted` ให้ผู้ใช้กด "ทำต่อ" (หรือ re-queue อัตโนมัติถ้า idempotent)
  2. `GenerationTask` ที่มี `runninghubTaskId` แล้วยังไม่จบ → **เรียก `/task/openapi/status` เพื่อ resync** (งานบน cloud ยังรันต่อแม้ปิดแอป) → ถ้าสำเร็จ ดึง `/outputs` และดาวน์โหลดทันที
  3. task ที่ยังไม่เคยได้ `runninghubTaskId` (เสี่ยงสร้างไม่สำเร็จ) → ติดป้าย "ไม่แน่ใจ" ให้ผู้ใช้เลือก ลองใหม่/ข้าม เพื่อไม่ให้เสียเครดิตซ้ำโดยไม่ตั้งใจ
- **Polling:** เริ่มทุก ~5 วินาที ค่อยๆ ถ่างเป็น 15–30 วินาทีสำหรับวิดีโอ; หยุดเมื่อสำเร็จ/ล้มเหลว/ถูกยกเลิก; มีเพดานเวลา (timeout) แล้วขึ้นสถานะ "รอนานผิดปกติ"
- **ดาวน์โหลดผลลัพธ์ทันที** ที่งานสำเร็จ (ลิงก์ผลอาจหมดอายุ — ตรวจนโยบายของ RunningHub) และเก็บ checksum/ขนาดไฟล์
- ถ้าเครื่องหลับ/ออฟไลน์ ระบบหยุด poll เอง และกลับมา resync ตอนตื่น

### 18.4 โครงสร้างข้อมูลในเครื่อง

```
novel-to-anime/
├─ .env                      # คีย์/ค่าตั้งต้น (ห้าม commit)
├─ data/                     # ตั้งตำแหน่งได้ด้วย DATA_DIR
│  ├─ assets/<projectId>/{images,videos,audio}/...
│  ├─ exports/<projectId>/EP01/...
│  ├─ backups/
│  └─ logs/
└─ ...
```
- ใน Mongo เก็บ `storageKey` เป็น **path แบบ relative** (เช่น `assets/<pid>/videos/EP01-S03-C01-take2.mp4`) เพื่อย้ายโฟลเดอร์ได้
- API เสิร์ฟไฟล์ผ่าน route `/files/*` โดยตรวจ path ไม่ให้หลุดออกนอก `DATA_DIR` (กัน path traversal)
- วิดีโอ/เสียงควรรองรับ HTTP Range เพื่อให้ player เลื่อนดูได้

### 18.5 การตั้งค่า & ความลับ

```
# .env
HOST=127.0.0.1             # ผูกเฉพาะเครื่องนี้
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/novel_anime
DATA_DIR=./data
ANTHROPIC_API_KEY=...
RH_API_KEY=...
RH_BASE_URL=https://www.runninghub.ai
LLM_MODEL=...
```
- หน้า **Settings** ในแอปให้กรอก/เปลี่ยนคีย์ได้ (เขียนลงไฟล์ในเครื่อง) และ **ไม่ส่งคีย์เต็มกลับไปที่เบราว์เซอร์** (แสดงเป็น `sk-…abcd`)
- เรียก LLM/RunningHub จากฝั่ง Node เท่านั้น ไม่เรียกจากเบราว์เซอร์
- ใส่ `.env` และ `data/` ใน `.gitignore`

### 18.6 ความปลอดภัยขั้นต่ำสำหรับเซิร์ฟเวอร์ใน localhost

แม้ใช้คนเดียว เว็บไซต์อื่นที่เปิดในเบราว์เซอร์เดียวกันอาจยิงมาที่ `localhost:3000` ได้ (CSRF / DNS rebinding) และ API นี้ใช้เครดิตและอ่านไฟล์ได้ จึงควรมี:
1. **bind ที่ `127.0.0.1`** เท่านั้น (ไม่ใช่ `0.0.0.0`)
2. ตรวจ header `Host` และ `Origin` ให้ตรงกับ `localhost:3000` / `127.0.0.1:3000` ไม่ตรงให้ปฏิเสธ
3. ปิด CORS (UI กับ API อยู่ origin เดียวกัน)
4. (แนะนำ) token สุ่มต่อการรันแต่ละครั้ง ฝังในหน้า UI แล้วส่งเป็น header ในทุก request ที่เปลี่ยนข้อมูลหรือใช้เครดิต
5. ไม่ต้องมี login/รหัสผ่าน

### 18.7 วิธีรันและติดตั้ง

| โหมด | คำสั่ง | ใช้เมื่อ |
|---|---|---|
| พัฒนา | `npm run dev` (API + Vite dev server พร้อมกัน) | ระหว่างเขียนโค้ด |
| ใช้งานจริง | `npm run build && npm start` | เปิด `http://localhost:3000` พอร์ตเดียว |
| MongoDB | **ติดตั้งในเครื่อง (macOS) — ตัดสินใจแล้ว** | ไม่ใช้ Docker (ดู 18.12) |

`docker-compose.yml` ที่เหลือ (เฉพาะฐานข้อมูล — แทนตัวอย่างในหัวข้อ 13):
```yaml
services:
  mongo:
    image: mongo:7
    ports: ["127.0.0.1:27017:27017"]   # เปิดเฉพาะ localhost
    volumes: [mongo_data:/data/db]
volumes:
  mongo_data:
```
- เตรียมสคริปต์ `start.sh` สำหรับ macOS (เช็ค Mongo → `npm start` → เปิดเบราว์เซอร์อัตโนมัติ) ดู 18.12
- ไม่จำเป็นต้องทำเป็นแอป desktop (Electron/Tauri) ในเฟสแรก

### 18.8 Backup, ย้ายเครื่อง, และพื้นที่ดิสก์

ข้อมูลอยู่ในเครื่องเดียว — **ความเสี่ยงหลักคือข้อมูลหาย/ดิสก์เต็ม**
- `npm run backup` → `mongodump` + บีบอัด `data/assets` เป็นไฟล์เดียวใน `data/backups/` (ตั้งเตือนในแอปให้ backup ทุก N วัน/หลังจบแต่ละ EP)
- **Export/Import โปรเจกต์เป็นไฟล์ zip** (JSON ของ Bible/Scenes/Shots/Clips + assets) เพื่อย้ายเครื่องหรือเก็บถาวร
- หน้า Settings แสดง **พื้นที่ดิสก์ที่ใช้** แยกตามโปรเจกต์/ประเภทไฟล์ และปุ่ม **"ลบ take ที่ไม่ได้เลือก/draft"** (วิดีโอ 2K ยาว 15 วินาทีอาจหนักหลายสิบ MB ต่อคลิป — ทั้งตอนอาจเป็นหลาย GB)
- เตือนเมื่อพื้นที่ว่างต่ำกว่าเกณฑ์ก่อนสั่งสร้างงานใหม่

### 18.9 ผลต่อ UI (ปรับจากหัวข้อ 17)

- **ไม่มีหน้า login / เมนูผู้ใช้ / สิทธิ์** — เปิดแอปแล้วเข้า Dashboard ทันที
- เพิ่มหน้า **`/settings`:** คีย์ API (แสดงแบบปิดบัง), ตำแหน่ง `DATA_DIR`, ค่าเพดาน/นโยบาย (clip, concurrency, งบต่อ EP), พื้นที่ดิสก์, Backup/Restore
- เพิ่ม **Health check** (ไอคอนบน header): Mongo ✔, LLM key ✔, RunningHub key ✔ + **ยอดเครดิตคงเหลือ** (RunningHub มี API ดึงข้อมูลบัญชี — ตรวจชื่อ endpoint และ field จากเอกสารก่อนใช้), พื้นที่ดิสก์ ✔
- แถบ "งานที่ค้างหลังเปิดแอปใหม่" (จาก startup recovery): เช่น "พบ 3 งานที่ยังรันอยู่บน cloud — กำลังตรวจสอบ…"
- ตัด UI-5 เรื่องหลายผู้ใช้ออกจาก roadmap (แทนที่ด้วย Settings/Health/Backup)

### 18.10 ผลต่อ Data Model/API

- **ตัด** `ownerId`/`userId`/auth ออกทุก collection (ถ้าอนาคตต้องมีผู้ใช้หลายคนค่อยเพิ่ม)
- `Asset.url` ของ RunningHub เก็บเป็น `sourceUrl` (อ้างอิง/debug) ส่วน `storageKey` ชี้ไฟล์ในเครื่อง และ UI ใช้ `/files/<storageKey>` เสมอ
- **ตัด** endpoint `POST /webhooks/runninghub`
- **เพิ่ม:** `GET/PUT /settings`, `GET /health`, `POST /backup`, `POST /projects/:id/export-zip`, `POST /projects/import-zip`, `POST /cleanup/takes`

### 18.11 Phase 0 ที่เบาลง (แทนข้อ Phase 0 เดิม)

1. สร้าง repo (monorepo: `server/`, `web/`, `shared/`), TypeScript, ESLint
2. Fastify + Mongoose เชื่อม MongoDB local, ผูก `127.0.0.1`, middleware ตรวจ Host/Origin
3. LLM wrapper + Zod (หัวข้อ 7), in-process queue + `Job` model + startup recovery
4. โฟลเดอร์ `data/` + route `/files/*` + หน้า Settings/Health แบบง่าย
5. สคริปต์ `npm run dev` / `npm start` / `npm run backup`

### 18.12 รายละเอียดเฉพาะ macOS + MongoDB ในเครื่อง

> **การตัดสินใจ:** ใช้งานบน macOS, MongoDB ติดตั้งในเครื่อง (ไม่ใช้ Docker) — ส่วนเอกสาร Docker Compose ในหัวข้อ 13 และ 18.7 เก็บไว้เป็นทางเลือกสำรองเท่านั้น

**1) เตรียมเครื่อง (ครั้งเดียว)**
```bash
# ตรวจว่ามี Homebrew และ Node.js (แนะนำ LTS ผ่าน nvm หรือ brew)
brew install node@20 ffmpeg mongodb-database-tools

# ถ้ายังไม่มี MongoDB ในเครื่อง / หรืออัปเดต
brew tap mongodb/brew
brew install mongodb-community@7.0

# เปิดเป็น service ที่รันเบื้องหลังและเริ่มเองตอนเปิดเครื่อง
brew services start mongodb/brew/mongodb-community@7.0
brew services list         # ต้องเห็น mongodb-community = started
```
- ถ้า MongoDB ติดตั้งไว้แล้วด้วยวิธีอื่น ให้ปรับ `MONGO_URI` ใน `.env` ให้ตรง (ค่าเริ่มต้น `mongodb://127.0.0.1:27017/novel_anime`)
- `ffmpeg` ใช้ดึงเฟรมสุดท้ายของ clip (โหมด `last_frame`), รวมคลิป, ทำ thumbnail; `mongodb-database-tools` ให้คำสั่ง `mongodump` / `mongorestore` สำหรับ backup
- ใช้ได้ทั้ง Apple Silicon และ Intel (Homebrew ติดตั้งตามสถาปัตยกรรมให้เอง); เช็คเวอร์ชัน MongoDB ที่ติดตั้งจริงด้วย `mongod --version` และปรับ `brew` formula ให้ตรง

**2) สคริปต์ `start.sh`**
```bash
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# 1) ตรวจว่า MongoDB ทำงานอยู่ ถ้าไม่ ให้เริ่ม
if ! brew services list | grep -E "mongodb-community.*started" >/dev/null; then
  echo "เริ่ม MongoDB..."; brew services start mongodb/brew/mongodb-community@7.0
  sleep 3
fi

# 2) ติดตั้ง/บิลด์ถ้ายังไม่ได้ทำ
[ -d node_modules ] || npm ci
[ -d web/dist ]     || npm run build

# 3) เปิดเบราว์เซอร์แล้วรันเซิร์ฟเวอร์ (caffeinate กันเครื่องหลับระหว่างงานรันยาว)
( sleep 2; open "http://localhost:3000" ) &
exec caffeinate -i npm start
```
```bash
chmod +x start.sh && ./start.sh
```
- `caffeinate -i` ป้องกันเครื่องเข้าโหมดหลับขณะแอปรันอยู่ (ปิดแอปแล้วกลับเป็นปกติ) ซึ่งช่วยให้ polling งานวิดีโอไม่หยุดกลางทาง; ถ้าเครื่องหลับก็ยังปลอดภัยเพราะมี startup recovery (หัวข้อ 18.3)
- ทำเป็นไอคอนคลิกเปิดได้: สร้าง Automator/Shortcuts ที่รัน `start.sh` หรือไฟล์ `.command` (ดับเบิลคลิกใน Finder)

**3) (ทางเลือก) ให้เซิร์ฟเวอร์เริ่มเองตอน login ด้วย `launchd`**
- ใช้ LaunchAgent ที่ `~/Library/LaunchAgents/local.novelanime.plist` รัน `npm start` ตอน login และตั้ง `KeepAlive`
- แนะนำให้เริ่มจาก `start.sh` ก่อน ค่อยทำ LaunchAgent เมื่อใช้งานบ่อยจนอยากให้เปิดอัตโนมัติ

**4) โฟลเดอร์ข้อมูลและ Backup บน macOS**
- ตั้ง `DATA_DIR` ไว้ใน `~/NovelAnimeData` (นอกโฟลเดอร์โค้ด) เพื่อไม่ให้ลบทิ้งตอนอัปเดต/ล้าง repo
- ถ้าเปิด **Time Machine** อยู่ โฟลเดอร์ข้อมูลจะถูกสำรองด้วย แต่ **ไฟล์ฐานข้อมูลที่กำลังเปิดใช้อาจสำรองไม่สมบูรณ์** จึงยังควรใช้ `npm run backup` (`mongodump`) เป็นตัวหลัก
- ปุ่ม/สคริปต์ backup: `mongodump --uri "$MONGO_URI" --archive=data/backups/db-YYYYMMDD.gz --gzip` + บีบอัด `assets/`
- ไฟล์ `.env` และ `settings.json` ตั้งสิทธิ์ `chmod 600`
- หน้า Settings แสดงพื้นที่ว่างของดิสก์ (`df`) และเตือนเมื่อเหลือน้อย โดยเฉพาะถ้าเป็น SSD ขนาดเล็ก

**5) ข้อควรรู้ของ macOS**
- bind ที่ `127.0.0.1` ทำให้ **macOS ไม่ถามสิทธิ์ firewall** ("Accept incoming connections?") และไม่เปิดให้เครื่องอื่นในเครือข่ายเข้าถึง (ตรงกับเงื่อนไขใช้เครื่องเดียว)
- พอร์ต 5000/7000 มักถูก AirPlay Receiver ใช้อยู่ — แอปนี้ใช้ 3000 (Vite dev ใช้ 5173) จึงไม่ชน แต่ถ้ามีโปรเจกต์อื่นใช้ 3000 ให้เปลี่ยน `PORT`
- ถ้าเก็บโค้ดใน iCloud Drive/Desktop ที่ซิงก์ ให้ **ย้ายโฟลเดอร์ `node_modules` และ `data/` ออกจากโฟลเดอร์ที่ซิงก์** (ไฟล์เล็กจำนวนมากและวิดีโอขนาดใหญ่ทำให้ซิงก์ช้าและอาจพัง)
- การดาวน์โหลดไฟล์วิดีโอเยอะๆ ใช้พื้นที่เร็ว — ตั้ง `DATA_DIR` ไว้บนดิสก์ที่มีที่ว่างพอ (หรือ external SSD ถ้าต้องการ) และเช็คว่าดิสก์เมานต์อยู่ก่อนเริ่มแอป
- Gatekeeper/สิทธิ์โฟลเดอร์: ถ้าใช้ Terminal เปิดแอปและแอปต้องเขียน `~/NovelAnimeData` ให้ Terminal มีสิทธิ์ Full Disk/Files and Folders (ปกติโฟลเดอร์ใน home ไม่ติดปัญหา)

**6) เช็คลิสต์พร้อมเริ่ม Phase 0 (เครื่อง macOS)**
- [ ] `node -v` ≥ 20, `npm -v`
- [ ] `brew services list` เห็น mongodb-community = started และ `mongosh` เชื่อมต่อได้
- [ ] `ffmpeg -version`, `mongodump --version`
- [ ] สร้าง `~/NovelAnimeData` และกำหนด `DATA_DIR`
- [ ] ใส่ `ANTHROPIC_API_KEY` และ `RH_API_KEY` ใน `.env` (chmod 600)

---

## 19. Next Steps

1. ยืนยัน video model เป้าหมาย (Veo3 / Kling / Runway ฯลฯ) เพื่อทำ template ใน S4 — **ตอนนี้ปรับเป็น: ระบุโมเดล/workflow ใน ComfyUI ที่จะใช้ทำภาพและวิดีโอ** แล้วปรับ prompt template ให้ตรงกับโมเดลนั้น
2. Export API-format JSON ของแต่ละ workflow จาก RunningHub แล้วทำ mapping ใน Workflow Registry (character sheet, location, keyframe, image-to-video)
3. ทดสอบเรียก `/task/openapi/create` ด้วย script เล็กๆ ก่อน เพื่อดู response จริงและเวลาที่ใช้ต่อ task
4. ตรวจโควตา concurrency และอัตราเครดิตของบัญชี RunningHub เพื่อกำหนด limit ใน queue
5. ตัดสินใจ policy: ความคิดภายในตัวละครจะแปลงเป็น narration, สีหน้า หรือ insert shot
6. เตรียมนิยายตัวอย่าง 1 EP สำหรับทดสอบ MVP
7. เริ่ม Phase 0 และเขียน Zod schema + system prompt ของ S1 เป็นอย่างแรก
8. เก็บตัวอย่าง prompt DY ที่ใช้ได้ผลจริงเป็น golden fixture แล้วเขียน `dy.ts` + validator ให้ผ่านเทสต์นั้น
9. ยืนยันกับโมเดลวิดีโอที่ใช้: ความหมายของ `(S#)`, ภาษาบทพูดที่ lip-sync ได้ (ไทย/อังกฤษ), จำนวนภาพ reference ที่รองรับ
10. ตัดสินใจ `continuityMode` (`scene_keyframe` เร็ว/ขนานได้ vs `last_frame` ต่อเนื่องกว่าแต่ต้องทำทีละ clip) โดยลองกับ scene ยาว 30–40 วินาที 1 ฉาก
11. เขียน `clipSplitter.ts` พร้อมเทสต์ (scene ยาวต่างๆ, shot ที่ `avoid`, shot ยาวใกล้เพดาน, scene สั้นกว่า 20s)
12. ทำ Spike หัวข้อ 16.8 กับ H3 บน RunningHub แล้วสรุป: วิธีรัน (API nodes / native), ความยาว prompt สูงสุด, ใช้ DY ตรงๆ ได้หรือต้องมี Prompt Adapter, ภาษาไทย lip sync
13. ปรับค่า `videoModel` และ `clipPolicy` (maxClipSec = 15) ตามผล Spike และเพิ่ม validator ตาม `limits`
14. ร่าง wireframe ละเอียดของขั้น 2 (Bible) และขั้น 6 (Clip Timeline) เพราะเป็นสองหน้าที่ซับซ้อนที่สุด แล้วทดสอบกับผู้ใช้ 2–3 คนก่อนเขียนโค้ด UI-1
15. ~~ตัดสินใจเรื่องผู้ใช้~~ **ตัดสินใจแล้ว: ใช้คนเดียวใน local เท่านั้น** — ไม่ต้องมี login/สิทธิ์ (ดูหัวข้อ 18)
16. ~~ตรวจ OS/MongoDB~~ **ตัดสินใจแล้ว: macOS + MongoDB ติดตั้งในเครื่อง** — ทำตามหัวข้อ 18.12
17. ทดสอบ resync: สั่งสร้างงานบน RunningHub 1 งาน → ปิดแอปกลางทาง → เปิดใหม่ → ต้องดึงผลและดาวน์โหลดได้ (ตรวจอายุลิงก์ผลลัพธ์ด้วย)

---

