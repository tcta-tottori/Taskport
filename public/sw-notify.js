// sw-notify.js — 録音中の常駐通知の操作を受け取る
//
// vite-plugin-pwa が生成する sw.js から importScripts で読み込む。
// 通知のアクション（一時停止・再開・録音完了）を、開いているページへ
// postMessage で伝える。ページ側（recNotification.ts）が実際の操作を行う。

const TP_NOTIF_ACTIONS = {
  stop: 'tp-stop-recording',
  pause: 'tp-pause-recording',
  resume: 'tp-resume-recording',
};

self.addEventListener('notificationclick', (event) => {
  // 期限のリマインドは下のハンドラが受け持つ（二重に窓を開かないため）
  if (String(event.notification.tag || '').startsWith('taskport-due-')) return;
  const msgType = TP_NOTIF_ACTIONS[event.action] || '';
  // 一時停止・再開は通知を残したまま、画面も前面に出さない
  // （通知だけで操作できるようにするため）
  const keepInBackground = event.action === 'pause' || event.action === 'resume';
  if (!keepInBackground) event.notification.close();

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      let client = clients.find((c) => 'focus' in c) || null;
      if (!keepInBackground) {
        try {
          if (client) await client.focus();
          else if (self.clients.openWindow) client = await self.clients.openWindow('./');
        } catch (_) {}
      }
      if (client && msgType) client.postMessage({ type: msgType });
    })(),
  );
});

// 期限のリマインドをタップしたらアプリを前面に出す。
// tag が taskport-due- で始まるものがそれ。
self.addEventListener('notificationclick', (event) => {
  if (!String(event.notification.tag || '').startsWith('taskport-due-')) return;
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = clients.find((c) => 'focus' in c);
      if (client) await client.focus();
      else if (self.clients.openWindow) await self.clients.openWindow('./');
    })(),
  );
});
