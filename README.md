# Framecraft — Local AI Photoshoot Director & Content Factory

**Framecraft** is a self-hosted, closed-loop generative media orchestration workbench. It connects a structured photography prompt compiler to your local GPU stack—covering identity LoRA dataset prep and training, ControlNet pose-locked rendering, ADetailer face/hand inpainting, R-ESRGAN upscaling, and automated Instagram publishing—without node spaghetti or manual copy-pasting.

```text
Raw Subject Photos (./lora_raw)
  └─▶ prepare_lora.py (1024px center-crop + BLIP auto-captioning)
        └─▶ train_lora.py (kohya_ss / accelerate -> .safetensors)
              └─▶ Framecraft Prompt Compiler (:3000)
                    ├─▶ A1111 WebUI (:7860) [ControlNet + ADetailer + R-ESRGAN 4x+]
                    ├─▶ ComfyUI API (:8188) [KSampler + LoraLoader JSON graph]
                    └─▶ Distribution Layer (./exports/ + ig_poster.py :5001)
```

---

## Repository Structure

```text
framecraft/
├── src/
│   ├── components/
│   │   ├── PromptCompilerWorkbench.tsx   # Compiler, ControlNet, ADetailer, Batch SSE Queue, LoRA, IG
│   │   ├── PivotVibeModal.tsx            # AI aesthetic set generator (/api/direct-set)
│   │   ├── ContactSheetGrid.tsx          # 3-scene visual motif grid
│   │   ├── SceneLightboxModal.tsx        # Scene breakdown & negative prompt inspector
│   │   └── ...                           # Header, HeroSection, TechnicalNotesSection
│   ├── utils/
│   │   ├── promptCompiler.ts             # SD / Midjourney / ComfyUI prompt compiler & guardrails
│   │   ├── renderPayload.ts              # Payload builders, upscale magic/dim checks, batch queue types
│   │   ├── zipBuilder.ts                 # Zero-dependency browser PKZIP contact-sheet packager
│   │   └── promptCompiler.test.ts        # Unit tests (node:test)
│   ├── data/presetSets.ts                # Presets, camera & lighting physics
│   └── App.tsx
├── exports/                              # .gitignore'd — upscaled IG-ready renders saved here
├── lora_raw/                             # .gitignore'd — raw subject photos for LoRA prep
├── lora_processed/                       # .gitignore'd — 1024px cropped + BLIP-captioned dataset
├── server.ts                             # Express proxy & orchestrator (Render, Upscale, Save, Train, Post)
├── prepare_lora.py                       # BLIP captioning & 1024x1024 image cropping
├── train_lora.py                         # Kohya_ss automated LoRA training runner
├── ig_poster.py                          # Standalone Flask + instagrapi publishing microservice
├── .env.example                          # GEMINI_API_KEY, APP_URL template
├── package.json
└── README.md
```

---

## Core Capabilities

### 1. Prompt Compiler & Workbench (Frontend)
- **Photography Physics Engine**: Translates structured creative direction into explicit camera bodies, focal lengths, apertures (`85mm f/1.8`, `24mm f/1.8`, `35mm f/2.8`, `Leica M6 50mm f/1.4`), and calibrated lighting setups (Soft Window Light, Flat Overhead Fluorescent, Harsh Midday Sunlight, Neon Club Spill, Studio Softbox, Golden Hour Rim).
- **LoRA Identity Injection**: Dynamic `<lora:filename:weight>` compilation with strength slider (`0.10–1.20`), toggleable injection, and automatic trigger sync after training.
- **Multi-Engine Compilation**: Real-time export formatting for **Stable Diffusion / Automatic1111**, **Midjourney v6** (`--ar`, `--style raw`, `--no`), and **ComfyUI** (executable workflow JSON).
- **CFG & Lighting Guardrails**: Enforces the recommended `7.0–9.0` Stable Diffusion CFG sweet spot to prevent plastic skin (`CFG > 10`) or prompt drift (`CFG < 5`), paired with lighting-consistency checks per scene.
- **AI Aesthetic Vibe Expansion**: Optional **Pivot Vibe** generator (`POST /api/direct-set`) using `@google/genai` to scaffold new 3-scene photoshoot sets from a short aesthetic brief.

### 2. Execution & Inference Proxy (Node.js / Express)
- **Local API Proxy**: Routes compiled prompts and image payloads from the browser to `127.0.0.1:7860` (Automatic1111) or `127.0.0.1:8188` (ComfyUI) via Node.js native `fetch`, avoiding browser CORS issues and handling base64 PNG responses.
- **Server-Side Batch Queue & SSE Orchestrator**: `POST /api/batch-render` enforces hard GPU concurrency `= 1`, sequentially rendering and upscaling every scene (`R-ESRGAN 4x+`), streaming live progress via `GET /api/batch-progress/:jobId` (`render` → `upscale` → `done`/`error`), supporting mid-queue cancellation (`POST /api/batch-cancel/:jobId`), and packaging all upscaled PNGs into a one-click client-side `.zip` (`src/utils/zipBuilder.ts`).
- **Reload Recovery & Storage Limits**: Completed contact sheets are cached in `localStorage` (`framecraft_last_batch_sheet_v1`) for one-click reload recovery. *Note*: because browsers enforce a ~5 MB `localStorage` quota, very large high-resolution base64 contact sheets (e.g., 4× upscales) may exceed quota and trigger an immediate download warning instead of persisting across reloads.
- **Path-Traversal Safety**: Validates local service URLs and sanitizes filenames (`sanitizeExportFilename`, `sanitizeDatasetImageFilename`, `sanitizeLoraTrainingArg`) before reading or writing inside `./exports/`, `./lora_raw/`, and `./lora_processed/`.

### 3. ControlNet & Post-Processing (Refinement)
- **Pose Matching (ControlNet)**: Drag-and-drop reference photo zone supporting **OpenPose Skeleton** (`openpose`), **Depth** (`depth_midas`), and **Canny Edge** (`canny`) preprocessors with configurable ControlNet weight (`0.10–1.50`), routed through `POST /api/render-controlled`.
- **Automated Inpaint (ADetailer)**: Optional `alwayson_scripts.ADetailer` passes targeting `face_yolov8n.pt` and `hand_yolov8n.pt` on A1111 `txt2img` renders to repair facial detail and hands automatically.
- **High-Res Upscaling (R-ESRGAN + Hardening)**: Pushes renders through `/sdapi/v1/extra-single-image` using `R-ESRGAN 4x+` (`2×`, `3×`, or `4×`) with `gfpgan_visibility: 0` unless explicitly enabled. Rejects non-PNG/JPEG magic bytes, payloads over `16 MB` base64 chars, and input images exceeding `2048×2048px`.

### 4. Identity Training Pipeline (Python)
- **Dataset Auto-Prep (`prepare_lora.py`)**: Scans `./lora_raw`, center-crops and resizes photos to `1024×1024` (`Image.LANCZOS`), runs `Salesforce/blip-image-captioning-base`, and saves paired `<name>.png` + `<name>.txt` captions prefixed with your unique trigger word inside `./lora_processed`.
- **Automated Kohya Training (`train_lora.py`)**: Launches `accelerate launch train_network.py` with tuned SD 1.5 LoRA defaults (`AdamW8bit`, `cosine` scheduler, `fp16`, `keep_tokens=1`) and two GPU presets selectable in the UI:
  - **8–12 GB VRAM**: `train_batch_size=2`, `network_dim=32`, `network_alpha=16`
  - **6 GB VRAM**: `train_batch_size=1`, `network_dim=16`, `network_alpha=8`

### 5. Distribution & Publishing (Python / Flask)
- **Local Export**: Writes rendered or upscaled PNGs safely into `./exports/` via `POST /api/save-local`.
- **Instagram Auto-Poster (`ig_poster.py`)**: Standalone local Flask microservice on port `5001` backed by `instagrapi`. Persists session settings to `session.json` and accepts proxied publish requests (`POST /api/post-ig`) with your caption directly from the UI.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite, Lucide Icons, Motion
- **Backend**: Node.js, Express, native Fetch API, `@google/genai` (server-side only)
- **AI / ML Scripts**: Python 3.10+, PyTorch, Pillow, Hugging Face `transformers` (BLIP), `kohya_ss` (`sd-scripts` + `accelerate`)
- **External Local APIs**: Automatic1111 WebUI (`--api`), ComfyUI (`/prompt`), `instagrapi` (via Flask microservice)

---

## Prerequisites

- **NVIDIA GPU**: 8 GB+ VRAM recommended for local inference (`512×640` + `R-ESRGAN 4x+`); 12 GB+ recommended for fast LoRA training (6 GB compact profile supported).
- **Automatic1111 WebUI** running locally with the `--api` flag (`http://127.0.0.1:7860`), or **ComfyUI** (`http://127.0.0.1:8188`).
- **A1111 Extensions** (for full refinement pipeline):
  - `sd-webui-controlnet` (with OpenPose / Depth / Canny models)
  - `adetailer` (`face_yolov8n.pt` and `hand_yolov8n.pt`)
- **Kohya SS (`sd-scripts`)** + `accelerate` (for local LoRA training).
- **Node.js 18+** (Node 22+ recommended) and **Python 3.10+**.

---

## Quickstart

### 1. Install Node.js Dependencies
```bash
npm install
```

### 2. Configure Environment Variables (Optional)
Copy `.env.example` to `.env` if you want to enable AI vibe expansion via Gemini, or export local Python training/IG variables in your shell:

```bash
# Required only for the "Pivot Vibe" AI set generator (/api/direct-set)
GEMINI_API_KEY="your_gemini_api_key"

# Optional overrides for train_lora.py
export KOHYA_DIR="C:/kohya_ss/sd-scripts"
export SD_BASE_MODEL="C:/A1111/models/Stable-diffusion/v1-5-pruned-emaonly.safetensors"
export LORA_OUTPUT_DIR="C:/A1111/models/Lora"

# Required only if using ig_poster.py
export IG_USERNAME="your_instagram_username"
export IG_PASSWORD="your_instagram_password"
```

### 3. Start Framecraft Workbench
```bash
npm run dev
```
Open `http://localhost:3000`.

### 4. Start Local GPU & Publishing Services (As Needed)
- **Automatic1111 WebUI**:
  ```bash
  ./webui.sh --api --xformers
  ```
- **LoRA Dataset Prep & Training Python Deps**:
  ```bash
  pip install Pillow transformers torch torchvision
  ```
- **Instagram Auto-Poster Microservice** (port `5001`):
  ```bash
  pip install flask instagrapi
  python ig_poster.py
  ```

---

## Scripts & Verification

```bash
# Start full-stack dev server (Express + Vite middleware on port 3000)
npm run dev

# Build production frontend bundle
npm run build

# Run TypeScript type check
npm run lint

# Run pure compiler, payload, and sanitization unit tests
npx tsx --test src/utils/promptCompiler.test.ts
```

---

## API Overview

### Express Backend (`server.ts` on `:3000`)
| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check (`{ ok: true }`) |
| `POST` | `/api/direct-set` | Generate a structured 3-scene photoshoot set via Gemini |
| `POST` | `/api/render-image` | Proxy `txt2img` (with optional `ADetailer`) to A1111 or workflow graph to ComfyUI |
| `POST` | `/api/render-controlled` | Proxy ControlNet (`openpose` / `depth_midas` / `canny`) + `ADetailer` render to A1111 |
| `POST` | `/api/upscale-image` | Validate PNG/JPEG magic & dimensions (`<=2048px`), proxy `R-ESRGAN 4x+` upscale to A1111 |
| `POST` | `/api/batch-render` | Enqueue sequential (`concurrency = 1`) batch render + upscale job; returns `jobId` |
| `GET` | `/api/batch-progress/:jobId` | Server-Sent Events (SSE) progress stream (`render` / `upscale` / `done` / `error`) |
| `POST` / `DELETE` | `/api/batch-cancel/:jobId` / `/api/batch-render/:jobId` | Abort in-flight render/upscale and drop remaining queued scenes |
| `GET` | `/api/batch-result/:jobId` | Fetch completed scenes array for a batch job |
| `POST` | `/api/save-local` | Sanitize filename and save base64 PNG into `./exports/` |
| `POST` | `/api/post-ig` | Proxy local export path + caption to `ig_poster.py` (`127.0.0.1:5001/post`) |
| `GET` / `POST` / `DELETE` | `/api/lora-dataset` | List, stage, or clear raw training images in `./lora_raw/` |
| `POST` | `/api/train-lora` | Run `prepare_lora.py` followed by `train_lora.py` and return combined logs |

### Instagram Microservice (`ig_poster.py` on `:5001`)
| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/health` | Microservice readiness check |
| `POST` | `/post` | Authenticate via `instagrapi` (`session.json`) and upload image + caption |
