import { AuthError, type AuthService, type SafeUser } from '@customer-ops/auth';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApplicationError } from '../errors/application-error';
import { getAuthenticatedPrincipal, type AuthenticatedRequest } from './authenticated-request';
import { AUTH_HTTP_CONFIG, AUTH_SERVICE, type AuthHttpConfig } from './auth-config';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookies';
import { SameOriginGuard } from './same-origin.guard';
import { SessionAuthGuard } from './session-auth.guard';

interface UserResponse {
  user: SafeUser;
}

function translateAuthError(error: unknown): never {
  if (!(error instanceof AuthError)) {
    throw error;
  }
  if (error.code === 'validation_error') {
    throw new ApplicationError({
      code: 'validation_error',
      httpStatus: 400,
      safeMessage: 'Invalid authentication request',
    });
  }
  if (error.code === 'invalid_credentials') {
    throw new ApplicationError({
      code: 'invalid_credentials',
      httpStatus: 401,
      safeMessage: 'Invalid credentials',
    });
  }
  throw new ApplicationError({
    code: 'duplicate_registration',
    httpStatus: 409,
    safeMessage: 'Registration conflicts with an existing account',
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly authService: AuthService,
    @Inject(AUTH_HTTP_CONFIG) private readonly config: AuthHttpConfig,
  ) {}

  @Post('register')
  @UseGuards(SameOriginGuard)
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponse> {
    try {
      const result = await this.authService.register(body);
      setSessionCookie(response, result.rawSessionToken, this.config);
      return { user: result.user };
    } catch (error) {
      return translateAuthError(error);
    }
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponse> {
    try {
      const result = await this.authService.login(body);
      setSessionCookie(response, result.rawSessionToken, this.config);
      return { user: result.user };
    } catch (error) {
      return translateAuthError(error);
    }
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SameOriginGuard)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(readSessionCookie(request.get('cookie')));
    clearSessionCookie(response, this.config);
  }

  @Post('logout-all')
  @HttpCode(204)
  @UseGuards(SameOriginGuard, SessionAuthGuard)
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logoutAll(getAuthenticatedPrincipal(request));
    clearSessionCookie(response, this.config);
  }

  @Get('session')
  @UseGuards(SessionAuthGuard)
  getSession(@Req() request: AuthenticatedRequest): UserResponse {
    const principal = getAuthenticatedPrincipal(request);
    return { user: { id: principal.userId, email: principal.email } };
  }
}
