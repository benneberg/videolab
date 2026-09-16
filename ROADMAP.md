# VideoLab — Roadmap

> Phases are sequential. Each phase ships a working, usable tool — no half-built states.

---

## Phase 1 — Foundation ✅ `current`

**Goal:** Two working modules, clean architecture, zero-config local dev, deployable to GitHub Pages.

### Completed
- [x] Vite + vanilla ES modules project structure
- [x] Design system (tokens, base/shell/module CSS layers)
- [x] Shell: image source panel (upload + FLUX generate + mood extraction)
- [x] Shell: module tab switcher
- [x] Shell: floating notepad (localStorage persistent)
- [x] Shell: localStorage helper
- [x] Engine: HF Space REST abstraction with ordered fallback chain
- [x] Module: Director (AI shot list → render → client-side stitch)
- [x] Module: Lipsync (TTS → lipsync engine → download)
- [x] Cloudflare Worker source (Claude Haiku vision for shot generation)
- [x] GitHub Actions deploy workflow
- [x] PRD, README, ARCHITECTURE docs

### Remaining in Phase 1
- [ ] **Settings panel + BYOK keys** (Anthropic, Groq, OpenRouter)
- [ ] **LLM client module** (`llmClient.js`) with provider routing
- [ ] **Groq model list** fetched live from `/v1/models`
- [ ] CI workflow (lint + build check on PRs)

---

## Phase 2 — Polish & Animate module `next`

**Goal:** Animate module (direct i2v without shot list), UX refinements, reproducibility tools.

### Planned
- [ ] **Animate module** — direct image-to-video
  - Engine selector (same HF fallback chain as Director render)
  - Camera move, motion mode, framing, resolution, FPS
  - Duration slider (2–30s) + long-form override (1/2/5/10/15 min)
  - Fine-tuning panel: strength, depth/parallax, focus, handheld, ambient life
  - Loop toggle (seamless / one-way)
  - On-device fallback: WebGL depth-warp parallax (offline, instant)
  - Caption burn-in toggle
- [ ] **Seed + reproducibility** — seed input, randomise, "Surprise me"
- [ ] **Share link** — URL encodes full recipe (image URL + all settings)
- [ ] **HF Space override UI** — settings panel rows for each engine ID
- [ ] **Mood → settings bridge** — mood data auto-adjusts motion intensity and cut pacing
- [ ] **Mic recording** — activate the already-wired Lipsync skeleton (MediaRecorder API)
- [ ] **Re-generate single shot** — per-shot re-render button in Director
- [ ] **Caption burn-in** — canvas text overlay on output video
- [ ] **Fullscreen button** for video results
- [ ] **Sound toggle** — global mute for audio previews

---

## Phase 3 — Describe module & long-form video

**Goal:** Image → text pipeline feeding Director; 15-minute video streaming to disk.

### Planned
- [ ] **Describe module** — vision model analyses image → detailed text description
  - Provider: Groq (Llama 4 Scout vision) → Anthropic (Claude Haiku) fallback
  - Editable output: user can tweak before passing to Director/Animate
  - Options: style tags, motion hints, mood hints, negative description
  - "Feed to Director" one-click handoff
- [ ] **Long-form video** — sequential shot render + stream directly to disk
  - Uses File System Access API (Chrome) for streaming write
  - Progress per clip, resume on failure
  - Target: up to 15 min output without holding entire video in memory
- [ ] **Director refinement chat** — iterative shot list editing via LLM conversation
  - "Make shot 3 more dramatic" → LLM rewrites that shot only
  - Conversation log displayed alongside shot list
- [ ] **Batch processing** — queue multiple images, process overnight

---

## Phase 4 — Design & Text modules

**Goal:** Title cards, text-to-video, overlay tools.

### Planned
- [ ] **Design module** — AI title card / overlay generator
  - Canvas-based renderer
  - LLM generates JSON config (typography, colors, layout)
  - Export as PNG overlay
  - Preview overlaid on source image
- [ ] **Text module** — text-to-video (no source image required)
  - Prompt input → same i2v engine chain
  - Style presets
- [ ] **Overlay composer** — combine title card + animated video in canvas
- [ ] **Font selector** — Google Fonts integration for title cards

---

## Phase 5 — Integration & extensibility

**Goal:** VideoLab as a platform other Relvanta tools can embed.

### Planned
- [ ] **Module API** — formal JS interface for external callers
  - `VideoLab.getModule('lipsync')` → returns module instance
  - `module.run({ image, script, voice })` → Promise<videoBlobUrl>
- [ ] **iframe embed mode** — query param `?module=lipsync&embed=1` renders single module
- [ ] **Event bus** — modules emit events other tools can subscribe to
- [ ] **Preset system** — save/load named setting configs per module
- [ ] **History panel** — recent renders with thumbnails, re-download without re-render
- [ ] **Personal HF Space dashboard** — list cloned Spaces, check status, switch active

---

## Deferred / under consideration

| Item | Notes |
|---|---|
| Cloudflare Worker team mode | Centralised key proxy for sharing with collaborators |
| Server-side ffmpeg stitch | Better than canvas stitch; needs a small server or edge function |
| AniPortrait v2 / MoDA / LeapTalk | Add when Spaces stabilise |
| LongCat-Video-Avatar 1.5 | Requires paid HF GPU; add as optional paid-tier option |
| Export format selection | MP4 / WebM / GIF choice |
| PWA / offline mode | Service worker caching for the on-device parallax path |
| Dark/light theme toggle | Currently dark-only |

---

## Version history

| Version | Date | Description |
|---|---|---|
| v0.1 | 2026-09-16 | Initial build — Director + Lipsync modules, shell, HF engine layer |
