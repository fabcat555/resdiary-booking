import { readFileSync, existsSync } from 'fs';
import { format, getHours, getMinutes, isValid, parse, parseISO } from 'date-fns';

/** Carica la configurazione da un file JSON. Esce con codice 1 se il file non esiste. */
export function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    console.error('Crea config.json (copia da config.example.json) e compila bookingUrl, reservation e contact.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

/**
 * Costruisce l'URL di prenotazione con query params ResDiary (date, time, partySize).
 * @param {string} baseUrl
 * @param {{ date?: string, time?: string, partySize?: number }} reservation
 * @returns {string}
 */
export function buildBookingUrl(baseUrl, reservation) {
  if (!reservation?.date) return baseUrl;
  const url = new URL(baseUrl);
  if (reservation.date) url.searchParams.set('date', reservation.date);
  if (reservation.time) url.searchParams.set('time', reservation.time);
  if (reservation.partySize != null) url.searchParams.set('partySize', String(reservation.partySize));
  return url.toString();
}

/**
 * Cerca un elemento che matcha uno dei selettori (separati da virgola).
 * Restituisce il locator per il primo selettore della lista.
 * @param {import('playwright').FrameLocator|import('playwright').Page} context
 * @param {string} selectorString
 * @returns {import('playwright').Locator}
 */
export function findLocator(context, selectorString) {
  const selectors = selectorString.split(',').map((s) => s.trim()).filter(Boolean);
  const sel = selectors[0] || 'body';
  return context.locator(sel).first();
}

/** ResDiary widget selectors (hardcoded; same structure across ResDiary/Trippa). */
export const DEFAULT_SELECTORS = {
  iframe: "iframe[src*='resdiary'], iframe[src*='book.']",
  dateInput: "input[name='date'], input[id*='date'], input[type='date']",
  timeSelect: "select[name='time'], select[id*='time']",
  partySizeSelect: "select[name='partySize'], select[name='covers'], select[id*='party'], select[id*='covers']",
  nameInput: "input[name='name'], input[name='firstName'], input[id*='name']",
  firstNameInput: "#firstName",
  lastNameInput: "#lastName",
  emailInput: "#emailAddress",
  phoneInput: "#mobile",
  searchAvailabilityButton: "button:has-text('Cerca'), button:has-text('Search'), button:has-text('Verifica'), a:has-text('Cerca')",
  timeSlotButton: "button[data-time], a[data-time], .time-slot, [class*='timeslot']",
  submitButton: "button[type='submit'], input[type='submit'], button:has-text('Prenota'), button:has-text('Conferma'), button:has-text('Book'), button:has-text('Confirm'), button:has-text('Completa Prenotazione'), button:has-text('Invia prenotazione')",
  confirmButton: "button:has-text('Conferma'), button:has-text('Confirm'), input[type='submit']",
  nextButton: "button.btn-next",
  promotionContainer: "#promotion .list-group-promotion, .list-group.list-group-promotion",
  promotionFirstOption: ".list-group-promotion .list-group-item, .list-group-promotion .clickable-promotion-text",
  partySizeDropdown: "#party-size-input .covers-input, #party-size-input .dropdown-selected, #party-size-input",
  datePickerDay: "td[data-action='selectDay'][data-day='__DATE__']:not(.disabled)",
  datePickerNext: "th.next[data-action='next']:not(.disabled), .datepicker th.next:not(.disabled)",
  datePickerPrev: "th.prev[data-action='previous']:not(.disabled), .datepicker th.prev:not(.disabled)",
  timeDropdown: ".rd-time-dropdown .dropdown-selected, .time-dropdown-input, .selected-text",
  timeSlotRow: "li.timeslot-row",
  timeSlotText: ".timeslot-text",
  stripeCardFrame: "#card-number iframe",
  stripeExpiryFrame: "#card-expiry iframe",
  stripeCvcFrame: "#card-cvc iframe",
  stripeCardInput: "input[name='cardnumber']",
  stripeExpiryInput: "input[name='exp-date']",
  stripeCvcInput: "input[name='cvc']",
  cardholderNameInput: "input[data-id='cardholder-name-input']",
  payButton: "button[data-id='btn-next'], button.btn-next",
};

/** Converte un orario in minuti da mezzanotte. ResDiary usa sempre HH:mm (24h). Accetta anche H:mm e HH.mm. Restituisce NaN se non parsabile. */
export function parseTimeToMinutes(str) {
  if (!str || typeof str !== 'string') return NaN;
  const normalized = String(str).trim().replace('.', ':');
  let d = parse(normalized, 'HH:mm', new Date(0));
  if (!isValid(d)) d = parse(normalized, 'H:mm', new Date(0));
  if (!isValid(d)) return NaN;
  const h = getHours(d);
  const min = getMinutes(d);
  if (h < 0 || h > 23 || min < 0 || min > 59) return NaN;
  return h * 60 + min;
}

/** Indice dell'orario più vicino a requestedMinutes (avanti o indietro). times in formato HH:mm. */
export function findClosestTimeIndex(requestedMinutes, times) {
  if (!times.length || Number.isNaN(requestedMinutes)) return 0;
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const min = parseTimeToMinutes(times[i]);
    if (Number.isNaN(min)) continue;
    const diff = Math.abs(min - requestedMinutes);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Parsa una stringa DD/MM/YYYY in Date (ResDiary usa sempre questo formato). Ritorna null se invalida. */
export function parseDdMmYyyy(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const d = parse(dateStr, 'dd/MM/yyyy', new Date());
  return isValid(d) ? d : null;
}

/** Parsa una stringa ISO (YYYY-MM-DD) in Date; ritorna null se invalida. */
export function parseIsoDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const d = parseISO(dateStr);
  return isValid(d) ? d : null;
}

/** Formatta una Date in stringa ISO YYYY-MM-DD; ritorna null se invalida. */
export function toIsoDate(dt) {
  if (!dt || !(dt instanceof Date) || !isValid(dt)) return null;
  return format(dt, 'yyyy-MM-dd');
}

