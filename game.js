(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // preload plane icon as player sprite
  const planeImg = new Image();
  planeImg.src = 'favicon.png';


  const uiOverlay = document.getElementById('uiOverlay');
  const btnStart = document.getElementById('btnStart');
  const btnRestart = document.getElementById('btnRestart');
  const btnPause = document.getElementById('btnPause');
  const controlMode = document.getElementById('controlMode');
  const difficultySel = document.getElementById('difficulty');
  const hiscoreEl = document.getElementById('hiscore');


  const W = canvas.width;
  const H = canvas.height;

  // Track & bounds
  const LANE = { left: 150, right: W - 150 };
  const TRACK_TOP = 60;
  const TRACK_BOTTOM = H - 90;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
  function rng(n=1){ return Math.random()*n; }

  // Difficulty presets & wave presets
  const DIFF = {
    easy:   { hpMult: 1.00, speedAdd: 0,   downBiasAdd: 0,   spawnMul: 1.10, waves: 5, bosses:[5],   bossHp:30 },
    normal: { hpMult: 1.35, speedAdd: 18,  downBiasAdd: 6,   spawnMul: 1.00, waves: 6, bosses:[3,6], bossHp:60 },
    hard:   { hpMult: 1.70, speedAdd: 36,  downBiasAdd: 12,  spawnMul: 0.85, waves: 8, bosses:[3,6,8], bossHp:120 },
  };
  let currentDiffKey = 'normal';
  let currentDiff = DIFF[currentDiffKey];

  // Game state
  let running = false;
  let paused = false;
  let levelZ = 0; // forward distance for gates only
  let speedZ = 180;

  const player = {
    x: (LANE.left + LANE.right)/2,
    y: TRACK_BOTTOM - 42, // start at bottom-center
    w: 34, h: 44,
    speedX: 0, speedY: 0,
    maxSpeed: 6,
    hp: 12,
    maxHp: 12,
    targetX: (LANE.left + LANE.right)/2,
    targetY: TRACK_BOTTOM - 42,
    invincibleTimer: 0,
    fireCooldown: 0,
    time: 0,
    speedBoostTimer: 0,
  };

  // Camera shake
  let shakeTime = 0;
  let shakeIntensity = 0;
  function addShake(amount, dur=0.25){
    shakeIntensity = Math.min(24, shakeIntensity + amount);
    shakeTime = Math.max(shakeTime, dur);
  }

  // Entities
  const gates = [];     // {z, x, w, h, effect:{op,val}, consumed:false}
  const monsters = [];  // {x,y,vx,vy,size,colors:{body,accent,cloak},hp,maxHp,type,ai,...,isBoss}
  const bullets = [];
  const enemyBullets = [];
  const particles = [];
  let bomb = null;      // {x,y,active:true}
  let bombTimer = 0;
  let nextBombInterval = 0;
  // Boots item disabled permanently

  const ops = ['+','-','÷','×'];

function pickOp() {
  const r = Math.random();
  if (r < 0.40) return '+';
  else if (r < 0.70) return '-';
  else if (r < 0.85) return '×';
  else return '÷';
}
 // x 제거
  let nextGateZ = 180;

  // High score UI helper
  function updateHiscoreUI(){
    if (hiscoreEl) hiscoreEl.textContent = `최고 점수: ${Math.floor(highScore)}`;
  }
// Waves
  let wave = 1;
  let inWave = true;
  let restTimer = 0;
  let waveKillTarget = 20;
  let waveKills = 0;
  let score = 0;
  let highScore = Number(localStorage.getItem('mf_highscore') || 0);


  // Monster spawn
  let spawnTimer = 0;
  let spawnInterval = 0.7;
  let MAX_MONSTERS = 28;

  function scheduleNextBomb() {
    nextBombInterval = 10 + Math.random()*10; // 10~20초
    bombTimer = nextBombInterval;
  }
  // scheduleNextBoots removed (boots disabled)

  function setDifficulty(key) {
    currentDiffKey = key in DIFF ? key : 'easy';
    currentDiff = DIFF[currentDiffKey];
  }

  function resetGame() {
    setDifficulty('normal'); // single difficulty mode // start as selected, default easy

    gates.length = 0;
    monsters.length = 0;
    bullets.length = 0;
    enemyBullets.length = 0;
    particles.length = 0;
    bomb = null;
    scheduleNextBomb();
    boots = null;
    // scheduleNextBoots() removed

    levelZ = 0;
    speedZ = 180;
    nextGateZ = 180;
    player.hp = 12;
    player.maxHp = 12;
    player.x = (LANE.left + LANE.right)/2;
    player.y = TRACK_BOTTOM - 42; // bottom center
    player.targetX = player.x;
    player.targetY = player.y;
    player.invincibleTimer = 0;
    player.fireCooldown = 0;
    player.time = 0;

    wave = 1;
    inWave = true;
    restTimer = 0;
    waveKills = 0;
    waveKillTarget = 16 + (currentDiffKey==='normal'?6:(currentDiffKey==='hard'?12:0));

    spawnTimer = 0;
    spawnInterval = 0.7 * (1/currentDiff.spawnMul);
    MAX_MONSTERS = (currentDiffKey === 'hard') ? 34 : (currentDiffKey === 'normal' ? 30 : 28);

    for (let i=0;i<8;i++) spawnGate();
  }

  function spawnGate() {
    const z = (gates.length? (gates[gates.length-1].z + randInt(100, 150)) : nextGateZ);
    nextGateZ = z + randInt(100, 150);
    const wPlus = 1.0, wMinus = 1.2, wDiv = 0.5, wMul = 0.2; // ratio: +:1, -:1.2, ÷:0.5, ×:0.2
    const sum = wPlus + wMinus + wDiv + wMul;
    let r = Math.random() * sum;
    let op;
    if ((r -= wPlus) < 0) op = '+';
    else if ((r -= wMinus) < 0) op = '-';
    else if ((r -= wDiv) < 0) op = '÷';
    else op = '×';
    let val;
    if (op === '+' || op === '-') val = randInt(2,10);
    else if (op === '÷') val = randInt(2,5);
    else if (op === '×') val = (Math.random()<0.5?2:3);
    const x = randInt(LANE.left+40, LANE.right-40); randInt(LANE.left+40, LANE.right-40); // random X
    gates.push({ z, x, w: 120, h: 60, effect:{op, val}, consumed:false });
    return z;
  }

  // ---- Monsters template ----
  const MONSTER_TYPES = [
    { name: 'imp',     hp: 2, speed: 110, size: 26, colors:{body:'#e14444',accent:'#ffb3b3',cloak:'#6d0f0f'}, ai: 'home',     downBias: 35 },
    { name: 'brute',   hp: 5, speed: 80,  size: 44, colors:{body:'#37465e',accent:'#bcc8dc',cloak:'#222f45'}, ai: 'orbit',   downBias: 28 },
    { name: 'charger', hp: 3, speed: 140, size: 32, colors:{body:'#ff8a3d',accent:'#ffd1b3',cloak:'#6a2a08'}, ai: 'pcharge', downBias: 42 },
    { name: 'split',   hp: 3, speed: 100, size: 30, colors:{body:'#9b59b6',accent:'#e3c8ff',cloak:'#3c1f52'}, ai: 'zigzag',  downBias: 36 },
    { name: 'dodger',  hp: 2, speed: 125, size: 26, colors:{body:'#2ecc71',accent:'#bdf3d0',cloak:'#0a5a2e'}, ai: 'evade',   downBias: 34 },
    { name: 'chaos',   hp: 3, speed: 120, size: 28, colors:{body:'#d35400',accent:'#ffd8b0',cloak:'#5a2400'}, ai: 'chaos',   downBias: 38 },
  ];

  function spawnMonster() {
    if (monsters.length >= MAX_MONSTERS) return;
    const t = MONSTER_TYPES[randInt(0, MONSTER_TYPES.length-1)];
    const x = randInt(LANE.left+40, LANE.right-40);
    const y = TRACK_TOP + randInt(0, 40); // spawn inside
    const angle = Math.atan2(player.y - y, player.x - x);
    const baseSpeed = t.speed + rng(50);
    const speed = baseSpeed + currentDiff.speedAdd + (wave*6);
    const vx = Math.cos(angle)*speed*0.08;
    const vy = Math.sin(angle)*speed*0.08 + (t.downBias + currentDiff.downBiasAdd)*0.2;

    const scaledHp = Math.max(1, Math.round(t.hp * currentDiff.hpMult * (1 + 0.06*(wave-1))));

    monsters.push({
      type: t.name,
      x, y, vx, vy,
      size: t.size,
      colors: t.colors,
      hp: scaledHp,
      maxHp: scaledHp,
      ai: t.ai,
      downBias: t.downBias + currentDiff.downBiasAdd,
      dashCd: 0,
      evadeCd: 0,
      zigzagTimer: rng(1.0),
      orbitAngle: Math.random()*Math.PI*2,
      noiseSeed: Math.random()*1000,
      hitFlash: 0,
      dead: false,
      isBoss: false,
    });
  }

  function spawnBoss() {
    const x = (LANE.left + LANE.right)/2;
    const y = TRACK_TOP + 60;
    const hp = Math.round(currentDiff.bossHp * (1 + 0.10*(wave-1)));
    monsters.push({
      type: 'boss',
      x, y, vx:0, vy: 35, // slowly descends
      size: 70,
      colors: {body:'#6b2c91', accent:'#f6d2ff', cloak:'#2b0f3e'},
      hp, maxHp: hp,
      ai: 'boss',
      downBias: 14 + currentDiff.downBiasAdd,
      dashCd: 0,
      evadeCd: 0,
      zigzagTimer: 0.4,
      orbitAngle: 0,
      noiseSeed: Math.random()*1000,
      hitFlash: 0,
      dead: false,
      isBoss: true,
      shootCd: 1.6,
      waveAngle: 0,
      phase2: false,
    });
    flashText(`보스 등장!`);
    addShake(8, 0.5);
  }

  function killMonster(m, cause='bullet') {
    // Only split when killed by bullets, not by touch or bomb; bosses don't split
    if (!m.isBoss && m.type === 'split' && cause === 'bullet') {
      for (let i=0;i<2;i++) {
        const childHp = Math.max(1, Math.round(1 * currentDiff.hpMult));
        monsters.push({
          type: 'imp',
          x: m.x + (i===0?-8:8),
          y: m.y,
          vx: (i===0?-1:1)*90, vy: -20,
          size: 20,
          colors: MONSTER_TYPES[0].colors,
          hp: childHp, maxHp: childHp,
          ai: 'home',
          downBias: 30 + currentDiff.downBiasAdd,
          dashCd: 0, evadeCd: 0,
          zigzagTimer: rng(1.0),
          orbitAngle: Math.random()*Math.PI*2,
          noiseSeed: Math.random()*1000,
          hitFlash: 0,
          dead: false,
          isBoss:false,
        });
      }
    }
    spawnBurst(m.x, m.y, 26, m.colors.body, 260, 0.7);
    spawnBurst(m.x, m.y, 12, '#ffffff', 220, 0.4);
    m.dead = true;
    score += (m.isBoss ? 100 : 10);
    if (!m.isBoss) {
      waveKills++;
      // increase small shake for kill feedback
      addShake(1.2, 0.12);
    } else {
      flashText('보스 격파!');
      addShake(10, 0.6);
      // proceed to next wave after short rest
      inWave = false;
      restTimer = 2.0;
    }
  }

  // Boss circular wave bullets
  function bossShoot(m) {
    const baseN = 18;
    const baseSpeed = 160 + (currentDiffKey==='hard'?60:(currentDiffKey==='normal'?30:0));
    const bulletsN = m.phase2 ? baseN + 8 : baseN;
    const speed = m.phase2 ? baseSpeed + 60 : baseSpeed;
    m.waveAngle += 0.35; // rotate pattern over time
    for (let i=0;i<bulletsN;i++) {
      const a = (i / bulletsN) * Math.PI*2 + m.waveAngle;
      enemyBullets.push({
        x: m.x, y: m.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 4.0,
        r: 4,
      });
    }
    spawnBurst(m.x, m.y, 10, '#f6d2ff', 180, 0.3);
  }

  // ---- Shooting (player) ----
  function bulletVolley() {
    if (player.hp <= 0) return;
    const n = Math.max(3, Math.min(7, Math.floor(player.hp/4)+2));
    const spread = Math.min(0.55, 0.06 * (n-1));
    for (let i=0;i<n;i++) {
      const t = (n===1) ? 0 : (i/(n-1) - 0.5);
      const angle = t * spread;
      bullets.push({
        x: player.x + 10, y: player.y - 6,
        vx: Math.sin(angle) * 310,
        vy: -440 * Math.cos(angle),
        life: 2.0
      });
    }
    const rate = 0.23 * (n>=6 ? 0.6 : 1.0);
    player.fireCooldown = rate;
    spawnBurst(player.x+10, player.y-6, 6, '#ffd966', 170, 0.25);
  }

  // ---- Gates -> affect player HP ----
  function applyGate(effect) {
    const {op, val} = effect;
    if (op === '+') player.hp += val;
    else if (op === '-') player.hp = Math.max(0, player.hp - val);
    else if (op === '÷') player.hp = Math.max(0, Math.floor(player.hp / val));
    else if (op === '×') player.hp = Math.max(0, Math.floor(player.hp * val));
    if (player.hp > player.maxHp) player.maxHp = player.hp; // dynamic cap grows with buffs
    flashText(`${op}${val}`);
    checkGameOver();
  }

  function takeDamage(amount){
    player.hp = Math.max(0, player.hp - amount);
    addShake(1.5*amount, 0.35);
    checkGameOver();
  }

  function checkGameOver() {
    if (player.hp <= 0) {
      player.hp = 0;
      endGame(false, '병사의 체력이 0이 되었습니다.');
    }
  }

  // Input
  let keys = {};
  window.addEventListener('keydown', (e)=>{
    // Space: pause/resume
    if (e.code === 'Space') { e.preventDefault(); paused = !paused; if (btnPause) btnPause.textContent = paused ? '계속' : '일시정지'; return; }
    if (e.code === 'ArrowLeft' || e.code==='KeyA') keys.left = true;
    if (e.code === 'ArrowRight'|| e.code==='KeyD') keys.right = true;
    if (e.code === 'ArrowUp' || e.code==='KeyW') keys.up = true;
    if (e.code === 'ArrowDown'|| e.code==='KeyS') keys.down = true;
  });
  window.addEventListener('keyup', (e)=>{
    if (e.code === 'ArrowLeft' || e.code==='KeyA') keys.left = false;
    if (e.code === 'ArrowRight'|| e.code==='KeyD') keys.right = false;
    if (e.code === 'ArrowUp' || e.code==='KeyW') keys.up = false;
    if (e.code === 'ArrowDown'|| e.code==='KeyS') keys.down = false;
  });
  canvas.addEventListener('mousemove', (e)=>{
    if (controlMode.value !== 'mouse') return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const minX = LANE.left+16, maxX = LANE.right-16;
    const minY = TRACK_TOP+10,  maxY = TRACK_BOTTOM-8;
    player.targetX = clamp(x, minX, maxX);
    player.targetY = clamp(y, minY, maxY);
  });

  function update(dt) {
    // time
    player.time += dt;
    score += dt * 1; // +1 per second

    // Difficulty curve (spawn interval drifts slightly)
    speedZ = Math.min(340, speedZ + dt * 1.1);
    spawnInterval = Math.max(0.18, spawnInterval - dt*0.005);

    // Camera shake decay
    if (shakeTime > 0) shakeTime -= dt;
    shakeIntensity *= 0.9;

    // Move player
    const minX = LANE.left+16, maxX = LANE.right-16;
    const minY = TRACK_TOP+10,  maxY = TRACK_BOTTOM-8;

    if (controlMode.value === 'keyboard') {
      let dirX = 0, dirY = 0;
      if (keys.left) dirX -= 1;
      if (keys.right) dirX += 1;
      if (keys.up) dirY -= 1;
      if (keys.down) dirY += 1;
      const spMul = 1.0; // fixed: no speed boost
      player.speedX = dirX * player.maxSpeed * spMul;
      player.speedY = dirY * player.maxSpeed * spMul;
      player.x = clamp(player.x + player.speedX, minX, maxX);
      player.y = clamp(player.y + player.speedY, minY, maxY);
      player.targetX = player.x; player.targetY = player.y;
    } else {
      const lerp = 0.2; // fixed: no speed boost
      player.x += (player.targetX - player.x) * lerp;
      player.y += (player.targetY - player.y) * lerp;
      player.x = clamp(player.x, minX, maxX);
      player.y = clamp(player.y, minY, maxY);
    }

    // Shooting
    player.fireCooldown -= dt;
    if (player.fireCooldown <= 0 && player.hp > 0) bulletVolley();

    // Forward scroll for gates
    levelZ += speedZ * dt;
    if (player.invincibleTimer > 0) player.invincibleTimer -= dt;

    // Spawn new gates
    while (nextGateZ < levelZ + 900) spawnGate();

    // Gate collision
    gates.forEach(g => {
      if (g.consumed) return;
      const gy = toScreenY(g.z);
      const collideX = Math.abs(player.x - g.x) < (g.w/2 + player.w/2);
      const collideY = Math.abs(player.y - gy) < (g.h/2 + player.h/2);
      if (collideX && collideY) {
        applyGate(g.effect);
        g.consumed = true;
        spawnBurst(g.x, gy, 14, colorForOp(g.effect.op), 140, 0.5);
      }
    });

    // Bomb spawn timer
    if (!bomb) {
      bombTimer -= dt;
      if (bombTimer <= 0) {
        // spawn bomb at random position within bounds
        bomb = {
          x: randInt(minX+10, maxX-10),
          y: randInt(minY+10, maxY-10),
          active: true
        };
      }
    } else {
      // bomb pickup check
      if (Math.abs(player.x - bomb.x) < (12 + player.w/2) &&
          Math.abs(player.y - bomb.y) < (12 + player.h/2)) {
        // kill all monsters on screen (no split)
        for (const m of monsters) {
          if (!m.dead) killMonster(m, 'bomb');
        }
        for (let i=monsters.length-1;i>=0;i--) if (monsters[i].dead) monsters.splice(i,1);
        spawnBurst(bomb.x, bomb.y, 60, '#ffd966', 360, 0.9);
        addShake(6, 0.35);
        bomb = null;
        scheduleNextBomb();

}
    }

    // Wave logic
    if (inWave) {
      // Boss spawn check
      if ((wave % 5) === 0) {
        // ensure no existing boss
        if (!monsters.some(m=>m.isBoss)) {
          spawnBoss();
        }
      } else {
        // Regular spawns
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          spawnMonster();
          spawnTimer = spawnInterval * (0.7 + Math.random()*0.6);
        }
      }

      // Wave clear condition (for non-boss waves): enough kills
      const isBossWave = ((wave % 5) === 0);
      if (!isBossWave && waveKills >= waveKillTarget) {
        inWave = false;
        restTimer = 2.0;
        flashText(`웨이브 ${wave} 클리어!`);
        addShake(4, 0.25);
      }

      // Bottom-touch game over is enforced in monster update
    } else {
      restTimer -= dt;
      if (restTimer <= 0) {
        // next wave
        wave++;
        waveKills = 0;
        waveKillTarget += 8;
        inWave = true;
        flashText(`웨이브 ${wave} 시작!`);
        // Scaling on new wave
        MAX_MONSTERS = Math.min(80, Math.floor(24 + wave*2.5));
        spawnInterval = Math.max(0.20, spawnInterval * 0.95);
      }
    }

    // Monster AI & physics
    const minXb = LANE.left+16, maxXb = LANE.right-16;
    const minYb = TRACK_TOP+10,  maxYb = TRACK_BOTTOM-8;

    for (const m of monsters) {
      if (m.dead) continue;
      // vectors
      const dx = player.x - m.x;
      const dy = player.y - m.y;
      const dist = Math.hypot(dx, dy) + 0.0001;
      const dirX = dx / dist, dirY = dy / dist;

      // stronger downward bias with difficulty
      m.vy += (m.downBias || 0) * 1.0 * dt;

      // boss behavior
      if (m.isBoss) {
        // Phase check
        if (!m.phase2 && m.hp <= Math.ceil(m.maxHp * 0.5)) {
          m.phase2 = true;
          flashText('보스 페이즈 2!');
          addShake(8, 0.5);
        }
        
        // slow drift towards player horizontally, stay upper half
        m.vx += dirX * 18 * dt;
        if (m.y < (TRACK_TOP + 120)) m.vy += 18 * dt; else m.vy *= 0.98;
        // shoot radial waves
        m.shootCd -= dt;
        if (m.shootCd <= 0) {
          bossShoot(m);
          m.shootCd = (m.phase2 ? 1.2 : 1.8) - (currentDiffKey==='hard'?0.4:(currentDiffKey==='normal'?0.2:0));
        }
      } else {
        // zigzag cadence
        m.zigzagTimer -= dt;
        if (m.zigzagTimer <= 0) {
          m.zigzagTimer = 0.28 + rng(0.45);
          m.vx += (Math.random() < 0.5 ? -1 : 1) * (40 + rng(90));
        }

        switch (m.ai) {
          case 'home':
            m.vx += dirX * 30 * dt;
            m.vy += dirY * 30 * dt;
            break;
          case 'pcharge': {
            const leadX = player.x + (player.targetX - player.x) * 0.7;
            const ddx = leadX - m.x;
            const ddy = player.y - m.y;
            const d2 = Math.hypot(ddx, ddy) + 0.0001;
            const lx = ddx/d2, ly = ddy/d2;
            m.dashCd -= dt;
            if (m.dashCd <= 0 && d2 > 40) {
              m.vx += lx * (190 + rng(120));
              m.vy += ly * (190 + rng(120));
              m.dashCd = 0.8 + rng(0.8);
            } else {
              m.vx += lx * 26 * dt;
              m.vy += ly * 26 * dt;
            }
            break;
          }
          case 'evade': {
            m.vx += dirX * 20 * dt;
            m.vy += dirY * 20 * dt;
            m.evadeCd -= dt;
            if (m.evadeCd <= 0) {
              let danger = null, bestD = 1e9;
              for (const b of bullets) {
                const d = Math.hypot(b.x - m.x, b.y - m.y);
                if (d < bestD && d < 120) { bestD = d; danger = b; }
              }
              if (danger) {
                const bv = Math.hypot(danger.vx, danger.vy) + 0.0001;
                const bx = danger.vx / bv, by = danger.vy / bv;
                const perpX = -by, perpY = bx;
                const sign = (Math.random() < 0.5 ? -1 : 1);
                m.vx += perpX * sign * (170 + rng(110));
                m.vy += perpY * sign * (130 + rng(70));
                m.evadeCd = 0.26 + rng(0.22);
              }
            }
            break;
          }
          case 'orbit': {
            m.orbitAngle += (1.0 + rng(0.3)) * dt;
            m.vx += dirX * 22 * dt + Math.cos(m.orbitAngle) * 56 * dt;
            m.vy += dirY * 22 * dt + Math.sin(m.orbitAngle) * 56 * dt;
            break;
          }
          case 'zigzag': {
            m.vx += dirX * 24 * dt + Math.sin(player.time*7 + m.noiseSeed) * 42 * dt;
            m.vy += dirY * 24 * dt;
            break;
          }
          case 'chaos': {
            const nx = Math.sin((player.time*2.0) + m.noiseSeed)*0.7 + Math.sin((player.time*2.6)+m.noiseSeed*1.3)*0.3;
            const ny = Math.cos((player.time*2.1) + m.noiseSeed*0.7)*0.7 + Math.cos((player.time*2.4)+m.noiseSeed*1.1)*0.3;
            m.vx += dirX * 20 * dt + nx * 70 * dt;
            m.vy += dirY * 20 * dt + ny * 70 * dt;
            break;
          }
        }
      }

      // speed clamp (higher with difficulty)
      const t = MONSTER_TYPES.find(t => t.name === m.type) || MONSTER_TYPES[0];
      const baseSpeed = (m.isBoss? 160 : (t?.speed || 100) + currentDiff.speedAdd);
      const maxS = baseSpeed + 130;
      const s = Math.hypot(m.vx, m.vy);
      if (s > maxS) { m.vx *= maxS/s; m.vy *= maxS/s; }

      // movement
      m.x += m.vx * dt;
      m.y += m.vy * dt;

      // friction
      m.vx *= 0.985; m.vy *= 0.988;

      // bounce left/right/top; bottom = GAME OVER
      if (m.x < minXb) { m.x = minXb; m.vx = Math.abs(m.vx); }
      if (m.x > maxXb) { m.x = maxXb; m.vx = -Math.abs(m.vx); }
      if (m.y < minYb) { m.y = minYb; m.vy = Math.abs(m.vy); }
      const breachMargin = 10;
      if (m.y - (m.size?m.size/2:16) >= maxYb + breachMargin) {
        endGame(false, '몬스터가 방어선을 돌파했습니다!');
        return;
      }

      // player touch damage: HP -= monster.hp, monster disappears (no split)
      if (Math.abs(m.x - player.x) < (m.size/2 + player.w/2 - 4) &&
          Math.abs(m.y - player.y) < (m.size/2 + player.h/2 - 6)) {
        if (player.invincibleTimer <= 0) {
          takeDamage(m.hp);
          player.invincibleTimer = 0.25;
          // touch death without split
          killMonster(m, 'touch');
        }
      }

      if (m.hitFlash > 0) m.hitFlash -= dt;
    }

    // Enemy bullets update & collision
    for (let i=enemyBullets.length-1;i>=0;i--) {
      const eb = enemyBullets[i];
      eb.x += eb.vx * dt;
      eb.y += eb.vy * dt;
      eb.life -= dt;
      if (Math.abs(eb.x - player.x) < (eb.r + player.w/2 - 6) &&
          Math.abs(eb.y - player.y) < (eb.r + player.h/2 - 6)) {
        // bullet hit
        enemyBullets.splice(i,1);
        takeDamage(1);
        continue;
      }
      if (eb.life <= 0 || eb.x < 0 || eb.x > W || eb.y < 0 || eb.y > H) {
        enemyBullets.splice(i,1);
      }
    }

    // Bullets & hits (player bullets)
    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      for (const m of monsters) {
        if (m.dead || m.hp <= 0) continue;
        if (Math.abs(b.x - m.x) < (m.size*0.55) && Math.abs(b.y - m.y) < (m.size*0.55)) {
          m.hp -= 1;
          m.hitFlash = 0.15;
          b.life = 0;
          spawnBurst(m.x, m.y, 6, '#ffffff', 130, 0.25);
          if (m.hp <= 0) {
            killMonster(m, 'bullet');
          }
        }
      }
    }

    // Cleanup bullets
    for (let i=bullets.length-1;i>=0;i--) {
      const b = bullets[i];
      if (b.life <= 0 || b.y < -40 || b.x < 0 || b.x > W || b.y > H+40) bullets.splice(i,1);
    }

    // Cleanup monsters (remove dead)
    for (let i=monsters.length-1;i>=0;i--) {
      if (monsters[i].dead) monsters.splice(i,1);
    }

    // Particles
    for (let i=particles.length-1;i>=0;i--) {
      const p = particles[i];
      p.vx *= 0.98; p.vy += 240*dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i,1);
    }

    // Remove consumed gates behind
    const beyond = levelZ - 100;
    while (gates.length && gates[0].z < beyond) gates.shift();
  }

  function toScreenY(z) { return TRACK_BOTTOM - (z - levelZ); }

  // Drawing
  function drawTrack() {
    ctx.fillStyle = '#eaf2ff';
    ctx.fillRect(LANE.left-60, TRACK_TOP-20, (LANE.right-LANE.left)+120, TRACK_BOTTOM-TRACK_TOP+40);
    ctx.strokeStyle = '#c8dcff';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 16]);
    ctx.beginPath();
    ctx.moveTo(W/2, TRACK_TOP-10);
    ctx.lineTo(W/2, TRACK_BOTTOM+10);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawPlayer() {
    // Wait until image is ready
    if (!planeImg.complete) return;
    ctx.save();
    ctx.translate(player.x, player.y);
    const alpha = player.invincibleTimer > 0 ? 0.6 + 0.4 * Math.sin(player.invincibleTimer * 20) : 1;
    ctx.globalAlpha = alpha;
    // Draw plane centered on player (40x40)
    ctx.drawImage(planeImg, -20, -20, 40, 40);
    ctx.restore();

    // Keep existing HP badge
    drawBadge(`HP ${player.hp}`, player.x, player.y - 46);
  }

  

  function drawGates() {
    for (const g of gates) {
      if (g.consumed) continue;
      const gy = toScreenY(g.z);
      if (gy < TRACK_TOP-60 || gy > H+60) continue;
      drawGatePanel(g.x - g.w/2, gy - g.h/2, g.w, g.h, colorForOp(g.effect.op), g.effect);
    }
  }

  function colorForOp(op){
    if (op === '+') return '#3aa6ff';     // + blue
    if (op === '×') return '#ffd93a';     // × yellow
    if (op === '÷') return '#ff2a2a';     // ÷ intense red
    return '#ff5c6a';                     // - lighter red
  }

  function drawMonsters() {
    for (const m of monsters) {
      // body (scary-cute/boss)
      ctx.save();
      ctx.translate(m.x, m.y);
      // cape
      ctx.fillStyle = m.colors.cloak;
      ctx.beginPath();
      ctx.moveTo(-m.size*0.5, 0);
      ctx.quadraticCurveTo(0, m.size*0.7, m.size*0.5, 0);
      ctx.quadraticCurveTo(0, m.size*0.8, -m.size*0.5, 0);
      ctx.fill();
      // body
      const r = 10;
      ctx.fillStyle = m.colors.body;
      roundRect(ctx, -m.size/2, -m.size/2, m.size, m.size, r);
      ctx.fill();
      // horns
      ctx.fillStyle = m.colors.accent;
      ctx.beginPath();
      ctx.moveTo(-m.size*0.25, -m.size*0.5);
      ctx.lineTo(-m.size*0.45, -m.size*0.8);
      ctx.lineTo(-m.size*0.1, -m.size*0.55);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(m.size*0.25, -m.size*0.5);
      ctx.lineTo(m.size*0.45, -m.size*0.8);
      ctx.lineTo(m.size*0.1, -m.size*0.55);
      ctx.closePath(); ctx.fill();
      // eyes + fangs
      ctx.fillStyle = '#ffffff';
      const eyeW = m.isBoss? 10 : 6;
      ctx.fillRect(-8, -2, eyeW, 3);
      ctx.fillRect(2, -2, eyeW, 3);
      ctx.beginPath();
      ctx.moveTo(-4, 6); ctx.lineTo(-2, 10); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(4, 6); ctx.lineTo(2, 10); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill();

      if (m.hitFlash > 0) {
        ctx.globalAlpha = Math.min(1, m.hitFlash / 0.15);
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, -m.size/2, -m.size/2, m.size, m.size, r);
        ctx.fill();
      }
      ctx.restore();

      // HP label
      drawHp(`${m.hp}`, m.x, m.y - (m.size/2) - 14);
    }
  }

  function drawHp(text, x, y){
    ctx.save();
    ctx.font = 'bold 14px system-ui, sans-serif';
    const m = ctx.measureText(text);
    const w = m.width + 10;
    const h = 20;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, x - w/2, y - h/2, w, h, 10);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x - m.width/2, y);
    ctx.restore();
  }

  function drawBullets() {
    ctx.save();
    ctx.fillStyle = '#2c74ff';
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEnemyBullets() {
    ctx.save();
    ctx.fillStyle = '#f6d2ff';
    for (const b of enemyBullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBomb() {
    if (!bomb) return;
    ctx.save();
    ctx.translate(bomb.x, bomb.y);
    // simple cartoon bomb
    ctx.fillStyle = '#333333';
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#ffd966';
    ctx.fillRect(-2, -14, 4, 6); // fuse
    ctx.beginPath();
    ctx.arc(0, -18, 3, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
  // drawBoots removed (boots disabled)
function drawUI() {
    // Score (top-left)
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillStyle = '#0b2a6d';
    const sTxt = `SCORE: ${Math.floor(score)}`;
    ctx.fillText(sTxt, 14, 22);
  // top bar
    ctx.fillStyle = '#cfe5ff';
    ctx.fillRect(0, 0, W, 50);
    ctx.fillStyle = '#e6f1ff';
    ctx.beginPath();
    ctx.moveTo(0, 50); ctx.lineTo(150, 30); ctx.lineTo(300, 50); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(500, 50); ctx.lineTo(700, 20); ctx.lineTo(900, 50); ctx.closePath(); ctx.fill();

    // Wave indicator (top-right)
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillStyle = '#0b2a6d';
    const diffText = `웨이브 ${wave}/∞`;
    const mt = ctx.measureText(diffText);
    ctx.fillText(diffText, W - mt.width - 14, 20);

    if (flash.timer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, flash.timer);
      ctx.font = 'bold 32px system-ui, sans-serif';
      ctx.fillStyle = '#102a6b';
      const m = ctx.measureText(flash.text);
      ctx.fillText(flash.text, (W - m.width)/2, 86);
      ctx.restore();
    }
  }

  function drawBadge(text, x, y) {
    ctx.save();
    ctx.font = 'bold 16px system-ui, sans-serif';
    const pad = 8;
    const m = ctx.measureText(text);
    const w = m.width + pad*2;
    const h = 26;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = '#cfe0ff';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x - w/2, y - h/2, w, h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0b2a6d';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x - m.width/2, y);
    ctx.restore();
  }

  function drawGatePanel(x,y,w,h,bg,effect) {
    ctx.save();

    // Glow for special gates
    if (effect.op === '×') {
      const glowGrad = ctx.createRadialGradient(x+w/2, y+h/2, w*0.2, x+w/2, y+h/2, w*0.8);
      glowGrad.addColorStop(0, 'rgba(255,230,100,0.4)');
      glowGrad.addColorStop(1, 'rgba(255,230,100,0.0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(x+w/2, y+h/2, w*0.8, 0, Math.PI*2);
      ctx.fill();
    } else if (effect.op === '÷') {
      // Tight rectangular glow hugging the panel
      ctx.save();
      ctx.fillStyle = 'rgba(255,60,60,0.28)';
      roundRect(ctx, x-6, y-6, w+12, h+12, 12);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = bg;
    roundRect(ctx, x,y,w,h,10);
    ctx.fill();
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    const text = `${effect.op}${effect.val}`;
    const m = ctx.measureText(text);
    ctx.fillText(text, x + (w - m.width)/2, y + h/2 + 10);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  // Particles
  function spawnBurst(x, y, count, color, speed, life) {
    for (let i=0;i<count;i++) {
      const a = Math.random()*Math.PI*2;
      const v = (0.4 + Math.random()*0.6) * speed;
      const p = {
        x, y, vx: Math.cos(a)*v, vy: Math.sin(a)*v,
        r: 2 + Math.random()*3, color, life, maxLife: life
      };
      particles.push(p);
    }
  }

  // Flash popup
  let flash = {text:'', timer: 0};
  function flashText(t){
    flash.text = t;
    flash.timer = 0.8;
  }

  // Loop
  let last = 0;
  function loop(ts){
    if (!running) return;
    const dt = Math.min(0.033, (ts - last)/1000);
    last = ts;

    if (!paused) update(dt);

    
    // Ensure high score persists when surpassed
    if (score > highScore) { highScore = Math.floor(score); localStorage.setItem('mf_highscore', String(highScore)); updateHiscoreUI(); }
// camera shake transform
    ctx.save();
    if (shakeTime > 0) {
      const dx = (Math.random()*2-1) * shakeIntensity;
      const dy = (Math.random()*2-1) * shakeIntensity;
      ctx.translate(dx, dy);
    }

    ctx.clearRect(0,0,W,H);
    drawUI();
    drawTrack();
    drawGates();
    drawMonsters();
    drawBullets();
    drawEnemyBullets();
    drawParticles();
    drawBomb();
    // drawBoots() removed
    drawPlayer();

    ctx.restore();

    if (flash.timer > 0) flash.timer -= dt;
    requestAnimationFrame(loop);
  }

  function showOverlay(title, msg){
    uiOverlay.innerHTML = `
      <div class="panel">
        <h2>${title}</h2>
        <p>${msg}</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="ovRetry">다시하기</button>
          <button id="ovClose">메뉴로</button>
        </div>
      </div>
    `;
    uiOverlay.classList.remove('hidden');
    document.getElementById('ovRetry').onclick = () => { resetGame(); uiOverlay.classList.add('hidden'); paused=false; };
    document.getElementById('ovClose').onclick = () => { location.reload(); };
  }

  function endGame(victory, reason){
    paused = true;
    setTimeout(()=>{
      const title = victory ? '승리!' : '게임 오버';
      const msg = (reason || (victory?'잘 막아냈습니다!':'병사의 체력이 0이 되었습니다.')) + `<br/><b>최종 점수: ${Math.floor(score)}</b>`;
      showOverlay(title, msg);
    }, 250);
  }

  function start() {
    running = true;
    paused = false;
    last = performance.now();
    resetGame();
    updateHiscoreUI();
    uiOverlay.classList.add('hidden');
    requestAnimationFrame(loop);
  }

  // Buttons
  btnStart?.addEventListener('click', start);
  btnRestart.addEventListener('click', () => { if (score > highScore) { highScore = Math.floor(score); localStorage.setItem('mf_highscore', String(highScore)); }
    resetGame(); paused=false; updateHiscoreUI(); });
  btnPause.addEventListener('click', () => { paused = !paused; if (score > highScore) { highScore = Math.floor(score); localStorage.setItem('mf_highscore', String(highScore)); updateHiscoreUI(); } if (btnPause) btnPause.textContent = paused ? '계속' : '일시정지'; });
  difficultySel?.addEventListener('change', (e)=>{ /* applies on next reset */ });

  resetGame(); // initial state reflects Easy by default
})();
