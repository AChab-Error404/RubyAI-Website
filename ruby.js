(() => {
  "use strict";
  const endpointKey = "ruby-ai-endpoint";
  const tokenKey = "ruby-ai-bridge-token";
  const makeId = (prefix) => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  let conversationId = makeId("conversation");
  const $ = (id) => document.getElementById(id);
  const messages = $("messages");
  const welcome = $("welcome-block");
  const form = $("composer");
  const prompt = $("prompt");
  const typing = $("typing-row");
  const endpoint = () => sessionStorage.getItem(endpointKey) || "";
  const token = () => sessionStorage.getItem(tokenKey) || "";
  const sidebar = $("sidebar");
  const backdrop = $("drawer-backdrop");

  function setDrawer(open) {
    sidebar.classList.toggle("open", open);
    backdrop.classList.toggle("open", open);
    backdrop.setAttribute("aria-hidden", String(!open));
    $("mobile-menu").setAttribute("aria-expanded", String(open));
  }

  function endpointIsAllowed(value) {
    try {
      const parsed = new URL(value);
      const local = parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
      const remote = parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
      return (local || remote) && parsed.pathname === "/chat" && !parsed.search && !parsed.hash;
    } catch (_) {
      return false;
    }
  }

  function healthEndpoint(value) {
    const parsed = new URL(value);
    parsed.pathname = "/health";
    return parsed.toString();
  }

  function addMessage(role, text) {
    const item = document.createElement("article");
    item.className = `message ${role}`;
    if (role === "assistant") {
      const avatar = document.createElement("img");
      avatar.className = "message-avatar";
      avatar.alt = "Mascotte Ruby";
      avatar.src = "assets/mascot/RubyMascotIdle.png";
      item.appendChild(avatar);
    }
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = text;
    item.appendChild(bubble);
    messages.appendChild(item);
    $("conversation").scrollTop = $("conversation").scrollHeight;
  }

  function setConnection(connected, label) {
    $("online-dot").classList.toggle("connected", connected);
    $("connection-label").textContent = connected ? "Ruby connectée" : label;
  }

  async function askRuby(text) {
    if (!endpoint()) throw new Error("Pont Ruby non configuré");
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const requestId = makeId("request");
    const response = await fetch(endpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify({ version: 1, request_id: requestId, turn_id: makeId("turn"), conversation_id: conversationId, text, stream: false, engine: "galaxy" }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Ruby a répondu HTTP ${response.status}`);
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
    throw new Error("Réponse Ruby non reconnue");
  }

  async function submit(text) {
    const clean = text.trim();
    if (!clean) return;
    welcome.classList.add("hidden");
    addMessage("user", clean);
    prompt.value = "";
    prompt.style.height = "auto";
    typing.classList.remove("hidden");
    try {
      const answer = await askRuby(clean);
      typing.classList.add("hidden");
      setConnection(true, "Connecté à Ruby en local");
      addMessage("assistant", answer);
    } catch (error) {
      typing.classList.add("hidden");
      setConnection(false, "Mode démonstration · Ruby non connectée");
      addMessage("assistant", "Je ne parviens pas à joindre Ruby. Vérifie que le pont local fonctionne, que le tunnel HTTPS est actif et que le jeton d’accès est correct dans ⚙ Connexion Ruby.");
      console.info("Ruby local bridge unavailable", error);
    }
  }

  form.addEventListener("submit", (event) => { event.preventDefault(); void submit(prompt.value); });
  prompt.addEventListener("input", () => { prompt.style.height = "auto"; prompt.style.height = `${Math.min(prompt.scrollHeight, 130)}px`; });
  prompt.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(prompt.value); } });
  document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => { void submit(button.dataset.prompt || ""); }));
  const resetConversation = () => { conversationId = makeId("conversation"); messages.replaceChildren(); welcome.classList.remove("hidden"); prompt.focus(); setDrawer(false); };
  $("new-chat").addEventListener("click", resetConversation);
  $("topbar-new").addEventListener("click", resetConversation);
  $("clear-chat").addEventListener("click", () => { conversationId = makeId("conversation"); messages.replaceChildren(); welcome.classList.remove("hidden"); });
  document.querySelectorAll("[data-toast]").forEach((button) => button.addEventListener("click", () => { addMessage("assistant", button.dataset.toast || ""); }));
  $("attach-button").addEventListener("click", () => { addMessage("assistant", "Les pièces jointes ne sont pas encore activées dans cette version. Le noyau local reste limité aux outils explicitement autorisés."); });
  document.querySelectorAll(".recent-chat").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".recent-chat").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
  }));
  $("mobile-menu").addEventListener("click", () => setDrawer(true));
  $("drawer-close").addEventListener("click", () => setDrawer(false));
  backdrop.addEventListener("click", () => setDrawer(false));
  document.querySelectorAll(".nav-item:not(:disabled)").forEach((button) => button.addEventListener("click", () => setDrawer(false)));
  const dialog = $("settings-dialog");
  const openSettings = () => {
    $("api-endpoint").value = endpoint();
    $("api-token").value = token();
    $("dialog-status").textContent = "";
    dialog.showModal();
  };
  $("settings-button").addEventListener("click", openSettings);
  $("open-settings").addEventListener("click", openSettings);
  async function saveConnection() {
    const value = $("api-endpoint").value.trim().replace(/\/$/, "");
    const accessToken = $("api-token").value.trim();
    if (!endpointIsAllowed(value)) {
      $("dialog-status").textContent = "Utilise http://127.0.0.1 en local ou une URL HTTPS /chat pour un tunnel distant.";
      return;
    }
    if (accessToken.length < 43) {
      $("dialog-status").textContent = "Le jeton doit contenir au moins 43 caractères URL-safe.";
      return;
    }
    $("dialog-status").textContent = "Test de connexion à Ruby…";
    try {
      const response = await fetch(healthEndpoint(value), {
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const health = await response.json();
      if (health.status !== "ok") throw new Error("pont non prêt");
      sessionStorage.setItem(endpointKey, value);
      sessionStorage.setItem(tokenKey, accessToken);
      setConnection(true, "Connecté à Ruby en local");
      $("dialog-status").textContent = "Ruby est joignable. La connexion est conservée pour cet onglet.";
      window.setTimeout(() => dialog.close(), 500);
    } catch (error) {
      $("dialog-status").textContent = "Pont injoignable. Vérifie le tunnel, l’origine GitHub Pages et le jeton.";
      console.info("Ruby bridge health check failed", error);
    }
  }
  $("settings-form").addEventListener("submit", (event) => {
    if (event.submitter && event.submitter.id === "save-settings") {
      event.preventDefault();
      void saveConnection();
    }
  });
  $("privacy-note").addEventListener("click", () => { addMessage("assistant", "Le site GitHub ne contient pas Ruby. Il transmet le message uniquement au pont HTTPS authentifié que tu as configuré ; Ruby garde les politiques d’autorisation et les outils fermés."); });
  setConnection(false, sessionStorage.getItem(endpointKey) ? "Pont configuré · test requis" : "Mode démonstration");
})();
