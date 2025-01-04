require('dotenv').config();
const express = require('express');
const { USDMClient } = require('binance');
const WebSocket = require('ws');

const app = express();
const PORT = 3002;
const leverage = 30; // Leverage to use
let openOrders = {};

// Initialize Binance Client
const binanceClient = new USDMClient({
    api_key: process.env.BINANCE_API_KEY,
    api_secret: process.env.BINANCE_API_SECRET,
});

// Middleware to parse JSON payloads
app.use(express.json());

// Route to handle webhooks
// Helper function to get the step size decimals
const getDecimals = (stepSize) => {
    const parts = stepSize.split('.');
    return parts[1] ? parts[1].length : 0;
};

// Route to handle webhooks and place market orders
app.post('/webhook', async (req, res) => {
  console.log('Webhook received:', req.body);
  
  const { symbol, price, side } = req.body;
  
  if (!symbol || !price || !side) {
    console.error('Missing required fields: symbol, price, or side');
    return res.status(400).send({ error: 'Missing required fields: symbol, price, or side' });
  }
  
  if (side !== 'BUY' && side !== 'SELL') {
    console.error('Invalid side. Must be either BUY or SELL');
    return res.status(400).send({ error: 'Invalid side. Must be either BUY or SELL' });
  }
  
  try {
    // Fetch USDT balance using getBalanceV3
    const balances = await binanceClient.getBalanceV3();
    const usdtWallet = balances.find((balance) => balance.asset === 'USDT');
    
    if (!usdtWallet || parseFloat(usdtWallet.balance) <= 0) {
    console.error('Insufficient USDT balance');
    return res.status(400).send({ error: 'Insufficient USDT balance' });
    }
  
    const balance = parseFloat(usdtWallet.balance) - 1; // Use USDT balance
  
    // Fetch exchange info
    const exchangeInfo = await binanceClient.getExchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === symbol);
  
    if (!symbolInfo) {
    console.error(`Symbol ${symbol} not found in exchange info`);
    return res.status(404).send({ error: `Symbol ${symbol} not found in exchange info` });
    }
  
    // Get the LOT_SIZE filter
    const lotSizeFilter = symbolInfo.filters.find((filter) => filter.filterType === 'LOT_SIZE');
    if (!lotSizeFilter) {
    console.error('LOT_SIZE filter not found for the symbol');
    return res.status(500).send({ error: 'LOT_SIZE filter not found for the symbol' });
    }
  
    // Get decimals for step size
    const decimals = getDecimals(lotSizeFilter.stepSize);
  
    // Calculate the amount to trade
    const quantity = ((balance * leverage) / price).toFixed(decimals);
  
    // Place a market order
    const orderResponse = await binanceClient.submitNewOrder({
    symbol,
    side,
    type: 'MARKET',
    quantity,
    });
  
    console.log(`Market order placed:`, orderResponse);
  
    // Store the order details in memory
    openOrders[symbol] = { orderId: orderResponse.orderId, side, quantity };
  
    // Open WebSocket connection to Binance
    const wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_5m`;
    const ws = new WebSocket(wsUrl);
  
    // Handle WebSocket events
    ws.on('open', () => {
    console.log(`WebSocket connected for ${symbol}`);
    });
  
    ws.on('message', async (data) => {
    const parsed = JSON.parse(data);
    if (parsed.e === 'kline' && parsed.k.x) {
      console.log(`Candle closed for ${symbol}. Sending opposite order...`);
  
      try {
      const { side: initialSide, quantity } = openOrders[symbol];
  
      // Determine the opposite side
      const oppositeSide = initialSide === 'BUY' ? 'SELL' : 'BUY';
  
      // Place the opposite market order
      const closeOrderResponse = await binanceClient.submitNewOrder({
        symbol,
        side: oppositeSide,
        type: 'MARKET',
        quantity,
      });
  
      console.log(`Opposite market order placed:`, closeOrderResponse);
  
      // Remove the order from memory
      delete openOrders[symbol];
      } catch (error) {
      console.error(`Failed to place opposite order for ${symbol}:`, error.message);
      } finally {
      // Close the WebSocket connection
      ws.close();
      }
    }
    });
  
    ws.on('error', (error) => {
    console.error(`WebSocket error for ${symbol}:`, error.message);
    });
  
    ws.on('close', () => {
    console.log(`WebSocket closed for ${symbol}`);
    });
  
    res.status(200).send({
    message: 'Market order placed successfully, WebSocket started',
    orderResponse,
    });
  } catch (error) {
    console.error('Error placing market order:', error.message);
    res.status(500).send({ error: 'Failed to place market order' });
  }
  });
// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});