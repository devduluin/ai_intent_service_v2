export const ID_DAY_NAMES: Record<string, number> = {
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  jumaat: 5,
  sabtu: 6,
  minggu: 0
};

export const ID_TIME_OF_DAY: Record<string, string> = {
  pagi: '08:00',
  siang: '12:00',
  sore: '17:00',
  malam: '19:00'
};

export function normalizeIndonesianMeridiem(hour: number, meridiem?: string): number {
  if (!meridiem) return hour;

  const normalized = meridiem.toLowerCase();
  if (normalized === 'sore' || normalized === 'malam') {
    return hour < 12 ? hour + 12 : hour;
  }

  if (normalized === 'siang') {
    return hour < 11 ? hour + 12 : hour;
  }

  return hour;
}
