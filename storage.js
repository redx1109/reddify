let likedSongs = JSON.parse(localStorage.getItem('redify-likedsongs') || '{}');

function toggleLike(videoId){
  liked.has(videoId)?liked.delete(videoId):liked.add(videoId);
  if(liked.has(videoId)){
    const song = songs.find(s=>s.videoId===videoId) || currentSong;
    if(song) likedSongs[videoId] = song;
  } else {
    delete likedSongs[videoId];
  }
  const isLiked=liked.has(videoId);
  const cnt=document.getElementById('favCount');
  cnt.textContent=liked.size; cnt.style.display=liked.size>0?'inline':'none';
  document.querySelectorAll(`[onclick*="toggleLike(${videoId})"]`).forEach(btn=>{
    btn.classList.toggle('liked',isLiked);
  });
  showToast(isLiked?'Added to Favorites ❤️':'Removed from Favorites');
  saveLiked();
}
function saveLiked(){
  localStorage.setItem('redify-liked', JSON.stringify([...liked]));
  localStorage.setItem('redify-likedsongs', JSON.stringify(likedSongs));
}

// ── Playlist Functions ────────────────────────────────────────────────────────
function renderPlaylists(){
  const nav=document.getElementById('playlistNav');
  if(!nav) return;
  const colors=['#D4537E','#7F77DD','#1D9E75','#E8A838','#5B8DEF','#C45FD4'];
  const names=Object.keys(playlists);
  if(!names.length){ nav.innerHTML='<div style="font-size:11px;color:var(--t3);padding:4px 10px">No playlists yet</div>'; return; }
  nav.innerHTML=names.map((name,i)=>`
    <div class="playlist-item" onclick="viewPlaylist('${name}')">
      <div class="pl-dot" style="background:${colors[i%colors.length]}"></div>
      ${name}
      <span style="margin-left:auto;font-size:10px;color:var(--t3)">${playlists[name].length}</span>
    </div>`).join('');
}
