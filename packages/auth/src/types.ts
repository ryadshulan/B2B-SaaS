export type UserStatus = 'active' | 'disabled';

export interface SafeUser {
  id: string;
  email: string;
}

export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
}

export interface AuthenticatedSession extends AuthenticatedPrincipal {
  sessionId: string;
}

export interface AuthenticationSuccess {
  user: SafeUser;
  rawSessionToken: string;
}

export interface AuthDatabaseSchema {
  users: {
    id: string;
    email: string;
    email_normalized: string;
    status: UserStatus;
    created_at: Date;
    updated_at: Date;
  };
  auth_password_credentials: {
    user_id: string;
    password_hash: string;
    password_changed_at: Date;
  };
  auth_sessions: {
    id: string;
    user_id: string;
    token_hash: string;
    created_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
  };
}
