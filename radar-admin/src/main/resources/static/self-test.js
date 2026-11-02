/**
 * self-test.js — 模型列表「自测」（radar-admin 原前端增强）
 *
 * 在模型列表操作列「进入模型 | 复制 | 编辑 | 删除」后面追加一个「自测」：
 *   点开弹窗 → 后端按该模型字段定义构造一份可直接提交的示例参数（可手工改）
 *   → 点「执行」由后端代理调用引擎 /services/v1/upload → 弹窗内展示结果。
 *
 * 三种场景避免"每次都是 pass"，也避免"永远是同一份数据"：
 *   new         全新请求：IP / 设备 / 账号每次都换
 *   sameDevice  同一设备重复提交：IP / 设备 / 账号固定，只换事件流水号
 *   sameIp      同一 IP 换设备：IP 固定、设备每次换，连点几次可让"同IP关联设备数"类规则命中
 *
 * 不修改 main.js；移除 index.html 中对本文件的引用即可整体下线。
 * 后端接口：/services/v1/model/selfTest/params/{id} 与 /run（SelfTestApiController）。
 */
(function () {
  'use strict';
  if (window.__RDSELFTEST__) return;
  window.__RDSELFTEST__ = true;

  var API = '/services/v1/model/selfTest';
  var PAGE = /^#\/modelList/;
  var MARK = 'rd-st-done';

  function token() {
    return localStorage.getItem('x-auth-token') || '';
  }

  function apiGet(path) {
    return fetch(path, { headers: { 'x-auth-token': token() } }).then(function (r) {
      return r.json();
    });
  }

  function apiPost(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'x-auth-token': token(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json();
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var CSS = [
    '/* 列表里的「自测」链接 */',
    '.rd-st-link{cursor:pointer;color:#1890ff;}',
    '.rd-st-link:hover{color:#40a9ff;}',

    '/* 弹窗 */',
    '#rd-st-mask{position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.45);',
    'display:flex;align-items:flex-start;justify-content:center;z-index:1100;overflow:auto;padding:40px 16px;}',
    '#rd-st-box{width:100%;max-width:880px;background:#fff;border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,.2);',
    'display:flex;flex-direction:column;max-height:calc(100vh - 80px);}',
    '#rd-st-head{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;}',
    '#rd-st-head .rd-st-title{font-size:15px;font-weight:600;color:rgba(0,0,0,.85);}',
    '#rd-st-head .rd-st-title small{font-weight:400;color:rgba(0,0,0,.45);margin-left:8px;font-size:12px;}',
    '#rd-st-close{border:0;background:transparent;font-size:18px;line-height:1;color:rgba(0,0,0,.45);cursor:pointer;padding:4px 8px;border-radius:4px;}',
    '#rd-st-close:hover{background:#f5f5f5;color:rgba(0,0,0,.75);}',
    '#rd-st-body{padding:16px 20px 20px;overflow:auto;}',

    /* 场景选择 */
    '.rd-st-scenes{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}',
    '.rd-st-scene{padding:6px 12px;border:1px solid #d9d9d9;border-radius:15px;font-size:12.5px;cursor:pointer;',
    'color:rgba(0,0,0,.65);background:#fff;transition:all .15s;white-space:nowrap;}',
    '.rd-st-scene:hover{border-color:#40a9ff;color:#40a9ff;}',
    '.rd-st-scene.on{border-color:#1890ff;color:#1890ff;background:#e6f4ff;font-weight:500;}',
    '.rd-st-desc{font-size:12.5px;color:rgba(0,0,0,.45);line-height:1.7;margin-bottom:12px;min-height:22px;}',

    '.rd-st-label{font-size:12.5px;color:rgba(0,0,0,.65);margin:0 0 6px;font-weight:500;}',
    '#rd-st-json{width:100%;height:210px;box-sizing:border-box;font-family:Menlo,Consolas,monospace;font-size:12.5px;',
    'line-height:1.6;padding:10px 12px;border:1px solid #d9d9d9;border-radius:4px;resize:vertical;outline:none;color:rgba(0,0,0,.75);}',
    '#rd-st-json:focus{border-color:#40a9ff;box-shadow:0 0 0 2px rgba(24,144,255,.12);}',

    '.rd-st-actions{display:flex;align-items:center;gap:10px;margin-top:12px;}',
    '.rd-st-btn{height:32px;padding:0 16px;font-size:13px;border-radius:4px;border:1px solid #d9d9d9;background:#fff;',
    'color:rgba(0,0,0,.65);cursor:pointer;transition:all .15s;}',
    '.rd-st-btn:hover{border-color:#40a9ff;color:#40a9ff;}',
    '.rd-st-btn.primary{background:#1890ff;border-color:#1890ff;color:#fff;}',
    '.rd-st-btn.primary:hover{background:#40a9ff;border-color:#40a9ff;color:#fff;}',
    '.rd-st-btn[disabled]{opacity:.55;cursor:not-allowed;}',
    '.rd-st-hint{font-size:12px;color:rgba(0,0,0,.35);margin-left:auto;}',

    /* 结果区 */
    '#rd-st-result{margin-top:16px;border-top:1px dashed #f0f0f0;padding-top:14px;}',
    '#rd-st-result:empty{display:none;}',
    '.rd-st-badges{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px;}',
    '.rd-st-badge{display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:12px;font-size:12.5px;font-weight:600;}',
    '.rd-st-badge.pass{background:#f6ffed;color:#389e0d;border:1px solid #b7eb8f;}',
    '.rd-st-badge.review{background:#fffbe6;color:#d48806;border:1px solid #ffe58f;}',
    '.rd-st-badge.reject{background:#fff1f0;color:#cf1322;border:1px solid #ffa39e;}',
    '.rd-st-badge.info{background:#fafafa;color:rgba(0,0,0,.55);border:1px solid #e8e8e8;font-weight:400;}',
    '.rd-st-err{padding:10px 12px;background:#fff1f0;border:1px solid #ffa39e;border-radius:4px;',
    'color:#cf1322;font-size:13px;line-height:1.7;}',
    '.rd-st-warn{padding:8px 12px;background:#fffbe6;border:1px solid #ffe58f;border-radius:4px;',
    'color:#d48806;font-size:12.5px;line-height:1.7;margin-bottom:10px;}',
    '.rd-st-pre{margin:0;max-height:300px;overflow:auto;background:#fafafa;border:1px solid #f0f0f0;border-radius:4px;',
    'padding:10px 12px;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.6;color:rgba(0,0,0,.75);white-space:pre-wrap;}',
    '.rd-st-tabs{display:flex;gap:6px;margin-bottom:8px;}',
    '.rd-st-tab{padding:3px 10px;font-size:12.5px;border-radius:3px;cursor:pointer;color:rgba(0,0,0,.55);}',
    '.rd-st-tab.on{background:#e6f4ff;color:#1890ff;}'
  ].join('');

  function ensureStyle() {
    if (document.getElementById('rd-st-style')) return;
    var s = document.createElement('style');
    s.id = 'rd-st-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- 1. 注入「自测」入口 ---------- */
  function injectLinks() {
    if (!PAGE.test(location.hash || '')) return;
    var rows = document.querySelectorAll('table tbody tr.ant-table-row');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var enter = row.querySelector('a[href^="#/field/"]');
      if (!enter) continue;
      var idm = /#\/field\/(\d+)/.exec(enter.getAttribute('href') || '');
      if (!idm) continue;
      var modelId = idm[1];
      if (row.getAttribute(MARK) === modelId) continue;

      var cell = row.querySelector('td:last-child');
      if (!cell) continue;

      // 模型名：第 2 列（编号, 名称, entity, entry, 查看, 参考字段, 操作）
      var nameCell = row.querySelectorAll('td')[1];
      var modelName = nameCell ? String(nameCell.textContent || '').replace(/\s+/g, ' ').trim() : '';

      var span = document.createElement('span');
      span.innerHTML = '<span class="ant-divider"></span>' +
        '<span><a class="rd-st-link">自测</a></span>';
      var link = span.querySelector('.rd-st-link');

      link.addEventListener('click', function (mid, mname) {
        return function (e) {
          e.preventDefault();
          e.stopPropagation();
          openDialog(mid, mname);
        };
      }(modelId, modelName));

      cell.appendChild(span.firstChild);
      cell.appendChild(span.firstChild);
      row.setAttribute(MARK, modelId);
    }
  }

  /* ---------- 2. 弹窗 ---------- */
  var state = { modelId: null, modelName: '', scenario: 'new', scenarios: [], entryName: '', busy: false, res: null, tab: 'summary' };

  function openDialog(modelId, modelName) {
    var old = document.getElementById('rd-st-mask');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    state.modelId = modelId;
    state.modelName = modelName;
    state.scenario = 'new';
    state.res = null;
    state.busy = false;
    state.tab = 'summary';

    ensureStyle();
    var mask = document.createElement('div');
    mask.id = 'rd-st-mask';
    mask.innerHTML =
      '<div id="rd-st-box" role="dialog" aria-modal="true">' +
        '<div id="rd-st-head">' +
          '<div class="rd-st-title">模型自测' +
            '<small id="rd-st-sub"></small>' +
          '</div>' +
          '<button id="rd-st-close" title="关闭">✕</button>' +
        '</div>' +
        '<div id="rd-st-body">' +
          '<div class="rd-st-scenes" id="rd-st-scenes"></div>' +
          '<div class="rd-st-desc" id="rd-st-desc"></div>' +
          '<div class="rd-st-label">请求参数（jsonInfo，可直接编辑）</div>' +
          '<textarea id="rd-st-json" spellcheck="false" placeholder="正在构造参数…"></textarea>' +
          '<div class="rd-st-actions">' +
            '<button class="rd-st-btn primary" id="rd-st-run">执行</button>' +
            '<button class="rd-st-btn" id="rd-st-regen">重新生成</button>' +
            '<button class="rd-st-btn" id="rd-st-copy">复制参数</button>' +
            '<span class="rd-st-hint" id="rd-st-hint"></span>' +
          '</div>' +
          '<div id="rd-st-result"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    mask.addEventListener('click', function (e) {
      if (e.target === mask) closeDialog();
    });
    document.getElementById('rd-st-close').addEventListener('click', closeDialog);
    document.getElementById('rd-st-run').addEventListener('click', run);
    document.getElementById('rd-st-regen').addEventListener('click', function () {
      loadParams(state.scenario);
    });
    document.getElementById('rd-st-copy').addEventListener('click', copyParams);
    document.addEventListener('keydown', onKey);

    document.getElementById('rd-st-sub').textContent =
      modelName ? '#' + modelId + ' · ' + modelName : '#' + modelId;

    loadParams('new');
  }

  function closeDialog() {
    document.removeEventListener('keydown', onKey);
    var mask = document.getElementById('rd-st-mask');
    if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
  }

  function onKey(e) {
    if (e.key === 'Escape') closeDialog();
  }

  /* ---------- 3. 参数加载 ---------- */
  function loadParams(scenario) {
    state.scenario = scenario;
    var ta = document.getElementById('rd-st-json');
    var hint = document.getElementById('rd-st-hint');
    if (ta) ta.value = '';
    if (hint) hint.textContent = '正在构造参数…';

    apiGet(API + '/params/' + state.modelId + '?scenario=' + encodeURIComponent(scenario))
      .then(function (res) {
        if (!res || !res.success) {
          if (hint) hint.textContent = '';
          showError((res && res.msg) || '构造参数失败');
          return;
        }
        var d = res.data || {};
        state.scenarios = d.scenarios || [];
        state.entryName = d.entryName || '';
        state.warn = d.warn || '';
        renderScenes();
        var ta2 = document.getElementById('rd-st-json');
        if (ta2) ta2.value = JSON.stringify(d.jsonInfo || {}, null, 2);
        if (hint) hint.textContent = '字段来自该模型的字段定义，可手工修改后再执行';
        renderWarn();
      })
      .catch(function (e) {
        if (hint) hint.textContent = '';
        showError('构造参数失败：' + e.message);
      });
  }

  function renderScenes() {
    var box = document.getElementById('rd-st-scenes');
    if (!box) return;
    box.innerHTML = '';
    var current = null;
    for (var i = 0; i < state.scenarios.length; i++) {
      var sc = state.scenarios[i];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rd-st-scene' + (sc.key === state.scenario ? ' on' : '');
      b.textContent = sc.name;
      b.addEventListener('click', function (key) {
        return function () {
          loadParams(key);
        };
      }(sc.key));
      box.appendChild(b);
      if (sc.key === state.scenario) current = sc;
    }
    var desc = document.getElementById('rd-st-desc');
    if (desc) desc.textContent = current ? current.desc : '';
  }

  function renderWarn() {
    var box = document.getElementById('rd-st-result');
    if (!box) return;
    box.innerHTML = state.warn ? '<div class="rd-st-warn">' + esc(state.warn) + '</div>' : '';
  }

  /* ---------- 4. 执行 ---------- */
  function run() {
    if (state.busy) return;
    var ta = document.getElementById('rd-st-json');
    var raw = ta ? ta.value : '';
    var jsonInfo;
    try {
      jsonInfo = JSON.parse(raw);
    } catch (e) {
      showError('参数不是合法 JSON：' + e.message);
      return;
    }

    state.busy = true;
    var btn = document.getElementById('rd-st-run');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '执行中…';
    }
    var hint = document.getElementById('rd-st-hint');
    if (hint) hint.textContent = '正在调用引擎 /services/v1/upload …';

    apiPost(API + '/run', {
      modelId: state.modelId,
      scenario: state.scenario,
      jsonInfo: jsonInfo
    })
      .then(function (res) {
        state.busy = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = '执行';
        }
        if (hint) hint.textContent = '';
        state.res = res;
        state.tab = 'summary';
        renderResult();
        // 该模型按 entryName（通常是 eventId）去重，连点必须换流水号才会真正落库
        bumpEntry();
      })
      .catch(function (e) {
        state.busy = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = '执行';
        }
        if (hint) hint.textContent = '';
        showError('调用失败：' + e.message);
      });
  }

  function showError(msg) {
    var box = document.getElementById('rd-st-result');
    if (!box) return;
    box.innerHTML = '<div class="rd-st-err">' + esc(msg) + '</div>';
  }

  /* ---------- 5. 结果渲染 ---------- */
  function riskOf(activations) {
    var t = String(activations || '');
    if (t.indexOf('reject') >= 0) return 'reject';
    if (t.indexOf('review') >= 0) return 'review';
    if (t.indexOf('pass') >= 0) return 'pass';
    return 'info';
  }

  function renderResult() {
    var box = document.getElementById('rd-st-result');
    if (!box) return;
    var res = state.res;
    if (!res) {
      box.innerHTML = '';
      return;
    }
    if (!res.success) {
      box.innerHTML = '<div class="rd-st-err">' + esc(res.msg || '执行失败') + '</div>';
      return;
    }

    var d = res.data || {};
    var s = d.summary || {};
    var risk = riskOf(s.activations);
    var riskText = { pass: '通过', review: '复核', reject: '拒绝', info: '未知' }[risk];

    var html = '<div class="rd-st-badges">' +
      '<span class="rd-st-badge ' + risk + '">' + riskText + '</span>';

    if (s.activations) {
      html += '<span class="rd-st-badge info">' + esc(s.activations) + '</span>';
    }
    if (s.hitCount != null) {
      html += '<span class="rd-st-badge info">命中规则 ' + esc(s.hitCount) + ' 条</span>';
    }
    if (d.costMs != null) {
      html += '<span class="rd-st-badge info">耗时 ' + esc(d.costMs) + ' ms</span>';
    }
    if (s.code) {
      html += '<span class="rd-st-badge info">code ' + esc(s.code) + '</span>';
    }
    html += '</div>';

    if (d.autoFilled) {
      html += '<div class="rd-st-desc" style="margin-bottom:8px;color:#d48806">' +
        '已自动补齐参考时间字段 ' + esc(d.autoFilled) + '（模型字段里没有定义它，但引擎落库必需）</div>';
    }
    if (s.msg) {
      html += '<div class="rd-st-desc" style="margin-bottom:8px">' + esc(s.msg) + '</div>';
    }

    html += '<div class="rd-st-tabs">' +
      tabBtn('summary', '摘要') +
      tabBtn('hits', '命中明细') +
      tabBtn('raw', '完整响应') +
      tabBtn('request', '请求体') +
      '</div>';

    html += '<pre class="rd-st-pre" id="rd-st-pre">' + esc(tabContent()) + '</pre>';
    box.innerHTML = html;

    var tabs = box.querySelectorAll('.rd-st-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function (key) {
        return function () {
          state.tab = key;
          renderResult();
        };
      }(tabs[i].getAttribute('data-key')));
    }
  }

  function tabBtn(key, label) {
    return '<span class="rd-st-tab' + (state.tab === key ? ' on' : '') + '" data-key="' + key + '">' + label + '</span>';
  }

  function tabContent() {
    var d = (state.res && state.res.data) || {};
    var s = d.summary || {};
    if (state.tab === 'request') {
      return JSON.stringify(d.request || {}, null, 2);
    }
    if (state.tab === 'hits') {
      return JSON.stringify(s.hitsDetail || {}, null, 2);
    }
    if (state.tab === 'raw') {
      return JSON.stringify(d.response, null, 2);
    }
    return JSON.stringify({
      activations: s.activations || '',
      hitCount: s.hitCount,
      msg: s.msg,
      code: s.code,
      abstractions: s.abstractions,
      referenceDate: s.referenceDate,
      engineUrl: d.engineUrl,
      costMs: d.costMs
    }, null, 2);
  }

  /**
   * 事件按 entryName（一般是 eventId）去重，复用同一个流水号第二次起不会落库，
   * 滑窗指标也就不会涨。执行成功后自动换一个新流水号，其余字段（含手工改动）保持不变。
   */
  function bumpEntry() {
    if (!state.entryName) return;
    var ta = document.getElementById('rd-st-json');
    if (!ta) return;
    var obj;
    try {
      obj = JSON.parse(ta.value);
    } catch (e) {
      return;
    }
    if (!obj) return;
    obj[state.entryName] = 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    ta.value = JSON.stringify(obj, null, 2);
    var hint = document.getElementById('rd-st-hint');
    if (hint) hint.textContent = '已更新 ' + state.entryName + '，继续点执行可累积滑窗指标';
  }

  function copyParams() {
    var ta = document.getElementById('rd-st-json');
    if (!ta) return;
    var hint = document.getElementById('rd-st-hint');
    try {
      ta.select();
      document.execCommand('copy');
      if (hint) hint.textContent = '已复制到剪贴板';
    } catch (e) {
      if (hint) hint.textContent = '复制失败，请手动选中复制';
    }
  }

  /* ---------- 6. 保活：React 重渲染会重建表格 ---------- */
  function tick() {
    ensureStyle();
    // 离开模型列表页时收起弹窗，避免遮罩挂在别的页面上
    if (!PAGE.test(location.hash || '') && document.getElementById('rd-st-mask')) {
      closeDialog();
    }
    injectLinks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }
  new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', tick);
  setInterval(tick, 800);
})();
