const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.raw({ type: 'application/json' }));
app.use(express.json());

// Gmail transporter setup
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// Logging array to store recent activities
const logs = [];
const addLog = (message) => {
  const timestamp = new Date().toISOString();
  logs.push({ timestamp, message });
  // Keep only last 50 logs
  if (logs.length > 50) logs.shift();
  console.log(`[${timestamp}] ${message}`);
};

// Helper function to format currency
const formatCurrency = (amount, currency) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(amount / 100);
};

// Helper function to format date
const formatDate = (timestamp) => {
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });
};

// Send email notification for failed payment
async function sendFailedPaymentNotification(charge) {
  try {
    const customer = charge.customer ? await stripe.customers.retrieve(charge.customer) : null;
    const customerName = customer?.name || 'Unknown Customer';
    const customerEmail = customer?.email || charge.billing_details?.email || 'No email provided';
    
    const subject = `🚨 Failed Payment Alert - ${formatCurrency(charge.amount, charge.currency)}`;
    
    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #d32f2f; margin-bottom: 20px;">💳 Payment Failed</h2>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #333;">Payment Details</h3>
          <p><strong>Amount:</strong> ${formatCurrency(charge.amount, charge.currency)}</p>
          <p><strong>Date:</strong> ${formatDate(charge.created)}</p>
          <p><strong>Charge ID:</strong> ${charge.id}</p>
          <p><strong>Failure Reason:</strong> ${charge.failure_message || charge.outcome?.seller_message || 'Unknown reason'}</p>
          <p><strong>Failure Code:</strong> ${charge.failure_code || 'N/A'}</p>
        </div>
        
        <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #333;">Customer Information</h3>
          <p><strong>Name:</strong> ${customerName}</p>
          <p><strong>Email:</strong> ${customerEmail}</p>
          ${customer?.id ? `<p><strong>Customer ID:</strong> ${customer.id}</p>` : ''}
        </div>
        
        <div style="background-color: #fff3e0; padding: 15px; border-radius: 5px;">
          <h3 style="margin-top: 0; color: #333;">Card Information</h3>
          <p><strong>Last 4 digits:</strong> ****${charge.payment_method_details?.card?.last4 || 'N/A'}</p>
          <p><strong>Brand:</strong> ${charge.payment_method_details?.card?.brand?.toUpperCase() || 'Unknown'}</p>
          <p><strong>Decline Code:</strong> ${charge.payment_method_details?.card?.decline_code || 'N/A'}</p>
        </div>
        
        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
          <p>This notification was sent automatically by your Stripe Failed Payments Monitor.</p>
          <p>Timestamp: ${new Date().toLocaleString()}</p>
        </div>
      </div>
    `;

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: 'blakeecom02@gmail.com',
      subject: subject,
      html: emailBody
    };

    await transporter.sendMail(mailOptions);
    addLog(`Failed payment notification sent for charge ${charge.id} - ${formatCurrency(charge.amount, charge.currency)}`);
    return true;
  } catch (error) {
    addLog(`Error sending failed payment notification: ${error.message}`);
    throw error;
  }
}

// Stripe webhook endpoint
app.post('/stripe/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    addLog(`Received Stripe webhook: ${event.type}`);
  } catch (err) {
    addLog(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Handle the event
    switch (event.type) {
      case 'charge.failed':
        const failedCharge = event.data.object;
        addLog(`Processing failed charge: ${failedCharge.id} for ${formatCurrency(failedCharge.amount, failedCharge.currency)}`);
        await sendFailedPaymentNotification(failedCharge);
        break;
      
      default:
        addLog(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    addLog(`Error processing webhook: ${error.message}`);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'Stripe Failed Payments Monitor'
  });
});

// Status endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Stripe Failed Payments Monitor',
    status: 'running',
    endpoints: {
      'POST /stripe/webhook': 'Receives Stripe webhook events',
      'GET /health': 'Health check',
      'GET /logs': 'View recent activity logs',
      'POST /test': 'Test notification system'
    },
    notification_email: 'blakeecom02@gmail.com',
    monitored_events: ['charge.failed'],
    timestamp: new Date().toISOString()
  });
});

// Logs endpoint
app.get('/logs', (req, res) => {
  res.json({
    recent_logs: logs.slice(-20), // Last 20 logs
    total_logs: logs.length
  });
});

// Test endpoint
app.post('/test', async (req, res) => {
  try {
    addLog('Manual test initiated');
    
    // Create a mock failed charge for testing
    const mockFailedCharge = {
      id: 'ch_test_' + Date.now(),
      amount: 2999,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      failure_message: 'Your card was declined.',
      failure_code: 'card_declined',
      customer: null,
      billing_details: {
        email: 'test@example.com'
      },
      payment_method_details: {
        card: {
          last4: '4242',
          brand: 'visa',
          decline_code: 'generic_decline'
        }
      },
      outcome: {
        seller_message: 'The bank declined the payment.'
      }
    };

    await sendFailedPaymentNotification(mockFailedCharge);
    
    res.json({ 
      success: true, 
      message: 'Test notification sent successfully',
      test_charge_id: mockFailedCharge.id,
      sent_to: 'blakeecom02@gmail.com'
    });
  } catch (error) {
    addLog(`Test failed: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Start server
app.listen(port, () => {
  addLog(`Stripe Failed Payments Monitor started on port ${port}`);
  console.log(`Server running on port ${port}`);
});

module.exports = app;