#!/usr/bin/env node
const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.COMIC_VINE_KEY || fs.readFileSync(path.join(process.env.HOME, '.config/comics/api_key'), 'utf8').trim();
const RECIPIENTS = ['cristian_marinescu@icloud.com']; // Add Tudor's email when available
const REPO_DIR = path.join(process.env.HOME, 'Documents/Kiro/tudor-comics');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'TudorComics/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

async function main() {
  const trackedPath = path.join(REPO_DIR, 'tracked-series.json');
  if (!fs.existsSync(trackedPath)) {
    console.log('No tracked-series.json found');
    return;
  }
  const tracked = JSON.parse(fs.readFileSync(trackedPath, 'utf8'));
  if (tracked.length === 0) {
    console.log('No tracked series');
    return;
  }

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() + 1);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  let releases = [];
  for (const series of tracked) {
    const id = series.id.replace('4050-', '');
    const url = `https://comicvine.gamespot.com/api/issues/?api_key=${API_KEY}&format=json&filter=volume:${id},store_date:${formatDate(startOfWeek)}|${formatDate(endOfWeek)}&sort=store_date:asc&field_list=id,name,issue_number,volume,image,store_date&limit=10`;
    try {
      const data = await fetchJSON(url);
      if (data.results) {
        releases.push(...data.results.map(r => ({
          title: `${series.name} #${r.issue_number}`,
          series: series.name,
          publisher: series.publisher,
          date: r.store_date || '',
          cover: r.image?.small_url || '',
          today: r.store_date === formatDate(now),
        })));
      }
    } catch (e) {
      console.error(`Failed to fetch ${series.name}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (releases.length === 0) {
    console.log('No releases this week');
    return;
  }

  releases.sort((a, b) => a.date.localeCompare(b.date));

  const todayReleases = releases.filter(r => r.today);
  const otherReleases = releases.filter(r => !r.today);

  let html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,sans-serif;background:#f8f9fa;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
<h1 style="font-size:1.3rem;margin-bottom:4px;">&#x1F4DA; Comics This Week</h1>
<p style="color:#666;font-size:0.85rem;margin-bottom:20px;">${formatDate(startOfWeek)} - ${formatDate(endOfWeek)}</p>`;

  if (todayReleases.length > 0) {
    html += `<h2 style="font-size:1rem;color:#e02424;margin-bottom:12px;">&#x1F525; Azi (${formatDate(now)})</h2>`;
    html += todayReleases.map(renderEmailCard).join('');
    html += '<hr style="border:none;border-top:1px solid #eee;margin:16px 0;">';
  }

  if (otherReleases.length > 0) {
    html += `<h2 style="font-size:1rem;color:#333;margin-bottom:12px;">Restul saptamanii</h2>`;
    html += otherReleases.map(renderEmailCard).join('');
  }

  html += `
<p style="color:#999;font-size:0.75rem;margin-top:20px;text-align:center;">
  ${releases.length} comics urmarite &bull; <a href="https://mcerincorporated.github.io/tudor-comics/releases.html">Vezi pe site</a>
</p>
</div></body></html>`;

  const tmpFile = '/tmp/comics-digest.html';
  fs.writeFileSync(tmpFile, html);

  const subject = `📚 Comics This Week — ${formatDate(now)}`;
  for (const recipient of RECIPIENTS) {
    const script = `
      set htmlContent to read (POSIX file "${tmpFile}") as «class utf8»
      tell application "Mail"
        set newMsg to make new outgoing message with properties {subject:"${subject}", content:htmlContent}
        set html content of newMsg to htmlContent
        make new to recipient at end of to recipients of newMsg with properties {address:"${recipient}"}
        send newMsg
      end tell`;
    try {
      execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);
      console.log(`Email sent to ${recipient}`);
    } catch (e) {
      console.error(`Failed to send to ${recipient}:`, e.message);
    }
  }
}

function renderEmailCard(r) {
  return `
<div style="display:flex;gap:12px;padding:10px;margin-bottom:8px;background:#f8f9fa;border-radius:8px;${r.today ? 'border-left:3px solid #e02424;' : ''}">
  ${r.cover ? `<img src="${r.cover}" style="width:45px;height:68px;object-fit:cover;border-radius:4px;">` : ''}
  <div>
    <div style="font-weight:600;font-size:0.9rem;">${r.title}</div>
    <div style="color:#666;font-size:0.8rem;">${r.publisher || ''} &bull; ${r.date}</div>
  </div>
</div>`;
}

main().catch(e => { console.error(e); process.exit(1); });
