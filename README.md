# Makcord (arquivo único)

Essa versão é **um único `index.html`** — CSS e JS já vêm embutidos dentro dele. Isso evita o problema mais comum ao publicar no GitHub Pages: pastas (`css/`, `js/`) que se perdem quando você arrasta arquivos soltos pela interface do GitHub.

## Como publicar (do jeito que não erra)
1. Crie um repositório no GitHub (ex: `makcord`).
2. Clique em **Add file → Upload files**.
3. Suba **só o arquivo `index.html`** (este aqui).
4. Vá em **Settings → Pages**, escolha a branch `main`, pasta **/ (root)**, salve.
5. Espere 1–2 minutos e acesse `https://SEU-USUARIO.github.io/makcord/`.

Não precisa criar pasta nenhuma manualmente — está tudo dentro de um arquivo só.

## Se quiser confirmar que carregou certo
Abra o site e veja se aparece o fundo escuro com o cartão "Makcord" centralizado (não texto azul sublinhado tipo página antiga). Se ainda aparecer sem estilo, é sinal de cache do navegador: dê Ctrl+Shift+R (recarregar ignorando cache) ou tente em aba anônima.

## Funcionalidades
- Nome e foto de perfil lembrados por IP público (localStorage) — não é login, é conveniência (ver limitações abaixo).
- **Servidores**: crie ou entre em vários servidores (salas), com uma barra lateral (rail) pra trocar entre os que você já visitou.
- **Canais**: dentro de cada servidor, o dono pode criar canais de texto e canais de voz. Cada canal de voz tem um limite configurável de 1 a 50 pessoas.
- Chamada de voz em grupo real via WebRTC (PeerJS), malha peer-to-peer — só entre quem está no mesmo canal de voz.
- Compartilhamento de tela 720p/30fps, com opção de incluir o áudio da tela/aba, notificação permanente clicável pros outros membros, e visualização em tela cheia.
- Troca de microfone e de saída de áudio (saída só funciona em Chrome/Edge desktop, por limitação do próprio navegador).
- Foto de perfil (upload de imagem, recortada e redimensionada no navegador) em vez das iniciais.
- Anel visual em quem está falando.

## Limitações (sem servidor próprio, é só GitHub Pages)
- Sem histórico de chat salvo — existe só enquanto o servidor está aberto (dura enquanto a aba do dono ficar aberta).
- Sinalização usa o broker público gratuito do PeerJS (sem SLA, ótimo pra uso entre amigos).
- Se quem criou o servidor sair, o servidor encerra (sem novo dono automático).
- Canais de voz com dezenas de pessoas usam WebRTC "malha" (cada pessoa conectada a cada pessoa): funciona bem até uns 10-15 participantes simultâneos falando; com o limite de 50 a qualidade de conexão de cada participante passa a depender bastante da internet e do processador de cada um, já que não há um servidor de mídia central retransmitindo o áudio.
- "Lembrar por IP" vale por navegador + rede; não é conta de verdade.
- A troca de servidores pela rail encerra a conexão de voz/tela do servidor anterior antes de entrar no próximo (não dá pra estar em dois servidores ao mesmo tempo).

## Testar localmente
```bash
python3 -m http.server 8080
```
Abra `http://localhost:8080` em duas abas/navegadores pra simular dois amigos.
