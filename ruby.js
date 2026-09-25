(() => {
  "use strict";
  const endpointKey = "ruby-ai-endpoint";
  const tokenKey = "ruby-ai-bridge-token";
  const conversationsKey = "ruby-ai-conversations-v1";
  const themeKey = "ruby-ai-theme";
  const mascotKey = "ruby-ai-mascot";
  const tips = ["Une petite étape à la fois, c’est déjà avancer.", "Tu peux me demander une réponse courte ou détaillée.", "Besoin d’idées ? On peut explorer plusieurs pistes ensemble.", "Tu peux toujours démarrer une nouvelle conversation dans le menu."];
  const mascotStates = new Set(["Idle", "Happy", "Alert", "Thinking", "Working", "WorkingHard", "Speaking", "Sad", "Error", "Playing", "Jump"]);
  const $ = (id) => document.getElementById(id);
  const messages = $("messages");
  const welcome = $("welcome-block");
  const form = $("composer");
  const prompt = $("prompt");
  const typing = $("typing-row");
  const sendButton = $("send-button");
  const historyNode = $("conversation-list");
  const dialog = $("settings-dialog");
  const sidebar = $("sidebar");
  const backdrop = $("drawer-backdrop");
  const readSession = (key, fallback = "") => { try { return sessionStorage.getItem(key) || fallback; } catch (_) { return fallback; } };
  const writeSession = (key, value) => { try { sessionStorage.setItem(key, value); } catch (_) { /* Private browsing may disable storage. */ } };
  const makeId = (prefix) => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  let conversations = loadConversations();
  let conversationId = conversations[0]?.id || makeId("conversation");
  let activeController = null;
  let activeRequest = 0;
  let responseTimer = null;
  let mascotTimer = null;
  let activeMascotImage = null;

  function loadConversations() {
    try {
      const value = JSON.parse(readSession(conversationsKey, "[]"));
      return Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string" && Array.isArray(item.messages)).slice(0, 30) : [];
    } catch (_) { return []; }
  }

  function saveConversations() {
    conversations = conversations.slice(0, 30);
    writeSession(conversationsKey, JSON.stringify(conversations));
    renderHistory();
  }

  function activeConversation() {
    let item = conversations.find((entry) => entry.id === conversationId);
    if (!item) {
      item = { id: conversationId, title: "Nouvelle conversation", messages: [], updatedAt: Date.now() };
      conversations.unshift(item);
    }
    return item;
  }

  function renderHistory() {
    historyNode.replaceChildren();
    conversations.forEach((entry) => {
      const row = document.createElement("div");
      row.className = `history-item${entry.id === conversationId ? " active" : ""}`;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "history-title";
      open.textContent = entry.title || "Nouvelle conversation";
      open.setAttribute("aria-label", `Ouvrir ${open.textContent}`);
      open.addEventListener("click", () => selectConversation(entry.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-conversation";
      remove.textContent = "×";
      remove.title = "Supprimer cette conversation";
      remove.setAttribute("aria-label", `Supprimer ${entry.title || "cette conversation"}`);
      remove.addEventListener("click", (event) => { event.stopPropagation(); deleteConversation(entry.id); });
      row.append(open, remove);
      historyNode.appendChild(row);
    });
  }

  function setDrawer(open) {
    sidebar.classList.toggle("open", open);
    backdrop.classList.toggle("open", open);
    backdrop.setAttribute("aria-hidden", String(!open));
    $("mobile-menu").setAttribute("aria-expanded", String(open));
  }

  function setMascot(state, hint) {
    const normalized = mascotStates.has(state) ? state : "Idle";
    const image = activeMascotImage || document.querySelector(typing.classList.contains("hidden") ? ".mascot" : ".tiny-mascot");
    if (image) image.src = `assets/mascot/RubyMascot${normalized}.png`;
    $("mascot-hint").textContent = hint || "";
    if (mascotTimer) window.clearTimeout(mascotTimer);
  }

  function enableMascot() {
    let enabled = true;
    try { enabled = localStorage.getItem(mascotKey) !== "false"; } catch (_) { /* Preference is optional. */ }
    $("mascot-home").classList.toggle("hidden", !enabled);
    document.querySelectorAll(".message-avatar-button").forEach((button) => button.classList.toggle("hidden", !enabled));
    $("mascot-toggle").checked = enabled;
  }

  function renderInline(text, parent) {
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > offset) parent.appendChild(document.createTextNode(text.slice(offset, match.index)));
      const value = match[0];
      const node = value.startsWith("`") ? document.createElement("code") : document.createElement("strong");
      node.textContent = value.slice(value.startsWith("`") ? 1 : 2, value.startsWith("`") ? -1 : -2);
      parent.appendChild(node);
      offset = match.index + value.length;
    }
    if (offset < text.length) parent.appendChild(document.createTextNode(text.slice(offset)));
  }

  function renderSafeMarkdown(text, container) {
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    let paragraph = [];
    let list = null;
    let code = null;
    const flushParagraph = () => {
      if (!paragraph.length) return;
      const p = document.createElement("p");
      renderInline(paragraph.join(" "), p);
      container.appendChild(p);
      paragraph = [];
    };
    const flushList = () => { if (list) { container.appendChild(list); list = null; } };
    for (const line of lines) {
      if (line.startsWith("```")) {
        flushParagraph(); flushList();
        if (code) { container.appendChild(code); code = null; }
        else { code = document.createElement("pre"); const node = document.createElement("code"); code.appendChild(node); }
        continue;
      }
      if (code) { code.firstChild.appendChild(document.createTextNode(`${line}\n`)); continue; }
      if (!line.trim()) { flushParagraph(); flushList(); continue; }
      const heading = line.match(/^#{1,3}\s+(.+)$/);
      if (heading) { flushParagraph(); flushList(); const h = document.createElement("h3"); renderInline(heading[1], h); container.appendChild(h); continue; }
      const item = line.match(/^\s*[-*]\s+(.+)$/);
      if (item) { flushParagraph(); if (!list) list = document.createElement("ul"); const li = document.createElement("li"); renderInline(item[1], li); list.appendChild(li); continue; }
      flushList(); paragraph.push(line);
    }
    flushParagraph(); flushList();
    if (code) container.appendChild(code);
  }

  function addMessage(role, text, options = {}) {
    const item = document.createElement("article");
    item.className = `message ${role}${options.error ? " error" : ""}`;
    if (role === "assistant") {
      const avatarButton = document.createElement("button");
      avatarButton.type = "button";
      avatarButton.className = "message-avatar-button";
      avatarButton.setAttribute("aria-label", "Ruby : afficher un conseil");
      const avatar = document.createElement("img");
      avatar.className = "message-avatar";
      avatar.alt = "";
      avatar.src = "assets/mascot/RubyMascotIdle.png";
      const hint = document.createElement("span"); hint.className = "message-mascot-hint"; hint.setAttribute("role", "status");
      avatarButton.appendChild(avatar);
      avatarButton.addEventListener("mouseenter", () => { avatar.src = "assets/mascot/RubyMascotHappy.png"; });
      avatarButton.addEventListener("mouseleave", () => { if (!hint.classList.contains("visible")) avatar.src = "assets/mascot/RubyMascotIdle.png"; });
      avatarButton.addEventListener("click", () => {
        avatar.src = "assets/mascot/RubyMascotJump.png";
        hint.textContent = tips[Math.floor(Math.random() * tips.length)];
        hint.classList.add("visible");
        window.setTimeout(() => { hint.classList.remove("visible"); avatar.src = "assets/mascot/RubyMascotIdle.png"; }, 3200);
      });
      item.append(avatarButton, hint);
      activeMascotImage = avatar;
    }
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (role === "assistant" && !options.error) {
      const content = document.createElement("div");
      content.className = "message-content";
      renderSafeMarkdown(text, content);
      bubble.appendChild(content);
    } else bubble.textContent = text;
    item.appendChild(bubble);
    if (role === "assistant" && options.tools) {
      const tools = document.createElement("div");
      tools.className = "message-tools";
      const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "Copier";
      copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(text); copy.textContent = "Copié"; } catch (_) { copy.textContent = "Copie indisponible"; } });
      const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Réessayer";
      retry.addEventListener("click", () => { item.remove(); void submit(options.retryText || ""); });
      tools.append(copy, retry); bubble.appendChild(tools);
    }
    if (role === "assistant" && options.connect) {
      const actionRow = document.createElement("div");
      actionRow.className = "connect-action";
      const connect = document.createElement("button");
      connect.type = "button"; connect.className = "primary-button connect-button"; connect.textContent = "Configurer la connexion";
      connect.addEventListener("click", openSettings);
      actionRow.appendChild(connect);
      bubble.appendChild(actionRow);
    }
    messages.appendChild(item);
    $("conversation").scrollTop = $("conversation").scrollHeight;
    welcome.classList.add("hidden");
    enableMascot();
    return item;
  }

  function renderConversation() {
    activeMascotImage = null;
    messages.replaceChildren();
    const entry = activeConversation();
    entry.messages.forEach((message) => addMessage(message.role, message.text));
    welcome.classList.toggle("hidden", entry.messages.length > 0);
    enableMascot();
    renderHistory();
  }

  function setConnection(connected, label) {
    $("online-dot").classList.toggle("connected", connected);
    $("connection-label").textContent = connected ? "Connectée à Ruby" : label;
  }

  function endpointIsAllowed(value) {
    try {
      const parsed = new URL(value);
      const local = parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
      const remote = parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
      return (local || remote) && parsed.pathname === "/chat" && !parsed.search && !parsed.hash;
    } catch (_) { return false; }
  }

  function healthEndpoint(value) { const parsed = new URL(value); parsed.pathname = "/health"; return parsed.toString(); }

  async function askRuby(text, signal) {
    const url = readSession(endpointKey);
    if (!url) throw new Error("NOT_CONFIGURED");
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    const accessToken = readSession(tokenKey);
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const requestId = makeId("request");
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ request_id: requestId, turn_id: makeId("turn"), conversation_id: conversationId, message: text }), signal });
    if (!response.ok) {
      const error = new Error(`HTTP_${response.status}`);
      error.status = response.status;
      error.retryAfter = response.headers.get("Retry-After");
      throw error;
    }
    const payload = await response.json();
    if (payload && payload.error && typeof payload.text !== "string") throw new Error(String(payload.error));
    if (payload && payload.error && payload.text) throw new Error(String(payload.text));
    if (typeof payload.text === "string") return payload.text;
    if (typeof payload.answer === "string") return payload.answer;
    if (typeof payload.message === "string") return payload.message;
    if (Array.isArray(payload.events)) {
      const done = payload.events.find((event) => event && event.kind === "done");
      if (done && typeof done.text === "string") return done.text;
    }
    throw new Error("INVALID_RESPONSE");
  }

  function friendlyError(error) {
    if (error.name === "AbortError") return "Requête arrêtée. Tu peux reformuler ou réessayer.";
    if (error.name === "TimeoutError") return "Ruby met trop de temps à répondre. Vérifie le pont et réessaie.";
    if (error.message === "NOT_CONFIGURED") return "Ruby n’est pas connectée. Ouvre Réglages pour configurer son pont local ou HTTPS privé.";
    if (error.status === 401 || error.status === 403) return "Accès refusé par Ruby (401/403). Vérifie le jeton et les autorisations du pont.";
    if (error.status === 429) return `Ruby est occupée. Réessaie${error.retryAfter ? ` dans ${error.retryAfter} secondes` : " dans un instant"}.`;
    if (error.status === 400) return "Ruby n’a pas accepté cette demande (400). Vérifie le message et le protocole du pont.";
    if (error.status >= 500) return `Le pont Ruby a rencontré une erreur (${error.status}). Réessaie plus tard.`;
    if (error.message === "INVALID_RESPONSE") return "Le pont a retourné une réponse inattendue. Mets-le à jour ou vérifie ses journaux.";
    if (error instanceof TypeError) return "Impossible de joindre le pont Ruby. Vérifie qu’il est démarré, ainsi que l’URL et le tunnel HTTPS.";
    return "Ruby n’a pas pu terminer cette demande. Vérifie le pont puis réessaie.";
  }

  function saveTurn(role, text) {
    const entry = activeConversation();
    entry.messages.push({ role, text });
    if (entry.messages.length > 40) entry.messages = entry.messages.slice(-40);
    if (role === "user" && entry.title === "Nouvelle conversation") entry.title = text.slice(0, 44) + (text.length > 44 ? "…" : "");
    entry.updatedAt = Date.now();
    conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    saveConversations();
  }

  function updateMascotWhileWaiting(startedAt) {
    const elapsed = Date.now() - startedAt;
    if (elapsed < 6000) setMascot("Thinking", "Je réfléchis…");
    else if (elapsed < 18000) setMascot("Working", "Je prépare une réponse.");
    else setMascot("WorkingHard", "Je prends un peu plus de temps.");
    mascotTimer = window.setTimeout(() => updateMascotWhileWaiting(startedAt), 6000);
  }

  async function submit(text) {
    const clean = text.trim();
    if (!clean) return;
    if (activeController) { activeController.abort(); return; }
    const requestNumber = ++activeRequest;
    const controller = new AbortController();
    activeController = controller;
    responseTimer = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), 190000);
    saveTurn("user", clean);
    addMessage("user", clean);
    prompt.value = ""; resizePrompt();
    typing.classList.remove("hidden");
    sendButton.classList.add("stop"); sendButton.textContent = ""; sendButton.setAttribute("aria-label", "Arrêter la réponse"); sendButton.title = "Arrêter la réponse";
    const startedAt = Date.now(); updateMascotWhileWaiting(startedAt);
    try {
      const answer = await askRuby(clean, controller.signal);
      if (requestNumber !== activeRequest) return;
      saveTurn("assistant", answer);
      addMessage("assistant", answer, { tools: true, retryText: clean });
      setConnection(true, "Connectée à Ruby");
      setMascot("Speaking"); mascotTimer = window.setTimeout(() => setMascot("Happy"), 1800);
      window.setTimeout(() => { if (!activeController) setMascot("Idle"); }, 3200);
    } catch (error) {
      if (requestNumber !== activeRequest) return;
      const message = friendlyError(error);
      addMessage("assistant", message, { error: true, tools: true, retryText: clean, connect: error.message === "NOT_CONFIGURED" });
      setMascot(error.name === "AbortError" ? "Sad" : "Error", message);
      if (error.name !== "AbortError") setConnection(false, error.message === "NOT_CONFIGURED" ? "Non connectée" : "Connexion à vérifier");
      console.info("Ruby bridge request failed", { status: error.status || "network", name: error.name || "Error" });
    } finally {
      if (requestNumber === activeRequest) {
        window.clearTimeout(responseTimer); responseTimer = null;
        activeController = null;
        typing.classList.add("hidden");
        sendButton.classList.remove("stop"); sendButton.textContent = "↑"; sendButton.setAttribute("aria-label", "Envoyer"); sendButton.title = "Envoyer";
        enableMascot();
      }
    }
  }

  function resizePrompt() { prompt.style.height = "auto"; prompt.style.height = `${Math.min(prompt.scrollHeight, 160)}px`; }
  function stopRequest() { if (activeController) { activeController.abort(); activeController = null; activeRequest++; if (responseTimer) window.clearTimeout(responseTimer); responseTimer = null; if (mascotTimer) window.clearTimeout(mascotTimer); mascotTimer = null; typing.classList.add("hidden"); sendButton.classList.remove("stop"); sendButton.textContent = "↑"; sendButton.setAttribute("aria-label", "Envoyer"); setMascot("Sad", "D’accord, j’arrête."); } }

  function resetConversation() {
    stopRequest();
    activeMascotImage = null;
    conversationId = makeId("conversation");
    conversations.unshift({ id: conversationId, title: "Nouvelle conversation", messages: [], updatedAt: Date.now() });
    saveConversations(); renderConversation(); prompt.focus(); setDrawer(false); setMascot("Playing", "On repart sur une nouvelle idée !");
    mascotTimer = window.setTimeout(() => setMascot("Idle"), 1800);
  }

  function selectConversation(id) {
    stopRequest(); activeMascotImage = null; conversationId = id; renderConversation(); setDrawer(false);
  }

  function deleteConversation(id) {
    conversations = conversations.filter((entry) => entry.id !== id);
    if (conversationId === id) { conversationId = conversations[0]?.id || makeId("conversation"); }
    activeMascotImage = null; saveConversations(); renderConversation();
  }

  function clearConversation() {
    stopRequest();
    activeMascotImage = null;
    conversations = conversations.filter((entry) => entry.id !== conversationId);
    conversationId = makeId("conversation");
    conversations.unshift({ id: conversationId, title: "Nouvelle conversation", messages: [], updatedAt: Date.now() });
    saveConversations(); renderConversation();
  }

  function setTheme(theme) {
    const selected = ["ruby", "faye", "halley"].includes(theme) ? theme : "ruby";
    document.documentElement.dataset.theme = selected;
    document.querySelector(`input[name="theme"][value="${selected}"]`).checked = true;
    try { localStorage.setItem(themeKey, selected); } catch (_) { /* Appearance still applies for this tab. */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    meta.content = selected === "faye" ? "#21192d" : selected === "halley" ? "#f5f8fd" : "#0b0b0e";
  }

  function applyMascotPreference() {
    const enabled = $("mascot-toggle").checked;
    try { localStorage.setItem(mascotKey, String(enabled)); } catch (_) { /* Optional preference. */ }
    enableMascot();
  }

  function openSettings() {
    $("api-endpoint").value = readSession(endpointKey);
    $("api-token").value = readSession(tokenKey);
    $("dialog-status").textContent = "";
    dialog.showModal();
  }

  async function saveConnection() {
    const value = $("api-endpoint").value.trim().replace(/\/$/, "");
    const accessToken = $("api-token").value.trim();
    if (!endpointIsAllowed(value)) { $("dialog-status").textContent = "Utilise http://127.0.0.1:8787 ou une URL HTTPS /chat pour un tunnel distant."; return; }
    if (accessToken.length < 43) { $("dialog-status").textContent = "Le jeton doit contenir au moins 43 caractères URL-safe."; return; }
    $("dialog-status").textContent = "Test de connexion à Ruby…";
    try {
      const response = await fetch(healthEndpoint(value), { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const health = await response.json();
      if (health.status !== "ok") throw new Error("bridge not ready");
      writeSession(endpointKey, value); writeSession(tokenKey, accessToken);
      setConnection(true, "Connectée à Ruby"); $("dialog-status").textContent = "Ruby est joignable. La connexion reste dans cet onglet.";
      window.setTimeout(() => dialog.close(), 650);
    } catch (_) { $("dialog-status").textContent = "Pont injoignable. Vérifie le tunnel, l’origine GitHub Pages et le jeton."; }
  }

  form.addEventListener("submit", (event) => { event.preventDefault(); if (activeController) stopRequest(); else void submit(prompt.value); });
  prompt.addEventListener("input", resizePrompt);
  prompt.addEventListener("input", () => { if (!activeController && prompt.value.trim()) setMascot("Alert", "Je t’écoute !"); else if (!activeController) setMascot("Idle", "Salut Antoine ! Clique pour un petit conseil."); });
  prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); form.requestSubmit(); }
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => { void submit(button.dataset.prompt || ""); }));
  $("new-chat").addEventListener("click", resetConversation);
  $("clear-history").addEventListener("click", () => {
    if (!conversations.length || !window.confirm("Effacer toutes les conversations de cet onglet ?")) return;
    conversations = []; conversationId = makeId("conversation"); saveConversations(); renderConversation(); setDrawer(false);
  });
  $("clear-chat").addEventListener("click", clearConversation);
  $("mobile-menu").addEventListener("click", () => setDrawer(true));
  $("drawer-close").addEventListener("click", () => setDrawer(false));
  backdrop.addEventListener("click", () => setDrawer(false));
  $("settings-button").addEventListener("click", openSettings);
  $("open-settings").addEventListener("click", openSettings);
  $("settings-form").addEventListener("submit", (event) => { if (event.submitter?.id === "save-settings") { event.preventDefault(); void saveConnection(); } });
  document.querySelectorAll('input[name="theme"]').forEach((input) => input.addEventListener("change", () => setTheme(input.value)));
  $("mascot-toggle").addEventListener("change", applyMascotPreference);
  $("toggle-token").addEventListener("click", () => { const field = $("api-token"); const shown = field.type === "password"; field.type = shown ? "text" : "password"; $("toggle-token").textContent = shown ? "Masquer" : "Afficher"; });
  $("disconnect").addEventListener("click", () => { try { sessionStorage.removeItem(endpointKey); sessionStorage.removeItem(tokenKey); } catch (_) { /* no-op */ } setConnection(false, "Non connectée"); $("api-endpoint").value = ""; $("api-token").value = ""; $("dialog-status").textContent = "Connexion supprimée de cet onglet."; });
  $("mascot-home").addEventListener("click", () => { setMascot("Jump", tips[Math.floor(Math.random() * tips.length)]); mascotTimer = window.setTimeout(() => setMascot("Idle", "Salut Antoine ! Clique pour un petit conseil."), 3300); });
  $("mascot-home").addEventListener("mouseenter", () => setMascot("Happy", "Content de te voir !"));
  $("mascot-home").addEventListener("mouseleave", () => setMascot("Idle", "Salut Antoine ! Clique pour un petit conseil."));
  $("privacy-note").addEventListener("click", () => addMessage("assistant", "Le site ne contient pas Ruby. Il transmet le message uniquement au pont HTTPS authentifié que tu as configuré ; Ruby conserve les politiques d’autorisation et les outils fermés."));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { if (activeController) stopRequest(); else if (sidebar.classList.contains("open")) setDrawer(false); }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "o") { event.preventDefault(); resetConversation(); }
  });

  let selectedTheme = "ruby";
  try { selectedTheme = localStorage.getItem(themeKey) || "ruby"; } catch (_) { /* Default to Ruby. */ }
  setTheme(selectedTheme);
  renderConversation();
  const storedEndpoint = readSession(endpointKey);
  if (storedEndpoint && readSession(tokenKey)) {
    setConnection(false, "Vérification de Ruby…");
    fetch(healthEndpoint(storedEndpoint), { headers: { Accept: "application/json", Authorization: `Bearer ${readSession(tokenKey)}` }, signal: AbortSignal.timeout(5000) })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("health")))
      .then((health) => { if (health.status === "ok") setConnection(true, "Connectée à Ruby"); else setConnection(false, "Connexion à vérifier"); })
      .catch(() => setConnection(false, "Connexion à vérifier"));
  } else setConnection(false, storedEndpoint ? "Pont configuré · jeton absent" : "Non connectée");
  ["Thinking", "Speaking", "Happy", "Sad"].forEach((state) => { const image = new Image(); image.src = `assets/mascot/RubyMascot${state}.png`; });
})();
