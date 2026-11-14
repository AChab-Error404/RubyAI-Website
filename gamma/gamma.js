(function (globalScope) {
  "use strict";

  const SLOT_NAMES = {
    "auto": "Auto (Routeur P5)",
    "local-fast": "Sun 4B",
    "local-balanced": "Adara 9B",
    "local-powerful": "Buna 12B"
  };

  const state = {
    projectAttached: false,
    currentDir: ".",
    currentEntries: [],
    treeFilter: "",
    currentFile: null,
    currentFileRaw: "",
    currentFileTotalLines: 0,
    activeTaskId: null,
    taskObjectives: new Map(),
    sessionTasks: [],
    testProfile: null,
    testPlan: null,
    trustedForTests: false,
    writable: false,
    agentMode: "ask",
    selectedModelSlot: "local-fast",
    theme: "dark"
  };

  function isNum(val) {
    return typeof val === "number" && Number.isFinite(val);
  }

  function modeBadge(mode, capturedAt) {
    if (mode === "live") return "En direct";
    if (mode === "cached") {
      const ts = capturedAt ? ` (${String(capturedAt).slice(0, 19).replace("T", " ")})` : "";
      return `Cache${ts}`;
    }
    return "Non mesuré";
  }

  function formatGpuPill(gpu) {
    if (!gpu || !gpu.Name) {
      return { text: "GPU : non mesuré", ok: false };
    }
    const rawTemp = isNum(gpu.TemperatureValueC)
      ? gpu.TemperatureValueC
      : (gpu.TemperatureC && isNum(gpu.TemperatureC.Value) ? gpu.TemperatureC.Value : null);
    const temp = isNum(rawTemp) ? ` · ${rawTemp}°C` : "";
    return { text: `${gpu.Name}${temp}`, ok: true };
  }

  function formatVolumeRow(v) {
    const driveLabel = v && (v.Drive || (v.DriveLetter ? `${v.DriveLetter}:` : null)) || "Volume";
    const freeGb = v && isNum(v.FreeGB) ? v.FreeGB : (v && isNum(v.AvailableGB) ? v.AvailableGB : null);
    const actualSizeGb = v && isNum(v.SizeGB) ? v.SizeGB : (v && isNum(v.TotalGB) ? v.TotalGB : null);
    const usedPct = v && isNum(v.UsedPercent) ? v.UsedPercent : (v && isNum(v.PercentUsed) ? v.PercentUsed : null);
    const vMode = modeBadge(v && v.MeasurementMode, v && (v.CapturedAt || v.MeasuredAt));
    if (!isNum(freeGb) || !isNum(actualSizeGb)) {
      return [`Disque ${driveLabel}`, "Non mesuré"];
    }
    const pctText = isNum(usedPct) ? `${usedPct} % utilisé` : "pourcentage non mesuré";
    return [`Disque ${driveLabel}`, `${freeGb} Go libres / ${actualSizeGb} Go (${pctText}) [${vMode}]`];
  }

  function formatSystemSummary(s) {
    const os = (s && s.Os) || {};
    const cpu = (s && s.Cpu) || {};
    const gpu = (s && s.Gpu) || {};
    const mem = (s && s.Memory) || {};

    const osMode = modeBadge(os.MeasurementMode || (s && s.MeasurementMode), os.CapturedAt || (s && s.CapturedAt));
    const cpuMode = modeBadge(cpu.MeasurementMode || (s && s.MeasurementMode), cpu.CapturedAt || (s && s.CapturedAt));
    const gpuMode = modeBadge(gpu.MeasurementMode, gpu.CapturedAt || (s && s.CapturedAt));
    const memMode = modeBadge(mem.MeasurementMode || (s && s.MeasurementMode), mem.CapturedAt || (s && s.CapturedAt));

    const osText = os.Caption
      ? `${os.Caption} (${os.Version || "version non mesurée"}) [${osMode}]`
      : "Non mesuré";
    const cpuCores = isNum(cpu.Cores) ? cpu.Cores : "non mesuré";
    const cpuThreads = isNum(cpu.LogicalProcessors) ? cpu.LogicalProcessors : "non mesuré";
    const cpuText = cpu.Name
      ? `${cpu.Name} (${cpuCores} c / ${cpuThreads} t) [${cpuMode}]`
      : "Non mesuré";
    const gpuText = gpu.Name ? `${gpu.Name} [${gpuMode}]` : "Non mesuré";

    const rawTemp = isNum(gpu.TemperatureValueC)
      ? gpu.TemperatureValueC
      : (gpu.TemperatureC && isNum(gpu.TemperatureC.Value) ? gpu.TemperatureC.Value : null);
    const vramText = isNum(gpu.VramTotalMB)
      ? `${isNum(gpu.VramUsedMB) ? gpu.VramUsedMB : "non mesuré"} / ${gpu.VramTotalMB} Mo (${isNum(rawTemp) ? rawTemp + " °C" : "temp. non mesurée"})`
      : "Non mesuré";

    const memFree = isNum(mem.AvailableGB) ? mem.AvailableGB : (isNum(mem.FreeGB) ? mem.FreeGB : null);
    const memText = isNum(mem.TotalGB)
      ? `${isNum(mem.UsedGB) ? mem.UsedGB : "non mesuré"} / ${mem.TotalGB} Go (${isNum(mem.UsedPercent) ? mem.UsedPercent + " %" : "non mesuré"}, ${isNum(memFree) ? memFree + " Go libre" : "libre non mesuré"}) [${memMode}]`
      : "Non mesuré";

    return [
      ["Système", osText],
      ["Processeur", cpuText],
      ["Carte graphique", gpuText],
      ["VRAM GPU", vramText],
      ["Mémoire RAM", memText]
    ];
  }

  function normalizeProjectState(proj) {
    if (!proj || proj.attached === false) {
      return { attached: false, name: "", writable: false };
    }
    const ws = proj.workspace || proj;
    const name = proj.name || (ws && ws.name) || "";
    if (!name && proj.attached !== true) {
      return { attached: false, name: "", writable: false };
    }
    const writable = Boolean(
      proj.writable || (ws && ws.permissions && ws.permissions.write)
    );
    return {
      attached: true,
      name: name || "Projet",
      writable
    };
  }

  function normalizeProjectPermissions(proj, testPlan) {
    const base = normalizeProjectState(proj);
    if (!base.attached) {
      return {
        attached: false,
        name: "",
        writable: false,
        trustedForTests: false,
        testPlan: null
      };
    }
    const ws = (proj && proj.workspace) || proj || {};
    const perms = (proj && proj.permissions) || ws.permissions || {};
    const trusted = Boolean(
      (proj && proj.trustedForTests) ||
      perms.trustedForTests ||
      (testPlan && testPlan.trusted)
    );
    return {
      attached: true,
      name: base.name,
      writable: base.writable,
      trustedForTests: trusted,
      testPlan: testPlan || (proj && proj.testPlan) || null
    };
  }

  function formatTestExecutionOutcome(testRun) {
    if (!testRun || typeof testRun !== "object") {
      return {
        status: "NOT_RUN",
        badgeText: "Aucun test exécuté",
        ok: false
      };
    }
    const count = isNum(testRun.testsRanCount) ? testRun.testsRanCount : null;
    const summaryStr = String(testRun.summary || "");
    const zeroTests =
      count === 0 ||
      testRun.status === "NO_TESTS_RAN" ||
      /NO_TESTS_RAN|Ran 0 tests|0 tests|aucun test/i.test(summaryStr);
    if (zeroTests) {
      return {
        status: "NO_TESTS_RAN",
        badgeText: "⚠ AUCUN TEST N'A TOURNÉ (0 test)",
        ok: false
      };
    }
    if (testRun.passed === true || testRun.status === "PASSED") {
      const countLabel = isNum(count) ? ` (${count} test${count > 1 ? "s" : ""})` : "";
      return {
        status: "PASSED",
        badgeText: `✓ TESTS RÉUSSIS${countLabel}`,
        ok: true
      };
    }
    return {
      status: "FAILED",
      badgeText: `✕ ÉCHEC DES TESTS (code ${isNum(testRun.exitCode) ? testRun.exitCode : 1})`,
      ok: false
    };
  }

  function formatModelStatusBanner(statusData, selectedSlot) {
    const slot = selectedSlot || (statusData && statusData.selectedModelSlot) || "auto";
    if (statusData && statusData.gpuBusyByOtherSession) {
      return {
        state: "gpu_busy",
        dot: "danger",
        text: statusData.gpuBusyReason || "GPU occupé par une autre session (Nova/Gamma) — libère la VRAM ou attends la fin du tour."
      };
    }
    if (statusData && statusData.loadingModelSlot) {
      const loadingLabel = SLOT_NAMES[statusData.loadingModelSlot] || statusData.loadingModelSlot;
      return {
        state: "loading",
        dot: "warn",
        text: `Modèle en cours de chargement en VRAM : ${loadingLabel}…`
      };
    }
    if (slot === "auto") {
      const last = statusData && statusData.lastTurnReport;
      if (last && last.modelDisplayName) {
        return {
          state: "auto_routed",
          dot: "ok",
          text: `Auto sélectionné · ${last.modelDisplayName} choisi pour le dernier tour`
        };
      }
      return {
        state: "auto_ready",
        dot: "ok",
        text: "Auto sélectionné (Routeur P5 déterministe)"
      };
    }
    const chosenLabel = SLOT_NAMES[slot] || slot;
    return {
      state: "pinned",
      dot: "ok",
      text: `${chosenLabel} choisi pour ce tour`
    };
  }

  const SESSION_STATE_LABELS = {
    AWAITING_APPROVAL: "En attente d'approbation",
    FIXED_AND_TESTED: "Corrigé et testé",
    CHANGED_NOT_TESTED: "Appliqué · non testé",
    TESTS_STILL_FAILING: "Appliqué · tests en échec",
    REJECTED_BY_USER: "Diff rejeté",
    ASK_USER: "Précision demandée",
    NO_PROPOSAL: "Aucun diff proposé",
    ROLLED_BACK: "Annulé · original restauré",
    STOPPED: "Arrêté sans correction",
    CANCELLED: "Interrompu"
  };

  /* Libellé humain d'un état ; un code inconnu reste affiché tel quel, jamais réinterprété */
  function formatSessionState(code) {
    const key = String(code || "").trim();
    if (!key) return "En cours";
    return SESSION_STATE_LABELS[key] || key;
  }

  /* Résultat réel d'une demande de déchargement : jamais « libérée » si rien n'a été déchargé */
  function formatUnloadOutcome(resp) {
    if (!resp || resp.status !== "OK") {
      return {
        ok: false,
        title: "VRAM non libérée",
        text: (resp && resp.message) || "Le serveur n'a pas pu décharger le modèle."
      };
    }
    if (resp.unloaded) {
      const name = SLOT_NAMES[resp.previousSlot] || resp.previousSlot || "Le modèle";
      return { ok: true, title: "VRAM libérée", text: `${name} a été déchargé de la VRAM par cette fenêtre.` };
    }
    return {
      ok: true,
      title: "Aucun modèle à décharger",
      text: "Cette fenêtre n'avait aucun modèle en VRAM. Si le GPU reste occupé, libère-le depuis l'autre fenêtre Ruby (Nova ou Gamma)."
    };
  }

  function normalizeCodingSession(session) {
    if (!session || typeof session !== "object") return null;
    const rawProp = session.proposal || session.pendingProposal || session.proposedDiff || null;
    const proposal = rawProp
      ? {
          proposalId: rawProp.proposalId || "",
          round: rawProp.round || session.round || 1,
          path: rawProp.path || "",
          diagnosis: rawProp.diagnosis || session.diagnosis || "",
          diff: rawProp.diff || rawProp.unifiedDiff || "",
          baseSha256: rawProp.baseSha256 || "",
          proposedSha256: rawProp.proposedSha256 || "",
          addedLines: isNum(rawProp.addedLines) ? rawProp.addedLines : null,
          removedLines: isNum(rawProp.removedLines) ? rawProp.removedLines : null,
          warnings: Array.isArray(rawProp.warnings) ? rawProp.warnings : [],
          awaitingApproval:
            typeof rawProp.awaitingApproval === "boolean"
              ? rawProp.awaitingApproval
              : Boolean(session.proposal || session.phase === "AWAITING_APPROVAL")
        }
      : null;
    const report = session.report || null;
    const outcome = (report && report.outcome) || session.state || session.phase || "";
    const summaryText = (report && report.text) || session.finalSummary || "";
    const diagnosis = (proposal && proposal.diagnosis) || (report && report.diagnosis) || session.diagnosis || "";
    const appliedChanges = Array.isArray(session.appliedChanges) ? session.appliedChanges : [];
    const executedTests = Array.isArray(session.executedTests) ? session.executedTests : [];
    const rollbackStatus = session.rollbackStatus || {
      available: appliedChanges.length > 0 && outcome !== "ROLLED_BACK",
      hasSnapshots: appliedChanges.length > 0,
      rolledBack: outcome === "ROLLED_BACK",
      userModifiedFiles: [],
      reason: appliedChanges.length > 0 ? "READY" : "NO_SNAPSHOT"
    };
    const staleConflict = Boolean(session.staleConflict || /STALE_BASE/i.test(summaryText));

    return {
      taskId: session.taskId || "",
      phase: session.phase || "",
      round: session.round || 1,
      outcome,
      diagnosis,
      summaryText,
      proposal,
      proposedDiff: proposal,
      appliedChanges,
      executedTests,
      rollbackStatus,
      staleConflict,
      report
    };
  }

  /* ---------- Coloration syntaxique (lexicale, sans innerHTML) ---------- */
  const words = (list) => new Set(list.split(" "));
  const PY_KEYWORDS = words(
    "False None True and as assert async await break case class continue def del elif else except " +
    "finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield"
  );
  const JS_KEYWORDS = words(
    "as async await break case catch class const continue debugger default delete do else enum export " +
    "extends false finally for from function if implements import in instanceof interface let new null of " +
    "private protected public readonly return static super switch this throw true try type typeof " +
    "undefined var void while yield"
  );
  const CLIKE_KEYWORDS = words(
    "auto bool break case catch char class const continue default do double else enum extern false final " +
    "float fn for func go if impl import in int interface let long match mut namespace new nil null package " +
    "private protected pub public return short signed sizeof static struct switch this throw trait true try " +
    "type typedef union unsigned use using var virtual void volatile while"
  );
  const PS_KEYWORDS = words(
    "begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach " +
    "from function if in param process return switch throw trap try until using while"
  );
  const CONFIG_KEYWORDS = words(
    "true false null yes no if then else elif fi for do done while case esac function return export local"
  );
  const JSON_KEYWORDS = words("true false null");
  const NO_KEYWORDS = new Set();

  /* Par langage : commentaires de ligne, commentaire de bloc, chaînes, mots-clés. */
  const LANG_SPECS = {
    python: { line: ["#"], quotes: "\"'", triple: true, keywords: PY_KEYWORDS, at: true },
    js: { line: ["//"], block: ["/*", "*/"], quotes: "\"'`", multiline: "`", keywords: JS_KEYWORDS, at: true },
    clike: { line: ["//"], block: ["/*", "*/"], quotes: "\"'", keywords: CLIKE_KEYWORDS, at: true },
    json: { quotes: "\"", keywords: JSON_KEYWORDS, keys: true },
    css: { block: ["/*", "*/"], quotes: "\"'", keywords: NO_KEYWORDS, at: true, hex: true },
    html: { block: ["<!--", "-->"], quotes: "\"'", keywords: NO_KEYWORDS, tags: true },
    powershell: {
      line: ["#"], block: ["<#", "#>"], quotes: "\"'", keywords: PS_KEYWORDS, dollar: true, foldCase: true
    },
    config: { line: ["#"], quotes: "\"'", keywords: CONFIG_KEYWORDS, dollar: true },
    markdown: { quotes: "`", keywords: NO_KEYWORDS, prose: true },
    code: { line: ["//"], block: ["/*", "*/"], quotes: "\"'", keywords: NO_KEYWORDS }
  };

  const LANG_BY_EXTENSION = {
    py: "python", pyi: "python", python: "python",
    js: "js", cjs: "js", mjs: "js", jsx: "js", ts: "js", tsx: "js", javascript: "js", typescript: "js",
    json: "json", jsonl: "json", webmanifest: "json",
    css: "css", scss: "css",
    html: "html", htm: "html", xml: "html", svg: "html", xaml: "html",
    ps1: "powershell", psm1: "powershell", psd1: "powershell", powershell: "powershell", pwsh: "powershell",
    md: "markdown", markdown: "markdown",
    sh: "config", bash: "config", shell: "config", yml: "config", yaml: "config", toml: "config",
    ini: "config", cfg: "config", conf: "config", env: "config", gitignore: "config", dockerfile: "config",
    c: "clike", h: "clike", cpp: "clike", cc: "clike", hpp: "clike", cs: "clike", java: "clike",
    go: "clike", rs: "clike", kt: "clike", swift: "clike", php: "clike"
  };

  /* Accepte un chemin de fichier, une extension ou un nom de langage (bloc ```lang). */
  function detectCodeLanguage(filePathOrHint) {
    const raw = String(filePathOrHint || "").trim().toLowerCase();
    if (!raw) return "code";
    if (Object.prototype.hasOwnProperty.call(LANG_SPECS, raw)) return raw;
    const name = raw.split(/[\\/]/).pop() || "";
    const ext = name.includes(".") ? name.split(".").pop() : name;
    return LANG_BY_EXTENSION[ext] || "code";
  }

  const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
  const NUMBER_RE = /0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const OPERATOR_RE = /[=!<>+\-*/%&|^~]+/y;
  const TAG_RE = /<\/?[A-Za-z][A-Za-z0-9-]*/y;
  const HEX_RE = /#[0-9a-fA-F]{3,8}\b/y;

  function stickyMatch(re, line, index) {
    re.lastIndex = index;
    const found = re.exec(line);
    return found ? found[0] : "";
  }

  /* Rend [{ type, text }] pour une ligne. `carry` (optionnel) garde d'une ligne à
     l'autre l'état d'un commentaire de bloc ou d'une chaîne multi-ligne ouverts. */
  function tokenizeCodeLine(lineText, langHint, carry) {
    const line = String(lineText == null ? "" : lineText);
    if (!line) return [{ type: "plain", text: " " }];
    const spec = LANG_SPECS[detectCodeLanguage(langHint)];
    const memo = carry || {};
    const out = [];
    const push = (type, text) => {
      if (!text) return;
      const last = out[out.length - 1];
      if (last && last.type === type) last.text += text;
      else out.push({ type, text });
    };
    let i = 0;

    if (memo.open) {
      const end = line.indexOf(memo.open.close);
      if (end < 0) return [{ type: memo.open.type, text: line }];
      i = end + memo.open.close.length;
      push(memo.open.type, line.slice(0, i));
      memo.open = null;
    }

    if (spec.prose && i === 0) {
      if (/^\s*#{1,6}\s/.test(line)) return [{ type: "kw", text: line }];
      if (/^\s*>/.test(line)) return [{ type: "com", text: line }];
      if (/^\s*```/.test(line)) return [{ type: "dec", text: line }];
    }

    let afterDefinition = false;
    while (i < line.length) {
      const ch = line[i];

      if (spec.line && spec.line.some((mark) => line.startsWith(mark, i))) {
        push("com", line.slice(i));
        break;
      }
      if (spec.block && line.startsWith(spec.block[0], i)) {
        const end = line.indexOf(spec.block[1], i + spec.block[0].length);
        if (end < 0) {
          push("com", line.slice(i));
          memo.open = { type: "com", close: spec.block[1] };
          break;
        }
        push("com", line.slice(i, end + spec.block[1].length));
        i = end + spec.block[1].length;
        continue;
      }

      if (spec.quotes.includes(ch)) {
        const triple = spec.triple && line.startsWith(ch.repeat(3), i) ? ch.repeat(3) : "";
        if (triple) {
          const end = line.indexOf(triple, i + 3);
          if (end < 0) {
            push("str", line.slice(i));
            memo.open = { type: "str", close: triple };
            break;
          }
          push("str", line.slice(i, end + 3));
          i = end + 3;
          continue;
        }
        let j = i + 1;
        while (j < line.length && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
        if (j < line.length) {
          const text = line.slice(i, j + 1);
          const isKey = spec.keys && /^\s*:/.test(line.slice(j + 1));
          push(isKey ? "dec" : "str", text);
          i = j + 1;
          continue;
        }
        if (spec.multiline === ch) {
          push("str", line.slice(i));
          memo.open = { type: "str", close: ch };
          break;
        }
        /* Guillemet sans fermeture (apostrophe dans du texte) : caractère ordinaire. */
        push("plain", ch);
        i += 1;
        continue;
      }

      if (spec.tags && ch === "<") {
        const tag = stickyMatch(TAG_RE, line, i);
        if (tag) {
          push("dec", tag);
          i += tag.length;
          continue;
        }
      }
      if (spec.hex && ch === "#") {
        const hex = stickyMatch(HEX_RE, line, i);
        if (hex) {
          push("num", hex);
          i += hex.length;
          continue;
        }
      }
      if ((spec.at && ch === "@") || (spec.dollar && ch === "$")) {
        const name = stickyMatch(IDENT_RE, line, i + 1);
        if (name) {
          push("dec", ch + name);
          i += 1 + name.length;
          continue;
        }
      }

      if (ch >= "0" && ch <= "9") {
        const num = stickyMatch(NUMBER_RE, line, i);
        if (num) {
          push("num", num);
          i += num.length;
          continue;
        }
      }

      const ident = stickyMatch(IDENT_RE, line, i);
      if (ident) {
        const key = spec.foldCase ? ident.toLowerCase() : ident;
        if (spec.keywords.has(key)) {
          push("kw", ident);
          afterDefinition = key === "def" || key === "class" || key === "function" || key === "fn" || key === "func";
        } else if (!spec.prose && (afterDefinition || /^\s*\(/.test(line.slice(i + ident.length, i + ident.length + 8)))) {
          push("fn", ident);
          afterDefinition = false;
        } else {
          push("plain", ident);
          afterDefinition = false;
        }
        i += ident.length;
        continue;
      }

      const op = spec.prose ? "" : stickyMatch(OPERATOR_RE, line, i);
      if (op) {
        push("op", op);
        i += op.length;
        continue;
      }
      push("plain", ch);
      i += 1;
    }
    return out.length > 0 ? out : [{ type: "plain", text: line }];
  }

  /* Libellé de la puce « permissions » : résume les 3 autorisations sans les confondre. */
  function formatPermsSummary(perms) {
    if (!perms || !perms.attached) return { label: "Aucun projet", tone: "" };
    if (perms.writable && perms.trustedForTests) return { label: "Écriture + tests", tone: "tests" };
    if (perms.writable) return { label: "Écriture autorisée", tone: "write" };
    if (perms.trustedForTests) return { label: "Lecture + tests", tone: "tests" };
    return { label: "Lecture seule", tone: "" };
  }

  /* Carte affichée dans le fil après POST /api/coding start : jamais « patch prêt »
     quand la session s'est terminée sans proposition (interrompue, sans diff, en panne). */
  function describeCodingStart(session) {
    const norm = normalizeCodingSession(session);
    if (!norm) {
      return { title: "Aucune proposition", text: "Le serveur n'a renvoyé aucune session.", pills: [] };
    }
    const prop = norm.proposal;
    if (prop && prop.awaitingApproval) {
      return {
        title: `Proposition de patch prête (${norm.taskId})`,
        text: norm.diagnosis || "Vérifie le diff dans l'onglet Intervention avant d'approuver.",
        pills: prop.path ? [`FILE: ${prop.path}`, "AWAITING_APPROVAL"] : ["AWAITING_APPROVAL"]
      };
    }
    const outcome = norm.outcome || "NO_PROPOSAL";
    const fallback =
      outcome === "CANCELLED"
        ? "Génération interrompue avant toute proposition. Aucun fichier n'a été modifié."
        : "Aucune proposition de diff n'a été produite. Aucun fichier n'a été modifié.";
    return {
      title: formatSessionState(outcome),
      text: (session && session.errorMessage) || norm.summaryText || fallback,
      pills: [outcome]
    };
  }

  const gammaExports = {
    formatUnloadOutcome,
    formatSessionState,
    isNum,
    modeBadge,
    formatGpuPill,
    formatVolumeRow,
    formatSystemSummary,
    normalizeProjectState,
    normalizeProjectPermissions,
    formatTestExecutionOutcome,
    formatModelStatusBanner,
    normalizeCodingSession,
    describeCodingStart,
    formatPermsSummary,
    detectCodeLanguage,
    tokenizeCodeLine
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = gammaExports;
  }
  if (globalScope) {
    globalScope.RubyGammaUI = gammaExports;
  }
  if (typeof document === "undefined") {
    return;
  }

  const el = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const GAMMA_THEME_KEY = "ruby_gamma_theme";
  const demo = globalScope.GammaDemo;
  const narrowLayout = window.matchMedia("(max-width: 920px)");
  const recentChats = [];
  let currentChat = createChat();
  let welcomeCard = null;

  function createChat() {
    return {
      title: "",
      draft: "",
      scrollTop: 0,
      cards: document.createDocumentFragment()
    };
  }

  /* Icône issue du sprite SVG local déclaré dans gamma.html */
  function svgIcon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "i");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function formatBytes(bytes) {
    if (!isNum(bytes) || bytes < 0) return "";
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
  }

  /* Retour visuel temporaire sur un bouton-icône (sans écraser son icône) */
  function flashDone(btn) {
    const use = btn.querySelector("use");
    const prev = use ? use.getAttribute("href") : null;
    btn.classList.add("done");
    if (use) use.setAttribute("href", "#i-check");
    setTimeout(() => {
      btn.classList.remove("done");
      if (use && prev) use.setAttribute("href", prev);
    }, 1200);
  }

  function highlightCodeLine(container, lineText, langHint, carry) {
    container.textContent = "";
    const tokens = tokenizeCodeLine(lineText, langHint, carry);
    tokens.forEach((tok) => {
      if (tok.type === "plain") {
        container.appendChild(document.createTextNode(tok.text));
      } else {
        const sp = document.createElement("span");
        sp.className = `tok-${tok.type}`;
        sp.textContent = tok.text;
        container.appendChild(sp);
      }
    });
  }

  function appendGammaInlineFormatted(parent, line) {
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

  function appendGammaTextBlocks(container, chunk) {
    const paragraphs = String(chunk).trim().split(/\n{2,}/);
    paragraphs.forEach((para) => {
      const trimmed = para.trim();
      if (!trimmed) return;
      if (/^#{1,3}\s+/.test(trimmed) && !trimmed.includes("\n")) {
        const level = trimmed.match(/^(#{1,3})\s+/)[1].length;
        const tag = level === 1 ? "h2" : (level === 2 ? "h3" : "h4");
        const h = document.createElement(tag);
        appendGammaInlineFormatted(h, trimmed.replace(/^#{1,3}\s+/, ""));
        container.appendChild(h);
        return;
      }
      const lines = trimmed.split(/\r?\n/);
      if (lines.every((l) => /^\s*>\s?/.test(l))) {
        const bq = document.createElement("blockquote");
        lines.forEach((l, idx) => {
          if (idx > 0) bq.appendChild(document.createElement("br"));
          appendGammaInlineFormatted(bq, l.replace(/^\s*>\s?/, ""));
        });
        container.appendChild(bq);
        return;
      }
      if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
        const ol = document.createElement("ol");
        lines.forEach((l) => {
          const li = document.createElement("li");
          appendGammaInlineFormatted(li, l.replace(/^\s*\d+\.\s+/, ""));
          ol.appendChild(li);
        });
        container.appendChild(ol);
        return;
      }
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
        const ul = document.createElement("ul");
        lines.forEach((l) => {
          const li = document.createElement("li");
          appendGammaInlineFormatted(li, l.replace(/^\s*[-*•]\s+/, ""));
          ul.appendChild(li);
        });
        container.appendChild(ul);
        return;
      }
      const p = document.createElement("p");
      lines.forEach((l, idx) => {
        if (idx > 0) p.appendChild(document.createElement("br"));
        appendGammaInlineFormatted(p, l);
      });
      container.appendChild(p);
    });
  }

  /* Rendu Markdown sûr pour l'agent Gamma (mode Question & diagnostics) */
  function renderGammaMarkdown(container, rawText) {
    container.textContent = "";
    /* Un bloc ``` non refermé (flux en cours, sortie tronquée) s'affiche quand même en code. */
    const text = String(rawText || "");
    const fenceRe = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
    let lastIdx = 0;
    let match;

    while ((match = fenceRe.exec(text)) !== null) {
      if (match.index > lastIdx) {
        appendGammaTextBlocks(container, text.slice(lastIdx, match.index));
      }
      const lang = (match[1] || "code").trim();
      const codeContent = match[2].replace(/\n$/, "");

      const block = document.createElement("div");
      block.className = "gamma-codeblock";

      const bar = document.createElement("div");
      bar.className = "gamma-codeblock-bar";
      const langSpan = document.createElement("span");
      langSpan.textContent = lang;
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "gamma-copy-code-btn";
      copyBtn.appendChild(svgIcon("copy"));
      const copyLbl = document.createElement("span");
      copyLbl.textContent = "Copier";
      copyBtn.appendChild(copyLbl);
      copyBtn.addEventListener("click", () => {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(codeContent).catch(() => {});
        }
        flashDone(copyBtn);
      });
      bar.appendChild(langSpan);
      bar.appendChild(copyBtn);

      const pre = document.createElement("pre");
      const codeEl = document.createElement("code");
      const codeLines = codeContent.split(/\r?\n/);
      const carry = {};
      codeLines.forEach((cLine, idx) => {
        if (idx > 0) codeEl.appendChild(document.createTextNode("\n"));
        const lineSpan = document.createElement("span");
        highlightCodeLine(lineSpan, cLine, lang, carry);
        codeEl.appendChild(lineSpan);
      });
      pre.appendChild(codeEl);

      block.appendChild(bar);
      block.appendChild(pre);
      container.appendChild(block);

      lastIdx = fenceRe.lastIndex;
    }

    if (lastIdx < text.length) {
      appendGammaTextBlocks(container, text.slice(lastIdx));
    }
  }

  /* Dialogue intégré de confirmation Gamma (remplace les boîtes natives du navigateur) */
  function openGammaConfirmDialog(opts) {
    const dialog = el("gamma-confirm-dialog");
    const titleEl = el("gamma-confirm-title");
    const msgEl = el("gamma-confirm-message");
    const detailsEl = el("gamma-confirm-details");
    const submitBtn = el("gamma-confirm-submit");
    const cancelBtn = el("gamma-confirm-cancel");
    const closeBtn = el("gamma-confirm-close");
    const form = el("gamma-confirm-form");

    if (!dialog || typeof dialog.showModal !== "function") {
      /* Sans dialogue, rien n'est confirmé à la place de l'utilisateur. */
      return Promise.resolve(false);
    }
    if (titleEl) titleEl.textContent = (opts && opts.title) || "Confirmation";
    if (msgEl) msgEl.textContent = (opts && opts.message) || "";
    if (detailsEl) {
      detailsEl.textContent = "";
      const items = (opts && Array.isArray(opts.details)) ? opts.details : [];
      items.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = Array.isArray(item) ? `${item[0]} : ${item[1]}` : String(item);
        detailsEl.appendChild(li);
      });
    }
    if (submitBtn) {
      submitBtn.textContent = (opts && (opts.confirmLabel || opts.okLabel)) || "Confirmer";
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (accepted) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (dialog.open) dialog.close();
        resolve(Boolean(accepted));
      };
      const onSubmit = (ev) => {
        ev.preventDefault();
        finish(true);
      };
      const onCancel = () => finish(false);
      const cleanup = () => {
        if (form) form.removeEventListener("submit", onSubmit);
        if (cancelBtn) cancelBtn.removeEventListener("click", onCancel);
        if (closeBtn) closeBtn.removeEventListener("click", onCancel);
        dialog.removeEventListener("close", onCancel);
      };
      if (form) form.addEventListener("submit", onSubmit);
      if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
      if (closeBtn) closeBtn.addEventListener("click", onCancel);
      dialog.addEventListener("close", onCancel);
      dialog.showModal();
      if (submitBtn) submitBtn.focus();
    });
  }

  /* Thème sombre par défaut ; le choix est mémorisé sous une seule clé. */
  function applyGammaTheme(theme, persist) {
    const next = theme === "light" ? "light" : "dark";
    state.theme = next;
    document.documentElement.setAttribute("data-theme", next);
    const themeBtn = el("btn-gamma-theme");
    if (themeBtn) {
      themeBtn.setAttribute("aria-pressed", next === "light" ? "true" : "false");
      themeBtn.title = next === "light" ? "Passer au thème sombre" : "Passer au thème clair";
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", next === "light" ? "#ffffff" : "#191919");
    if (persist === false) return;
    try {
      localStorage.setItem(GAMMA_THEME_KEY, next);
    } catch (_) {
      /* stockage refusé : le thème vaut pour cette session */
    }
  }

  function restoreGammaTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(GAMMA_THEME_KEY);
    } catch (_) {
      /* stockage refusé */
    }
    applyGammaTheme(saved === "light" ? "light" : "dark", false);
  }

  function setSidebarOpen(open) {
    const app = el("gamma-app");
    if (app) app.setAttribute("data-sidebar", open ? "open" : "closed");
    const btn = el("btn-toggle-sidebar");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && narrowLayout.matches) {
      setInspectorOpen(false);
      el("btn-close-sidebar").focus();
    }
    updateDrawerFocus();
  }

  function setProjectToolsOpen(open) {
    el("gamma-project-tools").classList.toggle("hidden", !open);
    el("btn-sidebar-project").setAttribute("aria-expanded", String(open));
  }

  function setInspectorOpen(open) {
    const app = el("gamma-app");
    if (app) app.setAttribute("data-inspector", open ? "open" : "closed");
    const btn = el("btn-toggle-inspector");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && narrowLayout.matches) {
      setSidebarOpen(false);
      el("btn-close-inspector").focus();
    }
    updateDrawerFocus();
  }

  function updateDrawerFocus() {
    el("gamma-agent").inert = narrowLayout.matches &&
      (isOpen("data-sidebar") || isOpen("data-inspector"));
  }

  function isOpen(attr) {
    const app = el("gamma-app");
    return Boolean(app) && app.getAttribute(attr) !== "closed";
  }

  function setComposerMenuOpen(menuId, buttonId, open) {
    const menu = el(menuId);
    const chip = el(buttonId);
    if (!menu || !chip) return;
    menu.classList.toggle("hidden", !open);
    chip.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function openProjectMenu() {
    setComposerMenuOpen("perms-menu", "btn-perms-menu", false);
    setComposerMenuOpen("gamma-project-menu", "btn-project-menu", true);
    el("btn-attach-project").focus();
  }

  function updatePermsSummary(perms) {
    const chip = el("btn-perms-menu");
    const label = el("perms-summary");
    if (!chip || !label) return;
    const summary = formatPermsSummary(perms);
    label.textContent = summary.label;
    chip.className = "g-chip" + (summary.tone ? ` ${summary.tone}` : "");
  }

  function setThreadTitle(text) {
    const title = el("gamma-thread-title");
    if (!title) return;
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    title.textContent = clean || "Nouveau chat";
    title.title = clean;
  }

  function renderRecentChats() {
    const list = el("gamma-recents-list");
    el("gamma-recents-empty").classList.toggle("hidden", recentChats.length > 0);
    list.replaceChildren();
    for (const chat of recentChats) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "g-recent";
      button.textContent = chat.title;
      button.title = chat.title;
      if (chat === currentChat) button.setAttribute("aria-current", "true");
      button.disabled = el("btn-coding-start").disabled;
      button.addEventListener("click", () => showChat(chat));
      item.appendChild(button);
      list.appendChild(item);
    }
  }

  function showChat(chat) {
    if (chat === currentChat || el("btn-coding-start").disabled) return;
    const feed = el("gamma-agent-feed");
    const input = el("coding-objective-input");
    currentChat.draft = input.value;
    currentChat.scrollTop = feed.scrollTop;
    welcomeCard.remove();
    currentChat.cards.append(...feed.childNodes);
    currentChat = chat;
    feed.append(chat.cards);
    if (!feed.hasChildNodes()) feed.appendChild(welcomeCard);
    input.value = chat.draft;
    feed.scrollTop = chat.scrollTop;
    setComposerMenuOpen("gamma-project-menu", "btn-project-menu", false);
    setComposerMenuOpen("perms-menu", "btn-perms-menu", false);
    setThreadTitle(chat.title);
    renderRecentChats();
    if (narrowLayout.matches) setSidebarOpen(false);
    setInspectorOpen(false);
    input.focus();
  }

  async function apiGet(path) {
    return demo.request(path, {});
  }

  async function apiPost(path, body) {
    return demo.request(path, body || {});
  }

  function switchWorkbenchTab(tab, reveal = true) {
    if (reveal) setInspectorOpen(true);
    const panels = {
      code: el("wb-panel-code"),
      diff: el("wb-panel-diff"),
      system: el("wb-panel-system")
    };
    Object.keys(panels).forEach((k) => {
      if (panels[k]) panels[k].classList.toggle("hidden", k !== tab);
    });
    document.querySelectorAll(".gamma-wb-tab").forEach((btn) => {
      const isActive = btn.getAttribute("data-wb") === tab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    const codeToolbar = el("code-toolbar");
    if (codeToolbar) {
      codeToolbar.classList.toggle("hidden", tab !== "code");
    }
    if (tab === "system" && reveal) refreshStatus(false);
  }

  function appendAgentCard(role, title, text, steps) {
    const feed = el("gamma-agent-feed");
    if (!feed) return null;
    welcomeCard.remove();
    const card = document.createElement("div");
    card.className = "gamma-agent-card " + (role === "user" ? "user" : "assistant");
    const st = document.createElement("strong");
    st.textContent = title;
    card.appendChild(st);
    if (role === "user") {
      const p = document.createElement("p");
      p.textContent = String(text || "");
      card.appendChild(p);
    } else {
      const mdBox = document.createElement("div");
      mdBox.className = "gamma-md";
      renderGammaMarkdown(mdBox, text);
      card.appendChild(mdBox);
    }
    if (Array.isArray(steps) && steps.length > 0) {
      const pills = document.createElement("div");
      pills.className = "gamma-step-pills";
      steps.forEach((stepLabel) => {
        const sp = document.createElement("span");
        sp.className = "gamma-step-pill";
        sp.textContent = stepLabel;
        pills.appendChild(sp);
      });
      card.appendChild(pills);
    }
    feed.appendChild(card);
    feed.scrollTop = feed.scrollHeight;
    return card;
  }

  function updateLatencyBreakdown(timings) {
    const bar = el("gamma-latency-bar");
    if (!bar) return;
    if (!timings || !isNum(timings.totalMs)) {
      return;
    }
    bar.classList.remove("hidden");
    const tot = el("lat-total-pill");
    const load = el("lat-load-pill");
    const ctx = el("lat-ctx-pill");
    const gen = el("lat-gen-pill");
    if (tot) tot.textContent = `Total ${timings.totalMs} ms`;
    if (load) {
      const modeLbl = timings.coldStart ? "à froid" : "chaud";
      load.textContent = `GGUF ${modeLbl} ${isNum(timings.loadMs) ? timings.loadMs : 0} ms`;
    }
    if (ctx) ctx.textContent = `Contexte ${isNum(timings.contextMs) ? timings.contextMs : 0} ms`;
    if (gen) {
      const tps = isNum(timings.tokensPerSecond) && timings.tokensPerSecond > 0 ? ` (${timings.tokensPerSecond} t/s)` : "";
      gen.textContent = `Génération ${isNum(timings.generationMs) ? timings.generationMs : 0} ms${tps}`;
    }
  }

  function updateProjectBadges(proj, detectedProfiles, activeProfile, testPlan) {
    const statusPill = el("project-status-pill");
    const enableBtn = el("btn-enable-writes");
    const trustBtn = el("btn-trust-tests");
    const planBar = el("test-plan-bar");
    const planCwd = el("test-plan-cwd");
    const planProf = el("test-plan-profile");
    const planCmd = el("test-plan-cmd");
    const planBadge = el("test-plan-trust-badge");

    if (!statusPill) return;
    const perms = normalizeProjectPermissions(proj, testPlan);
    const wasAttached = state.projectAttached;
    state.projectAttached = perms.attached;
    state.writable = perms.writable;
    state.trustedForTests = perms.trustedForTests;
    state.testPlan = perms.testPlan;
    updatePermsSummary(perms);
    const label = perms.attached ? perms.name : "Choisir un projet";
    for (const id of ["sidebar-project-label", "composer-project-label"]) {
      const caption = el(id);
      caption.textContent = label;
      caption.title = (proj && proj.rootPath) || label;
    }
    el("btn-detach-project").disabled = !perms.attached;
    el("btn-project-resume").disabled = true;
    if (enableBtn) enableBtn.disabled = true;
    if (trustBtn) trustBtn.disabled = true;
    if (wasAttached && !perms.attached) setProjectToolsOpen(false);

    if (!perms.attached) {
      statusPill.textContent = "Lecture · aucun projet";
      statusPill.className = "perm";
      el("btn-run-tests").disabled = true;
      if (enableBtn) {
        enableBtn.textContent = "Écriture verrouillée";
        enableBtn.className = "perm off";
        enableBtn.setAttribute("aria-pressed", "false");
      }
      if (trustBtn) {
        trustBtn.textContent = "Tests non autorisés";
        trustBtn.className = "perm off";
        trustBtn.setAttribute("aria-pressed", "false");
      }
      if (planBar) planBar.classList.add("hidden");
      state.testProfile = null;
      return;
    }

    statusPill.textContent = `Lecture · ${perms.name}`;
    statusPill.className = "perm on";

    if (enableBtn) {
      enableBtn.textContent = perms.writable ? "Écriture autorisée" : "Écriture verrouillée";
      enableBtn.className = perms.writable ? "perm on" : "perm off";
      enableBtn.setAttribute("aria-pressed", perms.writable ? "true" : "false");
    }

    if (trustBtn) {
      trustBtn.textContent = perms.trustedForTests ? "Tests autorisés" : "Tests non autorisés";
      trustBtn.className = perms.trustedForTests ? "perm on" : "perm off";
      trustBtn.setAttribute("aria-pressed", perms.trustedForTests ? "true" : "false");
    }

    const nextProf =
      (perms.testPlan && perms.testPlan.profile) ||
      activeProfile ||
      (Array.isArray(detectedProfiles) && detectedProfiles[0]) ||
      state.testProfile ||
      null;
    state.testProfile = nextProf;
    el("btn-run-tests").disabled = !state.testProfile;
    el("btn-run-tests").title = state.testProfile || "Aucun profil de tests détecté";

    if (planBar) planBar.classList.toggle("hidden", !perms.testPlan);
    if (planBar && perms.testPlan) {
      if (planCwd) planCwd.textContent = perms.testPlan.cwd || ".";
      if (planProf) planProf.textContent = perms.testPlan.profile || "—";
      if (planCmd) planCmd.textContent = perms.testPlan.commandLine || "—";
      if (planBadge) {
        planBadge.textContent = perms.trustedForTests ? "Exécution autorisée" : "Autorisation requise";
        planBadge.className = "pill " + (perms.trustedForTests ? "ok" : "warn");
      }
    } else if (planBar) {
      planBar.classList.add("hidden");
    }
  }

  function renderBreadcrumbs(dirPath) {
    const box = el("tree-breadcrumbs");
    if (!box) return;
    box.textContent = "";
    const rootBtn = document.createElement("button");
    rootBtn.type = "button";
    rootBtn.className = "crumb-btn";
    rootBtn.appendChild(svgIcon("folder"));
    rootBtn.appendChild(document.createTextNode("racine"));
    rootBtn.addEventListener("click", () => loadProjectTree("."));
    box.appendChild(rootBtn);

    if (!dirPath || dirPath === ".") return;
    const parts = String(dirPath).split("/").filter(Boolean);
    let acc = "";
    parts.forEach((seg) => {
      acc = acc ? `${acc}/${seg}` : seg;
      const targetPath = acc;
      const sep = document.createElement("span");
      sep.textContent = "/";
      box.appendChild(sep);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "crumb-btn";
      b.textContent = seg;
      b.addEventListener("click", () => loadProjectTree(targetPath));
      box.appendChild(b);
    });
  }

  function renderTreeEntries() {
    const out = el("explorer-output");
    if (!out) return;
    out.textContent = "";
    const dirPath = state.currentDir;
    const q = state.treeFilter.trim().toLowerCase();

    if (dirPath && dirPath !== ".") {
      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "tree-item dir";
      upBtn.appendChild(svgIcon("up"));
      const upLbl = document.createElement("span");
      upLbl.textContent = "..";
      upBtn.appendChild(upLbl);
      upBtn.title = "Dossier parent";
      upBtn.addEventListener("click", () => {
        const parts = dirPath.split("/").filter(Boolean);
        parts.pop();
        loadProjectTree(parts.join("/") || ".");
      });
      out.appendChild(upBtn);
    }

    const filtered = state.currentEntries.filter((item) => {
      if (!q) return true;
      return String(item.path || "").toLowerCase().includes(q);
    });

    filtered.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const isDir = item.kind === "directory";
      const isSelected = !isDir && item.path === state.currentFile;
      btn.className = "tree-item" + (isDir ? " dir" : "") + (isSelected ? " selected" : "");
      const nameSpan = document.createElement("span");
      /* Chemin relatif au dossier courant (garde le sous-dossier des entrées imbriquées) */
      const fullPath = String(item.path || "");
      const dirPrefix = dirPath && dirPath !== "." ? `${dirPath}/` : "";
      nameSpan.textContent = dirPrefix && fullPath.startsWith(dirPrefix) ? fullPath.slice(dirPrefix.length) : fullPath;
      btn.title = String(item.path || "");
      const metaSmall = document.createElement("small");
      const fileBytes = isNum(item.size) ? item.size : (isNum(item.sizeBytes) ? item.sizeBytes : 0);
      metaSmall.textContent = isDir ? "" : formatBytes(fileBytes);
      btn.appendChild(svgIcon(isDir ? "folder" : "file"));
      btn.appendChild(nameSpan);
      btn.appendChild(metaSmall);
      btn.addEventListener("click", () => {
        if (isDir) {
          loadProjectTree(item.path);
        } else {
          openProjectFile(item.path, null, false);
        }
      });
      out.appendChild(btn);
    });

    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "gamma-empty-hint";
      empty.textContent = q ? `Aucune entrée ne correspond à « ${q} ».` : "Dossier vide.";
      out.appendChild(empty);
    }
  }

  /* Onglet actif de l'explorateur : celui dont le contenu est réellement affiché. */
  function setExplorerView(view) {
    const tabs = { tree: "btn-tree-root", status: "btn-git-status", diff: "btn-git-diff", log: "btn-git-log" };
    Object.keys(tabs).forEach((key) => {
      const btn = el(tabs[key]);
      if (!btn) return;
      btn.classList.toggle("active", key === view);
      btn.setAttribute("aria-selected", key === view ? "true" : "false");
    });
  }

  async function loadProjectTree(dirPath) {
    const out = el("explorer-output");
    if (!out) return;
    setExplorerView("tree");
    const target = dirPath || ".";
    const resp = await apiPost("/api/project", { action: "tree", path: target });
    if (!resp || resp.status !== "OK" || !resp.tree) {
      out.textContent = "";
      const p = document.createElement("p");
      p.className = "gamma-empty-hint";
      p.textContent = (resp && resp.message) || "Impossible de lire l'arborescence.";
      out.appendChild(p);
      return;
    }
    state.currentDir = target;
    state.currentEntries = Array.isArray(resp.tree.entries) ? resp.tree.entries : [];
    renderBreadcrumbs(target);
    renderTreeEntries();
  }

  async function openProjectFile(filePath, highlightLine, fullFile) {
    const title = el("viewer-title");
    const meta = el("viewer-meta");
    const loadFullBtn = el("btn-load-full-file");
    const contentBox = el("file-viewer-content");
    if (!contentBox) return;
    switchWorkbenchTab("code");
    const maxLine = fullFile ? 2500 : 400;
    const startLine = highlightLine && highlightLine > 350 && !fullFile ? Math.max(1, highlightLine - 60) : 1;
    const endLine = startLine + maxLine;

    const resp = await apiPost("/api/project", {
      action: "read",
      path: filePath,
      start_line: startLine,
      end_line: endLine
    });
    if (!resp || resp.status !== "OK" || !resp.file) {
      contentBox.textContent = (resp && resp.message) || "Erreur de lecture du fichier.";
      return;
    }
    const f = resp.file;
    state.currentFile = f.path;
    state.currentFileRaw = String(f.content || "");
    state.currentFileTotalLines = isNum(f.totalLines) ? f.totalLines : 0;
    if (title) title.textContent = f.path;
    if (meta) {
      meta.textContent = `L${f.startLine}-${f.endLine}/${f.totalLines} · ${f.encoding} · ${f.lineEnding}`;
      meta.className = "pill " + (f.lineEnding === "MIXED" ? "warn" : "ok");
    }
    if (loadFullBtn) {
      const hasMore = isNum(f.totalLines) && isNum(f.endLine) && f.endLine < f.totalLines;
      loadFullBtn.classList.toggle("hidden", !hasMore);
      if (hasMore) {
        loadFullBtn.title = `Charger tout le fichier (${f.totalLines} lignes)`;
      }
    }

    contentBox.textContent = "";
    const lines = state.currentFileRaw.split(/\r?\n/);
    const lang = detectCodeLanguage(f.path);
    const carry = {};
    let targetEl = null;
    lines.forEach((line, i) => {
      const lineNum = f.startLine + i;
      const span = document.createElement("span");
      span.className = "code-line" + (highlightLine === lineNum ? " highlight" : "");
      const ln = document.createElement("span");
      ln.className = "ln";
      ln.textContent = String(lineNum);
      const lc = document.createElement("span");
      lc.className = "lc";
      highlightCodeLine(lc, line, lang, carry);
      span.appendChild(ln);
      span.appendChild(lc);
      contentBox.appendChild(span);
      if (highlightLine === lineNum) {
        targetEl = span;
      }
    });
    if (targetEl && typeof targetEl.scrollIntoView === "function") {
      targetEl.scrollIntoView({ block: "center" });
    }
    if (state.currentEntries.length > 0) {
      renderTreeEntries();
    }
  }

  async function runProjectSearch() {
    const input = el("project-search-input");
    const out = el("explorer-output");
    if (!input || !out) return;
    const q = input.value.trim();
    if (!q) return;
    setExplorerView("search");
    const resp = await apiPost("/api/project", { action: "search", query: q });
    out.textContent = "";
    if (!resp || resp.status !== "OK") {
      out.textContent = (resp && resp.message) || "Erreur lors de la recherche.";
      return;
    }
    const results = (resp.search && Array.isArray(resp.search.results)) ? resp.search.results : [];
    const defs = (resp.references && Array.isArray(resp.references.definitions)) ? resp.references.definitions : [];
    defs.forEach((d) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tree-item dir";
      btn.appendChild(svgIcon("star"));
      const defName = document.createElement("span");
      defName.textContent = d.name;
      const defLoc = document.createElement("small");
      defLoc.textContent = `${d.path}:${d.line}`;
      btn.appendChild(defName);
      btn.appendChild(defLoc);
      btn.addEventListener("click", () => openProjectFile(d.path, d.line, false));
      out.appendChild(btn);
    });
    results.forEach((hit) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tree-item";
      btn.className = "tree-item hit";
      const left = document.createElement("span");
      left.textContent = `${hit.path}:${hit.line}`;
      const right = document.createElement("small");
      right.textContent = String(hit.snippet || "").trim().slice(0, 80);
      btn.appendChild(left);
      btn.appendChild(right);
      btn.addEventListener("click", () => openProjectFile(hit.path, hit.line, false));
      out.appendChild(btn);
    });
    if (defs.length === 0 && results.length === 0) {
      out.textContent = "Aucun résultat trouvé.";
    }
  }

  function renderColorizedDiff(diffText) {
    const pre = document.createElement("pre");
    pre.className = "diff-box";
    const lines = String(diffText || "").split(/\r?\n/);
    lines.forEach((line) => {
      const span = document.createElement("span");
      let cls = "diff-line";
      if (line.startsWith("+") && !line.startsWith("+++")) cls += " add";
      else if (line.startsWith("-") && !line.startsWith("---")) cls += " del";
      else if (line.startsWith("@@")) cls += " hunk";
      span.className = cls;
      span.textContent = line;
      pre.appendChild(span);
    });
    return pre;
  }

  async function runGitCommand(sub) {
    const out = el("explorer-output");
    if (!out) return;
    setExplorerView(sub);
    const resp = await apiPost("/api/project", { action: "git", sub });
    out.textContent = "";
    if (!resp || resp.status !== "OK" || !resp.git) {
      out.textContent = (resp && resp.message) || "Commande Git indisponible.";
      return;
    }
    const g = resp.git;
    if (sub === "status") {
      const head = document.createElement("div");
      head.className = "g-tree-note";
      head.textContent = `Branche : ${g.branch || "?"} (${g.tracking || "local"})`;
      out.appendChild(head);
      const changed = Array.isArray(g.entries) ? g.entries : [];
      if (changed.length === 0) {
        const clean = document.createElement("div");
        clean.className = "g-tree-note ok";
        clean.textContent = "✓ Arbre de travail propre.";
        out.appendChild(clean);
      } else {
        changed.forEach((entry) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "tree-item";
          const s1 = document.createElement("span");
          s1.textContent = `${entry.indexStatus || ""}${entry.worktreeStatus || ""} ${entry.path}`;
          const s2 = document.createElement("small");
          s2.textContent = "modifié";
          b.appendChild(s1);
          b.appendChild(s2);
          b.addEventListener("click", () => openProjectFile(entry.path, null, false));
          out.appendChild(b);
        });
      }
    } else if (sub === "diff") {
      out.appendChild(renderColorizedDiff(g.diff || "(Aucun diff en cours)"));
    } else if (sub === "log") {
      const commits = Array.isArray(g.commits) ? g.commits : [];
      commits.forEach((c) => {
        const d = document.createElement("div");
        d.className = "tree-item";
        const s1 = document.createElement("span");
        s1.textContent = `${String(c.commit || "").slice(0, 8)} — ${c.subject || ""}`;
        const s2 = document.createElement("small");
        s2.textContent = String(c.authorDate || "").slice(0, 10);
        d.appendChild(s1);
        d.appendChild(s2);
        out.appendChild(d);
      });
    }
  }

  function renderSessionTasksFooter() {
    const box = el("session-tasks-box");
    if (!box) return;
    if (!Array.isArray(state.sessionTasks) || state.sessionTasks.length === 0) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    box.textContent = "";
    const lbl = document.createElement("strong");
    lbl.textContent = "Tâches de la session";
    box.appendChild(lbl);
    state.sessionTasks.slice(-6).reverse().forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gamma-mini-btn" + (t.taskId === state.activeTaskId ? " active" : "");
      btn.textContent = `${t.taskId} · ${formatSessionState(t.outcome || t.state || t.phase)}`;
      btn.addEventListener("click", () => {
        state.activeTaskId = t.taskId;
        renderCodingSession(t);
      });
      box.appendChild(btn);
    });
  }

  async function triggerRollbackForTask(taskId) {
    const box = el("coding-output");
    if (!taskId) {
      if (box) box.textContent = "Aucune tâche active à annuler dans cette session.";
      return;
    }
    const resp = await apiPost("/api/coding", { action: "rollback", task_id: taskId });
    if (resp && resp.status === "OK") {
      appendAgentCard(
        "assistant",
        "Retour arrière effectué (Rollback)",
        `Fichiers restaurés à l'octet près pour la tâche ${taskId}.`,
        resp.restored || []
      );
      if (resp.session) {
        renderCodingSession(resp.session);
      } else if (box) {
        box.textContent = `✓ Retour arrière effectué pour la tâche ${taskId}. Fichiers restaurés : ${(resp.restored || []).join(", ")}`;
      }
      if (state.currentFile) openProjectFile(state.currentFile, null, false);
    } else {
      const errMsg = (resp && resp.message) || "Retour arrière refusé.";
      appendAgentCard("assistant", "Rollback refusé (Protection des modifications)", errMsg, ["SNAPSHOT_CONFLICT"]);
      if (box) {
        const alertP = document.createElement("div");
        alertP.className = "gamma-ledger-card";
        alertP.textContent = `⚠ ${errMsg}`;
        box.prepend(alertP);
      }
    }
  }

  /* Rendu incontestable en 4 sections séparées :
   * 1. Diff proposé
   * 2. Modification appliquée (SHA-256 avant -> après + intégrité disque)
   * 3. Tests exécutés (commande exacte, dossier, nombre de tests, statut honnête)
   * 4. Retour arrière disponible (avec détection de conflit STALE_BASE ou retouche utilisateur)
   */
  function renderCodingSession(rawSession, reveal = true) {
    const box = el("coding-output");
    const badge = el("diff-pending-badge");
    const rollbackToolbarBtn = el("btn-rollback-last");
    const session = normalizeCodingSession(rawSession);
    if (!box || !session) return;
    box.textContent = "";
    state.activeTaskId = session.taskId || state.activeTaskId;
    switchWorkbenchTab("diff", reveal);

    /* En-tête de l'intervention */
    const header = document.createElement("div");
    header.className = "gamma-ledger-header";
    const headLeft = document.createElement("div");
    const st = document.createElement("strong");
    st.textContent = `Intervention ${session.taskId || ""} · Tour ${session.round || 1}`;
    headLeft.appendChild(st);
    if (session.diagnosis) {
      const diag = document.createElement("div");
      diag.className = "g-ledger-diag";
      diag.textContent = `Diagnostic : ${session.diagnosis}`;
      headLeft.appendChild(diag);
    }
    const stateBadge = document.createElement("span");
    /* Vert uniquement quand la correction a été réellement testée */
    const isGreen = session.outcome === "FIXED_AND_TESTED";
    const isRed = session.staleConflict || session.outcome === "TESTS_STILL_FAILING";
    stateBadge.className = "pill " + (isGreen ? "ok" : (isRed ? "danger" : "warn"));
    stateBadge.textContent = formatSessionState(session.outcome || session.phase);
    stateBadge.title = session.outcome || session.phase || "";
    header.appendChild(headLeft);
    header.appendChild(stateBadge);
    box.appendChild(header);

    const sectionsWrap = document.createElement("div");
    sectionsWrap.className = "gamma-ledger-sections";

    const proposal = session.proposedDiff;
    const isPendingApproval = Boolean(proposal && proposal.awaitingApproval && session.phase === "AWAITING_APPROVAL");
    if (badge) {
      badge.classList.toggle("hidden", !isPendingApproval);
    }

    /* =========================================================================
     * SECTION 1 : DIFF PROPOSÉ
     * ========================================================================= */
    const sec1 = document.createElement("div");
    sec1.className = "gamma-ledger-card";
    const sec1Head = document.createElement("div");
    sec1Head.className = "gamma-ledger-card-head";
    const sec1Title = document.createElement("strong");
    sec1Title.textContent = "Diff proposé";
    const sec1Badge = document.createElement("span");
    sec1Badge.className = "pill " + (isPendingApproval ? "warn" : (proposal ? "ok" : ""));
    sec1Badge.textContent = isPendingApproval
      ? "En attente d'approbation"
      : (proposal ? `Proposition ${proposal.proposalId}` : "Aucun diff");
    sec1Head.appendChild(sec1Title);
    sec1Head.appendChild(sec1Badge);
    sec1.appendChild(sec1Head);

    if (proposal && proposal.diff) {
      const metaRow = document.createElement("div");
      metaRow.className = "gamma-proposal-meta";
      if (proposal.path) {
        const fileBtn = document.createElement("button");
        fileBtn.type = "button";
        fileBtn.className = "gamma-mini-btn";
        fileBtn.appendChild(svgIcon("file"));
        fileBtn.appendChild(document.createTextNode(proposal.path));
        fileBtn.addEventListener("click", () => openProjectFile(proposal.path, null, false));
        metaRow.appendChild(fileBtn);
      }
      if (isNum(proposal.addedLines)) {
        const addSpan = document.createElement("span");
        addSpan.className = "diff-stat-add";
        addSpan.textContent = `+${proposal.addedLines}`;
        metaRow.appendChild(addSpan);
      }
      if (isNum(proposal.removedLines)) {
        const delSpan = document.createElement("span");
        delSpan.className = "diff-stat-del";
        delSpan.textContent = `-${proposal.removedLines}`;
        metaRow.appendChild(delSpan);
      }
      if (proposal.baseSha256) {
        const shaSmall = document.createElement("small");
        shaSmall.className = "g-muted";
        shaSmall.textContent = `Base SHA-256 : ${String(proposal.baseSha256).slice(0, 12)}…`;
        metaRow.appendChild(shaSmall);
      }
      sec1.appendChild(metaRow);

      proposal.warnings.forEach((w) => {
        const warnP = document.createElement("p");
        warnP.className = "g-ledger-text warn";
        warnP.textContent = `⚠ ${w}`;
        sec1.appendChild(warnP);
      });

      sec1.appendChild(renderColorizedDiff(proposal.diff));

      if (isPendingApproval) {
        const actRow = document.createElement("div");
        actRow.className = "gamma-approval-actions";

        const approveTestBtn = document.createElement("button");
        approveTestBtn.type = "button";
        approveTestBtn.className = "gamma-btn primary";
        approveTestBtn.disabled = true;
        const planCmdText = (state.testPlan && state.testPlan.commandLine) || state.testProfile || "tests";
        const canRunTests = Boolean(state.testProfile && state.trustedForTests);
        approveTestBtn.textContent = "Aperçu en lecture seule";
        if (canRunTests) {
          approveTestBtn.title = `Applique le diff puis exécute : ${planCmdText}`;
        }
        approveTestBtn.addEventListener("click", async () => {
          approveTestBtn.disabled = true;
          approveTestBtn.textContent = "Application du diff…";
          const resp = await apiPost("/api/coding", {
            action: "approve",
            task_id: session.taskId,
            proposal_id: proposal.proposalId,
            run_tests: canRunTests,
            require_trust: true
          });
          if (resp && resp.status === "OK" && resp.session) {
            const normAfter = normalizeCodingSession(resp.session);
            renderCodingSession(resp.session);
            appendAgentCard(
              "assistant",
              "Intervention terminée",
              (normAfter && normAfter.summaryText) || `État : ${normAfter ? normAfter.outcome : "DONE"}`,
              ["WRITE_APPROVED", (normAfter && normAfter.outcome) || "DONE"]
            );
            if (state.currentFile) openProjectFile(state.currentFile, null, false);
            refreshStatus(false);
          } else {
            box.textContent = (resp && resp.message) || "Erreur lors de l'application du diff.";
          }
        });
        actRow.appendChild(approveTestBtn);

        if (canRunTests) {
          const approveOnlyBtn = document.createElement("button");
          approveOnlyBtn.type = "button";
          approveOnlyBtn.className = "gamma-btn ok-outline";
          approveOnlyBtn.textContent = "Approuver sans tests";
          approveOnlyBtn.addEventListener("click", async () => {
            approveOnlyBtn.disabled = true;
            const resp = await apiPost("/api/coding", {
              action: "approve",
              task_id: session.taskId,
              proposal_id: proposal.proposalId,
              run_tests: false
            });
            if (resp && resp.status === "OK" && resp.session) {
              renderCodingSession(resp.session);
              if (state.currentFile) openProjectFile(state.currentFile, null, false);
              refreshStatus(false);
            }
          });
          actRow.appendChild(approveOnlyBtn);
        }

        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "gamma-btn danger-outline";
        rejectBtn.textContent = "Rejeter";
        rejectBtn.addEventListener("click", async () => {
          const resp = await apiPost("/api/coding", {
            action: "reject",
            task_id: session.taskId,
            proposal_id: proposal.proposalId
          });
          if (resp && resp.status === "OK" && resp.session) {
            renderCodingSession(resp.session);
          }
        });
        actRow.appendChild(rejectBtn);
        sec1.appendChild(actRow);
      }
    } else {
      const noProp = document.createElement("p");
      noProp.className = "g-ledger-text";
      noProp.textContent = session.summaryText || "Aucun diff proposé pour cette tâche.";
      sec1.appendChild(noProp);
    }
    sectionsWrap.appendChild(sec1);

    /* =========================================================================
     * SECTION 2 : MODIFICATION APPLIQUÉE (SHA-256 & Intégrité Disque)
     * ========================================================================= */
    const sec2 = document.createElement("div");
    sec2.className = "gamma-ledger-card";
    const sec2Head = document.createElement("div");
    sec2Head.className = "gamma-ledger-card-head";
    const sec2Title = document.createElement("strong");
    sec2Title.textContent = "Modification appliquée sur disque";
    const sec2Badge = document.createElement("span");
    if (session.staleConflict) {
      sec2Badge.className = "pill danger";
      sec2Badge.textContent = "✕ Refusé : fichier modifié entre-temps (STALE_BASE)";
    } else if (session.appliedChanges.length > 0) {
      sec2Badge.className = "pill ok";
      sec2Badge.textContent = `✓ ${session.appliedChanges.length} fichier(s) écrit(s)`;
    } else {
      sec2Badge.className = "pill";
      sec2Badge.textContent = "Aucune écriture disque";
    }
    sec2Head.appendChild(sec2Title);
    sec2Head.appendChild(sec2Badge);
    sec2.appendChild(sec2Head);

    if (session.staleConflict) {
      const staleBox = document.createElement("div");
      staleBox.className = "g-ledger-text danger";
      staleBox.textContent =
        "Le fichier cible a changé sur le disque entre la prévisualisation du diff et ton approbation. Pour protéger ton travail, aucune écriture n'a été effectuée.";
      const regenDiffBtn = document.createElement("button");
      regenDiffBtn.type = "button";
      regenDiffBtn.className = "gamma-btn primary sm";
      regenDiffBtn.textContent = "Reprendre la demande de patch";
      const objective = state.taskObjectives.get(session.taskId);
      regenDiffBtn.disabled = !objective;
      regenDiffBtn.addEventListener("click", () => {
        const input = el("coding-objective-input");
        const mode = el("gamma-mode-select");
        mode.value = "patch";
        state.agentMode = "patch";
        input.value = objective;
        if (narrowLayout.matches) setInspectorOpen(false);
        input.focus();
      });
      sec2.appendChild(staleBox);
      sec2.appendChild(regenDiffBtn);
    } else if (session.appliedChanges.length > 0) {
      session.appliedChanges.forEach((ch) => {
        const row = document.createElement("div");
        row.className = "gamma-sha-row";
        const left = document.createElement("span");
        left.textContent = `${ch.path} · SHA-256 : ${String(ch.beforeSha256 || "").slice(0, 10)}… → ${String(ch.afterSha256 || "").slice(0, 10)}…`;
        const right = document.createElement("span");
        if (ch.userModifiedSinceWrite) {
          right.className = "pill warn";
          right.textContent = "⚠ Retouché par l'utilisateur après écriture";
        } else {
          right.className = "pill ok";
          right.textContent = "✓ Intègre sur disque";
        }
        row.appendChild(left);
        row.appendChild(right);
        sec2.appendChild(row);
      });
    } else {
      const p2 = document.createElement("p");
      p2.className = "g-ledger-text";
      p2.textContent = isPendingApproval
        ? "En attente de ton approbation — aucun octet n'a encore été modifié sur le disque."
        : "Aucun fichier n'a été modifié durant cette intervention.";
      sec2.appendChild(p2);
    }
    sectionsWrap.appendChild(sec2);

    /* =========================================================================
     * SECTION 3 : TESTS EXÉCUTÉS
     * ========================================================================= */
    const sec3 = document.createElement("div");
    sec3.className = "gamma-ledger-card";
    const sec3Head = document.createElement("div");
    sec3Head.className = "gamma-ledger-card-head";
    const sec3Title = document.createElement("strong");
    sec3Title.textContent = "Tests exécutés";
    const lastTest = session.executedTests.length > 0 ? session.executedTests[session.executedTests.length - 1] : null;
    const testOutcome = formatTestExecutionOutcome(lastTest);
    const sec3Badge = document.createElement("span");
    sec3Badge.className =
      "pill " +
      (testOutcome.status === "PASSED"
        ? "ok"
        : testOutcome.status === "NO_TESTS_RAN" || testOutcome.status === "FAILED"
        ? "danger"
        : "");
    sec3Badge.textContent = testOutcome.badgeText;
    sec3Head.appendChild(sec3Title);
    sec3Head.appendChild(sec3Badge);
    sec3.appendChild(sec3Head);

    if (lastTest) {
      const metaTest = document.createElement("div");
      metaTest.className = "gamma-sha-row";
      const testParts = [
        `Dossier : ${lastTest.cwd || "."}`,
        `Profil : ${lastTest.profile || "—"}`,
        `Commande : ${lastTest.commandLine || "—"}`
      ];
      if (isNum(lastTest.exitCode)) testParts.push(`Code retour : ${lastTest.exitCode}`);
      if (isNum(lastTest.durationMs)) testParts.push(`Durée : ${Math.round(lastTest.durationMs)} ms`);
      metaTest.textContent = testParts.join(" │ ");
      sec3.appendChild(metaTest);
      if (lastTest.outputTail) {
        const outPre = document.createElement("pre");
        outPre.className = "diff-box";
        outPre.textContent = lastTest.outputTail;
        sec3.appendChild(outPre);
      }
    } else {
      const p3 = document.createElement("p");
      p3.className = "g-ledger-text";
      p3.textContent = state.testPlan
        ? `Aucun test lancé pour l'instant. Plan prêt : « ${state.testPlan.commandLine} » dans « ${state.testPlan.cwd} ».`
        : "Aucun test n'a été exécuté durant cette tâche.";
      sec3.appendChild(p3);
    }
    sectionsWrap.appendChild(sec3);

    /* =========================================================================
     * SECTION 4 : RETOUR ARRIÈRE DISPONIBLE (ROLLBACK)
     * ========================================================================= */
    const sec4 = document.createElement("div");
    sec4.className = "gamma-ledger-card";
    const sec4Head = document.createElement("div");
    sec4Head.className = "gamma-ledger-card-head";
    const sec4Title = document.createElement("strong");
    sec4Title.textContent = "Retour arrière";
    const rb = session.rollbackStatus || {};
    const sec4Badge = document.createElement("span");

    if (rb.rolledBack) {
      sec4Badge.className = "pill ok";
      sec4Badge.textContent = "✓ Annulé · Fichier original restauré";
    } else if (Array.isArray(rb.userModifiedFiles) && rb.userModifiedFiles.length > 0) {
      sec4Badge.className = "pill warn";
      sec4Badge.textContent = "Bloqué : retouche utilisateur détectée";
    } else if (rb.available) {
      sec4Badge.className = "pill ok";
      sec4Badge.textContent = "↺ Instantané prêt à restaurer";
    } else {
      sec4Badge.className = "pill";
      sec4Badge.textContent = "Aucun instantané à annuler";
    }
    sec4Head.appendChild(sec4Title);
    sec4Head.appendChild(sec4Badge);
    sec4.appendChild(sec4Head);

    const p4 = document.createElement("p");
    p4.className = "g-ledger-text";
    if (rb.rolledBack) {
      p4.textContent = "L'instantané SHA-256 d'origine a été restauré avec succès.";
    } else if (Array.isArray(rb.userModifiedFiles) && rb.userModifiedFiles.length > 0) {
      p4.textContent = `Tu as modifié manuellement ${rb.userModifiedFiles.join(", ")} après l'écriture de Gamma. Pour ne jamais écraser tes propres retouches, l'annulation automatique est désactivée.`;
    } else if (rb.available) {
      p4.textContent = "Un instantané complet d'avant-modification est disponible. Tu peux restaurer le fichier original à l'octet près en un clic.";
    } else {
      p4.textContent = "Aucune modification disque active à annuler.";
    }
    sec4.appendChild(p4);

    if (rb.available) {
      const rbInlineBtn = document.createElement("button");
      rbInlineBtn.type = "button";
      rbInlineBtn.className = "gamma-btn danger-outline";
      rbInlineBtn.textContent = `↺ Annuler la tâche ${session.taskId} et restaurer l'original`;
      rbInlineBtn.addEventListener("click", () => triggerRollbackForTask(session.taskId));
      sec4.appendChild(rbInlineBtn);
    }

    if (rollbackToolbarBtn) {
      rollbackToolbarBtn.disabled = !rb.available;
    }

    sectionsWrap.appendChild(sec4);
    box.appendChild(sectionsWrap);
  }

  function renderSystemView(data) {
    const summaryBox = el("sys-summary-box");
    const volumesBox = el("sys-volumes-box");
    const modelsBox = el("models-box");
    const probeLabel = el("sys-probe-age-label");
    if (!summaryBox || !volumesBox || !modelsBox) return;

    const hw = (data && data.hardware) || {};
    const s = hw.summary || {};
    const rows = formatSystemSummary(s);

    if (probeLabel) {
      const ageSec = isNum(s.AgeSeconds) ? s.AgeSeconds : null;
      const modeStr = s.Cached ? "Cache non-bloquant" : "Mesure directe";
      probeLabel.textContent = isNum(ageSec)
        ? `Dernière sonde il y a ${ageSec} s (${modeStr}) — le chat et l'annulation ne sont jamais bloqués.`
        : "Sonde matérielle prête.";
    }

    summaryBox.textContent = "";
    rows.forEach(([k, v]) => {
      const r = document.createElement("div");
      r.className = "metric-row";
      const st = document.createElement("strong");
      st.textContent = k;
      const sp = document.createElement("span");
      sp.textContent = String(v);
      r.appendChild(st);
      r.appendChild(sp);
      summaryBox.appendChild(r);
    });

    volumesBox.textContent = "";
    const vols = (hw.storage && Array.isArray(hw.storage.Volumes)) ? hw.storage.Volumes : [];
    vols.forEach((v) => {
      const [label, value] = formatVolumeRow(v);
      const r = document.createElement("div");
      r.className = "metric-row";
      const st = document.createElement("strong");
      st.textContent = label;
      const sp = document.createElement("span");
      sp.textContent = value;
      r.appendChild(st);
      r.appendChild(sp);
      volumesBox.appendChild(r);
    });

    modelsBox.textContent = "";
    const models = Array.isArray(data.models) ? data.models : [];
    models.forEach((m) => {
      const r = document.createElement("div");
      r.className = "metric-row";
      const st = document.createElement("strong");
      st.textContent = m.displayName || m.name;
      const sp = document.createElement("span");
      sp.textContent = `${m.sizeGB || 0} Go · ${m.loaded ? "Chargé en VRAM ✓" : (m.available ? "Prêt" : "Absent")}`;
      r.appendChild(st);
      r.appendChild(sp);
      modelsBox.appendChild(r);
    });
  }

  async function refreshStatus(forceRefresh) {
    const statusPill = el("status-pill");
    const probePill = el("probe-age-pill");
    const modelDot = el("gamma-model-dot");
    const modelText = el("gamma-model-state-text");

    try {
      const url = forceRefresh ? "/api/status?refresh=1" : "/api/status";
      const data = await apiGet(url);
      if (!data || !data.online) throw new Error("Gamma hors ligne");
      if (statusPill) {
        statusPill.textContent = "Gamma local";
        statusPill.className = "status-item ok";
      }
      const s = (data && data.hardware && data.hardware.summary) || {};
      if (probePill) {
        const age = isNum(s.AgeSeconds) ? `${Math.round(s.AgeSeconds)}s` : "0s";
        probePill.textContent = `Sonde ${age} · ${s.Cached ? "cache" : "direct"}`;
      }

      if (modelDot) modelDot.className = "dot ok";
      if (modelText) modelText.textContent = "Démo publique";

      if (data.lastTurnTimings) updateLatencyBreakdown(data.lastTurnTimings);

      if (Array.isArray(data.tasks)) {
        state.sessionTasks = data.tasks;
        renderSessionTasksFooter();
      }
      updateProjectBadges(data.project, data.detectedProfiles, data.activeTestProfile, data.testPlan);
      renderSystemView(data);
    } catch (_) {
      if (statusPill) {
        statusPill.textContent = "Gamma hors ligne";
        statusPill.className = "status-item";
      }
      if (modelDot) modelDot.className = "dot warn";
      if (modelText) modelText.textContent = "Gamma hors ligne";
    }
  }

  async function executeAgentAction() {
    const input = el("coding-objective-input");
    const btn = el("btn-coding-start");
    const modelDot = el("gamma-model-dot");
    const modelText = el("gamma-model-state-text");
    if (!input || !btn || btn.disabled) return;
    const obj = input.value.trim();
    if (!obj) return;
    if (state.agentMode === "patch" && !state.projectAttached) {
      openProjectMenu();
      return;
    }
    input.value = "";
    if (!currentChat.title) {
      currentChat.title = obj.replace(/\s+/g, " ").slice(0, 90);
      setThreadTitle(currentChat.title);
    }
    const previousIndex = recentChats.indexOf(currentChat);
    if (previousIndex !== -1) recentChats.splice(previousIndex, 1);
    recentChats.unshift(currentChat);
    recentChats.length = Math.min(recentChats.length, 20);
    btn.disabled = true;
    el("btn-new-task").disabled = true;
    renderRecentChats();
    appendAgentCard("user", "Instruction Ingénieur", obj);

    setComposerMenuOpen("gamma-project-menu", "btn-project-menu", false);
    setComposerMenuOpen("perms-menu", "btn-perms-menu", false);
    if (modelDot) modelDot.className = "dot ok";
    if (modelText) modelText.textContent = "Réponse simulée";

    try {
      if (state.agentMode === "ask") {
        appendAgentCard("assistant", "Réponse simulée", demo.reply(obj));
      } else {
        const progress = appendAgentCard("assistant", "Patch", "Préparation du diff…");
        let resp;
        try {
          resp = await apiPost("/api/coding", {
            action: "start",
            objective: obj,
            model_slot: state.selectedModelSlot
          });
        } finally {
          if (progress) progress.remove();
        }
        if (!resp || resp.status !== "OK") {
          const errMsg = (resp && resp.message) || "Impossible de lancer l'agent de code.";
          appendAgentCard("assistant", "Refusé", errMsg, [resp && resp.reason ? resp.reason : "REFUSED"]);
          return;
        }
        const card = describeCodingStart(resp.session);
        const message = appendAgentCard("assistant", card.title, card.text, card.pills);
        const session = normalizeCodingSession(resp.session);
        if (message && session && session.taskId) {
          if (state.taskObjectives.size >= 50) {
            state.taskObjectives.delete(state.taskObjectives.keys().next().value);
          }
          state.taskObjectives.set(session.taskId, obj);
          const openDiff = document.createElement("button");
          openDiff.type = "button";
          openDiff.className = "gamma-btn sm g-open-diff";
          openDiff.textContent = session.proposal?.awaitingApproval ? "Examiner le diff" : "Voir l’intervention";
          openDiff.addEventListener("click", () => {
            const latest = state.sessionTasks.find((task) => task.taskId === session.taskId);
            renderCodingSession(latest || resp.session);
          });
          message.appendChild(openDiff);
        }
        renderCodingSession(resp.session, false);
      }
    } catch (_) {
      appendAgentCard("assistant", "Erreur de connexion", "La demande a échoué. Vérifie que Gamma fonctionne avant de réessayer.");
    } finally {
      btn.disabled = false;
      el("btn-new-task").disabled = false;
      renderRecentChats();
      refreshStatus(false);
    }
  }

  function wireArrowKeyGroup(selector) {
    const items = Array.from(document.querySelectorAll(selector)).filter((btn) => !btn.classList.contains("hidden"));
    items.forEach((btn, idx) => {
      btn.addEventListener("keydown", (ev) => {
        if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
        ev.preventDefault();
        const delta = ev.key === "ArrowRight" ? 1 : -1;
        const nextIdx = (idx + delta + items.length) % items.length;
        const target = items[nextIdx];
        if (target) {
          target.focus();
          target.click();
        }
      });
    });
  }

  function wireEvents() {
    restoreGammaTheme();
    if (narrowLayout.matches) setSidebarOpen(false);
    narrowLayout.addEventListener("change", () => {
      if (narrowLayout.matches && isOpen("data-inspector")) {
        setInspectorOpen(true);
      } else if (narrowLayout.matches && isOpen("data-sidebar")) {
        setSidebarOpen(true);
      } else {
        updateDrawerFocus();
      }
    });

    const feedBox = el("gamma-agent-feed");
    welcomeCard = feedBox ? feedBox.querySelector(".gamma-agent-card.welcome") : null;
    for (const [id, mode, prompt] of [
      ["demo-question", "ask", "Explique calc.py"],
      ["demo-patch", "patch", "Corrige la formule dans calc.py"]
    ]) {
      el(id).addEventListener("click", async () => {
        if (mode === "patch" && !state.projectAttached) {
          const result = await apiPost("/api/project", { action: "attach" });
          updateProjectBadges(result.project, [], null, null);
        }
        el("gamma-mode-select").value = mode;
        state.agentMode = mode;
        el("coding-objective-input").value = prompt;
        executeAgentAction();
      });
    }

    const sidebarBtn = el("btn-toggle-sidebar");
    if (sidebarBtn) sidebarBtn.addEventListener("click", () => setSidebarOpen(!isOpen("data-sidebar")));
    el("btn-close-sidebar").addEventListener("click", () => {
      setSidebarOpen(false);
      sidebarBtn.focus();
    });
    const inspectorBtn = el("btn-toggle-inspector");
    if (inspectorBtn) inspectorBtn.addEventListener("click", () => setInspectorOpen(!isOpen("data-inspector")));
    const closeInspectorBtn = el("btn-close-inspector");
    if (closeInspectorBtn) closeInspectorBtn.addEventListener("click", () => {
      setInspectorOpen(false);
      inspectorBtn.focus();
    });
    const newTaskBtn = el("btn-new-task");
    newTaskBtn.addEventListener("click", () => {
      if (!el("btn-coding-start").disabled) showChat(createChat());
    });

    const projectMenu = el("gamma-project-menu");
    el("btn-sidebar-project").addEventListener("click", () => {
      if (state.projectAttached) {
        const open = el("gamma-project-tools").classList.contains("hidden");
        setProjectToolsOpen(open);
        if (open && !el("tree-breadcrumbs").hasChildNodes()) {
          loadProjectTree(".").catch(() => {
            el("explorer-output").textContent = "Impossible de lire l’arborescence.";
          });
        }
      } else {
        if (narrowLayout.matches) setSidebarOpen(false);
        openProjectMenu();
      }
    });
    for (const [menuId, buttonId] of [
      ["perms-menu", "btn-perms-menu"],
      ["gamma-project-menu", "btn-project-menu"]
    ]) {
      const menu = el(menuId);
      const chip = el(buttonId);
      chip.addEventListener("click", () => {
        const open = menu.classList.contains("hidden");
        if (open && menu === projectMenu) {
          openProjectMenu();
        } else {
          setComposerMenuOpen(menuId, buttonId, open);
        }
      });
      document.addEventListener("click", (ev) => {
        if (menu.classList.contains("hidden")) return;
        if (menu.contains(ev.target) || chip.contains(ev.target)) return;
        if (menu === projectMenu && el("btn-sidebar-project").contains(ev.target)) return;
        setComposerMenuOpen(menuId, buttonId, false);
      });
      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && !ev.defaultPrevented && !menu.classList.contains("hidden") &&
            !el("gamma-confirm-dialog").open) {
          ev.preventDefault();
          setComposerMenuOpen(menuId, buttonId, false);
          chip.focus();
        }
      });
    }

    const themeBtn = el("btn-gamma-theme");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        applyGammaTheme(state.theme === "light" ? "dark" : "light");
      });
    }

    document.querySelectorAll(".gamma-wb-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchWorkbenchTab(btn.getAttribute("data-wb") || "code");
      });
    });
    wireArrowKeyGroup(".gamma-wb-tab");

    wireArrowKeyGroup("#explorer-tab-group .gamma-mini-btn");

    const modeSelect = el("gamma-mode-select");
    modeSelect.value = state.agentMode;
    modeSelect.addEventListener("change", () => {
      state.agentMode = modeSelect.value === "patch" ? "patch" : "ask";
    });

    const modelSelect = el("gamma-model-select");
    if (modelSelect) {
      modelSelect.addEventListener("change", () => {
        state.selectedModelSlot = modelSelect.value;
        apiPost("/api/settings", { modelSlot: state.selectedModelSlot }).then(() => refreshStatus(false)).catch(() => {});
      });
    }

    const attachBtn = el("btn-attach-project");
    const detachBtn = el("btn-detach-project");
    const rootInput = el("project-root-input");
    const projectError = el("gamma-project-error");
    let changingProject = false;
    async function changeProject(action) {
      if (changingProject || el("btn-coding-start").disabled) return;
      const root = rootInput.value.trim();
      if (action === "attach" && !root) {
        projectError.textContent = "Saisis le chemin du dossier.";
        projectError.classList.remove("hidden");
        rootInput.focus();
        return;
      }
      changingProject = true;
      attachBtn.disabled = true;
      detachBtn.disabled = true;
      projectError.classList.add("hidden");
      try {
        const resp = await apiPost("/api/project", { action, root });
        if (resp && resp.status === "OK") {
          state.currentEntries = [];
          state.currentFile = null;
          state.currentFileRaw = "";
          state.currentFileTotalLines = 0;
          el("viewer-title").textContent = "Code";
          el("viewer-meta").textContent = "—";
          el("file-viewer-content").textContent = "Aucun fichier ouvert.";
          el("btn-load-full-file").classList.add("hidden");
          updateProjectBadges(resp.project, resp.detectedProfiles, resp.activeTestProfile, resp.testPlan);
          if (state.projectAttached) {
            await loadProjectTree(".");
          } else {
            rootInput.value = "";
            el("explorer-output").textContent = "Aucun projet attaché.";
          }
          setComposerMenuOpen("gamma-project-menu", "btn-project-menu", false);
          el("coding-objective-input").focus();
        } else {
          projectError.textContent = (resp && resp.message) || "Impossible de changer de projet.";
          projectError.classList.remove("hidden");
        }
      } catch (_) {
        projectError.textContent = "Impossible de joindre Gamma.";
        projectError.classList.remove("hidden");
      } finally {
        changingProject = false;
        attachBtn.disabled = false;
        detachBtn.disabled = !state.projectAttached;
      }
    }
    attachBtn.addEventListener("click", () => changeProject("attach"));
    detachBtn.addEventListener("click", () => changeProject("detach"));
    rootInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing) {
        ev.preventDefault();
        attachBtn.click();
      }
    });

    const enableWritesBtn = el("btn-enable-writes");
    if (enableWritesBtn) {
      enableWritesBtn.addEventListener("click", async () => {
        const resp = await apiPost("/api/coding", { action: "enable" });
        if (resp && resp.status === "OK") {
          updateProjectBadges(resp.project, resp.testProfile ? [resp.testProfile] : [], resp.testProfile, resp.testPlan);
          appendAgentCard(
            "assistant",
            "2. Écriture autorisée",
            "Écriture activée avec instantané SHA-256 obligatoire avant toute modification. L'exécution des tests reste une permission séparée (3. Confiance Tests).",
            resp.testProfile ? [`Profil détecté : ${resp.testProfile}`] : []
          );
        } else {
          const box = el("coding-output");
          if (box) box.textContent = (resp && resp.message) || "Impossible d'activer l'écriture.";
          switchWorkbenchTab("diff");
        }
      });
    }

    const trustTestsBtn = el("btn-trust-tests");
    if (trustTestsBtn) {
      trustTestsBtn.addEventListener("click", async () => {
        const nextTrust = !state.trustedForTests;
        if (nextTrust && state.testPlan) {
          const ok = await openGammaConfirmDialog({
            title: "Autoriser l'exécution des tests sur ce projet ?",
            message: "Cette permission autorise Gamma à exécuter la suite de tests détectée dans ce dépôt.",
            details: [
              ["Dossier", state.testPlan.cwd || "."],
              ["Profil", state.testPlan.profile || "—"],
              ["Commande exacte", state.testPlan.commandLine || "—"]
            ],
            okLabel: "Autoriser les tests"
          });
          if (!ok) return;
        }
        const resp = await apiPost("/api/project", { action: "trust_tests", trusted: nextTrust });
        if (resp && resp.status === "OK") {
          updateProjectBadges(resp.project, state.testProfile ? [state.testProfile] : [], state.testProfile, resp.testPlan);
          appendAgentCard(
            "assistant",
            nextTrust ? "3. Projet de confiance activé (Tests autorisés)" : "3. Confiance Tests révoquée",
            nextTrust && resp.testPlan
              ? `Commande autorisée : ${resp.testPlan.commandLine} dans ${resp.testPlan.cwd}`
              : "L'exécution des tests demandera désormais une confirmation explicite."
          );
        }
      });
    }

    const runTestsBtn = el("btn-run-tests");
    if (runTestsBtn) {
      runTestsBtn.addEventListener("click", async () => {
        const targetProf = state.testProfile || (state.testPlan && state.testPlan.profile) || "";
        const cwdText = (state.testPlan && state.testPlan.cwd) || ".";
        const cmdText = (state.testPlan && state.testPlan.commandLine) || targetProf || "par défaut";
        const ok = await openGammaConfirmDialog({
          title: "Confirmer l'exécution des tests du projet ?",
          message: "Vérifie le dossier et la commande exacte avant de lancer la suite de tests.",
          details: [
            ["Dossier", cwdText],
            ["Profil", targetProf || "auto"],
            ["Commande exacte", cmdText]
          ],
          okLabel: "Lancer les tests"
        });
        if (!ok) {
          return;
        }
        const box = el("coding-output");
        switchWorkbenchTab("diff");
        if (box) box.textContent = `Exécution de « ${cmdText} » dans « ${cwdText} »…`;
        const resp = await apiPost("/api/project", {
          action: "run_tests",
          profile: targetProf,
          confirmed: true,
          trust_project: true
        });
        if (!resp || resp.status !== "OK" || !resp.testResult) {
          if (box) box.textContent = (resp && resp.message) || "Échec du lancement des tests.";
          return;
        }
        const tr = resp.testResult;
        const outcome = formatTestExecutionOutcome(tr);
        if (box) {
          box.textContent = "";
          const card = document.createElement("div");
          card.className = "gamma-ledger-card";
          const head = document.createElement("div");
          head.className = "gamma-ledger-card-head";
          const st = document.createElement("strong");
          st.textContent = `Exécution des tests · ${tr.profile}`;
          const badge = document.createElement("span");
          badge.className = "pill " + (outcome.ok ? "ok" : "danger");
          badge.textContent = outcome.badgeText;
          head.appendChild(st);
          head.appendChild(badge);
          card.appendChild(head);

          const meta = document.createElement("div");
          meta.className = "gamma-sha-row";
          const runParts = [`Dossier : ${tr.cwd || cwdText}`, `Commande : ${tr.commandLine || cmdText}`];
          if (isNum(tr.exitCode)) runParts.push(`Code retour : ${tr.exitCode}`);
          if (isNum(tr.durationMs)) runParts.push(`Durée : ${Math.round(tr.durationMs)} ms`);
          meta.textContent = runParts.join(" │ ");
          card.appendChild(meta);

          const pre = document.createElement("pre");
          pre.className = "diff-box";
          pre.textContent = tr.outputTail || tr.summary || "";
          card.appendChild(pre);
          box.appendChild(card);
        }
        refreshStatus(false);
      });
    }

    const resumeBtn = el("btn-project-resume");
    if (resumeBtn) {
      resumeBtn.addEventListener("click", async () => {
        const resp = await apiPost("/api/project", { action: "resume" });
        const box = el("coding-output");
        switchWorkbenchTab("diff");
        if (box && resp) {
          box.textContent = "";
          const pre = document.createElement("pre");
          pre.className = "diff-box";
          pre.textContent = JSON.stringify(resp.resume || resp, null, 2);
          box.appendChild(pre);
        }
      });
    }

    const treeRootBtn = el("btn-tree-root");
    if (treeRootBtn) treeRootBtn.addEventListener("click", () => loadProjectTree("."));

    const treeFilterInput = el("tree-filter-input");
    if (treeFilterInput) {
      treeFilterInput.addEventListener("input", () => {
        state.treeFilter = treeFilterInput.value;
        if (state.currentEntries.length > 0) {
          renderTreeEntries();
        }
      });
    }

    const searchBtn = el("btn-project-search");
    const searchInput = el("project-search-input");
    if (searchBtn) searchBtn.addEventListener("click", runProjectSearch);
    if (searchInput) {
      searchInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          runProjectSearch();
        }
      });
    }

    const gitStatusBtn = el("btn-git-status");
    const gitDiffBtn = el("btn-git-diff");
    const gitLogBtn = el("btn-git-log");
    if (gitStatusBtn) gitStatusBtn.addEventListener("click", () => runGitCommand("status"));
    if (gitDiffBtn) gitDiffBtn.addEventListener("click", () => runGitCommand("diff"));
    if (gitLogBtn) gitLogBtn.addEventListener("click", () => runGitCommand("log"));

    const loadFullBtn = el("btn-load-full-file");
    if (loadFullBtn) {
      loadFullBtn.addEventListener("click", () => {
        if (state.currentFile) {
          openProjectFile(state.currentFile, null, true);
        }
      });
    }

    const askFileBtn = el("btn-ask-file");
    if (askFileBtn) {
      askFileBtn.addEventListener("click", () => {
        const input = el("coding-objective-input");
        if (!input) return;
        if (state.currentFile) {
          input.value = `Dans ${state.currentFile} : `;
        }
        if (narrowLayout.matches) setInspectorOpen(false);
        input.focus();
      });
    }

    const normEolBtn = el("btn-normalize-eol");
    if (normEolBtn) {
      normEolBtn.addEventListener("click", async () => {
        const box = el("coding-output");
        if (!state.currentFile) {
          if (box) box.textContent = "Ouvre d'abord un fichier dans le lecteur.";
          switchWorkbenchTab("diff");
          return;
        }
        const ok = await openGammaConfirmDialog({
          title: "Normaliser les fins de ligne en LF ?",
          message: "Un instantané SHA-256 sera pris avant la conversion pour permettre un retour arrière à l'octet près.",
          details: [
            ["Fichier", state.currentFile],
            ["Cible", "LF (\\n)"]
          ],
          okLabel: "Convertir en LF"
        });
        if (!ok) return;
        const resp = await apiPost("/api/project", {
          action: "normalize_eol",
          path: state.currentFile,
          mode: "lf",
          confirmed: true
        });
        if (resp && resp.status === "OK") {
          state.activeTaskId = resp.taskId;
          if (box) box.textContent = `✓ Fins de ligne normalisées en ${resp.lineEnding} pour ${resp.path} (Tâche ${resp.taskId}).`;
          openProjectFile(state.currentFile, null, false);
        } else if (box) {
          box.textContent = (resp && resp.message) || "Refusé : active d'abord l'écriture sur le projet.";
          switchWorkbenchTab("diff");
        }
      });
    }

    const copyFileBtn = el("btn-copy-file");
    if (copyFileBtn) {
      copyFileBtn.addEventListener("click", () => {
        if (!state.currentFileRaw) return;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(state.currentFileRaw).catch(() => {});
        }
        flashDone(copyFileBtn);
      });
    }

    const codingStartBtn = el("btn-coding-start");
    const codingInput = el("coding-objective-input");
    if (codingStartBtn) {
      codingStartBtn.addEventListener("click", executeAgentAction);
    }
    if (codingInput) {
      codingInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
          ev.preventDefault();
          executeAgentAction();
        }
      });
    }

    document.addEventListener("keydown", (ev) => {
      if (ev.defaultPrevented || el("gamma-confirm-dialog").open) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "p") {
        ev.preventDefault();
        if (state.projectAttached) {
          setSidebarOpen(true);
          setProjectToolsOpen(true);
          if (searchInput) searchInput.focus();
        } else {
          openProjectMenu();
        }
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "b") {
        ev.preventDefault();
        setSidebarOpen(!isOpen("data-sidebar"));
      } else if (ev.altKey && ev.key === "1") {
        ev.preventDefault();
        switchWorkbenchTab("code");
      } else if (ev.altKey && ev.key === "2") {
        ev.preventDefault();
        switchWorkbenchTab("diff");
      } else if (ev.key === "Escape" && isOpen("data-inspector")) {
        closeInspectorBtn.click();
      } else if (ev.key === "Escape" && narrowLayout.matches && isOpen("data-sidebar")) {
        el("btn-close-sidebar").click();
      }
    });

    const rollbackBtn = el("btn-rollback-last");
    if (rollbackBtn) {
      rollbackBtn.addEventListener("click", () => triggerRollbackForTask(state.activeTaskId));
    }

    const refreshSysBtn = el("btn-refresh-system");
    if (refreshSysBtn) {
      refreshSysBtn.addEventListener("click", () => refreshStatus(true));
    }

    const probeAgeBtn = el("probe-age-pill");
    if (probeAgeBtn) {
      probeAgeBtn.addEventListener("click", () => refreshStatus(true));
    }

    const unloadGpuBtn = el("btn-unload-gpu");
    if (unloadGpuBtn) {
      unloadGpuBtn.addEventListener("click", async () => {
        const outcome = formatUnloadOutcome(await apiPost("/api/models/unload", {}));
        appendAgentCard("assistant", outcome.title, outcome.text);
        refreshStatus(true);
      });
    }
  }

  wireEvents();
  refreshStatus(false);
})(typeof window !== "undefined" ? window : globalThis);
