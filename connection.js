/* Remote v2 non-secret connection book. No credential or chat persistence. */
(function (root) {
  'use strict';
  const KEY = 'ruby.remote.v2.installations';
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !['installation_id', 'origin', 'label', 'user_code'].includes(key))) {
      throw new Error('Carnet invalide : uniquement identité, adresse, nom et alias.');
    }
    const { installation_id, origin, label, user_code } = value;
    if (typeof installation_id !== 'string' || !uuid.test(installation_id)
        || typeof origin !== 'string' || typeof label !== 'string'
        || !label.trim() || label.length > 64 || /[\x00-\x1f\x7f]/.test(label)
        || typeof user_code !== 'string' || !/^[A-Z0-9]{1,32}$/.test(user_code)) {
      throw new Error('Vérifie l’identité, le nom et le code utilisateur (non secret).');
    }
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
        || url.search || url.hash || url.port || url.origin !== origin) {
      throw new Error('Une origine HTTPS exacte, sans chemin ni identifiant, est requise.');
    }
    return Object.freeze({ installation_id, origin, label: label.trim(), user_code });
  }
  function load(storage) {
    try {
      const entries = JSON.parse(storage.getItem(KEY) || '[]');
      if (!Array.isArray(entries) || entries.length > 16) return [];
      return entries.map(record);
    } catch { return []; }
  }
  function save(storage, entries) {
    if (!Array.isArray(entries) || entries.length > 16) throw new Error('16 installations maximum.');
    const clean = entries.map(record);
    if (new Set(clean.map(item => item.installation_id)).size !== clean.length) {
      throw new Error('Une seule entrée par installation.');
    }
    storage.setItem(KEY, JSON.stringify(clean));
    return clean;
  }
  function destination(value) {
    const item = record(value);
    return item.origin + '/remote/#' + new URLSearchParams({
      installation_id: item.installation_id, user_code: item.user_code,
    }).toString();
  }
  const api = { record, load, save, destination, uuid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RubyConnections = api;
})(typeof window !== 'undefined' ? window : globalThis);
