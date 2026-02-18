require('dotenv').config();
const {
  default: makeWASocket,
  DisconnectReason,
  initAuthCreds,
  BufferJSON,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const P = require('pino');
const express = require('express');
const QRCode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');

// ========== CONFIG ==========
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_JID = process.env.ADMIN_JID;
const REQUEST_PREFIX = process.env.REQUEST_PREFIX || 'REQ';

if (!SUPABASE_URL || !SUPABASE_KEY || !ADMIN_JID) {
  console.error('❌ Faltan variables de entorno. Revisa el .env');
  process.exit(1);
}

const logger = P({ level: 'fatal' });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
let sock = null;
let latestQR = null;

// ========== FUNCIONES AUXILIARES ==========
function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.buttonsMessage?.contentText ||
    msg.message?.templateMessage?.hydratedTemplate?.hydratedContentText ||
    ''
  );
}

function numberToEmoji(num) {
  const map = ['0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  return map[num] || num.toString();
}

function emojiToNumber(str) {
  const clean = str.replace(/[^0-9]/g, '');
  return clean ? parseInt(clean, 10) : null;
}

function generateRequestId() {
  return `${REQUEST_PREFIX}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// ========== ACCESO A DATOS ==========
async function getGames() {
  const { data, error } = await supabase.from('games').select('*').order('number', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getGameByNumber(number) {
  const { data, error } = await supabase.from('games').select('*').eq('number', number).maybeSingle();
  if (error) throw error;
  return data;
}

async function getGameById(id) {
  const { data, error } = await supabase.from('games').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function createGame(number, name, description = '') {
  const { error } = await supabase.from('games').insert({ number, name, description });
  if (error) throw error;
}

async function updateGame(gameId, updates) {
  const { error } = await supabase.from('games').update(updates).eq('id', gameId);
  if (error) throw error;
}

async function deleteGame(gameId) {
  const { error } = await supabase.from('games').delete().eq('id', gameId);
  if (error) throw error;
}

async function getOffersByGameId(gameId) {
  const { data, error } = await supabase.from('offers').select('*').eq('game_id', gameId).order('number', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getOfferByGameAndNumber(gameId, number) {
  const { data, error } = await supabase.from('offers').select('*').eq('game_id', gameId).eq('number', number).maybeSingle();
  if (error) throw error;
  return data;
}

async function getOfferById(id) {
  const { data, error } = await supabase.from('offers').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function createOffer(gameId, number, description, priceMobile, priceCard, priceUsd = null) {
  const { error } = await supabase.from('offers').insert({
    game_id: gameId,
    number,
    description,
    price_mobile: priceMobile,
    price_card: priceCard,
    price_usd: priceUsd
  });
  if (error) throw error;
}

async function updateOffer(offerId, updates) {
  const { error } = await supabase.from('offers').update(updates).eq('id', offerId);
  if (error) throw error;
}

async function deleteOffer(offerId) {
  const { error } = await supabase.from('offers').delete().eq('id', offerId);
  if (error) throw error;
}

async function getPaymentMethods(type) {
  const query = supabase.from('payment_methods').select('*').order('number', { ascending: true });
  if (type) query.eq('type', type);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function getPaymentMethodByNumber(type, number) {
  const { data, error } = await supabase.from('payment_methods').select('*').eq('type', type).eq('number', number).maybeSingle();
  if (error) throw error;
  return data;
}

async function getPaymentMethodById(id) {
  const { data, error } = await supabase.from('payment_methods').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function createPaymentMethod(type, number, label, details) {
  const { error } = await supabase.from('payment_methods').insert({ type, number, label, details });
  if (error) throw error;
}

async function updatePaymentMethod(id, updates) {
  const { error } = await supabase.from('payment_methods').update(updates).eq('id', id);
  if (error) throw error;
}

async function deletePaymentMethod(id) {
  const { error } = await supabase.from('payment_methods').delete().eq('id', id);
  if (error) throw error;
}

async function getUserSession(userJid) {
  const { data, error } = await supabase.from('user_sessions').select('*').eq('user_jid', userJid).maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: newData, error: insertError } = await supabase
      .from('user_sessions')
      .insert({ user_jid: userJid, step: 'idle' })
      .select()
      .single();
    if (insertError) throw insertError;
    return newData;
  }
  return data;
}

async function updateUserSession(userJid, updates) {
  const { error } = await supabase
    .from('user_sessions')
    .update({ ...updates, updated_at: new Date() })
    .eq('user_jid', userJid);
  if (error) throw error;
}

async function createRequest(requestId, data) {
  const { error } = await supabase.from('requests').insert({ id: requestId, ...data });
  if (error) throw error;
}

async function getRequest(requestId) {
  const { data, error } = await supabase.from('requests').select('*').eq('id', requestId).maybeSingle();
  if (error) throw error;
  return data;
}

async function completeRequest(requestId) {
  const { error } = await supabase
    .from('requests')
    .update({ status: 'completed', completed_at: new Date() })
    .eq('id', requestId);
  if (error) throw error;
}

async function getAdminDialog(adminJid) {
  const { data, error } = await supabase.from('admin_dialogs').select('*').eq('admin_jid', adminJid).maybeSingle();
  if (error) throw error;
  return data;
}

async function setAdminDialog(adminJid, command, step, data = {}) {
  await supabase
    .from('admin_dialogs')
    .upsert({ admin_jid: adminJid, command, step, data }, { onConflict: 'admin_jid' });
}

async function clearAdminDialog(adminJid) {
  await supabase.from('admin_dialogs').delete().eq('admin_jid', adminJid);
}

// ========== AUTENTICACIÓN PERSISTENTE ==========
const useSupabaseAuthState = async () => {
  const writeData = async (data, key) => {
    try {
      await supabase.from('auth_sessions').upsert({ key, value: JSON.stringify(data, BufferJSON.replacer) });
    } catch (e) {
      console.error('Error guardando auth:', e.message);
    }
  };
  const readData = async (key) => {
    try {
      const { data } = await supabase.from('auth_sessions').select('value').eq('key', key).maybeSingle();
      return data?.value ? JSON.parse(data.value, BufferJSON.reviver) : null;
    } catch (e) {
      return null;
    }
  };
  const removeData = async (key) => {
    try {
      await supabase.from('auth_sessions').delete().eq('key', key);
    } catch (e) {}
  };

  const creds = (await readData('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            const key = `${type}-${id}`;
            const value = await readData(key);
            if (value) data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) tasks.push(writeData(value, key));
              else tasks.push(removeData(key));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      await writeData(creds, 'creds');
    }
  };
};

// ========== ENVÍO DE MENSAJES ==========
async function sendMessage(jid, text, quoted = null) {
  return sock.sendMessage(jid, { text }, { quoted });
}

async function sendWithCancelHint(jid, text) {
  return sendMessage(jid, text + '\n\n_Puedes escribir "cancelar" para volver al inicio._');
}

// ========== FLUJO DEL CLIENTE ==========
async function handleClientMessage(msg, jid, text) {
  const session = await getUserSession(jid);
  const lower = text.trim().toLowerCase();

  if (lower === 'cancelar') {
    await updateUserSession(jid, { step: 'idle', selected_game: null, selected_offer_id: null, selected_payment_type: null, selected_payment_number: null, request_id: null });
    await sendMainMenu(jid);
    return;
  }

  if (lower === 'volver') {
    await handleBack(jid, session);
    return;
  }

  switch (session.step) {
    case 'idle':
      await sendMainMenu(jid);
      break;

    case 'awaiting_game': {
      const gameNumber = emojiToNumber(text);
      if (!gameNumber) {
        await sendWithCancelHint(jid, '❌ Número no válido. Responde con el número del juego (ej: 1).');
        return;
      }
      const game = await getGameByNumber(gameNumber);
      if (!game) {
        await sendWithCancelHint(jid, '❌ Ese juego no existe. Elige un número de la lista.');
        return;
      }
      const offers = await getOffersByGameId(game.id);
      if (offers.length === 0) {
        await sendWithCancelHint(jid, '❌ Este juego no tiene ofertas aún. Contacta al admin.');
        return;
      }
      let offerText = `*${game.name}*\n\nOfertas disponibles:\n`;
      offers.forEach(o => {
        offerText += `${numberToEmoji(o.number)} ${o.description} — 💳 ${o.price_card} CUP / 📲 ${o.price_mobile} CUP`;
        if (o.price_usd) offerText += ` / 💵 ${o.price_usd} USD`;
        offerText += '\n';
      });
      offerText += '\nResponde con el *número* de la oferta que deseas.';
      await sendWithCancelHint(jid, offerText);
      await updateUserSession(jid, { step: 'awaiting_offer', selected_game: gameNumber });
      break;
    }

    case 'awaiting_offer': {
      const offerNumber = emojiToNumber(text);
      if (!offerNumber) {
        await sendWithCancelHint(jid, '❌ Número no válido. Responde con el número de la oferta.');
        return;
      }
      const game = await getGameByNumber(session.selected_game);
      if (!game) {
        await sendWithCancelHint(jid, '❌ Error: juego no encontrado. Vuelve a empezar.');
        await updateUserSession(jid, { step: 'idle' });
        return;
      }
      const offer = await getOfferByGameAndNumber(game.id, offerNumber);
      if (!offer) {
        await sendWithCancelHint(jid, '❌ Oferta no encontrada. Elige un número de la lista.');
        return;
      }
      await updateUserSession(jid, { step: 'awaiting_payment_method', selected_offer_id: offer.id });
      const cards = await getPaymentMethods('card');
      const mobiles = await getPaymentMethods('mobile');
      let msg = 'Elige el método de pago:\n';
      if (cards.length > 0) msg += '1️⃣ Tarjeta\n';
      if (mobiles.length > 0) msg += '2️⃣ Saldo móvil\n';
      if (cards.length === 0 && mobiles.length === 0) {
        msg = '❌ No hay métodos de pago configurados. Contacta al admin.';
        await sendMessage(jid, msg);
        await updateUserSession(jid, { step: 'idle' });
        return;
      }
      msg += '\nResponde 1 o 2.';
      await sendWithCancelHint(jid, msg);
      break;
    }

    case 'awaiting_payment_method': {
      const method = text.trim();
      if (method !== '1' && method !== '2') {
        await sendWithCancelHint(jid, '❌ Responde 1 para tarjeta o 2 para saldo móvil.');
        return;
      }
      const type = method === '1' ? 'card' : 'mobile';
      const methods = await getPaymentMethods(type);
      if (methods.length === 0) {
        await sendWithCancelHint(jid, '❌ No hay métodos de ese tipo configurados. Intenta con otro.');
        return;
      }
      let list = `Métodos de pago (${type === 'card' ? 'Tarjetas' : 'Saldo móvil'}):\n`;
      methods.forEach(m => {
        list += `${numberToEmoji(m.number)} ${m.label}\n`;
      });
      list += '\nResponde con el número del método que usarás.';
      await sendWithCancelHint(jid, list);
      await updateUserSession(jid, { step: 'awaiting_payment_choice', selected_payment_type: type });
      break;
    }

    case 'awaiting_payment_choice': {
      const choiceNumber = emojiToNumber(text);
      if (!choiceNumber) {
        await sendWithCancelHint(jid, '❌ Número no válido. Elige un número de la lista.');
        return;
      }
      const method = await getPaymentMethodByNumber(session.selected_payment_type, choiceNumber);
      if (!method) {
        await sendWithCancelHint(jid, '❌ Método no encontrado. Intenta de nuevo.');
        return;
      }
      const game = await getGameByNumber(session.selected_game);
      const offer = await getOfferById(session.selected_offer_id);
      if (!game || !offer) {
        await sendWithCancelHint(jid, '❌ Error interno. Vuelve a empezar.');
        await updateUserSession(jid, { step: 'idle' });
        return;
      }

      const requestId = generateRequestId();
      const paymentDetails = method.details;

      let paymentInfo = `🧾 *Solicitud #${requestId}*\n\n`;
      paymentInfo += `🎮 Juego: ${game.name}\n`;
      paymentInfo += `💰 Oferta: ${offer.description}\n`;
      if (method.type === 'card') {
        paymentInfo += `💳 Tarjeta: ${paymentDetails.card_number}\n`;
        paymentInfo += `🔢 Número a confirmar: ${paymentDetails.confirm_number}\n`;
      } else {
        paymentInfo += `📲 Saldo móvil: ${paymentDetails.phone_number}\n`;
      }
      paymentInfo += `\n*Por favor, envía la captura de pantalla del pago realizado.*`;

      await sendMessage(jid, paymentInfo);
      await updateUserSession(jid, {
        step: 'awaiting_screenshot',
        request_id: requestId,
        selected_payment_number: choiceNumber
      });
      break;
    }

    case 'awaiting_screenshot': {
      if (!msg.message?.imageMessage && !msg.message?.documentMessage) {
        await sendWithCancelHint(jid, '❌ Debes enviar una *imagen* (captura de pantalla). Si ya pagaste, envía la foto.');
        return;
      }

      try {
        const stream = await sock.downloadMediaMessage(msg);
        const buffer = [];
        for await (const chunk of stream) {
          buffer.push(chunk);
        }
        const fileBuffer = Buffer.concat(buffer);
        const fileName = `screenshots/${session.request_id}.png`;
        const { error: uploadError } = await supabase.storage
          .from('recargas')
          .upload(fileName, fileBuffer, { contentType: 'image/png', upsert: true });
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('recargas').getPublicUrl(fileName);
        const screenshotUrl = urlData.publicUrl;

        const game = await getGameByNumber(session.selected_game);
        const offer = await getOfferById(session.selected_offer_id);
        const method = await getPaymentMethodByNumber(session.selected_payment_type, session.selected_payment_number);

        await createRequest(session.request_id, {
          user_jid: jid,
          game_name: game.name,
          offer_desc: offer.description,
          payment_method: method.label,
          payment_details: method.details,
          screenshot_url: screenshotUrl,
          status: 'pending'
        });

        let adminMsg = `🔔 *NUEVA SOLICITUD* 🔔\n\n`;
        adminMsg += `ID: ${session.request_id}\n`;
        adminMsg += `Usuario: ${jid.split('@')[0]}\n`;
        adminMsg += `Juego: ${game.name}\n`;
        adminMsg += `Oferta: ${offer.description}\n`;
        adminMsg += `Método: ${method.label}\n`;
        adminMsg += `Captura: ${screenshotUrl}\n\n`;
        adminMsg += `_Para completar, escribe:_\n/completar ${session.request_id}`;
        await sendMessage(ADMIN_JID, adminMsg);

        await sendMessage(jid, `✅ Solicitud #${session.request_id} enviada. Espera la confirmación del admin.`);
        await updateUserSession(jid, { step: 'idle', selected_game: null, selected_offer_id: null, selected_payment_type: null, selected_payment_number: null, request_id: null });
      } catch (err) {
        console.error('Error al procesar captura:', err);
        await sendWithCancelHint(jid, '❌ Ocurrió un error al recibir la captura. Intenta de nuevo o contacta al admin.');
      }
      break;
    }

    default:
      await sendMainMenu(jid);
  }
}

async function handleBack(jid, session) {
  switch (session.step) {
    case 'awaiting_game':
    case 'idle':
      await sendMainMenu(jid);
      break;
    case 'awaiting_offer':
      await sendMainMenu(jid);
      await updateUserSession(jid, { step: 'idle', selected_game: null });
      break;
    case 'awaiting_payment_method':
      {
        const game = await getGameByNumber(session.selected_game);
        if (!game) {
          await sendMainMenu(jid);
          return;
        }
        const offers = await getOffersByGameId(game.id);
        let offerText = `*${game.name}*\n\nOfertas:\n`;
        offers.forEach(o => {
          offerText += `${numberToEmoji(o.number)} ${o.description} — 💳 ${o.price_card} CUP / 📲 ${o.price_mobile} CUP\n`;
        });
        offerText += '\nElige el número de la oferta:';
        await sendWithCancelHint(jid, offerText);
        await updateUserSession(jid, { step: 'awaiting_offer', selected_offer_id: null });
      }
      break;
    case 'awaiting_payment_choice':
      {
        const cards = await getPaymentMethods('card');
        const mobiles = await getPaymentMethods('mobile');
        let msg = 'Elige el método de pago:\n';
        if (cards.length > 0) msg += '1️⃣ Tarjeta\n';
        if (mobiles.length > 0) msg += '2️⃣ Saldo móvil\n';
        msg += '\nResponde 1 o 2.';
        await sendWithCancelHint(jid, msg);
        await updateUserSession(jid, { step: 'awaiting_payment_method', selected_payment_type: null, selected_payment_number: null });
      }
      break;
    case 'awaiting_screenshot':
      await sendWithCancelHint(jid, 'Para cambiar el método de pago, escribe "cancelar" y vuelve a empezar.');
      break;
    default:
      await sendMainMenu(jid);
  }
}

async function sendMainMenu(jid) {
  const games = await getGames();
  if (games.length === 0) {
    await sendMessage(jid, '📭 No hay juegos disponibles en este momento. Contacta al admin.');
    return;
  }
  let menu = '🛒 *RECARGAS DE JUEGOS* 🛒\n\nElige un juego:\n';
  games.forEach(g => {
    menu += `${numberToEmoji(g.number)} ${g.name}\n`;
  });
  menu += '\n_Responde con el número del juego._\n_Si necesitas cancelar, escribe "cancelar"._';
  await sendMessage(jid, menu);
}

// ========== COMANDOS DE ADMIN ==========
async function handleAdminCommand(msg, jid, text) {
  const lower = text.trim().toLowerCase();
  const parts = text.trim().split(/\s+/);
  const command = parts[0].toLowerCase();

  // Comandos de creación (diálogos)
  if (command === '/crear' && parts[1] === 'tarjeta') {
    await setAdminDialog(jid, 'crear_tarjeta', 1, {});
    await sendMessage(jid, '✏️ Envíame el *número de menú* para esta tarjeta (ej: 1️⃣ o 1):');
    return;
  }
  if (command === '/crear' && parts[1] === 'saldo') {
    await setAdminDialog(jid, 'crear_saldo', 1, {});
    await sendMessage(jid, '✏️ Envíame el *número de menú* para este saldo móvil (ej: 1️⃣ o 1):');
    return;
  }
  if (command === '/crear' && parts[1] === 'tabla') {
    await setAdminDialog(jid, 'crear_tabla', 1, { lines: [] });
    await sendMessage(jid, '✏️ Envía la lista de juegos en el formato:\n1️⃣ Free Fire\n2️⃣ Roblox\n...\nCuando termines, escribe /listo');
    return;
  }
  if (command === '/añadir' && parts[1] === 'juego' && parts[2] === 'a' && parts[3]) {
    const gameNumber = emojiToNumber(parts[3]);
    if (!gameNumber) {
      await sendMessage(jid, '❌ Debes especificar el número del juego. Ej: /añadir juego a 1');
      return;
    }
    const game = await getGameByNumber(gameNumber);
    if (!game) {
      await sendMessage(jid, '❌ Ese juego no existe.');
      return;
    }
    await setAdminDialog(jid, 'anadir_ofertas', 1, { game_id: game.id, game_number: gameNumber, offers: [] });
    await sendMessage(jid, `✏️ Agregando ofertas para *${game.name}*. Envía cada oferta en el formato:\n1️⃣ 110 💎 250 700\n(número, descripción, precio móvil, precio tarjeta, precio USD opcional)\nCuando termines, escribe /fin`);
    return;
  }

  // Comandos de edición
  if (command === '/editar' && parts[1] === 'juego' && parts[2]) {
    const gameNumber = emojiToNumber(parts[2]);
    const game = await getGameByNumber(gameNumber);
    if (!game) {
      await sendMessage(jid, '❌ Juego no encontrado.');
      return;
    }
    await setAdminDialog(jid, 'editar_juego', 1, { game_id: game.id, game_number: gameNumber });
    await sendMessage(jid, `✏️ Editando juego *${game.name}*. Envía el nuevo nombre (o escribe "cancelar"):`);
    return;
  }
  if (command === '/editar' && parts[1] === 'oferta' && parts[2] && parts[3]) {
    const gameNumber = emojiToNumber(parts[2]);
    const offerNumber = emojiToNumber(parts[3]);
    const game = await getGameByNumber(gameNumber);
    if (!game) {
      await sendMessage(jid, '❌ Juego no encontrado.');
      return;
    }
    const offer = await getOfferByGameAndNumber(game.id, offerNumber);
    if (!offer) {
      await sendMessage(jid, '❌ Oferta no encontrada.');
      return;
    }
    await setAdminDialog(jid, 'editar_oferta', 1, { offer_id: offer.id, game_name: game.name });
    await sendMessage(jid, `✏️ Editando oferta *${offer.description}*. Envía la nueva descripción (o escribe "cancelar"):`);
    return;
  }
  if (command === '/editar' && (parts[1] === 'tarjeta' || parts[1] === 'saldo') && parts[2]) {
    const type = parts[1] === 'tarjeta' ? 'card' : 'mobile';
    const methodNumber = emojiToNumber(parts[2]);
    const method = await getPaymentMethodByNumber(type, methodNumber);
    if (!method) {
      await sendMessage(jid, '❌ Método de pago no encontrado.');
      return;
    }
    await setAdminDialog(jid, 'editar_metodo', 1, { method_id: method.id, type, method_number: methodNumber });
    await sendMessage(jid, `✏️ Editando método *${method.label}*. Envía la nueva etiqueta (o escribe "cancelar"):`);
    return;
  }

  // Comandos de listado
  if (command === '/listar' && parts[1] === 'juegos') {
    const games = await getGames();
    if (games.length === 0) {
      await sendMessage(jid, 'No hay juegos.');
      return;
    }
    let reply = '*Juegos:*\n';
    games.forEach(g => reply += `${numberToEmoji(g.number)} ${g.name} (ID: ${g.id})\n`);
    await sendMessage(jid, reply);
    return;
  }
  if (command === '/listar' && parts[1] === 'ofertas' && parts[2]) {
    const gameNumber = emojiToNumber(parts[2]);
    const game = await getGameByNumber(gameNumber);
    if (!game) {
      await sendMessage(jid, '❌ Juego no encontrado.');
      return;
    }
    const offers = await getOffersByGameId(game.id);
    if (offers.length === 0) {
      await sendMessage(jid, 'No hay ofertas para este juego.');
      return;
    }
    let reply = `*Ofertas de ${game.name}:*\n`;
    offers.forEach(o => {
      reply += `${numberToEmoji(o.number)} ${o.description} — 💳 ${o.price_card} / 📲 ${o.price_mobile}`;
      if (o.price_usd) reply += ` / 💵 ${o.price_usd}`;
      reply += ` (ID oferta: ${o.id})\n`;
    });
    await sendMessage(jid, reply);
    return;
  }
  if (command === '/listar' && parts[1] === 'metodos') {
    const cards = await getPaymentMethods('card');
    const mobiles = await getPaymentMethods('mobile');
    let reply = '*Métodos de pago:*\n';
    if (cards.length) {
      reply += '\n💳 Tarjetas:\n';
      cards.forEach(c => reply += `${numberToEmoji(c.number)} ${c.label} (ID: ${c.id})\n`);
    }
    if (mobiles.length) {
      reply += '\n📲 Saldo móvil:\n';
      mobiles.forEach(m => reply += `${numberToEmoji(m.number)} ${m.label} (ID: ${m.id})\n`);
    }
    if (!cards.length && !mobiles.length) reply += 'No hay métodos configurados.';
    await sendMessage(jid, reply);
    return;
  }

  // Comandos de borrado
  if (command === '/borrar' && parts[1] === 'juego' && parts[2]) {
    const gameNumber = emojiToNumber(parts[2]);
    const game = await getGameByNumber(gameNumber);
    if (!game) {
      await sendMessage(jid, '❌ Juego no encontrado.');
      return;
    }
    await deleteGame(game.id);
    await sendMessage(jid, `✅ Juego *${game.name}* eliminado.`);
    return;
  }
  if (command === '/borrar' && parts[1] === 'oferta' && parts[2] && parts[3]) {
    const gameNumber = emojiToNumber(parts[2]);
    const offerNumber = emojiToNumber(parts[3]);
    const game = await getGameByNumber(gameNumber);
    if (!game) {
      await sendMessage(jid, '❌ Juego no encontrado.');
      return;
    }
    const offer = await getOfferByGameAndNumber(game.id, offerNumber);
    if (!offer) {
      await sendMessage(jid, '❌ Oferta no encontrada.');
      return;
    }
    await deleteOffer(offer.id);
    await sendMessage(jid, `✅ Oferta *${offer.description}* eliminada.`);
    return;
  }
  if (command === '/borrar' && (parts[1] === 'tarjeta' || parts[1] === 'saldo') && parts[2]) {
    const type = parts[1] === 'tarjeta' ? 'card' : 'mobile';
    const methodNumber = emojiToNumber(parts[2]);
    const method = await getPaymentMethodByNumber(type, methodNumber);
    if (!method) {
      await sendMessage(jid, '❌ Método no encontrado.');
      return;
    }
    await deletePaymentMethod(method.id);
    await sendMessage(jid, `✅ Método *${method.label}* eliminado.`);
    return;
  }

  // Completar solicitud
  if (command === '/completar' && parts[1]) {
    const requestId = parts[1];
    const request = await getRequest(requestId);
    if (!request) {
      await sendMessage(jid, '❌ Solicitud no encontrada.');
      return;
    }
    if (request.status === 'completed') {
      await sendMessage(jid, '❌ Esta solicitud ya fue completada.');
      return;
    }
    await completeRequest(requestId);
    await sendMessage(request.user_jid, `✅ ¡Tu recarga de *${request.game_name}* - *${request.offer_desc}* se ha completado! Gracias.`);
    await sendMessage(jid, `✅ Solicitud ${requestId} marcada como completada y usuario notificado.`);
    return;
  }

  // Cancelar diálogo
  if (command === '/cancelar') {
    await clearAdminDialog(jid);
    await sendMessage(jid, '✅ Diálogo cancelado.');
    return;
  }

  await sendMessage(jid, '❌ Comando no reconocido. Usa /crear tarjeta, /crear saldo, /crear tabla, /añadir juego a #, /editar juego #, /editar oferta # #, /editar tarjeta #, /editar saldo #, /listar juegos, /listar ofertas #, /listar metodos, /borrar juego #, /borrar oferta # #, /borrar tarjeta #, /borrar saldo #, /completar ID');
}

// ========== MANEJO DE DIÁLOGOS DEL ADMIN ==========
async function handleAdminDialog(msg, jid, text) {
  const dialog = await getAdminDialog(jid);
  if (!dialog) return false;

  const lower = text.trim().toLowerCase();
  if (lower === 'cancelar') {
    await clearAdminDialog(jid);
    await sendMessage(jid, '✅ Diálogo cancelado.');
    return true;
  }

  switch (dialog.command) {
    case 'crear_tarjeta':
      return handleCreateCardDialog(jid, dialog, text);
    case 'crear_saldo':
      return handleCreateMobileDialog(jid, dialog, text);
    case 'crear_tabla':
      return handleCreateTableDialog(jid, dialog, text);
    case 'anadir_ofertas':
      return handleAddOffersDialog(jid, dialog, text);
    case 'editar_juego':
      return handleEditGameDialog(jid, dialog, text);
    case 'editar_oferta':
      return handleEditOfferDialog(jid, dialog, text);
    case 'editar_metodo':
      return handleEditMethodDialog(jid, dialog, text);
    default:
      await clearAdminDialog(jid);
      return false;
  }
}

async function handleCreateCardDialog(jid, dialog, text) {
  if (dialog.step === 1) {
    const number = emojiToNumber(text);
    if (!number) {
      await sendMessage(jid, '❌ Número inválido. Intenta de nuevo o escribe "cancelar".');
      return true;
    }
    dialog.data.number = number;
    dialog.step = 2;
    await setAdminDialog(jid, dialog.command, dialog.step, dialog.data);
    await sendMessage(jid, '✏️ Envíame la *etiqueta* o descripción corta (ej: "Tarjeta Banco Metropolitano"):');
    return true;
  }
  if (dialog.step === 2) {
    dialog.data.label = text;
    dialog.step = 3;
    await setAdminDialog(jid, dialog.command, dialog.step, dialog.data);
    await sendMessage(jid, '✏️ Envíame el *número de tarjeta* (solo dígitos):');
    return true;
  }
  if (dialog.step === 3) {
    dialog.data.card_number = text.replace(/\s+/g, '');
    dialog.step = 4;
    await setAdminDialog(jid, dialog.command, dialog.step, dialog.data);
    await sendMessage(jid, '✏️ Envíame el *número a confirmar*:');
    return true;
  }
  if (dialog.step === 4) {
    dialog.data.confirm_number = text;
    try {
      await createPaymentMethod('card', dialog.data.number, dialog.data.label, {
        card_number: dialog.data.card_number,
        confirm_number: dialog.data.confirm_number
      });
      await sendMessage(jid, `✅ Tarjeta guardada con número ${numberToEmoji(dialog.data.number)}.`);
    } catch (err) {
      await sendMessage(jid, `❌ Error al guardar: ${err.message}`);
    }
    await clearAdminDialog(jid);
    return true;
  }
  return false;
}

async function handleCreateMobileDialog(jid, dialog, text) {
  if (dialog.step === 1) {
    const number = emojiToNumber(text);
    if (!number) {
      await sendMessage(jid, '❌ Número inválido. Intenta de nuevo.');
      return true;
    }
    dialog.data.number = number;
    dialog.step = 2;
    await setAdminDialog(jid, dialog.command, dialog.step, dialog.data);
    await sendMessage(jid, '✏️ Envíame la *etiqueta* (ej: "Saldo móvil - Cubacel"):');
    return true;
  }
  if (dialog.step === 2) {
    dialog.data.label = text;
    dialog.step = 3;
    await setAdminDialog(jid, dialog.command, dialog.step, dialog.data);
    await sendMessage(jid, '✏️ Envíame el *número de teléfono* (solo dígitos):');
    return true;
  }
  if (dialog.step === 3) {
    dialog.data.phone_number = text.replace(/\s+/g, '');
    try {
      await createPaymentMethod('mobile', dialog.data.number, dialog.data.label, {
        phone_number: dialog.data.phone_number
      });
      await sendMessage(jid, `✅ Saldo móvil guardado con número ${numberToEmoji(dialog.data.number)}.`);
    } catch (err) {
      await sendMessage(jid, `❌ Error al guardar: ${err.message}`);
    }
    await clearAdminDialog(jid);
    return true;
  }
  return false;
}

async function handleCreateTableDialog(jid, dialog, text) {
  if (dialog.step === 1) {
    if (text.toLowerCase() === '/listo') {
      const lines = dialog.data.lines;
      if (lines.length === 0) {
        await sendMessage(jid, '❌ No se recibió ninguna línea. Cancelando.');
        await clearAdminDialog(jid);
        return true;
      }
      let success = 0;
      for (const line of lines) {
        const match = line.match(/^([0-9️⃣🔟]+)\s+(.+)$/);
        if (match) {
          const num = emojiToNumber(match[1]);
          const name = match[2].trim();
          if (num && name) {
            try {
              await createGame(num, name);
              success++;
            } catch (err) {
              await sendMessage(jid, `⚠️ Error al crear juego "${name}": ${err.message}`);
            }
          }
        }
      }
      await sendMessage(jid, `✅ Se crearon ${success} juegos.`);
      await clearAdminDialog(jid);
      return true;
    } else {
      dialog.data.lines.push(text);
      await setAdminDialog(jid, dialog.command, dialog.step, dialog.data);
      await sendMessage(jid, '✅ Línea agregada. Envía más líneas o escribe /listo para terminar.');
      return true;
    }
  }
  return false;
}

async function handleAddOffersDialog(jid, dialog, text) {
  if (dialog.step === 1) {
    if (text.toLowerCase() === '/fin') {
      const offers = dialog.data.offers;
      if (offers.length === 0) {
        await sendMessage(jid, '❌ No se agregó ninguna oferta.');
        await clearAdminDialog(jid);
        return true;
      }
      let success = 0;
      for (const off of offers) {
        try {
          await createOffer(dialog.data.game_id, off.number, off.desc, off.mobile, off.card, off.usd);
          success++;
        } catch (err) {
          await sendMessage(jid, `⚠️ Error al crear oferta "${off.desc}": ${err.message}`);
        }
      }
      await sendMessage(jid, `✅ Se agregaron ${success} ofertas para el juego.`);
      await clearAdminDialog(jid);
      return true;
    } else {
      const parts = text.trim().split(/\s+/);
      if (parts.length < 4) {
        await sendMessage(jid, '❌ Formato incorrecto. Debe ser: número descripción precio_móvil precio_tarjeta [precio_usd]. Ej: 1️⃣ 110 💎 250 700');
        return true;
      }
      const number = emojiToNumber(parts[0]);
      if (!number) {
        await sendMessage(jid, '❌ Número de oferta inválido.');
        return true;
      }
      let idx = parts.length - 1;
      let usd = null;
      let card, mobile;
      if (!isNaN(parseFloat(parts[idx])) && isFinite(parts[idx])) {
        usd = parseFloat(parts[idx]);
        idx--;
      }
      if (idx >= 2) {
        card = parseInt(parts[idx], 10);
        idx--;
        mobile = parseInt(parts[idx], 10);
        idx--;
      } else {
        await sendMessage(jid, '❌ No se encontraron precios válidos.');
        return true;
      }
      const desc = parts.slice(1, idx + 1).join(' ');
      dialog.data.offers.push({
        number,
        desc,
        mobile,
        card,
        usd
      });
      await setAdminDialog(jid, dialog.command, dialog.step, dialog.data);
      await sendMessage(jid, `✅ Oferta "${desc}" agregada. Puedes enviar otra o /fin.`);
      return true;
    }
  }
  return false;
}

async function handleEditGameDialog(jid, dialog, text) {
  if (dialog.step === 1) {
    const newName = text.trim();
    if (!newName) {
      await sendMessage(jid, '❌ El nombre no puede estar vacío.');
      return true;
    }
    try {
      await updateGame(dialog.data.game_id, { name: newName });
      await sendMessage(jid, `✅ Juego actualizado a *${newName}*.`);
    } catch (err) {
      await sendMessage(jid, `❌ Error al actualizar: ${err.message}`);
    }
    await clearAdminDialog(jid);
    return true;
  }
  return false;
}

async function handleEditOfferDialog(jid, dialog, text) {
  if (dialog.step === 1) {
    dialog.data.new_desc = text;
    dialog.step = 2;
    await setAdminDialog(jid, dialog.command, dialog.step, dialog.data);
    await sendMessage(jid, '✏️ Envía el nuevo *precio móvil* (solo números):');
    return true;
  }
  if (dialog.step === 2) {
    const mobile = parseInt(text, 10);
    if (isNaN(mobile)) {
      await sendMessage(jid, '❌ Precio inválido.');
      return true;
    }
    dialog.data.new_mobile = mobile;
    dialog.step = 3;
    await setAdminDialog(jid, dialog.command, dialog.step, dialog.data);
    await sendMessage(jid, '✏️ Envía el nuevo *precio tarjeta* (solo números):');
    return true;
  }
  if (dialog.step === 3) {
    const card = parseInt(text, 10);
    if (isNaN(card)) {
      await sendMessage(jid, '❌ Precio inválido.');
      return true;
    }
    dialog.data.new_card = card;
    dialog.step = 4;
    await setAdminDialog(jid, dialog.command, dialog.step, dialog.data);
    await sendMessage(jid, '✏️ Envía el nuevo *precio USD* (opcional, escribe 0 si no aplica):');
    return true;
  }
  if (dialog.step === 4) {
    let usd = null;
    if (text !== '0' && text.trim() !== '') {
      usd = parseFloat(text);
      if (isNaN(usd)) {
        await sendMessage(jid, '❌ Precio USD inválido.');
        return true;
      }
    }
    try {
      await updateOffer(dialog.data.offer_id, {
        description: dialog.data.new_desc,
        price_mobile: dialog.data.new_mobile,
        price_card: dialog.data.new_card,
        price_usd: usd
      });
      await sendMessage(jid, '✅ Oferta actualizada correctamente.');
    } catch (err) {
      await sendMessage(jid, `❌ Error al actualizar: ${err.message}`);
    }
    await clearAdminDialog(jid);
    return true;
  }
  return false;
}

async function handleEditMethodDialog(jid, dialog, text) {
  if (dialog.step === 1) {
    dialog.data.new_label = text;
    dialog.step = 2;
    await setAdminDialog(jid, dialog.command, dialog.step, dialog.data);
    if (dialog.data.type === 'card') {
      await sendMessage(jid, '✏️ Envía el nuevo *número de tarjeta*:');
    } else {
      await sendMessage(jid, '✏️ Envía el nuevo *número de teléfono*:');
    }
    return true;
  }
  if (dialog.step === 2) {
    const method = await getPaymentMethodById(dialog.data.method_id);
    if (!method) {
      await sendMessage(jid, '❌ Método no encontrado.');
      await clearAdminDialog(jid);
      return true;
    }
    const newDetails = { ...method.details };
    if (dialog.data.type === 'card') {
      newDetails.card_number = text.replace(/\s+/g, '');
      dialog.step = 3;
      await setAdminDialog(jid, dialog.command, dialog.step, dialog.data);
      await sendMessage(jid, '✏️ Envía el nuevo *número a confirmar*:');
      return true;
    } else {
      newDetails.phone_number = text.replace(/\s+/g, '');
      try {
        await updatePaymentMethod(dialog.data.method_id, { label: dialog.data.new_label, details: newDetails });
        await sendMessage(jid, '✅ Método actualizado.');
      } catch (err) {
        await sendMessage(jid, `❌ Error: ${err.message}`);
      }
      await clearAdminDialog(jid);
      return true;
    }
  }
  if (dialog.step === 3) {
    const method = await getPaymentMethodById(dialog.data.method_id);
    if (!method) {
      await sendMessage(jid, '❌ Método no encontrado.');
      await clearAdminDialog(jid);
      return true;
    }
    const newDetails = { ...method.details, confirm_number: text };
    try {
      await updatePaymentMethod(dialog.data.method_id, { label: dialog.data.new_label, details: newDetails });
      await sendMessage(jid, '✅ Tarjeta actualizada.');
    } catch (err) {
      await sendMessage(jid, `❌ Error: ${err.message}`);
    }
    await clearAdminDialog(jid);
    return true;
  }
  return false;
}

// ========== INICIO DEL BOT ==========
async function startBot() {
  console.log('🚀 Iniciando Bot de Recargas...');

  const { state, saveCreds } = await useSupabaseAuthState();
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger,
    browser: ['RecargasBot', 'Chrome', '1.0'],
    syncFullHistory: false,
    connectTimeoutMs: 60000
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) latestQR = qr;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`❌ Conexión cerrada. Reconectar: ${shouldReconnect}`);
      if (shouldReconnect) setTimeout(startBot, 5000);
    }
    if (connection === 'open') {
      console.log('✅ Bot conectado a WhatsApp');
      latestQR = null;
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        const remoteJid = msg.key.remoteJid;
        const participant = msg.key.participant || remoteJid;
        const pushName = msg.pushName || '';
        const text = extractText(msg);
        
        // Log detallado
        console.log(`\n📩 Mensaje recibido:`);
        console.log(`   De: ${participant} (${pushName || 'sin nombre'})`);
        console.log(`   Chat: ${remoteJid} (${remoteJid.endsWith('@s.whatsapp.net') ? 'privado' : 'grupo'})`);
        console.log(`   Tipo: ${msg.message ? Object.keys(msg.message)[0] : 'desconocido'}`);
        console.log(`   Texto: ${text || '(sin texto)'}`);

        // Solo procesamos mensajes privados
        if (!remoteJid.endsWith('@s.whatsapp.net')) {
          console.log('   ⚠️ Ignorado: no es chat privado');
          continue;
        }

        // Comando especial para obtener el propio JID
        if (text && text.trim() === '/mid') {
          await sendMessage(remoteJid, `Tu ID es: \`${participant}\``);
          continue;
        }

        const isAdmin = (participant === ADMIN_JID);

        // Si es admin y hay un diálogo activo, procesarlo
        if (isAdmin) {
          const handled = await handleAdminDialog(msg, remoteJid, text);
          if (handled) continue;
        }

        // Si es admin y comienza con /, comando
        if (isAdmin && text && text.startsWith('/')) {
          await handleAdminCommand(msg, remoteJid, text);
          continue;
        }

        // Cliente normal
        if (!isAdmin) {
          await handleClientMessage(msg, remoteJid, text);
        }
      } catch (err) {
        console.error('Error procesando mensaje:', err);
      }
    }
  });
}

// Servidor web para QR
const app = express();
app.get('/', (req, res) => res.send('Bot de Recargas activo 🤖'));
app.get('/qr', async (req, res) => {
  if (!latestQR) return res.send('<p>Bot ya conectado o generando QR... refresca en 10s.</p>');
  try {
    const qrImage = await QRCode.toDataURL(latestQR);
    res.send(`<img src="${qrImage}" />`);
  } catch (err) {
    res.status(500).send('Error generando QR');
  }
});
app.listen(PORT, () => console.log(`🌐 Servidor web en puerto ${PORT}`));

// Manejo de cierre
process.on('SIGINT', () => { console.log('Cerrando...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('Cerrando...'); process.exit(0); });

startBot().catch(console.error);
