/**
 * Домовой – клиентская логика.
 * Данные хранятся в XML (папка data/), загружаются через fetch и разбираются DOMParser.
 * Заявки, созданные пользователем, сериализуются обратно в XML-строку (localStorage).
 * Весь вывод строится методами DOM и textContent – без innerHTML (защита от XSS).
 */
(function () {
  'use strict';

  // ---------- Справочники ----------
  var STATUS = { new: 'Принята', work: 'В работе', done: 'Выполнена', rejected: 'Отклонена' };
  var TYPE = { emergency: 'Авария', planned: 'Плановое' };
  var SERVICE = { water: 'Вода', heat: 'Тепло', power: 'Электричество' };
  var DISTRICT = { central: 'Центральный', north: 'Северный' };
  var CATEGORY = {
    water: 'Водоснабжение',
    heating: 'Отопление',
    power: 'Электроснабжение',
    yard: 'Благоустройство',
    other: 'Другое'
  };
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var STORE_KEY = 'domovoy.requests.v1';
  var AUTH_KEY = 'domovoy.auth.v1';

  // ---------- Утилиты DOM ----------
  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  /** Создаёт элемент: класс, текст (через textContent) и атрибуты. Единственная точка создания HTML-узлов. */
  function el(tag, className, text, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttribute(key, attrs[key]);
      });
    }
    return node;
  }

  /** Создаёт SVG-элемент в пространстве имён SVG (createElementNS), иначе браузер не отрисует его. */
  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  /** Удаляет всех потомков узла перед повторной отрисовкой списка. */
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** Возвращает <svg><use> со ссылкой на символ спрайта assets/icons.svg#i-<имя>. */
  function icon(name, extraClass) {
    var svg = svgEl('svg', { class: 'icon' + (extraClass ? ' ' + extraClass : ''), 'aria-hidden': 'true', focusable: 'false' });
    var use = svgEl('use', {});
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'assets/icons.svg#i-' + name);
    use.setAttribute('href', 'assets/icons.svg#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  // ---------- Работа с XML ----------
  function parseXML(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Некорректный XML');
    }
    return doc;
  }

  /** Загружает XML-файл через fetch и возвращает Promise с XML-документом. */
  function loadXML(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error('Не удалось загрузить ' + url + ' (' + response.status + ')');
      return response.text().then(parseXML);
    });
  }

  /** Возвращает текст первого дочернего элемента с заданным тегом (пустая строка, если его нет). */
  function childText(node, tag) {
    var child = node.getElementsByTagName(tag)[0];
    return child ? child.textContent.trim() : '';
  }

  /** Показывает в контейнере понятное сообщение, если данные не загрузились (role="alert"). */
  function showLoadError(container) {
    clear(container);
    var box = el('p', 'muted', 'Не удалось загрузить данные. Обновите страницу или повторите попытку позже.', { role: 'alert' });
    container.appendChild(box);
  }

  // ---------- Даты ----------
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /** Разбирает дату ISO (ГГГГ-ММ-ДД[ТЧЧ:ММ]) в объект частей; null, если формат неверный. */
  function splitDate(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value || '');
    return m ? { y: m[1], mo: m[2], d: m[3], h: m[4] || '', mi: m[5] || '' } : null;
  }

  /** Формат ДД.ММ.ГГГГ. */
  function fmtDate(value) {
    var p = splitDate(value);
    return p ? p.d + '.' + p.mo + '.' + p.y : '';
  }

  /** Формат ДД.ММ, ЧЧ:ММ. */
  function fmtDateTime(value) {
    var p = splitDate(value);
    return p ? p.d + '.' + p.mo + (p.h ? ', ' + p.h + ':' + p.mi : '') : '';
  }

  /** Формат ДД.ММ.ГГГГ, ЧЧ:ММ. */
  function fmtFull(value) {
    var p = splitDate(value);
    return p ? p.d + '.' + p.mo + '.' + p.y + (p.h ? ', ' + p.h + ':' + p.mi : '') : '';
  }

  /** Человекочитаемый период отключения (один день или несколько, либо «срок уточняется»). */
  function fmtPeriod(from, to) {
    var a = splitDate(from);
    var b = splitDate(to);
    if (!a) return '';
    if (!b) return 'С ' + a.h + ':' + a.mi + ', срок уточняется';
    if (a.y === b.y && a.mo === b.mo && a.d === b.d) return 'С ' + a.h + ' до ' + b.h + ':' + b.mi;
    return a.d + '.' + a.mo + ' – ' + b.d + '.' + b.mo + ', ' + a.h + ':' + a.mi + '–' + b.h + ':' + b.mi;
  }

  // ---------- Модель: отключения ----------
  function parseOutage(node) {
    var period = node.getElementsByTagName('period')[0];
    var map = node.getElementsByTagName('map')[0];
    return {
      id: node.getAttribute('id'),
      type: node.getAttribute('type'),
      service: node.getAttribute('service'),
      district: node.getAttribute('district'),
      title: childText(node, 'title'),
      address: childText(node, 'address'),
      from: period ? period.getAttribute('from') : '',
      to: period ? period.getAttribute('to') : '',
      reason: childText(node, 'reason'),
      x: map ? Number(map.getAttribute('x')) : 0,
      y: map ? Number(map.getAttribute('y')) : 0,
      r: map ? Number(map.getAttribute('r')) : 40
    };
  }

  /** Загружает data/outages.xml и возвращает массив объектов отключений. */
  function loadOutages() {
    return loadXML('data/outages.xml').then(function (doc) {
      return Array.prototype.map.call(doc.getElementsByTagName('outage'), parseOutage);
    });
  }

  /** Подбирает имя иконки по виду услуги (вода, тепло, электричество). */
  function serviceIcon(service) {
    return service === 'water' ? 'drop' : service === 'heat' ? 'flame' : 'bolt';
  }

  // ---------- Модель: заявки ----------
  function parseRequest(node) {
    var events = Array.prototype.map.call(node.getElementsByTagName('event'), function (ev) {
      return { at: ev.getAttribute('at'), status: ev.getAttribute('status'), text: ev.textContent.trim() };
    });
    return {
      id: node.getAttribute('id'),
      status: node.getAttribute('status'),
      created: childText(node, 'created'),
      category: childText(node, 'category'),
      address: childText(node, 'address'),
      description: childText(node, 'description'),
      events: events,
      local: node.getAttribute('local') === 'true',
      owner: node.getAttribute('owner') || 'me',
      supporters: parseInt(childText(node, 'supporters'), 10) || 0
    };
  }

  /** Читает XML-документ заявок пользователя из localStorage или создаёт пустой <requests>. */
  function localDoc() {
    var stored = null;
    try {
      stored = window.localStorage.getItem(STORE_KEY);
    } catch (e) {
      stored = null;
    }
    if (stored) {
      try {
        return parseXML(stored);
      } catch (e) {
        /* повреждённые данные игнорируем */
      }
    }
    return parseXML('<?xml version="1.0" encoding="UTF-8"?><requests></requests>');
  }

  /** Сериализует XML-документ заявок (XMLSerializer) и сохраняет его в localStorage. */
  function saveLocalDoc(doc) {
    try {
      window.localStorage.setItem(STORE_KEY, new XMLSerializer().serializeToString(doc));
    } catch (e) {
      /* хранилище недоступно (приватный режим) – заявка живёт до перезагрузки */
    }
  }

  /** Объединяет заявки из data/requests.xml с заявками из localStorage. */
  function loadRequests() {
    return loadXML('data/requests.xml').then(function (baseDoc) {
      var items = Array.prototype.map.call(baseDoc.getElementsByTagName('request'), parseRequest);
      var local = Array.prototype.map.call(localDoc().getElementsByTagName('request'), parseRequest);
      return local.concat(items).sort(function (a, b) {
        return a.created < b.created ? 1 : -1;
      });
    });
  }

  /** Вычисляет следующий номер заявки вида ГГГГ-NNNN по уже имеющимся. */
  function nextRequestNumber(existing) {
    var max = 0;
    existing.forEach(function (r) {
      var n = parseInt(String(r.id).split('-')[1], 10);
      if (n > max) max = n;
    });
    return '2026-' + String(max + 1).padStart(4, '0');
  }

  /** Создаёт XML-узел новой заявки методами DOM, добавляет в документ и сохраняет; возвращает номер. */
  function addLocalRequest(data, existing) {
    var doc = localDoc();
    var root = doc.documentElement;
    var now = new Date();
    var stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    var id = nextRequestNumber(existing);

    var req = doc.createElement('request');
    req.setAttribute('id', id);
    req.setAttribute('status', 'new');
    req.setAttribute('local', 'true');
    [['created', stamp], ['category', data.category], ['address', data.address], ['description', data.description], ['phone', data.phone]].forEach(function (pair) {
      var node = doc.createElement(pair[0]);
      node.textContent = pair[1];
      req.appendChild(node);
    });
    var events = doc.createElement('events');
    var ev = doc.createElement('event');
    ev.setAttribute('at', stamp);
    ev.setAttribute('status', 'new');
    ev.textContent = 'Заявка принята';
    events.appendChild(ev);
    req.appendChild(events);
    root.appendChild(req);
    saveLocalDoc(doc);
    return id;
  }

  /** Создаёт «чип» статуса; цвет задаётся атрибутом data-status в SCSS. */
  function statusBadge(code, label) {
    return el('span', 'status', label || STATUS[code] || code, { 'data-status': code });
  }

  // ---------- Навигация ----------
  function initNav() {
    var toggle = $('#nav-toggle');
    var nav = $('#site-nav');
    if (!toggle || !nav) return;

    /** Открывает или закрывает меню, синхронизируя aria-expanded и подпись кнопки. */
    function setOpen(open) {
      nav.setAttribute('data-open', open ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    }

    toggle.addEventListener('click', function () {
      setOpen(nav.getAttribute('data-open') !== 'true');
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.getAttribute('data-open') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });
    setOpen(false);
  }

  // ---------- Форма заявки (главная и страница «Подать заявку») ----------
  function initRequestForm(form) {
    var confirmBox = $('[data-confirm]');

    /** Находит обёртку поля формы по атрибуту data-field. */
    function field(name) {
      return $('[data-field="' + name + '"]', form);
    }

    /** Показывает или снимает сообщение об ошибке у поля и выставляет aria-invalid. */
    function setError(name, message) {
      var wrap = field(name);
      if (!wrap) return;
      var control = $('input:not([type=radio]):not([type=checkbox]), select, textarea', wrap) || $('input', wrap);
      var errNode = $('.field__error', wrap);
      if (message) {
        wrap.classList.add('field--error');
        if (!errNode) {
          errNode = el('p', 'field__error', '', { id: 'err-' + name });
          wrap.appendChild(errNode);
        }
        errNode.textContent = message;
        if (control) {
          control.setAttribute('aria-invalid', 'true');
          control.setAttribute('aria-describedby', 'err-' + name);
        }
      } else {
        wrap.classList.remove('field--error');
        if (errNode) errNode.remove();
        if (control) {
          control.removeAttribute('aria-invalid');
          control.removeAttribute('aria-describedby');
        }
      }
    }

    /** Возвращает очищенное значение поля формы. */
    function value(name) {
      var control = form.elements[name];
      if (!control) return '';
      if (control.length !== undefined && !control.tagName) {
        var checked = Array.prototype.filter.call(control, function (r) {
          return r.checked;
        })[0];
        return checked ? checked.value : '';
      }
      return String(control.value || '').trim();
    }

    /** Проверяет все поля формы; возвращает true, если ошибок нет. */
    function validate() {
      var errors = {};
      if (!value('category')) errors.category = 'Выберите категорию проблемы';
      if (value('address').length < 5) errors.address = 'Укажите адрес: улица, дом, квартира';
      if (!/^\+?[\d\s()\-]{9,}$/.test(value('phone'))) errors.phone = 'Введите телефон, например +375 29 000-00-00';
      if (value('description').length < 10) errors.description = 'Опишите проблему подробнее (не менее 10 символов)';
      if (!form.elements.consent.checked) errors.consent = 'Нужно согласие на обработку данных';
      ['category', 'address', 'phone', 'description', 'consent'].forEach(function (name) {
        setError(name, errors[name] || '');
      });
      return errors;
    }

    ['address', 'phone', 'description'].forEach(function (name) {
      var control = form.elements[name];
      if (control) control.addEventListener('input', function () {
        if (field(name) && field(name).classList.contains('field--error')) setError(name, '');
      });
    });

    // «Мой адрес»: подставляем сохранённый адрес, если поле пустое
    var savedAddress = readStore(ADDR_KEY);
    if (savedAddress && form.elements.address && !form.elements.address.value) {
      form.elements.address.value = savedAddress;
    }
    // подсказка «У меня то же самое» и диктовка описания
    var checkSimilar = initSimilar(form, function () { return value('address'); }, function () { return value('category'); }, field('address'));
    if (form.elements.address) {
      form.elements.address.addEventListener('input', checkSimilar);
    }
    $$('[name=category]', form).forEach(function (control) {
      control.addEventListener('change', checkSimilar);
    });
    checkSimilar();
    initVoice(form);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var errors = validate();
      var firstKey = Object.keys(errors)[0];
      if (firstKey) {
        var wrap = field(firstKey);
        var focusable = wrap && $('input, select, textarea', wrap);
        if (focusable) focusable.focus();
        return;
      }
      var submit = $('[type=submit]', form);
      submit.setAttribute('aria-busy', 'true');
      submit.disabled = true;
      loadRequests()
        .catch(function () {
          return [];
        })
        .then(function (existing) {
          var id = addLocalRequest({
            category: value('category'),
            address: value('address'),
            phone: value('phone'),
            description: value('description')
          }, existing);
          window.setTimeout(function () {
            submit.removeAttribute('aria-busy');
            submit.disabled = false;
            form.reset();
            checkSimilar();
            if (confirmBox) {
              $('[data-confirm-id]', confirmBox).textContent = id;
              confirmBox.hidden = false;
              confirmBox.focus();
            }
          }, 350);
        });
    });
  }

  // Склонение существительного по числу: plural(2, ['авария', 'аварии', 'аварий'])
  function plural(n, forms) {
    var m10 = n % 10;
    var m100 = n % 100;
    if (m10 === 1 && m100 !== 11) {
      return forms[0];
    }
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) {
      return forms[1];
    }
    return forms[2];
  }

  // Сводка отключений в верхнем блоке главной
  function showHeroStatus(items) {
    var box = $('#hero-status');
    if (!box) {
      return;
    }
    var emergency = items.filter(function (o) { return o.type === 'emergency'; }).length;
    var planned = items.length - emergency;
    var parts = [];
    if (emergency) {
      parts.push(emergency + ' ' + plural(emergency, ['авария', 'аварии', 'аварий']));
    }
    if (planned) {
      parts.push(planned + ' ' + plural(planned, ['плановое отключение', 'плановых отключения', 'плановых отключений']));
    }
    if (!parts.length) {
      return;
    }
    box.textContent = 'Сейчас в городе: ' + parts.join(' и ');
    box.hidden = false;
  }

  // ---------- Окна на первом экране: подмигивают по нажатию ----------
  function initWindows() {
    $$('.win').forEach(function (win) {
      var timer = null;
      function wink() {
        win.classList.remove('is-wink');
        // перезапуск анимации при повторном нажатии
        void win.getBoundingClientRect();
        win.classList.add('is-wink');
        clearTimeout(timer);
        timer = setTimeout(function () {
          win.classList.remove('is-wink');
        }, 1100);
      }
      win.addEventListener('click', wink);
      win.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          wink();
        }
      });
    });
  }

  // ---------- Страница: главная ----------
  function pageHome() {
    initWindows();
    initMyHome();
    var list = $('#home-outages');
    if (list) {
      loadOutages().then(function (items) {
        clear(list);
        showHeroStatus(items);
        items.slice(0, 2).forEach(function (o) {
          var card = el('article', 'outage outage--static');
          var top = el('div', 'outage__top');
          top.appendChild(statusBadge(o.type, TYPE[o.type]));
          top.appendChild(icon(serviceIcon(o.service)));
          card.appendChild(top);
          card.appendChild(el('h3', 'h3', o.title));
          card.appendChild(el('p', 'muted', o.address + ' · ' + DISTRICT[o.district] + ' район'));
          card.appendChild(el('p', null, fmtPeriod(o.from, o.to)));
          card.appendChild(el('p', 'muted', 'Причина: ' + o.reason));
          list.appendChild(card);
        });
      }).catch(function (e) {
        showLoadError(list, e);
      });
    }
    var news = $('#home-news');
    if (news) {
      loadXML('data/news.xml').then(function (doc) {
        clear(news);
        Array.prototype.forEach.call(doc.getElementsByTagName('item'), function (n) {
          var card = el('article', 'news-card');
          card.appendChild(el('time', 'news-card__meta', fmtDate(n.getAttribute('date')) + ' · ' + childText(n, 'source'), { datetime: n.getAttribute('date') }));
          card.appendChild(el('h3', 'h4', childText(n, 'title')));
          card.appendChild(el('p', 'muted', childText(n, 'summary')));
          news.appendChild(card);
        });
      }).catch(function (e) {
        showLoadError(news, e);
      });
    }
    var form = $('[data-request-form]');
    if (form) initRequestForm(form);
  }

  // ---------- Страница: подать заявку ----------
  function pageRequest() {
    var form = $('[data-request-form]');
    if (form) initRequestForm(form);
    var select = $('#saved-address');
    var addressInput = $('#address');
    if (select && addressInput) {
      var mine = readStore(ADDR_KEY);
      if (mine) select.appendChild(el('option', null, mine + ' (мой адрес)', { value: mine }));
      loadXML('data/user.xml').then(function (doc) {
        Array.prototype.forEach.call(doc.getElementsByTagName('address'), function (a) {
          var label = a.getAttribute('street') + ', ' + a.getAttribute('house') + ', кв. ' + a.getAttribute('flat');
          select.appendChild(el('option', null, label + ' (' + a.textContent + ')', { value: label }));
        });
      }).catch(function () {
        /* список адресов необязателен */
      });
      select.addEventListener('change', function () {
        if (select.value) {
          addressInput.value = select.value;
          addressInput.dispatchEvent(new Event('input'));
        }
      });
    }
  }

  // ---------- Страница: отключения ----------
  function pageOutages() {
    var listBox = $('#outage-list');
    var layer = $('#map-layer');
    var details = $('#outage-details');
    var counter = $('#outage-count');
    var state = { service: 'all', district: 'all', selected: null };
    var all = [];

    /** Проверяет, подходит ли отключение под выбранные фильтры. */
    function matches(o) {
      return (state.service === 'all' || o.service === state.service) && (state.district === 'all' || o.district === state.district);
    }

    /** Выбирает отключение: подсвечивает строку и маркер, выводит подробности. */
    function select(id) {
      state.selected = state.selected === id ? null : id;
      render();
    }

    /** Заполняет панель подробностей выбранного элемента. */
    function renderDetails(o) {
      clear(details);
      if (!o) {
        details.appendChild(el('p', 'on-dark', 'Выберите отключение в списке или на карте, чтобы увидеть подробности.'));
        return;
      }
      details.appendChild(statusBadge(o.type, TYPE[o.type]));
      details.appendChild(el('h3', 'h3', o.title));
      var dl = el('dl');
      [['Адрес', o.address], ['Район', DISTRICT[o.district]], ['Услуга', SERVICE[o.service]], ['Период', fmtPeriod(o.from, o.to)], ['Причина', o.reason]].forEach(function (row) {
        var group = el('div');
        group.appendChild(el('dt', null, row[0]));
        group.appendChild(el('dd', null, row[1]));
        dl.appendChild(group);
      });
      details.appendChild(dl);
    }

    /** Перерисовывает список (и карту) с учётом текущих фильтров. */
    function render() {
      var visible = all.filter(matches);
      if (state.selected && !visible.some(function (o) { return o.id === state.selected; })) state.selected = null;
      clear(listBox);
      clear(layer);

      visible.forEach(function (o) {
        var pressed = state.selected === o.id ? 'true' : 'false';
        var item = el('li');
        var btn = el('button', 'outage', null, { type: 'button', 'aria-pressed': pressed });
        var top = el('span', 'outage__top');
        top.appendChild(statusBadge(o.type, TYPE[o.type]));
        top.appendChild(icon(serviceIcon(o.service)));
        btn.appendChild(top);
        btn.appendChild(el('span', 'h4', o.title));
        btn.appendChild(el('span', 'muted', o.address + ' · ' + fmtPeriod(o.from, o.to)));
        btn.appendChild(el('span', 'muted', 'Причина: ' + o.reason));
        btn.addEventListener('click', function () {
          select(o.id);
        });
        item.appendChild(btn);
        listBox.appendChild(item);

        var color = o.type === 'emergency' ? '#B8412F' : '#F2C14E';
        var g = svgEl('g', {
          class: 'map__marker',
          role: 'button',
          tabindex: '0',
          'aria-pressed': pressed,
          'aria-label': TYPE[o.type] + ': ' + o.title + ', ' + o.address
        });
        g.appendChild(svgEl('circle', { cx: o.x, cy: o.y, r: o.r, fill: color, opacity: '0.28' }));
        g.appendChild(svgEl('circle', { class: 'map__dot', cx: o.x, cy: o.y, r: 14, fill: color, stroke: '#FFFFFF', 'stroke-width': 4 }));
        g.addEventListener('click', function () {
          select(o.id);
        });
        g.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select(o.id);
          }
        });
        layer.appendChild(g);
      });

      if (!visible.length) {
        var empty = el('li', 'panel-card');
        empty.appendChild(el('p', null, 'По выбранным фильтрам отключений нет.'));
        listBox.appendChild(empty);
      }
      counter.textContent = 'Найдено отключений: ' + visible.length;
      renderDetails(visible.filter(function (o) { return o.id === state.selected; })[0]);
    }

    $$('[data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var group = btn.getAttribute('data-filter');
        state[group] = btn.getAttribute('data-value');
        $$('[data-filter="' + group + '"]').forEach(function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        render();
      });
    });

    loadOutages().then(function (items) {
      all = items;
      render();
    }).catch(function (e) {
      showLoadError(listBox, e);
    });
  }

  // ---------- Страница: мои заявки ----------
  function pageRequests() {
    var body = $('#req-body');
    var details = $('#req-details');
    var counter = $('#req-count');
    var state = { status: 'all', selected: null };
    var all = [];

    /** Заполняет панель подробностей выбранного элемента. */
    function renderDetails(r) {
      clear(details);
      if (!r) {
        details.appendChild(el('p', 'muted', 'Выберите заявку в списке, чтобы увидеть историю статусов.'));
        return;
      }
      details.appendChild(el('h2', 'h3', 'Заявка № ' + r.id));
      details.appendChild(statusBadge(r.status));
      details.appendChild(el('p', 'muted', (CATEGORY[r.category] || r.category) + '. ' + r.description + ' – ' + r.address));
      if (r.owner === 'other') {
        details.appendChild(el('p', null, 'Вы присоединились к заявке соседа. Новую заявку подавать не нужно.'));
      } else if (r.supporters) {
        details.appendChild(el('p', null, 'К заявке присоединились соседей: ' + r.supporters + '.'));
      }
      var ol = el('ol', 'timeline');
      r.events.forEach(function (ev) {
        var li = el('li');
        li.appendChild(el('span', 'timeline__dot', null, { 'aria-hidden': 'true' }));
        var box = el('div');
        box.appendChild(el('strong', null, ev.text));
        box.appendChild(el('div', 'timeline__time', fmtDateTime(ev.at)));
        li.appendChild(box);
        ol.appendChild(li);
      });
      details.appendChild(ol);
    }

    /** Перерисовывает список (и карту) с учётом текущих фильтров. */
    function render() {
      var visible = all.filter(function (r) {
        return state.status === 'all' || r.status === state.status;
      });
      clear(body);
      visible.forEach(function (r) {
        var tr = el('tr', 'data-table__row', null, {
          tabindex: '0',
          'aria-current': state.selected === r.id ? 'true' : 'false'
        });
        var cells = [
          ['', '№ ' + r.id, 'data-table__id'],
          ['Дата и время', fmtFull(r.created)],
          ['Категория', CATEGORY[r.category] || r.category],
          ['Описание', r.description + (r.local ? ' (новая)' : '') + (r.owner === 'other' ? ' (вы присоединились)' : '')]
        ];
        cells.forEach(function (c) {
          tr.appendChild(el('td', c[2] || '', c[1], { 'data-label': c[0] }));
        });
        var statusCell = el('td', '', null, { 'data-label': 'Статус' });
        statusCell.appendChild(statusBadge(r.status));
        tr.appendChild(statusCell);
        /** Выбор заявки в списке мышью или клавиатурой. */
        function choose() {
          state.selected = r.id;
          render();
        }
        tr.addEventListener('click', choose);
        tr.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            choose();
          }
        });
        body.appendChild(tr);
      });
      if (!visible.length) {
        var tr = el('tr');
        tr.appendChild(el('td', '', 'Заявок с таким статусом нет.', { colspan: '5' }));
        body.appendChild(tr);
      }
      counter.textContent = 'Показано заявок: ' + visible.length;
      renderDetails(visible.filter(function (r) { return r.id === state.selected; })[0] || null);
    }

    $$('[data-filter="status"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.status = btn.getAttribute('data-value');
        $$('[data-filter="status"]').forEach(function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        render();
      });
    });

    loadRequests().then(function (items) {
      all = mineOnly(items);
      state.selected = all.length ? all[0].id : null;
      render();
    }).catch(function (e) {
      showLoadError(body.parentNode.parentNode, e);
    });
  }

  // ---------- Страница: тарифы ----------
  function pageTariffs() {
    var body = $('#tariff-body');
    var orgs = $('#org-list');
    if (orgs) {
      loadXML('data/contacts.xml').then(function (doc) {
        clear(orgs);
        Array.prototype.forEach.call(doc.getElementsByTagName('org'), function (o) {
          var card = el('article', 'org');
          var phone = childText(o, 'phone');
          card.appendChild(el('h3', 'h4', childText(o, 'name')));
          card.appendChild(el('a', 'org__phone', phone, { href: 'tel:' + phone.replace(/[^\d+]/g, '') }));
          card.appendChild(el('p', 'org__hours', childText(o, 'hours')));
          card.appendChild(el('p', 'muted', childText(o, 'note')));
          orgs.appendChild(card);
        });
      }).catch(function (e) {
        showLoadError(orgs, e);
      });
    }
    var prices = {};
    loadXML('data/tariffs.xml').then(function (doc) {
      var root = doc.documentElement;
      var currency = root.getAttribute('currency') || 'BYN';
      $('#tariff-currency').textContent = 'Тариф, ' + currency;
      clear(body);
      Array.prototype.forEach.call(doc.getElementsByTagName('tariff'), function (t) {
        var tr = el('tr');
        tr.appendChild(el('td', 'data-table__id', childText(t, 'service'), { 'data-label': 'Услуга' }));
        tr.appendChild(el('td', '', childText(t, 'unit'), { 'data-label': 'Единица' }));
        tr.appendChild(el('td', 'data-table__id', childText(t, 'price'), { 'data-label': 'Тариф, ' + currency }));
        tr.appendChild(el('td', 'muted', childText(t, 'note'), { 'data-label': 'Примечание' }));
        body.appendChild(tr);
        prices[t.getAttribute('id')] = parseFloat(childText(t, 'price').replace(',', '.')) || 0;
      });
      initCalc(prices);
    }).catch(function (e) {
      showLoadError(body.parentNode.parentNode, e);
    });
  }

  // ---------- Страница: личный кабинет ----------
  function loadCabinet() {
    loadXML('data/user.xml').then(function (doc) {
      var root = doc.documentElement;
      $('#cab-name').textContent = childText(root, 'name');
      $('#cab-initials').textContent = childText(root, 'initials');
      var addrBox = $('#cab-addresses');
      clear(addrBox);
      var streets = [];
      Array.prototype.forEach.call(doc.getElementsByTagName('address'), function (a) {
        var li = el('li');
        li.appendChild(el('strong', null, a.getAttribute('street') + ', ' + a.getAttribute('house') + ', кв. ' + a.getAttribute('flat')));
        li.appendChild(el('span', 'muted', a.textContent));
        addrBox.appendChild(li);
        if (a.getAttribute('primary') === 'true') streets.push(a.getAttribute('street'));
      });

      loadOutages().then(function (items) {
        var box = $('#cab-outages');
        clear(box);
        var mine = items.filter(function (o) {
          return streets.some(function (s) { return o.address.indexOf(s) === 0; });
        });
        if (!mine.length) {
          box.appendChild(el('p', 'on-dark', 'Рядом с вашим домом отключений нет.'));
        }
        mine.forEach(function (o) {
          box.appendChild(el('p', 'on-dark', o.address + ' – ' + o.title.toLowerCase() + '. ' + fmtPeriod(o.from, o.to) + '.'));
        });
      }).catch(function (e) {
        showLoadError($('#cab-outages'), e);
      });
    }).catch(function (e) {
      showLoadError($('#cab-addresses'), e);
    });

    var history = $('#cab-requests');
    loadRequests().then(function (items) {
      clear(history);
      mineOnly(items).slice(0, 3).forEach(function (r) {
        var li = el('li', 'cab-request');
        var box = el('div');
        box.appendChild(el('strong', null, '№ ' + r.id + ' · ' + r.description));
        box.appendChild(el('div', 'timeline__time', fmtDate(r.created)));
        li.appendChild(box);
        li.appendChild(statusBadge(r.status));
        history.appendChild(li);
      });
    }).catch(function (e) {
      showLoadError(history, e);
    });
  }

  /** Личный кабинет: имитация входа (sessionStorage), адреса, заявки и отключения рядом с домом. */
  function pageCabinet() {
    var loginView = $('#login-view');
    var view = $('#cabinet-view');
    var form = $('#login-form');
    var errBox = $('#login-error');

    /** Проверяет признак входа в sessionStorage (с защитой от недоступного хранилища). */
    function isAuthed() {
      try {
        return window.sessionStorage.getItem(AUTH_KEY) === '1';
      } catch (e) {
        return false;
      }
    }

    /** Запоминает или сбрасывает признак входа. */
    function setAuthed(on) {
      try {
        if (on) window.sessionStorage.setItem(AUTH_KEY, '1');
        else window.sessionStorage.removeItem(AUTH_KEY);
      } catch (e) {
        /* без sessionStorage вход действует до перезагрузки страницы */
      }
    }

    /** Перерисовывает список (и карту) с учётом текущих фильтров. */
    function render() {
      var on = isAuthed();
      loginView.hidden = on;
      view.hidden = !on;
      if (on && !view.getAttribute('data-loaded')) {
        view.setAttribute('data-loaded', '1');
        loadCabinet();
      }
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      loadXML('data/user.xml').then(function (doc) {
        var user = doc.documentElement;
        var ok = form.elements.login.value.trim() === user.getAttribute('login') && form.elements.password.value === user.getAttribute('password');
        if (ok) {
          errBox.hidden = true;
          setAuthed(true);
          render();
          $('#cab-name').focus();
        } else {
          errBox.textContent = 'Неверный логин или пароль. Проверьте данные и попробуйте снова.';
          errBox.hidden = false;
          form.elements.password.focus();
        }
      }).catch(function (e) {
        errBox.textContent = 'Не удалось проверить данные: ' + e.message;
        errBox.hidden = false;
      });
    });

    $('#logout').addEventListener('click', function () {
      setAuthed(false);
      view.removeAttribute('data-loaded');
      form.reset();
      render();
      form.elements.login.focus();
    });

    render();
  }

  // ---------- Мелкие настройки пользователя (localStorage с запасным вариантом в памяти) ----------
  var ADDR_KEY = 'domovoy.address.v1';
  var JOIN_KEY = 'domovoy.joins.v1';
  var METER_KEY = 'domovoy.meters.v1';
  var LARGE_KEY = 'domovoy.large.v1';
  var memory = {};

  /** Читает строку из хранилища; если оно недоступно, берёт значение из памяти страницы. */
  function readStore(key) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null ? (memory[key] || '') : v;
    } catch (e) {
      return memory[key] || '';
    }
  }

  /** Записывает строку (пустая строка удаляет ключ). */
  function writeStore(key, value) {
    memory[key] = value;
    try {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch (e) {
      /* приватный режим: значение живёт до перезагрузки */
    }
  }

  function readJSON(key, fallback) {
    try {
      return JSON.parse(readStore(key)) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  // ---------- Адреса: разбор и сравнение ----------
  /** Приводит название улицы к сравнимому виду: без «ул.», «пр-т», регистра и «ё». */
  function normStreet(text) {
    return String(text).toLowerCase().replace(/ё/g, 'е')
      .replace(/(^|[\s.,])(улица|ул|проспект|пр-т|пр|переулок|пер|бульвар|б-р)(?=[\s.,]|$)/g, ' ')
      .replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Разбирает «ул. Примерная, 12–18, кв. 3» в улицу и диапазон домов; null, если дома нет. */
  function parseAddress(text) {
    var t = String(text || '').trim();
    var m = /^(.*?),\s*(?:д\.?\s*)?(\d+)\s*(?:[–-]\s*(\d+))?/.exec(t) || /^(.*?)\s+(\d+)\s*(?:[–-]\s*(\d+))?/.exec(t);
    if (!m || !normStreet(m[1])) return null;
    var from = parseInt(m[2], 10);
    return { street: normStreet(m[1]), from: from, to: m[3] ? parseInt(m[3], 10) : from };
  }

  /** Истина, если два адреса на одной улице и их диапазоны домов пересекаются. */
  function sameHouse(a, b) {
    return !!a && !!b && a.street === b.street && a.from <= b.to && b.from <= a.to;
  }

  /** Читает номера заявок, к которым присоединился пользователь. */
  function joinedIds() {
    return readJSON(JOIN_KEY, []);
  }

  function isJoined(id) {
    return joinedIds().indexOf(id) !== -1;
  }

  function setJoined(id, on) {
    var list = joinedIds().filter(function (x) { return x !== id; });
    if (on) list.push(id);
    writeStore(JOIN_KEY, JSON.stringify(list));
  }

  /** Заявки пользователя: свои и те, к которым он присоединился. */
  function mineOnly(items) {
    return items.filter(function (r) { return r.owner !== 'other' || isJoined(r.id); });
  }

  // ---------- Главная: «Что у вашего дома» ----------
  function initMyHome() {
    var form = $('#my-home-form');
    var input = $('#my-home-input');
    var errorBox = $('#my-home-error');
    var result = $('#my-home-result');
    var lead = $('#my-home-lead');
    if (!form || !input || !result) return;
    var data = null;

    /** Загружает отключения и заявки один раз. */
    function load() {
      if (!data) {
        data = Promise.all([
          loadOutages().catch(function () { return []; }),
          loadRequests().catch(function () { return []; })
        ]);
      }
      return data;
    }

    /** Карточка результата: заголовок, иконка и содержимое. */
    function card(iconName, title) {
      var box = el('article', 'my-home__card');
      var head = el('h3', 'h4 my-home__card-title');
      head.appendChild(icon(iconName));
      head.appendChild(document.createTextNode(title));
      box.appendChild(head);
      return box;
    }

    /** Показывает результат для сохранённого адреса. */
    function show(address) {
      var parsed = parseAddress(address);
      load().then(function (pair) {
        var outages = pair[0].filter(function (o) { return sameHouse(parsed, parseAddress(o.address)); });
        var requests = pair[1].filter(function (r) {
          return sameHouse(parsed, parseAddress(r.address));
        });
        var own = requests.filter(function (r) { return r.owner !== 'other'; });
        var neighbours = requests.filter(function (r) { return r.owner === 'other' && (r.status === 'new' || r.status === 'work'); });

        clear(result);
        var bar = el('div', 'my-home__bar');
        var who = el('p', 'my-home__address');
        who.appendChild(icon('pin'));
        who.appendChild(el('strong', null, address));
        bar.appendChild(who);
        var change = el('button', 'chip', 'Изменить', { type: 'button' });
        var forget = el('button', 'chip', 'Забыть адрес', { type: 'button' });
        change.addEventListener('click', function () {
          edit(address);
        });
        forget.addEventListener('click', function () {
          writeStore(ADDR_KEY, '');
          input.value = '';
          edit('');
          input.focus();
        });
        var tools = el('div', 'chips');
        tools.appendChild(change);
        tools.appendChild(forget);
        bar.appendChild(tools);
        result.appendChild(bar);

        var grid = el('div', 'my-home__grid');

        var cOut = card('bolt', 'Отключения');
        if (outages.length) {
          outages.forEach(function (o) {
            var row = el('div', 'my-home__row');
            row.appendChild(statusBadge(o.type, TYPE[o.type]));
            row.appendChild(el('strong', null, o.title));
            row.appendChild(el('span', 'muted', fmtPeriod(o.from, o.to)));
            cOut.appendChild(row);
          });
          cOut.appendChild(el('a', 'my-home__link', 'Посмотреть на карте', { href: 'outages.html' }));
        } else {
          cOut.appendChild(el('p', 'my-home__ok', 'На вашем адресе отключений нет.'));
        }
        grid.appendChild(cOut);

        var cReq = card('doc', 'Ваши заявки');
        if (own.length) {
          own.slice(0, 3).forEach(function (r) {
            var row = el('div', 'my-home__row');
            row.appendChild(statusBadge(r.status));
            row.appendChild(el('strong', null, '№ ' + r.id));
            row.appendChild(el('span', 'muted', r.description));
            cReq.appendChild(row);
          });
          cReq.appendChild(el('a', 'my-home__link', 'Все заявки', { href: 'requests.html' }));
        } else {
          cReq.appendChild(el('p', 'my-home__ok', 'По этому дому ваших заявок нет.'));
        }
        grid.appendChild(cReq);

        var cNb = card('home', 'В вашем доме');
        if (neighbours.length) {
          cNb.appendChild(el('p', null, 'Соседи уже сообщили о проблемах: ' + neighbours.length + '. Если у вас то же самое, присоединитесь к заявке, а не создавайте дубль.'));
        } else {
          cNb.appendChild(el('p', 'muted', 'Открытых заявок соседей нет. Если что-то случилось, сообщите нам.'));
        }
        cNb.appendChild(el('a', 'btn btn--small', 'Подать заявку', { href: 'request.html' }));
        grid.appendChild(cNb);

        result.appendChild(grid);
        result.hidden = false;
        form.hidden = true;
        if (lead) lead.textContent = 'Сводка по вашему дому. Адрес хранится только на этом устройстве.';
      });
    }

    /** Возвращает форму ввода адреса. */
    function edit(value) {
      result.hidden = true;
      form.hidden = false;
      input.value = value;
      errorBox.hidden = true;
      if (lead) lead.textContent = 'Введите адрес один раз, и мы покажем отключения и заявки рядом с вами. Регистрация не нужна, адрес остаётся на этом устройстве.';
      if (value) input.focus();
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = input.value.trim();
      if (!parseAddress(value)) {
        errorBox.textContent = 'Укажите улицу и номер дома, например: ул. Примерная, 12';
        errorBox.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      errorBox.hidden = true;
      input.removeAttribute('aria-invalid');
      writeStore(ADDR_KEY, value);
      show(value);
    });

    var saved = readStore(ADDR_KEY);
    if (saved && parseAddress(saved)) show(saved);
  }

  // ---------- Форма заявки: «У меня то же самое» ----------
  function initSimilar(form, getAddress, getCategory, addressWrap) {
    if (!addressWrap) return function () {};
    var box = el('div', 'similar', null, { 'aria-live': 'polite' });
    box.hidden = true;
    addressWrap.parentNode.insertBefore(box, addressWrap.nextSibling);
    var cache = null;
    var timer = 0;

    function load() {
      if (!cache) cache = loadRequests().catch(function () { return []; });
      return cache;
    }

    /** Строка одной похожей заявки с кнопкой присоединения. */
    function row(r, extra) {
      var item = el('div', 'similar__item');
      var text = el('div', 'similar__text');
      text.appendChild(el('strong', null, '№ ' + r.id + ' · ' + r.description));
      var meta = el('span', 'muted similar__meta');
      var flat = /кв\.?\s*\d+/i.exec(r.address);
      meta.textContent = (flat ? flat[0] + ' · ' : '') + (STATUS[r.status] || r.status) + ' · присоединились: ' + (r.supporters + (isJoined(r.id) ? 1 : 0));
      text.appendChild(meta);
      item.appendChild(text);
      var btn = el('button', 'chip', '', { type: 'button', 'aria-pressed': isJoined(r.id) ? 'true' : 'false' });
      btn.textContent = isJoined(r.id) ? 'Вы присоединились' : 'У меня то же самое';
      btn.addEventListener('click', function () {
        setJoined(r.id, !isJoined(r.id));
        extra();
      });
      item.appendChild(btn);
      return item;
    }

    function update() {
      var addr = parseAddress(getAddress());
      var category = getCategory();
      if (!addr || !category) {
        box.hidden = true;
        return;
      }
      load().then(function (items) {
        var found = items.filter(function (r) {
          return r.owner === 'other' && (r.status === 'new' || r.status === 'work') && r.category === category && sameHouse(addr, parseAddress(r.address));
        });
        clear(box);
        if (!found.length) {
          box.hidden = true;
          return;
        }
        box.appendChild(el('p', 'similar__title', 'Похожая заявка уже есть в вашем доме'));
        box.appendChild(el('p', 'muted', 'Присоединитесь к ней, и новую подавать не нужно: статус появится в разделе «Мои заявки».'));
        found.forEach(function (r) {
          box.appendChild(row(r, update));
        });
        if (found.some(function (r) { return isJoined(r.id); })) {
          box.appendChild(el('p', 'similar__done', 'Готово: вы присоединились. Если у вас другая проблема, отправьте форму как обычно.', { role: 'status' }));
        }
        box.hidden = false;
      });
    }

    return function schedule() {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 200);
    };
  }

  // ---------- Форма заявки: диктовка описания ----------
  function initVoice(form) {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    var area = form.elements.description;
    if (!Recognition || !area) return;
    var wrap = area.parentNode;
    var bar = el('div', 'voice');
    var btn = el('button', 'chip', 'Продиктовать', { type: 'button', 'aria-pressed': 'false' });
    var status = el('span', 'voice__status muted', '', { role: 'status' });
    bar.appendChild(btn);
    bar.appendChild(status);
    wrap.appendChild(bar);
    var rec = null;
    var base = '';

    function stop() {
      if (rec) rec.stop();
    }

    function finish(message) {
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = 'Продиктовать';
      status.textContent = message || '';
      rec = null;
    }

    btn.addEventListener('click', function () {
      if (rec) {
        stop();
        return;
      }
      rec = new Recognition();
      rec.lang = 'ru-RU';
      rec.interimResults = true;
      rec.continuous = true;
      base = area.value.trim();
      rec.onresult = function (event) {
        var text = '';
        for (var i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
        area.value = (base ? base + ' ' : '') + text.trim();
        area.dispatchEvent(new Event('input', { bubbles: true }));
      };
      rec.onerror = function (event) {
        finish(event.error === 'not-allowed' ? 'Нет доступа к микрофону: разрешите его в настройках браузера.' : 'Не удалось распознать речь. Попробуйте ещё раз или введите текст.');
      };
      rec.onend = function () {
        if (rec) finish('');
      };
      try {
        rec.start();
        btn.setAttribute('aria-pressed', 'true');
        btn.textContent = 'Остановить';
        status.textContent = 'Слушаю: говорите, затем нажмите «Остановить».';
      } catch (e) {
        finish('Не удалось включить микрофон.');
      }
    });
  }

  // ---------- Крупный режим ----------
  function initLarge() {
    var btn = $('#a11y-toggle');
    if (!btn) return;
    var root = document.documentElement;

    function apply(on) {
      if (on) root.setAttribute('data-large', 'true');
      else root.removeAttribute('data-large');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    apply(readStore(LARGE_KEY) === '1');
    btn.addEventListener('click', function () {
      var on = root.getAttribute('data-large') !== 'true';
      apply(on);
      writeStore(LARGE_KEY, on ? '1' : '');
    });
  }

  // ---------- Тарифы: калькулятор по показаниям ----------
  function initCalc(prices) {
    var form = $('#calc-form');
    var result = $('#calc-result');
    var saveBtn = $('#calc-save');
    if (!form || !result) return;
    var METERS = [
      { id: 'cold', name: 'Холодная вода', unit: 'м³', tariff: 't1', sewer: true, min: 2 },
      { id: 'hot', name: 'Горячая вода', unit: 'м³', tariff: 't3', sewer: true, min: 1 },
      { id: 'power', name: 'Электроэнергия', unit: 'кВт·ч', tariff: 't5', sewer: false, min: 40 }
    ];
    var last = null;

    function num(text) {
      var s = String(text).trim().replace(/\s/g, '').replace(',', '.');
      return s === '' ? null : /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
    }

    function money(n) {
      return n.toFixed(2).replace('.', ',');
    }

    function qty(n) {
      return String(Math.round(n * 100) / 100).replace('.', ',');
    }

    function setErr(id, message) {
      var p = $('[data-err="' + id + '"]', form);
      if (p) {
        p.textContent = message || '';
        p.hidden = !message;
      }
    }

    // подставляем в «Было» последние сохранённые показания
    var stored = readJSON(METER_KEY, null);
    if (stored && stored.readings) {
      METERS.forEach(function (m) {
        if (stored.readings[m.id] !== undefined && form.elements[m.id + '-prev']) {
          form.elements[m.id + '-prev'].value = String(stored.readings[m.id]).replace('.', ',');
        }
      });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var lines = [];
      var notes = [];
      var readings = {};
      var usage = {};
      var ok = true;
      var sewerQty = 0;
      METERS.forEach(function (m) {
        var a = num(form.elements[m.id + '-prev'].value);
        var b = num(form.elements[m.id + '-now'].value);
        setErr(m.id, '');
        if (a === null && b === null) return;
        if (a === null || b === null || isNaN(a) || isNaN(b)) {
          setErr(m.id, 'Введите оба показания числами, например 125,4');
          ok = false;
          return;
        }
        if (b < a) {
          setErr(m.id, 'Текущее показание меньше прошлого: проверьте цифры');
          ok = false;
          return;
        }
        var used = Math.round((b - a) * 1000) / 1000;
        readings[m.id] = b;
        usage[m.id] = used;
        lines.push({ name: m.name, qty: used, unit: m.unit, price: prices[m.tariff] || 0 });
        if (m.sewer) sewerQty += used;
        var before = stored && stored.usage ? stored.usage[m.id] : undefined;
        if (before !== undefined && before > 0) {
          var change = Math.round(((used - before) / before) * 100);
          if (used > before * 1.5 && used - before >= m.min) {
            notes.push({ warn: true, text: m.name + ': расход вырос на ' + change + ' % (было ' + qty(before) + ', стало ' + qty(used) + ' ' + m.unit + '). Проверьте показания, краны и приборы: возможна утечка.' });
          } else {
            notes.push({ warn: false, text: m.name + ': ' + (change > 0 ? '+' : '') + change + ' % к прошлому месяцу (' + qty(before) + ' ' + m.unit + ').' });
          }
        }
      });
      var area = num(form.elements.area.value);
      setErr('area', '');
      if (isNaN(area)) {
        setErr('area', 'Площадь укажите числом, например 54,5');
        ok = false;
      } else if (area) {
        lines.push({ name: 'Содержание жилья', qty: area, unit: 'м²', price: prices.t6 || 0 });
      }
      if (!ok) return;
      if (!lines.length) {
        setErr('area', 'Введите показания хотя бы одного счётчика или площадь');
        return;
      }
      if (sewerQty > 0) lines.splice(Math.min(lines.length, 2), 0, { name: 'Водоотведение', qty: sewerQty, unit: 'м³', price: prices.t2 || 0 });
      last = { readings: readings, usage: usage };

      clear(result);
      var table = el('table', 'data-table');
      var head = el('tr');
      ['Услуга', 'Объём', 'Тариф', 'Сумма'].forEach(function (h) {
        head.appendChild(el('th', null, h, { scope: 'col' }));
      });
      table.appendChild(el('caption', 'visually-hidden', 'Расчёт платежа'));
      var thead = el('thead');
      thead.appendChild(head);
      table.appendChild(thead);
      var tbody = el('tbody');
      var total = 0;
      lines.forEach(function (l) {
        var sum = Math.round(l.qty * l.price * 100) / 100;
        total += sum;
        var tr = el('tr');
        tr.appendChild(el('td', 'data-table__id', l.name, { 'data-label': 'Услуга' }));
        tr.appendChild(el('td', null, qty(l.qty) + ' ' + l.unit, { 'data-label': 'Объём' }));
        tr.appendChild(el('td', null, money(l.price), { 'data-label': 'Тариф' }));
        tr.appendChild(el('td', 'data-table__id', money(sum), { 'data-label': 'Сумма' }));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      var wrap = el('div', 'table-wrap');
      wrap.appendChild(table);
      result.appendChild(wrap);
      result.appendChild(el('p', 'calc__total', 'К оплате: ' + money(total) + ' BYN'));
      notes.forEach(function (n) {
        result.appendChild(el('p', n.warn ? 'calc__note calc__note--warn' : 'calc__note', n.text));
      });
      if (!notes.length) {
        result.appendChild(el('p', 'calc__note', 'Нажмите «Запомнить показания»: в следующем месяце сайт сравнит расход с этим и предупредит о резком скачке.'));
      }
      result.appendChild(el('p', 'muted', 'Отопление считается по нормативу и здесь не учтено. Расчёт ориентировочный.'));
      result.hidden = false;
      if (saveBtn) saveBtn.disabled = false;
    });

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.addEventListener('click', function () {
        if (!last) return;
        var prev = readJSON(METER_KEY, { readings: {}, usage: {} });
        Object.keys(last.readings).forEach(function (k) { prev.readings[k] = last.readings[k]; });
        Object.keys(last.usage).forEach(function (k) { prev.usage[k] = last.usage[k]; });
        writeStore(METER_KEY, JSON.stringify(prev));
        stored = prev;
        var msg = $('#calc-saved');
        if (msg) {
          msg.textContent = 'Показания сохранены на этом устройстве. В следующий раз поле «Было» заполнится само.';
          msg.hidden = false;
        }
      });
    }
  }

  // ---------- Запуск ----------
  var pages = {
    home: pageHome,
    request: pageRequest,
    outages: pageOutages,
    requests: pageRequests,
    tariffs: pageTariffs,
    cabinet: pageCabinet
  };

  document.addEventListener('DOMContentLoaded', function () {
    initNav();
    initLarge();
    var handler = pages[document.body.getAttribute('data-page')];
    if (handler) handler();
  });
})();
