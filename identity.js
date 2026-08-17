/* =========================================================
   IDENTITY.js
   Como o GitHub Pages não tem backend, "lembrar por IP" é feito
   assim: buscamos o IP público do visitante numa API gratuita
   (ipify) e usamos ele como chave no localStorage do navegador
   para guardar o nome e a foto de perfil escolhidos.

   Limitações importantes (deixe isso claro pro usuário):
   - Isso NÃO é autenticação. Qualquer um no mesmo IP (mesma rede
     Wi-Fi, mesma empresa, mesma operadora com CG-NAT) vai "herdar"
     o nome/foto salvos naquele navegador/IP.
   - localStorage é por navegador. Trocar de navegador, usar aba
     anônima ou limpar dados apaga a lembrança.
   - Se o IP mudar (trocou de rede, 4G, VPN), nada é lembrado.
   - Isso é só uma conveniência, não um sistema de contas.
   ========================================================= */

const Identity = (() => {
  const STORAGE_PREFIX = 'makcord:name:';
  const AVATAR_PREFIX = 'makcord:avatar:';
  let cachedIp = null;

  async function fetchPublicIp() {
    if (cachedIp) return cachedIp;
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const data = await res.json();
      cachedIp = data.ip;
      return cachedIp;
    } catch (err) {
      console.warn('Makcord: não foi possível obter o IP público, seguindo sem memória por IP.', err);
      return null;
    }
  }

  function keyFor(ip) { return STORAGE_PREFIX + ip; }
  function avatarKeyFor(ip) { return AVATAR_PREFIX + ip; }

  async function getRememberedName() {
    const ip = await fetchPublicIp();
    if (!ip) return { name: null, ip: null };
    const name = localStorage.getItem(keyFor(ip));
    return { name, ip };
  }

  async function rememberName(name) {
    const ip = await fetchPublicIp();
    if (!ip) return false;
    localStorage.setItem(keyFor(ip), name);
    return true;
  }

  async function getRememberedAvatar() {
    const ip = await fetchPublicIp();
    if (!ip) return null;
    return localStorage.getItem(avatarKeyFor(ip));
  }

  async function rememberAvatar(dataUrl) {
    const ip = await fetchPublicIp();
    if (!ip) return false;
    try {
      if (dataUrl) localStorage.setItem(avatarKeyFor(ip), dataUrl);
      else localStorage.removeItem(avatarKeyFor(ip));
      return true;
    } catch (e) {
      // localStorage cheio — a foto ainda funciona na sessão atual, só não fica salva
      console.warn('Makcord: não foi possível salvar a foto localmente.', e);
      return false;
    }
  }

  async function forget() {
    const ip = await fetchPublicIp();
    if (ip) { localStorage.removeItem(keyFor(ip)); localStorage.removeItem(avatarKeyFor(ip)); }
  }

  return { getRememberedName, rememberName, getRememberedAvatar, rememberAvatar, forget, fetchPublicIp };
})();
