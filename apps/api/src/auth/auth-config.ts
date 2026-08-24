export interface AuthHttpConfig {
  webOrigin: string;
  sessionTtlSeconds: number;
  secureCookies: boolean;
}

export const AUTH_HTTP_CONFIG = Symbol('AUTH_HTTP_CONFIG');
export const AUTH_SERVICE = Symbol('AUTH_SERVICE');
