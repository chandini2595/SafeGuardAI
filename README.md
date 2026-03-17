# Safeguard — Disaster safety agent

**Agents for Impact Hackathon · NVIDIA Nemotron**

Paste a photo of a natural disaster or emergency and your location. The app uses **NVIDIA Nemotron** (vision) to analyze the scene, suggests the **nearest safest location**, and shows **emergency numbers** (police, fire, ambulance) for your country.

## Quick start

1. **Get an OpenRouter API key** (hackathon: use the $10 voucher at [OpenRouter](https://openrouter.ai)).
2. Copy env and add your key:
   ```bash
   cp .env.example .env.local
   # Edit .env.local and set OPENROUTER_API_KEY=sk-or-v1-...
   ```
3. Run the app:
   ```bash
   npm install
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000). Upload or paste an image, enter location (e.g. "San Jose, CA"), click **Get safe location & emergency numbers**.

## Running on your network (HTTP)

To use the app from another device (e.g. phone or another laptop) on the same Wi‑Fi:

1. Run the dev server bound to all interfaces:
   ```bash
   npm run dev:lan
   ```
2. On the other device, open `http://<your-computer-ip>:3000` (e.g. `http://172.20.10.6:3000`). Find your IP with `ipconfig` (Windows) or `ifconfig` / Network settings (Mac).

3. **“Not secure” and voice/mic:** Browsers treat HTTP on an IP as insecure, so they may block the microphone (voice location). To allow it in Chrome:
   - Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
   - **Option A:** On the same machine use **http://localhost:3000** (mic often works). **Option B:** Run `npm run dev:https` and open **https://localhost:3000** (accept cert once). **Option C:** Add your URL (e.g. `http://0.0.0.0:3000` or `http://172.20.10.6:3000`) to the flag, then **Relaunch**.

## Stack

- **Next.js** (App Router) — frontend + API routes
- **NVIDIA Nemotron** via OpenRouter (`nvidia/nemotron-nano-12b-v2-vl`) — image understanding and safe-location suggestion
- **OpenStreetMap Nominatim** — geocoding location → country
- **Emergency Number API** — police/fire/ambulance by country

## Deploy on Vercel

### 1. Push the project to GitHub

If you haven’t already:

```bash
cd /path/to/SafeguardAI
git init
git add .
git commit -m "Initial commit - Safeguard app"
```

Create a new repository on [GitHub](https://github.com/new), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

### 2. Import the project in Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (GitHub is easiest).
2. Click **Add New…** → **Project**.
3. Import the GitHub repo you just pushed (e.g. `YOUR_USERNAME/YOUR_REPO`).
4. Leave **Framework Preset** as **Next.js** (Vercel detects it).
5. Before deploying, open **Environment Variables** and add:
   - **Name:** `OPENROUTER_API_KEY`  
   - **Value:** your OpenRouter API key (e.g. `sk-or-v1-...`)
   - Optionally add `OPENROUTER_FAST_VISION` = `1` for faster vision.
6. Click **Deploy**.

### 3. After deploy

- The app will be at **https://your-project-name.vercel.app** (or your custom domain if you set one).
- To change env vars later: Vercel dashboard → your project → **Settings** → **Environment Variables** → edit and redeploy.

### Deploy from the CLI (optional)

```bash
npm i -g vercel
vercel
```

Follow the prompts and add `OPENROUTER_API_KEY` when asked or in the Vercel dashboard.

