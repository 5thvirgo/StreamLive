// Live scores / fixtures for major competitions via the Sofascore API on
// RapidAPI. Sign up + subscribe (free Basic tier) at
// https://rapidapi.com/apidojo/api/sofascore
// and set RAPIDAPI_KEY in the environment before starting the server.
//
// We only ever fetch schedule/score metadata here — no video, no broadcast
// rebroadcasting. "Watch legally" just points viewers at the official
// rights-holder for their region.

const API_HOST = 'sofascore.p.rapidapi.com';

// Sofascore's own unique-tournament IDs (confirmed via /tournaments/list).
const COMPETITIONS = {
  epl: { id: 17, name: 'Premier League' },
  laliga: { id: 8, name: 'La Liga' },
  ucl: { id: 7, name: 'UEFA Champions League' },
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const SEASON_CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

async function callApi(path) {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    const err = new Error('RAPIDAPI_KEY is not set');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const res = await fetch(`https://${API_HOST}${path}`, {
    headers: {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': API_HOST,
    },
  });

  if (!res.ok) {
    const err = new Error(`Upstream request failed with status ${res.status}`);
    err.code = 'UPSTREAM_ERROR';
    throw err;
  }

  return res.json();
}

function cached(key, ttl, loader) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  return loader().then((data) => {
    cache.set(key, { data, expiresAt: Date.now() + ttl });
    return data;
  });
}

async function getCurrentSeasonId(tournamentId) {
  const key = `season:${tournamentId}`;
  const data = await cached(key, SEASON_CACHE_TTL_MS, async () => {
    const json = await callApi(`/tournaments/get-seasons?tournamentId=${tournamentId}`);
    return json.seasons && json.seasons[0];
  });
  if (!data) {
    const err = new Error('No season data available');
    err.code = 'UPSTREAM_ERROR';
    throw err;
  }
  return data.id;
}

function teamLogo(team) {
  return `https://api.sofascore.com/api/v1/team/${team.id}/image`;
}

function normalizeEvent(e, competitionName) {
  const type = e.status && e.status.type;
  const status = type === 'finished' ? 'FT' : type === 'inprogress' ? 'LIVE' : 'NS';
  const showScore = status !== 'NS';
  return {
    id: e.id,
    date: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString() : null,
    status,
    elapsed: null,
    venue: e.venue && e.venue.name,
    home: { name: e.homeTeam.name, logo: teamLogo(e.homeTeam), winner: null },
    away: { name: e.awayTeam.name, logo: teamLogo(e.awayTeam), winner: null },
    score: {
      home: showScore ? (e.homeScore && e.homeScore.current) : null,
      away: showScore ? (e.awayScore && e.awayScore.current) : null,
    },
    competition: competitionName,
  };
}

async function fetchFixtures(competitionKey, type) {
  const comp = COMPETITIONS[competitionKey];
  if (!comp) {
    const err = new Error(`Unknown competition "${competitionKey}"`);
    err.code = 'UNKNOWN_COMPETITION';
    throw err;
  }

  const seasonId = await getCurrentSeasonId(comp.id);
  const cacheKey = `${competitionKey}:${type}`;

  return cached(cacheKey, CACHE_TTL_MS, async () => {
    // Sofascore's "next" list only holds not-yet-started matches — once a
    // match kicks off it moves to "last" instead, so an in-progress match
    // falls into neither list on its own. Always pull "last" too and merge
    // in anything still live, regardless of which tab is being requested.
    const [nextJson, lastJson] = await Promise.all([
      callApi(`/tournaments/get-next-matches?tournamentId=${comp.id}&seasonId=${seasonId}&pageIndex=0`),
      callApi(`/tournaments/get-last-matches?tournamentId=${comp.id}&seasonId=${seasonId}&pageIndex=0`),
    ]);
    const nextEvents = (nextJson.events || []).map((e) => normalizeEvent(e, comp.name));
    const lastEvents = (lastJson.events || []).map((e) => normalizeEvent(e, comp.name));
    const liveEvents = lastEvents.filter((f) => f.status === 'LIVE');

    const events = type === 'last' ? lastEvents.filter((f) => f.status === 'FT') : [...liveEvents, ...nextEvents];
    const sorted = type === 'last'
      ? events.sort((a, b) => new Date(b.date) - new Date(a.date))
      : events.sort((a, b) => {
          if (a.status === 'LIVE' && b.status !== 'LIVE') return -1;
          if (b.status === 'LIVE' && a.status !== 'LIVE') return 1;
          return new Date(a.date) - new Date(b.date);
        });
    return sorted.slice(0, 10);
  });
}

// Curated starting point only — broadcast rights change by season and
// region, so treat this as illustrative and keep it updated, not as a
// guaranteed-accurate source.
const WATCH_LEGALLY = {
  epl: {
    officialUrl: 'https://www.premierleague.com/',
    regions: [
      { region: 'United States', broadcasters: ['Peacock', 'USA Network', 'NBC (select matches)'] },
      { region: 'United Kingdom', broadcasters: ['Sky Sports', 'TNT Sports'] },
    ],
  },
  laliga: {
    officialUrl: 'https://www.laliga.com/en-GB',
    regions: [
      { region: 'United States', broadcasters: ['ESPN', 'ESPN+'] },
      { region: 'United Kingdom', broadcasters: ['Premier Sports', 'LaLigaTV'] },
    ],
  },
  ucl: {
    officialUrl: 'https://www.uefa.com/uefachampionsleague/',
    regions: [
      { region: 'United States', broadcasters: ['Paramount+', 'CBS Sports Network'] },
      { region: 'United Kingdom', broadcasters: ['TNT Sports'] },
    ],
  },
};

module.exports = { COMPETITIONS, fetchFixtures, WATCH_LEGALLY };
