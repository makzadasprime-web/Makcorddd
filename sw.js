/* Service worker mínimo — só existe pra permitir "Adicionar à tela inicial"
   funcionar como app (ícone próprio, tela cheia, sem barra do navegador).
   Não guarda chamadas em cache: chamada de voz e compartilhamento de tela
   continuam exigindo a aba aberta e internet ativa. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {}); // sem cache — sempre busca da rede
