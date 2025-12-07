const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const sharp = require('sharp');
const { JSDOM } = require('jsdom');

const BOT_TOKEN = 'REDACTED';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Хранилище подписанных чатов
const subscribedChats = new Set();
// Кэш результатов проверки событий
const resultsCache = new Map();
// Предыдущие результаты для сравнения
const previousResults = new Map();
// Глобальный цикл проверки
let globalCheckInterval = null;
// Флаг выполнения проверки прямо сейчас
let isCheckRunning = false;

// Функция для создания клавиатуры с кнопками
function getKeyboard(isSubscribed) {
    const keyboard = {
        inline_keyboard: []
    };

    if (isSubscribed) {
        keyboard.inline_keyboard.push([
            { text: '🛑 Стоп', callback_data: 'stop' },
            { text: '📊 Статус', callback_data: 'status' }
        ]);
    } else {
        keyboard.inline_keyboard.push([
            { text: '🚀 Старт', callback_data: 'start' },
            { text: '📊 Статус', callback_data: 'status' }
        ]);
    }

    return keyboard;
}

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
    if (isCheckRunning) {
        console.log('⚠️ Проверка уже выполняется, пропускаю...');
        return;
    }

    isCheckRunning = true;
    const range = [41818, 41883];

    console.log('🔄 Начинаю новый цикл проверки...');
    const newResults = new Map();

    try {
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

            await delay(5000);
        }

        resultsCache.clear();
        resultsCache.set('changes', newResults);
        console.log(`✅ Цикл проверки завершен. Найдено изменений: ${newResults.size}`);

        // Уведомляем всех подписанных пользователей об изменениях
        if (newResults.size > 0) {
            for (const chatId of subscribedChats) {
                try {
                    await bot.sendMessage(chatId, '🔔 Обнаружены новые изменения!');
                    await sendCachedResults(chatId, false);
                } catch (error) {
                    console.error(`Ошибка отправки сообщения в чат ${chatId}:`, error.message);
                }
            }
        }
    } finally {
        isCheckRunning = false;
    }
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

async function startGlobalChecks() {
    if (globalCheckInterval) {
        console.log('⚠️ Глобальная проверка уже запущена');
        return;
    }

    console.log('🚀 Запускаю глобальный цикл проверки для всех пользователей');

    // Запускаем проверки по интервалу
    // ВАЖНО: НЕ вызываем performChecks() сразу, чтобы не дублировать запросы для каждого нового пользователя
    globalCheckInterval = setInterval(async () => {
        if (subscribedChats.size === 0) {
            console.log('⏹ Нет подписанных пользователей, останавливаю глобальную проверку');
            stopGlobalChecks();
            return;
        }

        await performChecks();
    }, 60000); // Проверка каждые 60 секунд (можно настроить)

    // Запускаем первую проверку сразу, НО только если это первый запуск (нет кэша)
    if (resultsCache.size === 0 && previousResults.size === 0) {
        console.log('📋 Первый запуск - выполняю начальную проверку');
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

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const isSubscribed = subscribedChats.has(chatId);

    const welcomeMessage = `🎭 Добро пожаловать в бот мониторинга билетов!

Я буду отслеживать доступность билетов и уведомлять вас об изменениях.

${isSubscribed ? '✅ Вы уже подписаны на уведомления' : '⭕️ Вы пока не подписаны'}

Используйте кнопки ниже для управления:`;

    await bot.sendMessage(chatId, welcomeMessage, {
        reply_markup: getKeyboard(isSubscribed)
    });
});

// Обработчик callback-кнопок
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const action = query.data;

    try {
        if (action === 'start') {
            // Подписка на уведомления
            if (subscribedChats.has(chatId)) {
                await bot.answerCallbackQuery(query.id, {
                    text: '⚠️ Вы уже подписаны!',
                    show_alert: false
                });
                return;
            }

            subscribedChats.add(chatId);

            // Обновляем сообщение с новыми кнопками
            await bot.editMessageText(
                '✅ Вы подписались на уведомления о доступных билетах!\nБуду уведомлять вас об изменениях.',
                {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: getKeyboard(true)
                }
            );

            // Если есть кэшированные результаты, отправляем их
            const changes = resultsCache.get('changes');
            if (changes && changes.size > 0) {
                await bot.sendMessage(chatId, '📦 Отправляю текущие доступные билеты:');
                await sendCachedResults(chatId, true);
            } else {
                await bot.sendMessage(chatId, '📭 Свободных мест пока не найдено');
            }

            // Запускаем глобальную проверку, если она еще не запущена
            if (!globalCheckInterval) {
                await bot.sendMessage(chatId, '🔄 Запускаю мониторинг билетов...');
                startGlobalChecks().catch(error => {
                    console.error('Ошибка глобальной проверки:', error);
                    bot.sendMessage(chatId, `⚠️ Ошибка запуска мониторинга: ${error.message}`);
                });
            }

            await bot.answerCallbackQuery(query.id, {
                text: '✅ Подписка активирована!',
                show_alert: false
            });

        } else if (action === 'stop') {
            // Отписка от уведомлений
            if (!subscribedChats.has(chatId)) {
                await bot.answerCallbackQuery(query.id, {
                    text: '⚠️ Вы не подписаны!',
                    show_alert: false
                });
                return;
            }

            subscribedChats.delete(chatId);

            // Обновляем сообщение с новыми кнопками
            await bot.editMessageText(
                '🛑 Вы отписались от уведомлений.\nНажмите "Старт" для повторной подписки.',
                {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: getKeyboard(false)
                }
            );

            await bot.answerCallbackQuery(query.id, {
                text: '🛑 Подписка отключена',
                show_alert: false
            });

            console.log(`Пользователь ${chatId} отписался. Активных подписок: ${subscribedChats.size}`);

        } else if (action === 'status') {
            // Показ статуса
            const isSubscribed = subscribedChats.has(chatId);
            const changes = resultsCache.get('changes');
            const cacheInfo = changes ? `Событий с изменениями: ${changes.size}` : 'Нет изменений';
            const monitoringStatus = globalCheckInterval ? '🔄 Мониторинг активен' : '⏸️ Мониторинг не запущен';
            const trackedEvents = `Отслеживается событий: ${previousResults.size}`;
            const totalSubscribers = `Всего подписчиков: ${subscribedChats.size}`;

            const statusMessage = `📊 Статус бота:

${isSubscribed ? '✅ Вы подписаны на уведомления' : '⭕️ Вы не подписаны'}
${monitoringStatus}
${totalSubscribers}
${cacheInfo}
${trackedEvents}`;

            // Отправляем статус как всплывающее уведомление
            await bot.answerCallbackQuery(query.id, {
                text: statusMessage,
                show_alert: true
            });
        }
    } catch (error) {
        console.error('Ошибка обработки callback:', error);
        await bot.answerCallbackQuery(query.id, {
            text: '⚠️ Произошла ошибка',
            show_alert: false
        });
    }
});

console.log('Бот запущен...');
