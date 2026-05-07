const fs = require('fs');

// 🌐 数据源列表（可自由增删）
const SOURCES = [
  'https://raw.githubusercontent.com/YueChan/Live/main/APTV.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u',
  'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u',
  'https://raw.githubusercontent.com/zhumeng11/IPTV/main/IPTV.m3u',
  'https://raw.githubusercontent.com/kimwang1978/collect-tv-txt/main/merged_output.txt'
];

// 📥 抓取源内容
async function fetchSource(url) {
  try {
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(10000), 
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
    });
    if (!res.ok) return [];
    return await res.text();
  } catch { return []; }
}

// 🛠 混合解析（M3U/TXT）
function parseContent(text) {
  const lines = text.split('\n');
  const channels = [];
  let curName = '', curUrl = '', curLogo = '';
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('#EXTINF:')) {
      const nameMatch = line.match(/,(.+)$/);
      const logoMatch = line.match(/tvg-logo="([^"]*)"/);
      curName = nameMatch ? nameMatch[1].trim() : '未知频道';
      curLogo = logoMatch ? logoMatch[1] : '';
    } else if (!line.startsWith('#') && line.match(/^https?:\/\//)) {
      curUrl = line;
      if (curName && curUrl) {
        channels.push({ name: curName, url: curUrl, logo: curLogo });
        curName = ''; curUrl = ''; curLogo = '';
      }
    } else if (line.includes(',')) {
      const [name, url] = line.split(',').map(s => s.trim());
      if (name && url && url.match(/^https?:\/\//)) {
        channels.push({ name, url, logo: '' });
      }
    }
  }
  return channels;
}

// 🔍 流媒体测活（HEAD + GET 降级）
async function testStream(url) {
  try {
    const headRes = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000), redirect: 'follow' });
    if (headRes.ok || [301,302,307,308].includes(headRes.status)) return true;
    const getRes = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000), redirect: 'follow' });
    return getRes.ok || [301,302,307,308].includes(getRes.status);
  } catch { return false; }
}

// 🗂 智能分组
function getGroup(name) {
  const n = name.toLowerCase();
  if (/cctv|央视/.test(n)) return '央视';
  if (/卫视/.test(n)) return '地方卫视';
  if (/凤凰|tvb|明珠|翡翠|澳亚|澳门|港台|港澳|hk|mo|tw|viu|now|星河/.test(n)) return '港澳台';
  if (/体育|sport|cba|nba|足球|篮球|cctv-5|cctv-5\+|咪咕体育|migu sport|赛事/.test(n)) return '体育';
  if (/电影|影视|cinema|movie|cctv-6|咪咕视频|migu video/.test(n)) return '影视';
  if (/纪录|documentary|探索|discovery|cctv-9/.test(n)) return '纪录';
  if (/少儿|动画|cartoon|kids|cctv-14/.test(n)) return '少儿';
  return '地方台';
}

// 🚀 主流程
async function main() {
  console.log('📡 Fetching sources...');
  const rawTexts = await Promise.all(SOURCES.map(fetchSource));
  let allChannels = rawTexts.flatMap(parseContent);
  console.log(`📊 Raw: ${allChannels.length}`);

  // 去重
  const dedupMap = new Map();
  for (const ch of allChannels) {
    const key = ch.name.replace(/[\s\-_\.()（）高清超清HD4K]/g, '').toLowerCase();
    if (!dedupMap.has(key)) dedupMap.set(key, ch);
  }
  const unique = Array.from(dedupMap.values());
  console.log(`✅ Deduped: ${unique.length}`);

  // 分批测活（避免 GitHub Runner 网络限流）
  console.log('🔍 Testing availability...');
  const batchSize = 60;
  const valid = [];
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async ch => (await testStream(ch.url)) ? ch : null));
    valid.push(...results.filter(Boolean));
    console.log(`   ${Math.min(i + batchSize, unique.length)}/${unique.length}`);
  }
  console.log(`🟢 Valid: ${valid.length}`);

  // 分组排序
  const grouped = {};
  for (const ch of valid) {
    const g = getGroup(ch.name);
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(ch);
  }
  const order = ['央视','地方卫视','港澳台','体育','影视','纪录','少儿','地方台','其他'];
  const sorted = order.filter(g => grouped[g]);
  Object.keys(grouped).forEach(g => { if (!sorted.includes(g)) sorted.push(g); });

  // 生成 TXT
  let txt = '';
  for (const g of sorted) {
    txt += `${g},#genre#\n${grouped[g].map(ch => `${ch.name},${ch.url}`).join('\n')}\n`;
  }
  fs.writeFileSync('live.txt', txt.trim());

  // 生成 M3U
  let m3u = '#EXTM3U url-tvg="http://epg.51zmt.top:8000/api/diyp/"\n';
  for (const g of sorted) {
    for (const ch of grouped[g]) {
      m3u += `#EXTINF:-1 group-title="${g}" tvg-name="${ch.name}" tvg-logo="${ch.logo||''}",${ch.name}\n${ch.url}\n`;
    }
  }
  fs.writeFileSync('live.m3u', m3u.trim());
  console.log('📦 Saved live.txt & live.m3u');
}

main().catch(e => { console.error(e); process.exit(1); });
