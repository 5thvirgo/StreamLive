# StreamLive

A minimal live-streaming platform prototype: RTMP ingest -> HLS transcode -> browser playback, with live chat per match.

## Run it

```bash
cd server
npm install
npm start
```

Open http://localhost:4000

## Go live

1. On the "Create match" page, fill in the match details. You'll get an RTMP server URL and a stream key.
2. Push a stream to it with any encoder:
   - OBS Studio: Settings -> Stream -> Server: `rtmp://localhost:1935/live`, Stream Key: (the generated key).
   - Or, with no camera/OBS, use the bundled synthetic test stream:
     ```bash
     cd server
     npm run demo-stream -- <streamKey>
     ```
3. The match flips to "Live" automatically and becomes watchable at `/watch.html?id=<matchId>`.

## Scores & fixtures (Premier League / La Liga / Champions League)

`/scores.html` shows upcoming fixtures and recent results for these three competitions, plus a "watch legally" panel pointing viewers at the official broadcaster for their region. This is metadata only — no match video — because we don't hold broadcast rights to these leagues; rebroadcasting their matches isn't something this project does.

Data comes from the **Sofascore** API on RapidAPI (`server/fixtures.js`) — chosen after testing a couple of alternatives that either had inconsistent coverage (missing Champions League fixtures entirely) or were blocked from some networks. Sofascore had full, accurate coverage of all three competitions.

To light up real data:

1. Get a free API key: sign up at RapidAPI, then subscribe (free Basic tier) to Sofascore at https://rapidapi.com/apidojo/api/sofascore
2. Put it in `server/.env` (auto-loaded via `dotenv`, and gitignored so it's never committed):
   ```
   RAPIDAPI_KEY=your_key_here
   ```
3. `npm start` as usual. Without a key, the page shows a friendly "no key configured" message instead of breaking.

Competition → Sofascore tournament ID mapping lives in `COMPETITIONS` in `server/fixtures.js` (Premier League=17, La Liga=8, Champions League=7) — Sofascore's own IDs, found via its `/tournaments/list` and `/tournaments/get-seasons` endpoints.

The "watch legally" broadcaster list (`server/fixtures.js`) is a curated starting point, not a guaranteed-accurate feed — broadcast rights change by season and region, so keep it updated or swap in a licensed data source.

### Kickoff reminders

Each upcoming fixture on `/scores.html` has a "🔔 Remind me" button. It uses the browser Notification API (`client/reminders.js`) — no account or server needed, reminders live in the viewer's `localStorage` and fire ~10 minutes before kickoff while any StreamLive tab is open. It's a plain page script, not a service worker, so it can't notify after the browser is fully closed.

## Architecture

- `server/index.js` — Express REST API (`/api/matches`), Socket.io chat, and `node-media-server` for RTMP ingest + ffmpeg transcode to HLS.
- `client/` — plain HTML/JS: match list, admin (create match), watch page (hls.js player + chat).
- Matches and chat are in-memory (no database) — restarting the server clears them.
- `server/patches/` — a `patch-package` fix for an upstream `node-media-server` bug (undefined variable in a log statement that crashes startup). Applied automatically via `postinstall` on every `npm install`.

## Swapping in a managed video service

For real scale/reliability you'd replace the local RTMP/ffmpeg pipeline with a managed ingest+transcode service (Mux, Cloudflare Stream, AWS IVS) — same REST/chat architecture, just point `hlsUrl` at the provider's playback URL instead of the local `/media` path.
