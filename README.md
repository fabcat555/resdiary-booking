# resdiary-booking

Automated tool (Playwright) to make restaurant reservations on venues using the **ResDiary** platform.

## Requirements

- Node.js 18+
- Chromium (installed via Playwright)

## Setup

```bash
cd resdiary-booking
npm install
npx playwright install chromium
```

## Configuration

1. Copy the example config and adjust it for the restaurant and reservation:

```bash
cp config.example.json config.json
```

2. Edit `config.json`:

- **bookingUrl**: ResDiary booking page URL (restaurant website or direct widget URL).
- **useUrlParams**: if `true`, appends ResDiary query params `date`, `time`, `partySize` to the URL. **Most widgets (e.g. Trippa) do not support them**: keep `false` and date, time and party size are selected in the UI (calendar + dropdown).
- **reservation**: `date` (YYYY-MM-DD), `time` (e.g. 19:30), `partySize` (number of guests). Used by the script to fill the calendar and dropdown when `useUrlParams` is `false`.
- **contact**: `name`, `email`, `phone`.
- **payment** (optional): if the restaurant requires a card (Stripe payment), add `cardNumber`, `expiry` (MM/YY), `cvc`, and optionally `cardholderName`. To avoid storing the card in `config.json`, use env vars: `STRIPE_CARD_NUMBER`, `STRIPE_EXPIRY`, `STRIPE_CVC`, `STRIPE_CARDHOLDER_NAME`.
- **selectors**: (optional) if the restaurant’s widget uses different classes/IDs, you can override selectors for date, time, party size, name, email, phone, buttons, and (for Stripe) iframes and card fields.

### Trippa Milano preset

For **Trippa Milano** (and ResDiary widgets with the same layout: party size/time dropdowns, calendar, contact step with first/last name, Stripe payment):

```bash
cp config.trippa.example.json config.json
```

Then edit `reservation`, `contact`, and `payment` with your details.

You can use either the restaurant’s page or the **direct widget URL**:
- **Website** (e.g. `https://www.trippamilano.it/book-a-table-2/`): the widget is in an iframe; the script detects it and works inside it.
- **Direct widget** (e.g. `https://booking.resdiary.com/widget/Standard/TRATTORIATRIPPA/8771`): no iframe; the script uses the main page. Same selectors, same flow. To skip iframe detection (and ~5 s wait), set `"iframe": ""` in config.

The preset uses:

- Page: `https://www.trippamilano.it/book-a-table-2/` (widget in ResDiary iframe)
- Party size/time: dropdowns to click (not `<select>`)
- Date: click on the day in the calendar (`data-day="DD/MM/YYYY"`)
- Contact: `firstName`, `lastName`, `email`, `phone` (“Mobile number” field)
- Confirm step: terms checkbox and “Next”
- Payment: “Name on card” + Stripe iframes for `#card-number`, `#card-expiry`, `#card-cvc`

ResDiary widget URLs often look like:

`https://book.resdiary.com/widget/Standard/RestaurantName/12345`

Only if the widget supports it (rare), you can prefill with `useUrlParams: true` and query params `?date=...&time=...&partySize=...`. Otherwise the script selects date, time and party size in the UI.

## Usage

- **Normal run (browser in background):**
  ```bash
  npm run book
  ```

- **With visible browser (useful for debugging):**
  ```bash
  npm run book:headed
  ```
  or:
  ```bash
  HEADED=1 npm run book
  ```

- **With Node debugger (breakpoints from IDE/Chrome):**
  ```bash
  npm run book:debug
  ```
  **The script pauses** until you attach the debugger. You’ll see a message in the terminal; open **Chrome** → `chrome://inspect` → “Open dedicated DevTools for Node”, or **Cursor/VS Code** → Run → “Attach to Node Process”. Then press F8 (Continue). To start the script immediately and attach later: `npm run book:debug:run`.
  ```bash
  npm run book:debug:run
  ```
  (Then open `chrome://inspect` in Chrome and click “Open dedicated DevTools for Node”, or in VS Code/Cursor use “Attach to Node Process” / launch config with `"request": "attach"`. With `--inspect-brk` execution stops on the first line; with `node --inspect book.js` it starts right away and you can attach the debugger when you want.)

## Tests

```bash
npm test
```

Tests use Playwright Test; for a meaningful run you need a `config.json` with a valid booking URL (or a mock).

## Notes

- The ResDiary widget may be inside an **iframe**: the script finds an iframe whose `src` contains `resdiary` or `book.` and runs inside it.
- **Stripe payment**: many ResDiary restaurants ask for a card (deposit/hold) via Stripe. After submitting contact and reservation, the script fills the Stripe iframes (card number, expiry, CVC) and clicks Pay/Confirm. Stripe iframe titles (e.g. “Secure card number input frame”) can vary; in that case override `selectors.stripeCardFrame`, `stripeExpiryFrame`, `stripeCvcFrame` in `config.json`.
- Default selectors are generic; if a restaurant customizes the widget you may need custom **selectors** in `config.json`.
- ResDiary can use multi-step flows (e.g. check availability → choose slot → contact details → confirm → payment). The selectors `searchAvailabilityButton`, `timeSlotButton`, `submitButton`, `confirmButton`, `payButton` handle these steps; adjust them for the actual site if needed.
