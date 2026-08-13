import express from 'express';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import { createServer as createViteServer } from 'vite';

dotenv.config();

interface AuthUser {
  id: string;
  googleId: string;
  email: string;
  name: string;
  picture: string;
  accessToken?: string;
  refreshToken?: string;
}

const users = new Map<string, AuthUser>();

function getAppOrigin(req: express.Request) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  const GOOGLE_CALLBACK_URL =
    process.env.GOOGLE_CALLBACK_URL ||
    `http://localhost:${PORT}/api/auth/google/callback`;

  const JWT_SECRET = process.env.JWT_SECRET;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !JWT_SECRET) {
    console.warn(
      '⚠️ Google OAuth is not fully configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and JWT_SECRET.'
    );
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID || '',
        clientSecret: GOOGLE_CLIENT_SECRET || '',
        callbackURL: GOOGLE_CALLBACK_URL,
      },
      async (
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done
      ) => {
        try {
          const email = profile.emails?.[0]?.value || '';
          const existing = users.get(profile.id);

          const user: AuthUser = existing || {
            id: profile.id,
            googleId: profile.id,
            email,
            name: profile.displayName || email.split('@')[0],
            picture: profile.photos?.[0]?.value || '',
          };

          user.email = email;
          user.name = profile.displayName || email.split('@')[0];
          user.picture = profile.photos?.[0]?.value || '';
          user.accessToken = accessToken;

          if (refreshToken) {
            user.refreshToken = refreshToken;
          }

          users.set(profile.id, user);

          console.log(`✅ Google authenticated: ${email}`);
          console.log(
            `🔑 Access token: ${accessToken ? 'AVAILABLE' : 'MISSING'}`
          );
          console.log(
            `🔄 Refresh token: ${
              user.refreshToken ? 'AVAILABLE' : 'MISSING'
            }`
          );

          return done(null, user);
        } catch (error) {
          console.error('❌ Google authentication error:', error);
          return done(error as Error);
        }
      }
    )
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );

  app.use(passport.initialize());

  // Health check for Render
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
    });
  });

  // Google OAuth login
  app.get(
    '/api/auth/google',
    passport.authenticate('google', {
      scope: [
        'profile',
        'email',
        'https://www.googleapis.com/auth/drive.file',
      ],
      accessType: 'offline',
      prompt: 'consent',
    })
  );

  // Google OAuth callback
  app.get(
    '/api/auth/google/callback',
    passport.authenticate('google', {
      session: false,
      failureRedirect: '/?auth=failed',
    }),
    (req, res) => {
      try {
        if (!JWT_SECRET) {
          throw new Error('JWT_SECRET is not configured');
        }

        const user = req.user as AuthUser;

        const token = jwt.sign(
          {
            userId: user.id,
            email: user.email,
            name: user.name,
            picture: user.picture,
          },
          JWT_SECRET,
          {
            expiresIn: '7d',
          }
        );

        const isProduction = process.env.NODE_ENV === 'production';

        res.cookie('token', token, {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000,
          path: '/',
        });

        res.redirect(getAppOrigin(req) + '/');
      } catch (error) {
        console.error('❌ JWT creation error:', error);
        res.redirect(getAppOrigin(req) + '/?auth=failed');
      }
    }
  );

  // Restore logged-in user
  app.get('/api/auth/me', (req, res) => {
    try {
      if (!JWT_SECRET) {
        return res.status(500).json({
          success: false,
          error: 'JWT_SECRET is not configured',
        });
      }

      const token = req.cookies.token;

      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated',
        });
      }

      const decoded = jwt.verify(token, JWT_SECRET) as {
        userId: string;
        email: string;
        name: string;
        picture?: string;
      };

      const user = users.get(decoded.userId);

      return res.json({
        success: true,
        user: {
          id: decoded.userId,
          email: decoded.email,
          name: decoded.name,
          picture: decoded.picture || '',
        },
        driveAuthorized: Boolean(user?.refreshToken),
      });
    } catch {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session',
      });
    }
  });

  // Logout
  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie('token', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });

    res.json({
      success: true,
    });
  });

  // Development: Vite middleware
  // Production: serve built frontend from dist
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');

    app.use(express.static(distPath));

    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server listening on http://0.0.0.0:${PORT}`);
    console.log(`🔐 Google OAuth: /api/auth/google`);
    console.log(`↩️ Google callback: ${GOOGLE_CALLBACK_URL}`);
  });
}

startServer();