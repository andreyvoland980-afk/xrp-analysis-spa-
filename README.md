# XRP Analysis – Single Page App (React + Vite)

Одностраничное приложение: TradingView график, внутренний график с авто S/R, RSI/MACD/SMA, сигнал Long/Short,
1‑часовой прогноз, фундаменталка, Telegram‑алерты (через backend или напрямую).

## Локальный запуск
```bash
npm install
npm run dev
# откройте адрес из консоли (обычно http://localhost:5173)
```

## Деплой на Vercel (Frontend)
1. Войдите на https://vercel.com → **New Project** → **Import** → **Upload** и загрузите содержимое этой папки.
2. После деплоя получите URL вида `https://your-frontend.vercel.app`.
3. В приложении (правый блок → Telegram Alerts) вставьте **Backend URL** из вашего бэкенда, например:
   `https://your-project.vercel.app/api/telegram`, нажмите **Backend ON** и **Send Test**.

## Источники данных
- История и фундаменталка: CoinGecko (без ключа).
- Реальное время (USD): Binance WebSocket (XRPUSDT).
- Графики и TA‑виджеты: TradingView (встраиваемые виджеты).

**Важное:** Модель сигналов и вероятностей носит образовательный характер, не является финансовой рекомендацией.
