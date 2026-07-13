# Fan Raid — MVP

Многопользовательская игра «второго экрана» поверх реального футбольного матча.
Болельщики выбирают сторону (Бразилия / Германия) и во время матча отвечают на
короткие микро-прогнозы. Правильные ответы двигают общую шкалу **Силы фанатов**
(Fan Power) в пользу своей стороны; чья сила выше к финальному свистку — та и
выигрывает рейд. Результат можно зафиксировать в Solana (feature flag).

Ключевой принцип: **игровая логика полностью отделена от источника данных**.
Движок работает одинаково с живым API (TxODDS), записанным реплеем и синтетическим
симулятором.

---

## Быстрый старт

```bash
# 1. Зависимости (нужен Node.js 20+ и pnpm; pnpm ставится через corepack)
corepack enable pnpm
pnpm install

# 2. Конфиг
cp .env.example .env        # значений по умолчанию достаточно для dev

# 3. Запуск сервера (:8080) и клиента (:5173) одновременно
pnpm dev
```

Открой <http://localhost:5173> — в dev-режиме клиент попросит имя и подключится к
матчу. Открой во **второй вкладке** и выбери другую сторону: оба игрока делят
общий матч (счёт, Силу фанатов, вопрос, лидерборд).

Другие команды:

```bash
pnpm test        # юнит-тесты движка (vitest)
pnpm build       # сборка shared + server + miniapp
pnpm typecheck   # строгая проверка типов во всех пакетах
```

---

## Конфигурация (`.env`)

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `FEED_SOURCE` | `sim` | Источник фида: `sim` \| `replay` \| `txodds` |
| `SIM_SPEED` | `20` | Масштаб времени SimFeed (1 игр. минута = 60000/SIM_SPEED мс) |
| `SIM_SEED` | — | Сид генератора для воспроизводимого матча |
| `REPLAY_FILE` | `./recordings/demo.jsonl` | JSONL-файл для `FEED_SOURCE=replay` |
| `REPLAY_SPEED` | `10` | Ускорение проигрывания реплея |
| `DEV_MODE` | `true` | Включает `POST /api/auth/dev` (вход без Telegram) |
| `MATCH_AUTORESTART` | `true` | Авто-старт нового матча после финального свистка |
| `SERVER_PORT` | `8080` | Порт сервера |
| `SESSION_SECRET` | `dev-secret-…` | Секрет подписи сессионных токенов |
| `TELEGRAM_BOT_TOKEN` | — | Токен бота для валидации Telegram `initData` |
| `SOLANA_ENABLED` | `false` | FEATURE FLAG фиксации результата on-chain |
| `SOLANA_KEYPAIR_PATH` | `./solana-keypair.json` | Keypair сервера для devnet |
| `TXODDS_API_URL` / `TXODDS_API_KEY` | — | Реквизиты реального TxODDS live feed |
| `TXODDS_SCORES_API_URL` | — | Дополнительный scores stream для TxLINE SSE |
| `TXODDS_BEARER_TOKEN` | — | Guest JWT для TxLINE FreeTier SSE |
| `TXODDS_MODE` | `auto` | `auto` выбирает `ws` для `ws(s)://`, иначе `poll`; можно задать `poll` / `ws` / `sse` явно |
| `TXODDS_POLL_MS` | `1000` | Интервал HTTP polling |
| `TXODDS_MATCH_ID` | — | Внешний id матча у TxODDS; подставляется в `{matchId}` в URL / subscribe message |
| `TXODDS_API_KEY_HEADER` / `TXODDS_API_KEY_PREFIX` | `Authorization` / `Bearer` | Как отправлять ключ API |

---

## Архитектура

```
FeedSource → normalize → MatchRoom (engine) → WS broadcast → клиенты
                                   ↑                              │
                              answer (WS) ────────────────────────┘

apps/server
  src/feed/       FeedSource + SimFeed / ReplayFeed / TxOddsFeed
  src/engine/     MatchRoom, QuestionEngine, questionTypes, scoring, fanPower, settlement
  src/ws/         WebSocket-шлюз (протокол, рассылка, комнаты)
  src/api/        REST: auth (telegram/dev), match, leaderboard; токены
  src/persist/    SQLite (better-sqlite3)
  src/recorder/   запись любого фида в JSONL
  src/solana/     FEATURE FLAG: NoopCommitter / DevnetCommitter
apps/miniapp
  src/screens/    Pick, Arena, Summary, Leaderboard, Toasts
  src/game/       WS-стор состояния, авторизация
  src/fx/         эффекты: конфетти, тряска, вспышка, пульс
packages/shared
  src/types.ts  src/protocol.ts  src/constants.ts
```

Сервер **авторитетен во всём**: клиент ничего не считает, только рендерит и
отправляет выбор стороны и ответы. Все игровые константы — в
[`packages/shared/src/constants.ts`](packages/shared/src/constants.ts), в логике не
хардкодятся.

### Игровой цикл вопроса (раздел 7 диздока)

```
created → open (окно ответа 20 игр. сек) → locked → resolved
```

**Анти-latency правило:** окно ответа всегда закрывается ДО начала периода, к
которому относится прогноз. Все окна прогноза отсчитываются от момента `locked`,
а не `created` — в проде это защищает от игроков, видящих трансляцию раньше фида.
Ответ, пришедший после `locked`, отклоняется (`QUESTION_CLOSED`).

---

## Реплеи: запись и проигрывание

**Recorder** пишет входящий фид из ЛЮБОГО активного источника в
`./recordings/{matchId}.jsonl` — так живой матч или симуляция превращается в
реплей для разработки и демо. Каждая строка:
`{ "kind": "odds" | "match", "payload": … }`, отсортировано по `ts`.

```bash
# записать: любой запуск SimFeed уже пишет ./recordings/brazil-germany.jsonl
pnpm dev

# проиграть записанное:
FEED_SOURCE=replay REPLAY_FILE=./recordings/demo.jsonl pnpm dev
```

Записи сохраняются в каталог `recordings/` относительно рабочего каталога
сервера (`apps/server`). В репозитории лежит готовый
[`apps/server/recordings/demo.jsonl`](apps/server/recordings/demo.jsonl).

---

## Подключение реального TxODDS

`TxOddsFeed` теперь не генерирует данные и не падает с TODO. Он подключается к
реальному JSON feed TxODDS через HTTP polling или WebSocket и нормализует данные в
доменные `OddsUpdate` / `MatchEvent`.

Минимальный `.env`:

```env
FEED_SOURCE=txodds
TXODDS_API_URL=https://example.txodds.endpoint/live/{matchId}
TXODDS_API_KEY=...
TXODDS_MATCH_ID=external-fixture-id
```

Для TxLINE FreeTier devnet используй SSE endpoints. Сначала в TxLINE нужно оформить free subscription
в devnet, получить guest JWT через `/auth/guest/start`, подписать activation message кошельком и получить
activated API token через `/api/token/activate`. Приватный ключ в приложение не нужен.

```env
FEED_SOURCE=txodds
TXODDS_MODE=sse
TXODDS_API_URL=https://txline-dev.txodds.com/api/odds/stream?fixtureId={matchId}
TXODDS_SCORES_API_URL=https://txline-dev.txodds.com/api/scores/stream?fixtureId={matchId}
TXODDS_MATCH_ID=
TXODDS_API_KEY=<activated API token>
```

Минимально для приложения достаточно один раз получить и вставить `TXODDS_API_KEY`. Если этот ключ есть,
backend сам переключится на `txodds`, сам получит guest JWT через `/auth/guest/start`, сам выставит devnet
SSE URLs, сам вызовет `fixtures/snapshot`, выберет live или ближайший upcoming fixture и подключит оба stream.
`TXODDS_MATCH_ID` нужен только как ручной override для отладки.

`TxOddsFeed` откроет два SSE-потока: odds и scores. Odds payload TxLINE (`PriceNames`, `Prices`/`Pct`)
превращается в `OddsUpdate`, score actions (`Goal`, `Corner`, карточки и т.п.) превращаются в `MatchEvent`.

Автоматический devnet-flow без ручного копирования токенов:

```bash
pnpm txline:activate
```

Команда запускает backend-скрипт `apps/server/src/scripts/txlineActivate.ts`: создает локальный
`apps/server/solana-keypair.json`, если его еще нет, запрашивает devnet SOL на комиссию,
отправляет бесплатную `subscribe` транзакцию в TxLINE program, получает guest JWT, подписывает
activation message этим же keypair, получает API token и обновляет корневой `.env`.

Если devnet faucet не сработал, пополни напечатанный wallet вручную и повтори:

```bash
pnpm txline:activate -- --skip-airdrop
```

Для WebSocket:

```env
TXODDS_API_URL=wss://example.txodds.endpoint/live
TXODDS_MODE=ws
TXODDS_SUBSCRIBE_MESSAGE={"type":"subscribe","matchId":"{matchId}"}
```

По умолчанию ключ уходит как `Authorization: Bearer <key>`. Если в контракте
TxODDS используется другой header, настрой:

```env
TXODDS_API_KEY_HEADER=x-api-key
TXODDS_API_KEY_PREFIX=
```

Авто-маппинг понимает типовые JSON-формы:

- probabilities: `home/draw/away`, `probs`, `probabilities`;
- decimal odds: `odds`, `prices`, `markets[].selections[]`;
- события: `goal`, `corner`, `yellow_card`, `red_card`, `kickoff`,
  `halftime`, `second_half`, `fulltime`.

Если приватная схема TxODDS отличается, задай dot-path поля:

```env
TXODDS_MINUTE_PATH=payload.minute
TXODDS_TS_PATH=payload.updatedAt
TXODDS_ODDS_HOME_PATH=payload.markets.0.outcomes.0.price
TXODDS_ODDS_DRAW_PATH=payload.markets.0.outcomes.1.price
TXODDS_ODDS_AWAY_PATH=payload.markets.0.outcomes.2.price
TXODDS_EVENT_TYPE_PATH=payload.event.type
TXODDS_EVENT_TEAM_PATH=payload.event.team
```

Остальной код менять не нужно: `MatchRoom`, WS и miniapp работают только с
нормализованными событиями.

---

## Solana (FEATURE FLAG, по умолчанию выключен)

- `SOLANA_ENABLED=false` — используется `NoopCommitter`: в лог пишется
  `chain commit skipped`, всё работает без сети. Остальной код от Solana не зависит.
- `SOLANA_ENABLED=true` — `DevnetCommitter` сериализует итог матча (счёт,
  победившая сторона, топ-10, sha256-хэш полного лога ответов) в memo-инструкцию
  транзакции на **devnet** от серверного keypair (`SOLANA_KEYPAIR_PATH`). Подпись
  показывается в итоговом экране как «Результат зафиксирован on-chain» со ссылкой
  на explorer.

Включение devnet-коммита:

```bash
# создать keypair (нужен solana-cli) и пополнить его на devnet
solana-keygen new -o ./solana-keypair.json
solana airdrop 1 --keypair ./solana-keypair.json --url devnet

# включить флаг
SOLANA_ENABLED=true SOLANA_KEYPAIR_PATH=./solana-keypair.json pnpm dev
```

Минт cNFT-трофеев в MVP не реализован — оставлен TODO-интерфейс `mintTrophies`.

---

## Тесты

`pnpm test` (vitest) покрывает игровое ядро:

- резолв всех 5 типов вопросов, включая `void`, и бонус на угловом;
- формулы скоринга, урона и Fan Power;
- анти-latency правило (ответ после `locked` отклоняется).

---

## Скоуп MVP

Один матч (hardcoded «Бразилия — Германия»), одна комната, общий мультиплеер, три
источника фида, 5 типов микро-прогнозов, экраны Pick / Arena / Summary /
Leaderboard, визуальные реакции на события, SQLite-персистентность, Solana за
флагом. Не входит: реальные деньги/беттинг, матчмейкинг, чат, несколько матчей,
пуш-уведомления, нативные iOS/Android, админ-панель, i18n.
