# Деплой фронтенда Lumina на Vercel

## Вариант 1: Через Vercel CLI

1. Установите Vercel CLI (один раз):
   ```bash
   npm i -g vercel
   ```
2. В корне репозитория выполните:
   ```bash
   cd F:\aura
   vercel
   ```
   При первом запуске ответьте на вопросы (логин, проект, линк с Git при желании). Деплой идёт из корня: в `vercel.json` указаны `installCommand` и `buildCommand` с переходом в `frontend/`.

3. Переменные окружения задайте в [Vercel Dashboard](https://vercel.com/dashboard) → ваш проект → **Settings** → **Environment Variables**:
   - `VITE_ENGINE_ADDRESS` — адрес движка (Engine proxy)
   - `VITE_REGISTRY_ADDRESS` — адрес реестра рынков
   - `VITE_CHAIN_ID` — например `11155111` (Sepolia) или `42161` (Arbitrum)
   - `VITE_WALLETCONNECT_PROJECT_ID` — (опционально) проект из https://cloud.walletconnect.com

4. Продакшен-деплой:
   ```bash
   vercel --prod
   ```

## Вариант 2: Через сайт Vercel (Git)

1. Залейте репозиторий на GitHub/GitLab/Bitbucket.
2. Зайдите на [vercel.com](https://vercel.com) → **Add New** → **Project** → импортируйте репозиторий.
3. **Root Directory** оставьте пустым (корень) — в корне уже есть `vercel.json`, который собирает приложение из папки `frontend/`.
4. В разделе **Environment Variables** добавьте переменные из списка выше.
5. Нажмите **Deploy**.

## Кнопка «Получить 1000 тестовых LUMINA» на продакшене

На Vercel нет бэкенда, поэтому запрос на `/api/faucet/aura` с сайта не сработает. Чтобы кнопка работала:

1. **Поднимите бэкенд отдельно** (Railway, Render, Fly.io, VPS и т.д.). В его `.env` должны быть `AURA_TOKEN_ADDRESS` (адрес токена LUMINA), `FAUCET_PRIVATE_KEY`, для Sepolia — `RPC_URL`.
2. В **Vercel** → проект → **Settings** → **Environment Variables** добавьте:
   - **Name:** `VITE_API_URL`
   - **Value:** URL бэкенда **без** слэша в конце, например `https://lumina-backend.railway.app`
3. **Пересоберите и задеплойте** фронт (Redeploy в Vercel или новый коммит). Переменные `VITE_*` подставляются при сборке, поэтому после добавления `VITE_API_URL` нужен новый деплой.

После этого кнопка на странице Governance будет отправлять запрос на `VITE_API_URL + /api/faucet/aura`.

## Важно

- На Vercel деплоится только **фронтенд**. Бэкенд (`/api/config/contracts`, фаусет и т.д.) на Vercel не поднимается. Контракты подставляются из `VITE_ENGINE_ADDRESS` и `VITE_REGISTRY_ADDRESS`.
- Если бэкенд на другом домене — задайте `VITE_API_URL` в Vercel (см. выше), иначе кнопка «Получить 1000 тестовых LUMINA» и другие вызовы `/api/...` будут уходить на тот же домен (Vercel) и давать 404.
