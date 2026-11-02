// Made By FALCREB
// Sohbet kutusu. Metin DOM'a yalnızca textContent ile yazılır, HTML olarak asla yorumlanmaz.

const ROLE_LABELS = { host: 'HOST', mod: 'MOD', vip: 'VIP' };

function span(className, text) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

export function createChatBox({ box, list, config, now = () => Date.now() }) {
  const updateEmpty = () => box.classList.toggle('is-empty', list.childElementCount === 0);

  function remove(row) {
    row.remove();
    updateEmpty();
  }

  // Tek bir zamanlayıcı tüm satırların süresini denetler; satır başına timer açılmaz.
  if (config.fade > 0) {
    setInterval(() => {
      const limit = now() - config.fade * 1000;
      for (const row of [...list.children]) {
        if (Number(row.dataset.at) < limit) remove(row);
      }
    }, 1000);
  }

  return {
    add(message, emphasis) {
      const row = document.createElement('div');
      row.className = 'msg';
      row.dataset.at = String(now());
      row.dataset.login = message.login;
      if (message.id) row.dataset.id = message.id;
      if (emphasis) row.classList.add(`emph-${emphasis}`);
      if (message.isAction) row.classList.add('is-action');

      if (message.role) row.append(span('msg-tag tag-role', ROLE_LABELS[message.role]));
      const user = span('msg-user', message.user);
      // Renk daha önce #rrggbb olarak doğrulandı.
      if (message.color) user.style.setProperty('--user-color', message.color);
      row.append(user, span('msg-text', message.text));

      list.append(row);
      while (list.childElementCount > config.max) list.firstElementChild.remove();
      updateEmpty();
    },

    /** Moderatör silme olaylarını uygular; silinen mesaj yayında kalmaz. */
    moderate(event) {
      for (const row of [...list.children]) {
        if (
          event.type === 'all' ||
          (event.type === 'message' && row.dataset.id === event.id) ||
          (event.type === 'user' && row.dataset.login === event.login)
        ) {
          remove(row);
        }
      }
    },
  };
}
