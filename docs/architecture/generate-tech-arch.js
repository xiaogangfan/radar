/**
 * generate-tech-arch.js — 生成 radar 风控引擎平台的技术架构图（.drawio）
 *
 * 交付物：docs/architecture/radar-tech-architecture.drawio（唯一交付物）
 * 自检：导出 PNG 到 /tmp 看一眼即弃（脚本头部的 OUT 指向 /tmp），不留在交付目录
 * 停做：不导出 PNG/SVG/HTML 版到交付目录（用户要求只留可编辑源）
 *
 * 图上的每个组件都对着源码核过：
 *  - 模块：radar-admin / radar-engine / radar-service / radar-service-impl / radar-dal / radar-dao / radar-commons
 *  - 端口：application.yml 里 admin=6580、engine=6581；本地 watchdog 用 --server.port覆盖为 6581/ 6582
 *  - MySQL 3306/radar（配置）、MongoDB 27017/radar（事件）、Redis 9300 db1（结果缓存 + 配置频道）、ES 9200（命中明细）
 *  - Redis 配置频道 8 个：radar_channel_model/field/preitem/abstraction/rule/activation/listrecord/datalist
 *  - 结果缓存 key：radar_engine_<modelId><sessionId>，TTL 5 分钟（CacheServiceImpl）
 *  - 预处理插件：IP2LOCATION / MOBILE2LOCATION / SUBSTRING（radar-service-impl/engine/plugin）
 */
const fs = require('fs');
const path = require('path');

// ---------- 布局常量（要调间距只改这里，下面全部自动跟随） ----------
const BAND_X = 60;
const BAND_W = 1600;
const GAP = 50;          // 层与层的缝
const LANE_HDR = 46;     // swimlane 标题带高度

const L1_Y = 96,  L1_H = 130;                       // 接入层
const L2_Y = L1_Y + L1_H + GAP, L2_H = 258;         // 应用层
const L3_Y = L2_Y + L2_H + GAP, L3_H = 230;         // 领域服务层
const L4_Y = L3_Y + L3_H + GAP, L4_H = 138;         // 数据访问层
const L5_Y = L4_Y + L4_H + GAP, L5_H = 176;         // 存储层
const L6_Y = L5_Y + L5_H + GAP, L6_H = 112;         // 外部依赖
const CANVAS_W = 1780;   // 右侧留出注释栏
const CANVAS_H = L6_Y + L6_H + 40;

const C = {
  laneEdge: '#9aa4b2', laneFont: '#1f2d3d',
  access:  { fill: '#dae8fc', stroke: '#6c8ebf' },
  app:     { fill: '#d5e8d4', stroke: '#82b366' },
  service: { fill: '#ffe6cc', stroke: '#d79b00' },
  dal:     { fill: '#e1d5e7', stroke: '#9673a6' },
  store:   { fill: '#fff2cc', stroke: '#d6b656' },
  ext:     { fill: '#f5f5f5', stroke: '#999999' },
};

let cells = [];
let id = 0;
const nid = (p) => `${p}${++id}`;

function add(xml) { cells.push(xml); }

// 泳道（层）
function lane(name, y, h, color) {
  const lid = nid('lane');
  add(`<mxCell id="${lid}" value="${name}" style="swimlane;startSize=${LANE_HDR};html=1;horizontal=1;fillColor=${color.fill};strokeColor=${color.stroke};fontColor=${C.laneFont};fontSize=15;fontStyle=1;rounded=0;pointerEvents=0;" vertex="1" parent="1">
    <mxGeometry x="${BAND_X}" y="${y}" width="${BAND_W}" height="${h}" as="geometry"/>
  </mxCell>`);
  return lid;
}

// 普通块
function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function box(parent, x, y, w, h, value, style = '') {
  const bid = nid('b');
  add(`<mxCell id="${bid}" value="${esc(value)}" style="rounded=1;arcSize=12;whiteSpace=wrap;html=1;${style}" vertex="1" parent="${parent}">
    <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>
  </mxCell>`);
  return bid;
}

// 存储块（圆柱）
function store(parent, x, y, w, h, value) {
  const bid = nid('s');
  add(`<mxCell id="${bid}" value="${esc(value)}" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=12;fillColor=${C.store.fill};strokeColor=${C.store.stroke};fontSize=12.5;" vertex="1" parent="${parent}">
    <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>
  </mxCell>`);
  return bid;
}

function edge(source, target, opts = {}) {
  const { label = '', style = '', points = null, exit = '', entry = '' } = opts;
  const eid = nid('e');
  const pts = points
    ? `<Array as="points">${points.map((p) => `<mxPoint x="${p[0]}" y="${p[1]}"/>`).join('')}</Array>`
    : '';
  add(`<mxCell id="${eid}" value="${label}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;jettySize=auto;html=1;fontSize=11.5;fontColor=#5a6472;labelBackgroundColor=#ffffff;${exit}${entry}${style}" edge="1" parent="1" source="${source}" target="${target}">
    <mxGeometry relative="1" as="geometry">${pts}</mxGeometry>
  </mxCell>`);
  return eid;
}

// 独立文字块（不压在连线上）
function note(x, y, w, h, value, style = '') {
  const nid2 = nid('n');
  add(`<mxCell id="${nid2}" value="${esc(value)}" style="text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;${style}" vertex="1" parent="1">
    <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>
  </mxCell>`);
  return nid2;
}

// ================= 各层内容 =================

// 顶部：两条主流程说明（占标题右侧空白）
note(980, 12, 680, 72,
  `<b>两条主流程</b><br>` +
  `<b>① 配置流</b>（左→右）：admin 改配置 → 写 MySQL → 发 Redis 频道 → 引擎收到热更新，<b>不用重启</b><br>` +
  `<b>② 调用流</b>：业务方事件 → 引擎落 Mongo → 抽象算滑窗值 → 规则打分 → 策略定级 → 返回 + 结果缓存 5 分钟`,
  'fontSize=12.5;fontColor=#3c4654;lineHeight=1.5;');

// ---- L1 接入层 ----
const l1 = lane('接入层', L1_Y, L1_H, C.access);
const caller = box(l1, 40, 52, 620, 64,
  '<b>业务方系统</b>（HTTP 调用方）<br><span style="font-size:11.5px;color:#5a6472">POST /services/v1/upload　携带 guid + 事件 JSON</span>',
  `fillColor=${C.access.fill};strokeColor=${C.access.stroke};fontSize=13.5;`);
const operator = box(l1, 700, 52, 500, 64,
  '<b>风控运营</b>（浏览器）<br><span style="font-size:11.5px;color:#5a6472">模型配置 / 事件检索 / 报表查询</span>',
  `fillColor=${C.access.fill};strokeColor=${C.access.stroke};fontSize=13.5;`);
const retNote = box(l1, 1240, 52, 320, 64,
  '<b>返回</b>　risk / score / hitsDetail<br><span style="font-size:11.5px;color:#5a6472">按 sessionId 可在 5 分钟内复查</span>',
  `fillColor=#ffffff;strokeColor=${C.access.stroke};dashed=1;fontSize=13.5;`);

// ---- L2 应用层 ----
const l2 = lane('应用层', L2_Y, L2_H, C.app);
const engine = box(l2, 40, 52, 740, 196,
  '<b>radar-engine · 风控引擎</b>　<span style="font-size:11.5px;color:#5a6472">默认 6581 / 本地 6582</span>',
  `fillColor=${C.app.fill};strokeColor=${C.app.stroke};fontSize=14;verticalAlign=top;spacingTop=8;`);
const eIn = box(engine, 16, 46, 708, 42, '事件接入：校验 guid 与模型是否激活',
  'fillColor=#ffffff;strokeColor=#82b366;fontSize=12.5;');
const eAbs = box(engine, 16, 96, 708, 42, '抽象计算：滑窗统计（count / distinct）',
  'fillColor=#ffffff;strokeColor=#82b366;fontSize=12.5;');
const eRule = box(engine, 16, 146, 708, 42, '规则打分 → 策略判定 → 生成风险结论',
  'fillColor=#ffffff;strokeColor=#82b366;fontSize=12.5;');

const admin = box(l2, 820, 52, 740, 196,
  '<b>radar-admin · 管理后台</b>　<span style="font-size:11.5px;color:#5a6472">默认 6580 / 本地 6581</span>',
  `fillColor=${C.app.fill};strokeColor=${C.app.stroke};fontSize=14;verticalAlign=top;spacingTop=8;`);
const aCfg = box(admin, 16, 46, 708, 42, '模型配置 CRUD：6 个 tab + 业务线 / 场景维度',
  'fillColor=#ffffff;strokeColor=#82b366;fontSize=12.5;');
const aQry = box(admin, 16, 96, 708, 42, '事件检索（Mongo）与命中明细查询（ES）',
  'fillColor=#ffffff;strokeColor=#82b366;fontSize=12.5;');
const aDoc = box(admin, 16, 146, 708, 42, '内置图文版使用手册 /manual.html',
  'fillColor=#ffffff;strokeColor=#82b366;fontSize=12.5;');

// ---- L3 领域服务层 ----
const l3 = lane('领域服务层（radar-service / radar-service-impl）', L3_Y, L3_H, C.service);
const svcApi = box(l3, 40, 52, 740, 168,
  '<b>radar-service　接口层</b><br><br>' +
  'ModelService · AbstractionService · RuleService · ActivationService<br>' +
  'EventService · DataListService · CacheService · SearchEngineService',
  `fillColor=${C.service.fill};strokeColor=${C.service.stroke};fontSize=13;align=left;spacingLeft=16;verticalAlign=middle;`);
const svcImpl = box(l3, 820, 52, 740, 168,
  '<b>radar-service-impl　实现层</b><br><br>' +
  '模型 / 抽象 / 规则 / 策略 / 名单 的业务实现<br>' +
  '预处理插件：IP2LOCATION · MOBILE2LOCATION · SUBSTRING',
  `fillColor=${C.service.fill};strokeColor=${C.service.stroke};fontSize=13;align=left;spacingLeft=16;verticalAlign=middle;`);

// ---- L4 数据访问层 ----
const l4 = lane('数据访问层', L4_Y, L4_H, C.dal);
const dal = box(l4, 40, 46, 740, 76,
  '<b>radar-dal</b>　DAO 封装，屏蔽 MyBatis / tkMapper 细节',
  `fillColor=${C.dal.fill};strokeColor=${C.dal.stroke};fontSize=13;`);
const dao = box(l4, 820, 46, 740, 76,
  '<b>radar-dao</b>　ModelPO / RulePO 等 PO + Mapper（tkMapper Example）',
  `fillColor=${C.dal.fill};strokeColor=${C.dal.stroke};fontSize=13;`);

// ---- L5 存储层 ----
const l5 = lane('存储层', L5_Y, L5_H, C.store);
const mysql = store(l5, 40, 50, 370, 106,
  '<b>MySQL</b> 3306 / radar<br><span style="font-size:11.5px">模型配置：字段 · 预处理 · 抽象<br>规则 · 策略 · 黑白名单 · 场景</span>');
const mongo = store(l5, 440, 50, 370, 106,
  '<b>MongoDB</b> 27017 / radar<br><span style="font-size:11.5px">事件明细 entity_&lt;模型ID&gt;<br>按 eventId 去重 · 抽象滑窗数据源</span>');
const redis = store(l5, 840, 50, 370, 106,
  '<b>Redis</b> 9300 db1<br><span style="font-size:11.5px">结果缓存 radar_engine_*（5 分钟）<br>配置频道 radar_channel_*（8 个）</span>');
const es = store(l5, 1240, 50, 320, 106,
  '<b>Elasticsearch</b> 9200<br><span style="font-size:11.5px">命中明细归档与检索</span>');

// ---- L6 外部依赖 ----
const l6 = lane('外部依赖', L6_Y, L6_H, C.ext);
const ext = box(l6, 40, 46, 740, 52,
  'IP / 手机号归属地查询服务　<span style="font-size:11.5px;color:#5a6472">预处理插件调用，可替换为本地库</span>',
  `fillColor=${C.ext.fill};strokeColor=${C.ext.stroke};dashed=1;fontSize=13;`);

// ================= 连线 =================
const X = BAND_X; //画布横轴起点

// 各存储块的水平中心（画布绝对坐标），用于把竖直段改成「先横后竖」
const CX = {
  mysql: X + 40 + 370 / 2,
  mongo: X + 440 + 370 / 2,
  redis: X + 840 + 370 / 2,
  es: X + 1240 + 320 / 2,
  ext: X + 40 + 740 / 2,
};
// 两条水平通道：分别走在数据访问层之上、存储层之上，避免竖线穿过块内文字
const CH_L4 = L4_Y - 26;   // 服务层 → 存储层
const CH_L5 = L5_Y - 26;   // 数据访问层 → 存储层

// 调用方 → 引擎
edge(caller, eIn, { label: '上传事件', exit: 'exitX=0.3;exitY=1;', entry: 'entryX=0.25;entryY=0;' });
// 返回（引擎 → 调用方方向的结果，虚线绕最左侧再从下方进接入层的结果框）
edge(eIn, retNote, {
  label: '', style: 'dashed=1;strokeColor=#6c8ebf;',
  exit: 'exitX=0;exitY=0.35;', entry: 'entryX=0;entryY=0.5;',
  points: [[X - 20, L2_Y + 150], [X - 20, L1_Y + L1_H + 16]],
});
// 运营 → 后台
edge(operator, aCfg, { label: '配置 / 查询', exit: 'exitX=0.4;exitY=1;', entry: 'entryX=0.4;entryY=0;' });

// 应用 → 服务层
edge(eRule, svcApi, { label: '调用', exit: 'exitX=0.35;exitY=1;', entry: 'entryX=0.35;entryY=0;' });
edge(aQry, svcImpl, { label: '调用', exit: 'exitX=0.35;exitY=1;', entry: 'entryX=0.35;entryY=0;' });
// 接口 ← 实现
edge(svcImpl, svcApi, {
  label: '实现接口', style: 'dashed=1;',
  exit: 'exitX=0;exitY=0.5;', entry: 'entryX=1;entryY=0.5;',
});

// 服务层 → 数据访问层
edge(svcImpl, dal, {
  label: '', exit: 'exitX=0.15;exitY=1;', entry: 'entryX=0.85;entryY=0;',
  points: [[CX.dal, L4_Y - 22]],
});
// 数据访问层 → MySQL（先横后竖，标签落在水平段上）
edge(dal, mysql, {
  label: '配置读写', exit: 'exitX=0.5;exitY=1;', entry: 'entryX=0.5;entryY=0;',
  points: [[CX.mysql, CH_L5]],
});
// 服务层 → Mongo / Redis / ES：统一走数据访问层上方的水平通道
edge(svcImpl, mongo, {
  label: '事件落库', exit: 'exitX=0.25;exitY=1;', entry: 'entryX=0.5;entryY=0;',
  points: [[CX.mongo, CH_L4]],
});
edge(svcImpl, redis, {
  label: '结果缓存 · 发配置频道', exit: 'exitX=0.45;exitY=1;', entry: 'entryX=0.5;entryY=0;',
  points: [[CX.redis, CH_L4]],
});
edge(svcImpl, es, {
  label: '命中明细异步归档', exit: 'exitX=0.65;exitY=1;', entry: 'entryX=0.5;entryY=0;',
  points: [[CX.es, CH_L4]],
});
// Redis → 引擎：配置热推送（右侧通道上行，不加边标签避免竖排）
edge(redis, eRule, {
  label: '',
  style: 'dashed=1;strokeColor=#d79b00;strokeWidth=1.5;',
  exit: 'exitX=1;exitY=0.2;', entry: 'entryX=1;entryY=0.85;',
  points: [[X + BAND_W + 36, L5_Y + 60], [X + BAND_W + 36, L2_Y + 150]],
});
note(X + BAND_W + 46, L2_Y + 250, 250, 60,
  '<span style="font-size:11.5px;color:#b8860b">引擎订阅 Redis 配置频道<br>改配置即时生效，不用重启</span>',
  'fontSize=11.5;');
// 服务层 → 外部依赖：沿最左侧空白通道下行，不压任何块
edge(svcImpl, ext, {
  label: '', exit: 'exitX=0.02;exitY=0.9;', entry: 'entryX=0;entryY=0.5;',
  points: [[X + 16, L3_Y + 150]],
});
// 外部依赖的说明文字（补上被去掉的边标签）
note(X + 60, L6_Y + 100, 900, 26,
  '<span style="font-size:11.5px;color:#5a6472">↑ 预处理插件按需调用（IP / 手机号归属地）</span>',
  'fontSize=11.5;');

// ---------- 输出 ----------
const xml = `<mxfile host="app.diagrams.net" agent="generate-tech-arch.js" version="24.0.0">
  <diagram id="radar-tech-arch" name="技术架构">
    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${CANVAS_W}" pageHeight="${CANVAS_H}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

const OUT = '/tmp/radar-tech-architecture.drawio';   // 自检产物在 /tmp，交付目录只放 .drawio
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, xml);
console.log('生成', OUT, '（cell 数：' + cells.length + '，画布 ' + CANVAS_W + 'x' + CANVAS_H + '）');
