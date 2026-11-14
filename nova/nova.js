(function (globalScope) {
  "use strict";

  const STORAGE_KEY = "ruby_nova_pages_conversations_v1";
  const THEME_KEY = "ruby_nova_pages_theme";
  const SIDEBAR_COLLAPSED_KEY = "ruby_nova_pages_sidebar_collapsed";

  const TIPS = [
    "Explore les exemples proposés pour découvrir le fil de discussion.",
    "Tous les blocs de code disposent d'un bouton « Copier le code » en un clic, et tu peux modifier ou régénérer n'importe quel tour.",
    "Utilise Ctrl+B pour replier l'historique, Ctrl+K pour chercher une discussion et Alt+N pour en créer une nouvelle.",
    "L’historique de la démo est enregistré dans ce navigateur."
  ];

  const state = {
    conversations: [],
    activeConvId: null,
    searchQuery: "",
    sidebarCollapsed: false,
    tipIndex: 0
  };

  function isNum(val) {
    return typeof val === "number" && Number.isFinite(val);
  }

  function formatDuration(ms) {
    if (!isNum(ms) || ms < 0) return "";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  }

  function formatLatencyBreakdown(timings) {
    if (!timings || !isNum(timings.totalMs)) return "";
    const modeLbl = timings.coldStart ? "à froid" : "à chaud";
    const loadPart = isNum(timings.loadMs) ? `GGUF ${timings.loadMs} ms` : "";
    const ctxPart = isNum(timings.contextMs) ? `Ctx ${timings.contextMs} ms` : "";
    const genPart = isNum(timings.generationMs) ? `Gén ${timings.generationMs} ms` : "";
    const details = [loadPart, ctxPart, genPart].filter(Boolean).join(" · ");
    return `${formatDuration(timings.totalMs)} (${modeLbl}${details ? " : " + details : ""})`;
  }

  const el = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MOBILE_QUERY = "(max-width: 860px)";

  /* Icône issue du sprite SVG local déclaré dans index.html */
  function svgIcon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "i");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  /* Bouton avec icône + libellé (le libellé reste modifiable sans perdre l'icône) */
  function iconButton(className, iconName, label, title) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.appendChild(svgIcon(iconName));
    if (label) {
      const span = document.createElement("span");
      span.textContent = label;
      btn.appendChild(span);
    }
    if (title) {
      btn.title = title;
      btn.setAttribute("aria-label", title);
    }
    return btn;
  }

  /* Retour visuel « copié » temporaire sur un bouton à icône */
  function flashDone(btn, label) {
    const span = btn.querySelector("span");
    const prev = span ? span.textContent : null;
    const use = btn.querySelector("use");
    const prevIcon = use ? use.getAttribute("href") : null;
    btn.classList.add("done");
    if (use) use.setAttribute("href", "#i-check");
    if (span && label) span.textContent = label;
    setTimeout(() => {
      btn.classList.remove("done");
      if (use && prevIcon) use.setAttribute("href", prevIcon);
      if (span && prev !== null) span.textContent = prev;
    }, 1400);
  }

  function isMobileLayout() {
    return typeof window.matchMedia === "function" && window.matchMedia(MOBILE_QUERY).matches;
  }

  function openNovaPromptDialog(opts) {
    const dialog = el("nova-prompt-dialog");
    const titleEl = el("nova-prompt-title");
    const labelEl = el("nova-prompt-label");
    const inputEl = el("nova-prompt-input");
    const submitBtn = el("nova-prompt-submit");
    const cancelBtn = el("nova-prompt-cancel");
    const closeBtn = el("nova-prompt-close");
    const form = el("nova-prompt-form");

    if (!dialog || !inputEl || typeof dialog.showModal !== "function") {
      return Promise.resolve(null);
    }
    if (titleEl) titleEl.textContent = (opts && opts.title) || "Modifier";
    if (labelEl) labelEl.textContent = (opts && opts.label) || "Valeur";
    if (submitBtn) submitBtn.textContent = (opts && opts.submitLabel) || "Enregistrer";
    inputEl.rows = opts && opts.rows ? opts.rows : 2;
    inputEl.value = (opts && opts.defaultValue) || "";

    return new Promise((resolve) => {
      let settled = false;
      const finish = (val) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (dialog.open) dialog.close();
        resolve(val);
      };
      const onSubmit = (ev) => {
        ev.preventDefault();
        finish(inputEl.value);
      };
      const onCancel = () => finish(null);
      const onKeydown = (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          finish(null);
        } else if (ev.key === "Enter" && !ev.shiftKey && (!opts || !opts.multiline)) {
          ev.preventDefault();
          finish(inputEl.value);
        }
      };
      const cleanup = () => {
        if (form) form.removeEventListener("submit", onSubmit);
        if (cancelBtn) cancelBtn.removeEventListener("click", onCancel);
        if (closeBtn) closeBtn.removeEventListener("click", onCancel);
        dialog.removeEventListener("close", onCancel);
        inputEl.removeEventListener("keydown", onKeydown);
      };
      if (form) form.addEventListener("submit", onSubmit);
      if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
      if (closeBtn) closeBtn.addEventListener("click", onCancel);
      dialog.addEventListener("close", onCancel);
      inputEl.addEventListener("keydown", onKeydown);
      dialog.showModal();
      inputEl.focus();
      inputEl.select();
    });
  }

  function newConvId() {
    const rand = Math.random().toString(16).slice(2, 14).padEnd(12, "0");
    return `conv-${Date.now()}-${rand}`;
  }

  function loadConversations() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          state.conversations = parsed;
          state.activeConvId = parsed[0].id;
          return;
        }
      }
    } catch (_) {}
    const initial = { id: newConvId(), title: "Nouvelle discussion", messages: [] };
    state.conversations = [initial];
    state.activeConvId = initial.id;
  }

  function saveConversations() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversations.slice(0, 50)));
    } catch (_) {}
  }

  function activeConv() {
    return state.conversations.find((c) => c.id === state.activeConvId) || state.conversations[0];
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme || "ruby");
    try {
      localStorage.setItem(THEME_KEY, theme || "ruby");
    } catch (_) {}
  }

  function applySidebarCollapsed(collapsed, persist) {
    state.sidebarCollapsed = Boolean(collapsed);
    const shell = el("nova-shell");
    if (shell) {
      shell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
    }
    const toggleBtn = el("toggle-sidebar");
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", state.sidebarCollapsed ? "false" : "true");
    }
    /* Sur mobile la barre latérale est un tiroir temporaire : on ne mémorise pas son état */
    if (persist === false || isMobileLayout()) return;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, state.sidebarCollapsed ? "1" : "0");
    } catch (_) {}
  }

  function loadPreferences() {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY) || "ruby";
      applyTheme(savedTheme);
      document.querySelectorAll('input[name="theme"]').forEach((r) => {
        r.checked = r.value === savedTheme;
      });
      const savedCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
      applySidebarCollapsed(isMobileLayout() ? true : savedCollapsed, false);
    } catch (_) {}
  }

  function renderSidebar() {
    const list = el("conversation-list");
    if (!list) return;
    list.textContent = "";
    const q = state.searchQuery.trim().toLowerCase();
    const filtered = state.conversations.filter((conv) => {
      if (!q) return true;
      if ((conv.title || "").toLowerCase().includes(q)) return true;
      return (conv.messages || []).some((m) => String(m.text || "").toLowerCase().includes(q));
    });

    filtered.forEach((conv) => {
      const row = document.createElement("div");
      row.className = "nova-conv-row" + (conv.id === state.activeConvId ? " active" : "");

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "nova-conv-select";
      selectBtn.textContent = conv.title || "Nouvelle discussion";
      selectBtn.title = conv.title || "Nouvelle discussion";
      if (conv.id === state.activeConvId) selectBtn.setAttribute("aria-current", "true");
      selectBtn.addEventListener("click", () => {
        state.activeConvId = conv.id;
        renderSidebar();
        renderMessages();
        if (isMobileLayout()) applySidebarCollapsed(true, false);
      });

      const renameBtn = iconButton("nova-conv-act", "pencil", "", "Renommer");
      renameBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const nextTitle = await openNovaPromptDialog({
          title: "Renommer la discussion",
          label: "Nouveau titre de la discussion :",
          defaultValue: conv.title || "",
          submitLabel: "Renommer",
          rows: 1,
          multiline: false
        });
        if (nextTitle && nextTitle.trim()) {
          conv.title = nextTitle.trim().slice(0, 60);
          saveConversations();
          renderSidebar();
        }
      });

      const delBtn = iconButton("nova-conv-act", "trash", "", "Supprimer");
      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (state.conversations.length <= 1) {
          conv.messages = [];
          conv.title = "Nouvelle discussion";
        } else {
          state.conversations = state.conversations.filter((c) => c.id !== conv.id);
          if (state.activeConvId === conv.id) {
            state.activeConvId = state.conversations[0].id;
          }
        }
        saveConversations();
        renderSidebar();
        renderMessages();
      });

      row.appendChild(selectBtn);
      row.appendChild(renameBtn);
      row.appendChild(delBtn);
      list.appendChild(row);
    });
  }

  /* Rendu Markdown sûr façon ChatGPT (titres, citations, listes, code inline et blocs de code avec bouton Copier) */
  function renderRichMarkdown(container, rawText) {
    container.textContent = "";
    const text = String(rawText || "");
    const fenceRe = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
    let lastIdx = 0;
    let match;

    while ((match = fenceRe.exec(text)) !== null) {
      if (match.index > lastIdx) {
        appendTextBlocks(container, text.slice(lastIdx, match.index));
      }
      const lang = (match[1] || "code").trim();
      const codeContent = match[2].replace(/\n$/, "");

      const block = document.createElement("div");
      block.className = "nova-codeblock";

      const bar = document.createElement("div");
      bar.className = "nova-codeblock-bar";
      const langSpan = document.createElement("span");
      langSpan.textContent = lang;
      const copyBtn = iconButton("nova-copy-code-btn", "copy", "Copier le code");
      copyBtn.addEventListener("click", () => {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(codeContent).catch(() => {});
        }
        flashDone(copyBtn, "Copié");
      });
      bar.appendChild(langSpan);
      bar.appendChild(copyBtn);

      const pre = document.createElement("pre");
      const codeEl = document.createElement("code");
      codeEl.textContent = codeContent;
      pre.appendChild(codeEl);

      block.appendChild(bar);
      block.appendChild(pre);
      container.appendChild(block);

      lastIdx = fenceRe.lastIndex;
    }

    if (lastIdx < text.length) {
      appendTextBlocks(container, text.slice(lastIdx));
    }
  }

  function appendInlineFormatted(parent, line) {
    const parts = String(line).split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g);
    parts.forEach((part) => {
      if (!part) return;
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        const c = document.createElement("code");
        c.className = "inline-code";
        c.textContent = part.slice(1, -1);
        parent.appendChild(c);
      } else if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        const b = document.createElement("strong");
        b.textContent = part.slice(2, -2);
        parent.appendChild(b);
      } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        const em = document.createElement("em");
        em.textContent = part.slice(1, -1);
        parent.appendChild(em);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    });
  }

  function appendTextBlocks(container, chunk) {
    const paragraphs = String(chunk).trim().split(/\n{2,}/);
    paragraphs.forEach((para) => {
      const trimmed = para.trim();
      if (!trimmed) return;

      /* Titre Markdown (#, ##, ###) */
      if (/^#{1,3}\s+/.test(trimmed) && !trimmed.includes("\n")) {
        const level = trimmed.match(/^(#{1,3})\s+/)[1].length;
        const tag = level === 1 ? "h2" : (level === 2 ? "h3" : "h4");
        const h = document.createElement(tag);
        appendInlineFormatted(h, trimmed.replace(/^#{1,3}\s+/, ""));
        container.appendChild(h);
        return;
      }

      const lines = trimmed.split(/\r?\n/);

      /* Citation (> ...) */
      if (lines.every((l) => /^\s*>\s?/.test(l))) {
        const bq = document.createElement("blockquote");
        lines.forEach((l, idx) => {
          if (idx > 0) bq.appendChild(document.createElement("br"));
          appendInlineFormatted(bq, l.replace(/^\s*>\s?/, ""));
        });
        container.appendChild(bq);
        return;
      }

      /* Liste numérotée */
      if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
        const ol = document.createElement("ol");
        lines.forEach((l) => {
          const li = document.createElement("li");
          appendInlineFormatted(li, l.replace(/^\s*\d+\.\s+/, ""));
          ol.appendChild(li);
        });
        container.appendChild(ol);
        return;
      }

      /* Liste à puces */
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
        const ul = document.createElement("ul");
        lines.forEach((l) => {
          const li = document.createElement("li");
          appendInlineFormatted(li, l.replace(/^\s*[-*•]\s+/, ""));
          ul.appendChild(li);
        });
        container.appendChild(ul);
        return;
      }

      const p = document.createElement("p");
      lines.forEach((l, idx) => {
        if (idx > 0) p.appendChild(document.createElement("br"));
        appendInlineFormatted(p, l);
      });
      container.appendChild(p);
    });
  }

  function renderMessages() {
    const box = el("messages");
    const welcome = el("welcome");
    if (!box) return;
    const conv = activeConv();
    box.textContent = "";
    const msgs = (conv && conv.messages) || [];
    if (welcome) {
      welcome.classList.toggle("hidden", msgs.length > 0);
    }

    msgs.forEach((m, index) => {
      const wrap = document.createElement("article");
      wrap.className = "nova-msg " + (m.role === "user" ? "user" : "assistant") + (m.error ? " error" : "") + (m.cancelled ? " cancelled" : "");

      if (m.role === "user") {
        const bubble = document.createElement("div");
        bubble.className = "nova-user-bubble";
        bubble.textContent = m.text || "";
        wrap.appendChild(bubble);

        const userTools = document.createElement("div");
        userTools.className = "nova-user-tools";
        const editBtn = iconButton("nova-action-btn", "pencil", "Modifier", "Modifier et relancer à partir d'ici");
        editBtn.addEventListener("click", async () => {
          const edited = await openNovaPromptDialog({
            title: "Modifier le message",
            label: "Modifier le message et relancer à partir d'ici :",
            defaultValue: m.text || "",
            submitLabel: "Relancer",
            rows: 3,
            multiline: true
          });
          if (edited && edited.trim()) {
            conv.messages = conv.messages.slice(0, index);
            saveConversations();
            sendChatMessage(edited.trim());
          }
        });
        userTools.appendChild(editBtn);
        wrap.appendChild(userTools);
      } else {
        const row = document.createElement("div");
        row.className = "nova-assistant-row";

        const avatar = document.createElement("div");
        avatar.className = "nova-assistant-avatar";
        const img = document.createElement("img");
        img.src = "../assets/RubyLogo.png";
        img.alt = "Ruby";
        img.width = 22;
        img.height = 22;
        avatar.appendChild(img);

        const body = document.createElement("div");
        body.className = "nova-assistant-body";

        const header = document.createElement("div");
        header.className = "nova-assistant-header";
        const nameStrong = document.createElement("strong");
        nameStrong.textContent = "Nova";
        const tag = document.createElement("span");
        tag.className = "nova-model-tag";
        tag.textContent = m.modelDisplayName || (m.source === "deterministic" ? "Galaxy · Déterministe" : "Modèle local");
        header.appendChild(nameStrong);
        header.appendChild(tag);

        if (m.timings && isNum(m.timings.totalMs)) {
          const lat = document.createElement("span");
          lat.className = "nova-latency-tag";
          lat.textContent = `· ${formatLatencyBreakdown(m.timings)}`;
          header.appendChild(lat);
        } else if (isNum(m.durationMs)) {
          const lat = document.createElement("span");
          lat.className = "nova-latency-tag";
          lat.textContent = `· ${formatDuration(m.durationMs)}`;
          header.appendChild(lat);
        }

        const prose = document.createElement("div");
        prose.className = "nova-prose";
        renderRichMarkdown(prose, m.text || "");

        body.appendChild(header);
        body.appendChild(prose);

        /* Sources Galaxy vérifiées */
        const sources = m.galaxy && Array.isArray(m.galaxy.sources) ? m.galaxy.sources : [];
        if (sources.length > 0) {
          const srcRow = document.createElement("div");
          srcRow.className = "nova-sources-row";
          sources.slice(0, 6).forEach((s) => {
            const lbl = s && (s.label || s.id);
            if (!lbl) return;
            const sp = document.createElement("span");
            sp.className = "nova-source-pill";
            sp.textContent = String(lbl);
            srcRow.appendChild(sp);
          });
          if (srcRow.childNodes.length > 0) {
            body.appendChild(srcRow);
          }
        }

        const actions = document.createElement("div");
        actions.className = "nova-msg-actions";

        const copyBtn = iconButton("nova-action-btn", "copy", "Copier", "Copier la réponse");
        copyBtn.addEventListener("click", () => {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(m.text || "").catch(() => {});
          }
          flashDone(copyBtn, "Copié");
        });
        actions.appendChild(copyBtn);

        /* Bouton Régénérer façon ChatGPT */
        if (index > 0 && msgs[index - 1] && msgs[index - 1].role === "user") {
          const prevUserText = msgs[index - 1].text;
          const regenBtn = iconButton("nova-action-btn", "refresh", "Régénérer", "Régénérer la réponse");
          regenBtn.addEventListener("click", () => {
            conv.messages = conv.messages.slice(0, index - 1);
            saveConversations();
            sendChatMessage(prevUserText);
          });
          actions.appendChild(regenBtn);
        }

        body.appendChild(actions);

        row.appendChild(avatar);
        row.appendChild(body);
        wrap.appendChild(row);
      }

      box.appendChild(wrap);
    });

    const scrollArea = el("chat-scroll-area");
    if (scrollArea) {
      scrollArea.scrollTop = scrollArea.scrollHeight;
    }
  }

  function resizeComposerInput() {
    const input = el("prompt-input");
    const counter = el("composer-char-count");
    if (!input) return;
    if (counter) {
      counter.textContent = `${input.value.length} / 4000`;
    }
  }

  function publicReply(message) {
    if (/transformer|attention/i.test(message)) {
      return "Dans un Transformer, l’attention permet à chaque mot de tenir compte des autres mots du texte. "
        + "Dans « Le chat dort parce qu’il est fatigué », ces liens aident le modèle à associer « il » au chat.";
    }
    if (/python|asynchrone|file de tâches/i.test(message)) {
      return "Pour une file de tâches asynchrones, utilise `asyncio.Queue` et des workers qui appellent `await queue.get()`. "
        + "Chaque worker peut journaliser les exceptions et appeler `queue.task_done()` dans un bloc `finally`.";
    }
    if (/performances|processeur|gpu|disque/i.test(message)) {
      return "Observe le processeur, la mémoire, le GPU et le disque pendant le ralentissement. "
        + "Compare les valeurs au repos et en charge pour repérer la ressource qui sature.";
    }
    if (/sun|adara|buna|modèle/i.test(message)) {
      return "Dans Ruby, Sun vise les réponses rapides, Adara équilibre débit et capacité, "
        + "et Buna est destiné aux tâches de raisonnement plus exigeantes.";
    }
    return "La démo propose des réponses prédéfinies. Essaie un exemple sur l’attention, "
      + "les tâches asynchrones, les performances ou les modèles Ruby.";
  }

  function sendChatMessage(text) {
    const clean = String(text || "").trim().slice(0, 4000);
    if (!clean) return;
    const conv = activeConv();
    if (conv.messages.length === 0) conv.title = clean.slice(0, 46);
    conv.messages.push({ role: "user", text: clean });
    conv.messages.push({ role: "assistant", text: publicReply(clean), modelDisplayName: "Exemple" });
    saveConversations();
    renderSidebar();
    renderMessages();
  }

  function createNewConversation() {
    const c = { id: newConvId(), title: "Nouvelle discussion", messages: [] };
    state.conversations.unshift(c);
    state.activeConvId = c.id;
    saveConversations();
    renderSidebar();
    renderMessages();
    const input = el("prompt-input");
    if (input) input.focus();
  }

  function buildMarkdownTranscript(conv) {
    const title = (conv && conv.title) || "Discussion Ruby Nova";
    const body = ((conv && conv.messages) || [])
      .map((m) => {
        const who = m.role === "user" ? "### 👤 Utilisateur" : `### ✦ Ruby Nova (${m.modelDisplayName || "Local"})`;
        return `${who}\n\n${m.text || ""}`;
      })
      .join("\n\n---\n\n");
    return `# ${title}\n\n${body}\n`;
  }

  function wireEvents() {
    const backdrop = el("nova-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", () => applySidebarCollapsed(true, false));
    }

    const toggleSidebarBtn = el("toggle-sidebar");
    if (toggleSidebarBtn) {
      toggleSidebarBtn.addEventListener("click", () => {
        applySidebarCollapsed(!state.sidebarCollapsed);
      });
    }

    [el("new-chat"), el("new-chat-main")].forEach((btn) => {
      if (btn) btn.addEventListener("click", createNewConversation);
    });

    const searchInput = el("conv-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        state.searchQuery = searchInput.value;
        renderSidebar();
      });
    }

    const composer = el("composer");
    const promptInput = el("prompt-input");
    if (composer && promptInput) {
      promptInput.addEventListener("input", resizeComposerInput);
      composer.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const text = promptInput.value;
        promptInput.value = "";
        resizeComposerInput();
        sendChatMessage(text);
      });
      promptInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          composer.requestSubmit();
        }
      });
    }

    document.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "b") {
        ev.preventDefault();
        applySidebarCollapsed(!state.sidebarCollapsed);
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        if (state.sidebarCollapsed) applySidebarCollapsed(false);
        if (searchInput) searchInput.focus();
      } else if (ev.altKey && ev.key.toLowerCase() === "n") {
        ev.preventDefault();
        createNewConversation();
      }
    });

    document.querySelectorAll(".suggestions button[data-prompt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        sendChatMessage(btn.getAttribute("data-prompt") || "");
      });
    });

    const clearChatBtn = el("clear-chat");
    if (clearChatBtn) {
      clearChatBtn.addEventListener("click", () => {
        const c = activeConv();
        if (c) {
          c.messages = [];
          saveConversations();
          renderMessages();
        }
      });
    }

    const exportBtn = el("export-chat");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const c = activeConv();
        if (!c || !c.messages.length) return;
        const transcript = buildMarkdownTranscript(c);
        if (navigator.clipboard) {
          navigator.clipboard.writeText(transcript).catch(() => {});
        }
        flashDone(exportBtn);
      });
    }

    const downloadBtn = el("download-chat");
    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => {
        const c = activeConv();
        if (!c || !c.messages.length) return;
        const md = buildMarkdownTranscript(c);
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const slug = String(c.title || "discussion").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40) || "discussion";
        a.href = url;
        a.download = `ruby-nova-${slug}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
    }

    const clearHistoryBtn = el("clear-history");
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener("click", () => {
        state.conversations = [{ id: newConvId(), title: "Nouvelle discussion", messages: [] }];
        state.activeConvId = state.conversations[0].id;
        saveConversations();
        renderSidebar();
        renderMessages();
      });
    }

    const mascotHome = el("mascot-home");
    const mascotHint = el("mascot-hint");
    if (mascotHome && mascotHint) {
      mascotHome.addEventListener("click", () => {
        state.tipIndex = (state.tipIndex + 1) % TIPS.length;
        mascotHint.textContent = TIPS[state.tipIndex];
      });
    }

    const settingsDialog = el("settings-dialog");
    [el("open-settings")].forEach((btn) => {
      if (btn && settingsDialog) {
        btn.addEventListener("click", () => {

          settingsDialog.showModal();
        });
        btn.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();

            settingsDialog.showModal();
          }
        });
      }
    });

    document.querySelectorAll('input[name="theme"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) applyTheme(radio.value);
      });
    });

  }

  loadPreferences();
  loadConversations();
  renderSidebar();
  renderMessages();
  wireEvents();

})(typeof window !== "undefined" ? window : globalThis);
