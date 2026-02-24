# resdiary-booking

Automated tool (Playwright) to make restaurant reservations on venues using the **ResDiary** platform.

## Prerequisites (install from scratch)

You need **Node.js 18 or newer** and **Chromium**. The steps below assume you have neither installed.

### 1. Install Node.js

Pick one method for your OS.

**Option A – Official installer (all platforms)**  
- Go to [nodejs.org](https://nodejs.org/) and download the **LTS** version.  
- Run the installer and follow the prompts.  
- Restart your terminal, then check:
  ```bash
  node -v   # should show v18.x or higher
  npm -v    # should show 9.x or higher
  ```

**Option B – macOS / Linux with Homebrew**
  ```bash
  brew install node
  node -v && npm -v
  ```

**Option C – macOS / Linux with nvm (Node Version Manager)**
  ```bash
  # Install nvm: https://github.com/nvm-sh/nvm#installing-and-updating
  nvm install 18
  nvm use 18
  node -v && npm -v
  ```

**Option D – Windows with winget**
  ```bash
  winget install OpenJS.NodeJS.LTS
  ```
  Restart the terminal and run `node -v` and `npm -v`.

### 2. Get the project

If you have the repo locally, go to its folder. Otherwise clone it (replace with your repo URL if different):

```bash
git clone <repository-url>
cd resdiary-booking
```

### 3. Install dependencies and Chromium

Install the project’s npm packages (this installs Playwright as a dependency) and then the Chromium browser used by Playwright:

```bash
npm install
npx playwright install chromium
```

Or use the project script for the browser only:

```bash
npm install
npm run install-browsers
```

After this you have Node, the project dependencies, and Chromium. No need to install Playwright globally.

### Summary: steps to run the tool

1. Install Node.js 18+ (see above).  
2. Open a terminal in the project folder (`resdiary-booking`).  
3. Run `npm install`, then `npx playwright install chromium` (or `npm run install-browsers`).  
4. Create and edit `config.json` (see [Configuration](#configuration)).  
5. Run `npm run book` (or `npm run book:headed` to see the browser).

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
