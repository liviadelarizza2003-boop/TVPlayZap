'use strict';
/**
 * bot/index.js — Conexão WhatsApp via Baileys
 *
 * - Gera QR Code e transmite via WebSocket para o painel (tela de Configurações)
 * - Persiste a sessão em DATA_DIR/session/ para não precisar escanear novamente
 * - Expõe sendMessage() para uso pelo messageHandler e pelo scheduler
 * - Reconecta automaticamente em caso de desconexão
 */

const path = require('path');
const fs   = require('fs');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
} = require('@whiskeysockets/baileys');

const { handleMessage } = require('./messageHandler');
const { setSendMessage }  = require('../scheduler/renewalReminder');

const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, '../../data');
const SESSION_DIR = path.join(DATA_DIR, 'session');
fs.mkdirSync(SESSION_DIR, { recursive: true });

const silentLogger = pino({ level: 'silent' });

// Estado compartilhado
let sock         = null;
let qrData       = null;      // string do QR Code atual
let connected    = false;
let qrListeners  = new Set(); // WebSockets aguardando QR

/** Retorna o estado de conexão para a API */
function getStatus() {
  return { connected, hasQr: !!qrData };
}

/** Adiciona um WebSocket listener que receberá o QR quando disponível */
function addQrListener(ws) {
  qrListeners.add(ws);
  // Se já tem QR pronto, envia imediatamente
  if (qrData) ws.send(JSON.stringify({ type: 'qr', data: qrData }));
  if (connected) ws.send(JSON.stringify({ type: 'connected' }));

  ws.on('close', () => qrListeners.delete(ws));
}

function broadcastToListeners(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of qrListeners) {
    try { ws.send(msg); } catch { /* ignora ws fechado */ }
  }
}

/**
 * Envia uma mensagem de texto para um número WhatsApp.
 * @param {string} jid  — ex: "5511999999999@s.whatsapp.net"
 * @param {string} text
 */
async function sendMessage(jid, text) {
  if (!sock || !connected) throw new Error('Bot não conectado ao WhatsApp');
  await sock.sendMessage(jid, { text });
}

// Exponha o sendMessage para o scheduler de lembretes
setSendMessage(sendMessage);

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger:         silentLogger,
    auth: {
      creds:    state.creds,
      keys:     makeCacheableSignalKeyStore(state.keys, silentLogger),
    },
    printQRInTerminal: true, // fallback útil durante dev local
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
  });

  // ── Credenciais ────────────────────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── QR Code ────────────────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrData    = qr;
      connected = false;

      // Gera imagem base64 do QR para o painel
      try {
        const QRCode = require('qrcode');
        const dataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        broadcastToListeners({ type: 'qr', data: dataUrl });
      } catch {
        broadcastToListeners({ type: 'qr', data: qr });
      }
    }

    if (connection === 'open') {
      connected = true;
      qrData    = null;
      console.log('[bot] ✅ WhatsApp conectado!');
      broadcastToListeners({ type: 'connected' });
    }

    if (connection === 'close') {
      connected = false;
      const reason = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log(`[bot] Conexão fechada (razão: ${reason}). Reconectar: ${shouldReconnect}`);
      broadcastToListeners({ type: 'disconnected', reason });

      if (shouldReconnect) {
        setTimeout(connect, 5000); // aguarda 5s antes de reconectar
      } else {
        // loggedOut: limpa sessão e aguarda novo QR scan
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        fs.mkdirSync(SESSION_DIR, { recursive: true });
        setTimeout(connect, 2000);
      }
    }
  });

  // ── Mensagens recebidas ────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Ignora mensagens do próprio bot, broadcasts e grupos
      if (msg.key.fromMe)            continue;
      if (isJidBroadcast(msg.key.remoteJid)) continue;
      if (msg.key.remoteJid?.endsWith('@g.us')) continue; // grupos

      try {
        await handleMessage(msg, sendMessage);
      } catch (err) {
        console.error('[bot] Erro ao processar mensagem:', err);
      }
    }
  });
}

module.exports = { connect, sendMessage, getStatus, addQrListener };
