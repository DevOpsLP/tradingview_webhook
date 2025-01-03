const express = require('express');

const app = express();
const PORT = 3002;

// Middleware to parse incoming JSON data
app.use(express.json());

// Route to handle webhooks
app.post('/webhook', (req, res) => {
  console.log('Webhook received:', req.body);

  // Respond to the webhook
  res.status(200).send({ message: 'Webhook received successfully' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});