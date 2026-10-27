/**
 * make-manual-video.js — 把《模型配置操作手册》做成一支短视频
 *
 * 做法：真实后台截图 + 说明字幕 → 浏览器渲染成 1920x1080 画面 → ffmpeg 做缓慢推拉镜头（Ken Burns）→ 拼接成片
 * 不用 AI 生成画面：手册讲的是具体后台操作，真实截图比空镜有说服力
 *
 * 用法：NODE_PATH=<puppeteer-core所在 node_modules> node make-manual-video.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const SHOTS = '/Users/happy/Code/sandbox/radar/docs/screenshots';
const WORK = '/tmp/manual-video';
const OUT = '/Users/happy/Code/sandbox/radar/docs/模型配置操作手册-短视频.mp4';
const W = 1920, H = 1080, FPS = 30;

const dataUri = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');

// ---------- 分镜脚本 ----------
const STORY = [
  { kind: 'cover', dur: 5, chip: '图文版', title: '模型配置操作手册', sub: '电商登录防撞库 ·「同 IP 10 分钟内用 ≥3 个设备登录就拒绝」', foot: '风控引擎管理平台 · 约 70 秒看完' },
  { img: '01-model-list.png', dur: 7, chip: '全局', title: '一个模型 = 6 个 tab', sub: '配置顺序固定：字段 → 预处理 → 名单 → 抽象 → 规则 → 策略，前一步的输出是后一步的输入', points: ['业务方传事件 → 抽象算统计值', '规则比较阈值加分', '策略按分数给出 pass / review / reject'] },
  { img: '02-model-detail-tab1.png', dur: 6, chip: 'Step 1', title: '字段管理 —— 模型的地基', sub: '它定义「这个模型认识哪些字段」，后面所有 tab 都建立在它之上' },
  { img: '09-dialog-field-new.png', dur: 6, chip: 'Step 1', title: '新增字段', sub: '两个硬规矩：抽象用到的字段必须勾「是否索引」；字段名必须和业务方 JSON 的 key 一模一样' },
  { img: '04-tab-preitem.png', dur: 5, chip: 'Step 2', title: '预处理管理', sub: '对原始字段做一次加工，产出衍生字段：IP 归属地、手机号归属地、号码段' },
  { img: '05-tab-bwlist.png', dur: 5, chip: 'Step 3', title: '黑 / 白名单', sub: '带优先级的事件过滤器：命中白名单直接放行，命中黑名单直接拒绝，不消耗抽象查询' },
  { img: '06-tab-abstraction.png', dur: 7, chip: 'Step 4', title: '抽象处理 —— 本例的核心', sub: '把「原始事件流」压缩成「滑窗统计值」，14 个指标就是风控的仪表盘' },
  { img: '10-dialog-abstraction-new.png', dur: 7, chip: 'Step 4', title: '配置一个去重计数指标', sub: '统计窗口 10 分钟 · 按 userIP 圈定 · 数不同 deviceId 有几个', highlight: '10分钟内IP关联设备数 ≥ 3 → 触发' },
  { img: '08-tab-activation.png', dur: 6, chip: 'Step 5', title: '策略：分数 → 决策', sub: '警戒值 40 → review/warn，拒绝值 80 → reject，开关打开才生效' },
  { img: '11-rule-list.png', dur: 7, chip: 'Step 5', title: '规则：命中就加分', sub: '引用抽象指标 + 比较符 + 阈值 + 命中加几分，本例命中一次加 100 分' },
  { kind: 'verify', dur: 7, chip: 'Step 6', title: '验证：同 IP 换 3 个设备连打 3 次', sub: '第 3 次 distinct(deviceId)=3 ≥ 3 → 命中规则 → 100 分 ≥ 拒绝值 80' },
  { kind: 'end', dur: 5, chip: '', title: '顶栏「使用手册」随时可看', sub: '登录后台 → 右上角「使用手册」→ 11 章图文版，含全部真实截图与可复制命令', foot: 'radar · 模型配置操作手册' },
];

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;overflow:hidden;
  font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  background:radial-gradient(1200px 700px at 18% 12%,#1b4f86 0%,#123a63 60%,#0a1c33 100%),#0a1c33;color:#fff}
body::before{content:"";position:absolute;inset:0;
  background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);
  background-size:60px 60px}
.stage{position:relative;width:100%;height:100%;padding:64px 88px;display:flex;flex-direction:column}
.chip{display:inline-block;align-self:flex-start;padding:8px 20px;border-radius:999px;background:rgba(53,194,255,.16);
  border:1px solid rgba(53,194,255,.45);color:#7fd8ff;font-size:22px;font-weight:600;letter-spacing:.5px}
h1{font-size:64px;line-height:1.15;font-weight:700;margin-top:18px;text-shadow:0 4px 24px rgba(0,0,0,.35)}
.sub{font-size:27px;line-height:1.5;color:rgba(255,255,255,.8);margin-top:16px;max-width:1500px}
.pts{margin-top:18px;font-size:23px;color:rgba(255,255,255,.72);line-height:1.7}
.pts li{margin-left:26px}
.hl{margin-top:20px;display:inline-block;padding:12px 24px;border-radius:10px;
  background:linear-gradient(90deg,rgba(53,194,255,.22),rgba(53,194,255,.05));
  border-left:4px solid #35c2ff;color:#cdeeff;font-size:26px;font-weight:600}
.card{margin-top:26px;flex:1;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.97);border-radius:18px;padding:14px;
  box-shadow:0 30px 80px rgba(0,0,0,.45);overflow:hidden}
.card img{width:100%;height:100%;object-fit:cover;object-position:center;display:block}
.foot{position:absolute;left:88px;right:88px;bottom:34px;display:flex;align-items:center;gap:20px;
  font-size:20px;color:rgba(255,255,255,.55)}
.bar{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.16);overflow:hidden}
.bar i{display:block;height:100%;background:linear-gradient(90deg,#35c2ff,#7ee8ff);border-radius:2px}
/* 封面/结尾 */
.center{justify-content:center;align-items:center;text-align:center}
.center h1{font-size:88px;margin-top:0}
.center .sub{max-width:1250px;text-align:center;font-size:30px}
.kicker{font-size:24px;color:#7fd8ff;letter-spacing:6px;margin-bottom:22px}
.rule{width:180px;height:5px;border-radius:3px;background:linear-gradient(90deg,#35c2ff,#7ee8ff);margin:34px 0}
.foot-c{position:absolute;bottom:56px;left:0;right:0;text-align:center;font-size:24px;color:rgba(255,255,255,.5)}
/* 验证卡 */
pre.json{width:100%;height:100%;margin:0;background:#0b1526;border-radius:12px;padding:28px 32px;
  font-family:"SF Mono",Menlo,Consolas,monospace;font-size:25px;line-height:1.62;color:#cfe3ff;overflow:hidden;white-space:pre}
.k{color:#7fd8ff}.s{color:#ffc98c}.n{color:#9fe6a0}.c{color:#7f8ea3}.b{color:#ff8fa3}
.verdict{margin-top:22px;display:flex;gap:18px;align-items:center}
.tag{padding:14px 28px;border-radius:12px;font-size:30px;font-weight:700}
.tag.bad{background:rgba(255,86,120,.18);border:1px solid rgba(255,110,140,.55);color:#ff9fb3}
.tag.ok{background:rgba(90,220,160,.15);border:1px solid rgba(110,230,180,.5);color:#8fe8c4}
`;

function shotHtml(s, idx, total) {
  const pct = Math.round(((idx + 1) / total) * 100);
  const foot = (extra = '') => `<div class="foot">${extra}<div class="bar"><i style="width:${pct}%"></i></div><span>${idx + 1} / ${total}</span></div>`;

  if (s.kind === 'cover' || s.kind === 'end') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
      <div class="stage center">
        ${s.kind === 'cover' ? `<div class="kicker">风控引擎管理平台</div>` : ''}
        <h1>${s.title}</h1>
        <div class="rule"></div>
        <div class="sub">${s.sub}</div>
        <div class="foot-c">${s.foot || ''}</div>
      </div></body></html>`;
  }

  if (s.kind === 'verify') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
      <div class="stage">
        <span class="chip">${s.chip}</span>
        <h1>${s.title}</h1>
        <div class="sub">${s.sub}</div>
        <div class="card" style="padding:0;background:transparent;box-shadow:none">
          <pre class="json">{
  <span class="k">"success"</span>: <span class="n">true</span>,
  <span class="k">"activations"</span>: {
    <span class="k">"login_exception"</span>: { <span class="k">"risk"</span>: <span class="b">"reject"</span>, <span class="k">"score"</span>: <span class="n">100</span> }
  },
  <span class="k">"hitsDetail"</span>: {
    <span class="k">"login_exception"</span>: [
      { <span class="k">"key"</span>: <span class="s">"442"</span>, <span class="k">"value"</span>: <span class="n">100</span>,
        <span class="k">"desc"</span>: <span class="s">"10分钟内IP关联设备数大于等于3"</span> }
    ]
  }
}</pre>
        </div>
        <div class="verdict">
          <div class="tag bad">第 3 次 → reject</div>
          <div class="tag ok">换新 IP → pass</div>
          <div class="tag ok">Mongo 落库 3 条，eventId 去重生效</div>
        </div>
        ${foot()}
      </div></body></html>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
    <div class="stage">
      <span class="chip">${s.chip}</span>
      <h1>${s.title}</h1>
      <div class="sub">${s.sub}</div>
      ${s.points ? `<ul class="pts">${s.points.map((p) => `<li>${p}</li>`).join('')}</ul>` : ''}
      ${s.highlight ? `<div class="hl">${s.highlight}</div>` : ''}
      <div class="card"><img src="${dataUri(path.join(SHOTS, s.img))}"></div>
      ${foot('模型配置操作手册')}
    </div></body></html>`;
}

// ---------- 渲染画面 ----------
async function renderFrames() {
  fs.mkdirSync(WORK, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const files = [];
  for (let i = 0; i < STORY.length; i++) {
    const f = path.join(WORK, `frame-${String(i).padStart(2, '0')}.png`);
    await p.setContent(shotHtml(STORY[i], i, STORY.length), { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 260));
    await p.screenshot({ path: f });
    files.push(f);
    process.stdout.write(`  渲染 ${i + 1}/${STORY.length} ${path.basename(f)}\n`);
  }
  await b.close();
  return files;
}

// ---------- 每段做缓慢推拉镜头 ----------
function kenBurns(frame, durSec, outFile) {
  const frames = Math.round(durSec * FPS);
  execFileSync(FFMPEG, [
    '-y', '-loop', '1', '-i', frame,
    '-vf', `scale=2560:1440:flags=lanczos,zoompan=z='min(zoom+0.00035,1.12)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},fade=t=in:st=0:d=0.4,fade=t=out:st=${(durSec - 0.4).toFixed(2)}:d=0.4,format=yuv420p`,
    '-t', String(durSec), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    outFile,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
}

// ---------- 拼接 ----------
function concat(segments, out) {
  const listFile = path.join(WORK, 'concat.txt');
  fs.writeFileSync(listFile, segments.map((s) => `file '${s}'`).join('\n'));
  execFileSync(FFMPEG, [
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-r', String(FPS), out,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
}

(async () => {
  console.log('1) 渲染分镜画面…');
  const frames = await renderFrames();
  console.log('2) 生成推拉镜头片段…');
  const segs = [];
  for (let i = 0; i < frames.length; i++) {
    const seg = path.join(WORK, `seg-${String(i).padStart(2, '0')}.mp4`);
    kenBurns(frames[i], STORY[i].dur, seg);
    segs.push(seg);
    process.stdout.write(`  片段 ${i + 1}/${frames.length}（${STORY[i].dur}s）\n`);
  }
  console.log('3) 合成成片…');
  concat(segs, OUT);
  const total = STORY.reduce((a, b) => a + b.dur, 0);
  console.log(`完成：${OUT}`);
  console.log(`时长约 ${total} 秒，分辨率 ${W}x${H}，帧率 ${FPS}fps`);
})();