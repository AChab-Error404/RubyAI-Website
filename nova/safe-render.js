/* Closed Markdown/Galaxy renderer: DOM nodes only, never model-provided HTML. */
(function (root) {
  'use strict';
  const GROUPS = new Set(['PROJECT', 'WEB', 'MACHINE', 'MEMORY', 'USER']);
  const MODELS = Object.freeze({
    'local-fast': 'Sun · Rapide',
    'local-balanced': 'Adara · Équilibré',
    'local-powerful': 'Buna · Puissant',
  });
  const safeText = (value, limit = 2000) => typeof value === 'string' ? value.slice(0, limit) : '';

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        ? url.href : '';
    } catch { return ''; }
  }

  function parseGalaxy(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== 1
        || !value.header || typeof value.header !== 'object' || Array.isArray(value.header)
        || !Array.isArray(value.sources) || value.sources.length > 32
        || !Array.isArray(value.tools) || value.tools.length > 32
        || !Array.isArray(value.limitations) || value.limitations.length > 32) return null;
    const sources = [];
    const seen = new Set();
    for (const source of value.sources) {
      if (!source || typeof source !== 'object' || Array.isArray(source)
          || !GROUPS.has(source.group) || typeof source.label !== 'string'
          || typeof source.locator !== 'string' || typeof source.citationId !== 'string') return null;
      const citationId = safeText(source.citationId, 80);
      if (citationId && seen.has(citationId)) continue;
      if (citationId) seen.add(citationId);
      sources.push(Object.freeze({
        group: source.group, label: safeText(source.label, 200),
        locator: safeText(source.locator, 300), citationId,
      }));
    }
    const tools = value.tools.map(tool => {
      if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string'
          || typeof tool.label !== 'string') return null;
      return Object.freeze({ name: safeText(tool.name, 80), label: safeText(tool.label, 200) });
    });
    const limitations = value.limitations.map(item => {
      if (!item || typeof item !== 'object' || typeof item.code !== 'string'
          || typeof item.text !== 'string') return null;
      return Object.freeze({ code: safeText(item.code, 64), text: safeText(item.text, 300) });
    });
    if (tools.includes(null) || limitations.includes(null)) return null;
    const header = value.header;
    const field = name => header[name] === null ? '' : safeText(header[name], 100);
    return Object.freeze({
      header: Object.freeze({
        answerSource: field('answerSource'), modelSlot: field('modelSlot'),
        modelLocation: field('modelLocation'), mode: field('mode'), privacy: field('privacy'),
        grounding: field('grounding'), evidence: field('evidence'), answerDepth: field('answerDepth'),
      }),
      sources: Object.freeze(sources), tools: Object.freeze(tools),
      limitations: Object.freeze(limitations), reviewPerformed: value.reviewPerformed === true,
    });
  }

  function appendInline(doc, parent, text, citations) {
    const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]{1,120}\]\([^\s)]+\)|\[[A-Za-z0-9_-]{1,80}\])/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > cursor) parent.append(doc.createTextNode(text.slice(cursor, match.index)));
      const token = match[0];
      if (token.startsWith('`')) {
        const code = doc.createElement('code'); code.textContent = token.slice(1, -1); parent.append(code);
      } else if (token.startsWith('**')) {
        const strong = doc.createElement('strong'); strong.textContent = token.slice(2, -2); parent.append(strong);
      } else if (token.includes('](')) {
        const pivot = token.indexOf(']('); const label = token.slice(1, pivot);
        const href = safeUrl(token.slice(pivot + 2, -1));
        if (href) {
          const link = doc.createElement('a'); link.textContent = label; link.href = href;
          link.target = '_blank'; link.rel = 'noopener noreferrer'; parent.append(link);
        } else parent.append(doc.createTextNode(token));
      } else {
        const id = token.slice(1, -1); const source = citations.get(id);
        if (source) {
          const button = doc.createElement('button'); button.type = 'button';
          button.className = 'citation-ref'; button.textContent = `[${id}]`;
          button.setAttribute('aria-label', `Voir la source ${source.label || id}`);
          button.addEventListener('click', () => {
            const target = doc.getElementById(`source-${id}`);
            if (target) { target.closest('details').open = true; target.scrollIntoView({ block: 'nearest' }); }
          });
          parent.append(button);
        } else parent.append(doc.createTextNode(token));
      }
      cursor = match.index + token.length;
    }
    if (cursor < text.length) parent.append(doc.createTextNode(text.slice(cursor)));
  }

  function renderTable(doc, parent, lines, start, citations) {
    if (start + 1 >= lines.length || !/^\s*\|?\s*:?-{3,}/.test(lines[start + 1])) return 0;
    const split = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
    const headers = split(lines[start]); const separators = split(lines[start + 1]);
    if (headers.length < 2 || headers.length !== separators.length
        || separators.some(cell => !/^:?-{3,}:?$/.test(cell))) return 0;
    const table = doc.createElement('table'); const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    headers.forEach(value => { const cell = doc.createElement('th'); appendInline(doc, cell, value, citations); headRow.append(cell); });
    thead.append(headRow); table.append(thead); const tbody = doc.createElement('tbody');
    let index = start + 2;
    while (index < lines.length && lines[index].includes('|')) {
      const values = split(lines[index]); if (values.length !== headers.length) break;
      const row = doc.createElement('tr');
      values.forEach(value => { const cell = doc.createElement('td'); appendInline(doc, cell, value, citations); row.append(cell); });
      tbody.append(row); index++;
    }
    table.append(tbody); const scroll = doc.createElement('div'); scroll.className = 'table-scroll'; scroll.append(table); parent.append(scroll);
    return index - start;
  }

  function renderAnswer(doc, container, value, galaxy) {
    container.replaceChildren(); const parsed = parseGalaxy(galaxy);
    const citations = new Map((parsed?.sources || []).filter(item => item.citationId).map(item => [item.citationId, item]));
    const lines = String(value ?? '').slice(0, 200000).replaceAll('\r\n', '\n').split('\n');
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (line.startsWith('```')) {
        const language = line.slice(3).trim().replace(/[^A-Za-z0-9_+#.-]/g, '').slice(0, 24);
        const body = []; index++;
        while (index < lines.length && !lines[index].startsWith('```')) body.push(lines[index++]);
        if (index < lines.length) index++;
        const pre = doc.createElement('pre'); const code = doc.createElement('code');
        if (language) code.setAttribute('data-language', language);
        code.textContent = body.join('\n'); pre.append(code); container.append(pre); continue;
      }
      const consumed = line.includes('|') ? renderTable(doc, container, lines, index, citations) : 0;
      if (consumed) { index += consumed; continue; }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const node = doc.createElement(`h${heading[1].length + 2}`);
        appendInline(doc, node, heading[2], citations); container.append(node); index++; continue;
      }
      const list = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
      if (list) {
        const ordered = /^\s*\d/.test(line); const node = doc.createElement(ordered ? 'ol' : 'ul');
        while (index < lines.length) {
          const item = lines[index].match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
          if (!item || /^\s*\d/.test(lines[index]) !== ordered) break;
          const li = doc.createElement('li'); appendInline(doc, li, item[1], citations); node.append(li); index++;
        }
        container.append(node); continue;
      }
      if (!line.trim()) { index++; continue; }
      const paragraph = doc.createElement(line.startsWith('> ') ? 'blockquote' : 'p');
      appendInline(doc, paragraph, line.startsWith('> ') ? line.slice(2) : line, citations);
      container.append(paragraph); index++;
    }
  }

  function renderGalaxy(doc, container, value) {
    container.replaceChildren(); const galaxy = parseGalaxy(value);
    if (!galaxy) { container.hidden = true; return null; }
    container.hidden = false;
    if (galaxy.sources.length) {
      const details = doc.createElement('details'); details.className = 'evidence-group';
      const summary = doc.createElement('summary'); summary.textContent = `Sources utilisées (${galaxy.sources.length})`; details.append(summary);
      galaxy.sources.forEach(source => {
        const card = doc.createElement('article'); card.className = 'source-card';
        if (source.citationId) card.id = `source-${source.citationId}`;
        const meta = doc.createElement('small'); meta.textContent = `${source.group}${source.citationId ? ` · [${source.citationId}]` : ''}`;
        const label = doc.createElement('strong'); label.textContent = source.label || 'Source sans titre';
        const href = safeUrl(source.locator);
        if (href) { const link = doc.createElement('a'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = href; card.append(meta, label, link); }
        else { const locator = doc.createElement('span'); locator.textContent = source.locator; card.append(meta, label, locator); }
        details.append(card);
      });
      container.append(details);
    }
    if (galaxy.tools.length) {
      const details = doc.createElement('details'); details.className = 'evidence-group';
      const summary = doc.createElement('summary'); summary.textContent = `Outils utilisés (${galaxy.tools.length})`; details.append(summary);
      const list = doc.createElement('ul'); galaxy.tools.forEach(tool => { const item = doc.createElement('li'); item.textContent = tool.label || tool.name; list.append(item); });
      details.append(list); container.append(details);
    }
    if (galaxy.limitations.length) {
      const details = doc.createElement('details'); details.className = 'evidence-group limitation-group';
      const summary = doc.createElement('summary'); summary.textContent = `Limites (${galaxy.limitations.length})`; details.append(summary);
      const list = doc.createElement('ul'); galaxy.limitations.forEach(entry => { const item = doc.createElement('li'); item.textContent = `${entry.code}${entry.text ? ` — ${entry.text}` : ''}`; list.append(item); });
      details.append(list); container.append(details);
    }
    return galaxy;
  }

  const api = { parseGalaxy, renderAnswer, renderGalaxy, safeUrl, modelLabel: slot => MODELS[slot] || '' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RubySafeRender = api;
})(typeof window !== 'undefined' ? window : globalThis);
