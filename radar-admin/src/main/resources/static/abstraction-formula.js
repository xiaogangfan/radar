/**
 * abstraction-formula.js — 抽象指标算式可视化（radar-admin 原前端增强）
 *
 * 只读数据、只加 DOM，不改 main.js 里任何既有逻辑：
 *   抽象处理列表（#/abstractionList/:modelId）每张卡片右侧显示这条指标的完整算式
 *       聚合函数(统计字段) where 搜索字段 = 本次 · 近 N 时间单位
 *   悬停给出等价 Mongo 查询、过滤条件与窗口口径；停用的指标灰显并标注。
 *
 * 数据来源（均为只读查询）：
 *   GET /services/v1/abstraction/list/:modelId
 *   GET /services/v1/field/list/:modelId     —— 字段英文名 → 中文标签
 *   GET /services/v1/model/:modelId          —— referenceDate（窗口基准时间字段）/ 实体名
 *
 * 以静态资源方式打进 BOOT-INF/classes/static/，由 index.html 引入。
 * 移除 index.html 中对本文件的引用即可整体下线。
 */
(function () {
  'use strict';
  if (window.__RDAFML__) return;
  window.__RDAFML__ = true;

  var API = '/services/v1';

  /* 聚合类型：radar-dal AggregateType */
  var AGG = { 1: 'count', 2: 'distinct', 3: 'sum', 4: 'avg', 5: 'max', 6: 'min', 7: 'sd', 8: 'variance', 10: 'median' };
  /* 时间单位：radar-dal DateType（Calendar 常量） */
  var UNIT = { 1: '年', 2: '个月', 3: '周', 5: '天', 11: '小时', 12: '分钟', 13: '秒' };
  /* 条件运算符：main.js 里的 Js 映射，取常用子集 */
  var OP = {
    StartsWith: '以…开始', Contains: '包含', Equal: '等于', Less: '小于', Less_Equal: '小于等于',
    Greater: '大于', Greater_Equal: '大于等于', InList: '在列表…中', NotStartsWith: '不以…开始',
    NotContains: '不包含', NotEqual: '不等于', NotInList: '不在列表…中',
    IsNull: '为空', IsNotNull: '不为空'
  };

  var cache = {};     // modelId -> { list, fields, model }
  var waiting = {};   // modelId -> [cb]
  var scanTimer = null;
  var refetchTimer = null;

  /* --------------------------- 基础工具 --------------------------- */

  function token() {
    return localStorage.getItem('x-auth-token') || '';
  }

  function api(path) {
    return fetch(API + path, {
      credentials: 'include',
      headers: { 'x-auth-token': token() }
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () { return null; });
  }

  function txt(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function strip(f) {
    return String(f == null ? '' : f).replace(/^(fields|preItems)\./, '');
  }

  function modelIdOf() {
    var m = (location.hash || '').match(/^#\/abstractionList\/(\d+)/);
    return m ? m[1] : null;
  }

  /* --------------------------- 数据 --------------------------- */

  function load(id, cb) {
    if (cache[id]) return cb(cache[id]);
    if (waiting[id]) { waiting[id].push(cb); return; }
    waiting[id] = [cb];
    Promise.all([
      api('/abstraction/list/' + id),
      api('/field/list/' + id),
      api('/model/' + id)
    ]).then(function (rs) {
      var a = rs[0] && rs[0].data;
      var d = {
        list: (a && (a.list || (a.length !== undefined ? a : []))) || [],
        fields: (rs[1] && rs[1].data && rs[1].data.field) || [],
        model: (rs[2] && rs[2].data && rs[2].data.model) || null
      };
      cache[id] = d;
      var q = waiting[id] || [];
      delete waiting[id];
      for (var i = 0; i < q.length; i++) q[i](d);
    }, function () {
      delete waiting[id];
    });
  }

  /* 字段英文名 → 中文标签（表单里显示的也是这个） */
  function fname(d, f) {
    var n = strip(f);
    if (!n) return '';
    for (var i = 0; i < d.fields.length; i++) {
      if (d.fields[i].fieldName === n) return d.fields[i].label || n;
    }
    return n;
  }

  function winText(a) {
    var v = a.searchIntervalValue, t = a.searchIntervalType;
    if (v === null || v === undefined || v === '' || !UNIT[t]) return '无窗口限制';
    return '近 ' + v + ' ' + UNIT[t];
  }

  /* 过滤条件：ruleDefinition → 人话；默认的「搜索字段不为空」不算显式过滤 */
  function conds(a) {
    var rd = a.ruleDefinition, out = [];
    if (!rd || typeof rd !== 'object' || !rd.conditions) return out;
    for (var i = 0; i < rd.conditions.length; i++) {
      var c = rd.conditions[i];
      if (!c || c.enabled === false) continue;
      var ex = (c.expressions && c.expressions[0]) || {};
      out.push({ column: ex.column, op: c.operator, value: c.value });
    }
    return out;
  }

  function isFiltered(a) {
    var cs = conds(a);
    if (!cs.length) return false;
    if (cs.length === 1 && cs[0].op === 'IsNotNull' && strip(cs[0].column) === strip(a.searchField)) return false;
    return true;
  }

  function condText(a, d) {
    var cs = conds(a);
    if (!cs.length) return '';
    var parts = [];
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      var col = c.column ? (fname(d, c.column) || strip(c.column)) : '?';
      var op = OP[c.op] || c.op || '?';
      parts.push(col + ' ' + op + (c.value === undefined || c.value === null || c.value === '' ? '' : ' ' + c.value));
    }
    var link = (a.ruleDefinition && a.ruleDefinition.linking === 'Any') ? ' 或 ' : ' 且 ';
    return parts.join(link);
  }

  /* --------------------------- 算式渲染 --------------------------- */

  function pillHtml(a, d) {
    var fn = AGG[a.aggregateType] || 'count';
    var h = '';
    if (isFiltered(a)) h += '<span class="iff">IF</span>';
    h += '<span class="fn">' + fn + '</span><span class="p">(</span>';
    h += a.functionField
      ? '<span class="m">' + esc(fname(d, a.functionField)) + '</span><span class="p">)</span>'
      : '<span class="star">*</span><span class="p">)</span>';
    h += '<span class="k">where</span>';
    h += '<span class="fld">' + esc(fname(d, a.searchField) || '—') + '</span>';
    h += '<span class="k">=</span><span class="v">本次</span>';
    h += '<span class="dot">·</span><span class="win">' + winText(a) + '</span>';
    if (a.status !== undefined && a.status !== null && a.status !== 1) h += '<span class="off-tag">停用</span>';
    return h;
  }

  function collectionOf(d, a) {
    var id = (d.model && d.model.id) || a.modelId;
    return 'entity_' + id;
  }

  function mongoOf(a, d) {
    var ent = collectionOf(d, a);
    var ref = (d.model && d.model.referenceDate) || 'loginTime';
    var sf = strip(a.searchField) || 'searchField';
    var ff = strip(a.functionField);
    var fn = AGG[a.aggregateType] || 'count';
    var q = '{ ' + sf + ': <本次>, ' + ref + ': { $gte: T-' + winText(a).replace('近 ', '') + ', $lte: T } }';
    if (fn === 'count') return 'db.' + ent + '.count(' + q + ')';
    if (fn === 'distinct') return 'db.' + ent + '.distinct("' + ff + '", ' + q + ')';
    return 'db.' + ent + '.aggregate([{ $match: ' + q + ' }, '
      + '{ $group: { _id: null, v: { $' + fn + ': "$' + ff + '" } } }])';
  }

  function tipText(a, d) {
    var ref = (d.model && d.model.referenceDate) || 'loginTime';
    var fn = AGG[a.aggregateType] || 'count';
    var sf = fname(d, a.searchField) || '搜索字段';
    var ff = fname(d, a.functionField) || '统计字段';
    var lines = [];
    lines.push('指标：' + (a.label || '') + (a.name ? '（' + a.name + '）' : ''));
    lines.push('算法：在 ' + collectionOf(d, a) + ' 中筛出 ' + ref + ' 落在「' + winText(a) + '」内、且 ' + sf + ' = 本次请求的「' + sf + '」的文档，'
      + (fn === 'count' ? '统计这些文档的条数'
        : fn === 'distinct' ? '统计其中不同「' + ff + '」的个数'
          : '对「' + ff + '」求 ' + fn));
    lines.push('Mongo：' + mongoOf(a, d));
    if (isFiltered(a)) {
      lines.push('过滤条件：' + condText(a, d) + '；不满足时该指标直接记为 -1，仍会原样参与规则运算');
    }
    lines.push('T = 本次事件的 ' + ref + ' 取值（窗口以事件时间往前取，不看服务器当前时间）');
    if (a.status !== undefined && a.status !== null && a.status !== 1) lines.push('状态：已停用，引擎不会计算这条指标');
    return lines.join('\n');
  }

  /* --------------------------- 挂载 --------------------------- */

  function decorate() {
    var id = modelIdOf();
    if (!id) return;
    load(id, function (d) {
      var byLabel = {}, byName = {}, list = d.list || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].label) byLabel[norm(list[i].label)] = list[i];
        if (list[i].name) byName[list[i].name] = list[i];
      }
      var blocks = document.querySelectorAll('.ant-layout-content .p-block');
      for (var j = 0; j < blocks.length; j++) {
        var block = blocks[j];
        var titleEl = block.querySelector('.p-block-title-left');
        var host = block.querySelector('.p-block-titles');
        if (!titleEl || !host) continue;

        var label = txt(titleEl);
        var a = byLabel[norm(label)];
        if (!a) {
          // 标题里可能带了指标英文名，退一步按包含关系找
          for (var k = 0; k < list.length; k++) {
            if (list[k].name && label.indexOf(list[k].name) >= 0) { a = list[k]; break; }
          }
        }
        if (!a) continue;

        var pill = host.querySelector('.rd-afml');
        if (!pill) {
          pill = document.createElement('div');
          pill.className = 'rd-afml';
          // 标题栏点击会展开/收起卡片，这里不能把点击冒泡上去
          pill.addEventListener('click', function (e) { e.stopPropagation(); });
          pill.addEventListener('mousedown', function (e) { e.stopPropagation(); });
          host.appendChild(pill);
        }
        var html = pillHtml(a, d);
        if (pill.__html !== html) {
          pill.innerHTML = html;
          pill.__html = html;
        }
        var tip = tipText(a, d);
        if (pill.title !== tip) pill.title = tip;
        pill.classList.toggle('is-off', a.status !== undefined && a.status !== null && a.status !== 1);
      }
    });
  }

  function norm(s) {
    return String(s == null ? '' : s).replace(/\s+/g, '');
  }

  function schedule() {
    var path = (location.hash || '').split('?')[0];
    if (path !== schedule.__last) {
      schedule.__last = path;
      cache = {};
    }
    if (!modelIdOf()) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(decorate, 120);
  }

  /* --------------------------- 样式 --------------------------- */

  var CSS = [
    '.rd-afml{float:right;box-sizing:border-box;max-width:58%;height:28px;line-height:26px;margin:6px 16px 0 0;',
    'padding:0 10px;background:#fafafa;border:1px solid #f0f0f0;border-radius:4px;font-size:12px;color:#262626;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help;transition:all .15s;}',
    '.rd-afml:hover{border-color:#bae7ff;background:#f5fbff;box-shadow:0 2px 8px rgba(24,144,255,.12);}',
    '.rd-afml .k{color:#8c8c8c;font-size:11px;margin:0 5px;}',
    '.rd-afml .p{color:#8c8c8c;}',
    '.rd-afml .dot{color:#c8ced6;margin:0 7px;}',
    '.rd-afml .fn{color:#722ed1;font-weight:600;font-family:Menlo,Consolas,monospace;font-size:11.5px;}',
    '.rd-afml .star{color:#595959;font-weight:600;}',
    '.rd-afml .m{display:inline-block;padding:0 5px;line-height:18px;background:#e6f7ff;border:1px solid #bae7ff;',
    'color:#0050b3;border-radius:2px;font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;vertical-align:1px;}',
    '.rd-afml .fld{display:inline-block;padding:0 5px;line-height:18px;background:#f6ffed;border:1px solid #b7eb8f;',
    'color:#237804;border-radius:2px;font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;vertical-align:1px;}',
    '.rd-afml .v{color:#237804;font-size:11.5px;}',
    '.rd-afml .win{color:#d46b08;font-size:11.5px;}',
    '.rd-afml .iff{display:inline-block;margin-right:5px;padding:0 5px;line-height:16px;background:#fff7e6;',
    'border:1px solid #ffd591;color:#d46b08;border-radius:2px;font-size:10px;font-weight:600;vertical-align:1px;}',
    '.rd-afml .off-tag{display:inline-block;margin-left:6px;padding:0 5px;line-height:16px;background:#f5f5f5;',
    'border:1px solid #d9d9d9;color:#8c8c8c;border-radius:2px;font-size:10px;vertical-align:1px;}',
    '.rd-afml.is-off{opacity:.62;background:#fcfcfc;}'
  ].join('');

  function ensureStyle() {
    if (document.getElementById('rd-afml-style')) return;
    var s = document.createElement('style');
    s.id = 'rd-afml-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* --------------------------- 启动 --------------------------- */

  function boot() {
    ensureStyle();

    new MutationObserver(function () { schedule(); })
      .observe(document.body, { childList: true, subtree: true });

    window.addEventListener('hashchange', function () {
      schedule.__last = '';
      schedule();
    });

    // 保存成功后接口数据会变，重新拉一次（不做 DOM 反解析，避免和 React 状态打架）
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button, a') : null;
      if (!btn) return;
      if (txt(btn).indexOf('保存') < 0) return;
      clearTimeout(refetchTimer);
      refetchTimer = setTimeout(function () {
        cache = {};
        schedule();
      }, 1200);
    }, true);

    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
