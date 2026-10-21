# AZ Delivery — Testing the full order flow (v3)

Run this with THREE separate browser profiles (or incognito windows): a
**business** account, a **customer** account and a **rider** account. Register
each via the sign-in modal (Customer / Rider / Business tab).

Before starting, run the migrations in the Supabase SQL editor IN THIS ORDER
(everything is idempotent and nothing deletes data):

1. `supabase/migrations/0019_quote_statuses.sql` — adds the new status enum
   values ONLY (each migration file runs in ONE transaction, so enum values
   must live in a file that runs before the code that uses them).
2. `supabase/migrations/0020_quote_flow_and_order_lists.sql` — everything
   else. It ends with `notify pgrst, 'reload schema';`.

(If not already applied, run 0015, 0017 and 0018 first — they are also
idempotent.)

## 1. Business setup (unchanged)

1. Business: fill Business details (name, phone, address), then add a product
   with up to 4 photos. The Add product button stays disabled until address
   and phone are saved.

## 2. Customer orders food; both sides see it

1. Customer: choose "Order from a business", select the business, add items,
   checkout. There is NO delivery fee anywhere on the customer's bill.
2. The order shows **Placed** under **My orders** with its timeline, the cart
   clears, and the business gets a realtime notification AND a new row in
   **New orders** with the customer's name, phone, items and total.
3. Business declines → reason prompt → the customer is notified and the order
   shows **Cancelled**. (Test this once with a second order.)

## 3. Business accepts with a preparation time (prep gate)

1. Business: in **New orders**, the order shows **Accept order** and
   **Decline**. The accept box has quick prep-time options 15 / 30 / 45 / 60
   minutes plus a custom field — accepting WITHOUT choosing a time is
   rejected.
2. Business accepts with **30 minutes** → the customer gets
   "{Business} will have your food ready in 30 minutes" and sees a prep
   countdown on the order card.
3. While the order is still **Placed** (not accepted), the customer's
   **Request a rider** button is DISABLED with the text
   "Waiting for the business to confirm and give a preparation time".
   After the accept it unlocks (status **accepted_by_business**).
4. Customer taps **Request a rider** → fills pickup address + pickup phone
   (prefilled from the business profile — the "Pickup phone is required"
   error must NOT appear when it is filled), delivery address + phone, item
   description. Status becomes **rider_requested**. There is no delivery-fee
   field on this form.

## 4. Rider quotes the price

1. Rider (clocked in): the request appears in **Available requests** with
   BOTH addresses and the item description — and NO price anywhere.
2. Rider taps **Quote a price**, enters the fee in naira, sends it. The
   request is now held for that rider (status **rider_quoted**).
3. A second rider sees the request as "Held by another rider" and cannot
   quote while the hold is active (SQL raises HELD_BY_ANOTHER_RIDER).
4. The customer gets a notification and a prominent card: rider name,
   vehicle, plate, the quoted price, the rider's phone number (tappable) and
   **Accept** / **Decline** buttons with a 5-minute countdown
   (`QUOTE_HOLD_MINUTES` in `src/data/flowConstants.ts`, mirrored by the SQL
   constant in migration 0020).
5. Customer taps **Accept** → status **rider_accepted**, the rider is
   assigned, the fee is stored on the order (quoted_fee_naira and
   delivery_fee_naira/total), and the rider gets the job in **My jobs**.

## 5. Quote fallbacks

1. **Customer declines**: tap **Decline** → the hold is released, the request
   returns to **rider_requested**, the rider is notified "Quote declined".
2. **Quote timeout**: let a quote sit unanswered for 5 minutes → the app
   releases it (expire_stale_quotes), the request returns to the pool, the
   rider gets "Your quote expired", the customer gets "Quote expired".
3. **Rider-only request** (no business): customer uses "Just order a rider" —
   no delivery-fee input; riders quote it exactly like a shop order; the
   business accept/prep step is skipped entirely.

## 6. Pickup + delivery codes (GOLDEN RULE — unchanged)

1. Business: for a shop order, tap **Order ready for pickup** → status
   **ready_for_pickup**; until then the rider's **"I've arrived at pickup"**
   stays disabled ("The business is still preparing the order").
2. Rider arrives at pickup → the BUSINESS sees the 6-digit **pickup code**
   (only the business, via get_pickup_code). The business calls the customer
   with the code; the customer tells the rider; the rider verifies it; the
   business confirms the rider. The rider NEVER sees the pickup code.
3. Rider picks up → arrives at destination → the CUSTOMER sees the 6-digit
   **delivery code** (only the customer, via get_delivery_code). The rider
   never sees it. Codes stay MANDATORY — there is no skip path anywhere.
4. Customer taps **I have received my order** → status **delivered**.

## 7. Not reachable / not responding / no rider (unchanged)

- Pickup: 5-minute wait, then "Customer not reachable" → business keeps
  waiting (+5 min) or cancels (rider released, customer notified).
- Destination: 5-minute wait for "Customer not responding", 15 minutes total
  before "Report failed delivery" → status **delivery_failed**, order
  returned to the business.
- `NO_RIDER_TIMEOUT_MINUTES` (10): the customer gets "No rider accepted yet"
  with Keep waiting / Cancel request.

## 8. Isolation + security checks

- The business list and the customer list load through SECURITY DEFINER
  functions (get_business_orders / get_customer_orders) — a failed load
  shows the REAL error on the page, never a silent empty list.
- A business sees only its own orders + items + the name/phone of its own
  customers. A customer sees only their own orders. A rider sees only open
  requests (addresses, no customer contact info, no price) and their own
  jobs. The quote card is only visible to the customer of that order.
- Every transition runs through SECURITY DEFINER functions with role checks
  (rider_quote_price, customer_accept_quote, customer_decline_quote,
  business_accept_order, business_mark_ready, …). Invalid transitions return
  clear errors.
- orders and order_items are in the supabase_realtime publication; the
  business and customer pages refetch live on insert/update, and everyone
  still gets realtime notifications.
- The pickup code is readable ONLY by the business; the delivery code ONLY
  by the customer; the rider sees neither.

Expected: the customer orders food, the order shows in both dashboards
instantly, the business accepts with a prep time, the Request-a-rider button
unlocks, a rider quotes a price, the customer accepts, the prep gate controls
the rider's arrival, the pickup and delivery codes work end to end, and every
person only sees their own data.
