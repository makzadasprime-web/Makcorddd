# Makcord (arquivo único)

Essa versão continua sendo **um único `index.html`** — CSS e JS embutidos. `manifest.json` e `sw.js` são dois arquivinhos extras, só pra permitir instalar como app no celular (ver seção Mobile).

## Como publicar
1. Crie um repositório no GitHub (ex: `makcord`).
2. **Antes de subir**, configure o Firebase (próxima seção) — sem isso o login não funciona.
3. **Add file → Upload files**: suba `index.html`, `manifest.json` e `sw.js` (os três, na raiz).
4. **Settings → Pages** → branch `main` → pasta **/ (root)** → salvar.
5. Espere 1–2 minutos e acesse `https://SEU-USUARIO.github.io/makcord/`.

## Configurar o login (Firebase — grátis)
O GitHub Pages não tem backend, então o login/amigos usam o **Firebase** (banco de dados + autenticação do Google, plano gratuito é suficiente pra esse uso).

1. Acesse **https://console.firebase.google.com** → **Criar projeto** (pode desativar o Google Analytics, não é necessário).
2. No menu lateral: **Build → Authentication → Get started → Sign-in method → E-mail/senha → Ativar**.
3. No menu lateral: **Build → Firestore Database → Criar banco de dados** → modo produção → escolha uma região.
4. Ainda em Firestore, aba **Regras**, cole as regras que já estão comentadas no topo do `index.html` (procure por `AUTH.js` dentro do arquivo) e publique.
5. **Configurações do projeto** (ícone de engrenagem) → role até **Seus apps** → clique no ícone **Web `</>`** → registre um app (não precisa marcar Hosting) → copie o objeto `firebaseConfig`.
6. Abra `index.html`, procure por `const firebaseConfig = {` (dentro do bloco `AUTH.js`) e substitua os valores `"COLE_AQUI"` pelos que você copiou.
7. Suba o `index.html` atualizado pro GitHub.

Sem isso, a tela de login aparece mas dá erro ao tentar criar conta/entrar.

## Funcionalidades
- **Login por e-mail e senha** (Firebase Authentication): a conta funciona em qualquer aparelho, não depende do navegador ou da rede.
- **Amigos**: adicione qualquer pessoa cadastrada pelo e-mail dela (botão "👥 Amigos" no hub), aceite/recuse pedidos recebidos. A lista de amigos fica salva na conta.
- **Servidores**: crie ou entre em vários servidores (salas), com uma barra lateral (rail) pra trocar entre os que você já visitou.
- **Canais**: dentro de cada servidor, o dono pode criar canais de texto e canais de voz (1 a 50 pessoas por canal de voz).
- Chamada de voz em grupo via WebRTC (PeerJS), peer-to-peer, só entre quem está no mesmo canal de voz.
- Compartilhamento de tela 720p/30fps (desktop), com áudio opcional, notificação clicável pros outros membros, e tela cheia.
- Troca de microfone e de saída de áudio (saída só em Chrome/Edge desktop).
- Foto de perfil (upload, recortada no navegador), agora salva na sua conta (Firestore) em vez do navegador.
- Anel visual em quem está falando.
- Instalável como **PWA** no celular (ver seção Mobile).

## Mobile — o que dá e o que não dá
Isso é um site (mesmo instalado como PWA), não um app nativo publicado na App Store/Play Store. Isso limita o que o sistema operacional permite:

- ✅ **Interface responsiva** e usável no celular.
- ✅ **Instalável na tela inicial** (Chrome Android: menu → "Adicionar à tela inicial"; iOS Safari: Compartilhar → "Adicionar à Tela de Início"). Abre em tela cheia, com ícone próprio, sem barra de endereço.
- ✅ **Chamada de voz funciona no mobile**, com a aba/app aberto e a tela ligada.
- ❌ **Transmissão de tela no mobile**: iOS Safari e Chrome Android não expõem a API de captura de tela pra sites/PWAs — é bloqueio do sistema operacional. Só um app nativo real (com uma extensão de "broadcast" no iOS, ou permissão especial no Android) consegue isso.
- ❌ **Chamada em segundo plano**: navegadores mobile suspendem/matam a aba quando ela sai de foco ou a tela apaga, derrubando a chamada. Contornar isso de verdade exige um app nativo com serviço em primeiro plano (Android) ou VoIP push + CallKit (iOS) — fora do alcance de um site.

Se algum dia isso virar prioridade, o caminho realista é reescrever como app nativo (React Native/Flutter ou Swift/Kotlin) usando esse mesmo Firebase como backend — é um projeto à parte, bem maior que ajustar o site.

## Limitações gerais (sem servidor próprio, é GitHub Pages + Firebase)
- Chat e presença em servidores/canais de voz continuam sem histórico persistente — existem só enquanto o servidor está aberto (dura enquanto a aba do dono ficar aberta). Login e amigos, esses sim, ficam salvos pra sempre no Firebase.
- Sinalização de voz usa o broker público gratuito do PeerJS (sem SLA, ótimo pra uso entre amigos).
- Se quem criou o servidor sair, o servidor encerra (sem novo dono automático).
- Canais de voz com dezenas de pessoas usam WebRTC "malha": funciona bem até uns 10-15 participantes falando ao mesmo tempo; perto do limite de 50, a qualidade depende da internet/processador de cada um.
- A troca de servidores pela rail encerra a conexão de voz/tela do servidor anterior antes de entrar no próximo.

## Testar localmente
```bash
python3 -m http.server 8080
```
Abra `http://localhost:8080` em duas abas/navegadores pra simular dois amigos (você pode criar duas contas de teste com e-mails diferentes).
