/* GitHub Pages launcher: no fetch, cookies, chat or bearer. */
(() => {
  'use strict';
  const api = window.RubyConnections;
  const notice = document.getElementById('notice');
  // A denied Storage getter must not disable the launcher. Only the validated,
  // non-secret descriptor book may fall back to this tab's memory.
  let temporary = false, memory = null;
  const storage = {
    getItem(key) {
      try { memory = localStorage.getItem(key); }
      catch { temporary = true; }
      return memory;
    },
    setItem(key, value) {
      memory = value;
      try { localStorage.setItem(key, value); }
      catch { temporary = true; }
    },
  };
  function inform(text) {
    notice.textContent = text + (temporary
      ? ' Carnet temporaire : non conservé après fermeture de cet onglet (stockage navigateur indisponible).'
      : '');
  }
  let entries = api.load(storage);
  function render() {
    const book = document.getElementById('book');
    book.replaceChildren();
    if (!entries.length) book.textContent = 'Aucune installation enregistrée sur cet appareil.';
    entries.forEach(item => {
      const card = document.createElement('section'); card.className = 'installation-card';
      const title = document.createElement('h2'); title.textContent = item.label;
      const address = document.createElement('p'); address.textContent = item.origin;
      const identity = document.createElement('small');
      identity.textContent = `${item.user_code} · installation ${item.installation_id}`;
      const open = document.createElement('a'); open.textContent = 'Ouvrir mon Ruby';
      open.className = 'primary-button'; open.href = api.destination(item); open.rel = 'noreferrer';
      const remove = document.createElement('button'); remove.textContent = 'Oublier du carnet';
      remove.type = 'button'; remove.className = 'secondary-button';
      remove.addEventListener('click', () => {
        try {
          entries = api.save(storage, entries.filter(entry => entry !== item)); render();
          inform('Installation oubliée du carnet. La session privée se révoque depuis le PC Ruby.');
        } catch { inform('Le navigateur ne permet pas de modifier le carnet.'); }
      });
      card.append(title, address, identity, open, remove); book.append(card);
    });
  }
  document.getElementById('add-installation').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const item = api.record(Object.fromEntries(new FormData(event.currentTarget)));
      entries = api.save(storage, [...entries.filter(entry => entry.installation_id !== item.installation_id), item]);
      event.currentTarget.reset(); render();
      event.currentTarget.closest('details').open = false;
      inform('Installation ajoutée. Aucun secret enregistré.');
    } catch (error) { inform(error.message); }
  });
  render(); inform('');
})();
