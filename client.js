window.__ModuleLoader__.load({
  id: '@local/dsh-quote-reply',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const {
      createElement: h, Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
    } = React

    const pluginId = 'quote-reply'
    const namespace = 'quoteReply'
    const draftSource = 'quote-reply'
    const draftChipSelector = '[data-composer-chip="' + draftSource + '"]'
    const draftCodec = {
      trigger: '@',
      name: draftSource,
      showGroupTitle: false,
      candidates: async () => [],
      onPick() {},
      codec: {
        clipboardText: text => text,
        async serialize(text, signal) {
          signal.throwIfAborted()
          return text
        },
      },
    }
    const highlightName = 'dsh-quote-reply'
    const conversationSelector = '[data-conversation-scroll]'
    const sourceSelector = '[data-text-interaction-source]'

    function quoteTextOf(text) {
      return text.replace(/\r\n?/gu, '\n').replace(/^ {0,3}>[ \t]?/gmu, '')
    }

    function messageQuoteRanges(text) {
      const ranges = []
      for (const match of text.matchAll(/^ {0,3}>[^\r\n]*(?:\r?\n {0,3}>[^\r\n]*)*/gmu)) {
        if (quoteTextOf(match[0]).trim()) {
          ranges.push({ start: match.index, end: match.index + match[0].length })
        }
      }
      return ranges
    }

    const quoteRule = {
      id: 'quote',
      order: -10,
      match(text, from) {
        for (const range of messageQuoteRanges(text)) {
          for (const start of [range.start - 2, range.start, range.end]) {
            if (start < from) continue
            if (start === range.start) {
              return { id: 'quote', start, end: range.end, data: { text: quoteTextOf(text.slice(start, range.end)) } }
            }
            if (text.slice(start, start + 2) === '\n\n') {
              return { id: 'text', start, end: start + 2, data: { text: '\n\n', display: ' ' } }
            }
          }
        }
      },
    }

    function formatReply(quotes, reply) {
      return [
        ...quotes.map(text => text.replace(/\r\n?/gu, '\n').split('\n').map(line => '> ' + line).join('\n')),
        reply.replace(/\r\n?/gu, '\n'),
      ].join('\n\n').replace(/\uFFFC/gu, '')
    }

    function sessionAcceptsQuotes(session) {
      return !session.removed && (session.subagent == null || session.subagent.address.mode === 'continuable')
    }

    function draftSpan(draft, state, start, end) {
      if (draft?.text !== state.draft || !Array.isArray(draft.references) || draft.command) return null
      let from = start
      let to = end
      for (const { offset, length } of [...draft.references, ...(draft.quotes ?? [])]) {
        const limit = offset + length
        // Harness counts an atomic editor node as one position, irrespective of its clipboard length.
        if ((offset < start && start < limit) || (offset < end && end < limit)) return null
        if (limit <= start) from -= length - 1
        if (limit <= end) to -= length - 1
      }
      return { start: from, end: to, draftRev: state.draftRev }
    }

    function replyReference(text, label) {
      return {
        source: draftSource,
        ref: text,
        clipboardText: text,
        label: label.trim().split('\n')[0],
      }
    }

    function legacyReplyRanges(key, text) {
      try {
        const saved = JSON.parse(window.localStorage.getItem(key) ?? 'null')
        let hash = 14695981039346656037n
        for (let index = 0; index < text.length; index++) {
          hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(index))) * 1099511628211n)
        }
        if (!Array.isArray(saved?.ranges) || saved.fingerprint !== text.length + ':' + hash.toString(16)) return []
        let previousEnd = 0
        for (const { start, body, end } of saved.ranges) {
          if (![start, body, end].every(Number.isInteger) || start < previousEnd || body < start || body - start > 2
            || end <= body || end > text.length || !text.startsWith('> ', body)
            || /[^\n]/u.test(text.slice(start, body))) return []
          previousEnd = end
        }
        return saved.ranges
      } catch {
        return []
      }
    }

    function migrateLegacyReplies(input, snapshot, key) {
      const { text, references, quotes = [] } = snapshot
      const occupied = [...references, ...quotes]
      const converted = []
      for (const { start, body, end } of legacyReplyRanges(key, text)) {
        if (occupied.some(({ offset, length }) => offset < end && offset + length > start)) continue
        const message = text.slice(body, end)
        const afterQuotes = messageQuoteRanges(message).at(-1)?.end
        const label = afterQuotes === undefined ? message : message.slice(afterQuotes).trim() || message
        converted.push({ ...replyReference(text.slice(start, end), label), offset: start, length: end - start })
      }
      if (!converted.length) return
      input.setDraft({
        ...snapshot,
        references: [...references, ...converted].sort((left, right) => left.offset - right.offset),
      })
      if (!converted.every(entry => input.draftSnapshot.references.some(ref =>
        ref.source === draftSource && ref.offset === entry.offset && ref.clipboardText === entry.clipboardText))) return
      try { window.localStorage.removeItem(key) } catch {}
    }

    function createSessionModel(conversation, binding) {
      const input = conversation.input.for(binding.ctx)
      const block = conversation.blocks.storeFor(binding.sessionId)
      const legacyKey = 'dsh-quote-reply:draft:' + binding.sessionId
      const listeners = new Set()
      let unsubscribe = []
      let checkedLegacyRevision
      let panel = null
      let state
      let snapshot

      function editable(current = input.state.getSnapshot()) {
        return current.phase === 'plain' && block.getSnapshot() === undefined
          && sessionAcceptsQuotes(binding.session.getSnapshot())
      }

      function sync() {
        const current = input.state.getSnapshot()
        const canEdit = editable(current)
        if (panel && !sessionAcceptsQuotes(binding.session.getSnapshot())) panel = null
        if (current === state && panel === snapshot?.panel && canEdit === snapshot.editable) return
        state = current
        snapshot = {
          replies: current.occurrences.filter(occurrence => occurrence.source === draftSource),
          panel,
          editable: canEdit,
          revision: current.draftRev,
        }
        for (const listener of listeners) listener()
      }

      function setPanel(value) {
        panel = value
        sync()
      }

      sync()
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          if (listeners.size === 1) {
            unsubscribe = [input.state.subscribe(sync), block.subscribe(sync), binding.session.subscribe(sync)]
            sync()
          }
          return () => {
            listeners.delete(listener)
            if (!listeners.size) {
              for (const dispose of unsubscribe) dispose()
              unsubscribe = []
            }
          }
        },
        migrate() {
          const current = input.state.getSnapshot()
          const draft = input.draftSnapshot
          if (!editable(current) || draft?.text !== current.draft || !draft.text || draft.command
            || checkedLegacyRevision === current.draftRev) return
          checkedLegacyRevision = current.draftRev
          migrateLegacyReplies(input, draft, legacyKey)
        },
        open(quote, origin) {
          if (!sessionAcceptsQuotes(binding.session.getSnapshot())) return
          const preceding = panel?.picking && panel.origin === origin ? panel.quotes : []
          setPanel({ quotes: [...preceding, quote], origin, picking: false })
        },
        chooseMore(picking) {
          if (panel) setPanel({ ...panel, picking })
        },
        close(origin) {
          if (panel?.origin === origin) setPanel(null)
        },
        add(replyText) {
          const current = input.state.getSnapshot()
          if (!panel || panel.picking || !replyText.trim() || !editable(current)) return false
          const draft = input.draftSnapshot
          const last = current.occurrences.at(-1)
          let offset = current.draft.length
          if (last?.source === draftSource && last.offset + last.length === offset - 1
            && current.draft.endsWith(' ')) offset--
          const before = current.draft.slice(0, offset)
          const separator = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
          const message = separator + formatReply(panel.quotes.map(quote => quote.text), replyText)
          const span = draftSpan(draft, current, offset, offset)
          if (!span || !input.insertReference(replyReference(message, replyText), span)) return false
          setPanel(null)
          input.focus()
          return true
        },
        remove(actions, occurrenceId) {
          const current = input.state.getSnapshot()
          if (!editable(current)) return false
          const occurrence = current.occurrences.find(entry => entry.source === draftSource && entry.occurrenceId === occurrenceId)
          if (!occurrence) return false
          const { offset, length } = occurrence
          let end = offset + length
          if (current.occurrences.at(-1) === occurrence && current.draft.slice(end) === ' ') end++
          const span = draftSpan(input.draftSnapshot, current, offset, end)
          if (!span || !actions.insertText('', span)) return false
          input.focus()
          return true
        },
      }
    }

    function QuoteGlyph() {
      return h('span', { className: 'qrp-glyph', 'aria-hidden': true }, '“')
    }

    function QuotedUserText({ node }) {
      const text = node?.data?.text ?? ''
      return h('span', { className: 'qrp-transcript-quote', title: text },
        h(QuoteGlyph), h('span', { className: 'qrp-ellipsis' }, text),
      )
    }

    function QuoteCapsule({ model, dismiss, readText, clearSelection, t }) {
      const { panel } = useSyncExternalStore(model.subscribe, model.getSnapshot)
      const pill = useRef(null)
      const [origin, setOrigin] = useState(null)
      useLayoutEffect(() => {
        setOrigin(pill.current?.closest(conversationSelector) ?? null)
      }, [])
      const adding = panel?.picking && panel.origin === origin
      return h('button', {
        ref: pill,
        type: 'button',
        className: 'qrp-pill',
        'aria-haspopup': 'dialog',
        onMouseDown: event => event.preventDefault(),
        onClick() {
          const text = readText()
          if (!origin || text == null || !text.trim()) { dismiss(); return }
          const selection = origin.ownerDocument.getSelection()
          const range = selection?.rangeCount === 1 && !selection.isCollapsed
            ? selection.getRangeAt(0).cloneRange()
            : null
          const rect = pill.current.getBoundingClientRect()
          model.open({ text, range, rect }, origin)
          clearSelection()
          dismiss()
        },
      }, h(QuoteGlyph), t(adding ? 'quote.join' : 'quote.reply'))
    }

    function QuotePreview({ text, t }) {
      const [expanded, setExpanded] = useState(false)
      return h('button', {
        type: 'button',
        className: 'qrp-preview',
        title: text,
        'aria-label': t('quote.full') + ': ' + text,
        'aria-expanded': expanded,
        onClick: () => setExpanded(!expanded),
      }, h('span', { className: expanded ? 'qrp-preview-full' : 'qrp-preview-lines' }, text))
    }

    function usePanelPosition(element, panel) {
      useLayoutEffect(() => {
        const card = element.current
        if (!card || panel.picking) return
        const { origin, quotes } = panel
        const view = origin.ownerDocument.defaultView
        const quote = quotes.at(-1)
        const margin = 12
        let frame = 0

        function place() {
          const rects = quote.range ? Array.from(quote.range.getClientRects()).filter(rect => rect.width && rect.height) : []
          const first = rects[0] ?? quote.rect
          const last = rects.at(-1) ?? first
          const area = origin.getBoundingClientRect()
          const viewportWidth = view.document.documentElement.clientWidth
          const viewportHeight = view.document.documentElement.clientHeight
          const leftEdge = Math.max(margin, area.left + margin)
          const rightEdge = Math.min(viewportWidth - margin, area.right - margin)
          card.style.width = Math.min(424, Math.max(0, rightEdge - leftEdge)) + 'px'
          const width = card.offsetWidth
          const height = card.offsetHeight
          const below = last.bottom + 8
          const above = first.top - 8 - height
          const idealTop = below + height <= viewportHeight - margin ? below : above
          card.style.left = Math.max(leftEdge, Math.min(first.left, rightEdge - width)) + 'px'
          card.style.top = Math.max(margin, Math.min(idealTop, viewportHeight - height - margin)) + 'px'
        }

        function schedule() {
          view.cancelAnimationFrame(frame)
          frame = view.requestAnimationFrame(place)
        }

        place()
        const observer = new view.ResizeObserver(schedule)
        observer.observe(card)
        observer.observe(origin)
        view.addEventListener('resize', schedule)
        view.addEventListener('scroll', schedule, true)
        return () => {
          observer.disconnect()
          view.removeEventListener('resize', schedule)
          view.removeEventListener('scroll', schedule, true)
          view.cancelAnimationFrame(frame)
        }
      }, [element, panel])
    }

    function QuoteReplyPanel({ model, panel, t }) {
      const [reply, setReply] = useState('')
      const [notice, setNotice] = useState(false)
      const input = useRef(null)
      const card = useRef(null)
      const composing = useRef(false)
      const { origin, quotes, picking } = panel

      usePanelPosition(card, panel)
      useLayoutEffect(() => {
        if (!picking) input.current?.focus({ preventScroll: true })
      }, [panel, picking])

      useEffect(() => {
        const document = origin.ownerDocument
        const view = document.defaultView
        if (view.CSS.highlights && view.Highlight) {
          view.CSS.highlights.set(highlightName, new view.Highlight(...quotes.map(quote => quote.range).filter(Boolean)))
        }
        return () => view.CSS.highlights?.delete(highlightName)
      }, [origin, quotes])

      useEffect(() => {
        const document = origin.ownerDocument
        const view = document.defaultView
        const close = () => model.close(origin)
        function outside(event) {
          const target = event.target
          if (!(target instanceof view.Element) || card.current?.contains(target)) return
          if (picking && origin.contains(target) && target.closest(sourceSelector + ', [data-text-interaction-surface], [data-qrp-picking]')) return
          close()
        }
        function escape(event) {
          if (event.key !== 'Escape' || composing.current || event.isComposing || event.keyCode === 229) return
          event.preventDefault()
          event.stopPropagation()
          close()
        }
        document.addEventListener('pointerdown', outside, true)
        document.addEventListener('keydown', escape, true)
        view.addEventListener('blur', close)
        return () => {
          document.removeEventListener('pointerdown', outside, true)
          document.removeEventListener('keydown', escape, true)
          view.removeEventListener('blur', close)
        }
      }, [model, origin, picking])

      function addToDraft() {
        if (!reply.trim()) return
        if (!model.add(reply)) setNotice(true)
      }

      if (picking) return null
      return h('section', { ref: card, className: 'qrp-card', role: 'dialog', 'aria-label': t('quote.reply') },
        h('header', { className: 'qrp-card-head' },
          h(QuoteGlyph), h('strong', null, t('quote.reply')),
          h('button', { type: 'button', className: 'qrp-text-button qrp-pick', onClick: () => model.chooseMore(true) },
            h('span', { 'aria-hidden': true }, '+'), ' ', t('quote.more')),
        ),
        h('div', { className: 'qrp-previews' },
          quotes.map((quote, index) => h(QuotePreview, { key: index, text: quote.text, t })),
        ),
        h('textarea', {
          ref: input,
          className: 'qrp-input',
          rows: 2,
          'aria-label': t('reply.placeholder'),
          placeholder: t('reply.placeholder'),
          value: reply,
          onChange: event => { setReply(event.currentTarget.value); setNotice(false) },
          onCompositionStart: () => { composing.current = true },
          onCompositionEnd: () => { composing.current = false },
          onKeyDown(event) {
            if (event.key !== 'Enter') return
            event.stopPropagation()
            if (event.shiftKey || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
            event.preventDefault()
            addToDraft()
          },
        }),
        notice && h('div', { className: 'qrp-notice', role: 'alert' }, t('draft.unavailable')),
        h('footer', { className: 'qrp-card-foot' },
          h('span', { className: 'qrp-key-hint' }, h('kbd', null, 'Shift'), ' ', h('kbd', null, 'Enter'), ' ', t('reply.newline')),
          h('div', { className: 'qrp-actions' },
            h('button', { type: 'button', className: 'qrp-text-button', onClick: () => model.close(origin) }, t('reply.cancel')),
            h('button', {
              type: 'button',
              className: 'qrp-add',
              'aria-keyshortcuts': 'Enter',
              disabled: !reply.trim(),
              onClick: addToDraft,
            }, t('reply.add'), h('span', { 'aria-hidden': true }, '↵')),
          ),
        ),
      )
    }

    function useDraftChipHosts(seat, replies) {
      const [hosts, setHosts] = useState([])
      useLayoutEffect(() => {
        const editor = seat.current?.closest('[data-composer-card]')?.querySelector('[data-composer-input]')
        if (!editor) return
        function reconcile() {
          const elements = [...editor.querySelectorAll(draftChipSelector)]
          setHosts(previous => elements.length === previous.length
            && elements.every((element, index) => element === previous[index]) ? previous : elements)
        }
        reconcile()
        const observer = new MutationObserver(reconcile)
        observer.observe(editor, { childList: true, subtree: true })
        return () => observer.disconnect()
      }, [seat, replies])
      return hosts.length === replies.length ? hosts : []
    }

    function ComposerQuoteReplies({ model, inputActions, t }) {
      const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
      const [origin, setOrigin] = useState(null)
      const [notice, setNotice] = useState(false)
      const seat = useRef(null)
      const resume = useRef(null)
      const hosts = useDraftChipHosts(seat, state.replies)
      const panel = state.panel?.origin === origin ? state.panel : null

      useLayoutEffect(() => {
        const owner = seat.current?.closest(conversationSelector) ?? null
        setOrigin(owner)
        return () => { if (owner) model.close(owner) }
      }, [model])
      useEffect(() => { model.migrate() }, [model, state.revision, state.editable])
      useLayoutEffect(() => {
        if (panel?.picking) resume.current?.focus({ preventScroll: true })
      }, [panel?.picking])

      return h(Fragment, null,
        h('div', { ref: seat, className: 'qrp-composer-extras', hidden: !panel?.picking && !notice },
          panel?.picking && h('div', { className: 'qrp-picking', 'data-qrp-picking': '' },
            h('span', { role: 'status' }, t('quote.pick')),
            h('button', {
              ref: resume, type: 'button', className: 'qrp-text-button',
              onClick: () => model.chooseMore(false),
            }, t('quote.return')),
          ),
          notice && h('span', { className: 'qrp-notice', role: 'alert' }, t('draft.unavailable')),
        ),
        hosts.map((host, index) => {
          const reply = state.replies[index]
          const original = quoteTextOf(reply.clipboardText.trimStart().split('\n')[0])
          return createPortal(h('span', { className: 'qrp-draft-chip', title: reply.clipboardText.trim() },
            h(QuoteGlyph),
            h('span', { className: 'qrp-ellipsis qrp-draft-origin' }, original),
            h('span', { className: 'qrp-ellipsis qrp-draft-response' }, reply.label),
            h('button', {
              type: 'button',
              className: 'qrp-remove',
              'aria-label': t('draft.remove') + ': ' + reply.label,
              disabled: !state.editable,
              onMouseDown: event => event.preventDefault(),
              onClick(event) {
                event.stopPropagation()
                setNotice(!model.remove(inputActions, reply.occurrenceId))
              },
            }, h('span', { 'aria-hidden': true }, '×')),
          ), host, reply.occurrenceId)
        }),
        panel && createPortal(h(QuoteReplyPanel, { model, panel, t }), origin.ownerDocument.body),
      )
    }

    const zh = {
      'quote.reply': '引用回复',
      'quote.join': '加入引用',
      'quote.more': '再选一段',
      'quote.pick': '划选下一段原文',
      'quote.return': '返回回复',
      'quote.full': '查看引用原文',
      'reply.placeholder': '写下你的回复…',
      'reply.add': '添加到聊天框',
      'reply.cancel': '取消',
      'reply.newline': '换行',
      'draft.remove': '删除这条引用回复',
      'draft.unavailable': '聊天框暂时无法编辑，请稍后再试。',
    }
    const en = {
      'quote.reply': 'Quote reply',
      'quote.join': 'Add quote',
      'quote.more': 'Select another',
      'quote.pick': 'Select another passage',
      'quote.return': 'Back to reply',
      'quote.full': 'View full quote',
      'reply.placeholder': 'Write your reply…',
      'reply.add': 'Add to chat box',
      'reply.cancel': 'Cancel',
      'reply.newline': 'New line',
      'draft.remove': 'Remove this quote reply',
      'draft.unavailable': 'The chat box is temporarily unavailable. Try again shortly.',
    }

    const styles = `
.qrp-pill, .qrp-card, .qrp-composer-extras { color: var(--dsw-alias-label-primary); }
.qrp-pill, .qrp-card {
  box-sizing: border-box;
  background: var(--dsw-menu-surface-fill);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l3);
  box-shadow: var(--dsw-elevation-panel);
}
.qrp-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 4px 10px;
  border: 0;
  border-radius: 999px;
  font: var(--dsw-font-xs-13);
  white-space: nowrap;
  cursor: pointer;
}
.qrp-glyph {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-state-business-primary);
  font: 700 22px/1 Georgia, serif;
}
.qrp-pill:hover, .qrp-text-button:hover, .qrp-remove:hover {
  background: var(--dsw-alias-button-floating-hover);
}
.qrp-pill:focus-visible, .qrp-card button:focus-visible, .qrp-composer-extras button:focus-visible, .qrp-draft-chip button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
::highlight(dsh-quote-reply) {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent);
}
.qrp-card {
  position: fixed;
  z-index: 900;
  display: flex;
  flex-direction: column;
  gap: 9px;
  width: min(424px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow: auto;
  padding: 12px;
  border-radius: var(--dsw-radius-panel);
  background: var(--dsw-specific-input-major);
  box-shadow: var(--dsw-elevation-prominent);
  font: var(--dsw-font-s-14);
}
.qrp-card-head, .qrp-card-foot, .qrp-actions, .qrp-picking {
  display: flex;
  align-items: center;
  gap: 6px;
}
.qrp-card-head strong { font-size: 14px; }
.qrp-card-foot { justify-content: space-between; flex-wrap: wrap; }
.qrp-actions, .qrp-pick { margin-inline-start: auto; }
.qrp-previews {
  display: grid;
  flex: none;
  gap: 6px;
  max-height: min(208px, 34dvh);
  overflow: auto;
}
.qrp-preview {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 7px 9px;
  border: 0;
  border-inline-start: 3px solid var(--dsw-alias-state-business-primary);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-settings-card-fill);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
  line-height: 18px;
  text-align: start;
  cursor: help;
}
.qrp-preview-lines, .qrp-preview-full {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.qrp-preview-lines {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
.qrp-preview-full { display: block; }
.qrp-input {
  box-sizing: border-box;
  flex: none;
  width: 100%;
  min-height: 64px;
  max-height: 128px;
  field-sizing: content;
  resize: none;
  padding: 8px 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 20px;
}
.qrp-input:focus {
  border-color: var(--dsw-alias-state-business-primary);
  outline: 1px solid var(--dsw-alias-state-business-primary);
}
.qrp-input::placeholder, .qrp-key-hint { color: var(--dsw-alias-label-secondary); }
.qrp-text-button, .qrp-remove, .qrp-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  color: inherit;
  font: var(--dsw-font-xs-13);
  white-space: nowrap;
  cursor: pointer;
}
.qrp-text-button { min-height: 28px; padding: 4px 7px; background: transparent; }
.qrp-pick { color: var(--dsw-alias-state-business-primary); }
.qrp-add {
  min-height: 31px;
  padding: 5px 10px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-inverted);
}
.qrp-add:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.qrp-add:disabled { opacity: .45; cursor: default; }
.qrp-key-hint, .qrp-notice { font-size: 12px; }
.qrp-key-hint kbd {
  padding: 1px 3px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  font: inherit;
}
.qrp-notice { color: var(--dsw-alias-state-warn-primary); }
[data-composer-overlay]:has(.qrp-composer-extras:not([hidden])) {
  position: relative;
  height: auto;
}
.qrp-composer-extras { padding: 8px 10px 0; }
.qrp-composer-extras[hidden] { display: none; }
/* The composer mounts its stock decorator into the same atomic node. */
[data-composer-chip="quote-reply"]:has(> .qrp-draft-chip) > :not(.qrp-draft-chip) { display: none; }
.qrp-draft-chip, .qrp-picking {
  align-items: center;
  gap: 5px;
  padding: 3px 4px 3px 7px;
  min-width: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-settings-card-fill);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-13);
}
.qrp-draft-chip {
  display: inline-flex;
  box-sizing: border-box;
  max-width: min(100%, 360px);
  vertical-align: middle;
}
.qrp-draft-origin { max-width: 180px; color: var(--dsw-alias-label-secondary); }
.qrp-draft-response { padding-inline-start: 5px; border-inline-start: 1px solid var(--dsw-alias-border-l2); }
.qrp-picking { justify-content: space-between; margin-bottom: 5px; }
.qrp-remove {
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 18px;
}
.qrp-remove:disabled { opacity: .45; cursor: default; }
.qrp-ellipsis {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qrp-transcript-quote {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  max-width: min(80%, 300px);
  color: var(--dsw-alias-state-business-primary);
  vertical-align: baseline;
}
@media (pointer: coarse) {
  .qrp-pill, .qrp-card button, .qrp-composer-extras button { min-height: 44px; }
  .qrp-remove { min-width: 44px; }
  .qrp-input { font-size: 16px; }
}
`

    return {
      name: pluginId,
      inject: ['slots', 'locale', 'sessions', 'uiConversation', 'conversation', 'inputTriggers'],
      apply(ctx) {
        const { conversation, inputTriggers, locale, sessions, slots, uiConversation } = ctx
        const models = new WeakMap()
        function sessionComponent(Component) {
          return props => {
            const binding = sessions.binding(props.sessionId)
            if (!binding) return null
            let model = models.get(binding)
            if (!model) {
              model = createSessionModel(conversation, binding)
              models.set(binding, model)
            }
            return h(Component, { ...props, model })
          }
        }

        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = styles
          document.head.append(style)
          return () => style.remove()
        }, 'quote-reply: styles')
        ctx.effect(() => inputTriggers.registerSource(draftCodec), 'quote-reply: draft codec')
        ctx.effect(() => locale.register(namespace, { zh, en }), 'quote-reply: dictionaries')
        ctx.effect(() => uiConversation.userText.register(quoteRule), 'quote-reply: quote rule')
        ctx.effect(() => uiConversation.interactions.register({
          id: pluginId,
          onInteraction(request) {
            const binding = sessions.binding(request.sessionId)
            if (request.trigger === 'selection' && request.readText() && binding
              && sessionAcceptsQuotes(binding.session.getSnapshot())) request.open()
          },
        }), 'quote-reply: selection interaction')
        slots.inject('conversation.chat.text-interaction', () => slots.register({
          name: 'conversation.chat.text-interaction', key: pluginId, locale: namespace,
        }, sessionComponent(QuoteCapsule)))
        slots.inject('conversation.input.overlay', () => slots.register({
          name: 'conversation.input.overlay', id: pluginId, locale: namespace,
        }, sessionComponent(ComposerQuoteReplies)))
        slots.inject('conversation.user.text.node', () => slots.register({
          name: 'conversation.user.text.node', key: 'quote', priority: 100,
        }, QuotedUserText))
      },
    }
  },
})
