/**
 * Checkout — processes payments via Stripe.
 * 🔴 CRITICAL: Any change here affects real financial transactions.
 */
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

async function createPaymentIntent(amount, currency, customerId) {
  const intent = await stripe.paymentIntents.create({
    amount,
    currency,
    customer: customerId,
    payment_method_types: ["card"],
  });
  return intent;
}

async function refundPayment(paymentIntentId) {
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
  });
  return refund;
}

async function getPaymentStatus(paymentIntentId) {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return intent.status;
}

module.exports = { createPaymentIntent, refundPayment, getPaymentStatus };
