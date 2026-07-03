// ── API Config ────────────────────────────────────────────────────────────────
const YT_KEY = 'AIzaSyBFYOKI2mTe7sE9su9FhoWl2ItHuIDz_qg';

// ── State ─────────────────────────────────────────────────────────────────────
let songs = [];
let currentSong = JSON.parse(localStorage.getItem('redify-currentsong') || 'null');
let liked=new Set(JSON.parse(localStorage.getItem('redify-liked')||'[]')), currentFilter='all', shuffleOn=false, repeatOn=false, isPlaying=false;
let volume=75, muted=false, activeGenre=null, searchQuery='';
let playlists = JSON.parse(localStorage.getItem('redify-playlists') || '{}');
// restore Sets (JSON doesn't save Sets)
let currentPlaylistView=null;
let ytPlayer=null, ytReady=false, progressInterval=null, searchDebounce=null;
let vizInterval = null;
let currentView='discover';
let originalSongs = [];
let favOrder = JSON.parse(localStorage.getItem('redify-favorder')||'[]');
// ── FIXED: cache for YT search results ───────────────────────────────────────
const _cache = {};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(s){ const m=Math.floor(s/60),x=Math.floor(s%60); return m+':'+(x<10?'0':'')+x; }
function fmtSec(s){ s=Math.floor(+s||0); return Math.floor(s/60)+':'+(s%60<10?'0':'')+(s%60); }
function parseISO8601(d){
  const m=d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if(!m) return '?:??';
  return fmtSec((+m[1]||0)*3600+(+m[2]||0)*60+(+m[3]||0));
}
function showToast(m){ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }
function updatePlayBtn(){
  document.getElementById('playIcon').className = isPlaying ? 'ti ti-player-pause' : 'ti ti-player-play';
  const art=document.getElementById('playerArt');
  isPlaying ? art.classList.add('spinning') : art.classList.remove('spinning');
}
function showLoading(msg){
  let el=document.getElementById('songList');
  if(!el){
    document.getElementById('songContent').innerHTML=
      '<div><div class="section-header"><div class="section-title">🔍 Results</div></div><div class="song-list" id="songList"></div></div>';
    el=document.getElementById('songList');
  }
  if(el) el.innerHTML=`<div class="empty-state"><i class="ti ti-loader"></i> ${msg}</div>`;
}

// ── Visualizer ────────────────────────────────────────────────────────────────
function buildViz(){ const v=document.getElementById('visualizer'); v.innerHTML=''; for(let i=0;i<12;i++){ const b=document.createElement('div'); b.className='viz-bar'; b.style.height='4px'; v.appendChild(b); } }
function animateViz(){ document.querySelectorAll('.viz-bar').forEach(b=>{ b.style.height=(isPlaying?Math.floor(Math.random()*20)+4:4)+'px'; }); }

// ── YouTube IFrame API setup ──────────────────────────────────────────────────
(function(){
  const s=document.createElement('script');
  s.src='https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
})();

const _ytDiv=document.createElement('div');
_ytDiv.id='yt-player';
_ytDiv.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px';
document.body.appendChild(_ytDiv);

function onYouTubeIframeAPIReady(){
  ytPlayer=new YT.Player('yt-player',{
    height:'1', width:'1',
    playerVars:{ autoplay:0, controls:0, rel:0,},
    events:{
      onReady: ()=>{ ytReady=true; ytPlayer.setVolume(volume); },
      onStateChange: onYTStateChange,
      onError: ()=>{ showToast('⚠️ Skipping unplayable song…'); isPlaying=false; updatePlayBtn(); setTimeout(()=>nextSong(), 1000); }
    }
  });
}

function onYTStateChange(e){
  if(e.data===YT.PlayerState.PLAYING){
    isPlaying=true; updatePlayBtn();
    if(!progressInterval) progressInterval=setInterval(updateProgress,500);
  } else if(e.data===YT.PlayerState.PAUSED){
    isPlaying=false; updatePlayBtn();
  } else if(e.data===YT.PlayerState.ENDED){
    clearInterval(progressInterval); progressInterval=null;
    isPlaying=false; updatePlayBtn();
    if(repeatOn){ ytPlayer.seekTo(0); ytPlayer.playVideo(); }
    else nextSong();
  }
}

function updateProgress(){
  if(!ytPlayer||!ytReady) return;
  try {
    const cur=ytPlayer.getCurrentTime()||0, dur=ytPlayer.getDuration()||0;
    if(!dur) return;
    document.getElementById('progFill').style.width=(cur/dur*100)+'%';
    document.getElementById('progCur').textContent=fmt(cur);
    document.getElementById('progEnd').textContent=fmt(dur);
  } catch(e){}
}

// ── YouTube Data API v3 ───────────────────────────────────────────────────────
async function ytSearch(query, maxResults=20){
  const lsKey = 'redify-yt-'+query;
  const lsCached = localStorage.getItem(lsKey);
  if(lsCached) return JSON.parse(lsCached);
  if(_cache[query]) return _cache[query];
  try {
    const sr=await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}`+
      `&type=video&videoCategoryId=10&videoEmbeddable=true&videoSyndicated=true&maxResults=${maxResults}&key=${YT_KEY}`
    );
    const sd=await sr.json();
    if(sd.error) throw new Error(sd.error.message);
    const items=(sd.items||[]).filter(i=>i.id?.videoId);
    if(!items.length) return [];

    const ids=items.map(i=>i.id.videoId).join(',');
    const vr=await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics,status&id=${ids}&key=${YT_KEY}`
    );
    const vd=await vr.json();
    
    const durMap={}, viewMap={};
    const playableSet = new Set();
    (vd.items||[]).forEach(v=>{
      durMap[v.id]=parseISO8601(v.contentDetails.duration);
      viewMap[v.id]=parseInt(v.statistics?.viewCount||'0',10);
      if(v.status?.embeddable && v.status?.privacyStatus==='public') playableSet.add(v.id);
    });
    const playableItems = items.filter(i=>playableSet.has(i.id.videoId));
    const mapped=playableItems.map((item,i)=>({
      id: i+1,
      title: item.snippet.title.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"'),
      artist: item.snippet.channelTitle,
      genre: 'Music',
      dur: durMap[item.id.videoId]||'?:??',
      views: viewMap[item.id.videoId]||0,
      emoji: '🎵',
      source: 'youtube',
      badge: 'badge-j',
      label: 'YouTube',
      videoId: item.id.videoId,
      url: item.id.videoId,
      thumb: item.snippet.thumbnails.medium?.url||item.snippet.thumbnails.default?.url,
    }));

    mapped.sort((a,b)=>b.views-a.views);
    mapped.forEach((s,i)=>s.id=i+1);
    localStorage.setItem('redify-yt-'+query, JSON.stringify(mapped));
    _cache[query] = mapped;   // ← cache result
    return mapped;
  } catch(e){ console.warn('YT search error:',e); return []; }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function initSongs(){
  showLoading('Loading trending songs… 🎵');
  const CACHE_KEY = 'redify-trending';
  const cached = localStorage.getItem(CACHE_KEY);
  if(cached && JSON.parse(cached).length){ songs=JSON.parse(cached); originalSongs=[...songs]; renderSongs(getFiltered()); showToast('✅ Loaded from cache'); return; }
  const results=await ytSearch('top music hits 2025',20);
  localStorage.setItem(CACHE_KEY, JSON.stringify(results));
  songs=results;
  originalSongs = [...songs];
  if(!songs.length){ showLoading('⚠️ Could not load — check API key or quota'); return; }
  renderSongs(getFiltered());
  if(currentSong){
  const stored = currentSong;
  // restore song into list if not present
  if(!songs.find(s=>s.videoId===stored.videoId)) songs.unshift(stored);
    currentSong = songs.find(s=>s.videoId===stored.videoId);
    document.getElementById('playerTitle').textContent = currentSong.title;
    document.getElementById('playerArtist').textContent = currentSong.artist;
    const artEl = document.getElementById('playerArt');
    if(currentSong.thumb){ 
      artEl.style.cssText='background-image:url('+currentSong.thumb+');background-size:cover;background-position:center'; 
      artEl.textContent='';
      if(ytReady&&ytPlayer) ytPlayer.loadVideoById(currentSong.videoId);
      else setTimeout(()=>ytPlayer?.loadVideoById(currentSong.videoId), 1000); }
      document.getElementById('progEnd').textContent = currentSong.dur;
  }
  showToast(`✅ Loaded ${songs.length} songs`);
}

// ── Live search ───────────────────────────────────────────────────────────────
async function liveSearch(query){
  if(!query){ await initSongs(); return; }
  showLoading(`Searching "${query}"… 🔍`);
  const results=await ytSearch(query+' music',20);
  songs=results;
  if(!songs.length){
    const el=document.getElementById('songList');
    if(el) el.innerHTML=`<div class="empty-state"><i class="ti ti-music-off"></i>No results for "${query}"</div>`;
    return;
  }
  document.getElementById('songContent').innerHTML =
    '<div><div class="section-header"><div class="section-title">🔍 Search Results</div></div><div class="song-list" id="songList"></div></div>';
  renderSongs(songs);
  showToast(`🔍 Found ${songs.length} songs`);
}

// ── Filter ────────────────────────────────────────────────────────────────────
function getFiltered(){
  let l=currentFilter==='all'?[...songs]:songs.filter(s=>s.source===currentFilter);
  if(activeGenre) l=l.filter(s=>s.genre===activeGenre);
  return l.length ? l : songs;
}

function fmtViews(n){
  if(n>=1e9) return (n/1e9).toFixed(1)+'B';
  if(n>=1e6) return (n/1e6).toFixed(1)+'M';
  if(n>=1e3) return (n/1e3).toFixed(0)+'K';
  return n>0?String(n):'';
}

function renderSongs(list, targetId='songList'){
  const el=document.getElementById(targetId);
  if(!el) return;
  if(!list.length){ el.innerHTML='<div class="empty-state"><i class="ti ti-music-off"></i>No songs found</div>'; return; }
  el.innerHTML=list.map((s,i)=>`
    <div class="song-row ${currentSong&&isPlaying&&currentSong.videoId===s.videoId?'playing':''}" onclick="playSong('${s.id}','${s.videoId}')">
      <div class="song-num">${currentSong&&currentSong.videoId===s.videoId?'<i class="ti ti-volume" style="font-size:13px;color:#7F77DD"></i>':(i+1)}</div>
      <div class="song-art" style="background:#111;overflow:hidden;padding:0">
        ${s.thumb?`<img src="${s.thumb}" style="width:100%;height:100%;object-fit:cover">`:s.emoji}
      </div>
      <div class="song-info"><div class="song-title">${s.title}</div><div class="song-artist">${s.artist}${s.views?` · <span style="color:var(--t3)">${fmtViews(s.views)} views</span>`:''}</div></div>
      <span class="badge ${s.badge}">${s.label}</span>
      <span class="song-dur">${s.dur}</span>
      <div class="song-actions">
        <button class="icon-btn" title="Add to playlist" onclick="event.stopPropagation();openAddToPlaylist('${s.videoId}')">
          <i class="ti ti-playlist-add"></i>
        </button>
        <button class="icon-btn" onclick="event.stopPropagation();window.open('https://youtube.com/watch?v=${s.videoId}','_blank')">
          <i class="ti ti-brand-youtube"></i>
        </button>
      </div>
    </div>`).join('');
}

// ── Playback ──────────────────────────────────────────────────────────────────
function playSong(id, videoId){
  const vid = videoId || id;
  let song = songs.find(s=>s.videoId===vid)
    || Object.values(playlists).flat().find(s=>s&&s.videoId===vid)
    || likedSongs[vid];
  if(!song) return;
  if(!ytReady||!ytPlayer){ setTimeout(()=>playSong(id),600); return; }
  currentSong=song; 
  let recent = JSON.parse(localStorage.getItem('redify-recent')||'[]');
  recent = [song, ...recent.filter(s=>s.videoId!==song.videoId)].slice(0,10);
  localStorage.setItem('redify-recent', JSON.stringify(recent));
  document.querySelector('.player').classList.remove('no-song');
  document.getElementById('playerTitle').textContent=song.title;
  document.getElementById('playerArtist').textContent=song.artist;
  const artEl=document.getElementById('playerArt');
  if(song.thumb){
    artEl.style.cssText='background-image:url('+song.thumb+');background-size:cover;background-position:center';
    artEl.textContent='';
  } else {
    artEl.style.cssText=''; artEl.textContent=song.emoji;
  }
  document.getElementById('progFill').style.width='0%';
  document.getElementById('progCur').textContent='0:00';
  document.getElementById('progEnd').textContent=song.dur;
  ytPlayer.loadVideoById(song.videoId);
  isPlaying=true; updatePlayBtn();
  if(currentView==='favorites') renderSongs(Object.values(likedSongs));
  else if(currentView==='playlist' && currentPlaylistView) renderSongs(playlists[currentPlaylistView]||[]);
  else renderSongs(getFiltered());
  localStorage.setItem('redify-currentsong', JSON.stringify(song));
  const phi = document.getElementById('playerHeartIcon');
  if(phi) phi.className = liked.has(song.videoId) ? 'ti ti-heart-filled' : 'ti ti-heart';
  document.getElementById('playerLikeBtn')?.classList.toggle('liked', liked.has(song.videoId));
}

function togglePlay(){
  if(!currentSong||!ytReady||!ytPlayer) return;
  if(isPlaying) ytPlayer.pauseVideo();
  else ytPlayer.playVideo();
}

function nextSong(){
  const list = (currentView==='playlist' && currentPlaylistView) ? (playlists[currentPlaylistView]||[]) : getFiltered(); if(!list.length) return;
  if(shuffleOn){ playSong(null, list[Math.floor(Math.random()*list.length)].videoId); return; }
  if(!currentSong){ playSong(null, list[0].videoId); return; }
  const idx=list.findIndex(s=>s.videoId===currentSong.videoId);
  playSong(null, list[(idx+1)%list.length].videoId);
}

function prevSong(){
  const list = (currentView==='playlist' && currentPlaylistView) ? (playlists[currentPlaylistView]||[]) : getFiltered(); if(!list.length||!currentSong) return;
  if(ytReady&&ytPlayer&&typeof ytPlayer.getCurrentTime==='function'&&ytPlayer.getCurrentTime()>3){ ytPlayer.seekTo(0,true); return; }
  const idx=list.findIndex(s=>s.videoId===currentSong.videoId);
  playSong(null, list[(idx-1+list.length)%list.length].videoId);
}

function seekSong(e){
  if(!currentSong||!ytReady||!ytPlayer) return;
  const rect=e.currentTarget.getBoundingClientRect();
  const pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
  const dur=ytPlayer.getDuration()||0;
  if(dur) ytPlayer.seekTo(pct*dur,true);
}

function toggleShuffle(){ shuffleOn=!shuffleOn; document.getElementById('shuffleBtn').classList.toggle('active',shuffleOn); showToast(shuffleOn?'Shuffle on 🔀':'Shuffle off'); }
function toggleRepeat(){ repeatOn=!repeatOn; document.getElementById('repeatBtn').classList.toggle('active',repeatOn); showToast(repeatOn?'Repeat on 🔁':'Repeat off'); }

let volDragging=false;
function setVolume(e){
  const track=document.querySelector('.vol-track');
  const rect=track.getBoundingClientRect();
  const pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
  volume=Math.round(pct*100);
  muted=false;
  if(ytReady&&ytPlayer) ytPlayer.setVolume(volume);
  updateVol();
}
document.querySelector('.vol-track').addEventListener('mousedown', e=>{
  volDragging=true;
  document.querySelector('.vol-track').classList.add('active');
  setVolume(e);
});
document.addEventListener('mousemove', e=>{ if(volDragging) setVolume(e); });
document.addEventListener('mouseup', ()=>{
  volDragging=false;
  document.querySelector('.vol-track').classList.remove('active');
});

function toggleMute(){ muted=!muted; if(ytReady&&ytPlayer) ytPlayer.setVolume(muted?0:volume); updateVol(); }
function updateVol(){
  document.getElementById('volFill').style.width=(muted?0:volume)+'%';
  const ic=document.getElementById('volIcon');
  ic.className='ti '+(muted||volume===0?'ti-volume-off':volume<50?'ti-volume-2':'ti-volume');
}

function downloadCurrent(){
  if(!currentSong){ showToast('Select a song first'); return; }
  window.open('https://youtube.com/watch?v='+currentSong.videoId,'_blank');
  showToast('Opening on YouTube 📺');
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navTo(view,el){
  if(songs!==originalSongs) songs=[...originalSongs];
  document.getElementById('searchInput').value=''; searchQuery='';  
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  el.classList.add('active'); activeGenre=null;
  const content=document.getElementById('songContent');
  if(view==='discover'){
    currentView='discover';
    const recent = JSON.parse(localStorage.getItem('redify-recent')||'[]');
    if(!favOrder.length) favOrder=Object.keys(likedSongs);
    const favs=favOrder.map(id=>likedSongs[id]).filter(Boolean);
    content.innerHTML = `
      ${recent.length?`<div><div class="section-header"><div class="section-title">🕓 Recently Played</div></div><div class="song-list carousel" id="songList-recent"></div></div>`:''}
      ${favs.length?`<div><div class="section-header"><div class="section-title">❤️ Your Favorites</div></div><div class="song-list carousel" id="songList-fav"></div></div>`:''}
      <div><div class="section-header"><div class="section-title">🔥 Trending Now</div></div><div class="song-list carousel" id="songList"></div></div>`;
    if(recent.length) renderSongs(recent, 'songList-recent');
    if(favs.length) renderSongs(favs, 'songList-fav');
    renderSongs(getFiltered());
  } else if(view==='trending'){
    currentView='trending';
    content.innerHTML='<div><div class="section-header"><div class="section-title">📈 Trending This Week</div></div><div class="song-list" id="songList"></div></div>';
    renderSongs([...songs].sort(()=>Math.random()-.5).slice(0,8));
  } else if(view==='genres'){
    currentView='genres';
    const genres=[...new Set(songs.map(s=>s.genre))];
    content.innerHTML=`<div><div class="section-header"><div class="section-title">🎼 Browse by Genre</div></div><div class="genre-chips">${genres.map(g=>'<button class="genre-chip" onclick="filterGenre(\''+g+'\',this)">'+g+'</button>').join('')}</div></div><div><div class="section-header"><div class="section-title" id="genreTitle">All Songs</div></div><div class="song-list" id="songList"></div></div>`;
    renderSongs(songs);
  } else if(view==='favorites'){
    currentView='favorites';
    content.innerHTML='<div><div class="section-header"><div class="section-title">❤️ Your Favorites</div></div><div class="song-list" id="songList"></div></div>';
    const favs=Object.values(likedSongs);
    if(favs.length) renderSongs(favs);
    else document.getElementById('songList').innerHTML='<div class="empty-state"><i class="ti ti-heart"></i>No favorites yet!</div>';
    document.querySelectorAll('#songList .song-row').forEach((row,i)=>{
      row.draggable=true;
      row.ondragstart=()=>dragStart(i);
      row.ondragover=e=>e.preventDefault();
      row.ondrop=()=>dropFav(i);
    });
  }
}
function toggleLikeCurrentSong(){
  if(!currentSong) return;
  toggleLike(currentSong.videoId);
  const isLiked = liked.has(currentSong.videoId);
  document.getElementById('playerHeartIcon').className = isLiked ? 'ti ti-heart-filled' : 'ti ti-heart';
  document.getElementById('playerLikeBtn')?.classList.toggle('liked', isLiked);
}
function filterGenre(genre,btn){
  activeGenre=activeGenre===genre?null:genre;
  document.querySelectorAll('.genre-chip').forEach(c=>c.classList.remove('active'));
  if(activeGenre){ btn.classList.add('active'); document.getElementById('genreTitle').textContent=genre; }
  else document.getElementById('genreTitle').textContent='All Songs';
  renderSongs(getFiltered());
}

function filterSource(src,btn){
  currentFilter=src;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  renderSongs(getFiltered());
}

function closePlModal(){
  const m=document.getElementById('plModal');
  m.style.display='none';
}

function createPlaylistPrompt(){
  const m=document.getElementById('plModal');
  document.getElementById('plModalContent').innerHTML=`
    <div style="font-size:15px;font-weight:600;margin-bottom:14px">New Playlist</div>
    <input id="plNameInput" placeholder="Playlist name..."
      style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid #333;background:#111;color:var(--bg2);font-size:13px;box-sizing:border-box"
      onkeydown="if(event.key==='Enter')confirmCreatePlaylist()"/>
    <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
      <button onclick="closePlModal()" style="padding:7px 16px;border-radius:8px;border:1px solid #444;background:transparent;color:#aaa;cursor:pointer">Cancel</button>
      <button onclick="confirmCreatePlaylist()" style="padding:7px 16px;border-radius:8px;border:none;background:#7F77DD;color:#fff;cursor:pointer;font-weight:600">Create</button>
    </div>`;
  m.style.display='flex';
  setTimeout(()=>document.getElementById('plNameInput')?.focus(),50);
}

function confirmCreatePlaylist(){
  const name=document.getElementById('plNameInput')?.value.trim();
  if(!name){ showToast('Enter a name!'); return; }
  if(playlists[name]){ showToast('Playlist already exists!'); return; }
  playlists[name]=[];
  savePlaylists();
  renderPlaylists();
  closePlModal();
  showToast(`✅ Playlist "${name}" created!`);
}

function openAddToPlaylist(songId){
  const names=Object.keys(playlists);
  const m=document.getElementById('plModal');
  document.getElementById('plModalContent').innerHTML=`
    <div style="font-size:15px;font-weight:600;margin-bottom:14px">Add to Playlist</div>
    <div onclick="toggleLike('${songId}');closePlModal();"
      style="padding:10px 12px;border-radius:8px;cursor:pointer;margin-bottom:6px;background:var(--bg2);display:flex;align-items:center;gap:10px;font-size:13px">
      <i class="ti ti-heart" style="color:#e0353f"></i> Add to Favorites
    </div>
    ${names.length ? names.map(name=>`
      <div onclick="addToPlaylist('${name}','${songId}')"
        style="padding:10px 12px;border-radius:8px;cursor:pointer;margin-bottom:6px;background:var(--bg2);display:flex;align-items:center;gap:10px;font-size:13px"
        onmouseover="this.style.background='var(--accent)'" onmouseout="this.style.background='var(--accent-d)'">
        <i class="ti ti-playlist" style="color:#7F77DD"></i> ${name}
        <span style="margin-left:auto;color:var(--t3);font-size:11px">${playlists[name].length} songs</span>
      </div>`).join('')
    : '<div style="color:var(--t3);font-size:13px;margin-bottom:12px">No playlists yet — create one first!</div>'}
    <div style="display:flex;gap:8px;margin-top:10px;justify-content:space-between">
      <button onclick="closePlModal();createPlaylistPrompt()" style="padding:7px 14px;border-radius:8px;border:1px solid #7F77DD;background:transparent;color:#7F77DD;cursor:pointer;font-size:12px"><i class="ti ti-plus"></i> New</button>
      <button onclick="closePlModal()" style="padding:7px 16px;border-radius:8px;border:1px solid #444;background:transparent;color:#aaa;cursor:pointer">Cancel</button>
    </div>`;
  m.style.display='flex';
}

function addToPlaylist(name, videoId){
  if(!playlists[name]) return;
  if(playlists[name].find(s=>s.videoId===videoId)){ showToast('Already in playlist!'); closePlModal(); return; }
  const allCached = Object.values(_cache).flat();
  const allPlSongs = Object.values(playlists).flat();
  const song = songs.find(s=>s.videoId===videoId)
    || allCached.find(s=>s&&s.videoId===videoId)
    || allPlSongs.find(s=>s&&s.videoId===videoId)
    || likedSongs[videoId]
    || (currentSong?.videoId===videoId ? {...currentSong} : null);
  if(!song){ showToast('Song not found!'); closePlModal(); return; }
  playlists[name].push({...song, id:`pl_${videoId}`});
  savePlaylists();
  renderPlaylists();
  closePlModal();
  showToast(`Added to "${name}" ✅`);
}

function viewPlaylist(name){
  document.getElementById('searchInput').value=''; searchQuery='';
  currentView='playlist'; currentPlaylistView=name;
  const pl=playlists[name]; if(!pl) return;
  const content=document.getElementById('songContent');
  content.innerHTML=`
    <div>
      <div class="section-header">
        <div class="section-title">🎵 ${name}</div>
        <button onclick="deletePlaylist('${name}')" style="padding:5px 12px;border-radius:8px;border:1px solid #c45;background:transparent;color:#c45;cursor:pointer;font-size:12px">
          <i class="ti ti-trash"></i> Delete
        </button>
      </div>
      <div class="song-list" id="songList"></div>
    </div>`;
  const plSongs=pl;
  if(plSongs.length) renderSongs(plSongs) ;
  else document.getElementById('songList').innerHTML='<div class="empty-state"><i class="ti ti-playlist"></i>No songs yet — add some!</div>';
  document.querySelectorAll('#songList .song-row').forEach((row,i)=>{
  row.draggable=true;
  row.ondragstart=()=>dragStart(i);
  row.ondragover=e=>e.preventDefault();
  row.ondrop=()=>dropSong(name,i);
  });
}

function deletePlaylist(name){
  delete playlists[name];
  savePlaylists();
  renderPlaylists();
  const nav=document.getElementById('nav-discover');
  navTo('discover', nav);
  nav.classList.add('active');
  showToast(`Deleted "${name}"`);
}

// ── Search ────────────────────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('input', function(){
  searchQuery=this.value.trim();
  clearTimeout(searchDebounce);
  if(!document.getElementById('songList')){
    document.getElementById('songContent').innerHTML=
      '<div><div class="section-header"><div class="section-title">🔍 Search Results</div></div><div class="song-list" id="songList"></div></div>';
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    document.getElementById('nav-discover').classList.add('active');
  }
  searchDebounce=setTimeout(()=>liveSearch(searchQuery),500);
});

function addCurrentToPlaylist(){
  if(!currentSong){ showToast('Select a song first'); return; }
  openAddToPlaylist(currentSong.videoId);
}

function savePlaylists(){
  localStorage.setItem('redify-playlists', JSON.stringify(playlists));
}

function setMobNav(el) {
  document.querySelectorAll('.mob-nav-item').forEach(n => n.classList.remove('active'));
  el.classList.add('active');
}

function showMobilePlaylists(){
  document.getElementById('searchInput').value=''; searchQuery='';
  currentView='discover';
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const names=Object.keys(playlists);
  document.getElementById('songContent').innerHTML=`
    <div><div class="section-header"><div class="section-title">🎵 My Playlists</div></div>
    <div id="mobPlList" style="padding:8px 0">${names.length?names.map(n=>`
      <div class="song-row" onclick="viewPlaylist('${n}')" style="cursor:pointer">
        <div class="song-info"><div class="song-title">${n}</div><div class="song-artist">${playlists[n].length} songs</div></div>
      </div>`).join(''):'<div class="empty-state"><i class="ti ti-playlist"></i>No playlists yet</div>'}
    </div></div>`;
}

let dragIdx=null;
function dragStart(i){ dragIdx=i; }
function dropSong(name, i){
  const arr=playlists[name];
  const [moved]=arr.splice(dragIdx,1);
  arr.splice(i,0,moved);
  savePlaylists();
  viewPlaylist(name);
}

function dropFav(i){
  const [moved]=favOrder.splice(dragIdx,1);
  favOrder.splice(i,0,moved);
  localStorage.setItem('redify-favorder', JSON.stringify(favOrder));
  navTo('favorites', document.getElementById('nav-favorites'));
}
// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  buildViz();
  vizInterval=setInterval(animateViz,140);
  renderPlaylists();
  updateVol();
  initSongs().then(()=>navTo('discover', document.getElementById('nav-discover')));
  if(!currentSong) document.querySelector('.player').classList.add('no-song');
  document.querySelector('.vol-track').addEventListener('mousedown', e=>{
  volDragging=true;
  document.querySelector('.vol-track').classList.add('active');
  setVolume(e);
  });
});

document.getElementById('plModal')?.addEventListener('click', function(e){
  if(e.target===this) closePlModal();
});
