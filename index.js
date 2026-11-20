const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const sharp = require('sharp');
const { JSDOM } = require('jsdom');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('Не задан BOT_TOKEN. Запуск: BOT_TOKEN=<токен> node index.js');
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Шоу, за которым следим: «Новогодняя акватория», Белгосцирк, 12.12.2026 — 17.01.2027
const SHOW = {
    title: 'Новогодняя акватория',
    pageUrl: 'https://ticketpro.by/ru/event/bilety-na-novogodnyaya-akvatoriya',
    // Внешний id группы сеансов: по нему REST API отдаёт её uuid
    groupExternalId: 50809,
    // Стартовые значения: оба переопределяются автоматически, если сайт их поменял
    groupId: 'da8a6f20-c8a5-32da-a260-e5383d306054',
    scheduleActionId: '60827b0d279f8c0d35d79e759a087eea26bdef5e59',
    // Публичный REST виджета — он переживает редизайны сайта
    widgetApi: 'https://api.ticketpro.by/ticketpro/widget/api/v1',
    // Окно для перебора id сеансов, когда расписание со страницы недоступно
    probeFrom: 50810,
    probeTo: 50900
};

// Оба идентификатора живут только в памяти: сайт меняет их при каждом деплое
let scheduleActionId = SHOW.scheduleActionId;
let groupId = SHOW.groupId;
// Сеансы, которых больше нет в продаже: API отвечает 422, спрашивать их незачем
const deadSessions = new Set();

// Расписание на случай, если сайт недоступен или сменил формат ответа
const FALLBACK_SESSIONS = [
    { id: 50810, start: '2026-12-12T11:00:00' },
    { id: 50811, start: '2026-12-12T19:00:00' },
    { id: 50812, start: '2026-12-13T11:00:00' },
    { id: 50813, start: '2026-12-13T15:00:00' },
    { id: 50814, start: '2026-12-13T19:00:00' },
    { id: 50815, start: '2026-12-15T19:00:00' },
    { id: 50816, start: '2026-12-16T19:00:00' },
    { id: 50817, start: '2026-12-17T19:00:00' },
    { id: 50818, start: '2026-12-18T19:00:00' },
    { id: 50819, start: '2026-12-19T15:00:00' },
    { id: 50820, start: '2026-12-19T19:00:00' },
    { id: 50821, start: '2026-12-20T11:00:00' },
    { id: 50822, start: '2026-12-20T15:00:00' },
    { id: 50823, start: '2026-12-20T19:00:00' },
    { id: 50825, start: '2026-12-22T15:00:00' },
    { id: 50826, start: '2026-12-22T19:00:00' },
    { id: 50827, start: '2026-12-23T15:00:00' },
    { id: 50828, start: '2026-12-23T19:00:00' },
    { id: 50829, start: '2026-12-24T15:00:00' },
    { id: 50830, start: '2026-12-24T19:00:00' },
    { id: 50831, start: '2026-12-25T11:00:00' },
    { id: 50832, start: '2026-12-25T15:00:00' },
    { id: 50833, start: '2026-12-25T19:00:00' },
    { id: 50834, start: '2026-12-26T11:00:00' },
    { id: 50835, start: '2026-12-26T15:00:00' },
    { id: 50836, start: '2026-12-26T19:00:00' },
    { id: 50837, start: '2026-12-27T11:00:00' },
    { id: 50838, start: '2026-12-27T15:00:00' },
    { id: 50839, start: '2026-12-27T19:00:00' },
    { id: 50840, start: '2026-12-28T15:00:00' },
    { id: 50841, start: '2026-12-28T19:00:00' },
    { id: 50842, start: '2026-12-29T11:00:00' },
    { id: 50843, start: '2026-12-29T15:00:00' },
    { id: 50844, start: '2026-12-29T19:00:00' },
    { id: 50845, start: '2026-12-30T11:00:00' },
    { id: 50846, start: '2026-12-30T15:00:00' },
    { id: 50847, start: '2026-12-30T19:00:00' },
    { id: 50848, start: '2026-12-31T11:00:00' },
    { id: 50849, start: '2026-12-31T15:00:00' },
    { id: 50850, start: '2026-12-31T19:00:00' },
    { id: 50851, start: '2026-12-28T11:00:00' },
    { id: 50852, start: '2027-01-02T11:00:00' },
    { id: 50853, start: '2027-01-02T15:00:00' },
    { id: 50854, start: '2027-01-02T19:00:00' },
    { id: 50855, start: '2027-01-03T11:00:00' },
    { id: 50856, start: '2027-01-03T15:00:00' },
    { id: 50857, start: '2027-01-03T19:00:00' },
    { id: 50858, start: '2027-01-04T11:00:00' },
    { id: 50859, start: '2027-01-04T15:00:00' },
    { id: 50860, start: '2027-01-04T19:00:00' },
    { id: 50861, start: '2027-01-05T11:00:00' },
    { id: 50862, start: '2027-01-05T15:00:00' },
    { id: 50863, start: '2027-01-05T19:00:00' },
    { id: 50864, start: '2027-01-06T11:00:00' },
    { id: 50865, start: '2027-01-06T15:00:00' },
    { id: 50866, start: '2027-01-06T19:00:00' },
    { id: 50867, start: '2027-01-07T11:00:00' },
    { id: 50868, start: '2027-01-07T15:00:00' },
    { id: 50869, start: '2027-01-07T19:00:00' },
    { id: 50870, start: '2027-01-08T11:00:00' },
    { id: 50871, start: '2027-01-08T15:00:00' },
    { id: 50872, start: '2027-01-08T19:00:00' },
    { id: 50873, start: '2027-01-09T11:00:00' },
    { id: 50874, start: '2027-01-09T15:00:00' },
    { id: 50875, start: '2027-01-09T19:00:00' },
    { id: 50876, start: '2027-01-10T11:00:00' },
    { id: 50877, start: '2027-01-10T15:00:00' },
    { id: 50878, start: '2027-01-10T19:00:00' },
    { id: 50879, start: '2027-01-13T19:00:00' },
    { id: 50880, start: '2027-01-15T19:00:00' },
    { id: 50881, start: '2027-01-16T11:00:00' },
    { id: 50882, start: '2027-01-16T15:00:00' },
    { id: 50883, start: '2027-01-16T19:00:00' },
    { id: 50884, start: '2027-01-17T11:00:00' },
    { id: 50885, start: '2027-01-17T15:00:00' },
];

const WIDGET_ID = 9;
const SCHEDULE_TTL_MS = 30 * 60 * 1000; // как часто перечитывать расписание с сайта
const CHECK_DELAY_MS = 2000;            // пауза между запросами схем залов
const CYCLE_INTERVAL_MS = 300000;       // интервал запуска цикла проверки: круг по всем сеансам идёт ~6 минут
const NOTIFY_COOLDOWN_MS = 15 * 60 * 1000; // не чаще одного уведомления по сеансу на чат
const MIN_SEATS_TO_REPORT = 3;          // сеанс интересен, только если мест больше
const MESSAGE_LIMIT = 3500;             // мягкий лимит длины сообщения Telegram
const SEATS_IN_CAPTION = 12;            // сколько мест перечислять в уведомлении
// Соседние места в ряду отстоят на 44–62 единицы схемы при радиусе 17.21,
// пропущенное место даёт уже 90+, поэтому запас в 4.5 радиуса безопасен
const ADJACENT_GAP_FACTOR = 4.5;

// Уровни в атрибуте name у кружка места: "2:<сектор>/3:<ряд>/4:<место>"
const LEVEL_SECTOR = '2';
const LEVEL_BOX = '26';
const LEVEL_ROW = '3';
const LEVEL_SEAT = '4';

// chatId -> { filters, awaiting }
const subscribers = new Map();
// Текущая картина по сеансам: id -> result
const currentResults = new Map();
// Что уже отправляли: `${chatId}:${eventId}` -> { ids: Set, at: timestamp }
const lastNotified = new Map();
// Актуальный список сеансов шоу
let sessions = [];
let sessionsFetchedAt = 0;
// Глобальный цикл проверки
let globalCheckInterval = null;
let isCheckRunning = false;
// Первый цикл после старта отдаём одним сводным сообщением, дальше — по одному изменению
let firstCycleDone = false;

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk',
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
});

const shortDateFormatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk',
    day: 'numeric',
    month: 'short'
});

// ─────────────────────────── состояние подписок ───────────────────────────

const STATE_REPO = process.env.STATE_REPO || '';
const STATE_PATH = process.env.STATE_PATH || 'state/subscribers.json';
const STATE_BRANCH = process.env.STATE_BRANCH || 'master';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
// Состояние содержит chat id подписчиков, поэтому в репозиторий пишется зашифрованным
const STATE_KEY = process.env.STATE_KEY || '';
const LOCAL_STATE_FILE = path.join(__dirname, 'state', 'subscribers.json');

const useRemoteState = Boolean(STATE_REPO && GITHUB_TOKEN);
let remoteStateSha = null;
let saveTimer = null;

function defaultFilters() {
    return { from: null, to: null, sectors: [], rowFrom: null, rowTo: null, minAdjacent: null };
}

function stateKey() {
    return crypto.createHash('sha256').update(STATE_KEY).digest();
}

function encryptState(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', stateKey(), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

    return JSON.stringify({
        v: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64')
    }, null, 2);
}

function decryptState(raw) {
    const box = JSON.parse(raw);
    const decipher = crypto.createDecipheriv('aes-256-gcm', stateKey(), Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));

    return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}

function isEncrypted(raw) {
    try {
        const box = JSON.parse(raw);
        return Boolean(box) && box.v === 1 && typeof box.data === 'string' && typeof box.iv === 'string';
    } catch (error) {
        return false;
    }
}

function serializeState() {
    const chats = [];
    for (const [chatId, entry] of subscribers) {
        chats.push({ chatId, filters: entry.filters });
    }
    const plain = JSON.stringify({ chats }, null, 2);

    return STATE_KEY ? encryptState(plain) : plain;
}

function applyState(raw) {
    let parsed;
    let content = raw;

    if (isEncrypted(raw)) {
        if (!STATE_KEY) {
            console.error('⚠️ Состояние зашифровано, но STATE_KEY не задан — начинаю с пустого');
            return;
        }

        try {
            content = decryptState(raw);
        } catch (error) {
            console.error('⚠️ Не удалось расшифровать состояние:', error.message);
            return;
        }
    }

    try {
        parsed = JSON.parse(content);
    } catch (error) {
        console.error('⚠️ Состояние повреждено, начинаю с пустого:', error.message);
        return;
    }

    (parsed.chats || []).forEach(chat => {
        subscribers.set(chat.chatId, {
            filters: { ...defaultFilters(), ...(chat.filters || {}) },
            awaiting: null
        });
    });

    console.log(`💾 Восстановлено подписок: ${subscribers.size}`);
}

async function loadState() {
    if (useRemoteState) {
        try {
            const response = await axios.get(
                `https://api.github.com/repos/${STATE_REPO}/contents/${STATE_PATH}`,
                {
                    params: { ref: STATE_BRANCH },
                    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
                    timeout: 20000
                }
            );
            remoteStateSha = response.data.sha;
            applyState(Buffer.from(response.data.content, 'base64').toString('utf8'));
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log('💾 Файл состояния ещё не создан');
            } else {
                console.error('⚠️ Не удалось прочитать состояние из репозитория:', error.message);
            }
        }
        return;
    }

    try {
        applyState(fs.readFileSync(LOCAL_STATE_FILE, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('⚠️ Не удалось прочитать локальное состояние:', error.message);
        }
    }
}

async function writeState() {
    if (useRemoteState && !STATE_KEY) {
        console.error('⚠️ STATE_KEY не задан — не записываю состояние в репозиторий, чтобы chat id не попали в открытые коммиты');
        return;
    }

    const content = serializeState();

    if (!useRemoteState) {
        try {
            fs.mkdirSync(path.dirname(LOCAL_STATE_FILE), { recursive: true });
            fs.writeFileSync(LOCAL_STATE_FILE, content);
        } catch (error) {
            console.error('⚠️ Не удалось сохранить состояние локально:', error.message);
        }
        return;
    }

    // Ветку могли переписать или файл изменить параллельно: при отказе перечитываем sha и пробуем ещё раз
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await axios.put(
                `https://api.github.com/repos/${STATE_REPO}/contents/${STATE_PATH}`,
                {
                    message: 'chore: обновление подписок бота',
                    content: Buffer.from(content, 'utf8').toString('base64'),
                    branch: STATE_BRANCH,
                    ...(remoteStateSha ? { sha: remoteStateSha } : {})
                },
                {
                    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
                    timeout: 20000
                }
            );
            remoteStateSha = response.data.content.sha;
            return;
        } catch (error) {
            if (attempt === 0) {
                await refreshRemoteStateSha();
                continue;
            }
            console.error('⚠️ Не удалось сохранить состояние в репозиторий:', error.message);
        }
    }
}

// Актуальный sha файла состояния: без него GitHub отклоняет перезапись
async function refreshRemoteStateSha() {
    try {
        const response = await axios.get(
            `https://api.github.com/repos/${STATE_REPO}/contents/${STATE_PATH}`,
            {
                params: { ref: STATE_BRANCH },
                headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
                timeout: 20000
            }
        );
        remoteStateSha = response.data.sha;
    } catch (error) {
        remoteStateSha = null;
    }
}

// Пишем не чаще раза в несколько секунд, чтобы не плодить коммиты
function saveState() {
    if (saveTimer) {
        return;
    }

    saveTimer = setTimeout(() => {
        saveTimer = null;
        writeState().catch(error => console.error('⚠️ Ошибка сохранения состояния:', error.message));
    }, 5000);
}

// ─────────────────────────── расписание и места ───────────────────────────

// Время сеанса на сайте указано по Минску без зоны
function sessionDate(session) {
    return new Date(`${session.start}+03:00`);
}

function sessionDay(session) {
    return session.start.slice(0, 10);
}

function formatSession(session) {
    return dateFormatter.format(sessionDate(session));
}

// Страницы вида /event/<slug> для отдельных сеансов отдают 404, покупка идёт через виджет
function buyUrl(eventId) {
    return `https://widget.ticketpro.by/event/${eventId}?widget_id=${WIDGET_ID}`;
}

function parseSeatName(name) {
    const levels = {};

    String(name || '').split('/').forEach(chunk => {
        const separator = chunk.indexOf(':');
        if (separator > 0) {
            levels[chunk.slice(0, separator)] = chunk.slice(separator + 1);
        }
    });

    const sector = levels[LEVEL_SECTOR] || null;
    const box = levels[LEVEL_BOX] || null;
    const row = levels[LEVEL_ROW] ? Number(levels[LEVEL_ROW]) : null;

    return {
        sector,
        box,
        row: Number.isFinite(row) ? row : null,
        seat: levels[LEVEL_SEAT] || null,
        seatNumber: Number(levels[LEVEL_SEAT]),
        zone: box ? `ложа ${box}` : (sector ? `сектор ${sector}` : 'зал'),
        zoneKey: (box ? `ложа ${box}` : (sector || '')).toLowerCase()
    };
}

function formatSeat(info) {
    const parts = [info.zone];
    if (info.row !== null) parts.push(`ряд ${info.row}`);
    if (info.seat) parts.push(`место ${info.seat}`);
    return parts.join(', ');
}

// Непрерывные цепочки свободных мест в одном ряду: соседние номера и реальное соседство на схеме
function seatRuns(seats) {
    const byRow = new Map();

    seats.forEach(seat => {
        const key = `${seat.info.zoneKey}|${seat.info.row}`;
        if (!byRow.has(key)) {
            byRow.set(key, []);
        }
        byRow.get(key).push(seat);
    });

    const runs = [];

    for (const rowSeats of byRow.values()) {
        const sorted = [...rowSeats].sort((a, b) => a.info.seatNumber - b.info.seatNumber);
        let run = [];

        sorted.forEach(seat => {
            const previous = run[run.length - 1];

            if (previous && isNextTo(previous, seat)) {
                run.push(seat);
                return;
            }

            if (run.length > 0) {
                runs.push(run);
            }
            run = [seat];
        });

        if (run.length > 0) {
            runs.push(run);
        }
    }

    return runs.sort((a, b) => b.length - a.length);
}

// Номера идут подряд и кружки стоят рядом: без второй проверки через проход
// в ряду места с номерами N и N+1 считались бы соседними
function isNextTo(first, second) {
    if (!Number.isFinite(first.info.seatNumber) || !Number.isFinite(second.info.seatNumber)) {
        return false;
    }
    if (second.info.seatNumber - first.info.seatNumber !== 1) {
        return false;
    }

    const radius = first.r || second.r;

    if (!Number.isFinite(first.cx) || !Number.isFinite(second.cx) || !radius) {
        return true;
    }

    const distance = Math.hypot(first.cx - second.cx, first.cy - second.cy);

    return distance <= radius * ADJACENT_GAP_FACTOR;
}

function describeRun(run) {
    const first = run[0].info;
    const last = run[run.length - 1].info;
    const seatsText = run.length === 1 ? `место ${first.seat}` : `места ${first.seat}–${last.seat}`;

    return `${first.zone}, ряд ${first.row}, ${seatsText} — ${run.length} подряд`;
}

// «сектор 1: ряды 3–10 (12)» по каждой зоне
function zoneSummary(seats) {
    const zones = new Map();

    seats.forEach(seat => {
        const info = seat.info;
        if (!zones.has(info.zone)) {
            zones.set(info.zone, { count: 0, min: null, max: null });
        }
        const zone = zones.get(info.zone);
        zone.count += 1;
        if (info.row !== null) {
            zone.min = zone.min === null ? info.row : Math.min(zone.min, info.row);
            zone.max = zone.max === null ? info.row : Math.max(zone.max, info.row);
        }
    });

    return [...zones.entries()]
        .map(([name, zone]) => {
            const rows = zone.min === null
                ? ''
                : (zone.min === zone.max ? `, ряд ${zone.min}` : `, ряды ${zone.min}–${zone.max}`);
            return `${name}${rows} (${zone.count})`;
        })
        .join('; ');
}

// uuid группы по её внешнему id: REST виджета стабилен, в отличие от разметки сайта
async function fetchGroupId() {
    const response = await axios.get(
        `${SHOW.widgetApi}/events/by-external-id/${SHOW.groupExternalId}`,
        { headers: { 'Accept-Language': 'ru' }, timeout: 20000 }
    );

    if (!response.data || !response.data.id) {
        throw new Error('REST не вернул uuid группы');
    }

    return response.data.id;
}

// id серверного экшена меняется при каждом деплое сайта, поэтому ищем его в бандлах страницы
async function discoverScheduleAction() {
    const page = await axios.get(SHOW.pageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        responseType: 'text',
        transformResponse: [data => data],
        timeout: 30000
    });

    const chunks = [...new Set(page.data.match(/\/_next\/static\/chunks\/[A-Za-z0-9_.-]+\.js/g) || [])];

    for (const chunk of chunks) {
        try {
            const body = await axios.get(`https://ticketpro.by${chunk}`, {
                responseType: 'text',
                transformResponse: [data => data],
                timeout: 25000
            });

            const match = body.data.match(/createServerReference\)\("([0-9a-f]{32,64})"[^)]{0,200}getGroupEventsApi/);

            if (match) {
                return match[1];
            }
        } catch (error) {
            // битый чанк не повод прекращать поиск
        }
    }

    throw new Error('не нашёл id экшена getGroupEventsApi в бандлах страницы');
}

async function requestSchedulePage(offset, limit) {
    const response = await axios.post(
        SHOW.pageUrl,
        JSON.stringify([groupId, { offset, limit }]),
        {
            headers: {
                'Next-Action': scheduleActionId,
                'Content-Type': 'text/plain;charset=UTF-8',
                'Accept': 'text/x-component',
                'User-Agent': 'Mozilla/5.0'
            },
            responseType: 'text',
            transformResponse: [data => data],
            timeout: 30000
        }
    );

    const marker = response.data.indexOf('1:{"events"');

    if (marker === -1) {
        throw new Error('в ответе сайта нет блока с расписанием');
    }

    return JSON.parse(response.data.slice(marker + 2).trim());
}

function toSession(event) {
    return {
        id: event.externalId,
        start: event.startTime,
        onSale: event.isOnSale !== false && !event.isSuspended
    };
}

// Расписание со страницы шоу: дешёво (4 запроса), но зависит от внутренностей Next.js
async function fetchScheduleFromSite() {
    const limit = 20;
    const items = [];
    let total = null;

    for (let offset = 0; total === null || offset < total; offset += limit) {
        let page;

        try {
            page = await requestSchedulePage(offset, limit);
        } catch (error) {
            // Сайт задеплоили — id экшена сменился, ищем новый и пробуем ещё раз
            if (offset > 0) {
                throw error;
            }

            console.log('🔎 Экшен расписания не ответил, ищу новый id...');
            scheduleActionId = await discoverScheduleAction();
            console.log(`🔑 Новый id экшена: ${scheduleActionId}`);
            page = await requestSchedulePage(offset, limit);
        }

        const events = page.events || [];

        if (events.length === 0) {
            break;
        }

        events.forEach(event => items.push(toSession(event)));
        total = page.pagination ? page.pagination.total : items.length;
    }

    if (items.length === 0) {
        throw new Error('сайт вернул пустое расписание');
    }

    return items;
}

// Запасной путь: перебираем id через REST виджета. Дороже, зато не зависит от вида сайта
async function fetchScheduleByProbe() {
    const items = [];

    for (let id = SHOW.probeFrom; id <= SHOW.probeTo; id += 1) {
        try {
            const response = await axios.get(
                `${SHOW.widgetApi}/events/by-external-id/${id}`,
                { headers: { 'Accept-Language': 'ru' }, timeout: 15000 }
            );
            const event = response.data;

            if (event && event.externalId && event.type === 'CHILD'
                && event.status === 'PUBLISHED' && event.title === SHOW.title) {
                items.push(toSession(event));
            }
        } catch (error) {
            // 404 означает, что такого сеанса нет — это нормальный результат перебора
        }
    }

    if (items.length === 0) {
        throw new Error('перебор не нашёл ни одного сеанса шоу');
    }

    return items;
}

// Обновляет список сеансов: страница шоу, затем перебор по REST, затем зашитый список
async function refreshSessions(force = false) {
    if (!force && sessions.length > 0 && Date.now() - sessionsFetchedAt < SCHEDULE_TTL_MS) {
        return sessions;
    }

    if (groupId === SHOW.groupId) {
        try {
            groupId = await fetchGroupId();
        } catch (error) {
            console.error('⚠️ Не удалось уточнить uuid группы:', error.message);
        }
    }

    let list = null;

    try {
        list = await fetchScheduleFromSite();
        console.log(`📅 Расписание со страницы шоу: ${list.length} сеансов`);
    } catch (error) {
        console.error('⚠️ Страница шоу не отдала расписание:', error.message);
    }

    if (!list) {
        try {
            list = await fetchScheduleByProbe();
            console.log(`📅 Расписание перебором по REST: ${list.length} сеансов`);
        } catch (error) {
            console.error('⚠️ Перебор по REST не помог:', error.message);
            list = FALLBACK_SESSIONS.map(session => ({ ...session, onSale: true }));
            console.log(`📅 Использую зашитое расписание: ${list.length} сеансов`);
        }
    }

    const now = Date.now();

    sessions = list
        .filter(session => session.onSale !== false)
        .filter(session => !deadSessions.has(session.id))
        .filter(session => sessionDate(session).getTime() > now)
        .sort((a, b) => sessionDate(a) - sessionDate(b));

    sessionsFetchedAt = Date.now();

    // Выкидываем из кэша сеансы, которых больше нет в расписании
    const actualIds = new Set(sessions.map(session => session.id));
    for (const eventId of [...currentResults.keys()]) {
        if (!actualIds.has(eventId)) {
            currentResults.delete(eventId);
            forgetNotified(eventId);
        }
    }

    console.log(`🎪 ${SHOW.title}: предстоящих сеансов — ${sessions.length}`);

    return sessions;
}

async function checkEvent(session) {
    const eventId = session.id;

    try {
        const getResponse = await axios.get(`https://auth.ticketpro.by/ticket-api/v1/get-scheme-prices-grouped/${eventId}?`);
        const svgUrl = getResponse.data.path;

        const svgResponse = await axios.get(svgUrl);
        const svgContent = svgResponse.data;

        const dom = new JSDOM(svgContent);
        const groups = dom.window.document.querySelectorAll('g[fill]');

        const availableSeats = [];

        groups.forEach(group => {
            const fill = group.getAttribute('fill');

            if (fill === '#999999') {
                return;
            }

            const circles = group.querySelectorAll('circle');
            circles.forEach(circle => {
                const name = circle.getAttribute('name');
                if (name) {
                    availableSeats.push({
                        id: circle.getAttribute('id'),
                        name: name,
                        info: parseSeatName(name),
                        color: fill,
                        cx: Number(circle.getAttribute('cx')),
                        cy: Number(circle.getAttribute('cy')),
                        r: Number(circle.getAttribute('r')),
                        priceId: group.getAttribute('price_id')
                    });
                }
            });
        });

        if (availableSeats.length <= MIN_SEATS_TO_REPORT) {
            return { status: 'few' };
        }

        {
            const width = 800;
            const height = 800;

            const svgBuffer = Buffer.from(svgContent);
            const pngBuffer = await sharp(svgBuffer, {
                density: 150
            })
                .resize(width, height, {
                    fit: 'contain',
                    background: { r: 255, g: 255, b: 255, alpha: 1 }
                })
                .png()
                .toBuffer();

            return {
                status: 'ok',
                result: { eventId, session, availableSeats, image: pngBuffer }
            };
        }
    } catch (error) {
        // 422 — сеанс снят с продажи: больше его не опрашиваем до обновления расписания
        if (error.response && error.response.status === 422) {
            return { status: 'gone' };
        }

        return { status: 'error', message: error.message };
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Нас интересует только появление мест: исчезновение значит, что их кто-то купил
function diffSeats(newResult, oldResult) {
    const oldIds = new Set(oldResult ? oldResult.availableSeats.map(seat => seat.id) : []);
    const newIds = new Set(newResult.availableSeats.map(seat => seat.id));

    return {
        added: newResult.availableSeats.filter(seat => !oldIds.has(seat.id)),
        removed: oldResult ? oldResult.availableSeats.filter(seat => !newIds.has(seat.id)).length : 0
    };
}

function notifyKey(chatId, eventId) {
    return `${chatId}:${eventId}`;
}

// Запоминаем текущую подборку как отправленную, чтобы сводка не повторилась уведомлениями
function primeNotified(chatId) {
    const entry = subscribers.get(chatId);

    if (!entry) {
        return;
    }

    for (const [eventId, result] of currentResults) {
        const seats = matchingSeats(result, entry.filters);
        lastNotified.set(notifyKey(chatId, eventId), {
            ids: new Set((seats || []).map(seat => seat.id)),
            at: Date.now()
        });
    }
}

function forgetNotified(eventId) {
    for (const key of [...lastNotified.keys()]) {
        if (key.endsWith(`:${eventId}`)) {
            lastNotified.delete(key);
        }
    }
}

// ─────────────────────────── фильтры ───────────────────────────

function sessionMatchesFilters(session, filters) {
    const day = sessionDay(session);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    return true;
}

function seatMatchesFilters(seat, filters) {
    const info = seat.info;

    if (filters.sectors.length > 0 && !filters.sectors.includes(info.zoneKey)) {
        return false;
    }
    if (filters.rowFrom !== null && (info.row === null || info.row < filters.rowFrom)) {
        return false;
    }
    if (filters.rowTo !== null && (info.row === null || info.row > filters.rowTo)) {
        return false;
    }

    return true;
}

// Возвращает места сеанса, подходящие под фильтры чата, либо null
function matchingSeats(result, filters) {
    if (!sessionMatchesFilters(result.session, filters)) {
        return null;
    }

    let seats = result.availableSeats.filter(seat => seatMatchesFilters(seat, filters));

    if (filters.minAdjacent) {
        seats = seatRuns(seats)
            .filter(run => run.length >= filters.minAdjacent)
            .flat();
    }

    return seats.length > 0 ? seats : null;
}

function hasFilters(filters) {
    return Boolean(filters.from || filters.to || filters.sectors.length > 0
        || filters.rowFrom !== null || filters.rowTo !== null || filters.minAdjacent);
}

function describeFilters(filters) {
    const parts = [];

    if (filters.from || filters.to) {
        const from = filters.from ? shortDateFormatter.format(new Date(`${filters.from}T12:00:00+03:00`)) : '…';
        const to = filters.to ? shortDateFormatter.format(new Date(`${filters.to}T12:00:00+03:00`)) : '…';
        parts.push(`период ${from} – ${to}`);
    }
    if (filters.sectors.length > 0) {
        parts.push(`сектора: ${filters.sectors.join(', ')}`);
    }
    if (filters.rowFrom !== null || filters.rowTo !== null) {
        const from = filters.rowFrom === null ? '1' : filters.rowFrom;
        const to = filters.rowTo === null ? '…' : filters.rowTo;
        parts.push(`ряды ${from}–${to}`);
    }

    if (filters.minAdjacent) {
        parts.push(`мест рядом: от ${filters.minAdjacent}`);
    }

    return parts.length > 0 ? parts.join(' · ') : 'не заданы';
}

// Границы сезона — чтобы «29.12» и «3.01» попали в нужный год
function seasonBounds() {
    const list = sessions.length > 0 ? sessions : FALLBACK_SESSIONS;
    return { first: list[0].start.slice(0, 10), last: list[list.length - 1].start.slice(0, 10) };
}

function resolveDate(day, month, year) {
    const pad = value => String(value).padStart(2, '0');

    if (year) {
        return `${year}-${pad(month)}-${pad(day)}`;
    }

    const { first, last } = seasonBounds();
    const startYear = Number(first.slice(0, 4));

    for (const candidateYear of [startYear, startYear + 1]) {
        const candidate = `${candidateYear}-${pad(month)}-${pad(day)}`;
        if (candidate >= first && candidate <= last) {
            return candidate;
        }
    }

    // Вне сезона — год выбираем по месяцу начала показа
    return `${month >= Number(first.slice(5, 7)) ? startYear : startYear + 1}-${pad(month)}-${pad(day)}`;
}

// Принимает «29.12 3.01», «29.12-03.01», «29.12.2026 - 03.01.2027», «off»
function parsePeriod(text) {
    const value = text.trim().toLowerCase();

    if (['off', 'сброс', 'все', 'всё', '-'].includes(value)) {
        return { from: null, to: null };
    }

    const matches = [...value.matchAll(/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{4}))?/g)];

    if (matches.length === 0) {
        return null;
    }

    const dates = matches.slice(0, 2).map(match => resolveDate(
        Number(match[1]),
        Number(match[2]),
        match[3] ? Number(match[3]) : null
    ));

    const from = dates[0];
    const to = dates.length > 1 ? dates[1] : dates[0];

    return from <= to ? { from, to } : { from: to, to: from };
}

// Принимает «1», «1,2», «ложа 2», «1, ложа Центральная», «off»
function parseSectors(text) {
    const value = text.trim().toLowerCase();

    if (['off', 'сброс', 'все', 'всё', '-'].includes(value)) {
        return [];
    }

    return value
        .split(/[,;]+/)
        .map(part => part.trim().replace(/^сектор\s+/, '').replace(/^лож[аи]\s*/, 'ложа '))
        .filter(Boolean);
}

// Принимает «1», «1-3», «до 3», «off»
function parseRows(text) {
    const value = text.trim().toLowerCase();

    if (['off', 'сброс', 'все', 'всё', '-'].includes(value)) {
        return { rowFrom: null, rowTo: null };
    }

    const numbers = (value.match(/\d+/g) || []).map(Number);

    if (numbers.length === 0) {
        return null;
    }
    if (numbers.length === 1) {
        return value.startsWith('до') || value.startsWith('<')
            ? { rowFrom: null, rowTo: numbers[0] }
            : { rowFrom: numbers[0], rowTo: numbers[0] };
    }

    return { rowFrom: Math.min(numbers[0], numbers[1]), rowTo: Math.max(numbers[0], numbers[1]) };
}

// Принимает «4», «от 4», «off»
function parseAdjacent(text) {
    const value = text.trim().toLowerCase();

    if (['off', 'сброс', 'любое', 'все', 'всё', '-', '1'].includes(value)) {
        return { minAdjacent: null };
    }

    const number = Number((value.match(/\d+/) || [])[0]);

    if (!Number.isFinite(number) || number < 1) {
        return null;
    }

    return { minAdjacent: number > 1 ? number : null };
}

// ─────────────────────────── клавиатуры ───────────────────────────

function getKeyboard(chatId) {
    const isSubscribed = subscribers.has(chatId);

    return {
        inline_keyboard: [
            [
                isSubscribed ? { text: '🛑 Стоп', callback_data: 'stop' } : { text: '🚀 Старт', callback_data: 'start' },
                { text: '📊 Статус', callback_data: 'status' }
            ],
            [
                { text: '🎚 Фильтры', callback_data: 'filters' },
                { text: '📋 Свободные места', callback_data: 'list' }
            ]
        ]
    };
}

function getFiltersKeyboard(filters) {
    return {
        inline_keyboard: [
            [{ text: `📅 Период: ${filters.from || filters.to ? describePeriodShort(filters) : 'любой'}`, callback_data: 'set_period' }],
            [{ text: `🎯 Сектора: ${filters.sectors.length > 0 ? filters.sectors.join(', ') : 'любые'}`, callback_data: 'set_sector' }],
            [{ text: `🪑 Ряды: ${filters.rowFrom !== null || filters.rowTo !== null ? `${filters.rowFrom || 1}–${filters.rowTo || '…'}` : 'любые'}`, callback_data: 'set_row' }],
            [{ text: `👥 Мест рядом: ${filters.minAdjacent ? `от ${filters.minAdjacent}` : 'любое'}`, callback_data: 'set_adjacent' }],
            [{ text: '♻️ Сбросить фильтры', callback_data: 'reset_filters' }],
            [{ text: '⬅️ Назад', callback_data: 'menu' }]
        ]
    };
}

function describePeriodShort(filters) {
    const from = filters.from ? shortDateFormatter.format(new Date(`${filters.from}T12:00:00+03:00`)) : '…';
    const to = filters.to ? shortDateFormatter.format(new Date(`${filters.to}T12:00:00+03:00`)) : '…';
    return `${from} – ${to}`;
}

// Кнопки-переключатели по зонам, которые реально есть в продаже
function getSectorsKeyboard(filters) {
    const zones = new Map();

    for (const result of currentResults.values()) {
        result.availableSeats.forEach(seat => zones.set(seat.info.zoneKey, seat.info.zone));
    }

    const rows = [];
    const keys = [...zones.keys()].sort();

    for (let i = 0; i < keys.length; i += 2) {
        rows.push(keys.slice(i, i + 2).map(key => ({
            text: `${filters.sectors.includes(key) ? '✅' : '▫️'} ${zones.get(key)}`,
            callback_data: `zone:${key}`
        })));
    }

    rows.push([{ text: '♻️ Любые сектора', callback_data: 'zone_reset' }]);
    rows.push([{ text: '⬅️ К фильтрам', callback_data: 'filters' }]);

    return { inline_keyboard: rows };
}

// ─────────────────────────── отправка ───────────────────────────

async function sendChunks(chatId, lines, header) {
    let message = header ? `${header}\n\n` : '';

    for (const line of lines) {
        if (message.length + line.length > MESSAGE_LIMIT) {
            await bot.sendMessage(chatId, message, { disable_web_page_preview: true });
            message = '';
        }
        message += `${line}\n`;
    }

    if (message.trim().length > 0) {
        await bot.sendMessage(chatId, message, { disable_web_page_preview: true });
    }
}

// Одно сводное сообщение вместо десятков фото
async function sendSummary(chatId, header) {
    const entry = subscribers.get(chatId);
    const filters = entry ? entry.filters : defaultFilters();
    const lines = [];
    let totalSeats = 0;

    for (const session of sessions) {
        const result = currentResults.get(session.id);
        if (!result) continue;

        const seats = matchingSeats(result, filters);
        if (!seats) continue;

        totalSeats += seats.length;

        if (filters.minAdjacent) {
            const runs = seatRuns(seats);
            lines.push(`🎫 ${formatSession(session)} — групп по ${filters.minAdjacent}+ рядом: ${runs.length}`);
            runs.slice(0, 5).forEach(run => lines.push(`   ${describeRun(run)}`));
            if (runs.length > 5) {
                lines.push(`   …и ещё ${runs.length - 5}`);
            }
        } else {
            lines.push(`🎫 ${formatSession(session)} — ${seats.length} мест`);
            lines.push(`   ${zoneSummary(seats)}`);
        }
        lines.push(`   ${buyUrl(session.id)}`);
        lines.push('');
    }

    if (lines.length === 0) {
        await bot.sendMessage(
            chatId,
            hasFilters(filters)
                ? `📭 Под ваши фильтры (${describeFilters(filters)}) свободных мест нет.`
                : '📭 Свободных мест не найдено.'
        );
        return;
    }

    const title = `${header}\n🎪 ${SHOW.title}\n🎚 Фильтры: ${describeFilters(filters)}\n📊 Сеансов: ${lines.filter(l => l.startsWith('🎫')).length}, мест: ${totalSeats}`;

    await sendChunks(chatId, lines, title);
}

// Точечное уведомление: шлём, только если у чата появились новые подходящие места
async function notifyChange(result) {
    for (const [chatId, entry] of subscribers) {
        const seats = matchingSeats(result, entry.filters) || [];
        const key = notifyKey(chatId, result.eventId);
        const previous = lastNotified.get(key);
        const knownIds = previous ? previous.ids : new Set();
        const gained = seats.filter(seat => !knownIds.has(seat.id));

        if (gained.length === 0) {
            // Места только убавились — для покупателя это не новость
            if (previous) {
                previous.ids = new Set(seats.map(seat => seat.id));
            }
            continue;
        }

        // Кулдаун: не обновляем память, чтобы эти места ушли следующим уведомлением
        if (previous && Date.now() - previous.at < NOTIFY_COOLDOWN_MS) {
            continue;
        }

        const groupMode = Boolean(entry.filters.minAdjacent);
        const gainedIds = new Set(gained.map(seat => seat.id));
        const freshRuns = seatRuns(seats).filter(run => run.some(seat => gainedIds.has(seat.id)));
        const items = groupMode ? freshRuns.map(describeRun) : gained.map(seat => formatSeat(seat.info));
        const limit = groupMode ? 8 : SEATS_IN_CAPTION;
        const listed = items.slice(0, limit).join('\n');
        const more = items.length > limit ? `\n…и ещё ${items.length - limit}` : '';

        const headline = groupMode
            ? `🟢 Новые группы по ${entry.filters.minAdjacent}+ мест рядом: ${freshRuns.length}\nВсего подходит мест: ${seats.length}`
            : `🟢 Новых мест: ${gained.length}\nВсего подходит: ${seats.length} · ${zoneSummary(seats)}`;

        const title = previous ? '➕ Появились новые места' : '🆕 Появились билеты';
        const caption = `${title}\n🎪 ${SHOW.title}\n📅 ${formatSession(result.session)}\n${headline}\n\n${listed}${more}\n\n🎟 ${buyUrl(result.eventId)}`;

        try {
            await bot.sendPhoto(chatId, result.image, { caption: caption.slice(0, 1024) });
            lastNotified.set(key, { ids: new Set(seats.map(seat => seat.id)), at: Date.now() });
            console.log(`📨 Уведомление в чат ${chatId}: сеанс ${result.eventId}, новых мест ${gained.length}`);
        } catch (error) {
            console.error(`Ошибка отправки в чат ${chatId}:`, error.message);
        }
    }
}

// ─────────────────────────── цикл проверки ───────────────────────────

async function performChecks() {
    if (isCheckRunning) {
        console.log('⚠️ Проверка уже выполняется, пропускаю...');
        return;
    }

    isCheckRunning = true;
    console.log('🔄 Начинаю новый цикл проверки...');

    try {
        await refreshSessions();

        if (sessions.length === 0) {
            console.log('📭 Предстоящих сеансов нет');
            return;
        }

        let changes = 0;
        const failed = [];
        const gone = [];

        for (const session of sessions) {
            const check = await checkEvent(session);

            if (check.status === 'error') {
                // Сетевой сбой — не повод считать, что мест не стало: оставляем прошлую картину
                failed.push(session.id);
                await delay(CHECK_DELAY_MS);
                continue;
            }

            if (check.status === 'gone') {
                gone.push(session.id);
                deadSessions.add(session.id);
                currentResults.delete(session.id);
                forgetNotified(session.id);
                await delay(CHECK_DELAY_MS);
                continue;
            }

            if (check.status === 'ok') {
                const result = check.result;
                const diff = diffSeats(result, currentResults.get(session.id));
                currentResults.set(session.id, result);

                if (diff.added.length > 0 || diff.removed > 0) {
                    changes += 1;
                    console.log(`✅ ${formatSession(session)} (${session.id}): +${diff.added.length} / -${diff.removed}, всего ${result.availableSeats.length}`);
                }

                // Первый цикл после старта отдаём сводкой, дальше — точечными уведомлениями.
                // Вызываем каждый круг: уведомление могло быть отложено кулдауном
                if (firstCycleDone) {
                    await notifyChange(result);
                }
            } else if (currentResults.has(session.id)) {
                console.log(`❌ ${formatSession(session)} (${session.id}): места закончились`);
                currentResults.delete(session.id);
                forgetNotified(session.id);
            }

            await delay(CHECK_DELAY_MS);
        }

        if (gone.length > 0) {
            // Такие сеансы выпадут из списка при следующем обновлении расписания
            sessions = sessions.filter(session => !deadSessions.has(session.id));
            console.log(`🚫 Снято с продажи: ${gone.join(', ')}`);
        }

        if (failed.length > 0) {
            console.log(`⚠️ Не удалось проверить сеансов: ${failed.length} (${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''})`);
        }

        console.log(`✅ Цикл завершён. Изменений: ${changes}`);

        if (!firstCycleDone) {
            firstCycleDone = true;

            for (const chatId of subscribers.keys()) {
                try {
                    await sendSummary(chatId, '📦 Текущая картина по билетам:');
                    primeNotified(chatId);
                } catch (error) {
                    console.error(`Ошибка отправки сводки в чат ${chatId}:`, error.message);
                }
            }
        }
    } finally {
        isCheckRunning = false;
    }
}

async function startGlobalChecks() {
    if (globalCheckInterval) {
        return;
    }

    console.log('🚀 Запускаю глобальный цикл проверки');

    globalCheckInterval = setInterval(async () => {
        if (subscribers.size === 0) {
            console.log('⏹ Нет подписанных пользователей, останавливаю проверку');
            stopGlobalChecks();
            return;
        }

        await performChecks();
    }, CYCLE_INTERVAL_MS);

    if (currentResults.size === 0) {
        console.log('📋 Первый запуск — выполняю начальную проверку');
        await performChecks();
    }
}

function stopGlobalChecks() {
    if (globalCheckInterval) {
        clearInterval(globalCheckInterval);
        globalCheckInterval = null;
        console.log('⏹ Глобальная проверка остановлена');
    }
}

// ─────────────────────────── команды ───────────────────────────

const HELP_TEXT = `🎪 Бот следит за билетами на «${SHOW.title}» (Белгосцирк, 12 декабря 2026 — 17 января 2027).

После подписки приходит одно сводное сообщение, дальше — по одному уведомлению на каждое изменение.

Команды:
/start — меню и подписка
/stop — отписаться
/list — свободные места сейчас
/filters — показать фильтры
/period 29.12 3.01 — только этот период (/period off — сброс)
/sector 1,2 — только эти сектора, можно «ложа 2» (/sector off — сброс)
/row 1-3 — только эти ряды, /row 1 — первый ряд (/row off — сброс)
/together 4 — только где минимум 4 места подряд в одном ряду (/together off — сброс)
/help — эта справка`;

function ensureEntry(chatId) {
    if (!subscribers.has(chatId)) {
        subscribers.set(chatId, { filters: defaultFilters(), awaiting: null });
    }
    return subscribers.get(chatId);
}

// Фильтры можно настраивать и без подписки — храним их в том же месте
const pendingFilters = new Map();

function filtersOf(chatId) {
    if (subscribers.has(chatId)) {
        return subscribers.get(chatId).filters;
    }
    if (!pendingFilters.has(chatId)) {
        pendingFilters.set(chatId, defaultFilters());
    }
    return pendingFilters.get(chatId);
}

function awaitingOf(chatId) {
    const entry = subscribers.get(chatId);
    return entry ? entry.awaiting : pendingFilters.get(`await:${chatId}`) || null;
}

function setAwaiting(chatId, value) {
    const entry = subscribers.get(chatId);
    if (entry) {
        entry.awaiting = value;
    } else {
        pendingFilters.set(`await:${chatId}`, value);
    }
}

async function subscribe(chatId) {
    if (subscribers.has(chatId)) {
        return false;
    }

    const filters = pendingFilters.get(chatId) || defaultFilters();
    pendingFilters.delete(chatId);
    subscribers.set(chatId, { filters, awaiting: null });
    saveState();

    return true;
}

bot.onText(/^\/(start|help)\b/, async (msg) => {
    const chatId = msg.chat.id;

    await bot.sendMessage(chatId, `${HELP_TEXT}\n\n🎚 Ваши фильтры: ${describeFilters(filtersOf(chatId))}`, {
        reply_markup: getKeyboard(chatId)
    });
});

bot.onText(/^\/stop\b/, async (msg) => {
    const chatId = msg.chat.id;

    if (!subscribers.has(chatId)) {
        await bot.sendMessage(chatId, '⚠️ Вы не подписаны.', { reply_markup: getKeyboard(chatId) });
        return;
    }

    pendingFilters.set(chatId, subscribers.get(chatId).filters);
    subscribers.delete(chatId);
    saveState();

    await bot.sendMessage(chatId, '🛑 Подписка отключена. Фильтры сохранены.', { reply_markup: getKeyboard(chatId) });
});

bot.onText(/^\/list\b/, async (msg) => {
    await sendSummary(msg.chat.id, '📋 Свободные места сейчас:');
});

bot.onText(/^\/filters\b/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, `🎚 Фильтры: ${describeFilters(filtersOf(chatId))}`, {
        reply_markup: getFiltersKeyboard(filtersOf(chatId))
    });
});

bot.onText(/^\/period\b\s*(.*)$/, async (msg, match) => {
    await applyPeriod(msg.chat.id, match[1]);
});

bot.onText(/^\/sector\b\s*(.*)$/, async (msg, match) => {
    await applySectors(msg.chat.id, match[1]);
});

bot.onText(/^\/row\b\s*(.*)$/, async (msg, match) => {
    await applyRows(msg.chat.id, match[1]);
});

bot.onText(/^\/(?:together|adjacent)\b\s*(.*)$/, async (msg, match) => {
    await applyAdjacent(msg.chat.id, match[1]);
});

async function applyPeriod(chatId, text) {
    if (!text.trim()) {
        setAwaiting(chatId, 'period');
        await bot.sendMessage(chatId, '📅 Пришлите период, например «29.12 3.01» или «off», чтобы снять фильтр.');
        return;
    }

    const period = parsePeriod(text);

    if (!period) {
        await bot.sendMessage(chatId, '⚠️ Не понял период. Пример: 29.12 3.01');
        return;
    }

    const filters = filtersOf(chatId);
    filters.from = period.from;
    filters.to = period.to;
    setAwaiting(chatId, null);
    saveState();
    primeNotified(chatId);

    await bot.sendMessage(chatId, `✅ Фильтры: ${describeFilters(filters)}`, {
        reply_markup: getFiltersKeyboard(filters)
    });
}

async function applySectors(chatId, text) {
    if (!text.trim()) {
        setAwaiting(chatId, 'sector');
        await bot.sendMessage(chatId, '🎯 Пришлите сектора, например «1,2» или «ложа 2», либо «off».', {
            reply_markup: getSectorsKeyboard(filtersOf(chatId))
        });
        return;
    }

    const filters = filtersOf(chatId);
    filters.sectors = parseSectors(text);
    setAwaiting(chatId, null);
    saveState();
    primeNotified(chatId);

    await bot.sendMessage(chatId, `✅ Фильтры: ${describeFilters(filters)}`, {
        reply_markup: getFiltersKeyboard(filters)
    });
}

async function applyRows(chatId, text) {
    if (!text.trim()) {
        setAwaiting(chatId, 'row');
        await bot.sendMessage(chatId, '🪑 Пришлите ряды, например «1-3», «1» (только первый ряд), «до 5» или «off».');
        return;
    }

    const rows = parseRows(text);

    if (!rows) {
        await bot.sendMessage(chatId, '⚠️ Не понял ряды. Примеры: 1, 1-3, до 5');
        return;
    }

    const filters = filtersOf(chatId);
    filters.rowFrom = rows.rowFrom;
    filters.rowTo = rows.rowTo;
    setAwaiting(chatId, null);
    saveState();
    primeNotified(chatId);

    await bot.sendMessage(chatId, `✅ Фильтры: ${describeFilters(filters)}`, {
        reply_markup: getFiltersKeyboard(filters)
    });
}

async function applyAdjacent(chatId, text) {
    if (!text.trim()) {
        setAwaiting(chatId, 'adjacent');
        await bot.sendMessage(chatId, '👥 Сколько мест должно быть подряд в одном ряду? Например «4». «off» — снять фильтр.');
        return;
    }

    const parsed = parseAdjacent(text);

    if (!parsed) {
        await bot.sendMessage(chatId, '⚠️ Не понял количество. Примеры: 4, от 4, off');
        return;
    }

    const filters = filtersOf(chatId);
    filters.minAdjacent = parsed.minAdjacent;
    setAwaiting(chatId, null);
    saveState();
    primeNotified(chatId);

    await bot.sendMessage(chatId, `✅ Фильтры: ${describeFilters(filters)}`, {
        reply_markup: getFiltersKeyboard(filters)
    });
}

// Свободный ввод после нажатия кнопки фильтра
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    if (!text || text.startsWith('/')) {
        return;
    }

    const awaiting = awaitingOf(chatId);

    if (!awaiting) {
        return;
    }

    try {
        if (awaiting === 'period') await applyPeriod(chatId, text);
        else if (awaiting === 'sector') await applySectors(chatId, text);
        else if (awaiting === 'row') await applyRows(chatId, text);
        else if (awaiting === 'adjacent') await applyAdjacent(chatId, text);
    } catch (error) {
        console.error('Ошибка обработки ввода:', error.message);
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const action = query.data;

    try {
        if (action === 'start') {
            const added = await subscribe(chatId);

            await bot.editMessageText(
                added
                    ? `✅ Подписка на «${SHOW.title}» включена.\n🎚 Фильтры: ${describeFilters(filtersOf(chatId))}`
                    : '⚠️ Вы уже подписаны.',
                { chat_id: chatId, message_id: messageId, reply_markup: getKeyboard(chatId) }
            );

            if (added) {
                if (currentResults.size > 0) {
                    await sendSummary(chatId, '📦 Текущая картина по билетам:');
                    primeNotified(chatId);
                } else {
                    await bot.sendMessage(chatId, '🔄 Собираю данные, первая сводка придёт через несколько минут.');
                }

                startGlobalChecks().catch(error => console.error('Ошибка цикла проверки:', error.message));
            }

            await bot.answerCallbackQuery(query.id, { text: added ? '✅ Подписка включена' : '⚠️ Уже подписаны' });

        } else if (action === 'stop') {
            if (subscribers.has(chatId)) {
                pendingFilters.set(chatId, subscribers.get(chatId).filters);
                subscribers.delete(chatId);
                saveState();
            }

            await bot.editMessageText('🛑 Подписка отключена. Фильтры сохранены.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: getKeyboard(chatId)
            });
            await bot.answerCallbackQuery(query.id, { text: '🛑 Отписаны' });

        } else if (action === 'status') {
            const filters = filtersOf(chatId);
            const matched = sessions.filter(session => {
                const result = currentResults.get(session.id);
                return result && matchingSeats(result, filters);
            }).length;

            const statusMessage = `📊 ${SHOW.title}

${subscribers.has(chatId) ? '✅ Вы подписаны' : '⭕️ Вы не подписаны'}
${globalCheckInterval ? '🔄 Мониторинг активен' : '⏸️ Мониторинг не запущен'}
Подписчиков: ${subscribers.size}
Сеансов в расписании: ${sessions.length}
Сеансов с местами: ${currentResults.size}
Подходит под фильтры: ${matched}
Фильтры: ${describeFilters(filters)}`;

            await bot.answerCallbackQuery(query.id, { text: statusMessage, show_alert: true });

        } else if (action === 'filters') {
            await bot.editMessageText(`🎚 Фильтры: ${describeFilters(filtersOf(chatId))}`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: getFiltersKeyboard(filtersOf(chatId))
            });
            await bot.answerCallbackQuery(query.id);

        } else if (action === 'menu') {
            await bot.editMessageText(`🎪 ${SHOW.title}\n🎚 Фильтры: ${describeFilters(filtersOf(chatId))}`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: getKeyboard(chatId)
            });
            await bot.answerCallbackQuery(query.id);

        } else if (action === 'list') {
            await bot.answerCallbackQuery(query.id, { text: '📋 Собираю список...' });
            await sendSummary(chatId, '📋 Свободные места сейчас:');

        } else if (action === 'set_period') {
            setAwaiting(chatId, 'period');
            await bot.answerCallbackQuery(query.id);
            await bot.sendMessage(chatId, '📅 Пришлите период, например «29.12 3.01». «off» — снять фильтр.');

        } else if (action === 'set_sector') {
            setAwaiting(chatId, 'sector');
            await bot.answerCallbackQuery(query.id);
            await bot.sendMessage(chatId, '🎯 Выберите сектора кнопками или пришлите текстом, например «1,2».', {
                reply_markup: getSectorsKeyboard(filtersOf(chatId))
            });

        } else if (action === 'set_row') {
            setAwaiting(chatId, 'row');
            await bot.answerCallbackQuery(query.id);
            await bot.sendMessage(chatId, '🪑 Пришлите ряды: «1» — первый ряд, «1-3», «до 5». «off» — снять фильтр.');

        } else if (action === 'set_adjacent') {
            setAwaiting(chatId, 'adjacent');
            await bot.answerCallbackQuery(query.id);
            await bot.sendMessage(chatId, '👥 Сколько мест подряд нужно в одном ряду? Пришлите число, например «4». «off» — снять фильтр.');

        } else if (action.startsWith('zone:')) {
            const key = action.slice(5);
            const filters = filtersOf(chatId);

            if (filters.sectors.includes(key)) {
                filters.sectors = filters.sectors.filter(sector => sector !== key);
            } else {
                filters.sectors = [...filters.sectors, key];
            }

            setAwaiting(chatId, null);
            saveState();
            primeNotified(chatId);

            await bot.editMessageReplyMarkup(getSectorsKeyboard(filters), { chat_id: chatId, message_id: messageId });
            await bot.answerCallbackQuery(query.id, { text: `Сектора: ${filters.sectors.length > 0 ? filters.sectors.join(', ') : 'любые'}` });

        } else if (action === 'zone_reset') {
            const filters = filtersOf(chatId);
            filters.sectors = [];
            saveState();
            primeNotified(chatId);

            await bot.editMessageReplyMarkup(getSectorsKeyboard(filters), { chat_id: chatId, message_id: messageId });
            await bot.answerCallbackQuery(query.id, { text: 'Сектора: любые' });

        } else if (action === 'reset_filters') {
            const filters = filtersOf(chatId);
            Object.assign(filters, defaultFilters());
            setAwaiting(chatId, null);
            saveState();
            primeNotified(chatId);

            await bot.editMessageText('♻️ Фильтры сброшены.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: getFiltersKeyboard(filters)
            });
            await bot.answerCallbackQuery(query.id, { text: '♻️ Сброшено' });
        }
    } catch (error) {
        console.error('Ошибка обработки callback:', error.message);
        await bot.answerCallbackQuery(query.id, { text: '⚠️ Произошла ошибка' }).catch(() => {});
    }
});

// ─────────────────────────── старт ───────────────────────────

// На GitHub Actions job живёт не дольше лимита — выходим сами, следующий запуск поднимет бота заново
const runMinutes = Number(process.env.RUN_MINUTES || 0);

if (runMinutes > 0) {
    setTimeout(() => {
        console.log(`⏱ Отработано ${runMinutes} минут, завершаю процесс`);
        process.exit(0);
    }, runMinutes * 60 * 1000).unref();
}

(async () => {
    await loadState();
    await refreshSessions(true).catch(error => console.error('Не удалось загрузить расписание:', error.message));

    if (subscribers.size > 0) {
        await startGlobalChecks();
    }
})().catch(error => console.error('Ошибка запуска:', error.message));

console.log(`Бот запущен. Следим за «${SHOW.title}»...`);
