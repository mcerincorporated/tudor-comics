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
      if (request.method === 'GET' && path === '/issue') {
        return await getIssueDetails(url, env);
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
      if (request.method === 'POST' && path === '/scan') {
        return await scanCover(request, env);
      }
      if (request.method === 'POST' && path === '/chores/save') {
        return await saveChoresData(request, env);
      }
      if (request.method === 'POST' && path.startsWith('/chores/')) {
        return await choresAction(request, env, path.split('/').pop());
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

async function getIssueDetails(url, env) {
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id parameter' }, 400);

  const cvUrl = `${COMIC_VINE}/issue/4000-${id}/?api_key=${env.COMIC_VINE_KEY}&format=json&field_list=id,name,issue_number,volume,image,store_date,cover_date,description,person_credits,cover_price`;
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

async function scanCover(request, env) {
  const formData = await request.formData();
  const file = formData.get('photo');
  if (!file) return json({ error: 'No photo uploaded' }, 400);

  const arrayBuffer = await file.arrayBuffer();

  const aiResp = await env.AI.run('@cf/unum/uform-gen2-qwen-500m', {
    prompt: 'Describe this comic book cover. What is the title, series name, issue number, and publisher?',
    image: Array.from(new Uint8Array(arrayBuffer)),
  });

  const text = aiResp.response || aiResp.description || aiResp.result || JSON.stringify(aiResp);

  let parsed = { series: '', issue_number: '', publisher: '' };
  try {
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {}

  if (!parsed.series) {
    parsed.description = text;
    const words = text.replace(/[^a-zA-Z0-9\s#-]/g, '').trim();
    parsed.series = words.split(/\s+/).slice(0, 4).join(' ');
  }

  const q = parsed.series + (parsed.issue_number ? ' ' + parsed.issue_number : '');
  const cvUrl = `${COMIC_VINE}/search/?api_key=${env.COMIC_VINE_KEY}&format=json&resources=issue&query=${encodeURIComponent(q)}&limit=10&field_list=id,name,issue_number,volume,image,store_date,cover_date`;
  const cvResp = await fetch(cvUrl, { headers: { 'User-Agent': 'TudorComics/1.0' } });
  const cvData = await cvResp.json();

  return json({
    detected: parsed,
    results: cvData.results || [],
    raw_description: text,
  });
}

const CHORES_REPO = 'mcerincorporated/chores';

async function saveChoresData(request, env) {
  const newData = await request.json();
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(newData, null, 2) + '\n')));

  const getResp = await fetch(`${GITHUB_API}/repos/${CHORES_REPO}/contents/data.json`, {
    headers: { 'Authorization': `token ${env.GITHUB_TOKEN}`, 'User-Agent': 'Chores/1.0' }
  });
  const { sha } = await getResp.json();

  const putResp = await fetch(`${GITHUB_API}/repos/${CHORES_REPO}/contents/data.json`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${env.GITHUB_TOKEN}`, 'User-Agent': 'Chores/1.0', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'chores: update data', content: encoded, sha }),
  });
  return putResp.ok ? json({ ok: true }) : json({ error: 'Failed to save' }, 500);
}

async function choresAction(request, env, action) {
  const payload = await request.json();
  const getResp = await fetch(`${GITHUB_API}/repos/${CHORES_REPO}/contents/data.json`, {
    headers: { 'Authorization': `token ${env.GITHUB_TOKEN}`, 'User-Agent': 'Chores/1.0' }
  });
  const { content, sha } = await getResp.json();
  const data = JSON.parse(atob(content));

  if (action === 'assign') {
    data.completions.push(payload);
  } else if (action === 'complete') {
    const comp = data.completions.find(c => c.id === payload.id);
    if (comp) comp.status = payload.status;
  } else if (action === 'approve') {
    const comp = data.completions.find(c => c.id === payload.id);
    if (comp) comp.status = 'approved';
  } else if (action === 'reject') {
    const comp = data.completions.find(c => c.id === payload.id);
    if (comp) comp.status = 'rejected';
  }

  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2) + '\n')));
  const putResp = await fetch(`${GITHUB_API}/repos/${CHORES_REPO}/contents/data.json`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${env.GITHUB_TOKEN}`, 'User-Agent': 'Chores/1.0', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `chores: ${action}`, content: encoded, sha }),
  });
  return putResp.ok ? json({ ok: true }) : json({ error: 'Failed' }, 500);
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
