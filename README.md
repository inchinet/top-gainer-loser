# Top Gainer / Loser Stocks(TWN/USA)

![Internet View 1a](https://github.com/inchinet/top-gainer-loser/blob/main/view-1a.png)
![Internet View 1b](https://github.com/inchinet/top-gainer-loser/blob/main/view-1b.png)
![Internet View 2](https://github.com/inchinet/top-gainer-loser/blob/main/view-2.png)

Node.js project for showing stock market gainers and losers in a browser.

It serves a static HTML frontend and an API endpoint that returns stock data for:

- US gainers and losers from Yahoo Finance
- US screener data from TradingView
- Taiwan gainers and losers from TradingView
- Taiwan screener data with `0050` and `0052` inserted at the end, from TradingView

## Files

- `server.js` - local HTTP server and stock data fetcher
- `top-gainer-loser.html` - main frontend page
- `top-gainer-loser2.html` - alternate frontend page (side by side)

## Run Locally

The server listens on port `3001`.

```powershell
node server.js
```

Then open:

- `http://localhost:3001/top-gainer-loser.html`
- `http://localhost:3001/top-gainer-loser2.html`

The API is available at:

- `http://localhost:3001/api/stocks`

## What It Does

The server currently:

- fetches US gainers and losers from Yahoo Finance pages
- fetches US screener data from the TradingView scanner API
- fetches Taiwan gainers and losers from TradingView pages
- fetches Taiwan screener data from the TradingView scanner API
- builds TradingView chart links for each symbol
- serves the HTML page directly from the same Node process

## Deployment Notes

For a Linux server with PM2 and Apache reverse proxy:

1. Copy `server.js` and the HTML files to the target directory on the server.
2. Start the Node process with PM2:

```bash
pm2 start server.js --name "stock-gainers-server"
pm2 save
```

3. Proxy the API endpoint through Apache if needed:

```apache
ProxyPass /api-stocks http://localhost:3001/api/stocks
ProxyPassReverse /api-stocks http://localhost:3001/api/stocks
```

4. Reload Apache and open the HTML page from your domain.

## Notes

- No dependency file is currently included in this folder.
- If you add npm packages later, run `npm install` in the project directory and commit the relevant lockfile if you use one.


## 📜 授權條款
MIT License - 開發者 [inchinet](https://github.com/inchinet)。歡迎自由使用及修改！
