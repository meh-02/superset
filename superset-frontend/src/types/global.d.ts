// AHMS: lock values seeded via the `native_filters` URL param.
// Filters listed here keep their × hidden and resist "Clear all".
declare global {
  interface Window {
    __supersetLockedFilters?: Record<string, (string | number)[]>;
  }
}
export {};
