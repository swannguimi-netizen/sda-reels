/*!
 * Widget de chat — Assistant IA
 * Intégration : <script src="https://VOTRE-APP/widget.js" charset="utf-8" data-key="CLÉ" data-api="https://PROJET.supabase.co/functions/v1/widget-chat" async></script>
 * Options : data-inline="#conteneur" (affichage intégré, toujours ouvert), data-open="true" (ouvert au chargement),
 *           data-preview="true" (aperçu dans l'application : historique séparé)
 * Autonome, sans dépendance ; isolé du site hôte par un Shadow DOM.
 */
(function () {
  'use strict'
  var script = document.currentScript
  // Balise retirée avant exécution (aperçu rechargé) : on ne démarre pas
  if (!script || !script.isConnected) return
  var KEY = script.getAttribute('data-key')
  var API = script.getAttribute('data-api')
  var INLINE = script.getAttribute('data-inline')
  if (!KEY || !API) return console.warn('[assistant] data-key et data-api sont requis')
  if (!INLINE && window.__assistantWidgetLoaded) return
  if (!INLINE) window.__assistantWidgetLoaded = true

  // ------------------------------------------------------------------ état
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)) } catch (e) { return null } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { /* navigation privée */ } },
  }
  var visitorId = store.get('assistant_vid')
  if (!visitorId) {
    visitorId = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    store.set('assistant_vid', visitorId)
  }
  var PREVIEW = script.getAttribute('data-preview') === 'true'
  var convKey = 'assistant_conv_' + KEY + (PREVIEW ? '_preview' : '')
  var saved = store.get(convKey) || {}
  var state = {
    config: null,
    open: !!INLINE,
    conversationId: saved.id || null,
    messages: saved.messages || [],
    sending: false,
    unread: 0,
    lastAt: saved.lastAt || null,
  }
  function persist() {
    store.set(convKey, { id: state.conversationId, messages: state.messages.slice(-50), lastAt: state.lastAt })
  }

  function api(payload) {
    payload.key = KEY
    payload.visitor_id = visitorId
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok && !d.reply) throw d; return d }) })
  }

  // ------------------------------------------------------------------ rendu
  var host = document.createElement('div')
  host.setAttribute('data-assistant-widget', '')
  var mount = INLINE ? document.querySelector(INLINE) : document.body
  if (!mount) return console.warn('[assistant] conteneur introuvable : ' + INLINE)
  if (INLINE) {
    // Une seule instance par conteneur : l'ancienne est arrêtée puis retirée
    Array.prototype.forEach.call(mount.querySelectorAll('[data-assistant-widget]'), function (old) {
      if (old.__destroy) old.__destroy()
      old.remove()
    })
  }
  mount.appendChild(host)
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host

  function el(tag, attrs, children) {
    var n = document.createElement(tag)
    for (var k in attrs || {}) {
      if (k === 'text') n.textContent = attrs[k]
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k])
      else n.setAttribute(k, attrs[k])
    }
    ;(children || []).forEach(function (c) { if (c) n.appendChild(c) })
    return n
  }

  /** Texte -> nœuds DOM sûrs : retours à la ligne, **gras**, liens, emails, téléphones. */
  function richText(text) {
    var frag = document.createDocumentFragment()
    var re = /(\*\*[^*]+\*\*|https?:\/\/[^\s<]+[^\s<.,;:!?)]|[\w.+-]+@[\w-]+\.[\w.-]+|(?:\+\d{2,3}\s?)?0?\d(?:[\s.]?\d{2}){4})/g
    text.split('\n').forEach(function (line, i) {
      if (i) frag.appendChild(document.createElement('br'))
      var last = 0
      line.replace(re, function (m, _g, idx) {
        if (idx > last) frag.appendChild(document.createTextNode(line.slice(last, idx)))
        if (m.slice(0, 2) === '**') frag.appendChild(el('strong', { text: m.slice(2, -2) }))
        else if (/^https?:/.test(m)) frag.appendChild(el('a', { href: m, target: '_blank', rel: 'noopener noreferrer', text: m }))
        else if (m.indexOf('@') > 0) frag.appendChild(el('a', { href: 'mailto:' + m, text: m }))
        else frag.appendChild(el('a', { href: 'tel:' + m.replace(/[\s.]/g, ''), text: m }))
        last = idx + m.length
      })
      if (last < line.length) frag.appendChild(document.createTextNode(line.slice(last)))
    })
    return frag
  }

  var css = function (c, pos) {
    return ':host{all:initial}*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif}' +
      '.launcher{position:fixed;bottom:20px;' + pos + ':20px;z-index:2147483000;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;background:' + c + ';color:#fff;box-shadow:0 8px 24px rgba(15,23,42,.25);display:flex;align-items:center;justify-content:center;transition:transform .2s}' +
      '.launcher:hover{transform:scale(1.06)}.launcher svg{width:28px;height:28px}' +
      '.badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;border-radius:10px;background:#ef4444;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;border:2px solid #fff}' +
      '.teaser{position:fixed;bottom:92px;' + pos + ':20px;z-index:2147483000;max-width:260px;background:#fff;color:#0f172a;border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.4;box-shadow:0 8px 24px rgba(15,23,42,.18);cursor:pointer;animation:pop .3s ease}' +
      '.teaser button{position:absolute;top:4px;right:6px;border:0;background:none;color:#94a3b8;cursor:pointer;font-size:16px}' +
      '.panel{position:fixed;bottom:92px;' + pos + ':20px;z-index:2147483000;width:370px;height:min(600px,calc(100vh - 120px));background:#fff;border-radius:18px;box-shadow:0 16px 48px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden;animation:pop .2s ease}' +
      '.panel.inline{position:relative;bottom:auto;right:auto;left:auto;width:100%;height:100%;min-height:480px;box-shadow:0 1px 3px rgba(15,23,42,.12);border:1px solid #e2e8f0;animation:none}' +
      '@media (max-width:480px){.panel:not(.inline){inset:0;width:100%;height:100%;border-radius:0}}' +
      '@keyframes pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
      '.head{background:' + c + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}' +
      '.avatar{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-weight:700;overflow:hidden;flex-shrink:0}' +
      '.avatar img{width:100%;height:100%;object-fit:contain;background:#fff}' +
      '.title{flex:1;min-width:0}.title b{display:block;font-size:15px}.title span{font-size:12px;opacity:.85;display:flex;align-items:center;gap:5px}' +
      '.dot{width:7px;height:7px;border-radius:50%;background:#4ade80;display:inline-block}' +
      '.close{border:0;background:rgba(255,255,255,.15);color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:18px}' +
      '.msgs{flex:1;overflow-y:auto;padding:16px;background:#f8fafc;display:flex;flex-direction:column;gap:8px}' +
      '.msg{max-width:82%;padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.45;word-wrap:break-word;white-space:normal}' +
      '.msg a{color:inherit;text-decoration:underline}' +
      '.bot{background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-bottom-left-radius:4px;align-self:flex-start}' +
      '.agent{background:#fff;color:#0f172a;border:1px solid ' + c + ';border-bottom-left-radius:4px;align-self:flex-start}' +
      '.agent-label{font-size:11px;color:' + c + ';font-weight:600;margin:0 0 -4px 4px}' +
      '.me{background:' + c + ';color:#fff;border-bottom-right-radius:4px;align-self:flex-end}' +
      '.err{align-self:center;font-size:12px;color:#b91c1c;background:#fef2f2;padding:6px 10px;border-radius:8px}' +
      '.typing{display:flex;gap:4px;padding:12px 14px}.typing i{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:b 1.2s infinite}' +
      '.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}@keyframes b{0%,60%,100%{opacity:.3;transform:none}30%{opacity:1;transform:translateY(-3px)}}' +
      '.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px;background:#f8fafc}' +
      '.chip{border:1px solid ' + c + ';color:' + c + ';background:#fff;border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer}' +
      '.chip:hover{background:' + c + ';color:#fff}' +
      'form{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff}' +
      'textarea{flex:1;resize:none;border:1px solid #cbd5e1;border-radius:12px;padding:9px 12px;font-size:14px;max-height:110px;outline:none;line-height:1.4;color:#0f172a}' +
      'textarea:focus{border-color:' + c + '}' +
      '.send{border:0;background:' + c + ';color:#fff;width:42px;border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
      '.send:disabled{opacity:.5;cursor:default}.send svg{width:18px;height:18px}' +
      '.foot{text-align:center;font-size:11px;color:#94a3b8;padding:0 0 8px;background:#fff}'
  }

  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>'

  var ui = {}

  function render() {
    var cfg = state.config
    root.innerHTML = ''
    root.appendChild(el('style', { text: css(cfg.color, cfg.position === 'left' ? 'left' : 'right') }))

    if (!INLINE) {
      var launcher = el('button', { class: 'launcher', 'aria-label': state.open ? 'Fermer la discussion' : 'Ouvrir la discussion avec ' + cfg.assistant_name, onclick: toggle })
      launcher.innerHTML = state.open ? ICON_CLOSE : ICON_CHAT
      if (!state.open && state.unread) launcher.appendChild(el('span', { class: 'badge', text: String(state.unread) }))
      root.appendChild(launcher)
      if (!state.open && !state.messages.length && !store.get('assistant_teaser_' + KEY)) {
        var teaser = el('div', { class: 'teaser', role: 'button', tabindex: '0', onclick: toggle }, [
          el('button', { 'aria-label': 'Masquer', text: '×', onclick: function (e) { e.stopPropagation(); store.set('assistant_teaser_' + KEY, 1); render() } }),
          el('span', { text: cfg.welcome_message }),
        ])
        setTimeout(function () { if (!state.open && teaser.isConnected) teaser.style.display = '' }, 0)
        root.appendChild(teaser)
      }
    }
    if (!state.open) return

    var avatar = el('div', { class: 'avatar' })
    if (cfg.logo_url) avatar.appendChild(el('img', { src: cfg.logo_url, alt: '' }))
    else avatar.textContent = (cfg.company_name || '?').charAt(0).toUpperCase()

    ui.msgs = el('div', { class: 'msgs', role: 'log', 'aria-live': 'polite' })
    ui.input = el('textarea', { rows: '1', placeholder: 'Écrivez votre message…', 'aria-label': 'Votre message', maxlength: '1000' })
    ui.send = el('button', { class: 'send', type: 'submit', 'aria-label': 'Envoyer' })
    ui.send.innerHTML = ICON_SEND
    ui.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
    })
    ui.input.addEventListener('input', function () {
      ui.input.style.height = 'auto'
      ui.input.style.height = Math.min(ui.input.scrollHeight, 110) + 'px'
    })

    var head = el('div', { class: 'head' }, [
      avatar,
      el('div', { class: 'title' }, [
        el('b', { text: cfg.assistant_name }),
        el('span', {}, [el('i', { class: 'dot' }), document.createTextNode(cfg.company_name + ' · répond en quelques secondes')]),
      ]),
    ])
    if (!INLINE) {
      var close = el('button', { class: 'close', 'aria-label': 'Fermer', onclick: toggle })
      close.innerHTML = ICON_CLOSE
      close.firstChild.setAttribute('width', '16')
      head.appendChild(close)
    }

    ui.chips = el('div', { class: 'chips' })
    var panel = el('div', { class: 'panel' + (INLINE ? ' inline' : ''), role: 'dialog', 'aria-label': 'Discussion avec ' + cfg.assistant_name }, [
      head,
      ui.msgs,
      ui.chips,
      el('form', { onsubmit: function (e) { e.preventDefault(); submit() } }, [ui.input, ui.send]),
      el('div', { class: 'foot', text: 'Assistant IA · vos messages sont transmis à ' + cfg.company_name }),
    ])
    root.appendChild(panel)
    renderMessages()
    if (!INLINE) setTimeout(function () { ui.input.focus() }, 50)
  }

  function renderMessages() {
    if (!ui.msgs) return
    ui.msgs.innerHTML = ''
    ui.msgs.appendChild(bubble({ role: 'assistant', content: state.config.welcome_message }))
    var prevRole = null
    state.messages.forEach(function (m) {
      if (m.role === 'agent' && prevRole !== 'agent') ui.msgs.appendChild(el('div', { class: 'agent-label', text: 'Réponse de l’équipe' }))
      ui.msgs.appendChild(bubble(m))
      prevRole = m.role
    })
    if (state.sending) ui.msgs.appendChild(el('div', { class: 'msg bot typing', 'aria-label': 'L’assistant écrit' }, [el('i'), el('i'), el('i')]))
    if (state.error) ui.msgs.appendChild(el('div', { class: 'err', text: state.error }))
    ui.msgs.scrollTop = ui.msgs.scrollHeight

    ui.chips.innerHTML = ''
    var hasVisitor = state.messages.some(function (m) { return m.role === 'visitor' })
    if (!hasVisitor) {
      ;(state.config.suggestions || []).forEach(function (s) {
        ui.chips.appendChild(el('button', { class: 'chip', type: 'button', text: s, onclick: function () { submit(s) } }))
      })
    }
    ui.send.disabled = state.sending
  }

  function bubble(m) {
    var cls = m.role === 'visitor' ? 'me' : m.role === 'agent' ? 'agent' : 'bot'
    var b = el('div', { class: 'msg ' + cls })
    b.appendChild(richText(m.content))
    return b
  }

  function addMessages(list) {
    var known = {}
    state.messages.forEach(function (m) { if (m.id) known[m.id] = 1 })
    var added = 0
    list.forEach(function (m) {
      if (m && !known[m.id]) { state.messages.push(m); added++ }
      if (m && m.created_at && (!state.lastAt || m.created_at > state.lastAt)) state.lastAt = m.created_at
    })
    if (added) {
      if (!state.open) state.unread += added
      persist()
    }
    return added
  }

  function submit(preset) {
    var text = (preset || ui.input.value).trim()
    if (!text || state.sending) return
    ui.input.value = ''
    ui.input.style.height = 'auto'
    state.error = null
    state.messages.push({ role: 'visitor', content: text, created_at: new Date().toISOString() })
    state.sending = true
    persist()
    renderMessages()
    api({ action: 'message', conversation_id: state.conversationId, message: text, page_url: location.href })
      .then(function (d) {
        if (d.error) throw d
        state.conversationId = d.conversation_id
        if (d.reply) addMessages([d.reply])
      })
      .catch(function (e) { state.error = (e && e.error) || 'Connexion impossible, réessayez.' })
      .then(function () { state.sending = false; persist(); renderMessages() })
  }

  function toggle() {
    state.open = !state.open
    if (state.open) state.unread = 0
    render()
  }

  // Réponses de l'équipe (reprise en main) : interrogation périodique
  function poll() {
    if (!state.conversationId || state.sending) return
    api({ action: 'poll', conversation_id: state.conversationId, after: state.lastAt })
      .then(function (d) { if (addMessages(d.messages || [])) state.open ? renderMessages() : render() })
      .catch(function () { /* réseau : on réessaiera */ })
  }
  var timer = setInterval(function () {
    if (!host.isConnected) return clearInterval(timer)
    if (state.open || state.conversationId) poll()
  }, 6000)
  host.__destroy = function () { clearInterval(timer) }

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open && !INLINE) toggle() })

  api({ action: 'config' })
    .then(function (cfg) {
      state.config = cfg
      if (script.getAttribute('data-open') === 'true') state.open = true
      render()
      poll()
    })
    .catch(function (e) { console.warn('[assistant]', (e && e.error) || e) })
})()
