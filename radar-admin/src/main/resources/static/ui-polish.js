/**
 * ui-polish.js — 后台通用交互打磨（radar-admin 原前端增强）
 *
 * 只加 DOM/样式与属性，不改 main.js 任何既有逻辑，也不碰接口契约：
 *   1. 顶栏图标补中文 title / aria-label —— 原来只有 aria-label="icon: home"
 *   2. 查询区紧凑化：标签与输入框同一行、输入框限宽 300px、按钮同行，
 *      并补 placeholder（原来是一个占满整行的空框，不知道填什么）
 *   3. 空状态中文化 + 模型列表给「新建模型」引导（原先是 Ant 默认的 No Data）
 *
 * 以静态资源方式打进 BOOT-INF/classes/static/，由 index.html 引入。
 * 移除 index.html 中对本文件的引用即可整体下线。
 */
(function () {
  'use strict';
  if (window.__RDPOLISH__) return;
  window.__RDPOLISH__ = true;

  /* 顶栏图标 → 中文说明 */
  var ICON_LABEL = {
    home: '首页',
    'line-chart': '数据看板',
    'bar-chart': '报表',
    logout: '退出登录',
    setting: '设置',
    bell: '通知',
    user: '账号'
  };

  /* 查询框 label → placeholder */
  var SEARCH_HINT = {
    '指标名': '输入指标名筛选',
    '显示名称': '输入规则名筛选',
    '字段名': '输入字段名筛选',
    '模型名': '输入模型名筛选',
    '列表名': '输入名单名筛选'
  };

  /* 各页空状态文案；cta 会去点页面上已有的同名按钮 */
  var EMPTY = {
    modelList: { text: '当前业务线下还没有模型', hint: '先新建一个模型，再按「字段 → 预处理 → 名单 → 抽象 → 规则 → 策略」配置', cta: '新建模型' },
    abstractionList: { text: '还没有抽象指标', hint: '点上方「新增」创建第一条，规则需要它来算分' },
    ruleList: { text: '还没有规则', hint: '点上方「新增」创建第一条，命中的规则会给策略加分' },
    field: { text: '还没有字段', hint: '点上方「新增」定义模型认识哪些字段' },
    preItem: { text: '还没有预处理规则', hint: '点上方「新增」加工原始字段' },
    datalist: { text: '还没有黑/白名单', hint: '点上方「新增」建一个名单' },
    default: { text: '暂无数据', hint: '' }
  };

  var CSS = [
    /* ---- 查询区：标签与输入框同行，输入框限宽，按钮同行 ---- */
    '#header form.ant-form-horizontal{display:flex;align-items:center;flex-wrap:wrap;gap:10px 14px;}',
    '#header form.ant-form-horizontal > .ant-row.ant-form-item{display:flex;align-items:center;margin-bottom:0;flex:0 0 auto;}',
    '#header form.ant-form-horizontal .ant-form-item-label{flex:0 0 auto;line-height:32px;padding-right:2px;}',
    '#header form.ant-form-horizontal .ant-form-item-label label{padding-bottom:0;color:#595959;}',
    '#header form.ant-form-horizontal .ant-form-item-control-wrapper{flex:0 0 auto;}',
    '#header form.ant-form-horizontal input.ant-input{width:300px;}',
    '#header input.ant-input::placeholder{color:#bfbfbf;}',

    /* ---- 空状态 ---- */
    '.rd-empty{display:flex;flex-direction:column;align-items:center;gap:2px;}',
    '.rd-empty .rd-empty-t{font-size:14px;color:rgba(0,0,0,.55);}',
    '.rd-empty .rd-empty-h{font-size:12.5px;color:rgba(0,0,0,.35);line-height:1.6;text-align:center;max-width:420px;}',
    '.rd-empty .rd-empty-cta{margin-top:10px;display:inline-flex;align-items:center;height:30px;padding:0 16px;',
    'border:1px solid #1890ff;border-radius:4px;color:#1890ff;background:#fff;font-size:13px;cursor:pointer;',
    'transition:all .15s;}',
    '.rd-empty .rd-empty-cta:hover{background:#1890ff;color:#fff;}'
  ].join('');

  function ensureStyle() {
    if (document.getElementById('rd-polish-style')) return;
    var s = document.createElement('style');
    s.id = 'rd-polish-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function txt(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, '').trim() : '';
  }

  /* ---------- 1. 顶栏图标补说明 ---------- */
  function polishIcons() {
    var icons = document.querySelectorAll('.ant-layout-header i.anticon');
    for (var i = 0; i < icons.length; i++) {
      var cls = String(icons[i].className || '');
      var key = null;
      for (var k in ICON_LABEL) {
        if (cls.indexOf('anticon-' + k) >= 0) { key = k; break; }
      }
      if (!key) continue;
      var label = ICON_LABEL[key];
      var host = icons[i].closest('a') || icons[i];
      if (host.getAttribute('title') !== label) host.setAttribute('title', label);
      if (icons[i].getAttribute('aria-label') !== label) icons[i].setAttribute('aria-label', label);
      icons[i].setAttribute('aria-hidden', 'false');
    }
  }

  /* ---------- 2. 查询区 placeholder ---------- */
  function polishSearch() {
    var form = document.querySelector('#header form.ant-form-horizontal, #header form.ant-form-inline');
    if (!form) return;
    var inputs = form.querySelectorAll('input.ant-input');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      if (input.getAttribute('data-rd-ph')) continue;
      var item = input.closest('.ant-form-item');
      var label = item ? txt(item.querySelector('.ant-form-item-label')) : '';
      var hint = SEARCH_HINT[label.replace(/[:：]/g, '')];
      if (!hint) continue;
      input.setAttribute('placeholder', hint);
      input.setAttribute('data-rd-ph', '1');
    }
  }

  /* ---------- 3. 空状态中文化 ---------- */
  function pageKey() {
    var h = location.hash || '';
    var m = h.match(/^#\/([A-Za-z]+)/);
    return m ? m[1] : 'default';
  }

  function findButton(re) {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (re.test(txt(btns[i]))) return btns[i];
    }
    return null;
  }

  function polishEmpty() {
    var boxes = document.querySelectorAll('.ant-empty-description');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      if (box.querySelector('.rd-empty')) continue;
      if (txt(box) !== 'NoData') continue;

      var cfg = EMPTY[pageKey()] || EMPTY.default;
      var wrap = document.createElement('div');
      wrap.className = 'rd-empty';

      var t = document.createElement('div');
      t.className = 'rd-empty-t';
      t.textContent = cfg.text;
      wrap.appendChild(t);

      if (cfg.hint) {
        var h = document.createElement('div');
        h.className = 'rd-empty-h';
        h.textContent = cfg.hint;
        wrap.appendChild(h);
      }

      if (cfg.cta) {
        var btnText = cfg.cta;
        var cta = document.createElement('button');
        cta.type = 'button';
        cta.className = 'rd-empty-cta';
        cta.textContent = btnText;
        cta.addEventListener('click', function (name) {
          return function () {
            var target = findButton(new RegExp(name.split('').join('\\s*')));
            if (target) target.click();
          };
        }(btnText));
        wrap.appendChild(cta);
      }

      box.textContent = '';
      box.appendChild(wrap);
    }
  }

  /* ---------- 调度 ---------- */
  var timer = null;
  function run() {
    ensureStyle();
    polishIcons();
    polishSearch();
    polishEmpty();
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 80);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', schedule);
})();
