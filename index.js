const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const sharp = require('sharp');
const { JSDOM } = require('jsdom');

const BOT_TOKEN = 'REDACTED';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Хранилище активных проверок для каждого чата
const activeChecks = new Map();
// Кэш результатов проверки событий
const resultsCache = new Map();
// Предыдущие результаты для сравнения
const previousResults = new Map();
// Флаг, указывающий на выполнение цикла проверки
let checkingInProgress = false;

async function checkEvent(eventId) {
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
                        color: fill,
                        cx: circle.getAttribute('cx'),
                        cy: circle.getAttribute('cy'),
                        priceId: group.getAttribute('price_id')
                    });
                }
            });
        });

        if (availableSeats.length > 3) {
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
                eventId,
                availableSeats,
                image: pngBuffer
            };
        }

        return null;
    } catch (error) {
        console.error(`Ошибка при проверке события ${eventId}:`, error.message);
        return null;
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function compareResults(newResult, oldResult) {
    if (!oldResult) {
        return { hasChanges: true, type: 'new' };
    }

    const newSeatIds = new Set(newResult.availableSeats.map(s => s.id));
    const oldSeatIds = new Set(oldResult.availableSeats.map(s => s.id));

    if (newSeatIds.size !== oldSeatIds.size) {
        return { hasChanges: true, type: 'count_changed' };
    }

    for (const id of newSeatIds) {
        if (!oldSeatIds.has(id)) {
            return { hasChanges: true, type: 'seats_changed' };
        }
    }

    return { hasChanges: false, type: 'same' };
}

async function performChecks() {
    const range = [41818, 41883];

    console.log('🔄 Начинаю новый цикл проверки...');
    checkingInProgress = true;
    const newResults = new Map();

    for (let eventId = range[1]; eventId >= range[0]; eventId--) {
        console.log(`Проверяю событие https://www.ticketpro.by/kupit-bilet/${eventId}/ ...`);

        const result = await checkEvent(eventId);

        if (result) {
            const comparison = compareResults(result, previousResults.get(eventId));

            if (comparison.hasChanges) {
                newResults.set(eventId, { result, changeType: comparison.type });
                console.log(`✅ Изменения для события ${eventId}: ${comparison.type}`);
            } else {
                console.log(`⏭️ Событие ${eventId}: без изменений`);
            }

            previousResults.set(eventId, result);
        } else {
            // Если мест не стало, но раньше были
            if (previousResults.has(eventId)) {
                console.log(`❌ Событие ${eventId}: места закончились`);
                previousResults.delete(eventId);
            }
        }

        await delay(15000);
    }

    resultsCache.clear();
    resultsCache.set('changes', newResults);
    checkingInProgress = false;
    console.log(`✅ Цикл проверки завершен. Найдено изменений: ${newResults.size}`);
}

async function sendCachedResults(chatId, isFirstRun = false) {
    const changes = resultsCache.get('changes');

    if (!changes || changes.size === 0) {
        if (isFirstRun) {
            await bot.sendMessage(chatId, '📭 Свободных мест не найдено');
        }
        return;
    }

    for (const [eventId, { result, changeType }] of changes) {
        let changeEmoji = '🆕';
        let changeText = 'Новые билеты';

        if (changeType === 'count_changed') {
            changeEmoji = '🔄';
            changeText = 'Изменение количества мест';
        } else if (changeType === 'seats_changed') {
            changeEmoji = '🔄';
            changeText = 'Изменение мест';
        }

        await bot.sendPhoto(chatId, result.image, {
            caption: `${changeEmoji} ${changeText}\n🎉 Событие https://www.ticketpro.by/kupit-bilet/${result.eventId}/\nНайдено свободных мест: ${result.availableSeats.length}`
        });

        let message = '🟢 Свободные места:\n\n';
        result.availableSeats.forEach((seat, index) => {
            message += `${index + 1}. ${seat.name}\n`;

            if (message.length > 3500) {
                bot.sendMessage(chatId, message);
                message = '';
            }
        });

        if (message.length > 0) {
            //await bot.sendMessage(chatId, message);
        }
    }
}

async function runChecks(chatId) {
    let isFirstRun = true;

    while (activeChecks.get(chatId)) {
        // Если проверка уже идет, используем кэш
        if (checkingInProgress) {
            await bot.sendMessage(chatId, '⏳ Проверка уже выполняется, ожидайте...');

            // Ждем завершения проверки
            while (checkingInProgress && activeChecks.get(chatId)) {
                await delay(5000);
            }

            if (!activeChecks.get(chatId)) {
                return;
            }
        }

        // Отправляем результаты только при первом запуске или если есть изменения
        const changes = resultsCache.get('changes');
        if (changes && changes.size > 0) {
            if (isFirstRun) {
                await bot.sendMessage(chatId, '📦 Отправляю текущие результаты...');
            } else {
                await bot.sendMessage(chatId, '🔔 Обнаружены изменения!');
            }
            await sendCachedResults(chatId, isFirstRun);
        } else if (isFirstRun) {
            await bot.sendMessage(chatId, '📭 Свободных мест пока не найдено');
        }

        isFirstRun = false;

        // Запускаем новую проверку
        //await bot.sendMessage(chatId, '🔍 Запускаю новую проверку...');
        await performChecks();

        if (!activeChecks.get(chatId)) {
            await bot.sendMessage(chatId, '⏹ Проверка остановлена');
            return;
        }

        // Отправляем результаты только если есть изменения
        const newChanges = resultsCache.get('changes');
        if (newChanges && newChanges.size > 0) {
            await bot.sendMessage(chatId, '🔔 Новые изменения:');
            await sendCachedResults(chatId, false);
        } else {
            //await bot.sendMessage(chatId, '✅ Проверка завершена. Изменений не обнаружено.');
        }
    }
}

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    if (activeChecks.get(chatId)) {
        await bot.sendMessage(chatId, '⚠️ Проверка уже запущена! Используйте /stop для остановки.');
        return;
    }

    activeChecks.set(chatId, true);
    await bot.sendMessage(chatId, '🚀 Начинаю непрерывную проверку билетов...\nБуду уведомлять только об изменениях.\nИспользуйте /stop для остановки.');

    runChecks(chatId).catch(error => {
        console.error(error);
        bot.sendMessage(chatId, `Ошибка: ${error.message}`);
        activeChecks.delete(chatId);
    });
});

bot.onText(/\/stop/, async (msg) => {
    const chatId = msg.chat.id;

    if (!activeChecks.get(chatId)) {
        await bot.sendMessage(chatId, '⚠️ Проверка не запущена!');
        return;
    }

    activeChecks.delete(chatId);
    await bot.sendMessage(chatId, '🛑 Останавливаю проверку...');
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const isActive = activeChecks.get(chatId);
    const changes = resultsCache.get('changes');
    const cacheInfo = changes ? `Событий с изменениями: ${changes.size}` : 'Нет изменений';
    const checkStatus = checkingInProgress ? '🔄 Проверка в процессе' : '⏸️ Проверка не активна';
    const trackedEvents = `Отслеживается событий: ${previousResults.size}`;

    await bot.sendMessage(chatId,
        `${isActive ? '✅ Подписка активна' : '⭕️ Подписка остановлена'}\n${checkStatus}\n${cacheInfo}\n${trackedEvents}`
    );
});

console.log('Бот запущен...');
