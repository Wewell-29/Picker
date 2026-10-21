(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const canvas = $('machineCanvas');
  const ctx = canvas.getContext('2d');
  const csvFile = $('csvFile');
  const hasHeader = $('hasHeader');
  const idColumn = $('idColumn');
  const nameColumn = $('nameColumn');
  const categoryColumn = $('categoryColumn');
  const drawCategory = $('drawCategory');
  const drawBtn = $('drawBtn');
  const nextBtn = $('nextBtn');
  const exportBtn = $('exportBtn');
  const resetBtn = $('resetBtn');
  const overlay = $('winnerOverlay');

  let rawRows = [], members = [], remaining = [], winners = [], balls = [];
  let width = 900, height = 650, dpr = 1, lastFrame = 0;
  let drawing = false, drawStart = 0, selectedWinner = null, catchBall = null;

  const colors = [
    ['#ff7272','#b8243d'], ['#4edbd0','#137b83'], ['#ffd66e','#b7751c'],
    ['#7da5ff','#3148a0'], ['#d7a0ff','#7c3ca5'], ['#72e5a1','#267b50'],
    ['#ffad77','#a84d2b'], ['#ff91bf','#a63169'], ['#8ceaff','#237c96'],
    ['#c3ed84','#537a29'], ['#f6a45d','#984b20'], ['#f1b0dc','#9a477d']
  ];

  function getEligibleMembers() {
    const selected = String(drawCategory.value || 'sc').trim().toLowerCase();
    const winnerIds = new Set(winners.map(winner => winner.id.trim().toLowerCase()));
    return remaining.filter(member =>
      !winnerIds.has(member.id.trim().toLowerCase()) &&
      String(member.category || '').trim().toLowerCase() === selected
    );
  }

  function populateDrawCategories() {
    const selected = drawCategory.value;
    const categories = [...new Map(
      members
        .map(member => member.category.trim())
        .filter(Boolean)
        .map(category => [category.toLowerCase(), category])
    ).values()];

    drawCategory.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All Members';
    drawCategory.appendChild(allOption);

    categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      drawCategory.appendChild(option);
    });

    const matchingCategory = categories.find(category => category.toLowerCase() === selected.toLowerCase());
    drawCategory.value = matchingCategory || '';
  }

  function updateStats() {
    $('loadedCount').textContent = members.length.toLocaleString();
    $('winnerCount').textContent = winners.length.toLocaleString();
    drawBtn.disabled = drawing || getEligibleMembers().length === 0;
    exportBtn.disabled = winners.length === 0;
    resetBtn.disabled = !members.length || drawing;
    $('drawBtn').textContent = drawing ? 'Drawing…' : '🎱 Pick a Winner';
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    row.push(field);
    if (row.some(v => String(v).trim()) || !rows.length) rows.push(row);
    return rows.filter(r => r.some(v => String(v ?? '').trim()));
  }

  function findColumn(terms, fallback) {
    const max = Math.max(0, ...rawRows.map(r => r.length));
    if (!hasHeader.checked || !rawRows[0]) return Math.min(fallback, Math.max(0, max - 1));
    const headers = rawRows[0].map(v => String(v ?? '').trim().toLowerCase());
    const found = headers.findIndex(h => terms.some(t => h === t || h.includes(t)));
    return found >= 0 ? found : Math.min(fallback, Math.max(0, max - 1));
  }

  function populateSelect(select, selectedIndex) {
    select.innerHTML = '';
    const max = Math.max(0, ...rawRows.map(r => r.length));
    for (let i = 0; i < max; i++) {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = hasHeader.checked && rawRows[0][i]
        ? String(rawRows[0][i]).trim() : `Column ${i + 1}`;
      select.appendChild(option);
    }
    if (max) select.value = String(Math.min(selectedIndex, max - 1));
    select.disabled = max === 0;
  }

  function rebuildColumns() {
    if (!rawRows.length || drawing) return;
    populateSelect(idColumn, findColumn(['member id','member no','member number','account no','account number','id'], 0));
    populateSelect(nameColumn, findColumn(['member name','full name','name'], 1));
    populateSelect(categoryColumn, findColumn(['category','member category','court'], 2));
    loadMembers();
  }

  function loadMembers() {
    if (!rawRows.length || drawing) return;
    const start = hasHeader.checked ? 1 : 0;
    const idIndex = Number(idColumn.value || 0);
    const nameIndex = Number(nameColumn.value || 0);
    const categoryIndex = Number(categoryColumn.value || 0);
    const loaded = [];

    for (let i = start; i < rawRows.length; i++) {
      const row = rawRows[i];
      const id = String(row[idIndex] ?? '').trim();
      if (!id) continue;
      const name = idIndex === nameIndex ? '' : String(row[nameIndex] ?? '').trim();
      const category = String(row[categoryIndex] ?? '').trim();
      loaded.push({ uid: `${i}-${loaded.length}`, id, name, category });
    }

    members = loaded;
    remaining = members.slice();
    winners = [];
    selectedWinner = null;
    catchBall = null;
    overlay.classList.remove('show');
    drawBtn.hidden = false;
    nextBtn.hidden = true;
    populateDrawCategories();
    drawCategory.disabled = !members.length;

    makeBalls();
    renderHistory();
    updateStats();

    if (!members.length) {
      window.alert('No member IDs found. Check the selected ID column.');
    }
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    width = Math.max(320, rect.width);
    height = Math.max(340, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    makeBalls();
  }

  function sampleRemaining(count) {
    const pool = getEligibleMembers().slice();
    const chosen = [];
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      chosen.push(pool[i]);
    }
    return chosen;
  }

  function machineGeometry() {
    const radius = Math.min(width * .36, height * .36, 270);
    return { cx: width / 2, cy: height * .54, r: radius };
  }

  function makeBalls() {
    if (!ctx) return;
    const g = machineGeometry();
    const sample = sampleRemaining(Number($('ballCount').value || 36));
    const ballR = Math.max(12, Math.min(22, g.r / 10));
    balls = sample.map((member, i) => {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * Math.max(1, g.r - ballR - 13);
      return {
        member, r: ballR,
        x: g.cx + Math.cos(angle) * distance,
        y: g.cy + Math.sin(angle) * distance,
        vx: (Math.random() - .5) * 2.7, vy: (Math.random() - .5) * 2.7,
        c1: colors[i % colors.length][0], c2: colors[i % colors.length][1],
        phase: Math.random() * Math.PI * 2
      };
    });
  }

  function drawTopCatcher(cx, cy, r, timestamp) {
    const mouthY = cy - r + 20;
    const neckW = r * .18;
    const glow = drawing && performance.now() - drawStart > 1750;
    ctx.save();
    const metal = ctx.createLinearGradient(cx-neckW, 0, cx+neckW, 0);
    metal.addColorStop(0, '#536471'); metal.addColorStop(.25, '#f9fcff');
    metal.addColorStop(.52, '#9eacb7'); metal.addColorStop(.8, '#fff'); metal.addColorStop(1, '#526472');
    ctx.fillStyle = metal;
    ctx.beginPath();
    ctx.moveTo(cx-neckW*.45, cy-r*.45); ctx.lineTo(cx-neckW*.45, mouthY);
    ctx.lineTo(cx-neckW, mouthY+13); ctx.lineTo(cx+neckW, mouthY+13);
    ctx.lineTo(cx+neckW*.45, mouthY); ctx.lineTo(cx+neckW*.45, cy-r*.45);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#253542';
    ctx.beginPath(); ctx.ellipse(cx, mouthY+2, neckW*1.35, neckW*.48, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = glow ? '#ffd166' : '#f8fbff';
    ctx.lineWidth = 4; ctx.shadowColor = glow ? '#ffd166' : '#fff'; ctx.shadowBlur = glow ? 20 : 7;
    ctx.beginPath(); ctx.ellipse(cx, mouthY, neckW*1.35, neckW*.48, 0, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#718491'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx-neckW*.8, mouthY+5); ctx.quadraticCurveTo(cx-neckW*1.2, mouthY-17, cx-neckW*.65, mouthY-28);
    ctx.moveTo(cx+neckW*.8, mouthY+5); ctx.quadraticCurveTo(cx+neckW*1.2, mouthY-17, cx+neckW*.65, mouthY-28);
    ctx.stroke(); ctx.restore();
  }

  function drawBall(b, timestamp) {
    const pulse = 1 + Math.sin(timestamp / 350 + b.phase) * .025;
    const r = b.r * pulse;
    const grad = ctx.createRadialGradient(b.x-r*.36, b.y-r*.45, 1, b.x, b.y, r*1.12);
    grad.addColorStop(0, '#fff'); grad.addColorStop(.18, b.c1); grad.addColorStop(1, b.c2);
    ctx.save(); ctx.shadowColor = b.c1; ctx.shadowBlur = drawing ? 9 : 5;
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI*2); ctx.fillStyle = grad; ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = 1.4; ctx.strokeStyle = '#ffffffc9'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(b.x-r*.2, b.y-r*.43, r*.32, r*.12, -.5, 0, Math.PI*2);
    ctx.fillStyle = '#ffffffa0'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${b.member.id.length > 8 ? Math.max(7,r*.42) : Math.max(9,r*.56)}px Arial`;
    ctx.shadowColor = '#15202b'; ctx.shadowBlur = 3;
    ctx.fillText(b.member.id, b.x, b.y, r*1.65); ctx.restore();
  }

  function drawMachine(timestamp) {
    const { cx, cy, r } = machineGeometry();
    ctx.save();
    ctx.shadowColor = '#000'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 12;
    const glass = ctx.createRadialGradient(cx-r*.35, cy-r*.48, r*.05, cx, cy, r*1.08);
    glass.addColorStop(0, '#fff'); glass.addColorStop(.55, '#dbe7f0');
    glass.addColorStop(.82, '#8b9dad'); glass.addColorStop(1, '#e7eef5');
    ctx.beginPath(); ctx.arc(cx, cy, r+5, 0, Math.PI*2); ctx.fillStyle = glass; ctx.fill(); ctx.restore();

    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.clip();
    const inside = ctx.createRadialGradient(cx-r*.2, cy-r*.4, 4, cx, cy, r);
    inside.addColorStop(0, '#f5fbff'); inside.addColorStop(.6, '#d8e1e8'); inside.addColorStop(1, '#9aa9b5');
    ctx.fillStyle = inside; ctx.fillRect(cx-r, cy-r, r*2, r*2);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(timestamp * (drawing ? .0035 : .0005));
    for (let i=0; i<5; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${.12+i*.025})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0,0,r*.86,r*(.28+i*.09),i*.24,-.8,2.5); ctx.stroke();
    }
    ctx.restore();
    balls.forEach(b => drawBall(b, timestamp));
    ctx.restore();

    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r+4, 0, Math.PI*2);
    ctx.lineWidth = 7; ctx.strokeStyle = '#9daab4'; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r+1, -2.35, -.75); ctx.lineWidth = 5; ctx.strokeStyle = '#ffffffd9'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx-r*.56, cy-r*.65, r*.22, r*.07, -.7, 0, Math.PI*2); ctx.fillStyle = '#ffffff85'; ctx.fill();
    const baseY = cy+r+8;
    const pedestal = ctx.createLinearGradient(cx-r*.32, baseY, cx+r*.32, baseY+55);
    pedestal.addColorStop(0,'#dce3e8'); pedestal.addColorStop(.35,'#687783'); pedestal.addColorStop(.7,'#263542'); pedestal.addColorStop(1,'#b5c0c8');
    ctx.fillStyle = pedestal; ctx.beginPath(); ctx.moveTo(cx-r*.32,baseY); ctx.lineTo(cx+r*.32,baseY);
    ctx.lineTo(cx+r*.24,baseY+35); ctx.quadraticCurveTo(cx,baseY+48,cx-r*.24,baseY+35); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1b2733'; ctx.beginPath(); ctx.ellipse(cx,baseY+38,r*.28,10,0,0,Math.PI*2); ctx.fill(); ctx.restore();

    drawTopCatcher(cx, cy, r, timestamp);
    if (catchBall) drawCaughtBall(timestamp);
  }

  function drawCaughtBall(timestamp) {
    const g = machineGeometry();
    const elapsed = timestamp - catchBall.start;
    const p = Math.min(elapsed / 1250, 1);
    const ease = p*p*(3-2*p);
    const startX = g.cx;
    const startY = g.cy - g.r + 43;
    const endY = g.cy - g.r - 17;
    const x = startX + Math.sin(p*Math.PI*2)*g.r*.025;
    const y = startY + (endY-startY)*ease;
    const c = catchBall.memberBall;
    const radius = c.r * (1 + .8*ease);
    const grad = ctx.createRadialGradient(x-radius*.35,y-radius*.4,1,x,y,radius);
    grad.addColorStop(0,'#fff'); grad.addColorStop(.2,c.c1); grad.addColorStop(1,c.c2);
    ctx.save(); ctx.shadowColor = c.c1; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(x,y,radius,0,Math.PI*2); ctx.fillStyle = grad; ctx.fill();
    ctx.lineWidth=2; ctx.strokeStyle='#fff'; ctx.stroke(); ctx.shadowBlur=4;
    ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font=`900 ${c.member.id.length > 8 ? radius*.5 : radius*.62}px Arial`;
    ctx.fillText(c.member.id,x,y,radius*1.6); ctx.restore();

    if (p >= 1 && !catchBall.revealed) {
      catchBall.revealed = true;
      window.setTimeout(revealWinner, 250);
    }
  }

  function revealWinner() {
    if (!selectedWinner || !drawing) return;
    drawing = false;
    const winner = selectedWinner;
    const winnerId = winner.id.trim().toLowerCase();
    remaining = remaining.filter(member => member.id.trim().toLowerCase() !== winnerId);
    winners.push({ ...winner, drawNumber: winners.length + 1, drawnAt: new Date() });
    $('winnerTitle').textContent = winner.name || 'Member selected';
    $('winnerId').textContent = `Member ID: ${winner.id}`;
    renderHistory();
    updateStats();
    overlay.classList.add('show');
    nextBtn.hidden = true;
    drawBtn.hidden = true;
    selectedWinner = null;
  }

  function gameLoop(timestamp) {
    requestAnimationFrame(gameLoop);
    const dt = lastFrame ? Math.min((timestamp-lastFrame)/16.67, 2.5) : 1;
    lastFrame = timestamp;
    const g = machineGeometry();
    ctx.clearRect(0,0,width,height);
    for (let i=0; i<24; i++) {
      const x=(i*137.5+timestamp*.005)%width, y=(i*73.1)%height;
      ctx.fillStyle=`rgba(255,255,255,${.035+.035*Math.sin(timestamp/600+i)})`;
      ctx.beginPath(); ctx.arc(x,y,1.3,0,Math.PI*2); ctx.fill();
    }

    for (const b of balls) {
      if (drawing && !catchBall) {
        b.vx += (Math.random()-.5)*.75; b.vy += (Math.random()-.5)*.75;
        b.vx = Math.max(-7,Math.min(7,b.vx)); b.vy = Math.max(-7,Math.min(7,b.vy));
      } else {
        b.vx += (Math.random()-.5)*.035; b.vy += (Math.random()-.5)*.035;
        b.vx = Math.max(-2.1,Math.min(2.1,b.vx)); b.vy = Math.max(-2.1,Math.min(2.1,b.vy));
      }
      b.x += b.vx*dt; b.y += b.vy*dt;
      const dx=b.x-g.cx, dy=b.y-g.cy, distance=Math.hypot(dx,dy), limit=g.r-b.r-8;
      if (distance>limit) {
        const nx=dx/(distance||1), ny=dy/(distance||1);
        b.x=g.cx+nx*limit; b.y=g.cy+ny*limit;
        const dot=b.vx*nx+b.vy*ny; b.vx-=2*dot*nx; b.vy-=2*dot*ny;
      }
    }

    if (drawing && !catchBall && timestamp-drawStart>1900) {
      let source = balls.find(b => b.member.uid === selectedWinner.uid);
      if (!source) {
        const color = colors[Math.floor(Math.random()*colors.length)];
        source = { member: selectedWinner, r: Math.max(14,Math.min(30,g.r/10)), x:g.cx, y:g.cy-g.r*.45, c1:color[0], c2:color[1] };
      }
      catchBall = { start: timestamp, memberBall: { ...source, member: selectedWinner }, revealed: false };
    }

    drawMachine(timestamp);
  }

  function renderHistory() {
    const list = $('historyList');
    list.innerHTML = '';
    if (!winners.length) {
      const li = document.createElement('li');
      li.className = 'empty'; li.textContent = 'No winners yet.';
      list.appendChild(li); return;
    }
    winners.slice().reverse().forEach(w => {
      const li = document.createElement('li');
      const name = document.createElement('div'); name.className = 'history-name';
      name.textContent = w.name || 'Member selected';
      const id = document.createElement('div'); id.className = 'history-id'; id.textContent = `ID: ${w.id}`;
      const category = document.createElement('span'); category.className = 'history-category';
      category.textContent = w.category || 'Unspecified';
      li.append(name,id,category); list.appendChild(li);
    });
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }

  function exportWinners() {
    if (!winners.length) return;
    const rows = [
      ['Draw Number','Member ID','Member Name','Category','Drawn At'],
      ...winners.map(w => [w.drawNumber,w.id,w.name,w.category,w.drawnAt.toISOString()])
    ];
    const csv = '\uFEFF' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download='lottery-winners.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function startDraw() {
    if (drawing) return;
    const eligible = getEligibleMembers();
    if (!eligible.length) {
      updateStats();
      return;
    }

    selectedWinner = eligible[Math.floor(Math.random()*eligible.length)];
    drawing = true;
    drawStart = performance.now();
    catchBall = null;
    nextBtn.hidden = true;
    drawBtn.disabled = true;
    idColumn.disabled = nameColumn.disabled = categoryColumn.disabled = csvFile.disabled = hasHeader.disabled = true;
    drawCategory.disabled = true;
    for (const b of balls) { b.vx=(Math.random()-.5)*8; b.vy=(Math.random()-.5)*8; }
    updateStats();
  }

  function closeWinner() {
    overlay.classList.remove('show');
    drawBtn.hidden = false;
    nextBtn.hidden = true;
    idColumn.disabled = nameColumn.disabled = categoryColumn.disabled = csvFile.disabled = hasHeader.disabled = false;
    drawCategory.disabled = !members.length;
    catchBall = null;
    makeBalls();
    updateStats();
  }

  function resetDraw() {
    if (!members.length || drawing) return;
    if (!confirm('Reset the draw and make all imported members eligible again?')) return;
    remaining = members.slice();
    winners = [];
    selectedWinner = null;
    catchBall = null;
    overlay.classList.remove('show');
    drawBtn.hidden = false;
    nextBtn.hidden = true;
    makeBalls();
    renderHistory();
    updateStats();
  }

  csvFile.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      rawRows = parseCSV(await file.text());
      if (!rawRows.length) { window.alert('The CSV is empty.'); return; }
      rebuildColumns();
    } catch {
      window.alert('Could not read the file. Export it as CSV UTF-8 and try again.');
    }
  });

  hasHeader.addEventListener('change', rebuildColumns);
  idColumn.addEventListener('change', loadMembers);
  nameColumn.addEventListener('change', loadMembers);
  categoryColumn.addEventListener('change', loadMembers);
  drawCategory.addEventListener('change', () => {
    if (drawing) return;
    makeBalls();
    updateStats();
  });
  $('ballCount').addEventListener('change', makeBalls);
  drawBtn.addEventListener('click', startDraw);
  nextBtn.addEventListener('click', startDraw);
  $('overlayNext').addEventListener('click', closeWinner);
  exportBtn.addEventListener('click', exportWinners);
  resetBtn.addEventListener('click', resetDraw);
  window.addEventListener('resize', resizeCanvas);

  resizeCanvas();
  updateStats();
  requestAnimationFrame(gameLoop);
})();
