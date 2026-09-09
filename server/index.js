require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const NodeMediaServer = require('node-media-server');
const ffmpegPath = require('ffmpeg-static');
const { COMPETITIONS, fetchFixtures, fetchLiveMatches, WATCH_LEGALLY } = require('./fixtures');

const PORT = process.env.PORT || 4000;
const RTMP_PORT = 1935;
const MEDIA_ROOT = path.join(__dirname, 'media');
const CLIENT_ROOT = path.join(__dirname, '..', 'client');

const matches = new Map();

function serializeMatch(match) {
  const { streamKey, ...pub } = match;
  return pub;
}

function findByStreamKey(key) {
  for (const match of matches.values()) {
    if (match.streamKey === key) return match;
  }
  return null;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use('/media', express.static(MEDIA_ROOT, { cacheControl: false }));
app.use(express.static(CLIENT_ROOT));

app.get('/api/matches', (req, res) => {
  const list = [...matches.values()]
    .map(serializeMatch)
    .sort((a, b) => a.kickoff - b.kickoff);
  res.json(list);
});

app.post('/api/matches', (req, res) => {
  const { title, homeTeam, awayTeam, kickoff } = req.body || {};
  if (!title || !homeTeam || !awayTeam || !kickoff) {
    return res.status(400).json({ error: 'title, homeTeam, awayTeam, kickoff are required' });
  }
  const kickoffMs = new Date(kickoff).getTime();
  if (Number.isNaN(kickoffMs)) {
    return res.status(400).json({ error: 'kickoff must be a valid date/time' });
  }
  const id = crypto.randomUUID();
  const streamKey = crypto.randomBytes(8).toString('hex');
  const match = {
    id,
    title,
    homeTeam,
    awayTeam,
    streamKey,
    status: 'upcoming',
    hlsUrl: null,
    kickoff: kickoffMs,
    createdAt: Date.now(),
  };
  matches.set(id, match);
  res.status(201).json({
    ...serializeMatch(match),
    streamKey,
    rtmpUrl: `rtmp://localhost:${RTMP_PORT}/live`,
  });
});

app.get('/api/matches/:id', (req, res) => {
  const match = matches.get(req.params.id);
  if (!match) return res.status(404).json({ error: 'match not found' });
  res.json(serializeMatch(match));
});

app.delete('/api/matches/:id', (req, res) => {
  matches.delete(req.params.id);
  res.status(204).end();
});

app.get('/api/fixtures/:competition', async (req, res) => {
  const { competition } = req.params;
  const type = req.query.type === 'last' ? 'last' : 'next';
  if (!COMPETITIONS[competition]) {
    return res.status(404).json({ error: `Unknown competition "${competition}"` });
  }
  try {
    const fixtures = await fetchFixtures(competition, type);
    res.json({ competition: COMPETITIONS[competition].name, type, fixtures });
  } catch (err) {
    if (err.code === 'NO_API_KEY') {
      return res.status(503).json({
        error: 'No sports-data API key configured.',
        hint: 'Get a free key at https://rapidapi.com/api-sports/api/api-football and set RAPIDAPI_KEY.',
      });
    }
    console.error('fixtures error:', err.message);
    res.status(502).json({ error: 'Failed to fetch fixtures from upstream provider.' });
  }
});

app.get('/api/live', async (req, res) => {
  try {
    const matches = await fetchLiveMatches();
    res.json({ matches });
  } catch (err) {
    if (err.code === 'NO_API_KEY') {
      return res.status(503).json({
        error: 'No sports-data API key configured.',
        hint: 'Get a free key at https://rapidapi.com/apidojo/api/sofascore and set RAPIDAPI_KEY.',
      });
    }
    console.error('live matches error:', err.message);
    res.status(502).json({ error: 'Failed to fetch live matches from upstream provider.' });
  }
});

app.get('/api/watch-legally/:competition', (req, res) => {
  const info = WATCH_LEGALLY[req.params.competition];
  if (!info) return res.status(404).json({ error: 'Unknown competition' });
  res.json(info);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  socket.on('join', ({ matchId, name }) => {
    socket.join(matchId);
    socket.data.name = (name || 'Fan').slice(0, 40);
    socket.to(matchId).emit('system', `${socket.data.name} joined the chat`);
  });

  socket.on('chat', ({ matchId, text }) => {
    if (!matchId || !text) return;
    io.to(matchId).emit('chat', {
      name: socket.data.name || 'Fan',
      text: String(text).slice(0, 500),
      ts: Date.now(),
    });
  });
});

const nms = new NodeMediaServer({
  logType: 1,
  rtmp: {
    port: RTMP_PORT,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: {
    port: 8000,
    mediaroot: MEDIA_ROOT,
    allow_origin: '*',
  },
  trans: {
    ffmpeg: ffmpegPath,
    tasks: [
      {
        app: 'live',
        hls: true,
        hlsFlags: '[hls_time=2:hls_list_size=6:hls_flags=delete_segments]',
      },
    ],
  },
});

nms.on('postPublish', (id, streamPath) => {
  const key = streamPath.split('/').pop();
  const match = findByStreamKey(key);
  if (match) {
    match.status = 'live';
    match.hlsUrl = `/media/live/${key}/index.m3u8`;
    io.emit('matches:updated');
    console.log(`[live] "${match.title}" is now live (${key})`);
  }
});

nms.on('donePublish', (id, streamPath) => {
  const key = streamPath.split('/').pop();
  const match = findByStreamKey(key);
  if (match) {
    match.status = 'ended';
    io.emit('matches:updated');
    console.log(`[ended] "${match.title}" stream ended (${key})`);
  }
});

nms.run();

server.listen(PORT, () => {
  console.log(`StreamLive web app:  http://localhost:${PORT}`);
  console.log(`RTMP ingest:         rtmp://localhost:${RTMP_PORT}/live/<streamKey>`);
});
