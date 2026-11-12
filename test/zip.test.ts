import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { parseWhatsAppExport } from '../src/logic';
import { chatTextFromZip, looksLikeZip } from '../src/zip';

const CHAT = [
  '09/10/2026, 18:05 - Rasheed: Tech Fellowship',
  'Deadline: 30 November https://forms.gle/xyz',
].join('\n');

test('reads _chat.txt out of a WhatsApp export zip, skipping media', () => {
  const zip = zipSync({
    '_chat.txt': strToU8(CHAT),
    '00000012-PHOTO-2026-10-09.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
  });
  assert.equal(looksLikeZip(zip), true);
  const text = chatTextFromZip(zip);
  assert.equal(text, CHAT);
  assert.equal(parseWhatsAppExport(text!).length, 1);
});

test('falls back to the WhatsApp-named text file, and rejects things that are not zips', () => {
  const zip = zipSync({ 'notes.md': strToU8('x'), 'WhatsApp Chat with Me.txt': strToU8(CHAT) });
  assert.equal(chatTextFromZip(zip), CHAT);
  assert.equal(chatTextFromZip(strToU8('just some text')), null);
  assert.equal(chatTextFromZip(zipSync({ 'photo.jpg': new Uint8Array([1, 2]) })), null);
});
