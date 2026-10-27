/**
 * rule-formula.js — 规则得分算式可视化（radar-admin 原前端增强）
 *
 * 两处增强，都只读数据、只加 DOM，不改 main.js 里任何既有逻辑：
 *   1. 规则列表卡片右侧：显示这条规则的完整得分算式
 *      （初始得分 + 命中基数 操作符 (指标值 × 比率%)，最大值>0 时套 min）
 *   2. 展开的规则编辑表单右侧：实时算式预览
 *      —— 数值下方标注字段名、单独给出最大值封顶逻辑、算例与配置告警
 *
 * 数据来源：POST /services/v1/rule（只读查询）+ GET /services/v1/activation/feature/columns
 * 表单预览直接读 DOM 上的输入值，因此不用碰 React 组件状态，改哪个字段都能即时刷新。
 *
 * 以静态资源方式打进 BOOT-INF/classes/static/，由 index.html 引入。
 * 移除 index.html 中对本文件的引用即可整体下线。
 */
(function () {
  'use strict';
  if (window.__RDFORMULA__) return;
  window.__RDFORMULA__ = true;

  var API = '/services/v1';
  var OP_NAME = { NONE: '无', ADD: '加', SUB: '减', MUL: '乘', DIV: '除' };
  var OP_REV = { '无': 'NONE', '加': 'ADD', '减': 'SUB', '乘': 'MUL', '除': 'DIV' };
  var SYM = { ADD: '+', SUB: '−', MUL: '×', DIV: '÷' };

  var cache = {};        // activationId -> 数据
  var waiting = {};      // activationId -> [cb]
  var scanTimer = null;
  var lastPath = '';

  /* --------------------------- 基础工具 --------------------------- */

  function token() {
    return localStorage.getItem('x-auth-token') || '';
  }

  function api(path, method, body) {
    var opt = { credentials: 'include', headers: { 'x-auth-token': token() } };
    if (method && method !== 'GET') {
      opt.method = method;
      opt.headers['Content-Type'] = 'application/json';
      if (body != null) opt.body = JSON.stringify(body);
    }
    return fetch(API + path, opt).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () { return null; });
  }

  function txt(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function fmt(n) {
    if (!isFinite(n)) return '—';
    return String(Math.round(n * 100) / 100);
  }

  function riskOf(n) {
    return n >= 80 ? 'reject' : n >= 40 ? 'review' : 'pass';
  }

  function riskTxt(n) {
    return { reject: '拒绝', review: '复核', pass: '通过' }[riskOf(n)];
  }

  function hashInfo() {
    var m = (location.hash || '').match(/^#\/ruleList\/(\d+)\/(\d+)/);
    return m ? { modelId: m[1], activationId: m[2] } : null;
  }

  /* --------------------------- 算分（与引擎一致） --------------------------- */

  function calc(c, v) {
    var rate = num(c.rate) / 100;
    var extra = (typeof v === 'number' ? v : 0) * rate;
    switch (c.op) {
      case 'ADD': extra = num(c.base) + extra; break;
      case 'SUB': extra = num(c.base) - extra; break;
      case 'MUL': extra = num(c.base) * extra; break;
      case 'DIV': extra = extra === 0 ? NaN : Math.round((num(c.base) / extra) * 100) / 100; break;
      default: break;
    }
    var amount = num(c.init) + extra;
    if (num(c.max) > 0 && amount > num(c.max)) amount = num(c.max);
    return amount;
  }

  function calcRaw(c, v) {
    var rate = num(c.rate) / 100;
    var extra = (typeof v === 'number' ? v : 0) * rate;
    switch (c.op) {
      case 'ADD': extra = num(c.base) + extra; break;
      case 'SUB': extra = num(c.base) - extra; break;
      case 'MUL': extra = num(c.base) * extra; break;
      case 'DIV': extra = extra === 0 ? NaN : Math.round((num(c.base) / extra) * 100) / 100; break;
    }
    return num(c.init) + extra;
  }

  function calcText(c, v) {
    if (c.op === 'NONE' || !c.metric) return String(num(c.init));
    var inner = v + '×' + num(c.rate) + '%';
    var core;
    if (c.op === 'MUL') core = num(c.base) + '×(' + inner + ')';
    else if (c.op === 'DIV') core = num(c.base) + '÷(' + inner + ')';
    else if (c.op === 'ADD') core = '(' + num(c.base) + '+' + inner + ')';
    else core = '(' + num(c.base) + '−' + inner + ')';
    var s = num(c.init) + '+' + core;
    if (num(c.max) > 0) s = 'min(' + s + ', ' + num(c.max) + ')';
    return s;
  }

  function warnOf(c) {
    if (c.op === 'MUL' && num(c.base) === 0) return 'warn';
    if (num(c.max) > 0 && num(c.max) <= num(c.init)) return 'bad';
    if (c.op === 'DIV') return 'warn';
    return '';
  }

  /* --------------------------- 算式渲染 --------------------------- */

  function dispMetric(c) {
    return c.metricLabel || c.metric || '';
  }

  /* 完整算式的纯文本版本（用于 title 提示） */
  function plainFormula(c) {
    if (c.op === 'NONE' || !c.metric) return '得分 = ' + num(c.init);
    var inner = dispMetric(c) + ' × ' + num(c.rate) + '%';
    var core = (c.op === 'MUL' || c.op === 'DIV')
      ? num(c.base) + ' ' + SYM[c.op] + ' (' + inner + ')'
      : '(' + num(c.base) + ' ' + SYM[c.op] + ' ' + inner + ')';
    var body = num(c.init) + ' + ' + core;
    return num(c.max) > 0
      ? '得分 = min(' + body + ', ' + num(c.max) + ')'
      : '得分 = ' + body;
  }

  function pillHtml(c) {
    var h = '<span class="k">得分</span><span class="paren">=</span>';
    var cap = num(c.max) > 0;
    if (cap) h += '<span class="fn">min</span><span class="paren">(</span>';
    h += '<span class="n">' + num(c.init) + '</span>';
    if (c.op !== 'NONE' && c.metric) {
      h += '<span class="op">+</span>';
      if (c.op === 'MUL' || c.op === 'DIV') {
        h += '<span class="n">' + num(c.base) + '</span><span class="op">' + SYM[c.op] + '</span><span class="paren">(</span>';
      } else {
        h += '<span class="paren">(</span><span class="n">' + num(c.base) + '</span><span class="op">' + SYM[c.op] + '</span>';
      }
      h += '<span class="m">' + esc(dispMetric(c)) + '</span>';
      h += '<span class="op">×</span><span class="n">' + num(c.rate) + '%</span><span class="paren">)</span>';
    }
    if (cap) h += '<span class="paren">,</span><span class="n">' + num(c.max) + '</span><span class="paren">)</span>';
    return h;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 表单预览：带字段标注的算式 + 封顶逻辑 + 算例 + 提示 */
  function previewHtml(c) {
    var warn = warnOf(c);
    var h = '';

    h += '<div class="rd-live-head"><span class="t">得分算式</span><span class="live">实时</span></div>';
    h += '<div class="rd-live-fml">' + bigFormula(c) + '</div>';

    h += '<div class="rd-sep"></div><div class="rd-live-sub">封顶逻辑 <em>最大值</em></div>';
    h += '<div class="rd-cap"><span class="eq">最终得分 =</span>';
    if (num(c.max) > 0) {
      h += '<span class="fn">min</span><span class="sym">(</span><span class="raw">原始分</span>' +
           '<span class="sym">,</span>' + term(num(c.max), '最大值') + '<span class="sym">)</span>';
    } else {
      h += '<span class="raw">原始分</span><span class="tip">最大值 = 0，不封顶</span>';
    }
    h += '</div>';

    h += '<div class="rd-sep"></div><div class="rd-live-sub">算例 ' +
         (c.op === 'NONE' ? '' : '<em>V = 指标字段值</em>') + '</div>';
    if (c.op === 'NONE' || !c.metric) {
      var s0 = num(c.init);
      h += '<div class="rd-eg"><span class="v">规则命中</span><span class="calc">' + num(c.init) + '</span>' +
           '<span class="s">= ' + fmt(s0) + ' 分</span><span class="tag ' + riskOf(s0) + '">' + riskTxt(s0) + '</span></div>';
    } else {
      [10, 30, 60].forEach(function (v) {
        var s = calc(c, v);
        h += '<div class="rd-eg"><span class="v">V = ' + v + '</span>' +
             '<span class="calc">' + esc(calcText(c, v)) + '</span>' +
             '<span class="s">= ' + fmt(s) + ' 分</span>' +
             '<span class="tag ' + riskOf(s) + '">' + riskTxt(s) + '</span></div>';
      });
    }

    var note;
    if (warn === 'bad') note = '最大值 ≤ 初始得分，命中后会被压到 ' + num(c.max) + ' 分，比底分还低。';
    else if (c.op === 'MUL' && num(c.base) === 0) note = '命中基数为 0，×0 后指标不参与计分，得分恒为 ' + num(c.init) + ' 分。';
    else if (c.op === 'DIV') note = '除法没有除零保护：指标值为 0 时引擎会抛异常。';
    else if (num(c.max) > 0) {
      var raw60 = calcRaw(c, 60);
      note = '原始分超过 ' + num(c.max) + ' 分按 ' + num(c.max) + ' 分计' +
        (raw60 > num(c.max) ? '；例如 V=60 时原始分 ' + fmt(raw60) + '，最终 ' + num(c.max) + ' 分。' : '。');
    } else {
      note = '最大值 0 = 不封顶，原始分即最终得分。想让单条规则限高，在这里填正数。';
    }
    h += '<div class="rd-sep"></div><div class="rd-note ' + warn + '">' + esc(note) + '</div>';
    return h;
  }

  function term(val, label) {
    return '<span class="term"><span class="val"><b>' + val + '</b></span><em>' + label + '</em></span>';
  }

  function bigFormula(c) {
    var h = '<span class="eq">得分 =</span>';
    h += term(num(c.init), '初始得分');
    if (c.op === 'NONE' || !c.metric) return h;
    h += '<span class="sym">+</span>';
    if (c.op === 'MUL' || c.op === 'DIV') {
      h += term(num(c.base), '命中基数') +
           '<span class="term"><span class="val"><i class="osym">' + SYM[c.op] + '</i></span><em>操作符</em></span>' +
           '<span class="sym">(</span>' +
           '<span class="term"><span class="val"><span class="m">' + esc(dispMetric(c)) + '</span></span><em>指标字段</em></span>' +
           '<span class="sym">×</span>' + term(num(c.rate) + '%', '比率') + '<span class="sym">)</span>';
    } else {
      h += '<span class="sym">(</span>' + term(num(c.base), '命中基数') +
           '<span class="term"><span class="val"><i class="osym">' + SYM[c.op] + '</i></span><em>操作符</em></span>' +
           '<span class="term"><span class="val"><span class="m">' + esc(dispMetric(c)) + '</span></span><em>指标字段</em></span>' +
           '<span class="sym">×</span>' + term(num(c.rate) + '%', '比率') + '<span class="sym">)</span>';
    }
    return h;
  }

  /* --------------------------- 数据 --------------------------- */

  function orderRules(list, order) {
    if (!order || !order.length) return list.slice();
    var map = {}, out = [];
    list.forEach(function (r) { map[String(r.id)] = r; });
    order.forEach(function (id) {
      if (map[String(id)]) { out.push(map[String(id)]); delete map[String(id)]; }
    });
    list.forEach(function (r) { if (map[String(r.id)]) out.push(r); });
    return out;
  }

  function ensureData(info, cb) {
    var key = info.activationId;
    var c = cache[key];
    if (c && Date.now() - c.at < 3000) { cb(c); return; }
    if (waiting[key]) { waiting[key].push(cb); return; }
    waiting[key] = [cb];

    Promise.all([
      api('/rule', 'POST', { pageNo: 1, pageSize: 1000, activationId: Number(key) }),
      api('/activation/feature/columns/' + info.modelId)
    ]).then(function (res) {
      var res1 = res[0] || {}, res2 = res[1] || {};
      var page = (res1.data && res1.data.page) || {};
      var list = page.list || [];
      var order = String((res1.data && res1.data.ruleOrder) || '').split(',').filter(Boolean);

      var labels = {};
      (function walk(nodes) {
        (nodes || []).forEach(function (n) {
          if (!n) return;
          if (n.value && n.label) labels[n.value] = n.label;
          if (n.children) walk(n.children);
        });
      })((res2.data && res2.data.list) || []);

      var byLabel = {};
      list.forEach(function (r) {
        var k = String(r.label == null ? '' : r.label).replace(/\s+/g, ' ').trim();
        if (k) byLabel[k] = r;
      });

      var data = {
        list: list,
        ordered: orderRules(list, order),
        byLabel: byLabel,
        labels: labels,
        at: Date.now()
      };
      cache[key] = data;

      var q = waiting[key] || [];
      delete waiting[key];
      q.forEach(function (f) { try { f(data); } catch (e) { /* 单个回调异常不影响其他 */ } });
    });
  }

  function cfgOfRule(r, labels) {
    return {
      init: num(r.initScore),
      base: num(r.baseNum),
      op: OP_NAME[r.operator] ? r.operator : 'NONE',
      metric: r.abstractionName || '',
      metricLabel: labels[r.abstractionName] || r.abstractionName || '',
      rate: num(r.rate),
      max: num(r.max)
    };
  }

  /* --------------------------- 表单读取 --------------------------- */

  function inputVal(item) {
    var i = item.querySelector('input.ant-input-number-input') || item.querySelector('input.ant-input');
    return i ? i.value : '';
  }

  function selectVal(item) {
    var el = item.querySelector('.ant-select-selection-selected-value');
    if (el) return txt(el);
    var c = item.querySelector('.ant-cascader-picker-label');
    if (c) {
      var s = txt(c);
      var p = s.split(' / ');
      return p[p.length - 1];
    }
    return '';
  }

  function readFormCfg(form) {
    var c = { init: 0, base: 0, op: 'NONE', metric: '', label: '', rate: 100, max: 0 };
    var items = form.querySelectorAll('.ant-form-item');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var lab = txt(item.querySelector('.ant-form-item-label')).replace(/[：:*\s]/g, '');
      if (!lab) continue;
      if (lab === '显示名称') c.label = inputVal(item);
      else if (lab === '初始得分') c.init = num(inputVal(item));
      else if (lab === '命中基数') c.base = num(inputVal(item));
      else if (lab === '比率') c.rate = num(inputVal(item));
      else if (lab === '最大值') c.max = num(inputVal(item));
      else if (lab === '操作符') c.op = OP_REV[selectVal(item)] || 'NONE';
      else if (lab === '指标字段') c.metric = selectVal(item);
    }
    return c;
  }

  /* --------------------------- DOM 装饰 --------------------------- */

  function updatePill(block, c) {
    var host = block.querySelector('.p-block-titles');
    if (!host) return;
    var pill = host.querySelector('.rd-fml');
    if (!pill) return;
    var html = pillHtml(c);
    if (pill.__html !== html) {
      pill.innerHTML = html;
      pill.__html = html;
    }
    var title = plainFormula(c);
    if (pill.getAttribute('title') !== title) pill.setAttribute('title', title);
  }

  function decorateForm(block, c) {
    var main = block.querySelector('.p-block-main');
    if (!main) return;
    var form = main.querySelector('form');
    if (!form) return;

    var panel = main.querySelector('.rd-live');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'rd-live';
      main.classList.add('rd-host');
      main.appendChild(panel);
    }

    var cfg = readFormCfg(form);
    if (!cfg.metric && c && c.metric) cfg.metric = c.metric;
    if (!cfg.metric && c && c.metricLabel) cfg.metricLabel = c.metricLabel;

    var html = previewHtml(cfg);
    if (panel.__html !== html) {
      panel.innerHTML = html;
      panel.__html = html;
    }

    // 空间够才放右侧，否则落到表单下方
    // 注意：表单外层固定 750px，但控件列只占其中一部分，所以按控件右边缘量
    var inline = fitRight(main, form) < 384;
    if (panel.classList.contains('rd-inline') !== inline) {
      panel.classList.toggle('rd-inline', inline);
    }

    bindForm(form, block, c);
  }

  /* 表单右侧剩余可用宽度（面板 372 + 12 间距才算放得下） */
  function fitRight(main, form) {
    var els = form.querySelectorAll('.ant-form-item-control-wrapper, .ant-form-item-control');
    var right = 0;
    for (var i = 0; i < els.length; i++) {
      var b = els[i].getBoundingClientRect();
      if (b.width > 0 && b.right > right) right = b.right;
    }
    if (!right) return 0;
    return main.getBoundingClientRect().right - 20 - right;
  }

  function bindForm(form, block, baseCfg) {
    if (form.__rdBound) return;
    form.__rdBound = true;
    var timer = null;
    function kick() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var cfg = readFormCfg(form);
        decorateForm(block, baseCfg);
        updatePill(block, cfg);
      }, 60);
    }
    form.addEventListener('input', kick, true);
    form.addEventListener('change', kick, true);
    form.addEventListener('click', kick, true);
    try {
      new MutationObserver(kick).observe(form, { childList: true, subtree: true, characterData: true });
    } catch (e) { /* 老浏览器忽略 */ }
  }

  function decorate() {
    var info = hashInfo();
    if (!info) return;
    ensureData(info, function (data) {
      var blocks = document.querySelectorAll('.ant-layout-content .p-block');
      for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (block.querySelector('.rd-live') && block.querySelector('.rd-fml')) continue;

        var titleEl = block.querySelector('.p-block-title-left');
        var label = txt(titleEl);
        var rule = data.byLabel[label] || (label ? null : data.ordered[i]);
        var cfg = rule ? cfgOfRule(rule, data.labels) : null;

        if (cfg) {
          var host = block.querySelector('.p-block-titles');
          if (host && !host.querySelector('.rd-fml')) {
            var pill = document.createElement('div');
            pill.className = 'rd-fml';
            pill.addEventListener('click', function (e) { e.stopPropagation(); });
            pill.addEventListener('mousedown', function (e) { e.stopPropagation(); });
            host.appendChild(pill);
          }
          updatePill(block, cfg);
        }
        decorateForm(block, cfg);
      }
    });
  }

  function schedule() {
    var info = hashInfo();
    var path = location.hash || '';
    if (path !== lastPath) {
      lastPath = path;
      cache = {};
    }
    if (!info) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(decorate, 120);
  }

  /* --------------------------- 样式 --------------------------- */

  var CSS = [
    /* 卡片右侧算式 */
    '.rd-fml{float:right;box-sizing:border-box;max-width:46%;height:28px;line-height:26px;margin:6px 16px 0 0;',
    'padding:0 10px;background:#fafafa;border:1px solid #f0f0f0;border-radius:4px;font-size:12px;color:#262626;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default;transition:all .15s;}',
    '.rd-fml:hover{border-color:#bae7ff;background:#f5fbff;box-shadow:0 2px 8px rgba(24,144,255,.12);}',
    '.rd-fml .k{color:#8c8c8c;font-size:11px;margin-right:3px;}',
    '.rd-fml .op,.rd-fml .paren{color:#8c8c8c;}',
    '.rd-fml .n{font-weight:600;font-variant-numeric:tabular-nums;}',
    '.rd-fml .fn{color:#722ed1;font-weight:600;margin:0 1px;}',
    '.rd-fml .m{display:inline-block;padding:0 5px;line-height:18px;background:#e6f7ff;border:1px solid #bae7ff;',
    'color:#0050b3;border-radius:2px;font-size:11px;max-width:190px;overflow:hidden;text-overflow:ellipsis;',
    'vertical-align:1px;}',

    /* 表单右侧预览 */
    '.p-block-main.rd-host{position:relative;}',
    '.rd-live{position:absolute;right:0;top:20px;box-sizing:border-box;width:372px;padding:12px 14px;',
    'background:#fcfdff;border:1px solid #e8f0fb;border-radius:4px;font-size:12px;color:#595959;',
    'box-shadow:0 1px 2px rgba(24,144,255,.05);}',
    '.rd-live.rd-inline{position:static;width:auto;margin-top:16px;}',
    '.rd-live-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}',
    '.rd-live-head .t{font-size:13px;font-weight:600;color:#262626;}',
    '.rd-live-head .live{font-size:10px;color:#389e0d;background:#f6ffed;border:1px solid #b7eb8f;',
    'border-radius:2px;line-height:16px;padding:0 5px;}',
    '.rd-live-fml{display:flex;flex-wrap:wrap;align-items:flex-start;column-gap:2px;row-gap:2px;}',
    '.rd-live-fml .eq{font-size:12px;font-weight:600;color:#262626;line-height:26px;}',
    '.rd-live .term{display:inline-flex;flex-direction:column;align-items:center;height:39px;}',
    '.rd-live .term .val{height:26px;display:flex;align-items:center;font-variant-numeric:tabular-nums;}',
    '.rd-live .term b{font-size:12.5px;font-weight:600;color:#262626;}',
    '.rd-live .term .osym{font-style:normal;font-size:13px;color:#8c8c8c;}',
    '.rd-live .term em{font-style:normal;font-size:9px;line-height:11px;color:#8c8c8c;margin-top:1px;white-space:nowrap;}',
    '.rd-live .sym{height:26px;display:flex;align-items:center;font-size:13px;color:#8c8c8c;padding:0 1px;}',
    '.rd-live .term .m{display:inline-block;padding:0 3px;line-height:18px;background:#e6f7ff;border:1px solid #bae7ff;',
    'color:#0050b3;border-radius:2px;font-size:10.5px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.rd-sep{height:1px;background:#f0f0f0;margin:11px 0 9px;}',
    '.rd-live-sub{font-size:12px;color:#8c8c8c;margin-bottom:6px;}',
    '.rd-live-sub em{font-style:normal;font-size:10px;color:#bfbfbf;margin-left:4px;}',
    '.rd-cap{display:flex;flex-wrap:wrap;align-items:flex-start;column-gap:3px;font-size:12px;color:#595959;}',
    '.rd-cap .eq{line-height:26px;color:#8c8c8c;}',
    '.rd-cap .raw{line-height:26px;color:#262626;font-weight:600;}',
    '.rd-cap .fn{line-height:26px;color:#722ed1;font-weight:600;}',
    '.rd-cap .case{line-height:26px;font-size:11px;color:#8c8c8c;}',
    '.rd-cap .tip{line-height:26px;font-size:11px;color:#8c8c8c;}',
    '.rd-eg{display:flex;align-items:baseline;gap:6px;font-size:11px;color:#595959;padding:3px 0;white-space:nowrap;}',
    '.rd-eg .v{flex:0 0 52px;color:#8c8c8c;}',
    '.rd-eg .calc{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;}',
    '.rd-eg .s{flex:0 0 auto;font-weight:600;color:#262626;font-variant-numeric:tabular-nums;}',
    '.rd-eg .tag{flex:0 0 auto;font-size:10px;line-height:15px;padding:0 5px;border-radius:2px;border:1px solid;}',
    '.rd-eg .tag.pass{color:#389e0d;background:#f6ffed;border-color:#b7eb8f;}',
    '.rd-eg .tag.review{color:#d46b08;background:#fffbe6;border-color:#ffe58f;}',
    '.rd-eg .tag.reject{color:#cf1322;background:#fff1f0;border-color:#ffa39e;}',
    '.rd-note{font-size:11px;line-height:1.7;color:#8c8c8c;}',
    '.rd-note.warn{color:#d46b08;background:#fffbe6;border:1px solid #ffe58f;border-radius:2px;padding:6px 9px;}',
    '.rd-note.bad{color:#cf1322;background:#fff1f0;border:1px solid #ffa39e;border-radius:2px;padding:6px 9px;}'
  ].join('');

  function ensureStyle() {
    if (document.getElementById('rd-fml-style')) return;
    var s = document.createElement('style');
    s.id = 'rd-fml-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* --------------------------- 启动 --------------------------- */

  function boot() {
    ensureStyle();
    var obs = new MutationObserver(function () { schedule(); });
    obs.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', function () {
      lastPath = '';
      schedule();
    });
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
