// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
  
  // API configuration is injected by the server into index.html
  interface Window {
    API_CONFIG?: import('$lib/utils/api').ApiConfig;
    // Legacy support for old API_PORT injection
    API_PORT?: number;
  }
}

export {};
