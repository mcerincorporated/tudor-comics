const COMIC_VINE = 'https://comicvine.gamespot.com/api';
const GITHUB_API = 'https://api.github.com';
const REPO = 'mcerincorporated/tudor-comics';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'GET' && path === '/search') {
        return await searchComics(url, env);
      }
      if (request.method === 'GET' && path === '/volume') {
        return await getVolume(url, env);
      }
      if (request.method === 'GET' && path === '/issues') {
        return await getIssues(url, env);
      }
      if (request.method === 'POST' && path === '/collection/add') {
        return await addComic(request, env);
      }
      if (request.method === 'POST' && path === '/collection/edit') {
        return await editComic(request, env);
      }
      if (request.method === 'POST' && path === '/collection/delete') {
        return await deleteComic(request, env);
      }
      if (request.method === 'POST' && path === '/series/track') {
        return await trackSeries(request, env);
      }
      if (request.method === 'POST' && path === '/series/untrack') {
        return await untrackSeries(request, env);
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};

async function searchComics(url, env) {
  const q = url.searchParams.get('q');
  if (!q) return json({ error: 'Missing q parameter' }, 400);

  const cvUrl = `${COMIC_VINE}/search/?api_key=${env.COMIC_VINE_KEY}&format=json&resources=issue&query=${encodeURIComponent(q)}&limit=15&field_list=id,name,issue_number,volume,image,store_date,cover_date`;
  const resp = await fetch(cvUrl, { headers: { 'User-Agent': 'TudorComics/1.0' } });
  const data = await resp.json();
  return json(data);
}

async function getVolume(url, env) {
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id parameter' }, 400);

  const cvUrl = `${COMIC_VINE}/volume/4050-${id}/?api_key=${env.COMIC_VINE_KEY}&format=json&field_list=id,name,publisher,start_year,image,count_of_issues`;
  const resp = await fetch(cvUrl, { headers: { 'User-Agent': 'TudorComics/1.0' } });
  const data = await resp.json();
  return json(data);
}

async function getIssues(url, env) {
  const volumeId = url.searchParams.get('volume');
  const filter = url.searchParams.get('filter') || '';
  if (!volumeId) return json({ error: 'Missing volume parameter' }, 400);

  let cvUrl = `${COMIC_VINE}/issues/?api_key=${env.COMIC_VINE_KEY}&format=json&filter=volume:${volumeId}${filter ? ',' + filter : ''}&sort=store_date:desc&limit=20&field_list=id,name,issue_number,volume,image,store_date,cover_date`;
  const resp = await fetch(cvUrl, { headers: { 'User-Agent': 'TudorComics/1.0' } });
  const data = await resp.json();
  return json(data);
}

async function addComic(request, env) {
  const comic = await request.json();
  return await updateJsonFile(env, 'comics.json', (comics) => {
    if (comics.find(c => c.id === comic.id)) {
      throw new Error('Comic already in collection');
    }
    comic.added_date = new Date().toISOString().split('T')[0];
    comics.push(comic);
    return comics;
  }, `add: ${comic.title || comic.id}`);
}

async function editComic(request, env) {
  const { id, ...updates } = await request.json();
  return await updateJsonFile(env, 'comics.json', (comics) => {
    const idx = comics.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Comic not found');
    Object.assign(comics[idx], updates);
    return comics;
  }, `edit: ${id}`);
}

async function deleteComic(request, env) {
  const { id } = await request.json();
  return await updateJsonFile(env, 'comics.json', (comics) => {
    const filtered = comics.filter(c => c.id !== id);
    if (filtered.length === comics.length) throw new Error('Comic not found');
    return filtered;
  }, `delete: ${id}`);
}

async function trackSeries(request, env) {
  const series = await request.json();
  return await updateJsonFile(env, 'tracked-series.json', (tracked) => {
    if (tracked.find(s => s.id === series.id)) {
      throw new Error('Series already tracked');
    }
    series.tracked_since = new Date().toISOString().split('T')[0];
    tracked.push(series);
    return tracked;
  }, `track: ${series.name || series.id}`);
}

async function untrackSeries(request, env) {
  const { id } = await request.json();
  return await updateJsonFile(env, 'tracked-series.json', (tracked) => {
    return tracked.filter(s => s.id !== id);
  }, `untrack: ${id}`);
}

async function updateJsonFile(env, file, mutator, commitMsg) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${file}`, {
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'User-Agent': 'TudorComics/1.0',
      }
    });
    const { content, sha } = await resp.json();
    const current = JSON.parse(atob(content));
    const updated = mutator([...current]);

    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(updated, null, 2) + '\n')));
    const putResp = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${file}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'User-Agent': 'TudorComics/1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: commitMsg, content: encoded, sha }),
    });

    if (putResp.ok) {
      return json({ ok: true });
    }

    const err = await putResp.json();
    if (putResp.status === 409 && attempt < 2) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    return json({ error: err.message || 'GitHub API error' }, putResp.status);
  }
  return json({ error: 'Failed after 3 retries' }, 500);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
