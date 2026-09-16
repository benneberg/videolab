# VideoLab
   [![CI](https://github.com/benneberg/videolab/actions/workflows/ci.yml/badge.svg)](https://github.com/benneberg/videolab/actions/workflows/ci.yml)
   [![Deploy](https://github.com/benneberg/videolab/actions/workflows/deploy.yml/badge.svg)](https://github.com/benneberg/videolab/actions/workflows/deploy.yml)
Modular AI video tool. Currently includes two modules: **Director** (AI-generated shot lists → rendered video) and **Lipsync** (portrait animation from speech). Built to be extended — adding a new tool means adding one module file.

---

## Architecture

```
src/
├── main.js                  # Bootstrap — wires everything together
├── shell/
│   ├── imageSource.js       # Shared image panel (upload / generate / mood)
│   ├── tabBar.js            # Module switcher
│   ├── notepad.js           # Floating scratch notes
│   └── storage.js           # localStorage helpers
├── engines/
│   └── hfClient.js          # HuggingFace Space REST abstraction + fallback chain
├── modules/
│   ├── director/
│   │   ├── index.js         # Director UI
│   │   ├── shotList.js      # Shot data model + editor
│   │   └── render.js        # HF i2v calls + client-side video stitcher
│   └── lipsync/
│       ├── index.js         # Lipsync UI
│       ├── tts.js           # TTS engine calls (Kokoro / Coqui)
│       └── sync.js          # Lipsync engine calls (EchoMimic / AniPortrait / LatentSync)
└── style/
    ├── base.css             # Design tokens + reset
    ├── shell.css            # Layout, sidebar, topbar
    └── modules.css          # Shared form controls, cards, buttons

worker/
└── director.js              # Cloudflare Worker — proxies Claude API for shot generation
```

---

## Local development

```bash
npm install
npm run dev
# → http://localhost:5173
```

---

## Deploy: GitHub Pages

### First-time setup

1. Push this repo to GitHub
2. Go to **Settings → Pages → Source** → select **GitHub Actions**
3. Push to `main` — the workflow in `.github/workflows/deploy.yml` builds and deploys automatically

The app is fully static. All HuggingFace Space calls go directly from the browser.

### Subsequent deploys

```bash
git push origin main
# GitHub Actions picks it up automatically
```

---

## Deploy: Cloudflare Worker (Director AI)

The Director module generates shot lists via Claude. Without the Worker it uses built-in template shots (still fully functional). With the Worker you get AI-written shot lists from your actual image.

### Setup

```bash
# Install Wrangler globally
npm install -g wrangler

# Authenticate
wrangler login

# Set your Anthropic API key (stored encrypted in Cloudflare — never in code)
wrangler secret put ANTHROPIC_API_KEY
# Paste your key when prompted

# Deploy
wrangler deploy
```

Wrangler will print your Worker URL, e.g. `https://videolab-director.yourname.workers.dev`.

### Connect to the app

In the Director module, open **Engine settings** and paste your Worker URL. It's saved locally in your browser.

---

## HuggingFace Spaces used

All calls go to public free-tier Spaces. The fallback chain tries each in order.

| Module    | Engine        | Space                                          |
|-----------|---------------|------------------------------------------------|
| Director  | Wan 2.2 I2V   | `wan-ai/Wan2.2-I2V-14B`                        |
| Director  | Wan 2.1 I2V   | `wangfuyun/AnimateLCM`                         |
| Director  | LTX-2         | `Lightricks/LTX-2`                             |
| Director  | LTX-Video     | `Lightricks/LTX-Video`                         |
| Director  | SVD           | `stabilityai/stable-video-diffusion-img2vid-xt`|
| Lipsync   | EchoMimic     | `BadToBest/EchoMimic`                          |
| Lipsync   | AniPortrait   | `ZJYang/AniPortrait`                           |
| Lipsync   | LatentSync    | `ByteDance/LatentSync`                         |
| Lipsync   | FantasyTalk   | `Fantasy-Studio/FantasyTalking`                |
| TTS       | Kokoro        | `hexgrad/Kokoro-82M`                           |
| TTS       | Coqui XTTS    | `coqui/xtts`                                   |
| Gen image | FLUX Schnell  | `black-forest-labs/FLUX.1-schnell`             |
| Gen image | SDXL Turbo    | `diffusers/unofficial-SDXL-Turbo-i2i-t2i`     |

### Using your own cloned Spaces

Open browser dev tools console and run:

```javascript
// Example: point the EchoMimic engine at your own Space
import('/src/engines/hfClient.js').then(m => {
  m.setSpaceOverride('echomimic', 'https://yourusername-echomimic.hf.space');
});
```

A settings UI for this will be added in a future version.

---

## Adding a new module

1. Create `src/modules/yourmodule/index.js` with this interface:

```javascript
export class YourModule {
  get id()    { return 'yourmodule'; }
  get label() { return 'Your Module'; }
  get icon()  { return '<svg>...</svg>'; }

  mount() {
    // Render your UI into this._container
    // Bind your events
  }

  onImageChange({ img, dataUrl, meta }) {
    // Called whenever the user loads/generates a new image
  }

  onActivate() {
    // Optional: called when the user switches to this tab
  }
}
```

2. Register in `src/main.js`:

```javascript
import { YourModule } from './modules/yourmodule/index.js';

const modules = [
  new DirectorModule('#module-director', imageSource),
  new LipsyncModule('#module-lipsync',   imageSource),
  new YourModule('#module-yourmodule',   imageSource),  // ← add
];

// Add to HTML in main (in buildShell):
// <div class="module-view" data-module="yourmodule" id="module-yourmodule"></div>

tabBar.register({ id: 'yourmodule', label: 'Your Module', icon: ICON_YOUR });
```

That's it. The shell handles tab switching, image forwarding, and layout automatically.

---

## Roadmap

- [ ] Animate module (direct i2v, no shot list)
- [ ] Describe module (image → text description → prompt feed)
- [ ] Space override settings panel (UI for hfClient overrides)
- [ ] Mic recording for Lipsync
- [ ] Seed + reproducibility controls
- [ ] Caption burn-in on video output
- [ ] Export settings (resolution, format, quality)
