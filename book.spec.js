/**
 * Test per resdiary-booking: build URL e (opzionale) caricamento config.
 */
import { test, expect } from '@playwright/test';
import { buildBookingUrl } from './utils.js';

test('buildBookingUrl aggiunge date, time e partySize', () => {
  const base = 'https://booking.resdiary.com/widget/Standard/TRATTORIATRIPPA/8771';
  const url = buildBookingUrl(base, {
    date: '2025-03-15',
    time: '19:30',
    partySize: 2,
  });
  expect(url).toContain('date=2025-03-15');
  expect(url).toContain('time=19%3A30');
  expect(url).toContain('partySize=2');
});

test('buildBookingUrl senza reservation restituisce baseUrl', () => {
  const base = 'https://example.com/book';
  expect(buildBookingUrl(base, null)).toBe(base);
  expect(buildBookingUrl(base, {})).toBe(base);
});
