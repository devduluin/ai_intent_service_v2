import type { ActiveOffer } from '../types/active-offer.types';

export type OfferResponseDecision = boolean | null;

export function normalizeOfferResponseText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyDeterministicOfferResponse(
  text: string,
  offer: ActiveOffer
): OfferResponseDecision {
  const normalized = normalizeOfferResponseText(text);

  if (/^(ya|iya|boleh|lanjut|ok|oke|yes|y)$/.test(normalized)) {
    return true;
  }

  if (/^(ya|iya|boleh|ok|oke|yes)\s+(tampilkan|lihat|lanjut|jalankan|buka|show|continue)\b/.test(normalized)) {
    if (hasNonOfferResidue(normalized, offer)) {
      return null;
    }
    return true;
  }

  if (/^(tampilkan|lihat|lanjut|jalankan|buka|show|continue)\s+(saja|itu|sekarang|dong)?$/.test(normalized)) {
    if (hasNonOfferResidue(normalized, offer)) {
      return null;
    }
    return true;
  }

  if (/^(tidak|nggak|gak|ga|batal|jangan|no|n)$/.test(normalized)) {
    return false;
  }

  if (/^(tampilkan|lihat|lanjut|jalankan|buka|show|continue)\b/.test(normalized) && hasNonOfferResidue(normalized, offer)) {
    return null;
  }

  return null;
}

export function hasNonOfferResidue(normalizedText: string, offer: ActiveOffer): boolean {
  const commandStripped = normalizedText
    .replace(/^(ya|iya|boleh|ok|oke|yes)\s+/i, ' ')
    .trim()
    .replace(/^(tampilkan|lihat|lanjut|jalankan|buka|show|continue)\s*/i, ' ')
    .replace(/\b(saja|aja|itu|sekarang|dong|please)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!commandStripped) return false;

  const allowedText = [
    offer.type,
    offer.label,
    offer.target.key,
    offer.target.resource,
    offer.reason
  ].join(' ').toLowerCase();

  const residueTokens = commandStripped
    .split(/\s+/)
    .filter(token => token.length >= 3);

  if (residueTokens.length === 0) return false;
  return !residueTokens.every(token => allowedText.includes(token));
}
