# AZ Delivery — Testing the full order flow (v2)

Run this with THREE separate browser profiles (or incognito windows): a
**business** account, a **customer** account and a **rider** account. Register
each via the sign-in modal (Customer / Rider / Business tab).

Before starting, run `supabase/migrations/0018_order_flow_upgrades.sql` in the
Supabase SQL editor (after 0015/0017 if not already applied — everything is
idempotent). It ends with `notify pgrst, 'reload schema';`.

## 1. Business setup (unchanged)

1. Business: fill Business details (name, phone, address), then add a product
   with up to 4 photos. The Add product button stays disabled until address
   and phone are saved.

## 2. Order + business accept/ready

1. Customer: choose "Order from a business", select the business, add items,
   checkout (no delivery fee on the shop bill). The order shows **Placed**
   and the timeline starts.
2. Customer page shows **"Waiting for you to request a rider"** with a
   prominent **Request a rider** button.
3. Business page shows the new order with **"Customer has not requested a
   rider yet"**, plus **Accept order** (enter an optional prep time in
   minutes) and **Decline order** (asks for a reason → customer is notified
   and the order is cancelled).
4. Business accepts → status **accepted_by_business** → **Order ready for
   pickup** → status **ready_for_pickup**; rider and customer are notified.
5. Customer taps **Request a rider** → status **rider_requested**.

## 3. Business marks ready gates the rider

1. Rider (clocked in): accept the request — this works even while the
   business is preparing.
2. The rider's **"I've arrived at pickup"** button is DISABLED with
   **"The business is still preparing the order"**.
3. Business taps **Order ready for pickup**. The rider's button enables and
   the full pickup-code + "Confirm this is the rider" flow works as before
   (codes stay mandatory; no skip).

## 4. Customer not reachable at pickup

1. At the business, the rider taps "I've arrived at pickup" and waits.
2. After 5 minutes the rider can tap **"Customer not reachable"** — customer
   and business are notified, and everyone sees a countdown.
3. Business chooses **Keep waiting (+5 min)** (countdown extends) or
   **Cancel order** (reason prompt → rider released, customer notified).
4. The pickup code and business confirm remain REQUIRED — the only ways out
   are the code flow or the cancel fallback.

## 5. No rider accepts (timeout)

1. Create a rider request, but have the rider stay clocked out.
2. After 10 minutes (constant `NO_RIDER_TIMEOUT_MINUTES` in
   `src/data/flowConstants.ts`) the customer gets a notification and sees
   **Keep waiting / Cancel request**. Keep waiting restarts the timer;
   cancel cancels the order and notifies the business.
3. Before a rider accepts, the customer can cancel any time; after a rider
   accepts, cancel is allowed only until pickup is verified.

## 6. Customer not responding at the destination

1. Rider: "I've arrived at destination" → the customer sees the delivery
   code (big) and a notification; the rider never sees the code.
2. After 5 minutes the rider taps **"Customer not responding"** — customer
   and business are notified and a countdown shows.
3. After 15 minutes in total the rider taps **"Report failed delivery"** with
   a reason → status **delivery_failed**, the order is returned to the
   business, and business + customer are notified.
4. The delivery code can never be bypassed — a failed delivery is the only
   way out without the correct code.

## 7. Reminders + order history

1. If the customer never requests a rider, reminders arrive after 5 and 15
   minutes.
2. Every order shows **Order history** (order_events) for the customer,
   business and rider: status changes, code attempts (success/failure —
   never the code itself), timeouts, cancellations and reports.

## 8. Isolation + security checks

- Every state change goes through SECURITY DEFINER functions with role
  checks; invalid transitions return clear errors (e.g. accept twice, mark
  ready before accepting, cancel after pickup, arrive before ready).
- The pickup code is readable ONLY by the business, the delivery code ONLY
  by the customer, via `get_pickup_code`/`get_delivery_code`; `order_codes`
  columns are revoked from everyone.
- Each account only sees its own orders, jobs and notifications.

Expected: the business gates pickup with accept/ready, the rider cannot
arrive early, the customer drives the rider request and its timers, the
not-reachable / not-responding fallbacks work with countdowns, codes can
never be skipped, and every person only sees their own data.
