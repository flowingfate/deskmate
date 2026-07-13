export interface ClientLocalTime {
  localTime: string;
  timeZone: string;
  utcOffset: string;
}

export function formatClientLocalTime(timestamp: number): ClientLocalTime {
  const date = new Date(timestamp);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetMinutes = date.getTimezoneOffset();
  const sign = offsetMinutes <= 0 ? '+' : '-';
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return {
    localTime: `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`,
    timeZone,
    utcOffset: `UTC${sign}${offsetHours}:${offsetRemainder}`,
  };
}
