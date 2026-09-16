# VideoLab — Product Requirements Document

> **Status:** Active development · Phase 1 in progress  
> **Owner:** Lukas (Relvanta)  
> **Last updated:** 2026-09-16  

---

## 1. Vision

A **modular, private-use AI video tool** that lives entirely in the browser and calls public HuggingFace Spaces (or personal cloned Spaces) for GPU-heavy work. No subscription, no backend required for basic operation. BYOK (bring-your-own-key) for LLM providers. Designed as a collection of standalone modules that can be embedded in other tools or used independently.

The closest public reference is [perchance.org/clip-animator](https://perchance.org/clip-animator) — VideoLab aims to be a more structured, extensible, open implementation of the same concept, minus community features, plus proper engineering.

---

## 2. Core principles

| Principle | What it means |
|---|---|
| **Client-side first** | All compute goes to HF Spaces via browser fetch. No server required for basic use. |
| **BYOK** | User supplies API keys (Anthropic, Groq, OpenRouter). Keys live in localStorage, never sent anywhere except the named provider. |
| **Modular** | Each tool is an isolated JS module. Adding a new tool = one file + 3 lines in main.js. |
| **Fallback chain** | Every HF engine call tries a ranked list of Spaces, falls back gracefully. |
| **Private-use first** | No auth, no multi-user, no server-side logging. Built for one person's workflow. |
| **Embeddable** | Modules expose a clean interface so they can be used by other Relvanta tools. |

---

## 3. Discovered features (from perchance/clip-animator analysis)

### 3.1 Global / shared

| Feature | Status in VideoLab |
|---|---|
| Upload image (drag-drop + click) | ✅ Implemented |
| Generate image from text prompt | ✅ Implemented (FLUX → SDXL fallback) |
| Re-roll / re-generate image | ✅ Implemented |
| Source image canvas preview | ✅ Implemented |
| Palette mood extraction | ✅ Implemented (client-side k-means) |
| Match mood → render settings | 🔲 Phase 2 |
| Persistent notepad | ✅ Implemented |
| Sound on/off toggle | 🔲 Phase 2 |
| Age gate / content rating | ⬜ Not planned (private tool) |
| Seed + reproducibility | 🔲 Phase 2 |
| "Surprise me" randomiser | 🔲 Phase 2 |
| Copy share link (URL recipe) | 🔲 Phase 2 |
| Community / AI characters | ⬜ Not planned |
| Fullscreen button | 🔲 Phase 2 |

### 3.2 Director module

| Feature | Status |
|---|---|
| AI analyses image → writes shot list | ✅ Implemented (via Cloudflare Worker → Claude) |
| BYOK director (Groq / Anthropic / OpenRouter) | ✅ Implemented (Phase 1 addition) |
| Template fallback (no API key) | ✅ Implemented |
| Film style selector | ✅ Implemented |
| Shot count + duration controls | ✅ Implemented |
| Per-shot: prompt, camera move, caption | ✅ Implemented |
| Shot list editor (add/edit/delete/reorder) | ✅ Implemented |
| Render all shots → sequential HF calls | ✅ Implemented |
| Client-side video stitching | ✅ Implemented (Canvas + MediaRecorder) |
| Shot list persistence (localStorage) | ✅ Implemented |
| Re-generate individual shots | 🔲 Phase 2 |
| Iterative director refinement (chat) | 🔲 Phase 2 |
| Director's cut export | ✅ Implemented |

### 3.3 Lipsync module

| Feature | Status |
|---|---|
| Script textarea | ✅ Implemented |
| TTS engine (Kokoro → Coqui fallback) | ✅ Implemented |
| Voice selector (6 Kokoro + 2 Coqui voices) | ✅ Implemented |
| Audio preview player | ✅ Implemented |
| Mic recording UI | ✅ Skeleton (disabled, "coming soon") |
| Mouth position marker (click-to-place) | ✅ Implemented |
| Lipsync engine selector | ✅ Implemented |
| Auto-fallback chain | ✅ Implemented |
| Result video player + download | ✅ Implemented |

### 3.4 Features identified but not yet scoped

| Feature | Likely module |
|---|---|
| Direct image-to-video (no shot list) | Animate module (Phase 2) |
| Living motion / ambient effects | Animate module |
| On-device depth-warp parallax (offline fallback) | Animate module |
| Caption burn-in on video | Shared utility (Phase 2) |
| Image description → text (vision) | Describe module (Phase 2) |
| Title card / overlay designer | Design module (Phase 3) |
| Long-form video (1–15 min, streaming to disk) | Phase 3 |
| Personal Space URL overrides UI | Settings panel (Phase 2) |

---

## 4. HuggingFace Spaces catalogue

### 4.1 Image-to-video engines

| Engine ID | HF Space | Model | VRAM req | Notes |
|---|---|---|---|---|
| `wan22-i2v` | `wan-ai/Wan2.2-I2V-14B` | Wan 2.2 I2V 14B | ~20 GB | Best quality; A100 needed |
| `wan21-i2v` | `wangfuyun/AnimateLCM` | Wan 2.1 + LCM | ~16 GB | Faster; community Space |
| `ltx2` | `Lightricks/LTX-2` | LTX-2 19B | ~24 GB | Good quality; ZeroGPU |
| `ltx-video` | `Lightricks/LTX-Video` | LTX-Video | ~16 GB | Reliable; ZeroGPU |
| `hunyuan` | `tencent/HunyuanVideo` | HunyuanVideo 1.5 | ~30 GB | Highest quality; slow |
| `svd` | `stabilityai/stable-video-diffusion-img2vid-xt` | SVD XT | ~10 GB | Reliable fallback; shorter clips |

### 4.2 Lipsync engines

| Engine ID | HF Space | Model | Notes |
|---|---|---|---|
| `echomimic` | `BadToBest/EchoMimic` | EchoMimic v2 | Best quality; audio-driven |
| `aniportrait` | `ZJYang/AniPortrait` | AniPortrait | Fast; decent quality |
| `latentsync` | `ByteDance/LatentSync` | LatentSync | ByteDance; reliable |
| `fantasytalk` | `Fantasy-Studio/FantasyTalking` | FantasyTalking | Expressive motion |
| `longcat` | `meituan-longcat/LongCat-Video-Avatar-1.5` | LongCat 1.5 | **Paid GPU tier only** |
| `moda` | Community Space | MoDA | Alt engine; Phase 2 |
| `leaptalk` | Community Space | LeapTalk | Alt engine; Phase 2 |

### 4.3 TTS engines

| Engine ID | HF Space | Model | Voices | Notes |
|---|---|---|---|---|
| `tts-kokoro` | `hexgrad/Kokoro-82M` | Kokoro 82M | af_heart, af_bella, am_adam, am_michael, bf_emma, bm_george | Primary; high quality |
| `tts-coqui` | `coqui/xtts` | XTTS v2 | Multilingual | Fallback; slower |

### 4.4 Text-to-image (source generation)

| Engine ID | HF Space | Model | Notes |
|---|---|---|---|
| `flux-schnell` | `black-forest-labs/FLUX.1-schnell` | FLUX.1-schnell | Primary; 4-step, fast |
| `sdxl` | `diffusers/unofficial-SDXL-Turbo-i2i-t2i` | SDXL Turbo | Fallback |

### 4.5 Cloning guidance

**Free-tier clonable (ZeroGPU grant eligible):**
- LTX-Video, LTX-2, AniPortrait, LatentSync, EchoMimic, Kokoro

**Requires paid tier or A100 large:**
- Wan 2.2 14B, HunyuanVideo 1.5, LongCat 1.5

**To clone:** HF → Space → Duplicate → set to Public → apply for ZeroGPU grant at hf.co/zero-gpu-explorers

---

## 5. LLM providers (BYOK)

### 5.1 Anthropic

- **Endpoint:** `https://api.anthropic.com/v1/messages`
- **Auth:** `x-api-key` header
- **Models used:** Claude Haiku 4.5 (director — vision + fast), Claude Sonnet 4.6 (optional quality mode)
- **Key prefix:** `sk-ant-`
- **Vision:** Yes — image passed as base64 content block
- **Use in VideoLab:** Director shot list generation (image → shot list)

### 5.2 Groq

- **Endpoint:** `https://api.groq.com/openai/v1/chat/completions`
- **Auth:** `Authorization: Bearer gsk_...`
- **Models endpoint:** `GET https://api.groq.com/openai/v1/models` — live list, populated dynamically in UI
- **Vision model:** `meta-llama/llama-4-scout-17b-16e-instruct` (only multimodal model in catalogue)
- **Key prefix:** `gsk_`

**Known chat models (September 2026):**

| Model ID | Context | Speed (t/s) | Best for |
|---|---|---|---|
| `llama-3.1-8b-instant` | 131k | ~840 | Ultra-fast, director drafts |
| `llama-3.3-70b-versatile` | 131k | ~394 | Best quality text-only |
| `meta-llama/llama-4-scout-17b-16e-instruct` | 131k | ~594 | **Vision** — image + text |
| `meta-llama/llama-4-maverick-17b-128e-instruct` | 131k | ~594 | Latest Llama 4 |
| `openai/gpt-oss-20b` | 131k | ~1000 | Fastest reasoning |
| `openai/gpt-oss-120b` | 131k | ~500 | Flagship open-weight |
| `qwen/qwen3-32b` | 131k | ~662 | Multilingual + reasoning |
| `moonshotai/kimi-k2-instruct` | 131k | — | Long context |
| `gemma2-9b-it` | 8k | — | Lightweight |
| `deepseek-r1-distill-llama-70b` | 131k | — | Reasoning |

**Note:** Model list fetched live from `/v1/models` at settings open time. UI filters to `chat` type only (excludes guard/whisper models).

### 5.3 OpenRouter

- **Endpoint:** `https://openrouter.ai/api/v1/chat/completions`
- **Auth:** `Authorization: Bearer sk-or-...`
- **Models endpoint:** `GET https://openrouter.ai/api/v1/models`
- **Key prefix:** `sk-or-`
- **Free models:** Many — filtered in UI by `pricing.prompt === "0"` on the models response
- **Vision:** Varies per model (flagged in model metadata)
- **Use in VideoLab:** Director fallback when Anthropic + Groq not configured

---

## 6. Architecture overview

```
Browser (GitHub Pages)
│
├── Shell
│   ├── Image source panel    ← upload / FLUX generate / mood extract
│   ├── Tab bar               ← module switcher
│   ├── Notepad               ← localStorage scratch pad
│   └── Settings panel        ← BYOK keys, HF overrides, preferences
│
├── Modules
│   ├── Director              ← shot list → render → stitch
│   └── Lipsync               ← TTS → lipsync engine → download
│
└── Engines
    ├── hfClient.js           ← HF Space REST + fallback chain
    └── llmClient.js          ← BYOK LLM router (Anthropic / Groq / OpenRouter)

External services (browser → directly, no server)
├── HuggingFace Spaces        ← GPU inference (i2v, lipsync, TTS, image gen)
├── Groq API                  ← fast LLM inference (director, BYOK)
├── Anthropic API             ← Claude (director, BYOK)
├── OpenRouter API            ← LLM router (director, BYOK)
└── Cloudflare Worker (opt.)  ← API key proxy (future / team use)
```

---

## 7. Data flow: Director module

```
User loads image
    │
    ▼
[Image Source] → imageDataUrl (base64)
    │
    ▼
[Director: Generate]
    │
    ├─ if BYOK key set ──► [llmClient] ──► Groq/Anthropic/OpenRouter
    │                          │
    │                          ▼
    │                     shot list JSON (prompt, move, duration, caption)
    │
    ├─ if Worker URL set ──► [Cloudflare Worker] ──► Claude Haiku
    │
    └─ else ──────────────► template shots (10 built-in)
    │
    ▼
[Shot List Editor] — user reviews / edits / reorders
    │
    ▼
[Render All] — for each shot:
    │
    ├─ [hfClient.callWithFallback]
    │   wan22-i2v → wan21-i2v → ltx2 → ltx-video → svd
    │   └─ returns video blob URL
    │
    └─ [stitchVideos] — canvas + MediaRecorder → single WebM/MP4
    │
    ▼
[Result panel] — inline player + download
```

---

## 8. Data flow: Lipsync module

```
User loads portrait image + types script
    │
    ▼
[TTS] — Kokoro → Coqui fallback
    │   returns audio blob + duration
    ▼
[Audio preview] — user listens + approves
    │
    ▼
[Mouth marker] — user clicks portrait to set position
    │
    ▼
[runLipsync] — selected engine → fallback chain
    │   EchoMimic → AniPortrait → LatentSync → FantasyTalk
    │   returns video blob URL
    ▼
[Result panel] — inline player + download
```

---

## 9. Non-goals (explicitly out of scope)

- Multi-user / authentication
- Server-side video processing (except optional Cloudflare Worker for LLM proxying)
- Community features, comments, AI characters
- Mobile-first design (responsive but desktop-primary)
- Paid tier HF Space orchestration (LongCat, etc.)
- Commercial licensing / SaaS
