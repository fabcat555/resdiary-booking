/**
 * Script Playwright per prenotazioni automatiche su siti che usano ResDiary.
 * Supporta URL con parametri (date, time, partySize), iframe e selectors configurabili.
 *
 * Uso:
 *   npm run book
 *   HEADED=1 npm run book   (browser visibile, utile per debug)
 *
 * Configurazione: config.json (copia da config.example.json)
 */

import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { format, getDate, getDaysInMonth } from 'date-fns';
import { DEFAULT_SELECTORS, buildBookingUrl, findClosestTimeIndex, findLocator, loadConfig, parseDdMmYyyy, parseIsoDate, parseTimeToMinutes, toIsoDate } from './utils.js'; 

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, 'config.json');

if (process.execArgv?.some((a) => String(a).includes('inspect'))) {
  console.log(
    '\n[DEBUG] Node in ascolto. Per attaccare il debugger:\n  • Chrome: apri chrome://inspect → "Open dedicated DevTools for Node"\n  • Cursor/VS Code: Run → "Attach to Node Process" (scegli il processo node)\n  Con --inspect-brk lo script è in pausa: attacca e poi continua (F8).\n'
  );
}

/**
 * Compila il form di prenotazione e invia.
 * @param {import('playwright').Page} page
 * @param {object} config
 */
async function runBooking(page, config) {
  const { reservation, contact, selectors: configSelectors, useUrlParams, waitAfterPageLoad, waitAfterPaymentConfirm } = config;
  const sel = { ...DEFAULT_SELECTORS, ...configSelectors };

  const baseUrl = config.bookingUrl;
  const finalUrl = useUrlParams !== false && reservation ? buildBookingUrl(baseUrl, reservation) : baseUrl;

  console.log('Apertura URL:', finalUrl);
  const gotoOpts = { timeout: config.timeout || 30000, waitUntil: config.waitUntil || 'load' };
  await page.goto(finalUrl, gotoOpts);

  let ctx = page;
  if (sel.iframe) {
    const frameEl = page.locator(sel.iframe).first();
    try {
      await frameEl.waitFor({ state: 'visible', timeout: 5000 });
      ctx = page.frameLocator(sel.iframe).first();
      console.log('Utilizzo contenuto iframe ResDiary.');
    } catch {
      console.log('Nessun iframe trovato, uso pagina principale.');
    }
  }

  // Procedi appena il form è pronto (primo elemento visibile), max waitAfterPageLoad ms
  const maxWait = typeof waitAfterPageLoad === 'number' ? waitAfterPageLoad : 5000;
  const firstFormSel = sel.partySizeDropdown || sel.timeDropdown || '.rd-time-dropdown, #party-size-input, [class*="datepicker"]';
  if (firstFormSel) {
    try {
      await ctx.locator(firstFormSel.split(',')[0].trim()).first().waitFor({ state: 'visible', timeout: maxWait });
    } catch {
      if (maxWait > 0) await page.waitForTimeout(Math.min(maxWait, 800));
    }
  }

  const fill = async (selectorKey, value, label) => {
    if (!value) return;
    const loc = findLocator(ctx, sel[selectorKey] || DEFAULT_SELECTORS[selectorKey]);
    if (!loc) return;
    try {
      await loc.waitFor({ state: 'visible', timeout: 5000 });
      await loc.fill(value);
      console.log('  Compilato', label || selectorKey);
    } catch (e) {
      console.warn('  Impossibile compilare', label || selectorKey, e.message);
    }
  };

  /** Try to select an adjacent day (same month). Tries forward first (22, 23, 24…), then backward (20, 19…). Uses the site's :not(.disabled) so we only click cells the widget marks as available. */
  const selectAdjacentAvailableDate = async (targetDateIso, datePickerSel, radiusDays = 15) => {
    const targetDate = parseIsoDate(targetDateIso);
    if (!targetDate || !datePickerSel) return null;
    const day = getDate(targetDate);
    const daysInMonth = getDaysInMonth(targetDate);
    const candidates = [];
    for (let offset = 1; offset <= radiusDays; offset++) {
      if (day + offset <= daysInMonth) candidates.push(day + offset);
    }
    for (let offset = 1; offset <= radiusDays; offset++) {
      if (day - offset >= 1) candidates.push(day - offset);
    }
    const monthSuffix = '/' + format(targetDate, 'MM/yyyy');
    const calendarScope = ctx.locator(`table:has(td[data-day$='${monthSuffix}']), [class*="calendar"]:has(td[data-day$='${monthSuffix}'])`).first();
    const scopeExists = await calendarScope.count().then((n) => n > 0).catch(() => false);
    const base = scopeExists ? calendarScope : ctx;
    for (const d of candidates) {
      const dateStr = format(new Date(targetDate.getFullYear(), targetDate.getMonth(), d), 'dd/MM/yyyy');
      const cellSel = datePickerSel.replace('__DATE__', dateStr);
      const cell = base.locator(cellSel).first();
      await cell.click().catch(() => null);
      return dateStr;
    }
    return null;
  };

  const selectOption = async (selectorKey, value, label) => {
    if (value == null || value === '') return;
    const loc = findLocator(ctx, sel[selectorKey] || DEFAULT_SELECTORS[selectorKey]);
    if (!loc) return;
    try {
      await loc.waitFor({ state: 'visible', timeout: 5000 });
      await loc.selectOption({ value: String(value) }).catch(() => loc.selectOption({ label: String(value) }));
      console.log('  Selezionato', label || selectorKey);
    } catch (e) {
      console.warn('  Impossibile selezionare', label || selectorKey, e.message);
    }
  };

  /** Seleziona l'orario richiesto o il più vicino disponibile nel select. */
  const selectTimeClosest = async (context, requestedTime, selectorMap) => {
    if (!requestedTime) return;
    const timeSel = selectorMap.timeSelect || DEFAULT_SELECTORS.timeSelect;
    const loc = context.locator(timeSel).first();
    try {
      await loc.waitFor({ state: 'visible', timeout: 5000 });
      const optionsData = await loc.locator('option').evaluateAll((opts) =>
        opts.filter((o) => o.value && o.value.trim() !== '').map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
      );
      if (!optionsData.length) return;
      const exact = optionsData.find((o) => o.label === requestedTime || o.value === requestedTime || parseTimeToMinutes(o.label) === parseTimeToMinutes(requestedTime));
      if (exact) {
        await loc.selectOption({ value: exact.value });
        console.log('  Selezionato orario richiesto (select)');
        return;
      }
      const requestedMin = parseTimeToMinutes(requestedTime);
      let bestIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < optionsData.length; i++) {
        const min = parseTimeToMinutes(optionsData[i].label || optionsData[i].value);
        if (Number.isNaN(min)) continue;
        const diff = Math.abs(min - requestedMin);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      await loc.selectOption({ value: optionsData[bestIdx].value });
      console.log('  Orario più vicino disponibile (select):', optionsData[bestIdx].label || optionsData[bestIdx].value);
    } catch (e) {
      console.warn('  Impossibile selezionare orario', e.message);
    }
  };

  const clickButton = async (selectorKey) => {
    const selector = sel[selectorKey] || DEFAULT_SELECTORS[selectorKey];
    if (!selector) return false;
    const useVisibleOnly = selectorKey === 'nextButton';
    const loc = useVisibleOnly ? ctx.locator(selector) : findLocator(ctx, selector);
    try {
      if (useVisibleOnly) {
        const n = await loc.count();
        for (let i = 0; i < n; i++) {
          const el = loc.nth(i);
          if (await el.isVisible().catch(() => false)) {
            await el.click();
            console.log('  Clic', selectorKey);
            return true;
          }
        }
        return false;
      }
      await loc.waitFor({ state: 'visible', timeout: 5000 });
      await loc.click();
      console.log('  Clic', selectorKey);
      return true;
    } catch {
      return false;
    }
  };

  // Step 1: data/ora/numero persone
  if (reservation) {
    const partyDropdown = sel.partySizeDropdown || '';
    if (partyDropdown) {
      try {
        await ctx.locator(partyDropdown).first().click();
        await page.waitForTimeout(60);
        await ctx.locator(`li:has-text('${reservation.partySize}')`).first().click();
        console.log('  Selezionati coperti (dropdown)');
      } catch (e) {
        console.warn('  Dropdown coperti:', e.message);
      }
    } else {
      await selectOption('partySizeSelect', reservation.partySize, 'coperti');
    }

    const datePickerSel = sel.datePickerDay || '';
    let selectedDateIso = reservation?.date || '';
    if (datePickerSel && reservation.date) {
      const [y, m, d] = reservation.date.split('-');
      const dayFormatted = `${d}/${m}/${y}`;
      const dayCellSelAny = datePickerSel.replace('__DATE__', dayFormatted).replace(/:not\(\.disabled\)/g, '');
      const nextSel = sel.datePickerNext || DEFAULT_SELECTORS.datePickerNext;
      const prevSel = sel.datePickerPrev || DEFAULT_SELECTORS.datePickerPrev;
      const waitAfterMonthMs = config.datePickerWaitAfterMonthChange ?? 80;
      const dayPollIntervalMs = 60;
      const dayPollMaxAttempts = 8;
      let clicked = false;
      const tryClickDay = async (waitForLoad = false) => {
        const cell = ctx.locator(dayCellSelAny).first();
        const visibleTimeout = waitForLoad ? 3000 : 600;
        try {
          await cell.waitFor({ state: 'visible', timeout: visibleTimeout });
        } catch {
          return false;
        }
        for (let attempt = 0; attempt < dayPollMaxAttempts; attempt++) {
          const cls = await cell.getAttribute('class').catch(() => '');
          if (cls && cls.includes('disabled')) {
            await page.waitForTimeout(dayPollIntervalMs);
            continue;
          }
          await cell.click();
          return true;
        }
        return false;
      };

      const onRightMonthButDayDisabled = async () => {
        const cell = ctx.locator(dayCellSelAny).first();
        const visible = await cell.isVisible().catch(() => false);
        if (!visible) return false;
        const cls = await cell.getAttribute('class').catch(() => '');
        return !!(cls && cls.includes('disabled'));
      };

      for (let i = 0; i < 12 && !clicked; i++) {
        clicked = await tryClickDay(i > 0);
        if (clicked) break;
        if (await onRightMonthButDayDisabled()) {
          const adjacentRadius = config.dateAdjacentRadiusDays ?? 15;
          const fallbackDay = await selectAdjacentAvailableDate(reservation.date, datePickerSel, adjacentRadius);
          if (fallbackDay) {
            console.log(`  Data richiesta non disponibile, selezionata data adiacente: ${fallbackDay}`);
            const dt = parseDdMmYyyy(fallbackDay);
            if (dt) selectedDateIso = toIsoDate(dt);
            clicked = true;
          }
          break;
        }
        if (nextSel) {
          try {
            await ctx.locator(nextSel).first().click();
            await page.waitForTimeout(waitAfterMonthMs);
          } catch {
            break;
          }
        }
      }
      if (!clicked && prevSel) {
        for (let back = 0; back < 24; back++) {
          try {
            await ctx.locator(prevSel).first().click();
            await page.waitForTimeout(waitAfterMonthMs);
          } catch {
            break;
          }
        }
        for (let i = 0; i < 12 && !clicked; i++) {
          clicked = await tryClickDay(i > 0);
          if (clicked) break;
          if (await onRightMonthButDayDisabled()) {
            const adjacentRadius = config.dateAdjacentRadiusDays ?? 15;
            const fallbackDay = await selectAdjacentAvailableDate(reservation.date, datePickerSel, adjacentRadius);
            if (fallbackDay) {
              console.log(`  Data richiesta non disponibile, selezionata data adiacente: ${fallbackDay}`);
              const dt = parseDdMmYyyy(fallbackDay);
              if (dt) selectedDateIso = toIsoDate(dt);
              clicked = true;
            }
            break;
          }
          if (nextSel) {
            try {
              await ctx.locator(nextSel).first().click();
              await page.waitForTimeout(waitAfterMonthMs);
            } catch {
              break;
            }
          }
        }
      }
      if (clicked) {
        if (!selectedDateIso || selectedDateIso === reservation.date) {
          console.log('  Selezionata data (calendario)');
        }
      } else {
        const adjacentRadius = config.dateAdjacentRadiusDays ?? 15;
        const fallbackDay = await selectAdjacentAvailableDate(reservation.date, datePickerSel, adjacentRadius);
        if (fallbackDay) {
          console.log(`  Data richiesta non disponibile, selezionata data adiacente: ${fallbackDay}`);
          const dt = parseDdMmYyyy(fallbackDay);
          if (dt) selectedDateIso = toIsoDate(dt);
        } else {
          console.warn('  Calendario data: giorno non trovato o non cliccabile');
          await fill('dateInput', reservation.date, 'data');
        }
      }
    } else {
      await fill('dateInput', reservation.date, 'data');
    }

    const timeDropSel = sel.timeDropdown || '';
    const timeListSel = '.rd-time-dropdown .time-list-container li, .time-list-container .drop-list li, .drop-list li, [class*="timeslot"]';
    if (timeDropSel && reservation.time) {
      try {
        await ctx.locator(timeDropSel).first().click();
        const hasTimeDropdown = (await ctx.locator('time-dropdown').first().count().catch(() => 0)) > 0;
        const scope = hasTimeDropdown ? ctx.locator('time-dropdown').first() : ctx;
        const exactItem = scope.locator(timeListSel).filter({ hasText: reservation.time }).first();
        try {
          await exactItem.click({ timeout: 100 });
          console.log('  Selezionato orario richiesto (dropdown)');
        } catch {
          const items = scope.locator(timeListSel);
          await items.first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => null);
          const texts = await items.evaluateAll((nodes) => nodes.map((el) => (el.textContent || '').trim()).filter(Boolean));
          const requestedMin = parseTimeToMinutes(reservation.time);
          const idx = findClosestTimeIndex(requestedMin, texts);
          const chosenTimeStr = (texts[idx] || '').trim();
          if (!chosenTimeStr) {
            console.warn('  Nessun orario disponibile nel dropdown');
          } else {
            // Locate by text so we click the right element (texts can be fewer than items if some are empty)
            const chosen = scope.locator(timeListSel).filter({ hasText: chosenTimeStr }).first();
            await chosen.scrollIntoViewIfNeeded().catch(() => null);
            try {
              await chosen.click({ timeout: 2000 });
            } catch {
              await chosen.evaluate((el) => el.click());
            }
            console.log('  Orario richiesto non disponibile, selezionato orario più vicino:', chosenTimeStr);
            await page.waitForTimeout(120);
          }
        }
        // Chiudi il dropdown e attendi prima di cliccare Successivo (evita che la lista resti aperta o si riapra)
        await page.keyboard.press('Escape');
        await page.waitForTimeout(40);
        if (hasTimeDropdown) {
          await ctx.locator('time-dropdown .time-list-container').first().waitFor({ state: 'hidden', timeout: 2000 }).catch(() => null);
        }
        await page.waitForTimeout(20);
      } catch (e) {
        console.warn('  Dropdown orario:', e.message);
        await selectTimeClosest(ctx, reservation.time, sel);
      }
    } else {
      await selectTimeClosest(ctx, reservation.time, sel);
    }

    if (sel.nextButton) await clickButton('nextButton');
    await page.waitForTimeout(120);
  }

  // Step 1b: eventuale scelta tipo tavolo / promozione (es. interno o esterno)
  const promotionContainerSel = sel.promotionContainer || DEFAULT_SELECTORS.promotionContainer;
  const promotionOptionSel = sel.promotionFirstOption || DEFAULT_SELECTORS.promotionFirstOption;
  try {
    const promoContainer = ctx.locator(promotionContainerSel).first();
    await promoContainer.waitFor({ state: 'visible', timeout: 2000 });
    const firstOption = ctx.locator(promotionOptionSel).first();
    await firstOption.waitFor({ state: 'visible', timeout: 1500 });
    await firstOption.click();
    console.log('  Selezionata prima opzione (tipo tavolo/promozione)');
    await page.waitForTimeout(50);
    if (sel.nextButton) await clickButton('nextButton');
    await page.waitForTimeout(100);
  } catch {
    // nessuno step promozione, procedi
  }

  // Step 2: dati di contatto
  if (contact) {
    const firstSel = sel.firstNameInput || '';
    const lastSel = sel.lastNameInput || '';
    if (firstSel && lastSel) {
      const firstName = contact.firstName || (contact.name ? contact.name.split(/\s+/)[0] : '');
      const lastName = contact.lastName || (contact.name ? contact.name.split(/\s+/).slice(1).join(' ') : '');
      await fill('firstNameInput', firstName, 'nome');
      await fill('lastNameInput', lastName, 'cognome');
    } else {
      await fill('nameInput', contact.name, 'nome');
    }
    await fill('emailInput', contact.email, 'email');
    await fill('phoneInput', contact.phone || contact.mobile, 'telefono');
    if (sel.nextButton) await clickButton('nextButton');
    await page.waitForTimeout(100);
  }

  // Step 3: conferma (termini) e invio
  const termsCheckbox = ctx.locator("input[type='checkbox'][data-bind*='areRestaurantTermsAccepted'], input[type='checkbox'][data-bind*='TermsAccepted']").first();
  try {
    await termsCheckbox.check({ timeout: 2000 });
    console.log('  Accettati termini');
  } catch {
    // nessun checkbox termini
  }
  const submitted = await clickButton('nextButton');
  if (submitted) await page.waitForTimeout(120);

  // Step 4: pagamento con carta (Stripe) – iframe separati per numero, scadenza, CVC
  const payment = config.payment;
  const cardNumber = payment?.cardNumber || process.env.STRIPE_CARD_NUMBER;
  const expiry = payment?.expiry || process.env.STRIPE_EXPIRY;
  const cvc = payment?.cvc || process.env.STRIPE_CVC;
  const cardholderName = payment?.cardholderName || process.env.STRIPE_CARDHOLDER_NAME;

  if (cardNumber && expiry && cvc) {
    console.log('Step pagamento Stripe: compilazione carta...');
    await page.waitForTimeout(100);
    const filled = await fillStripePayment(page, ctx, { cardNumber, expiry, cvc, cardholderName }, sel);
    if (filled) {
      await page.waitForTimeout(80);
      await clickButton('nextButton');
      await page.waitForTimeout(120);
      await clickButton('nextButton');
      const waitMs = typeof waitAfterPaymentConfirm === 'number' ? waitAfterPaymentConfirm : 30000;
      if (waitMs > 0) {
        console.log(`Attendendo ${waitMs / 1000}s per conferma carta (3D Secure / banca)... Completa l'operazione sulla pagina se richiesto.`);
        await page.waitForTimeout(waitMs);
      }
    } else {
      console.warn('Form Stripe non trovato (il ristorante potrebbe non richiedere carta in questo step).');
    }
  }

  console.log('Flusso di prenotazione completato. Controlla la pagina per conferma.');
}

/**
 * Compila i campi carta negli iframe Stripe (card number, expiry, CVC).
 * Prova prima sulla page, poi dentro il frame ResDiary se ctx è un FrameLocator.
 * @param {import('playwright').Page} page
 * @param {import('playwright').FrameLocator|import('playwright').Page} ctx
 * @param {{ cardNumber: string, expiry: string, cvc: string, cardholderName?: string }} data
 * @param {Record<string, string>} sel
 * @returns {Promise<boolean>} true se almeno un campo è stato compilato
 */
async function fillStripePayment(page, ctx, data, sel) {
  const { cardNumber, expiry, cvc, cardholderName } = data;
  const tryContext = async (context) => {
    const cardFrameSel = sel.stripeCardFrame || DEFAULT_SELECTORS.stripeCardFrame;
    const expiryFrameSel = sel.stripeExpiryFrame || DEFAULT_SELECTORS.stripeExpiryFrame;
    const cvcFrameSel = sel.stripeCvcFrame || DEFAULT_SELECTORS.stripeCvcFrame;
    const cardInputSel = sel.stripeCardInput || DEFAULT_SELECTORS.stripeCardInput;
    const expiryInputSel = sel.stripeExpiryInput || DEFAULT_SELECTORS.stripeExpiryInput;
    const cvcInputSel = sel.stripeCvcInput || DEFAULT_SELECTORS.stripeCvcInput;
    let ok = false;
    try {
      const cardFrame = context.frameLocator(cardFrameSel).first();
      await cardFrame.locator(cardInputSel).waitFor({ state: 'visible', timeout: 1500 });
      await cardFrame.locator(cardInputSel).fill(cardNumber);
      ok = true;
      console.log('  Compilato numero carta (Stripe)');
    } catch {
      // skip
    }
    try {
      const expiryFrame = context.frameLocator(expiryFrameSel).first();
      await expiryFrame.locator(expiryInputSel).waitFor({ state: 'visible', timeout: 1200 });
      await expiryFrame.locator(expiryInputSel).fill(expiry);
      ok = true;
      console.log('  Compilato scadenza (Stripe)');
    } catch {
      // skip
    }
    try {
      const cvcFrame = context.frameLocator(cvcFrameSel).first();
      await cvcFrame.locator(cvcInputSel).waitFor({ state: 'visible', timeout: 1200 });
      await cvcFrame.locator(cvcInputSel).fill(cvc);
      ok = true;
      console.log('  Compilato CVC (Stripe)');
    } catch {
      // skip
    }
    if (cardholderName) {
      const cardholderSel = sel.cardholderNameInput || DEFAULT_SELECTORS.cardholderNameInput;
      try {
        const nameLoc = context.locator(cardholderSel).first();
        await nameLoc.waitFor({ state: 'visible', timeout: 1200 });
        await nameLoc.fill(cardholderName);
        console.log('  Compilato nome titolare carta');
      } catch {
        // skip
      }
    }
    return ok;
  };

  // Prefer booking context first: avoids slow probing on wrong document.
  if (ctx !== page) if (await tryContext(ctx)) return true;
  if (await tryContext(page)) return true;
  if (ctx !== page) return tryContext(ctx);
  return false;
}

export async function main() {
  const config = loadConfig(CONFIG_PATH);
  const isDebug = typeof process.execArgv !== 'undefined' && process.execArgv.some((a) => String(a).includes('inspect'));
  const headed = process.env.HEADED === '1' || isDebug;

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  if (config.ignoreHttpsErrors) await context.setIgnoreHTTPSErrors(true);

  const page = await context.newPage();
  page.setDefaultTimeout(config.timeout || 30000);

  try {
    await runBooking(page, config);
    if (headed) await page.waitForTimeout(5000);
  } finally {
    await browser.close();
  }
  console.log('Fatto.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
