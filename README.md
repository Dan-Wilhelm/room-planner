# Room Planner

AI interior-design assistant for whole apartments — a private test app for a few people in the Karlsruhe area.

A **project** (apartment, house, several homes) contains **rooms**, a shared **furniture inventory** and an **inspiration board**. For each room you:

1. **Capture** it — text description, photos and/or a walkthrough video (only 8–12 downscaled frames are used; the video never leaves your computer), and the dimensions you know. Any shape: templates (rectangle, L, rectangle + niche, U) or a corner table; sloped ceilings, doors, windows, roof windows, radiators, sockets, built-ins.
2. **Review** the room model. Values you entered are never overwritten; AI estimates are marked with confidence and a reason.
3. Assign **furniture** (keep = only move, replaceable = may be replaced; spare items from other rooms can be used).
4. Optionally state your **taste** (plain words), a **style source** (independent / match another room / follow inspirations), an **idea** and a **budget** (incl. paint + small materials, excl. shipping).
5. Get **3 complete designs** — layout, lighting plan, paint with quantities, textiles, plants, decor — each with **real products** from IKEA, Amazon.de, Otto, DIY stores and garden centres in two tiers (“Budget” / “A bit nicer”), shown in **3D**, as a **2D plan** and on demand as a **photorealistic image**. Click any item for 5 alternatives, build variations on a design, compare, mark one as chosen, export the shopping list.

A deterministic geometry module checks every layout (fits the room, headroom under slopes, walkways ≥ 80 cm, door swings, radiators, windows, sockets) — the AI is not trusted with spatial maths.

## Stack

Next.js 16 (App Router, `proxy.ts`, Node runtime, `cacheComponents` off) · TypeScript · Tailwind · three.js / react-three-fiber / drei · Anthropic TypeScript SDK (Claude Sonnet 5.5 for analysis & design, Claude Haiku 5.5 for product search) · Vercel AI SDK 7 + AI Gateway (Gemini “Nano Banana 2.1” images) · IndexedDB (all data stays in the browser) · Vitest + Playwright.

Deployed on Vercel (team `dans-projects-98`, region `fra1`).

## Local setup

```bash
npm install
vercel link            # once
vercel env pull        # writes .env.local (git-ignored); re-run after 12 h for a fresh OIDC token
cp .env.example .env.development.local   # optional overrides for `next dev`, e.g. APP_PASSWORD=localtest, AI_MODE=mock
npm run dev
```

`AI_MODE=mock` (default for local development) uses realistic fixtures with simulated streaming — no API costs. `AI_MODE=live` calls the real APIs.

Tests: `npm run test:unit` (Vitest) · `npm run test:e2e` (Playwright, full flow in mock mode) · `npm test` runs both.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Claude API (server-side only) |
| `APP_PASSWORD` | yes | shared password for the app |
| `SESSION_SECRET` | yes | ≥ 32 chars, signs the session cookie |
| `AI_MODE` | yes | `live` in production, `mock` locally |
| `PRODUCT_SEARCH_MODEL` | no | default `claude-haiku-5-5` |
| `IMAGE_MODEL` | no | default `google/gemini-nano-banana-2.1` |
| `AI_GATEWAY_API_KEY` | no | only for local image generation without OIDC |
| `META_OEMBED_TOKEN`, `META_IG_USER_TOKEN`, `META_IG_USER_ID`, `META_IG_USER_TOKEN_EXPIRES` | no | optional Instagram booster (see below) |

Never commit `.env*` files — this repository is public. `npm run secret-scan` checks staged files (run before every commit).

## Costs (measured on production, 2026-11-14)

| Step | Model | Measured |
| --- | --- | --- |
| Room analysis (text + 1–3 images) | Claude Sonnet 5.5 | ≈ $0.04–0.06 |
| 3 designs (one call, effort `low`) | Claude Sonnet 5.5 | ≈ $0.19, ~2 min |
| Product search, 3 designs × 2 tiers incl. link check | Claude Haiku 5.5 + web search ($0.01/search) | ≈ $0.45–0.65 |
| **Full room run** (designs + products) | | **$0.74–0.88**, 4–5.5 min — hard limit $1.00 (each design gets an equal product budget; search stops early and says so) |
| Build on a design (2 variations) | Sonnet + Haiku | ≈ $0.43, ~2.5 min |
| Find alternatives (one item) | Claude Haiku 5.5 | $0.02–0.06 |
| Inspiration analysis | Claude Sonnet 5.5 | ≈ $0.01 |
| Photorealistic image | Nano Banana 2.1 via AI Gateway | $0.034, ~20 s |

Design effort can be raised with `DESIGN_EFFORT=medium|high` (measured: `high` costs ~3× for one design without better layouts).

Every design shows its real costs (tokens, searches, images) in a cost panel.

**Please set spend limits:**
- Anthropic Console → *Plans & Billing* / *Limits*: a monthly spend limit for the workspace of the API key.
- Vercel → *AI Gateway → Budgets*: e.g. `vercel ai-gateway budgets set project room-planner --limit 10 --refresh-period monthly` (check `--help` first). Image generation needs **paid** AI Gateway credits — the free tier does not include the image model.

## Instagram booster (optional, off by default)

Instagram usually blocks link previews. Without the booster, add 2–4 screenshots or a screen recording of the post — that always works. To enable the booster later, use **your own** Meta app and Instagram account — never credentials from other projects (e.g. client websites):

1. Create an app at <https://developers.facebook.com/apps> (type *Business*).
2. **oEmbed** (caption + author): add the *oEmbed Read* feature; set `META_OEMBED_TOKEN` to the app token `APP_ID|APP_SECRET` (or `APP_ID|CLIENT_TOKEN`).
3. **Business Discovery** (real images of posts from other creator/business accounts): switch your own Instagram account to *Creator* or *Business*, link it to a Facebook Page, add the *Instagram API with Facebook Login* product (Instagram Login alone does not support Business Discovery), and create a long-lived user token with `instagram_basic` and `pages_show_list`. Set `META_IG_USER_TOKEN`, `META_IG_USER_ID` (your Instagram professional account id) and `META_IG_USER_TOKEN_EXPIRES` (ISO date — the app warns 7 days before; tokens last ~60 days).
4. `vercel env add <NAME> production` for each, then redeploy.

Limits: no media for videos with licensed music, reels with downloads disabled, private or personal accounts — the app falls back to screenshots.

## Security notes

Password gate in the app (`proxy.ts` + HMAC-signed cookie; every API route checks it again; login throttling). Web pages and captions are treated as data, never as instructions. Product links are checked by our server through an SSRF-safe fetcher (no private IPs, size/time limits, no cookies). Links render with `rel="noopener noreferrer nofollow"`.
